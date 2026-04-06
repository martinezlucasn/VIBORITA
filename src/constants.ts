import { Skin } from "./types";

export const WORLD_W = 3000;
export const WORLD_H = 3000;
export const BASE_SPEED = 130;
export const CELL = 16;

export const ALL_SKINS: Skin[] = [
  { id: 'default', name: 'Default', icon: '🟢', rarity: 'common', colors: ['#22ff44', '#11cc33'] },
  { id: 'ocean', name: 'Ocean Wave', icon: '🌊', rarity: 'common', colors: ['#2288ff', '#1166cc'] },
  { id: 'sunset', name: 'Sunset', icon: '🌅', rarity: 'common', colors: ['#ff8844', '#cc5522'] },
  { id: 'forest', name: 'Forest', icon: '🌲', rarity: 'common', colors: ['#228833', '#115522'] },
  { id: 'cloud', name: 'Cloud', icon: '☁️', rarity: 'common', colors: ['#aaccee', '#88aacc'] },
  { id: 'stone', name: 'Stone', icon: '🪨', rarity: 'common', colors: ['#778899', '#556677'] },
  { id: 'ice', name: 'Ice Crystal', icon: '❄️', rarity: 'rare', colors: ['#44ddff', '#2299cc'] },
  { id: 'fire', name: 'Fire Snake', icon: '🔥', rarity: 'rare', colors: ['#ff4422', '#cc2200'] },
  { id: 'electric', name: 'Electric', icon: '⚡', rarity: 'rare', colors: ['#ffff22', '#cccc00'] },
  { id: 'toxic', name: 'Toxic', icon: '☠️', rarity: 'rare', colors: ['#44ff88', '#22cc55'] },
  { id: 'sakura', name: 'Sakura', icon: '🌸', rarity: 'rare', colors: ['#ff88aa', '#cc5577'] },
  { id: 'mint', name: 'Mint', icon: '🍃', rarity: 'rare', colors: ['#44ffaa', '#22cc77'] },
  { id: 'galaxy', name: 'Galaxy', icon: '🌌', rarity: 'epic', colors: ['#8844ff', '#5522cc'] },
  { id: 'dragon', name: 'Dragon', icon: '🐉', rarity: 'epic', colors: ['#ff2244', '#aa0022'] },
  { id: 'aurora', name: 'Aurora', icon: '🌈', rarity: 'epic', colors: ['#44ffcc', '#ff44aa'] },
  { id: 'phantom', name: 'Phantom', icon: '👻', rarity: 'epic', colors: ['#aaaaff', '#6666cc'] },
  { id: 'golden', name: 'Golden King', icon: '👑', rarity: 'legendary', colors: ['#ffd700', '#cc9900'] },
  { id: 'cosmic', name: 'Cosmic Lord', icon: '✨', rarity: 'legendary', colors: ['#ff44ff', '#aa22aa'] },
  { id: 'void', name: 'Void Walker', icon: '🕳️', rarity: 'legendary', colors: ['#222244', '#8844ff'] },
  { id: 'rainbow', name: 'Rainbow', icon: '🦄', rarity: 'legendary', colors: ['#ff2222', '#2222ff'] },
];
