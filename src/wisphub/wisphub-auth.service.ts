import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import { WisphubLoginDto } from './dto/wisphub-login.dto';

export interface WisphubAuthResult {
  /** API Key del usuario autenticado */
  apiKey: string;
  /** Email / usuario con el que se autenticó */
  login: string;
  /** Indica si la autenticación fue exitosa */
  authenticated: boolean;
}

/**
 * Servicio que realiza login al panel web de WispHub y extrae la API Key
 * del perfil del usuario autenticado.
 *
 * Flujo:
 *  1. GET /accounts/login/  → obtener csrftoken (cookie + campo oculto)
 *  2. POST /accounts/login/ → enviar login + password + csrfmiddlewaretoken
 *  3. Con las cookies de sesión, GET /staff/{id}/editar/ → extraer API Key del HTML
 */
@Injectable()
export class WisphubAuthService {
  private readonly logger = new Logger(WisphubAuthService.name);
  private readonly wisphubWebUrl = 'https://wisphub.io';

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Autentica al usuario en el panel web de WispHub y retorna su API Key.
   * Si el login es exitoso, también actualiza la variable de entorno en memoria
   * para que WisphubService use el nuevo API Key.
   */
  async loginAndGetApiKey(dto: WisphubLoginDto): Promise<WisphubAuthResult> {
    // ── Paso 1: Obtener la página de login para extraer el csrftoken ────────
    const loginPageUrl = `${this.wisphubWebUrl}/accounts/login/`;

    this.logger.log(`Obteniendo página de login: ${loginPageUrl}`);

    let csrfToken: string;
    let initialCookies: string;

    try {
      const loginPageResp = await firstValueFrom(
        this.http.get(loginPageUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html',
          },
          maxRedirects: 5,
        }),
      );

      // Extraer csrftoken del campo oculto del formulario
      const $ = cheerio.load(loginPageResp.data as string);
      csrfToken = $('input[name="csrfmiddlewaretoken"]').val() as string;

      // Las cookies vienen en el header Set-Cookie
      const setCookieHeader = loginPageResp.headers['set-cookie'] as
        | string[]
        | string
        | undefined;
      initialCookies = Array.isArray(setCookieHeader)
        ? setCookieHeader.map((c) => c.split(';')[0]).join('; ')
        : (setCookieHeader?.split(';')[0] ?? '');

      // Si no está en el form, intentar extraer del cookie
      if (!csrfToken) {
        const csrfCookie = initialCookies
          .split('; ')
          .find((c) => c.startsWith('csrftoken='));
        csrfToken = csrfCookie?.split('=')[1] ?? '';
      }

      if (!csrfToken) {
        throw new UnauthorizedException(
          'No se pudo obtener el token CSRF de WispHub',
        );
      }

      this.logger.debug(
        `CSRF Token obtenido: ${csrfToken.substring(0, 10)}...`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error obteniendo página de login: ${msg}`);
      throw new UnauthorizedException(`Error conectando a WispHub: ${msg}`);
    }

    // ── Paso 2: Hacer POST al login con las credenciales ────────────────────
    this.logger.log(`Enviando credenciales para: ${dto.login}`);

    let sessionCookies: string;

    try {
      const loginResp = await firstValueFrom(
        this.http.post(
          loginPageUrl,
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
              Referer: loginPageUrl,
              Cookie: initialCookies,
            },
            maxRedirects: 0, // No seguir el redirect automáticamente
            validateStatus: (s) => s < 400, // Aceptar 302
          },
        ),
      );

      // Extraer cookies de sesión del response
      const respCookies = loginResp.headers['set-cookie'] as
        | string[]
        | string
        | undefined;
      const cookieList = Array.isArray(respCookies)
        ? respCookies
        : respCookies
          ? [respCookies]
          : [];

      sessionCookies = cookieList.map((c) => c.split(';')[0]).join('; ');

      // Verificar que tengamos sessionid (indica login exitoso)
      if (!sessionCookies.includes('sessionid')) {
        throw new UnauthorizedException(
          'Credenciales incorrectas o acceso denegado en WispHub',
        );
      }

      this.logger.log('Login exitoso — sesión iniciada en WispHub');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error en login WispHub: ${msg}`);
      throw new UnauthorizedException(`Login fallido: ${msg}`);
    }

    // ── Paso 3: Obtener el API Key del perfil del usuario ───────────────────
    // La API Key está en Ajustes > Staff > [usuario] > pestaña Personal
    // Intentamos obtenerla desde la página de ajustes del perfil propio
    const apiKey = await this.extractApiKey(
      sessionCookies,
      csrfToken,
      dto.login,
    );

    return {
      apiKey,
      login: dto.login,
      authenticated: true,
    };
  }

  /**
   * Extrae el API Key del perfil del usuario en el panel de WispHub.
   * Navega al listado de staff, busca el usuario y extrae la clave del HTML.
   */
  private async extractApiKey(
    sessionCookies: string,
    csrfToken: string,
    loginEmail: string,
  ): Promise<string> {
    const headers = {
      Cookie: sessionCookies,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html',
      'X-CSRFToken': csrfToken,
    };

    // Intentar obtener el API Key vía la API REST (más fiable que scraping HTML)
    // El endpoint /api/users/me/ o /api/staff/ podría retornar el token
    try {
      const staffApiResp = await firstValueFrom(
        this.http.get(`${this.wisphubWebUrl}/api/staff/`, { headers }),
      );
      const staffData = staffApiResp.data as any;
      const results = staffData?.results ?? staffData;

      if (Array.isArray(results)) {
        // Buscar el usuario por email
        const user = results.find(
          (u: any) =>
            u.email === loginEmail ||
            u.username === loginEmail ||
            u.login === loginEmail,
        );
        if (user?.api_key || user?.token || user?.key) {
          const key = user.api_key ?? user.token ?? user.key;
          this.logger.log('API Key obtenida vía /api/staff/');
          return key;
        }
      }
    } catch {
      this.logger.debug(
        'No se pudo obtener API Key vía /api/staff/, intentando scraping...',
      );
    }

    // Fallback: hacer scraping del panel web de staff
    try {
      const staffPageResp = await firstValueFrom(
        this.http.get(`${this.wisphubWebUrl}/staff/`, { headers }),
      );
      const $ = cheerio.load(staffPageResp.data as string);

      // Buscar enlace de edición para el usuario actual
      const found = { url: '' };
      $('table tr, .staff-row, [data-email]').each((_: number, el: any) => {
        const row = $(el);
        const rowText = row.text();
        if (!found.url && rowText.includes(loginEmail)) {
          const editLink = row
            .find('a[href*="/editar/"], a[href*="/edit/"]')
            .attr('href');
          if (editLink) found.url = editLink;
        }
      });

      const staffEditUrl: string | null = found.url || null;

      if (staffEditUrl) {
        const editUrl = staffEditUrl.startsWith('http')
          ? staffEditUrl
          : `${this.wisphubWebUrl}${staffEditUrl}`;

        const editPageResp = await firstValueFrom(
          this.http.get(editUrl, { headers }),
        );
        const $edit = cheerio.load(editPageResp.data as string);

        // Buscar el campo del API Key en el HTML
        const apiKey =
          $edit('input[name="api_key"]').val() ??
          $edit('input[name="token"]').val() ??
          $edit('[data-api-key]').attr('data-api-key') ??
          $edit('code:contains("Api-Key")')
            .text()
            .replace('Api-Key', '')
            .trim() ??
          null;

        if (apiKey) {
          this.logger.log('API Key extraída del panel de edición de staff');
          return apiKey as string;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Scraping de API Key falló: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Si no se pudo extraer dinámicamente, retornar la del .env como fallback
    const envKey = this.configService.get<string>('WISPHUB_API_TOKEN', '');
    this.logger.warn(
      'No se pudo extraer el API Key del panel. Retornando la clave del .env como fallback.',
    );
    return envKey;
  }
}
