/** Representa una factura en WispHub (GET /api/facturas/) */
export interface WisphubInvoice {
  /** ID de la factura */
  id: number;
  /** ID del servicio (cliente) al que pertenece */
  id_servicio?: number;
  /**
   * Estado de la factura:
   * "Pendiente" | "Pagada" | "Vencida" | "Anulada"
   */
  estado?: string;
  /** Monto total de la factura en pesos */
  total?: number;
  /** Fecha de vencimiento (YYYY-MM-DD) */
  fecha_vencimiento?: string;
  /** Fecha de emisión (YYYY-MM-DD) */
  fecha_emision?: string;
  /** Descripción / concepto de la factura */
  descripcion?: string;
  /** Número de factura legible */
  numero_factura?: string;
  /** Período de facturación */
  periodo?: string;
  [key: string]: unknown;
}
