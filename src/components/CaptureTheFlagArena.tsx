import { useEffect, useRef, useState, TouchEvent } from 'react';
import { User, PlayerSession, Point } from '../types';
import { WORLD_W, WORLD_H, BASE_SPEED, CELL, ALL_SKINS, SEGMENT_DISTANCE } from '../constants';
import { doc, updateDoc, increment, setDoc, onSnapshot, collection, query, where, deleteDoc, addDoc, getDocs, getDoc, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowLeft, LogOut, Target, X, Timer, Flag, Play } from 'lucide-react';
import { soundManager } from '../lib/sounds';
import { io, Socket } from 'socket.io-client';

interface CTFPlayerSession extends PlayerSession {
  corner: number; // 0: TL, 1: TR, 2: BL, 3: BR
  hasFlag: number | null; // index of flag being carried (0-3)
  isEliminated: boolean;
}

interface CTFArenaProps {
  user: User;
  wager: number;
  onGameOver: () => void;
}

const COLORS = ['#ef4444', '#10b981', '#3b82f6', '#f8fafc']; // Red, Green, Blue, White
const CORNERS = [
  { x: 100, y: 100, name: 'Rojo' },
  { x: WORLD_W - 100, y: 100, name: 'Verde' },
  { x: 100, y: WORLD_H - 100, name: 'Azul' },
  { x: WORLD_W - 100, y: WORLD_H - 100, name: 'Blanco' }
];

export default function CaptureTheFlagArena({ user, wager, onGameOver }: CTFArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAlive, setIsAlive] = useState(true);
  const [isEliminated, setIsEliminated] = useState(false);
  const [isWinner, setIsWinner] = useState(false);
  const [serverId, setServerId] = useState<string | null>(null);
  const [playerCorner, setPlayerCorner] = useState<number | null>(null);
  const [roomStatus, setRoomStatus] = useState<'waiting' | 'playing'>('waiting');
  const socketRef = useRef<Socket | null>(null);
  
  const [flags, setFlags] = useState<{ x: number, y: number, carrierId: string | null, ownerCorner: number, active?: boolean }[]>([
    { x: CORNERS[0].x, y: CORNERS[0].y, carrierId: null, ownerCorner: 0, active: false },
    { x: CORNERS[1].x, y: CORNERS[1].y, carrierId: null, ownerCorner: 1, active: false },
    { x: CORNERS[2].x, y: CORNERS[2].y, carrierId: null, ownerCorner: 2, active: false },
    { x: CORNERS[3].x, y: CORNERS[3].y, carrierId: null, ownerCorner: 3, active: false }
  ]);
  const flagsRef = useRef(flags);

  const playerRef = useRef<CTFPlayerSession>({
    id: user.id,
    userId: user.id,
    displayName: user.displayName,
    segments: [],
    angle: 0,
    wager: wager,
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
    isBoosting: false,
    corner: -1,
    hasFlag: null,
    isEliminated: false
  });

  const otherPlayersRef = useRef<Record<string, CTFPlayerSession>>({});
  const mouseRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cameraRef = useRef({ x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1.2 });
  const [onlineCount, setOnlineCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showExitWarning, setShowExitWarning] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial call
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const initCTF = async () => {
      try {
        setIsLoading(true);
        const socket = io();
        socketRef.current = socket;

        socket.on("connect", () => {
          socket.emit("join_arena", {
            id: user.id,
            displayName: user.displayName,
            equippedSkin: user.equippedSkin,
            wager: wager,
            mode: 'ctf',
            color1: playerRef.current.color1,
            color2: playerRef.current.color2,
            skinEmoji: playerRef.current.skinEmoji,
            tailEmoji: playerRef.current.tailEmoji
          });
        });

        socket.on("joined_room", ({ roomId, corner, flags: serverFlags, playersCount, players, status }) => {
          setServerId(roomId);
          setPlayerCorner(corner);
          setOnlineCount(playersCount);
          if (status) setRoomStatus(status);
          
          if (serverFlags) {
            setFlags(serverFlags);
            flagsRef.current = serverFlags;
          }

          if (players) {
            players.forEach((p: CTFPlayerSession) => {
              const playerId = p.userId || p.id;
              if (playerId !== user.id) {
                otherPlayersRef.current[playerId] = {
                  ...p,
                  lastUpdate: Date.now()
                };
              }
            });
          }

          const base = CORNERS[corner];
          playerRef.current.corner = corner;
          playerRef.current.color1 = COLORS[corner];
          playerRef.current.color2 = COLORS[corner] + 'aa';
          
          cameraRef.current.x = base.x;
          cameraRef.current.y = base.y;
          
          playerRef.current.segments = Array.from({ length: 15 }, (_, i) => ({ 
            x: base.x + (corner % 2 === 0 ? 1 : -1) * i * SEGMENT_DISTANCE, 
            y: base.y 
          }));

          setIsLoading(false);
        });

        socket.on("player_joined", (data) => {
          if (data.playersCount) setOnlineCount(data.playersCount);
          const playerId = data.userId || data.id;
          if (playerId !== user.id) {
            const existing = otherPlayersRef.current[playerId] || {};
            otherPlayersRef.current[playerId] = {
              ...existing,
              ...data,
              lastUpdate: Date.now()
            } as any;
          }
        });

        socket.on("player_left", (data) => {
          if (data.playersCount) setOnlineCount(data.playersCount);
          const playerId = data.userId || data.id;
          if (playerId) {
            delete otherPlayersRef.current[playerId];
          }
        });

        socket.on("player_died", ({ id, userId, killerName }) => {
          const playerId = userId || id;
          if (playerId !== user.id) {
            delete otherPlayersRef.current[playerId];
          }
        });

        socket.on("player_moved", (data) => {
          const playerId = data.userId || data.id;
          if (playerId !== user.id) {
            const existing = otherPlayersRef.current[playerId] || {};
            otherPlayersRef.current[playerId] = {
              ...existing,
              ...data,
              lastUpdate: Date.now()
            };
          }
        });

        socket.on("ctf_flag_update", (data) => {
          setFlags(data.flags);
          flagsRef.current = data.flags;
        });

        socket.on("ctf_player_eliminated", ({ id, socketId }) => {
          if (id === user.id) {
            setIsEliminated(true);
            setIsAlive(false);
            playerRef.current.isEliminated = true;
            soundManager.play('death');
          } else {
            const playerId = id || socketId;
            if (playerId) {
              delete otherPlayersRef.current[playerId];
            }
          }
        });

        socket.on("ctf_defeated", ({ message, wagerLost }) => {
          setIsEliminated(true);
          setIsAlive(false);
          playerRef.current.isEliminated = true;
          soundManager.play('death');
          // We can use the message from server
        });

        socket.on("ctf_score", ({ scorerId, reward }) => {
          if (scorerId === user.id) {
            soundManager.play('goldFood');
            setIsWinner(true);
            setTimeout(() => setIsWinner(false), 3000);
          }
        });
        
        socket.on("ctf_game_start", ({ status }) => {
          setRoomStatus(status);
          soundManager.play('plim');
        });

        socket.on("room_full", ({ error }) => {
          alert(error);
          onGameOver();
        });

        socket.on("server_death", ({ killerName }) => {
           setIsAlive(false);
           soundManager.play('death');
        });

      } catch (e) {
        console.error("CTF Socket Init Err:", e);
        onGameOver();
      }
    };

    initCTF();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!serverId) return;

    // Game loop
    let lastTime = performance.now();
    const loop = (now: number) => {
      if (!isAlive) return;
      
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (isAlive && !playerRef.current.isEliminated) {
        updatePlayer(dt);
        checkCollisions(dt);
        
        if (socketRef.current?.connected) {
          socketRef.current.emit("update_position", {
            segments: playerRef.current.segments,
            angle: playerRef.current.angle,
            isBoosting: playerRef.current.isBoosting,
            hasFlag: playerRef.current.hasFlag
          });
        }
      }

      render();
      requestAnimationFrame(loop);
    };

    const animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [serverId, isAlive, isEliminated]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
        <motion.div
           animate={{ rotate: 360 }}
           transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
           className="mb-6 h-16 w-16 rounded-full border-4 border-red-500 border-t-transparent"
        />
        <h2 className="text-2xl font-black italic text-white uppercase tracking-tighter">Buscando Arena...</h2>
        <p className="mt-2 text-xs font-bold text-gray-500 uppercase tracking-widest text-center">Capture the Flag</p>
      </div>
    );
  }

  const handleAttemptExit = async () => {
    if (playerCorner === null) {
      onGameOver();
      return;
    }

    const myFlag = flagsRef.current.find(f => f.ownerCorner === playerCorner);
    if (!myFlag) {
      onGameOver();
      return;
    }

    const myBase = CORNERS[playerCorner];
    const isAtBase = Math.abs(myFlag.x - myBase.x) < 5 && Math.abs(myFlag.y - myBase.y) < 5 && myFlag.carrierId === null;

    if (isAtBase) {
      // Refund wager
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        monedas: increment(wager)
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
      
      onGameOver();
    } else {
      setShowExitWarning(true);
      setTimeout(() => setShowExitWarning(false), 3000);
    }
  };

  const updatePlayer = (dt: number) => {
    const head = playerRef.current.segments[0];
    if (!head) return;
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

    const speed = playerRef.current.isBoosting ? BASE_SPEED * 1.8 : BASE_SPEED;
    const newX = head.x + Math.cos(playerRef.current.angle) * speed * dt;
    const newY = head.y + Math.sin(playerRef.current.angle) * speed * dt;

    // Boundary
    const clampedX = Math.max(10, Math.min(WORLD_W - 10, newX));
    const clampedY = Math.max(10, Math.min(WORLD_H - 10, newY));

    const trail = [...playerRef.current.segments];
    const d = Math.sqrt((clampedX - head.x) ** 2 + (clampedY - head.y) ** 2);
    
    // Smooth movement: update head position
    trail[0] = { x: clampedX, y: clampedY };
    
    // If moved enough, push segments
    if (d > SEGMENT_DISTANCE / 2) {
      for (let i = trail.length - 1; i > 0; i--) {
        const seg = trail[i];
        const next = trail[i - 1];
        const angle = Math.atan2(next.y - seg.y, next.x - seg.x);
        seg.x = next.x - Math.cos(angle) * SEGMENT_DISTANCE;
        seg.y = next.y - Math.sin(angle) * SEGMENT_DISTANCE;
      }
    }
    
    playerRef.current.segments = trail;

    cameraRef.current.x += (head.x - cameraRef.current.x) * 0.1;
    cameraRef.current.y += (head.y - cameraRef.current.y) * 0.1;
  };

  const checkCollisions = (dt: number) => {
    const head = playerRef.current.segments[0];
    if (!head) return;

    // Flag pickup
    flagsRef.current.forEach((flag, idx) => {
      // NEW: Requirement - only pickup if owner is in the arena
      const ownerInArena = (Object.values(otherPlayersRef.current) as CTFPlayerSession[]).some(p => p.corner === flag.ownerCorner && !p.isEliminated);
      // Also check if I am the owner (actually pickup is for opponents only)
      
      if (flag.carrierId === null && flag.ownerCorner !== playerRef.current.corner && ownerInArena) {
        const d = Math.sqrt((head.x - flag.x) ** 2 + (head.y - flag.y) ** 2);
        // Requirement: Touch with head (smaller distance)
        if (d < CELL && playerRef.current.hasFlag === null) {
          // Pickup
          socketRef.current?.emit("ctf_pickup", { flagIndex: idx });
          playerRef.current.hasFlag = idx;
          soundManager.play('plim');
        }
      }
    });

    // Score flag
    if (playerRef.current.hasFlag !== null) {
      const myBase = CORNERS[playerRef.current.corner!];
      const d = Math.sqrt((head.x - myBase.x) ** 2 + (head.y - myBase.y) ** 2);
      // Requirement: Base size is CELL * 12, so half is CELL * 6
      if (d < CELL * 6) {
        socketRef.current?.emit("ctf_score", { flagIndex: playerRef.current.hasFlag });
        playerRef.current.hasFlag = null;
      }
    }

    // Steal from others / Collide
    (Object.values(otherPlayersRef.current) as CTFPlayerSession[]).forEach(other => {
      if (!other.segments || other.segments.length === 0) return;
      const otherHead = other.segments[0];
      
      const myHeadToOtherBody = (other.segments as Point[]).some(seg => {
         const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
         return d < CELL * 1.5;
      });

      if (myHeadToOtherBody && other.hasFlag !== null && playerRef.current.hasFlag === null) {
         socketRef.current?.emit("ctf_steal", { victimId: other.id });
         playerRef.current.hasFlag = other.hasFlag;
         soundManager.play('powerup');
      }
    });
  };

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);
    ctx.translate(-cameraRef.current.x, -cameraRef.current.y);

    // Arena Floor (Green Field)
    ctx.fillStyle = '#1b4332'; // Deep field green
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Draw Grass Details
    ctx.strokeStyle = '#143125';
    ctx.lineWidth = 2;
    for (let x = 100; x < WORLD_W; x += 250) {
      for (let y = 100; y < WORLD_H; y += 250) {
        // Add random offset based on coordinates (deterministic)
        const ox = (Math.sin(x * 0.01) * 40);
        const oy = (Math.cos(y * 0.01) * 40);
        
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox - 3, y + oy - 6);
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + 3, y + oy - 6);
        ctx.stroke();

        // Second blade
        if ((x + y) % 2 === 0) {
           ctx.beginPath();
           ctx.moveTo(x + ox + 15, y + oy + 10);
           ctx.lineTo(x + ox + 13, y + oy + 4);
           ctx.moveTo(x + ox + 15, y + oy + 10);
           ctx.lineTo(x + ox + 17, y + oy + 4);
           ctx.stroke();
        }
      }
    }

    // Draw Grid (Subtle)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_W; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let y = 0; y <= WORLD_H; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }

    // Draw Bases
    CORNERS.forEach((corner, i) => {
      ctx.fillStyle = COLORS[i] + '33';
      ctx.beginPath();
      // Draw Square Base - Requirement: Double the size (was CELL * 6)
      const size = CELL * 12;
      ctx.rect(corner.x - size / 2, corner.y - size / 2, size, size);
      ctx.fill();
      ctx.strokeStyle = COLORS[i];
      ctx.setLineDash([10, 10]);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Base label
      ctx.fillStyle = COLORS[i];
      ctx.font = 'bold 20px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(corner.name, corner.x, corner.y + size / 2 + 30);
    });

    // Draw Flags
    flagsRef.current.forEach((flag, i) => {
      if (flag.carrierId === null && flag.active) {
        ctx.save();
        // Requirement: Floating flag in the middle
        const float = Math.sin(Date.now() / 300) * 8;
        ctx.translate(flag.x, flag.y + float);
        
        // Flag icon
        ctx.fillStyle = COLORS[flag.ownerCorner];
        ctx.beginPath();
        ctx.moveTo(0, 0); 
        ctx.lineTo(0, -45); 
        ctx.lineTo(35, -35); 
        ctx.lineTo(0, -25);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Glow effect for flag
        ctx.shadowBlur = 20;
        ctx.shadowColor = COLORS[flag.ownerCorner];
        ctx.stroke();
        
        ctx.restore();
      }
    });

    // Draw Other Players
    (Object.values(otherPlayersRef.current) as CTFPlayerSession[]).forEach(p => {
      if (p.isEliminated) return;
      drawSnake(ctx, p);
    });

    // Draw My Player
    if (isAlive && !playerRef.current.isEliminated) {
      drawSnake(ctx, playerRef.current);
    }

    ctx.restore();

    // Draw Radar
    drawRadar(ctx, canvas);
  };

  const drawRadar = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const radarSize = 180; // Slightly larger
    const padding = 20;
    const radarX = canvas.width - radarSize - padding;
    const radarY = padding;

    ctx.save();
    ctx.translate(radarX, radarY);
    
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; // Darker
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Manual rounded rect for better compatibility
    const r = 10;
    ctx.moveTo(r, 0);
    ctx.lineTo(radarSize - r, 0);
    ctx.quadraticCurveTo(radarSize, 0, radarSize, r);
    ctx.lineTo(radarSize, radarSize - r);
    ctx.quadraticCurveTo(radarSize, radarSize, radarSize - r, radarSize);
    ctx.lineTo(r, radarSize);
    ctx.quadraticCurveTo(0, radarSize, 0, radarSize - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.fill();
    ctx.stroke();

    const scale = radarSize / WORLD_W;

    // Draw Bases
    CORNERS.forEach((corner, i) => {
      ctx.fillStyle = COLORS[i];
      ctx.beginPath();
      ctx.rect(corner.x * scale - 6, corner.y * scale - 6, 12, 12);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Draw Flags
    flagsRef.current.forEach((flag, i) => {
      if (!flag.active) return;
      ctx.fillStyle = COLORS[flag.ownerCorner];
      ctx.beginPath();
      ctx.arc(flag.x * scale, flag.y * scale, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Draw Other Players
    (Object.values(otherPlayersRef.current) as CTFPlayerSession[]).forEach(p => {
      if (p.isEliminated || !p.segments[0]) return;
      ctx.fillStyle = COLORS[p.corner];
      ctx.beginPath();
      ctx.arc(p.segments[0].x * scale, p.segments[0].y * scale, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw My Player
    if (isAlive && !playerRef.current.isEliminated && playerRef.current.segments[0]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(playerRef.current.segments[0].x * scale, playerRef.current.segments[0].y * scale, 5, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw Square for my base on radar too
      if (playerCorner !== null) {
        const myBase = CORNERS[playerCorner];
        ctx.strokeStyle = COLORS[playerCorner];
        ctx.lineWidth = 2;
        ctx.strokeRect(myBase.x * scale - 8, myBase.y * scale - 8, 16, 16);
      }

      // Blink effect
      if (Math.floor(Date.now() / 200) % 2 === 0) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(playerRef.current.segments[0].x * scale, playerRef.current.segments[0].y * scale, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  };

  const drawSnake = (ctx: CanvasRenderingContext2D, p: CTFPlayerSession) => {
    if (!p.segments || p.segments.length === 0) return;
    
    // Draw Aura
    if (p.hasAura) {
      const head = p.segments[0];
      const auraColor = p.color1 || '#ffffff';
      ctx.save();
      ctx.beginPath();
      ctx.arc(head.x, head.y, CELL * 3, 0, Math.PI * 2);
      try {
        const auraGrad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, CELL * 3);
        auraGrad.addColorStop(0, auraColor + '44');
        auraGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = auraGrad;
        ctx.fill();
      } catch (e) {
        ctx.fillStyle = auraColor + '22';
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw trail
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = CELL * 1.8;
    ctx.strokeStyle = p.color1 || '#ffffff';
    
    // Add shadow
    ctx.shadowBlur = 15;
    ctx.shadowColor = p.color1 || '#ffffff';
    
    p.segments.forEach((seg, i) => {
      if (i === 0) ctx.moveTo(seg.x, seg.y);
      else ctx.lineTo(seg.x, seg.y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw Head
    const head = p.segments[0];
    const headColor = p.color1 || '#ffffff';
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(p.angle);
    
    // Head Glow
    try {
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, CELL * 1.5);
      gradient.addColorStop(0, headColor);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 1.5, 0, Math.PI * 2);
      ctx.fill();
    } catch (e) {
      ctx.fillStyle = headColor;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Circular Head (replacing emojis)
    ctx.fillStyle = headColor;
    ctx.beginPath();
    ctx.arc(0, 0, CELL * 0.9, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyes
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(CELL * 0.3, -CELL * 0.3, 3, 0, Math.PI * 2);
    ctx.arc(CELL * 0.3, CELL * 0.3, 3, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();

    // Draw Flag if carrying
    if (p.hasFlag !== null) {
       ctx.save();
       ctx.translate(head.x, head.y - 35);
       // Animated float
       const float = Math.sin(Date.now() / 200) * 5;
       ctx.translate(0, float);
       
       // Flag stick
       ctx.strokeStyle = '#fff';
       ctx.lineWidth = 3;
       ctx.beginPath();
       ctx.moveTo(0, 0); ctx.lineTo(0, 25);
       ctx.stroke();
       
       // Flag fabric
       ctx.fillStyle = COLORS[p.hasFlag];
       ctx.beginPath();
       ctx.moveTo(0, 0); 
       ctx.lineTo(25, 7.5); 
       ctx.lineTo(0, 15);
       ctx.fill();
       
       ctx.restore();
    }
  };

  return (
    <div className="relative h-full w-full bg-black overflow-hidden touch-none select-none">
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="block"
        onMouseMove={(e) => (mouseRef.current = { x: e.clientX, y: e.clientY })}
        onMouseDown={() => (playerRef.current.isBoosting = true)}
        onMouseUp={() => (playerRef.current.isBoosting = false)}
        onTouchStart={(e) => {
          mouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          playerRef.current.isBoosting = true;
        }}
        onTouchEnd={() => (playerRef.current.isBoosting = false)}
        onTouchMove={(e) => (mouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      />

      <div className="absolute top-6 left-6 flex flex-col gap-4">
        <button onClick={handleAttemptExit} className="rounded-xl bg-white/10 p-3 backdrop-blur-md hover:bg-white/20 transition-all">
          <ArrowLeft className="text-white" />
        </button>
        <div className="rounded-2xl bg-black/60 p-4 border border-white/5 backdrop-blur-md">
           <div className="flex items-center gap-2 mb-2">
             <Target className="text-red-500" size={16} />
             <span className="text-xs font-black text-white uppercase tracking-tighter">CTF ARENA</span>
           </div>
           <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2">
             <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
             <span>{onlineCount}/4 JUGADORES</span>
           </div>
           <div className="mt-2 text-xl font-black text-white italic">
             {wager.toLocaleString()} <span className="text-[10px] text-blue-400 uppercase not-italic">Monedas</span>
           </div>
        </div>
      </div>

      <AnimatePresence>
        {roomStatus === 'waiting' && isAlive && !isEliminated && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px]"
          >
            <div className="flex flex-col items-center gap-6 rounded-3xl bg-black/60 p-12 border border-white/10 backdrop-blur-md">
              <div className="relative">
                <Timer size={48} className="text-red-500 animate-pulse" />
                <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-500 animate-ping" />
              </div>
              <div className="text-center">
                <h3 className="text-3xl font-black italic text-white uppercase tracking-tighter">Esperando Competidores</h3>
                <p className="mt-2 text-xs font-bold text-gray-400 uppercase tracking-[0.3em]">{onlineCount}/4 JUGADORES LISTOS</p>
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => socketRef.current?.emit("start_ctf_early")}
                className="group relative flex items-center gap-3 rounded-2xl bg-white px-8 py-4 transition-all hover:bg-blue-500"
              >
                <Play size={20} className="text-black group-hover:text-white" />
                <span className="text-lg font-black italic uppercase text-black group-hover:text-white">Continuar</span>
              </motion.button>
            </div>
          </motion.div>
        )}

        {showExitWarning && (
           <motion.div 
             key="exit-warning"
             initial={{ y: -50, opacity: 0 }}
             animate={{ y: 0, opacity: 1 }}
             exit={{ y: -50, opacity: 0 }}
             className="fixed top-24 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-red-600 px-6 py-3 shadow-2xl"
           >
             <p className="text-sm font-black text-white uppercase tracking-widest">
               RECUPERE LA BANDERA PARA SALIR.
             </p>
           </motion.div>
        )}

        {isEliminated && (
          <motion.div 
            key="elimination-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-8 text-center backdrop-blur-xl"
          >
            <div className="mb-6 rounded-full bg-red-600/20 p-8">
              <LogOut size={64} className="text-red-500" />
            </div>
            <h2 className="mb-2 text-5xl font-black italic tracking-tighter text-white uppercase">¡BANDERA ROBADA!</h2>
            <p className="mb-8 max-w-sm text-lg text-gray-400 font-medium leading-relaxed uppercase tracking-widest">
              Alguien ha llevado tu bandera a su base. Has perdido la apuesta de {wager.toLocaleString()} monedas.
            </p>
            <button 
              onClick={onGameOver}
              className="flex items-center gap-3 rounded-2xl bg-white px-12 py-5 text-xl font-black uppercase text-black shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-all hover:scale-105 active:scale-95"
            >
              CONTINUAR
            </button>
          </motion.div>
        )}

        {isWinner && (
          <motion.div 
            key="score-overlay"
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="pointer-events-none fixed top-1/4 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center"
          >
            <div className="rounded-full bg-yellow-500/20 p-4 border border-yellow-500/50">
              <Trophy size={48} className="text-yellow-500" />
            </div>
            <h3 className="mt-4 text-4xl font-black italic tracking-tighter text-yellow-500 uppercase">¡ANOTACIÓN!</h3>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-6 right-6 hidden md:block">
        <div className="rounded-2xl border border-white/5 bg-black/60 p-4 backdrop-blur-md">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Controles</div>
          <div className="text-xs text-white font-medium uppercase tracking-tight">Mueve el ratón para girar</div>
        </div>
      </div>
    </div>
  );
}
