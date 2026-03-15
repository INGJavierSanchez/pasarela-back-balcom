import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Payload para POST /api/facturas/{id_factura}/registrar-pago/
 * Campos exactos que espera la API de WispHub.
 */
export class WisphubRegisterPaymentDto {
  /** Referencia del pago (ej. ID de transacción Wompi) */
  @IsString()
  referencia!: string;

  /**
   * Fecha y hora del pago en formato "YYYY-MM-DD HH:mm"
   * Si no se provee, se usa la fecha/hora actual.
   */
  @IsString()
  @IsOptional()
  fecha_pago?: string;

  /** Monto total cobrado en pesos (no centavos) */
  @IsNumber()
  @Min(0)
  total_cobrado!: number;

  /**
   * Acción a tomar al registrar el pago:
   * - 0 = solo registrar el pago
   * - 1 = registrar el pago y reactivar el servicio si estaba suspendido
   */
  @IsInt()
  @IsOptional()
  accion?: 0 | 1;

  /**
   * ID de la forma de pago configurada en WispHub.
   * Obtener con GET /api/formas-de-pago/.
   * Si no se especifica, se usa 1 (primer método disponible).
   */
  @IsInt()
  @IsOptional()
  forma_pago?: number;
}
