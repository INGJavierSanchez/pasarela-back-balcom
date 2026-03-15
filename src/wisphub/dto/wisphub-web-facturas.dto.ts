import { IsOptional, IsString } from 'class-validator';

/** Parámetros para consultar facturas en el panel web de WispHub */
export class WisphubWebFacturasDto {
  /**
   * Texto a buscar (cédula, nombre usuario, ID factura, teléfono, ID servicio).
   * Si se proporciona, usa el endpoint de búsqueda; de lo contrario, lista todas.
   */
  @IsString()
  @IsOptional()
  busqueda?: string;

  /**
   * Campo en el que buscar. Valores:
   * - `cliente__perfilusuario__cedula`     → Cédula / DNI (default)
   * - `cliente__username`                  → Nombre de usuario
   * - `id_factura`                         → ID de la factura
   * - `cliente__perfilusuario__telefono`   → Teléfono
   * - `cliente__user_cliente__id_servicio` → ID del servicio
   */
  @IsString()
  @IsOptional()
  buscarEn?: string;

  /**
   * Tipo de coincidencia:
   * - `Contiene` (default)
   * - `Exacta`
   */
  @IsString()
  @IsOptional()
  tipoBusqueda?: string;

  /** Estado: `pendiente` | `pagada` | `vencida` | `anulada` (opcional) */
  @IsString()
  @IsOptional()
  estado?: string;

  /** Fecha de inicio (YYYY-MM-DD) para filtrar por rango */
  @IsString()
  @IsOptional()
  desde?: string;

  /** Fecha de fin (YYYY-MM-DD) para filtrar por rango */
  @IsString()
  @IsOptional()
  hasta?: string;

  /** Criterio de fecha: `fecha_emision` | `fecha_pago` */
  @IsString()
  @IsOptional()
  tipoFecha?: string;

  /** ID de zona para filtrar */
  @IsString()
  @IsOptional()
  zona?: string;

  /** Número de página (desde 1) */
  @IsOptional()
  page?: number;

  /** Registros por página */
  @IsOptional()
  limit?: number;
}
