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
  }

  const rooms = new Map<string, { players: Map<string, Player>; bots: Player[] }>();
  const CELL = 24;
  const WORLD_W = 3000;
  const WORLD_H = 3000;

  // Mercado Pago Configuration
  const client = process.env.MP_ACCESS_TOKEN 
    ? new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
    : null;

  // 🛡️ Firestore Bridge: Listen for payments from external Google Cloud services
  // This allows processing payments even if webhooks don't reach this app directly
  function setupFirestoreBridge() {
    console.log("[BRIDGE] Setting up Firestore Payment Bridge...");
    const paymentsRef = db.collection('payment_notifications');
    
    // Listen for new documents in 'payment_notifications'
    // This allows an external Cloud Function to "bridge" MP webhooks to this app
    paymentsRef.where('processed', '==', false).limit(10).onSnapshot(async (snapshot) => {
      if (snapshot.empty) return;
      
      console.log(`[BRIDGE] Detected ${snapshot.size} unprocessed payment notifications in Firestore.`);
      
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const notificationId = doc.id;
        const mpPaymentId = data.payment_id || data.id;

        if (!mpPaymentId || !client) continue;

        try {
          console.log(`[BRIDGE] Processing notification ${notificationId} (Payment ID: ${mpPaymentId})`);
          const payment = new Payment(client);
          const paymentData = await payment.get({ id: String(mpPaymentId) });
          
          if (paymentData.status === 'approved') {
            const success = await processApprovedPayment(String(mpPaymentId), paymentData);
            await doc.ref.update({ 
              processed: true, 
              success: success, 
              processedAt: FieldValue.serverTimestamp(),
              status: paymentData.status
            });
          } else {
            console.log(`[BRIDGE] Payment ${mpPaymentId} not approved yet (${paymentData.status}).`);
            // We don't mark as processed if not approved, unless it's a terminal failure
            if (['cancelled', 'rejected', 'refunded'].includes(paymentData.status)) {
              await doc.ref.update({ 
                processed: true, 
                success: false, 
                processedAt: FieldValue.serverTimestamp(),
                status: paymentData.status
              });
            }
          }
        } catch (err) {
          console.error(`[BRIDGE] Error processing ${notificationId}:`, err);
          await doc.ref.update({ 
            error: err instanceof Error ? err.message : String(err),
            lastAttempt: FieldValue.serverTimestamp()
          });
        }
      }
    }, (err) => {
      console.error("[BRIDGE] Firestore Listener Error:", err);
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
      
      // Use the canonical URL provided for payment notifications (Google Cloud Run/Production)
      // or default to current host. Mercado Pago requires HTTPS.
      const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || `https://${actualHost}`;
      const notificationUrl = isLocal && !process.env.WEBHOOK_BASE_URL ? undefined : `${webhookBaseUrl}/api/webhook`;

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

  // Helper to process approved payments
  async function processApprovedPayment(paymentId: string, data: any) {
    console.log(`[PAYMENT_PROCESSOR] Examining payment ${paymentId}. Status: ${data.status}`);
    
    if (data.status !== 'approved') {
      console.log(`[PAYMENT_PROCESSOR] Payment ${paymentId} is not approved (${data.status}). Skipping.`);
      return false;
    }

    // Mercado Pago can send metadata in different places
    const metadata = data.metadata || {};
    const userId = metadata.user_id || data.external_reference; // Fallback to external_reference
    const amount = Number(metadata.coins_amount || 0);
    const purchaseType = metadata.purchase_type || 'monedas';
    const pointsToAdd = Number(metadata.points_to_add || 0);

    console.log(`[PAYMENT_PROCESSOR] Extracted Info: userId=${userId}, amount=${amount}, type=${purchaseType}, metadata Keys: ${Object.keys(metadata)}`);

    if (!userId) {
      console.error("[PAYMENT_PROCESSOR] ERROR: No userId found in payment data. Cannot credit balance.");
      return false;
    }

    if (amount <= 0 && pointsToAdd <= 0) {
      console.error("[PAYMENT_PROCESSOR] ERROR: Amount is 0 or invalid. Check metadata fields.");
      // We don't return false here to allow logs to be marked as "processed" but with errors
    }
    
    // 1. Check if this payment was already processed to prevent double crediting
    const paymentRef = db.collection('processed_payments').doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (paymentDoc.exists) {
      console.log(`Payment ${paymentId} already processed. Skipping.`);
      return true; // Already processed is a success
    }

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
        });
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
        console.error("Error fetching Supabase profile:", profileError);
      } else if (profile) {
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
        
        if (updateError) console.error("Error updating Supabase profile:", updateError);
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
          
          if (data.status === 'approved') {
            const success = await processApprovedPayment(paymentId, data);
            
            // Mark as processed in Firestore logs
            if (logRef) {
              await logRef.update({ 
                processed: true, 
                approved: true, 
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
      
      if (data.status === 'approved') {
        const success = await processApprovedPayment(paymentId, data);
        const metadata = data.metadata || {};
        return res.json({ 
          success, 
          status: data.status, 
          already_processed: !success,
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
      
      // Only maintain bots in non-wager and non-private rooms
      const isWagerRoom = roomId.startsWith('wager_') || 
                         roomId.startsWith('basica_') || 
                         roomId.startsWith('pro_') || 
                         roomId.startsWith('millonario_');
      const isPrivateRoom = roomId.startsWith('private_');
      
      if (isWagerRoom || isPrivateRoom) {
        // Clear any existing bots in wager rooms
        if (room.bots.length > 0) {
          room.bots.forEach(bot => {
            io.to(roomId).emit("player_left", { id: bot.id });
          });
          room.bots = [];
        }
        continue;
      }
      
      // Maintain 10 bots per room for normal arena
      while (room.bots.length < 10) {
        room.bots.push(createServerBot(roomId, Math.random().toString(36).substr(2, 5)));
      }

      room.bots.forEach(bot => {
        if (!bot.isAlive) {
          // Respawn after a delay
          if (Math.random() > 0.98) {
            const index = room.bots.indexOf(bot);
            room.bots[index] = createServerBot(roomId, Math.random().toString(36).substr(2, 5));
          }
          return;
        }

        // Simple movement
        const head = bot.segments[0];
        const speed = 100;
        const dt = 0.05; // 20fps approx

        // Randomly change angle
        if (Math.random() > 0.95) {
          (bot as any).targetAngle = Math.random() * Math.PI * 2;
        }
        
        if ((bot as any).targetAngle !== undefined) {
          let diff = (bot as any).targetAngle - bot.angle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          bot.angle += diff * 0.1;
        }

        const newX = head.x + Math.cos(bot.angle) * speed * dt;
        const newY = head.y + Math.sin(bot.angle) * speed * dt;

        // Wall bounce
        if (newX < 50 || newX > WORLD_W - 50 || newY < 50 || newY > WORLD_H - 50) {
          bot.angle += Math.PI / 2;
        }

        bot.segments.unshift({ x: newX, y: newY });
        if (bot.segments.length > 60) bot.segments.pop();

        // Broadcast bot position
        io.to(roomId).emit("player_moved", {
          id: bot.id,
          segments: bot.segments,
          angle: bot.angle,
          displayName: bot.displayName,
          color1: (bot as any).color1,
          color2: (bot as any).color2,
          skinEmoji: (bot as any).skinEmoji,
          isAlive: bot.isAlive
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

    socket.on("join_arena", (userData) => {
      const roomId = userData.serverId || getAvailableRoom();
      let room = rooms.get(roomId);
      
      if (!room) {
        room = { players: new Map(), bots: [] };
        rooms.set(roomId, room);
      }
      
      const newPlayer: Player = {
        id: socket.id,
        roomId,
        displayName: userData.displayName || "Invitado",
        segments: [],
        isAlive: true,
        spawnTime: Date.now(),
        angle: 0,
        wager: userData.wager || 0,
        hasAura: userData.hasAura,
        auraType: userData.auraType
      };

      socket.join(roomId);
      room.players.set(socket.id, newPlayer);
      
      console.log(`User ${socket.id} joined ${roomId}. Players: ${room.players.size}`);

      socket.emit("joined_room", { roomId, playersCount: room.players.size });
      
      socket.to(roomId).emit("player_joined", { 
        id: socket.id, 
        displayName: newPlayer.displayName,
        skin: userData.equippedSkin,
        hasAura: userData.hasAura,
        auraType: userData.auraType
      });
    });

    socket.on("update_position", (data) => {
      const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      const player = room.players.get(socket.id);
      if (!player || !player.isAlive) return;

      // Update server-side state
      player.segments = data.segments || [];
      player.wager = data.wager || player.wager;
      
      // Server-side collision detection: Head vs Other Bodies
      const head = player.segments[0];
      if (head) {
        const isInvulnerable = Date.now() - player.spawnTime < 1000;
        
        if (!isInvulnerable) {
          for (const [otherId, other] of room.players.entries()) {
            if (otherId === socket.id || !other.isAlive) continue;
            
            const otherInvulnerable = Date.now() - other.spawnTime < 1000;
            if (otherInvulnerable) continue;

            // Check head vs other's segments
            for (const seg of other.segments) {
              const dx = head.x - seg.x;
              const dy = head.y - seg.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              if (dist < CELL) {
                // Collision! Player dies
                player.isAlive = false;
                socket.emit("server_death", { killerName: other.displayName });
                socket.to(roomId).emit("player_died", { 
                  id: socket.id, 
                  killerName: other.displayName,
                  wager: player.wager,
                  segments: player.segments
                });
                return; // Stop checking for this player
              }
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
      console.log(`User disconnected: ${socket.id}`);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
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
