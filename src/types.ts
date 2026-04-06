export interface Point {
  x: number;
  y: number;
}

export interface User {
  id: string;
  displayName: string;
  coins: number;
  ownedSkins: string[];
  equippedSkin: string;
  highScore: number;
  lastActive: number;
}

export interface PlayerSession {
  id: string;
  userId: string;
  displayName: string;
  segments: Point[];
  angle: number;
  wager: number;
  isAlive: boolean;
  lastUpdate: number;
  color1: string;
  color2: string;
}

export interface Food {
  id: string;
  x: number;
  y: number;
  value: number;
  type: 'normal' | 'gold' | 'speed' | 'star' | 'dropped';
  color: string;
}

export interface Skin {
  id: string;
  name: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  colors: [string, string];
}

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  timestamp: number;
}

export interface KillEvent {
  id: string;
  killerName: string;
  victimName: string;
  timestamp: number;
}
