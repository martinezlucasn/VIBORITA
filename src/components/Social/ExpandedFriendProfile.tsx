import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Friendship, Skin, PrivateMessage } from '../../types';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { doc, updateDoc, increment, collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { X, MessageSquare, Zap, Heart, Trophy, Medal, Target, Skull, Send, ShieldCheck, ArrowRightLeft, Smile, AlertTriangle, UserMinus, CreditCard, Ticket } from 'lucide-react';
import { MonedasIcon, GoldPointIcon } from '../Icons';
import { ALL_SKINS } from '../../constants';

interface ExpandedFriendProfileProps {
  friend: User;
  onClose: () => void;
  currentUser: User;
  friendship: Friendship;
  onInvite: (wager: number) => void;
  listings: any[];
  onBuySkin: (listing: any) => void;
  onDeleteFriend?: (friendshipId: string) => void;
  onTransfer?: (amount: number, currency: 'coins' | 'monedas') => void;
}

const FRIENDSHIP_RANKS = [
  { level: 0, name: 'Amigos', color: 'text-blue-400', bg: 'bg-blue-400/10' },
  { level: 15, name: 'Buenos Amigos', color: 'text-green-400', bg: 'bg-green-400/10' },
  { level: 30, name: 'Besties', color: 'text-purple-400', bg: 'bg-purple-400/10' },
  { level: 50, name: 'Almas Gemelas', color: 'text-pink-400', bg: 'bg-pink-400/10' },
  { level: 100, name: 'Leyendas', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
];

export default function ExpandedFriendProfile({ friend, onClose, currentUser, friendship, onInvite, listings, onBuySkin, onDeleteFriend, onTransfer }: ExpandedFriendProfileProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'chat' | 'rivalry'>('profile');
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [duelWager, setDuelWager] = useState<number | string>(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState<number | string>(0);
  const [transferCurrency, setTransferCurrency] = useState<'coins' | 'monedas'>('coins');

  const numericWager = typeof duelWager === 'string' ? (parseInt(duelWager) || 0) : duelWager;
  const isFriendly = numericWager === 0;
  const rivalInsufficient = numericWager > (friend.monedas || 0);

  const nextRank = FRIENDSHIP_RANKS.find(r => r.level > (friendship.level || 0));
  const progressToNext = nextRank ? ((friendship.exp || 0) / (nextRank.level * 100)) * 100 : 100;

  useEffect(() => {
    if (activeTab === 'chat') {
      const q = query(
        collection(db, 'privateMessages'),
        where('friendshipId', '==', friendship.id),
        orderBy('timestamp', 'asc'),
        limit(50)
      );
      const unsubscribe = onSnapshot(q, (snap) => {
        setMessages(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PrivateMessage)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'privateMessages'));
      return () => unsubscribe();
    }
  }, [activeTab, friendship.id]);

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;
    try {
      await addDoc(collection(db, 'privateMessages'), {
        friendshipId: friendship.id,
        senderId: currentUser.id,
        text: newMessage.trim(),
        timestamp: Date.now()
      });
      setNewMessage('');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'privateMessages');
    }
  };

  const friendSkin = ALL_SKINS.find(s => s.id === (friend.equippedSkin || 'classic'));

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/95 p-4 backdrop-blur-xl">
      <motion.div
        initial={{ y: 50, scale: 0.9, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 50, scale: 0.9, opacity: 0 }}
        className="relative w-full max-w-2xl overflow-hidden rounded-[3rem] border border-white/10 bg-gray-900 shadow-2xl"
      >
        {/* Profile Header Background */}
        <div className={`absolute top-0 left-0 h-48 w-full opacity-20 bg-gradient-to-br from-blue-600 to-purple-900`} 
              style={friend.profileTheme ? { background: friend.profileTheme } : {}} />

        <div className="relative flex h-full flex-col p-8">
          {/* Floating Close Button */}
          <button 
            onClick={onClose} 
            className="absolute top-6 right-6 z-20 rounded-full bg-black/60 p-3 text-gray-400 backdrop-blur-sm transition-all hover:bg-black/80 hover:text-white active:scale-95"
          >
            <X size={24} />
          </button>

          {/* Header */}
          <div className="mb-8 flex items-start justify-between">
            <div className="flex items-center gap-6 pr-12">
              <div className="relative">
                {friend.avatarConfig ? (
                  <img 
                    src={`https://api.dicebear.com/7.x/${friend.avatarConfig.style}/svg?seed=${friend.avatarConfig.seed}`}
                    className={`h-24 w-24 rounded-3xl bg-blue-500/10 shadow-2xl border-2 ${friend.profileBorder || 'border-blue-500/30'}`}
                    alt={friend.displayName}
                  />
                ) : (
                  <div className={`h-24 w-24 rounded-3xl bg-blue-500/20 flex items-center justify-center text-4xl font-black text-blue-400 shadow-2xl border-2 ${friend.profileBorder || 'border-blue-500/30'}`}>
                    {friend.displayName[0].toUpperCase()}
                  </div>
                )}
                <div className="absolute -bottom-2 -right-2 rounded-full bg-green-500 p-1 border-4 border-gray-900">
                  <div className="h-3 w-3" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-black italic tracking-tighter text-white uppercase sm:text-2xl lg:text-4xl" title={friend.displayName}>
                  {friend.displayName}
                </h2>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="mb-8 flex gap-1 rounded-2xl bg-black/40 p-1 border border-white/5">
            {[
              { id: 'profile', icon: UserIcon, label: 'Perfil' },
              { id: 'chat', icon: MessageSquare, label: 'Chat' },
              { id: 'rivalry', icon: Trophy, label: 'Rivalidad' }
            ].map(tab => (
              <button
                key={`tab-nav-${tab.id}`}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-3 text-[10px] sm:text-xs font-black uppercase tracking-wider transition-all px-1 ${
                  activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <tab.icon size={12} className="sm:hidden" />
                <tab.icon size={14} className="hidden sm:block" />
                <span className="truncate">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar">
            <AnimatePresence mode="wait">
              {activeTab === 'profile' && (
                <motion.div
                  key="profile-tab"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-4 pb-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    {/* Character Showcase */}
                    <div className="rounded-[2rem] bg-white/5 p-6 border border-white/5 flex flex-col items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-t from-blue-500/10 to-transparent" />
                      <span className="text-6xl mb-3 relative z-10">{friendSkin?.icon || '🐍'}</span>
                      <h4 className="text-[9px] font-black text-blue-400 uppercase tracking-[0.3em] mb-1">Skin Equipada</h4>
                      <p className="text-xs font-black text-white uppercase italic">{friendSkin?.name || 'Clásica'}</p>
                    </div>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-1 gap-2">
                      <div className="rounded-2xl bg-white/5 p-3 border border-white/5">
                        <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Puntos</p>
                        <div className="flex items-center gap-2">
                          <GoldPointIcon size={16} />
                          <span className="text-lg font-black text-white italic">{friend.coins?.toLocaleString() || 0}</span>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white/5 p-3 border border-white/5">
                        <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Monedas</p>
                        <div className="flex items-center gap-2">
                          <MonedasIcon size={16} />
                          <span className="text-lg font-black text-blue-400 italic">{friend.highScoreMonedas?.toLocaleString() || 0}</span>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white/5 p-3 border border-white/5">
                        <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Medallas</p>
                        <div className="flex items-center gap-2">
                          <Medal size={16} className="text-purple-400" />
                          <span className="text-lg font-black text-white italic">{friend.trophies || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Friendship Level Progress */}
                  <div className="rounded-[2rem] bg-white/5 p-5 border border-white/5">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h4 className="text-[10px] font-black uppercase text-white">Amistad</h4>
                        <p className="text-[8px] text-gray-500 uppercase tracking-widest">Interactúa para ganar EXP</p>
                      </div>
                      <div className="text-right">
                        {nextRank && (
                          <p className="text-[8px] text-gray-500 uppercase tracking-widest">{nextRank.name}</p>
                        )}
                      </div>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-gray-800 p-0.5 border border-white/5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progressToNext}%` }}
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600 bg-[length:200%_100%] animate-shimmer"
                      />
                    </div>
                  </div>

                  {/* Market Content - Integrated into Profile */}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-2 px-2">
                      <ShoppingBag size={14} className="text-blue-400" />
                      <h4 className="text-[10px] font-black uppercase italic text-white tracking-widest">Skins en Venta</h4>
                    </div>
                    
                    <div className="space-y-2">
                      {(() => {
                        const friendListings = listings
                          .filter(l => l.sellerId === friend.id && l.status === 'active')
                          .sort((a, b) => b.timestamp - a.timestamp);
                        
                        if (friendListings.length === 0) {
                          return (
                            <div className="flex flex-col items-center justify-center py-8 rounded-[2rem] bg-white/5 border border-white/5 border-dashed">
                              <p className="text-[8px] font-bold text-gray-600 uppercase tracking-widest text-center px-4">
                                Sin ofertas activas
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div className="grid grid-cols-1 gap-2">
                            {friendListings.map((listing, idx) => {
                              const skin = ALL_SKINS.find(s => s.id === listing.skinId);
                              if (!skin) return null;
                              return (
                                <div 
                                  key={`friend-listing-${listing.id || idx}`}
                                  className="flex items-center justify-between rounded-2xl bg-black/40 border border-white/10 p-3 hover:border-blue-500/30 transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="text-2xl">{skin.icon}</span>
                                    <div>
                                      <p className="text-[10px] font-black text-white uppercase italic">{skin.name}</p>
                                      <div className="flex items-center gap-1 mt-0.5">
                                        <MonedasIcon size={10} />
                                        <span className="text-xs font-black text-blue-400">{listing.price.toLocaleString()}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <button 
                                    onClick={() => onBuySkin(listing)}
                                    disabled={currentUser.monedas < listing.price}
                                    className="rounded-xl bg-blue-600 px-4 py-2 text-[8px] font-black uppercase tracking-widest text-white hover:bg-blue-500 disabled:opacity-50 active:scale-95 transition-all shadow-lg"
                                  >
                                    Comprar
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Interaction Bar */}
                  <div className="flex justify-center gap-3">
                    {onDeleteFriend && (
                      <button 
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500 shadow-lg shadow-red-500/5 hover:bg-red-500 hover:text-white transition-all"
                        title="Eliminar amigo"
                      >
                        <UserMinus size={20} />
                      </button>
                    )}
                    {onTransfer && (
                      <button 
                        onClick={() => setShowTransferModal(true)}
                        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400 shadow-lg shadow-blue-500/5 hover:bg-blue-600 hover:text-white transition-all"
                        title="Transferir monedas"
                      >
                        <ArrowRightLeft size={20} />
                      </button>
                    )}
                    <button 
                      onClick={() => setActiveTab('chat')}
                      className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"
                    >
                      <MessageSquare size={20} />
                    </button>
                    <button 
                      onClick={() => onInvite(numericWager)}
                      className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-500"
                    >
                      <Zap size={20} />
                    </button>
                  </div>
                </motion.div>
              )}

              {activeTab === 'chat' && (
                <motion.div
                  key="chat-tab"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex h-[350px] flex-col rounded-[2rem] bg-black/40 border border-white/5 overflow-hidden"
                >
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {messages.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center opacity-30">
                        <MessageSquare size={40} className="mb-2" />
                        <p className="text-[10px] font-bold uppercase tracking-widest">Sin mensajes aún</p>
                        <p className="text-[8px]">¡Saluda a tu amigo!</p>
                      </div>
                    ) : (
                      messages.map((msg, idx) => (
                        <div key={`ms-pk-${msg.id || idx}`} className={`flex ${msg.senderId === currentUser.id ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-xs font-bold shadow-lg ${
                            msg.senderId === currentUser.id 
                              ? 'bg-blue-600 text-white' 
                              : 'bg-white/10 text-gray-200 border border-white/10'
                          }`}>
                            {msg.text}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="p-3 bg-white/5 border-t border-white/5 flex gap-2">
                    <input 
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Mensaje..."
                      className="flex-1 rounded-xl bg-black/40 px-3 py-2 text-xs font-bold text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-blue-500"
                    />
                    <button 
                      onClick={handleSendMessage}
                      className="rounded-xl bg-blue-600 p-2 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </motion.div>
              )}

              {activeTab === 'rivalry' && (
                <motion.div
                  key="rivalry-tab"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-4 pb-4"
                >
                  <div className="rounded-[2rem] bg-white/5 p-6 border border-white/5 text-center">
                    <h4 className="text-[10px] font-black uppercase text-blue-400 mb-4 tracking-[0.3em]">Historial Directo</h4>
                    <div className="flex items-center justify-between px-8">
                      <div className="text-center">
                        <p className="text-3xl font-black text-white italic">{friendship.stats?.[currentUser.id]?.wins || 0}</p>
                        <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mt-1">Tus Victorias</p>
                      </div>
                      <div className="h-12 w-px bg-white/5" />
                      <div className="text-center">
                        <p className="text-3xl font-black text-white italic">{friendship.stats?.[friend.id]?.wins || 0}</p>
                        <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mt-1">Sus Victorias</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white/5 p-3 border border-white/5 space-y-2">
                        <h5 className="text-[9px] font-black uppercase text-gray-500 tracking-widest">Tus Puntos</h5>
                        <div className="flex justify-between items-end">
                            <span className="text-[8px] font-bold text-gray-600 uppercase">Actuales</span>
                            <span className="text-xs font-black text-white italic">{currentUser.coins?.toLocaleString() || 0}</span>
                        </div>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-3 border border-white/5 space-y-2">
                        <h5 className="text-[9px] font-black uppercase text-gray-500 tracking-widest">Sus Puntos</h5>
                        <div className="flex justify-between items-end">
                            <span className="text-[8px] font-bold text-gray-600 uppercase">Actuales</span>
                            <span className="text-xs font-black text-blue-400 italic">{friend.coins?.toLocaleString() || 0}</span>
                        </div>
                    </div>
                  </div>

                  <div className="rounded-[2rem] bg-red-900/20 p-6 border border-red-500/20 relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-3 opacity-10">
                        <Target size={80} className="text-red-500 rotate-12" />
                     </div>
                     <p className="text-[9px] font-black text-red-500 uppercase tracking-[0.4em] text-center mb-4 relative z-10">ZONA DE DESAFÍO</p>
                     <div className="flex flex-col gap-3 relative z-10">
                        <div className="flex flex-col gap-1.5">
                           <label className="text-[8px] font-bold text-gray-500 uppercase tracking-widest px-2">Monto de la Apuesta</label>
                           <div className="flex-1 bg-black/60 rounded-xl p-3 border border-white/5 flex items-center gap-3 focus-within:border-red-500/50 transition-colors">
                               <MonedasIcon size={18} />
                               <input 
                                   type="number" 
                                   value={duelWager}
                                   onChange={(e) => setDuelWager(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))}
                                   placeholder="0 - Amistoso"
                                   className="bg-transparent outline-none text-xl text-white font-black w-full placeholder:text-gray-700"
                               />
                           </div>
                        </div>
                        
                         <div className="relative">
                           <button 
                               onClick={() => onInvite(numericWager)}
                               disabled={currentUser.monedas < numericWager || (rivalInsufficient && numericWager > 0)}
                               className="group relative w-full overflow-hidden rounded-xl bg-red-600 py-4 font-black uppercase text-white shadow-2xl shadow-red-600/40 transition-all hover:bg-red-500 active:scale-95 disabled:opacity-50 disabled:grayscale"
                           >
                               <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                               <div className="flex items-center justify-center gap-2">
                                  <Zap size={18} className={isFriendly ? "" : "animate-pulse"} />
                                  <span className="text-base tracking-tighter italic">
                                    {isFriendly ? "Amistoso" : "Desafiar"}
                                  </span>
                               </div>
                           </button>

                           <AnimatePresence>
                             {rivalInsufficient && numericWager > 0 && (
                               <motion.div 
                                 initial={{ opacity: 0, y: -5 }}
                                 animate={{ opacity: 1, y: 0 }}
                                 exit={{ opacity: 0, y: -5 }}
                                 className="mt-3 flex items-center justify-center gap-2 text-red-500 text-[9px] font-black uppercase tracking-widest"
                               >
                                 <AlertTriangle size={10} />
                                 <span>El rival no tiene las monedas suficientes</span>
                               </motion.div>
                             )}
                           </AnimatePresence>
                        </div>
                        
                        {currentUser.monedas < numericWager && (
                          <p className="text-[9px] font-bold text-red-500 uppercase text-center mt-1">Saldo insuficiente</p>
                        )}
                     </div>
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </div>
        <AnimatePresence>
          {showTransferModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[200] flex items-center justify-center bg-gray-900/90 backdrop-blur-md p-8"
            >
              <div className="w-full max-w-sm text-center">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
                  <ArrowRightLeft size={40} />
                </div>
                <h3 className="mb-2 text-xl font-black uppercase text-white tracking-widest">Transferir a {friend.displayName}</h3>
                <p className="mb-8 text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Selecciona el monto y la moneda</p>
                
                <div className="flex flex-col gap-4 mb-8">
                  {/* Currency Toggle */}
                  <div className="flex gap-2 rounded-2xl bg-black/40 p-1 border border-white/5">
                    <button 
                      onClick={() => setTransferCurrency('coins')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${transferCurrency === 'coins' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      <GoldPointIcon size={14} /> Puntos
                    </button>
                    <button 
                      onClick={() => setTransferCurrency('monedas')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${transferCurrency === 'monedas' ? 'bg-yellow-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      <MonedasIcon size={14} /> Monedas
                    </button>
                  </div>

                  {/* Amount Input */}
                  <div className="relative">
                    <input 
                      type="number"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full rounded-2xl bg-black/60 border border-white/10 px-6 py-4 text-2xl font-black text-white text-center italic placeholder:text-gray-800 outline-none focus:border-blue-500/50 transition-all"
                      placeholder="Monto"
                    />
                    <div className="mt-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Tu saldo: <span className="text-white">{(transferCurrency === 'coins' ? currentUser.coins : currentUser.monedas)?.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    disabled={!transferAmount || Number(transferAmount) <= 0 || (transferCurrency === 'coins' ? currentUser.coins : currentUser.monedas) < Number(transferAmount)}
                    onClick={() => {
                        onTransfer?.(Number(transferAmount), transferCurrency);
                        setShowTransferModal(false);
                    }}
                    className="w-full rounded-2xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-500 active:scale-95 disabled:grayscale disabled:opacity-50"
                  >
                    Confirmar Envio
                  </button>
                  <button
                    onClick={() => setShowTransferModal(false)}
                    className="w-full rounded-2xl bg-white/5 py-4 font-black uppercase tracking-widest text-gray-400 transition-all hover:bg-white/10 hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showDeleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[200] flex items-center justify-center bg-gray-900/90 backdrop-blur-md p-8"
            >
              <div className="max-w-xs text-center">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                  <UserMinus size={40} />
                </div>
                <h3 className="mb-2 text-xl font-black uppercase text-white">¿Eliminar Amigo?</h3>
                <p className="mb-8 text-sm font-medium text-gray-400">
                  ¿Estás seguro de que quieres eliminar a <span className="font-bold text-white">{friend.displayName}</span>? 
                  Esta acción es permanente y perderás tu nivel de amistad.
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => {
                      onDeleteFriend?.(friendship.id);
                      setShowDeleteConfirm(false);
                    }}
                    className="w-full rounded-2xl bg-red-600 py-4 font-black uppercase tracking-widest text-white shadow-lg shadow-red-600/30 transition-all hover:bg-red-500"
                  >
                    Sí, eliminar
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="w-full rounded-2xl bg-white/5 py-4 font-black uppercase tracking-widest text-gray-400 transition-all hover:bg-white/10 hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

const ShoppingBag = (props: any) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
);

const UserIcon = (props: any) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
);
