PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS storage_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS group_config (
  group_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_qa (
  group_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  mode TEXT NOT NULL,
  reply TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, keyword, mode)
);

CREATE TABLE IF NOT EXISTS activity (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  last_active INTEGER NOT NULL DEFAULT 0,
  msg_count_today INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS signin (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_signin INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  inviter_id TEXT NOT NULL DEFAULT '',
  invite_count INTEGER NOT NULL DEFAULT 0,
  invited_users_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS warnings (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS join_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  passphrase_matched INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS self_recall_tasks (
  task_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  next_retry_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  last_code TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recall_tasks (
  task_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  next_retry_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  last_code TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sub_players (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  gold INTEGER NOT NULL DEFAULT 0,
  value INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  servant_name TEXT NOT NULL DEFAULT '',
  master_id TEXT NOT NULL DEFAULT '',
  last_welfare_day TEXT NOT NULL DEFAULT '',
  last_action_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS sub_contracts (
  group_id TEXT NOT NULL,
  master_id TEXT NOT NULL,
  servant_id TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active',
  servant_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, servant_id)
);

CREATE TABLE IF NOT EXISTS sub_gameplay_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sub_racing_players (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  racer_name TEXT NOT NULL DEFAULT '',
  car_coins INTEGER NOT NULL DEFAULT 0,
  fuel INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  champions INTEGER NOT NULL DEFAULT 0,
  career_runs INTEGER NOT NULL DEFAULT 0,
  active_car_id TEXT NOT NULL DEFAULT 'starter',
  owned_cars_json TEXT NOT NULL DEFAULT '["starter"]',
  last_duel_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS sub_resources (
  group_id TEXT NOT NULL DEFAULT '',
  resource_key TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT '',
  resource_type TEXT NOT NULL DEFAULT 'text',
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, resource_key)
);

CREATE INDEX IF NOT EXISTS idx_activity_group_last_active ON activity(group_id, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_signin_group_points ON signin(group_id, points DESC);
CREATE INDEX IF NOT EXISTS idx_join_logs_group_timestamp ON join_logs(group_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_warnings_group_count ON warnings(group_id, count DESC);
CREATE INDEX IF NOT EXISTS idx_self_recall_due_status ON self_recall_tasks(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_recall_due_status ON recall_tasks(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_sub_players_gold ON sub_players(group_id, gold DESC);
CREATE INDEX IF NOT EXISTS idx_sub_players_value ON sub_players(group_id, value DESC);
CREATE INDEX IF NOT EXISTS idx_sub_players_level ON sub_players(group_id, level DESC, exp DESC);
CREATE INDEX IF NOT EXISTS idx_sub_contracts_master ON sub_contracts(group_id, master_id, state);
CREATE INDEX IF NOT EXISTS idx_sub_gameplay_events_group_created ON sub_gameplay_events(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_racing_wins ON sub_racing_players(group_id, wins DESC);
CREATE INDEX IF NOT EXISTS idx_sub_racing_champions ON sub_racing_players(group_id, champions DESC);
