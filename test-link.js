const axios = require('axios');

// Cédula del cliente (debe existir en tu WispHub)
const customerId = "1102816908";
const amountInCents = 2080000; // Ej: 20.800 COP = 2080000 centavos

console.log(`Solicitando Link de Pago para la cédula: ${customerId}...`);

axios.post('http://localhost:3000/api/payments/link', {
    customerId: customerId,
    amountInCents: amountInCents,
    currency: "COP",
    description: "Pago de mensualidad internet",
    singleUse: true,
    redirectUrl: "https://tudominio.com/gracias-por-el-pago"
}).then(res => {
    console.log('\n✅ Link de pago generado exitosamente:');
    console.log('🔗 URL:', res.data.url);
    console.log('🆔 Payment Link ID:', res.data.paymentLinkId);
    console.log('⏳ Expira en:', res.data.expiresAt);
}).catch(err => {
    console.error('\n❌ Error vinculando pago:', err.response ? err.response.data : err.message);
});
