import { useEffect, useRef, useState, TouchEvent } from 'react';
import { User, PlayerSession, Food, Point, ArenaItemEntity } from '../types';
import { WORLD_W, WORLD_H, BASE_SPEED, CELL, ALL_SKINS, SEGMENT_DISTANCE } from '../constants';
import { ARENA_ITEMS } from '../items';
import { ALL_ABILITIES } from '../abilities';
import { doc, updateDoc, increment, collection, query, where, onSnapshot, addDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowLeft, Zap, Bot, Coins, LogOut } from 'lucide-react';
import { GoldPointIcon } from './Icons';
import { soundManager } from '../lib/sounds';
import { supabase } from '../lib/supabase';

interface TrainingArenaProps {
  user: User;
  botCount?: number;
  initialWager?: number;
  serverId?: string;
  onGameOver: () => void;
}

export default function TrainingArena({ user, botCount = 1, initialWager = 0, serverId = 'training_default', onGameOver }: TrainingArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [isAlive, setIsAlive] = useState(true);
  const [isCollecting, setIsCollecting] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);
  const [boostCharge, setBoostCharge] = useState(5.0); // 5 seconds max
  const [isOverheated, setIsOverheated] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(0);
  const smokeParticlesRef = useRef<{x: number, y: number, id: number, life: number, vx: number, vy: number}[]>([]);
  const foodsRef = useRef<Food[]>([]);
  const itemsRef = useRef<Record<string, ArenaItemEntity>>({});
  const lastTapRef = useRef<number>(0);
  const boostTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTouchBoostingRef = useRef(false);

  // Abilities state
  const [isInvulnerable, setIsInvulnerable] = useState(false);
  const [lastTeleportTime, setLastTeleportTime] = useState(0);
  const [floatingTexts, setFloatingTexts] = useState<{ id: string; x: number; y: number; text: string; color: string; opacity: number }[]>([]);
  const equippedAbilities = user.equippedAbilities || [];
  const hasZoom = equippedAbilities.includes('zoom');
  const hasMagnet = equippedAbilities.includes('magnet');
  const hasTeleport = equippedAbilities.includes('teleport');
  const hasGrosor = equippedAbilities.includes('grosor');
  const hasBoostCooldown = equippedAbilities.includes('boost_cooldown');

  const handleTeleport = async () => {
    if (!hasTeleport || user.coins < 250) return;
    const now = Date.now();
    if (now - lastTeleportTime < 180000) return; // 3 min

    // Cost (to saldo)
    try {
      if (!user.isGuest) {
        const userRef = doc(db, 'users', user.id);
        await updateDoc(userRef, {
          coins: increment(-250)
        });
      } else {
        // Guest points update handled locally in parent or by storage
        const updatedUser = { ...user, coins: user.coins - 250 };
        // We will save to localStorage in handleDeath/handleCollect or periodically
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
      return;
    }

    setLastTeleportTime(now);
    
    // Add floating text
    const textId = Math.random().toString(36).substr(2, 9);
    setFloatingTexts(prev => [...prev, {
      id: textId,
      x: 20,
      y: window.innerHeight - 100,
      text: '-250 Puntos',
      color: '#fbbf24',
      opacity: 1
    }]);

    soundManager.play('star');
    
    setIsInvulnerable(true);
    setTimeout(() => setIsInvulnerable(false), 3000);
    
    const newPos = {
      x: 100 + Math.random() * (WORLD_W - 200),
      y: 100 + Math.random() * (WORLD_H - 200)
    };
    
    playerRef.current.segments = playerRef.current.segments.map(() => ({ ...newPos }));
    cameraRef.current.x = newPos.x;
    cameraRef.current.y = newPos.y;
  };

  const playerRef = useRef<PlayerSession>({
    id: 'player',
    userId: user.id,
    displayName: user.displayName,
    segments: Array.from({ length: 12 + Math.floor(initialWager / 10) }, (_, i) => ({ x: WORLD_W / 2 - i * SEGMENT_DISTANCE, y: WORLD_H / 2 })),
    angle: 0,
    wager: initialWager,
    isAlive: true,
    lastUpdate: Date.now(),
    spawnTime: Date.now(),
    color1: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[0] || '#22ff44',
    color2: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[1] || '#11cc33',
    skinEmoji: ALL_SKINS.find(s => s.id === user.equippedSkin)?.icon,
    tailEmoji: ALL_SKINS.find(s => s.id === user.equippedSkin)?.tailIcon,
    hasAura: ALL_SKINS.find(s => s.id === user.equippedSkin)?.hasAura,
    auraType: ALL_SKINS.find(s => s.id === user.equippedSkin)?.auraType,
    skinId: user.equippedSkin,
    isBoosting: false
  });

  const botsRef = useRef<PlayerSession[]>([]);

  const mouseRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cameraRef = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 });

  useEffect(() => {
    // Initial bots
    const botNames = [
      "ElPro_777", "GamerLatino", "xX_Slayer_Xx", "LaLeyenda", "PibeGamer", 
      "VatoLoco", "Chamo_Snake", "El_Master", "Don_Gamer", "Rey_De_La_Arena", 
      "Latino_Power", "El_Tigre", "Lobo_Solitario", "Gamer_MX", "Arg_Pro", 
      "Chilean_Warrior", "Peru_King", "Col_Sniper", "Uru_Gamer", "Bol_Master", 
      "El_Bicho", "La_Bestia", "Manco_Pero_Feliz", "Pro_Player_Vip", "El_Capo", 
      "Zorro_Veloz", "Aguila_Real", "Jaguar_Negro", "Cobra_Latina", "Fenix_Azul", 
      "Rayo_McQueen", "El_Rayo", "Trueno_Gamer", "Sombra_Latina", "Halcón_Peregrino", 
      "Gato_Con_Botas", "El_Curro", "Pibe_De_Oro", "El_Padrino", "La_Jefa"
    ];

    const initialBots: PlayerSession[] = [];
    for (let i = 0; i < botCount; i++) {
      initialBots.push(createBot(i));
    }
    botsRef.current = initialBots;

    // Arena Items Listener
    const itemsQuery = query(collection(db, 'arenaItems'), where('serverId', '==', serverId));
    const unsubItems = onSnapshot(itemsQuery, (snapshot) => {
      const newItems: Record<string, ArenaItemEntity> = {};
      snapshot.forEach((doc) => {
        newItems[doc.id] = { id: doc.id, ...doc.data() } as ArenaItemEntity;
      });
      itemsRef.current = newItems;

      // Arena items spawning logic: Keep at least 5 items in training
      if (snapshot.size < 5) {
        const spawnCount = 5 - snapshot.size;
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

    // Initial food
    const initialFood: Food[] = [];
    for (let i = 0; i < 100; i++) {
      const isSpecial = Math.random() > 0.9;
      initialFood.push({
        id: Math.random().toString(),
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        value: isSpecial ? 12 : 3,
        type: isSpecial ? 'gold' : 'normal',
        color: isSpecial ? '#fbbf24' : '#ef4444' // Yellow (12) or Red (3)
      });
    }
    foodsRef.current = initialFood;

    let lastTime = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (isAlive && playerRef.current.isAlive) {
        updatePlayer(dt);
        botsRef.current.forEach(bot => {
          if (bot.isAlive) updateBot(bot, dt);
        });
        checkCollisions(dt);
      }

      render();
      requestAnimationFrame(loop);
    };

    const animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isAlive]);

  const updatePlayer = (dt: number) => {
    const head = playerRef.current.segments[0];
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    // Boost logic changes
    let actualIsBoosting = isBoosting && !isOverheated;
    if (actualIsBoosting) {
      setBoostCharge(prev => {
        const next = Math.max(0, prev - dt);
        if (next === 0 && !isOverheated) {
          setIsOverheated(true);
          setCooldownTime(30);
        }
        return next;
      });
    } else if (isOverheated) {
      setCooldownTime(prev => {
        const next = Math.max(0, prev - dt);
        if (next === 0) setIsOverheated(false);
        return next;
      });
      setBoostCharge(prev => Math.min(5, prev + (5 / 30) * dt));

      if (Math.random() > 0.7) {
        smokeParticlesRef.current.push({
          x: head.x,
          y: head.y,
          id: Math.random(),
          life: 1.0,
          vx: (Math.random() - 0.5) * 50,
          vy: (Math.random() - 0.5) * 50 - 30
        });
      }
    } else if (boostCharge < 5) {
      setBoostCharge(prev => Math.min(5, prev + 0.5 * dt));
    }

    smokeParticlesRef.current = smokeParticlesRef.current.map(p => ({
      ...p,
      x: p.x + p.vx * dt,
      y: p.y + p.vy * dt,
      life: p.life - dt * 0.8
    })).filter(p => p.life > 0);

    playerRef.current.isBoosting = actualIsBoosting;
    const speed = actualIsBoosting ? BASE_SPEED * 2 : BASE_SPEED;
    
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

    // Growth logic: starting size (12 base segments) + scaling segments
    const pointsPerSegment = 5;
    const baseSegments = 12;
    const currentScore = playerRef.current.wager;
    
    // Multi-stage linear growth: 
    // Uniform growth logic: 1 segment per 50 points constantly
    const bonusSegments = Math.floor(currentScore / 50);
    
    const targetSegments = baseSegments + bonusSegments;
    const maxTrailLen = targetSegments * pointsPerSegment;

    if (speed > 0) {
      while (trail.length > maxTrailLen) {
        trail.pop();
      }
    }
    playerRef.current.segments = trail;

    cameraRef.current.x += (head.x - cameraRef.current.x) * 0.1;
    cameraRef.current.y += (head.y - cameraRef.current.y) * 0.1;

    // Dynamic zoom: Stay closer
    let targetZoomBase = Math.max(0.5, Math.min(1.1, 1600 / (maxTrailLen * 1.2 + 800)));
    if (hasZoom) targetZoomBase *= 0.65;
    cameraRef.current.zoom += (targetZoomBase - cameraRef.current.zoom) * 0.02;

    // Update floating texts
    setFloatingTexts(prev => prev.map(ft => ({
      ...ft,
      y: ft.y - 1,
      opacity: ft.opacity - 0.02
    })).filter(ft => ft.opacity > 0));
  };

  const createBot = (index: number): PlayerSession => {
    const botNames = [
      "ElPro_777", "GamerLatino", "xX_Slayer_Xx", "LaLeyenda", "PibeGamer", 
      "VatoLoco", "Chamo_Snake", "El_Master", "Don_Gamer", "Rey_De_La_Arena", 
      "Latino_Power", "El_Tigre", "Lobo_Solitario", "Gamer_MX", "Arg_Pro", 
      "Chilean_Warrior", "Peru_King", "Col_Sniper", "Uru_Gamer", "Bol_Master", 
      "El_Bicho", "La_Bestia", "Manco_Pero_Feliz", "Pro_Player_Vip", "El_Capo", 
      "Zorro_Veloz", "Aguila_Real", "Jaguar_Negro", "Cobra_Latina", "Fenix_Azul", 
      "Rayo_McQueen", "El_Rayo", "Trueno_Gamer", "Sombra_Latina", "Halcón_Peregrino", 
      "Gato_Con_Botas", "El_Curro", "Pibe_De_Oro", "El_Padrino", "La_Jefa"
    ];
    const randomName = botNames[Math.floor(Math.random() * botNames.length)];
    const margin = 100;
    const startX = margin + Math.random() * (WORLD_W - margin * 2);
    const startY = margin + Math.random() * (WORLD_H - margin * 2);
    const randomSkin = ALL_SKINS[Math.floor(Math.random() * ALL_SKINS.length)];
    return {
      id: `bot-${index}-${Math.random().toString(36).substr(2, 5)}`,
      userId: `bot-${index}`,
      displayName: `${randomName} ${Math.random() > 0.7 ? Math.floor(Math.random() * 99) : ''}`.trim(),
      segments: Array.from({ length: 15 }, (_, j) => ({ 
        x: startX - j * SEGMENT_DISTANCE, 
        y: startY 
      })),
      angle: Math.random() * Math.PI * 2,
      wager: 100,
      isAlive: true,
      lastUpdate: Date.now(),
      spawnTime: Date.now(),
      color1: randomSkin.colors[0],
      color2: randomSkin.colors[1],
      skinEmoji: randomSkin.icon,
      tailEmoji: randomSkin.tailIcon,
      skinId: randomSkin.id,
      hasAura: randomSkin.hasAura,
      auraType: randomSkin.auraType,
    };
  };

  const dropBotFood = (bot: PlayerSession) => {
    const segments = bot.segments;
    const pointsPerSegment = 5; // Defined in updateBot too
    
    // REDUCTION FOR LAG: Half visual points and half value compared to previous (before it was wager/20)
    // Doubled for bots as per request
    const dropCount = Math.max(2, Math.floor(bot.wager / 20));
    const dropFrequency = pointsPerSegment * 4;

    for (let i = 0; i < dropCount; i++) {
      const idx = i * dropFrequency;
      const s = segments[idx] || segments[segments.length - 1];
      const val = 3; // Red base value
      
      foodsRef.current.push({
        id: Math.random().toString(),
        x: s.x,
        y: s.y,
        value: val,
        type: 'normal',
        color: bot.color1
      });
    }
  };

  const updateBot = (bot: PlayerSession, dt: number) => {
    const head = bot.segments[0];
    
    // IA de Bots: recalcular objetivo solo ocasionalmente
    if (!bot.lastAIUpdate || Date.now() - bot.lastAIUpdate > 500) {
      bot.lastAIUpdate = Date.now();
      let nearestFood = null;
      let minDist = 300; // Radio de búsqueda reducido
      
      for (const f of foodsRef.current) {
        const dx = head.x - f.x;
        const dy = head.y - f.y;
        if (Math.abs(dx) > minDist || Math.abs(dy) > minDist) continue;
        
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) {
          minDist = d;
          nearestFood = f;
        }
      }
      bot.targetFood = nearestFood;
    }

    if (bot.targetFood) {
      const dx = bot.targetFood.x - head.x;
      const dy = bot.targetFood.y - head.y;
      const targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - bot.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      bot.angle += diff * Math.min(1, 4 * dt);
    }

    const speed = BASE_SPEED * 0.8;
    const newX = head.x + Math.cos(bot.angle) * speed * dt;
    const newY = head.y + Math.sin(bot.angle) * speed * dt;

    // Die at walls
    if (newX < 0 || newX > WORLD_W || newY < 0 || newY > WORLD_H) {
      bot.isAlive = false;
      // Drop food
      dropBotFood(bot);
      return;
    }

    const trail = bot.segments;
    trail.unshift({ x: newX, y: newY });

    // Bot growth: 10 base segments (100 pts) + 1 per 10 points
    const pointsPerSegment = 5;
    const botScore = Math.min(5000, bot.wager); // Increased limit as they start bigger
    const targetSegments = Math.floor(botScore / 10);
    const maxTrailLen = targetSegments * pointsPerSegment;

    while (trail.length > maxTrailLen) {
      trail.pop();
    }
    bot.segments = trail;
  };  const checkCollisions = (dt: number) => {
    const head = playerRef.current.segments[0];
    let scoreGain = 0;

    // Viewport bounds for culling some collision checks if needed, but foods are global.
    // However, bots-food can be culled to bot vicinity.

    // Food attraction and collision
    const remaining = foodsRef.current.filter(f => {
      // Static bounding box check for player
      if (Math.abs(head.x - f.x) > 150 || Math.abs(head.y - f.y) > 150) {
        // Still check bots-food but only for bots near this food
        for (const bot of botsRef.current) {
          if (!bot.isAlive) continue;
          const botHead = bot.segments[0];
          if (Math.abs(botHead.x - f.x) < 30 && Math.abs(botHead.y - f.y) < 30) {
            const dBot = Math.sqrt((botHead.x - f.x) ** 2 + (botHead.y - f.y) ** 2);
            if (dBot < CELL) {
              bot.wager = Math.min(3000, bot.wager + f.value);
              return false;
            }
          }
        }
        return true;
      }

      const dx = head.x - f.x;
      const dy = head.y - f.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      
      const attractionRadius = hasMagnet ? CELL * 4 : 0;
      const collectionRadius = hasGrosor ? CELL * 2.5 : CELL * 1.5;

      // Magnet attraction effect
      if (hasMagnet && d < attractionRadius && d > collectionRadius) {
        const pullSpeed = BASE_SPEED * 2; // Moderate speed for flight effect
        const angle = Math.atan2(dy, dx);
        f.x += Math.cos(angle) * pullSpeed * dt;
        f.y += Math.sin(angle) * pullSpeed * dt;
      }

      const currentD = Math.sqrt((head.x - f.x) ** 2 + (head.y - f.y) ** 2);
      if (currentD < collectionRadius) {
        scoreGain += f.value;
        if (f.value >= 5) soundManager.play('goldFood');
        else soundManager.play('food');
        return false;
      }
      
      // Bots food collision (immediate)
      for (const bot of botsRef.current) {
        if (!bot.isAlive) continue;
        const botHead = bot.segments[0];
        if (Math.abs(botHead.x - f.x) < 30 && Math.abs(botHead.y - f.y) < 30) {
          const dBot = Math.sqrt((botHead.x - f.x) ** 2 + (botHead.y - f.y) ** 2);
          if (dBot < CELL) {
            bot.wager = Math.min(3000, bot.wager + f.value);
            return false;
          }
        }
      }
      return true;
    });

    if (scoreGain > 0) {
      playerRef.current.wager += scoreGain;
      setScore(Math.floor(playerRef.current.wager));
    }
    
    // Player Arena Item collision
    Object.entries(itemsRef.current).forEach(([id, item]: [string, ArenaItemEntity]) => {
      const d = Math.sqrt((head.x - item.x) ** 2 + (head.y - item.y) ** 2);
      if (d < CELL * 1.5) {
        const itemDef = ARENA_ITEMS.find(i => i.id === item.itemId);
        if (itemDef) {
          soundManager.play('plim');
          // Update local inventory (optimistic)
          if (!user.inventoryItems) user.inventoryItems = {};
          user.inventoryItems[itemDef.id] = (user.inventoryItems[itemDef.id] || 0) + 1;
          
          if (!user.isGuest) {
            // Update Firestore inventory
            const userRef = doc(db, 'users', user.id);
            updateDoc(userRef, {
              [`inventoryItems.${itemDef.id}`]: increment(1)
            }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
          } else {
            // Guest local persistence
            localStorage.setItem('viborita_guest_data', JSON.stringify(user));
          }

          // Delete item from arena
          delete itemsRef.current[id];
          deleteDoc(doc(db, 'arenaItems', id)).catch(() => {});
        }
      }
    });

    // Respawn food
    while (remaining.length < 120) {
      const isSpecial = Math.random() > 0.9;
      remaining.push({
        id: Math.random().toString(),
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        value: isSpecial ? 12 : 3,
        type: isSpecial ? 'gold' : 'normal',
        color: isSpecial ? '#fbbf24' : '#ef4444'
      });
    }
    foodsRef.current = remaining;

    // Magnet Effect: Pull food removed
    
    // PowerUp collision removed

    // Respawn powerups removed

    // Collision detection (Head vs Body)
    const isPlayerInvulnerable = (playerRef.current.spawnTime && (Date.now() - playerRef.current.spawnTime < 1500));

    botsRef.current.forEach(bot => {
      if (!bot.isAlive) return;
      const isBotInvulnerable = bot.spawnTime && (Date.now() - bot.spawnTime < 1500);

      // Player head vs Bot body
      const hitBox = hasGrosor ? CELL * 2 : CELL;
      if (!isPlayerInvulnerable && !isBotInvulnerable) {
        bot.segments.forEach(seg => {
          if (Math.abs(head.x - seg.x) < 50 && Math.abs(head.y - seg.y) < 50) {
            const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
            if (d < hitBox) handleDeath();
          }
        });
      }

      // Bot head vs Player body
      if (!isBotInvulnerable && !isPlayerInvulnerable) {
        const botHead = bot.segments[0];
        playerRef.current.segments.forEach(seg => {
          if (Math.abs(botHead.x - seg.x) < 50 && Math.abs(botHead.y - seg.y) < 50) {
            const d = Math.sqrt((botHead.x - seg.x) ** 2 + (botHead.y - seg.y) ** 2);
            if (d < hitBox) {
              bot.isAlive = false;
              
              // Increment bot kills
              if (user?.id) {
                if (!user.isGuest) {
                  const userRef = doc(db, 'users', user.id);
                  updateDoc(userRef, { botKills: increment(1) }).catch(() => {});
                } else {
                  // Guest bot kills
                }
              }

              // Drop food
              dropBotFood(bot);
            }
          }
        });
      }

      // NOVEDAD: Colisión entre bots
      if (bot.isAlive && !isBotInvulnerable) {
        const botHead = bot.segments[0];
        botsRef.current.forEach(otherBot => {
          if (otherBot.id === bot.id || !otherBot.isAlive) return;
          const isOtherInvulnerable = otherBot.spawnTime && (Date.now() - otherBot.spawnTime < 1500);
          if (isOtherInvulnerable) return;

          // Optimization: skip if bot heads are very far from each other
          const distHeadsX = Math.abs(botHead.x - otherBot.segments[0].x);
          const distHeadsY = Math.abs(botHead.y - otherBot.segments[0].y);
          if (distHeadsX > 800 || distHeadsY > 800) return;

          otherBot.segments.forEach(seg => {
            if (Math.abs(botHead.x - seg.x) < 30 && Math.abs(botHead.y - seg.y) < 30) {
              const d = Math.sqrt((botHead.x - seg.x) ** 2 + (botHead.y - seg.y) ** 2);
              if (d < CELL) {
                bot.isAlive = false;
                // Drop food
                dropBotFood(bot);
              }
            }
          });
        });
      }
    });

    // Respawn bots
    const aliveBots = botsRef.current.filter(b => b.isAlive);
    if (aliveBots.length < botCount) {
      if (Math.random() > 0.98) {
        botsRef.current.push(createBot(botsRef.current.length));
      }
    }
  };

  const handleDeath = () => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    playerRef.current.isAlive = false;
    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    soundManager.play('death');
    soundManager.stopBoost();

    // Player drops score in training too - follow the same lag-reduction logic
    const segments = playerRef.current.segments;
    const totalWager = playerRef.current.wager;
    
    // Increased drop density for better feeling
    const dropCount = Math.max(15, Math.floor(totalWager / 10));
    const dropFrequency = Math.max(1, Math.floor(segments.length / dropCount));

    for (let i = 0; i < dropCount; i++) {
        const idx = (i * dropFrequency) % segments.length;
        const s = segments[idx] || segments[segments.length - 1];
        
        // Distribute value among drops
        const val = Math.max(1, Math.floor(totalWager / dropCount));
        
        const offsetX = (Math.random() - 0.5) * 30;
        const offsetY = (Math.random() - 0.5) * 30;

        foodsRef.current.push({
            id: Math.random().toString(),
            x: s.x + offsetX,
            y: s.y + offsetY,
            value: val,
            type: val >= 10 ? 'gold' : 'normal',
            color: val >= 10 ? '#fbbf24' : playerRef.current.color1
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

    if (!user.isGuest) {
      // Update user coins (credit training score)
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        coins: increment(score),
        highScore: Math.max(user.highScore, score)
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

      // Sync with Supabase
      await supabase.from('profiles').update({
        coins: user.coins + score,
        high_score: Math.max(user.highScore, score)
      }).eq('id', user.id);

      // Record transaction
      if (score > 0) {
        await supabase.from('transactions').insert({
          user_id: user.id,
          type: 'collected',
          currency: 'coins',
          amount: score,
          reason: 'training_collect',
          timestamp: new Date().toISOString()
        });
      }
    } else {
      // Guest logic
      const updatedUser = { 
        ...user, 
        coins: user.coins + score,
        highScore: Math.max(user.highScore, score)
      };
      localStorage.setItem('viborita_guest_data', JSON.stringify(updatedUser));
    }
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

    // Viewport Culling calculations
    const head = playerRef.current.segments[0];
    const viewportW = window.innerWidth / cameraRef.current.zoom;
    const viewportH = window.innerHeight / cameraRef.current.zoom;
    const viewportX = head.x - viewportW / 2;
    const viewportY = head.y - viewportH / 2;
    const cullMargin = 200; // Extra margin to avoid pop-in

    // Food - Only draw if in viewport
    foodsRef.current.forEach(f => {
      if (f.x < viewportX - cullMargin || f.x > viewportX + viewportW + cullMargin ||
          f.y < viewportY - cullMargin || f.y > viewportY + viewportH + cullMargin) return;

      ctx.fillStyle = f.color || '#ef4444';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 6, 0, Math.PI * 2);
      ctx.fill();
      
      // Subtle neon glow for special food only
      if (f.value > 1) {
        ctx.strokeStyle = f.color || '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    // Draw Arena Items - Only if in viewport
    Object.values(itemsRef.current).forEach((item: ArenaItemEntity) => {
      if (item.x < viewportX - cullMargin || item.x > viewportX + viewportW + cullMargin ||
          item.y < viewportY - cullMargin || item.y > viewportY + viewportH + cullMargin) return;

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

    // Snakes - Only draw if at least one segment is in viewport
    botsRef.current.forEach(bot => {
      if (bot.isAlive) {
        const botHead = bot.segments[0];
        // For bots, we check if head is near viewport
        if (botHead.x > viewportX - cullMargin * 2 && botHead.x < viewportX + viewportW + cullMargin * 2 &&
            botHead.y > viewportY - cullMargin * 2 && botHead.y < viewportY + viewportH + cullMargin * 2) {
          drawSnake(ctx, bot);
        }
      }
    });
    if (isAlive && playerRef.current.isAlive) drawSnake(ctx, playerRef.current);

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
    ctx.fillText('RADAR PUNTOS', 8, 15);

    // Center on player
    const head = playerRef.current.segments[0];
    ctx.translate(mapSize / 2, mapSize / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-head.x, -head.y);

    // World Border in minimap
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 20;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    // Draw Bots on minimap
    ctx.fillStyle = '#ff4422';
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

    const pointsPerSegment = 5;
    const baseRadius = 10;
    const headRadius = 14;

    // Aura
    if (snake.hasAura) {
      ctx.save();
      const time = Date.now() / 1000;
      const auraPulse = Math.sin(time * 5) * 2;
      const auraRadius = headRadius + 8 + auraPulse;
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
      } else if (snake.auraType === 'water') {
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.6)');
        gradient.addColorStop(0.5, 'rgba(30, 64, 175, 0.4)');
        gradient.addColorStop(1, 'rgba(30, 58, 138, 0)');
      } else if (snake.auraType === 'death') {
        gradient.addColorStop(0, 'rgba(75, 85, 99, 0.5)');
        gradient.addColorStop(0.5, 'rgba(6, 78, 59, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (snake.auraType === 'crystal') {
        gradient.addColorStop(0, 'rgba(34, 211, 238, 0.5)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      } else if (snake.auraType === 'ember') {
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.6)');
        gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.4)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (snake.auraType === 'nebula') {
        gradient.addColorStop(0, 'rgba(236, 72, 153, 0.5)');
        gradient.addColorStop(0.5, 'rgba(126, 34, 206, 0.3)');
        gradient.addColorStop(1, 'rgba(88, 28, 135, 0)');
      }
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(trail[0].x, trail[0].y, auraRadius, 0, Math.PI * 2);
      ctx.fill();

      // Bolts for lightning aura
      if (snake.auraType === 'lightning') {
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
      }

      ctx.restore();
    }

    const isOverheated = snake.userId === user.id && cooldownTime > 0;
    const bodyRadius = (hasGrosor && snake.userId === user.id) ? baseRadius * 2 : baseRadius;
    const hRadius = (hasGrosor && snake.userId === user.id) ? headRadius * 2 : headRadius;

    // Draw smoke for overheating
    if (isOverheated) {
      smokeParticlesRef.current.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life * 0.4;
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 + (1 - p.life) * 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // Neon glow
    ctx.shadowBlur = snake.isBoosting ? 20 + Math.random() * 10 : 10;
    ctx.shadowColor = snake.isBoosting ? '#fff' : snake.color1;

    for (let i = trail.length - 1; i >= pointsPerSegment; i -= pointsPerSegment) {
      const segmentIndex = Math.floor(i / pointsPerSegment);
      const isTail = i >= (trail.length - pointsPerSegment);
      const r = bodyRadius;
      
      const isSpecialSkin = ['necromancer', 'dragon_fuego'].includes(snake.skinId || '');

      if (snake.isBoosting) {
        ctx.fillStyle = Math.random() > 0.5 ? '#fff' : (segmentIndex % 2 === 0 ? snake.color1 : snake.color2);
      } else {
        ctx.fillStyle = segmentIndex % 2 === 0 ? snake.color1 : snake.color2;
      }

      ctx.beginPath();
      if (snake.skinId === 'dragon_fuego') {
        const rTapered = bodyRadius * (1 - (i / trail.length) * 0.4); 
        ctx.save();
        ctx.translate(trail[i].x, trail[i].y);
        const nextSeg = trail[i - pointsPerSegment] || trail[i];
        const angle = Math.atan2(nextSeg.y - trail[i].y, nextSeg.x - trail[i].x);
        ctx.rotate(angle);

        const radius = rTapered;
        
        // --- Vector Style Segment ---
        ctx.lineWidth = radius * 0.2;
        ctx.strokeStyle = "#000000";
        ctx.lineJoin = "round";

        // Púas laterales (Hueso)
        ctx.fillStyle = "#F2D8B3";
        ctx.beginPath();
        ctx.moveTo(0, -radius*0.7);
        ctx.lineTo(-radius*0.8, -radius*1.6);
        ctx.lineTo(radius*0.4, -radius*0.7);
        ctx.moveTo(0, radius*0.7);
        ctx.lineTo(-radius*0.8, radius*1.6);
        ctx.lineTo(radius*0.4, radius*0.7);
        ctx.fill(); 
        ctx.stroke();

        // Círculo principal del cuerpo
        ctx.fillStyle = "#796B75";
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill(); 
        ctx.stroke();

        // Detalle central oscuro del cuerpo
        ctx.fillStyle = "#5C4E57";
        ctx.beginPath();
        ctx.moveTo(-radius*0.4, -radius*0.5);
        ctx.lineTo(radius*0.4, 0);
        ctx.lineTo(-radius*0.4, radius*0.5);
        ctx.lineTo(-radius*0.6, 0);
        ctx.closePath();
        ctx.fill(); 
        ctx.stroke();

        ctx.restore();
      } else if (snake.skinId === 'komodo') {
        const rTapered = bodyRadius * (1 - (i / trail.length) * 0.2); 
        ctx.save();
        ctx.translate(trail[i].x, trail[i].y);
        const nextSeg = trail[i - pointsPerSegment] || trail[i];
        const angle = Math.atan2(nextSeg.y - trail[i].y, nextSeg.x - trail[i].x);
        ctx.rotate(angle);
        
        const radius = rTapered;

        const bodyGrad = ctx.createLinearGradient(0, -radius, 0, radius);
        bodyGrad.addColorStop(0, '#1c1714');
        bodyGrad.addColorStop(0.2, '#3b322a');
        bodyGrad.addColorStop(0.5, '#6b5e52');
        bodyGrad.addColorStop(0.8, '#3b322a');
        bodyGrad.addColorStop(1, '#0d0b09');

        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        const drawDorsalScale = (x: number, y: number, r: number, color: string, highlight: string) => {
          ctx.save();
          ctx.translate(x, y);
          ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
          ctx.beginPath();
          ctx.moveTo(r * 0.2, 0);
          ctx.quadraticCurveTo(-r * 0.5, r * 0.8, -r * 0.8, 0);
          ctx.quadraticCurveTo(-r * 0.5, -r * 0.8, r * 0.2, 0);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(r * 0.3, 0);
          ctx.quadraticCurveTo(-r * 0.3, r * 0.6, -r * 0.6, 0);
          ctx.quadraticCurveTo(-r * 0.3, -r * 0.6, r * 0.3, 0);
          ctx.fill();
          ctx.strokeStyle = highlight;
          ctx.lineWidth = r * 0.12;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(-r * 0.1, -r * 0.25);
          ctx.quadraticCurveTo(-r * 0.25, 0, -r * 0.1, r * 0.25);
          ctx.stroke();
          ctx.restore();
        };

        drawDorsalScale(0, 0, radius, '#29221d', 'rgba(255, 255, 255, 0.15)');
        drawDorsalScale(-radius*0.15, -radius*0.4, radius*0.6, '#473d34', 'rgba(255, 255, 255, 0.1)');
        drawDorsalScale(-radius*0.15, radius*0.4, radius*0.6, '#473d34', 'rgba(255, 255, 255, 0.1)');
        
        ctx.restore();
      } else if (snake.skinId === 'necromancer') {
        // Rib cage look (Bone tail removed as requested)
        ctx.save();
        ctx.translate(trail[i].x, trail[i].y);
        const nextSeg = trail[i - pointsPerSegment] || trail[i];
        const angle = Math.atan2(nextSeg.y - trail[i].y, nextSeg.x - trail[i].x);
        ctx.rotate(angle);
        
        // Spine
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(-r/2, -r/4, r, r/2);
        
        // Ribs
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 3;
        ctx.beginPath();
        // Top rib
        ctx.moveTo(0, -r/4);
        ctx.quadraticCurveTo(r, -r, 0, -r * 1.2);
        // Bottom rib
        ctx.moveTo(0, r/4);
        ctx.quadraticCurveTo(r, r, 0, r * 1.2);
        ctx.stroke();
        ctx.restore();
      } else if (isSpecialSkin) {
        const sides = 6;
        const angleStep = (Math.PI * 2) / sides;
        ctx.moveTo(trail[i].x + r * Math.cos(0), trail[i].y + r * Math.sin(0));
        for (let s = 1; s <= sides; s++) {
          ctx.lineTo(trail[i].x + r * Math.cos(s * angleStep), trail[i].y + r * Math.sin(s * angleStep));
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.arc(trail[i].x, trail[i].y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isSpecialSkin) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (isTail && snake.tailEmoji) {
        ctx.save();
        // Point tail away from the next segment
        const nextSegment = trail[i - pointsPerSegment] || trail[i];
        const dx = trail[i].x - nextSegment.x;
        const dy = trail[i].y - nextSegment.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        // Si es phoenix, lo movemos un poco más atrás para que "flote" fuera del orbe
        const offset = snake.skinId === 'phoenix' ? r * 1.2 : 0;
        ctx.translate(trail[i].x + (dx/dist) * offset, trail[i].y + (dy/dist) * offset);

        const tailAngle = Math.atan2(dy, dx) + Math.PI / 2;
        ctx.rotate(tailAngle);
        
        // Fenix Eterno tail emoji should be a bit smaller (r * 1.8 instead of r * 2.5)
        const emojiSizeMultiplier = snake.skinId === 'phoenix' ? 1.8 : 2.5;
        const fontSize = Math.max(12, r * emojiSizeMultiplier);
        ctx.font = `${fontSize}px Arial`;
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(snake.tailEmoji, 0, 0);
        ctx.restore();
      }

      if (snake.isBoosting && Math.random() > 0.8) {
        ctx.save();
        ctx.shadowBlur = 5;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(trail[i].x + (Math.random() - 0.5) * r * 3, trail[i].y + (Math.random() - 0.5) * r * 3, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (snake.hasAura && Math.random() > 0.7) {
        ctx.save();
        let rSize = 2;
        if (snake.auraType === 'fire') {
          ctx.fillStyle = `rgba(255, ${Math.floor(Math.random() * 100 + 50)}, 0, 0.5)`;
        } else if (snake.auraType === 'ice') {
          ctx.fillStyle = `rgba(${Math.floor(Math.random() * 50 + 200)}, 255, 255, 0.5)`;
        } else if (snake.auraType === 'water') {
          ctx.fillStyle = `rgba(147, 197, 253, 0.6)`;
        } else if (snake.auraType === 'death') {
          ctx.fillStyle = `rgba(75, 85, 99, 0.4)`;
        } else if (snake.auraType === 'crystal') {
          ctx.fillStyle = `rgba(255, 255, 255, 0.6)`;
          rSize = Math.random() * 2 + 1;
        } else if (snake.auraType === 'ember') {
          ctx.fillStyle = '#ef4444';
        } else if (snake.auraType === 'nebula') {
          if (['dragon_fuego'].includes(snake.skinId || '')) { ctx.restore(); return; }
          ctx.fillStyle = '#ec4899';
        }
        ctx.beginPath();
        ctx.arc(trail[i].x + (Math.random() - 0.5) * r * 3, trail[i].y + (Math.random() - 0.5) * r * 3, rSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    const head = trail[0];
    
    if (snake.skinId === 'dragon_fuego') {
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(snake.angle);

      const radius = hRadius;
      const s = radius * 2.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // --- 1. CUERNOS DE HUESO ---
      const drawHorns = (side: number) => {
          ctx.save(); 
          ctx.scale(1, side);
          ctx.fillStyle = "#F2D8B3";
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = s * 0.1;

          // Cuerno Superior Grande (Achicado)
          ctx.beginPath();
          ctx.moveTo(-s*0.1, -s*0.3);
          ctx.quadraticCurveTo(-s*0.3, -s*0.6, -s*0.35, -s*0.9);
          ctx.quadraticCurveTo(0, -s*0.6, s*0.1, -s*0.4);
          ctx.fill(); ctx.stroke();

          // Cuerno Medio (Achicado)
          ctx.beginPath();
          ctx.moveTo(s*0.1, -s*0.4);
          ctx.quadraticCurveTo(s*0.05, -s*0.55, 0, -s*0.7);
          ctx.quadraticCurveTo(s*0.25, -s*0.55, s*0.25, -s*0.4);
          ctx.fill(); ctx.stroke();

          // Cuerno Pequeño Frontal (Achicado)
          ctx.beginPath();
          ctx.moveTo(s*0.3, -s*0.4);
          ctx.quadraticCurveTo(s*0.25, -s*0.5, s*0.2, -s*0.55);
          ctx.quadraticCurveTo(s*0.35, -s*0.5, s*0.4, -s*0.4);
          ctx.fill(); ctx.stroke();
          ctx.restore();
      };
      drawHorns(1); 
      drawHorns(-1);

      // --- 2. BASE DE LA CABEZA ---
      ctx.fillStyle = "#796B75"; 
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = s * 0.12; 

      const headShape = new Path2D();
      headShape.moveTo(-s*0.4, 0);
      headShape.lineTo(-s*0.5, -s*0.1);
      headShape.lineTo(-s*0.4, -s*0.2);
      headShape.lineTo(-s*0.5, -s*0.3);
      headShape.lineTo(-s*0.3, -s*0.4);
      headShape.quadraticCurveTo(s*0.1, -s*0.6, s*0.45, -s*0.4);
      headShape.lineTo(s*0.5, -s*0.2);
      headShape.lineTo(s*0.8, -s*0.2);
      headShape.quadraticCurveTo(s*1.1, -s*0.1, s*1.1, 0);
      headShape.quadraticCurveTo(s*1.1, s*0.1, s*0.8, s*0.2);
      headShape.lineTo(s*0.5, s*0.2);
      headShape.lineTo(s*0.45, s*0.4);
      headShape.quadraticCurveTo(s*0.1, s*0.6, -s*0.3, s*0.4);
      headShape.lineTo(-s*0.5, s*0.3);
      headShape.lineTo(-s*0.4, s*0.2);
      headShape.lineTo(-s*0.5, s*0.1);
      headShape.closePath();

      ctx.stroke(headShape);
      ctx.fill(headShape);

      // --- 3. PATRONES OSCUROS ---
      ctx.fillStyle = "#5C4E57"; 
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = s * 0.08;

      const drawBrow = (side: number) => {
          ctx.save(); 
          ctx.scale(1, side);
          ctx.beginPath();
          ctx.moveTo(-s*0.2, 0);
          ctx.lineTo(-s*0.2, -s*0.2);
          ctx.lineTo(-s*0.3, -s*0.3);
          ctx.quadraticCurveTo(s*0.1, -s*0.5, s*0.4, -s*0.35);
          ctx.quadraticCurveTo(s*0.3, -s*0.1, s*0.2, -s*0.15);
          ctx.quadraticCurveTo(s*0.1, -s*0.3, -s*0.1, -s*0.15);
          ctx.lineTo(0, 0);
          ctx.fill(); 
          ctx.stroke();
          ctx.restore();
      };
      drawBrow(1); 
      drawBrow(-1);

      // --- 4. LÍNEAS DEL HOCICO ---
      ctx.beginPath();
      ctx.moveTo(s*0.2, -s*0.15);
      ctx.lineTo(s*0.8, -s*0.15);
      ctx.moveTo(s*0.2, s*0.15);
      ctx.lineTo(s*0.8, s*0.15);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(s*0.8, -s*0.15);
      ctx.quadraticCurveTo(s*0.7, 0, s*0.8, s*0.15);
      ctx.stroke();

      // --- 5. OJOS ---
      const drawEye = (side: number) => {
          ctx.save(); 
          ctx.scale(1, side);
          ctx.fillStyle = "#F8B81D";
          ctx.beginPath();
          ctx.moveTo(s*0.4, -s*0.25);
          ctx.lineTo(s*0.2, -s*0.1);
          ctx.lineTo(s*0.35, -s*0.12);
          ctx.closePath();
          ctx.fill();
          
          ctx.shadowBlur = 15;
          ctx.shadowColor = "#F8B81D";
          ctx.fill();
          ctx.restore();
      };
      drawEye(1); 
      drawEye(-1);

      // --- 6. FOSAS NASALES ---
      const drawNostril = (side: number) => {
          ctx.save(); 
          ctx.scale(1, side);
          ctx.fillStyle = "#000000";
          ctx.beginPath();
          ctx.moveTo(s*0.85, -s*0.08);
          ctx.quadraticCurveTo(s*1.0, -s*0.15, s*0.95, -s*0.02);
          ctx.quadraticCurveTo(s*0.9, -s*0.02, s*0.85, -s*0.08);
          ctx.fill();
          ctx.restore();
      };
      drawNostril(1); 
      drawNostril(-1);
      
      ctx.beginPath();
      ctx.moveTo(s*0.9, -s*0.25);
      ctx.quadraticCurveTo(s*1.2, 0, s*0.9, s*0.25);
      ctx.stroke();

      ctx.restore();
    } else if (snake.skinId === 'komodo') {
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(snake.angle);

      const radius = hRadius;
      const s = radius * 1.6;
      
      const time = Date.now() * 0.005;
      const flicker = Math.sin(time);
      if (Math.sin(time * 0.4) > 0.4) { 
          ctx.strokeStyle = "#e8c39e"; 
          ctx.lineWidth = 3; 
          ctx.beginPath();
          ctx.moveTo(s, 0);
          ctx.lineTo(s * 1.4 + flicker * s * 0.2, 0);
          ctx.lineTo(s * 1.7 + flicker * s * 0.3, -s * 0.2);
          ctx.moveTo(s * 1.4 + flicker * s * 0.2, 0);
          ctx.lineTo(s * 1.7 + flicker * s * 0.3, s * 0.2);
          ctx.stroke();
      }

      const headPath = new Path2D();
      headPath.moveTo(-s * 0.2, -s * 0.7); 
      headPath.quadraticCurveTo(s * 0.4, -s * 0.8, s * 0.8, -s * 0.5); 
      headPath.lineTo(s * 1.4, -s * 0.25); 
      headPath.quadraticCurveTo(s * 1.6, 0, s * 1.4, s * 0.25); 
      headPath.lineTo(s * 0.8, s * 0.5); 
      headPath.quadraticCurveTo(s * 0.4, s * 0.8, -s * 0.2, s * 0.7); 
      headPath.closePath();

      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 15;
      ctx.shadowOffsetY = 10;
      
      const headGrad = ctx.createRadialGradient(s * 0.5, 0, 0, s * 0.5, 0, s * 1.5);
      headGrad.addColorStop(0, '#6b5e52'); 
      headGrad.addColorStop(0.6, '#3b322a'); 
      headGrad.addColorStop(1, '#1c1714'); 

      ctx.fillStyle = headGrad;
      ctx.fill(headPath);
      ctx.shadowColor = 'transparent';

      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(s * 1.3, 0);
      ctx.moveTo(s * 0.3, 0); ctx.quadraticCurveTo(s*0.5, -s*0.2, s * 0.7, -s * 0.5);
      ctx.moveTo(s * 0.3, 0); ctx.quadraticCurveTo(s*0.5, s*0.2, s * 0.7, s * 0.5);
      ctx.moveTo(s * 0.9, 0); ctx.lineTo(s * 1.2, -s * 0.15);
      ctx.moveTo(s * 0.9, 0); ctx.lineTo(s * 1.2, s * 0.15);
      ctx.stroke();

      const eyeX = s * 0.65;
      const eyeY = s * 0.45;
      [1, -1].forEach(side => {
          ctx.save();
          ctx.translate(eyeX, side * eyeY);
          ctx.rotate(side * 0.1); 
          
          ctx.fillStyle = "#0a0807";
          ctx.beginPath();
          ctx.ellipse(0, 0, s*0.25, s*0.18, 0, 0, Math.PI * 2);
          ctx.fill();

          const iris = ctx.createRadialGradient(0, 0, 0, 0, 0, s*0.2);
          iris.addColorStop(0, "#c29129");
          iris.addColorStop(0.5, "#7a560e");
          iris.addColorStop(1, "#291c01");
          ctx.fillStyle = iris;
          ctx.beginPath();
          ctx.ellipse(0, 0, s*0.2, s*0.14, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#000000";
          ctx.beginPath();
          ctx.ellipse(0, 0, s*0.07, s*0.07, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
          ctx.beginPath();
          ctx.ellipse(s*0.06, -s*0.05, s*0.05, s*0.03, -Math.PI/4, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
      });

      [1, -1].forEach(side => {
          ctx.fillStyle = "#000000";
          ctx.beginPath();
          ctx.ellipse(s * 1.35, side * s * 0.15, s*0.06, s*0.04, side * 0.3, 0, Math.PI * 2);
          ctx.fill();
      });

      ctx.restore();
    } else {
      ctx.fillStyle = snake.isBoosting ? '#fff' : snake.color1;
      ctx.beginPath(); ctx.arc(head.x, head.y, hRadius, 0, Math.PI * 2); ctx.fill();
    }
    
    ctx.shadowBlur = 0; 
    
    // Emoji Head support (Skip eyes/emoji if we just drew the realistic head)
    if (!['dragon_fuego', 'komodo'].includes(snake.skinId || '') && snake.skinEmoji && snake.skinEmoji !== '🟢') {
      ctx.save();
      ctx.translate(head.x, head.y);
      
      if (snake.skinId === 'phoenix') {
        // Doble emoji de fuego para el Fénix Eterno
        const angles = [snake.angle + (60 * Math.PI / 180), snake.angle + (120 * Math.PI / 180)];
        ctx.font = `${hRadius * 2.2}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        angles.forEach(angle => {
          ctx.save();
          ctx.rotate(angle);
          ctx.fillText(snake.skinEmoji, 0, 0);
          ctx.restore();
        });
      } else {
        let emojiAngle = snake.angle + Math.PI / 2;
        if (snake.skinId === 'water_eternal') {
          emojiAngle += Math.PI; // Invert droplet
        }
        ctx.rotate(emojiAngle);
        ctx.font = `${hRadius * 2.2}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(snake.skinEmoji, 0, 0);
      }
      ctx.restore();
    } else {
      const eyeOff = (hasGrosor && snake.userId === user.id) ? CELL / 2 : CELL / 4;
      const ex1 = head.x + Math.cos(snake.angle - 0.5) * eyeOff;
      const ey1 = head.y + Math.sin(snake.angle - 0.5) * eyeOff;
      const ex2 = head.x + Math.cos(snake.angle + 0.5) * eyeOff;
      const ey2 = head.y + Math.sin(snake.angle + 0.5) * eyeOff;
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(ex1, ey1, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, 3, 0, Math.PI * 2); ctx.fill();
    }
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(snake.displayName, head.x, head.y - 10 - bodyRadius);
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

  const handleTouchStart = (e: TouchEvent) => {
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

  const handleTouchMove = (e: TouchEvent) => {
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

      {/* Ability Buttons Section */}
      <div className="absolute bottom-6 left-4 z-[70] flex flex-row items-end gap-4 pointer-events-auto">
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

        {hasBoostCooldown && (
          <div className="relative">
            <button
              onMouseDown={() => !isOverheated && setIsBoosting(true)}
              onMouseUp={() => setIsBoosting(false)}
              onMouseLeave={() => setIsBoosting(false)}
              onTouchStart={(e) => { e.preventDefault(); !isOverheated && setIsBoosting(true); }}
              onTouchEnd={() => setIsBoosting(false)}
              className={`flex h-16 w-16 items-center justify-center rounded-full border-4 transition-all active:scale-95 ${isOverheated ? 'border-red-600 bg-red-900/50 text-red-500 cursor-not-allowed' : (isBoosting ? 'border-blue-400 bg-blue-500 text-white shadow-lg shadow-blue-500/50' : 'border-blue-600 bg-blue-900/30 text-blue-400')}`}
            >
              <Zap size={32} className={isBoosting ? 'animate-pulse' : ''} />
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50" cy="50" r="45"
                  fill="none" stroke="currentColor" strokeWidth="4"
                  strokeDasharray={`${(boostCharge / 5) * 283} 283`}
                  className="transition-all duration-100"
                />
              </svg>
            </button>
            <span className={`mt-2 block text-center text-[10px] font-black uppercase ${isOverheated ? 'text-red-500 animate-bounce' : 'text-blue-400'}`}>
              {isOverheated ? `RECALENTADO (${Math.ceil(cooldownTime)}s)` : 'IMPULSO'}
            </span>
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

      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-4 rounded-2xl bg-black/60 p-3 backdrop-blur-md border border-white/10 shadow-2xl">
        <div className="flex items-center gap-2 pr-4 border-r border-white/10">
          <Trophy className="text-yellow-500" size={20} />
          <span className="text-2xl font-black italic tracking-tighter text-white uppercase">{score}</span>
        </div>
        <div className="flex items-center gap-2">
          <GoldPointIcon size={14} />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Saldo:</span>
          <span className="text-sm font-black text-yellow-500">{user.coins}</span>
        </div>
      </div>

      {/* Active Powerups UI removed */}
      <div className="pointer-events-none absolute left-4 top-24 flex flex-col gap-2">
      </div>

      {/* Floating Collect Button - Moved to the right side with pointer-events enabled */}
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
            className="flex flex-col items-center gap-4 rounded-3xl bg-gray-900/90 p-8 text-center backdrop-blur-xl border border-gray-700"
          >
            <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">PUNTOS TERMINADO</h2>
            <p className="text-gray-400">Puntuación alcanzada: {score}</p>
            <button
              onClick={onGameOver}
              className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-3 font-bold text-white hover:bg-blue-500"
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
            <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">¡PUNTOS EXITOSO!</h2>
            <p className="text-green-100">Has recolectado exitosamente tus puntos de práctica.</p>
            <div className="flex flex-col items-center gap-1 my-2">
              <div className="flex items-center gap-2 text-5xl font-black text-yellow-500">
                <Coins size={40} />
                <span>+{score}</span>
              </div>
              <p className="text-xs font-bold text-green-400 uppercase tracking-widest">Sumados a tu puntaje general</p>
              <div className="mt-2 rounded-lg bg-black/30 px-4 py-1 text-sm font-bold text-white">
                Saldo Total: {user.coins}
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
