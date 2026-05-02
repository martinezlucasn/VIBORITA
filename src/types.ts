export interface Point {
  x: number;
  y: number;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface User {
  id: string;
  displayName: string;
  email: string;
  coins: number;
  monedas: number;
  ownedSkins: string[]; // Keep for backward compatibility, will store duplicates for quantity
  equippedSkin: string;
  highScore: number;
  highScoreMonedas: number;
  lastActive: number;
  usernameSet?: boolean;
  proAccessUntil?: number;
  millonarioAccessUntil?: number;
  botKills?: number;
  insomniaCount?: number;
  inventoryItems?: { [itemId: string]: number };
  inventoryAbilities?: { [abilityId: string]: number };
  equippedAbilities?: string[];
  claimedPlatinumReward?: boolean;
  dailyRewardsCycle?: number;
  lastDailyRewardClaim?: number;
  // New Social/Profile properties
  bio?: string;
  profileTheme?: string;
  profileBorder?: string;
  unlockedThemes?: string[];
  unlockedBorders?: string[];
  trophies?: number;
  avatarConfig?: {
    style: string;
    seed: string;
  };
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  fragmentId: string;
}

export interface AbilityListing {
  id: string;
  sellerId: string;
  sellerName: string;
  abilityId: string;
  price: number; // In "monedas"
  timestamp: number;
  status: 'active' | 'sold';
}

export interface SkinListing {
  id: string;
  sellerId: string;
  sellerName: string;
  skinId: string;
  price: number; // In "monedas"
  timestamp: number;
  status: 'active' | 'sold';
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
  auraType?: 'fire' | 'ice' | 'lightning';
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
  expiresAt?: number;
  isDeathLoot?: boolean;
}

export interface ArenaItemEntity {
  id: string;
  x: number;
  y: number;
  itemId: string; // Ref to ARENA_ITEMS
  serverId: string;
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
  auraType?: 'fire' | 'ice' | 'lightning';
}

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  timestamp: number;
  serverId?: string;
  avatarConfig?: { style: string; seed: string; };
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
  level: number;
  exp: number;
  lastInteractionTime?: number;
  stats: {
    [uid: string]: {
      wins: number;
    };
  };
  timestamp: number;
}

export interface PrivateMessage {
  id: string;
  friendshipId: string;
  senderId: string;
  text: string;
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
