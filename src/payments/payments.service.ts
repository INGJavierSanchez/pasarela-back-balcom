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
import { GetPaymentsReportDto } from './dto/get-payments-report.dto';

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
    let customerEmail: string | undefined = dto.customerEmail;
    let customerPhone: string | undefined;
    let routerName = '';

    try {
      // Usar el WebService (Scraping) que funciona para buscar al cliente
      const result = await this.wisphubWebService.getClienteFacturas(
        this.wisphubCredentials,
        dto.customerId
      );

      this.logger.log(`Resultados de Wisphub para ${dto.customerId}: Name="${result?.customerName}", Email="${result?.customerEmail}", Phone="${result?.customerPhone}", Router="${result?.router}"`);

      if (result) {
        if (result.customerName) customerName = result.customerName;
        if (result.customerEmail) customerEmail = result.customerEmail;
        if (result.customerPhone) customerPhone = result.customerPhone;
        routerName = (result.router || '').trim().toUpperCase();
      }
    } catch (e) {
      this.logger.warn(`No se pudo obtener datos del cliente ${dto.customerId} via WispHub Web Service: ${e.message}`);
    }

    const configKey = routerName.includes('SINCELEJO') ? 'DEFAULT' : 'MAG';
    this.logger.log(`Router detectado: "${routerName}" -> Usando configuración Wompi: ${configKey}`);

    // Limpiar teléfono para Wompi (solo dígitos, 10 últimos)
    const cleanPhone = customerPhone ? customerPhone.replace(/\D/g, '').slice(-10) : undefined;

    const wompiPayload = {
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
      customerEmail,
      customerData: {
        fullName: customerName,
        phoneNumber: cleanPhone,
        legalId: dto.customerId,
        legalIdType: 'CC',
      },
      metadata: {
        customerId: dto.customerId,
        wompiConfig: configKey,
      },
    };

    this.logger.log(`Enviando a Wompi (${configKey}) con payload: ${JSON.stringify(wompiPayload)}`);

    const link = await this.wompiService.createPaymentLink(wompiPayload, configKey as 'DEFAULT' | 'MAG');

    this.logger.debug(`Wompi link response: ${JSON.stringify(link)}`);

    // Wompi puede devolver la URL directamente o solo el ID
    const paymentUrl = link.url ?? `https://checkout.wompi.co/l/${link.id}`;

    return {
      customerName,
      paymentLinkId: link.id,
      url: paymentUrl,
      expiresAt: link.expires_at,
    };
  }

  async handleWebhook(payload: any, signature?: string, rawBody?: string) {
    const eventType = payload?.event;
    const transaction = payload?.data?.transaction;

    if (!transaction) {
      this.logger.warn('Webhook recibido sin datos de transacción');
      return;
    }

    // Extraer metadata para saber qué configuración se usó
    const metadata =
      transaction.payment_link?.data?.metadata ?? transaction.metadata ?? {};
    const configKey = metadata.wompiConfig || 'DEFAULT';

    // Validar firma con la configuración correspondiente
    this.wompiService.assertSignature(signature, payload, rawBody, configKey as 'DEFAULT' | 'MAG');

    if (transaction.status !== 'APPROVED') {
      this.logger.log(
        `Ignorando transacción con estado: ${transaction.status}`,
      );
      return;
    }

    // El metadata ya fue extraído arriba para la firma
    let customerId = 
      metadata.customerId || 
      metadata.customer_id || 
      transaction.customer_data?.legal_id || 
      transaction.customer_data?.legalId;

    if (!customerId && transaction.payment_link_id) {
      this.logger.debug(`Buscando customerId en el Payment Link original: ${transaction.payment_link_id}`);
      try {
        const linkData = await this.wompiService.getPaymentLink(
          transaction.payment_link_id,
          configKey as 'DEFAULT' | 'MAG'
        );
        customerId = 
          linkData?.metadata?.customerId || 
          linkData?.metadata?.customer_id || 
          linkData?.customer_data?.legal_id ||
          linkData?.customer_data?.legalId ||
          transaction.customer_email; // Último recurso
      } catch (e) {
        this.logger.warn(`Error buscando payment link original: ${e.message}`);
      }
    }

    if (!customerId) {
      this.logger.warn(
        `Transacción aprobada sin customerId en metadata o customer_data. Transaction: ${JSON.stringify(transaction)}`
      );
      return;
    }

    // ─── Buscar la factura pendiente del cliente ────────────────────────────────
    // Usamos el Web Service en lugar de la API que da 403
    let pendingInvoices: any[] = [];
    let fetchError: string | null = null;
    try {
      const result = await this.wisphubWebService.getClienteFacturas(
        this.wisphubCredentials,
        String(customerId)
      );
      pendingInvoices = result.pending;
    } catch (e) {
      fetchError = e.message;
      this.logger.warn(`Error buscando facturas vía WebService: ${e.message}`);
    }

    const targetInvoice =
      pendingInvoices && pendingInvoices.length > 0 ? pendingInvoices[0] : null;

    if (!targetInvoice) {
      this.logger.warn(
        `No se encontraron facturas pendientes para el cliente ${customerId}. ` +
          `El pago de Wompi (ref: ${transaction.id}) NO fue registrado en WispHub.`,
      );
    } else {
      this.logger.log(
        `Cliente ${customerId}: ${pendingInvoices.length} factura(s) pendiente(s). ` +
          `Registrando pago en factura ID=${targetInvoice.id}`,
      );
    }

    // ─── Guardar en Base de Datos (PostgreSQL) ──────────────────────────────
    try {
      let paymentRecord = await this.paymentRecordRepository.findOne({
        where: { transactionId: transaction.id }
      });

      if (!paymentRecord) {
        paymentRecord = this.paymentRecordRepository.create({
          transactionId: transaction.id,
          customerId: String(customerId),
          invoiceId: targetInvoice ? Number(targetInvoice.id) : 0,
          amountInCents: transaction.amount_in_cents,
          currency: transaction.currency,
          status: transaction.status,
          paymentMethod: transaction.payment_method?.type,
          metadata: {
            ...metadata,
            wisphubSyncStatus: targetInvoice ? 'PENDING' : 'NO_INVOICE_FOUND',
            wisphubSyncError:
              fetchError ||
              (!targetInvoice ? 'No se encontraron facturas pendientes' : null),
          },
        });
        await this.paymentRecordRepository.save(paymentRecord);
        this.logger.log(
          `Pago guardado en la base de datos local con ID: ${paymentRecord.id}`,
        );
      } else {
        this.logger.log(`El pago Wompi ${transaction.id} ya existe en la Base de Datos. Procediendo a reintentar WispHub...`);
      }

      if (paymentRecord?.metadata?.wisphubSyncStatus === 'SUCCESS') {
        this.logger.log(
          `La transaccion ${transaction.id} ya estaba sincronizada en WispHub (idempotencia).`,
        );
        return;
      }
    } catch (dbError) {
      this.logger.error(
        `Error guardando el pago en la base de datos. Transaction ID: ${transaction.id} - ${dbError.message}`,
      );
    }

    // Si no hay factura destino, abortar el registro en Wisphub
    if (!targetInvoice) {
      return;
    }

    // Si tiene 3 o más facturas pendientes, SOLO registrar el pago (acción 0).
    // Si tiene menos de 3, Registrar y Activar (acción 1).
    const accionWispHub = pendingInvoices.length >= 3 ? 0 : 1;

    // ─── Registrar el pago en WispHub (vía Scraping Web) ──────────────────────
    try {
      await this.wisphubWebService.registerPayment(
        this.wisphubCredentials,
        String(targetInvoice.id),
        transaction.amount_in_cents,
        transaction.id,
        accionWispHub,
      );

      const existingRecord = await this.paymentRecordRepository.findOne({
        where: { transactionId: transaction.id }
      });
      if (existingRecord) {
        existingRecord.metadata = {
          ...existingRecord.metadata,
          wisphubSyncStatus: 'SUCCESS',
          wisphubSyncAt: new Date().toISOString(),
          wisphubSyncError: null,
        };
        await this.paymentRecordRepository.save(existingRecord);
      }

      this.logger.log(
        `Pago registrado exitosamente en WispHub: cliente=${customerId}, factura=${targetInvoice.id}, ` +
          `monto=${transaction.amount_in_cents / 100} COP, ref=${transaction.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Falló el reporte del pago a WispHub Web: ${error.message}`,
      );
      const existingRecord = await this.paymentRecordRepository.findOne({
        where: { transactionId: transaction.id }
      });
      if (existingRecord) {
        existingRecord.metadata = {
          ...existingRecord.metadata,
          wisphubSyncStatus: 'ERROR',
          wisphubSyncError: error.message,
        };
        await this.paymentRecordRepository.save(existingRecord);
      }
    }
  }

  async getReport(filters: GetPaymentsReportDto) {
    const { startDate, endDate, customerId, status, page, limit } = filters;
    const query = this.paymentRecordRepository.createQueryBuilder('payment');

    if (startDate) {
      // Forzar que sea la medianoche de Bogotá (-05:00) y convertir a objeto Date (UTC)
      const start = new Date(`${startDate}T00:00:00-05:00`);
      query.andWhere('payment.createdAt >= :start', { start });
    }

    if (endDate) {
      // Forzar que sea el final del día en Bogotá (-05:00) y convertir a objeto Date (UTC)
      const end = new Date(`${endDate}T23:59:59.999-05:00`);
      query.andWhere('payment.createdAt <= :end', { end });
    }

    if (customerId) {
      query.andWhere('payment.customerId = :customerId', { customerId });
    }

    if (status) {
      query.andWhere('payment.status = :status', { status });
    }

    query.orderBy('payment.createdAt', 'DESC');

    const total = await query.getCount();
    const data = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
