import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { createHmac, createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';

interface CreateWompiPaymentLinkInput {
  name: string;
  description: string;
  amountInCents: number;
  currency: string;
  redirectUrl?: string;
  singleUse?: boolean;
  customerEmail?: string;
  customerData?: {
    fullName?: string;
    phoneNumber?: string;
    phoneNumberPrefix?: string;
    legalId?: string;
    legalIdType?: string;
  };
  metadata?: Record<string, unknown>;
}

interface WompiPaymentLinkResponse {
  id: string;
  url: string;
  status: string;
  expires_at?: string;
  [key: string]: unknown;
}

@Injectable()
export class WompiService {
  private readonly logger = new Logger(WompiService.name);

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
  ) { }

  private getAuthHeaders(configKey?: 'DEFAULT' | 'MAG') {
    const keySuffix = configKey === 'MAG' ? '_MAG' : '';
    const privateKey = this.configService.get<string>(`WOMPI_PRIVATE_KEY${keySuffix}`);
    return {
      Authorization: `Bearer ${privateKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createPaymentLink(
    input: CreateWompiPaymentLinkInput,
    configKey: 'DEFAULT' | 'MAG' = 'DEFAULT',
  ): Promise<WompiPaymentLinkResponse> {
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          '/payment_links',
          {
            name: input.name,
            description: input.description,
            amount_in_cents: input.amountInCents,
            currency: input.currency,
            single_use: input.singleUse ?? true,
            collect_shipping: false,
            redirect_url: input.redirectUrl,
            customer_email: input.customerEmail,
            customer_data: input.customerData
              ? {
                full_name: input.customerData.fullName,
                phone_number: input.customerData.phoneNumber,
                phone_number_prefix: input.customerData.phoneNumberPrefix ?? '+57',
                legal_id: input.customerData.legalId,
                legal_id_type: input.customerData.legalIdType,
              }
              : undefined,
            metadata: input.metadata,
          },
          { headers: this.getAuthHeaders(configKey) },
        ),
      );

      return data.data;
    } catch (error) {
      this.handleError('createPaymentLink', error as AxiosError);
    }
  }

  async getPaymentLink(id: string, configKey: 'DEFAULT' | 'MAG' = 'DEFAULT'): Promise<any> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/payment_links/${id}`, {
          headers: this.getAuthHeaders(configKey),
        }),
      );
      return data.data;
    } catch (error) {
      this.logger.warn(`Failed to fetch payment link ${id}: ${error.message}`);
      return null;
    }
  }

  assertSignature(
    signatureHeader: string | undefined,
    payload: any,
    rawBody?: string,
    configKey: 'DEFAULT' | 'MAG' = 'DEFAULT',
  ) {
    const keySuffix = configKey === 'MAG' ? '_MAG' : '';
    const secret = this.configService.get<string>(`WOMPI_EVENTS_SECRET${keySuffix}`);

    if (!secret) {
      throw new UnauthorizedException('Missing events secret in config');
    }

    // ─── Validación Nueva: Checksum en Payload (SHA256) ─────────────────────
    if (
      payload?.signature &&
      payload.signature.checksum &&
      Array.isArray(payload.signature.properties)
    ) {
      this.logger.debug('Validando firma Wompi con el nuevo método Checksum (SHA256)');
      let concatenatedValues = '';

      for (const propPath of payload.signature.properties) {
        // propPath ej: "transaction.id"
        const parts = propPath.split('.');
        let val: any = payload.data;
        for (const part of parts) {
          if (val === undefined || val === null) break;
          val = val[part];
        }
        concatenatedValues += (val ?? '');
      }

      const timestamp = payload.timestamp?.toString() || '';
      const stringToHash = concatenatedValues + timestamp + secret;
      const computed = createHash('sha256').update(stringToHash).digest('hex');

      if (computed !== payload.signature.checksum) {
        this.logger.error(`Checksum inválido. Recibido: ${payload.signature.checksum}, Calculado: ${computed}`);
        throw new UnauthorizedException('Invalid Wompi payload checksum');
      }

      return; // Validación exitosa
    }

    // ─── Validación Legacy: cabecera x-event-signature (HMAC SHA256) ────────
    if (!signatureHeader) {
      this.logger.error('No se recibió cabecera x-event-signature ni nuevo checksum de seguridad');
      throw new UnauthorizedException('Missing Wompi signature (Header and Payload)');
    }

    this.logger.debug('Validando firma Wompi con método Legacy (HMAC Header)');
    const parsed = this.parseSignatureHeader(signatureHeader);
    const payloadString = rawBody ?? JSON.stringify(payload);
    const computedLegacy = this.computeHmac(
      `${parsed.timestamp}.${payloadString}`,
      secret,
    );

    if (computedLegacy !== parsed.signature) {
      this.logger.error(`Firma Legacy inválida`);
      throw new UnauthorizedException('Invalid Wompi legacy signature');
    }
  }

  private computeHmac(content: string, secret?: string) {
    if (!secret) {
      throw new UnauthorizedException('Missing events secret');
    }
    return createHmac('sha256', secret).update(content).digest('hex');
  }

  private parseSignatureHeader(signatureHeader: string) {
    // Expected format: t=timestamp,v1=signature
    const parts = signatureHeader
      .split(',')
      .reduce<Record<string, string>>((acc, part) => {
        const [key, value] = part.split('=');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
      }, {});

    const timestamp = parts['t'];
    const signature = parts['v1'];

    if (!timestamp || !signature) {
      throw new UnauthorizedException('Malformed Wompi signature header');
    }

    return { timestamp, signature };
  }

  private handleError(operation: string, error: AxiosError): never {
    const errorData = error.response?.data as any;
    const message =
      errorData?.error?.reason || errorData?.error?.type || error.message;

    this.logger.error(`${operation} failed: ${message}`, error.stack);

    if (errorData) {
      this.logger.error(`Wompi Error Details: ${JSON.stringify(errorData)}`);
    }

    throw error;
  }
}
