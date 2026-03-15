import { IsOptional, IsString } from 'class-validator';

/** Parámetros para buscar clientes en el panel web de WispHub */
export class WisphubWebSearchDto {
  /** Texto a buscar */
  @IsString()
  busqueda!: string;

  /**
   * Campo en el que buscar. Opciones comunes:
   * - `user__username`  → Usuario (cédula / username del servicio)
   * - `nombre`          → Nombre del cliente
   * - `telefono`        → Teléfono
   * - `ip`              → Dirección IP
   * - `mac`             → MAC address
   * - `num_contrato`    → Número de contrato
   * - `direccion`       → Dirección
   * Por defecto: `user__username`
   */
  @IsString()
  @IsOptional()
  buscarEn?: string;

  /**
   * Tipo de búsqueda:
   * - `Contiene` (default)
   * - `Igual`
   * - `Empieza`
   * - `Termina`
   */
  @IsString()
  @IsOptional()
  tipoBusqueda?: string;

  /**
   * Estado del servicio:
   * - `1` = Activo (default)
   * - `2` = Suspendido
   * - `0` = Todos
   */
  @IsString()
  @IsOptional()
  estado?: string;

  /** ID del router para filtrar (opcional) */
  @IsString()
  @IsOptional()
  router?: string;

  /** ID del plan de internet para filtrar (opcional) */
  @IsString()
  @IsOptional()
  planInternet?: string;
}
