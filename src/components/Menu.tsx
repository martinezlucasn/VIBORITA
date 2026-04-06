import { useState, useEffect } from 'react';
import { User, Skin } from '../types';
import { ALL_SKINS } from '../constants';
import { motion } from 'motion/react';
import { Coins, Play, ShoppingBag, User as UserIcon, Trophy, ArrowLeft, Plus, Copy, ExternalLink, Check, X, Zap, Users } from 'lucide-react';
import { doc, updateDoc, onSnapshot, collection, query, where, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface MenuProps {
  user: User;
  onStartGame: (wager: number) => void;
  onStartTraining: (botCount: number) => void;
}

export default function Menu({ user, onStartGame, onStartTraining }: MenuProps) {
  const [view, setView] = useState<'main' | 'shop' | 'inventory' | 'ranking'>('main');
  const [wager, setWager] = useState(0);
  const [showBuyPoints, setShowBuyPoints] = useState(false);
  const [buyAmount, setBuyAmount] = useState(100);
  const [copied, setCopied] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [topPlayers, setTopPlayers] = useState<User[]>([]);

  useEffect(() => {
    const sixtySecondsAgo = Date.now() - 60000;
    const q = query(collection(db, 'users'), where('lastActive', '>', sixtySecondsAgo));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOnlineCount(snapshot.size);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'users'));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('coins', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const players: User[] = [];
      snapshot.forEach((doc) => {
        players.push({ id: doc.id, ...doc.data() } as User);
      });
      setTopPlayers(players);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'users'));
    return () => unsubscribe();
  }, []);

  const copyAlias = () => {
    navigator.clipboard.writeText('latorre44');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const equippedSkin = ALL_SKINS.find(s => s.id === user.equippedSkin) || ALL_SKINS[0];

  const handleEquip = async (skinId: string) => {
    const userRef = doc(db, 'users', user.id);
    await updateDoc(userRef, { equippedSkin: skinId })
      .catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
  };

  const handleBuy = async (skin: Skin, price: number) => {
    if (user.coins < price) return;
    const userRef = doc(db, 'users', user.id);
    await updateDoc(userRef, {
      coins: user.coins - price,
      ownedSkins: [...user.ownedSkins, skin.id]
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="flex min-h-full w-full flex-col items-center justify-center p-4 pb-20 text-white">
      {view === 'main' && (
        <div className="flex w-full max-w-md flex-col gap-4">
          <div className="mb-8 text-center">
            <h1 className="text-5xl font-black italic tracking-tighter text-blue-500 text-center no-underline">Viborita</h1>
            <p className="text-gray-400">Apuesta en base a tus habilidades, gana dinero</p>
          </div>

          <div className="mb-4 flex items-center justify-center gap-4 rounded-2xl bg-gray-800/50 px-6 py-4 backdrop-blur-md border border-white/5">
            <div className="flex flex-col items-center">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Tu Saldo Actual</span>
              <div className="flex items-center gap-3">
                <Coins className="text-yellow-500" size={28} />
                <motion.span 
                  key={user.coins}
                  initial={{ scale: 1.2, color: '#4ade80' }}
                  animate={{ scale: 1, color: '#ffffff' }}
                  transition={{ duration: 0.5 }}
                  className="text-4xl font-black"
                >
                  {user.coins} <span className="text-2xl text-gray-400 italic">🗿</span>
                </motion.span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-gray-800/50 p-6 backdrop-blur-md">
            <label className="mb-4 block text-center text-sm font-bold text-gray-400 uppercase tracking-widest">
              Selecciona tu Apuesta
            </label>
            <div className="flex items-center justify-between gap-4">
              <button 
                onClick={() => setWager(Math.max(0, wager - 10))}
                className="h-12 w-12 rounded-full bg-gray-700 text-2xl font-bold hover:bg-gray-600"
              >
                -
              </button>
              <div className="text-center">
                <span className="text-4xl font-black text-yellow-500">{wager}</span>
                <span className="ml-2 text-xl text-gray-400">🗿</span>
              </div>
              <button 
                onClick={() => setWager(Math.min(user.coins, wager + 10))}
                className="h-12 w-12 rounded-full bg-gray-700 text-2xl font-bold hover:bg-gray-600"
              >
                +
              </button>
            </div>
            <div className="mt-4 flex gap-2">
              {[0, 10, 50, 100].map(val => (
                <button
                  key={val}
                  onClick={() => setWager(Math.min(user.coins, val))}
                  className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${wager === val ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => onStartTraining(1)}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-blue-500/50 bg-blue-500/10 py-6 text-xl font-black uppercase tracking-tighter transition-all hover:bg-blue-500/20 active:scale-95"
            >
              <Zap size={24} className="text-blue-400" />
              <span className="text-sm">Entrenamiento</span>
            </button>

            <button
              onClick={() => onStartGame(wager)}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-green-500/50 bg-green-500/10 py-6 text-xl font-black uppercase tracking-tighter transition-all hover:bg-green-500/20 active:scale-95"
            >
              <div className="relative">
                <Users size={24} className="text-green-400" />
                <motion.div
                  animate={{ scale: [1, 1.5, 1], opacity: [1, 0, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-green-500"
                />
              </div>
              <span className="text-sm">Modo Online</span>
            </button>
          </div>

          <button
            onClick={() => onStartGame(wager)}
            className="group relative flex w-full flex-col items-center justify-center gap-1 rounded-2xl bg-blue-600 py-6 transition-all hover:bg-blue-500 hover:shadow-[0_0_30px_rgba(37,99,235,0.4)] active:scale-95"
          >
            <div className="flex items-center gap-2 text-2xl font-black uppercase tracking-tighter">
              <Play fill="currentColor" /> Jugar Ahora
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-blue-200 opacity-80">
              {onlineCount} Jugadores en línea
            </div>
          </button>

          <button
            onClick={() => onStartTraining(10)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-purple-500/50 bg-purple-500/10 py-4 text-xl font-black uppercase tracking-tighter transition-all hover:bg-purple-500/20"
          >
            <Zap size={20} className="text-purple-400" /> Entrenamiento Avanzado x10
          </button>

          <div className="grid grid-cols-3 gap-4">
            <button
              onClick={() => setView('inventory')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gray-800 py-4 font-bold hover:bg-gray-700"
            >
              <UserIcon size={20} />
              <span className="text-[10px] uppercase tracking-widest">Inventario</span>
            </button>
            <button
              onClick={() => setView('shop')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gray-800 py-4 font-bold hover:bg-gray-700"
            >
              <ShoppingBag size={20} />
              <span className="text-[10px] uppercase tracking-widest">Tienda</span>
            </button>
            <button
              onClick={() => setView('ranking')}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gray-800 py-4 font-bold hover:bg-gray-700"
            >
              <Trophy size={20} className="text-yellow-500" />
              <span className="text-[10px] uppercase tracking-widest">Ranking</span>
            </button>
          </div>
        </div>
      )}

      {view === 'ranking' && (
        <div className="w-full max-w-md rounded-3xl bg-gray-900/80 p-8 backdrop-blur-xl border border-white/10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-3xl font-black italic tracking-tighter text-yellow-500">RANKING GLOBAL</h2>
            <div className="flex items-center gap-2 rounded-full bg-gray-800 px-3 py-1">
              <Coins size={14} className="text-yellow-500" />
              <span className="text-sm font-bold">{user.coins}</span>
            </div>
            <button onClick={() => setView('main')} className="text-gray-400 hover:text-white">
              <X size={24} />
            </button>
          </div>
          <div className="space-y-3">
            {topPlayers.map((player, index) => (
              <div 
                key={player.id} 
                className={`flex items-center justify-between rounded-xl p-4 ${player.id === user.id ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-gray-800/50'}`}
              >
                <div className="flex items-center gap-4">
                  <span className={`text-xl font-black ${index === 0 ? 'text-yellow-500' : index === 1 ? 'text-gray-300' : index === 2 ? 'text-orange-500' : 'text-gray-500'}`}>
                    #{index + 1}
                  </span>
                  <span className="font-bold">{player.displayName}</span>
                </div>
                <span className="font-black text-yellow-500">{player.coins} 🗿</span>
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

      {view === 'inventory' && (
        <div className="w-full max-w-2xl rounded-3xl bg-gray-900/80 p-8 backdrop-blur-xl">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-3xl font-bold">Tus Skins</h2>
              <div className="flex items-center gap-2 rounded-full bg-gray-800 px-3 py-1">
                <Coins size={14} className="text-yellow-500" />
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
        <div className="w-full max-w-2xl rounded-3xl bg-gray-900/80 p-8 backdrop-blur-xl">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-3xl font-bold">Tienda de Skins</h2>
              <div className="flex items-center gap-2 rounded-full bg-gray-800 px-3 py-1">
                <Coins size={14} className="text-yellow-500" />
                <span className="text-sm font-bold">{user.coins}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBuyPoints(true)}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-blue-500 hover:shadow-[0_0_15px_rgba(37,99,235,0.4)]"
              >
                <Plus size={16} /> Comprar Puntos
              </button>
              <button onClick={() => setView('main')} className="text-gray-400 hover:text-white">Cerrar</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {ALL_SKINS.filter(s => !user.ownedSkins.includes(s.id)).map(skin => {
              const price = skin.rarity === 'legendary' ? 500 : skin.rarity === 'epic' ? 250 : skin.rarity === 'rare' ? 100 : 50;
              return (
                <button
                  key={skin.id}
                  onClick={() => handleBuy(skin, price)}
                  disabled={user.coins < price}
                  className={`group flex flex-col items-center rounded-2xl border-2 border-gray-700 bg-gray-800 p-4 transition-all hover:border-yellow-500 disabled:opacity-50`}
                >
                  <span className="mb-2 text-4xl">{skin.icon}</span>
                  <span className="text-xs font-bold uppercase tracking-tighter">{skin.name}</span>
                  <span className="mt-2 flex items-center gap-1 text-sm font-black text-yellow-500">
                    {price} 🗿
                  </span>
                </button>
              );
            })}
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
                    value={buyAmount}
                    onChange={(e) => setBuyAmount(Math.max(1, parseInt(e.target.value) || 0))}
                    className="w-full bg-transparent text-3xl font-black text-white outline-none"
                  />
                  <span className="text-2xl">🗿</span>
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
    </div>
  </div>
  );
}
