import { useState, useEffect } from 'react';
import { User } from '../types';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, getDocs, doc, updateDoc, increment, where, orderBy, addDoc, serverTimestamp, onSnapshot, limit } from 'firebase/firestore';
import { supabase } from '../lib/supabase';
import { X, Search, ShieldCheck, Coins, Zap, Save, RefreshCw, CreditCard, CheckCircle2, History, Users, Info, CircleAlert, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoldPointIcon, MonedasIcon } from './Icons';

interface AdminPanelProps {
  onClose: () => void;
  adminUser: User;
}

interface WithdrawalRequest {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  amount: number;
  alias: string;
  status: 'pending' | 'completed' | 'rejected';
  timestamp: number;
  transactionId?: string;
}

export default function AdminPanel({ onClose, adminUser }: AdminPanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'users' | 'withdrawals' | 'webhooks' | 'payments' | 'bridge'>('users');
  const [withdrawalFilter, setWithdrawalFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [transactionIds, setTransactionIds] = useState<Record<string, string>>({});
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRequest | null>(null);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [processedPayments, setProcessedPayments] = useState<any[]>([]);
  const [bridgeNotifications, setBridgeNotifications] = useState<any[]>([]);

  useEffect(() => {
    setLoading(true);
    const qUsers = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qUsers, (snapshot) => {
      const fetchedUsersMap = new Map<string, User>();
      snapshot.forEach(doc => {
        fetchedUsersMap.set(doc.id, { id: doc.id, ...doc.data() } as User);
      });
      setUsers(Array.from(fetchedUsersMap.values()));
      setLoading(false);
    }, (e) => {
      handleFirestoreError(e, OperationType.LIST, 'users');
      setLoading(false);
    });

    const qWithdrawals = query(collection(db, 'withdrawals'), orderBy('timestamp', 'desc'));
    const unsubWithdrawals = onSnapshot(qWithdrawals, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ 
        firestoreId: doc.id, 
        id: doc.id,
        ...doc.data() 
      }));
      setWithdrawals(items as any);
    }, (e) => {
      handleFirestoreError(e, OperationType.LIST, 'withdrawals');
    });

    const qWebhooks = query(collection(db, 'webhook_logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubWebhooks = onSnapshot(qWebhooks, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ 
        firestoreId: doc.id, 
        uid: doc.id,
        ...doc.data() 
      }));
      setWebhooks(logs);
    }, (e) => {
      console.error("Error fetching webhooks:", e);
    });

    const qPayments = query(collection(db, 'processed_payments'), orderBy('timestamp', 'desc'), limit(50));
    const unsubPayments = onSnapshot(qPayments, (snapshot) => {
      const payments = snapshot.docs.map(doc => ({ 
        firestoreId: doc.id, 
        uid: doc.id,
        ...doc.data() 
      }));
      setProcessedPayments(payments);
    }, (e) => {
      console.error("Error fetching processed payments:", e);
    });

    const qBridge = query(collection(db, 'payment_notifications'), orderBy('received_at', 'desc'), limit(50));
    const unsubBridge = onSnapshot(qBridge, (snapshot) => {
      const notes = snapshot.docs.map(doc => ({ 
        firestoreId: doc.id, 
        ...doc.data() 
      }));
      setBridgeNotifications(notes);
    }, (e) => {
      console.error("Error fetching bridge notifications:", e);
    });

    return () => {
      unsubUsers();
      unsubWithdrawals();
      unsubWebhooks();
      unsubPayments();
      unsubBridge();
    };
  }, []);

  const handleUpdate = async (userId: string, field: 'coins' | 'monedas', amount: number) => {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        [field]: increment(amount)
      });

      // If updating monedas, also sync with Supabase
      const user = users.find(u => u.id === userId);
      if (user) {
        const newValue = (field === 'coins' ? user.coins : user.monedas) + amount;
        const supabaseField = field === 'coins' ? 'coins' : 'monedas';
        
        await supabase.from('profiles').update({ 
          [supabaseField]: newValue,
          ...(field === 'monedas' ? { high_score_monedas: Math.max(user.highScoreMonedas, newValue) } : {})
        }).eq('id', userId);

        // Record transaction
        await supabase.from('transactions').insert({
          user_id: userId,
          type: amount > 0 ? 'reward' : 'spent',
          currency: field,
          amount: Math.abs(amount),
          reason: 'admin_update',
          timestamp: new Date().toISOString()
        });
      }

      setMessage({ text: `Se sumaron ${amount} ${field} correctamente`, type: 'success' });
    } catch (e) {
      setMessage({ text: 'Error al actualizar', type: 'error' });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}`);
    }
    setTimeout(() => setMessage(null), 3000);
  };

  const handleCompleteWithdrawal = async (withdrawal: WithdrawalRequest) => {
    const txId = transactionIds[withdrawal.id];
    if (!txId?.trim()) {
      setMessage({ text: 'Debes ingresar el número de transferencia', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const withdrawalRef = doc(db, 'withdrawals', withdrawal.id);
      await updateDoc(withdrawalRef, {
        status: 'completed',
        transactionId: txId.trim(),
        completedAt: Date.now()
      });

      // Sync with Supabase
      await supabase.from('withdrawals').update({
        status: 'completed',
        transaction_id: txId.trim(),
        completed_at: new Date().toISOString()
      }).eq('id_firestore', withdrawal.id); // We'll need to store firestore ID in supabase too or use a common ID

      setMessage({ text: 'Transferencia certificada correctamente', type: 'success' });
    } catch (e) {
      setMessage({ text: 'Error al procesar retiro', type: 'error' });
      handleFirestoreError(e, OperationType.UPDATE, `withdrawals/${withdrawal.id}`);
    } finally {
      setLoading(false);
    }
    setTimeout(() => setMessage(null), 3000);
  };

  const filteredUsers = users.filter(u => 
    u.displayName.toLowerCase().includes(search.toLowerCase()) || 
    (u.email && u.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex h-[80vh] w-full max-w-4xl flex-col rounded-3xl border border-red-500/30 bg-gray-900 shadow-2xl shadow-red-500/10"
      >
        <div className="flex items-center justify-between border-b border-white/10 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-red-500/20 p-2">
              <ShieldCheck className="text-red-500" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black italic tracking-tighter text-white uppercase">Panel de Control Maestro</h2>
              <p className="text-xs font-bold text-red-500/70 uppercase tracking-widest">Acceso Restringido: Administrador</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full bg-gray-800 p-2 text-gray-400 hover:bg-gray-700 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-6">
          <div className="mb-6 flex gap-4">
            <div className="flex rounded-2xl bg-gray-800 p-1">
              <button 
                onClick={() => setActiveTab('users')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${activeTab === 'users' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <Users size={18} /> Usuarios
              </button>
              <button 
                onClick={() => setActiveTab('withdrawals')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${activeTab === 'withdrawals' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <CreditCard size={18} /> Retiros
              </button>
              <button 
                onClick={() => setActiveTab('webhooks')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${activeTab === 'webhooks' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <History size={18} /> Webhooks
              </button>
              <button 
                onClick={() => setActiveTab('payments')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${activeTab === 'payments' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <CreditCard size={18} /> Pagos
              </button>
              <button 
                onClick={() => setActiveTab('bridge')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${activeTab === 'bridge' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <RefreshCw size={18} /> Puente
              </button>
            </div>

            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
              <input 
                type="text"
                placeholder={activeTab === 'users' ? "Buscar por nombre o email..." : "Buscar solicitudes..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-2xl bg-gray-800 py-4 pl-12 pr-4 font-bold text-white outline-none focus:ring-2 focus:ring-red-500/50"
              />
            </div>
            <button 
              onClick={() => {}}
              disabled={loading}
              className="rounded-2xl bg-gray-800 px-6 hover:bg-gray-700 disabled:opacity-50"
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} size={20} />
            </button>
          </div>

          <AnimatePresence>
            {message && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`mb-4 rounded-xl p-4 text-center font-bold ${message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
              >
                {message.text}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="h-full overflow-y-auto pr-2 custom-scrollbar">
            {activeTab === 'users' ? (
              <div className="space-y-2">
                {filteredUsers.map((u, idx) => (
                  <div key={`admin-u-${u.id}-${idx}`} className="flex items-center gap-4 rounded-xl bg-gray-800/40 p-3 border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-white truncate">{u.displayName}</h3>
                        {Date.now() - u.lastActive < 120000 && (
                          <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" title="Online" />
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 truncate">{u.email || 'Sin email'}</p>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Puntos Section */}
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-end mr-1">
                          <div className="flex items-center gap-1">
                            <GoldPointIcon size={12} />
                            <span className="text-xs font-black text-white">{u.coins}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 rounded-lg bg-black/30 p-1">
                          <input 
                            type="number"
                            placeholder="±"
                            value={customAmounts[u.id] || ''}
                            onChange={(e) => setCustomAmounts(prev => ({ ...prev, [u.id]: e.target.value }))}
                            className="w-12 rounded bg-gray-900 px-1 py-0.5 text-[10px] font-bold text-white outline-none focus:ring-1 focus:ring-yellow-500"
                          />
                          <button 
                            onClick={() => {
                              const val = parseInt(customAmounts[u.id]);
                              if (!isNaN(val)) handleUpdate(u.id, 'coins', val);
                            }}
                            className="rounded bg-yellow-600/20 px-2 py-0.5 text-[10px] font-black text-yellow-500 hover:bg-yellow-600/40 transition-colors"
                          >
                            OK
                          </button>
                        </div>
                      </div>

                      {/* Monedas Section */}
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-end mr-1">
                          <div className="flex items-center gap-1">
                            <MonedasIcon size={12} />
                            <span className="text-xs font-black text-white">{u.monedas}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 rounded-lg bg-black/30 p-1">
                          <input 
                            type="number"
                            placeholder="±"
                            value={customAmounts[u.id] || ''}
                            onChange={(e) => setCustomAmounts(prev => ({ ...prev, [u.id]: e.target.value }))}
                            className="w-12 rounded bg-gray-900 px-1 py-0.5 text-[10px] font-bold text-white outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <button 
                            onClick={() => {
                              const val = parseInt(customAmounts[u.id]);
                              if (!isNaN(val)) handleUpdate(u.id, 'monedas', val);
                            }}
                            className="rounded bg-blue-600/20 px-2 py-0.5 text-[10px] font-black text-blue-400 hover:bg-blue-600/40 transition-colors"
                          >
                            OK
                          </button>
                        </div>
                      </div>

                      {/* Withdrawal Info Button */}
                      {withdrawals.some(w => w.userId === u.id && w.status === 'pending') && (
                        <button 
                          onClick={() => {
                            const w = withdrawals.find(w => w.userId === u.id && w.status === 'pending');
                            if (w) setSelectedWithdrawal(w);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/40 transition-all"
                          title="Ver Solicitud de Retiro"
                        >
                          <CircleAlert size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeTab === 'withdrawals' ? (
              <div className="space-y-3">
                <div className="flex gap-2 mb-4">
                  {(['all', 'pending', 'completed'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setWithdrawalFilter(f)}
                      className={`rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                        withdrawalFilter === f 
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                          : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      {f === 'all' ? 'Todos' : f === 'pending' ? 'Pendientes' : 'Completados'}
                    </button>
                  ))}
                </div>

                {withdrawals.filter(w => {
                  const matchesSearch = w.displayName.toLowerCase().includes(search.toLowerCase()) || 
                    w.email.toLowerCase().includes(search.toLowerCase()) ||
                    w.alias.toLowerCase().includes(search.toLowerCase());
                  const matchesFilter = withdrawalFilter === 'all' || w.status === withdrawalFilter;
                  return matchesSearch && matchesFilter;
                }).map((w: any, idx) => (
                  <div key={`admin-withdraw-${w.id || w.firestoreId || idx}-${idx}`} className={`rounded-2xl border p-4 transition-all ${w.status === 'pending' ? 'border-blue-500/30 bg-blue-500/5' : 'border-white/5 bg-gray-800/40'}`}>
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-black text-white">{w.displayName}</h3>
                          {users.find(u => u.id === w.userId) && Date.now() - (users.find(u => u.id === w.userId)?.lastActive || 0) < 120000 && (
                            <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" title="Online" />
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{w.email}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${w.status === 'pending' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                            {w.status === 'pending' ? 'Pendiente' : 'Completado'}
                          </span>
                          <span className="text-[10px] text-gray-600">{new Date(w.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-2 text-2xl font-black text-white">
                          {w.amount} <MonedasIcon size={20} />
                        </div>
                        <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Monto a Transferir</p>
                      </div>
                    </div>

                    <div className="rounded-xl bg-black/30 p-3 mb-4">
                      <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Alias / CBU de Destino</p>
                      <p className="font-mono text-sm font-bold text-white break-all">{w.alias}</p>
                    </div>

                    {w.status === 'pending' ? (
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          placeholder="N° de Transferencia / Comprobante"
                          value={transactionIds[w.id] || ''}
                          onChange={(e) => setTransactionIds(prev => ({ ...prev, [w.id]: e.target.value }))}
                          className="flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-green-500/50"
                        />
                        <button 
                          onClick={() => handleCompleteWithdrawal(w)}
                          className="flex items-center gap-2 rounded-xl bg-green-600 px-6 font-black text-white hover:bg-green-500 transition-all shadow-lg shadow-green-500/20"
                        >
                          <CheckCircle2 size={20} /> CERTIFICAR
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-xl bg-green-500/10 p-3 text-green-400">
                        <CheckCircle2 size={18} />
                        <div className="text-xs">
                          <span className="font-bold">Transferencia Ejecutada:</span>
                          <span className="ml-2 font-mono">{w.transactionId}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {withdrawals.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                    <History size={48} className="mb-4 opacity-20" />
                    <p className="font-bold">No hay solicitudes de retiro</p>
                  </div>
                )}
              </div>
            ) : activeTab === 'payments' ? (
              <div className="space-y-3 overflow-y-auto max-h-[50vh] pr-2 custom-scrollbar">
                <div className="mb-4 rounded-xl bg-green-500/10 p-4 border border-green-500/20">
                  <p className="text-xs text-green-300">
                    Pagos procesados y acreditados exitosamente a través del Webhook.
                  </p>
                </div>
                {processedPayments.map((p, idx) => (
                  <div key={`admin-paid-${p.firestoreId || p.id || idx}-${idx}`} className="rounded-2xl border border-white/5 bg-gray-800/40 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-green-400">
                          Acreditado
                        </span>
                        <span className="text-[10px] font-bold text-gray-500 uppercase">{p.purchaseType || 'monedas'}</span>
                      </div>
                      <span className="text-[10px] text-gray-500">{p.timestamp ? new Date(p.timestamp.seconds * 1000).toLocaleString() : 'Reciente'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-black text-white">Usuario: {users.find(u => u.id === p.userId)?.displayName || p.userId}</p>
                        <p className="text-[10px] font-mono text-gray-500">ID Pago: {p.id}</p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-lg font-black text-white">
                          +{p.amount} {p.purchaseType === 'points' ? <GoldPointIcon size={16} /> : <MonedasIcon size={16} />}
                        </div>
                        {p.pointsAdded > 0 && p.purchaseType !== 'points' && (
                          <p className="text-[10px] font-bold text-yellow-500">+{p.pointsAdded} Puntos (Bono)</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {processedPayments.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                    <CreditCard size={48} className="mb-4 opacity-20" />
                    <p className="font-bold uppercase tracking-widest">No hay pagos procesados</p>
                  </div>
                )}
              </div>
            ) : activeTab === 'bridge' ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-yellow-500/10 p-4 border border-yellow-500/20 mb-4">
                  <p className="text-[10px] text-yellow-500 leading-relaxed font-bold uppercase tracking-widest">
                    ⚠️ Estas notificaciones provienen del puente en Google Cloud Run. Si ves una con 'Procesado: SI', el servidor del juego ya la validó.
                  </p>
                </div>
                {bridgeNotifications.map((n, idx) => (
                  <div key={`admin-bridge-${n.firestoreId || idx}-${idx}`} className="rounded-2xl border border-white/5 bg-gray-800/40 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${n.processed ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">BRIDGE ID: {n.payment_id}</span>
                      </div>
                      <span className="text-[10px] text-gray-500">{(n.received_at as any)?.toDate?.().toLocaleString() || 'Ahora'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-left">
                        <p className="text-[10px] text-gray-500 uppercase tracking-tighter">Procesado</p>
                        <p className={`text-xs font-black ${n.processed ? 'text-green-400' : 'text-yellow-500'}`}>
                          {n.processed ? 'SI' : 'PENDIENTE'}
                        </p>
                      </div>
                      {n.error && (
                        <div className="text-right">
                          <p className="text-[10px] text-red-500 uppercase tracking-tighter">Error</p>
                          <p className="text-[10px] text-red-400 italic max-w-[150px] truncate">{n.error}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {bridgeNotifications.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                    <RefreshCw size={48} className="mb-4 opacity-20" />
                    <p className="font-bold uppercase tracking-widest">No hay notificaciones del puente</p>
                    <p className="text-xs">Usa el simulador de Mercado Pago para probar.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto max-h-[50vh] pr-2 custom-scrollbar">
                <div className="mb-4 rounded-xl bg-blue-500/10 p-4 border border-blue-500/20">
                  <p className="text-xs text-blue-300">
                    Aquí se muestran los últimos 50 eventos de Mercado Pago. Útil para verificar si las notificaciones están llegando al servidor.
                  </p>
                </div>
                {webhooks.map((w, idx) => (
                  <div key={`admin-hook-${w.firestoreId || idx}-${idx}`} className="rounded-2xl border border-white/5 bg-gray-800/40 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${w.topic === 'payment' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                        {w.topic || 'Desconocido'}
                      </span>
                      <span className="text-[10px] text-gray-500">{w.timestamp ? new Date(w.timestamp.seconds * 1000).toLocaleString() : 'Reciente'}</span>
                    </div>
                    <p className="text-[10px] font-mono text-gray-500 mb-2">ID: {w.id}</p>
                    <div className="rounded-lg bg-black/30 p-3 text-[10px] font-mono text-gray-400 overflow-x-auto">
                      <pre>{JSON.stringify(w.body || w.query, null, 2)}</pre>
                    </div>
                  </div>
                ))}
                {webhooks.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                    <History size={48} className="mb-4 opacity-20" />
                    <p className="font-bold uppercase tracking-widest">No hay webhooks registrados</p>
                    <p className="text-xs">Los pagos aparecerán aquí cuando Mercado Pago envíe la notificación.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Withdrawal Detail Modal */}
        <AnimatePresence>
          {selectedWithdrawal && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-md rounded-3xl border border-blue-500/30 bg-gray-900 p-6 shadow-2xl"
              >
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-blue-400">
                    <CircleAlert size={20} />
                    <h3 className="text-lg font-black uppercase tracking-tighter">Detalles de Retiro</h3>
                  </div>
                  <button onClick={() => setSelectedWithdrawal(null)} className="text-gray-500 hover:text-white">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Usuario</p>
                    <p className="text-sm font-black text-white">{selectedWithdrawal.displayName}</p>
                    <p className="text-xs text-gray-400">{selectedWithdrawal.email}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                      <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Monto</p>
                      <div className="flex items-center gap-2 text-xl font-black text-white">
                        {selectedWithdrawal.amount} <MonedasIcon size={16} />
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                      <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Fecha</p>
                      <p className="text-xs font-bold text-white">{new Date(selectedWithdrawal.timestamp).toLocaleDateString()}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-blue-500/10 p-4 border border-blue-500/20">
                    <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Alias / CBU de Destino</p>
                    <p className="font-mono text-sm font-bold text-white break-all">{selectedWithdrawal.alias}</p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-gray-500 uppercase ml-1">Número de Transferencia</p>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        placeholder="Ej: MP-123456789"
                        value={transactionIds[selectedWithdrawal.id] || ''}
                        onChange={(e) => setTransactionIds(prev => ({ ...prev, [selectedWithdrawal.id]: e.target.value }))}
                        className="flex-1 rounded-xl bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                      <button 
                        onClick={async () => {
                          await handleCompleteWithdrawal(selectedWithdrawal);
                          setSelectedWithdrawal(null);
                        }}
                        className="rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-500 transition-all"
                      >
                        <Save size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
