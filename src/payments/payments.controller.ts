import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { PaymentsService } from './payments.service';
import { GetPaymentsReportDto } from './dto/get-payments-report.dto';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiOperation({ summary: 'Crear un link de pago en Wompi' })
  @ApiResponse({ status: 201, description: 'Link creado exitosamente' })
  @Post('link')
  createPaymentLink(@Body() dto: CreatePaymentLinkDto) {
    return this.paymentsService.createPaymentLink(dto);
  }

  @ApiOperation({ summary: 'Webhook para recibir notificaciones de Wompi' })
  @Post('webhook')
  async handleWebhook(
    @Headers('x-event-signature') signature: string | undefined,
    @Body() payload: unknown,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = req.rawBody?.toString();
    await this.paymentsService.handleWebhook(payload, signature, rawBody);
    return { received: true };
  }

  @ApiOperation({ summary: 'Generar reporte de pagos (requiere login)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('report')
  async getReport(@Query() filters: GetPaymentsReportDto) {
    return this.paymentsService.getReport(filters);
  }
}
