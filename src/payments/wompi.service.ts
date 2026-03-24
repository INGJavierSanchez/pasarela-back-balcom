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
    const privateKey =
      this.configService
        .get<string>(`WOMPI_PRIVATE_KEY${keySuffix}`)
        ?.trim() ?? '';
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
  ): 'DEFAULT' | 'MAG' {
    const secretCandidates = this.getSecretCandidates(configKey);

    if (secretCandidates.length === 0) {
      throw new UnauthorizedException('Missing events secret in config');
    }

    // ─── Validación Nueva: Checksum en Payload (SHA256) ─────────────────────
    if (
      payload?.signature &&
      payload.signature.checksum &&
      Array.isArray(payload.signature.properties)
    ) {
      this.logger.debug('Validando firma Wompi con el nuevo método Checksum (SHA256)');
      this.logger.debug(
        `Checksum metadata: configEsperada=${configKey}, propiedades=${JSON.stringify(
          payload.signature.properties,
        )}, timestamp=${payload.timestamp ?? ''}`,
      );

      for (const candidate of secretCandidates) {
        const computedFromData = this.computeChecksum(payload, candidate.secret, 'data');
        if (computedFromData === payload.signature.checksum) {
          if (candidate.key !== configKey) {
            this.logger.warn(
              `Firma validada con secreto alterno (${candidate.key}/${candidate.kind}) en lugar de ${configKey}.`,
            );
          }
          return candidate.key;
        }

        const computedFromRoot = this.computeChecksum(payload, candidate.secret, 'root');
        if (computedFromRoot === payload.signature.checksum) {
          if (candidate.key !== configKey) {
            this.logger.warn(
              `Firma validada con secreto alterno (${candidate.key}/${candidate.kind}) en lugar de ${configKey}.`,
            );
          }
          this.logger.warn(
            'Checksum validado leyendo propiedades desde payload raiz (compatibilidad).',
          );
          return candidate.key;
        }
      }

      this.logger.error(
        `Checksum inválido. tx=${payload?.data?.transaction?.id ?? 'N/A'}, paymentLink=${payload?.data?.transaction?.payment_link_id ?? 'N/A'}, legalId=${payload?.data?.transaction?.customer_data?.legal_id ?? payload?.data?.transaction?.customer_data?.legalId ?? 'N/A'}, checksumRecibido=${payload.signature.checksum}, configEsperada=${configKey}`,
      );
      throw new UnauthorizedException('Invalid Wompi payload checksum');

      // Validación exitosa retorna arriba
    }

    // ─── Validación Legacy: cabecera x-event-signature (HMAC SHA256) ────────
    if (!signatureHeader) {
      this.logger.error('No se recibió cabecera x-event-signature ni nuevo checksum de seguridad');
      throw new UnauthorizedException('Missing Wompi signature (Header and Payload)');
    }

    this.logger.debug('Validando firma Wompi con método Legacy (HMAC Header)');
    const parsed = this.parseSignatureHeader(signatureHeader);
    const payloadString = rawBody ?? JSON.stringify(payload);

    for (const candidate of secretCandidates) {
      const computedLegacy = this.computeHmac(
        `${parsed.timestamp}.${payloadString}`,
        candidate.secret,
      );

      if (computedLegacy === parsed.signature) {
        if (candidate.key !== configKey) {
          this.logger.warn(
            `Firma Legacy validada con secreto alterno (${candidate.key}/${candidate.kind}) en lugar de ${configKey}.`,
          );
        }
        return candidate.key;
      }
    }

    this.logger.error(
      `Firma Legacy inválida. tx=${payload?.data?.transaction?.id ?? 'N/A'}, paymentLink=${payload?.data?.transaction?.payment_link_id ?? 'N/A'}, configEsperada=${configKey}`,
    );
    throw new UnauthorizedException('Invalid Wompi legacy signature');
  }

  private computeChecksum(
    payload: any,
    secret: string,
    mode: 'data' | 'root',
  ): string {
    let concatenatedValues = '';

    for (const propPath of payload.signature.properties as string[]) {
      const parts = propPath.split('.');
      let val: any = mode === 'data' ? payload?.data : payload;
      for (const part of parts) {
        if (val === undefined || val === null) break;
        val = val[part];
      }
      concatenatedValues += (val ?? '');
    }

    const timestamp = payload.timestamp?.toString() || '';
    const stringToHash = concatenatedValues + timestamp + secret;
    return createHash('sha256').update(stringToHash).digest('hex');
  }

  private getSecretCandidates(
    preferred: 'DEFAULT' | 'MAG',
  ): Array<{ key: 'DEFAULT' | 'MAG'; kind: 'events' | 'integrity'; secret: string }> {
    const preferredSuffix = preferred === 'MAG' ? '_MAG' : '';
    const preferredEvents = this.configService
      .get<string>(`WOMPI_EVENTS_SECRET${preferredSuffix}`)
      ?.trim();
    const preferredIntegrity = this.configService
      .get<string>(`WOMPI_INTEGRITY_SECRET${preferredSuffix}`)
      ?.trim();

    const fallbackKey: 'DEFAULT' | 'MAG' = preferred === 'MAG' ? 'DEFAULT' : 'MAG';
    const fallbackSuffix = fallbackKey === 'MAG' ? '_MAG' : '';
    const fallbackEvents = this.configService
      .get<string>(`WOMPI_EVENTS_SECRET${fallbackSuffix}`)
      ?.trim();
    const fallbackIntegrity = this.configService
      .get<string>(`WOMPI_INTEGRITY_SECRET${fallbackSuffix}`)
      ?.trim();

    const candidates: Array<{ key: 'DEFAULT' | 'MAG'; kind: 'events' | 'integrity'; secret: string }> = [];
    if (preferredEvents) candidates.push({ key: preferred, kind: 'events', secret: preferredEvents });
    if (preferredIntegrity) candidates.push({ key: preferred, kind: 'integrity', secret: preferredIntegrity });
    if (fallbackEvents) candidates.push({ key: fallbackKey, kind: 'events', secret: fallbackEvents });
    if (fallbackIntegrity) candidates.push({ key: fallbackKey, kind: 'integrity', secret: fallbackIntegrity });

    this.logger.debug(
      `Secrets candidatos para ${preferred}: ${candidates
        .map((c) => `${c.key}/${c.kind}`)
        .join(', ') || 'ninguno'}`,
    );

    return candidates;
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
