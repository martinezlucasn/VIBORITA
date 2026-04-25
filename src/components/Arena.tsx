import React, { useEffect, useRef, useState, FormEvent } from 'react';
import { User, PlayerSession, Food, Point, ArenaItemEntity } from '../types';
import { WORLD_W, WORLD_H, BASE_SPEED, CELL, ALL_SKINS, SEGMENT_DISTANCE } from '../constants';
import { ARENA_ITEMS } from '../items';
import { doc, setDoc, deleteDoc, onSnapshot, collection, query, where, serverTimestamp, addDoc, updateDoc, increment, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Coins, ArrowLeft, Zap, LogOut, MessageSquare, Send, Users, X, Target } from 'lucide-react';
import { GoldPointIcon } from './Icons';
import { soundManager } from '../lib/sounds';
import { supabase } from '../lib/supabase';
import { ChatMessage, KillEvent } from '../types';
import { findAvailableServer } from '../lib/serverManager';
import { io, Socket } from 'socket.io-client';

interface ArenaProps {
  user: User;
  wager: number;
  onGameOver: () => void;
}

export default function Arena({ user, wager, onGameOver }: ArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(wager);
  const [isAlive, setIsAlive] = useState(true);
  const [isCollecting, setIsCollecting] = useState(false);
  const otherPlayersRef = useRef<Record<string, PlayerSession>>({});
  const interpolatedPlayersRef = useRef<Record<string, PlayerSession>>({});
  const foodsRef = useRef<Record<string, Food>>({});
  const itemsRef = useRef<Record<string, ArenaItemEntity>>({});
  const [isBoosting, setIsBoosting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [serverId, setServerId] = useState<string | null>(null);
  const [kills, setKills] = useState<KillEvent[]>([]);
  const [paymentNotice, setPaymentNotice] = useState<{ id: string; status: string; amount: number } | null>(null);
  const [finalBalance, setFinalBalance] = useState<number | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const botsRef = useRef<PlayerSession[]>([]);
  const lastTapRef = useRef<number>(0);
  const boostTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTouchBoostingRef = useRef(false);

  // Abilities state
  const [isStopped, setIsStopped] = useState(false);
  const [isAutopilot, setIsAutopilot] = useState(false);
  const [isInvulnerable, setIsInvulnerable] = useState(false);
  const [lastTeleportTime, setLastTeleportTime] = useState(0);
  const [floatingTexts, setFloatingTexts] = useState<{ id: string; x: number; y: number; text: string; color: string; opacity: number }[]>([]);
  const equippedAbilities = user.equippedAbilities || [];
  const hasZoom = equippedAbilities.includes('zoom');
  const hasMagnet = equippedAbilities.includes('magnet');
  const hasTeleport = equippedAbilities.includes('teleport');
  const hasStop = equippedAbilities.includes('stop');
  const hasAutopilot = equippedAbilities.includes('autopilot');
  
  const handleTeleport = async () => {
    if (!hasTeleport || user.coins < 250) return;
    const now = Date.now();
    if (now - lastTeleportTime < 180000) return; // 3 min

    // Cost (to saldo)
    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        coins: increment(-250)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
      return;
    }

    setLastTeleportTime(now);
    
    // Add floating text above the button
    const textId = Math.random().toString(36).substr(2, 9);
    setFloatingTexts(prev => [...prev, {
      id: textId,
      x: 20,
      y: window.innerHeight - 100,
      text: '-250 Puntos',
      color: '#fbbf24',
      opacity: 1
    }]);

    soundManager.play('star'); // Flash sound
    
    // Jump effect (invulnerability)
    setIsInvulnerable(true);
    setTimeout(() => setIsInvulnerable(false), 3000);
    
    // Find safe spot (far from other snakes)
    const newPos = {
      x: 100 + Math.random() * (WORLD_W - 200),
      y: 100 + Math.random() * (WORLD_H - 200)
    };
    
    playerRef.current.segments = playerRef.current.segments.map(() => ({ ...newPos }));
    cameraRef.current.x = newPos.x;
    cameraRef.current.y = newPos.y;
    
    // Add a flash effect on the snake (not implemented visually but invulnerability is there)
  };

  const playerRef = useRef<PlayerSession>({
    id: user.id,
    userId: user.id,
    displayName: user.displayName,
    segments: Array.from({ length: 12 }, (_, i) => ({ x: WORLD_W / 2 - i * SEGMENT_DISTANCE, y: WORLD_H / 2 })),
    angle: 0,
    wager: wager,
    isAlive: true,
    lastUpdate: Date.now(),
    spawnTime: Date.now(),
    color1: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[0] || '#22ff44',
    color2: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[1] || '#11cc33',
    skinEmoji: ALL_SKINS.find(s => s.id === user.equippedSkin)?.icon,
    hasAura: ALL_SKINS.find(s => s.id === user.equippedSkin)?.hasAura,
    auraType: ALL_SKINS.find(s => s.id === user.equippedSkin)?.auraType,
    isBoosting: false
  });

  const mouseRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cameraRef = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 });
  const initialCoinsRef = useRef(user.coins);
  const pendingFoodDeletions = useRef<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!serverId) setShowCancel(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [serverId]);

  useEffect(() => {
    const initServer = async () => {
      const id = await findAvailableServer('arenaPlayers');
      setServerId(id);
      playerRef.current.serverId = id;

      // Initialize Socket.io
      const socket = io(window.location.origin);
      socketRef.current = socket;

      socket.on("connect", () => {
        console.log("Connected to WebSocket server");
        // Use a prefix for the serverId based on category to separate players
        const categoryServerId = `basica_${id}`;
        socket.emit("join_arena", {
          id: user.id,
          displayName: user.displayName,
          equippedSkin: user.equippedSkin,
          hasAura: playerRef.current.hasAura,
          auraType: playerRef.current.auraType,
          serverId: categoryServerId,
          wager: 0,
          mode: 'points'
        });
      });

      socket.on("payment_status_update", (data) => {
        console.log("Status de pago actualizado:", data);
        setPaymentNotice(data);
        setTimeout(() => setPaymentNotice(null), 8000); // Auto close after 8s
      });

      socket.on("joined_room", ({ roomId }) => {
        console.log(`Joined WebSocket room: ${roomId}`);
      });

      socket.on("player_moved", (data) => {
        if (data.id !== user.id) {
          otherPlayersRef.current[data.id] = {
            ...data,
            lastUpdate: Date.now()
          };
        }
      });

      socket.on("player_died", ({ id, killerName }) => {
        if (id !== user.id) {
          delete otherPlayersRef.current[id];
          delete interpolatedPlayersRef.current[id];
        }
      });
    };
    initServer();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (!serverId) return;

    // 1. Initialize player in Firestore
    const playerDocRef = doc(db, 'arenaPlayers', user.id);
    setDoc(playerDocRef, { ...playerRef.current, lastUpdate: Date.now() })
      .catch(e => handleFirestoreError(e, OperationType.WRITE, 'arenaPlayers/' + user.id));

    // No bots for Arena
    botsRef.current = [];

    // Join message
    addDoc(collection(db, 'arenaChat'), {
      userId: 'system',
      displayName: 'SISTEMA',
      text: `🎮 ${user.displayName} se unió a la arena (${serverId})`,
      timestamp: Date.now(),
      serverId
    }).catch(() => {});

    // 2. Listen for other players
    const playersQuery = query(
      collection(db, 'arenaPlayers'), 
      where('isAlive', '==', true),
      where('serverId', '==', serverId)
    );
    const unsubPlayers = onSnapshot(playersQuery, (snapshot) => {
      const players: Record<string, PlayerSession> = {};
      snapshot.forEach((doc) => {
        if (doc.id !== user.id) {
          players[doc.id] = { id: doc.id, ...doc.data() } as PlayerSession;
        }
      });
      otherPlayersRef.current = players;
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaPlayers'));

      // 3. Listen for food
      const foodQuery = query(collection(db, 'arenaFood'), where('serverId', '==', serverId));
      const unsubFood = onSnapshot(foodQuery, (snapshot) => {
        const newFoods: Record<string, Food> = {};
        snapshot.forEach((doc) => {
          newFoods[doc.id] = { id: doc.id, ...doc.data() } as Food;
        });
        foodsRef.current = newFoods;

        // Base food spawning logic: Keep at least 40 items
        if (snapshot.size < 40) {
          const spawnCount = 40 - snapshot.size;
          for (let i = 0; i < spawnCount; i++) {
            addDoc(collection(db, 'arenaFood'), {
              x: Math.random() * WORLD_W,
              y: Math.random() * WORLD_H,
              value: 1,
              type: 'normal',
              color: `hsl(${Math.random() * 360}, 70%, 50%)`,
              serverId
            }).catch(() => {}); // Silently fail on quota
          }
        }
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaFood'));

    // 3.5 Listen for arena items
    const itemsQuery = query(collection(db, 'arenaItems'), where('serverId', '==', serverId));
    const unsubItems = onSnapshot(itemsQuery, (snapshot) => {
      const newItems: Record<string, ArenaItemEntity> = {};
      snapshot.forEach((doc) => {
        newItems[doc.id] = { id: doc.id, ...doc.data() } as ArenaItemEntity;
      });
      itemsRef.current = newItems;

      // Arena items spawning logic: Keep at least 8 items
      if (snapshot.size < 8) {
        const spawnCount = 8 - snapshot.size;
        for (let i = 0; i < spawnCount; i++) {
          const rand = Math.random();
          let rarity: 'common' | 'rare' | 'epic' | 'legendary' = 'common';
          if (rand > 0.98) rarity = 'legendary';
          else if (rand > 0.90) rarity = 'epic';
          else if (rand > 0.70) rarity = 'rare';

          // 20% chance for ability fragments
          const isFragmentChance = Math.random() < 0.20;
          let candidates = ARENA_ITEMS.filter(item => 
            item.rarity === rarity && 
            (isFragmentChance ? item.id.startsWith('frag_') : !item.id.startsWith('frag_'))
          );
          
          // Fallback if no fragments/items found for this rarity
          if (candidates.length === 0) {
            candidates = ARENA_ITEMS.filter(item => item.rarity === rarity);
          }
          
          const chosenItem = candidates[Math.floor(Math.random() * candidates.length)];

          addDoc(collection(db, 'arenaItems'), {
            x: Math.random() * WORLD_W,
            y: Math.random() * WORLD_H,
            itemId: chosenItem.id,
            serverId
          }).catch(() => {});
        }
      }
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaItems'));

    // 4. Listen for chat
    const chatQuery = query(
      collection(db, 'arenaChat'), 
      where('serverId', '==', serverId),
      orderBy('timestamp', 'desc'), 
      limit(50)
    );
    const unsubChat = onSnapshot(chatQuery, (snapshot) => {
      const msgs: ChatMessage[] = [];
      snapshot.forEach((doc) => {
        msgs.push({ id: doc.id, ...doc.data() } as ChatMessage);
      });
      setMessages(msgs.reverse());
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaChat'));

    // 5. Listen for online count (Server specific)
    const sixtySecondsAgo = Date.now() - 60000;
    const onlineQuery = query(
      collection(db, 'arenaPlayers'), 
      where('serverId', '==', serverId),
      where('isAlive', '==', true),
      where('lastUpdate', '>', sixtySecondsAgo)
    );
    const unsubOnline = onSnapshot(onlineQuery, (snapshot) => {
      setOnlineCount(snapshot.size);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaPlayers'));

    // 6. Listen for kills
    const killsQuery = query(
      collection(db, 'arenaKills'), 
      where('serverId', '==', serverId),
      orderBy('timestamp', 'desc'), 
      limit(5)
    );
    const unsubKills = onSnapshot(killsQuery, (snapshot) => {
      const k: KillEvent[] = [];
      snapshot.forEach((doc) => {
        k.push({ id: doc.id, ...doc.data() } as KillEvent);
      });
      setKills(k);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaKills'));

    // 7. Supabase Realtime for high-frequency updates
    const channel = supabase.channel(`arena_updates_${serverId}`, {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    channel
      .on('broadcast', { event: 'player_update' }, ({ payload }) => {
        if (payload.id !== user.id) {
          // Store the update. We'll interpolate in the loop.
          otherPlayersRef.current[payload.id] = {
            ...payload,
            lastUpdate: Date.now()
          };
        }
      })
      .subscribe();

    // 8. Game Loop
    let lastTime = performance.now();
    let frameCount = 0;

    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (isAlive && playerRef.current.isAlive) {
        updatePlayer(dt);
        
        checkCollisions(dt);
        
        // Smooth other players movement locally (Interpolation)
        (Object.values(otherPlayersRef.current) as PlayerSession[]).forEach(target => {
          if (!target.segments || target.segments.length === 0) return;
          
          if (!interpolatedPlayersRef.current[target.id]) {
            interpolatedPlayersRef.current[target.id] = JSON.parse(JSON.stringify(target));
            return;
          }

          const current = interpolatedPlayersRef.current[target.id];
          // Interpolate segments (move 15% towards target each frame)
          current.segments = target.segments.map((targetSeg, i) => {
            const currentSeg = current.segments[i] || targetSeg;
            return {
              x: currentSeg.x + (targetSeg.x - currentSeg.x) * 0.15,
              y: currentSeg.y + (targetSeg.y - currentSeg.y) * 0.15
            };
          });
          current.angle = target.angle;
          current.isBoosting = target.isBoosting;
          current.wager = target.wager;
        });
        
        // Cleanup old players from interpolated ref
        Object.keys(interpolatedPlayersRef.current).forEach(id => {
          if (!otherPlayersRef.current[id]) {
            delete interpolatedPlayersRef.current[id];
          }
        });
        
        // Broadcast update via Socket.io every 3 frames (~20 times per second)
        frameCount++;
        if (frameCount % 3 === 0) {
          if (socketRef.current?.connected) {
            socketRef.current.emit("update_position", {
              segments: playerRef.current.segments,
              angle: playerRef.current.angle,
              wager: playerRef.current.wager,
              isBoosting: playerRef.current.isBoosting,
              color1: playerRef.current.color1,
              color2: playerRef.current.color2,
              displayName: playerRef.current.displayName,
              skinEmoji: playerRef.current.skinEmoji
            });
          }
          
          // Keep Supabase as fallback or for other features if needed
          channel.send({
            type: 'broadcast',
            event: 'player_update',
            payload: {
              id: playerRef.current.id,
              segments: playerRef.current.segments,
              angle: playerRef.current.angle,
              wager: playerRef.current.wager,
              isBoosting: playerRef.current.isBoosting,
              color1: playerRef.current.color1,
              color2: playerRef.current.color2,
              displayName: playerRef.current.displayName,
              skinEmoji: playerRef.current.skinEmoji
            }
          });
        }

        // Update Firestore less frequently (every 60 frames ~ 1 second) for heartbeat/state
        if (frameCount % 60 === 0) {
          updateDoc(playerDocRef, {
            wager: playerRef.current.wager,
            lastUpdate: Date.now()
          }).catch(e => {
            const msg = e.message?.toLowerCase() || '';
            if (!msg.includes('resource-exhausted') && !msg.includes('quota-exceeded')) {
              handleFirestoreError(e, OperationType.UPDATE, 'arenaPlayers/' + user.id);
            }
          });

          // Process pending food deletions in a single burst
          if (pendingFoodDeletions.current.length > 0) {
            const deletions = [...pendingFoodDeletions.current];
            pendingFoodDeletions.current = [];
            deletions.forEach(id => {
              deleteDoc(doc(db, 'arenaFood', id)).catch(() => {});
            });
          }
        }
      }

      render();
      requestAnimationFrame(loop);
    };

    const animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      unsubPlayers();
      unsubFood();
      unsubItems();
      unsubChat();
      unsubOnline();
      unsubKills();
      channel.unsubscribe();
      // Mark as dead on cleanup
      updateDoc(playerDocRef, { isAlive: false }).catch(() => {});
    };
  }, [serverId, isAlive]);

  const updatePlayer = (dt: number) => {
    const head = playerRef.current.segments[0];
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Calculate world mouse position
    const worldMouseX = (mouseRef.current.x - canvas.width / 2) / cameraRef.current.zoom + cameraRef.current.x;
    const worldMouseY = (mouseRef.current.y - canvas.height / 2) / cameraRef.current.zoom + cameraRef.current.y;

    const dx = worldMouseX - head.x;
    const dy = worldMouseY - head.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 5) {
      const targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - playerRef.current.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      playerRef.current.angle += diff * Math.min(1, 8 * dt);
    }

    playerRef.current.isBoosting = isBoosting && playerRef.current.wager > 0;
    
    let speed = isBoosting && playerRef.current.wager > 0 ? BASE_SPEED * 2 : BASE_SPEED;
    
    // STOP ABILITY
    if (isStopped) speed = 0;

    // AUTOPILOT ABILITY
    if (isAutopilot && !isStopped) {
      let nearestTarget: {x: number, y: number} | null = null;
      let minDist = 300;
      
      // Find nearest food
      Object.values(foodsRef.current).forEach((f: any) => {
        const d = Math.sqrt((head.x - f.x) ** 2 + (head.y - f.y) ** 2);
        if (d < minDist) {
          minDist = d;
          nearestTarget = { x: f.x, y: f.y };
        }
      });

      if (nearestTarget) {
        const dxT = nearestTarget.x - head.x;
        const dyT = nearestTarget.y - head.y;
        const targetAngle = Math.atan2(dyT, dxT);
        let diff = targetAngle - playerRef.current.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        playerRef.current.angle += diff * Math.min(1, 5 * dt);
      }

      // Obstacle avoidance (walls)
      const lookAhead = 100;
      const futureX = head.x + Math.cos(playerRef.current.angle) * lookAhead;
      const futureY = head.y + Math.sin(playerRef.current.angle) * lookAhead;
      if (futureX < 50 || futureX > WORLD_W - 50 || futureY < 50 || futureY > WORLD_H - 50) {
        playerRef.current.angle += Math.PI * 0.1; // Turn away
      }
    }

    if (isBoosting && playerRef.current.wager > 0 && !isStopped) {
      playerRef.current.wager -= 0.2 * dt * 60; // Consume points over time
    }
    const newX = head.x + Math.cos(playerRef.current.angle) * speed * dt;
    const newY = head.y + Math.sin(playerRef.current.angle) * speed * dt;

    // Wall collision
    if (newX < 0 || newX > WORLD_W || newY < 0 || newY > WORLD_H) {
      if (!isInvulnerable) {
        handleDeath();
        return;
      }
    }

    const trail = playerRef.current.segments;
    if (speed > 0) {
      trail.unshift({ x: newX, y: newY });
    }

    // New growth logic: starting size (12 base segments) + 1 segment every 7 points collected
    const collectedPoints = Math.max(0, playerRef.current.wager - wager);
    const pointsPerSegment = 5; // internal visual resolution
    const baseSegments = 12;
    const targetSegments = baseSegments + Math.floor(collectedPoints / 7);
    const maxTrailLen = targetSegments * pointsPerSegment;

    if (speed > 0) {
      while (trail.length > maxTrailLen) {
        trail.pop();
      }
    }
    playerRef.current.segments = trail;

    // Update camera
    cameraRef.current.x += (head.x - cameraRef.current.x) * 0.1;
    cameraRef.current.y += (head.y - cameraRef.current.y) * 0.1;

    // Dynamic zoom based on snake length to see ~80% of it
    let targetZoomBase = Math.max(0.35, Math.min(1, 1200 / (maxTrailLen * 2 + 800)));
    // ZOOM ABILITY: increase view width by 50%
    if (hasZoom) targetZoomBase *= 0.65; 
    
    cameraRef.current.zoom += (targetZoomBase - cameraRef.current.zoom) * 0.02;

    // Update floating texts
    setFloatingTexts(prev => prev.map(ft => ({
      ...ft,
      y: ft.y - 1,
      opacity: ft.opacity - 0.02
    })).filter(ft => ft.opacity > 0));
  };

  const createBot = (index: number, sId?: string): PlayerSession => {
    const botNames = ["Sombra", "Rayo", "Cobra", "Tigre", "Lobo", "Halcón", "Jaguar", "Zorro"];
    const name = botNames[Math.floor(Math.random() * botNames.length)];
    const margin = 200;

    // 50% chance to use a random skin
    const useSkin = Math.random() > 0.5;
    const randomSkin = useSkin ? ALL_SKINS[Math.floor(Math.random() * ALL_SKINS.length)] : null;

    const startX = margin + Math.random() * (WORLD_W - margin * 2);
    const startY = margin + Math.random() * (WORLD_H - margin * 2);

    return {
      id: `bot-${index}-${Math.random().toString(36).substr(2, 5)}`,
      userId: `bot-${index}`,
      displayName: `BOT ${name}`,
      segments: Array.from({ length: 12 }, (_, j) => ({ 
        x: startX - j * SEGMENT_DISTANCE, 
        y: startY 
      })),
      angle: Math.random() * Math.PI * 2,
      wager: 5 + Math.random() * 10,
      isAlive: true,
      lastUpdate: Date.now(),
      spawnTime: Date.now(),
      color1: randomSkin ? randomSkin.colors[0] : `hsl(${Math.random() * 360}, 70%, 50%)`,
      color2: randomSkin ? randomSkin.colors[1] : `hsl(${Math.random() * 360}, 70%, 30%)`,
      skinEmoji: randomSkin ? randomSkin.icon : undefined,
      serverId: sId || serverId || 'server_1'
    };
  };

  const updateBot = (bot: PlayerSession, dt: number) => {
    const head = bot.segments[0];
    
    // Simple AI: find nearest food
    let nearestFood: Food | null = null;
    let minDist = 500; // Only look for food within 500px
    (Object.values(foodsRef.current) as Food[]).forEach(f => {
      const d = Math.sqrt((head.x - f.x) ** 2 + (head.y - f.y) ** 2);
      if (d < minDist) {
        minDist = d;
        nearestFood = f;
      }
    });

    if (nearestFood) {
      const dx = nearestFood.x - head.x;
      const dy = nearestFood.y - head.y;
      const targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - bot.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      bot.angle += diff * Math.min(1, 4 * dt);
    }

    const speed = BASE_SPEED * 0.7;
    const newX = head.x + Math.cos(bot.angle) * speed * dt;
    const newY = head.y + Math.sin(bot.angle) * speed * dt;

    // Die at walls
    if (newX < 0 || newX > WORLD_W || newY < 0 || newY > WORLD_H) {
      bot.isAlive = false;
      return;
    }

    const trail = bot.segments;
    trail.unshift({ x: newX, y: newY });

    // Bot growth follows the 1/7 rule too
    const collectedPoints = Math.max(0, bot.wager - 5); // Assuming 5 is bot starting wager
    const pointsPerSegment = 5;
    const baseSegments = 12;
    const targetSegments = baseSegments + Math.floor(collectedPoints / 7);
    const maxTrailLen = targetSegments * pointsPerSegment;

    while (trail.length > maxTrailLen) {
      trail.pop();
    }
    bot.segments = trail;
  };

  const checkCollisions = (dt: number) => {
    const head = playerRef.current.segments[0];
    let scoreChanged = false;

    // Food attraction and collision
    Object.entries(foodsRef.current).forEach(([id, food]: [string, Food]) => {
      const dx = head.x - food.x;
      const dy = head.y - food.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      
      const attractionRadius = hasMagnet ? CELL * 3 : 0;
      const collectionRadius = CELL;

      // Magnet attraction effect
      if (hasMagnet && d < attractionRadius && d > collectionRadius) {
        const pullSpeed = BASE_SPEED * 2; // Moderate speed for flight effect
        const angle = Math.atan2(dy, dx);
        food.x += Math.cos(angle) * pullSpeed * dt;
        food.y += Math.sin(angle) * pullSpeed * dt;
      }

      const currentD = Math.sqrt((head.x - food.x) ** 2 + (head.y - food.y) ** 2);
      if (currentD < collectionRadius) {
        // Add to pending deletions instead of immediate delete
        if (!pendingFoodDeletions.current.includes(id)) {
          pendingFoodDeletions.current.push(id);
        }
        
        playerRef.current.wager += food.value;
        scoreChanged = true;
        
        // Play sound
        if (food.value >= 5) {
          soundManager.play('goldFood');
        } else {
          soundManager.play('food');
        }
      }
    });

    if (scoreChanged) {
      setScore(Math.floor(playerRef.current.wager));
    }

    // Arena Items collision
    Object.entries(itemsRef.current).forEach(([id, item]: [string, ArenaItemEntity]) => {
      const d = Math.sqrt((head.x - item.x) ** 2 + (head.y - item.y) ** 2);
      if (d < CELL * 1.5) {
        // Collect item
        deleteDoc(doc(db, 'arenaItems', id)).catch(() => {});
        delete itemsRef.current[id];

        // Update user inventory
        const userRef = doc(db, 'users', user.id);
        updateDoc(userRef, {
          [`inventoryItems.${item.itemId}`]: increment(1)
        }).catch(e => console.error("Error updating inventory:", e));

        soundManager.play('plim');
      }
    });

    // Collision detection (Head vs Body)
    const isPlayerInvulnerable = (playerRef.current.spawnTime && (Date.now() - playerRef.current.spawnTime < 1500));

    // Other players collision (only head vs body)
    Object.values(otherPlayersRef.current).forEach((other: PlayerSession) => {
      if (isPlayerInvulnerable) return;
      const isOtherInvulnerable = other.spawnTime && (Date.now() - other.spawnTime < 1500);
      if (isOtherInvulnerable) return;

      other.segments.forEach((seg, i) => {
        // We only die if OUR head hits THEIR segments
        const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
        if (d < CELL) {
          // Collision detected!
          handleDeath(other.displayName);
        }
      });
    });

    // Local Bots collision
    botsRef.current.forEach(bot => {
      if (!bot.isAlive) return;
      const isBotInvulnerable = bot.spawnTime && (Date.now() - bot.spawnTime < 1500);

      // Player head vs Bot body
      if (!isPlayerInvulnerable && !isBotInvulnerable) {
        bot.segments.forEach(seg => {
          const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
          if (d < CELL) handleDeath(bot.displayName);
        });
      }

      // Bot head vs Player body
      if (!isBotInvulnerable && !isPlayerInvulnerable) {
        const botHead = bot.segments[0];
        let hasCollided = false;

        for (const seg of playerRef.current.segments) {
          // Slightly larger hitbox for player body (CELL * 1.2) to make it easier to kill bots
          const d = Math.sqrt((botHead.x - seg.x) ** 2 + (botHead.y - seg.y) ** 2);
          if (d < CELL * 1.2) {
            bot.isAlive = false;
            bot.lastUpdate = Date.now(); // Mark death time
            hasCollided = true;
            
            // Increment bot kills for the player
            if (user?.id) {
              const userRef = doc(db, 'users', user.id);
              updateDoc(userRef, {
                botKills: increment(1)
              }).catch((e) => console.error("Error updating bot kills:", e));

              // Add to kill feed for visual feedback
              addDoc(collection(db, 'arenaKills'), {
                killerName: user.displayName,
                victimName: bot.displayName,
                timestamp: Date.now(),
              }).catch(() => {});
            }
            break;
          }
        }

        if (hasCollided) {
          // Drop food along segments
          const segments = bot.segments;
          const totalValue = segments.length;
          const valuePerSegment = 1;
          
          // Drop food every 5 segments to avoid too many writes
          const dropFrequency = 5;
          for (let i = 0; i < segments.length; i += dropFrequency) {
            const s = segments[i];
            const val = valuePerSegment * dropFrequency;
            if (val > 0) {
              addDoc(collection(db, 'arenaFood'), {
                x: s.x,
                y: s.y,
                value: val,
                type: 'dropped',
                color: bot.color1,
                serverId
              }).catch(() => {});
            }
          }
        }
      }
    });

    // Respawn bots locally ONLY if NOT connected to a server
    if (!serverId && botsRef.current.filter(b => b.isAlive).length < 5) {
      if (Math.random() > 0.99) {
        botsRef.current.push(createBot(botsRef.current.length));
      }
    }
  };

  const handleDeath = async (killerName?: string) => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    playerRef.current.isAlive = false;
    
    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    soundManager.play('death');
    soundManager.stopBoost();

    if (killerName) {
      await addDoc(collection(db, 'arenaKills'), {
        killerName,
        victimName: user.displayName,
        timestamp: Date.now(),
        serverId
      }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'arenaKills'));

      // Automatic chat message for the kill
      await addDoc(collection(db, 'arenaChat'), {
        userId: 'system',
        displayName: 'SISTEMA',
        text: `💀 ${killerName} eliminó a ${user.displayName}`,
        timestamp: Date.now(),
        serverId
      }).catch(() => {});
    }
    
    const finalScore = Math.floor(playerRef.current.wager);
    const playerDocRef = doc(db, 'arenaPlayers', user.id);
    await updateDoc(playerDocRef, { isAlive: false })
      .catch(e => handleFirestoreError(e, OperationType.UPDATE, 'arenaPlayers/' + user.id));

    // Player drops NOTHING in "jugar por puntos" / Arena Mode
    // Removed food dropping logic here

    // Update user highScore
    const userRef = doc(db, 'users', user.id);
    const earnings = Math.floor(Math.max(0, playerRef.current.wager - wager));
    
    await updateDoc(userRef, {
      coins: increment(earnings),
      highScore: Math.max(user.highScore, finalScore)
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

    // Sync with Supabase
    await supabase.from('profiles').update({
      coins: user.coins + earnings,
      high_score: Math.max(user.highScore, finalScore)
    }).eq('id', user.id);

    // Record transaction
    if (earnings > 0) {
      await supabase.from('transactions').insert({
        user_id: user.id,
        type: 'collected',
        currency: 'coins',
        amount: earnings,
        reason: 'game_win',
        timestamp: new Date().toISOString()
      });
    } else if (wager > 0) {
      await supabase.from('transactions').insert({
        user_id: user.id,
        type: 'lost',
        currency: 'coins',
        amount: wager,
        reason: 'game_loss',
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleCollect = async () => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    setIsCollecting(true);
    playerRef.current.isAlive = false;

    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    soundManager.play('collect');
    soundManager.stopBoost();

    const finalScore = Math.floor(playerRef.current.wager);
    const earnings = Math.floor(Math.max(0, playerRef.current.wager - wager));
    const playerDocRef = doc(db, 'arenaPlayers', user.id);
    await updateDoc(playerDocRef, { isAlive: false })
      .catch(e => handleFirestoreError(e, OperationType.UPDATE, 'arenaPlayers/' + user.id));

    // Update user coins (credit entire score)
    const userRef = doc(db, 'users', user.id);
    const newBalance = user.coins + finalScore;
    setFinalBalance(newBalance);

    await updateDoc(userRef, {
      coins: increment(finalScore),
      highScore: Math.max(user.highScore, finalScore)
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

    // Sync with Supabase
    await supabase.from('profiles').update({
      coins: user.coins + finalScore,
      high_score: Math.max(user.highScore, finalScore)
    }).eq('id', user.id);

    // Record transaction
    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'collected',
      currency: 'coins',
      amount: finalScore,
      reason: 'game_collect',
      timestamp: new Date().toISOString()
    });
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !serverId) return;

    const msg = chatInput.trim();
    setChatInput('');

    await addDoc(collection(db, 'arenaChat'), {
      userId: user.id,
      displayName: user.displayName,
      text: msg,
      timestamp: Date.now(),
      serverId
    }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'arenaChat'));
  };

  useEffect(() => {
    if (isBoosting && isAlive) {
      soundManager.startBoost();
    } else {
      soundManager.stopBoost();
    }
  }, [isBoosting, isAlive]);

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#05070a'; // Darker neon background
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);
    ctx.translate(-cameraRef.current.x, -cameraRef.current.y);

    // Neon Grid
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let y = 0; y <= WORLD_H; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }

    // Neon Border
    ctx.strokeStyle = '#00f2ff';
    ctx.lineWidth = 8;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#00f2ff';
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
    ctx.shadowBlur = 0;

    // Draw Food
    Object.values(foodsRef.current).forEach((f: Food) => {
      ctx.fillStyle = f.color || '#ff3344';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Subtle neon glow for special food
      if (f.value > 1) {
        ctx.strokeStyle = f.color || '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    // Draw Arena Items
    Object.values(itemsRef.current).forEach((item: ArenaItemEntity) => {
      const itemDef = ARENA_ITEMS.find(i => i.id === item.itemId);
      if (!itemDef) return;

      ctx.save();
      ctx.translate(item.x, item.y);

      // Draw semi-transparent box
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      const boxSize = 34;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(-boxSize / 2, -boxSize / 2, boxSize, boxSize, 8);
      } else {
        ctx.rect(-boxSize / 2, -boxSize / 2, boxSize, boxSize);
      }
      ctx.fill();
      ctx.stroke();

      if (itemDef.type === 'color') {
        ctx.fillStyle = itemDef.value;
        ctx.shadowBlur = 15;
        ctx.shadowColor = itemDef.value;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.font = '22px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(itemDef.value, 0, 0);
      }
      ctx.restore();
    });

    // Draw Other Players
    Object.values(interpolatedPlayersRef.current).forEach((p: PlayerSession) => {
      drawSnake(ctx, p);
    });

    // Draw Local Bots
    botsRef.current.forEach(bot => {
      if (bot.isAlive) drawSnake(ctx, bot);
    });

    // Draw Local Player
    if (isAlive && playerRef.current.isAlive) {
      drawSnake(ctx, playerRef.current);
    }

    ctx.restore();

    // Draw Mini-map
    drawMinimap(ctx);
  };

  const drawMinimap = (ctx: CanvasRenderingContext2D) => {
    const mapSize = 135;
    const padding = 10;
    const x = window.innerWidth - mapSize - padding;
    const y = window.innerHeight - mapSize - padding;
    const zoom = 0.05; // Mini-map zoom level

    ctx.save();
    ctx.translate(x, y);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(0, 0, mapSize, mapSize, 20);
    } else {
      ctx.rect(0, 0, mapSize, mapSize);
    }
    ctx.fill();
    ctx.stroke();
    ctx.clip();

    // Minimap Label
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('RADAR ONLINE', 8, 15);

    // Center on player
    const head = playerRef.current.segments[0];
    ctx.translate(mapSize / 2, mapSize / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-head.x, -head.y);

    // World Border in minimap
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 20;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    // Draw Other Players on minimap
    ctx.fillStyle = '#ff4422';
    Object.values(otherPlayersRef.current).forEach(otherVal => {
      const other = otherVal as PlayerSession;
      if (!other.isAlive || !other.segments || other.segments.length === 0) return;
      const otherHead = other.segments[0];
      ctx.beginPath();
      ctx.arc(otherHead.x, otherHead.y, 40, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Bots on minimap
    ctx.fillStyle = '#ffaa00';
    botsRef.current.forEach(bot => {
      if (!bot.isAlive) return;
      const botHead = bot.segments[0];
      ctx.beginPath();
      ctx.arc(botHead.x, botHead.y, 40, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Player on minimap (always at center due to translation)
    ctx.fillStyle = '#22ff44';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 40, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  const drawSnake = (ctx: CanvasRenderingContext2D, snake: PlayerSession) => {
    const trail = snake.segments;
    if (trail.length < 2) return;

    const isInvulnerable = snake.spawnTime && (Date.now() - snake.spawnTime < 1500);

    ctx.save();
    if (isInvulnerable) {
      ctx.globalAlpha = 0.5;
    }

    // Constant thickness (no growth with wager)
    const pointsPerSegment = 3; // Closer segments for natural look
    const baseRadius = 10; // Fixed radius for body
    const headRadius = 14; // Fixed radius for head

    // Aura (Visual Ability)
    if (snake.hasAura) {
      ctx.save();
      const time = Date.now() / 1000;
      const auraPulse = Math.sin(time * 5) * 2;
      const auraRadius = headRadius + 8 + auraPulse;
      
      // Layered glow
      const gradient = ctx.createRadialGradient(trail[0].x, trail[0].y, headRadius, trail[0].x, trail[0].y, auraRadius);
      
      if (snake.auraType === 'fire') {
        gradient.addColorStop(0, 'rgba(255, 68, 0, 0.5)');
        gradient.addColorStop(0.5, 'rgba(255, 153, 0, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 204, 0, 0)');
      } else if (snake.auraType === 'ice') {
        gradient.addColorStop(0, 'rgba(0, 255, 255, 0.5)');
        gradient.addColorStop(0.5, 'rgba(150, 230, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(200, 250, 255, 0)');
      } else if (snake.auraType === 'lightning') {
        gradient.addColorStop(0, 'rgba(255, 255, 0, 0.5)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 200, 0)');
      }
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(trail[0].x, trail[0].y, auraRadius, 0, Math.PI * 2);
      ctx.fill();
      
      // Particles / Bolts
      if (snake.auraType === 'lightning') {
        // Draw small lightning bolts
        for (let b = 0; b < 3; b++) {
          if (Math.random() > 0.4) {
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 1.5;
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'yellow';
            ctx.beginPath();
            let bx = trail[0].x;
            let by = trail[0].y;
            ctx.moveTo(bx, by);
            for (let s = 0; s < 3; s++) {
              bx += (Math.random() - 0.5) * auraRadius * 0.8;
              by += (Math.random() - 0.5) * auraRadius * 0.8;
              ctx.lineTo(bx, by);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
        }
      } else if (Math.random() > 0.6) {
        if (snake.auraType === 'fire') {
          ctx.fillStyle = `rgba(255, ${Math.floor(Math.random() * 100 + 50)}, 0, 0.5)`;
        } else if (snake.auraType === 'ice') {
          ctx.fillStyle = `rgba(${Math.floor(Math.random() * 50 + 200)}, 255, 255, 0.5)`;
        }
        ctx.beginPath();
        const px = trail[0].x + (Math.random() - 0.5) * headRadius * 2;
        const py = trail[0].y + (Math.random() - 0.5) * headRadius * 2;
        ctx.arc(px, py, Math.random() * 3 + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Neon glow for the whole snake
    ctx.shadowBlur = snake.isBoosting ? 20 + Math.random() * 10 : 10;
    ctx.shadowColor = snake.isBoosting ? '#fff' : snake.color1;

    // Body segments (drawn from tail to head)
    for (let i = trail.length - 1; i >= pointsPerSegment; i -= pointsPerSegment) {
      const segmentIndex = Math.floor(i / pointsPerSegment);
      
      // Constant thickness (no tapering)
      const r = baseRadius;
      
      if (snake.isBoosting) {
        ctx.fillStyle = Math.random() > 0.5 ? '#fff' : (segmentIndex % 2 === 0 ? snake.color1 : snake.color2);
        // Aura particles
        if (Math.random() > 0.8) {
          ctx.save();
          ctx.shadowBlur = 5;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(trail[i].x + (Math.random() - 0.5) * r * 3, trail[i].y + (Math.random() - 0.5) * r * 3, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } else {
        ctx.fillStyle = segmentIndex % 2 === 0 ? snake.color1 : snake.color2;
      }

      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head (always at index 0)
    const head = trail[0];
    ctx.fillStyle = snake.isBoosting ? '#fff' : snake.color1;
    ctx.beginPath();
    ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0; // Reset shadow for eyes/emoji

    // Emoji Head support
    if (snake.skinEmoji && snake.skinEmoji !== '🟢') {
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(snake.angle + Math.PI / 2);
      ctx.font = `${headRadius * 2.2}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(snake.skinEmoji, 0, 0);
      ctx.restore();
    } else {
      // Eyes (only if no emoji)
      const eyeOff = CELL / 4;
      const ex1 = head.x + Math.cos(snake.angle - 0.5) * eyeOff;
      const ey1 = head.y + Math.sin(snake.angle - 0.5) * eyeOff;
      const ex2 = head.x + Math.cos(snake.angle + 0.5) * eyeOff;
      const ey2 = head.y + Math.sin(snake.angle + 0.5) * eyeOff;
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(ex1, ey1, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, 3, 0, Math.PI * 2); ctx.fill();
    }

    // Name
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(snake.displayName, head.x, head.y - 15 - baseRadius);
    ctx.restore();
  };

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    mouseRef.current = { x: touch.clientX, y: touch.clientY };
    
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap detected
      setIsBoosting(true);
      isTouchBoostingRef.current = true;
      
      // Auto-stop boost after 2 seconds
      if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
      boostTimerRef.current = setTimeout(() => {
        setIsBoosting(false);
        isTouchBoostingRef.current = false;
      }, 2000);
    }
    lastTapRef.current = now;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    mouseRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = () => {
    if (isTouchBoostingRef.current) {
      setIsBoosting(false);
      isTouchBoostingRef.current = false;
      if (boostTimerRef.current) {
        clearTimeout(boostTimerRef.current);
        boostTimerRef.current = null;
      }
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden touch-none">
      {/* Server Allocation Loading */}
      {!serverId && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="mb-4 h-12 w-12 border-4 border-blue-500 border-t-transparent rounded-full"
          />
          <p className="text-xl font-black text-white uppercase tracking-widest animate-pulse">
            Buscando Servidor Disponible...
          </p>
          <p className="mt-2 text-sm text-gray-400">
            Asignando instancia de combate optimizada
          </p>
          {showCancel && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={onGameOver}
              className="mt-8 flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-sm font-bold text-white backdrop-blur-md border border-white/20 hover:bg-white/20 transition-all active:scale-95"
            >
              <ArrowLeft size={16} />
              Cancelar y Volver al Menú
            </motion.button>
          )}
        </div>
      )}

      <canvas
        ref={canvasRef}
        onMouseMove={(e) => { mouseRef.current = { x: e.clientX, y: e.clientY }; }}
        onMouseDown={() => setIsBoosting(true)}
        onMouseUp={() => setIsBoosting(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="h-full w-full cursor-none"
      />

      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-black/50 p-3 backdrop-blur-md border border-white/10">
            <GoldPointIcon size={24} />
            <span className="text-2xl font-black text-white">{score}</span>
          </div>
          <motion.div 
            key={`arena-score-total-${finalBalance || (user.coins + score)}`}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.1, 1] }}
            className="flex items-center gap-2 rounded-xl bg-yellow-600/30 p-3 backdrop-blur-md border border-yellow-500/30"
          >
            <GoldPointIcon size={20} />
            <span className="text-lg font-bold text-white">{finalBalance || (user.coins + score)}</span>
          </motion.div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-black/50 p-3 backdrop-blur-md w-fit">
          <Zap className={isBoosting ? "text-blue-400" : "text-gray-600"} />
          <span className="text-xs font-bold text-gray-400 uppercase tracking-tighter">Boost</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-black/50 p-3 backdrop-blur-md w-fit">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="h-2 w-2 rounded-full bg-green-400"
          />
          <span className="text-xs font-bold text-white uppercase tracking-tighter">{onlineCount} En línea</span>
          {serverId && (
            <span className="text-[10px] font-mono text-gray-500 ml-1 border-l border-white/20 pl-2">
              {serverId.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* Payment Notification Overlay */}
      <AnimatePresence>
        {paymentNotice && (
          <motion.div
            initial={{ opacity: 0, x: 50, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="fixed bottom-24 right-6 z-[60] flex max-w-sm flex-col gap-2 rounded-2xl border border-blue-500/30 bg-gray-900/90 p-4 shadow-2xl backdrop-blur-md pointer-events-auto"
          >
            <div className="flex items-center gap-3">
              <div className={`rounded-full p-2 ${paymentNotice.status === 'approved' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                {paymentNotice.status === 'approved' ? <Trophy size={20} /> : <Zap size={20} />}
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Notificación de Pago</p>
                <h4 className="text-sm font-black text-white">
                  {paymentNotice.status === 'approved' ? '¡Pago Acreditado!' : 'Pago en Proceso...'}
                </h4>
              </div>
              <button 
                onClick={() => setPaymentNotice(null)}
                className="text-gray-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="mt-2 rounded-xl bg-black/30 p-3">
              <p className="text-[10px] font-bold text-gray-500 uppercase leading-tight">
                {paymentNotice.status === 'approved' 
                  ? 'Se han acreditado las monedas en tu cuenta exitosamente.' 
                  : 'Mercado Pago ha recibido tu solicitud. El saldo se acreditará automáticamente cuando se confirme el pago (puede tardar unos minutos).'}
              </p>
              <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-white">+{paymentNotice.amount}</span>
                  <Coins className="text-yellow-500" size={16} />
                </div>
                <span className={`text-[10px] font-bold uppercase ${paymentNotice.status === 'approved' ? 'text-green-500' : 'text-yellow-500'}`}>
                  {paymentNotice.status.toUpperCase()}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Powerups UI removed */}
      <div className="pointer-events-none absolute left-4 top-40 flex flex-col gap-2">
      </div>

      {/* Ability Buttons Section */}
      <div className="absolute bottom-6 left-4 z-[70] flex flex-col gap-3 pointer-events-auto">
        {hasTeleport && (
          <div className="relative">
            <button
              onClick={handleTeleport}
              disabled={Date.now() - lastTeleportTime < 180000 || user.coins < 250}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 transition-all active:scale-95 ${Date.now() - lastTeleportTime < 180000 ? 'border-gray-700 bg-gray-800/80 grayscale text-gray-500' : 'border-blue-500 bg-blue-500/20 text-blue-400 shadow-lg shadow-blue-500/20 hover:bg-blue-500/30'}`}
            >
              <Zap size={24} />
              {Date.now() - lastTeleportTime < 180000 && (
                <div className="absolute -top-2 -right-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[8px] font-black text-white">
                  {Math.ceil((180000 - (Date.now() - lastTeleportTime)) / 1000)}s
                </div>
              )}
            </button>
            <span className="mt-1 block text-center text-[8px] font-black uppercase text-white/50">Teleport (250)</span>
          </div>
        )}

        {hasStop && (
          <div className="relative">
            <button
              onClick={() => setIsStopped(!isStopped)}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 transition-all active:scale-95 ${isStopped ? 'border-red-500 bg-red-500 text-white shadow-lg shadow-red-500/40' : 'border-gray-700 bg-gray-800/80 text-gray-400 hover:border-gray-500'}`}
            >
              <div className="h-4 w-4 bg-current rounded-sm" />
            </button>
            <span className="mt-1 block text-center text-[8px] font-black uppercase text-white/50">Parar</span>
          </div>
        )}

        {hasAutopilot && (
          <div className="relative">
            <button
              onClick={() => setIsAutopilot(!isAutopilot)}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 transition-all active:scale-95 ${isAutopilot ? 'border-green-500 bg-green-500/20 text-green-400 shadow-lg shadow-green-500/20' : 'border-gray-700 bg-gray-800/80 text-gray-400 hover:border-gray-500'}`}
            >
              <Target size={24} />
            </button>
            <span className="mt-1 block text-center text-[8px] font-black uppercase text-white/50">Auto</span>
          </div>
        )}
      </div>

      {/* Floating Texts */}
      <div className="pointer-events-none fixed inset-0 z-[100]">
        {floatingTexts.map(ft => (
          <motion.div
            key={ft.id}
            initial={{ opacity: 1, y: ft.y }}
            animate={{ opacity: 0, y: ft.y - 100 }}
            className="absolute font-black text-xs uppercase tracking-widest whitespace-nowrap"
            style={{ left: ft.x, color: ft.color }}
          >
            {ft.text}
          </motion.div>
        ))}
      </div>

      {/* Chat System */}
      <div className="absolute bottom-4 left-4 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {showChat && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="flex h-64 w-72 flex-col rounded-2xl bg-black/60 p-4 backdrop-blur-xl border border-white/10 shadow-2xl"
            >
              <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-black uppercase tracking-widest text-blue-400">
                  Chat de Arena {serverId?.split('_')[1]}
                </span>
                <button onClick={() => setShowChat(false)} className="text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {messages.map((msg, idx) => (
                  <div key={`msg-${msg.id}-${idx}`} className="text-sm">
                    <span className="font-bold text-blue-400">{msg.displayName}: </span>
                    <span className="text-gray-200">{msg.text}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={handleSendMessage} className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs text-white outline-none focus:bg-white/20"
                />
                <button type="submit" className="rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-500">
                  <Send size={14} />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
        
        {!showChat && (
          <button
            onClick={() => setShowChat(true)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-500 active:scale-95"
          >
            <MessageSquare size={20} />
          </button>
        )}
      </div>

      {/* Kill Feed */}
      <div className="pointer-events-none absolute right-4 top-20 flex flex-col items-end gap-2">
        <AnimatePresence mode="popLayout">
          {kills.map((kill, idx) => (
            <motion.div
              key={`kill-${kill.id}-${idx}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex items-center gap-2 rounded-lg bg-black/40 px-3 py-1 text-xs backdrop-blur-sm border border-white/5"
            >
              <span className="font-bold text-blue-400">{kill.killerName}</span>
              <span className="text-gray-400 italic">eliminó a</span>
              <span className="font-bold text-red-400">{kill.victimName}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Floating Collect Button */}
      {isAlive && (
        <div className="absolute right-4 top-4">
          <button
            onClick={handleCollect}
            className="group flex items-center gap-2 rounded-2xl bg-yellow-600 px-6 py-3 font-black uppercase tracking-tighter text-white shadow-lg transition-all hover:bg-yellow-500 hover:shadow-[0_0_20px_rgba(202,138,4,0.4)] active:scale-95"
          >
            <Coins className="transition-transform group-hover:rotate-12" />
            <span className="hidden sm:inline">Cobrar y Salir</span>
            <LogOut size={18} className="ml-1 opacity-50" />
          </button>
        </div>
      )}

      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-4">
        {!isAlive && !isCollecting && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center gap-4 rounded-3xl bg-red-900/90 p-8 text-center backdrop-blur-xl"
          >
            <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">HAS MUERTO</h2>
            <div className="flex flex-col gap-1">
              <p className="text-red-200">Perdiste tu apuesta de {wager}</p>
              {score > wager && (
                <p className="text-green-400 font-bold text-sm uppercase tracking-widest">
                  Pero conservaste +{score - wager} de ganancia
                </p>
              )}
            </div>
            <button
              onClick={onGameOver}
              className="flex items-center gap-2 rounded-full bg-white px-8 py-3 font-bold text-red-900"
            >
              <ArrowLeft /> Volver al Menú
            </button>
          </motion.div>
        )}

        {!isAlive && isCollecting && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center gap-4 rounded-3xl bg-green-900/90 p-8 text-center backdrop-blur-xl border border-green-500/30 shadow-[0_0_50px_rgba(34,197,94,0.2)]"
          >
            <div className="rounded-full bg-yellow-500 p-4 text-green-900">
              <Trophy size={48} />
            </div>
            <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">¡FELICITACIONES!</h2>
            <p className="text-green-100">Has recolectado exitosamente tus puntos.</p>
            <div className="flex flex-col items-center gap-1 my-2">
              <div className="mb-4 flex items-center gap-8 rounded-2xl bg-black/20 px-6 py-3">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-green-400">Apuesta</span>
                  <span className="text-xl font-black text-white">{wager}</span>
                </div>
                <div className="text-2xl font-black text-green-500">+</div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-green-400">Ganancia</span>
                  <span className="text-xl font-black text-white">{score - wager}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-6xl font-black text-yellow-500">
                <Coins size={48} />
                <span>+{score}</span>
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-green-400">Total a acreditar</p>
              
              <div className="mt-4 flex flex-col items-center gap-1 rounded-2xl bg-black/40 px-8 py-4 border border-white/10">
                <div className="flex items-center gap-3 text-gray-400">
                  <span className="text-sm font-bold uppercase tracking-widest">Saldo Inicial</span>
                  <span className="text-lg font-black">{initialCoinsRef.current}</span>
                  <span className="text-xl font-black text-green-500">+</span>
                  <span className="text-lg font-black text-yellow-500">{score - wager} (Puntos)</span>
                </div>
                <div className="h-px w-full bg-white/10 my-2" />
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold uppercase tracking-widest text-white">Saldo Final</span>
                  <span className="text-3xl font-black text-green-400">{initialCoinsRef.current + (score - wager)}</span>
                </div>
              </div>
            </div>
            <button
              onClick={onGameOver}
              className="mt-4 flex items-center gap-2 rounded-full bg-white px-10 py-4 font-black uppercase tracking-tighter text-green-900 transition-all hover:bg-green-100 active:scale-95"
            >
              <ArrowLeft /> Volver al Menú
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
