import { Module } from '@nestjs/common';
import { PaymentLogsController } from './payment-logs.controller';

@Module({
  controllers: [PaymentLogsController]
})
export class PaymentLogsModule {}
