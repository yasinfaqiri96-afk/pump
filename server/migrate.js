'use strict';
/* ============================================================
   مهاجرت سکیما — ترتیبی، تکرارپذیر، قابل بازرسی
   هر مهاجرت یک بار اجرا می‌شود و در جدول schema_version ثبت می‌گردد.
   قبل از اجرای اولین مهاجرت روی یک دیتابیس دارای داده، بکاپ گرفته می‌شود.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

/* ---------- کمک‌کننده‌های تکرارپذیر ---------- */
function cols(db, table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); }
  catch (_) { return []; }
}
function hasTable(db, table) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}
function addCol(db, table, col, decl) {
  if (!hasTable(db, table)) return;
  if (cols(db, table).indexOf(col) >= 0) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

/* ---------- فهرست مهاجرت‌ها ----------
   شماره‌ها هرگز تغییر نمی‌کنند و دوباره استفاده نمی‌شوند. */
const MIGRATIONS = [

  /* ============================================================
     ۰۰۱ — جلوگیری از ثبت دوباره (Idempotency)
     ============================================================ */
  {
    id: 1, name: 'idempotency-keys',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS idem_key (
          key        TEXT PRIMARY KEY,
          scope      TEXT NOT NULL,
          user_id    INTEGER,
          result     TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_idem_at ON idem_key(created_at);
      `);
    }
  },

  /* ============================================================
     ۰۰۲ — سند انتقال بین تانک‌ها
     ============================================================ */
  {
    id: 2, name: 'tank-transfer-document',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tank_transfer (
          id            INTEGER PRIMARY KEY,
          station_id    INTEGER NOT NULL REFERENCES station(id),
          from_tank_id  INTEGER NOT NULL REFERENCES tank(id),
          to_tank_id    INTEGER NOT NULL REFERENCES tank(id),
          product_id    INTEGER NOT NULL REFERENCES product(id),
          doc_date      TEXT NOT NULL,
          qty_l         REAL NOT NULL,
          unit_cost     REAL NOT NULL DEFAULT 0,
          cost_amount   REAL NOT NULL DEFAULT 0,
          dip_before_mm REAL, dip_after_mm REAL,
          temp_c        REAL, density15 REAL,
          status        TEXT NOT NULL DEFAULT 'posted',   -- posted | reversed | reversal
          reversal_of   INTEGER,
          reason        TEXT,
          note          TEXT,
          created_by    INTEGER,
          created_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_transfer_station ON tank_transfer(station_id, doc_date DESC);
        CREATE INDEX IF NOT EXISTS ix_transfer_tank ON tank_transfer(from_tank_id, to_tank_id);
      `);
    }
  },

  /* ============================================================
     ۰۰۳ — موتر مشتری و فروش قرضی نازل
     ============================================================ */
  {
    id: 3, name: 'customer-vehicles-and-credit-tickets',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle (
          id           INTEGER PRIMARY KEY,
          party_id     INTEGER NOT NULL REFERENCES party(id) ON DELETE CASCADE,
          plate_no     TEXT NOT NULL,
          kind         TEXT,                -- موتر باربری | موتر سواری | جنراتور | ...
          product_id   INTEGER REFERENCES product(id),
          driver_name  TEXT,
          driver_phone TEXT,
          credit_limit REAL NOT NULL DEFAULT 0,
          note         TEXT,
          active       INTEGER NOT NULL DEFAULT 1,
          created_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_vehicle_party ON vehicle(party_id, active);
        CREATE INDEX IF NOT EXISTS ix_vehicle_plate ON vehicle(plate_no);

        /* بلیت قرضی: بخشی از فروش همان شفت که نقد نیست.
           هیچ stock_move نمی‌سازد — لیتر آن قبلاً در ریدینگ نازل حساب شده است. */
        CREATE TABLE IF NOT EXISTS credit_ticket (
          id          INTEGER PRIMARY KEY,
          station_id  INTEGER NOT NULL REFERENCES station(id),
          shift_id    INTEGER REFERENCES shift(id),
          doc_date    TEXT NOT NULL,
          party_id    INTEGER NOT NULL REFERENCES party(id),
          vehicle_id  INTEGER REFERENCES vehicle(id),
          nozzle_id   INTEGER REFERENCES nozzle(id),
          product_id  INTEGER REFERENCES product(id),
          qty_l       REAL NOT NULL DEFAULT 0,
          unit_price  REAL NOT NULL DEFAULT 0,
          amount      REAL NOT NULL DEFAULT 0,
          ticket_no   TEXT,
          driver_name TEXT,
          status      TEXT NOT NULL DEFAULT 'posted',   -- posted | reversed | reversal
          reversal_of INTEGER,
          note        TEXT,
          created_by  INTEGER,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_ticket_shift ON credit_ticket(shift_id);
        CREATE INDEX IF NOT EXISTS ix_ticket_party ON credit_ticket(party_id, doc_date DESC);
        CREATE INDEX IF NOT EXISTS ix_ticket_vehicle ON credit_ticket(vehicle_id, doc_date DESC);
      `);
    }
  },

  /* ============================================================
     ۰۰۴ — تغییر نرخ وسط شفت (نقطه کنترل نرخ)
     ============================================================ */
  {
    id: 4, name: 'mid-shift-price-checkpoint',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS price_checkpoint (
          id         INTEGER PRIMARY KEY,
          shift_id   INTEGER NOT NULL REFERENCES shift(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES product(id),
          price_id   INTEGER REFERENCES price(id),
          at         TEXT NOT NULL,
          old_price  REAL NOT NULL,
          new_price  REAL NOT NULL,
          note       TEXT,
          created_by INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_pchk_shift ON price_checkpoint(shift_id);

        /* ریدینگ نازل در لحظه تغییر نرخ */
        CREATE TABLE IF NOT EXISTS price_checkpoint_reading (
          id            INTEGER PRIMARY KEY,
          checkpoint_id INTEGER NOT NULL REFERENCES price_checkpoint(id) ON DELETE CASCADE,
          nozzle_id     INTEGER NOT NULL REFERENCES nozzle(id),
          reading       REAL NOT NULL,
          rollovers     INTEGER NOT NULL DEFAULT 0,
          UNIQUE(checkpoint_id, nozzle_id)
        );

        /* بخش‌های فروش هر نازل — یک سطر برای هر بازه نرخ */
        CREATE TABLE IF NOT EXISTS nozzle_segment (
          id            INTEGER PRIMARY KEY,
          shift_id      INTEGER NOT NULL REFERENCES shift(id) ON DELETE CASCADE,
          nozzle_id     INTEGER NOT NULL REFERENCES nozzle(id),
          seq           INTEGER NOT NULL,
          checkpoint_id INTEGER REFERENCES price_checkpoint(id),
          opening       REAL NOT NULL,
          closing       REAL NOT NULL,
          rollovers     INTEGER NOT NULL DEFAULT 0,
          sold_l        REAL NOT NULL DEFAULT 0,
          price         REAL NOT NULL DEFAULT 0,
          amount        REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS ix_seg_shift ON nozzle_segment(shift_id, nozzle_id, seq);
      `);
    }
  },

  /* ============================================================
     ۰۰۵ — بستن روز
     ============================================================ */
  {
    id: 5, name: 'daily-close',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS day_close (
          id          INTEGER PRIMARY KEY,
          station_id  INTEGER NOT NULL REFERENCES station(id),
          doc_date    TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'closed',   -- closed | reopened
          total_liters REAL NOT NULL DEFAULT 0,
          total_amount REAL NOT NULL DEFAULT 0,
          cash_amount  REAL NOT NULL DEFAULT 0,
          credit_amount REAL NOT NULL DEFAULT 0,
          expense_amount REAL NOT NULL DEFAULT 0,
          note        TEXT,
          closed_by   INTEGER,
          closed_at   TEXT NOT NULL,
          reopened_by INTEGER,
          reopened_at TEXT,
          reopen_reason TEXT,
          UNIQUE(station_id, doc_date)
        );
        CREATE INDEX IF NOT EXISTS ix_dayclose ON day_close(station_id, doc_date DESC);
      `);
    }
  },

  /* ============================================================
     ۰۰۶ — نسخه‌بندی جدول سنجش تانک
     ============================================================ */
  {
    id: 6, name: 'tank-calibration-versions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tank_calib_version (
          id             INTEGER PRIMARY KEY,
          tank_id        INTEGER NOT NULL REFERENCES tank(id) ON DELETE CASCADE,
          version        INTEGER NOT NULL,
          effective_from TEXT NOT NULL,
          source         TEXT,             -- real | linear
          certificate_no TEXT,
          issued_by      TEXT,
          next_check     TEXT,
          point_count    INTEGER NOT NULL DEFAULT 0,
          note           TEXT,
          created_by     INTEGER,
          created_at     TEXT NOT NULL,
          UNIQUE(tank_id, version)
        );
        CREATE INDEX IF NOT EXISTS ix_calibver_tank ON tank_calib_version(tank_id, effective_from DESC);

        /* نقاط سنجش هر نسخه. جدول قدیمی tank_calib به عنوان «نسخه فعال» باقی می‌ماند
           تا هیچ کد یا داده موجودی نشکند. */
        CREATE TABLE IF NOT EXISTS tank_calib_point (
          version_id INTEGER NOT NULL REFERENCES tank_calib_version(id) ON DELETE CASCADE,
          dip_mm     REAL NOT NULL,
          volume_l   REAL NOT NULL,
          PRIMARY KEY (version_id, dip_mm)
        );
      `);
      addCol(db, 'tank', 'calib_version_id', 'INTEGER');
      addCol(db, 'dip', 'calib_version_id', 'INTEGER');
      addCol(db, 'receipt', 'calib_version_id', 'INTEGER');

      /* داده موجود: اگر تانکی نقاط سنجش دارد ولی نسخه‌ای ندارد، نسخه ۱ ساخته شود. */
      if (hasTable(db, 'tank_calib')) {
        const tanks = db.prepare(
          `SELECT DISTINCT tank_id FROM tank_calib`).all();
        for (const t of tanks) {
          const exists = db.prepare(
            `SELECT id FROM tank_calib_version WHERE tank_id=?`).get(t.tank_id);
          if (exists) continue;
          const pts = db.prepare(
            `SELECT dip_mm, volume_l FROM tank_calib WHERE tank_id=? ORDER BY dip_mm`).all(t.tank_id);
          const at = new Date().toISOString();
          const r = db.prepare(`INSERT INTO tank_calib_version
            (tank_id,version,effective_from,source,point_count,note,created_at)
            VALUES (?,?,?,?,?,?,?)`)
            .run(t.tank_id, 1, at.slice(0, 10), 'real', pts.length,
              'نسخه اولیه — از داده موجود ساخته شد', at);
          const vid = Number(r.lastInsertRowid);
          const ins = db.prepare(
            `INSERT OR REPLACE INTO tank_calib_point (version_id,dip_mm,volume_l) VALUES (?,?,?)`);
          for (const p of pts) ins.run(vid, p.dip_mm, p.volume_l);
          db.prepare(`UPDATE tank SET calib_version_id=? WHERE id=?`).run(vid, t.tank_id);
        }
      }
    }
  },

  /* ============================================================
     ۰۰۷ — تاریخچه کالیبراسیون نازل
     ============================================================ */
  {
    id: 7, name: 'nozzle-calibration-history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS nozzle_calib (
          id             INTEGER PRIMARY KEY,
          nozzle_id      INTEGER NOT NULL REFERENCES nozzle(id) ON DELETE CASCADE,
          effective_from TEXT NOT NULL,
          meter_factor   REAL NOT NULL DEFAULT 1,
          error_ml       REAL,             -- خطای اندازه‌گیری در ۵ لیتر (میلی‌لیتر)
          next_check     TEXT,
          certificate_no TEXT,
          checked_by     TEXT,
          note           TEXT,
          created_by     INTEGER,
          created_at     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_nzcal ON nozzle_calib(nozzle_id, effective_from DESC);
      `);
      addCol(db, 'nozzle', 'calib_date', 'TEXT');
      addCol(db, 'nozzle', 'next_check', 'TEXT');
      addCol(db, 'nozzle_reading', 'meter_factor_used', 'REAL');

      /* برای هر نازل موجود یک سطر تاریخچه با ضریب فعلی ثبت شود. */
      if (hasTable(db, 'nozzle')) {
        const nz = db.prepare(`SELECT id, meter_factor FROM nozzle`).all();
        const at = new Date().toISOString();
        for (const n of nz) {
          const e = db.prepare(`SELECT id FROM nozzle_calib WHERE nozzle_id=?`).get(n.id);
          if (e) continue;
          db.prepare(`INSERT INTO nozzle_calib
            (nozzle_id,effective_from,meter_factor,note,created_at)
            VALUES (?,?,?,?,?)`)
            .run(n.id, at.slice(0, 10), n.meter_factor || 1,
              'ثبت اولیه — از ضریب موجود ساخته شد', at);
        }
      }
    }
  },

  /* ============================================================
     ۰۰۸ — مهر تجهیزات
     ============================================================ */
  {
    id: 8, name: 'equipment-seals',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS equipment_seal (
          id          INTEGER PRIMARY KEY,
          entity      TEXT NOT NULL,       -- nozzle | dispenser | tank
          entity_id   INTEGER NOT NULL,
          seal_no     TEXT NOT NULL,
          applied_on  TEXT NOT NULL,
          applied_by  TEXT,
          removed_on  TEXT,
          removed_reason TEXT,
          note        TEXT,
          created_by  INTEGER,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_seal_entity ON equipment_seal(entity, entity_id, applied_on DESC);
      `);
    }
  },

  /* ============================================================
     ۰۰۹ — کنترل کیفیت محموله
     ============================================================ */
  {
    id: 9, name: 'quality-check',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quality_check (
          id          INTEGER PRIMARY KEY,
          receipt_id  INTEGER REFERENCES receipt(id),
          station_id  INTEGER,
          tank_id     INTEGER,
          sample_date TEXT NOT NULL,
          density15   REAL,
          temp_c      REAL,
          water_ppm   REAL,
          result      TEXT NOT NULL DEFAULT 'pending',   -- pass | fail | pending
          lab_name    TEXT,
          certificate_no TEXT,
          note        TEXT,
          created_by  INTEGER,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_quality_receipt ON quality_check(receipt_id);
      `);
    }
  },

  /* ============================================================
     ۰۱۰ — اسعار روی هر سند مالی
     ============================================================ */
  {
    id: 10, name: 'multi-currency-fields',
    up(db) {
      /* money_move از قبل currency/fx_rate/amount_base دارد.
         این‌جا فقط اسناد سرمنشأ کامل می‌شوند. */
      addCol(db, 'expense', 'amount_base', 'REAL');
      addCol(db, 'receipt', 'total_cost_ccy', 'REAL');   // مبلغ به ارز سند
      addCol(db, 'bulk_sale', 'amount_base', 'REAL');
      addCol(db, 'fx_rate', 'note', 'TEXT');
      addCol(db, 'fx_rate', 'created_at', 'TEXT');

      /* پر کردن مقادیر قدیمی */
      if (cols(db, 'expense').indexOf('amount_base') >= 0)
        db.exec(`UPDATE expense SET amount_base = amount * COALESCE(fx_rate,1)
                 WHERE amount_base IS NULL`);
      if (cols(db, 'bulk_sale').indexOf('amount_base') >= 0)
        db.exec(`UPDATE bulk_sale SET amount_base = amount * COALESCE(fx_rate,1)
                 WHERE amount_base IS NULL`);
    }
  },

  /* ============================================================
     ۰۱۱ — امانتی (مالکیت موجودی)
     ============================================================ */
  {
    id: 11, name: 'consignment-ownership',
    up(db) {
      addCol(db, 'stock_move', 'owner_party_id', 'INTEGER');   // خالی = مال خود ما
      addCol(db, 'tank', 'opening_owner_id', 'INTEGER');
      addCol(db, 'receipt', 'owner_party_id', 'INTEGER');
      addCol(db, 'bulk_sale', 'owner_party_id', 'INTEGER');
      db.exec(`CREATE INDEX IF NOT EXISTS ix_sm_owner ON stock_move(tank_id, owner_party_id)`);
    }
  },

  /* ============================================================
     ۰۱۲ — پیش‌خرید و پیش‌فروش (ماژول اختیاری)
     ============================================================ */
  {
    id: 12, name: 'fuel-orders',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS fuel_order (
          id           INTEGER PRIMARY KEY,
          station_id   INTEGER NOT NULL REFERENCES station(id),
          kind         TEXT NOT NULL,      -- purchase | sale
          party_id     INTEGER REFERENCES party(id),
          product_id   INTEGER NOT NULL REFERENCES product(id),
          doc_date     TEXT NOT NULL,
          due_date     TEXT,
          qty_l        REAL NOT NULL DEFAULT 0,
          qty_mt       REAL NOT NULL DEFAULT 0,
          unit_price   REAL NOT NULL DEFAULT 0,
          currency     TEXT NOT NULL DEFAULT 'AFN',
          fx_rate      REAL NOT NULL DEFAULT 1,
          amount       REAL NOT NULL DEFAULT 0,
          prepaid      REAL NOT NULL DEFAULT 0,
          delivered_l  REAL NOT NULL DEFAULT 0,
          status       TEXT NOT NULL DEFAULT 'open',  -- open | in_transit | received | delivered | closed | cancelled
          ref_no       TEXT,
          note         TEXT,
          created_by   INTEGER,
          created_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_order_station ON fuel_order(station_id, kind, status);
      `);
      addCol(db, 'receipt', 'order_id', 'INTEGER');
      addCol(db, 'bulk_sale', 'order_id', 'INTEGER');
    }
  },

  /* ============================================================
     ۰۱۳ — فروش مستقیم (پا به پا) و برگشت اسناد
     ============================================================ */
  {
    id: 13, name: 'direct-sale-and-reversal',
    up(db) {
      addCol(db, 'bulk_sale', 'sale_kind', "TEXT NOT NULL DEFAULT 'stock'");   // stock | direct
      addCol(db, 'bulk_sale', 'status', "TEXT NOT NULL DEFAULT 'posted'");
      addCol(db, 'bulk_sale', 'reversal_of', 'INTEGER');
      addCol(db, 'bulk_sale', 'reverse_reason', 'TEXT');
      addCol(db, 'receipt', 'reversal_of', 'INTEGER');
      addCol(db, 'receipt', 'reverse_reason', 'TEXT');
      addCol(db, 'expense', 'status', "TEXT NOT NULL DEFAULT 'posted'");
      addCol(db, 'expense', 'reversal_of', 'INTEGER');
    }
  },

  /* ============================================================
     ۰۱۴ — بکاپ
     ============================================================ */
  {
    id: 14, name: 'backup-log',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS backup_log (
          id         INTEGER PRIMARY KEY,
          at         TEXT NOT NULL,
          kind       TEXT NOT NULL,        -- manual | auto | pre_restore | pre_migrate
          file_path  TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          ok         INTEGER NOT NULL DEFAULT 1,
          message    TEXT,
          created_by INTEGER
        );
        CREATE INDEX IF NOT EXISTS ix_backup_at ON backup_log(at DESC);
      `);
    }
  },

  /* ============================================================
     ۰۱۵ — ثبت تاریخ سند در تعدیل موجودی و کارایی
     ============================================================ */
  {
    id: 15, name: 'performance-indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS ix_sm_station_date ON stock_move(station_id, doc_date);
        CREATE INDEX IF NOT EXISTS ix_sm_prod_date    ON stock_move(product_id, doc_date);
        CREATE INDEX IF NOT EXISTS ix_mm_station_date ON money_move(station_id, doc_date);
        CREATE INDEX IF NOT EXISTS ix_mm_src          ON money_move(source_type, source_id);
        CREATE INDEX IF NOT EXISTS ix_dip_date        ON dip(doc_date);
        CREATE INDEX IF NOT EXISTS ix_dip_station     ON dip(station_id, doc_date);
        CREATE INDEX IF NOT EXISTS ix_nr_product      ON nozzle_reading(product_id);
        CREATE INDEX IF NOT EXISTS ix_exp_date        ON expense(doc_date);
        CREATE INDEX IF NOT EXISTS ix_bulk_date       ON bulk_sale(doc_date);
        CREATE INDEX IF NOT EXISTS ix_alert_code      ON alert(code, resolved);
        CREATE INDEX IF NOT EXISTS ix_session_exp     ON session(expires_at);
      `);
    }
  },

  /* ============================================================
     ۰۱۶ — تعدیل موجودی به عنوان سند مستقل
     ============================================================ */
  {
    id: 16, name: 'stock-adjust-document',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS stock_adjust (
          id          INTEGER PRIMARY KEY,
          station_id  INTEGER NOT NULL REFERENCES station(id),
          tank_id     INTEGER NOT NULL REFERENCES tank(id),
          product_id  INTEGER NOT NULL REFERENCES product(id),
          doc_date    TEXT NOT NULL,
          kind        TEXT NOT NULL,        -- adjust | genset
          qty_l       REAL NOT NULL,        -- مثبت = ورود، منفی = خروج
          unit_cost   REAL NOT NULL DEFAULT 0,
          reason      TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'posted',
          reversal_of INTEGER,
          created_by  INTEGER,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_adj_tank ON stock_adjust(tank_id, doc_date DESC);
      `);
    }
  },

  /* ============================================================
     ۰۱۷ — یکسان‌سازی واحد دانسیته در داده موجود
     دانسیته باید همه‌جا kg/لیتر باشد (مثلاً 0.84).
     اگر جایی kg/m³ ثبت شده (مثلاً 840) تقسیم بر ۱۰۰۰ می‌شود.
     ============================================================ */
  {
    id: 17, name: 'normalize-density-units',
    up(db) {
      const fix = (table, col) => {
        if (!hasTable(db, table) || cols(db, table).indexOf(col) < 0) return;
        db.exec(`UPDATE ${table} SET ${col} = ${col}/1000.0 WHERE ${col} IS NOT NULL AND ${col} > 10`);
      };
      fix('product', 'default_density');
      fix('stock_move', 'density15');
      fix('dip', 'density15');
      fix('receipt', 'density15');
      fix('receipt', 'src_density15');
      fix('bulk_sale', 'density15');
    }
  },

  /* ============================================================
     ۰۱۸ — دلیل ثبت با تاریخ گذشته
     ============================================================ */
  {
    id: 18, name: 'backdate-reason',
    up(db) {
      const t = ['receipt', 'bulk_sale', 'expense', 'dip', 'tank_transfer', 'credit_ticket', 'stock_adjust'];
      for (const x of t) addCol(db, x, 'backdate_reason', 'TEXT');
    }
  }
];

/* ---------- اجرا ---------- */
function ensureVersionTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
}

function applied(db) {
  const set = new Set();
  for (const r of db.prepare(`SELECT id FROM schema_version`).all()) set.add(r.id);
  return set;
}

/* بکاپ قبل از مهاجرت — فقط وقتی دیتابیس داده واقعی دارد */
function preMigrateBackup(db, dbPath) {
  try {
    if (!dbPath || dbPath === ':memory:') return null;
    if (!hasTable(db, 'app_user')) return null;
    const c = db.prepare(`SELECT COUNT(*) c FROM app_user`).get().c;
    if (!c) return null;
    const dir = path.join(path.dirname(path.dirname(dbPath)), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, 'pre-migrate-' + stamp + '.db');
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return file;
  } catch (e) {
    console.error('  ! بکاپ قبل از مهاجرت ناکام شد:', e.message);
    return null;
  }
}

function migrate(db, dbPath) {
  ensureVersionTable(db);
  const done = applied(db);
  const pending = MIGRATIONS.filter(m => !done.has(m.id)).sort((a, b) => a.id - b.id);
  if (!pending.length) return { applied: [], backup: null };

  const backup = preMigrateBackup(db, dbPath);
  const names = [];
  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.prepare(`INSERT INTO schema_version (id,name,applied_at) VALUES (?,?,?)`)
        .run(m.id, m.name, new Date().toISOString());
      db.exec('COMMIT');
      names.push(m.id + ' — ' + m.name);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) { }
      throw new Error('مهاجرت ' + m.id + ' (' + m.name + ') ناکام شد: ' + e.message);
    }
  }
  return { applied: names, backup };
}

module.exports = { migrate, MIGRATIONS, addCol, cols, hasTable };
