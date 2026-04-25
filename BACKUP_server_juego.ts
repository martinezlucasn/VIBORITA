import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

dotenv.config();

// Initialize Firebase Admin
const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const firebaseApp = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: firebaseConfig.projectId,
});

const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
console.log(`Firebase Admin initialized for project: ${firebaseConfig.projectId}`);

// Initialize Supabase Admin (using service role if available, otherwise anon)
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);
console.log(`Supabase client initialized. URL: ${!!supabaseUrl}, Key: ${!!supabaseKey}, ServiceRole: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json());
  
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;
  const MAX_PLAYERS_PER_ROOM = 10;

  // Game State
  interface Player {
    id: string;
    roomId: string;
    displayName: string;
    segments: { x: number; y: number }[];
    isAlive: boolean;
    spawnTime: number;
    angle: number;
    wager: number;
    color1?: string;
    color2?: string;
    skinEmoji?: string;
    hasAura?: boolean;
    auraType?: string;
    activePowerUps?: Record<string, number>;
  }

  const rooms = new Map<string, { players: Map<string, Player>; bots: Player[] }>();
  const userSockets = new Map<string, string>(); // userId -> socketId
  const CELL = 24;
  const WORLD_W = 3000;
  const WORLD_H = 3000;

  // Mercado Pago Configuration
  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'APP_USR-8338032777407473-041219-60a8de4c25c2273f599e7f4c30d48437-148608155';
  const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

  // 🛡️ Firestore Bridge: Listen for payments from external Google Cloud services
  function setupFirestoreBridge() {
    console.log("[BRIDGE] 🚀 Iniciando Puente Infalible de Pagos...");
    const paymentsRef = db.collection('payment_notifications');
    
    // Escuchamos todas las notificaciones recientes
    paymentsRef.orderBy('received_at', 'desc').limit(50).onSnapshot(async (snapshot) => {
      if (snapshot.empty) return;
      
      const pendingDocs = snapshot.docs.filter(d => d.data().processed === false);
      if (pendingDocs.length === 0) return;

      console.log(`[BRIDGE] 📥 Procesando ${pendingDocs.length} notificaciones pendientes.`);
      
      for (const doc of pendingDocs) {
        const data = doc.data();
        const notificationId = doc.id;
        const mpPaymentId = data.payment_id || data.id;

        if (!mpPaymentId) continue;

        try {
          console.log(`[BRIDGE] 🔍 Validando con Mercado Pago ID: ${mpPaymentId}`);
          const payment = new Payment(client);
          const paymentData = await payment.get({ id: String(mpPaymentId) });
          
          if (paymentData.status === 'approved') {
            console.log(`[BRIDGE] ✅ Pago aprobado. Iniciando acreditación para ${data.user_id}`);
            const success = await processPaymentUpdate(String(mpPaymentId), paymentData);
            
            await doc.ref.update({ 
              processed: true, 
              success: success, 
              processedAt: FieldValue.serverTimestamp(),
              status: 'approved'
            });
            console.log(`[BRIDGE] ✨ Listo. El panel debería mostrar "SI" ahora.`);
          } else {
            console.log(`[BRIDGE] ℹ️ Pago ${mpPaymentId} en estado ${paymentData.status}.`);
          }
        } catch (err: any) {
          console.error(`[BRIDGE] ❌ Error verificando pago ${mpPaymentId}:`, err.message);
          if (err.message?.includes('not found')) {
             await doc.ref.update({ processed: true, error: "Not found in MP" });
          }
        }
      }
    }, (err) => {
      console.error("[BRIDGE] Error en el Listener de Firestore:", err);
    });
  }

  // Only setup bridge if configured
  if (client) {
    setupFirestoreBridge();
  }

  // API Routes
  app.post("/api/create-preference", async (req, res) => {
    if (!client) {
      return res.status(500).json({ error: "Mercado Pago no está configurado" });
    }

    const { amount, userId, email, type, pointsAmount, price } = req.body;

    if (!email) {
      return res.status(400).json({ error: "El email del usuario es requerido para procesar el pago" });
    }

    try {
      const preference = new Preference(client);
      
      // Ensure notification_url is only set if we have a valid public host
      const host = req.headers.host;
      const xForwardedHost = req.headers['x-forwarded-host'] as string;
      const actualHost = xForwardedHost || host;
      const isLocal = actualHost?.includes('localhost') || actualHost?.includes('127.0.0.1');
      
      // Use the canonical bridge URL for payment notifications
      const notificationUrl = "https://puente-viborita-955968394030.us-central1.run.app/api/webhook";

      console.log(`Creating preference for user ${userId}, amount ${amount}, webhook: ${notificationUrl}`);

      const result = await preference.create({
        body: {
          items: [
            {
              id: type === 'points' ? `points-${pointsAmount}` : `coins-${amount}`,
              title: type === 'points' ? `Carga de ${pointsAmount} Puntos - Viborita` : `Carga de ${amount} Monedas - Viborita`,
              quantity: 1,
              unit_price: Number(price || amount),
              currency_id: 'ARS'
            }
          ],
          payer: {
            email: email
          },
          metadata: {
            user_id: userId,
            coins_amount: amount,
            purchase_type: type || 'monedas',
            points_to_add: pointsAmount || 0
          },
          back_urls: {
            success: `${req.headers.origin}/?payment=success`,
            failure: `${req.headers.origin}/?payment=failure`,
            pending: `${req.headers.origin}/?payment=pending`
          },
          auto_return: 'approved',
          notification_url: notificationUrl,
          external_reference: userId // Useful for tracking
        }
      });

      res.json({ id: result.id, init_point: result.init_point });
    } catch (error: any) {
      console.error("Error creating Mercado Pago preference:", error);
      const errorMessage = error.message || "Error al crear la preferencia de pago";
      res.status(500).json({ error: errorMessage });
    }
  });

  // Helper to process payments (approved or pending)
  async function processPaymentUpdate(paymentId: string, data: any) {
    const status = data.status;
    console.log(`[PAYMENT_PROCESSOR] Examining payment ${paymentId}. Status: ${status}`);
    
    if (status !== 'approved' && status !== 'pending') {
      console.log(`[PAYMENT_PROCESSOR] Payment ${paymentId} status (${status}) not eligible for processing in this handler. Skipping.`);
      return false;
    }

    // Mercado Pago can send metadata in different places
    const metadata = data.metadata || {};
    
    // Fallback chain for userId: metadata -> external_reference
    const userId = metadata.user_id || metadata.userId || data.external_reference;
    
    // Fallback chain for amount: metadata.coins_amount -> transaction_amount
    let amount = Number(metadata.coins_amount || metadata.amount || 0);
    if (amount <= 0) {
      amount = Number(data.transaction_amount || 0);
      console.log(`[PAYMENT_PROCESSOR] Usando fallback de monto: ${amount}`);
    }

    const purchaseType = metadata.purchase_type || 'monedas';
    const pointsToAdd = Number(metadata.points_to_add || 0);

    console.log(`[PAYMENT_PROCESSOR] 📊 Información extraída:
      - ID Pago: ${paymentId}
      - ID Usuario: ${userId}
      - Monto: ${amount}
      - Tipo: ${purchaseType}
      - Status: ${status}
    `);

    if (!userId) {
      console.error("[PAYMENT_PROCESSOR] ❌ ERROR: No userId found in payment data. Cannot process.");
      return false;
    }
    
    if (amount <= 0) {
      console.warn("[PAYMENT_PROCESSOR] ⚠️ ADVERTENCIA: El monto es 0 o menor.");
    }
    
    // 1. Check if this payment was already processed as approved to prevent double crediting
    const paymentRef = db.collection('processed_payments').doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (paymentDoc.exists && paymentDoc.data()?.status === 'approved') {
      console.log(`Payment ${paymentId} already approved and credited. Skipping.`);
      return true;
    }

    // Notify user via Socket.IO if they are online
    const userSocketId = userSockets.get(userId);
    if (userSocketId) {
      console.log(`[PAYMENT_PROCESSOR] Notifying user ${userId} via socket ${userSocketId} about status ${status}`);
      io.to(userSocketId).emit("payment_status_update", {
        id: paymentId,
        status: status,
        amount: amount,
        purchaseType: purchaseType
      });
    }

    if (status === 'pending') {
      console.log(`[PAYMENT_PROCESSOR] Recording payment ${paymentId} as pending in Firestore and Supabase.`);
      await paymentRef.set({
        userId,
        amount,
        purchaseType,
        pointsAdded: purchaseType === 'points' ? pointsToAdd : (amount === 100000 ? 50000 : 0),
        timestamp: FieldValue.serverTimestamp(),
        status: 'pending',
        mercadoPagoData: {
          id: data.id,
          status: data.status,
          status_detail: data.status_detail,
          external_reference: data.external_reference
        }
      }, { merge: true });

      // Record as pending transaction in Supabase
      try {
        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'pending',
          currency: purchaseType === 'points' ? 'coins' : 'monedas',
          amount: purchaseType === 'points' ? pointsToAdd : amount,
          reason: `mercado_pago_pending: ${paymentId}`,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error("Error logging pending transaction to Supabase:", err);
      }

      return true;
    }

    // From here on, it's 'approved'
    console.log(`[PAYMENT_PROCESSOR] Proceeding to credit balance for approved payment ${paymentId}`);

    // 2. Update Firestore User
    const userRef = db.collection('users').doc(userId);
    
    try {
      await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        
        const currentMonedas = userDoc.exists ? (userDoc.data()?.monedas || 0) : 0;
        const currentCoins = userDoc.exists ? (userDoc.data()?.coins || 0) : 0;
        
        const updates: any = {};

        if (purchaseType === 'points') {
          updates.coins = currentCoins + pointsToAdd;
        } else {
          updates.monedas = currentMonedas + amount;
          // If it's the 100k package, add the 50k points bonus
          if (amount === 100000) {
            updates.coins = currentCoins + 50000;
          }
        }

        if (userDoc.exists) {
          transaction.update(userRef, updates);
        } else {
          transaction.set(userRef, {
            monedas: updates.monedas || 0,
            coins: updates.coins || 0,
            displayName: 'Player',
            email: data.payer?.email || '',
            lastActive: Date.now(),
            ownedSkins: ['default'],
            equippedSkin: 'default',
            highScore: 0,
            highScoreMonedas: 0
          }, { merge: true });
        }

        transaction.set(paymentRef, {
          userId,
          amount,
          purchaseType,
          pointsAdded: purchaseType === 'points' ? pointsToAdd : (amount === 100000 ? 50000 : 0),
          timestamp: FieldValue.serverTimestamp(),
          status: 'approved',
          mercadoPagoData: {
            id: data.id,
            status: data.status,
            status_detail: data.status_detail,
            external_reference: data.external_reference
          }
        }, { merge: true });
      });
    } catch (transactionError) {
      console.error("Transaction failed:", transactionError);
      throw transactionError;
    }

    // 3. Update Supabase Profile
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('monedas, coins')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        console.error(`[PAYMENT_PROCESSOR] ❌ Error al buscar perfil en Supabase para ${userId}:`, profileError);
      } else if (profile) {
        console.log(`[PAYMENT_PROCESSOR] 👤 Usuario encontrado:`, profile);
        const updates: any = {};
        if (purchaseType === 'points') {
          updates.coins = (profile.coins || 0) + pointsToAdd;
        } else {
          updates.monedas = (profile.monedas || 0) + amount;
          if (amount === 100000) {
            updates.coins = (profile.coins || 0) + 50000;
          }
        }

        const { error: updateError } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', userId);
        
        if (updateError) {
          console.error("[PAYMENT_PROCESSOR] ❌ Error al actualizar saldo en Supabase:", updateError);
        } else {
          console.log(`[PAYMENT_PROCESSOR] ✅ Saldo actualizado correctamente en Supabase para ${userId}`);
        }
      } else {
        console.warn(`[PAYMENT_PROCESSOR] ⚠️ No se encontró ningún perfil en Supabase con el ID: ${userId}`);
      }
    } catch (supabaseErr) {
      console.error("Supabase operation failed:", supabaseErr);
    }

    // 4. Log Transaction in Supabase
    try {
      await supabase.from('transactions').insert({
        user_id: userId,
        type: 'received',
        currency: purchaseType === 'points' ? 'coins' : 'monedas',
        amount: purchaseType === 'points' ? pointsToAdd : amount,
        reason: `mercado_pago_purchase: ${paymentId}`,
        timestamp: new Date().toISOString()
      });

      if (purchaseType === 'monedas' && amount === 100000) {
        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'received',
          currency: 'coins',
          amount: 50000,
          reason: `mercado_pago_bonus: ${paymentId}`,
          timestamp: new Date().toISOString()
        });
      }
    } catch (logErr) {
      console.error("Error logging transaction to Supabase:", logErr);
    }

    console.log(`Successfully credited ${amount} ${purchaseType} to user ${userId}`);
    return true;
  }

  app.post("/api/webhook", async (req, res) => {
    const { query, body } = req;
    
    // Mercado Pago sends topic/id in different places depending on the version
    // Topic can be in type, topic, action, or body.type
    let topic = query.topic || query.type || body.type || body.action;
    // ID can be in data.id, id, resource (as a URL), etc.
    let id = query.id || body.data?.id || body.id;

    // Handle 'resource' pattern (e.g., https://api.mercadopago.com/v1/payments/123)
    if (!id && body.resource) {
      const parts = body.resource.split('/');
      id = parts[parts.length - 1];
    }

    console.log(`[WEBHOOK] Incoming: topic=${topic}, id=${id}, action=${body.action}, type=${body.type}`);
    
    // Respond IMMEDIATELY to Mercado Pago to avoid 502/504 timeouts
    res.sendStatus(200);

    if (!id) {
      console.warn("[WEBHOOK] Received notification without a detectable ID. Skipping background process.");
      return;
    }

    // Process the rest in the background
    (async () => {
      const paymentId = String(id);
      console.log(`[WEBHOOK_BG] Starting background process for ${paymentId} (Topic: ${topic})`);

      // Log to Firestore for debugging
      let logRef = null;
      try {
        logRef = await db.collection('webhook_logs').add({
          topic: topic || 'unknown',
          id: paymentId,
          query,
          body,
          processed: false,
          timestamp: FieldValue.serverTimestamp()
        });
      } catch (e) {
        console.error("[WEBHOOK_BG] Firestore log failed:", e);
      }

      // Also log to Supabase for redundancy
      try {
        await supabase.from('webhook_logs').insert({
          topic: String(topic || 'unknown'),
          external_id: String(id || 'unknown'),
          payload: { query, body },
          timestamp: new Date().toISOString()
        });
      } catch (supabaseErr) {
        console.warn("Supabase webhook logging skipped:", supabaseErr);
      }

      const isPaymentEvent = topic === 'payment' || 
                            topic === 'payment.updated' || 
                            topic === 'payment.created' ||
                            (typeof topic === 'string' && topic.includes('payment'));

      if (isPaymentEvent && id) {
        const paymentId = String(id);
        
        try {
          if (!client) {
            throw new Error("MercadoPago client is NOT initialized. Please set MP_ACCESS_TOKEN in Settings.");
          }

          const payment = new Payment(client);
          console.log(`[WEBHOOK_BG] Fetching payment ${paymentId} from MP API...`);
          
          // Fetch full payment details from Mercado Pago API
          const data = await payment.get({ id: paymentId });
          console.log(`[WEBHOOK_BG] MP API Response status: ${data.status}`);
          
          if (data.status === 'approved' || data.status === 'pending') {
            const success = await processPaymentUpdate(paymentId, data);
            
            // Mark as processed in Firestore logs
            if (logRef) {
              await logRef.update({ 
                processed: true, 
                approved: data.status === 'approved', 
                status: data.status,
                success: success,
                processedAt: FieldValue.serverTimestamp()
              });
            }
          } else {
            console.log(`[WEBHOOK_BG] Payment ${paymentId} not approved yet. Current status: ${data.status}`);
            if (logRef) {
              await logRef.update({ 
                processed: true, 
                approved: false, 
                status: data.status,
                processedAt: FieldValue.serverTimestamp()
              });
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[WEBHOOK_BG] Error processing background webhook payment ${paymentId}:`, error);
          if (logRef) {
            await logRef.update({ 
              processed: true, 
              error: errorMessage,
              processedAt: FieldValue.serverTimestamp()
            });
          }
        }
      }
    })();
  });

  app.get("/api/check-payment/:paymentId", async (req, res) => {
    const { paymentId } = req.params;
    
    if (!client || !paymentId) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    try {
      const payment = new Payment(client);
      const data = await payment.get({ id: paymentId });
      
      if (data.status === 'approved' || data.status === 'pending') {
        const success = await processPaymentUpdate(paymentId, data);
        const metadata = data.metadata || {};
        return res.json({ 
          success, 
          status: data.status, 
          already_processed: data.status === 'approved' && !success,
          amount: metadata.coins_amount || data.transaction_amount,
          type: metadata.purchase_type || 'monedas',
          userId: metadata.user_id,
          email: metadata.email || (data.payer ? data.payer.email : undefined)
        });
      }
      
      return res.json({ success: false, status: data.status });
    } catch (error: any) {
      console.error("Error checking payment:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // REST OF FILE OMITTED FOR BREVITY AS THIS IS FOR BACKUP PURPOSES
  // ... socket.io and room logic ...
}

startServer();
