import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
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

const rooms = new Map<string, any>();
const userSockets = new Map<string, string>(); // userId -> socketId

const WORLD_W = 3000;
const WORLD_H = 3000;

function initCTFFlags() {
  return [
    { x: 100, y: 100, carrierId: null, ownerCorner: 0, active: false },
    { x: WORLD_W - 100, y: 100, carrierId: null, ownerCorner: 1, active: false },
    { x: 100, y: WORLD_H - 100, carrierId: null, ownerCorner: 2, active: false },
    { x: WORLD_W - 100, y: WORLD_H - 100, carrierId: null, ownerCorner: 3, active: false }
  ];
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // API endpoint for AI background music generation using Google Lyria
  app.post("/api/generate-music", async (req, res) => {
    const { type, prompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ 
        error: "La clave API de Gemini (GEMINI_API_KEY) no está configurada. Por favor, asegúrate de añadirla en los Secretos de la aplicación." 
      });
    }

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const aiClient = new GoogleGenAI({ apiKey });
      
      let generationPrompt = "";
      if (prompt) {
        generationPrompt = prompt;
      } else if (type === "menu") {
        generationPrompt = "Generate a relaxing, atmospheric, warm synth background music loop for a casual classic retro arcade style snake game. Cozy, slow tempo, 90 bpm, light melodic, looped, instrumental, electronic, pleasant and relaxing background.";
      } else { // gameplay / playing / ctf / training / wager
        generationPrompt = "Generate an addictive, energetic, fast-paced synth wave theme for a snake game. Accelerated tempo, 130 bpm, driving electronic drums, punchy retro synth bassline, high energy, immersive action game style loop, instrumental.";
      }

      console.log(`[Lyria] Generating music for type "${type || 'custom'}" with prompt: "${generationPrompt}"`);

      // Using lyria-3-clip-preview for 30-second loopable soundtracks (optimized for fast gameplay responses)
      const responseStream = await aiClient.models.generateContentStream({
        model: "lyria-3-clip-preview",
        contents: generationPrompt,
      });

      let audioBase64 = "";
      let lyrics = "";
      let mimeType = "audio/wav";

      for await (const chunk of responseStream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;

        for (const part of parts) {
          if (part.inlineData?.data) {
            if (!audioBase64 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioBase64 += part.inlineData.data;
          }
          if (part.text && !lyrics) {
            lyrics = part.text;
          }
        }
      }

      if (!audioBase64) {
        throw new Error("No se recibieron datos de audio del modelo de generación Lyria.");
      }

      console.log(`[Lyria] Music generated successfully. Length: ${audioBase64.length} chars. MimeType: ${mimeType}`);

      res.json({
        audio: audioBase64,
        mimeType,
        lyrics
      });

    } catch (error: any) {
      console.error("Error generating music with Lyria:", error);
      
      let errorMessage = "Error interno al generar la música de fondo con el modelo Lyria.";
      if (error && error.message) {
        const msg = String(error.message);
        if (msg.includes("API key not valid") || msg.includes("API_KEY_INVALID") || msg.includes("key not valid") || msg.includes("invalid api key")) {
          errorMessage = "La clave API de Gemini no es válida o no está configurada. Por favor, ve al menú de Ajustes de AI Studio (arriba a la derecha, ícono de engranaje) y añade una variable de entorno con el nombre GEMINI_API_KEY y tu clave API de Gemini válida de Google AI Studio.";
        } else if (msg.includes("quota") || msg.includes("Quota exceeded") || msg.includes("429")) {
          errorMessage = "Se ha superado la cuota de generación de música para tu clave API de Gemini o el modelo Lyria no tiene disponibilidad en este momento. Por favor, vuelve a intentarlo más tarde.";
        } else {
          // Try to parse JSON if the SDK error message is a stringed JSON
          try {
            // Some error messages from the fetch client contain a JSON string
            const jsonStart = msg.indexOf("{");
            if (jsonStart !== -1) {
              const jsonStr = msg.substring(jsonStart);
              const parsed = JSON.parse(jsonStr);
              if (parsed.error && parsed.error.message) {
                errorMessage = parsed.error.message;
              } else if (parsed.message) {
                errorMessage = parsed.message;
              }
            } else {
              errorMessage = msg;
            }
          } catch (e) {
            errorMessage = msg;
          }
        }
      } else if (error && error.statusText) {
        errorMessage = error.statusText;
      }
      
      // Clean up any double stringified errors
      if (errorMessage.includes('"message":') || errorMessage.includes('{"error":')) {
        try {
          const innerParse = JSON.parse(errorMessage.substring(errorMessage.indexOf("{")));
          if (innerParse.error && innerParse.error.message) {
            errorMessage = innerParse.error.message;
          } else if (innerParse.message) {
            errorMessage = innerParse.message;
          }
        } catch (e) {}
      }

      res.status(500).json({ 
        error: errorMessage
      });
    }
  });
  
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

  const CELL = 24;

  const CORNERS = [
    { x: 100, y: 100, name: 'Rojo' },
    { x: WORLD_W - 100, y: 100, name: 'Verde' },
    { x: 100, y: WORLD_H - 100, name: 'Azul' },
    { x: WORLD_W - 100, y: WORLD_H - 100, name: 'Blanco' }
  ];
  const COLORS = ['#ef4444', '#10b981', '#3b82f6', '#f8fafc']; // Red, Green, Blue, White

  // API Routes
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

  function getAvailableRoom(mode: string = 'points') {
    // For global arenas, use a shared common room ID first
    if (mode === 'points') return 'global_arena_points';
    if (mode === 'wager') return 'global_arena_wager';
    if (mode === 'ctf') return 'global_arena_ctf';
    
    for (const [roomId, room] of rooms.entries()) {
      if (room.mode === mode && room.players.size < MAX_PLAYERS_PER_ROOM) {
        return roomId;
      }
    }
    const newRoomId = `room_${mode}_${Date.now()}`;
    rooms.set(newRoomId, { players: new Map(), bots: [], mode });
    return newRoomId;
  }

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("join_arena", async (userData) => {
      let roomId = userData.serverId;
      const mode = userData.mode || 'points';
      
      // FORCE global rooms for points and wager if no specific private room is requested
      if (!roomId || roomId === 'undefined' || roomId === 'null') {
        const targetWager = Number(userData.wager || 0);
        if (mode === 'points') {
          roomId = 'global_arena_points';
        } else if (mode === 'wager') {
          // Separar arenas de apuestas por monto para evitar mezclas
          roomId = `global_arena_wager_${targetWager}`;
        } else if (mode === 'ctf') {
          // CTF Matchmaking determinístico
          for (let i = 1; i <= 100; i++) {
            const checkId = `ctf_${targetWager}_room_${i}`;
            const r = rooms.get(checkId);
            if (!r || (r.players.size < 4)) {
              roomId = checkId;
              break;
            }
          }
        } else {
          roomId = getAvailableRoom(mode);
        }
      }

      let room = rooms.get(roomId);
      if (!room) {
        room = { 
          players: new Map(), 
          bots: [], 
          mode: userData.mode || 'points',
          status: 'waiting',
          wager: userData.wager || 0,
          createdAt: Date.now()
        };
        if (userData.mode === 'ctf') {
          room.flags = initCTFFlags();
        }
        rooms.set(roomId, room);
      } else if (room.mode === 'ctf' && room.players.size >= 4 && !room.players.has(socket.id)) {
        // Room is full
        socket.emit("room_full", { error: "Esta arena ya está llena (máximo 4 jugadores)." });
        return;
      }
      
      if (userData.id) {
        userSockets.set(userData.id, socket.id);
        (socket as any).userId = userData.id;
      }
      (socket as any).roomId = roomId;

      // Corner assignment for CTF
      let cornerIndex = -1;
      if (room.mode === 'ctf') {
        const occupied = Array.from(room.players.values()).map((p: any) => p.corner);
        const order = [0, 3, 2, 1]; // Rojo (0), Blanco (3), Azul (2), Verde (1)
        for (const i of order) {
          if (!occupied.includes(i)) {
            cornerIndex = i;
            break;
          }
        }
        
        // Activate flag for this corner
        if (cornerIndex !== -1 && room.flags) {
          room.flags[cornerIndex].active = true;
          io.to(roomId).emit("ctf_flag_update", { flags: room.flags });
        }
      }
      
      const SEGMENT_DISTANCE = 15;
      const initialSegments = cornerIndex !== -1 ? Array.from({ length: 15 }, (_, i) => ({ 
        x: CORNERS[cornerIndex].x + (cornerIndex % 2 === 0 ? 1 : -1) * i * SEGMENT_DISTANCE, 
        y: CORNERS[cornerIndex].y 
      })) : [];

      const newPlayer: Player = {
        id: socket.id,
        userId: userData.id,
        roomId,
        displayName: userData.displayName || "Invitado",
        segments: room.mode === 'ctf' ? initialSegments : [],
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
        ...newPlayer,
        playersCount: room.players.size
      });

      socket.emit("joined_room", { 
        roomId,
        playersCount: room.players.size,
        flags: room.flags,
        corner: newPlayer.corner,
        status: room.status,
        players: Array.from(room.players.entries())
          .filter(([id]) => id !== socket.id)
          .map(([_, p]) => p)
      });
    });

    socket.on("start_ctf_early", () => {
      const roomId = (socket as any).roomId;
      const room = rooms.get(roomId);
      if (room && room.mode === 'ctf') {
        if (room.status === 'waiting') {
          room.status = 'playing';
          io.to(roomId).emit("ctf_game_start", { status: 'playing' });
          
          // Update persistence
          db.collection('ctf_rooms').doc(roomId).update({
            status: 'playing'
          }).catch(() => {});
        }
      }
    });

    socket.on("update_position", (data) => {
      const roomId = (socket as any).roomId;
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player || !player.isAlive || player.isEliminated) return;
      
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
                userId: player.userId,
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
        userId: player.userId,
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
      const ownerExists = Array.from(room.players.values()).some((p: any) => p.corner === flag.ownerCorner && !p.isEliminated);
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
      const victimEntry = Array.from(room.players.entries()).find(([_, p]) => (p as any).corner === flagOwnerCorner);
      const wagerToSteal = room.wager || 0;

      if (victimEntry) {
        const [vSocketId, vPlayer] = victimEntry as [string, any];
        
        // Inform the victim they were defeated
        io.to(vSocketId).emit("ctf_defeated", { 
          message: "¡Tu bandera ha sido capturada! Has perdido tu apuesta.",
          wagerLost: wagerToSteal
        });

        // Remove victim from room
        room.players.delete(vSocketId);
        
        // Log the elimination
        io.to(player.roomId).emit("ctf_player_eliminated", { id: vPlayer.userId, socketId: vSocketId });
        
        // Update Firestore if needed (optional since players are being cleaned up)
        db.collection('ctf_rooms').doc(player.roomId).update({
          [`players.${vPlayer.userId}.isEliminated`]: true
        }).catch(() => {});
      }

      // Reset flag to base
      flag.carrierId = null;
      flag.x = CORNERS[flag.ownerCorner].x;
      flag.y = CORNERS[flag.ownerCorner].y;
      flag.active = false; // Flag is inactive until a new player joins this corner
      player.hasFlag = null;

      io.to(player.roomId).emit("ctf_flag_update", { flags: room.flags });
      io.to(player.roomId).emit("ctf_score", { 
        scorerId: player.userId, 
        flagOwnerCorner: flag.ownerCorner,
        reward: wagerToSteal 
      });

      // Transfer money
      if (player.userId) {
        try {
          await db.collection('users').doc(player.userId).update({
            monedas: admin.firestore.FieldValue.increment(wagerToSteal)
          });
        } catch (e) { 
          console.error(`Score reward err for user ${player.userId}:`, e);
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
              [`players.${(player as any).userId || (player as any).id}`]: FieldValue.delete()
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
            io.to(roomId).emit("player_left", { id: socket.id, userId: (player as any).userId, playersCount: room.players.size });
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
      // Find the room that is currently "available" for this wager (preferring the one with most players but still having space)
      const availableRooms = Array.from(rooms.values()).filter(r => 
        r.mode === 'ctf' && 
        Number(r.wager || 0) === w && 
        r.players.size < 4
      );
      
      let bestCount = 0;
      if (availableRooms.length > 0) {
        // Prefer room with most players to encourage filling up rooms
        availableRooms.sort((a, b) => b.players.size - a.players.size);
        bestCount = availableRooms[0].players.size;
      }
      
      counts[w] = bestCount;
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
