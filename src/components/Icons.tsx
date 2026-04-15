import { motion } from 'motion/react';

export const GoldPointIcon = ({ size = 24 }: { size?: number }) => (
  <motion.div
    animate={{ y: [0, -4, 0] }}
    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    className="relative flex items-center justify-center"
    style={{ width: size, height: size }}
  >
    <div 
      className="rounded-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]"
      style={{ width: size * 0.8, height: size * 0.8 }}
    />
  </motion.div>
);

export const MonedasIcon = ({ size = 24 }: { size?: number }) => (
  <div className="relative flex items-center justify-center" style={{ width: size * 1.5, height: size }}>
    {/* Second coin (background) */}
    <div 
      className="absolute right-0 top-1 flex items-center justify-center rounded-full border border-blue-400 bg-blue-600 shadow-lg"
      style={{ width: size, height: size }}
    >
      <span className="text-[10px] font-black text-white">1</span>
    </div>
    {/* First coin (foreground) */}
    <div 
      className="absolute left-0 top-0 flex items-center justify-center rounded-full border border-blue-300 bg-blue-500 shadow-lg"
      style={{ width: size, height: size }}
    >
      <span className="text-[10px] font-black text-white">1</span>
    </div>
  </div>
);
