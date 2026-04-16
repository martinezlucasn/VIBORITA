import { useState, useEffect } from 'react';
import { User, Skin } from '../types';
import { ALL_SKINS } from '../constants';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { Coins, Play, ShoppingBag, User as UserIcon, Trophy, ArrowLeft, Plus, Copy, ExternalLink, Check, X, Zap, Users, ShieldCheck, History, LogOut, Trash2, CreditCard } from 'lucide-react';
import { GoldPointIcon, MonedasIcon } from './Icons';
import AdminPanel from './AdminPanel';
import { doc, updateDoc, onSnapshot, collection, query, where, orderBy, limit, getDocs, setDoc, addDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, auth, OperationType } from '../firebase';
import { AnimatePresence } from 'motion/react';
import { signOut, deleteUser } from 'firebase/auth';

interface MenuProps {
  user: User;
  onStartGame: (wager: number) => void;
  onStartTraining: (botCount: number) => void;
  onStartWager: (wager: number, growthWager: number, category: string) => void;
}

export default function Menu({ user, onStartGame, onStartTraining, onStartWager }: MenuProps) {
  const [view, setView] = useState<'main' | 'shop' | 'inventory' | 'ranking' | 'profile' | 'wallet'>('main');
  const [showAdmin, setShowAdmin] = useState(false);
  const [wager, setWager] = useState(0);
  const [showWagerModal, setShowWagerModal] = useState(false);
  const [showPrivateModal, setShowPrivateModal] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState<{code: string, wager: number} | null>(null);
  const [privateRoomId, setPrivateRoomId] = useState('');
  const [privateWager, setPrivateWager] = useState(10);
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

  // Profile States
  const [newUsername, setNewUsername] = useState(user.displayName);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [withdrawAlias, setWithdrawAlias] = useState('');
  const [profileMessage, setProfileMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [withdrawalHistory, setWithdrawalHistory] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    
    if (paymentStatus === 'success') {
      setTicketMessage({ text: '¡Pago aprobado! Tus monedas se acreditarán en segundos.', type: 'success' });
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => setTicketMessage(null), 5000);
    } else if (paymentStatus === 'failure') {
      setTicketMessage({ text: 'El pago fue cancelado o rechazado.', type: 'error' });
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => setTicketMessage(null), 5000);
    }
  }, []);

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
        const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setWithdrawalHistory(history);
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
      const players: User[] = [];
      snapshot.forEach((doc) => {
        players.push({ id: doc.id, ...doc.data() } as User);
      });
      setTopPlayers(players);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'users'));
    return () => unsubscribe();
  }, []);

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

  const equippedSkin = ALL_SKINS.find(s => s.id === user.equippedSkin) || ALL_SKINS[0];

  const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? '' 
    : 'https://ais-pre-q3rghkaneiw6ol5cicebm3-79875930852.us-east1.run.app';

  const handleCreatePreference = async (amount: number, type: 'monedas' | 'points' = 'monedas', pointsAmount: number = 0, price?: number) => {
    setIsCreatingPreference(true);
    try {
      const response = await fetch(`${API_URL}/api/create-preference`, {
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

  const handleUpdateUsername = async () => {
    if (!newUsername.trim() || newUsername === user.displayName) return;
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
      await updateDoc(userRef, { displayName: newUsername.trim() });
      
      // Sync with Supabase
      await supabase.from('profiles').update({ display_name: newUsername.trim() }).eq('id', user.id);
      
      setProfileMessage({ text: 'Nombre de usuario actualizado', type: 'success' });
    } catch (e) {
      setProfileMessage({ text: 'Error al actualizar', type: 'error' });
    } finally {
      setIsUpdatingProfile(false);
      setTimeout(() => setProfileMessage(null), 3000);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawAmount <= 0 || withdrawAmount > user.monedas || !withdrawAlias.trim()) return;
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
    const confirmDelete = window.confirm('¿Estás seguro de que quieres desvincular tu cuenta? Esta acción eliminará todos tus datos, puntos y monedas de forma permanente.');
    if (!confirmDelete) return;

    const currentUser = auth.currentUser;
    if (!currentUser) return;

    setIsUpdatingProfile(true);
    try {
      // 1. Delete from Firestore
      await deleteDoc(doc(db, 'users', user.id));
      
      // 2. Delete from Supabase
      await supabase.from('profiles').delete().eq('id', user.id);
      
      // 3. Delete Firebase Auth User
      await deleteUser(currentUser);
      
      setProfileMessage({ text: 'Cuenta desvinculada con éxito', type: 'success' });
    } catch (e: any) {
      console.error('Error deleting account:', e);
      if (e.code === 'auth/requires-recent-login') {
        setProfileMessage({ text: 'Por seguridad, debes volver a iniciar sesión antes de desvincular la cuenta', type: 'error' });
      } else {
        setProfileMessage({ text: 'Error al desvincular la cuenta', type: 'error' });
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

  const handleBuy = async (skin: Skin, price: number) => {
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

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="flex min-h-full w-full flex-col items-center justify-center p-4 pb-20 text-white">
      {view === 'main' && (
        <div className="flex w-full max-w-md flex-col gap-4">
          {user.email === 'martinezlucasn@gmail.com' && (
            <button 
              onClick={() => setShowAdmin(true)}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-600/20 text-red-500 transition-all hover:bg-red-600/40"
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
            <div className="bg-gray-800/80 px-4 py-1.5 rounded-t-xl border-t border-x border-white/10 backdrop-blur-md">
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
                    key={user.coins}
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
                    key={user.monedas}
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
              <span>MONEDAS</span>
            </button>

            <button
              onClick={() => onStartTraining(3)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gray-800 py-6 text-xl font-black uppercase tracking-tighter transition-all hover:bg-gray-700 active:scale-95 border border-white/5 shadow-lg"
            >
              <GoldPointIcon size={24} />
              <span>PUNTOS BASICO</span>
            </button>

            <button
              onClick={() => onStartTraining(100)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gray-800 py-6 text-xl font-black uppercase tracking-tighter transition-all hover:bg-gray-700 active:scale-95 border border-white/5 shadow-lg"
            >
              <GoldPointIcon size={24} />
              <span>PUNTOS AVANZADO</span>
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

          <div className="space-y-6">
            {/* Username Section */}
            <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Nombre de Usuario (Único)</label>
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="flex-1 rounded-xl bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Nuevo nombre..."
                />
                <button 
                  onClick={handleUpdateUsername}
                  disabled={isUpdatingProfile || newUsername === user.displayName}
                  className="rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  <Check size={20} />
                </button>
              </div>
            </div>

            {/* Withdrawal Section */}
            <div className="rounded-2xl bg-blue-500/5 p-4 border border-blue-500/20">
              <div className="mb-4 flex items-center justify-between">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-blue-400">Retirar Dinero (Monedas)</label>
                <div className="flex items-center gap-1">
                  <MonedasIcon size={12} />
                  <span className="text-xs font-black text-white">{user.monedas}</span>
                </div>
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
                    placeholder="Cantidad a retirar..."
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-500">
                    ARS
                  </div>
                </div>
                <input 
                  type="text"
                  value={withdrawAlias}
                  onChange={(e) => setWithdrawAlias(e.target.value)}
                  className="w-full rounded-xl bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Alias o CBU de Mercado Pago..."
                />
                <button 
                  onClick={handleWithdraw}
                  disabled={isUpdatingProfile || withdrawAmount <= 0 || !withdrawAlias.trim()}
                  className="w-full rounded-xl bg-blue-600 py-4 text-sm font-black uppercase tracking-tighter text-white hover:bg-blue-500 disabled:opacity-50 shadow-lg shadow-blue-500/20"
                >
                  Solicitar Retiro
                </button>
                <p className="text-[10px] text-center text-gray-500 italic">
                  * El monto solicitado se descontará de tus monedas actuales.
                </p>
              </div>
            </div>

            {/* Feedback Message */}
            <AnimatePresence>
              {profileMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={`rounded-xl p-3 text-center text-xs font-bold ${profileMessage.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
                >
                  {profileMessage.text}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Wallet Shortcut */}
            <button
              onClick={() => setView('wallet')}
              className="flex w-full items-center justify-between rounded-2xl bg-blue-600/10 p-4 border border-blue-500/20 hover:bg-blue-600/20 transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-blue-600/20 p-2 group-hover:scale-110 transition-transform">
                  <CreditCard className="text-blue-400" size={20} />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-black text-white uppercase italic tracking-tighter">Mi Billetera</h3>
                  <p className="text-[10px] font-bold text-blue-400/70 uppercase tracking-widest">Cargar o Canjear Monedas</p>
                </div>
              </div>
              <ExternalLink size={18} className="text-blue-400/50 group-hover:text-blue-400 transition-colors" />
            </button>

            {/* Withdrawal History Section */}
            <div className="mt-8 space-y-4">
              <div className="flex items-center gap-2 text-gray-400">
                <History size={16} />
                <h3 className="text-xs font-bold uppercase tracking-widest">Historial de Retiros</h3>
              </div>
              
              <div className="max-h-60 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                {withdrawalHistory.map((w) => (
                  <div key={w.id} className="rounded-xl bg-white/5 p-3 border border-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-gray-500">{new Date(w.timestamp).toLocaleDateString()}</span>
                      <span className={`text-[10px] font-bold uppercase ${w.status === 'completed' ? 'text-green-400' : 'text-blue-400'}`}>
                        {w.status === 'completed' ? 'Completado' : 'Pendiente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-black text-white">{w.amount}</span>
                        <MonedasIcon size={12} />
                      </div>
                      {w.transactionId && (
                        <div className="text-right">
                          <p className="text-[8px] text-gray-500 uppercase">Comprobante</p>
                          <p className="text-[10px] font-mono text-blue-400 font-bold">{w.transactionId}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {withdrawalHistory.length === 0 && (
                  <p className="py-4 text-center text-[10px] text-gray-600 italic">No tienes retiros previos</p>
                )}
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

              {/* Points Exchange in Wallet */}
              <div className="space-y-4 pt-4 border-t border-white/5">
                <div className="flex items-center gap-2 text-yellow-500">
                  <GoldPointIcon size={18} />
                  <h3 className="text-xs font-bold uppercase tracking-widest">Canjear por Puntos</h3>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { points: 1000, cost: 100 },
                    { points: 2000, cost: 175 }
                  ].map((pkg) => (
                    <button
                      key={pkg.points}
                      onClick={() => handleExchangePoints(pkg.points, pkg.cost)}
                      disabled={user.monedas < pkg.cost}
                      className="group relative flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 p-4 transition-all hover:bg-blue-600/20 hover:border-blue-500/50 disabled:opacity-30 active:scale-95"
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-yellow-500/20 p-2">
                          <GoldPointIcon size={20} />
                        </div>
                        <div className="text-left">
                          <p className="text-lg font-black text-white">{pkg.points.toLocaleString()} Puntos</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-lg font-black text-blue-400">{pkg.cost}</span>
                          <MonedasIcon size={14} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Purchase Options */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-blue-400">
                <ShoppingBag size={18} />
                <h3 className="text-xs font-bold uppercase tracking-widest">Cargar Monedas</h3>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                {[150, 500, 1000, 2000, 3000, 4000, 5000, 10000, 20000, 50000, 100000].map((amount) => (
                  <button
                    key={amount}
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
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">${Math.round(amount * 1.074).toLocaleString()} ARS</span>
                    
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

              <div className="rounded-xl bg-blue-500/10 p-4 border border-blue-500/20">
                <p className="text-[10px] text-blue-300 leading-relaxed">
                  * Las recargas se procesan manualmente. Selecciona un monto para ver los datos de transferencia.
                </p>
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
              {withdrawalHistory.map((w) => (
                <div key={w.id} className="rounded-xl bg-white/5 p-4 border border-white/5 hover:bg-white/10 transition-colors">
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
            {topPlayers.map((player, index) => (
              <div 
                key={player.id} 
                className={`flex items-center justify-between rounded-xl p-4 ${player.id === user.id ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-gray-800/50'}`}
              >
                <div className="flex items-center gap-4">
                  <span className={`text-xl font-black ${index === 0 ? 'text-yellow-500' : index === 1 ? 'text-gray-300' : index === 2 ? 'text-orange-500' : 'text-gray-500'}`}>
                    #{index + 1}
                  </span>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{player.displayName}</span>
                      {player.lastActive > currentTime - 60000 && (
                        <span className="relative flex h-2 w-2" title="En línea">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                        </span>
                      )}
                    </div>
                    {player.id === user.id && <span className="text-[8px] font-bold uppercase tracking-widest text-blue-400">Tú</span>}
                  </div>
                </div>
                <span className="font-black text-yellow-500">{player.coins} <GoldPointIcon size={14} /></span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setView('main')}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-800 py-4 font-bold transition-colors hover:bg-gray-700"
          >
            <ArrowLeft size={20} /> Volver al Menú
          </button>
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
                    <p className="text-2xl font-black text-white">${Math.round(selectedCoinPackage * 1.074).toLocaleString()} ARS</p>
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
                onClick={() => handleCreatePreference(selectedCoinPackage, 'monedas', 0, Math.round(selectedCoinPackage * 1.074))}
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
        <div className="w-full max-w-2xl rounded-3xl bg-gray-900/80 p-8 backdrop-blur-xl">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-3xl font-bold">Tus Skins</h2>
              <div className="flex items-center gap-2 rounded-full bg-gray-800 px-3 py-1">
                <GoldPointIcon size={14} />
                <span className="text-sm font-bold">{user.coins}</span>
              </div>
            </div>
            <button onClick={() => setView('main')} className="text-gray-400 hover:text-white">Cerrar</button>
          </div>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {ALL_SKINS.filter(s => user.ownedSkins.includes(s.id)).map(skin => (
              <button
                key={skin.id}
                onClick={() => handleEquip(skin.id)}
                className={`group relative flex flex-col items-center rounded-2xl border-2 p-4 transition-all ${user.equippedSkin === skin.id ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 bg-gray-800 hover:border-gray-500'}`}
              >
                <span className="mb-2 text-4xl">{skin.icon}</span>
                <span className="text-xs font-bold uppercase tracking-tighter">{skin.name}</span>
                {user.equippedSkin === skin.id && (
                  <div className="absolute -right-2 -top-2 rounded-full bg-blue-500 p-1">
                    <Play size={12} fill="white" />
                  </div>
                )}
              </button>
            ))}
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
              <div className="flex items-center gap-2 rounded-full bg-gray-800 px-4 py-2">
                <GoldPointIcon size={16} />
                <span className="font-black text-yellow-500">{user.coins}</span>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-gray-800 px-4 py-2">
                <MonedasIcon size={16} />
                <span className="font-black text-blue-400">{user.monedas}</span>
              </div>
              <button onClick={() => setView('main')} className="text-gray-400 hover:text-white">
                <X size={24} />
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
                {ALL_SKINS.filter(s => !user.ownedSkins.includes(s.id)).map(skin => {
                  let price = skin.price || (skin.rarity === 'legendary' ? 10000 : skin.rarity === 'epic' ? 5000 : skin.rarity === 'rare' ? 2500 : 1000);
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
                      key={skin.id}
                      onClick={() => handleBuy(skin, price)}
                      disabled={userBalance < price}
                      className={`group relative flex flex-col items-center rounded-2xl border-2 border-gray-700 bg-gray-800 p-4 transition-all hover:border-yellow-500 disabled:opacity-50`}
                    >
                      {isDiscountDay && (
                        <div className="absolute -top-2 -right-2 z-10 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white shadow-lg">
                          -10%
                        </div>
                      )}
                      <span className="mb-2 text-4xl">{skin.icon}</span>
                      <span className="text-xs font-bold uppercase tracking-tighter">{skin.name}</span>
                      <span className={`mt-2 flex items-center gap-1 text-sm font-black ${currency === 'coins' ? 'text-yellow-500' : 'text-blue-400'}`}>
                        {price} {currency === 'coins' ? <GoldPointIcon size={14} /> : <MonedasIcon size={14} />}
                      </span>
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
                ].map((pkg) => (
                  <button
                    key={pkg.points}
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
                  key={cat}
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
                  basica: [10, 50, 100, 150],
                  pro: [200, 500, 1000, 2000],
                  millonario: [3000, 4000, 5000, 6000]
                };
                const growthMapping = [10, 50, 100, 150];
                
                return categories[selectedCategory].map((val, idx) => {
                  const isLocked = (selectedCategory === 'pro' && (!user.proAccessUntil || user.proAccessUntil < Date.now())) ||
                                  (selectedCategory === 'millonario' && (!user.millonarioAccessUntil || user.millonarioAccessUntil < Date.now()));
                  
                  const timeInfo = selectedCategory === 'pro' ? getTimeRemaining(user.proAccessUntil || 0) :
                                  selectedCategory === 'millonario' ? getTimeRemaining(user.millonarioAccessUntil || 0) : null;

                  return (
                    <button
                      key={val}
                      onClick={() => {
                        if (isLocked) {
                          setTicketMessage({ text: `Debes comprar la entrada ${selectedCategory.toUpperCase()} en la tienda`, type: 'error' });
                          setTimeout(() => setTicketMessage(null), 3000);
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
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      <AnimatePresence>
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
      </AnimatePresence>
    </div>
  </div>
  );
}
