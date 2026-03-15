import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import * as express from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.use(
    '/swagger-theme-toggle.js',
    express.static(join(process.cwd(), 'public', 'swagger-theme-toggle.js')),
  );
  app.enableCors();
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  if (configService.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Pasarela de pagos API')
      .setDescription('Integración WispHub + Wompi para gestión de pagos')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' })
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      customSiteTitle: 'Pasarela de pagos - Swagger',
      swaggerOptions: {
        persistAuthorization: true,
      },
      customCss: `
        body.swagger-dark { background: #0d1117; color: #c9d1d9; }
        body.swagger-dark .topbar { background: #0d1117; }
        body.swagger-dark .swagger-ui .info { color: #c9d1d9; }
        body.swagger-dark .swagger-ui .markdown p { color: #c9d1d9; }
        body.swagger-dark .swagger-ui .opblock { background: #161b22; border-color: #30363d; }
        body.swagger-dark .swagger-ui .opblock-summary { background: #21262d; border-color: #30363d; }
        body.swagger-dark .swagger-ui .opblock-summary-description { color: #c9d1d9; }
        body.swagger-dark .swagger-ui .scheme-container { background: #161b22; }
        body.swagger-dark .swagger-ui .model-box { background: #0d1117; }
        body.swagger-dark .swagger-ui .btn.execute { background: #238636; border-color: #238636; }
        body.swagger-dark .swagger-ui .parameter__name, body.swagger-dark .swagger-ui .parameter__type { color: #58a6ff; }
        body.swagger-dark .swagger-ui .response-col_status { color: #a5d6ff; }
        #swagger-theme-toggle { background: #ffffff; color: #111827; }
        body.swagger-dark #swagger-theme-toggle { background: #111827; color: #e5e7eb; border-color: #30363d; }
      `,
      customJs: '/swagger-theme-toggle.js',
    });
  }

  await app.listen(port, '0.0.0.0');
  Logger.log(`HTTP server listening on port ${port} (0.0.0.0)`, 'Bootstrap');
}

bootstrap();
