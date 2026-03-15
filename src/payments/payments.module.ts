import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WisphubModule } from '../wisphub/wisphub.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WompiService } from './wompi.service';
import { PaymentRecord } from './entities/payment-record.entity';

@Module({
  imports: [
    ConfigModule,
    WisphubModule,
    TypeOrmModule.forFeature([PaymentRecord]),
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get<string>('WOMPI_BASE_URL'),
        timeout: 10000,
        maxRedirects: 3,
      }),
    }),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, WompiService],
})
export class PaymentsModule {}
