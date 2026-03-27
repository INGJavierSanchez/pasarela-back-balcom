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
    let suggestedInvoiceId: string | undefined;

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
        if (Array.isArray(result.pending) && result.pending.length > 0) {
          suggestedInvoiceId = String(result.pending[0].id ?? '');
        }
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
        invoiceId: suggestedInvoiceId,
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

    const txMetadata =
      transaction.payment_link?.data?.metadata ?? transaction.metadata ?? {};

    let linkData: any = null;
    let linkMetadata: Record<string, any> = {};
    if (transaction.payment_link_id) {
      try {
        // Primer intento: metadata declarada en el webhook (si existe)
        const preConfig = (txMetadata?.wompiConfig || 'DEFAULT') as 'DEFAULT' | 'MAG';
        linkData = await this.wompiService.getPaymentLink(
          transaction.payment_link_id,
          preConfig,
        );

        // Si no retorna, reintentar con config alterna
        if (!linkData) {
          const altConfig = preConfig === 'MAG' ? 'DEFAULT' : 'MAG';
          linkData = await this.wompiService.getPaymentLink(
            transaction.payment_link_id,
            altConfig,
          );
        }

        linkMetadata = (linkData?.metadata ?? {}) as Record<string, any>;
      } catch (e) {
        this.logger.warn(
          `No se pudo cargar metadata del payment link ${transaction.payment_link_id}: ${e.message}`,
        );
      }
    }

    const metadata = {
      ...txMetadata,
      ...linkMetadata,
    };

    const declaredConfigKey = metadata.wompiConfig || 'DEFAULT';
    this.logger.debug(
      `Webhook recibido: tx=${transaction?.id ?? 'N/A'}, configDeclarada=${declaredConfigKey}`,
    );

    // Validar firma con la configuración correspondiente
    let validatedConfigKey: 'DEFAULT' | 'MAG';
    try {
      validatedConfigKey = this.wompiService.assertSignature(
        signature,
        payload,
        rawBody,
        declaredConfigKey as 'DEFAULT' | 'MAG',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Webhook rechazado por firma. tx=${transaction?.id ?? 'N/A'}, customerId=${metadata?.customerId ?? metadata?.customer_id ?? transaction?.customer_data?.legal_id ?? transaction?.customer_data?.legalId ?? 'N/A'}, configDeclarada=${declaredConfigKey}, motivo=${msg}`,
      );
      throw e;
    }
    if (validatedConfigKey !== declaredConfigKey) {
      this.logger.warn(
        `Webhook tx=${transaction?.id ?? 'N/A'} validado con config=${validatedConfigKey} distinta a la declarada (${declaredConfigKey}).`,
      );
    }

    if (transaction.status !== 'APPROVED') {
      this.logger.log(
        `Ignorando transacción con estado: ${transaction.status}`,
      );
      return;
    }

    // Prioridad de identificación: metadata del link > metadata transacción > legal_id digitado
    let customerId =
      metadata.customerId ||
      metadata.customer_id ||
      linkData?.customer_data?.legal_id ||
      linkData?.customer_data?.legalId ||
      transaction.customer_data?.legal_id ||
      transaction.customer_data?.legalId;

    customerId = this.normalizeCustomerId(customerId);
    const customerEmail = this.normalizeCustomerEmail(transaction.customer_email);

    if (!customerId && customerEmail) {
      customerId = await this.resolveCustomerIdFromEmail(customerEmail);
      if (customerId) {
        this.logger.log(
          `CustomerId resuelto por email en webhook. email=${customerEmail}, customerId=${customerId}, tx=${transaction?.id ?? 'N/A'}`,
        );
      }
    }

    const customerIdFromBuyer =
      transaction.customer_data?.legal_id || transaction.customer_data?.legalId;
    if (
      customerId &&
      customerIdFromBuyer &&
      String(customerId) !== String(customerIdFromBuyer)
    ) {
      this.logger.warn(
        `El documento digitado por comprador (${customerIdFromBuyer}) no coincide con customerId del link (${customerId}). Se usa customerId del link para aplicar el pago.`,
      );
    }

    if (!customerId) {
      this.logger.warn(
        `Transacción aprobada sin customerId resoluble. tx=${transaction?.id ?? 'N/A'}, email=${customerEmail ?? 'N/A'}. Se omite sincronización para evitar buscar por cédula con email.`
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

    const metaInvoiceId =
      metadata.invoiceId ||
      metadata.invoice_id ||
      linkMetadata.invoiceId ||
      linkMetadata.invoice_id;

    let targetInvoice =
      pendingInvoices && pendingInvoices.length > 0 ? pendingInvoices[0] : null;

    if (metaInvoiceId && Array.isArray(pendingInvoices) && pendingInvoices.length > 0) {
      const matchByMeta = pendingInvoices.find(
        (inv: any) => String(inv?.id ?? '') === String(metaInvoiceId),
      );
      if (matchByMeta) {
        targetInvoice = matchByMeta;
      } else {
        this.logger.warn(
          `La factura en metadata (${metaInvoiceId}) no aparece en pendientes de ${customerId}. Se usa la primera pendiente disponible.`,
        );
      }
    }

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
      await this.registerPaymentInWisphubWithFallback(
        Number(targetInvoice.id),
        transaction.amount_in_cents,
        transaction.id,
        transaction.status,
        transaction.currency,
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

    await this.reconcileApprovedPaymentsInReport(data);

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

  private async reconcileApprovedPaymentsInReport(
    records: PaymentRecord[],
  ): Promise<void> {
    const processedInvoiceIds = new Set<number>();

    for (const record of records) {
      if (record.status !== 'APPROVED') continue;
      if (record.metadata?.wisphubSyncStatus === 'SUCCESS') continue;

       const invoiceId = Number(record.invoiceId);
       if (invoiceId > 0) {
        if (processedInvoiceIds.has(invoiceId)) {
          this.logger.debug(
            `Reconciliacion: factura ${invoiceId} ya procesada en esta consulta. Se omite tx=${record.transactionId}.`,
          );
          continue;
        }
        processedInvoiceIds.add(invoiceId);
      }

      await this.reconcileSingleApprovedPayment(record);
    }
  }

  private async reconcileSingleApprovedPayment(
    record: PaymentRecord,
  ): Promise<void> {
    const txId = record.transactionId;

    try {
      if (!record.invoiceId || Number(record.invoiceId) <= 0) {
        await this.updatePaymentSyncMetadata(record, {
          wisphubSyncStatus: 'ERROR',
          wisphubSyncError:
            'No hay invoiceId en BD para reconciliar contra WispHub.',
          wisphubSyncAt: new Date().toISOString(),
        });
        this.logger.warn(
          `Reconciliacion omitida para tx=${txId}: invoiceId invalido (${record.invoiceId}).`,
        );
        return;
      }

      const preState = await this.getWisphubInvoiceState(record.invoiceId);
      if (preState === 'paid') {
        await this.updatePaymentSyncMetadata(record, {
          wisphubSyncStatus: 'SUCCESS',
          wisphubSyncError: null,
          wisphubSyncAt: new Date().toISOString(),
        });
        this.logger.log(
          `Reconciliacion tx=${txId}: la factura ${record.invoiceId} ya estaba pagada en WispHub.`,
        );
        return;
      }

      const action = await this.resolveWisphubAction(record.customerId);

      this.logger.log(
        `Reconciliando tx=${txId}: reintentando registro en WispHub para factura=${record.invoiceId}.`,
      );

      await this.registerPaymentInWisphubWithFallback(
        record.invoiceId,
        record.amountInCents,
        txId,
        record.status,
        record.currency,
        action,
      );

      const postState = await this.getWisphubInvoiceState(record.invoiceId);
      if (postState === 'paid') {
        await this.updatePaymentSyncMetadata(record, {
          wisphubSyncStatus: 'SUCCESS',
          wisphubSyncError: null,
          wisphubSyncAt: new Date().toISOString(),
        });
        this.logger.log(
          `Reconciliacion tx=${txId} completada: factura ${record.invoiceId} ahora esta pagada en WispHub.`,
        );
        return;
      }

      await this.updatePaymentSyncMetadata(record, {
        wisphubSyncStatus: 'ERROR',
        wisphubSyncError:
          `Se reintento registro en WispHub, pero la factura ${record.invoiceId} sigue pendiente.`,
        wisphubSyncAt: new Date().toISOString(),
      });

      this.logger.warn(
        `Reconciliacion tx=${txId}: WispHub mantiene factura ${record.invoiceId} en pendiente.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.updatePaymentSyncMetadata(record, {
        wisphubSyncStatus: 'ERROR',
        wisphubSyncError: `Reconciliacion fallida: ${msg}`,
        wisphubSyncAt: new Date().toISOString(),
      });
      this.logger.error(`Reconciliacion tx=${txId} fallo: ${msg}`);
    }
  }

  private async getWisphubInvoiceState(
    invoiceId: number,
  ): Promise<'pending' | 'paid' | 'not_found'> {
    try {
      const result = (await this.wisphubWebService.getFacturas(
        this.wisphubCredentials,
        String(invoiceId),
        'id_factura',
        'Exacta',
        undefined,
        undefined,
        undefined,
        'fecha_emision',
        undefined,
        1,
        20,
      )) as any;

      const rows = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result)
          ? result
          : [];

      const target = rows.find(
        (row: any) => String(row?.id_factura ?? row?.id ?? '') === String(invoiceId),
      );

      if (!target) return 'not_found';

      const estado = String(target?.estado ?? '').toLowerCase();
      if (estado.includes('pendiente')) return 'pending';
      return 'paid';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `No se pudo consultar estado actual de factura ${invoiceId} en WispHub: ${msg}`,
      );
      return 'not_found';
    }
  }

  private async resolveWisphubAction(customerId: string): Promise<number> {
    try {
      const invoices = await this.wisphubWebService.getClienteFacturas(
        this.wisphubCredentials,
        customerId,
      );
      return invoices.pending.length >= 3 ? 0 : 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `No se pudo calcular accion WispHub para cliente ${customerId}. Se usa accion=1. Error: ${msg}`,
      );
      return 1;
    }
  }

  private async registerPaymentInWisphubWithFallback(
    invoiceId: number,
    amountInCents: number,
    transactionId: string,
    status: string,
    currency: string,
    action: number,
  ): Promise<void> {
    try {
      await this.wisphubWebService.registerPayment(
        this.wisphubCredentials,
        invoiceId,
        amountInCents,
        transactionId,
        action,
      );
      return;
    } catch (webError) {
      const webMsg = webError instanceof Error ? webError.message : String(webError);
      this.logger.warn(
        `Registro web en WispHub fallo para factura ${invoiceId}. Se intentara fallback API: ${webMsg}`,
      );
    }

    const dto: RegisterPaymentDto = {
      invoiceId,
      amountInCents,
      transactionId,
      status,
      currency,
      estado_pago: 1,
      accion: action === 0 ? 0 : 1,
    };

    await this.wisphubService.registerPayment(invoiceId, dto);
  }

  private async updatePaymentSyncMetadata(
    record: PaymentRecord,
    patch: Record<string, any>,
  ): Promise<void> {
    const freshRecord = await this.paymentRecordRepository.findOne({
      where: { id: record.id },
    });
    if (!freshRecord) return;

    freshRecord.metadata = {
      ...(freshRecord.metadata ?? {}),
      ...patch,
    };
    await this.paymentRecordRepository.save(freshRecord);

    record.metadata = freshRecord.metadata;
  }

  private normalizeCustomerId(value: unknown): string | undefined {
    const raw = String(value ?? '').trim();
    if (!raw) return undefined;
    if (raw.includes('@')) return undefined;
    return raw;
  }

  private normalizeCustomerEmail(value: unknown): string | undefined {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return undefined;
    if (!raw.includes('@')) return undefined;
    return raw;
  }

  private async resolveCustomerIdFromEmail(
    email: string,
  ): Promise<string | undefined> {
    const searchFields = ['cliente__username'];

    for (const searchField of searchFields) {
      try {
        const result = (await this.wisphubWebService.getFacturas(
          this.wisphubCredentials,
          email,
          searchField,
          'Exacta',
          undefined,
          undefined,
          undefined,
          'fecha_emision',
          undefined,
          1,
          5,
        )) as any;

        const rows = Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result)
            ? result
            : [];

        const firstRow = rows[0] ?? null;
        if (!firstRow) continue;

        const rawCustomerId =
          firstRow['cliente__perfilusuario__cedula'] ??
          firstRow['cliente__cedula'] ??
          firstRow['cedula'] ??
          firstRow['documento'] ??
          null;

        const normalized = this.normalizeCustomerId(rawCustomerId);
        if (normalized) return normalized;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `No se pudo resolver customerId por email (${email}) en ${searchField}: ${msg}`,
        );
      }
    }

    return undefined;
  }
}
