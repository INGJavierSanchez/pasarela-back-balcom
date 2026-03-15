import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WisphubService } from './wisphub.service';
import { WisphubController } from './wisphub.controller';
import { WisphubAuthService } from './wisphub-auth.service';
import { WisphubAuthController } from './wisphub-auth.controller';
import { WisphubWebService } from './wisphub-web.service';
import { WisphubWebController } from './wisphub-web.controller';

@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get<string>('WISPHUB_BASE_URL'),
        timeout: 60000, // 60s — endpoints de facturas/clientes pueden ser lentos
        maxRedirects: 10,
      }),
    }),
  ],
  controllers: [WisphubController, WisphubAuthController, WisphubWebController],
  providers: [WisphubService, WisphubAuthService, WisphubWebService],
  exports: [WisphubService, WisphubAuthService, WisphubWebService],
})
export class WisphubModule {}
