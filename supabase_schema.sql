-- Supabase Schema for Viborita App

-- 1. Profiles Table (User data and balances)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  display_name TEXT,
  email TEXT,
  coins BIGINT DEFAULT 0,
  monedas BIGINT DEFAULT 0,
  equipped_skin TEXT DEFAULT 'classic',
  high_score BIGINT DEFAULT 0,
  high_score_monedas BIGINT DEFAULT 0,
  has_speed_boost BOOLEAN DEFAULT FALSE,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Inventory Table (Owned skins)
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  skin_id TEXT NOT NULL,
  acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, skin_id)
);

-- 3. Transactions Table (History of points and monedas)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'spent', 'collected', 'lost', 'reward', 'withdrawal'
  currency TEXT NOT NULL, -- 'coins', 'monedas'
  amount BIGINT NOT NULL,
  reason TEXT, -- 'game_win', 'game_loss', 'store_purchase', 'admin_update', etc.
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Withdrawals Table (Withdrawal requests)
CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_firestore TEXT,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  amount BIGINT,
  alias TEXT,
  status TEXT DEFAULT 'pending',
  transaction_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable Realtime for these tables
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE withdrawals;
