import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ActivateServiceDto } from './dto/activate-service.dto';
import { UpdateCutoffDateDto } from './dto/update-cutoff-date.dto';
import { WisphubService } from './wisphub.service';
import { WisphubCustomer } from './interfaces/wisphub-customer.interface';
import { WisphubInvoice } from './interfaces/wisphub-invoice.interface';

@ApiTags('wisphub')
@Controller('wisphub')
export class WisphubController {
  constructor(private readonly wisphubService: WisphubService) {}

  @Get('clients/:id')
  @ApiOperation({ summary: 'Obtener servicio/cliente por ID desde WispHub' })
  @ApiParam({
    name: 'id',
    description: 'ID del servicio en WispHub (id_servicio)',
  })
  @ApiOkResponse({
    type: Object,
    description: 'Datos del cliente y su servicio',
  })
  getCustomer(@Param('id') id: string): Promise<WisphubCustomer> {
    return this.wisphubService.getCustomer(id);
  }

  @Get('clients/search')
  @ApiOperation({
    summary: 'Buscar clientes por cédula / documento de identidad en WispHub',
  })
  @ApiQuery({
    name: 'document',
    required: true,
    type: String,
    description: 'Número de cédula o documento de identidad del cliente',
  })
  @ApiOkResponse({ type: Array, description: 'Lista de servicios encontrados' })
  searchCustomers(
    @Query('document') document: string,
  ): Promise<WisphubCustomer[]> {
    return this.wisphubService.searchCustomersByDocument(document);
  }

  @Get('clients/:id/invoices')
  @ApiOperation({ summary: 'Listar facturas del cliente en WispHub' })
  @ApiParam({
    name: 'id',
    description: 'ID del servicio en WispHub (id_servicio)',
  })
  @ApiQuery({
    name: 'estado',
    required: false,
    type: String,
    description: 'Filtrar por estado: Pendiente | Pagada | Vencida | Anulada',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOkResponse({ type: Array, description: 'Facturas del cliente' })
  getInvoices(
    @Param('id') id: string,
    @Query('estado') estado?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<WisphubInvoice[]> {
    return this.wisphubService.getCustomerInvoices(id, estado, limit, offset);
  }

  @Patch('clients/:id/cutoff-date')
  @ApiOperation({ summary: 'Actualizar fecha de corte del cliente en WispHub' })
  @ApiParam({
    name: 'id',
    description: 'ID del servicio en WispHub (id_servicio)',
  })
  @ApiOkResponse({ description: 'Fecha de corte actualizada' })
  updateCutoff(@Param('id') id: string, @Body() dto: UpdateCutoffDateDto) {
    return this.wisphubService.updateCutoffDate(id, dto);
  }

  @Post('clients/:id/activate')
  @ApiOperation({
    summary: 'Activar o reactivar servicio del cliente en WispHub',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del servicio en WispHub (id_servicio)',
  })
  @ApiOkResponse({ description: 'Servicio activado/reactivado' })
  activate(@Param('id') id: string, @Body() dto: ActivateServiceDto) {
    return this.wisphubService.activateService(id, dto);
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Obtener formas de pago configuradas en WispHub' })
  @ApiOkResponse({
    type: Array,
    description: 'Lista de formas de pago (id + nombre)',
  })
  getPaymentMethods() {
    return this.wisphubService.getPaymentMethods();
  }
}
