import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

/**
 * DTO del webhook de Wompi → WispHub.
 * Contiene los datos de la transacción aprobada por Wompi
 * y la información necesaria para registrar el pago en WispHub.
 */
export class RegisterPaymentDto {
  /** ID de la factura en WispHub donde se registrará el pago */
  @IsInt()
  @Min(1)
  invoiceId!: number;

  /** Monto de la transacción en centavos (como llega de Wompi) */
  @IsInt()
  @Min(1)
  amountInCents!: number;

  /** ID de la transacción en Wompi — se usa como referencia en WispHub */
  @IsString()
  transactionId!: string;

  /** Moneda de la transacción (por defecto: 'COP') */
  @IsString()
  @IsOptional()
  currency: string = 'COP';

  /** Estado de la transacción en Wompi */
  @IsString()
  status!: string;

  /** Descripción opcional del pago */
  @IsString()
  @IsOptional()
  description?: string;

  /**
   * Acción en WispHub al registrar el pago:
   * - 0 = solo registrar (default)
   * - 1 = registrar y reactivar servicio si estaba suspendido
   */
  @IsOptional()
  accion?: 0 | 1;

  /**
   * ID de la forma de pago en WispHub (ver GET /api/formas-de-pago/).
   * Si no se especifica, se usa 1 por defecto.
   */
  @IsInt()
  @IsOptional()
  forma_pago?: number;

  /** Metadatos adicionales de la transacción de Wompi */
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
