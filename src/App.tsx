import { useEffect, useState } from 'react';
import { StatusBar } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, updateDoc, increment } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { supabase } from './lib/supabase';
import { User } from './types';
import Menu from './components/Menu';
import Arena from './components/Arena';
import TrainingArena from './components/TrainingArena';
import WagerArena from './components/WagerArena';
import { motion, AnimatePresence } from 'motion/react';
import { LogIn, Loader2, ShieldCheck, X, Download, AlertCircle } from 'lucide-react';
import { soundManager } from './lib/sounds';

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'training' | 'wager'>('menu');
  const [wager, setWager] = useState(0);
  const [growthWager, setGrowthWager] = useState(0);
  const [wagerCategory, setWagerCategory] = useState<string>('basica');
  const [botCount, setBotCount] = useState(1);
  const [trainingWager, setTrainingWager] = useState(0);
  const [lastRivalId, setLastRivalId] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [fbReady, setFbReady] = useState(false);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [appConfig, setAppConfig] = useState<any>(null);

  useEffect(() => {
    // Version check
    const checkVersion = async () => {
      try {
        const configSnap = await getDoc(doc(db, 'app_config', 'current'));
        if (configSnap.exists()) {
          const config = configSnap.data();
          setAppConfig(config);
          const minVersion = config.minVersion || '0.0.0';
          if (compareVersions(APP_VERSION, minVersion) < 0) {
            setNeedsUpdate(true);
          }
        }
      } catch (err) {
        console.error('Error checking app version:', err);
      }
    };
    checkVersion();
  }, []);

  useEffect(() => {
    const checkFB = () => {
      // @ts-ignore
      if (window.FB_GAME_READY) {
        setFbReady(true);
        return true;
      }
      return false;
    };

    if (!checkFB()) {
      const handleReady = () => {
        setFbReady(true);
      };
      window.addEventListener('fb-instant-ready', handleReady);
      
      const timeout = setTimeout(() => {
        setFbReady(true);
      }, 5000);

      return () => {
        window.removeEventListener('fb-instant-ready', handleReady);
        clearTimeout(timeout);
      };
    }
  }, []);

  useEffect(() => {
    // Hide status bar for full screen experience
    if (Capacitor.isNativePlatform()) {
      StatusBar.hide().catch(err => console.warn('Could not hide status bar', err));
    }

    // Global error listener for quota errors
    const handleError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const msg = (event instanceof ErrorEvent ? event.message : (event as any).reason?.message || '').toLowerCase();
      if (msg.includes('resource-exhausted') || msg.includes('quota-exceeded')) {
        setQuotaExceeded(true);
      }
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleError);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleError);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        
        // Update presence
        const updatePresence = () => {
          updateDoc(userDocRef, { lastActive: Date.now() })
            .catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + firebaseUser.uid));
        };
        updatePresence();
        const presenceInterval = setInterval(updatePresence, 60000);

        // Listen for real-time updates to user data
        const unsubUser = onSnapshot(userDocRef, async (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data() as User;
            setUser({ id: docSnap.id, email: firebaseUser.email || '', ...userData } as User);
            
            // Sync with Supabase (Firestore is the source of truth)
            await supabase.from('profiles').upsert({
              id: firebaseUser.uid,
              display_name: userData.displayName || 'Player',
              email: firebaseUser.email || '',
              coins: userData.coins || 0,
              monedas: userData.monedas || 0,
              equipped_skin: userData.equippedSkin || 'default',
              high_score: userData.highScore || 0,
              high_score_monedas: userData.highScoreMonedas || 0,
              last_active: new Date(userData.lastActive).toISOString(),
              updated_at: new Date().toISOString()
            });
          } else {
            // Check if we already have a user in state to avoid overwriting with 0s
            // if this is a transient "not found" state or if the user was just created
            setUser(prev => {
              if (prev && prev.id === firebaseUser.uid) {
                console.warn("User document missing in Firestore, but we have it in state. Not recreating to avoid reset.");
                return prev;
              }

              // Create new user if truly doesn't exist
              const newUser: User = {
                id: firebaseUser.uid,
                displayName: firebaseUser.displayName || 'Player',
                email: (firebaseUser.email || '').toLowerCase(),
                coins: 0,
                monedas: 0,
                botKills: 0,
                insomniaCount: 0,
                highScoreMonedas: 0,
                ownedSkins: ['default'],
                equippedSkin: 'default',
                equippedAbilities: [],
                inventoryAbilities: {},
                highScore: 0,
                lastActive: Date.now()
              };
              
              // Only create if we are not in the middle of a deletion
              if (!sessionStorage.getItem('deleting_account')) {
                setDoc(userDocRef, newUser, { merge: true })
                  .catch(e => handleFirestoreError(e, OperationType.CREATE, 'users/' + firebaseUser.uid));
                  
                // Create Supabase profile
                (async () => {
                  try {
                    await supabase.from('profiles').upsert({
                      id: firebaseUser.uid,
                      display_name: newUser.displayName,
                      email: newUser.email.toLowerCase(),
                      coins: newUser.coins,
                      monedas: newUser.monedas,
                      equipped_skin: newUser.equippedSkin,
                      high_score: newUser.highScore,
                      high_score_monedas: newUser.highScoreMonedas,
                      last_active: new Date(newUser.lastActive).toISOString(),
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString()
                    });

                    // Add initial skin to inventory
                    await supabase.from('inventory').upsert({
                      user_id: firebaseUser.uid,
                      skin_id: 'default',
                      acquired_at: new Date().toISOString()
                    });
                  } catch (err) {
                    console.error("Error syncing with Supabase on creation:", err);
                  }
                })();
              }

              return newUser;
            });
          }
          setLoading(false);
        }, (e) => handleFirestoreError(e, OperationType.GET, 'users/' + firebaseUser.uid));

        return () => {
          unsubUser();
          clearInterval(presenceInterval);
        };
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    
    // Si estamos en una plataforma nativa (APK), signInWithPopup no funcionará directamente.
    // Se requiere el uso de @capacitor-community/google-auth para un login real en Android.
    if (Capacitor.isNativePlatform()) {
      console.warn('Ejecutando en plataforma nativa. Asegúrate de configurar el plugin nativo de Google Auth.');
      // Por ahora, intentamos el flujo normal, pero en producción APK se debe usar el SDK Nativo.
    }

    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login error:', error);
      if (Capacitor.isNativePlatform() && error.code === 'auth/operation-not-supported-in-this-environment') {
        alert('El inicio de sesión de Google en Android requiere configuración del plugin nativo Capacitor Google Auth.');
      }
    }
  };

  const handleStartGame = (selectedWager: number) => {
    if (!user) return;
    
    // Deduct wager (don't await to make UI transition instant)
    const userRef = doc(db, 'users', user.id);
    updateDoc(userRef, {
      coins: increment(-selectedWager)
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

    setWager(selectedWager);
    setGameState('playing');
  };

  const handleGameOver = () => {
    setWager(0);
    setBotCount(1);
    setTrainingWager(0);
    setGameState('menu');
  };

  const handleReturnToRival = (rivalId: string) => {
    setWager(0);
    setBotCount(1);
    setTrainingWager(0);
    setLastRivalId(rivalId);
    setGameState('menu');
  };

  const handleStartTraining = (count: number = 1, wager: number = 0) => {
    setBotCount(count);
    setTrainingWager(wager);
    setGameState('training');
  };

  const handleStartWager = async (selectedWager: number, selectedGrowthWager: number, category: string) => {
    if (!user) return;
    
    const userRef = doc(db, 'users', user.id);
    await updateDoc(userRef, {
      monedas: increment(-selectedWager)
    }).catch(e => handleFirestoreError(e, OperationType.UPDATE, 'users/' + user.id));

    // Immediate sync with Supabase to avoid race conditions
    await supabase.from('profiles').update({
      monedas: user.monedas - selectedWager
    }).eq('id', user.id);

    setWager(selectedWager);
    setGrowthWager(selectedGrowthWager);
    setWagerCategory(category);
    setGameState('wager');
  };

  if (needsUpdate) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#05070a] p-8 text-center text-white">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md"
        >
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-3xl bg-red-600/20 text-red-500 shadow-[0_0_30px_rgba(220,38,38,0.2)]">
            <AlertCircle size={48} />
          </div>
          
          <h1 className="mb-4 text-4xl font-black uppercase tracking-tighter italic">Actualización Obligatoria</h1>
          <p className="mb-8 text-gray-400 font-bold uppercase tracking-widest text-[10px]">
            Tu versión actual (<span className="text-white">{APP_VERSION}</span>) ya no es compatible. 
            Por favor descarga la última versión para seguir jugando.
          </p>

          {appConfig?.updateMessage && (
            <div className="mb-8 rounded-2xl bg-white/5 p-4 border border-white/10 italic text-sm text-gray-300">
              "{appConfig.updateMessage}"
            </div>
          )}

          <a
            href={appConfig?.downloadUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 py-5 text-lg font-black uppercase tracking-widest text-white shadow-xl shadow-blue-600/20 transition-all hover:bg-blue-500 hover:scale-105 active:scale-95"
          >
            <Download size={24} />
            Descargar APK v{appConfig?.version || 'Latest'}
          </a>
          
          <p className="mt-8 text-[8px] font-mono text-gray-700 uppercase tracking-[0.4em]">Viborita 1.0.0 - Bonus Arg.</p>
        </motion.div>
      </div>
    );
  }

  if (loading || !fbReady) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#05070a]">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative flex flex-col items-center"
        >
          {/* Neon Logo */}
          <motion.h1 
            animate={{ 
              textShadow: [
                "0 0 10px #2563eb, 0 0 20px #2563eb",
                "0 0 20px #2563eb, 0 0 40px #2563eb",
                "0 0 10px #2563eb, 0 0 20px #2563eb"
              ]
            }}
            transition={{ duration: 2, repeat: Infinity }}
            className="mb-8 text-7xl font-black italic tracking-tighter text-blue-500"
          >
            Viborita
          </motion.h1>

          {/* Loading Animation */}
          <div className="relative h-1 w-64 overflow-hidden rounded-full bg-blue-900/30">
            <motion.div
              initial={{ left: "-100%" }}
              animate={{ left: "100%" }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="absolute h-full w-1/2 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_15px_#60a5fa]"
            />
          </div>
          
          <motion.p
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="mt-4 font-mono text-xs uppercase tracking-[0.3em] text-blue-400/60"
          >
            Cargando Arena...
          </motion.p>
        </motion.div>

        {/* Background Glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/5 blur-[120px]" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#05070a] p-4 text-white">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative text-center"
        >
          {/* Background Glow */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-[100px]" />
          
          <motion.h1 
            animate={{ 
              textShadow: [
                "0 0 10px #2563eb, 0 0 20px #2563eb",
                "0 0 20px #2563eb, 0 0 40px #2563eb",
                "0 0 10px #2563eb, 0 0 20px #2563eb"
              ]
            }}
            transition={{ duration: 3, repeat: Infinity }}
            className="mb-8 text-8xl font-black italic tracking-tighter text-blue-500"
          >
            Viborita
          </motion.h1>
          
          <p className="mb-8 text-xl tracking-wide text-gray-400">
            Apuesta en base a tus habilidades, <span className="text-blue-400">gana dinero</span>
          </p>

          <div className="mb-8 flex flex-col items-center gap-4">
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/5 p-4 transition-all hover:bg-white/10">
              <input 
                type="checkbox" 
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="h-5 w-5 rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-300">
                Acepto las <button onClick={(e) => { e.preventDefault(); setShowTerms(true); }} className="font-bold text-blue-400 underline hover:text-blue-300">Bases y Condiciones</button> del juego
              </span>
            </label>
          </div>
          
          <button
            onClick={handleLogin}
            disabled={!termsAccepted}
            className="group relative flex items-center gap-3 overflow-hidden rounded-full bg-blue-600 px-10 py-5 text-xl font-bold transition-all hover:bg-blue-500 hover:shadow-[0_0_30px_rgba(37,99,235,0.6)] active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:opacity-50 disabled:shadow-none"
          >
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
            <LogIn className="h-6 w-6" /> 
            <span>Iniciar Sesión con Google</span>
          </button>

          <div className="mt-12 flex gap-8 text-xs font-mono uppercase tracking-widest text-gray-600">
            <span className="flex items-center gap-2"><div className="h-1 w-1 rounded-full bg-blue-500" /> Multiplayer</span>
            <span className="flex items-center gap-2"><div className="h-1 w-1 rounded-full bg-blue-500" /> Neon Style</span>
            <span className="flex items-center gap-2"><div className="h-1 w-1 rounded-full bg-blue-500" /> Wager Arena</span>
          </div>
        </motion.div>

        <AnimatePresence>
          {showTerms && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-3xl border border-blue-500/30 bg-gray-900 shadow-2xl"
              >
                <div className="flex items-center justify-between border-b border-white/10 p-6">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="text-blue-400" size={24} />
                    <h2 className="text-xl font-black uppercase tracking-tighter text-white">Bases y Condiciones</h2>
                  </div>
                  <button onClick={() => setShowTerms(false)} className="text-gray-500 hover:text-white">
                    <X size={24} />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 text-sm leading-relaxed text-gray-400 custom-scrollbar">
                  <div className="space-y-6">
                    <section>
                      <h3 className="mb-2 font-black uppercase tracking-widest text-blue-400">1. Aceptación de los Términos</h3>
                      <p>Al acceder y utilizar la aplicación "Viborita", usted acepta estar sujeto a estas Bases y Condiciones. Si no está de acuerdo con alguna parte de estos términos, no podrá utilizar el servicio.</p>
                    </section>

                    <section>
                      <h3 className="mb-2 font-black uppercase tracking-widest text-blue-400">2. Elegibilidad</h3>
                      <p>El usuario declara ser mayor de 18 años. El uso de la plataforma por menores de edad está estrictamente prohibido. Nos reservamos el derecho de solicitar verificación de identidad.</p>
                    </section>

                    <section>
                      <h3 className="mb-2 font-black uppercase tracking-widest text-blue-400">3. Moneda Virtual (Monedas y Puntos)</h3>
                      <p>Las "Monedas" y "Puntos" son activos virtuales dentro del juego. Las Monedas pueden ser adquiridas mediante métodos de pago integrados. Los Puntos se obtienen mediante transferencias manuales o bonificaciones. Estos activos no tienen valor fuera de la plataforma excepto por el sistema de retiros habilitado.</p>
                    </section>

                    <section>
                      <h3 className="mb-2 font-black uppercase tracking-widest text-blue-400">4. Mecánica de Apuestas (Wager Arena)</h3>
                      <p>El usuario reconoce que participar en la "Arena de Apuestas" implica un riesgo de pérdida de sus activos virtuales. El resultado de cada partida depende de la habilidad del jugador. No nos hacemos responsables por pérdidas derivadas de la jugabilidad, desconexiones de red o errores del usuario.</p>
                    </section>

                    <section>
                      <h3 className="mb-2 font-black uppercase tracking-widest text-blue-400">5. Sistema de Retiros</h3>
                      <p>Los retiros de fondos están sujetos a verificación manual. El usuario es responsable de proporcionar un Alias o CBU correcto. No nos responsabilizamos por transferencias enviadas a datos incorrectos proporcionados por el usuario.</p>
                    </section>

                    <section>
                      <h3 className="mb-2 font-black uppercase tracking-widest text-blue-400">6. Conducta del Usuario</h3>
                      <p>Se prohíbe el uso de bots, trampas (cheats) o cualquier software de terceros que altere la jugabilidad. El incumplimiento resultará en la suspensión permanente de la cuenta y la pérdida de activos.</p>
                    </section>

                    <section>
                      <h3 className="mb-2 font-black uppercase tracking-widest text-blue-400">7. Privacidad</h3>
                      <p>Utilizamos Google Sign-In para la autenticación. Solo recolectamos su nombre público y correo electrónico para la gestión de su perfil y seguridad de sus transacciones.</p>
                    </section>

                    <section>
                      <h3 className="mb-2 font-black uppercase tracking-widest text-blue-400">8. Limitación de Responsabilidad</h3>
                      <p>La aplicación se proporciona "tal cual". No garantizamos disponibilidad ininterrumpida y no somos responsables por daños indirectos o fallos técnicos externos.</p>
                    </section>
                  </div>
                </div>

                <div className="border-t border-white/10 p-6">
                  <button 
                    onClick={() => { setTermsAccepted(true); setShowTerms(false); }}
                    className="w-full rounded-2xl bg-blue-600 py-4 font-black uppercase tracking-widest text-white transition-all hover:bg-blue-500"
                  >
                    Aceptar y Continuar
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0e1a]">
      <AnimatePresence>
        {quotaExceeded && (
          <motion.div
            key="quota-notice"
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            className="fixed left-0 right-0 top-0 z-[100] flex items-center justify-center bg-red-600 p-2 text-center text-xs font-bold text-white shadow-lg"
          >
            Límite de cuota de Firestore alcanzado (Free Tier). Algunos cambios podrían no guardarse.
            <button onClick={() => setQuotaExceeded(false)} className="ml-4 rounded bg-white/20 px-2 py-1 hover:bg-white/30">Cerrar</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {gameState === 'menu' ? (
          <motion.div
            key="menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <Menu 
              user={user} 
              onStartGame={handleStartGame} 
              onStartTraining={handleStartTraining}
              onStartWager={handleStartWager}
              initialRivalId={lastRivalId}
              onRivalHandled={() => setLastRivalId(null)}
            />
          </motion.div>
        ) : gameState === 'playing' ? (
          <motion.div
            key="arena"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <Arena user={user} wager={wager} onGameOver={handleGameOver} />
          </motion.div>
        ) : gameState === 'training' ? (
          <motion.div
            key="training"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <TrainingArena user={user} botCount={botCount} initialWager={trainingWager} onGameOver={handleGameOver} />
          </motion.div>
        ) : (
          <motion.div
            key="wager"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <WagerArena 
              user={user} 
              wager={wager} 
              growthWager={growthWager} 
              category={wagerCategory} 
              onGameOver={handleGameOver}
              onReturnToRival={handleReturnToRival}
              onStartWager={handleStartWager}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
