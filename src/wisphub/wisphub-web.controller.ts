import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { WisphubWebService } from './wisphub-web.service';
import { WisphubLoginDto } from './dto/wisphub-login.dto';
import { WisphubWebSearchDto } from './dto/wisphub-web-search.dto';

/**
 * Controlador que expone los endpoints internos del panel web de WispHub.
 * Las credenciales son opcionales en cada request: si no se pasan, se usan
 * los valores de WISPHUB_WEB_LOGIN y WISPHUB_WEB_PASSWORD del .env.
 *
 * La sesión se cachea en memoria por 25 minutos.
 */
@ApiTags('wisphub-web (panel web)')
@Controller('wisphub/web')
export class WisphubWebController {
  constructor(
    private readonly wisphubWebService: WisphubWebService,
    private readonly configService: ConfigService,
  ) {}

  /** Resuelve las credenciales del request o cae al .env */
  private resolveCredentials(
    login?: string,
    password?: string,
  ): WisphubLoginDto {
    return {
      login: login || this.configService.get<string>('WISPHUB_WEB_LOGIN', ''),
      password:
        password || this.configService.get<string>('WISPHUB_WEB_PASSWORD', ''),
    };
  }

  // ─── Autenticación ──────────────────────────────────────────────────────────

  @Post('login')
  @ApiOperation({
    summary: 'Iniciar sesión en el panel web de WispHub',
    description:
      'Autentica en wisphub.io con usuario y contraseña. La sesión se cachea **25 minutos**. ' +
      'No es necesario llamar este endpoint antes de buscar — los endpoints de búsqueda ' +
      'se autentican automáticamente usando las credenciales del `.env`.',
  })
  @ApiBody({
    schema: {
      example: {
        login: 'javiersanchez@balcom',
        password: 'horus_javier_123',
      },
    },
  })
  @ApiOkResponse({
    description: 'Sesión iniciada correctamente',
    schema: {
      example: {
        message: 'Sesión iniciada exitosamente en WispHub',
        companySlug: 'balcom',
      },
    },
  })
  login(@Body() dto: WisphubLoginDto) {
    return this.wisphubWebService.login(dto);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Cerrar sesión (invalida caché)',
    description:
      'Invalida la sesión cacheada. La siguiente petición hará login automático.',
  })
  @ApiOkResponse({ schema: { example: { message: 'Sesión cerrada' } } })
  logout() {
    return this.wisphubWebService.logout();
  }

  // ─── Clientes ───────────────────────────────────────────────────────────────

  @Get('clientes')
  @ApiOperation({
    summary: 'Listar todos los clientes con paginación (panel web)',
    description:
      'Equivale a **Lista Clientes** en el panel de WispHub. ' +
      'La respuesta incluye `recordsTotal` con el total de registros.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Página (desde 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Registros por página',
    example: 50,
  })
  @ApiQuery({
    name: 'login',
    required: false,
    type: String,
    description: 'Email de WispHub (opcional si está en .env)',
    example: 'javiersanchez@balcom',
  })
  @ApiQuery({
    name: 'password',
    required: false,
    type: String,
    description: 'Contraseña de WispHub (opcional si está en .env)',
    example: 'horus_javier_123',
  })
  @ApiOkResponse({
    description: 'Lista paginada de clientes',
    schema: {
      example: {
        recordsTotal: 320,
        recordsFiltered: 320,
        data: [
          {
            nombre: 'JOSE JOAQUIN PEREZ',
            servicio: '92531084gpon4900',
            estado: 'Activo',
          },
        ],
      },
    },
  })
  listClientes(
    @Query('login') login?: string,
    @Query('password') password?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.wisphubWebService.listClientes(
      this.resolveCredentials(login, password),
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  @Get('clientes/buscar')
  @ApiOperation({
    summary: 'Buscar clientes (buscador avanzado del panel web)',
    description: `
Equivale al formulario **Buscar Clientes** del panel de WispHub.

**Campos disponibles para \`buscarEn\`:**

| Valor | Descripción |
|---|---|
| \`user__username\` | Cédula / usuario (default) |
| \`nombre\` | Nombre del cliente |
| \`ip\` | Dirección IP |
| \`mac\` | MAC address |
| \`num_contrato\` | Número de contrato |
| \`telefono\` | Teléfono |
| \`direccion\` | Dirección |

Las credenciales son opcionales si están configuradas en el \`.env\`.
    `,
  })
  @ApiQuery({
    name: 'busqueda',
    required: true,
    type: String,
    description: 'Texto a buscar (cédula, nombre, IP, etc.)',
    example: '92531684',
  })
  @ApiQuery({
    name: 'buscarEn',
    required: false,
    type: String,
    description: 'Campo en el que buscar',
    example: 'user__username',
    enum: [
      'user__username',
      'nombre',
      'ip',
      'mac',
      'num_contrato',
      'telefono',
      'direccion',
    ],
  })
  @ApiQuery({
    name: 'tipoBusqueda',
    required: false,
    type: String,
    description: 'Tipo de coincidencia',
    example: 'Contiene',
    enum: ['Contiene', 'Igual', 'Empieza', 'Termina'],
  })
  @ApiQuery({
    name: 'estado',
    required: false,
    type: String,
    description: 'Estado del servicio (1=Activo, 2=Suspendido, 0=Todos)',
    example: '1',
    enum: ['0', '1', '2'],
  })
  @ApiQuery({
    name: 'router',
    required: false,
    type: String,
    description: 'ID del router para filtrar (opcional)',
    example: '33298',
  })
  @ApiQuery({
    name: 'planInternet',
    required: false,
    type: String,
    description: 'ID del plan de internet para filtrar (opcional)',
  })
  @ApiQuery({
    name: 'login',
    required: false,
    type: String,
    description: 'Email de WispHub (opcional si está en .env)',
    example: 'javiersanchez@balcom',
  })
  @ApiQuery({
    name: 'password',
    required: false,
    type: String,
    description: 'Contraseña de WispHub (opcional si está en .env)',
    example: 'horus_javier_123',
  })
  @ApiOkResponse({
    description:
      'Clientes encontrados en formato JSON del panel web de WispHub',
  })
  searchClientes(
    @Query('busqueda') busqueda: string,
    @Query('login') login?: string,
    @Query('password') password?: string,
    @Query('buscarEn') buscarEn?: string,
    @Query('tipoBusqueda') tipoBusqueda?: string,
    @Query('estado') estado?: string,
    @Query('router') router?: string,
    @Query('planInternet') planInternet?: string,
  ) {
    const searchDto: WisphubWebSearchDto = {
      busqueda,
      buscarEn,
      tipoBusqueda,
      estado,
      router,
      planInternet,
    };
    return this.wisphubWebService.searchClientes(
      this.resolveCredentials(login, password),
      searchDto,
    );
  }

  // ─── Facturas ───────────────────────────────────────────────────────────────

  @Get('facturas')
  @ApiOperation({
    summary: 'Consultar facturas (panel web)',
    description: `
Consulta facturas del panel web de WispHub. Funciona en dos modos:

- **Búsqueda** (si pasas \`busqueda\`): busca por cédula, ID factura, usuario, etc.
- **Listado** (sin \`busqueda\`): lista todas con filtros de fecha y estado.

**Campos disponibles para \`buscarEn\`:**

| Valor | Descripción |
|---|---|
| \`cliente__perfilusuario__cedula\` | Cédula / DNI (default) |
| \`cliente__username\` | Nombre de usuario del servicio |
| \`id_factura\` | ID numérico de la factura |
| \`cliente__perfilusuario__telefono\` | Teléfono |
| \`cliente__user_cliente__id_servicio\` | ID del servicio |
        `,
  })
  @ApiQuery({
    name: 'busqueda',
    required: false,
    type: String,
    description: 'Cédula, ID factura, etc.',
    example: '92531684',
  })
  @ApiQuery({
    name: 'buscarEn',
    required: false,
    type: String,
    description: 'Campo de búsqueda',
    example: 'cliente__perfilusuario__cedula',
    enum: [
      'cliente__perfilusuario__cedula',
      'cliente__username',
      'id_factura',
      'cliente__perfilusuario__telefono',
      'cliente__user_cliente__id_servicio',
    ],
  })
  @ApiQuery({
    name: 'tipoBusqueda',
    required: false,
    type: String,
    description: 'Tipo de coincidencia',
    example: 'Contiene',
    enum: ['Contiene', 'Exacta'],
  })
  @ApiQuery({
    name: 'estado',
    required: false,
    type: String,
    description: 'Estado de la factura',
    example: 'pendiente',
    enum: ['pendiente', 'pagada', 'vencida', 'anulada'],
  })
  @ApiQuery({
    name: 'desde',
    required: false,
    type: String,
    description: 'Fecha inicio (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @ApiQuery({
    name: 'hasta',
    required: false,
    type: String,
    description: 'Fecha fin (YYYY-MM-DD)',
    example: '2026-03-31',
  })
  @ApiQuery({
    name: 'tipoFecha',
    required: false,
    type: String,
    description: 'Criterio de fecha',
    enum: ['fecha_emision', 'fecha_pago'],
    example: 'fecha_emision',
  })
  @ApiQuery({
    name: 'zona',
    required: false,
    type: String,
    description: 'ID de zona para filtrar',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Página (desde 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Registros por página',
    example: 50,
  })
  @ApiQuery({
    name: 'login',
    required: false,
    type: String,
    description: 'Email de WispHub (opcional si está en .env)',
    example: 'javiersanchez@balcom',
  })
  @ApiQuery({
    name: 'password',
    required: false,
    type: String,
    description: 'Contraseña de WispHub (opcional si está en .env)',
  })
  @ApiOkResponse({
    description: 'Facturas encontradas',
    schema: {
      example: [
        {
          id_factura: 85367,
          cliente__username: '92531684gpon4773@balcom',
          sub_total: '30000.00',
          total: '30000.00',
          saldo: '0.00',
          estado: 'Pendiente de pago',
          fecha_emision: '01/03/2026',
          cliente__perfilusuario__cedula: '92531684',
        },
      ],
    },
  })
  getFacturas(
    @Query('login') login?: string,
    @Query('password') password?: string,
    @Query('busqueda') busqueda?: string,
    @Query('buscarEn') buscarEn?: string,
    @Query('tipoBusqueda') tipoBusqueda?: string,
    @Query('estado') estado?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('tipoFecha') tipoFecha?: string,
    @Query('zona') zona?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.wisphubWebService.getFacturas(
      this.resolveCredentials(login, password),
      busqueda,
      buscarEn,
      tipoBusqueda,
      estado,
      desde,
      hasta,
      tipoFecha,
      zona,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  // ─── Endpoint compuesto para el frontend ────────────────────────────────────

  @Get('cliente-facturas')
  @ApiOperation({
    summary: 'Buscar cliente y traer sus facturas (frontend)',
    description:
      'Busca un cliente por cédula/NIT y retorna sus facturas del año actual ' +
      'ya normalizadas y separadas en **pendientes** y **pagadas**. ' +
      'Diseñado para ser consumido directamente por el frontend de la pasarela.',
  })
  @ApiQuery({
    name: 'cedula',
    required: true,
    type: String,
    description: 'Cédula o NIT del cliente',
    example: '92531684',
  })
  @ApiQuery({
    name: 'login',
    required: false,
    type: String,
    description: 'Email WispHub (opcional si está en .env)',
  })
  @ApiQuery({
    name: 'password',
    required: false,
    type: String,
    description: 'Contraseña WispHub (opcional si está en .env)',
  })
  @ApiOkResponse({
    description: 'Cliente y facturas normalizadas',
    schema: {
      example: {
        customerId: '92531684',
        customerName: 'JOSE JOAQUIN PEREZ',
        username: '92531684gpon4773@balcom',
        pending: [
          {
            id: '85367',
            amount: 30000,
            currency: 'COP',
            issueDate: '2026-03-01',
            dueDate: '2026-03-01',
            status: 'pending',
            rawEstado: 'Pendiente de pago',
          },
        ],
        paid: [
          {
            id: '84001',
            amount: 30000,
            currency: 'COP',
            issueDate: '2026-02-01',
            dueDate: '2026-02-01',
            paidDate: '2026-02-05',
            status: 'paid',
            rawEstado: 'Pagada',
          },
        ],
      },
    },
  })
  getClienteFacturas(
    @Query('cedula') cedula: string,
    @Query('login') login?: string,
    @Query('password') password?: string,
  ) {
    return this.wisphubWebService.getClienteFacturas(
      this.resolveCredentials(login, password),
      cedula,
    );
  }
}
