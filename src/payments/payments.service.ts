import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { WompiService } from './wompi.service';
import { WisphubService } from '../wisphub/wisphub.service';
import { RegisterPaymentDto } from '../wisphub/dto/register-payment.dto';
import { PaymentRecord } from './entities/payment-record.entity';
import { WisphubWebService } from '../wisphub/wisphub-web.service';
import { WisphubLoginDto } from '../wisphub/dto/wisphub-login.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly wompiService: WompiService,
    private readonly wisphubService: WisphubService,
    private readonly wisphubWebService: WisphubWebService,
    private readonly configService: ConfigService,
    @InjectRepository(PaymentRecord)
    private readonly paymentRecordRepository: Repository<PaymentRecord>,
  ) { }

  private get wisphubCredentials(): WisphubLoginDto {
    return {
      login: this.configService.get<string>('WISPHUB_WEB_LOGIN')!,
      password: this.configService.get<string>('WISPHUB_WEB_PASSWORD')!,
    };
  }

  async createPaymentLink(dto: CreatePaymentLinkDto) {
    let customerName = `Cliente ${dto.customerId}`;
    let customerEmail;

    try {
      // Usar el WebService (Scraping) que funciona para buscar al cliente
      const result = await this.wisphubWebService.getClienteFacturas(
        this.wisphubCredentials,
        dto.customerId
      );

      if (result && result.customerName) {
        customerName = result.customerName;
      }
    } catch (e) {
      this.logger.warn(`No se pudo obtener el nombre del cliente ${dto.customerId} via WispHub Web Service`);
    }

    const link = await this.wompiService.createPaymentLink({
      name:
        dto.description ??
        `Pago cliente ${customerName}`,
      description:
        dto.description ??
        `Pago por ${(dto.amountInCents / 100).toFixed(2)} ${dto.currency ?? 'COP'}`,
      amountInCents: dto.amountInCents,
      currency: dto.currency ?? 'COP',
      singleUse: dto.singleUse ?? true,
      redirectUrl:
        dto.redirectUrl ??
        this.configService.get<string>('PAYMENTS_REDIRECT_URL'),
      customerEmail:
        dto.customerEmail ?? customerEmail,
      metadata: {
        customerId: dto.customerId,
      },
    });

    return {
      customerName,
      paymentLinkId: link.id,
      url: link.url,
      expiresAt: link.expires_at,
    };
  }

  async handleWebhook(payload: any, signature?: string, rawBody?: string) {
    this.wompiService.assertSignature(signature, payload, rawBody);

    const eventType = payload?.event;
    const transaction = payload?.data?.transaction;

    if (!transaction) {
      this.logger.warn('Webhook recibido sin datos de transacción');
      return;
    }

    if (transaction.status !== 'APPROVED') {
      this.logger.log(
        `Ignorando transacción con estado: ${transaction.status}`,
      );
      return;
    }

    // Extraer el customerId del metadata (soporta ambas variantes)
    const metadata =
      transaction.payment_link?.data?.metadata ?? transaction.metadata ?? {};
    const customerId = metadata.customerId || metadata.customer_id;

    if (!customerId) {
      this.logger.warn('Transacción aprobada sin customerId en metadata');
      return;
    }

    // ─── Buscar la factura pendiente del cliente ────────────────────────────────
    // Usamos el Web Service en lugar de la API que da 403
    let pendingInvoices: any[] = [];
    try {
      const result = await this.wisphubWebService.getClienteFacturas(
        this.wisphubCredentials,
        String(customerId)
      );
      pendingInvoices = result.pending;
    } catch (e) {
      this.logger.warn(`Error buscando facturas vía WebService: ${e.message}`);
    }

    if (!pendingInvoices || pendingInvoices.length === 0) {
      this.logger.warn(
        `No se encontraron facturas pendientes para el cliente ${customerId}. ` +
        `El pago de Wompi (ref: ${transaction.id}) NO fue registrado en WispHub.`,
      );
      return;
    }

    // Seleccionar la factura más reciente (primera en la lista, ordenada por fecha desc)
    // Si Wompi envía el monto exacto de una factura, también se puede cruzar por monto.
    const targetInvoice = pendingInvoices[0];
    this.logger.log(
      `Cliente ${customerId}: ${pendingInvoices.length} factura(s) pendiente(s). ` +
      `Registrando pago en factura ID=${targetInvoice.id}`,
    );

    // ─── Guardar en Base de Datos (PostgreSQL) ──────────────────────────────
    try {
      const paymentRecord = this.paymentRecordRepository.create({
        transactionId: transaction.id,
        customerId: String(customerId),
        invoiceId: Number(targetInvoice.id),
        amountInCents: transaction.amount_in_cents,
        currency: transaction.currency,
        status: transaction.status,
        paymentMethod: transaction.payment_method?.type,
        metadata: metadata,
      });

      await this.paymentRecordRepository.save(paymentRecord);
      this.logger.log(
        `Pago guardado en la base de datos local con ID: ${paymentRecord.id}`,
      );
    } catch (dbError) {
      this.logger.error(
        `Error guardando el pago en la base de datos. Transaction ID: ${transaction.id}`,
        dbError.stack,
      );
      // Opcional: Decidir si se debe abortar o continuar intentando reportar a wisphub incluso si falla la DB.
      // Por ahora, solo logueamos para no interrumpir la reactivación del servicio.
    }

    // ─── Registrar el pago en WispHub (vía Scraping Web) ──────────────────────
    try {
      await this.wisphubWebService.registerPayment(
        this.wisphubCredentials,
        String(targetInvoice.id),
        transaction.amount_in_cents,
        transaction.id,
        1 // 1 = Registrar pago y reconectar servicio automáticamente
      );
    } catch (error) {
      this.logger.error(`Falló el reporte del pago a WispHub Web: ${error.message}`);
    }

    this.logger.log(
      `Pago registrado exitosamente: cliente=${customerId}, factura=${targetInvoice.id}, ` +
      `monto=${transaction.amount_in_cents / 100} COP, ref=${transaction.id}`,
    );
  }
}
