import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as Joi from 'joi';
import { PaymentsModule } from './payments/payments.module';
import { WisphubModule } from './wisphub/wisphub.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().port().default(3000),
        WISPHUB_BASE_URL: Joi.string()
          .uri()
          .default('https://api.wisphub.io/api'),
        WISPHUB_API_TOKEN: Joi.when('NODE_ENV', {
          is: 'test',
          then: Joi.string().default('test-wisphub-token'),
          otherwise: Joi.string().required(),
        }),
        WOMPI_BASE_URL: Joi.string()
          .uri()
          .default('https://production.wompi.co/v1'),
        WOMPI_PUBLIC_KEY: Joi.when('NODE_ENV', {
          is: 'test',
          then: Joi.string().default('pub_test_key'),
          otherwise: Joi.string().required(),
        }),
        WOMPI_PRIVATE_KEY: Joi.when('NODE_ENV', {
          is: 'test',
          then: Joi.string().default('prv_test_key'),
          otherwise: Joi.string().required(),
        }),
        WOMPI_EVENTS_SECRET: Joi.when('NODE_ENV', {
          is: 'test',
          then: Joi.string().default('events_secret_test'),
          otherwise: Joi.string().required(),
        }),
        PAYMENTS_REDIRECT_URL: Joi.when('NODE_ENV', {
          is: 'test',
          then: Joi.string().default('https://example.com/redirect'),
          otherwise: Joi.string().uri().required(),
        }),
        DATABASE_HOST: Joi.string().required(),
        DATABASE_PORT: Joi.number().default(5432),
        DATABASE_USER: Joi.string().required(),
        DATABASE_PASSWORD: Joi.string().required(),
        DATABASE_NAME: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST'),
        port: configService.get<number>('DATABASE_PORT'),
        username: configService.get<string>('DATABASE_USER'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),
        autoLoadEntities: true,
        synchronize: true, // Only creates new tables or columns; does not drop existing data securely.
      }),
    }),
    HealthModule,
    WisphubModule,
    PaymentsModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
