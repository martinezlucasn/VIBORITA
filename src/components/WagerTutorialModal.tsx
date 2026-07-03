import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Coins, Sparkles, Award, Zap, Users, Trophy, Skull, Play, Check, X, ArrowRight, MousePointer, ShieldCheck, HelpCircle } from 'lucide-react';
import { soundManager } from '../lib/sounds';

interface WagerTutorialModalProps {
  onClose: () => void;
}

export default function WagerTutorialModal({ onClose }: WagerTutorialModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 5;

  // Sound manager shorthand
  const playSound = (sound: 'food' | 'goldFood' | 'death' | 'boost' | 'collect' | 'powerup' | 'plim' | 'star') => {
    try {
      soundManager.play(sound);
    } catch (e) {
      console.warn('Sound play deferred:', e);
    }
  };

  // --- Step 1: Coins and Betting State ---
  const [coinsCollected, setCoinsCollected] = useState<number[]>([]);
  const coinsToCollect = [1, 2, 3];
  const handleCollectCoin = (id: number) => {
    if (!coinsCollected.includes(id)) {
      setCoinsCollected((prev) => [...prev, id]);
      playSound('goldFood');
    }
  };

  // --- Step 2: Initial Length Slider State ---
  const [selectedWagerLevel, setSelectedWagerLevel] = useState<'basica' | 'pro' | 'millonario'>('basica');
  const getSegmentCount = () => {
    if (selectedWagerLevel === 'basica') return 12;
    if (selectedWagerLevel === 'pro') return 24;
    return 48; // millonario
  };

  // --- Step 3: Combat / Trap Simulation State ---
  const [rivalStatus, setRivalStatus] = useState<'alive' | 'colliding' | 'exploded' | 'collected'>('alive');
  const [collectedSimulationCoins, setCollectedSimulationCoins] = useState<number[]>([]);
  const simCoins = [1, 2, 3, 4, 5];

  const handleTrapRival = () => {
    if (rivalStatus !== 'alive') return;
    setRivalStatus('colliding');
    playSound('boost');
    
    setTimeout(() => {
      setRivalStatus('exploded');
      playSound('death');
      playSound('star');
    }, 1000);
  };

  const handleCollectSimCoin = (id: number) => {
    if (!collectedSimulationCoins.includes(id)) {
      setCollectedSimulationCoins((prev) => [...prev, id]);
      playSound('collect');
    }
  };

  useEffect(() => {
    if (rivalStatus === 'exploded' && collectedSimulationCoins.length === simCoins.length) {
      setRivalStatus('collected');
      playSound('powerup');
    }
  }, [collectedSimulationCoins, rivalStatus]);

  // --- Step 4: Ability Testing State ---
  const [activeAbilityTest, setActiveAbilityTest] = useState<string | null>(null);
  const [teleportCount, setTeleportCount] = useState(0);
  const [magnetPulses, setMagnetPulses] = useState<number[]>([]);

  const handleTestAbility = (ability: string) => {
    setActiveAbilityTest(ability);
    if (ability === 'teleport') {
      playSound('star');
      setTeleportCount((prev) => prev + 1);
    } else if (ability === 'boost') {
      playSound('boost');
      setTimeout(() => {
        try { soundManager.stopBoost(); } catch (e) {}
      }, 1200);
    } else if (ability === 'magnet') {
      playSound('powerup');
      setMagnetPulses((prev) => [...prev, Date.now()]);
    } else if (ability === 'zoom') {
      playSound('plim');
    }
  };

  // --- Step 5: Host Private Room State ---
  const [simulatedCode, setSimulatedCode] = useState<string | null>(null);
  const [simulatingGeneration, setSimulatingGeneration] = useState(false);

  const handleGenerateCode = () => {
    if (simulatingGeneration) return;
    setSimulatingGeneration(true);
    playSound('plim');
    setTimeout(() => {
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      setSimulatedCode(code);
      setSimulatingGeneration(false);
      playSound('star');
    }, 1200);
  };

  // Finish Wager Tutorial
  const handleFinish = () => {
    playSound('powerup');
    localStorage.setItem('viborita_wager_tutorial_seen', 'true');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="relative flex h-[90vh] max-h-[700px] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-blue-500/30 bg-gray-950 shadow-2xl shadow-blue-500/10 text-white"
      >
        {/* Decorative Top Beam */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-yellow-400 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Guía de Entrenamiento</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-white/5 p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Dynamic Step Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
          <AnimatePresence mode="wait">
            {currentStep === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
                    <Coins size={24} className="animate-bounce" />
                  </div>
                  <div>
                    <h4 className="text-lg font-black uppercase tracking-tight text-white leading-tight">La Arena de Apuestas</h4>
                    <p className="text-xs text-gray-400">¿Cómo funcionan las Monedas de oro?</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl bg-white/5 p-4 border border-white/5 text-xs text-gray-300 leading-relaxed">
                  <p>
                    ¡Bienvenido a la <strong className="text-blue-400">Competición Global</strong>! Aquí no juegas por simples puntos acumulativos. En esta arena de apuestas, el boleto de entrada y las recompensas se manejan con <strong className="text-yellow-400">Monedas</strong>.
                  </p>
                  <p>
                    Al ingresar a una sala, aportarás una cantidad fija de monedas. ¡Si logras sobrevivir y vencer a tus oponentes, podrás reclamar el premio mayor!
                  </p>
                </div>

                {/* Interactive Simulation Area */}
                <div className="rounded-2xl bg-gray-900/80 p-4 border border-white/5 space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-gray-400">
                    <span>Simulación de Recolección</span>
                    <span className="text-yellow-400 font-mono">Monedas: {coinsCollected.length} / 3</span>
                  </div>

                  <p className="text-[11px] text-gray-400 text-center">
                    Haz click en las monedas flotantes para acumular tu primer saldo de práctica:
                  </p>

                  <div className="flex justify-center gap-6 py-4">
                    {coinsToCollect.map((id) => {
                      const isCollected = coinsCollected.includes(id);
                      return (
                        <button
                          key={`coin-${id}`}
                          disabled={isCollected}
                          onClick={() => handleCollectCoin(id)}
                          className={`relative flex h-14 w-14 items-center justify-center rounded-full border transition-all ${
                            isCollected
                              ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500/30 scale-90'
                              : 'bg-yellow-500/20 border-yellow-400 hover:scale-110 text-yellow-400 cursor-pointer shadow-lg shadow-yellow-500/10 animate-pulse'
                          }`}
                        >
                          <Coins size={24} />
                          {isCollected && (
                            <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white">
                              <Check size={10} strokeWidth={4} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {coinsCollected.length === 3 ? (
                    <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-2.5 text-center text-xs text-green-400 font-bold">
                      🎉 ¡Perfecto! Has recolectado tu saldo inicial para la arena.
                    </div>
                  ) : (
                    <div className="text-center text-[10px] text-gray-500 italic">
                      Debes recoger todas las monedas para habilitar el siguiente paso.
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
                    <Trophy size={24} />
                  </div>
                  <div>
                    <h4 className="text-lg font-black uppercase tracking-tight text-white leading-tight">El Tamaño Inicial Importa</h4>
                    <p className="text-xs text-gray-400">Cuanto más alta es tu apuesta, mayor es tu ventaja</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl bg-white/5 p-4 border border-white/5 text-xs text-gray-300 leading-relaxed">
                  <p>
                    A diferencia del modo clásico donde siempre empiezas pequeño, en la <strong className="text-blue-400">Arena de Apuestas</strong> inicias con una longitud de segmentos proporcional al nivel de apuesta elegido.
                  </p>
                  <p>
                    ¡Esto te otorga una <strong className="text-green-400">ventaja competitiva masiva</strong> desde el primer segundo para encerrar a tus rivales!
                  </p>
                </div>

                {/* Interactive Wager Selector */}
                <div className="rounded-2xl bg-gray-900/80 p-5 border border-white/5 space-y-4">
                  <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider text-center">
                    Selecciona una categoría para ver la escala inicial:
                  </p>

                  <div className="flex gap-2">
                    {(['basica', 'pro', 'millonario'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => {
                          setSelectedWagerLevel(level);
                          playSound('plim');
                        }}
                        className={`flex-1 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-wider border transition-all ${
                          selectedWagerLevel === level
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                            : 'bg-gray-800/80 border-white/5 text-gray-400 hover:bg-gray-800'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>

                  {/* Snake preview visualization */}
                  <div className="relative flex flex-col items-center justify-center rounded-2xl bg-black/60 p-6 min-h-[120px] overflow-hidden border border-white/5">
                    <span className="absolute top-2 right-3 text-[10px] font-mono text-gray-500">
                      Segmentos: <strong className="text-blue-400">{getSegmentCount()}</strong>
                    </span>

                    <div className="flex flex-wrap gap-1.5 justify-center max-w-[85%]">
                      {/* Snake Head */}
                      <div className="h-4 w-4 rounded-full bg-blue-400 flex items-center justify-center font-bold text-[8px] text-white select-none animate-pulse">
                        👀
                      </div>
                      {/* Snake Body segments */}
                      {Array.from({ length: Math.min(getSegmentCount() - 1, 30) }).map((_, idx) => (
                        <div
                          key={`seg-${idx}`}
                          style={{
                            opacity: 1 - idx * 0.025,
                            transform: `scale(${1 - idx * 0.015})`,
                          }}
                          className="h-3 w-3 rounded-full bg-blue-500/80 shadow-[0_0_4px_rgba(59,130,246,0.3)]"
                        />
                      ))}
                      {getSegmentCount() > 30 && (
                        <span className="text-[9px] text-gray-400 font-bold self-center ml-1">
                          +{getSegmentCount() - 30} más...
                        </span>
                      )}
                    </div>

                    <div className="mt-4 text-center">
                      {selectedWagerLevel === 'basica' && (
                        <p className="text-[10px] text-gray-400">Apuestas pequeñas. Comienzas con un largo estándar manejable.</p>
                      )}
                      {selectedWagerLevel === 'pro' && (
                        <p className="text-[10px] text-purple-400 font-bold">¡Doble de largo! Comienzas fuerte para dominar el centro rápidamente.</p>
                      )}
                      {selectedWagerLevel === 'millonario' && (
                        <p className="text-[10px] text-yellow-400 font-black uppercase tracking-tight">¡Monstruo gigante! Comienzas con un largo extremo capaz de acorralar casi de inmediato.</p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
                    <Skull size={24} />
                  </div>
                  <div>
                    <h4 className="text-lg font-black uppercase tracking-tight text-white leading-tight">Derrotar y Reclamar Monedas</h4>
                    <p className="text-xs text-gray-400">La regla de oro de la Arena</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl bg-white/5 p-4 border border-white/5 text-xs text-gray-300 leading-relaxed">
                  <p>
                    Cuando eliminas a un oponente obligándolo a chocar contra tu cuerpo, este estallará y dejará caer el <strong className="text-yellow-400">50% del valor de su apuesta de entrada</strong> en forma de monedas gigantes de oro en la arena.
                  </p>
                  <p>
                    ¡Debes moverte rápido para tragarte sus monedas antes de que otros competidores oportunistas se las lleven!
                  </p>
                </div>

                {/* Interactive Trap Simulation */}
                <div className="rounded-2xl bg-gray-900/80 p-4 border border-white/5 space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-gray-400">
                    <span>Simulador de Combate</span>
                    <span className="text-red-400 font-mono">Estado: {rivalStatus.toUpperCase()}</span>
                  </div>

                  <div className="relative flex flex-col items-center justify-center rounded-2xl bg-black/80 h-36 overflow-hidden border border-white/5">
                    {rivalStatus === 'alive' && (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center gap-8">
                          {/* Your Snake head */}
                          <div className="flex items-center gap-1">
                            <span className="h-5 w-5 rounded-full bg-blue-500 flex items-center justify-center">🟢</span>
                            <span className="text-[9px] font-bold text-blue-400">Tú (Largo)</span>
                          </div>
                          {/* Rival head */}
                          <div className="flex items-center gap-1 animate-bounce">
                            <span className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">🔴</span>
                            <span className="text-[9px] font-bold text-red-400">Rival distraído</span>
                          </div>
                        </div>

                        <button
                          onClick={handleTrapRival}
                          className="rounded-xl bg-red-600 px-5 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-red-600/30 hover:bg-red-500 hover:scale-105 active:scale-95 transition-all"
                        >
                          ⚔️ ¡Encerrar al Rival!
                        </button>
                      </div>
                    )}

                    {rivalStatus === 'colliding' && (
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-10 w-10 animate-spin text-red-500 text-3xl">💥</div>
                        <span className="text-xs font-black text-red-400 uppercase animate-pulse">¡Cerrando círculo mortal!</span>
                      </div>
                    )}

                    {rivalStatus === 'exploded' && (
                      <div className="flex flex-col items-center justify-center w-full h-full p-2">
                        <p className="text-[10px] text-yellow-400 font-black mb-2 uppercase tracking-wide">¡Rival eliminado! Haz click en las monedas para recogerlas:</p>
                        <div className="flex gap-3">
                          {simCoins.map((id) => {
                            const isPicked = collectedSimulationCoins.includes(id);
                            return (
                              <button
                                key={`sim-coin-${id}`}
                                disabled={isPicked}
                                onClick={() => handleCollectSimCoin(id)}
                                className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all ${
                                  isPicked
                                    ? 'bg-transparent border-transparent scale-50 opacity-0'
                                    : 'bg-yellow-500 border-yellow-300 text-white cursor-pointer shadow-[0_0_10px_rgba(234,179,8,0.5)] animate-bounce hover:scale-110'
                                }`}
                              >
                                🪙
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {rivalStatus === 'collected' && (
                      <div className="flex flex-col items-center gap-1 text-center px-4">
                        <span className="text-green-400 text-2xl font-bold">💰 +500 Monedas</span>
                        <p className="text-[10px] text-gray-300">¡Victoria total! Has reclamado el botín del oponente derrotado de forma segura.</p>
                      </div>
                    )}
                  </div>

                  {rivalStatus !== 'collected' && (
                    <p className="text-center text-[10px] text-gray-500 italic">
                      Pon a prueba el simulador atrapando al oponente y recolectando su tesoro.
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {currentStep === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
                    <Zap size={24} className="animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-lg font-black uppercase tracking-tight text-white leading-tight">Habilidades de Combate</h4>
                    <p className="text-xs text-gray-400">Sácale ventaja táctica a tus rivales</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl bg-white/5 p-4 border border-white/5 text-xs text-gray-300 leading-relaxed">
                  <p>
                    Puedes equipar habilidades compradas en la tienda para utilizarlas estratégicamente en tus partidas. ¡Haz click en cada una para probarlas en tiempo real en la vista previa!
                  </p>
                </div>

                {/* Abilities testing grid */}
                <div className="rounded-2xl bg-gray-900/80 p-4 border border-white/5 space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleTestAbility('boost')}
                      className={`flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left ${
                        activeAbilityTest === 'boost'
                          ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                          : 'bg-gray-800/60 border-white/5 text-gray-400 hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-[10px] font-black uppercase text-white flex items-center gap-1">🚀 Turbo (Acelerar)</span>
                      <span className="text-[8px]">Acelera tu velocidad para rebasar y encerrar rivales.</span>
                    </button>

                    <button
                      onClick={() => handleTestAbility('teleport')}
                      className={`flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left ${
                        activeAbilityTest === 'teleport'
                          ? 'bg-purple-600/20 border-purple-500 text-purple-400'
                          : 'bg-gray-800/60 border-white/5 text-gray-400 hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-[10px] font-black uppercase text-white flex items-center gap-1">🔮 Teleport</span>
                      <span className="text-[8px]">Sálvate de una trampa saltando a otra ubicación del mapa (Cuesta 250 pts).</span>
                    </button>

                    <button
                      onClick={() => handleTestAbility('magnet')}
                      className={`flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left ${
                        activeAbilityTest === 'magnet'
                          ? 'bg-yellow-600/20 border-yellow-500 text-yellow-400'
                          : 'bg-gray-800/60 border-white/5 text-gray-400 hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-[10px] font-black uppercase text-white flex items-center gap-1">🧲 Imán (Magnet)</span>
                      <span className="text-[8px]">Atrae monedas y comida que estén en tu cercanía de forma automática.</span>
                    </button>

                    <button
                      onClick={() => handleTestAbility('zoom')}
                      className={`flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left ${
                        activeAbilityTest === 'zoom'
                          ? 'bg-green-600/20 border-green-500 text-green-400'
                          : 'bg-gray-800/60 border-white/5 text-gray-400 hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-[10px] font-black uppercase text-white flex items-center gap-1">🔍 Zoom de Campo</span>
                      <span className="text-[8px]">Amplía tu visión del mapa para evitar colisionar por sorpresa.</span>
                    </button>
                  </div>

                  {/* Sandbox Visualizer of ability */}
                  <div className="relative flex items-center justify-center rounded-xl bg-black/70 p-4 h-28 border border-white/5 overflow-hidden">
                    <AnimatePresence mode="wait">
                      {!activeAbilityTest && (
                        <motion.span
                          key="no-ability"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="text-[10px] text-gray-500 italic"
                        >
                          Haz click en una habilidad arriba para ver su simulación táctica.
                        </motion.span>
                      )}

                      {activeAbilityTest === 'boost' && (
                        <motion.div
                          key="boost-sim"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex flex-col items-center text-center space-y-2"
                        >
                          <div className="flex gap-1 items-center animate-pulse">
                            <span className="h-4 w-4 bg-blue-500 rounded-full"></span>
                            <span className="text-[12px] text-blue-400 font-bold tracking-widest">&gt;&gt;&gt; SUPER TURBO &gt;&gt;&gt;</span>
                          </div>
                          <span className="text-[9px] text-gray-400">¡Tu velocidad se incrementa temporalmente con estelas de fuego!</span>
                        </motion.div>
                      )}

                      {activeAbilityTest === 'teleport' && (
                        <motion.div
                          key={`teleport-sim-${teleportCount}`}
                          initial={{ opacity: 0, scale: 0.2 }}
                          animate={{ opacity: 1, scale: [0.5, 1.2, 1] }}
                          className="flex flex-col items-center text-center space-y-1"
                        >
                          <span className="text-2xl">✨ 👾 ✨</span>
                          <span className="text-[10px] text-purple-400 font-bold">¡Salto Dimensional Exitoso!</span>
                          <span className="text-[8px] text-gray-500">(Te teletransporta al azar de forma instantánea)</span>
                        </motion.div>
                      )}

                      {activeAbilityTest === 'magnet' && (
                        <motion.div
                          key="magnet-sim"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex flex-col items-center text-center space-y-1 w-full"
                        >
                          <div className="relative flex items-center justify-center">
                            <div className="absolute h-14 w-14 rounded-full border border-yellow-500/40 animate-ping" />
                            <div className="absolute h-8 w-8 rounded-full border border-yellow-500/60 animate-pulse" />
                            <span className="text-xl relative z-10">🧲</span>
                          </div>
                          <span className="text-[9px] text-yellow-400 font-bold">Campo magnético activo recolectando monedas...</span>
                        </motion.div>
                      )}

                      {activeAbilityTest === 'zoom' && (
                        <motion.div
                          key="zoom-sim"
                          initial={{ scale: 1.5 }}
                          animate={{ scale: 0.9 }}
                          transition={{ duration: 0.8 }}
                          className="flex flex-col items-center text-center space-y-1"
                        >
                          <span className="text-xs font-mono text-green-400">[ 🔎 VISTA DE ÁREA COMPLETA ]</span>
                          <span className="text-[9px] text-gray-400">Menos sorpresas: detecta cabezas de rivales antes que ellos a ti.</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}

            {currentStep === 5 && (
              <motion.div
                key="step-5"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-500/10 border border-pink-500/30 text-pink-400">
                    <Users size={24} />
                  </div>
                  <div>
                    <h4 className="text-lg font-black uppercase tracking-tight text-white leading-tight">Salas Privadas 1v1</h4>
                    <p className="text-xs text-gray-400">Reta a tus amigos directamente</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl bg-white/5 p-4 border border-white/5 text-xs text-gray-300 leading-relaxed">
                  <p>
                    ¿Tienes una rivalidad con un amigo? En lugar de competir contra todo el mundo en las arenas públicas, puedes crear una <strong className="text-pink-400">Sala Privada</strong> con el valor de apuesta de monedas que tú decidas.
                  </p>
                  <p>
                    ¡Esto te dará un <strong className="text-blue-400">código único de 4 dígitos</strong> que podrás copiar y mandarle para jugar un mano a mano definitivo!
                  </p>
                </div>

                {/* Interactive Code Generation */}
                <div className="rounded-2xl bg-gray-900/80 p-4 border border-white/5 space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-gray-400">
                    <span>Simulación de Sala Privada</span>
                    <span>Anfitrión</span>
                  </div>

                  <div className="flex flex-col items-center justify-center rounded-xl bg-black/60 p-4 min-h-[100px] border border-white/5">
                    {simulatingGeneration ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
                        <span className="text-[10px] font-bold text-pink-400 uppercase tracking-widest animate-pulse">Generando Sala en Firestore...</span>
                      </div>
                    ) : simulatedCode ? (
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex flex-col items-center gap-2 text-center"
                      >
                        <span className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">CÓDIGO DE INVITACIÓN</span>
                        <div className="rounded-2xl bg-pink-500/20 border border-pink-500/40 px-6 py-2 text-2xl font-black tracking-widest text-pink-400 font-mono">
                          {simulatedCode}
                        </div>
                        <span className="text-[9px] text-green-400 font-bold flex items-center gap-1">
                          ✓ ¡Compartido con tu amigo! Listo para jugar.
                        </span>
                      </motion.div>
                    ) : (
                      <button
                        onClick={handleGenerateCode}
                        className="rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-pink-500/10"
                      >
                        🔑 Crear Sala de Prueba
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Modal Footer with Actions and Progress bar */}
        <div className="px-6 py-5 border-t border-white/5 flex flex-col gap-4 bg-gray-950/80 backdrop-blur-sm">
          {/* Progress Indicator Dots */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {Array.from({ length: totalSteps }).map((_, idx) => (
                <div
                  key={`dot-${idx}`}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx + 1 === currentStep
                      ? 'w-6 bg-blue-500'
                      : idx + 1 < currentStep
                      ? 'w-2 bg-blue-500/40'
                      : 'w-2 bg-white/10'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] font-bold text-gray-500 font-mono">Paso {currentStep} de {totalSteps}</span>
          </div>

          <div className="flex gap-3">
            {currentStep > 1 && (
              <button
                onClick={() => {
                  setCurrentStep((prev) => Math.max(1, prev - 1));
                  playSound('plim');
                }}
                className="rounded-xl bg-gray-800 border border-white/5 hover:bg-gray-700 px-4 font-bold text-xs text-gray-300 transition-all cursor-pointer"
              >
                Atrás
              </button>
            )}

            {currentStep < totalSteps ? (
              <button
                onClick={() => {
                  setCurrentStep((prev) => Math.min(totalSteps, prev + 1));
                  playSound('plim');
                }}
                disabled={currentStep === 1 && coinsCollected.length < 3}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                  currentStep === 1 && coinsCollected.length < 3
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-white/5'
                    : 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 active:scale-95'
                }`}
              >
                <span>Siguiente</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-green-600 py-3 text-xs font-black uppercase tracking-widest text-white hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-blue-500/25 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Play size={14} fill="currentColor" />
                <span>¡Empezar a Competir!</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
