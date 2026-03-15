import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import { WisphubLoginDto } from './dto/wisphub-login.dto';
import { WisphubWebSearchDto } from './dto/wisphub-web-search.dto';
import { WisphubService } from './wisphub.service';

/** Sesión activa de WispHub (cookies de navegador) */
interface WisphubSession {
  sessionCookies: string;
  csrfToken: string;
  /** Slug de la empresa (ej: "balcom") */
  companySlug: string;
  /** Timestamp de cuando se creó la sesión */
  createdAt: number;
}

/** Factura normalizada lista para el frontend */
export interface NormalizedInvoice {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  currency: string;
  issueDate: string; // ISO 8601
  dueDate: string; // ISO 8601
  paidDate?: string; // ISO 8601, solo si pagada
  status: 'pending' | 'paid';
  reference?: string;
  rawEstado: string; // Estado original de WispHub
}

/** Convierte DD/MM/YYYY (formato WispHub) a YYYY-MM-DD (ISO) */
function parseWisphubDate(raw: string): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  // Eliminar la parte de la hora si viene como "DD/MM/YYYY HH:MM"
  raw = raw.trim().split(' ')[0];

  // Si ya viene en formato ISO no tocarlo
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const parts = raw.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return raw;
}

/** Mapea el estado de WispHub al enum del frontend */
function normalizeEstado(estado: string): 'pending' | 'paid' {
  const lower = estado.toLowerCase();
  if (lower.includes('pagada') || lower.includes('pagado')) return 'paid';
  return 'pending';
}

/**
 * Servicio que accede a los endpoints JSON internos del panel web de WispHub.
 *
 * Endpoints utilizados:
 *  - Lista clientes:  GET /clientes/json/{slug}/
 *  - Buscar clientes: GET /clientes/buscar/json/
 *
 * Autenticación: cookies de sesión Django (sessionid + csrftoken).
 * La sesión se cachea en memoria por 25 minutos.
 */
@Injectable()
export class WisphubWebService {
  private readonly logger = new Logger(WisphubWebService.name);
  private readonly baseUrl = 'https://wisphub.io';

  /** TTL de la sesión: 25 minutos */
  private readonly SESSION_TTL_MS = 25 * 60 * 1000;

  /** Caché de sesión activa */
  private activeSession: WisphubSession | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
    private readonly wisphubService: WisphubService,
  ) { }

  // ─────────────────────────────────────────────────────────────────────────────
  // Autenticación / sesión
  // ─────────────────────────────────────────────────────────────────────────────

  async login(
    dto: WisphubLoginDto,
  ): Promise<{ message: string; companySlug: string }> {
    const session = await this.ensureSession(dto);
    return {
      message: 'Sesión iniciada exitosamente en WispHub',
      companySlug: session.companySlug,
    };
  }

  logout() {
    this.activeSession = null;
    return { message: 'Sesión cerrada' };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Endpoints internos del panel web
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Lista todos los clientes.
   * GET https://wisphub.io/clientes/json/{slug}/
   * @param page   Página a obtener (desde 1). Default: 1
   * @param limit  Registros por página. Default: 50
   */
  async listClientes(
    credentials: WisphubLoginDto,
    page = 1,
    limit = 50,
  ): Promise<unknown> {
    const session = await this.ensureSession(credentials);
    const url = `${this.baseUrl}/clientes/json/${session.companySlug}/`;
    const start = (page - 1) * limit; // offset basado en la convención DataTables

    this.logger.log(
      `Listando clientes: ${url} (page=${page}, limit=${limit}, start=${start})`,
    );

    try {
      const { data } = await firstValueFrom(
        this.http.get(url, {
          headers: this.buildHeaders(session),
          params: {
            start, // offset de registros (DataTables)
            length: limit, // cantidad de registros por página
            _: Date.now(),
          },
        }),
      );
      return data;
    } catch (err) {
      this.handleSessionError(err);
    }
  }

  /**
   * Busca clientes con el buscador avanzado.
   * GET https://wisphub.io/clientes/buscar/json/
   */
  async searchClientes(
    credentials: WisphubLoginDto,
    dto: WisphubWebSearchDto,
  ): Promise<unknown> {
    const session = await this.ensureSession(credentials);
    const url = `${this.baseUrl}/clientes/buscar/json/`;

    this.logger.log(
      `Buscando clientes: busqueda="${dto.busqueda}" en="${dto.buscarEn ?? 'user__username'}"`,
    );

    const params: Record<string, string> = {
      tipo_busqueda: dto.tipoBusqueda ?? 'Contiene',
      busqueda: dto.busqueda,
      buscar_en: dto.buscarEn ?? 'user__username',
      estado: dto.estado ?? '1',
      'busqueda-por-filtros': 'True',
      _: String(Date.now()),
    };

    if (dto.router) params.router = dto.router;
    if (dto.planInternet) params.plan_internet = dto.planInternet;

    try {
      const { data } = await firstValueFrom(
        this.http.get(url, {
          headers: this.buildHeaders(session),
          params,
        }),
      );
      return data;
    } catch (err) {
      this.handleSessionError(err);
    }
  }

  /**
   * Endpoint compuesto: busca al cliente por cédula y trae sus facturas del año actual,
   * separadas en pendientes y pagadas — listo para consumir desde el frontend.
   */
  async getClienteFacturas(
    credentials: WisphubLoginDto,
    cedula: string,
  ): Promise<{
    customerId: string;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    plan: string;
    pending: NormalizedInvoice[];
    paid: NormalizedInvoice[];
  }> {
    // 1. Obtener facturas del año actual (siempre se necesitan)
    const ahora = new Date();
    const desde = `${ahora.getFullYear()}-01-01`;
    const hasta = ahora.toISOString().slice(0, 10);

    const facturasRaw = (await this.getFacturas(
      credentials,
      cedula,
      'cliente__perfilusuario__cedula',
      'Exacta',
      undefined,
      desde,
      hasta,
      'fecha_emision',
      undefined,
      1,
      200,
    )) as any;

    const facturasList: any[] = facturasRaw?.data ?? facturasRaw ?? [];
    const facturas = Array.isArray(facturasList) ? facturasList : [];

    // 2. Extraer nombre del cliente desde la primera factura
    //    WispHub puede enviar distintos campos según la versión del panel.
    //    Logueamos las keys para depuración.
    const primeraFactura: any = facturas[0] ?? {};
    this.logger.debug(
      `Factura[0] keys: [${Object.keys(primeraFactura).join(', ')}]`,
    );

    let customerName: string =
      primeraFactura.cliente ??
      primeraFactura.nombre_cliente ??
      primeraFactura.nombre ??
      primeraFactura.cliente__perfilusuario__nombre ??
      primeraFactura['cliente__perfilusuario__nombre'] ??
      primeraFactura.cliente_nombre ??
      '';

    const plan: string =
      primeraFactura['plan_internet'] ?? primeraFactura.plan ?? '';

    // 3. Si la factura no trae el nombre, usamos la API REST oficial (más confiable)
    if (!customerName) {
      try {
        const clientes =
          await this.wisphubService.searchCustomersByDocument(cedula);
        this.logger.debug(
          `API REST clientes: ${JSON.stringify(clientes).slice(0, 300)}`,
        );
        const c = Array.isArray(clientes) ? clientes[0] : null;
        customerName = c?.nombre ?? c?.name ?? '';
      } catch {
        // Falla silenciosamente
      }
    }

    // 4. Fallback final
    if (!customerName) customerName = `Cliente ${cedula}`;

    // 5. Extraer email y teléfono del cliente desde la factura
    const customerEmail: string | undefined =
      primeraFactura['cliente__email'] ||
      primeraFactura['email'] ||
      undefined;

    const customerPhone: string | undefined =
      primeraFactura['cliente__perfilusuario__telefono'] ||
      primeraFactura['telefono'] ||
      undefined;

    const pending: NormalizedInvoice[] = [];
    const paid: NormalizedInvoice[] = [];

    for (const f of facturas) {
      const normalized: NormalizedInvoice = {
        id: String(f.id_factura ?? f.id ?? ''),
        customerId: cedula,
        customerName,
        amount: parseFloat(f.total ?? f.sub_total ?? '0'),
        currency: 'COP',
        issueDate: parseWisphubDate(f.fecha_emision ?? ''),
        dueDate: parseWisphubDate(f.fecha_emision ?? ''),
        paidDate: f.fecha_pago ? parseWisphubDate(f.fecha_pago) : undefined,
        status: normalizeEstado(f.estado ?? ''),
        reference: f.num_contrato ?? undefined,
        rawEstado: f.estado ?? '',
      };

      if (normalized.status === 'pending') {
        pending.push(normalized);
      } else if (normalized.status === 'paid') {
        paid.push(normalized);
      }
    }

    // Ordenar pagadas por fecha de emisión descendente
    paid.sort((a, b) => b.issueDate.localeCompare(a.issueDate));

    return { customerId: cedula, customerName, customerEmail, customerPhone, plan, pending, paid };
  }

  /**
   * Consulta facturas del panel web de WispHub.
   *
   * Si se proporciona `busqueda`, usa el endpoint de búsqueda específica:
   *   GET /facturas/json/{slug}/busqueda/
   *
   * Si no, lista todas con filtros de fecha/estado:
   *   GET /facturas/json/{slug}/
   *
   * @param credentials  Credenciales WispHub (login + password)
   * @param busqueda     Texto a buscar (cédula, ID factura, username, etc.)
   * @param buscarEn     Campo en el que buscar (default: cedula)
   * @param tipoBusqueda Tipo de coincidencia (default: Contiene)
   * @param estado       Estado de la factura (pendiente, pagada, vencida, anulada)
   * @param desde        Fecha inicio YYYY-MM-DD
   * @param hasta        Fecha fin YYYY-MM-DD
   * @param tipoFecha    Criterio de fecha (fecha_emision | fecha_pago)
   * @param zona         ID de zona para filtrar
   * @param page         Número de página (desde 1)
   * @param limit        Registros por página (default: 50)
   */
  async getFacturas(
    credentials: WisphubLoginDto,
    busqueda?: string,
    buscarEn?: string,
    tipoBusqueda?: string,
    estado?: string,
    desde?: string,
    hasta?: string,
    tipoFecha?: string,
    zona?: string,
    page = 1,
    limit = 50,
  ): Promise<unknown> {
    const session = await this.ensureSession(credentials);
    const start = (page - 1) * limit;

    // ── Modo búsqueda (por cédula, ID factura, usuario, etc.) ────────────
    if (busqueda) {
      const url = `${this.baseUrl}/facturas/json/${session.companySlug}/busqueda/`;

      // Rango de fechas por defecto: 2 meses atrás → 1 mes adelante
      // (replicar el comportamiento del panel que siempre envía rango)
      const ahora = new Date();
      const defaultHasta =
        hasta ??
        new Date(ahora.getFullYear(), ahora.getMonth() + 1, ahora.getDate())
          .toISOString()
          .slice(0, 10);
      const defaultDesde =
        desde ??
        new Date(ahora.getFullYear(), ahora.getMonth() - 2, 1)
          .toISOString()
          .slice(0, 10);

      this.logger.log(
        `Buscando facturas: "${busqueda}" en "${buscarEn ?? 'cliente__perfilusuario__cedula'}" ` +
        `[${defaultDesde} → ${defaultHasta}]`,
      );

      // Parámetros que replica EXACTAMENTE la URL interna de WispHub:
      // /facturas/json/balcom/busqueda/?desde=...&hasta=...&tipo_fecha=fecha_emision
      //   &estado=&forma_pago=&cajero=&zona=&estado_fiscal=&articulos=
      //   &servicio_adicional=&pagos_fecha=&id_tipo_factura=1
      //   &tipo_busqueda=Exacta&busqueda=XXX&buscar_en[]=campo
      //   &buscar=true&buscar_todos_tiempos=false&plan_internet=
      const params: Record<string, string> = {
        desde: defaultDesde,
        hasta: defaultHasta,
        tipo_fecha: tipoFecha ?? 'fecha_emision',
        estado: estado ?? '',
        forma_pago: '',
        cajero: '',
        zona: zona ?? '',
        estado_fiscal: '',
        articulos: '',
        servicio_adicional: '',
        pagos_fecha: '',
        id_tipo_factura: '1',
        tipo_busqueda: tipoBusqueda ?? 'Exacta', // Exacta es más rápido que Contiene
        busqueda,
        'buscar_en[]': buscarEn ?? 'cliente__perfilusuario__cedula',
        buscar: 'true',
        buscar_todos_tiempos: 'false', // false = usar el rango desde/hasta
        plan_internet: '',
        _: String(Date.now()),
      };

      try {
        const { data } = await firstValueFrom(
          this.http.get(url, {
            headers: {
              ...this.buildHeaders(session),
              Referer: `${this.baseUrl}/facturas/buscar/`,
            },
            params,
            timeout: 60000,
          }),
        );
        return data;
      } catch (err) {
        this.handleSessionError(err);
      }
    }

    // ── Modo listado general (con filtros de fecha/estado) ───────────────
    const url = `${this.baseUrl}/facturas/json/${session.companySlug}/`;

    this.logger.log(`Listando facturas: ${url} (page=${page}, limit=${limit})`);

    const params: Record<string, string> = {
      start: String(start),
      length: String(limit),
      _: String(Date.now()),
    };

    if (estado) params.estado = estado;
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    if (tipoFecha) params.tipo_fecha = tipoFecha;
    if (zona) params.zona = zona;

    try {
      const { data } = await firstValueFrom(
        this.http.get(url, {
          headers: {
            ...this.buildHeaders(session),
            Referer: `${this.baseUrl}/facturas/`,
          },
          params,
          timeout: 60000, // facturas puede tardar en WispHub
        }),
      );
      return data;
    } catch (err) {
      this.handleSessionError(err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Registro de Pagos (Scraping)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Registra un pago simulando el envío del formulario web del dashboard de WispHub.
   * POST https://wisphub.io/facturas/{id}/registrar-pago/
   */
  async registerPayment(
    credentials: WisphubLoginDto,
    invoiceId: string | number,
    amount: number,
    reference: string,
    action: number = 1 // 1 = Registrar y reactivar servicio
  ): Promise<string> {
    const session = await this.ensureSession(credentials);
    const url = `${this.baseUrl}/facturas/${invoiceId}/registrar-pago/`;

    // Convertir centavos (Wompi) → pesos (WispHub)
    const totalCobrado = amount / 100;

    // Formatear fecha "DD/MM/YYYY HH:mm" (formato que espera el form web de WispHub)
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fechaPago =
      `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    this.logger.log(
      `Registrando pago via Web (Scraping) en WispHub: factura=${invoiceId}, ref=${reference}, monto=${totalCobrado}`
    );

    // Los campos requeridos por el form web de django de WispHub
    const formData = new URLSearchParams({
      csrfmiddlewaretoken: session.csrfToken,
      referencia: reference,
      fecha_pago: fechaPago,
      total_cobrado: String(totalCobrado),
      forma_pago: '1', // 1 suele ser Efectivo o Transferencia base; ajustable si se tiene el ID específico de Wompi
      accion: String(action),
      // Campos opcionales vacíos que suele enviar el UI:
      comentario: 'Pago generado vía Wompi Automático',
      cajero: '',
    });

    try {
      const resp = await firstValueFrom(
        this.http.post(url, formData.toString(), {
          headers: {
            Cookie: session.sessionCookies,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: url, // Importante para pasar validación CSRF estricta
          },
          // No redirigir para poder ver si fue un éxito (usualmente 302 a listado)
          maxRedirects: 0,
          validateStatus: (s) => s < 500,
        })
      );

      this.logger.debug(`Respuesta registro pago web: status=${resp.status}`);

      // WispHub web retorna 302 Found redirigiendo a la lista de facturas cuando el POST es exitoso
      if (resp.status === 302 || resp.status === 200) {
        return `Pago registrado exitosamente en WispHub (Factura ${invoiceId}).`;
      } else {
        this.logger.warn(`El registro de pago devolvió status ${resp.status}`);
      }
      return 'Respuesta no confirmada al registrar pago web.';
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error guardando pago por web: ${msg}`);
      throw new Error(`Error registrando el pago en WispHub web: ${msg}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers internos
  // ─────────────────────────────────────────────────────────────────────────────

  private buildHeaders(session: WisphubSession): Record<string, string> {
    return {
      Cookie: session.sessionCookies,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': session.csrfToken,
      Referer: `${this.baseUrl}/clientes/`,
    };
  }

  /**
   * Maneja errores de peticiones al panel web.
   * Solo invalida la sesión si el error es de autenticación (401/403).
   * Errores de timeout o red NO invalidan la sesión.
   */
  private handleSessionError(err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err);
    const isAxiosError = err && typeof err === 'object' && 'response' in err;
    const status: number = isAxiosError
      ? ((err as any).response?.status ?? 0)
      : 0;
    const isAuthError = status === 401 || status === 403;

    if (isAuthError) {
      this.activeSession = null; // Solo invalidar en error de autenticación real
      this.logger.warn(
        `Sesión inválida (${status}) — se reautenticará en la próxima petición.`,
      );
    } else {
      this.logger.error(`Error en petición web de WispHub: ${msg}`);
    }

    throw new UnauthorizedException(
      isAuthError
        ? `Sesión expirada en WispHub (${status}). La próxima petición re-autenticará.`
        : `Error accediendo a WispHub: ${msg}`,
    );
  }

  private async ensureSession(
    credentials: WisphubLoginDto,
  ): Promise<WisphubSession> {
    const now = Date.now();

    if (
      this.activeSession &&
      now - this.activeSession.createdAt < this.SESSION_TTL_MS
    ) {
      this.logger.debug('Reutilizando sesión activa de WispHub');
      return this.activeSession;
    }

    this.logger.log(
      `Iniciando nueva sesión en WispHub para: ${credentials.login}`,
    );
    const session = await this.doLogin(credentials);
    this.activeSession = session;
    return session;
  }

  /**
   * Ejecuta el flujo completo de login web en WispHub.
   *
   * FLUJO:
   * 1. GET /accounts/login/  → extraer csrfmiddlewaretoken del HTML + cookie csrftoken
   * 2. POST /accounts/login/ → enviar form-data → WispHub responde 302 con Set-Cookie: sessionid
   *    ⚠️ maxRedirects DEBE ser 0: el sessionid está en el header Set-Cookie del 302.
   *    Si axios sigue el redirect, la respuesta final (200) ya NO tiene ese header.
   */
  private async doLogin(dto: WisphubLoginDto): Promise<WisphubSession> {
    const loginUrl = `${this.baseUrl}/accounts/login/`;

    // ── 1. GET de la página de login → csrftoken ──────────────────────────────
    let csrfToken: string;
    const initialCookieMap = new Map<string, string>();

    try {
      const pageResp = await firstValueFrom(
        this.http.get(loginUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
          maxRedirects: 5,
        }),
      );

      // Extraer csrftoken del formulario HTML
      const $ = cheerio.load(pageResp.data as string);
      const formCsrf =
        ($('input[name="csrfmiddlewaretoken"]').val() as string) ?? '';

      // Parsear las cookies del GET de la página de login
      const getCookies = pageResp.headers['set-cookie'] as
        | string[]
        | string
        | undefined;
      const getCookieArr = Array.isArray(getCookies)
        ? getCookies
        : getCookies
          ? [getCookies]
          : [];

      for (const raw of getCookieArr) {
        const kv = raw.split(';')[0];
        const eqIdx = kv.indexOf('=');
        if (eqIdx > 0) {
          initialCookieMap.set(
            kv.substring(0, eqIdx).trim(),
            kv.substring(eqIdx + 1).trim(),
          );
        }
      }

      // csrftoken: preferir del form HTML, fallback al cookie
      csrfToken = formCsrf || initialCookieMap.get('csrftoken') || '';

      if (!csrfToken) {
        throw new UnauthorizedException(
          'No se pudo obtener el csrftoken de WispHub',
        );
      }

      this.logger.debug(`csrftoken obtenido: ${csrfToken.substring(0, 10)}...`);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new UnauthorizedException(`Error conectando a WispHub: ${msg}`);
    }

    // ── 2. POST de login → capturar sessionid del 302 ─────────────────────────
    const initialCookieStr = Array.from(initialCookieMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const companySlug = this.configService.get<string>(
      'WISPHUB_COMPANY_SLUG',
      'balcom',
    );
    let sessionCookies: string;

    try {
      const loginResp = await firstValueFrom(
        this.http.post(
          loginUrl,
          new URLSearchParams({
            csrfmiddlewaretoken: csrfToken,
            login: dto.login,
            password: dto.password,
            remember: '1',
            token_device: '',
            name_device: '',
            type_device: '',
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Referer: loginUrl,
              Cookie: initialCookieStr,
            },
            // ⚠️ CRÍTICO: maxRedirects=0 para capturar el Set-Cookie del 302
            // Con maxRedirects>0, axios sigue la redirección y pierde el sessionid
            maxRedirects: 0,
            validateStatus: (s) => s < 500,
          },
        ),
      );

      this.logger.debug(`POST /accounts/login/ → status: ${loginResp.status}`);

      // Parsear cookies del POST — aquí viene el sessionid
      const postCookies = loginResp.headers['set-cookie'] as
        | string[]
        | string
        | undefined;
      const postCookieArr = Array.isArray(postCookies)
        ? postCookies
        : postCookies
          ? [postCookies]
          : [];

      // Merge: iniciales (GET) sobrescritas por las del POST (sessionid, csrftoken nuevo)
      const cookieMap = new Map(initialCookieMap);
      for (const raw of postCookieArr) {
        const kv = raw.split(';')[0];
        const eqIdx = kv.indexOf('=');
        if (eqIdx > 0) {
          const k = kv.substring(0, eqIdx).trim();
          const v = kv.substring(eqIdx + 1).trim();
          cookieMap.set(k, v);
          if (k === 'csrftoken') csrfToken = v; // Actualizar csrftoken si fue renovado
        }
      }

      this.logger.debug(
        `Cookies capturadas: [${[...cookieMap.keys()].join(', ')}]`,
      );

      if (!cookieMap.has('sessionid')) {
        throw new UnauthorizedException(
          `Credenciales incorrectas. WispHub respondió ${loginResp.status} sin sessionid. ` +
          `Verifica WISPHUB_WEB_LOGIN y WISPHUB_WEB_PASSWORD en el .env.`,
        );
      }

      sessionCookies = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      this.logger.log(`Sesión iniciada exitosamente. Slug: ${companySlug}`);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new UnauthorizedException(`Login en WispHub fallido: ${msg}`);
    }

    return {
      sessionCookies,
      csrfToken,
      companySlug,
      createdAt: Date.now(),
    };
  }
}
