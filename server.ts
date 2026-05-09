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
    userId?: string;
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
    tailEmoji?: string;
    hasAura?: boolean;
    auraType?: string;
    corner?: number;
    hasFlag?: number | null;
    isEliminated?: boolean;
    isBoosting?: boolean;
  }

  const rooms = new Map<string, { 
    players: Map<string, Player>; 
    bots: Player[]; 
    mode?: 'points' | 'wager' | 'ctf';
    flags?: { x: number; y: number; carrierId: string | null; ownerCorner: number; active: boolean }[];
    status?: 'waiting' | 'playing' | 'finished';
    wager?: number;
  }>();

  function initCTFFlags() {
    return [
      { x: 100, y: 100, carrierId: null, ownerCorner: 0, active: false },
      { x: WORLD_W - 100, y: 100, carrierId: null, ownerCorner: 1, active: false },
      { x: 100, y: WORLD_H - 100, carrierId: null, ownerCorner: 2, active: false },
      { x: WORLD_W - 100, y: WORLD_H - 100, carrierId: null, ownerCorner: 3, active: false }
    ];
  }
  const userSockets = new Map<string, string>(); // userId -> socketId
  const CELL = 24;
  const WORLD_W = 3000;
  const WORLD_H = 3000;

  const CORNERS = [
    { x: 100, y: 100, name: 'Rojo' },
    { x: WORLD_W - 100, y: 100, name: 'Verde' },
    { x: 100, y: WORLD_H - 100, name: 'Azul' },
    { x: WORLD_W - 100, y: WORLD_H - 100, name: 'Blanco' }
  ];
  const COLORS = ['#ef4444', '#10b981', '#3b82f6', '#f8fafc']; // Red, Green, Blue, White

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

  function createServerBot(roomId: string, id: string): Player {
    const botNames = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Ghost", "Hunter"];
    const name = botNames[Math.floor(Math.random() * botNames.length)];
    const x = Math.random() * WORLD_W;
    const y = Math.random() * WORLD_H;
    
    // 50% chance to use a random skin emoji
    const useSkin = Math.random() > 0.5;
    const skinEmojis = ['😊', '😆', '😮', '🤑', '🤢', '😂', '😍', '😎', '😡', '😱', '🤡', '🐷', '👩‍🦲', '🧑🏽‍🦲', '🪙', '⚽', '🌝', '🌞', '🌍'];
    const selectedEmoji = useSkin ? skinEmojis[Math.floor(Math.random() * skinEmojis.length)] : undefined;

    return {
      id: `srv-bot-${id}`,
      roomId,
      displayName: `[BOT] ${name}`,
      segments: Array.from({ length: 15 }, (_, i) => ({ x: x - i * 5, y })),
      isAlive: true,
      spawnTime: Date.now(),
      angle: Math.random() * Math.PI * 2,
      color1: `hsl(${Math.random() * 360}, 70%, 50%)`,
      color2: `hsl(${Math.random() * 360}, 70%, 30%)`,
      skinEmoji: selectedEmoji
    } as any;
  }

  // Bot update loop
  setInterval(() => {
    for (const [roomId, room] of rooms.entries()) {
      if (!room.bots) room.bots = [];
      
        // Only maintain bots in non-private rooms
        const isPrivateRoom = roomId.startsWith('private_');
        const isWagerRoom = room.mode === 'wager';
        const isCTFRoom = room.mode === 'ctf';
        
        if (isPrivateRoom || isWagerRoom || isCTFRoom) {
          // Clear any existing bots in private, wager, or CTF rooms
          if (room.bots.length > 0) {
            room.bots.forEach(bot => {
              io.to(roomId).emit("player_left", { id: bot.id });
            });
            room.bots = [];
          }
          continue;
        }
        
        // Maintain 20 bots per room for common arenas
        const targetBots = 20; 
        while (room.bots.length < targetBots) {
          const newBot = createServerBot(roomId, Math.random().toString(36).substr(2, 5));
          room.bots.push(newBot);
          // Broadcast joining
          io.to(roomId).emit("player_joined", { 
            id: newBot.id, 
            displayName: newBot.displayName,
            skinEmoji: (newBot as any).skinEmoji,
            color1: (newBot as any).color1,
            color2: (newBot as any).color2,
            isBot: true
          });
        }

        room.bots.forEach(bot => {
          if (!bot.isAlive) {
            // Respawn after a delay
            if (Math.random() > 0.95) {
              const index = room.bots.indexOf(bot);
              const newBot = createServerBot(roomId, Math.random().toString(36).substr(2, 5));
              room.bots[index] = newBot;
              io.to(roomId).emit("player_joined", { 
                id: newBot.id, 
                displayName: newBot.displayName,
                skinEmoji: (newBot as any).skinEmoji,
                color1: (newBot as any).color1,
                color2: (newBot as any).color2,
                isBot: true
              });
            }
            return;
          }

          // Simple movement
          const head = bot.segments[0];
          const speed = 150;
          const dt = 0.05; 

          // Randomly change angle
          if (Math.random() > 0.95) {
            (bot as any).targetAngle = Math.random() * Math.PI * 2;
          }
          
          if ((bot as any).targetAngle !== undefined) {
            let diff = (bot as any).targetAngle - bot.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            bot.angle += diff * 0.15;
          }

          const newX = head.x + Math.cos(bot.angle) * speed * dt;
          const newY = head.y + Math.sin(bot.angle) * speed * dt;

          // Wall bounce
          if (newX < 50 || newX > WORLD_W - 50 || newY < 50 || newY > WORLD_H - 50) {
            bot.angle += Math.PI / 2;
          }

          bot.segments.unshift({ x: newX, y: newY });
          // Grow slowly or keep length based on "points" (which we don't track explicitly yet, but let's give them 30-100 segments)
          const maxLength = (bot as any).maxLength || 45;
          if (bot.segments.length > maxLength) bot.segments.pop();

          // Server-side collision for BOT vs Player and BOT vs BOT
          let hasDied = false;
          const now = Date.now();
          const isInvulnerable = now - (bot.spawnTime || 0) < 2000;

          if (!isInvulnerable) {
            // Vs Players
            for (const [pId, player] of room.players.entries()) {
              if (!player.isAlive) continue;
              for (const seg of player.segments) {
                const dist = Math.sqrt((newX - seg.x)**2 + (newY - seg.y)**2);
                if (dist < CELL) {
                  hasDied = true;
                  break;
                }
              }
              if (hasDied) break;
            }

            // Vs Other Bots
            if (!hasDied) {
              for (const otherBot of room.bots) {
                if (otherBot.id === bot.id || !otherBot.isAlive) continue;
                for (const seg of otherBot.segments) {
                  const dist = Math.sqrt((newX - seg.x)**2 + (newY - seg.y)**2);
                  if (dist < CELL) {
                    hasDied = true;
                    break;
                  }
                }
                if (hasDied) break;
              }
            }
          }

          if (hasDied) {
            bot.isAlive = false;
            const segments = bot.segments;
            const totalValue = segments.length;

            io.to(roomId).emit("player_died", { 
              id: bot.id, 
              killerName: "Obstáculo",
              segments: segments,
              wager: totalValue // 1 point per segment rule
            });

            // Drop food in Firestore for bot death (Server-side 1:1)
            // USER REQUEST: Remove random coins in global competition (wager mode)
            // So we skip coin drops for bots in wager mode.
            if (room.mode !== 'wager') {
              const dropFrequency = 5;
              const collectionName = 'arenaFood';

              for (let i = 0; i < segments.length; i += dropFrequency) {
                const seg = segments[i];
                db.collection(collectionName).add({
                  x: seg.x,
                  y: seg.y,
                  value: dropFrequency, 
                  serverId: roomId,
                  type: 'dropped',
                  color: (bot as any).color1 || '#ffffff',
                  timestamp: FieldValue.serverTimestamp(),
                }).catch(() => {});
              }
            }
            return;
          }

          // Broadcast bot position
          io.to(roomId).emit("player_moved", {
            id: bot.id,
            segments: bot.segments,
            angle: bot.angle,
            displayName: bot.displayName,
            color1: (bot as any).color1,
            color2: (bot as any).color2,
            skinEmoji: (bot as any).skinEmoji,
            isAlive: bot.isAlive,
            isBot: true
          });
        });
      }
    }, 50);

  function getAvailableRoom() {
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.size < MAX_PLAYERS_PER_ROOM) {
        return roomId;
      }
    }
    const newRoomId = `room_${Date.now()}`;
    rooms.set(newRoomId, { players: new Map(), bots: [] });
    return newRoomId;
  }

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("join_arena", async (userData) => {
      let roomId = userData.serverId;
      
      // Auto-assign CTF room if none provided
      if (!roomId && userData.mode === 'ctf') {
        for (const [rId, r] of rooms.entries()) {
          if (r.mode === 'ctf' && r.wager === userData.wager && r.players.size < 4 && r.status === 'waiting') {
            roomId = rId;
            break;
          }
        }
        
        if (!roomId) {
          roomId = `ctf_${Math.random().toString(36).substring(2, 10)}`;
          const newRoom: any = {
            id: roomId,
            players: new Map(),
            bots: [],
            mode: 'ctf',
            status: 'waiting',
            wager: userData.wager || 0,
            flags: initCTFFlags(),
            createdAt: Date.now()
          };
          rooms.set(roomId, newRoom);
          
          // Basic persistence for room discovery
          db.collection('ctf_rooms').doc(roomId).set({
            betAmount: userData.wager || 0,
            status: 'waiting',
            createdAt: FieldValue.serverTimestamp()
          }).catch(() => {});
        }
      } else if (!roomId) {
        roomId = getAvailableRoom();
      }

      let room = rooms.get(roomId);
      if (!room) {
        room = { 
          players: new Map(), 
          bots: [], 
          mode: userData.mode || 'points',
          status: 'waiting',
          wager: userData.wager || 0
        };
        if (userData.mode === 'ctf') {
          room.flags = initCTFFlags();
        }
        rooms.set(roomId, room);
      }
      
      if (userData.id) {
        userSockets.set(userData.id, socket.id);
        (socket as any).userId = userData.id;
      }

      // Corner assignment for CTF
      let cornerIndex = -1;
      if (room.mode === 'ctf') {
        const occupied = Array.from(room.players.values()).map((p: any) => p.corner);
        const order = [0, 3, 2, 1]; // Rojo, Blanco, Azul, Verde
        for (const i of order) {
          if (!occupied.includes(i)) {
            cornerIndex = i;
            break;
          }
        }
      }
      
      const newPlayer: Player = {
        id: socket.id,
        userId: userData.id,
        roomId,
        displayName: userData.displayName || "Invitado",
        segments: [],
        isAlive: true,
        spawnTime: Date.now(),
        angle: 0,
        wager: userData.wager || 0,
        hasAura: userData.hasAura,
        auraType: userData.auraType,
        color1: userData.color1 || (cornerIndex !== -1 ? COLORS[cornerIndex] : undefined),
        color2: userData.color2,
        skinEmoji: userData.skinEmoji,
        tailEmoji: userData.tailEmoji,
        corner: cornerIndex,
        hasFlag: null,
        isEliminated: false
      };

      socket.join(roomId);
      room.players.set(socket.id, newPlayer);
      
      // Activate flag for the joined corner
      if (room.mode === 'ctf' && room.flags && cornerIndex !== -1) {
        room.flags[cornerIndex].active = true;
      }
      
      console.log(`User ${socket.id} joined ${roomId} (Corner: ${cornerIndex}). Players: ${room.players.size}`);
      
      // NEW: Trigger game start when 4 players are reached
      if (room.mode === 'ctf' && room.players.size === 4 && room.status === 'waiting') {
        room.status = 'playing';
        io.to(roomId).emit("ctf_game_start", { status: 'playing' });
        
        // Update persistence
        db.collection('ctf_rooms').doc(roomId).update({
          status: 'playing'
        }).catch(() => {});
      }
      
      io.to(roomId).emit("player_joined", { 
        id: socket.id, 
        displayName: newPlayer.displayName,
        playersCount: room.players.size,
        corner: newPlayer.corner,
        color1: newPlayer.color1,
        skinEmoji: newPlayer.skinEmoji
      });

      socket.emit("joined_room", { 
        roomId,
        playersCount: room.players.size,
        flags: room.flags,
        corner: newPlayer.corner,
        status: room.status
      });
    });

    socket.on("update_position", (data) => {
      const roomEntry = Array.from(rooms.values()).find(r => r.players.has(socket.id));
      if (!roomEntry) return;
      const player = roomEntry.players.get(socket.id);
      if (!player || !player.isAlive || player.isEliminated) return;
      
      const roomId = player.roomId;
      const room = rooms.get(roomId);
      if (!room) return;

      // Update basic state
      player.segments = data.segments || [];
      player.angle = data.angle;
      player.isBoosting = data.isBoosting;
      player.wager = data.wager || player.wager;
      
      const head = player.segments[0];
      if (!head) return;

      const now = Date.now();
      const isInvulnerable = now - player.spawnTime < 2500;

      // Carry flag logic
      if (room.mode === 'ctf' && player.hasFlag !== null && room.flags) {
        const flag = room.flags[player.hasFlag];
        if (flag) {
          flag.x = head.x;
          flag.y = head.y;
        }
      }

      // Collision logic
      if (!isInvulnerable) {
        for (const [otherId, other] of room.players.entries()) {
          if (otherId === socket.id || !other.isAlive || other.isEliminated) continue;
          
          // Tail collision (Head vs Body)
          for (const seg of other.segments) {
            const dx = head.x - seg.x;
            const dy = head.y - seg.y;
            if (Math.sqrt(dx * dx + dy * dy) < CELL) {
              
              // If CTF mode, check if we simply steal or both die
              if (room.mode === 'ctf') {
                 // In CTF, if you hit a body, you drop your flag and die
                 if (player.hasFlag !== null && room.flags) {
                    const fIdx = player.hasFlag;
                    room.flags[fIdx].carrierId = null;
                    player.hasFlag = null;
                    io.to(roomId).emit("ctf_flag_update", { flags: room.flags });
                 }
              }

              player.isAlive = false;
              socket.emit("server_death", { killerName: other.displayName });
              io.to(roomId).emit("player_died", { 
                id: socket.id, 
                killerName: other.displayName,
                wager: player.wager,
                segments: player.segments
              });
              return;
            }
          }

          // CTF Theft Logic: If my head touches someone who has a flag, I steal it
          if (room.mode === 'ctf' && other.hasFlag !== null && player.hasFlag === null) {
             const d = Math.sqrt((head.x - other.segments[0].x)**2 + (head.y - other.segments[0].y)**2);
             if (d < CELL * 2) {
                const flagIndex = other.hasFlag;
                room.flags![flagIndex].carrierId = socket.id;
                player.hasFlag = flagIndex;
                other.hasFlag = null;
                io.to(roomId).emit("ctf_flag_update", { flags: room.flags });
             }
          }
        }
      }

      // Broadcast position to others
      socket.to(roomId).emit("player_moved", {
        id: socket.id,
        hasAura: player.hasAura,
        auraType: player.auraType,
        ...data
      });
    });

    socket.on("ctf_pickup", ({ flagIndex }) => {
      const player = Array.from(rooms.values()).find(r => r.players.has(socket.id))?.players.get(socket.id);
      if (!player || !player.roomId || player.isEliminated) return;
      const room = rooms.get(player.roomId);
      if (!room || !room.flags || !room.flags[flagIndex]) return;

      const flag = room.flags[flagIndex];
      
      // NEW: Check if the flag owner is in the room and not eliminated
      const ownerExists = Array.from(room.players.values()).some(p => p.corner === flag.ownerCorner && !p.isEliminated);
      if (!ownerExists) {
        console.log(`[CTF] Flag ${flagIndex} pickup denied: owner not in arena.`);
        return;
      }

      if (flag.carrierId === null && flag.ownerCorner !== player.corner && player.hasFlag === null) {
        flag.carrierId = socket.id;
        player.hasFlag = flagIndex;
        io.to(player.roomId).emit("ctf_flag_update", { flags: room.flags });
      }
    });

    socket.on("ctf_score", async ({ flagIndex }) => {
      const player = Array.from(rooms.values()).find(r => r.players.has(socket.id))?.players.get(socket.id);
      if (!player || !player.roomId || player.hasFlag !== flagIndex) return;
      const room = rooms.get(player.roomId);
      if (!room || !room.flags) return;

      const flag = room.flags[flagIndex];
      const flagOwnerCorner = flag.ownerCorner;
      
      // Find the player who owns this flag to eliminate them
      const victimEntry = Array.from(room.players.entries()).find(([_, p]) => p.corner === flagOwnerCorner);
      if (victimEntry) {
        const [vSocketId, vPlayer] = victimEntry;
        vPlayer.isEliminated = true;
        
        // Deactivate flag
        flag.active = false;
        
        io.to(player.roomId).emit("ctf_player_eliminated", { id: vPlayer.userId, socketId: vSocketId });
        
        // Update Firestore
        db.collection('ctf_rooms').doc(player.roomId).update({
          [`players.${vPlayer.userId}.isEliminated`]: true
        }).catch((e) => {
          console.error(`Error updating ctf_room ${player.roomId}:`, e);
        });
      }

      // Reset flag
      flag.carrierId = null;
      flag.x = CORNERS[flag.ownerCorner].x;
      flag.y = CORNERS[flag.ownerCorner].y;
      player.hasFlag = null;

      io.to(player.roomId).emit("ctf_flag_update", { flags: room.flags });
      io.to(player.roomId).emit("ctf_score", { 
        scorerId: player.userId, 
        flagOwnerCorner: flag.ownerCorner,
        reward: room.wager || 0 
      });

      if (player.userId) {
        try {
          await db.collection('users').doc(player.userId).update({
            monedas: admin.firestore.FieldValue.increment((room.wager || 0) * 2)
          });
        } catch (e) { 
          console.error(`Score reward err for user ${player.userId}:`, e);
          if (e instanceof Error) {
            console.error("Stack:", e.stack);
          }
        }
      }
    });

    socket.on("ctf_steal", ({ victimId }) => {
      const thief = Array.from(rooms.values()).find(r => r.players.has(socket.id))?.players.get(socket.id);
      if (!thief || thief.hasFlag !== null) return;
      const room = rooms.get(thief.roomId);
      const victim = room?.players.get(victimId);
      if (!victim || victim.hasFlag === null) return;

      const flagIdx = victim.hasFlag;
      victim.hasFlag = null;
      thief.hasFlag = flagIdx;
      room!.flags![flagIdx].carrierId = thief.id;
      
      io.to(thief.roomId).emit("ctf_flag_update", { flags: room!.flags });
    });

    socket.on("player_died", (data) => {
      const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
      if (!roomId) return;
      
      const room = rooms.get(roomId);
      if (room) {
        const player = room.players.get(socket.id);
        if (player) {
          player.isAlive = false;
        }
      }
      
      // Broadcast death to others
      socket.to(roomId).emit("player_died", {
        id: socket.id,
        killerName: data.killerName || "Obstáculo",
        wager: data.wager,
        segments: data.segments
      });
    });


    socket.on("disconnecting", () => {
      socket.rooms.forEach(roomId => {
        const room = rooms.get(roomId);
        if (room) {
          room.players.delete(socket.id);
          socket.to(roomId).emit("player_left", { id: socket.id });
          
          if (room.players.size === 0) {
            rooms.delete(roomId);
          }
        }
      });
    });

    socket.on("disconnect", () => {
      const userId = (socket as any).userId;
      if (userId && userSockets.get(userId) === socket.id) {
        userSockets.delete(userId);
      }
      
      rooms.forEach((room, roomId) => {
        if (room.players.has(socket.id)) {
          const player = room.players.get(socket.id);
          room.players.delete(socket.id);
          
          if (room.mode === 'wager' || room.mode === 'points' || room.mode === 'ctf') {
            const roomRef = db.collection(room.mode === 'ctf' ? 'ctf_rooms' : (room.mode === 'wager' ? 'wager_rooms' : 'private_rooms')).doc(roomId);
            roomRef.update({
              [`players.${(player as any).userId}`]: FieldValue.delete()
            }).catch(() => {});

            if (room.mode === 'ctf' && room.flags) {
              const flagIndex = (player as any).hasFlag;
              if (flagIndex !== null && room.flags[flagIndex]) {
                room.flags[flagIndex].carrierId = null;
              }
              
              const myCorner = (player as any).corner;
              if (myCorner !== -1 && room.flags[myCorner]) {
                room.flags[myCorner].active = false;
              }
              
              io.to(roomId).emit("ctf_flag_update", { flags: room.flags });
            }
          }
          
          if (room.players.size === 0 && room.bots.length === 0) {
            rooms.delete(roomId);
          } else {
            // Update flags based on remaining players
            if (room.mode === 'ctf' && room.flags) {
              room.flags.forEach((f, i) => {
                const owner = Array.from(room.players.values()).find((p: any) => p.corner === i);
                if (!owner) {
                  f.active = false;
                  f.carrierId = null;
                }
              });
              io.to(roomId).emit("ctf_flag_update", { flags: room.flags });
            }
            io.to(roomId).emit("player_left", { id: socket.id });
          }
        }
      });

      console.log(`User disconnected: ${socket.id}`);
    });
  });

  // NEW: Broadcast CTF lobby counts to all clients every 2 seconds
  setInterval(() => {
    const ctfWagers = [1000, 2500, 5000, 10000, 20000];
    const counts: Record<number, number> = {};
    
    ctfWagers.forEach(w => {
      // Find the room that is currently "waiting" for this wager
      let totalWaiting = 0;
      for (const room of rooms.values()) {
        if (room.mode === 'ctf' && room.wager === w && room.status === 'waiting') {
          totalWaiting = Math.max(totalWaiting, room.players.size);
        }
      }
      counts[w] = totalWaiting;
    });
    
    io.emit("ctf_lobby_counts", counts);
  }, 2000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'build');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
