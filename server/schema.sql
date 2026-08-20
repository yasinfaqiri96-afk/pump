-- ============================================================
-- سیستم مدیریت تانک تیل و پمپ استیشن — سکیما
-- SQLite. تمام مقادیر پولی/حجمی REAL با گرد کردن کنترل‌شده در لایه منطق.
-- دو دفتر تغییرناپذیر: stock_move و money_move.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- امنیت ----------
CREATE TABLE IF NOT EXISTS app_user (
  id           INTEGER PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  full_name    TEXT NOT NULL,
  role         TEXT NOT NULL,              -- owner | manager | accountant | station | operator | dipper
  station_id   INTEGER,                    -- خالی = تمام استیشن‌ها
  pin_hash     TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  user_id   INTEGER,
  user_name TEXT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  detail    TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at DESC);

-- ---------- اساسات ----------
CREATE TABLE IF NOT EXISTS station (
  id       INTEGER PRIMARY KEY,
  code     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  province TEXT,
  address  TEXT,
  phone    TEXT,
  license_no    TEXT,
  license_expiry TEXT,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  uom           TEXT NOT NULL DEFAULT 'لیتر',   -- لیتر | کیلوگرام | عدد
  density_group TEXT NOT NULL DEFAULT 'diesel', -- gasoline|diesel|jet|lpg|none
  default_density REAL DEFAULT 0.84,
  tolerance_pct REAL NOT NULL DEFAULT 0.5,
  is_mass       INTEGER NOT NULL DEFAULT 0,     -- ۱ = بر اساس کیلوگرام (گاز مایع)
  color         TEXT DEFAULT '#0B8457',
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tank (
  id            INTEGER PRIMARY KEY,
  station_id    INTEGER NOT NULL REFERENCES station(id),
  product_id    INTEGER NOT NULL REFERENCES product(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  capacity_l    REAL NOT NULL DEFAULT 0,
  dead_stock_l  REAL NOT NULL DEFAULT 0,
  min_level_l   REAL NOT NULL DEFAULT 0,
  kind          TEXT DEFAULT 'زیرزمینی',
  opening_qty   REAL NOT NULL DEFAULT 0,
  opening_cost  REAL NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE(station_id, code)
);

CREATE TABLE IF NOT EXISTS tank_calib (
  tank_id  INTEGER NOT NULL REFERENCES tank(id) ON DELETE CASCADE,
  dip_mm   REAL NOT NULL,
  volume_l REAL NOT NULL,
  PRIMARY KEY (tank_id, dip_mm)
);

CREATE TABLE IF NOT EXISTS dispenser (
  id         INTEGER PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES station(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE(station_id, code)
);

CREATE TABLE IF NOT EXISTS nozzle (
  id           INTEGER PRIMARY KEY,
  dispenser_id INTEGER NOT NULL REFERENCES dispenser(id),
  tank_id      INTEGER NOT NULL REFERENCES tank(id),
  code         TEXT NOT NULL,
  meter_digits INTEGER NOT NULL DEFAULT 6,
  meter_factor REAL NOT NULL DEFAULT 1,
  last_reading REAL NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

-- ---------- طرف حساب ----------
CREATE TABLE IF NOT EXISTS party (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,        -- customer | supplier | transporter | employee
  code         TEXT,
  name         TEXT NOT NULL,
  phone        TEXT,
  address      TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,
  credit_days  INTEGER NOT NULL DEFAULT 0,
  opening_bal  REAL NOT NULL DEFAULT 0,   -- مثبت = طلب ما از او
  salary       REAL NOT NULL DEFAULT 0,
  note         TEXT,
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_party_kind ON party(kind, active);

-- ---------- نرخ ----------
CREATE TABLE IF NOT EXISTS price (
  id             INTEGER PRIMARY KEY,
  station_id     INTEGER REFERENCES station(id),   -- خالی = همه استیشن‌ها
  product_id     INTEGER NOT NULL REFERENCES product(id),
  price          REAL NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'AFN',
  effective_from TEXT NOT NULL,          -- تاریخ میلادی ISO
  note           TEXT,
  created_by     INTEGER,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_price_lookup ON price(product_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS fx_rate (
  id        INTEGER PRIMARY KEY,
  rate_date TEXT NOT NULL,
  ccy       TEXT NOT NULL,
  rate      REAL NOT NULL,     -- ۱ واحد ارز = چند واحد ارز پایه
  UNIQUE(rate_date, ccy)
);

-- ---------- دفتر موجودی (تغییرناپذیر) ----------
CREATE TABLE IF NOT EXISTS stock_move (
  id          INTEGER PRIMARY KEY,
  moved_at    TEXT NOT NULL,
  doc_date    TEXT NOT NULL,          -- میلادی ISO
  station_id  INTEGER NOT NULL,
  tank_id     INTEGER NOT NULL,
  product_id  INTEGER NOT NULL,
  direction   TEXT NOT NULL,          -- in | out
  qty_obs     REAL NOT NULL,
  temp_c      REAL,
  density15   REAL,
  vcf         REAL DEFAULT 1,
  qty15       REAL,
  qty_mt      REAL,
  unit_cost   REAL NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL,          -- opening|receipt|shift|bulk_sale|transfer|adjust|genset|test_return
  source_id   INTEGER,
  reversal_of INTEGER,
  note        TEXT,
  created_by  INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sm_tank ON stock_move(tank_id, doc_date);
CREATE INDEX IF NOT EXISTS ix_sm_src  ON stock_move(source_type, source_id);

-- ---------- دفتر پول (تغییرناپذیر) ----------
CREATE TABLE IF NOT EXISTS money_move (
  id          INTEGER PRIMARY KEY,
  moved_at    TEXT NOT NULL,
  doc_date    TEXT NOT NULL,
  station_id  INTEGER NOT NULL,
  account     TEXT NOT NULL,          -- cash|bank|hawala|receivable|payable|sales|cogs|expense|equity
  party_id    INTEGER,
  direction   TEXT NOT NULL,          -- in | out
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'AFN',
  fx_rate     REAL NOT NULL DEFAULT 1,
  amount_base REAL NOT NULL,
  method      TEXT,                   -- cash|bank|hawala|cheque|credit|coupon
  ref_no      TEXT,
  source_type TEXT NOT NULL,
  source_id   INTEGER,
  reversal_of INTEGER,
  note        TEXT,
  created_by  INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mm_party ON money_move(party_id, doc_date);
CREATE INDEX IF NOT EXISTS ix_mm_acct  ON money_move(account, doc_date);

-- ---------- دیپ ----------
CREATE TABLE IF NOT EXISTS dip (
  id           INTEGER PRIMARY KEY,
  station_id   INTEGER NOT NULL REFERENCES station(id),
  tank_id      INTEGER NOT NULL REFERENCES tank(id),
  read_at      TEXT NOT NULL,
  doc_date     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'spot',  -- open|close|spot|pre_unload|post_unload
  dip_mm       REAL NOT NULL,
  water_mm     REAL NOT NULL DEFAULT 0,
  temp_c       REAL,
  density15    REAL,
  vol_gross_l  REAL NOT NULL,
  vol_water_l  REAL NOT NULL DEFAULT 0,
  vol_net_l    REAL NOT NULL,
  vol15_l      REAL,
  book_l       REAL,          -- موجودی دفتری در همان لحظه
  variance_l   REAL,
  variance_pct REAL,
  shift_id     INTEGER,
  read_by      INTEGER,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dip_tank ON dip(tank_id, read_at DESC);

-- ---------- شفت ----------
CREATE TABLE IF NOT EXISTS shift (
  id            INTEGER PRIMARY KEY,
  station_id    INTEGER NOT NULL REFERENCES station(id),
  operator_id   INTEGER NOT NULL REFERENCES party(id),
  code          TEXT,
  doc_date      TEXT NOT NULL,
  opened_at     TEXT NOT NULL,
  closed_at     TEXT,
  float_amount  REAL NOT NULL DEFAULT 0,
  total_liters  REAL NOT NULL DEFAULT 0,
  total_amount  REAL NOT NULL DEFAULT 0,
  cash_expected REAL NOT NULL DEFAULT 0,
  cash_counted  REAL NOT NULL DEFAULT 0,
  cash_variance REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | closed
  opened_by     INTEGER,
  closed_by     INTEGER,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS ix_shift_station ON shift(station_id, doc_date DESC);

CREATE TABLE IF NOT EXISTS nozzle_reading (
  id           INTEGER PRIMARY KEY,
  shift_id     INTEGER NOT NULL REFERENCES shift(id) ON DELETE CASCADE,
  nozzle_id    INTEGER NOT NULL REFERENCES nozzle(id),
  tank_id      INTEGER NOT NULL,
  product_id   INTEGER NOT NULL,
  opening      REAL NOT NULL DEFAULT 0,
  closing      REAL,
  rollovers    INTEGER NOT NULL DEFAULT 0,
  test_return_l REAL NOT NULL DEFAULT 0,
  sold_l       REAL NOT NULL DEFAULT 0,
  price        REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  UNIQUE(shift_id, nozzle_id)
);

CREATE TABLE IF NOT EXISTS shift_tender (
  id       INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shift(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,     -- credit | coupon | bank | hawala
  party_id INTEGER,
  amount   REAL NOT NULL,
  ref_no   TEXT,
  note     TEXT
);

-- ---------- ورود تیل (تخلیه) ----------
CREATE TABLE IF NOT EXISTS receipt (
  id             INTEGER PRIMARY KEY,
  station_id     INTEGER NOT NULL REFERENCES station(id),
  supplier_id    INTEGER REFERENCES party(id),
  transporter_id INTEGER REFERENCES party(id),
  tank_id        INTEGER NOT NULL REFERENCES tank(id),
  product_id     INTEGER NOT NULL REFERENCES product(id),
  doc_date       TEXT NOT NULL,
  waybill_no     TEXT,
  truck_plate    TEXT,
  driver_name    TEXT,
  driver_phone   TEXT,
  entry_port     TEXT,                 -- حیرتان | تورغندی | اسلام‌قلعه | تورخم | سپین‌بولدک | داخلی
  seal_out       TEXT,
  seal_in        TEXT,
  src_qty_mt     REAL DEFAULT 0,
  src_density15  REAL,
  src_temp       REAL,
  src_qty15      REAL DEFAULT 0,
  dip_before_mm  REAL, water_before_mm REAL DEFAULT 0,
  dip_after_mm   REAL, water_after_mm  REAL DEFAULT 0,
  vol_before_l   REAL, vol_after_l REAL,
  temp_c         REAL, density15 REAL,
  vol_obs_l      REAL DEFAULT 0,
  vcf            REAL DEFAULT 1,
  vol15_l        REAL DEFAULT 0,
  qty_mt         REAL DEFAULT 0,
  variance_mt    REAL DEFAULT 0,
  variance_pct   REAL DEFAULT 0,
  unit_cost      REAL DEFAULT 0,       -- به ارز سند، هر لیتر
  other_cost     REAL DEFAULT 0,       -- کرایه/گمرک/تخلیه — به ارز پایه
  total_cost     REAL DEFAULT 0,
  currency       TEXT DEFAULT 'AFN',
  fx_rate        REAL DEFAULT 1,
  quality_ok     INTEGER DEFAULT 1,
  quality_note   TEXT,
  payment_kind   TEXT DEFAULT 'credit',   -- cash | credit | hawala | bank
  status         TEXT NOT NULL DEFAULT 'posted',
  note           TEXT,
  created_by     INTEGER,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_receipt_station ON receipt(station_id, doc_date DESC);

-- ---------- فروش عمده ----------
CREATE TABLE IF NOT EXISTS bulk_sale (
  id           INTEGER PRIMARY KEY,
  station_id   INTEGER NOT NULL REFERENCES station(id),
  customer_id  INTEGER REFERENCES party(id),
  tank_id      INTEGER NOT NULL REFERENCES tank(id),
  product_id   INTEGER NOT NULL REFERENCES product(id),
  doc_date     TEXT NOT NULL,
  invoice_no   TEXT,
  qty_obs      REAL NOT NULL,
  temp_c       REAL, density15 REAL,
  vcf          REAL DEFAULT 1,
  qty15        REAL DEFAULT 0,
  qty_mt       REAL DEFAULT 0,
  price_basis  TEXT DEFAULT 'liter',     -- liter | liter15 | mt
  unit_price   REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  cost_amount  REAL NOT NULL DEFAULT 0,
  currency     TEXT DEFAULT 'AFN',
  fx_rate      REAL DEFAULT 1,
  truck_plate  TEXT, seal_no TEXT, driver_name TEXT,
  payment_kind TEXT DEFAULT 'credit',    -- cash | credit | hawala | bank
  note         TEXT,
  created_by   INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bulk_station ON bulk_sale(station_id, doc_date DESC);

-- ---------- مصارف ----------
CREATE TABLE IF NOT EXISTS expense (
  id         INTEGER PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES station(id),
  doc_date   TEXT NOT NULL,
  category   TEXT NOT NULL,        -- معاش | کرایه | برق | ترمیم | مالیه | ترانسپورت | متفرقه
  party_id   INTEGER,
  amount     REAL NOT NULL,
  currency   TEXT DEFAULT 'AFN',
  fx_rate    REAL DEFAULT 1,
  method     TEXT DEFAULT 'cash',
  ref_no     TEXT,
  note       TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_exp_station ON expense(station_id, doc_date DESC);

-- ---------- هشدار ضد-تقلب ----------
CREATE TABLE IF NOT EXISTS alert (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  station_id INTEGER,
  severity   TEXT NOT NULL,        -- high | medium | low
  code       TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT,
  ref_type   TEXT, ref_id INTEGER,
  resolved   INTEGER NOT NULL DEFAULT 0,
  resolved_by INTEGER, resolved_at TEXT, resolve_note TEXT
);
CREATE INDEX IF NOT EXISTS ix_alert_open ON alert(resolved, at DESC);

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- سه دفتر اصلی فقط افزودنی‌اند؛ اصلاح باید با سند معکوس انجام شود.
CREATE TRIGGER IF NOT EXISTS stock_move_no_update BEFORE UPDATE ON stock_move
BEGIN SELECT RAISE(ABORT, 'stock_move فقط افزودنی است'); END;
CREATE TRIGGER IF NOT EXISTS stock_move_no_delete BEFORE DELETE ON stock_move
BEGIN SELECT RAISE(ABORT, 'stock_move فقط افزودنی است'); END;
CREATE TRIGGER IF NOT EXISTS money_move_no_update BEFORE UPDATE ON money_move
BEGIN SELECT RAISE(ABORT, 'money_move فقط افزودنی است'); END;
CREATE TRIGGER IF NOT EXISTS money_move_no_delete BEFORE DELETE ON money_move
BEGIN SELECT RAISE(ABORT, 'money_move فقط افزودنی است'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log فقط افزودنی است'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log فقط افزودنی است'); END;
