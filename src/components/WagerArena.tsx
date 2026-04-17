import { useEffect, useRef, useState, TouchEvent } from 'react';
import { User, PlayerSession, Food, Point } from '../types';
import { WORLD_W, WORLD_H, BASE_SPEED, CELL, ALL_SKINS, SEGMENT_DISTANCE } from '../constants';
import { doc, updateDoc, increment, setDoc, onSnapshot, collection, query, where, deleteDoc, addDoc, getDocs, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowLeft, Zap, Coins, LogOut, Crown, ShieldCheck, X } from 'lucide-react';
import { soundManager } from '../lib/sounds';
import { supabase } from '../lib/supabase';

interface WagerArenaProps {
  user: User;
  wager: number;
  growthWager: number;
  category: string;
  onGameOver: () => void;
}

import { findAvailableServer } from '../lib/serverManager';
import { io, Socket } from 'socket.io-client';

interface CompetitionStats {
  wins: number;
  losses: number;
  coinsWon: number;
  coinsLost: number;
}

export default function WagerArena({ user, wager, growthWager, category, onGameOver }: WagerArenaProps) {
  const isPrivate = category.startsWith('private_');
  const worldW = isPrivate ? WORLD_W / 2 : WORLD_W;
  const worldH = isPrivate ? WORLD_H / 2 : WORLD_H;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [isAlive, setIsAlive] = useState(true);
  const [isWinner, setIsWinner] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [finalBalance, setFinalBalance] = useState(0);
  const [competitionStats, setCompetitionStats] = useState<CompetitionStats | null>(null);
  const [opponentInfo, setOpponentInfo] = useState<{ id: string, name: string } | null>(null);
  const [isBoosting, setIsBoosting] = useState(false);
  const [serverId, setServerId] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [topMonedas, setTopMonedas] = useState<string[]>([]); // IDs of top 10 players
  const socketRef = useRef<Socket | null>(null);
  const lastTapRef = useRef<number>(0);
  const boostTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTouchBoostingRef = useRef(false);
  
  const startX = Math.random() * worldW;
  const startY = Math.random() * worldH;

  const playerRef = useRef<PlayerSession>({
    id: user.id,
    userId: user.id,
    displayName: user.displayName,
    segments: Array.from({ length: 10 + Math.floor(growthWager * 3) }, (_, i) => ({ x: startX - i * SEGMENT_DISTANCE, y: startY })),
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
    isBoosting: false,
  });

  const otherPlayersRef = useRef<Record<string, PlayerSession>>({});
  const interpolatedPlayersRef = useRef<Record<string, PlayerSession>>({});
  const droppedCoinsRef = useRef<Food[]>([]);
  const mouseRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cameraRef = useRef({ x: worldW / 2, y: worldH / 2, zoom: 1 });
  const channelRef = useRef<any>(null);
  const initialWagerRef = useRef(wager);

  useEffect(() => {
    if (!isAlive && !isWinner && !isCollecting && category.startsWith('private_')) {
      const timer = setTimeout(() => {
        onGameOver();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isAlive, isWinner, isCollecting, category, onGameOver]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!serverId) setShowCancel(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [serverId]);

  useEffect(() => {
    const initServer = async () => {
      const id = await findAvailableServer('wagerPlayers');
      setServerId(id);
      playerRef.current.serverId = id;

      // Initialize Socket.io
      const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? window.location.origin 
        : 'https://ais-pre-q3rghkaneiw6ol5cicebm3-79875930852.us-east1.run.app';
        
      const socket = io(SERVER_URL);
      socketRef.current = socket;

      socket.on("connect", () => {
        console.log(`Connected to WebSocket server (Wager - ${category})`);
        // Use a prefix for the serverId based on category to separate players
        const categoryServerId = `${category}_${id}`;
        socket.emit("join_arena", {
          displayName: user.displayName,
          equippedSkin: user.equippedSkin,
          hasAura: playerRef.current.hasAura,
          auraType: playerRef.current.auraType,
          serverId: categoryServerId,
          wager: playerRef.current.wager,
          category: category
        });
      });

      socket.on("player_moved", (data) => {
        if (data.id !== user.id) {
          otherPlayersRef.current[data.id] = {
            ...data,
            lastUpdate: Date.now()
          };
        }
      });

      socket.on("server_death", ({ killerName }) => {
        console.log("Server confirmed death (Wager)!");
        handleDeath();
      });

      socket.on("player_died", async ({ id, wager: victimWager, segments: victimSegments, killerName }) => {
        if (id !== user.id) {
          // If I am the killer
          if (killerName === user.displayName && victimWager && victimSegments) {
            if (category.startsWith('private_')) {
              // In private rooms, coins are transferred directly to the winner's score
              setScore(s => s + victimWager);
              playerRef.current.wager += victimWager;
              soundManager.play('goldFood');
              
              // Trigger Win Logic for Private Room
              handleWin(victimWager);
            } else {
              // In public rooms, coins are dropped in the arena
              dropWagerCoins(victimWager, victimSegments);
            }
          }
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

    // 1. Initialize player in Firestore too for the server manager to work
    const playerDocRef = doc(db, 'wagerPlayers', user.id);
    updateDoc(playerDocRef, { serverId, category, isAlive: true, lastUpdate: Date.now() })
      .catch(() => {
        // If doc doesn't exist, set it
        setDoc(playerDocRef, { 
          id: user.id, 
          serverId, 
          category,
          isAlive: true, 
          lastUpdate: Date.now() 
        });
      });

    // 2. Listen for dropped coins in Firestore
    const coinsQuery = query(
      collection(db, 'wagerCoins'), 
      where('serverId', '==', serverId),
      where('category', '==', category)
    );
    const unsubCoins = onSnapshot(coinsQuery, (snapshot) => {
      const coins: Food[] = [];
      snapshot.forEach((doc) => {
        coins.push({ id: doc.id, ...doc.data() } as Food);
      });
      droppedCoinsRef.current = coins;
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'wagerCoins'));

    // 3. Lazy cleanup of expired coins
    const cleanupInterval = setInterval(async () => {
      const now = Date.now();
      const q = query(collection(db, 'wagerCoins'), where('expiresAt', '<', now));
      const snap = await getDocs(q).catch(() => null);
      if (snap) {
        snap.forEach(d => deleteDoc(d.ref).catch(() => {}));
      }
    }, 60000);

    // Heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      updateDoc(playerDocRef, { lastUpdate: Date.now() }).catch(() => {});
    }, 30000);

    // Fetch top 10 for crowns
    const fetchTop = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .order('high_score_monedas', { ascending: false })
        .limit(10);
      if (data) setTopMonedas(data.map(d => d.id));
    };
    fetchTop();

    // Supabase Realtime Setup with Server ID
    const channel = supabase.channel(`wager_arena_${serverId}`, {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const others: Record<string, PlayerSession> = {};
        Object.entries(state).forEach(([key, presence]: [string, any]) => {
          const p = presence[0] as PlayerSession;
          if (key !== user.id && p) {
            others[key] = p;
            // In private room, identify opponent
            if (category.startsWith('private_') && !opponentInfo) {
              setOpponentInfo({ id: key, name: p.displayName });
            }
          }
        });
        otherPlayersRef.current = others;
      })
      .on('broadcast', { event: 'player_update' }, ({ payload }) => {
        if (payload.id !== user.id) {
          otherPlayersRef.current[payload.id] = payload;
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track(playerRef.current);
        }
      });

    channelRef.current = channel;

    // Game Loop
    let lastTime = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (isAlive && playerRef.current.isAlive) {
        updatePlayer(dt);
        checkCollisions();
        
        // Smooth other players movement locally (Interpolation)
        (Object.values(otherPlayersRef.current) as PlayerSession[]).forEach(target => {
          if (!target.segments || target.segments.length === 0) return;
          
          if (!interpolatedPlayersRef.current[target.id]) {
            interpolatedPlayersRef.current[target.id] = JSON.parse(JSON.stringify(target));
            return;
          }

          const current = interpolatedPlayersRef.current[target.id];
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

        // Broadcast update every few frames
        if (Math.random() > 0.5) {
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

          channel.send({
            type: 'broadcast',
            event: 'player_update',
            payload: playerRef.current,
          });
        }
      }

      render();
      requestAnimationFrame(loop);
    };

    const animId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animId);
      channel.unsubscribe();
      unsubCoins();
      clearInterval(cleanupInterval);
      clearInterval(heartbeat);
      // Mark as dead in Firestore
      updateDoc(playerDocRef, { isAlive: false, lastUpdate: Date.now() }).catch(() => {});
    };
  }, [serverId, isAlive]);

  const updatePlayer = (dt: number) => {
    const head = playerRef.current.segments[0];
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Mouse follow logic
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
      // Consume score for boost
      setScore(s => Math.max(0, s - 0.2 * dt * 60));
    }
    const newX = head.x + Math.cos(playerRef.current.angle) * speed * dt;
    const newY = head.y + Math.sin(playerRef.current.angle) * speed * dt;

    if (newX < 0 || newX > worldW || newY < 0 || newY > worldH) {
      handleDeath();
      return;
    }

    const trail = playerRef.current.segments;
    trail.unshift({ x: newX, y: newY });

    const currentGrowth = growthWager + (playerRef.current.wager - initialWagerRef.current);
    // Coherent growth: length grows linearly with score
    const pointsPerSegment = 5;
    const targetSegments = 10 + Math.floor(currentGrowth);
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

  const checkCollisions = () => {
    const head = playerRef.current.segments[0];

    // Collision detection (Head vs Body)
    const isPlayerInvulnerable = playerRef.current.spawnTime && (Date.now() - playerRef.current.spawnTime < 1500);

    // Coin collection
    let scoreGain = 0;
    droppedCoinsRef.current.forEach(c => {
      const d = Math.sqrt((head.x - c.x) ** 2 + (head.y - c.y) ** 2);
      if (d < CELL) {
        scoreGain += c.value;
        playerRef.current.wager += c.value;
        soundManager.play('goldFood');
        
        // Delete from Firestore
        deleteDoc(doc(db, 'wagerCoins', c.id!)).catch(() => {});
      }
    });
    
    if (scoreGain > 0) {
      setScore(s => s + scoreGain);
    }

    // Player vs Player collision
    (Object.values(otherPlayersRef.current) as PlayerSession[]).forEach(other => {
      if (!other || !other.isAlive) return;
      if (isPlayerInvulnerable) return;
      const isOtherInvulnerable = other.spawnTime && (Date.now() - other.spawnTime < 1500);
      if (isOtherInvulnerable) return;

      other.segments.forEach(seg => {
        const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
        if (d < CELL) {
          handleDeath();
        }
      });
    });
  };

  const updateCompetitionStats = async (isWin: boolean, coins: number) => {
    if (!opponentInfo || !category.startsWith('private_')) return;

    const statsId = [user.id, opponentInfo.id].sort().join('_');
    const statsRef = doc(db, 'competitionStats', statsId);
    
    try {
      const snap = await getDoc(statsRef);
      let currentStats: any = {
        [user.id]: { wins: 0, losses: 0, coinsWon: 0, coinsLost: 0 },
        [opponentInfo.id]: { wins: 0, losses: 0, coinsWon: 0, coinsLost: 0 }
      };

      if (snap.exists()) {
        currentStats = snap.data();
      }

      const myStats = currentStats[user.id] || { wins: 0, losses: 0, coinsWon: 0, coinsLost: 0 };
      const oppStats = currentStats[opponentInfo.id] || { wins: 0, losses: 0, coinsWon: 0, coinsLost: 0 };

      if (isWin) {
        myStats.wins++;
        myStats.coinsWon += coins;
        oppStats.losses++;
        oppStats.coinsLost += coins;
      } else {
        myStats.losses++;
        myStats.coinsLost += coins;
        oppStats.wins++;
        oppStats.coinsWon += coins;
      }

      const updatedStats = {
        ...currentStats,
        [user.id]: myStats,
        [opponentInfo.id]: oppStats,
        lastMatch: Date.now()
      };

      await setDoc(statsRef, updatedStats);
      setCompetitionStats(myStats);

      // Update Friendship stats if they are friends
      const fQuery = query(collection(db, 'friendships'), where('uids', 'array-contains', user.id));
      const fSnap = await getDocs(fQuery);
      const friendshipDoc = fSnap.docs.find(d => d.data().uids.includes(opponentInfo.id));
      
      if (friendshipDoc) {
        await updateDoc(friendshipDoc.ref, {
          gamesPlayed: increment(1),
          [`stats.${user.id}.wins`]: isWin ? increment(1) : increment(0),
          [`stats.${opponentInfo.id}.wins`]: !isWin ? increment(1) : increment(0),
          lastMatch: Date.now()
        });
      }
    } catch (error) {
      console.error("Error updating competition stats:", error);
    }
  };

  const handleDeath = async () => {
    if (!isAlive) return;
    setIsAlive(false);
    playerRef.current.isAlive = false;
    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    soundManager.play('death');

    // Update competition stats if in private room
    if (category.startsWith('private_')) {
      await updateCompetitionStats(false, wager);
    }

    // Drop coins only in public rooms. In private rooms, coins are transferred directly to the killer.
    if (!category.startsWith('private_')) {
      dropWagerCoins(playerRef.current.wager, playerRef.current.segments);
    }

    // Update balance: only return collected coins (score), wager remains lost
    const userRef = doc(db, 'users', user.id);
    const newMonedas = user.monedas + score;
    const newHighScore = Math.max(user.highScoreMonedas, newMonedas);

    await updateDoc(userRef, {
      monedas: increment(score),
      highScoreMonedas: newHighScore
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

    // Sync with Supabase
    await supabase.from('profiles').update({ 
      monedas: newMonedas,
      high_score_monedas: newHighScore
    }).eq('id', user.id);
        
    // Record transaction
    if (score > 0) {
      await supabase.from('transactions').insert({
        user_id: user.id,
        type: 'collected',
        currency: 'monedas',
        amount: score,
        reason: 'wager_game_death_coins',
        timestamp: new Date().toISOString()
      });
    }
    
    // Record the loss of the initial wager
    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'lost',
      currency: 'monedas',
      amount: wager,
      reason: 'wager_game_loss',
      timestamp: new Date().toISOString()
    });

    // Cleanup private room if applicable
    if (category.startsWith('private_')) {
      const roomId = category.replace('private_', '');
      await deleteDoc(doc(db, 'privateRooms', roomId)).catch(() => {});
    } else {
      setTimeout(onGameOver, 3000);
    }
  };

  const handleWin = async (winAmount: number) => {
    if (!isAlive) return;
    setIsAlive(false);
    setIsWinner(true);
    playerRef.current.isAlive = false;
    
    soundManager.play('collect'); // Use collect sound for winning

    // Update competition stats if in private room
    if (category.startsWith('private_')) {
      await updateCompetitionStats(true, wager);
    }

    const totalToReturn = Math.floor(playerRef.current.wager);
    const userRef = doc(db, 'users', user.id);
    const newMonedas = user.monedas + totalToReturn;
    const newHighScore = Math.max(user.highScoreMonedas, newMonedas);
    setFinalBalance(newMonedas);

    // Update Firebase
    await updateDoc(userRef, {
      monedas: increment(totalToReturn),
      highScoreMonedas: newHighScore
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

    // Sync with Supabase
    await supabase.from('profiles').update({ 
      monedas: newMonedas,
      high_score_monedas: newHighScore
    }).eq('id', user.id);
        
    // Record transaction for the win
    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'collected',
      currency: 'monedas',
      amount: totalToReturn,
      reason: 'wager_game_win_private',
      timestamp: new Date().toISOString()
    });

    // Cleanup private room
    if (category.startsWith('private_')) {
      const roomId = category.replace('private_', '');
      await deleteDoc(doc(db, 'privateRooms', roomId)).catch(() => {});
    }
  };

  const dropWagerCoins = (wagerVal: number, segments: {x: number, y: number}[]) => {
    if (!serverId || segments.length === 0) return;
    
    // We drop one coin per segment to reflect the exact length and position
    // The total wager value is distributed among the segments
    const totalValue = Math.floor(wagerVal);
    const valuePerSegment = Math.max(1, Math.floor(totalValue / segments.length));
    const expiresAt = Date.now() + 4 * 60 * 1000; // 4 minutes

    // To avoid too many Firestore writes, we'll drop coins every 2 segments
    // but keep the visual length by making them slightly larger if needed
    for (let i = 0; i < segments.length; i += 2) {
      const seg = segments[i];
      const val = valuePerSegment * 2;
      
      if (val > 0) {
        addDoc(collection(db, 'wagerCoins'), {
          x: seg.x,
          y: seg.y,
          value: val,
          serverId,
          category,
          expiresAt,
          color: '#00f2ff' // Neon Blue
        }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'wagerCoins'));
      }
    }
  };

  const handleCollect = async () => {
    if (!isAlive || !playerRef.current.isAlive) return;
    setIsAlive(false);
    setIsCollecting(true);
    playerRef.current.isAlive = false;

    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    soundManager.play('collect');

    const totalToReturn = Math.floor(playerRef.current.wager);
    const userRef = doc(db, 'users', user.id);
    const newMonedas = user.monedas + totalToReturn;
    const newHighScore = Math.max(user.highScoreMonedas, newMonedas);
    setFinalBalance(newMonedas);

    // Update Firebase
    await updateDoc(userRef, {
      monedas: increment(totalToReturn),
      highScoreMonedas: newHighScore
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

    // Sync with Supabase
    await supabase.from('profiles').update({ 
      monedas: newMonedas,
      high_score_monedas: newHighScore
    }).eq('id', user.id);
        
    // Record transaction
    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'collected',
      currency: 'monedas',
      amount: totalToReturn,
      reason: 'wager_game_collect_exit',
      timestamp: new Date().toISOString()
    });

    // Cleanup private room if applicable
    if (category.startsWith('private_')) {
      const roomId = category.replace('private_', '');
      await deleteDoc(doc(db, 'privateRooms', roomId)).catch(() => {});
    }
  };

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
    for (let x = 0; x <= worldW; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, worldH); ctx.stroke();
    }
    for (let y = 0; y <= worldH; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(worldW, y); ctx.stroke();
    }

    // Neon Border
    ctx.strokeStyle = '#00f2ff';
    ctx.lineWidth = 8;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#00f2ff';
    ctx.strokeRect(0, 0, worldW, worldH);
    ctx.shadowBlur = 0;

    // Dropped Coins (Neon Blue Points)
    droppedCoinsRef.current.forEach(c => {
      ctx.save();
      ctx.fillStyle = '#00f2ff';
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#00f2ff';
      
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      ctx.fill();
      
      // Inner white core for extra neon effect
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    });

    // Other Players
    (Object.values(interpolatedPlayersRef.current) as PlayerSession[]).forEach(p => {
      if (p) drawSnake(ctx, p);
    });

    // Local Player
    if (isAlive) drawSnake(ctx, playerRef.current);

    // Opponent Arrow for Private Rooms
    if (isPrivate && isAlive) {
      const others = Object.values(otherPlayersRef.current) as PlayerSession[];
      if (others.length > 0) {
        const opponent = others[0];
        const head = playerRef.current.segments[0];
        const oppHead = opponent.segments[0];
        const dx = oppHead.x - head.x;
        const dy = oppHead.y - head.y;
        const angle = Math.atan2(dy, dx);
        const arrowDist = 120;

        ctx.save();
        ctx.translate(head.x, head.y);
        ctx.rotate(angle);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.moveTo(arrowDist, 0);
        ctx.lineTo(arrowDist - 25, -12);
        ctx.lineTo(arrowDist - 25, 12);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

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
    
    ctx.shadowBlur = 0; // Reset shadow for eyes/emoji/crown
    
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
    
    // Crown for top 10
    if (topMonedas.includes(snake.userId)) {
      ctx.save();
      ctx.translate(head.x, head.y - 25 - baseRadius);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-15, -15);
      ctx.lineTo(-5, -8);
      ctx.lineTo(0, -18);
      ctx.lineTo(5, -8);
      ctx.lineTo(15, -15);
      ctx.lineTo(10, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(snake.displayName, head.x, head.y - 15 - baseRadius);
    ctx.restore();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsBoosting(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setIsBoosting(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
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
    <div className="relative h-full w-full touch-none">
      {/* Server Allocation Loading */}
      {!serverId && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="mb-4 h-12 w-12 border-4 border-yellow-500 border-t-transparent rounded-full"
          />
          <p className="text-xl font-black text-white uppercase tracking-widest animate-pulse">
            Conectando a Arena de Apuestas...
          </p>
          <p className="mt-2 text-sm text-gray-400">
            Sincronizando con el servidor de apuestas en tiempo real
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
        width={window.innerWidth} 
        height={window.innerHeight} 
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      <AnimatePresence>
        {!isAlive && !isCollecting && !isWinner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md"
          >
            {category.startsWith('private_') && competitionStats ? (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full max-w-md rounded-[40px] bg-gradient-to-b from-red-900/40 to-black/90 p-10 text-center border border-red-500/30 shadow-2xl"
              >
                <div className="mb-6 flex flex-col items-center gap-2">
                  <div className="rounded-full bg-red-500/20 p-4">
                    <X size={48} className="text-red-500" />
                  </div>
                  <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">¡DERROTA!</h2>
                  <p className="text-sm font-bold text-red-400 uppercase tracking-widest">Estadísticas de Competencia</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Duelos Ganados</p>
                    <p className="text-2xl font-black text-white">{competitionStats.wins}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Duelos Perdidos</p>
                    <p className="text-2xl font-black text-red-500">{competitionStats.losses}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Monedas Ganadas</p>
                    <p className="text-xl font-black text-green-400">+{competitionStats.coinsWon}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Monedas Perdidas</p>
                    <p className="text-xl font-black text-red-400">-{competitionStats.coinsLost}</p>
                  </div>
                </div>

                <div className="mb-8 rounded-2xl bg-white/5 p-4 border border-white/10">
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Efectividad contra {opponentInfo?.name}</p>
                  <div className="h-3 w-full rounded-full bg-gray-800 overflow-hidden">
                    <div 
                      className="h-full bg-green-500 transition-all duration-1000"
                      style={{ width: `${(competitionStats.wins / (competitionStats.wins + competitionStats.losses || 1)) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-2">
                    <span className="text-[10px] font-black text-green-400">
                      {Math.round((competitionStats.wins / (competitionStats.wins + competitionStats.losses || 1)) * 100)}% ÉXITO
                    </span>
                    <span className="text-[10px] font-black text-red-400">
                      {Math.round((competitionStats.losses / (competitionStats.wins + competitionStats.losses || 1)) * 100)}% FRACASO
                    </span>
                  </div>
                </div>

                <button
                  onClick={onGameOver}
                  className="w-full rounded-full bg-white py-4 text-xl font-black uppercase tracking-tighter text-black transition-all hover:scale-105 active:scale-95"
                >
                  Continuar
                </button>
              </motion.div>
            ) : (
              <div className="text-center">
                <h2 className="mb-4 text-6xl font-black text-red-500 italic">¡ELIMINADO!</h2>
                <p className="text-2xl text-white">
                  {category.startsWith('private_') 
                    ? `Has perdido ${Math.floor(wager)} monedas en el duelo` 
                    : 'Has perdido tu apuesta'}
                </p>
              </div>
            )}
          </motion.div>
        )}

        {isWinner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-xl"
          >
            {category.startsWith('private_') && competitionStats ? (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full max-w-md rounded-[40px] bg-gradient-to-b from-yellow-500/20 to-black/90 p-10 text-center border border-yellow-500/30 shadow-2xl"
              >
                <div className="mb-6 flex flex-col items-center gap-2">
                  <div className="rounded-full bg-yellow-500 p-4 text-black">
                    <Trophy size={48} />
                  </div>
                  <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">¡VICTORIA!</h2>
                  <p className="text-sm font-bold text-yellow-500 uppercase tracking-widest">Estadísticas de Competencia</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Duelos Ganados</p>
                    <p className="text-2xl font-black text-green-400">{competitionStats.wins}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Duelos Perdidos</p>
                    <p className="text-2xl font-black text-white">{competitionStats.losses}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Monedas Ganadas</p>
                    <p className="text-xl font-black text-green-400">+{competitionStats.coinsWon}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Monedas Perdidas</p>
                    <p className="text-xl font-black text-red-400">-{competitionStats.coinsLost}</p>
                  </div>
                </div>

                <div className="mb-8 rounded-2xl bg-white/5 p-4 border border-white/10">
                  <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Efectividad contra {opponentInfo?.name}</p>
                  <div className="h-3 w-full rounded-full bg-gray-800 overflow-hidden">
                    <div 
                      className="h-full bg-green-500 transition-all duration-1000"
                      style={{ width: `${(competitionStats.wins / (competitionStats.wins + competitionStats.losses || 1)) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-2">
                    <span className="text-[10px] font-black text-green-400">
                      {Math.round((competitionStats.wins / (competitionStats.wins + competitionStats.losses || 1)) * 100)}% ÉXITO
                    </span>
                    <span className="text-[10px] font-black text-red-400">
                      {Math.round((competitionStats.losses / (competitionStats.wins + competitionStats.losses || 1)) * 100)}% FRACASO
                    </span>
                  </div>
                </div>

                <button
                  onClick={onGameOver}
                  className="w-full rounded-full bg-white py-4 text-xl font-black uppercase tracking-tighter text-black transition-all hover:scale-105 active:scale-95"
                >
                  Continuar
                </button>
              </motion.div>
            ) : (
              <motion.div
                initial={{ scale: 0.8, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="flex flex-col items-center gap-6 rounded-[40px] bg-gradient-to-b from-yellow-500/20 to-black/80 p-12 text-center border border-yellow-500/30 shadow-[0_0_100px_rgba(234,179,8,0.2)]"
              >
                <motion.div
                  animate={{ 
                    rotateY: [0, 360],
                    scale: [1, 1.1, 1]
                  }}
                  transition={{ duration: 3, repeat: Infinity }}
                  className="rounded-full bg-yellow-500 p-6 text-black shadow-[0_0_30px_rgba(234,179,8,0.5)]"
                >
                  <Trophy size={64} />
                </motion.div>
                
                <div className="space-y-2">
                  <h2 className="text-6xl font-black text-white uppercase italic tracking-tighter">
                    ¡FELICITACIONES!
                  </h2>
                  <p className="text-2xl font-bold text-yellow-500 uppercase tracking-widest">
                    Eres el Ganador del Duelo
                  </p>
                </div>

                <div className="flex flex-col items-center gap-2 rounded-3xl bg-white/5 px-12 py-8 border border-white/10">
                  <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Ganancia Total</span>
                  <div className="flex items-center gap-4 text-7xl font-black text-yellow-500">
                    <Coins size={60} />
                    <span>{Math.floor(playerRef.current.wager)}</span>
                  </div>
                  <p className="mt-2 text-xs font-bold text-green-400 uppercase tracking-widest">Monedas acreditadas</p>
                </div>

                <button
                  onClick={onGameOver}
                  className="group relative mt-4 flex items-center gap-3 overflow-hidden rounded-full bg-white px-12 py-5 text-2xl font-black uppercase tracking-tighter text-black transition-all hover:scale-105 active:scale-95"
                >
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-yellow-500/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                  <span>Aceptar</span>
                  <ArrowLeft className="rotate-180" />
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-4">
        {!isAlive && isCollecting && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center gap-4 rounded-3xl bg-green-900/90 p-8 text-center backdrop-blur-xl border border-green-500/30 shadow-[0_0_50px_rgba(34,197,94,0.2)]"
          >
            <div className="rounded-full bg-yellow-500 p-4 text-green-900">
              <Trophy size={48} />
            </div>
            <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">¡RETIRO EXITOSO!</h2>
            <p className="text-green-100">Has recuperado tu apuesta más tus ganancias.</p>
            <div className="flex flex-col items-center gap-1 my-2">
              <div className="flex items-center gap-2 text-5xl font-black text-yellow-500">
                <Coins size={40} />
                <span>+{Math.floor(playerRef.current.wager)} 💰</span>
              </div>
              <p className="text-xs font-bold text-green-400 uppercase tracking-widest">Abonados a tu cuenta</p>
              <div className="mt-2 rounded-lg bg-black/30 px-4 py-1 text-sm font-bold text-white">
                Saldo Total: {finalBalance} 💰
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

      {/* Floating UI */}
      {isAlive && (
        <div className="absolute inset-x-0 top-4 px-4 flex items-start justify-between pointer-events-none">
          {/* Left Side: Room Info / Score */}
          <div className="flex flex-col gap-2 pointer-events-auto">
            {!category.startsWith('private_') ? (
              <div className="flex items-center gap-2 rounded-xl bg-black/50 p-3 backdrop-blur-md border border-white/10">
                <Coins className="h-5 w-5 text-yellow-500" />
                <span className="text-xl font-black text-white">{Math.floor(score)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-purple-900/50 px-3 py-1.5 backdrop-blur-sm border border-purple-500/30">
                <ShieldCheck size={14} className="text-purple-400" />
                <span className="text-sm font-black text-white tracking-widest font-mono">
                  {category.replace('private_', '')}
                </span>
              </div>
            )}
          </div>

          {/* Center: Info Display */}
          <div className="flex flex-col items-center gap-2 pointer-events-auto">
            {category.startsWith('private_') ? (
              <>
                <div className="flex items-center gap-4 rounded-2xl bg-black/60 px-6 py-3 backdrop-blur-xl border border-white/10 shadow-2xl">
                  <span className="text-xl font-black text-white italic uppercase tracking-tighter">
                    {user.displayName.split(' ')[0]}
                  </span>
                  <span className="text-2xl">🆚</span>
                  <span className="text-xl font-black text-white italic uppercase tracking-tighter">
                    {opponentInfo ? opponentInfo.name.split(' ')[0] : '???'}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-yellow-500/20 px-4 py-1 border border-yellow-500/30 backdrop-blur-md">
                  <Coins size={14} className="text-yellow-500" />
                  <span className="text-sm font-black text-yellow-500 uppercase tracking-widest">
                    Pozo: {(wager * 2).toLocaleString()}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-3 rounded-full bg-black/40 px-4 py-2 backdrop-blur-md border border-white/5 shadow-lg">
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"
                    />
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">
                      {Object.keys(otherPlayersRef.current).length + 1} Jugadores
                    </span>
                  </div>
                  <div className="h-3 w-px bg-white/10" />
                  <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                    Arena {category}
                  </span>
                </div>
                {serverId && (
                  <span className="text-[8px] font-mono text-white/20 uppercase tracking-[0.2em]">
                    ID: {serverId.split('_').pop()?.toUpperCase()}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right Side: Collect Button */}
          <div className="pointer-events-auto">
            <button
              onClick={handleCollect}
              className="group flex items-center gap-2 rounded-2xl bg-yellow-600 px-6 py-3 font-black uppercase tracking-tighter text-white shadow-lg transition-all hover:bg-yellow-500 hover:shadow-[0_0_20px_rgba(202,138,4,0.4)] active:scale-95"
            >
              <Coins className="transition-transform group-hover:rotate-12" />
              <span className="hidden sm:inline">Cobrar y Salir</span>
              <LogOut size={18} className="ml-1 opacity-50" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
