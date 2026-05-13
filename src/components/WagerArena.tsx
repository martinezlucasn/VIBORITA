import { useEffect, useRef, useState, TouchEvent } from 'react';
import { User, PlayerSession, Food, Point, ArenaItemEntity } from '../types';
import { WORLD_W, WORLD_H, BASE_SPEED, CELL, ALL_SKINS, SEGMENT_DISTANCE } from '../constants';
import { ARENA_ITEMS } from '../items';
import { ALL_ABILITIES } from '../abilities';
import { GoldPointIcon } from './Icons';
import { doc, updateDoc, increment, setDoc, onSnapshot, collection, query, where, deleteDoc, addDoc, getDocs, getDoc, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowLeft, Zap, Coins, LogOut, Crown, X, Lock } from 'lucide-react';
import { soundManager } from '../lib/sounds';
import { supabase } from '../lib/supabase';

interface WagerArenaProps {
  user: User;
  wager: number;
  growthWager: number;
  category: string;
  onGameOver: () => void;
  onReturnToRival?: (rivalId: string) => void;
  onStartWager: (wager: number, growthWager: number, category: string) => void;
}

import { findAvailableServer } from '../lib/serverManager';
import { io, Socket } from 'socket.io-client';

interface CompetitionStats {
  wins: number;
  losses: number;
  coinsWon: number;
  coinsLost: number;
}

export default function WagerArena({ user, wager, growthWager, category, onGameOver, onReturnToRival, onStartWager }: WagerArenaProps) {
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
  const [boostCharge, setBoostCharge] = useState(5.0); // 5 seconds max
  const boostChargeRef = useRef(5.0);
  const [isOverheated, setIsOverheated] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(0);
  const cooldownTimeRef = useRef(0);
  const frameCounterRef = useRef(0);
  const smokeParticlesRef = useRef<{x: number, y: number, id: number, life: number, vx: number, vy: number}[]>([]);
  const floatingTextsRef = useRef<{ id: string; x: number; y: number; text: string; color: string; opacity: number }[]>([]);
  const [serverId, setServerId] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [topMonedas, setTopMonedas] = useState<string[]>([]); // IDs of top 10 players
  const socketRef = useRef<Socket | null>(null);
  const lastTapRef = useRef<number>(0);
  const boostTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTouchBoostingRef = useRef(false);

  // Abilities state
  const [isInvulnerable, setIsInvulnerable] = useState(false);
  const [lastTeleportTime, setLastTeleportTime] = useState(0);
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
    const textId = `ft-wager-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;
    floatingTextsRef.current.push({
      id: textId,
      x: 20,
      y: window.innerHeight - 100,
      text: '-250 Puntos',
      color: '#fbbf24',
      opacity: 1
    });

    soundManager.play('star'); // Flash sound
    
    // Jump effect (invulnerability)
    setIsInvulnerable(true);
    setTimeout(() => setIsInvulnerable(false), 3000);
    
    // Find safe spot
    const newPos = {
      x: 100 + Math.random() * (worldW - 200),
      y: 100 + Math.random() * (worldH - 200)
    };
    
    playerRef.current.segments = playerRef.current.segments.map(() => ({ ...newPos }));
    cameraRef.current.x = newPos.x;
    cameraRef.current.y = newPos.y;
  };
  
  const startX = Math.random() * worldW;
  const startY = Math.random() * worldH;

  // Calculate initial segments based on wager level (1-4)
  const getInitialSegmentsLength = () => {
    const bets = {
      basica: [250, 500, 750, 1000],
      pro: [1000, 2000, 3000, 4000],
      millonario: [5000, 7500, 10000, 15000]
    };
    const categoryBets = bets[category as keyof typeof bets] || bets.basica;
    const wagerIndex = categoryBets.indexOf(wager);
    const growthScale = [12, 24, 36, 60];
    return growthScale[wagerIndex] !== undefined ? growthScale[wagerIndex] : 12;
  };

  const initialSegCount = getInitialSegmentsLength();

  const playerRef = useRef<PlayerSession>({
    id: user.id,
    userId: user.id,
    displayName: user.displayName,
    segments: Array.from({ length: initialSegCount }, (_, i) => ({ x: startX - i * SEGMENT_DISTANCE, y: startY })),
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
  });

  const otherPlayersRef = useRef<Record<string, PlayerSession>>({});
  const interpolatedPlayersRef = useRef<Record<string, PlayerSession>>({});
  const itemsRef = useRef<Record<string, ArenaItemEntity>>({});
  const droppedCoinsRef = useRef<Food[]>([]);
  const mouseRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cameraRef = useRef({ x: worldW / 2, y: worldH / 2, zoom: 1 });
  const channelRef = useRef<any>(null);
  const initialWagerRef = useRef(wager);

  const [showNewWinAnim, setShowNewWinAnim] = useState(false);

  useEffect(() => {
    if (isWinner && !showNewWinAnim) {
      const timer = setTimeout(() => setShowNewWinAnim(true), 500);
      return () => clearTimeout(timer);
    }
  }, [isWinner]);

  useEffect(() => {
    if (!isAlive && !isWinner && !isCollecting && category.startsWith('private_')) {
      // For private rooms, we wait for user interaction to exit
      return;
    }
    if (!isAlive && !isWinner && !isCollecting) {
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
    const initServer = () => {
      try {
        // Initialize Socket.io
        const socket = io();
        socketRef.current = socket;

        socket.on("connect", () => {
          console.log(`Connected to WebSocket server (Wager - ${category})`);
          socket.emit("join_arena", {
            id: user.id,
            displayName: user.displayName,
            equippedSkin: user.equippedSkin,
            hasAura: playerRef.current.hasAura,
            auraType: playerRef.current.auraType,
            serverId: null,
            wager: playerRef.current.wager,
            category: category,
            mode: 'wager'
          });
        });

        socket.on("joined_room", ({ roomId, players }) => {
          console.log(`Joined WebSocket room: ${roomId}`);
          setServerId(roomId);
          playerRef.current.serverId = roomId;
          if (players) {
            players.forEach((p: any) => {
              const playerId = p.userId || p.id;
              if (playerId !== user.id) {
                otherPlayersRef.current[playerId] = {
                  ...otherPlayersRef.current[playerId],
                  ...p,
                  lastUpdate: Date.now()
                };
              }
            });
          }
        });

        socket.on("player_moved", (data) => {
          // Use userId for matching if it exists, otherwise use id (socket id)
          const playerId = data.userId || data.id;
          if (playerId !== user.id) {
            otherPlayersRef.current[playerId] = {
              ...otherPlayersRef.current[playerId],
              ...data,
              lastUpdate: Date.now()
            };
          }
        });

        socket.on("player_joined", (data) => {
          const playerId = data.userId || data.id;
          if (playerId !== user.id) {
            otherPlayersRef.current[playerId] = {
              ...otherPlayersRef.current[playerId],
              ...data,
              lastUpdate: Date.now()
            };
          }
        });

        socket.on("player_left", ({ id, userId }) => {
          const playerId = userId || id;
          delete otherPlayersRef.current[playerId];
          delete interpolatedPlayersRef.current[playerId];
        });

        socket.on("server_death", ({ killerName }) => {
          console.log("Server confirmed death (Wager)!");
          const killerId = Object.keys(otherPlayersRef.current).find(id => otherPlayersRef.current[id].displayName === killerName);
          handleDeath(killerId);
        });

        socket.on("player_died", async ({ id, userId, wager: victimWager, segments: victimSegments, killerName }) => {
          const playerId = userId || id;
          if (playerId !== user.id) {
            // If in private room, the remaining player is ALWAYS the winner if the other dies
            if (category.startsWith('private_')) {
               // Identify opponent if not already done
               if (!opponentInfo) {
                 setOpponentInfo({ id, name: otherPlayersRef.current[id]?.displayName || killerName || 'Oponente' });
               }
               
               // handleWin will set setIsWinner(true) and setIsAlive(false) correctly
               handleWin(victimWager || wager, id);
            } else {
              // In public rooms, only if specifically informed
              if (killerName === user.displayName && victimWager && victimSegments) {
                // We DON'T call dropWagerCoins here anymore because the VICTIM calls it in their handleDeath
                // This prevents double dropping of coins.
                updateCompetitionStats(true, victimWager, playerId);
              }
            }
            delete otherPlayersRef.current[playerId];
            delete interpolatedPlayersRef.current[playerId];
          }
        });
      } catch (err) {
        console.error("Error initializing server in WagerArena:", err);
        const fallbackId = category ? `${category}_1` : "wager_1";
        setServerId(fallbackId);
        playerRef.current.serverId = fallbackId;
        setShowCancel(true);
      }
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
      where('serverId', '==', serverId)
    );
    const unsubCoins = onSnapshot(coinsQuery, (snapshot) => {
      const coins: Food[] = [];
      snapshot.forEach((doc) => {
        coins.push({ id: doc.id, ...doc.data() } as Food);
      });
      droppedCoinsRef.current = coins;
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'wagerCoins'));

    // 2.5 Listen for arena items
    const itemsQuery = query(collection(db, 'arenaItems'), where('serverId', '==', serverId));
    const unsubItems = onSnapshot(itemsQuery, (snapshot) => {
      const newItems: Record<string, ArenaItemEntity> = {};
      snapshot.forEach((doc) => {
        newItems[doc.id] = { id: doc.id, ...doc.data() } as ArenaItemEntity;
      });
      itemsRef.current = newItems;

      // Arena items spawning logic: Only for private rooms or specific categories
      // User requested to remove random coins/items in global competition
      if (snapshot.size < 6 && isPrivate) {
        const spawnCount = 6 - snapshot.size;
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
            x: Math.random() * worldW,
            y: Math.random() * worldH,
            itemId: chosenItem.id,
            serverId
          }).catch(() => {});
        }
      }
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'arenaItems'));

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
        checkCollisions(dt);
        
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

    // Boost logic changes
    let actualIsBoosting = isBoosting && !isOverheated;
    if (actualIsBoosting) {
      boostChargeRef.current = Math.max(0, boostChargeRef.current - dt);
      if (boostChargeRef.current === 0 && !isOverheated) {
        setIsOverheated(true);
        cooldownTimeRef.current = 30;
      }
    } else if (isOverheated) {
      cooldownTimeRef.current = Math.max(0, cooldownTimeRef.current - dt);
      if (cooldownTimeRef.current === 0) setIsOverheated(false);
      boostChargeRef.current = Math.min(5, boostChargeRef.current + (5 / 30) * dt);

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
    } else if (boostChargeRef.current < 5) {
      boostChargeRef.current = Math.min(5, boostChargeRef.current + 0.5 * dt);
    }

    // Throttle state updates for UI performance
    frameCounterRef.current++;
    if (frameCounterRef.current % 3 === 0) {
      setBoostCharge(boostChargeRef.current);
      setCooldownTime(cooldownTimeRef.current);
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
    if (newX < 0 || newX > worldW || newY < 0 || newY > worldH) {
      if (!isInvulnerable) {
        handleDeath();
        return;
      }
    }

    const trail = playerRef.current.segments;
    if (speed > 0) {
      trail.unshift({ x: newX, y: newY });
    }

    // Uniform growth logic: 1 segment per 10 coins constantly
    const collectedCoins = Math.max(0, playerRef.current.wager - initialWagerRef.current);
    const pointsPerSegment = 5;
    const baseSegments = initialSegCount;
    const bonusSegments = Math.floor(collectedCoins / 10);
    
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

    // Dynamic zoom based on snake length to see ~80% of it
    let targetZoomBase = Math.max(0.35, Math.min(1, 1200 / (maxTrailLen * 2 + 800)));
    if (hasZoom) targetZoomBase *= 0.65;
    cameraRef.current.zoom += (targetZoomBase - cameraRef.current.zoom) * 0.02;

    // Update floating texts (Ref logic, no state update here)
    floatingTextsRef.current = floatingTextsRef.current.map(ft => ({
      ...ft,
      y: ft.y - 1,
      opacity: ft.opacity - 0.02
    })).filter(ft => ft.opacity > 0);
  };

  const checkCollisions = (dt: number) => {
    const head = playerRef.current.segments[0];

    // Collision detection (Head vs Body)
    const isPlayerInvulnerable = playerRef.current.spawnTime && (Date.now() - playerRef.current.spawnTime < 1500);

    // Coin collection and attraction
    let scoreGain = 0;
    droppedCoinsRef.current.forEach(c => {
      const dx = head.x - c.x;
      const dy = head.y - c.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      
      const attractionRadius = hasMagnet ? CELL * 3 : 0;
      const collectionRadius = hasGrosor ? CELL * 2 : CELL;

      // Magnet attraction effect
      if (hasMagnet && d < attractionRadius && d > collectionRadius) {
        const pullSpeed = BASE_SPEED * 2; // Moderate speed for flight effect
        const angle = Math.atan2(dy, dx);
        c.x += Math.cos(angle) * pullSpeed * dt;
        c.y += Math.sin(angle) * pullSpeed * dt;
      }

      const currentD = Math.sqrt((head.x - c.x) ** 2 + (head.y - c.y) ** 2);
      if (currentD < collectionRadius) {
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
          
          // Update Firestore inventory
          const userRef = doc(db, 'users', user.id);
          updateDoc(userRef, {
            [`inventoryItems.${itemDef.id}`]: increment(1)
          }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

          // Delete item from arena
          delete itemsRef.current[id];
          deleteDoc(doc(db, 'arenaItems', id)).catch(() => {});
        }
      }
    });

    // Player vs Player collision
    (Object.values(otherPlayersRef.current) as PlayerSession[]).forEach(other => {
      if (!other || !other.isAlive) return;
      if (isPlayerInvulnerable) return;
      const isOtherInvulnerable = other.spawnTime && (Date.now() - other.spawnTime < 1500);
      if (isOtherInvulnerable) return;

      const hitBox = hasGrosor ? CELL * 2 : CELL;

      // Case 1: My Head vs Their Body (I die)
      other.segments.forEach(seg => {
        const d = Math.sqrt((head.x - seg.x) ** 2 + (head.y - seg.y) ** 2);
        if (d < hitBox) {
          handleDeath();
        }
      });

      // Case 2: Their Head vs My Body (They die)
      const otherHead = other.segments[0];
      if (otherHead) {
        playerRef.current.segments.forEach(seg => {
          const d = Math.sqrt((otherHead.x - seg.x) ** 2 + (seg.y - otherHead.y) ** 2);
          if (d < hitBox) {
            // Tell server they died by hitting me
            if (socketRef.current?.connected) {
              socketRef.current.emit("player_died", {
                id: other.id,
                killerName: user.displayName,
                wager: other.wager,
                segments: other.segments
              });
            }

            // We DON'T call dropWagerCoins here because the victim will detect it and call it locally
            // This prevents double dropping.
            
            // Update local stats
            updateCompetitionStats(true, other.wager, other.id);

            // Cleanup local refs
            delete otherPlayersRef.current[other.id];
            delete interpolatedPlayersRef.current[other.id];
          }
        });
      }
    });
  };

  const updateCompetitionStats = async (isWin: boolean, coins: number, opponentIdOverride?: string) => {
    const opponentId = opponentIdOverride || opponentInfo?.id || Object.keys(otherPlayersRef.current).find(id => id !== user.id);
    if (!opponentId) {
      console.log("No opponentId skipping stats update");
      return;
    }

    // Check if they are friends first
    const fQuery = query(collection(db, 'friendships'), where('uids', 'array-contains', user.id));
    const fSnap = await getDocs(fQuery);
    const friendshipDoc = fSnap.docs.find(d => d.data().uids.includes(opponentId));

    // We ONLY update stats if it's a private room OR if they are friends
    if (!category.startsWith('private_') && !friendshipDoc) {
      console.log("Not a private room and not friends, skipping stats update");
      return;
    }

    const statsId = [user.id, opponentId].sort().join('_');
    const statsRef = doc(db, 'competitionStats', statsId);
    
    try {
      const snap = await getDoc(statsRef);
      let currentStats: any = {
        [user.id]: { wins: 0, losses: 0, coinsWon: 0, coinsLost: 0 },
        [opponentId]: { wins: 0, losses: 0, coinsWon: 0, coinsLost: 0 }
      };

      if (snap.exists()) {
        currentStats = snap.data();
      }

      const myStats = { ...(currentStats[user.id] || { wins: 0, losses: 0, coinsWon: 0, coinsLost: 0 }) };

      if (isWin) {
        myStats.wins++;
        myStats.coinsWon += coins;
      } else {
        myStats.losses++;
        myStats.coinsLost += coins;
      }

      const updatedStats = {
        ...currentStats,
        [user.id]: myStats,
        lastMatch: Date.now()
      };

      await setDoc(statsRef, updatedStats, { merge: true });
      setCompetitionStats(myStats);

      // Update Friendship stats if they are friends
      if (friendshipDoc) {
        const updateData: any = {
          gamesPlayed: increment(1),
          lastMatch: Date.now()
        };

        // ONLY update current user's side to avoid double-counting when both players call this
        if (isWin) {
          updateData[`stats.${user.id}.wins`] = increment(1);
        }
        
        // Also update regular points/coins record for current user
        if (isWin) {
          updateData[`stats.${user.id}.coinsWon`] = increment(coins);
        } else {
          updateData[`stats.${user.id}.coinsLost`] = increment(coins);
        }

        await updateDoc(friendshipDoc.ref, updateData);
      }
    } catch (error) {
      console.error("Error updating competition stats:", error);
    }
  };

  const handleDeath = async (killerId?: string) => {
    if (!isAlive) return;
    setIsAlive(false);
    playerRef.current.isAlive = false;

    // Drop coins immediately for best responsiveness
    // Drop coins only in public rooms. In private rooms, coins are transferred directly to the killer.
    if (!category.startsWith('private_')) {
      dropWagerCoins(playerRef.current.wager, playerRef.current.segments);
    }
    
    // Inform others via socket
    if (socketRef.current?.connected) {
      socketRef.current.emit("player_died", {
        id: user.id,
        killerName: killerId ? (otherPlayersRef.current[killerId]?.displayName || "Oponente") : "Obstáculo",
        wager: playerRef.current.wager,
        segments: playerRef.current.segments
      });
    }

    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    soundManager.play('death');

    // Update competition stats - don't await to avoid blocking UI
    updateCompetitionStats(false, wager, killerId);

    // Update balance: only if they survived and are withdrawing.
    // When a player dies, they lose their initial wager AND all collected coins.
    // In Public Rooms, these are dropped on the map. In Private Rooms, they are transferred to the winner.
    // In both cases, the victim walk away with 0 new coins to avoid inflation.
    
    // We still update the high score if applicable
    const newHighScore = Math.max(user.highScoreMonedas, user.monedas + score);
    if (newHighScore > user.highScoreMonedas) {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        highScoreMonedas: newHighScore
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
      
      await supabase.from('profiles').update({ 
        high_score_monedas: newHighScore
      }).eq('id', user.id);
    }
    
    // Record the loss of the initial wager (Always record the loss transaction)
    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'lost',
      currency: 'monedas',
      amount: wager,
      reason: 'wager_game_loss',
      timestamp: new Date().toISOString()
    });

    // Handle game over delay based on rematch
    if (!category.startsWith('private_')) {
      setTimeout(onGameOver, 3000);
    }
  };

  const handleWin = async (winAmount: number, opponentId?: string) => {
    if (!isAlive) return;
    setIsAlive(false);
    setIsWinner(true);
    playerRef.current.isAlive = false;
    
    soundManager.play('collect'); // Use collect sound for winning

    // Update competition stats if in private room
    if (category.startsWith('private_')) {
      await updateCompetitionStats(true, wager, opponentId);
    }

    const myWagerValue = Math.floor(playerRef.current.wager);
    const totalToReturn = myWagerValue + Math.floor(winAmount);
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
    const sId = serverId || playerRef.current.serverId;
    if (!sId || segments.length === 0) return;
    
    // Total value is sum of initial wager + collected coins (score/growth)
    // playerRef.current.wager already includes the initial wager + added value from coins
    const totalValue = Math.max(0, Math.floor(wagerVal || 0));
    const expiresAt = Date.now() + 33 * 60 * 1000;

    // Distribution logic optimized for silhouette
    // We use a fixed number of orbs to represent the player's body clearly
    // but only enough to cover the silhouette as requested
    // Request: each orb can value any value, as long as total matches wager + collected
    const dropCount = Math.min(segments.length, 30); // 30 orbs is enough for silhouette
    
    if (dropCount <= 0) return;

    // Distribution: divide exactly the provided wager value by dropCount
    const totalToDrop = Math.max(0, Math.floor(wagerVal || 0));
    const baseValuePerDrop = Math.floor(totalToDrop / dropCount);
    const remainder = totalToDrop % dropCount;

    for (let i = 0; i < dropCount; i++) {
      // Pick segments uniformly to form silhouette
      const segIndex = Math.floor((i / (dropCount > 1 ? dropCount - 1 : 1)) * (segments.length - 1));
      const seg = segments[segIndex];
      if (!seg) continue;

      const val = baseValuePerDrop + (i < remainder ? 1 : 0);
      
      const scatterX = (Math.random() - 0.5) * 6;
      const scatterY = (Math.random() - 0.5) * 6;

      addDoc(collection(db, 'wagerCoins'), {
        x: seg.x + scatterX,
        y: seg.y + scatterY,
        value: val,
        serverId: sId,
        category,
        expiresAt,
        type: 'dropped',
        color: '#00ccff', // Specialized silhouette color
        isDeathLoot: true
      }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'wagerCoins'));
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

    // Dropped Coins (Simplified for Performance)
    ctx.save();
    droppedCoinsRef.current.forEach(c => {
      const coinColor = c.color || '#00f2ff';
      
      // Simple Glow (Alpha based, no shadow)
      ctx.fillStyle = hexToRgba(coinColor, 0.25);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
      ctx.fill();

      // Sharp Core
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();

      // Color hint core
      ctx.fillStyle = coinColor;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

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

    // Render Minimap after game world restore but before UI
    if (isAlive) {
      renderMinimap(ctx);
    }

    // Draw Floating Texts
    ctx.restore(); // Out of camera space if they are UI-based
    floatingTextsRef.current.forEach(ft => {
      ctx.save();
      ctx.globalAlpha = ft.opacity;
      ctx.fillStyle = ft.color;
      ctx.font = 'black 12px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });
  };

  const renderMinimap = (ctx: CanvasRenderingContext2D) => {
    const mapSize = window.innerWidth < 640 ? 100 : 150;
    const padding = 20;
    const x = window.innerWidth - mapSize - padding;
    const y = window.innerHeight - mapSize - padding;

    ctx.save();
    ctx.translate(x, y);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(0, 0, mapSize, mapSize, 16);
    } else {
      ctx.rect(0, 0, mapSize, mapSize);
    }
    ctx.fill();
    ctx.stroke();

    // Scale factors
    const scaleX = mapSize / worldW;
    const scaleY = mapSize / worldH;

    // World border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeRect(0, 0, mapSize, mapSize);

    // Coins (Batching for performance)
    ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
    droppedCoinsRef.current.forEach(c => {
      if (c.x * scaleX < 0 || c.x * scaleX > mapSize || c.y * scaleY < 0 || c.y * scaleY > mapSize) return;
      ctx.fillRect(c.x * scaleX - 0.5, c.y * scaleY - 0.5, 1, 1);
    });

    // Other Players (Use interpolated for smoothness)
    (Object.values(interpolatedPlayersRef.current) as PlayerSession[]).forEach(p => {
      if (!p || !p.segments || p.segments.length === 0) return;
      const head = p.segments[0];
      ctx.fillStyle = p.color1 || '#ff3333';
      ctx.beginPath();
      ctx.arc(head.x * scaleX, head.y * scaleY, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Local Player
    if (isAlive) {
      const head = playerRef.current.segments[0];
      ctx.fillStyle = '#fff';
      
      // Glow effect for local player
      ctx.shadowBlur = 8;
      ctx.shadowColor = playerRef.current.color1 || '#22ff44';
      
      ctx.beginPath();
      ctx.arc(head.x * scaleX, head.y * scaleY, 3, 0, Math.PI * 2);
      ctx.fill();
      
      // Outer ring for local player
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(head.x * scaleX, head.y * scaleY, 5 + Math.sin(Date.now() / 200) * 2, 0, Math.PI * 2);
      ctx.stroke();
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

    const pointsPerSegment = 3.75; // Reducción de densidad del 20% (3 / 0.8)
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
      
      // Particles / Bolts
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
      } else if (Math.random() > 0.6) {
        let rSize = Math.random() * 3 + 1;
        if (snake.auraType === 'fire') {
          ctx.fillStyle = `rgba(255, ${Math.floor(Math.random() * 100 + 50)}, 0, 0.5)`;
        } else if (snake.auraType === 'ice') {
          ctx.fillStyle = `rgba(${Math.floor(Math.random() * 50 + 200)}, 255, 255, 0.5)`;
        } else if (snake.auraType === 'water') {
          ctx.fillStyle = `rgba(147, 197, 253, 0.6)`;
        } else if (snake.auraType === 'death') {
          ctx.fillStyle = `rgba(75, 85, 99, ${Math.random() * 0.5})`;
        } else if (snake.auraType === 'crystal') {
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.8})`;
          rSize = Math.random() * 3 + 1;
        } else if (snake.auraType === 'ember') {
          ctx.fillStyle = Math.random() > 0.5 ? '#ef4444' : '#f97316';
          rSize = Math.random() * 2 + 1;
        } else if (snake.auraType === 'nebula') {
          if (['dragon', 'dragon_fuego'].includes(snake.skinId || '')) return; // Quitar partículas para el skin de dragón
          ctx.fillStyle = Math.random() > 0.5 ? '#ec4899' : '#a855f7';
        }
        ctx.beginPath();
        const px = trail[0].x + (Math.random() - 0.5) * headRadius * 2;
        const py = trail[0].y + (Math.random() - 0.5) * headRadius * 2;
        ctx.arc(px, py, rSize, 0, Math.PI * 2);
        ctx.fill();
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

    // Neon glow for the whole snake
    ctx.shadowBlur = snake.isBoosting ? 20 + Math.random() * 10 : 10;
    ctx.shadowColor = snake.isBoosting ? '#fff' : snake.color1;

    for (let i = trail.length - 1; i >= pointsPerSegment; i -= pointsPerSegment) {
      const idx = Math.floor(i);
      const segmentIndex = Math.floor(idx / pointsPerSegment);
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
        const rTapered = bodyRadius * (1 - (idx / trail.length) * 0.4); 
        ctx.save();
        ctx.translate(trail[idx].x, trail[idx].y);
        const nextSeg = trail[idx - pointsPerSegment] || trail[idx];
        const angle = Math.atan2(nextSeg.y - trail[idx].y, nextSeg.x - trail[idx].x);
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
        const rTapered = bodyRadius * (1 - (idx / trail.length) * 0.2); 
        ctx.save();
        ctx.translate(trail[idx].x, trail[idx].y);
        const nextSeg = trail[idx - pointsPerSegment] || trail[idx];
        const angle = Math.atan2(nextSeg.y - trail[idx].y, nextSeg.x - trail[idx].x);
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
        ctx.translate(trail[idx].x, trail[idx].y);
        const nextSeg = trail[idx - pointsPerSegment] || trail[idx];
        const angle = Math.atan2(nextSeg.y - trail[idx].y, nextSeg.x - trail[idx].x);
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
        ctx.moveTo(trail[idx].x + r * Math.cos(0), trail[idx].y + r * Math.sin(0));
        for (let s = 1; s <= sides; s++) {
          ctx.lineTo(trail[idx].x + r * Math.cos(s * angleStep), trail[idx].y + r * Math.sin(s * angleStep));
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.arc(trail[idx].x, trail[idx].y, r, 0, Math.PI * 2);
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
        const nextSegment = trail[idx - pointsPerSegment] || trail[idx];
        const dx = trail[idx].x - nextSegment.x;
        const dy = trail[idx].y - nextSegment.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        // Si es phoenix, lo movemos un poco más atrás para que "flote" fuera del orbe
        const offset = snake.skinId === 'phoenix' ? r * 1.2 : 0;
        ctx.translate(trail[idx].x + (dx/dist) * offset, trail[idx].y + (dy/dist) * offset);

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
        ctx.arc(trail[idx].x + (Math.random() - 0.5) * r * 3, trail[idx].y + (Math.random() - 0.5) * r * 3, 2, 0, Math.PI * 2);
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
          ctx.fillStyle = '#ec4899';
        }
        ctx.beginPath();
        ctx.arc(trail[idx].x + (Math.random() - 0.5) * r * 3, trail[idx].y + (Math.random() - 0.5) * r * 3, rSize, 0, Math.PI * 2);
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
    
    ctx.shadowBlur = 0; // Reset shadow for eyes/emoji/crown
    
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
      // Eyes (only if no emoji)
      const eyeOff = (hasGrosor && snake.userId === user.id) ? CELL / 2 : CELL / 4;
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
      ctx.translate(head.x, head.y - 25 - bodyRadius);
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
    ctx.fillText(snake.displayName, head.x, head.y - 15 - bodyRadius);
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

      {/* Floating Texts (Moved to Canvas) */}

      <AnimatePresence>
        {!isAlive && !isCollecting && !isWinner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-xl"
          >
            {category.startsWith('private_') ? (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full max-w-sm rounded-[40px] bg-gradient-to-b from-red-900/40 to-black/95 p-8 text-center border border-red-500/30 shadow-2xl"
              >
                <div className="mb-6 flex flex-col items-center gap-2">
                  <div className="rounded-full bg-red-500/20 p-4 mb-2">
                    <X size={48} className="text-red-500" />
                  </div>
                  <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">¡ELIMINADO!</h2>
                  <p className="text-xs font-bold text-red-400 uppercase tracking-widest">Estadísticas de Rivalidad</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Victorias</p>
                    <p className="text-3xl font-black text-white italic">{competitionStats?.wins || 0}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Derrotas</p>
                    <div className="flex flex-col items-center">
                      <p className="text-3xl font-black text-red-500 italic">{(competitionStats?.losses || 0)}</p>
                      <motion.span 
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-[10px] font-black text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full"
                      >
                        +1 DERROTA
                      </motion.span>
                    </div>
                  </div>
                </div>

                <div className="mb-6 rounded-2xl bg-white/5 p-4 border border-white/5 text-left">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-black text-gray-500 uppercase">Apuesta Perdida</p>
                    <div className="flex items-center gap-1">
                      <Coins size={12} className="text-red-400" />
                      <span className="text-sm font-black text-red-400">-{Math.floor(wager)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
                    <div 
                      className="h-full bg-red-500 transition-all duration-1000"
                      style={{ width: `${((competitionStats?.losses || 0) / ((competitionStats?.wins || 0) + (competitionStats?.losses || 0) || 1)) * 100}%` }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (opponentInfo?.id && onReturnToRival) {
                      onReturnToRival(opponentInfo.id);
                    } else {
                      onGameOver();
                    }
                  }}
                  className="w-full rounded-2xl bg-white py-4 text-lg font-black uppercase tracking-tighter text-black transition-all hover:scale-105 active:scale-95 shadow-lg shadow-white/10"
                >
                  Aceptar
                </button>
              </motion.div>
            ) : (
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mb-4 inline-block rounded-full bg-red-500/20 p-6"
                >
                  <X size={64} className="text-red-500" />
                </motion.div>
                <h2 className="mb-4 text-7xl font-black text-red-500 italic tracking-tighter">¡ELIMINADO!</h2>
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xl font-bold text-white uppercase tracking-widest">
                    Has perdido tu apuesta
                  </p>
                  <div className="flex items-center gap-2 rounded-full bg-red-500/10 px-4 py-1 border border-red-500/20">
                    <Coins size={16} className="text-red-400" />
                    <span className="text-lg font-black text-red-400">-{Math.floor(wager)}</span>
                  </div>
                </div>
                <button
                  onClick={onGameOver}
                  className="mt-8 rounded-full bg-white px-8 py-3 font-bold text-black"
                >
                  Continuar
                </button>
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
            {category.startsWith('private_') ? (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full max-sm:w-[90%] max-w-sm rounded-[40px] bg-gradient-to-b from-green-900/40 to-black/95 p-8 text-center border border-green-500/30 shadow-2xl"
              >
                <div className="mb-6 flex flex-col items-center gap-2">
                  <motion.div 
                    animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="rounded-full bg-green-500 p-5 text-black mb-2 shadow-[0_0_30px_rgba(34,197,94,0.4)]"
                  >
                    <Trophy size={48} />
                  </motion.div>
                  <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter">¡FELICITACIONES!</h2>
                  <p className="text-xs font-bold text-green-400 uppercase tracking-widest">Estadísticas de Rivalidad</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Victorias</p>
                    <div className="flex flex-col items-center">
                      <p className="text-3xl font-black text-green-400 italic">{competitionStats?.wins || 0}</p>
                      <AnimatePresence>
                        {showNewWinAnim && (
                          <motion.span 
                            initial={{ opacity: 0, y: 10, scale: 0.5 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className="text-[10px] font-black text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full"
                          >
                            +1 VICTORIA
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Derrotas</p>
                    <p className="text-3xl font-black text-white italic">{competitionStats?.losses || 0}</p>
                  </div>
                </div>

                <div className="mb-6 rounded-2xl bg-white/5 p-4 border border-white/5 text-left">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-black text-gray-500 uppercase">Apuesta Ganada</p>
                    <div className="flex items-center gap-1">
                      <Coins size={12} className="text-yellow-400" />
                      <span className="text-sm font-black text-green-400">+{Math.floor(wager)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
                    <div 
                      className="h-full bg-green-500 transition-all duration-1000"
                      style={{ width: `${((competitionStats?.wins || 0) / ((competitionStats?.wins || 0) + (competitionStats?.losses || 0) || 1)) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => {
                      if (opponentInfo?.id && onReturnToRival) {
                        onReturnToRival(opponentInfo.id);
                      } else {
                        onGameOver();
                      }
                    }}
                    className="w-full rounded-2xl bg-white py-4 text-lg font-black uppercase tracking-tighter text-black transition-all hover:scale-105 active:scale-95 shadow-lg shadow-white/10"
                  >
                    Aceptar
                  </button>
                </div>
              </motion.div>
            ) : (
              <div className="text-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="mb-8 inline-block rounded-full bg-yellow-500 p-8 shadow-2xl shadow-yellow-500/40"
                >
                  <Trophy size={64} className="text-black" />
                </motion.div>
                <h2 className="mb-4 text-7xl font-black text-yellow-500 italic tracking-tighter">¡VICTORIA!</h2>
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xl font-bold text-white uppercase tracking-widest">
                    Has recolectado
                  </p>
                  <div className="flex items-center gap-2 rounded-full bg-yellow-500/20 px-6 py-2 border border-yellow-500/30">
                    <Coins size={20} className="text-yellow-400" />
                    <span className="text-3xl font-black text-yellow-400">+{Math.floor(playerRef.current.wager)}</span>
                  </div>
                </div>
                <button
                  onClick={onGameOver}
                  className="mt-12 rounded-full bg-white px-12 py-4 text-xl font-black uppercase tracking-tighter text-black transition-all hover:scale-110 active:scale-95"
                >
                  Continuar
                </button>
              </div>
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
                <Lock size={14} className="text-purple-400" />
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

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
