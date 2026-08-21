'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { migrate } = require('./migrate');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.PUMP_DB || path.join(DATA_DIR, 'pump.db');

/* ---------- تنظیمات موتور دیتابیس ----------
   foreign_keys: تمامیت ارجاعی روشن باشد.
   journal_mode=WAL: خواندن و نوشتن همزمان بدون قفل کامل.
   synchronous=FULL: برای سیستم مالی، در برق‌رفتگی معامله ثبت‌شده گم نشود.
   busy_timeout: به‌جای خطای فوری SQLITE_BUSY، پنج ثانیه صبر کند. */
const PRAGMAS = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;
`;

/* db قابل تعویض است تا «برگرداندن بکاپ» بدون بستن سرور کار کند.
   هیچ Statement آماده‌ای نگهداری نمی‌شود، پس تعویض بی‌خطر است. */
let db = null;
let MIG = null;

function openDb() {
  db = new DatabaseSync(DB_PATH);
  db.exec(PRAGMAS);
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  MIG = migrate(db, DB_PATH);
  return db;
}
openDb();

/* بعد از برگرداندن بکاپ: بستن، باز کردن دوباره، پاک کردن حافظه موقت */
function reopen() {
  try { db.close(); } catch (_) { }
  openDb();
  invalidateAll();
  return MIG;
}
function handle() { return db; }

/* ---------- کمک‌کننده‌ها ---------- */
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const exec = (sql) => db.exec(sql);
const now = () => new Date().toISOString();

/* ---------- معامله دیتابیس ----------
   تودرتو-پذیر: معامله بیرونی BEGIN IMMEDIATE می‌گیرد، درونی‌ها SAVEPOINT.
   بدون این، فراخوانی یک تابع دارای tx از داخل tx دیگر دیتابیس را
   در حالت نیمه‌ثبت‌شده رها می‌کرد. */
let txDepth = 0;
let spSeq = 0;

function tx(fn) {
  if (txDepth > 0) {
    const sp = 'sp_' + (++spSeq);
    db.exec('SAVEPOINT ' + sp);
    txDepth++;
    try {
      const r = fn();
      db.exec('RELEASE ' + sp);
      return r;
    } catch (e) {
      try { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); } catch (_) { }
      throw e;
    } finally { txDepth--; }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { }
    throw e;
  } finally { txDepth = 0; }
}

function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function round(v, d) { const f = Math.pow(10, d === undefined ? 4 : d); return Math.round(num(v) * f) / f; }

/* ---------- رمز ---------- */
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return salt + ':' + h;
}
function checkPin(pin, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const [salt, h] = stored.split(':');
  const c = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(c, 'hex'));
}

/* ---------- ثبت وقایع ---------- */
function audit(user, action, entity, entityId, detail) {
  run(`INSERT INTO audit_log (at,user_id,user_name,action,entity,entity_id,detail)
       VALUES (?,?,?,?,?,?,?)`,
    now(), user ? user.id : null, user ? user.full_name : 'سیستم',
    action, entity || null, entityId == null ? null : String(entityId),
    detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null);
}

/* ---------- هشدار ---------- */
function raiseAlert(stationId, severity, code, title, detail, refType, refId) {
  /* هشدار باز با همان کد و همان موضوع تکرار نمی‌شود — به‌روز می‌گردد و شمارش می‌خورد.
     این جلوگیری می‌کند از انباشت ده‌ها هشدار یکسان برای یک تانک. */
  const dup = refId == null && !refType
    ? get(`SELECT id, detail FROM alert WHERE code=? AND title=? AND ref_type IS NULL AND resolved=0`, code, title)
    : get(`SELECT id, detail FROM alert WHERE code=? AND ref_type=? AND ref_id IS ? AND resolved=0`,
      code, refType || null, refId == null ? null : refId);
  if (dup) {
    const m = /\[تکرار (\d+) بار\]/.exec(dup.detail || '');
    const cnt = (m ? Number(m[1]) : 1) + 1;
    run(`UPDATE alert SET at=?, severity=?, detail=? WHERE id=?`,
      now(), severity, (detail || '') + '  [تکرار ' + cnt + ' بار]', dup.id);
    return dup.id;
  }
  const r = run(`INSERT INTO alert (at,station_id,severity,code,title,detail,ref_type,ref_id)
                 VALUES (?,?,?,?,?,?,?,?)`,
    now(), stationId || null, severity, code, title, detail || null,
    refType || null, refId == null ? null : refId);
  return Number(r.lastInsertRowid);
}

/* ============================================================
   حافظه موقت موجودی و بهای تمام‌شده
   محاسبه WAC یعنی بازخوانی تمام حرکات یک تانک. بدون حافظه موقت،
   یک بار باز کردن داشبورد با ده‌ها هزار سطر، ثانیه‌ها طول می‌کشد.
   قاعده: با هر نوشتن، فقط ورودی همان تانک پاک می‌شود (نه به‌روزرسانی).
   پس اگر معامله ROLLBACK شود، مقدار دوباره از دیتابیس خوانده می‌گردد
   و همیشه درست است.
   ============================================================ */
const tankCache = new Map();     // tank_id -> { qty, val, wac }
const partyCache = new Map();    // party_id -> balance

function invalidateTank(tankId) { tankCache.delete(Number(tankId)); }
function invalidateParty(partyId) { if (partyId != null) partyCache.delete(Number(partyId)); }
function invalidateAll() { tankCache.clear(); partyCache.clear(); }

/* ---------- دفتر موجودی ---------- */
function addStockMove(m, user) {
  const r = run(`INSERT INTO stock_move
    (moved_at,doc_date,station_id,tank_id,product_id,direction,qty_obs,temp_c,density15,
     vcf,qty15,qty_mt,unit_cost,source_type,source_id,reversal_of,note,owner_party_id,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    m.moved_at || now(), m.doc_date, m.station_id, m.tank_id, m.product_id,
    m.direction, round(m.qty_obs, 3), m.temp_c ?? null, m.density15 ?? null,
    round(m.vcf ?? 1, 7), round(m.qty15 ?? m.qty_obs, 3), round(m.qty_mt ?? 0, 6),
    round(m.unit_cost ?? 0, 6), m.source_type, m.source_id ?? null,
    m.reversal_of ?? null, m.note ?? null, m.owner_party_id ?? null,
    user ? user.id : null, now());
  invalidateTank(m.tank_id);
  return Number(r.lastInsertRowid);
}

/* موجودی دفتری تانک تا یک لحظه */
function tankBook(tankId, untilDate) {
  tankId = Number(tankId);
  if (!untilDate) return tankState(tankId).qty;
  const t = get(`SELECT opening_qty FROM tank WHERE id=?`, tankId);
  const opening = t ? num(t.opening_qty) : 0;
  const q = get(`SELECT
        COALESCE(SUM(CASE WHEN direction='in' THEN qty_obs ELSE -qty_obs END),0) v
      FROM stock_move WHERE tank_id=? AND doc_date<=?`, tankId, untilDate);
  return round(opening + num(q.v), 3);
}

/* موجودی فزیکی و ارزش دفتری تانک — یک بار محاسبه، بعد از حافظه موقت */
function tankState(tankId) {
  tankId = Number(tankId);
  const hit = tankCache.get(tankId);
  if (hit) return hit;

  const t = get(`SELECT opening_qty, opening_cost, opening_owner_id FROM tank WHERE id=?`, tankId);
  let qty = t ? num(t.opening_qty) : 0;
  let val = qty * (t ? num(t.opening_cost) : 0);
  const owned = {};                       // party_id|'' -> qty
  const openOwner = t && t.opening_owner_id ? String(t.opening_owner_id) : '';
  owned[openOwner] = qty;

  const moves = all(`SELECT direction, qty_obs, unit_cost, owner_party_id FROM stock_move
                     WHERE tank_id=? ORDER BY id`, tankId);
  for (const m of moves) {
    const key = m.owner_party_id ? String(m.owner_party_id) : '';
    const q = num(m.qty_obs);
    if (m.direction === 'in') {
      val += q * num(m.unit_cost);
      qty += q;
      owned[key] = num(owned[key]) + q;
    } else {
      const wac = qty > 0 ? val / qty : 0;
      val -= q * wac;
      qty -= q;
      owned[key] = num(owned[key]) - q;
      if (qty <= 0) { qty = Math.max(qty, 0); val = Math.max(val, 0); }
    }
  }
  const state = {
    qty: round(qty, 3),
    value: round(val, 2),
    wac: qty > 0 ? round(val / qty, 6) : round(num(t && t.opening_cost), 6),
    owned_l: round(num(owned['']), 3),
    consigned: Object.keys(owned).filter(k => k && Math.abs(owned[k]) > 0.001)
      .map(k => ({ party_id: Number(k), qty_l: round(owned[k], 3) }))
  };
  tankCache.set(tankId, state);
  return state;
}

/* میانگین موزون بهای تمام‌شده تانک */
function tankWac(tankId) { return tankState(tankId).wac; }

/* ---------- جدول سنجش ---------- */
/* نسخه فعال یک تانک در یک تاریخ. اگر تاریخ ندهی، نسخه جاری. */
function calibVersionAt(tankId, date) {
  if (!date) {
    const t = get(`SELECT calib_version_id FROM tank WHERE id=?`, tankId);
    if (t && t.calib_version_id) return Number(t.calib_version_id);
  }
  const v = get(`SELECT id FROM tank_calib_version
                 WHERE tank_id=? AND effective_from<=?
                 ORDER BY effective_from DESC, version DESC LIMIT 1`,
    tankId, date || '9999-12-31');
  if (v) return Number(v.id);
  const any = get(`SELECT id FROM tank_calib_version WHERE tank_id=?
                   ORDER BY effective_from ASC, version ASC LIMIT 1`, tankId);
  return any ? Number(any.id) : null;
}

/* نقاط سنجش. versionId خالی = نسخه جاری تانک. */
function calibChart(tankId, versionId) {
  const vid = versionId || calibVersionAt(tankId);
  if (vid) {
    const rows = all(`SELECT dip_mm, volume_l FROM tank_calib_point
                      WHERE version_id=? ORDER BY dip_mm`, vid);
    if (rows.length) return rows;
  }
  /* برگشت به جدول قدیمی — دیتابیس‌های پیش از نسخه‌بندی */
  return all(`SELECT dip_mm, volume_l FROM tank_calib WHERE tank_id=? ORDER BY dip_mm`, tankId);
}

/* ---------- دفتر پول ---------- */
function addMoneyMove(m, user) {
  const amount = round(m.amount, 2);
  const fx = num(m.fx_rate, 1) || 1;
  const r = run(`INSERT INTO money_move
    (moved_at,doc_date,station_id,account,party_id,direction,amount,currency,fx_rate,
     amount_base,method,ref_no,source_type,source_id,reversal_of,note,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    m.moved_at || now(), m.doc_date, m.station_id, m.account, m.party_id ?? null,
    m.direction, amount, m.currency || 'AFN', fx, round(amount * fx, 2),
    m.method ?? null, m.ref_no ?? null, m.source_type, m.source_id ?? null,
    m.reversal_of ?? null, m.note ?? null, user ? user.id : null, now());
  invalidateParty(m.party_id);
  return Number(r.lastInsertRowid);
}

/* بیلانس طرف حساب: مثبت = او به ما بدهکار */
function partyBalance(partyId) {
  partyId = Number(partyId);
  const hit = partyCache.get(partyId);
  if (hit !== undefined) return hit;
  const p = get(`SELECT opening_bal FROM party WHERE id=?`, partyId);
  const q = get(`SELECT
      COALESCE(SUM(CASE WHEN direction='in' THEN amount_base ELSE -amount_base END),0) v
    FROM money_move WHERE party_id=? AND account IN ('receivable','payable')`, partyId);
  const v = round((p ? num(p.opening_bal) : 0) + num(q.v), 2);
  partyCache.set(partyId, v);
  return v;
}

/* ============================================================
   جلوگیری از ثبت دوباره یک سند
   کلید را مرورگر می‌سازد و با هر بار زدن دکمه همان کلید فرستاده می‌شود.
   اگر شبکه قطع شود و کاربر دوباره بزند، سرور همان نتیجه قبلی را
   برمی‌گرداند و سند دوم ثبت نمی‌شود.
   ============================================================ */
function idempotent(key, scope, user, fn) {
  if (!key) return fn();
  const k = scope + ':' + String(key).slice(0, 100);
  const prev = get(`SELECT result FROM idem_key WHERE key=?`, k);
  if (prev) {
    let out = {};
    try { out = JSON.parse(prev.result || '{}'); } catch (_) { }
    return Object.assign({}, out, { duplicate: true });
  }
  return tx(() => {
    const again = get(`SELECT result FROM idem_key WHERE key=?`, k);
    if (again) {
      let out = {};
      try { out = JSON.parse(again.result || '{}'); } catch (_) { }
      return Object.assign({}, out, { duplicate: true });
    }
    const res = fn();
    run(`INSERT INTO idem_key (key,scope,user_id,result,created_at) VALUES (?,?,?,?,?)`,
      k, scope, user ? user.id : null, JSON.stringify(res === undefined ? {} : res), now());
    return res;
  });
}

function purgeIdemKeys() {
  const cut = new Date(Date.now() - 45 * 86400000).toISOString();
  run(`DELETE FROM idem_key WHERE created_at < ?`, cut);
}

/* ---------- تنظیمات ---------- */
function baseCurrency() {
  const s = get(`SELECT value FROM setting WHERE key='base_currency'`);
  return s ? s.value : 'AFN';
}
function setting(key, def) {
  const s = get(`SELECT value FROM setting WHERE key=?`, key);
  return s && s.value !== null && s.value !== '' ? s.value : def;
}
function settingOn(key, def) {
  const v = setting(key, def ? '1' : '0');
  return v === '1' || v === 'true' || v === 1 || v === true;
}
function setSetting(key, value) {
  run(`INSERT INTO setting (key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, String(value));
}

/* نرخ فعال یک محصول در یک تاریخ.
   اگر در آن تاریخ نرخی نافذ نبود، به قدیمی‌ترین نرخ ثبت‌شده برمی‌گردد
   تا هرگز فروش با نرخ صفر ثبت نشود. */
function activePrice(productId, stationId, date) {
  const r = get(`SELECT price FROM price
     WHERE product_id=? AND effective_from<=?
       AND (station_id IS NULL OR station_id=?)
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    productId, date, stationId ?? -1);
  if (r && num(r.price) > 0) return num(r.price);
  const fb = get(`SELECT price FROM price
     WHERE product_id=? AND (station_id IS NULL OR station_id=?)
     ORDER BY effective_from ASC, id ASC LIMIT 1`, productId, stationId ?? -1);
  return fb ? num(fb.price) : 0;
}

/* نرخ اسعار در یک تاریخ — نزدیک‌ترین نرخ ثبت‌شده تا آن تاریخ.
   ارز پایه همیشه ۱ است. اگر نرخی نبود، ۰ برمی‌گردد تا کاربر مجبور شود وارد کند. */
function fxRate(ccy, date) {
  if (!ccy || ccy === baseCurrency()) return 1;
  const r = get(`SELECT rate FROM fx_rate WHERE ccy=? AND rate_date<=?
                 ORDER BY rate_date DESC LIMIT 1`, ccy, date || '9999-12-31');
  if (r && num(r.rate) > 0) return num(r.rate);
  const any = get(`SELECT rate FROM fx_rate WHERE ccy=? ORDER BY rate_date DESC LIMIT 1`, ccy);
  return any ? num(any.rate) : 0;
}

/* ---------- بستن روز ---------- */
function dayClosedAt(stationId, docDate) {
  if (!stationId || !docDate) return null;
  return get(`SELECT * FROM day_close WHERE station_id=? AND doc_date<=? AND status='closed'
              ORDER BY doc_date DESC LIMIT 1`, Number(stationId), docDate) || null;
}

module.exports = {
  handle, reopen, all, get, run, exec, tx, now, num, round,
  hashPin, checkPin, audit, raiseAlert,
  addStockMove, tankBook, tankState, tankWac,
  calibChart, calibVersionAt,
  addMoneyMove, partyBalance,
  idempotent, purgeIdemKeys,
  invalidateTank, invalidateParty, invalidateAll,
  baseCurrency, setting, settingOn, setSetting, activePrice, fxRate,
  dayClosedAt,
  DB_PATH, ROOT, DATA_DIR,
  get MIG() { return MIG; }
};
