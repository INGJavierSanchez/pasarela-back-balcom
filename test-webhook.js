const crypto = require('crypto');
const axios = require('axios');

// Secreto de Sandbox de tu .env
const secret = 'test_events_KOLzaXLJPONhvg692RDshyCSdc3yr6zg';

// IMPORTANTE: Cambia esta cédula por una que SÍ tenga al menos 1 factura pendiente en tu Wisphub
const customerId = "1102816908";

const payload = {
    event: 'transaction.updated',
    data: {
        transaction: {
            id: "test-wompi-txn-" + Date.now(),
            amount_in_cents: 2080000,
            reference: "test-ref-" + Date.now(),
            currency: "COP",
            payment_method: { type: "CARD" },
            status: "APPROVED",
            metadata: {
                customerId: customerId
            }
        }
    }
};

const payloadString = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000).toString();
// Wompi firma usando HMAC SHA256 sobre "timestamp.payloadJSON"
const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${payloadString}`).digest('hex');

const signatureHeader = `t=${timestamp},v1=${signature}`;

console.log("Enviando webhook simulado a http://localhost:3000/api/payments/webhook...");
console.log(`Simulando pago Aprobado para cédula: ${customerId}\n`);

axios.post('http://localhost:3000/api/payments/webhook', payload, {
    headers: {
        'x-event-signature': signatureHeader,
        'Content-Type': 'application/json'
    }
}).then(res => {
    console.log('✅ Webhook procesado exitosamente por el backend:', res.data);
}).catch(err => {
    console.error('❌ Error enviando webhook:', err.response ? err.response.data : err.message);
});
