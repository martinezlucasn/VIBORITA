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
import { LogIn, Loader2 } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'training' | 'wager'>('menu');
  const [wager, setWager] = useState(0);
  const [growthWager, setGrowthWager] = useState(0);
  const [wagerCategory, setWagerCategory] = useState<string>('basica');
  const [botCount, setBotCount] = useState(1);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

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
                email: firebaseUser.email || '',
                coins: 0,
                monedas: 0,
                ownedSkins: ['default'],
                equippedSkin: 'default',
                highScore: 0,
                highScoreMonedas: 0,
                lastActive: Date.now()
              };
              
              setDoc(userDocRef, newUser)
                .catch(e => handleFirestoreError(e, OperationType.CREATE, 'users/' + firebaseUser.uid));
                
              // Create Supabase profile
              (async () => {
                try {
                  await supabase.from('profiles').upsert({
                    id: firebaseUser.uid,
                    display_name: newUser.displayName,
                    email: newUser.email,
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
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
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
    setGameState('menu');
  };

  const handleStartTraining = (count: number = 1) => {
    setBotCount(count);
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

  if (loading) {
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
          
          <p className="mb-12 text-xl tracking-wide text-gray-400">
            Apuesta en base a tus habilidades, <span className="text-blue-400">gana dinero</span>
          </p>
          
          <button
            onClick={handleLogin}
            className="group relative flex items-center gap-3 overflow-hidden rounded-full bg-blue-600 px-10 py-5 text-xl font-bold transition-all hover:bg-blue-500 hover:shadow-[0_0_30px_rgba(37,99,235,0.6)] active:scale-95"
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
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0e1a]">
      <AnimatePresence>
        {quotaExceeded && (
          <motion.div
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
            <TrainingArena user={user} botCount={botCount} onGameOver={handleGameOver} />
          </motion.div>
        ) : (
          <motion.div
            key="wager"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <WagerArena user={user} wager={wager} growthWager={growthWager} category={wagerCategory} onGameOver={handleGameOver} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
