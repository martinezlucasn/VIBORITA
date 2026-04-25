const express = require('express');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();
app.use(express.json());

// CONFIGURACIÓN (v2.7)
const MP_ACCESS_TOKEN = 'APP_USR-8338032777407473-041219-60a8de4c25c2273f599e7f4c30d48437-148608155';
const DB_ID = 'ai-studio-57439a0f-5f63-4cda-b333-932430d39d7e';

if (admin.apps.length === 0) { admin.initializeApp(); }
const db = getFirestore(DB_ID);
const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

app.get('/', (req, res) => res.status(200).send('Puente Viborita v2.7 - SINCRONIZADO'));

app.all('/api/webhook', async (req, res) => {
  const { query, body, method } = req;
  const paymentId = query.id || query['data.id'] || (body.data && body.data.id) || body.id;
  const topic = query.type || query.topic || body.type || 'payment';

  console.log(`[${method}] Recibido ID: ${paymentId} | Tipo: ${topic}`);
  res.status(200).send('OK');

  if (paymentId && topic.includes('payment')) {
    try {
      const payment = new Payment(mpClient);
      const paymentData = await payment.get({ id: String(paymentId) });
      const { status, metadata, external_reference } = paymentData;
      
      const userId = metadata?.user_id || metadata?.userId || external_reference;
      const montoMonedas = Number(metadata?.coins_amount || 150);

      if (status === 'approved' && userId) {
        console.log(`[PROCESANDO] ID: ${paymentId} para Usuario: ${userId}`);

        // 1. ACTUALIZAR FIRESTORE (Base del Juego)
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const data = userDoc.data();
          const currentMonedas = data.monedas || 0;
          const currentCoins = data.coins || 0;
          
          let updateData = {
            monedas: currentMonedas + montoMonedas,
            lastActive: Date.now()
          };

          if (montoMonedas >= 100000) {
            updateData.coins = currentCoins + 50000;
          }

          await userRef.update(updateData);
          console.log(`[FIRESTORE] Saldo actualizado.`);
        }

        // 2. REGISTRAR NOTIFICACIÓN
        await db.collection('payment_notifications').add({
          payment_id: String(paymentId),
          user_id: userId,
          amount: montoMonedas,
          processed: true,
          status: 'approved',
          received_at: admin.firestore.FieldValue.serverTimestamp(),
          source: 'bridge_v2.7'
        });
      }
    } catch (err) {
      console.error(`[ERROR] ${err.message}`);
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Puente v2.7 Online`));
