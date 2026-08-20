'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.PUMP_DB || path.join(DATA_DIR, 'pump.db');
const db = new DatabaseSync(DB_PATH);

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

/* ---------- کمک‌کننده‌ها ---------- */
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const now = () => new Date().toISOString();

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) { } throw e; }
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
  const dup = get(`SELECT id, detail FROM alert WHERE code=? AND ref_type=? AND ref_id=? AND resolved=0`,
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

/* ---------- دفتر موجودی ---------- */
function addStockMove(m, user) {
  const r = run(`INSERT INTO stock_move
    (moved_at,doc_date,station_id,tank_id,product_id,direction,qty_obs,temp_c,density15,
     vcf,qty15,qty_mt,unit_cost,source_type,source_id,reversal_of,note,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    m.moved_at || now(), m.doc_date, m.station_id, m.tank_id, m.product_id,
    m.direction, round(m.qty_obs, 3), m.temp_c ?? null, m.density15 ?? null,
    round(m.vcf ?? 1, 7), round(m.qty15 ?? m.qty_obs, 3), round(m.qty_mt ?? 0, 6),
    round(m.unit_cost ?? 0, 6), m.source_type, m.source_id ?? null,
    m.reversal_of ?? null, m.note ?? null, user ? user.id : null, now());
  return Number(r.lastInsertRowid);
}

/* موجودی دفتری تانک تا یک لحظه */
function tankBook(tankId, untilDate) {
  const t = get(`SELECT opening_qty FROM tank WHERE id=?`, tankId);
  const opening = t ? num(t.opening_qty) : 0;
  const q = untilDate
    ? get(`SELECT
             COALESCE(SUM(CASE WHEN direction='in' THEN qty_obs ELSE -qty_obs END),0) v
           FROM stock_move WHERE tank_id=? AND doc_date<=?`, tankId, untilDate)
    : get(`SELECT
             COALESCE(SUM(CASE WHEN direction='in' THEN qty_obs ELSE -qty_obs END),0) v
           FROM stock_move WHERE tank_id=?`, tankId);
  return round(opening + num(q.v), 3);
}

/* برای دیپ، ساعت مهم است: حرکت بعدی همان روز نباید داخل موجودی زمان دیپ بیاید. */
function tankBookAt(tankId, at) {
  const t = get(`SELECT opening_qty FROM tank WHERE id=?`, tankId);
  const q = get(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN qty_obs ELSE -qty_obs END),0) v
                 FROM stock_move WHERE tank_id=? AND moved_at<=?`, tankId, at || now());
  return round(num(t && t.opening_qty) + num(q.v), 3);
}

/* میانگین موزون بهای تمام‌شده تانک */
function tankWac(tankId) {
  const t = get(`SELECT opening_qty, opening_cost FROM tank WHERE id=?`, tankId);
  let qty = t ? num(t.opening_qty) : 0;
  let val = qty * (t ? num(t.opening_cost) : 0);
  const moves = all(`SELECT direction, qty_obs, unit_cost FROM stock_move
                     WHERE tank_id=? ORDER BY moved_at, id`, tankId);
  for (const m of moves) {
    if (m.direction === 'in') {
      val += num(m.qty_obs) * num(m.unit_cost);
      qty += num(m.qty_obs);
    } else {
      const wac = qty > 0 ? val / qty : 0;
      val -= num(m.qty_obs) * wac;
      qty -= num(m.qty_obs);
      if (qty <= 0) { qty = Math.max(qty, 0); val = Math.max(val, 0); }
    }
  }
  return qty > 0 ? round(val / qty, 6) : round(num(t && t.opening_cost), 6);
}

/* جدول سنجش تانک */
function calibChart(tankId) {
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
  return Number(r.lastInsertRowid);
}

/* بیلانس طرف حساب: مثبت = او به ما بدهکار */
function partyBalance(partyId) {
  const p = get(`SELECT opening_bal FROM party WHERE id=?`, partyId);
  const q = get(`SELECT
      COALESCE(SUM(CASE WHEN account='receivable' AND direction='in'  THEN amount_base
                        WHEN account='receivable' AND direction='out' THEN -amount_base
                        WHEN account='payable'    AND direction='out' THEN -amount_base
                        WHEN account='payable'    AND direction='in'  THEN amount_base
                        ELSE 0 END),0) v
    FROM money_move WHERE party_id=?`, partyId);
  return round((p ? num(p.opening_bal) : 0) + num(q.v), 2);
}

function baseCurrency() {
  const s = get(`SELECT value FROM setting WHERE key='base_currency'`);
  return s ? s.value : 'AFN';
}
function setting(key, def) {
  const s = get(`SELECT value FROM setting WHERE key=?`, key);
  return s ? s.value : def;
}
function setSetting(key, value) {
  run(`INSERT INTO setting (key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, String(value));
}

/* نرخ فعال یک محصول در یک تاریخ.
   اگر در آن تاریخ نرخی نافذ نبود، به قدیمی‌ترین نرخ ثبت‌شده برمی‌گردد
   تا هرگز فروش با نرخ صفر ثبت نشود. */
function priceInBase(row, date) {
  if (!row) return 0;
  const base = baseCurrency();
  if (!row.currency || row.currency === base) return num(row.price);
  const fx = get(`SELECT rate FROM fx_rate WHERE ccy=? AND rate_date<=?
                  ORDER BY rate_date DESC LIMIT 1`, row.currency, date);
  return fx ? round(num(row.price) * num(fx.rate), 4) : 0;
}

function activePrice(productId, stationId, date) {
  const r = get(`SELECT price,currency FROM price
     WHERE product_id=? AND effective_from<=?
       AND (station_id IS NULL OR station_id=?)
     ORDER BY CASE WHEN station_id=? THEN 0 ELSE 1 END, effective_from DESC, id DESC LIMIT 1`,
    productId, date, stationId ?? -1, stationId ?? -1);
  const current = priceInBase(r, date);
  if (current > 0) return current;
  const fb = get(`SELECT price,currency FROM price
     WHERE product_id=? AND (station_id IS NULL OR station_id=?)
     ORDER BY effective_from ASC, id ASC LIMIT 1`, productId, stationId ?? -1);
  return priceInBase(fb, date);
}

module.exports = {
  db, all, get, run, tx, now, num, round,
  hashPin, checkPin, audit, raiseAlert,
  addStockMove, tankBook, tankBookAt, tankWac, calibChart,
  addMoneyMove, partyBalance,
  baseCurrency, setting, setSetting, activePrice,
  DB_PATH, ROOT
};
