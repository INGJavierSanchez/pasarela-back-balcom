import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(() => {
    process.env.WISPHUB_API_TOKEN ??= 'test-token';
    process.env.WOMPI_PUBLIC_KEY ??= 'pub_test';
    process.env.WOMPI_PRIVATE_KEY ??= 'prv_test';
    process.env.WOMPI_EVENTS_SECRET ??= 'secret';
    process.env.PAYMENTS_REDIRECT_URL ??= 'https://example.com/redirect';
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ status: 'ok' });
      });
  });
});
