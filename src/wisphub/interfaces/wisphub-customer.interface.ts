/** Representa un servicio/cliente en WispHub (GET /api/clientes/{id_servicio}/) */
export interface WisphubCustomer {
  /** ID del servicio en WispHub */
  id: number;
  /** Nombre completo del cliente */
  nombre?: string;
  /** Nombre (alias para compatibilidad) */
  name?: string;
  /** Correo electrónico */
  email?: string;
  /** Cédula / documento de identidad */
  cedula?: string;
  /** Teléfono de contacto */
  telefono?: string;
  /** Dirección de instalación */
  direccion?: string;
  /**
   * Estado del servicio:
   * 0 = En instalación, 1 = Activo, 2 = Suspendido,
   * 3 = Retirado, 4 = Inactivo
   */
  estado?: number;
  /** Nombre del plan de internet asignado */
  plan_internet?: string | { id: number; nombre: string };
  /** IP asignada */
  ip?: string;
  /** MAC del equipo */
  mac?: string;
  /** Saldo actual del cliente */
  saldo?: number;
  /** Número de contrato */
  num_contrato?: string;
  /** Usuario del router (PPPoE / usuario_rb) */
  usuario_rb?: string;
  /** Zona asignada */
  zona?: string;
  /** Sector asignado */
  sector?: string;
  [key: string]: unknown;
}
