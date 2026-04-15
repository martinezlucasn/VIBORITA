import { Skin } from "./types";

export const WORLD_W = 3000;
export const WORLD_H = 3000;
export const BASE_SPEED = 130;
export const CELL = 24;
export const SEGMENT_DISTANCE = 5; // Distance between segments for better fluidity and separation

export const ALL_SKINS: Skin[] = [
  { id: 'default', name: 'Default', icon: '🟢', rarity: 'common', colors: ['#22ff44', '#11cc33'] },
  { id: 'ocean', name: 'Azul', icon: '🔵', rarity: 'common', colors: ['#2288ff', '#1166cc'] },
  { id: 'sunset', name: 'Naranja', icon: '🟠', rarity: 'common', colors: ['#ff8844', '#cc5522'] },
  { id: 'forest', name: 'Verde', icon: '🟢', rarity: 'common', colors: ['#228833', '#115522'] },
  { id: 'cloud', name: 'Celeste', icon: '🔵', rarity: 'common', colors: ['#aaccee', '#88aacc'] },
  { id: 'stone', name: 'Rosa', icon: '🔴', rarity: 'common', colors: ['#ff69b4', '#ff1493'] },
  { id: 'ice', name: 'Negro', icon: '⚫', rarity: 'rare', colors: ['#000000', '#222222'] },
  { id: 'fire', name: 'Bordo', icon: '🟤', rarity: 'rare', colors: ['#800000', '#4d0000'] },
  { id: 'electric', name: 'Amarillo', icon: '🟡', rarity: 'rare', colors: ['#ffff22', '#cccc00'] },
  { id: 'toxic', name: 'Blanco', icon: '⚪', rarity: 'rare', colors: ['#ffffff', '#eeeeee'] },
  { id: 'sakura', name: 'Marrón', icon: '🟤', rarity: 'rare', colors: ['#8b4513', '#5d2e0d'] },
  { id: 'mint', name: 'Azul Marino', icon: '🔵', rarity: 'rare', colors: ['#000080', '#000060'] },
  { id: 'galaxy', name: 'Agotado', icon: '🫩', rarity: 'epic', colors: ['#8844ff', '#5522cc'] },
  { id: 'dragon', name: 'Ruborizado', icon: '😊', rarity: 'epic', colors: ['#fcd34d', '#f59e0b'] },
  { id: 'aurora', name: 'Risa Loca', icon: '😆', rarity: 'epic', colors: ['#fcd34d', '#f59e0b'] },
  { id: 'phantom', name: 'Sorpresa', icon: '😮', rarity: 'epic', colors: ['#aaaaff', '#6666cc'] },
  { id: 'golden', name: 'Millonario', icon: '🤑', rarity: 'legendary', colors: ['#ffd700', '#cc9900'], price: 15000 },
  { id: 'cosmic', name: 'Náuseas', icon: '🤢', rarity: 'legendary', colors: ['#44ff88', '#22cc55'] },
  { id: 'void', name: 'Oscuro', icon: '🕳️', rarity: 'legendary', colors: ['#222244', '#8844ff'] },
  { id: 'rainbow', name: 'Serio', icon: '😑', rarity: 'legendary', colors: ['#9ca3af', '#4b5563'] },
  { id: 'emoji_laugh', name: 'Risa Suprema', icon: '😂', rarity: 'legendary', colors: ['#fcd34d', '#f59e0b'] },
  { id: 'emoji_love', name: 'Amor Infinito', icon: '😍', rarity: 'legendary', colors: ['#f87171', '#dc2626'] },
  { id: 'emoji_angry', name: 'Furia Roja', icon: '😡', rarity: 'legendary', colors: ['#ef4444', '#b91c1c'] },
  { id: 'emoji_scared', name: 'Terror Puro', icon: '😱', rarity: 'legendary', colors: ['#93c5fd', '#3b82f6'] },
  { id: 'emoji_cool', name: 'Estilo Pro', icon: '😎', rarity: 'legendary', colors: ['#60a5fa', '#2563eb'] },
  { id: 'emoji_clown', name: 'Bromista', icon: '🤡', rarity: 'legendary', colors: ['#ffffff', '#ef4444'] },
  { id: 'pig', name: 'Cerdito', icon: '🐷', rarity: 'common', colors: ['#ffafbd', '#ffc3a0'], price: 25, currency: 'monedas' },
  { id: 'bald_woman', name: 'Perrito', icon: '🐶', rarity: 'common', colors: ['#f3e5ab', '#e6be8a'], price: 25, currency: 'monedas' },
  { id: 'bald_man', name: 'Gatito', icon: '🐱', rarity: 'common', colors: ['#d2b48c', '#8b4513'], price: 25, currency: 'monedas' },
  { id: 'radioactive', name: 'Radiactivo', icon: '☢️', rarity: 'common', colors: ['#ffff00', '#000000'], price: 25, currency: 'monedas' },
  { id: 'biohazard', name: 'Peligro Biológico', icon: '☣️', rarity: 'common', colors: ['#ff6600', '#000000'], price: 25, currency: 'monedas' },
  { id: 'coin_skin', name: 'Moneda de Oro', icon: '🪙', rarity: 'common', colors: ['#ffd700', '#daa520'], price: 50, currency: 'monedas' },
  { id: 'soccer_skin', name: 'Futbolista', icon: '⚽', rarity: 'common', colors: ['#ffffff', '#000000'], price: 50, currency: 'monedas' },
  { id: 'moon_skin', name: 'Luna Llena', icon: '🌝', rarity: 'common', colors: ['#fdfd96', '#f4f4f4'], price: 50, currency: 'monedas' },
  { id: 'sun_skin', name: 'Sol Radiante', icon: '🌞', rarity: 'common', colors: ['#ffcc33', '#ff9900'], price: 50, currency: 'monedas' },
  { id: 'earth_skin', name: 'Planeta Tierra', icon: '🌍', rarity: 'common', colors: ['#4b9cd3', '#228b22'], price: 50, currency: 'monedas' },
  { id: 'phoenix', name: 'Fénix Eterno', icon: '🔥', rarity: 'legendary', colors: ['#ff0000', '#ffcc00'], price: 250, currency: 'monedas', hasAura: true, auraType: 'fire' },
  { id: 'glacier', name: 'Glaciar Eterno', icon: '❄️', rarity: 'legendary', colors: ['#00ffff', '#ffffff'], price: 250, currency: 'monedas', hasAura: true, auraType: 'ice' },
];
