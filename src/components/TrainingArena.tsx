import { useEffect, useRef, useState } from 'react';
import { User, PlayerSession, Food, Point } from '../types';
import { WORLD_W, WORLD_H, BASE_SPEED, CELL, ALL_SKINS } from '../constants';
import { doc, updateDoc, increment } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowLeft, Zap, Bot, Coins, LogOut } from 'lucide-react';
import { soundManager } from '../lib/sounds';

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

  const playerRef = useRef<PlayerSession>({
    id: 'player',
    userId: user.id,
    displayName: user.displayName,
    segments: Array.from({ length: 10 }, (_, i) => ({ x: WORLD_W / 2 - i * CELL, y: WORLD_H / 2 })),
    angle: 0,
    wager: 0,
    isAlive: true,
    lastUpdate: Date.now(),
    color1: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[0] || '#22ff44',
    color2: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[1] || '#11cc33',
  });

  const botsRef = useRef<PlayerSession[]>([]);

  const mouseRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cameraRef = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 });

  useEffect(() => {
    // Initial bots
    const initialBots: PlayerSession[] = [];
    for (let i = 0; i < botCount; i++) {
      initialBots.push({
        id: `bot-${i}`,
        userId: `bot-${i}`,
        displayName: `IA Entrenadora ${i + 1}`,
        segments: Array.from({ length: 15 }, (_, j) => ({ 
          x: Math.random() * WORLD_W - j * CELL, 
          y: Math.random() * WORLD_H 
        })),
        angle: Math.random() * Math.PI * 2,
        wager: 0,
        isAlive: true,
        lastUpdate: Date.now(),
        color1: i % 2 === 0 ? '#ff4422' : '#ff8822',
        color2: i % 2 === 0 ? '#cc3311' : '#cc6611',
      });
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
    const newX = head.x + Math.cos(playerRef.current.angle) * speed * dt;
    const newY = head.y + Math.sin(playerRef.current.angle) * speed * dt;

    if (newX < 0 || newX > WORLD_W || newY < 0 || newY > WORLD_H) {
      handleDeath();
      return;
    }

    const newSegments = [{ x: newX, y: newY }, ...playerRef.current.segments];
    const targetLen = 10 + score * 4;
    while (newSegments.length > targetLen) {
      newSegments.pop();
    }
    playerRef.current.segments = newSegments;

    cameraRef.current.x += (head.x - cameraRef.current.x) * 0.1;
    cameraRef.current.y += (head.y - cameraRef.current.y) * 0.1;
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

    // Bounce off walls
    if (newX < 0 || newX > WORLD_W || newY < 0 || newY > WORLD_H) {
      bot.angle += Math.PI;
    }

    const newSegments = [{ x: newX, y: newY }, ...bot.segments];
    const targetLen = 15 + Math.floor(bot.wager * 4);
    while (newSegments.length > targetLen) {
      newSegments.pop();
    }
    bot.segments = newSegments;
  };

  const checkCollisions = () => {
    const head = playerRef.current.segments[0];

    // Player food collision
    const remaining = foodsRef.current.filter(f => {
      const d = Math.sqrt((head.x - f.x) ** 2 + (head.y - f.y) ** 2);
      if (d < CELL) {
        setScore(s => s + f.value);
        
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

    // Collision detection (Head vs Body)
    botsRef.current.forEach(bot => {
      if (!bot.isAlive) return;

      // Player head vs Bot body
      bot.segments.forEach(seg => {
        const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
        if (d < CELL) {
          handleDeath();
        }
      });

      // Bot head vs Player body
      const botHead = bot.segments[0];
      playerRef.current.segments.forEach(seg => {
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

      // Bot head vs Other bot body
      botsRef.current.forEach(otherBot => {
        if (bot.id === otherBot.id || !otherBot.isAlive) return;
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
    });
  };

  const handleDeath = () => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    playerRef.current.isAlive = false;
    soundManager.play('death');
    soundManager.stopBoost();
  };

  const handleCollect = async () => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    setIsCollecting(true);
    playerRef.current.isAlive = false;

    soundManager.play('collect');
    soundManager.stopBoost();

    // Update user coins (credit training score)
    const userRef = doc(db, 'users', user.id);
    await updateDoc(userRef, {
      coins: increment(score),
      highScore: Math.max(user.highScore, score)
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
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

    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);
    ctx.translate(-cameraRef.current.x, -cameraRef.current.y);

    // Grid
    ctx.strokeStyle = 'rgba(34,136,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let y = 0; y <= WORLD_H; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    // Food
    foodsRef.current.forEach(f => {
      ctx.fillStyle = f.color || '#ef4444';
      ctx.shadowBlur = f.value > 1 ? 10 : 0;
      ctx.shadowColor = f.color || '#ef4444';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.value > 1 ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
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
    const mapSize = 150;
    const padding = 20;
    const x = window.innerWidth - mapSize - padding;
    const y = window.innerHeight - mapSize - padding;
    const zoom = 0.05; // Mini-map zoom level

    ctx.save();
    ctx.translate(x, y);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(0, 0, mapSize, mapSize);
    ctx.fill();
    ctx.stroke();
    ctx.clip();

    // Minimap Label
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('RADAR ENTRENAMIENTO', 8, 15);

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
    const segs = snake.segments;
    for (let i = segs.length - 1; i >= 1; i--) {
      const t = i / segs.length;
      const r = (CELL / 2) * (0.5 + (1 - t) * 0.5);
      ctx.fillStyle = i % 2 === 0 ? snake.color1 : snake.color2;
      ctx.beginPath();
      ctx.arc(segs[i].x, segs[i].y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const head = segs[0];
    ctx.fillStyle = snake.color1;
    ctx.beginPath(); ctx.arc(head.x, head.y, CELL / 2 + 2, 0, Math.PI * 2); ctx.fill();
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(snake.displayName, head.x, head.y - 15);
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

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseMove={(e) => { mouseRef.current = { x: e.clientX, y: e.clientY }; }}
        onMouseDown={() => setIsBoosting(true)}
        onMouseUp={() => setIsBoosting(false)}
        className="h-full w-full cursor-none"
      />

      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-blue-900/50 p-3 backdrop-blur-md border border-blue-500/30">
            <Bot className="text-blue-400" />
            <span className="text-xs font-bold text-blue-200 uppercase tracking-widest">Modo Entrenamiento</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-yellow-600/30 p-3 backdrop-blur-md border border-yellow-500/30">
            <Coins className="text-yellow-500" size={20} />
            <span className="text-lg font-bold text-white">{user.coins}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-black/50 p-3 backdrop-blur-md w-fit">
          <Trophy className="text-yellow-500" />
          <span className="text-2xl font-black text-white">{score}</span>
        </div>
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
            className="flex flex-col items-center gap-4 rounded-3xl bg-gray-900/90 p-8 text-center backdrop-blur-xl border border-gray-700"
          >
            <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">ENTRENAMIENTO TERMINADO</h2>
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
            <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">¡ENTRENAMIENTO EXITOSO!</h2>
            <p className="text-green-100">Has recolectado exitosamente tus puntos de práctica.</p>
            <div className="flex flex-col items-center gap-1 my-2">
              <div className="flex items-center gap-2 text-5xl font-black text-yellow-500">
                <Coins size={40} />
                <span>+{score} 🗿</span>
              </div>
              <p className="text-xs font-bold text-green-400 uppercase tracking-widest">Sumados a tu puntaje general</p>
              <div className="mt-2 rounded-lg bg-black/30 px-4 py-1 text-sm font-bold text-white">
                Saldo Total: {user.coins} 🗿
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
