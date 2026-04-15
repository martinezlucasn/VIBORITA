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

// Initialize Supabase Admin (using service role if available, otherwise anon)
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

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
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const isLocal = host?.includes('localhost') || host?.includes('127.0.0.1');
      const notificationUrl = isLocal ? undefined : `${protocol}://${host}/api/webhook`;

      console.log(`Creating preference for user ${userId}, amount ${amount}, host: ${host}, url: ${notificationUrl}`);

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

  app.post("/api/webhook", async (req, res) => {
    const { query, body } = req;
    const topic = query.topic || query.type || body.type;
    const id = query.id || body.data?.id || body.id;

    console.log(`Webhook received: topic=${topic}, id=${id}`);
    
    // Log to Firestore for debugging
    try {
      await db.collection('webhook_logs').add({
        topic,
        id,
        query,
        body,
        timestamp: FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.error("Error logging webhook to Firestore:", e);
    }

    if ((topic === 'payment' || topic === 'payment.updated') && client && id) {
      const paymentId = String(id);
      
      try {
        const payment = new Payment(client);
        const data = await payment.get({ id: paymentId });

        console.log(`Payment data retrieved for ${paymentId}: status=${data.status}`);

        if (data.status === 'approved') {
          const userId = data.metadata.user_id;
          const amount = Number(data.metadata.coins_amount);
          const purchaseType = data.metadata.purchase_type || 'monedas';
          const pointsToAdd = Number(data.metadata.points_to_add || 0);

          if (!userId) {
            console.error("No userId in payment metadata");
            return res.sendStatus(200);
          }

          console.log(`Processing approved payment ${paymentId} for user ${userId}: ${amount} ${purchaseType}`);
          
          // 1. Check if this payment was already processed to prevent double crediting
          const paymentRef = db.collection('processed_payments').doc(paymentId);
          const paymentDoc = await paymentRef.get();

          if (paymentDoc.exists) {
            console.log(`Payment ${paymentId} already processed. Skipping.`);
            return res.sendStatus(200);
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
                // If user doesn't exist for some reason, create it (shouldn't happen but safe)
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
                status: 'approved'
              });
            });
          } catch (transactionError) {
            console.error("Transaction failed:", transactionError);
            throw transactionError;
          }

          // 3. Update Supabase Profile
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('monedas, coins')
            .eq('id', userId)
            .single();

          if (!profileError && profile) {
            const updates: any = {};
            if (purchaseType === 'points') {
              updates.coins = (profile.coins || 0) + pointsToAdd;
            } else {
              updates.monedas = (profile.monedas || 0) + amount;
              if (amount === 100000) {
                updates.coins = (profile.coins || 0) + 50000;
              }
            }

            await supabase
              .from('profiles')
              .update(updates)
              .eq('id', userId);
          }

          // 4. Log Transaction in Supabase
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

          console.log(`Successfully credited ${amount} ${purchaseType} to user ${userId}`);
        }
      } catch (error) {
        console.error("Error processing webhook:", error);
        return res.status(500).send("Internal Server Error");
      }
    }

    res.sendStatus(200);
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
