import { useState, useEffect, useRef } from 'react';
import { User, Skin, Friendship, Notification as GameNotification, SkinListing, Ability } from '../types';
import { ALL_SKINS } from '../constants';
import { ALL_ABILITIES } from '../abilities';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { Coins, Play, ShoppingBag, User as UserIcon, Trophy, ArrowLeft, Plus, Copy, ExternalLink, Check, X, Zap, Users, ShieldCheck, History, LogOut, Trash2, CreditCard, UserPlus, Palette, Search, Send, MessageSquare, Heart, Loader2, Award, Moon, Target, Skull, Sparkles, Settings, Volume2, VolumeX, Gamepad2, UserMinus, Instagram, Youtube, Facebook, Twitch, Calendar, Timer, Download } from 'lucide-react';
import { GoldPointIcon, MonedasIcon } from './Icons';
import AdminPanel from './AdminPanel';
import { ARENA_ITEMS, SUCCESS_RATES, ArenaItem } from '../items';
import { doc, updateDoc, onSnapshot, collection, query, where, orderBy, limit, getDocs, setDoc, addDoc, deleteDoc, getDoc, arrayUnion, increment, runTransaction } from 'firebase/firestore';
import { db, handleFirestoreError, auth, OperationType } from '../firebase';
import { signOut, deleteUser } from 'firebase/auth';
import { soundManager } from '../lib/sounds';
import { GoogleGenAI } from "@google/genai";
import ExpandedFriendProfile from './Social/ExpandedFriendProfile';
import ProfileCustomization from './Social/ProfileCustomization';

// Initialize AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const RARITY_ORDER: Record<string, number> = {
  legendary: 4,
  epic: 3,
  rare: 2,
  common: 1
};

const APP_VERSION = '1.0.0';

function compareVersions(v1: string, v2: string) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts1[i] > (parts2[i] || 0)) return 1;
    if (parts1[i] < (parts2[i] || 0)) return -1;
  }
  return 0;
}

const DAILY_REWARDS = [
  { day: 1, points: 500, fragments: 1 },
  { day: 2, points: 750, fragments: 1 },
  { day: 3, points: 1000, fragments: 1, proEntry: true },
  { day: 4, points: 1000, fragments: 2, proEntry: true },
  { day: 5, points: 1000, fragments: 2, millonarioEntry: true },
  { day: 6, points: 1000, fragments: 2, millonarioEntry: true, monedas: 150 },
  { day: 7, points: 1000, fragments: 2, proEntry: true, millonarioEntry: true, monedas: 250, randomAbility: true },
];

interface MenuProps {
  user: User;
  onStartGame: (wager: number) => void;
  onStartTraining: (botCount: number, wager: number) => void;
  onStartWager: (wager: number, growthWager: number, category: string) => void;
  initialRivalId?: string | null;
  onRivalHandled?: () => void;
}

export default function Menu({ user, onStartGame, onStartTraining, onStartWager, initialRivalId, onRivalHandled }: MenuProps) {
  const [view, setView] = useState<'main' | 'shop' | 'inventory' | 'ranking' | 'profile' | 'wallet' | 'fusion'>('main');
  const [showAdmin, setShowAdmin] = useState(false);
  const [wager, setWager] = useState(0);
  const [showWagerModal, setShowWagerModal] = useState(false);
  const [showPrivateModal, setShowPrivateModal] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState<{code: string, wager: number} | null>(null);
  const [privateRoomId, setPrivateRoomId] = useState('');
  const [privateWager, setPrivateWager] = useState(50);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [showJoinConfirm, setShowJoinConfirm] = useState<{id: string, wager: number} | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'basica' | 'pro' | 'millonario'>('basica');
  const [showBuyPoints, setShowBuyPoints] = useState(false);
  const [buyAmount, setBuyAmount] = useState(100);
  const [copied, setCopied] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [topPlayers, setTopPlayers] = useState<User[]>([]);
  const [shopCategory, setShopCategory] = useState<'skins' | 'tickets'>('skins');
  const [ticketMessage, setTicketMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [selectedCoinPackage, setSelectedCoinPackage] = useState<number | null>(null);
  const [selectedPointPackage, setSelectedPointPackage] = useState<{ points: number, price: number } | null>(null);
  const [isCreatingPreference, setIsCreatingPreference] = useState(false);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferCurrency, setTransferCurrency] = useState<'coins' | 'monedas'>('coins');
  const [friendProfiles, setFriendProfiles] = useState<Record<string, User>>({});
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [tempUsername, setTempUsername] = useState(user.displayName);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [duelWager, setDuelWager] = useState(50);
  const [selectedMedal, setSelectedMedal] = useState<any>(null);
  const [unlockedMedalIds, setUnlockedMedalIds] = useState<string[]>([]);
  const [medalNotification, setMedalNotification] = useState<any>(null);
  const [geminiMessage, setGeminiMessage] = useState<string | null>(null);
  const [isGeminiLoading, setIsGeminiLoading] = useState(false);
  const [purchaseConfirmation, setPurchaseConfirmation] = useState<{ skin: Skin; price: number } | null>(null);
  const [showArenaTicketsModal, setShowArenaTicketsModal] = useState(false);
  const [showDailyRewards, setShowDailyRewards] = useState(false);
  const [selectedDayForPreview, setSelectedDayForPreview] = useState<number | null>(null);
  const [showProfileCustomization, setShowProfileCustomization] = useState(false);
  const [showFriendProfile, setShowFriendProfile] = useState<Friendship | null>(null);
  const [trainingWager, setTrainingWager] = useState(0);

  useEffect(() => {
    if (showFriendProfile) {
      const friendId = showFriendProfile.uids.find(id => id !== user.id);
      if (friendId) {
        // Fetch fresh profile data when opening the profile to ensure medal counts and stats are up to date
        getDoc(doc(db, 'users', friendId)).then(snap => {
          if (snap.exists()) {
            setFriendProfiles(prev => ({ ...prev, [friendId]: { id: friendId, ...snap.data() } as User }));
          }
        }).catch(err => console.error("Error fetching fresh friend profile:", err));
      }
    }
  }, [showFriendProfile, user.id]);

  useEffect(() => {
    if (initialRivalId && friendships.length > 0) {
      const friendship = friendships.find(f => f.friendId === initialRivalId);
      if (friendship) {
        setShowFriendProfile(friendship);
        setView('profile');
        if (onRivalHandled) onRivalHandled();
      }
    }
  }, [initialRivalId, friendships, onRivalHandled]);

  // Check daily reward eligibility
  useEffect(() => {
    const checkDailyReward = () => {
      const now = Date.now();
      const lastClaim = user.lastDailyRewardClaim || 0;
      
      const lastClaimDate = new Date(lastClaim).toDateString();
      const nowDate = new Date(now).toDateString();
      
      if (lastClaimDate !== nowDate) {
        setShowDailyRewards(true);
        // Default preview to the day to be claimed
        const currentCycle = user.dailyRewardsCycle || 0;
        let nextDay = currentCycle + 1;
        if (nextDay > 7) nextDay = 1;
        setSelectedDayForPreview(nextDay);
      } else {
        // If already claimed today, preview the next day in the cycle
        const currentCycle = user.dailyRewardsCycle || 0;
        let nextDay = currentCycle + 1;
        if (nextDay > 7) nextDay = 1;
        setSelectedDayForPreview(nextDay);
      }
    };
    checkDailyReward();
  }, [user.lastDailyRewardClaim, user.dailyRewardsCycle]);

  // Fusion state
  const [isFusing, setIsFusing] = useState(false);
  const [fusingItem, setFusingItem] = useState<ArenaItem | null>(null);
  const [fusionResult, setFusionResult] = useState<{ success: boolean; skin?: Skin; ability?: Ability } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(soundManager.isSFXEnabled());
  const [showControls, setShowControls] = useState(false);
  const [highQuality, setHighQuality] = useState(true);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{ type: 'latest' | 'available' | 'error', msg: string } | null>(null);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const configSnap = await getDoc(doc(db, 'app_config', 'current'));
      if (configSnap.exists()) {
        const config = configSnap.data();
        const latestVersion = config.version || '0.0.0';
        
        if (compareVersions(APP_VERSION, latestVersion) < 0) {
          setUpdateStatus({ 
            type: 'available', 
            msg: `Nueva versión disponible: ${latestVersion}` 
          });
          // Also redirect if it's open
          if (config.downloadUrl) {
            window.open(config.downloadUrl, '_blank');
          }
        } else {
          setUpdateStatus({ 
            type: 'latest', 
            msg: '¡Estás usando la última versión!' 
          });
        }
      } else {
        setUpdateStatus({ type: 'latest', msg: '¡Estás usando la última versión!' });
      }
    } catch (err) {
      console.error('Update check error:', err);
      setUpdateStatus({ type: 'error', msg: 'Error al buscar actualizaciones' });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  useEffect(() => {
    const acceptedFriends = friendships.filter(f => f.status === 'accepted').length;
    const maxMatches = Math.max(0, ...friendships.map(f => f.gamesPlayed || 0));
    const botKills = user.botKills || 0;
    const insomnia = user.insomniaCount || 0;
    const money = user.highScoreMonedas || 0;

    const currentMedals = [
      { id: 'f_b', name: 'Amistad de Bronce', unlocked: acceptedFriends >= 10 },
      { id: 'f_s', name: 'Amistad de Plata', unlocked: acceptedFriends >= 50 },
      { id: 'f_g', name: 'Amistad de Oro', unlocked: acceptedFriends >= 100 },
      { id: 'f_p', name: 'Amistad de Platino', unlocked: acceptedFriends >= 1000 },
      { id: 'd_b', name: 'Duelo de Bronce', unlocked: maxMatches >= 500 },
      { id: 'd_s', name: 'Duelo de Plata', unlocked: maxMatches >= 1000 },
      { id: 'd_g', name: 'Duelo de Oro', unlocked: maxMatches >= 2500 },
      { id: 'm_b', name: 'Dinero de Bronce', unlocked: money >= 1000 },
      { id: 'm_s', name: 'Dinero de Plata', unlocked: money >= 10000 },
      { id: 'm_g', name: 'Dinero de Oro', unlocked: money >= 500000 },
      { id: 'e_b', name: 'Eliminador de Bronce', unlocked: botKills >= 10 },
      { id: 'e_s', name: 'Eliminador de Plata', unlocked: botKills >= 100 },
      { id: 'e_g', name: 'Eliminador de Oro', unlocked: botKills >= 1000 },
      { id: 'i_b', name: 'Insomnio de Bronce', unlocked: insomnia >= 1 },
      { id: 'i_s', name: 'Insomnio de Plata', unlocked: insomnia >= 30 },
      { id: 'i_g', name: 'Insomnio de Oro', unlocked: insomnia >= 365 },
    ];

    const allUnlocked = currentMedals.filter(m => m.unlocked).map(m => m.id);
    const newlyUnlocked = currentMedals.filter(m => m.unlocked && !unlockedMedalIds.includes(m.id));
    
    if (newlyUnlocked.length > 0) {
      // If it's the first run (unlockedMedalIds is empty), don't notify for everything
      if (unlockedMedalIds.length > 0) {
        setMedalNotification(newlyUnlocked[0]);
        setTimeout(() => setMedalNotification(null), 5000);
      }
      setUnlockedMedalIds(allUnlocked);
    }

    // Persist the count to the user profile so friends can see it
    // Check every time stats change to ensure DB is in sync
    if (user.id && allUnlocked.length !== user.trophies) {
      const userRef = doc(db, 'users', user.id);
      updateDoc(userRef, {
        trophies: allUnlocked.length
      }).catch(e => console.error("Error updating trophies count:", e));
    }
  }, [friendships, user.botKills, user.insomniaCount, user.highScoreMonedas, unlockedMedalIds, user.id, user.trophies]);

  useEffect(() => {
    const checkInsomnia = async () => {
      const now = new Date();
      const hour = now.getHours();
      if (hour >= 0 && hour < 5) {
        // Only increment once per session to avoid quota issues
        const sessionKey = `insomnia_checked_${user.id}_${now.toDateString()}`;
        if (!sessionStorage.getItem(sessionKey)) {
          const userRef = doc(db, 'users', user.id);
          await updateDoc(userRef, {
            insomniaCount: increment(1)
          });
          sessionStorage.setItem(sessionKey, 'true');
        }
      }
    };
    checkInsomnia();
  }, [user.id]);

  useEffect(() => {
    if (!user.usernameSet) {
      setShowUsernameModal(true);
    }
  }, [user.usernameSet]);

  // Gift fragments for tester
  useEffect(() => {
    if (user.email === 'martinezlucasn@gmail.com' && !sessionStorage.getItem('gift_fragments_v4')) {
      const grantFragments = async () => {
        try {
          const userRef = doc(db, 'users', user.id);
          const updates: any = {};
          ALL_ABILITIES.forEach(ability => {
            updates[`inventoryItems.${ability.fragmentId}`] = increment(4);
          });
          await updateDoc(userRef, updates);
          sessionStorage.setItem('gift_fragments_v4', 'true');
          setProfileMessage({ text: '¡4 fragmentos adicionales acreditados para pruebas!', type: 'success' });
          setTimeout(() => setProfileMessage(null), 5000);
        } catch (e) {
          console.error("Error gifting fragments:", e);
        }
      };
      grantFragments();
    }
  }, [user.id, user.email]);

  // Profile States
  const [newUsername, setNewUsername] = useState(user.displayName);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [withdrawAlias, setWithdrawAlias] = useState('');
  const [profileMessage, setProfileMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [withdrawalHistory, setWithdrawalHistory] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [profileTab, setProfileTab] = useState<'general' | 'friends'>('general');
  const [inventoryTab, setInventoryTab] = useState<'skins' | 'abilities'>('skins');
  const [friendToDelete, setFriendToDelete] = useState<{id: string, name: string} | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment') || params.get('status');
    const paymentId = params.get('payment_id') || params.get('collection_id');
    
    if (paymentId && (paymentStatus === 'success' || paymentStatus === 'approved')) {
      // Trigger manual check immediately to avoid waiting for webhook
      const checkPayment = async () => {
        try {
          const response = await fetch(`/api/check-payment/${paymentId}`);
          const data = await response.json();
          if (data.success) {
            setTicketMessage({ text: '¡Pago verificado y acreditado correctamente!', type: 'success' });
            
            // Get AI personalized message
            if (data.amount && data.type) {
              setIsGeminiLoading(true);
              try {
                const aiResponse = await ai.models.generateContent({
                  model: "gemini-3-flash-preview",
                  contents: `Un usuario (${user.displayName}) acaba de comprar ${data.amount} ${data.type === 'points' ? 'Puntos' : 'Monedas'}. Di algo motivador o divertido sobre su compra para el juego 'Viborita' (juego de snakes neon con apuestas). Mantén el mensaje corto (máximo 15 palabras) y en español.`,
                });
                setGeminiMessage(aiResponse.text);
              } catch (aiErr) {
                console.error("Gemini error:", aiErr);
              } finally {
                setIsGeminiLoading(false);
              }
            }
          } else if (data.status === 'approved' && data.already_processed) {
            setTicketMessage({ text: 'Pago ya procesado. Tus monedas ya deberían estar acreditadas.', type: 'success' });
          } else {
            setTicketMessage({ text: 'Verificando pago...tus monedas se acreditarán en segundos.', type: 'success' });
          }
        } catch (err) {
          console.error("Error verifying payment:", err);
          setTicketMessage({ text: 'Pago aprobado. La acreditación puede demorar unos segundos.', type: 'success' });
        }
      };

      checkPayment();
      
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => setTicketMessage(null), 8000);
    } else if (paymentStatus === 'failure' || paymentStatus === 'rejected') {
      setTicketMessage({ text: 'El pago fue cancelado o rechazado.', type: 'error' });
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => setTicketMessage(null), 5000);
    }
  }, []);

  useEffect(() => {
    if (geminiMessage) {
      const timer = setTimeout(() => {
        setGeminiMessage(null);
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [geminiMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (view === 'profile' || view === 'wallet') {
      const q = query(collection(db, 'withdrawals'), where('userId', '==', user.id), orderBy('timestamp', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const historyMap = new Map<string, any>();
        snapshot.forEach(doc => {
          historyMap.set(doc.id, { id: doc.id, ...doc.data() });
        });
        setWithdrawalHistory(Array.from(historyMap.values()));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'withdrawals'));
      return () => unsubscribe();
    }
  }, [view, user.id]);

  useEffect(() => {
    const sixtySecondsAgo = currentTime - 60000;
    const q = query(collection(db, 'users'), where('lastActive', '>', sixtySecondsAgo));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOnlineCount(snapshot.size);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'users'));
    return () => unsubscribe();
  }, [currentTime]);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('coins', 'desc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const playersMap = new Map<string, User>();
      snapshot.forEach((doc) => {
        playersMap.set(doc.id, { id: doc.id, ...doc.data() } as User);
      });
      setTopPlayers(Array.from(playersMap.values()));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'users'));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'friendships'), where('uids', 'array-contains', user.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const friendsMap = new Map<string, Friendship>();
      snapshot.forEach(doc => {
        friendsMap.set(doc.id, { id: doc.id, ...doc.data() } as Friendship);
      });
      const friends = Array.from(friendsMap.values());
      setFriendships(friends);
      
      // Fetch profiles for all friends
      friends.forEach(async (f) => {
        const friendId = f.uids.find(id => id !== user.id);
        if (friendId && !friendProfiles[friendId]) {
          const friendDoc = await getDoc(doc(db, 'users', friendId));
          if (friendDoc.exists()) {
            setFriendProfiles(prev => ({ ...prev, [friendId]: { id: friendId, ...friendDoc.data() } as User }));
          }
        }
      });
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'friendships'));
    return () => unsubscribe();
  }, [user.id]);

  useEffect(() => {
    const q = query(collection(db, 'notifications'), where('toId', '==', user.id), where('status', '==', 'pending'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notifsMap = new Map<string, GameNotification>();
      snapshot.forEach(doc => {
        notifsMap.set(doc.id, { id: doc.id, ...doc.data() } as GameNotification);
      });
      setNotifications(Array.from(notifsMap.values()));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'notifications'));
    return () => unsubscribe();
  }, [user.id]);

  const handleExchangePoints = async (points: number, monedasCost: number) => {
    if (user.monedas < monedasCost) {
      setTicketMessage({ text: 'Monedas insuficientes', type: 'error' });
      setTimeout(() => setTicketMessage(null), 3000);
      return;
    }

    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        monedas: user.monedas - monedasCost,
        coins: user.coins + points
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

      await supabase.from('profiles').update({
        monedas: user.monedas - monedasCost,
        coins: user.coins + points
      }).eq('id', user.id);

      await supabase.from('transactions').insert({
        user_id: user.id,
        type: 'exchange',
        currency: 'coins',
        amount: points,
        reason: `exchange_monedas_for_points: ${monedasCost} monedas`,
        timestamp: new Date().toISOString()
      });

      setTicketMessage({ text: `¡Canje exitoso! +${points} Puntos`, type: 'success' });
      setTimeout(() => setTicketMessage(null), 3000);
    } catch (e) {
      console.error('Error in handleExchangePoints:', e);
      setTicketMessage({ text: 'Error al procesar el canje', type: 'error' });
      setTimeout(() => setTicketMessage(null), 3000);
    }
  };

  const handleBuyTicket = async (type: 'pro' | 'millonario', coinsPrice: number, monedasPrice: number) => {
    if (user.coins < coinsPrice || user.monedas < monedasPrice) {
      setTicketMessage({ text: 'Saldo insuficiente', type: 'error' });
      setTimeout(() => setTicketMessage(null), 3000);
      return;
    }

    const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    const field = type === 'pro' ? 'proAccessUntil' : 'millonarioAccessUntil';

    try {
      const userRef = doc(db, 'users', user.id);
      
      // 1. Update User Document
      await updateDoc(userRef, {
        coins: user.coins - coinsPrice,
        monedas: user.monedas - monedasPrice,
        [field]: expiry
      }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

      // 2. Log Purchase in TicketPurchases collection
      await addDoc(collection(db, 'ticketPurchases'), {
        userId: user.id,
        email: user.email,
        type,
        coinsPrice,
        monedasPrice,
        expiry,
        timestamp: Date.now()
      }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'ticketPurchases'));

      // 3. Sync with Supabase
      const { error: supabaseError } = await supabase.from('profiles').update({
        coins: user.coins - coinsPrice,
        monedas: user.monedas - monedasPrice
      }).eq('id', user.id);

      if (supabaseError) throw supabaseError;

      setTicketMessage({ text: `Entrada ${type.toUpperCase()} comprada por 24hs`, type: 'success' });
      setTimeout(() => setTicketMessage(null), 3000);
    } catch (e) {
      console.error('Error in handleBuyTicket:', e);
      setTicketMessage({ text: 'Error al procesar la compra. Reintenta.', type: 'error' });
      setTimeout(() => setTicketMessage(null), 3000);
    }
  };

  const handleClaimDailyReward = async () => {
    const userRef = doc(db, 'users', user.id);
    
    try {
      await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) throw new Error("Documento de usuario no existe");

        const userData = userDoc.data();
        const now = Date.now();
        const lastClaim = userData.lastDailyRewardClaim || 0;
        const currentCycle = userData.dailyRewardsCycle || 0;
        
        let nextDay = currentCycle + 1;
        if (nextDay > 7) nextDay = 1;

        // Strict calendar day check
        const lastClaimDate = new Date(lastClaim).toDateString();
        const nowDate = new Date(now).toDateString();
        if (lastClaimDate === nowDate) throw new Error("Ya reclamaste hoy");

        const reward = DAILY_REWARDS[nextDay - 1];
        
        // Prepare updates
        const updates: any = {
          coins: (userData.coins || 0) + reward.points,
          monedas: (userData.monedas || 0) + (reward.monedas || 0),
          dailyRewardsCycle: nextDay,
          lastDailyRewardClaim: now
        };

        if (reward.proEntry) {
          updates.proAccessUntil = now + (24 * 60 * 60 * 1000);
        }
        if (reward.millonarioEntry) {
          updates.millonarioAccessUntil = now + (24 * 60 * 60 * 1000);
        }
        
        // Random fragments
        const inventoryItems = userData.inventoryItems || {};
        const skinFragments = ARENA_ITEMS.filter(item => !item.id.startsWith('frag_'));
        for (let i = 0; i < (reward.fragments || 0); i++) {
          const randomFrag = skinFragments[Math.floor(Math.random() * skinFragments.length)];
          if (randomFrag) {
            inventoryItems[randomFrag.id] = (inventoryItems[randomFrag.id] || 0) + 1;
          }
        }
        updates.inventoryItems = inventoryItems;

        // Random ability
        if (reward.randomAbility) {
          const inventoryAbilities = userData.inventoryAbilities || {};
          const randomAbility = ALL_ABILITIES[Math.floor(Math.random() * ALL_ABILITIES.length)];
          if (randomAbility) {
            inventoryAbilities[randomAbility.id] = (inventoryAbilities[randomAbility.id] || 0) + 1;
            updates.inventoryAbilities = inventoryAbilities;
          }
        }

        transaction.update(userRef, updates);
      });

      // UI Feedback - currentCycle will update via onSnapshot in App.tsx
      setTicketMessage({ text: '¡Recompensa reclamada con éxito!', type: 'success' });
      setTimeout(() => setTicketMessage(null), 4000);
    } catch (e: any) {
      console.error("Error claiming daily reward:", e);
      if (e.message !== "Ya reclamaste hoy") {
        setTicketMessage({ text: 'Error al reclamar recompensa', type: 'error' });
        setTimeout(() => setTicketMessage(null), 3000);
      }
    }
  };

  const getTimeRemaining = (expiry: number) => {
    const remaining = expiry - Date.now();
    if (remaining <= 0) return null;
    
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    return { hours, minutes, totalHours: hours + minutes / 60 };
  };

  const copyAlias = () => {
    navigator.clipboard.writeText('latorre44');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendFriendRequest = async (search: string) => {
    if (!search.trim()) return;
    
    try {
      let targetUser: User | null = null;
      
      // Search by Username (displayName) first
      const qName = query(collection(db, 'users'), where('displayName', '==', search.trim()));
      const snapName = await getDocs(qName);
      
      if (!snapName.empty) {
        targetUser = { id: snapName.docs[0].id, ...snapName.docs[0].data() } as User;
      } else {
        // Search by ID
        const idDoc = await getDoc(doc(db, 'users', search.trim()));
        if (idDoc.exists()) {
          targetUser = { id: idDoc.id, ...idDoc.data() } as User;
        } else {
          // Search by Email (lowercase)
          const qEmail = query(collection(db, 'users'), where('email', '==', search.trim().toLowerCase()));
          const snapEmail = await getDocs(qEmail);
          if (!snapEmail.empty) {
            targetUser = { id: snapEmail.docs[0].id, ...snapEmail.docs[0].data() } as User;
          }
        }
      }

      if (!targetUser) {
        setProfileMessage({ text: 'Usuario no encontrado', type: 'error' });
        return;
      }

      if (targetUser.id === user.id) {
        setProfileMessage({ text: 'No puedes enviarte una solicitud a ti mismo', type: 'error' });
        return;
      }

      // Check if already friends or request pending
      const existingQ = query(collection(db, 'friendships'), where('uids', 'array-contains', user.id));
      const existingSnapshot = await getDocs(existingQ);
      const alreadyExists = existingSnapshot.docs.some(doc => {
        const data = doc.data();
        return data.uids.includes(targetUser!.id);
      });

      if (alreadyExists) {
        setProfileMessage({ text: 'Ya existe una relación o solicitud pendiente', type: 'error' });
        return;
      }

      await addDoc(collection(db, 'friendships'), {
        uids: [user.id, targetUser.id],
        status: 'pending',
        requesterId: user.id,
        gamesPlayed: 0,
        stats: {
          [user.id]: { wins: 0 },
          [targetUser.id]: { wins: 0 }
        },
        timestamp: Date.now()
      });

      setProfileMessage({ text: 'Solicitud enviada correctamente', type: 'success' });
      setFriendSearch('');
    } catch (e) {
      console.error('Error sending friend request:', e);
      setProfileMessage({ text: 'Error al enviar solicitud', type: 'error' });
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const handleAcceptFriendRequest = async (friendshipId: string) => {
    try {
      await updateDoc(doc(db, 'friendships', friendshipId), {
        status: 'accepted',
        timestamp: Date.now()
      });
      setProfileMessage({ text: 'Solicitud aceptada', type: 'success' });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'friendships/' + friendshipId);
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const handleRejectFriendRequest = async (friendshipId: string) => {
    try {
      await deleteDoc(doc(db, 'friendships', friendshipId));
      setProfileMessage({ text: 'Solicitud rechazada', type: 'success' });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'friendships/' + friendshipId);
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const handleDeleteFriend = async (friendshipId: string) => {
    try {
      await deleteDoc(doc(db, 'friendships', friendshipId));
      setProfileMessage({ text: 'Amigo eliminado', type: 'success' });
      setShowFriendProfile(null);
      setSelectedFriend(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'friendships/' + friendshipId);
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const handleWithdrawListing = async (listing: SkinListing) => {
    try {
      const userRef = doc(db, 'users', user.id);
      const listingRef = doc(db, 'skinSales', listing.id);

      await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) throw new Error("Usuario no encontrado");
        
        const listingDoc = await transaction.get(listingRef);
        if (!listingDoc.exists()) throw new Error("Publicación no encontrada");
        if (listingDoc.data().status !== 'active') throw new Error("La publicación ya no está activa");

        transaction.update(userRef, {
          ownedSkins: arrayUnion(listing.skinId)
        });
        transaction.delete(listingRef);
      });

      setProfileMessage({ text: 'Skin retirada y devuelta al inventario', type: 'success' });
    } catch (e) {
      console.error("Error withdrawing listing:", e);
      setProfileMessage({ text: 'Error al retirar la skin', type: 'error' });
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const handleClaimMedalReward = async (medalId: string) => {
    if (medalId !== 'f_p') return;
    if (user.claimedPlatinumReward) return;

    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        ownedSkins: arrayUnion('lightning'),
        claimedPlatinumReward: true
      });
      setProfileMessage({ text: '¡Felicidades! Has reclamado el Rayo Eterno ⚡', type: 'success' });
      setSelectedMedal(prev => prev ? { ...prev, claimed: true } : null);
    } catch (e) {
      console.error("Error claiming reward:", e);
      setProfileMessage({ text: 'Error al reclamar la skin', type: 'error' });
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const handleInviteFriend = async (friendId: string, wager: number) => {
    if (user.monedas < wager) {
      setProfileMessage({ text: 'No tienes suficientes monedas', type: 'error' });
      return;
    }

    try {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      // Create private room
      await setDoc(doc(db, 'privateRooms', roomId), {
        id: roomId,
        creatorId: user.id,
        wager,
        createdAt: Date.now(),
        status: 'open'
      });

      // Send notification
      await addDoc(collection(db, 'notifications'), {
        type: 'game_invite',
        fromId: user.id,
        fromName: user.displayName,
        toId: friendId,
        roomId,
        wager,
        status: 'pending',
        timestamp: Date.now()
      });

      setProfileMessage({ text: 'Invitación enviada', type: 'success' });
      onStartWager(wager, 10, `private_${roomId}`);
    } catch (e) {
      console.error('Error inviting friend:', e);
      setProfileMessage({ text: 'Error al enviar invitación', type: 'error' });
    }
  };

  const handleConfirmUsername = async () => {
    if (!tempUsername.trim() || tempUsername.length < 3) {
      setProfileMessage({ text: 'Nombre demasiado corto', type: 'error' });
      return;
    }

    const isFirstTime = !user.usernameSet;
    const cost = isFirstTime ? 0 : 10000;

    if (!isFirstTime && user.coins < cost) {
      setProfileMessage({ text: 'Saldo de puntos insuficiente (10,000 puntos requeridos)', type: 'error' });
      return;
    }

    setIsCheckingUsername(true);
    try {
      // Check if username is taken
      const q = query(collection(db, 'users'), where('displayName', '==', tempUsername.trim()));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty && snapshot.docs[0].id !== user.id) {
        setProfileMessage({ text: 'Este nombre de usuario ya está en uso', type: 'error' });
        setIsCheckingUsername(false);
        return;
      }

      const userRef = doc(db, 'users', user.id);
      const updates: any = {
        displayName: tempUsername.trim(),
        usernameSet: true
      };

      if (!isFirstTime) {
        updates.coins = increment(-cost);
      }

      await updateDoc(userRef, updates);

      // Sync with Supabase (optional, but good for consistency)
      await supabase.from('profiles').update({
        display_name: tempUsername.trim(),
        coins: user.coins - cost
      }).eq('id', user.id);

      setShowUsernameModal(false);
      setProfileMessage({ text: isFirstTime ? 'Nombre de usuario establecido' : 'Nombre de usuario actualizado', type: 'success' });
    } catch (e) {
      console.error('Error updating username:', e);
      setProfileMessage({ text: 'Error al actualizar nombre', type: 'error' });
    } finally {
      setIsCheckingUsername(false);
      setTimeout(() => setProfileMessage(null), 3000);
    }
  };

  const handleTransfer = async (friendId: string, amount: number, currency: 'coins' | 'monedas') => {
    if (amount <= 0) return;
    if ((currency === 'coins' ? user.coins : user.monedas) < amount) {
      setProfileMessage({ text: 'Saldo insuficiente', type: 'error' });
      return;
    }

    try {
      const userRef = doc(db, 'users', user.id);
      const friendRef = doc(db, 'users', friendId);

      await updateDoc(userRef, {
        [currency]: increment(-amount)
      });

      await updateDoc(friendRef, {
        [currency]: increment(amount)
      });

      // Sync Supabase
      await supabase.from('profiles').update({
        [currency]: (currency === 'coins' ? user.coins : user.monedas) - amount
      }).eq('id', user.id);

      const friendDoc = await getDoc(friendRef);
      if (friendDoc.exists()) {
        const friendData = friendDoc.data();
        await supabase.from('profiles').update({
          [currency]: (friendData[currency] || 0)
        }).eq('id', friendId);
      }

      setProfileMessage({ text: 'Transferencia exitosa', type: 'success' });
      setShowTransferModal(false);
      setTransferAmount(0);
    } catch (e) {
      console.error('Error in transfer:', e);
      setProfileMessage({ text: 'Error al transferir', type: 'error' });
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const [showListModal, setShowListModal] = useState<{ skin: Skin } | null>(null);
  const [listPrice, setListPrice] = useState(10);
  const [isListing, setIsListing] = useState(false);
  const [listings, setListings] = useState<SkinListing[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'skinSales'), where('status', '==', 'active'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: SkinListing[] = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() } as SkinListing));
      setListings(list);
    });
    return () => unsubscribe();
  }, []);

  const handleSellToSystem = async (skin: Skin) => {
    if (skin.id === 'default') {
      setProfileMessage({ text: 'No puedes vender el skin base', type: 'error' });
      return;
    }
    const rawPrice = skin.price || (skin.rarity === 'legendary' ? 15000 : skin.rarity === 'epic' ? 10000 : skin.rarity === 'rare' ? 5000 : 2000);
    const currency = skin.currency || 'coins';
    
    // Calculate point sell price: coin-skins sell for 20x their coin value * 0.5 (more valuable than point skins)
    // Point-skins sell for rawPrice * 0.5
    const sellPrice = currency === 'monedas' 
      ? Math.floor(rawPrice * 20 * 0.5) 
      : Math.floor(rawPrice * 0.5);

    const skinIndex = user.ownedSkins.indexOf(skin.id);
    if (skinIndex === -1) return;

    const newOwnedSkins = [...user.ownedSkins];
    newOwnedSkins.splice(skinIndex, 1);

    const userRef = doc(db, 'users', user.id);
    await updateDoc(userRef, {
      ownedSkins: newOwnedSkins,
      coins: increment(sellPrice)
    });

    // Supabase sync
    await supabase.from('profiles').update({
      coins: user.coins + sellPrice
    }).eq('id', user.id);

    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'earned',
      currency: 'coins',
      amount: sellPrice,
      reason: `system_resale: ${skin.name}`,
      timestamp: new Date().toISOString()
    });

    setProfileMessage({ text: `¡Skin vendida! Recibiste +${sellPrice.toLocaleString()} Puntos`, type: 'success' });
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const handleDeleteFriendship = async () => {
    if (!friendToDelete) return;
    try {
      await deleteDoc(doc(db, 'friendships', friendToDelete.id));
      setProfileMessage({ text: 'Amigo eliminado correctamente', type: 'success' });
      setSelectedFriend(null);
      setTimeout(() => setProfileMessage(null), 3000);
    } catch (error) {
      console.error('Error deleting friendship:', error);
      setProfileMessage({ text: 'Error al eliminar amigo', type: 'error' });
      setTimeout(() => setProfileMessage(null), 3000);
    } finally {
      setFriendToDelete(null);
    }
  };

  const handleListSkin = async (skin: Skin, price: number) => {
    if (price <= 0 || isListing) return;
    const skinIndex = user.ownedSkins.indexOf(skin.id);
    if (skinIndex === -1) return;

    setIsListing(true);

    try {
      const newOwnedSkins = [...user.ownedSkins];
      newOwnedSkins.splice(skinIndex, 1);

      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        ownedSkins: newOwnedSkins
      });

      await addDoc(collection(db, 'skinSales'), {
        sellerId: user.id,
        sellerName: user.displayName,
        skinId: skin.id,
        price: price,
        timestamp: Date.now(),
        status: 'active'
      });

      // Wait for 3 seconds before closing and showing success
      setTimeout(() => {
        setIsListing(false);
        setShowListModal(null);
        setView('profile');
        setProfileTab('friends');
        setProfileMessage({ text: 'Skin publicada para tus amigos', type: 'success' });
        setTimeout(() => setProfileMessage(null), 3000);
      }, 3000);
    } catch (e) {
      console.error('Error listing skin:', e);
      setProfileMessage({ text: 'Error al publicar skin', type: 'error' });
      setIsListing(false);
      setTimeout(() => setProfileMessage(null), 3000);
    }
  };

  const handleBuyFromFriend = async (listing: SkinListing) => {
    if (user.monedas < listing.price) {
      setProfileMessage({ text: 'Monedas insuficientes', type: 'error' });
      setTimeout(() => setProfileMessage(null), 3000);
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const listingDoc = await transaction.get(doc(db, 'skinSales', listing.id));
        if (!listingDoc.exists() || listingDoc.data()?.status !== 'active') {
          throw new Error('La skin ya no está disponible');
        }

        const buyerRef = doc(db, 'users', user.id);
        const sellerRef = doc(db, 'users', listing.sellerId);
        
        transaction.update(buyerRef, {
          monedas: increment(-listing.price),
          ownedSkins: arrayUnion(listing.skinId)
        });

        transaction.update(sellerRef, {
          monedas: increment(listing.price)
        });

        transaction.update(doc(db, 'skinSales', listing.id), {
          status: 'sold'
        });
      });

      // Supabase sync (only local user for simplicity, seller will sync on next login/activity)
      await supabase.from('profiles').update({ monedas: user.monedas - listing.price }).eq('id', user.id);

      await supabase.from('transactions').insert([
        {
          user_id: user.id,
          type: 'spent',
          currency: 'monedas',
          amount: listing.price,
          reason: `market_buy: ${listing.skinId} from ${listing.sellerName}`,
          timestamp: new Date().toISOString()
        },
        {
          user_id: listing.sellerId,
          type: 'earned',
          currency: 'monedas',
          amount: listing.price,
          reason: `market_sold: ${listing.skinId} to ${user.displayName}`,
          timestamp: new Date().toISOString()
        }
      ]);

      setProfileMessage({ text: 'Skin comprada con éxito!', type: 'success' });
    } catch (e: any) {
      console.error('Error buying skin:', e);
      setProfileMessage({ text: e.message || 'Error al comprar skin', type: 'error' });
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const equippedSkin = ALL_SKINS.find(s => s.id === user.equippedSkin) || ALL_SKINS[0];

  const handleCreatePreference = async (amount: number, type: 'monedas' | 'points' = 'monedas', pointsAmount: number = 0, price?: number) => {
    setIsCreatingPreference(true);
    try {
      // Use window.location.origin to ensure we point to the current server instance
      const response = await fetch(`${window.location.origin}/api/create-preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          userId: user.id,
          email: user.email,
          type,
          pointsAmount,
          price: price || amount
        })
      });

      const data = await response.json();
      if (data.init_point) {
        window.location.href = data.init_point;
      } else {
        throw new Error(data.error || 'Error al crear el pago');
      }
    } catch (error) {
      console.error('Error:', error);
      setTicketMessage({ text: 'Error al conectar con Mercado Pago', type: 'error' });
      setTimeout(() => setTicketMessage(null), 3000);
    } finally {
      setIsCreatingPreference(false);
    }
  };

  const handleEquip = async (skinId: string) => {
    const userRef = doc(db, 'users', user.id);
    await updateDoc(userRef, { equippedSkin: skinId })
      .catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
    
    // Sync with Supabase
    await supabase.from('profiles').update({ equipped_skin: skinId }).eq('id', user.id);
  };
  
  const handleEquipAbility = async (abilityId: string) => {
    const currentEquipped = user.equippedAbilities || [];
    const isEquipped = currentEquipped.includes(abilityId);
    
    let newEquipped: string[];
    if (isEquipped) {
      newEquipped = currentEquipped.filter(id => id !== abilityId);
    } else {
      newEquipped = [...currentEquipped, abilityId];
    }
    
    const userRef = doc(db, 'users', user.id);
    await updateDoc(userRef, { equippedAbilities: newEquipped })
      .catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
  };

  const handleSellAbilityToSystem = async (ability: Ability) => {
    const count = user.inventoryAbilities?.[ability.id] || 0;
    if (count <= 0) return;

    const sellPrice = 10000;
    const userRef = doc(db, 'users', user.id);
    
    try {
      await updateDoc(userRef, {
        [`inventoryAbilities.${ability.id}`]: increment(-1),
        coins: increment(sellPrice)
      });
      
      setProfileMessage({ text: `Habilidad vendida por ${sellPrice.toLocaleString()} Puntos`, type: 'success' });
    } catch (e) {
      console.error('Error selling ability:', e);
      setProfileMessage({ text: 'Error al vender habilidad', type: 'error' });
    }
    setTimeout(() => setProfileMessage(null), 3000);
  };

  const [showAbilityListingModal, setShowAbilityListingModal] = useState<{ ability: Ability } | null>(null);

  const handleUpdateUsername = async () => {
    if (!newUsername.trim() || newUsername === user.displayName) return;
    
    // Cost check: 10,000 points if not the first time
    if (user.usernameSet && user.coins < 10000) {
      setProfileMessage({ text: 'Necesitas 10.000 puntos para cambiar tu nombre', type: 'error' });
      setTimeout(() => setProfileMessage(null), 3000);
      return;
    }

    setIsUpdatingProfile(true);
    try {
      // Check if username is taken (unique check)
      const q = query(collection(db, 'users'), where('displayName', '==', newUsername.trim()));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        setProfileMessage({ text: 'El nombre de usuario ya está en uso', type: 'error' });
        return;
      }

      const userRef = doc(db, 'users', user.id);
      const updateData: any = { 
        displayName: newUsername.trim(),
        usernameSet: true 
      };

      // Deduct coins if not the first time
      if (user.usernameSet) {
        updateData.coins = user.coins - 10000;
      }

      await updateDoc(userRef, updateData);
      
      // Sync with Supabase
      const supabaseData: any = { display_name: newUsername.trim() };
      if (user.usernameSet) {
        supabaseData.coins = user.coins - 10000;
      }
      await supabase.from('profiles').update(supabaseData).eq('id', user.id);
      
      setProfileMessage({ text: user.usernameSet ? 'Nombre actualizado (-10.000 pts)' : 'Nombre establecido (Gratis)', type: 'success' });
    } catch (e) {
      setProfileMessage({ text: 'Error al actualizar', type: 'error' });
    } finally {
      setIsUpdatingProfile(false);
      setTimeout(() => setProfileMessage(null), 3000);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawAmount < 1000 || withdrawAmount > user.monedas || !withdrawAlias.trim()) return;
    setIsUpdatingProfile(true);
    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, { 
        monedas: user.monedas - withdrawAmount 
      });

      // Sync with Supabase
      await supabase.from('profiles').update({ 
        monedas: user.monedas - withdrawAmount 
      }).eq('id', user.id);

      // Create a withdrawal request in Firestore for admin to see
      const withdrawalData = {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        amount: withdrawAmount,
        alias: withdrawAlias,
        status: 'pending',
        timestamp: Date.now()
      };
      
      const docRef = await addDoc(collection(db, 'withdrawals'), withdrawalData);

      // Sync with Supabase
      await supabase.from('withdrawals').insert({
        id_firestore: docRef.id,
        user_id: user.id,
        display_name: user.displayName,
        email: user.email,
        amount: withdrawAmount,
        alias: withdrawAlias,
        status: 'pending',
        created_at: new Date().toISOString()
      });

      setProfileMessage({ text: `Solicitud de retiro por ${withdrawAmount} enviada`, type: 'success' });
      setWithdrawAmount(0);
      setWithdrawAlias('');
    } catch (e) {
      setProfileMessage({ text: 'Error al procesar el retiro', type: 'error' });
    } finally {
      setIsUpdatingProfile(false);
      setTimeout(() => setProfileMessage(null), 3000);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Error signing out:', e);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmation = window.prompt(`¿ESTÁS ABSOLUTAMENTE SEGURO? Esta acción es IRREVERSIBLE y perderás todos tus puntos, monedas y skins para siempre.\n\nPara confirmar, escribe tu nombre de usuario exactamente: "${user.displayName}"`);
    
    if (confirmation !== user.displayName) {
      if (confirmation !== null) {
        setProfileMessage({ text: 'El nombre no coincide. Acción cancelada.', type: 'error' });
        setTimeout(() => setProfileMessage(null), 3000);
      }
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) return;

    setIsUpdatingProfile(true);
    try {
      // Set flag to avoid auto-recreation in App.tsx
      sessionStorage.setItem('deleting_account', 'true');
      
      // 1. Delete from Firestore
      await deleteDoc(doc(db, 'users', user.id));
      
      // 2. Delete from Supabase
      await supabase.from('profiles').delete().eq('id', user.id);
      
      // 3. Delete Firebase Auth User
      await deleteUser(currentUser);
      
      setProfileMessage({ text: 'Cuenta desvinculada con éxito', type: 'success' });
      window.location.reload();
    } catch (e: any) {
      console.error('Error deleting account:', e);
      sessionStorage.removeItem('deleting_account');
      if (e.code === 'auth/requires-recent-login') {
        setProfileMessage({ text: 'Por seguridad, debes volver a iniciar sesión antes de desvincular la cuenta', type: 'error' });
      } else {
        setProfileMessage({ text: 'Error al desvincular la cuenta: ' + e.message, type: 'error' });
      }
    } finally {
      setIsUpdatingProfile(false);
      setTimeout(() => setProfileMessage(null), 3000);
    }
  };

  const handleCreatePrivateRoom = async (wager: number) => {
    if (user.monedas < wager) {
      setRoomError('Monedas insuficientes');
      return;
    }
    
    // Generate unique 4-digit numeric code
    let newCode = '';
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 10) {
      newCode = Math.floor(1000 + Math.random() * 9000).toString();
      const roomRef = doc(db, 'privateRooms', newCode);
      const roomSnap = await getDoc(roomRef).catch(() => null);
      if (!roomSnap || !roomSnap.exists()) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      setRoomError('Error al generar código. Intenta de nuevo.');
      return;
    }

    const roomRef = doc(db, 'privateRooms', newCode);
    await setDoc(roomRef, {
      id: newCode,
      creatorId: user.id,
      wager: wager,
      createdAt: Date.now(),
      status: 'open'
    }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'privateRooms'));

    setShowCreateConfirm({ code: newCode, wager: wager });
  };

  const handleBuy = (skin: Skin, price: number) => {
    setPurchaseConfirmation({ skin, price });
  };

  const executePurchase = async (skin: Skin, price: number) => {
    setPurchaseConfirmation(null);
    const currency = skin.currency || 'coins';
    const userBalance = currency === 'coins' ? user.coins : user.monedas;
    
    if (userBalance < price) return;
    
    const userRef = doc(db, 'users', user.id);
    const updateData: any = {
      ownedSkins: [...user.ownedSkins, skin.id]
    };
    
    if (currency === 'coins') {
      updateData.coins = user.coins - price;
    } else {
      updateData.monedas = user.monedas - price;
    }
    
    await updateDoc(userRef, updateData).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

    // Sync with Supabase
    await supabase.from('inventory').insert({
      user_id: user.id,
      skin_id: skin.id,
      acquired_at: new Date().toISOString()
    });

    // Record transaction
    await supabase.from('transactions').insert({
      user_id: user.id,
      type: 'spent',
      currency: currency,
      amount: price,
      reason: `store_purchase: ${skin.name}`,
      timestamp: new Date().toISOString()
    });

    // Update profile balance in Supabase
    const supabaseUpdate: any = {};
    if (currency === 'coins') {
      supabaseUpdate.coins = user.coins - price;
    } else {
      supabaseUpdate.monedas = user.monedas - price;
    }
    
    await supabase.from('profiles').update(supabaseUpdate).eq('id', user.id);
  };

  const handleStartFusion = async (item: ArenaItem) => {
    const count = user.inventoryItems?.[item.id] || 0;
    if (count < 4) {
      setGeminiMessage('Necesitas al menos 4 elementos del mismo tipo para intentar la fusión.');
      setIsGeminiLoading(true);
      setTimeout(() => setIsGeminiLoading(false), 3000);
      return;
    }
    if (user.coins < 1000) {
      setGeminiMessage('Necesitas 1000 Puntos para la caja de fusión.');
      setIsGeminiLoading(true);
      setTimeout(() => setIsGeminiLoading(false), 3000);
      return;
    }

    setFusingItem(item);
    setIsFusing(true);
    setFusionResult(null);
    soundManager.play('star');

    // Deduction
    const userRef = doc(db, 'users', user.id);
    await updateDoc(userRef, {
      coins: increment(-1000),
      [`inventoryItems.${item.id}`]: increment(-4)
    }).catch(e => console.error("Error updating fusion cost:", e));

    // 4 seconds
    setTimeout(async () => {
      const successRate = SUCCESS_RATES[item.rarity];
      const success = Math.random() < successRate;
      
      if (success) {
        if (item.skinId.startsWith('ability_')) {
          const abilityId = item.skinId.replace('ability_', '');
          const ability = ALL_ABILITIES.find(a => a.id === abilityId);
          setFusionResult({ success: true, ability });
        } else {
          const skin = ALL_SKINS.find(s => s.id === item.skinId);
          setFusionResult({ success: true, skin });
        }
      } else {
        setFusionResult({ success: false });
      }
      setIsFusing(false);
    }, 4000);
  };

  const handleCollectFusionReward = async () => {
    if (!fusionResult?.success || (!fusionResult.skin && !fusionResult.ability)) return;
    
    console.log("Recolectando recompensa de fusión:", fusionResult.ability ? 'Habilidad' : 'Skin');
    const userRef = doc(db, 'users', user.id);
    try {
      if (fusionResult.skin) {
        await updateDoc(userRef, {
          ownedSkins: arrayUnion(fusionResult.skin.id)
        });
      } else if (fusionResult.ability) {
        const abilityPath = `inventoryAbilities.${fusionResult.ability.id}`;
        await updateDoc(userRef, {
          [abilityPath]: increment(1)
        });
      }
      soundManager.play('star');
      setProfileMessage({ text: '¡Recompensa recolectada con éxito!', type: 'success' });
    } catch (e: any) {
      console.error("Error collecting reward:", e);
      setProfileMessage({ text: `Error al recolectar: ${e.message}`, type: 'error' });
    } finally {
      // Always reset state even if Firestore fails to prevent getting stuck
      setFusionResult(null);
      setFusingItem(null);
      setTimeout(() => setProfileMessage(null), 3000);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="flex min-h-full w-full flex-col items-center justify-center p-4 pb-20 text-white">
      {view === 'main' && (
        <div className="flex w-full max-w-md flex-col gap-4">
          <button 
            onClick={() => setShowSettings(true)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-gray-800/80 text-gray-400 transition-all hover:bg-blue-600/20 hover:text-blue-400 border border-white/5 active:scale-95 shadow-lg backdrop-blur-sm z-50"
            title="Ajustes"
          >
            <Settings size={20} />
          </button>

          <button 
            onClick={() => setShowDailyRewards(true)}
            className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-gray-800/80 text-yellow-500 transition-all hover:bg-yellow-600/20 hover:text-yellow-400 border border-white/5 active:scale-95 shadow-lg backdrop-blur-sm z-50"
            title="Recompensas Diarias"
          >
            <Calendar size={20} />
            {(() => {
                const lastClaim = user.lastDailyRewardClaim || 0;
                const lastClaimDate = new Date(lastClaim).toDateString();
                const nowDate = new Date().toDateString();
                if (lastClaimDate !== nowDate) {
                    return <div className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full border-2 border-gray-900 animate-pulse" />;
                }
                return null;
            })()}
          </button>

          {user.email === 'martinezlucasn@gmail.com' && (
            <button 
              onClick={() => setShowAdmin(true)}
              className="absolute right-4 top-16 flex h-10 w-10 items-center justify-center rounded-full bg-red-600/20 text-red-500 transition-all hover:bg-red-600/40 z-50"
              title="Panel Maestro"
            >
              <ShieldCheck size={20} />
            </button>
          )}
          <div className="mb-8 text-center">
            <motion.h1 
              animate={{ 
                y: [0, -2, 0],
                rotate: [0, 0.5, 0]
              }}
              transition={{ 
                duration: 4, 
                repeat: Infinity, 
                ease: "easeInOut" 
              }}
              className="text-5xl font-black italic tracking-tighter text-blue-500 text-center no-underline uppercase"
            >
              Viborita
            </motion.h1>
            <p className="text-gray-400">Apuesta en base a tus habilidades, gana dinero</p>
          </div>

          <div className="flex flex-col items-center w-full">
            <div className="bg-gray-800/80 px-4 py-1.5 rounded-t-xl border-t border-x border-white/10 backdrop-blur-md flex items-center gap-2">
              {user.avatarConfig && (
                <img 
                  src={`https://api.dicebear.com/7.x/${user.avatarConfig.style}/svg?seed=${user.avatarConfig.seed}`}
                  className="h-4 w-4 rounded-full bg-blue-500/10"
                  alt="Perfil"
                />
              )}
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">
                Bienvenido <span className="text-white">{user.displayName}</span>
              </p>
            </div>
            <div className="relative w-full mb-4 flex flex-col items-center justify-center gap-4 rounded-2xl rounded-t-none bg-gray-800/50 px-6 py-4 backdrop-blur-md border border-white/5">
              <div className="flex items-center justify-center gap-4 w-full">
              <div className="flex flex-col items-center border-r border-white/10 pr-6">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Puntos</span>
                <div className="flex items-center gap-2">
                  <GoldPointIcon size={20} />
                  <motion.span 
                    key={`menu-coins-${user.coins}`}
                    initial={{ scale: 1.2, color: '#4ade80' }}
                    animate={{ scale: 1, color: '#ffffff' }}
                    className="text-2xl font-black"
                  >
                    {user.coins}
                  </motion.span>
                </div>
              </div>
              <div 
                className="flex flex-col items-center pl-2 cursor-pointer group"
                onClick={() => setView('wallet')}
              >
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1 group-hover:text-blue-300 transition-colors">Monedas</span>
                <div className="flex items-center gap-2">
                  <MonedasIcon size={20} />
                  <motion.span 
                    key={`menu-monedas-${user.monedas}`}
                    initial={{ scale: 1.2, color: '#60a5fa' }}
                    animate={{ scale: 1, color: '#ffffff' }}
                    className="text-2xl font-black group-hover:text-blue-200 transition-colors"
                  >
                    {user.monedas}
                  </motion.span>
                  <div 
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-transform group-hover:scale-110 active:scale-95"
                    title="Cargar Monedas"
                  >
                    <Plus size={14} strokeWidth={3} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => setShowWagerModal(true)}
              className="group relative flex w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 py-6 text-xl font-black uppercase tracking-tighter transition-all hover:bg-blue-500 active:scale-95 shadow-[0_0_20px_rgba(37,99,235,0.3)]"
            >
              <div className="absolute left-4 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/20 px-2 py-1">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                </span>
                <span className="text-[10px] font-bold text-white">{onlineCount}</span>
              </div>
              <MonedasIcon size={24} /> 
              <span>COMPETICIÓN GLOBAL</span>
            </button>

            <button
              onClick={() => setShowTrainingModal(true)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gray-800 py-6 text-xl font-black uppercase tracking-tighter transition-all hover:bg-gray-700 active:scale-95 border border-white/5 shadow-lg"
            >
              <GoldPointIcon size={24} />
              <span>JUGAR POR PUNTOS</span>
            </button>

            <button
              onClick={() => setView('fusion')}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-purple-600/40 to-blue-600/40 py-6 text-xl font-black uppercase tracking-tighter transition-all hover:from-purple-600/60 hover:to-blue-600/60 active:scale-95 border border-purple-500/30 shadow-[0_0_20px_rgba(147,51,234,0.2)] group"
            >
              <Zap size={26} className="text-yellow-400 group-hover:rotate-12 transition-transform" />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-purple-200">CAJA DE FUSIÓN</span>
            </button>

            <button
              onClick={() => setView('wallet')}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-blue-600/20 py-6 text-xl font-black uppercase tracking-tighter transition-all hover:bg-blue-600/30 active:scale-95 border border-blue-500/30 shadow-lg"
            >
              <CreditCard size={24} className="text-blue-400" />
              <span>MI BILLETERA</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setView('profile')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gray-800 py-4 font-bold hover:bg-gray-700 border border-white/5"
            >
              <UserIcon size={20} className="text-blue-400" />
              <span className="text-[10px] uppercase tracking-widest">Perfil</span>
            </button>
            <button
              onClick={() => setView('inventory')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gray-800 py-4 font-bold hover:bg-gray-700 border border-white/5"
            >
              <ShoppingBag size={20} className="text-purple-400" />
              <span className="text-[10px] uppercase tracking-widest">Inventario</span>
            </button>
            <button
              onClick={() => setView('shop')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gray-800 py-4 font-bold hover:bg-gray-700 border border-white/5"
            >
              <ShoppingBag size={20} className="text-yellow-500" />
              <span className="text-[10px] uppercase tracking-widest">Tienda</span>
            </button>
            <button
              onClick={() => setView('ranking')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gray-800 py-4 font-bold hover:bg-gray-700 border border-white/5"
            >
              <Trophy size={20} className="text-yellow-500" />
              <span className="text-[10px] uppercase tracking-widest">Ranking</span>
            </button>
          </div>

          <div className="mt-8 flex items-center justify-center gap-6 border-t border-white/5 pt-8">
            <button className="text-gray-500 transition-all hover:scale-110 hover:text-pink-500" title="Instagram">
              <Instagram size={24} />
            </button>
            <button className="text-gray-500 transition-all hover:scale-110 hover:text-blue-500" title="Facebook">
              <Facebook size={24} />
            </button>
            <button className="text-gray-500 transition-all hover:scale-110 hover:text-red-500" title="YouTube">
              <Youtube size={24} />
            </button>
            <button className="text-gray-500 transition-all hover:scale-110 hover:text-purple-500" title="Twitch">
              <Twitch size={24} />
            </button>
          </div>
        </div>
      )}

      {view === 'profile' && (
        <div className="w-full max-w-md rounded-3xl bg-gray-900/90 p-8 backdrop-blur-xl border border-white/10 shadow-2xl">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-blue-500/20 p-2">
                <UserIcon className="text-blue-400" size={24} />
              </div>
              <h2 className="text-3xl font-black italic tracking-tighter text-white uppercase">Mi Perfil</h2>
            </div>
            <button onClick={() => setView('main')} className="text-gray-400 hover:text-white">
              <X size={24} />
            </button>
          </div>

          <div className="mb-6 flex rounded-2xl bg-gray-800 p-1">
            <button
              onClick={() => setProfileTab('general')}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${profileTab === 'general' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              General
            </button>
            <button
              onClick={() => setProfileTab('friends')}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${profileTab === 'friends' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Amigos
            </button>
          </div>

          <div className="space-y-6">
            {profileTab === 'general' ? (
              <>
                {/* Username Section */}
                <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Nombre de Usuario</label>
                    <span className="text-[8px] font-bold uppercase tracking-widest text-blue-400">
                      {user.usernameSet ? 'Costo: 10.000 Puntos' : 'Primer cambio gratis'}
                    </span>
                  </div>
                  <div className="space-y-4">
                    <input 
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="w-full rounded-2xl bg-black/40 px-6 py-4 text-sm font-black text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-blue-500/50 transition-all"
                      placeholder="Escribe tu nuevo nombre..."
                    />
                    <button 
                      onClick={handleUpdateUsername}
                      disabled={isUpdatingProfile || !newUsername.trim() || newUsername === user.displayName}
                      className="w-full rounded-2xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 disabled:opacity-50 active:scale-95 transition-all"
                    >
                      {isUpdatingProfile ? 'Actualizando...' : 'Confirmar Cambio'}
                    </button>
                  </div>
                </div>

                {/* Medal Collection */}
                <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                  <div className="mb-4 flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Colección de Medallas</label>
                    <Award size={14} className="text-gray-600" />
                  </div>
                  
                  <div className="grid grid-cols-4 gap-3">
                    {(() => {
                      const acceptedFriends = friendships.filter(f => f.status === 'accepted').length;
                      const maxMatches = Math.max(0, ...friendships.map(f => f.gamesPlayed || 0));
                      const botKills = user.botKills || 0;
                      const insomnia = user.insomniaCount || 0;
                      const money = user.highScoreMonedas || 0;

                      const medals = [
                        // Friendship
                        { id: 'f_b', name: 'Amistad de Bronce', desc: 'Tener 10 amistades', icon: <Users size={20} />, color: '#cd7f32', current: acceptedFriends, goal: 10, unlocked: acceptedFriends >= 10 },
                        { id: 'f_s', name: 'Amistad de Plata', desc: 'Tener 50 amistades', icon: <Users size={20} />, color: '#c0c0c0', current: acceptedFriends, goal: 50, unlocked: acceptedFriends >= 50 },
                        { id: 'f_g', name: 'Amistad de Oro', desc: 'Tener 100 amistades', icon: <Users size={20} />, color: '#ffd700', current: acceptedFriends, goal: 100, unlocked: acceptedFriends >= 100 },
                        { id: 'f_p', name: 'Amistad de Platino', desc: 'Tener 1000 amistades', icon: <Users size={20} />, color: '#e5e4e2', current: acceptedFriends, goal: 1000, unlocked: acceptedFriends >= 1000 },
                        // Duel
                        { id: 'd_b', name: 'Duelo de Bronce', desc: 'Jugar 500 partidas con un amigo', icon: <Zap size={20} />, color: '#cd7f32', current: maxMatches, goal: 500, unlocked: maxMatches >= 500 },
                        { id: 'd_s', name: 'Duelo de Plata', desc: 'Jugar 1000 partidas con un amigo', icon: <Zap size={20} />, color: '#c0c0c0', current: maxMatches, goal: 1000, unlocked: maxMatches >= 1000 },
                        { id: 'd_g', name: 'Duelo de Oro', desc: 'Jugar 2500 partidas con un amigo', icon: <Zap size={20} />, color: '#ffd700', current: maxMatches, goal: 2500, unlocked: maxMatches >= 2500 },
                        // Money
                        { id: 'm_b', name: 'Dinero de Bronce', desc: 'Llegar a 1.000 monedas', icon: <Coins size={20} />, color: '#cd7f32', current: money, goal: 1000, unlocked: money >= 1000 },
                        { id: 'm_s', name: 'Dinero de Plata', desc: 'Llegar a 10.000 monedas', icon: <Coins size={20} />, color: '#c0c0c0', current: money, goal: 10000, unlocked: money >= 10000 },
                        { id: 'm_g', name: 'Dinero de Oro', desc: 'Llegar a 500.000 monedas', icon: <Coins size={20} />, color: '#ffd700', current: money, goal: 500000, unlocked: money >= 500000 },
                        // Eliminator
                        { id: 'e_b', name: 'Eliminador de Bronce', desc: 'Matar 10 bots', icon: <Target size={20} />, color: '#cd7f32', current: botKills, goal: 10, unlocked: botKills >= 10 },
                        { id: 'e_s', name: 'Eliminador de Plata', desc: 'Matar 100 bots', icon: <Skull size={20} />, color: '#c0c0c0', current: botKills, goal: 100, unlocked: botKills >= 100 },
                        { id: 'e_g', name: 'Eliminador de Oro', desc: 'Matar 1.000 bots', icon: <Trophy size={20} />, color: '#ffd700', current: botKills, goal: 1000, unlocked: botKills >= 1000 },
                        // Insomnia
                        { id: 'i_b', name: 'Insomnio de Bronce', desc: 'Jugar 1 vez (00:00 - 05:00 AM)', icon: <Moon size={20} />, color: '#cd7f32', current: insomnia, goal: 1, unlocked: insomnia >= 1 },
                        { id: 'i_s', name: 'Insomnio de Plata', desc: 'Jugar 30 días (00:00 - 05:00 AM)', icon: <Moon size={20} />, color: '#c0c0c0', current: insomnia, goal: 30, unlocked: insomnia >= 30 },
                        { id: 'i_g', name: 'Insomnio de Oro', desc: 'Jugar 365 días (00:00 - 05:00 AM)', icon: <Moon size={20} />, color: '#ffd700', current: insomnia, goal: 365, unlocked: insomnia >= 365 },
                      ];

                      return medals.map((medal, idx) => (
                        <button
                          key={`medal-box-${medal.id}-${idx}`}
                          onClick={() => setSelectedMedal(medal)}
                          className={`group relative flex aspect-square items-center justify-center rounded-xl bg-black/40 border transition-all hover:border-white/20 active:scale-95 ${medal.unlocked ? 'border-white/10 shadow-lg' : 'border-transparent opacity-30 filter grayscale hover:opacity-100'}`}
                          style={{ borderColor: medal.unlocked ? `${medal.color}44` : 'transparent' }}
                        >
                          <div 
                            className="transition-colors"
                            style={{ color: medal.unlocked ? medal.color : '#4b5563' }}
                          >
                            {medal.icon}
                          </div>
                          {medal.unlocked && (
                            <div 
                              className="absolute inset-0 rounded-xl opacity-10 animate-pulse"
                              style={{ backgroundColor: medal.color }}
                            />
                          )}
                          {!medal.unlocked && (
                             <div className="absolute bottom-1 left-1 right-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                               <div 
                                 className="h-full bg-gray-600" 
                                 style={{ width: `${Math.min(100, (medal.current / medal.goal) * 100)}%` }}
                               />
                             </div>
                          )}
                        </button>
                      ));
                    })()}
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="mt-8 space-y-3 pt-6 border-t border-white/5">
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-800 py-4 font-bold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
                  >
                    <LogOut size={18} /> Cerrar Sesión
                  </button>
                  
                  <button
                    onClick={handleDeleteAccount}
                    disabled={isUpdatingProfile}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-900/20 py-4 font-bold text-red-500 transition-colors hover:bg-red-900/40 disabled:opacity-50"
                  >
                    <Trash2 size={18} /> Desvincular Cuenta
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-6">
                {/* My Username Section */}
                <div className={`rounded-2xl p-6 border text-center relative overflow-hidden ${user.profileBorder || 'border-blue-500/20'} bg-blue-600/10`}>
                  {user.profileTheme && (
                    <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ background: user.profileTheme }} />
                  )}
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-2 relative z-10">Tu Identidad</p>
                  <div className="flex flex-col items-center justify-center gap-4 relative z-10">
                    {user.avatarConfig ? (
                      <div className="relative group/avatar">
                        <img 
                          src={`https://api.dicebear.com/7.x/${user.avatarConfig.style}/svg?seed=${user.avatarConfig.seed}`}
                          className="h-24 w-24 rounded-full bg-blue-600/10 border-4 border-blue-500/30 p-1 shadow-[0_0_20px_rgba(37,99,235,0.2)] transition-transform group-hover/avatar:scale-110"
                          alt="Avatar de Perfil"
                        />
                        <div className="absolute inset-0 rounded-full bg-blue-400 opacity-0 group-hover/avatar:opacity-10 blur-xl transition-opacity pointer-events-none" />
                      </div>
                    ) : (
                      <div className="h-24 w-24 rounded-full bg-blue-600/20 flex items-center justify-center text-4xl font-black text-blue-400 border-4 border-blue-500/30 shadow-lg">
                        {user.displayName?.[0].toUpperCase() || '?'}
                      </div>
                    )}
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-4xl font-black tracking-tighter text-white uppercase italic">{user.displayName}</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(user.displayName);
                          setProfileMessage({ text: 'Nombre copiado', type: 'success' });
                          setTimeout(() => setProfileMessage(null), 2000);
                        }}
                        className="rounded-lg bg-blue-600/20 p-2 text-blue-400 hover:bg-blue-600/40 transition-all"
                      >
                        <Copy size={18} />
                      </button>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowProfileCustomization(true)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 relative z-10"
                  >
                    <Palette size={14} /> Personalizar Perfil
                  </button>
                  {user.bio && (
                    <p className="mt-4 text-[10px] text-gray-400 italic font-medium px-4 line-clamp-2 relative z-10">
                      "{user.bio}"
                    </p>
                  )}
                </div>

                {/* Add Friend Section */}
                <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-gray-400">AGREGAR AMIGO:</label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={friendSearch}
                      onChange={(e) => setFriendSearch(e.target.value)}
                      className="flex-1 rounded-xl bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                      placeholder="Nombre de usuario..."
                    />
                    <button 
                      onClick={() => handleSendFriendRequest(friendSearch)}
                      className="rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-500"
                    >
                      <UserPlus size={20} />
                    </button>
                  </div>
                </div>

                {/* Friend Requests Section */}
                {friendships.filter(f => f.status === 'pending' && f.requesterId !== user.id).length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-yellow-500 flex items-center gap-2">
                      <Plus size={14} /> Solicitudes Pendientes
                    </h3>
                    <div className="space-y-2">
                      {friendships.filter(f => f.status === 'pending' && f.requesterId !== user.id).map((f, idx) => {
                        const requester = friendProfiles[f.requesterId];
                        return (
                          <div key={`pending-req-list-${f.id || idx}`} className="flex items-center justify-between rounded-xl bg-yellow-500/5 p-3 border border-yellow-500/20">
                            <div className="flex items-center gap-3">
                              {requester?.avatarConfig ? (
                                <img 
                                  src={`https://api.dicebear.com/7.x/${requester.avatarConfig.style}/svg?seed=${requester.avatarConfig.seed}`}
                                  className="h-8 w-8 rounded-full"
                                  alt={requester.displayName}
                                />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 font-bold">
                                  {requester?.displayName?.[0].toUpperCase() || '?'}
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-bold text-white">{requester?.displayName || 'Cargando...'}</p>
                                <p className="text-[8px] text-gray-500 uppercase tracking-widest">Pendiente</p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => handleAcceptFriendRequest(f.id)}
                                className="rounded-lg bg-green-500/20 p-2 text-green-400 hover:bg-green-500/40"
                              >
                                <Check size={16} />
                              </button>
                              <button 
                                onClick={() => handleRejectFriendRequest(f.id)}
                                className="rounded-lg bg-red-500/20 p-2 text-red-400 hover:bg-red-900/40"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Friends List Section */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400 flex items-center gap-2">
                    <Users size={14} /> Mis Amigos
                  </h3>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                    {friendships.filter(f => f.status === 'accepted').map((f, idx) => {
                      const friendId = f.uids.find(id => id !== user.id)!;
                      const friend = friendProfiles[friendId];
                      const isOnline = friend && (currentTime - friend.lastActive < 60000);
                      
                      return (
                        <div 
                          key={`friend-acc-v2-${f.id || idx}`} 
                          onClick={() => {
                            if (friend) {
                              const friendshipRecord = friendships.find(f_rec => f_rec.uids.includes(friend.id));
                              if (friendshipRecord) {
                                setShowFriendProfile(friendshipRecord);
                                setSelectedFriend(friend);
                              }
                            }
                          }}
                          className={`group flex items-center justify-between rounded-xl p-3 border hover:scale-[1.02] transition-all cursor-pointer relative overflow-hidden ${
                            friend?.profileBorder || 'border-white/5 bg-white/5'
                          } hover:bg-white/10`}
                        >
                          {friend?.profileTheme && (
                            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ background: friend.profileTheme }} />
                          )}
                          <div className="flex items-center gap-3 relative z-10">
                            <div className="relative">
                              {friend?.avatarConfig ? (
                                <img 
                                  src={`https://api.dicebear.com/7.x/${friend.avatarConfig.style}/svg?seed=${friend.avatarConfig.seed}`}
                                  className={`h-10 w-10 rounded-full bg-blue-500/10 border ${friend.profileBorder || 'border-transparent'}`}
                                  alt={friend.displayName}
                                />
                              ) : (
                                <div className={`h-10 w-10 rounded-full flex items-center justify-center font-black text-xl bg-blue-500/20 text-blue-400 ${friend?.profileBorder}`}>
                                  {friend?.displayName?.[0].toUpperCase() || '?'}
                                </div>
                              )}
                              {isOnline && (
                                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-gray-900 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-black text-white">{friend?.displayName || 'Cargando...'}</p>
                                {f.level > 1 && (
                                  <span className="text-[8px] font-black bg-blue-600 text-white px-1.5 py-0.5 rounded italic">NV.{f.level}</span>
                                )}
                              </div>
                              <p className="text-[8px] text-gray-500 uppercase tracking-widest">
                                {isOnline ? <span className="text-green-400">En Línea</span> : 'Desconectado'}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity relative z-10">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInviteFriend(friendId, 50);
                              }}
                              className="rounded-lg bg-pink-600/20 p-2 text-pink-400 hover:bg-pink-600/40"
                              title="Enviar Corazón"
                            >
                              <Heart size={16} />
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInviteFriend(friendId, 50);
                              }}
                              className="rounded-lg bg-purple-600/20 p-2 text-purple-400 hover:bg-purple-600/40"
                              title="Invitar a Duelo"
                            >
                              <Zap size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {friendships.filter(f => f.status === 'accepted').length === 0 && (
                      <div className="py-8 text-center">
                        <Users size={32} className="mx-auto text-gray-800 mb-2" />
                        <p className="text-[10px] text-gray-600 uppercase font-bold">Aún no tienes amigos</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Global Marketplace Section */}
                <div className="space-y-3 pt-4 border-t border-white/5">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400 flex items-center gap-2">
                    <ShoppingBag size={14} /> Skins en Venta
                  </h3>
                  <div className="max-h-60 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                    {(() => {
                      const activeListings = listings
                        .filter(l => l.status === 'active')
                        .sort((a, b) => {
                          const isOwnA = a.sellerId === user.id;
                          const isOwnB = b.sellerId === user.id;
                          if (isOwnA && !isOwnB) return -1;
                          if (!isOwnA && isOwnB) return 1;
                          return b.timestamp - a.timestamp;
                        });

                      if (activeListings.length === 0) {
                        return (
                          <div className="py-8 text-center bg-white/5 rounded-xl border border-dashed border-white/10">
                            <ShoppingBag size={24} className="mx-auto text-gray-800 mb-2" />
                            <p className="text-[10px] text-gray-600 uppercase font-bold">No hay skins publicadas</p>
                          </div>
                        );
                      }

                      return activeListings.map((listing, idx) => {
                        const skin = ALL_SKINS.find(s => s.id === listing.skinId);
                        if (!skin) return null;
                        const isOwnListing = listing.sellerId === user.id;

                        return (
                          <div 
                            key={`market-listing-global-${listing.id || idx}`}
                            className="flex items-center justify-between rounded-xl bg-white/5 p-3 border border-white/5 hover:border-blue-500/30 transition-all"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">{skin.icon}</span>
                              <div>
                                <p className="text-xs font-black text-white uppercase leading-none">{skin.name}</p>
                                <div className="flex items-center gap-1 mt-1">
                                  <MonedasIcon size={10} />
                                  <span className="text-xs font-black text-blue-400">{listing.price.toLocaleString()}</span>
                                  <span className="text-[8px] font-black text-gray-500 uppercase ml-2 tracking-tighter">Vendedor: {isOwnListing ? 'Tú' : listing.sellerName}</span>
                                </div>
                              </div>
                            </div>
                            {!isOwnListing && (
                              <button 
                                onClick={() => handleBuyFromFriend(listing)}
                                disabled={user.monedas < listing.price}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-blue-600/20"
                              >
                                Comprar
                              </button>
                            )}
                            {isOwnListing && (
                              <div className="flex flex-col gap-1 items-end">
                                <div className="text-[8px] font-black uppercase text-yellow-500 px-2 py-1 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                                    Tu Publicación
                                </div>
                                <button
                                  onClick={() => handleWithdrawListing(listing)}
                                  className="text-[8px] font-bold uppercase text-red-400 hover:text-red-300 transition-colors underline underline-offset-2"
                                >
                                  Retirar
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Feedback Message */}
          <AnimatePresence mode="popLayout">
            {profileMessage && (
              <motion.div
                key={`profile-msg-${profileMessage.type}-${profileMessage.text.substring(0, 10)}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className={`rounded-xl p-3 text-center text-xs font-bold ${profileMessage.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
              >
                {profileMessage.text}
              </motion.div>
            )}
          </AnimatePresence>
          </div>

          <button
            onClick={() => setView('main')}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-800 py-4 font-bold transition-colors hover:bg-gray-700"
          >
            <ArrowLeft size={20} /> Volver al Menú
          </button>
        </div>
      )}

      {view === 'wallet' && (
        <div className="w-full max-w-2xl rounded-3xl bg-gray-900/90 p-8 backdrop-blur-xl border border-white/10">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-600/20 p-3">
                <MonedasIcon size={32} />
              </div>
              <div>
                <h2 className="text-3xl font-black italic tracking-tighter text-white uppercase">Mi Billetera</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Gestión de Monedas</p>
              </div>
            </div>
            <button onClick={() => setView('main')} className="text-gray-400 hover:text-white transition-colors">
              <X size={28} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Left Column: Balance */}
            <div className="space-y-6">
              <div className="rounded-2xl bg-white/5 p-6 border border-white/10">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-2">Saldo Disponible</span>
                <div className="flex items-center gap-3">
                  <MonedasIcon size={32} />
                  <span className="text-5xl font-black text-white">{user.monedas}</span>
                </div>
                <p className="mt-4 text-[10px] text-gray-400 italic">Equivalente a ${user.monedas} ARS</p>
              </div>

              {/* Withdrawal Form in Wallet */}
              <div className="rounded-2xl bg-blue-500/5 p-4 border border-blue-500/20">
                <div className="mb-4 flex items-center justify-between">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-blue-400">Solicitar Retiro</label>
                  <span className="text-[10px] text-gray-500 uppercase">Mín: 1.000</span>
                </div>
                
                <div className="space-y-3">
                  <div className="relative">
                    <input 
                      type="number"
                      value={withdrawAmount || ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                        setWithdrawAmount(isNaN(val) ? 0 : Math.min(user.monedas, val));
                      }}
                      className="w-full rounded-xl bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                      placeholder="Cantidad..."
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-500">
                      MONEDAS
                    </div>
                  </div>
                  <input 
                    type="text"
                    value={withdrawAlias}
                    onChange={(e) => setWithdrawAlias(e.target.value)}
                    className="w-full rounded-xl bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="Alias o CBU..."
                  />
                  <button 
                    onClick={handleWithdraw}
                    disabled={isUpdatingProfile || withdrawAmount < 1000 || !withdrawAlias.trim()}
                    className="w-full rounded-xl bg-blue-600 py-4 text-xs font-black uppercase tracking-tighter text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Confirmar Retiro
                  </button>
                  <p className="mt-2 text-center text-[10px] font-medium text-white/30 italic whitespace-nowrap">
                    *Los depósitos serán efectuados dentro de las 48hs.
                  </p>
                </div>
              </div>
            </div>

            {/* Purchase Options */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-blue-400">
                <ShoppingBag size={18} />
                <h3 className="text-xs font-bold uppercase tracking-widest">Cargar Monedas</h3>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                {[150, 500, 1000, 2000, 3000, 4000, 5000, 10000, 20000, 50000, 100000].map((amount, idx) => (
                  <button
                    key={`coin-pkg-${amount}-${idx}`}
                    onClick={() => setSelectedCoinPackage(amount)}
                    className={`group relative flex flex-col items-center justify-center rounded-2xl border p-4 transition-all active:scale-95 ${
                      amount === 100000 
                        ? 'col-span-2 border-yellow-500/50 bg-yellow-500/10 hover:bg-yellow-500/20' 
                        : 'border-white/5 bg-white/5 hover:bg-blue-600/20 hover:border-blue-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <MonedasIcon size={14} />
                      <span className="text-lg font-black text-white">{amount.toLocaleString()}</span>
                    </div>
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">${Math.round(amount * 1.101).toLocaleString()} ARS</span>
                    
                    {amount === 5000 && (
                      <div className="mt-1 rounded-full bg-green-500/20 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-green-400 border border-green-500/30">
                        Compra Popular
                      </div>
                    )}

                    {amount === 100000 && (
                      <div className="mt-2 rounded-full bg-yellow-500 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-black">
                        +50.000 Puntos Gratis
                      </div>
                    )}

                    <div className="absolute -right-1 -top-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className={`rounded-full p-1 shadow-lg ${amount === 100000 ? 'bg-yellow-500' : 'bg-blue-500'}`}>
                        <Plus size={10} className="text-white" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Withdrawal History Section - Moved to bottom */}
          <div className="mt-8 space-y-4 pt-8 border-t border-white/5">
            <div className="flex items-center gap-2 text-gray-400">
              <History size={18} />
              <h3 className="text-xs font-bold uppercase tracking-widest">Historial de Retiros</h3>
            </div>
            
            <div className="max-h-[300px] space-y-3 overflow-y-auto pr-2 custom-scrollbar">
              {withdrawalHistory.map((w, idx) => (
                <div key={`withdraw-transaction-row-${w.id || idx}-${idx}`} className="rounded-xl bg-white/5 p-4 border border-white/5 hover:bg-white/10 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-gray-500">{new Date(w.timestamp).toLocaleDateString()}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${w.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                      {w.status === 'completed' ? 'Completado' : 'Pendiente'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MonedasIcon size={16} />
                      <span className="text-lg font-black text-white">{w.amount}</span>
                    </div>
                    {w.transactionId && (
                      <div className="text-right">
                        <p className="text-[8px] text-gray-500 uppercase">ID Operación</p>
                        <p className="text-[10px] font-mono text-blue-400 font-bold">{w.transactionId}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {withdrawalHistory.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 rounded-2xl bg-white/5 border border-dashed border-white/10">
                  <History size={32} className="text-gray-700 mb-2" />
                  <p className="text-[10px] text-gray-600 uppercase font-bold">Sin movimientos previos</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <button
              onClick={() => setView('main')}
              className="flex items-center gap-2 rounded-xl bg-gray-800 px-10 py-4 font-black uppercase tracking-widest text-gray-400 transition-all hover:bg-gray-700 hover:text-white"
            >
              <ArrowLeft size={20} /> Volver al Menú
            </button>
          </div>
        </div>
      )}

      {view === 'ranking' && (
        <div className="w-full max-w-md rounded-3xl bg-gray-900/80 p-8 backdrop-blur-xl border border-white/10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-3xl font-black italic tracking-tighter text-yellow-500">RANKING GLOBAL</h2>
            <div className="flex items-center gap-2 rounded-full bg-gray-800 px-3 py-1">
              <GoldPointIcon size={14} />
              <span className="text-sm font-bold">{user.coins}</span>
            </div>
            <button onClick={() => setView('main')} className="text-gray-400 hover:text-white">
              <X size={24} />
            </button>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2 custom-scrollbar">
            {topPlayers.map((player, idx) => {
              const currentTime = Date.now();
              return (
              <div 
                key={`global-rank-row-${player.id}-${idx}-${player.coins}`} 
                className={`flex items-center justify-between rounded-xl p-4 ${player.id === user.id ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-gray-800/50'}`}
              >
                <div className="flex items-center gap-4">
                  <span className={`text-xl font-black ${idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-orange-500' : 'text-gray-500'}`}>
                    #{idx + 1}
                  </span>
                  <div className="relative">
                    {player.avatarConfig ? (
                      <img 
                        src={`https://api.dicebear.com/7.x/${player.avatarConfig.style}/svg?seed=${player.avatarConfig.seed}`}
                        alt={player.displayName}
                        className="h-10 w-10 rounded-xl bg-blue-500/10"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center font-black text-xl text-blue-400">
                        {player.displayName[0].toUpperCase()}
                      </div>
                    )}
                    {player.lastActive > currentTime - 60000 && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{player.displayName}</span>
                    </div>
                    {player.id === user.id && <span className="text-[8px] font-bold uppercase tracking-widest text-blue-400">Tú</span>}
                  </div>
                </div>
                <div className="font-black text-yellow-500 flex items-center gap-1">{player.coins} <GoldPointIcon size={14} /></div>
              </div>
              )
            })}
          </div>
          <button
            onClick={() => setView('main')}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-800 py-4 font-bold transition-colors hover:bg-gray-700"
          >
            <ArrowLeft size={20} /> Volver al Menú
          </button>
        </div>
      )}

      {view === 'fusion' && (
        <div className="w-full max-w-4xl rounded-3xl bg-gray-900/95 p-8 backdrop-blur-xl border border-purple-500/20 shadow-[0_0_50px_rgba(147,51,234,0.15)] relative overflow-hidden">
          {/* Fusion Background Effect */}
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <motion.div 
               animate={{ rotate: 360 }}
               transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
               className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-dashed border-purple-500 rounded-full"
            />
          </div>

          <div className="mb-8 flex items-center justify-between relative z-10">
            <div className="flex-1 w-fit">
              <h2 className="text-3xl sm:text-4xl font-black italic tracking-[0.1em] text-white uppercase whitespace-nowrap leading-none flex flex-col items-start">
                <span>CAJA DE FUSIÓN</span>
                <span className="text-[12px] sm:text-[14px] font-bold uppercase tracking-widest text-violet-500 mt-1">
                  Combina 4 fragmentos para crear una habilidad o skin
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={() => setView('main')} className="text-gray-400 hover:text-white transition-colors">
                <X size={28} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">
             {/* Inventory List */}
             <div className="lg:col-span-2 space-y-6">

                
                <div className="max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar space-y-8">
                  {/* Skin Fragments Section */}
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-4 border-b border-blue-500/20 pb-1">Fragmentos de Skins</h4>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                      {[...ARENA_ITEMS]
                        .filter(item => !item.id.startsWith('frag_'))
                        .sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity])
                        .map((item) => {
                        const count = user.inventoryItems?.[item.id] || 0;
                        return (
                          <button
                            key={`fusion-inv-${item.id}`}
                            onClick={() => !isFusing && setFusingItem(item)}
                            className={`group relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${fusingItem?.id === item.id ? 'border-purple-500 bg-purple-600/20' : 'border-gray-800 bg-gray-800/50 hover:border-gray-700'} ${count < 1 ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
                          >
                            <div className="mb-2 text-3xl">
                                {item.type === 'color' ? (
                                  <div className="w-8 h-8 rounded-full border-2 border-white/20 shadow-md" style={{ backgroundColor: item.value }} />
                                ) : item.value}
                            </div>
                            <span className="text-[8px] font-black uppercase tracking-tighter text-center">{item.name}</span>
                            <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 border border-white/10 text-[10px] font-black">
                                {count}
                            </div>
                            <div className={`mt-1 h-1 w-full rounded-full ${item.rarity === 'common' ? 'bg-gray-500' : item.rarity === 'rare' ? 'bg-blue-500' : item.rarity === 'epic' ? 'bg-purple-500' : 'bg-yellow-500'}`} />
                          </button>
                        )
                      })}
                    </div>
                  </div>

                      {/* Ability Fragments Section */}
                      <div>
                        <div className="flex items-center gap-2 mb-4 border-b border-yellow-500/20 pb-1">
                          <Zap size={14} className="text-yellow-500" />
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Fragmentos de Habilidades</h4>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                          {[...ARENA_ITEMS]
                            .filter(item => item.id.startsWith('frag_'))
                            .sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity])
                            .map((item) => {
                            const count = user.inventoryItems?.[item.id] || 0;
                            return (
                              <button
                                key={`fusion-inv-${item.id}`}
                                onClick={() => !isFusing && setFusingItem(item)}
                                className={`group relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${fusingItem?.id === item.id ? 'border-purple-500 bg-purple-600/20 shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'border-gray-800 bg-gray-800/50 hover:border-gray-700'} ${count < 1 ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
                              >
                                <div className="mb-2 text-3xl">
                                    {item.value}
                                </div>
                                <span className="text-[8px] font-black uppercase tracking-tighter text-center">{item.name}</span>
                                <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 border border-white/10 text-[10px] font-black">
                                    {count}
                                </div>
                                <div className={`mt-1 h-1 w-full rounded-full ${item.rarity === 'common' ? 'bg-gray-500' : item.rarity === 'rare' ? 'bg-blue-500' : item.rarity === 'epic' ? 'bg-purple-500' : 'bg-yellow-500'}`} />
                              </button>
                            )
                          })}
                        </div>
                      </div>
                </div>
             </div>

             {/* Fusion Slot */}
             <div className="flex flex-col items-center justify-center bg-white/5 rounded-3xl p-8 border border-white/10 relative overflow-hidden">
                {!fusingItem ? (
                  <div className="text-center py-20">
                    <div className="mx-auto w-16 h-16 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center mb-4">
                      <Plus className="text-gray-700" />
                    </div>
                    <p className="text-xs text-gray-500 uppercase font-black">Elige un elemento</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-6 text-center">
                       <h4 className="text-xl font-black italic text-white uppercase tracking-tighter mb-2">Preparando Fusión</h4>
                       <span className={`inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${fusingItem.rarity === 'common' ? 'bg-gray-500/20 text-gray-400' : fusingItem.rarity === 'rare' ? 'bg-blue-500/20 text-blue-400' : fusingItem.rarity === 'epic' ? 'bg-purple-500/20 text-purple-400' : 'bg-yellow-500/20 text-yellow-500'}`}>
                          {fusingItem.rarity}
                       </span>
                    </div>

                    <div className="relative mb-6">
                       <div className="grid grid-cols-4 gap-3">
                          {[1,2,3,4].map(idx => {
                            const isSlotOn = (user.inventoryItems?.[fusingItem.id] || 0) >= idx;
                            return (
                            <motion.div 
                               key={`fusion-grid-slot-${idx}`}
                               animate={isFusing && isSlotOn ? { scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] } : {}}
                               transition={{ duration: 0.5, repeat: isFusing ? Infinity : 0 }}
                               className={`w-14 h-14 rounded-2xl border-2 transition-all flex items-center justify-center text-2xl ${isSlotOn ? 'bg-black/60 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.15)] ring-1 ring-purple-500/20' : 'bg-black/20 border-gray-800 grayscale opacity-30 text-gray-700'}`}
                            >
                               {isSlotOn ? (
                                 fusingItem.type === 'color' ? (
                                   <div className="w-6 h-6 rounded-full shadow-lg" style={{ backgroundColor: fusingItem.value, boxShadow: `0 0 10px ${fusingItem.value}` }} />
                                 ) : fusingItem.value
                               ) : (
                                 <Plus size={16} />
                               )}
                            </motion.div>
                          );
                        })}
                       </div>
                       
                       {isFusing && (
                         <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <motion.div 
                              animate={{ scale: [1, 1.5, 1], opacity: [0, 0.8, 0] }}
                              transition={{ duration: 1, repeat: Infinity }}
                              className="w-32 h-32 rounded-full bg-purple-500 blur-2xl"
                            />
                         </div>
                       )}
                    </div>

                    <div className="w-full space-y-2">
                       <div className="flex justify-between items-end text-[10px] font-black uppercase tracking-widest pb-1">
                          <span className="text-gray-500">Éxito Estimado</span>
                          <span className={user.coins >= 1000 ? 'text-green-400' : 'text-red-400'}>{SUCCESS_RATES[fusingItem.rarity] * 100}%</span>
                       </div>
                       <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${SUCCESS_RATES[fusingItem.rarity] * 100}%` }}
                            className={`h-full ${fusingItem.rarity === 'common' ? 'bg-gray-500' : fusingItem.rarity === 'rare' ? 'bg-blue-500' : fusingItem.rarity === 'epic' ? 'bg-purple-500' : 'bg-yellow-500'}`}
                          />
                       </div>

                       <div className="pt-4 flex flex-col items-center gap-4">
                          <div className="flex items-center gap-2 text-sm font-black text-gray-300">
                             COSTE: 1.000 <GoldPointIcon size={16} />
                          </div>
                          <button
                            onClick={() => handleStartFusion(fusingItem)}
                            disabled={isFusing || user.coins < 1000 || (user.inventoryItems?.[fusingItem.id] || 0) < 4}
                            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 py-4 rounded-xl text-lg font-black uppercase tracking-tighter hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:grayscale transition-all shadow-lg active:scale-95"
                          >
                             {isFusing ? 'FUSIONANDO...' : 'INICIAR FUSIÓN'}
                          </button>
                       </div>
                    </div>
                  </>
                )}
             </div>
          </div>

          <div className="mt-8 flex justify-center relative z-10">
            <button
              onClick={() => setView('main')}
              className="flex items-center gap-2 rounded-xl bg-gray-800 px-10 py-4 font-black uppercase tracking-widest text-gray-400 transition-all hover:bg-gray-700 hover:text-white"
            >
              <ArrowLeft size={20} /> Volver al Menú
            </button>
          </div>

          <AnimatePresence>
            {isFusing && (
               <motion.div 
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md"
               >
                  <div className="text-center">
                     <motion.div
                       animate={{ 
                         scale: [1, 1.2, 1],
                         rotate: 360
                       }}
                       transition={{ duration: 4, ease: "easeInOut" }}
                       className="relative inline-block mb-8"
                     >
                        <Zap size={100} className="text-yellow-400" />
                        <motion.div 
                          animate={{ opacity: [0, 1, 0], scale: [0.8, 1.2, 0.8] }}
                          transition={{ duration: 0.5, repeat: Infinity }}
                          className="absolute inset-0 bg-purple-500/40 blur-3xl rounded-full"
                        />
                     </motion.div>
                     <h3 className="text-3xl font-black italic text-white uppercase tracking-tighter mb-4 animate-pulse uppercase tracking-[0.2em]">FUSIONANDO ELEMENTOS...</h3>
                     <div className="w-80 h-3 bg-gray-800 rounded-full mx-auto overflow-hidden border border-white/10">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: "100%" }}
                          transition={{ duration: 4, ease: "linear" }}
                          className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                        />
                     </div>
                     <p className="mt-4 text-[10px] text-gray-500 font-bold uppercase tracking-[0.3em]">No cierres la aplicación</p>
                  </div>
               </motion.div>
            )}

            {fusionResult && (
               <motion.div 
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-lg p-4"
               >
                  <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="w-full max-w-sm rounded-[2.5rem] bg-gray-900 border border-white/10 p-10 shadow-2xl text-center"
                  >
                     {fusionResult.success ? (
                       <>
                         <div className="mx-auto w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(34,197,94,0.3)]">
                            <Sparkles size={48} className="text-green-400" />
                         </div>
                         <div className="flex flex-col gap-1 items-center">
                           <h2 className="text-3xl font-black italic text-white uppercase tracking-tighter">¡FELICITACIONES!</h2>
                           <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-6 px-4">
                             Has creado {fusionResult.ability ? 'una habilidad' : 'un skin'} con éxito
                           </p>
                         </div>
                         
                         <div className="mb-10 bg-white/5 rounded-3xl p-6 border border-white/5">
                            <div className="text-6xl mb-4">
                              {fusionResult.ability ? fusionResult.ability.icon : fusionResult.skin?.icon}
                            </div>
                            <h4 className="text-xl font-black text-white uppercase">
                              {fusionResult.ability ? fusionResult.ability.name : fusionResult.skin?.name}
                            </h4>
                            <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">
                              {fusionResult.ability ? fusionResult.ability.rarity.toUpperCase() : fusionResult.skin?.rarity.toUpperCase()}
                            </p>
                         </div>

                         <button
                           onClick={handleCollectFusionReward}
                           className="w-full bg-green-600 hover:bg-green-500 py-5 rounded-2xl text-xl font-black uppercase tracking-tighter transition-all shadow-xl active:scale-95"
                         >
                            RECOLECTAR {fusionResult.ability ? 'HABILIDAD' : 'SKIN'}
                         </button>
                       </>
                     ) : (
                       <>
                         <div className="mx-auto w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(239,68,68,0.3)]">
                            <X size={48} className="text-red-400" />
                         </div>
                         <h2 className="text-3xl font-black italic text-white uppercase tracking-tighter mb-2">COMBINACIÓN FALLIDA</h2>
                         <p className="text-sm text-gray-400 mb-8 font-medium">No te desanimes, la probabilidad no estuvo de tu lado esta vez. ¡Vuelve a intentarlo!</p>
                         
                         <button
                           onClick={() => { setFusionResult(null); setFusingItem(null); }}
                           className="w-full bg-gray-800 hover:bg-gray-700 py-5 rounded-2xl text-xl font-black uppercase tracking-tighter transition-all active:scale-95 border border-white/5"
                         >
                            ACEPTAR
                         </button>
                       </>
                     )}
                  </motion.div>
               </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {selectedPointPackage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md rounded-3xl border border-yellow-500/30 bg-gray-900 p-8 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-2xl font-black italic tracking-tighter text-yellow-500 uppercase">Confirmar Carga</h3>
              <button onClick={() => setSelectedPointPackage(null)} className="text-gray-500 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="flex flex-col gap-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-yellow-500">Recibirás</p>
                    <div className="flex items-center gap-2">
                      <GoldPointIcon size={24} />
                      <p className="text-3xl font-black text-white">{selectedPointPackage.points.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Total a Pagar</p>
                    <p className="text-2xl font-black text-white">${selectedPointPackage.price.toLocaleString()} ARS</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-gray-400">Serás redirigido a la plataforma segura de <span className="font-bold text-blue-400">Mercado Pago</span> para completar tu compra de puntos.</p>
              </div>

              <div className="rounded-xl bg-yellow-500/10 p-4 border border-yellow-500/20">
                <p className="text-xs text-yellow-500 leading-relaxed">
                  <span className="font-bold uppercase tracking-widest block mb-1">🚀 Acreditación Instantánea:</span>
                  Una vez aprobado el pago, los puntos se sumarán automáticamente a tu cuenta en segundos.
                </p>
              </div>

              <button
                onClick={() => handleCreatePreference(selectedPointPackage.price, 'points', selectedPointPackage.points)}
                disabled={isCreatingPreference}
                className="w-full rounded-2xl bg-yellow-600 py-4 text-lg font-black uppercase tracking-widest text-white transition-all hover:bg-yellow-500 shadow-lg shadow-yellow-600/20 disabled:opacity-50"
              >
                {isCreatingPreference ? 'Procesando...' : 'Pagar con Mercado Pago'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {selectedCoinPackage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md rounded-3xl border border-blue-500/30 bg-gray-900 p-8 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-2xl font-black italic tracking-tighter text-blue-400 uppercase">Confirmar Carga</h3>
              <button onClick={() => setSelectedCoinPackage(null)} className="text-gray-500 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="flex flex-col gap-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-blue-400">Recibirás</p>
                    <div className="flex items-center gap-2">
                      <MonedasIcon size={24} />
                      <p className="text-3xl font-black text-white">{selectedCoinPackage.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Total a Pagar</p>
                    <p className="text-2xl font-black text-white">${Math.round(selectedCoinPackage * 1.101).toLocaleString()} ARS</p>
                  </div>
                </div>

                {selectedCoinPackage === 100000 && (
                  <div className="flex items-center justify-between border-t border-blue-500/20 pt-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-full bg-yellow-500/20 p-1.5">
                        <Zap size={16} className="text-yellow-500" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Bonus de Regalo</p>
                        <div className="flex items-center gap-1">
                          <GoldPointIcon size={14} />
                          <p className="text-lg font-black text-white">50.000 Puntos</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-sm text-gray-400">Serás redirigido a la plataforma segura de <span className="font-bold text-blue-400">Mercado Pago</span> para completar tu compra.</p>
                <div className="rounded-xl bg-blue-500/5 p-4 border border-blue-500/10">
                  <p className="text-[10px] text-gray-500 italic text-center">
                    Aceptamos tarjetas de débito, crédito y dinero en cuenta de Mercado Pago.
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-yellow-500/10 p-4 border border-yellow-500/20">
                <p className="text-xs text-yellow-500 leading-relaxed">
                  <span className="font-bold uppercase tracking-widest block mb-1">🚀 Acreditación Instantánea:</span>
                  Una vez aprobado el pago, las monedas se sumarán automáticamente a tu cuenta en segundos.
                </p>
              </div>

              <button
                onClick={() => handleCreatePreference(selectedCoinPackage, 'monedas', 0, Math.round(selectedCoinPackage * 1.101))}
                disabled={isCreatingPreference}
                className="w-full rounded-2xl bg-blue-600 py-4 text-lg font-black uppercase tracking-widest text-white transition-all hover:bg-blue-500 shadow-lg shadow-blue-600/20 disabled:opacity-50"
              >
                {isCreatingPreference ? 'Procesando...' : 'Pagar con Mercado Pago'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {view === 'inventory' && (
        <div className="w-full max-w-4xl rounded-3xl bg-gray-900/80 p-8 backdrop-blur-xl">
          <div className="mb-8 border-b border-white/5 pb-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-4xl font-black italic tracking-tighter text-white uppercase">Inventario</h2>
              <button onClick={() => setView('main')} className="text-gray-400 hover:text-white transition-all hover:scale-110 active:scale-95">
                <X size={28} />
              </button>
            </div>
            
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="flex bg-black/40 rounded-2xl p-1.5 border border-white/5">
                <button
                  onClick={() => setInventoryTab('skins')}
                  className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${inventoryTab === 'skins' ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Skins
                </button>
                <button
                  onClick={() => setInventoryTab('abilities')}
                  className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${inventoryTab === 'abilities' ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Habilidades
                </button>
              </div>
              
              <div className="flex items-center gap-4 -mt-2">
                <div className="flex items-center gap-2 rounded-2xl bg-black/40 border border-white/5 px-4 py-2">
                  <GoldPointIcon size={14} />
                  <span className="text-sm font-black text-yellow-500">{user.coins.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 rounded-2xl bg-black/40 border border-white/5 px-4 py-2">
                  <MonedasIcon size={14} />
                  <span className="text-sm font-black text-blue-400">{user.monedas.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
            {inventoryTab === 'skins' ? (() => {
              const uniqueSkins = Array.from(new Set(user.ownedSkins));
              return uniqueSkins
                .map(id => ALL_SKINS.find(s => s.id === id)!)
                .filter(Boolean)
                .sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity])
                .map((skin, idx) => {
                const skinId = skin.id;
                const count = user.ownedSkins.filter(id => id === skinId).length;
                const isEquipped = user.equippedSkin === skinId;
                const isPointSkin = (skin.currency || 'coins') === 'coins';
                const sellPrice = Math.floor((skin.price || (skin.rarity === 'legendary' ? 15000 : skin.rarity === 'epic' ? 10000 : skin.rarity === 'rare' ? 5000 : 2000)) * 0.5);

                return (
                  <div
                    key={`inv-skin-render-${skinId}-${idx}-${count}`}
                    className={`group relative flex flex-col items-center rounded-2xl border-2 p-4 transition-all ${isEquipped ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 bg-gray-800'}`}
                  >
                    {/* Quantity Badge */}
                    <div className="absolute -right-2 -top-2 z-10 rounded-full bg-yellow-600 px-2.5 py-1 text-xs font-black text-white shadow-lg border border-yellow-400/50">
                      x{count}
                    </div>

                    <span className="mb-2 text-4xl">{skin.icon}</span>
                    <span className="text-xs font-black uppercase tracking-tighter text-white mb-3">{skin.name}</span>
                    
                    <div className="flex flex-col w-full gap-2 mt-auto">
                      <button
                        onClick={() => handleEquip(skin.id)}
                        className={`w-full rounded-lg py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${isEquipped ? 'bg-blue-600 text-white cursor-default' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                      >
                        {isEquipped ? 'Equipado' : 'Equipar'}
                      </button>

                      {skinId !== 'default' && (
                        <>
                          <button
                            onClick={() => handleSellToSystem(skin)}
                            className="w-full rounded-lg py-1.5 text-[10px] font-black uppercase tracking-widest bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/40 transition-all flex items-center justify-center gap-2"
                          >
                            <span>Vender</span>
                            <GoldPointIcon size={12} />
                          </button>

                          <button
                            onClick={() => setShowListModal({ skin })}
                            className="w-full rounded-lg py-1.5 text-[10px] font-black uppercase tracking-widest bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/40 transition-all flex items-center justify-center gap-2"
                          >
                            <span>Vender</span>
                            <MonedasIcon size={12} />
                          </button>
                        </>
                      )}
                    </div>

                    {isEquipped && (
                      <div className="absolute left-2 top-2 rounded-full bg-blue-500/20 p-1">
                        <Check size={10} className="text-blue-400" />
                      </div>
                    )}
                  </div>
                );
              });
            })() : (() => {
              const sortedAbilities = [...ALL_ABILITIES].sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]);
              return sortedAbilities.map((ability, idx) => {
                const count = user.inventoryAbilities?.[ability.id] || 0;
                const isEquipped = (user.equippedAbilities || []).includes(ability.id);
                const isUnlocked = count > 0;

                return (
                  <div
                    key={`inv-ability-render-${ability.id}-${idx}-${count}`}
                    className={`group relative flex flex-col items-center rounded-2xl border-2 p-4 transition-all ${isEquipped ? 'border-yellow-500 bg-yellow-500/10' : isUnlocked ? 'border-gray-700 bg-gray-800' : 'border-gray-800 bg-black/40 grayscale'}`}
                  >
                    {!isUnlocked && (
                      <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 rounded-2xl backdrop-blur-[1px]">
                        <div className="flex flex-col items-center gap-1">
                          <ShieldCheck size={24} className="text-gray-500" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bloqueado</span>
                        </div>
                      </div>
                    )}

                    {isUnlocked && (
                      <div className="absolute -right-2 -top-2 z-10 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-black text-white shadow-lg border border-blue-400/50">
                        x{count}
                      </div>
                    )}

                    <span className="mb-2 text-4xl">{ability.icon}</span>
                    <span className="text-xs font-black uppercase tracking-tighter text-white mb-1">{ability.name}</span>
                    <p className="text-[8px] text-gray-400 text-center mb-3 line-clamp-2 h-4">{ability.description}</p>
                    
                    {isUnlocked && (
                      <div className="flex flex-col w-full gap-2 mt-auto relative z-30">
                        <button
                          onClick={() => handleEquipAbility(ability.id)}
                          className={`w-full rounded-lg py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${isEquipped ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        >
                          {isEquipped ? 'Desequipar' : 'Equipar'}
                        </button>

                        <button
                          onClick={() => handleSellAbilityToSystem(ability)}
                          className="w-full rounded-lg py-1.5 text-[10px] font-black uppercase tracking-widest bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/40 transition-all flex items-center justify-center gap-2"
                        >
                          <span>Vender</span>
                          <GoldPointIcon size={12} />
                        </button>

                        <button
                          onClick={() => setShowAbilityListingModal({ ability })}
                          className="w-full rounded-lg py-1.5 text-[10px] font-black uppercase tracking-widest bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/40 transition-all flex items-center justify-center gap-2"
                        >
                          <span>Vender</span>
                          <MonedasIcon size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* Feedback Message */}
          <div className="h-10 mt-4 overflow-hidden">
            <AnimatePresence mode="wait">
              {profileMessage && (
                <motion.div
                  key={`inventory-msg-${profileMessage.text}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  className={`rounded-xl p-2 text-center text-[10px] font-black uppercase tracking-widest ${profileMessage.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}
                >
                  {profileMessage.text}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-8 flex justify-center">
            <button
              onClick={() => setView('main')}
              className="flex items-center gap-2 rounded-xl bg-gray-800 px-8 py-3 font-bold transition-colors hover:bg-gray-700"
            >
              <ArrowLeft size={20} /> Volver al Menú
            </button>
          </div>
        </div>
      )}

      {view === 'shop' && (
        <div className="w-full max-w-4xl rounded-3xl bg-gray-900/90 p-8 backdrop-blur-xl border border-white/10">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-4xl font-black italic tracking-tighter text-yellow-500 uppercase">Tienda</h2>
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-2 items-end">
                <div className="flex items-center gap-2 rounded-full bg-gray-800 px-4 py-1.5">
                  <GoldPointIcon size={14} />
                  <span className="text-sm font-black text-yellow-500 tracking-tighter">{user.coins.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-gray-800 px-4 py-1.5">
                  <MonedasIcon size={14} />
                  <span className="text-sm font-black text-blue-400 tracking-tighter">{user.monedas.toLocaleString()}</span>
                </div>
              </div>
              <button onClick={() => setView('main')} className="text-gray-400 hover:text-white transition-colors">
                <X size={28} />
              </button>
            </div>
          </div>

          <div className="max-h-[70vh] space-y-12 overflow-y-auto pr-2 custom-scrollbar">
            {/* Skins Section */}
            <section>
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-xl font-black uppercase tracking-widest text-white border-l-4 border-yellow-500 pl-4">Skins Disponibles</h3>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[...ALL_SKINS]
                  .sort((a, b) => {
                    const currencyA = a.currency || 'coins';
                    const currencyB = b.currency || 'coins';
                    
                    // First sort by currency: coins (points) first, then monedas (money)
                    if (currencyA !== currencyB) {
                      return currencyA === 'coins' ? -1 : 1;
                    }
                    
                    // Then by price: cheapest to expensive
                    const getBasePrice = (s: Skin) => s.price || (s.rarity === 'legendary' ? 15000 : s.rarity === 'epic' ? 10000 : s.rarity === 'rare' ? 5000 : 2000);
                    return getBasePrice(a) - getBasePrice(b);
                  })
                  .map((skin, idx) => {
                  let price = skin.price || (skin.rarity === 'legendary' ? 15000 : skin.rarity === 'epic' ? 10000 : skin.rarity === 'rare' ? 5000 : 2000);
                  const currency = skin.currency || 'coins';
                  const userBalance = currency === 'coins' ? user.coins : user.monedas;
                  
                  // 10% discount for the first 5 days of the month
                  const today = new Date();
                  const isDiscountDay = today.getDate() <= 5;
                  if (isDiscountDay) {
                    price = Math.floor(price * 0.9);
                  }
                  
                  return (
                    <button
                      key={`shop-skin-${skin.id}-${idx}`}
                      onClick={() => handleBuy(skin, price)}
                      disabled={userBalance < price}
                      className={`group relative flex flex-col items-center rounded-2xl border-2 border-gray-700 bg-gray-800 p-4 transition-all hover:border-yellow-500 disabled:opacity-50`}
                    >
                      {user.ownedSkins.includes(skin.id) && (
                        <div className="absolute -top-2 -left-2 z-10 rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-black text-white shadow-lg">
                          Posesión: {user.ownedSkins.filter(id => id === skin.id).length}
                        </div>
                      )}
                      {isDiscountDay && (
                        <div className="absolute -top-2 -right-2 z-10 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white shadow-lg">
                          -10%
                        </div>
                      )}
                      <span className="mb-2 text-4xl">{skin.icon}</span>
                      <span className="text-xs font-bold uppercase tracking-tighter">{skin.name}</span>
                      <div className={`mt-2 flex items-center gap-1 text-sm font-black ${currency === 'coins' ? 'text-yellow-500' : 'text-blue-400'}`}>
                        {price} {currency === 'coins' ? <GoldPointIcon size={14} /> : <MonedasIcon size={14} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Points Exchange Section */}
            <section>
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-xl font-black uppercase tracking-widest text-white border-l-4 border-blue-400 pl-4">Canje de Puntos</h3>
                <div className="rounded-full bg-blue-500/10 px-3 py-1 border border-blue-500/20">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Usa tus Monedas</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { points: 1000, cost: 100 },
                  { points: 2000, cost: 175 }
                ].map((pkg, idx) => (
                  <button
                    key={`shop-exchange-pkg-${pkg.points}-${idx}`}
                    onClick={() => handleExchangePoints(pkg.points, pkg.cost)}
                    disabled={user.monedas < pkg.cost}
                    className="group relative flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 p-6 transition-all hover:bg-blue-600/20 hover:border-blue-500/50 disabled:opacity-30"
                  >
                    <div className="flex items-center gap-4">
                      <div className="rounded-xl bg-yellow-500/20 p-3">
                        <GoldPointIcon size={24} />
                      </div>
                      <div className="text-left">
                        <p className="text-2xl font-black text-white">{pkg.points.toLocaleString()}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-500">Puntos</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Costo</p>
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xl font-black text-blue-400">{pkg.cost}</span>
                        <MonedasIcon size={16} />
                      </div>
                    </div>
                    {user.monedas < pkg.cost && (
                      <div className="absolute -top-2 right-4 rounded-full bg-red-500 px-2 py-0.5 text-[8px] font-bold text-white uppercase">Insuficiente</div>
                    )}
                  </button>
                ))}
              </div>
            </section>

            {/* Tickets Section */}
            <section>
              <div className="mb-6">
                <h3 className="text-xl font-black uppercase tracking-widest text-white border-l-4 border-blue-500 pl-4">Entradas de Arena</h3>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="rounded-3xl border border-blue-500/30 bg-blue-900/20 p-8 text-center backdrop-blur-md">
                  <div className="mb-4 flex justify-center">
                    <div className="rounded-full bg-blue-500/20 p-4">
                      <ShieldCheck size={48} className="text-blue-400" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-black uppercase tracking-tighter text-white">Entrada Arena PRO</h3>
                  <p className="mt-2 text-sm text-gray-400">Acceso ilimitado por 24 horas a la categoría PRO</p>
                  <div className="mt-6 flex flex-col items-center justify-center gap-2">
                    <div className="flex items-center gap-2">
                      <GoldPointIcon size={20} />
                      <span className="text-2xl font-black text-yellow-500">5000</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MonedasIcon size={20} />
                      <span className="text-2xl font-black text-blue-400">500</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleBuyTicket('pro', 5000, 500)}
                    disabled={user.coins < 5000 || user.monedas < 500 || (user.proAccessUntil && user.proAccessUntil > Date.now())}
                    className="mt-8 w-full rounded-xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white transition-all hover:bg-blue-500 disabled:opacity-50"
                  >
                    {user.proAccessUntil && user.proAccessUntil > Date.now() ? 'Entrada Activa' : 'Comprar Entrada'}
                  </button>
                </div>

                <div className="rounded-3xl border border-yellow-500/30 bg-yellow-900/20 p-8 text-center backdrop-blur-md">
                  <div className="mb-4 flex justify-center">
                    <div className="rounded-full bg-yellow-500/20 p-4">
                      <Trophy size={48} className="text-yellow-500" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-black uppercase tracking-tighter text-white">Entrada Arena MILLONARIO</h3>
                  <p className="mt-2 text-sm text-gray-400">Acceso ilimitado por 24 horas a la categoría MILLONARIO</p>
                  <div className="mt-6 flex flex-col items-center justify-center gap-2">
                    <div className="flex items-center gap-2">
                      <GoldPointIcon size={20} />
                      <span className="text-2xl font-black text-yellow-500">10000</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MonedasIcon size={20} />
                      <span className="text-2xl font-black text-blue-400">1000</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleBuyTicket('millonario', 10000, 1000)}
                    disabled={user.coins < 10000 || user.monedas < 1000 || (user.millonarioAccessUntil && user.millonarioAccessUntil > Date.now())}
                    className="mt-8 w-full rounded-xl bg-yellow-600 py-4 font-black uppercase tracking-widest text-white transition-all hover:bg-yellow-500 disabled:opacity-50"
                  >
                    {user.millonarioAccessUntil && user.millonarioAccessUntil > Date.now() ? 'Entrada Activa' : 'Comprar Entrada'}
                  </button>
                </div>
              </div>
            </section>
          </div>

          {isGeminiLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 flex items-center justify-center gap-2 text-[10px] font-bold text-blue-400 uppercase tracking-[0.2em]"
            >
              <Loader2 className="animate-spin" size={12} />
              Analizando compra...
            </motion.div>
          )}

          {geminiMessage && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mt-4 relative overflow-hidden rounded-2xl border border-blue-500/30 bg-blue-600/10 p-4 shadow-[0_0_20px_rgba(37,99,235,0.2)]"
            >
              <div className="absolute top-0 right-0 p-1">
                <Sparkles size={14} className="text-blue-400 animate-pulse" />
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-1 rounded-full bg-blue-500/20 p-2">
                  <MessageSquare size={16} className="text-blue-400" />
                </div>
                <div className="text-left">
                  <span className="text-[8px] font-black uppercase tracking-widest text-blue-400 mb-1 block">Sugerencia de la Arena</span>
                  <p className="text-sm font-medium italic text-gray-200 leading-relaxed">
                    "{geminiMessage}"
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {ticketMessage && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-4 rounded-xl p-3 text-center text-xs font-bold ${ticketMessage.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
            >
              {ticketMessage.text}
            </motion.div>
          )}

          <div className="mt-8 flex justify-center">
            <button
              onClick={() => setView('main')}
              className="flex items-center gap-2 rounded-xl bg-gray-800 px-8 py-3 font-bold transition-colors hover:bg-gray-700"
            >
              <ArrowLeft size={20} /> Volver al Menú
            </button>
          </div>

          <AnimatePresence>
            {purchaseConfirmation && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="w-full max-w-sm rounded-3xl border border-white/10 bg-gray-900 p-8 shadow-2xl"
                >
                  <div className="mb-6 text-center">
                    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-500/20 text-5xl">
                      {purchaseConfirmation.skin.icon}
                    </div>
                    <h3 className="text-2xl font-black uppercase tracking-tighter text-white">¿Confirmar Compra?</h3>
                    <p className="mt-2 text-sm text-gray-400 leading-relaxed px-4">
                      ¿Quieres comprar <span className="font-bold text-white">{purchaseConfirmation.skin.name}</span> por {' '}
                      <span className={`font-black ${(purchaseConfirmation.skin.currency || 'coins') === 'monedas' ? 'text-blue-400' : 'text-yellow-500'}`}>
                        {purchaseConfirmation.price.toLocaleString()} {(purchaseConfirmation.skin.currency || 'coins') === 'monedas' ? 'Monedas' : 'Puntos'}
                      </span>?
                    </p>
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={() => setPurchaseConfirmation(null)}
                      className="flex-1 rounded-xl bg-gray-800 py-3 font-bold text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => executePurchase(purchaseConfirmation.skin, purchaseConfirmation.price)}
                      className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-50 hover:text-blue-600 active:scale-95"
                    >
                      Comprar
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      )}

      {showWagerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-lg rounded-3xl border border-white/10 bg-gray-900 p-8 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-2xl font-black italic tracking-tighter text-blue-400 uppercase">Seleccionar Apuesta</h3>
              <button onClick={() => setShowWagerModal(false)} className="text-gray-500 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="mb-8 flex gap-2">
              {(['basica', 'pro', 'millonario'] as const).map(cat => (
                <button
                  key={`wager-category-${cat}`}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex-1 rounded-xl py-3 text-xs font-black uppercase tracking-widest transition-all ${selectedCategory === cat ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {(() => {
                const categories = {
                  basica: [50, 100, 150, 200],
                  pro: [500, 1000, 2000, 3000],
                  millonario: [5000, 7500, 10000, 15000]
                };
                const growthMapping = [50, 100, 150, 200];
                
                return categories[selectedCategory].map((val, idx) => {
                  const isLocked = (selectedCategory === 'pro' && (!user.proAccessUntil || user.proAccessUntil < Date.now())) ||
                                  (selectedCategory === 'millonario' && (!user.millonarioAccessUntil || user.millonarioAccessUntil < Date.now()));
                  
                  const timeInfo = selectedCategory === 'pro' ? getTimeRemaining(user.proAccessUntil || 0) :
                                  selectedCategory === 'millonario' ? getTimeRemaining(user.millonarioAccessUntil || 0) : null;

                  return (
                    <button
                      key={`wager-${selectedCategory}-${val}-${idx}`}
                      onClick={() => {
                        if (isLocked) {
                          setShowArenaTicketsModal(true);
                          return;
                        }
                        onStartWager(val, growthMapping[idx], selectedCategory);
                        setShowWagerModal(false);
                      }}
                      disabled={user.monedas < val}
                      className="group relative flex flex-col items-center gap-2 rounded-2xl border border-white/5 bg-white/5 p-6 transition-all hover:bg-blue-600/20 hover:border-blue-500/50 disabled:opacity-30"
                    >
                      {isLocked && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-black/60 backdrop-blur-[2px]">
                          <ShieldCheck size={24} className="mb-1 text-gray-400" />
                          <span className="text-[8px] font-black uppercase tracking-widest text-white">Bloqueado</span>
                        </div>
                      )}
                      
                      <span className="text-3xl font-black text-white">{val}</span>
                      <div className="flex items-center gap-1 text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                        <MonedasIcon size={12} /> Monedas
                      </div>
                      
                      {timeInfo && (
                        <div className={`mt-2 text-[10px] font-black uppercase tracking-widest ${timeInfo.totalHours <= 6 ? 'text-red-500' : 'text-green-500'}`}>
                          {timeInfo.hours}h {timeInfo.minutes}m restantes
                        </div>
                      )}

                      {user.monedas < val && !isLocked && (
                        <span className="absolute -top-2 rounded-full bg-red-500 px-2 py-0.5 text-[8px] font-bold text-white uppercase">Insuficiente</span>
                      )}
                    </button>
                  );
                });
              })()}
            </div>


            <div className="mt-6 flex flex-col gap-3">
              <div className="h-px bg-white/5 w-full" />
              <button
                onClick={() => {
                  setShowWagerModal(false);
                  setShowPrivateModal(true);
                }}
                className="group relative flex w-full items-center justify-center gap-3 rounded-2xl bg-purple-600/20 border border-purple-500/30 py-4 text-sm font-black uppercase tracking-widest transition-all hover:bg-purple-600/30 active:scale-95"
              >
                <ShieldCheck size={18} className="text-purple-400" />
                <div className="flex flex-col items-center">
                  <span className="text-purple-100">SALAS PRIVADAS</span>
                  <span className="text-[8px] text-purple-400/60 font-medium lowercase tracking-normal">Duelos personalizados con amigos</span>
                </div>
              </button>
            </div>

            <p className="mt-8 text-center text-[10px] text-gray-500 uppercase tracking-widest italic">
              * El crecimiento de la viborita está regulado por categoría
            </p>
          </motion.div>
        </div>
      )}

      {showPrivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md rounded-3xl border border-purple-500/30 bg-gray-900 p-8 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-purple-500/20 p-2">
                  <ShieldCheck className="text-purple-400" size={24} />
                </div>
                <h3 className="text-2xl font-black italic tracking-tighter text-purple-400 uppercase">Sala Privada</h3>
              </div>
              <button onClick={() => setShowPrivateModal(false)} className="text-gray-500 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <p className="mb-8 text-xs leading-relaxed text-gray-400 text-center">
              Crea una sala con una apuesta personalizada o únete a una existente para jugar solo con amigos.
            </p>

            <div className="space-y-6">
              <div className="rounded-2xl bg-white/5 p-6 border border-white/5">
                <label className="mb-3 block text-[10px] font-black uppercase tracking-widest text-purple-400">Crear Nueva Sala</label>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[8px] font-bold uppercase text-gray-500">Monto a Apostar</span>
                      <span className="text-[8px] font-bold uppercase text-purple-400">Saldo: {user.monedas}</span>
                    </div>
                    <input 
                      type="number"
                      value={privateWager || ''}
                      max={user.monedas}
                      onChange={(e) => {
                        const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                        setPrivateWager(isNaN(val) ? 0 : Math.min(val, user.monedas));
                      }}
                      className="w-full rounded-xl bg-black/40 px-4 py-4 text-xl font-black text-white outline-none ring-1 ring-white/10 focus:ring-purple-500/50"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {/* Basic Private Room */}
                    <button
                      onClick={async () => {
                        if (privateWager > 6000) {
                          setRoomError('Límite de 6000 monedas para sala básica');
                          return;
                        }
                        handleCreatePrivateRoom(privateWager);
                      }}
                      disabled={user.monedas < privateWager || privateWager < 0}
                      className="group relative flex flex-col items-center justify-center rounded-xl bg-gray-800/50 border border-white/5 p-4 transition-all hover:bg-gray-800 hover:border-purple-500/50 disabled:opacity-30"
                    >
                      <span className="text-xs font-black uppercase tracking-widest text-white">Sala Estándar</span>
                      <span className="text-[8px] text-gray-500 uppercase mt-1">Límite: 6000 Monedas</span>
                    </button>

                    {/* Pro Private Room */}
                    <button
                      onClick={async () => {
                        const isLocked = !user.proAccessUntil || user.proAccessUntil < Date.now();
                        if (isLocked) {
                          setRoomError('Requiere Entrada PRO');
                          return;
                        }
                        if (privateWager > 12000) {
                          setRoomError('Límite de 12000 monedas para sala PRO');
                          return;
                        }
                        handleCreatePrivateRoom(privateWager);
                      }}
                      disabled={user.monedas < privateWager || privateWager < 0}
                      className="group relative flex flex-col items-center justify-center rounded-xl bg-blue-900/20 border border-blue-500/30 p-4 transition-all hover:bg-blue-900/40 hover:border-blue-400 disabled:opacity-30"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={12} className="text-blue-400" />
                        <span className="text-xs font-black uppercase tracking-widest text-blue-100">Sala PRO</span>
                      </div>
                      <span className="text-[8px] text-blue-400/60 uppercase mt-1">Límite: 12000 Monedas</span>
                      {(!user.proAccessUntil || user.proAccessUntil < Date.now()) && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl backdrop-blur-[1px]">
                          <Zap size={14} className="text-gray-500" />
                        </div>
                      )}
                    </button>

                    {/* Millionaire Private Room */}
                    <button
                      onClick={async () => {
                        const isLocked = !user.millonarioAccessUntil || user.millonarioAccessUntil < Date.now();
                        if (isLocked) {
                          setRoomError('Requiere Entrada MILLONARIO');
                          return;
                        }
                        handleCreatePrivateRoom(privateWager);
                      }}
                      disabled={user.monedas < privateWager || privateWager < 0}
                      className="group relative flex flex-col items-center justify-center rounded-xl bg-yellow-900/20 border border-yellow-500/30 p-4 transition-all hover:bg-yellow-900/40 hover:border-yellow-400 disabled:opacity-30"
                    >
                      <div className="flex items-center gap-2">
                        <Trophy size={12} className="text-yellow-500" />
                        <span className="text-xs font-black uppercase tracking-widest text-yellow-100">Sala MILLONARIO</span>
                      </div>
                      <span className="text-[8px] text-yellow-500/60 uppercase mt-1">Sin Límite de Apuesta</span>
                      {(!user.millonarioAccessUntil || user.millonarioAccessUntil < Date.now()) && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl backdrop-blur-[1px]">
                          <Zap size={14} className="text-gray-500" />
                        </div>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/5"></div>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                  <span className="bg-gray-900 px-4 text-gray-500 font-bold">O</span>
                </div>
              </div>

              <div className="rounded-2xl bg-white/5 p-6 border border-white/5">
                <label className="mb-3 block text-[10px] font-black uppercase tracking-widest text-purple-400">Unirse a una Sala</label>
                <div className="flex flex-col gap-3">
                  <input 
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={privateRoomId}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setPrivateRoomId(val);
                      setRoomError(null);
                    }}
                    placeholder="CÓDIGO (4 DÍGITOS)"
                    className="w-full rounded-xl bg-black/40 px-4 py-4 text-center text-2xl font-black text-white outline-none ring-1 ring-white/10 focus:ring-purple-500/50 placeholder:text-gray-700"
                  />
                  <button
                    onClick={async () => {
                      if (privateRoomId.length < 4) {
                        setRoomError('Ingresa el código de 4 dígitos');
                        return;
                      }
                      const roomRef = doc(db, 'privateRooms', privateRoomId);
                      const roomSnap = await getDoc(roomRef).catch(() => null);
                      if (!roomSnap || !roomSnap.exists()) {
                        setRoomError('La sala no existe');
                        return;
                      }
                      const roomData = roomSnap.data();
                      setShowJoinConfirm({ id: privateRoomId, wager: roomData.wager });
                    }}
                    className="w-full rounded-xl bg-purple-600/20 border border-purple-500/50 py-4 font-black uppercase tracking-widest text-purple-400 transition-all hover:bg-purple-600/30"
                  >
                    Unirse al Duelo
                  </button>
                </div>
                {roomError && (
                  <p className="mt-3 text-[10px] font-bold text-red-500 text-center">{roomError}</p>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {showBuyPoints && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md rounded-3xl border border-gray-700 bg-gray-900 p-8 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-2xl font-black italic tracking-tighter text-blue-400">COMPRAR PUNTOS</h3>
              <button onClick={() => setShowBuyPoints(false)} className="text-gray-500 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="rounded-2xl bg-gray-800 p-4">
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-400">Cantidad de Puntos</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    value={buyAmount || ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                      setBuyAmount(isNaN(val) ? 0 : val);
                    }}
                    className="w-full bg-transparent text-3xl font-black text-white outline-none"
                  />
                  <GoldPointIcon size={24} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-400">Total a Pagar</p>
                  <p className="text-2xl font-black text-white">${buyAmount} ARS</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-gray-500 uppercase">1 Punto = $1 ARS</p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-gray-400">Transfiere el monto exacto a través de <span className="font-bold text-blue-400">Mercado Pago</span> al siguiente alias:</p>
                <div className="flex items-center justify-between rounded-xl bg-gray-800 p-4">
                  <span className="font-mono text-xl font-bold text-white">latorre44</span>
                  <button
                    onClick={copyAlias}
                    className="flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-xs font-bold transition-colors hover:bg-gray-600"
                  >
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                    {copied ? 'Copiado' : 'Copiar Alias'}
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-yellow-500/10 p-4 text-xs text-yellow-500">
                <p className="font-bold">⚠️ Importante:</p>
                <p>Una vez realizada la transferencia, los puntos se acreditarán manualmente. Asegúrate de que el monto coincida con la cantidad solicitada.</p>
              </div>

              <button
                onClick={() => setShowBuyPoints(false)}
                className="w-full rounded-2xl bg-blue-600 py-4 text-lg font-black uppercase tracking-tighter text-white transition-all hover:bg-blue-500"
              >
                Entendido
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} adminUser={user} />}

      <AnimatePresence>
        {selectedMedal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-[2.5rem] bg-gray-900 p-8 border border-white/10 shadow-3xl text-center relative"
            >
              <button 
                onClick={() => setSelectedMedal(null)}
                className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>

              <div 
                className={`mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-black/40 border-4 ${selectedMedal.unlocked ? 'animate-bounce-subtle' : 'grayscale opacity-30 shadow-none'}`}
                style={{ 
                  borderColor: selectedMedal.color,
                  boxShadow: selectedMedal.unlocked ? `0 0 40px ${selectedMedal.color}22` : 'none'
                }}
              >
                <div style={{ color: selectedMedal.color }}>
                  {selectedMedal.icon && typeof selectedMedal.icon === 'object' && 'props' in selectedMedal.icon ? (
                    (() => {
                      const Icon = selectedMedal.icon.type;
                      return <Icon size={48} {...selectedMedal.icon.props} />;
                    })()
                  ) : null }
                </div>
              </div>

              <h3 className="text-2xl font-black italic tracking-tighter text-white uppercase mb-2">
                {selectedMedal.name}
              </h3>
              
              <div className="rounded-2xl bg-white/5 p-4 border border-white/5 mb-6">
                <p className="text-sm font-bold text-gray-400 mb-4">
                  {selectedMedal.desc}
                </p>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    <span>Progreso</span>
                    <span>{selectedMedal.current.toLocaleString()} / {selectedMedal.goal.toLocaleString()}</span>
                  </div>
                  <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (selectedMedal.current / selectedMedal.goal) * 100)}%` }}
                      className="h-full shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                      style={{ backgroundColor: selectedMedal.color }}
                    />
                  </div>
                </div>
              </div>

              <div className={`flex flex-col items-center justify-center gap-4 py-3 rounded-2xl font-black uppercase tracking-widest text-xs ${selectedMedal.unlocked ? 'bg-green-500/20 text-green-400 border border-green-500/10' : 'bg-gray-800 text-gray-500'}`}>
                {selectedMedal.unlocked ? (
                  <>
                    <div className="flex items-center gap-2">
                       <ShieldCheck size={16} /> ¡DESBLOQUEADA!
                    </div>
                    {selectedMedal.id === 'f_p' && !user.claimedPlatinumReward && (
                      <button
                        onClick={() => handleClaimMedalReward('f_p')}
                        className="bg-yellow-500 text-black px-6 py-3 rounded-xl text-xs font-black shadow-lg shadow-yellow-500/20 hover:bg-yellow-400 active:scale-95 transition-all"
                      >
                        RECLAMAR SKIN "RAYO ETERNO"
                      </button>
                    )}
                    {selectedMedal.id === 'f_p' && user.claimedPlatinumReward && (
                      <span className="text-[10px] text-yellow-500">Recompensa Reclamada ✓</span>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <X size={16} /> BLOQUEADA
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {showCreateConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl border border-purple-500/30 bg-gray-900 p-8 text-center shadow-2xl"
            >
              <div className="mb-6 flex justify-center">
                <div className="rounded-full bg-purple-500/20 p-4">
                  <ShieldCheck size={40} className="text-purple-400" />
                </div>
              </div>
              <h3 className="mb-2 text-xl font-black uppercase tracking-tighter text-white">Sala Creada</h3>
              <p className="mb-6 text-sm text-gray-400">
                Comparte este código con tu oponente para comenzar el duelo:
              </p>
              
              <div className="mb-8 rounded-2xl bg-black/40 py-6 border border-purple-500/20">
                <span className="text-5xl font-black tracking-[0.2em] text-white font-mono">
                  {showCreateConfirm.code}
                </span>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    onStartWager(showCreateConfirm.wager, 10, `private_${showCreateConfirm.code}`);
                    setShowCreateConfirm(null);
                    setShowPrivateModal(false);
                  }}
                  className="w-full rounded-2xl bg-purple-600 py-4 font-black uppercase tracking-widest text-white transition-all hover:bg-purple-500 shadow-lg shadow-purple-600/20"
                >
                  Iniciar Duelo
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showJoinConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl border border-purple-500/30 bg-gray-900 p-8 text-center shadow-2xl"
            >
              <div className="mb-6 flex justify-center">
                <div className="rounded-full bg-purple-500/20 p-4">
                  <ShieldCheck size={40} className="text-purple-400" />
                </div>
              </div>
              <h3 className="mb-2 text-xl font-black uppercase tracking-tighter text-white">Confirmar Duelo</h3>
              <p className="mb-6 text-sm text-gray-400">
                Estás por unirte a la sala <span className="font-bold text-purple-400">{showJoinConfirm.id}</span>.
                <br />
                Se descontarán <span className="font-bold text-yellow-500">{showJoinConfirm.wager} monedas</span> de tu saldo.
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    if (user.monedas < showJoinConfirm.wager) {
                      setRoomError(`Necesitas ${showJoinConfirm.wager} monedas`);
                      setShowJoinConfirm(null);
                      return;
                    }
                    onStartWager(showJoinConfirm.wager, 10, `private_${showJoinConfirm.id}`);
                    setShowJoinConfirm(null);
                    setShowWagerModal(false);
                  }}
                  className="w-full rounded-2xl bg-purple-600 py-4 font-black uppercase tracking-widest text-white transition-all hover:bg-purple-500 shadow-lg shadow-purple-600/20"
                >
                  Aceptar y Entrar
                </button>
                <button
                  onClick={() => setShowJoinConfirm(null)}
                  className="w-full rounded-2xl bg-gray-800 py-4 font-black uppercase tracking-widest text-gray-400 transition-all hover:bg-gray-700"
                >
                  Volver Atrás
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showArenaTicketsModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-4xl rounded-3xl border border-blue-500/30 bg-gray-900 p-8 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-blue-500/20 p-2">
                    <ShieldCheck className="text-blue-400" size={24} />
                  </div>
                  <h3 className="text-2xl font-black italic tracking-tighter text-blue-400 uppercase">Entradas de Arena</h3>
                </div>
                <button onClick={() => setShowArenaTicketsModal(false)} className="text-gray-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="rounded-3xl border border-blue-500/30 bg-blue-900/20 p-8 text-center backdrop-blur-md">
                  <div className="mb-4 flex justify-center">
                    <div className="rounded-full bg-blue-500/20 p-4">
                      <ShieldCheck size={48} className="text-blue-400" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-black uppercase tracking-tighter text-white">Entrada Arena PRO</h3>
                  <p className="mt-2 text-sm text-gray-400">Acceso ilimitado por 24 horas a la categoría PRO</p>
                  <div className="mt-6 flex flex-col items-center justify-center gap-2">
                    <div className="flex items-center gap-2">
                      <GoldPointIcon size={20} />
                      <span className="text-2xl font-black text-yellow-500">5000</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MonedasIcon size={20} />
                      <span className="text-2xl font-black text-blue-400">500</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleBuyTicket('pro', 5000, 500)}
                    disabled={user.coins < 5000 || user.monedas < 500 || (user.proAccessUntil && user.proAccessUntil > Date.now())}
                    className="mt-8 w-full rounded-xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white transition-all hover:bg-blue-500 disabled:opacity-50"
                  >
                    {user.proAccessUntil && user.proAccessUntil > Date.now() ? 'Entrada Activa' : 'Comprar Entrada'}
                  </button>
                </div>

                <div className="rounded-3xl border border-yellow-500/30 bg-yellow-900/20 p-8 text-center backdrop-blur-md">
                  <div className="mb-4 flex justify-center">
                    <div className="rounded-full bg-yellow-500/20 p-4">
                      <Trophy size={48} className="text-yellow-500" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-black uppercase tracking-tighter text-white">Entrada Arena MILLONARIO</h3>
                  <p className="mt-2 text-sm text-gray-400">Acceso ilimitado por 24 horas a la categoría MILLONARIO</p>
                  <div className="mt-6 flex flex-col items-center justify-center gap-2">
                    <div className="flex items-center gap-2">
                      <GoldPointIcon size={20} />
                      <span className="text-2xl font-black text-yellow-500">10000</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MonedasIcon size={20} />
                      <span className="text-2xl font-black text-blue-400">1000</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleBuyTicket('millonario', 10000, 1000)}
                    disabled={user.coins < 10000 || user.monedas < 1000 || (user.millonarioAccessUntil && user.millonarioAccessUntil > Date.now())}
                    className="mt-8 w-full rounded-xl bg-yellow-600 py-4 font-black uppercase tracking-widest text-white transition-all hover:bg-yellow-500 disabled:opacity-50"
                  >
                    {user.millonarioAccessUntil && user.millonarioAccessUntil > Date.now() ? 'Entrada Activa' : 'Comprar Entrada'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* New Expanded Friend Profile Modal */}
        <AnimatePresence>
          {showFriendProfile && selectedFriend && (
            <ExpandedFriendProfile 
              friend={selectedFriend}
              currentUser={user}
              friendship={showFriendProfile}
              listings={listings}
              onBuySkin={handleBuyFromFriend}
              onClose={() => {
                setShowFriendProfile(null);
                setSelectedFriend(null);
              }}
              onInvite={(wager) => {
                handleInviteFriend(selectedFriend.id, wager);
                setShowFriendProfile(null);
                setSelectedFriend(null);
              }}
              onDeleteFriend={handleDeleteFriend}
              onTransfer={(amount, currency) => handleTransfer(selectedFriend.id, amount, currency)}
            />
          )}
        </AnimatePresence>

        {/* New Profile Customization Modal */}
        <AnimatePresence>
          {showProfileCustomization && (
            <ProfileCustomization 
              user={user}
              onClose={() => setShowProfileCustomization(false)}
              onUpdate={() => {
                // The main App.tsx should detect changes via onSnapshot, 
                // but we can trigger a manual refresh if needed.
                setShowProfileCustomization(false);
              }}
            />
          )}
        </AnimatePresence>

        {/* List Skin Modal */}
        {showListModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 p-4 backdrop-blur-xl">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-sm rounded-[2.5rem] bg-gray-900 p-8 border border-white/10 shadow-3xl text-center"
            >
              <h3 className="text-2xl font-black italic tracking-tighter text-white uppercase mb-6">Poner en Venta</h3>
              
              <div className="mb-8 p-6 rounded-3xl bg-black/40 border border-white/5 inline-block mx-auto">
                <span className="text-6xl block mb-2">{showListModal.skin.icon}</span>
                <span className="text-sm font-black text-gray-400 uppercase tracking-widest">{showListModal.skin.name}</span>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-gray-500 text-left px-2">Precio en Monedas</label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                      <MonedasIcon size={24} />
                    </div>
                    <input 
                      type="number"
                      value={listPrice}
                      onChange={(e) => setListPrice(Math.max(1, parseInt(e.target.value) || 0))}
                      className="w-full rounded-2xl bg-black/60 px-14 py-5 text-3xl font-black text-white outline-none ring-2 ring-blue-500/20 focus:ring-blue-500 shadow-xl"
                    />
                  </div>
                  <p className="mt-3 text-[10px] text-gray-500 font-bold uppercase tracking-tight leading-relaxed px-4">
                    Tus amigos verán esta oferta en tu perfil y podrán comprarla al instante.
                  </p>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowListModal(null)}
                    disabled={isListing}
                    className="flex-1 rounded-2xl bg-gray-800 py-4 font-bold text-gray-400 hover:bg-gray-700 uppercase tracking-widest shadow-lg disabled:opacity-50"
                  >
                    Cerrar
                  </button>
                  <button 
                    onClick={() => handleListSkin(showListModal.skin, listPrice)}
                    disabled={isListing}
                    className="flex-1 rounded-2xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white hover:bg-blue-500 shadow-lg shadow-blue-600/30 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {isListing ? 'publicando...' : 'Publicar'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showTransferModal && selectedFriend && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/95 p-4 backdrop-blur-xl">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl border border-blue-500/30 bg-gray-900 p-8 shadow-2xl"
            >
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                  <Send size={32} />
                </div>
                <h3 className="text-xl font-black uppercase tracking-tighter text-white">Transferir a {selectedFriend.displayName}</h3>
              </div>

              <div className="space-y-6">
                <div className="flex rounded-2xl bg-gray-800 p-1">
                  <button
                    onClick={() => setTransferCurrency('coins')}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all flex items-center justify-center gap-2 ${transferCurrency === 'coins' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    <GoldPointIcon size={14} /> Puntos
                  </button>
                  <button
                    onClick={() => setTransferCurrency('monedas')}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all flex items-center justify-center gap-2 ${transferCurrency === 'monedas' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    <MonedasIcon size={14} /> Monedas
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-gray-500">Monto a Enviar</label>
                  <input 
                    type="number"
                    value={transferAmount || ''}
                    onChange={(e) => setTransferAmount(parseInt(e.target.value) || 0)}
                    className="w-full rounded-xl bg-black/40 px-4 py-4 text-2xl font-black text-white outline-none ring-1 ring-white/10 focus:ring-blue-500/50"
                    placeholder="0"
                  />
                  <p className="mt-2 text-[10px] text-right text-gray-500 font-bold uppercase">
                    Disponible: {transferCurrency === 'coins' ? user.coins : user.monedas}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowTransferModal(false)}
                    className="flex-1 rounded-xl bg-gray-800 py-4 font-bold text-gray-400 hover:bg-gray-700"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => handleTransfer(selectedFriend.id, transferAmount, transferCurrency)}
                    disabled={transferAmount <= 0 || transferAmount > (transferCurrency === 'coins' ? user.coins : user.monedas)}
                    className="flex-1 rounded-xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Enviar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Notifications Overlay */}
        <div className="fixed top-6 right-6 z-[100] flex flex-col gap-4 pointer-events-none">
          <AnimatePresence>
            {medalNotification && (
              <motion.div
                key={`medal-unlock-${medalNotification.id}`}
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 100, opacity: 0 }}
                className="w-80 rounded-2xl bg-gradient-to-br from-yellow-600/20 to-gray-900 border border-yellow-500/30 p-4 shadow-2xl backdrop-blur-xl pointer-events-auto"
              >
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-yellow-500/20 p-2 text-yellow-500">
                    <Award size={24} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-yellow-500">¡Medalla Desbloqueada!</h4>
                    <p className="text-sm font-black text-white uppercase italic">{medalNotification.name}</p>
                  </div>
                </div>
              </motion.div>
            )}
            {notifications.map((notif, idx) => (
              <motion.div
                key={`notif-${notif.id}-${idx}`}
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 100, opacity: 0 }}
                className={`w-80 rounded-2xl bg-gray-900/95 p-4 border shadow-2xl backdrop-blur-xl pointer-events-auto ${
                  notif.type === 'rematch_invite' ? 'border-yellow-500/50 shadow-yellow-500/10' : 'border-purple-500/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`rounded-full p-2 ${
                    notif.type === 'rematch_invite' ? 'bg-yellow-500/20' : 'bg-purple-500/20'
                  }`}>
                    <Zap className={notif.type === 'rematch_invite' ? 'text-yellow-400' : 'text-purple-400'} size={20} />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-black text-white uppercase italic tracking-tighter">
                      {notif.type === 'rematch_invite' ? '¡Revancha Solicitada!' : '¡Desafío Recibido!'}
                    </h4>
                    <p className="text-xs text-gray-400 mt-1">
                      <span className="font-bold text-white">{notif.fromName}</span> te invita a una {notif.type === 'rematch_invite' ? 'revancha' : 'duelo'} {notif.wager > 0 ? (
                        <>por <span className={`font-bold ${notif.type === 'rematch_invite' ? 'text-yellow-400' : 'text-yellow-500'}`}>{notif.wager} monedas</span></>
                      ) : (
                        <span className="font-bold text-blue-400">Amistoso</span>
                      )}.
                    </p>
                    <div className="mt-4 flex gap-2">
                      <button 
                        onClick={async () => {
                          if (user.monedas < (notif.wager || 0)) {
                            setProfileMessage({ text: 'No tienes suficientes monedas para aceptar', type: 'error' });
                            setTimeout(() => setProfileMessage(null), 3000);
                            return;
                          }
                          try {
                            await updateDoc(doc(db, 'notifications', notif.id), { status: 'accepted' });
                            if (notif.type === 'rematch_invite') {
                              onStartWager(notif.wager, notif.growthWager || 10, notif.category);
                            } else {
                              onStartWager(notif.wager || 0, 10, `private_${notif.roomId}`);
                            }
                          } catch (e) {
                            console.error('Error accepting invite:', e);
                          }
                        }}
                        className={`flex-1 rounded-lg py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors ${
                          notif.type === 'rematch_invite' ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-purple-600 hover:bg-purple-500'
                        }`}
                      >
                        Aceptar
                      </button>
                      <button 
                        onClick={async () => {
                          try {
                            await updateDoc(doc(db, 'notifications', notif.id), { status: 'rejected' });
                          } catch (e) {
                            console.error('Error rejecting invite:', e);
                          }
                        }}
                        className="flex-1 rounded-lg bg-gray-800 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:bg-gray-700"
                      >
                        Rechazar
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Daily Rewards Modal */}
        <AnimatePresence>
          {showDailyRewards && (
            <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
              <motion.div
                initial={{ scale: 0.8, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.8, opacity: 0, y: 20 }}
                className="w-full max-w-lg rounded-[3rem] border border-blue-500/30 bg-gray-900 shadow-3xl overflow-hidden"
              >
                <div className="relative h-32 bg-gradient-to-br from-blue-600 to-indigo-900 p-8 flex items-center justify-between border-b border-white/10">
                  <div className="z-10">
                    <h2 className="text-3xl font-black italic tracking-tighter text-white uppercase leading-none">Recompensas Diarias</h2>
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-200">Reclama tu premio cada 24 horas</p>
                  </div>
                  <Calendar size={48} className="absolute right-8 text-white/10 z-0" />
                  <button onClick={() => setShowDailyRewards(false)} className="z-10 text-white/50 hover:text-white transition-colors">
                    <X size={24} />
                  </button>
                </div>

                <div className="p-8">
                  <div className="grid grid-cols-4 gap-3 mb-8">
                    {DAILY_REWARDS.map((reward, idx) => {
                      const dayNumber = idx + 1;
                      const currentCycle = user.dailyRewardsCycle || 0;
                      const lastClaimDate = new Date(user.lastDailyRewardClaim || 0).toDateString();
                      const nowDate = new Date().toDateString();
                      const isClaimedToday = lastClaimDate === nowDate;
                      
                      const isAlreadyClaimed = dayNumber <= currentCycle && (isClaimedToday || dayNumber < currentCycle);
                      const isNextToClaim = !isClaimedToday && (dayNumber === (currentCycle % 7) + 1);
                      const isSelected = (selectedDayForPreview || (isNextToClaim ? dayNumber : (currentCycle % 7) + 1)) === dayNumber;
                      
                      return (
                        <button 
                          key={`reward-day-card-${dayNumber}`}
                          onClick={() => setSelectedDayForPreview(dayNumber)}
                          className={`relative flex flex-col items-center justify-center rounded-2xl p-4 transition-all border ${
                            isAlreadyClaimed ? 'bg-green-500/10 border-green-500/40 opacity-40 grayscale-[0.8]' :
                            isNextToClaim ? 'bg-blue-600 shadow-xl shadow-blue-600/30 border-blue-400' :
                            isSelected ? 'bg-gray-800 border-blue-500/50 scale-105 z-10' :
                            'bg-gray-800 border-white/5 opacity-80 hover:opacity-100 hover:border-white/20'
                          } ${dayNumber === 7 ? 'col-span-2' : ''}`}
                        >
                          <span className={`text-[10px] font-black uppercase mb-2 ${isNextToClaim ? 'text-white' : isSelected ? 'text-blue-400' : 'text-gray-500'}`}>Día {dayNumber}</span>
                          <div className="text-xl mb-1 filter drop-shadow-md">
                            {dayNumber === 7 ? '🎁' : dayNumber % 3 === 0 ? '🏆' : '💎'}
                          </div>
                          {isAlreadyClaimed && <Check size={16} className="absolute top-2 right-2 text-green-500" strokeWidth={3} />}
                          {isNextToClaim && !isAlreadyClaimed && <div className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full border-2 border-gray-900 animate-pulse" />}
                        </button>
                      );
                    })}
                  </div>

                  {(() => {
                    const currentCycle = user.dailyRewardsCycle || 0;
                    const lastClaim = user.lastDailyRewardClaim || 0;
                    const lastClaimDate = new Date(lastClaim).toDateString();
                    const nowDate = new Date().toDateString();
                    const isClaimedToday = lastClaimDate === nowDate;
                    
                    let nextToClaimDay = currentCycle + 1;
                    if (nextToClaimDay > 7) nextToClaimDay = 1;

                    // If user is looking at a day that is NOT the next claimable day
                    const previewDay = selectedDayForPreview || nextToClaimDay;
                    const reward = DAILY_REWARDS[previewDay - 1];
                    const isPreviewingClaimable = previewDay === nextToClaimDay && !isClaimedToday;
                    const isPreviewingClaimed = (previewDay <= currentCycle && isClaimedToday) || (previewDay < currentCycle);

                    return (
                        <div className="space-y-6">
                            <div className={`rounded-3xl p-6 border transition-all ${
                                isPreviewingClaimable ? 'bg-blue-600/10 border-blue-500/30' : 
                                isPreviewingClaimed ? 'bg-green-500/5 border-green-500/20' : 
                                'bg-gray-800/50 border-white/10'
                            }`}>
                                <div className="flex items-center justify-between mb-4">
                                    <h4 className={`text-[10px] font-black uppercase tracking-[0.2em] ${
                                        isPreviewingClaimable ? 'text-blue-400' : 
                                        isPreviewingClaimed ? 'text-green-500' : 
                                        'text-gray-500'
                                    }`}>
                                        {isPreviewingClaimed ? `Recompensa Día ${previewDay} (Reclamada)` : 
                                         isPreviewingClaimable ? `Tu Recompensa del Día ${previewDay}` : 
                                         `Previa Recompensa Día ${previewDay}`}
                                    </h4>
                                    {isPreviewingClaimed && <span className="text-[10px] font-bold text-green-500 uppercase">Obtenido</span>}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex items-center gap-3 bg-black/30 p-3 rounded-2xl border border-white/5">
                                        <GoldPointIcon size={20} />
                                        <span className="text-sm font-black text-white">+{reward.points} Puntos</span>
                                    </div>
                                    {reward.fragments > 0 && (
                                        <div className="flex items-center gap-3 bg-black/30 p-3 rounded-2xl border border-white/5">
                                            <Sparkles size={16} className="text-purple-400" />
                                            <span className="text-sm font-black text-white">+{reward.fragments} Fragmentos</span>
                                        </div>
                                    )}
                                    {reward.proEntry && (
                                        <div className="flex items-center gap-3 bg-black/30 p-3 rounded-2xl border border-white/5">
                                            <ShieldCheck size={16} className="text-blue-400" />
                                            <span className="text-[10px] font-black text-white uppercase">Entrada PRO</span>
                                        </div>
                                    )}
                                    {reward.millonarioEntry && (
                                        <div className="flex items-center gap-3 bg-black/30 p-3 rounded-2xl border border-white/5">
                                            <Trophy size={16} className="text-yellow-500" />
                                            <span className="text-[10px] font-black text-white uppercase">Entrada Millonario</span>
                                        </div>
                                    )}
                                    {reward.monedas && (
                                        <div className="flex items-center gap-3 bg-black/30 p-3 rounded-2xl border border-white/5">
                                            <MonedasIcon size={16} />
                                            <span className="text-sm font-black text-white">+{reward.monedas} Monedas</span>
                                        </div>
                                    )}
                                    {reward.randomAbility && (
                                        <div className="flex items-center gap-3 bg-black/30 p-3 rounded-2xl border border-white/5">
                                            <Zap size={16} className="text-yellow-400" />
                                            <span className="text-[10px] font-black text-white uppercase">Habilidad Aleatoria</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {isPreviewingClaimable ? (
                                <button 
                                    onClick={handleClaimDailyReward}
                                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl text-lg uppercase tracking-widest transition-all shadow-xl shadow-blue-600/30 active:scale-[0.98]"
                                >
                                    Reclamar Premio
                                </button>
                            ) : isClaimedToday && previewDay === currentCycle ? (
                                <div className="bg-gray-800/80 rounded-3xl p-6 text-center border border-white/5">
                                    <div className="flex items-center justify-center gap-2 mb-2">
                                        <Check size={20} className="text-green-500" />
                                        <p className="text-sm font-bold text-gray-400 uppercase tracking-widest text-green-500/80">¡Premio de hoy reclamado!</p>
                                    </div>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">Premio de hoy reclamado. Vuelve mañana para reclamar tu nuevo premio.</p>
                                    <p className="text-[10px] text-blue-400 mt-2 font-black uppercase tracking-[0.2em] animate-pulse">Día {nextToClaimDay} disponible mañana</p>
                                </div>
                            ) : (
                                <div className="bg-gray-800/40 rounded-3xl p-4 text-center border border-white/5">
                                    <p className="text-[10px] font-black text-gray-600 uppercase tracking-[0.2em]">Incentivo: Llega al Día {previewDay} para este premio</p>
                                </div>
                            )}
                        </div>
                    );
                  })()}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Username Modal */}
        <AnimatePresence>
          {showUsernameModal && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 p-4 backdrop-blur-2xl">
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="w-full max-w-md rounded-[40px] border border-blue-500/30 bg-gray-900 p-10 shadow-[0_0_100px_rgba(37,99,235,0.2)]"
              >
                <div className="mb-8 text-center">
                  <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-600/20 text-blue-400">
                    <UserIcon size={40} />
                  </div>
                  <h2 className="text-3xl font-black italic tracking-tighter text-white uppercase">Tu Identidad</h2>
                  <p className="mt-2 text-xs font-bold uppercase tracking-widest text-gray-500">
                    {user.usernameSet ? 'Cambiar tu nombre de usuario' : 'Confirma tu nombre de usuario para continuar'}
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="rounded-3xl bg-white/5 p-6 border border-white/5">
                    <div className="mb-3 flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Nombre de Usuario</label>
                      <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 border border-white/10">
                        {user.usernameSet ? (
                          <>
                            <GoldPointIcon size={12} />
                            <span className="text-xs font-black text-white">10,000</span>
                          </>
                        ) : (
                          <span className="text-[10px] font-black text-green-400 uppercase">¡Gratis!</span>
                        )}
                      </div>
                    </div>
                    <input 
                      type="text"
                      value={tempUsername}
                      onChange={(e) => setTempUsername(e.target.value)}
                      className="w-full rounded-2xl bg-black/40 px-6 py-4 text-xl font-black text-white outline-none ring-2 ring-white/10 focus:ring-blue-500"
                      placeholder="Ej: ElPro_44"
                    />
                    <div className="mt-4 flex flex-col gap-2">
                      <p className="text-[10px] text-gray-500 italic">
                        * Este nombre será visible para tus amigos y en el ranking.
                      </p>
                      {user.usernameSet && (
                        <p className="text-[9px] font-bold text-blue-400 uppercase tracking-tight">
                          El cambio de nombre cuesta 10,000 puntos después de la primera vez.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={handleConfirmUsername}
                      disabled={isCheckingUsername || !tempUsername.trim()}
                      className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-blue-600 py-5 text-lg font-black uppercase tracking-widest text-white transition-all hover:bg-blue-500 disabled:opacity-50"
                    >
                      {isCheckingUsername ? (
                        <Loader2 className="animate-spin" size={24} />
                      ) : (
                        <>
                          <span>Confirmar Identidad</span>
                          <Check size={24} />
                        </>
                      )}
                    </button>
                    {user.usernameSet && (
                      <button 
                        onClick={() => setShowUsernameModal(false)}
                        className="text-[10px] font-black uppercase tracking-widest text-gray-600 hover:text-white transition-colors py-2"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Training Difficulty Modal */}
        <AnimatePresence>
          {showTrainingModal && (
            <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm" onClick={() => setShowTrainingModal(false)}>
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-[2.5rem] border border-white/10 bg-gray-900 p-8 shadow-2xl text-center"
              >
                <div className="mb-6 flex justify-center">
                  <div className="rounded-2xl bg-blue-500/20 p-4">
                    <GoldPointIcon size={40} />
                  </div>
                </div>
                <h3 className="mb-2 text-2xl font-black uppercase tracking-tighter text-white">JUGAR POR PUNTOS</h3>
                <p className="mb-8 text-sm text-gray-400">Selecciona la dificultad</p>
                
                <div className="mb-4">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-400">Apostador de Puntos</p>
                  <div className="flex items-center gap-4 rounded-2xl bg-white/5 p-4 border border-white/5">
                    <button 
                      onClick={() => setTrainingWager(prev => Math.max(0, prev - 10))}
                      className="h-10 w-10 shrink-0 rounded-xl bg-gray-800 flex items-center justify-center text-white hover:bg-gray-700 transition-colors"
                    >
                      -10
                    </button>
                    <input 
                      type="number" 
                      value={trainingWager}
                      onChange={(e) => setTrainingWager(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full bg-transparent text-center text-2xl font-black text-white outline-none"
                    />
                    <button 
                      onClick={() => setTrainingWager(prev => prev + 10)}
                      className="h-10 w-10 shrink-0 rounded-xl bg-blue-600 flex items-center justify-center text-white hover:bg-blue-500 transition-colors"
                    >
                      +10
                    </button>
                  </div>
                  <p className="mt-3 text-[9px] font-bold text-gray-500 uppercase tracking-tighter text-center">
                    la cantidad de puntos apostados define la longitud de tu personaje.
                  </p>
                </div>

                <div className="space-y-4">
                  <button 
                    onClick={() => {
                      onStartTraining(5, trainingWager);
                      setShowTrainingModal(false);
                    }}
                    className="group flex w-full items-center justify-between rounded-2xl bg-white/5 p-5 border border-white/5 hover:border-green-500/30 hover:bg-green-500/10 transition-all"
                  >
                    <div className="text-left">
                      <p className="text-lg font-black text-white uppercase tracking-tighter">Modo Fácil</p>
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Hasta 5 usuarios - ideal para practicar</p>
                    </div>
                    <Check size={24} className="text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>

                  <button 
                    onClick={() => {
                      onStartTraining(50, trainingWager);
                      setShowTrainingModal(false);
                    }}
                    className="group flex w-full items-center justify-between rounded-2xl bg-white/5 p-5 border border-white/5 hover:border-red-500/30 hover:bg-red-500/10 transition-all"
                  >
                    <div className="text-left">
                      <p className="text-lg font-black text-white uppercase tracking-tighter">Modo Difícil</p>
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Hasta 50 usuarios - desafío extremo</p>
                    </div>
                    <Zap size={24} className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                </div>

                <button 
                  onClick={() => setShowTrainingModal(false)}
                  className="mt-8 text-[10px] font-black uppercase tracking-widest text-gray-600 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={() => setShowSettings(false)}>
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-[2.5rem] bg-gray-900 border border-white/10 shadow-3xl overflow-hidden"
              >
                <div className="bg-gradient-to-r from-gray-800 to-gray-900 p-6 flex items-center justify-between border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-blue-500/20 p-2">
                      <Settings className="text-blue-400" size={20} />
                    </div>
                    <h3 className="text-xl font-black italic tracking-tighter text-white uppercase">Ajustes</h3>
                  </div>
                  <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white transition-colors">
                    <X size={24} />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    <button 
                      onClick={() => {
                          const next = !sfxEnabled;
                          setSfxEnabled(next);
                          soundManager.toggleSFX(next);
                      }}
                      className={`flex items-center justify-center gap-2 rounded-2xl p-4 font-bold border transition-all ${sfxEnabled ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'bg-gray-800 border-white/5 text-gray-500'}`}
                    >
                      {sfxEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                      <span className="text-[10px] uppercase tracking-widest">SFX</span>
                    </button>
                  </div>

                  {/* Controls Button */}
                  <button 
                    onClick={() => setShowControls(true)}
                    className="flex w-full items-center justify-between rounded-2xl bg-gray-800 p-4 font-bold border border-white/5 hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Gamepad2 size={20} className="text-purple-400" />
                      <span className="text-[10px] uppercase tracking-widest">Ver Controles</span>
                    </div>
                    <Plus size={16} className="text-gray-600" />
                  </button>

                  {/* Change Username Shortcut */}
                  <button 
                    onClick={() => {
                      setView('profile');
                      setShowSettings(false);
                    }}
                    className="flex w-full items-center justify-between rounded-2xl bg-gray-800 p-4 font-bold border border-white/5 hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <UserIcon size={20} className="text-blue-400" />
                      <div className="text-left">
                        <p className="text-[10px] uppercase tracking-widest">Cambiar Nombre</p>
                        <p className="text-[8px] text-gray-500">Actual: {user.displayName}</p>
                      </div>
                    </div>
                    <Check size={16} className="text-blue-500" />
                  </button>

                  {/* High Quality Toggle (Recommended detail) */}
                  <button 
                    onClick={() => setHighQuality(!highQuality)}
                    className={`flex w-full items-center justify-between rounded-2xl p-4 font-bold border transition-all ${highQuality ? 'bg-green-600/10 border-green-500/20 text-green-400' : 'bg-gray-800 border-white/5 text-gray-500'}`}
                  >
                    <div className="flex items-center gap-3">
                      <Sparkles size={20} className={highQuality ? 'text-green-400' : 'text-gray-500'} />
                      <div className="text-left">
                        <p className="text-[10px] uppercase tracking-widest">Efectos Especiales</p>
                        <p className="text-[8px] opacity-70">Aumenta los detalles visuales</p>
                      </div>
                    </div>
                    <div className={`w-10 h-5 rounded-full relative transition-colors ${highQuality ? 'bg-green-500' : 'bg-gray-600'}`}>
                      <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${highQuality ? 'left-6' : 'left-1'}`} />
                    </div>
                  </button>

                  {/* Search for Updates Button */}
                  <div className="space-y-2">
                    <button 
                      onClick={handleCheckUpdate}
                      disabled={isCheckingUpdate}
                      className="flex w-full items-center justify-between rounded-2xl bg-blue-600/10 p-4 font-bold border border-blue-500/20 hover:bg-blue-600/20 transition-all disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        {isCheckingUpdate ? (
                          <Loader2 size={20} className="text-blue-400 animate-spin" />
                        ) : (
                          <Download size={20} className="text-blue-400" />
                        )}
                        <div className="text-left">
                          <p className="text-[10px] uppercase tracking-widest text-blue-400">Buscar Actualizaciones</p>
                          <p className="text-[8px] text-gray-400">verificar nueva version disponible.</p>
                        </div>
                      </div>
                      {!isCheckingUpdate && <Search size={16} className="text-blue-500/50" />}
                    </button>
                    
                    <AnimatePresence>
                      {updateStatus && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className={`rounded-xl p-3 text-[10px] font-bold uppercase tracking-wider text-center ${
                            updateStatus.type === 'available' ? 'bg-yellow-500/20 text-yellow-500' : 
                            updateStatus.type === 'error' ? 'bg-red-500/20 text-red-500' : 
                            'bg-green-500/20 text-green-500'
                          }`}
                        >
                          {updateStatus.msg}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="p-6 bg-black/20 text-center">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-600">Viborita 1.0.0 - Bonus Arg.</p>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Friend Confirmation Modal */}
        <AnimatePresence>
          {friendToDelete && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95 p-4 backdrop-blur-xl">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-sm rounded-[2.5rem] border border-red-500/30 bg-gray-900 p-8 shadow-2xl text-center"
              >
                <div className="mb-6 flex justify-center">
                  <div className="rounded-2xl bg-red-500/20 p-4">
                    <Trash2 size={40} className="text-red-400" />
                  </div>
                </div>
                <h3 className="mb-2 text-2xl font-black uppercase tracking-tighter text-white">¿Eliminar Amigo?</h3>
                <p className="mb-8 text-sm text-gray-400">¿Estás seguro de que quieres eliminar a <span className="text-white font-bold">{friendToDelete.name}</span> de tu lista de amigos?</p>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={handleDeleteFriendship}
                    className="w-full rounded-2xl bg-red-600 py-4 text-sm font-black uppercase tracking-widest text-white hover:bg-red-500 transition-all shadow-lg shadow-red-600/20"
                  >
                    Sí, Eliminar
                  </button>
                  <button 
                    onClick={() => setFriendToDelete(null)}
                    className="w-full rounded-2xl bg-gray-800 py-4 text-sm font-black uppercase tracking-widest text-gray-400 hover:text-white transition-all border border-white/5"
                  >
                    Cancelar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Controls Detail Modal */}
        <AnimatePresence>
          {showControls && (
            <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/90 p-4" onClick={() => setShowControls(false)}>
               <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-[2.5rem] bg-gray-900 border border-white/10 p-8 shadow-2xl text-center"
              >
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-500/20">
                  <Gamepad2 size={32} className="text-purple-400" />
                </div>
                <h3 className="text-xl font-black uppercase tracking-tighter text-white mb-6">¿Cómo jugar?</h3>
                
                <div className="space-y-4 text-left">
                  <div className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/5">
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Movimiento</p>
                      <p className="text-xs text-gray-300">Usa el mouse o el dedo para que la cabeza siga el cursor. La viborita siempre avanza.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/5">
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest mb-1">Impulso (Turbo)</p>
                      <p className="text-xs text-gray-300">Mantén presionado el clic o la pantalla para ir más rápido. Consume un poco de puntos/masa.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/5">
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">Regla de Oro</p>
                      <p className="text-xs text-gray-300">Si tu cabeza toca el cuerpo de otra viborita, explotas. ¡Haz que los demás te toquen a ti!</p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowControls(false)}
                  className="mt-8 w-full rounded-2xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 transition-all active:scale-95"
                >
                  Entendido
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </AnimatePresence>
    </div>
  </div>
  );
}
