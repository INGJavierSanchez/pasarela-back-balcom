## Pasarela de pagos backend

Servicio NestJS que integra WispHub para consultar clientes y Wompi para generar enlaces de pago y registrar pagos confirmados. Incluye validación, configuración por entorno y webhook con firma.

### Características
- Generación de enlaces de pago Wompi con metadatos del cliente WispHub.
- Webhook para eventos Wompi con validación de firma y registro del pago en WispHub.
- Validación de DTOs, prefijo global `/api`, CORS y health check en `/api/health`.

### Requisitos previos
- Node.js 18 o superior
- npm

### Configuración
1) Instala dependencias:
```bash
npm install
```
2) Copia las variables de entorno:
```bash
cp .env.sample .env
```
3) Completa `.env` con tu `WISPHUB_BASE_URL` (ej: `https://api.wisphub.net/api`) y `WISPHUB_API_TOKEN`, más las llaves de Wompi (`WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENTS_SECRET`) y define `PAYMENTS_REDIRECT_URL`.

### Ejecución
- Desarrollo: `npm run start:dev`
- Producción: `npm run start:prod`
- El servidor escucha en `PORT` y expone los endpoints bajo `/api`.

### Endpoints clave
- `POST /api/payments/link` crea un enlace de pago. Body esperado: `customerId`, `amountInCents`, `currency?`, `description?`, `redirectUrl?`, `singleUse?`, `customerEmail?`.
- `POST /api/payments/webhook` recibe eventos de Wompi. Debe incluir el header `x-event-signature`. Configura Wompi para enviar el webhook a esta ruta.
- `GET /api/health` verificación básica.
- `GET /api/docs` Swagger UI (solo en entornos no productivos) con tema oscuro y persistencia de autorización.
- `GET /api/wisphub/clients/:id` consulta un cliente en WispHub.
- `GET /api/wisphub/clients/search?document=` busca clientes por documento (`usuario_rb`).
- `GET /api/wisphub/clients/:id/invoices` lista facturas del cliente.
- `PATCH /api/wisphub/clients/:id/cutoff-date` actualiza la fecha de corte del cliente (body: `cutoffDate`, `note?`).
- `POST /api/wisphub/clients/:id/activate` reactiva/activa el servicio (body opcional: `reason`).

### Pruebas
- Unit: `npm run test`
- E2E: `npm run test:e2e`

### Notas
- Las rutas hacia WispHub usan endpoints genéricos `/clients/:id` y `/clients/:id/payments`. Ajusta si la API de WispHub difiere.
