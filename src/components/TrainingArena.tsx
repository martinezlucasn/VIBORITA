import { useEffect, useRef, useState, TouchEvent } from 'react';
import { User, PlayerSession, Food, Point } from '../types';
import { WORLD_W, WORLD_H, BASE_SPEED, CELL, ALL_SKINS, SEGMENT_DISTANCE } from '../constants';
import { doc, updateDoc, increment } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowLeft, Zap, Bot, Coins, LogOut } from 'lucide-react';
import { GoldPointIcon } from './Icons';
import { soundManager } from '../lib/sounds';
import { supabase } from '../lib/supabase';

interface TrainingArenaProps {
  user: User;
  botCount?: number;
  onGameOver: () => void;
}

export default function TrainingArena({ user, botCount = 1, onGameOver }: TrainingArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [isAlive, setIsAlive] = useState(true);
  const [isCollecting, setIsCollecting] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);
  const foodsRef = useRef<Food[]>([]);
  const lastTapRef = useRef<number>(0);
  const boostTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTouchBoostingRef = useRef(false);

  const playerRef = useRef<PlayerSession>({
    id: 'player',
    userId: user.id,
    displayName: user.displayName,
    segments: Array.from({ length: 10 }, (_, i) => ({ x: WORLD_W / 2 - i * SEGMENT_DISTANCE, y: WORLD_H / 2 })),
    angle: 0,
    wager: 0,
    isAlive: true,
    lastUpdate: Date.now(),
    spawnTime: Date.now(),
    color1: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[0] || '#22ff44',
    color2: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[1] || '#11cc33',
    skinEmoji: ALL_SKINS.find(s => s.id === user.equippedSkin)?.icon,
    hasAura: ALL_SKINS.find(s => s.id === user.equippedSkin)?.hasAura,
    auraType: ALL_SKINS.find(s => s.id === user.equippedSkin)?.auraType,
    isBoosting: false,
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

    // Initial food
    const initialFood: Food[] = [];
    for (let i = 0; i < 100; i++) {
      const isSpecial = Math.random() > 0.9;
      initialFood.push({
        id: Math.random().toString(),
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        value: isSpecial ? 10 : 1,
        type: isSpecial ? 'gold' : 'normal',
        color: isSpecial ? '#fbbf24' : '#ef4444' // Yellow (10) or Red (1)
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
        checkCollisions();
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

    const speed = isBoosting ? BASE_SPEED * 2 : BASE_SPEED;
    playerRef.current.isBoosting = isBoosting;
    if (isBoosting) {
      setScore(s => Math.max(0, s - 0.2 * dt * 60));
    }
    const newX = head.x + Math.cos(playerRef.current.angle) * speed * dt;
    const newY = head.y + Math.sin(playerRef.current.angle) * speed * dt;

    if (newX < 0 || newX > WORLD_W || newY < 0 || newY > WORLD_H) {
      handleDeath();
      return;
    }

    const trail = playerRef.current.segments;
    trail.unshift({ x: newX, y: newY });

    // Coherent growth: length grows linearly with score
    const pointsPerSegment = 5;
    const targetSegments = 10 + Math.floor(score);
    const maxTrailLen = targetSegments * pointsPerSegment;

    while (trail.length > maxTrailLen) {
      trail.pop();
    }
    playerRef.current.segments = trail;

    cameraRef.current.x += (head.x - cameraRef.current.x) * 0.1;
    cameraRef.current.y += (head.y - cameraRef.current.y) * 0.1;

    // Dynamic zoom based on snake length to see ~80% of it
    const targetZoom = Math.max(0.35, Math.min(1, 1200 / (maxTrailLen * 2 + 800)));
    cameraRef.current.zoom += (targetZoom - cameraRef.current.zoom) * 0.02;
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
    return {
      id: `bot-${index}-${Math.random().toString(36).substr(2, 5)}`,
      userId: `bot-${index}`,
      displayName: `${randomName} ${Math.random() > 0.7 ? Math.floor(Math.random() * 99) : ''}`.trim(),
      segments: Array.from({ length: 15 }, (_, j) => ({ 
        x: startX - j * SEGMENT_DISTANCE, 
        y: startY 
      })),
      angle: Math.random() * Math.PI * 2,
      wager: 0,
      isAlive: true,
      lastUpdate: Date.now(),
      spawnTime: Date.now(),
      color1: index % 2 === 0 ? '#ff4422' : '#ff8822',
      color2: index % 2 === 0 ? '#cc3311' : '#cc6611',
    };
  };

  const updateBot = (bot: PlayerSession, dt: number) => {
    const head = bot.segments[0];
    
    // Simple AI: find nearest food
    let nearestFood = foodsRef.current[0];
    let minDist = Infinity;
    foodsRef.current.forEach(f => {
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

    const speed = BASE_SPEED * 0.8;
    const newX = head.x + Math.cos(bot.angle) * speed * dt;
    const newY = head.y + Math.sin(bot.angle) * speed * dt;

    // Die at walls
    if (newX < 0 || newX > WORLD_W || newY < 0 || newY > WORLD_H) {
      bot.isAlive = false;
      // Drop food
      bot.segments.forEach((s, i) => {
        if (i % 5 === 0) {
          foodsRef.current.push({
            id: Math.random().toString(),
            x: s.x,
            y: s.y,
            value: 1,
            type: 'normal',
            color: bot.color1
          });
        }
      });
      return;
    }

    const trail = bot.segments;
    trail.unshift({ x: newX, y: newY });

    const pointsPerSegment = 5;
    const targetSegments = 15 + Math.floor(bot.wager);
    const maxTrailLen = targetSegments * pointsPerSegment;

    while (trail.length > maxTrailLen) {
      trail.pop();
    }
    bot.segments = trail;
  };

  const checkCollisions = () => {
    const head = playerRef.current.segments[0];
    let scoreGain = 0;

    // Player food collision
    const remaining = foodsRef.current.filter(f => {
      const d = Math.sqrt((head.x - f.x) ** 2 + (head.y - f.y) ** 2);
      if (d < CELL) {
        scoreGain += f.value;
        
        // Play sound
        if (f.value >= 5) {
          soundManager.play('goldFood');
        } else {
          soundManager.play('food');
        }
        
        return false;
      }
      
      // Bots food collision
      for (const bot of botsRef.current) {
        if (!bot.isAlive) continue;
        const botHead = bot.segments[0];
        const dBot = Math.sqrt((botHead.x - f.x) ** 2 + (botHead.y - f.y) ** 2);
        if (dBot < CELL) {
          bot.wager += f.value;
          return false;
        }
      }
      return true;
    });

    if (scoreGain > 0) {
      setScore(s => s + scoreGain);
    }
    
    // Respawn food
    while (remaining.length < 150) {
      const isSpecial = Math.random() > 0.9;
      remaining.push({
        id: Math.random().toString(),
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        value: isSpecial ? 10 : 1,
        type: isSpecial ? 'gold' : 'normal',
        color: isSpecial ? '#fbbf24' : '#ef4444'
      });
    }
    foodsRef.current = remaining;

    // Respawn bots to maintain constant count
    const aliveBots = botsRef.current.filter(b => b.isAlive);
    if (aliveBots.length < botCount) {
      // Add a new bot after a small delay (handled by the loop)
      // We can just add it immediately or with a chance
      if (Math.random() > 0.98) { // Approx 1 respawn attempt per second at 60fps
        botsRef.current.push(createBot(botsRef.current.length));
      }
    }

    // Collision detection (Head vs Body)
    const isPlayerInvulnerable = playerRef.current.spawnTime && (Date.now() - playerRef.current.spawnTime < 1500);

    botsRef.current.forEach(bot => {
      if (!bot.isAlive) return;
      const isBotInvulnerable = bot.spawnTime && (Date.now() - bot.spawnTime < 1500);

      // Player head vs Bot body
      if (!isPlayerInvulnerable && !isBotInvulnerable) {
        bot.segments.forEach(seg => {
          const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
          if (d < CELL) {
            handleDeath();
          }
        });
      }

      // Bot head vs Player body
      if (!isBotInvulnerable && !isPlayerInvulnerable) {
        const botHead = bot.segments[0];
        playerRef.current.segments.forEach(seg => {
          const d = Math.sqrt((botHead.x - seg.x) ** 2 + (botHead.y - seg.y) ** 2);
          if (d < CELL) {
            bot.isAlive = false;
            
            // Increment bot kills for the player
            if (user?.id) {
              const userRef = doc(db, 'users', user.id);
              updateDoc(userRef, {
                botKills: increment(1)
              }).catch((e) => console.error("Error updating bot kills:", e));
            }

            // Drop food where bot died along segments
            bot.segments.forEach((s, i) => {
              if (i % 2 === 0) { // Every 2 segments to avoid too many local objects
                foodsRef.current.push({
                  id: Math.random().toString(),
                  x: s.x,
                  y: s.y,
                  value: 2,
                  type: 'normal',
                  color: bot.color1
                });
              }
            });
          }
        });
      }

      // Bot head vs Other bot body
      if (!isBotInvulnerable) {
        botsRef.current.forEach(otherBot => {
          if (bot.id === otherBot.id || !otherBot.isAlive) return;
          const isOtherInvulnerable = otherBot.spawnTime && (Date.now() - otherBot.spawnTime < 1000);
          if (isOtherInvulnerable) return;

          const botHead = bot.segments[0];
          otherBot.segments.forEach(seg => {
            const d = Math.sqrt((botHead.x - seg.x) ** 2 + (botHead.y - seg.y) ** 2);
            if (d < CELL) {
              bot.isAlive = false;
              // Drop food where bot died
              bot.segments.forEach(s => {
                foodsRef.current.push({
                  id: Math.random().toString(),
                  x: s.x,
                  y: s.y,
                  value: 1,
                  type: 'normal',
                  color: bot.color1
                });
              });
            }
          });
        });
      }
    });
  };

  const handleDeath = () => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    playerRef.current.isAlive = false;
    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    soundManager.play('death');
    soundManager.stopBoost();

    // Drop food along segments
    playerRef.current.segments.forEach((s, i) => {
      if (i % 2 === 0) {
        foodsRef.current.push({
          id: Math.random().toString(),
          x: s.x,
          y: s.y,
          value: 2,
          type: 'normal',
          color: playerRef.current.color1
        });
      }
    });
  };

  const handleCollect = async () => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    setIsCollecting(true);
    playerRef.current.isAlive = false;

    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    soundManager.play('collect');
    soundManager.stopBoost();

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

    // Food - Instant and static
    foodsRef.current.forEach(f => {
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

    // Snakes
    botsRef.current.forEach(bot => {
      if (bot.isAlive) drawSnake(ctx, bot);
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
      }
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(trail[0].x, trail[0].y, auraRadius, 0, Math.PI * 2);
      ctx.fill();
      
      // Particles
      if (Math.random() > 0.6) {
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
    const head = trail[0];
    ctx.fillStyle = snake.isBoosting ? '#fff' : snake.color1;
    ctx.beginPath(); ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2); ctx.fill();
    
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
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(snake.displayName, head.x, head.y - 10 - baseRadius);
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
