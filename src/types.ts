export interface Point {
  x: number;
  y: number;
}

export interface User {
  id: string;
  displayName: string;
  email: string;
  coins: number;
  monedas: number;
  ownedSkins: string[];
  equippedSkin: string;
  highScore: number;
  highScoreMonedas: number;
  lastActive: number;
  usernameSet?: boolean;
  proAccessUntil?: number;
  millonarioAccessUntil?: number;
  botKills?: number;
  insomniaCount?: number;
  photoURL?: string;
  lightweight?: boolean;
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
  spawnTime?: number;
  color1: string;
  color2: string;
  skinEmoji?: string;
  isBoosting?: boolean;
  hasAura?: boolean;
  auraType?: 'fire' | 'ice';
  serverId?: string;
}

export interface Food {
  id: string;
  x: number;
  y: number;
  value: number;
  type: 'normal' | 'gold' | 'speed' | 'star' | 'dropped';
  color: string;
  serverId?: string;
}

export interface Skin {
  id: string;
  name: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  colors: [string, string];
  price?: number;
  currency?: 'coins' | 'monedas';
  hasAura?: boolean;
  auraType?: 'fire' | 'ice';
}

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  timestamp: number;
  serverId?: string;
}

export interface KillEvent {
  id: string;
  killerName: string;
  victimName: string;
  timestamp: number;
  serverId?: string;
}

export interface Friendship {
  id: string;
  uids: string[];
  status: 'pending' | 'accepted';
  requesterId: string;
  gamesPlayed: number;
  stats: {
    [uid: string]: {
      wins: number;
    };
  };
  timestamp: number;
}

export interface Notification {
  id: string;
  type: 'game_invite';
  fromId: string;
  fromName: string;
  toId: string;
  roomId?: string;
  wager?: number;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: number;
}
