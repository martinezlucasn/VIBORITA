import React, { useEffect, useRef, useState, FormEvent } from 'react';
import { User, PlayerSession, Food, Point } from '../types';
import { WORLD_W, WORLD_H, BASE_SPEED, CELL, ALL_SKINS } from '../constants';
import { doc, setDoc, deleteDoc, onSnapshot, collection, query, where, serverTimestamp, addDoc, updateDoc, increment, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Coins, ArrowLeft, Zap, LogOut, MessageSquare, Send, Users, X } from 'lucide-react';
import { soundManager } from '../lib/sounds';
import { ChatMessage, KillEvent } from '../types';

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
  const foodsRef = useRef<Record<string, Food>>({});
  const [isBoosting, setIsBoosting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [kills, setKills] = useState<KillEvent[]>([]);
  const [finalBalance, setFinalBalance] = useState<number | null>(null);

  const playerRef = useRef<PlayerSession>({
    id: user.id,
    userId: user.id,
    displayName: user.displayName,
    segments: Array.from({ length: 8 + Math.floor(wager) }, (_, i) => ({ x: WORLD_W / 2 - i * CELL, y: WORLD_H / 2 })),
    angle: 0,
    wager: wager,
    isAlive: true,
    lastUpdate: Date.now(),
    color1: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[0] || '#22ff44',
    color2: ALL_SKINS.find(s => s.id === user.equippedSkin)?.colors[1] || '#11cc33',
  });

  const mouseRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cameraRef = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 });
  const initialCoinsRef = useRef(user.coins);
  const pendingFoodDeletions = useRef<string[]>([]);

  useEffect(() => {
    // 1. Initialize player in Firestore
    const playerDocRef = doc(db, 'arenaPlayers', user.id);
    setDoc(playerDocRef, { ...playerRef.current, lastUpdate: Date.now() })
      .catch(e => handleFirestoreError(e, OperationType.WRITE, 'arenaPlayers/' + user.id));

    // 2. Listen for other players
    const playersQuery = query(collection(db, 'arenaPlayers'), where('isAlive', '==', true));
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
    const unsubFood = onSnapshot(collection(db, 'arenaFood'), (snapshot) => {
      const newFoods: Record<string, Food> = {};
      snapshot.forEach((doc) => {
        newFoods[doc.id] = { id: doc.id, ...doc.data() } as Food;
      });
      foodsRef.current = newFoods;

      // Simple food spawning logic: REMOVED as per request
      /*
      if (snapshot.size < 50) {
        const spawnCount = 50 - snapshot.size;
        for (let i = 0; i < spawnCount; i++) {
          addDoc(collection(db, 'arenaFood'), {
            x: Math.random() * WORLD_W,
            y: Math.random() * WORLD_H,
            value: 1,
            type: 'normal',
            color: `hsl(${Math.random() * 360}, 70%, 50%)`
          }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'arenaFood'));
        }
      }
      */
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaFood'));

    // 4. Listen for chat
    const chatQuery = query(collection(db, 'arenaChat'), orderBy('timestamp', 'desc'), limit(50));
    const unsubChat = onSnapshot(chatQuery, (snapshot) => {
      const msgs: ChatMessage[] = [];
      snapshot.forEach((doc) => {
        msgs.push({ id: doc.id, ...doc.data() } as ChatMessage);
      });
      setMessages(msgs.reverse());
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaChat'));

    // 5. Listen for online count
    const sixtySecondsAgo = Date.now() - 60000;
    const onlineQuery = query(collection(db, 'users'), where('lastActive', '>', sixtySecondsAgo));
    const unsubOnline = onSnapshot(onlineQuery, (snapshot) => {
      setOnlineCount(snapshot.size);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'users'));

    // 6. Listen for kills
    const killsQuery = query(collection(db, 'arenaKills'), orderBy('timestamp', 'desc'), limit(5));
    const unsubKills = onSnapshot(killsQuery, (snapshot) => {
      const k: KillEvent[] = [];
      snapshot.forEach((doc) => {
        k.push({ id: doc.id, ...doc.data() } as KillEvent);
      });
      setKills(k);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaKills'));

    // 7. Game Loop
    let lastTime = performance.now();
    let frameCount = 0;

    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (isAlive && playerRef.current.isAlive) {
        updatePlayer(dt);
        checkCollisions();
        
        // Update Firestore every 360 frames to reduce writes (Optimization for Quota)
        // 360 frames is approx every 6 seconds at 60fps
        frameCount++;
        if (frameCount % 360 === 0) {
          updateDoc(playerDocRef, {
            segments: playerRef.current.segments,
            angle: playerRef.current.angle,
            wager: playerRef.current.wager,
            lastUpdate: Date.now()
          }).catch(e => {
            // Silently handle quota errors to prevent console spam
            const msg = e.message?.toLowerCase() || '';
            if (!msg.includes('resource-exhausted') && !msg.includes('quota-exceeded')) {
              handleFirestoreError(e, OperationType.UPDATE, 'arenaPlayers/' + user.id);
            }
          });

          // Process pending food deletions in a single burst every 6 seconds
          if (pendingFoodDeletions.current.length > 0) {
            const deletions = [...pendingFoodDeletions.current];
            pendingFoodDeletions.current = [];
            
            // We delete them individually but at a controlled rate
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
      // Mark as dead on cleanup
      updateDoc(playerDocRef, { isAlive: false });
    };
  }, [isAlive]);

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

    const speed = isBoosting && playerRef.current.wager > 0 ? BASE_SPEED * 2 : BASE_SPEED;
    if (isBoosting && playerRef.current.wager > 0) {
      playerRef.current.wager -= 0.1; // Consume 0.1 points per frame
      setScore(Math.floor(playerRef.current.wager));
    }
    const newX = head.x + Math.cos(playerRef.current.angle) * speed * dt;
    const newY = head.y + Math.sin(playerRef.current.angle) * speed * dt;

    // Wall collision
    if (newX < 0 || newX > WORLD_W || newY < 0 || newY > WORLD_H) {
      handleDeath();
      return;
    }

    const newSegments = [{ x: newX, y: newY }, ...playerRef.current.segments];
    const targetLen = 8 + Math.floor(playerRef.current.wager * 4);
    while (newSegments.length > targetLen) {
      newSegments.pop();
    }
    playerRef.current.segments = newSegments;

    // Update camera
    cameraRef.current.x += (head.x - cameraRef.current.x) * 0.1;
    cameraRef.current.y += (head.y - cameraRef.current.y) * 0.1;
  };

  const checkCollisions = () => {
    const head = playerRef.current.segments[0];

    // Food collision
    Object.entries(foodsRef.current).forEach(([id, food]: [string, Food]) => {
      const d = Math.sqrt((head.x - food.x) ** 2 + (head.y - food.y) ** 2);
      if (d < CELL) {
        // Add to pending deletions instead of immediate delete
        if (!pendingFoodDeletions.current.includes(id)) {
          pendingFoodDeletions.current.push(id);
        }
        
        playerRef.current.wager += food.value;
        setScore(Math.floor(playerRef.current.wager));
        
        // Play sound
        if (food.value >= 5) {
          soundManager.play('goldFood');
        } else {
          soundManager.play('food');
        }
      }
    });

    // Other players collision (only head vs body)
    Object.values(otherPlayersRef.current).forEach((other: PlayerSession) => {
      other.segments.forEach((seg, i) => {
        // We only die if OUR head hits THEIR segments
        const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
        if (d < CELL) {
          // Collision detected!
          // If it's head-to-head (i=0) or head-to-body (i>0)
          handleDeath(other.displayName);
        }
      });
    });
  };

  const handleDeath = async (killerName?: string) => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    playerRef.current.isAlive = false;
    
    soundManager.play('death');
    soundManager.stopBoost();

    if (killerName) {
      await addDoc(collection(db, 'arenaKills'), {
        killerName,
        victimName: user.displayName,
        timestamp: Date.now()
      }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'arenaKills'));
    }
    
    const finalScore = Math.floor(playerRef.current.wager);
    const playerDocRef = doc(db, 'arenaPlayers', user.id);
    await updateDoc(playerDocRef, { isAlive: false })
      .catch(e => handleFirestoreError(e, OperationType.UPDATE, 'arenaPlayers/' + user.id));

    // Drop food (Optimized: Fewer items, higher value to save quota)
    const segments = playerRef.current.segments;
    const totalValue = playerRef.current.wager;
    const foodCount = Math.min(8, Math.floor(segments.length / 4) + 1);
    const valuePerFood = Math.floor(totalValue / foodCount);

    for (let i = 0; i < foodCount; i++) {
      const seg = segments[Math.floor(i * (segments.length / foodCount))];
      addDoc(collection(db, 'arenaFood'), {
        x: seg.x + (Math.random() - 0.5) * 40,
        y: seg.y + (Math.random() - 0.5) * 40,
        value: valuePerFood,
        type: 'dropped',
        color: playerRef.current.color1
      }).catch(() => {}); // Silently fail on quota
    }

    // Update user highScore
    const userRef = doc(db, 'users', user.id);
    const earnings = Math.floor(Math.max(0, playerRef.current.wager - wager));
    
    await updateDoc(userRef, {
      coins: increment(earnings),
      highScore: Math.max(user.highScore, finalScore)
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
  };

  const handleCollect = async () => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    setIsCollecting(true);
    playerRef.current.isAlive = false;

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
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const msg = chatInput.trim();
    setChatInput('');

    await addDoc(collection(db, 'arenaChat'), {
      userId: user.id,
      displayName: user.displayName,
      text: msg,
      timestamp: Date.now()
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
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);
    ctx.translate(-cameraRef.current.x, -cameraRef.current.y);

    // Draw Grid
    ctx.strokeStyle = 'rgba(34,136,255,0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let y = 0; y <= WORLD_H; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }

    // Draw Border
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    // Draw Food
    Object.values(foodsRef.current).forEach((f: Food) => {
      ctx.fillStyle = f.color || '#ff3344';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 6, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Other Players
    Object.values(otherPlayersRef.current).forEach((p: PlayerSession) => {
      drawSnake(ctx, p);
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

    // Draw Player on minimap (always at center due to translation)
    ctx.fillStyle = '#22ff44';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 40, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  const drawSnake = (ctx: CanvasRenderingContext2D, snake: PlayerSession) => {
    const segs = snake.segments;
    if (segs.length < 2) return;

    // Body
    for (let i = segs.length - 1; i >= 1; i--) {
      const t = i / segs.length;
      const r = (CELL / 2) * (0.5 + (1 - t) * 0.5);
      ctx.fillStyle = i % 2 === 0 ? snake.color1 : snake.color2;
      ctx.beginPath();
      ctx.arc(segs[i].x, segs[i].y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head
    const head = segs[0];
    ctx.fillStyle = snake.color1;
    ctx.beginPath();
    ctx.arc(head.x, head.y, CELL / 2 + 2, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const eyeOff = CELL / 4;
    const ex1 = head.x + Math.cos(snake.angle - 0.5) * eyeOff;
    const ey1 = head.y + Math.sin(snake.angle - 0.5) * eyeOff;
    const ex2 = head.x + Math.cos(snake.angle + 0.5) * eyeOff;
    const ey2 = head.y + Math.sin(snake.angle + 0.5) * eyeOff;
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(ex1, ey1, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2, ey2, 3, 0, Math.PI * 2); ctx.fill();

    // Name
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(snake.displayName, head.x, head.y - 20);
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
        onTouchMove={(e) => { mouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchStart={() => setIsBoosting(true)}
        onTouchEnd={() => setIsBoosting(false)}
        className="h-full w-full cursor-none"
      />

      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-black/50 p-3 backdrop-blur-md border border-white/10">
            <Trophy className="text-yellow-500" />
            <span className="text-2xl font-black text-white">{score}</span>
          </div>
          <motion.div 
            key={finalBalance || (user.coins + score)}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.1, 1] }}
            className="flex items-center gap-2 rounded-xl bg-yellow-600/30 p-3 backdrop-blur-md border border-yellow-500/30"
          >
            <Coins className="text-yellow-500" size={20} />
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
        </div>
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
                <span className="text-xs font-black uppercase tracking-widest text-blue-400">Chat Global</span>
                <button onClick={() => setShowChat(false)} className="text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {messages.map((msg) => (
                  <div key={msg.id} className="text-sm">
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
        <AnimatePresence>
          {kills.map((kill) => (
            <motion.div
              key={kill.id}
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
              <p className="text-red-200">Perdiste tu apuesta de {wager} 🗿</p>
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
                <span>+{score} 🗿</span>
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
                  <span className="text-3xl font-black text-green-400">{initialCoinsRef.current + (score - wager)} 🗿</span>
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
