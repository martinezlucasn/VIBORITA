import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from '../../types';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { doc, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { X, Palette, ShieldCheck, Sparkles, Check, Lock, Smile, RefreshCw } from 'lucide-react';
import { MonedasIcon, GoldPointIcon } from '../Icons';

interface ProfileCustomizationProps {
  user: User;
  onClose: () => void;
  onUpdate: () => void;
}

const THEMES = [
  { id: 'neon_blue', name: 'Neón Azul', css: 'linear-gradient(to bottom right, #2563eb, #1e3a8a)', price: 1000, currency: 'coins' },
  { id: 'cyber_purple', name: 'Cyber Púrpura', css: 'linear-gradient(to bottom right, #9333ea, #581c87)', price: 2500, currency: 'coins' },
  { id: 'emerald_haze', name: 'Esmeralda', css: 'linear-gradient(to bottom right, #059669, #064e3b)', price: 500, currency: 'monedas' },
  { id: 'volcano', name: 'Volcán', css: 'linear-gradient(to bottom right, #dc2626, #7f1d1d)', price: 1000, currency: 'monedas' },
  { id: 'royal_gold', name: 'Oro Real', css: 'linear-gradient(to bottom right, #eab308, #854d0e)', price: 5000, currency: 'monedas' },
  { id: 'abstract_dark', name: 'Vacío', css: 'linear-gradient(to bottom right, #111827, #000000)', price: 2000, currency: 'coins' },
];

const BORDERS = [
  { id: 'border_simple', name: 'Borde Simple', style: 'border-white/30', price: 0, currency: 'coins' },
  { id: 'border_neon', name: 'Brillo Neón', style: 'border-blue-500 shadow-[0_0_15px_#3b82f6]', price: 3000, currency: 'coins' },
  { id: 'border_gold', name: 'Aura Dorada', style: 'border-yellow-500 shadow-[0_0_15px_#eab308]', price: 1500, currency: 'monedas' },
  { id: 'border_pulsing', name: 'Pulso Rojo', style: 'border-red-500 animate-pulse shadow-[0_0_20px_#ef4444]', price: 2500, currency: 'monedas' },
];

const AVATAR_STYLES = [
  { id: 'adventurer', name: 'Aventurero' },
  { id: 'pixel-art', name: 'Pixel Art' },
  { id: 'bottts', name: 'Robots' },
  { id: 'avataaars', name: 'Avatar' },
  { id: 'big-ears', name: 'Orejones' },
  { id: 'croodles', name: 'Garabatos' },
  { id: 'miniavs', name: 'Minis' },
  { id: 'open-peeps', name: 'Personas' },
];

export default function ProfileCustomization({ user, onClose, onUpdate }: ProfileCustomizationProps) {
  const [activeTab, setActiveTab] = useState<'themes' | 'borders' | 'bio' | 'avatar'>('avatar');
  const [tempBio, setTempBio] = useState(user.bio || '');
  const [avatarStyle, setAvatarStyle] = useState(user.avatarConfig?.style || 'adventurer');
  const [avatarSeed, setAvatarSeed] = useState(user.avatarConfig?.seed || user.displayName);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  const handleBuyItem = async (item: any, type: 'theme' | 'border') => {
    const isTheme = type === 'theme';
    const unlockedList = isTheme ? (user.unlockedThemes || []) : (user.unlockedBorders || []);
    
    if (unlockedList.includes(item.id)) {
      // Already owned, just equip
      try {
        const userRef = doc(db, 'users', user.id);
        await updateDoc(userRef, {
          [isTheme ? 'profileTheme' : 'profileBorder']: isTheme ? item.css : item.style
        });
        onUpdate();
        setMessage({ text: '¡Equipado correctamente!', type: 'success' });
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id);
      }
      return;
    }

    // Need to buy
    const balance = item.currency === 'coins' ? user.coins : user.monedas;
    if (balance < item.price) {
      setMessage({ text: 'No tienes suficiente saldo', type: 'error' });
      return;
    }

    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        [item.currency]: increment(-item.price),
        [isTheme ? 'unlockedThemes' : 'unlockedBorders']: arrayUnion(item.id),
        [isTheme ? 'profileTheme' : 'profileBorder']: isTheme ? item.css : item.style
      });
      onUpdate();
      setMessage({ text: `¡Has desbloqueado ${item.name}!`, type: 'success' });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id);
    }
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSaveBio = async () => {
    setIsSaving(true);
    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, { bio: tempBio });
      onUpdate();
      setMessage({ text: 'Biografía actualizada', type: 'success' });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id);
    } finally {
      setIsSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4 backdrop-blur-xl">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-xl rounded-[3rem] border border-white/10 bg-gray-900 overflow-hidden shadow-2xl"
      >
        <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 p-8 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-blue-600/20 p-3">
              <Palette className="text-blue-400" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black italic tracking-tighter text-white uppercase leading-none">Personalizar Perfil</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mt-1">Destaca entre la multitud</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X size={28} />
          </button>
        </div>

        <div className="p-8">
          {/* Tabs */}
          <div className="mb-8 flex gap-4 border-b border-white/5">
            {[
              { id: 'avatar', label: 'Avatar' },
              { id: 'themes', label: 'Temas' },
              { id: 'borders', label: 'Bordes' },
              { id: 'bio', label: 'Biografía' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`pb-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all border-b-2 ${
                  activeTab === tab.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            <AnimatePresence mode="wait">
              {activeTab === 'avatar' && (
                <motion.div
                  key="avatar-config"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <div className="flex flex-col items-center justify-center p-6 bg-white/5 rounded-[2rem] border border-white/10 relative overflow-hidden">
                    <div className="absolute inset-0 bg-blue-500/5" />
                    <img 
                      src={`https://api.dicebear.com/7.x/${avatarStyle}/svg?seed=${avatarSeed}`}
                      alt="Preview"
                      className="h-32 w-32 rounded-3xl bg-blue-500/20 shadow-2xl relative z-10"
                    />
                    <button 
                      onClick={() => setAvatarSeed(Math.random().toString(36).substring(7))}
                      className="absolute top-4 right-4 p-2 rounded-xl bg-black/40 text-blue-400 hover:text-white transition-colors"
                    >
                      <RefreshCw size={18} />
                    </button>
                    <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 relative z-10">Vista Previa</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                       <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest px-2 mb-2 block">Nombre Semilla (Seed)</label>
                       <input 
                         type="text"
                         value={avatarSeed}
                         onChange={(e) => setAvatarSeed(e.target.value)}
                         className="w-full rounded-xl bg-black/40 px-4 py-3 text-sm font-bold text-white outline-none border border-white/5 focus:border-blue-500"
                         placeholder="Ingresa cualquier texto..."
                       />
                    </div>
                    {AVATAR_STYLES.map(style => (
                      <button
                        key={style.id}
                        onClick={() => setAvatarStyle(style.id)}
                        className={`flex items-center gap-3 rounded-2xl p-3 border transition-all ${
                          avatarStyle === style.id ? 'bg-blue-600 border-blue-400 text-white' : 'bg-white/5 border-white/5 text-gray-400 hover:border-white/20'
                        }`}
                      >
                        <img 
                          src={`https://api.dicebear.com/7.x/${style.id}/svg?seed=preview`}
                          className="h-8 w-8 rounded-lg bg-black/20"
                          alt={style.name}
                        />
                        <span className="text-[10px] font-black uppercase tracking-wider">{style.name}</span>
                      </button>
                    ))}
                  </div>

                  <button 
                    onClick={async () => {
                      setIsSaving(true);
                      try {
                        const userRef = doc(db, 'users', user.id);
                        await updateDoc(userRef, {
                          avatarConfig: { style: avatarStyle, seed: avatarSeed }
                        });
                        onUpdate();
                        setMessage({ text: 'Avatar guardado', type: 'success' });
                      } catch (e) {
                        handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id);
                      } finally {
                        setIsSaving(false);
                        setTimeout(() => setMessage(null), 3000);
                      }
                    }}
                    disabled={isSaving}
                    className="w-full rounded-2xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white shadow-xl shadow-blue-600/30 hover:bg-blue-500 transition-all disabled:opacity-50"
                  >
                    {isSaving ? 'Guardando...' : 'Aplicar Avatar'}
                  </button>
                </motion.div>
              )}

              {activeTab === 'themes' && (
                <motion.div
                  key="themes-grid"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid grid-cols-2 gap-4"
                >
                  {THEMES.map(theme => {
                    const isUnlocked = user.unlockedThemes?.includes(theme.id);
                    const isEquipped = user.profileTheme === theme.css;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => handleBuyItem(theme, 'theme')}
                        className={`group relative overflow-hidden rounded-[2rem] border p-4 text-left transition-all ${
                          isEquipped ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="absolute inset-0 opacity-40 group-hover:opacity-60 transition-opacity" style={{ background: theme.css }} />
                        <div className="relative z-10 flex flex-col items-center gap-2 py-4">
                          <span className="text-[10px] font-black uppercase tracking-widest text-white">{theme.name}</span>
                          <div className="mt-2 flex items-center gap-2">
                            {isEquipped ? (
                              <div className="flex items-center gap-1 text-[9px] font-black text-blue-400 uppercase">
                                <Check size={12} /> Equipado
                              </div>
                            ) : isUnlocked ? (
                              <div className="text-[9px] font-black text-gray-400 uppercase">Equipar</div>
                            ) : (
                              <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 border border-white/10">
                                {theme.currency === 'coins' ? <GoldPointIcon size={12} /> : <MonedasIcon size={12} />}
                                <span className="text-xs font-black text-white">{theme.price.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </motion.div>
              )}

              {activeTab === 'borders' && (
                <motion.div
                  key="borders-grid"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid grid-cols-2 gap-4"
                >
                  {BORDERS.map(border => {
                    const isUnlocked = user.unlockedBorders?.includes(border.id) || border.price === 0;
                    const isEquipped = user.profileBorder === border.style || (!user.profileBorder && border.id === 'border_simple');
                    return (
                      <button
                        key={border.id}
                        onClick={() => handleBuyItem(border, 'border')}
                        className={`group relative flex flex-col items-center justify-center rounded-[2rem] border p-6 text-center transition-all ${
                          isEquipped ? 'border-blue-500 bg-blue-600/5' : 'border-white/5 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className={`mb-4 h-16 w-16 rounded-2xl bg-gray-800 border-4 flex items-center justify-center text-gray-600 text-2xl font-black ${border.style}`}>
                          {user.displayName[0].toUpperCase()}
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">{border.name}</span>
                        <div className="mt-4">
                            {isEquipped ? (
                              <span className="text-[9px] font-black text-blue-400 uppercase">Seleccionado</span>
                            ) : isUnlocked ? (
                              <span className="text-[9px] font-black text-gray-400 uppercase">Equipar</span>
                            ) : (
                              <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 border border-white/10">
                                {border.currency === 'coins' ? <GoldPointIcon size={12} /> : <MonedasIcon size={12} />}
                                <span className="text-xs font-black text-white">{border.price.toLocaleString()}</span>
                              </div>
                            )}
                        </div>
                      </button>
                    );
                  })}
                </motion.div>
              )}

              {activeTab === 'bio' && (
                <motion.div
                  key="bio-form"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-6"
                >
                  <div className="rounded-[2rem] bg-white/5 p-6 border border-white/10">
                    <label className="mb-4 block text-[10px] font-bold uppercase tracking-widest text-gray-500">¿Qué quieres decirle al mundo?</label>
                    <textarea 
                      value={tempBio}
                      onChange={(e) => setTempBio(e.target.value.slice(0, 150))}
                      rows={4}
                      className="w-full rounded-2xl bg-black/40 p-4 text-sm font-bold text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-blue-500"
                      placeholder="Escribe algo sobre ti..."
                    />
                    <div className="mt-2 text-right">
                        <span className="text-[10px] font-black text-gray-600">{tempBio.length}/150</span>
                    </div>
                  </div>
                  <button 
                    onClick={handleSaveBio}
                    disabled={isSaving}
                    className="w-full rounded-2xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white shadow-xl shadow-blue-600/30 hover:bg-blue-500 transition-all disabled:opacity-50"
                  >
                    {isSaving ? 'Guardando...' : 'Guardar Biografía'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {message && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={`mt-6 rounded-xl p-3 text-center text-[10px] font-black uppercase tracking-widest ${
                    message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {message.text}
                </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
