import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('link')
  createPaymentLink(@Body() dto: CreatePaymentLinkDto) {
    return this.paymentsService.createPaymentLink(dto);
  }

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
}
