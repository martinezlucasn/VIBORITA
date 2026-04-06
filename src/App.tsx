import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, updateDoc, increment } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { User } from './types';
import Menu from './components/Menu';
import Arena from './components/Arena';
import TrainingArena from './components/TrainingArena';
import { motion, AnimatePresence } from 'motion/react';
import { LogIn, Loader2 } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'training'>('menu');
  const [wager, setWager] = useState(0);
  const [botCount, setBotCount] = useState(1);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  useEffect(() => {
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
        const unsubUser = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            setUser({ id: docSnap.id, ...docSnap.data() } as User);
          } else {
            // Create new user if doesn't exist
            const newUser: User = {
              id: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'Player',
              coins: 100,
              ownedSkins: ['default'],
              equippedSkin: 'default',
              highScore: 0,
              lastActive: Date.now()
            };
            setDoc(userDocRef, newUser)
              .catch(e => handleFirestoreError(e, OperationType.CREATE, 'users/' + firebaseUser.uid));
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

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0e1a]">
        <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#0a0e1a] p-4 text-white">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h1 className="mb-8 text-6xl font-black italic tracking-tighter text-blue-500">Viborita</h1>
          <p className="mb-8 text-xl text-gray-400">Apuesta en base a tus habilidades, gana dinero</p>
          <button
            onClick={handleLogin}
            className="flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-xl font-bold transition-all hover:bg-blue-500 hover:shadow-[0_0_20px_rgba(37,99,235,0.5)]"
          >
            <LogIn /> Iniciar Sesión con Google
          </button>
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
            <Menu user={user} onStartGame={handleStartGame} onStartTraining={handleStartTraining} />
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
        ) : (
          <motion.div
            key="training"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <TrainingArena user={user} botCount={botCount} onGameOver={handleGameOver} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
