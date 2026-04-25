import { Rarity } from "./types";

export interface ArenaItem {
  id: string;
  name: string;
  type: 'color' | 'emoji';
  value: string; // hex color or emoji
  rarity: Rarity;
  skinId: string; // The skin it creates if you gather 4
}

export const ARENA_ITEMS: ArenaItem[] = [
  // COMMON (Colors)
  { id: 'item_blue', name: 'Azul', type: 'color', value: '#2288ff', rarity: 'common', skinId: 'ocean' },
  { id: 'item_orange', name: 'Naranja', type: 'color', value: '#ff8844', rarity: 'common', skinId: 'sunset' },
  { id: 'item_green', name: 'Verde', type: 'color', value: '#228833', rarity: 'common', skinId: 'forest' },
  { id: 'item_cyan', name: 'Celeste', type: 'color', value: '#aaccee', rarity: 'common', skinId: 'cloud' },
  { id: 'item_red', name: 'Rojo', type: 'color', value: '#ff69b4', rarity: 'common', skinId: 'stone' },
  { id: 'item_black', name: 'Negro', type: 'color', value: '#000000', rarity: 'common', skinId: 'ice' },
  { id: 'item_maroon', name: 'Bordo', type: 'color', value: '#800000', rarity: 'common', skinId: 'fire' },
  { id: 'item_yellow', name: 'Amarillo', type: 'color', value: '#ffff22', rarity: 'common', skinId: 'electric' },
  { id: 'item_white', name: 'Blanco', type: 'color', value: '#ffffff', rarity: 'common', skinId: 'toxic' },
  { id: 'item_brown', name: 'Marrón', type: 'color', value: '#8b4513', rarity: 'common', skinId: 'sakura' },
  { id: 'item_navy', name: 'Azul Marino', type: 'color', value: '#000080', rarity: 'common', skinId: 'mint' },

  // RARE (Emojis from Agotado to Bromista)
  { id: 'item_agotado', name: 'Agotado', type: 'emoji', value: '🫩', rarity: 'rare', skinId: 'galaxy' },
  { id: 'item_ruborizado', name: 'Ruborizado', type: 'emoji', value: '😊', rarity: 'rare', skinId: 'dragon' },
  { id: 'item_risa_loca', name: 'Risa Loca', type: 'emoji', value: '😆', rarity: 'rare', skinId: 'aurora' },
  { id: 'item_sorpresa', name: 'Sorpresa', type: 'emoji', value: '😮', rarity: 'rare', skinId: 'phantom' },
  { id: 'item_millonario', name: 'Millonario', type: 'emoji', value: '🤑', rarity: 'rare', skinId: 'golden' },
  { id: 'item_nauseas', name: 'Náuseas', type: 'emoji', value: '🤢', rarity: 'rare', skinId: 'cosmic' },
  { id: 'item_oscuro', name: 'Oscuro', type: 'emoji', value: '🕳️', rarity: 'rare', skinId: 'void' },
  { id: 'item_serio', name: 'Serio', type: 'emoji', value: '😑', rarity: 'rare', skinId: 'rainbow' },
  { id: 'item_risa_suprema', name: 'Risa Suprema', type: 'emoji', value: '😂', rarity: 'rare', skinId: 'emoji_laugh' },
  { id: 'item_amor_infinito', name: 'Amor Infinito', type: 'emoji', value: '😍', rarity: 'rare', skinId: 'emoji_love' },
  { id: 'item_furia_roja', name: 'Furia Roja', type: 'emoji', value: '😡', rarity: 'rare', skinId: 'emoji_angry' },
  { id: 'item_terror_puro', name: 'Terror Puro', type: 'emoji', value: '😱', rarity: 'rare', skinId: 'emoji_scared' },
  { id: 'item_estilo_pro', name: 'Estilo Pro', type: 'emoji', value: '😎', rarity: 'rare', skinId: 'emoji_cool' },
  { id: 'item_bromista', name: 'Bromista', type: 'emoji', value: '🤡', rarity: 'rare', skinId: 'emoji_clown' },

  // EPIC (Emojis from Cerdito to Planeta Tierra)
  { id: 'item_cerdito', name: 'Cerdito', type: 'emoji', value: '🐷', rarity: 'epic', skinId: 'pig' },
  { id: 'item_perrito', name: 'Perrito', type: 'emoji', value: '🐶', rarity: 'epic', skinId: 'bald_woman' },
  { id: 'item_gatito', name: 'Gatito', type: 'emoji', value: '🐱', rarity: 'epic', skinId: 'bald_man' },
  { id: 'item_radiactivo', name: 'Radiactivo', type: 'emoji', value: '☢️', rarity: 'epic', skinId: 'radioactive' },
  { id: 'item_peligro_bio', name: 'Peligro Biológico', type: 'emoji', value: '☣️', rarity: 'epic', skinId: 'biohazard' },
  { id: 'item_moneda_oro', name: 'Moneda de Oro', type: 'emoji', value: '🪙', rarity: 'epic', skinId: 'coin_skin' },
  { id: 'item_futbolista', name: 'Futbolista', type: 'emoji', value: '⚽', rarity: 'epic', skinId: 'soccer_skin' },
  { id: 'item_luna_llena', name: 'Luna Llena', type: 'emoji', value: '🌝', rarity: 'epic', skinId: 'moon_skin' },
  { id: 'item_sol_radiante', name: 'Sol Radiante', type: 'emoji', value: '🌞', rarity: 'epic', skinId: 'sun_skin' },
  { id: 'item_planeta_tierra', name: 'Planeta Tierra', type: 'emoji', value: '🌍', rarity: 'epic', skinId: 'earth_skin' },

  // LEGENDARY (Emojis from Fénix Eterno to Glaciar Eterno)
  { id: 'item_fenix_eterno', name: 'Fénix Eterno', type: 'emoji', value: '🔥', rarity: 'legendary', skinId: 'phoenix' },
  { id: 'item_glaciar_eterno', name: 'Glaciar Eterno', type: 'emoji', value: '❄️', rarity: 'legendary', skinId: 'glacier' },
  { id: 'item_rayo_eterno', name: 'Rayo Eterno', type: 'emoji', value: '⚡', rarity: 'legendary', skinId: 'lightning' },
  
  // ABILITY FRAGMENTS
  { id: 'frag_zoom', name: 'Fragmento de Zoom', type: 'emoji', value: '🔍', rarity: 'rare', skinId: 'ability_zoom' },
  { id: 'frag_teleport', name: 'Fragmento de Teletransporte', type: 'emoji', value: '🌀', rarity: 'legendary', skinId: 'ability_teleport' },
  { id: 'frag_stop', name: 'Fragmento de Parar', type: 'emoji', value: '🛑', rarity: 'common', skinId: 'ability_stop' },
  { id: 'frag_magnet', name: 'Fragmento de Imán', type: 'emoji', value: '🧲', rarity: 'epic', skinId: 'ability_magnet' },
  { id: 'frag_autopilot', name: 'Fragmento de Autopilot', type: 'emoji', value: '🤖', rarity: 'legendary', skinId: 'ability_autopilot' },
];

export const SUCCESS_RATES: Record<Rarity, number> = {
  common: 0.8,
  rare: 0.7,
  epic: 0.5,
  legendary: 0.3
};
