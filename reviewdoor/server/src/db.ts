/**
 * ReviewDoor — SQLite persistence layer (PostgreSQL-compatible schema intent).
 * Authoritative transactional store for tenants, subscriptions, QR configuration,
 * payments, orders and audit state (Design Doc §3.2). WAL mode + busy_timeout so the
 * background scheduler can write concurrently with the API process.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = process.env.RD_DATA_DIR || path.join(process.cwd(), '.data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

export const DB_PATH = process.env.RD_DB_PATH || path.join(DATA_DIR, 'reviewdoor.db');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
  created_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  category TEXT,
  logo_path TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  cta TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_destinations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  qr_code_id TEXT,
  platform TEXT NOT NULL,
  label TEXT,
  url TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  health_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  last_checked_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  short_code TEXT NOT NULL UNIQUE,
  operational_state TEXT NOT NULL DEFAULT 'ENABLED',
  suspend_reason TEXT,
  destination_url TEXT NOT NULL,
  destination_platform TEXT NOT NULL,
  last_known_good_url TEXT,
  design_json TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS qr_versions (
  id TEXT PRIMARY KEY,
  qr_code_id TEXT NOT NULL REFERENCES qr_codes(id),
  destination_url TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  duration_days INTEGER NOT NULL,
  trial_days INTEGER NOT NULL DEFAULT 0,
  grace_days INTEGER NOT NULL DEFAULT 7,
  provisional_hours INTEGER NOT NULL DEFAULT 48,
  included_qrs INTEGER NOT NULL DEFAULT 1,
  downloads_allowed INTEGER NOT NULL DEFAULT 1,
  analytics_enabled INTEGER NOT NULL DEFAULT 1,
  card_entitled INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  recommended INTEGER NOT NULL DEFAULT 0,
  features TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_history (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  snapshot TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  plan_snapshot TEXT NOT NULL,
  status TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  provisional_until TEXT,
  provisional_source_receipt_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual_receipt',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  subscription_id TEXT REFERENCES subscriptions(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  purpose TEXT NOT NULL,
  expected_amount REAL NOT NULL,
  currency TEXT NOT NULL,
  payment_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  intent_id TEXT NOT NULL REFERENCES payment_intents(id),
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  extracted TEXT,
  extraction_meta TEXT,
  rule_results TEXT,
  risk_flags TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  admin_notes TEXT,
  credited_payment_id TEXT REFERENCES payments(id),
  submitted_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  intent_id TEXT NOT NULL REFERENCES payment_intents(id),
  receipt_id TEXT REFERENCES receipts(id),
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL,
  provider_event_id TEXT UNIQUE,
  transaction_ref TEXT UNIQUE,
  subscription_id TEXT,
  extended_period_end TEXT,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'CREDITED',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_events (
  id TEXT PRIMARY KEY,
  qr_code_id TEXT NOT NULL REFERENCES qr_codes(id),
  account_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  device_category TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  ip_hash TEXT,
  ip_expires_at TEXT,
  user_agent TEXT,
  referrer TEXT,
  correlation_id TEXT,
  scanned_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS funnel_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  account_id TEXT,
  context TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'card',
  palette TEXT NOT NULL,
  base TEXT NOT NULL,
  ink TEXT NOT NULL,
  accent INTEGER NOT NULL DEFAULT 0,
  printer_cfg TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS card_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  product TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  template_id TEXT REFERENCES design_templates(id),
  design_json TEXT NOT NULL,
  unit_price REAL NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',
  reviewer_notes TEXT,
  ship_name TEXT, ship_phone TEXT, ship_address TEXT,
  tracking_ref TEXT,
  entitlement_ok INTEGER NOT NULL DEFAULT 0,
  print_job_key TEXT UNIQUE,
  shipment_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  dedupe_key TEXT UNIQUE,
  delivery_status TEXT NOT NULL DEFAULT 'QUEUED',
  template_version TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_prefs (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  email INTEGER NOT NULL DEFAULT 1,
  whatsapp INTEGER NOT NULL DEFAULT 0,
  sms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  reply TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  before_summary TEXT,
  after_summary TEXT,
  outcome TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_account ON businesses(account_id);
CREATE INDEX IF NOT EXISTS idx_qr_business ON qr_codes(business_id);
CREATE INDEX IF NOT EXISTS idx_sub_account ON subscriptions(account_id);
CREATE INDEX IF NOT EXISTS idx_receipt_account ON receipts(account_id);
CREATE INDEX IF NOT EXISTS idx_scan_qr ON scan_events(qr_code_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  run_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status, run_at);
CREATE TABLE IF NOT EXISTS rate_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
`);

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM integration_settings WHERE key=?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}
export function setSetting(key: string, value: unknown) {
  db.prepare(
    'INSERT INTO integration_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export const nowIso = () => new Date().toISOString();
export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
