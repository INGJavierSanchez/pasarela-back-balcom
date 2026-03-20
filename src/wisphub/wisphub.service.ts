import { HttpService } from '@nestjs/axios';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { UpdateCutoffDateDto } from './dto/update-cutoff-date.dto';
import { ActivateServiceDto } from './dto/activate-service.dto';
import { WisphubCustomer } from './interfaces/wisphub-customer.interface';
import { WisphubInvoice } from './interfaces/wisphub-invoice.interface';

/** Forma de pago registrada en WispHub (GET /api/formas-de-pago/) */
export interface WisphubPaymentMethod {
  id: number;
  nombre: string;
  [key: string]: unknown;
}

@Injectable()
export class WisphubService {
  private readonly logger = new Logger(WisphubService.name);

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private get authHeaders() {
    const apiKey = this.configService.get<string>('WISPHUB_API_TOKEN');
    return {
      Authorization: `Api-Key ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Clientes
  // ─────────────────────────────────────────────────────────────────────────────

  async getCustomer(customerId: string): Promise<WisphubCustomer> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/clientes/${customerId}/`, {
          headers: this.authHeaders,
        }),
      );
      return data;
    } catch (error) {
      this.handleError('getCustomer', error as AxiosError);
    }
  }

  /**
   * Busca clientes por cédula / documento de identidad.
   * FIX: El parámetro correcto es `cedula`, no `usuario_rb`.
   * (`usuario_rb` es el usuario del router PPPoE, no el documento de identidad.)
   */
  async searchCustomersByDocument(
    document: string,
  ): Promise<WisphubCustomer[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get('/clientes/', {
          headers: this.authHeaders,
          params: { cedula: document },
        }),
      );

      return data?.results ?? data;
    } catch (error) {
      this.handleError('searchCustomersByDocument', error as AxiosError);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Facturas
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Lista las facturas de un servicio/cliente.
   * @param customerId  ID del servicio en WispHub (id_servicio)
   * @param estado      Filtro de estado: "Pendiente" | "Pagada" | "Vencida" | "Anulada"
   * @param limit       Número máximo de resultados
   * @param offset      Desplazamiento para paginación
   */
  async getCustomerInvoices(
    customerId: string,
    estado?: string,
    limit?: number,
    offset?: number,
  ): Promise<WisphubInvoice[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/facturas/`, {
          headers: this.authHeaders,
          params: {
            id_servicio: customerId,
            ...(estado ? { estado } : {}),
            ...(limit !== undefined ? { limit } : {}),
            ...(offset !== undefined ? { offset } : {}),
          },
        }),
      );
      return data?.results ?? data;
    } catch (error) {
      this.handleError('getCustomerInvoices', error as AxiosError);
    }
  }

  /**
   * Obtiene las facturas en estado "Pendiente" de un cliente.
   * Utilidad para el flujo del webhook de Wompi.
   */
  async getPendingInvoices(customerId: string): Promise<WisphubInvoice[]> {
    return this.getCustomerInvoices(customerId, 'Pendiente');
  }

  /**
   * Registra el pago de una factura específica en WispHub.
   *
   * FIX CRÍTICO: El endpoint correcto es:
   *   POST /api/facturas/{id_factura}/registrar-pago/
   *
   * El código anterior usaba '/clients/{id}/payments' que NO existe en la API de WispHub.
   *
   * @param invoiceId  ID de la factura en WispHub
   * @param dto        Datos del pago (viene del webhook de Wompi)
   */
  async registerPayment(
    invoiceId: number,
    dto: RegisterPaymentDto,
  ): Promise<unknown> {
    try {
      // Convertir centavos (Wompi) → pesos (WispHub)
      const totalCobrado = dto.amountInCents / 100;

      // Formatear fecha al formato requerido por WispHub: "YYYY-MM-DD HH:mm"
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const fechaPago =
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
        `${pad(now.getHours())}:${pad(now.getMinutes())}`;

      const payload = {
        referencia: dto.transactionId,
        fecha_pago: fechaPago,
        total_cobrado: totalCobrado,
        estado_pago: dto.estado_pago ?? 1,
        accion: dto.accion ?? 1, // Por defecto: registrar Y reactivar servicio
        forma_pago: dto.forma_pago ?? 1, // Por defecto: primer método de pago disponible
      };

      this.logger.log(
        `Registrando pago en WispHub: factura=${invoiceId}, ref=${dto.transactionId}, monto=${totalCobrado}`,
      );

      const { data } = await firstValueFrom(
        this.http.post(`/facturas/${invoiceId}/registrar-pago/`, payload, {
          headers: this.authHeaders,
        }),
      );

      return data;
    } catch (error) {
      this.handleError('registerPayment', error as AxiosError);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Configuración
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Lista las formas de pago configuradas en WispHub.
   * Útil para conocer el ID correcto a usar en `forma_pago` al registrar pagos.
   * GET /api/formas-de-pago/
   */
  async getPaymentMethods(): Promise<WisphubPaymentMethod[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get('/formas-de-pago/', { headers: this.authHeaders }),
      );
      return data?.results ?? data;
    } catch (error) {
      this.handleError('getPaymentMethods', error as AxiosError);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Servicio
  // ─────────────────────────────────────────────────────────────────────────────

  async updateCutoffDate(customerId: string, dto: UpdateCutoffDateDto) {
    try {
      const payload = { cutoff_date: dto.cutoffDate, note: dto.note };
      const { data } = await firstValueFrom(
        this.http.patch(`/clientes/${customerId}/fecha-corte/`, payload, {
          headers: this.authHeaders,
        }),
      );
      return data;
    } catch (error) {
      this.handleError('updateCutoffDate', error as AxiosError);
    }
  }

  async activateService(customerId: string, dto: ActivateServiceDto) {
    try {
      const payload = { reason: dto.reason };
      const { data } = await firstValueFrom(
        this.http.post(`/clientes/${customerId}/activar-servicio/`, payload, {
          headers: this.authHeaders,
        }),
      );
      return data;
    } catch (error) {
      this.handleError('activateService', error as AxiosError);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private handleError(operation: string, error: AxiosError): never {
    const status = error.response?.status ?? 500;
    const payload = error.response?.data ?? { message: error.message };
    this.logger.error(
      `${operation} failed: status=${status} message=${error.message}`,
      error.stack,
    );
    this.logger.error(
      `${operation} response payload: ${JSON.stringify(payload)}`,
    );
    throw new HttpException(payload, status);
  }
}
