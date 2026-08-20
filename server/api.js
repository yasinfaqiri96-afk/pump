'use strict';
const crypto = require('node:crypto');
const D = require('./db');
const Petro = require('../public/js/shared/petroleum.js');
const Jalali = require('../public/js/shared/jalali.js');

function fail(code, msg) { const e = new Error(msg); e.httpCode = code; return e; }

/* ---------------- صلاحیت ---------------- */
const ROLE_CAPS = {
  owner: ['admin', 'setup', 'ops', 'finance', 'dip', 'shift', 'report', 'read'],
  manager: ['setup', 'ops', 'finance', 'dip', 'shift', 'report', 'read'],
  accountant: ['finance', 'ops', 'report', 'read'],
  station: ['ops', 'dip', 'shift', 'report', 'read'],
  operator: ['shift', 'read'],
  dipper: ['dip', 'read']
};
const ROLE_NAMES = {
  owner: 'مالک', manager: 'مدیر', accountant: 'محاسب',
  station: 'مدیر استیشن', operator: 'اپراتور', dipper: 'دیپ‌زن'
};
function can(user, cap) {
  if (!user) return false;
  return (ROLE_CAPS[user.role] || []).indexOf(cap) >= 0;
}
function need(user, cap) {
  if (!can(user, cap)) throw fail(403, 'صلاحیت کافی ندارید');
}

/* ---------------- نشست ---------------- */
function userFromToken(token) {
  if (!token) return null;
  const s = D.get(`SELECT * FROM session WHERE token=? AND expires_at > ?`, token, D.now());
  if (!s) return null;
  const u = D.get(`SELECT id,username,full_name,role,station_id,active FROM app_user WHERE id=?`, s.user_id);
  if (!u || !u.active) return null;
  return u;
}

/* ---------------- کمکی ---------------- */
const N = D.num, R = D.round;
function today() { return Jalali.todayGregorian(); }
function docDate(v) { return (v && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v.slice(0, 10) : today(); }
function req(body, field, label) {
  const v = body[field];
  if (v === undefined || v === null || v === '') throw fail(400, (label || field) + ' الزامی است');
  return v;
}
function stationScope(user, stationId) {
  if (user.station_id && Number(stationId) !== Number(user.station_id))
    throw fail(403, 'به این استیشن دسترسی ندارید');
  return Number(stationId);
}

/* حجم خالص از دیپ */
function dipVolumes(tankId, dipMm, waterMm) {
  const chart = D.calibChart(tankId);
  if (chart.length < 2) throw fail(400, 'جدول سنجش این تانک ثبت نشده یا کامل نیست');
  const dip = Number(dipMm), waterDip = Number(waterMm || 0);
  if (!Number.isFinite(dip) || dip < 0) throw fail(400, 'عدد دیپ باید صفر یا بزرگتر باشد');
  if (!Number.isFinite(waterDip) || waterDip < 0) throw fail(400, 'عدد آب باید صفر یا بزرگتر باشد');
  if (waterDip > dip) throw fail(400, 'دیپ آب نمی‌تواند از دیپ کل بیشتر باشد');
  const min = Number(chart[0].dip_mm), max = Number(chart[chart.length - 1].dip_mm);
  if (dip < min || dip > max)
    throw fail(400, 'دیپ باید داخل محدوده جدول سنجش باشد (' + min + ' تا ' + max + ' میلی‌متر)');
  if (waterDip < min || waterDip > max)
    throw fail(400, 'دیپ آب بیرون محدوده جدول سنجش است');
  const gross = Petro.dipToVolume(chart, dip);
  const water = waterDip > 0 ? Petro.dipToVolume(chart, waterDip) : 0;
  return { gross: R(gross, 3), water: R(water, 3), net: R(gross - water, 3), chart };
}

function productOf(tankId) {
  return D.get(`SELECT p.* FROM tank t JOIN product p ON p.id=t.product_id WHERE t.id=?`, tankId);
}

/* ---------------- روتر ---------------- */
const routes = [];
function route(method, pattern, cap, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, cap, handler });
}

function assertTankScope(user, tankId) {
  if (!user || !user.station_id || !tankId) return;
  const t = D.get(`SELECT station_id FROM tank WHERE id=?`, Number(tankId));
  if (!t) throw fail(404, 'تانک یافت نشد');
  stationScope(user, t.station_id);
}

/* محدوده استیشن در یک نقطه مرکزی تطبیق می‌شود تا هیچ مسیر جدیدی آن را فراموش نکند. */
function enforceStationScope(user, path, params, q, b) {
  if (!user || !user.station_id) return;
  const sid = Number(user.station_id);
  if (q.station_id) stationScope(user, q.station_id);
  if (b.station_id) stationScope(user, b.station_id);
  q.station_id = sid;

  ['tank_id', 'from_tank_id', 'to_tank_id'].forEach(k => {
    if (b[k]) assertTankScope(user, b[k]);
    if (q[k]) assertTankScope(user, q[k]);
  });
  if (/^\/tanks\//.test(path)) assertTankScope(user, params.id);

  if (/^\/shifts\//.test(path) && params.id) {
    const x = D.get(`SELECT station_id FROM shift WHERE id=?`, Number(params.id));
    if (x) stationScope(user, x.station_id);
  }
  if (/^\/alerts\//.test(path) && params.id) {
    const x = D.get(`SELECT station_id FROM alert WHERE id=?`, Number(params.id));
    if (x && x.station_id) stationScope(user, x.station_id);
  }
  if (/^\/nozzles\//.test(path) && params.id) {
    const x = D.get(`SELECT d.station_id FROM nozzle n JOIN dispenser d ON d.id=n.dispenser_id WHERE n.id=?`, Number(params.id));
    if (x) stationScope(user, x.station_id);
  }
  if (/^\/dispensers\//.test(path) && params.id) {
    const x = D.get(`SELECT station_id FROM dispenser WHERE id=?`, Number(params.id));
    if (x) stationScope(user, x.station_id);
  }
}

async function handle(ctx) {
  const user = userFromToken(ctx.token);
  for (const r of routes) {
    if (r.method !== ctx.method) continue;
    const m = ctx.path.match(r.rx);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
    if (r.cap !== null) {
      if (!user) throw fail(401, 'وارد سیستم نشده‌اید');
      if (r.cap) need(user, r.cap);
      enforceStationScope(user, ctx.path, params, ctx.query, ctx.body);
    }
    const body = await r.handler({ user, params, q: ctx.query, b: ctx.body, ip: ctx.ip || '' });
    return { code: 200, body: body === undefined ? { ok: true } : body };
  }
  throw fail(404, 'مسیر یافت نشد: ' + ctx.path);
}

/* ================= سلامت ================= */
route('GET', '/health', null, () => ({ ok: true, at: D.now() }));

/* ================= محدودیت نرخ ورود =================
   پین کوتاه است، پس بدون این محدودیت با چند هزار درخواست شکسته می‌شود.
   شمارش در حافظه است — با ری‌استارت پاک می‌شود، که برای یک نمونه کافی است. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginFails = new Map();

function loginKey(ip, username) { return ip + '|' + username; }

function loginGuard(ip, username) {
  const rec = loginFails.get(loginKey(ip, username));
  if (!rec) return;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    throw fail(429, 'تلاش‌های ناموفق زیاد بود. ' + mins + ' دقیقه بعد دوباره کوشش کنید.');
  }
}

function loginFailed(ip, username) {
  const k = loginKey(ip, username);
  const nowMs = Date.now();
  let rec = loginFails.get(k);
  if (!rec || nowMs - rec.first > LOGIN_WINDOW_MS) rec = { first: nowMs, count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_FAILS) rec.lockedUntil = nowMs + LOGIN_LOCK_MS;
  loginFails.set(k, rec);
  /* پاک‌سازی ورودی‌های کهنه تا نقشه بی‌نهایت بزرگ نشود */
  if (loginFails.size > 5000)
    for (const [key, v] of loginFails)
      if (nowMs - v.first > LOGIN_WINDOW_MS && (!v.lockedUntil || v.lockedUntil < nowMs)) loginFails.delete(key);
}

function loginOk(ip, username) { loginFails.delete(loginKey(ip, username)); }

/* ================= ورود ================= */
route('POST', '/auth/login', null, ({ b, ip }) => {
  const username = String(b.username || '').trim().toLowerCase();
  loginGuard(ip, username);
  const u = D.get(`SELECT * FROM app_user WHERE lower(username)=? AND active=1`, username);
  if (!u || !D.checkPin(b.pin, u.pin_hash)) {
    loginFailed(ip, username);
    D.audit(null, 'ورود ناموفق', 'app_user', null, 'نام کاربری: ' + username + ' — نشانی: ' + ip);
    throw fail(401, 'نام کاربری یا پین اشتباه است');
  }
  loginOk(ip, username);
  const token = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  D.run(`INSERT INTO session (token,user_id,created_at,expires_at) VALUES (?,?,?,?)`,
    token, u.id, D.now(), exp);
  D.run(`DELETE FROM session WHERE expires_at < ?`, D.now());
  D.audit(u, 'ورود به سیستم', 'app_user', u.id, null);
  return {
    token,
    user: {
      id: u.id, username: u.username, full_name: u.full_name, role: u.role,
      role_name: ROLE_NAMES[u.role] || u.role, station_id: u.station_id,
      caps: ROLE_CAPS[u.role] || []
    }
  };
});

route('POST', '/auth/logout', '', ({ user, b }) => {
  D.run(`DELETE FROM session WHERE user_id=?`, user.id);
  D.audit(user, 'خروج از سیستم', 'app_user', user.id, null);
});

route('GET', '/auth/me', '', ({ user }) => ({
  user: Object.assign({}, user, {
    role_name: ROLE_NAMES[user.role] || user.role, caps: ROLE_CAPS[user.role] || []
  })
}));

/* ================= اطلاعات پایه صفحه ================= */
route('GET', '/meta', '', ({ user }) => {
  const where = user.station_id ? ` WHERE id=${Number(user.station_id)}` : ' WHERE active=1';
  const stations = D.all(`SELECT * FROM station${where} ORDER BY name`);
  return {
    stations,
    products: D.all(`SELECT * FROM product WHERE active=1 ORDER BY id`),
    base_currency: D.baseCurrency(),
    company: D.setting('company_name', 'شرکت'),
    open_alerts: D.get(`SELECT COUNT(*) c FROM alert WHERE resolved=0 ${user.station_id ? 'AND (station_id IS NULL OR station_id=' + Number(user.station_id) + ')' : ''}`).c,
    open_shifts: D.get(`SELECT COUNT(*) c FROM shift WHERE status='open' ${user.station_id ? 'AND station_id=' + Number(user.station_id) : ''}`).c,
    role_names: ROLE_NAMES
  };
});

/* ================= استیشن ================= */
route('GET', '/stations', 'read', ({ user }) =>
  D.all(`SELECT * FROM station ${user.station_id ? 'WHERE id=' + Number(user.station_id) : ''} ORDER BY name`));

route('POST', '/stations', 'setup', ({ user, b }) => {
  req(b, 'code', 'کد'); req(b, 'name', 'نام');
  const r = D.run(`INSERT INTO station (code,name,province,address,phone,license_no,license_expiry,active)
    VALUES (?,?,?,?,?,?,?,1)`, b.code, b.name, b.province || null, b.address || null,
    b.phone || null, b.license_no || null, b.license_expiry || null);
  D.audit(user, 'ثبت استیشن', 'station', r.lastInsertRowid, b.name);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/stations/:id', 'setup', ({ user, params, b }) => {
  D.run(`UPDATE station SET name=?,province=?,address=?,phone=?,license_no=?,license_expiry=?,active=?
         WHERE id=?`, b.name, b.province || null, b.address || null, b.phone || null,
    b.license_no || null, b.license_expiry || null, b.active ? 1 : 0, params.id);
  D.audit(user, 'ویرایش استیشن', 'station', params.id, b.name);
});

/* ================= محصول ================= */
route('GET', '/products', 'read', () => D.all(`SELECT * FROM product ORDER BY id`));

route('POST', '/products', 'setup', ({ user, b }) => {
  req(b, 'code', 'کد'); req(b, 'name', 'نام');
  const r = D.run(`INSERT INTO product (code,name,uom,density_group,default_density,tolerance_pct,is_mass,color,active)
    VALUES (?,?,?,?,?,?,?,?,1)`, b.code, b.name, b.uom || 'لیتر', b.density_group || 'diesel',
    N(b.default_density, 0.84), N(b.tolerance_pct, 0.5), b.is_mass ? 1 : 0, b.color || '#0B8457');
  D.audit(user, 'ثبت محصول', 'product', r.lastInsertRowid, b.name);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/products/:id', 'setup', ({ user, params, b }) => {
  D.run(`UPDATE product SET name=?,uom=?,density_group=?,default_density=?,tolerance_pct=?,is_mass=?,color=?,active=?
         WHERE id=?`, b.name, b.uom || 'لیتر', b.density_group || 'diesel',
    N(b.default_density, 0.84), N(b.tolerance_pct, 0.5), b.is_mass ? 1 : 0,
    b.color || '#0B8457', b.active ? 1 : 0, params.id);
  D.audit(user, 'ویرایش محصول', 'product', params.id, b.name);
});

/* ================= تانک ================= */
function tankView(t) {
  const book = D.tankBook(t.id);
  const lastDip = D.get(`SELECT * FROM dip WHERE tank_id=? ORDER BY read_at DESC LIMIT 1`, t.id);
  const cap = N(t.capacity_l);
  const chart = D.get(`SELECT COUNT(*) c FROM tank_calib WHERE tank_id=?`, t.id).c;
  return Object.assign({}, t, {
    book_l: book,
    wac: D.tankWac(t.id),
    fill_pct: cap > 0 ? R(book / cap * 100, 1) : 0,
    calib_points: chart,
    last_dip_at: lastDip ? lastDip.read_at : null,
    last_dip_net: lastDip ? lastDip.vol_net_l : null,
    last_variance_l: lastDip ? lastDip.variance_l : null,
    low: cap > 0 && book <= N(t.min_level_l)
  });
}

route('GET', '/tanks', 'read', ({ user, q }) => {
  const conds = ['t.active=1'], args = [];
  if (q.station_id) { conds.push('t.station_id=?'); args.push(Number(q.station_id)); }
  if (user.station_id) { conds.push('t.station_id=?'); args.push(Number(user.station_id)); }
  const rows = D.all(`SELECT t.*, p.name product_name, p.uom, p.color, p.density_group,
      p.default_density, p.tolerance_pct, p.is_mass, s.name station_name
    FROM tank t JOIN product p ON p.id=t.product_id JOIN station s ON s.id=t.station_id
    WHERE ${conds.join(' AND ')} ORDER BY s.name, t.code`, ...args);
  return rows.map(tankView);
});

route('GET', '/tanks/:id', 'read', ({ params }) => {
  const t = D.get(`SELECT t.*, p.name product_name, p.uom, p.color, p.density_group,
      p.default_density, p.tolerance_pct, p.is_mass, s.name station_name
    FROM tank t JOIN product p ON p.id=t.product_id JOIN station s ON s.id=t.station_id
    WHERE t.id=?`, params.id);
  if (!t) throw fail(404, 'تانک یافت نشد');
  const v = tankView(t);
  v.recent_moves = D.all(`SELECT * FROM stock_move WHERE tank_id=? ORDER BY id DESC LIMIT 40`, params.id);
  v.recent_dips = D.all(`SELECT * FROM dip WHERE tank_id=? ORDER BY read_at DESC LIMIT 20`, params.id);
  return v;
});

route('POST', '/tanks', 'setup', ({ user, b }) => {
  req(b, 'station_id', 'استیشن'); req(b, 'product_id', 'محصول');
  req(b, 'code', 'کد'); req(b, 'name', 'نام');
  const r = D.run(`INSERT INTO tank
    (station_id,product_id,code,name,capacity_l,dead_stock_l,min_level_l,kind,opening_qty,opening_cost,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
    Number(b.station_id), Number(b.product_id), b.code, b.name,
    N(b.capacity_l), N(b.dead_stock_l), N(b.min_level_l), b.kind || 'زیرزمینی',
    N(b.opening_qty), N(b.opening_cost));
  D.audit(user, 'ثبت تانک', 'tank', r.lastInsertRowid, b.name);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/tanks/:id', 'setup', ({ user, params, b }) => {
  D.run(`UPDATE tank SET name=?,capacity_l=?,dead_stock_l=?,min_level_l=?,kind=?,active=?
         WHERE id=?`, b.name, N(b.capacity_l), N(b.dead_stock_l), N(b.min_level_l),
    b.kind || 'زیرزمینی', b.active ? 1 : 0, params.id);
  D.audit(user, 'ویرایش تانک', 'tank', params.id, b.name);
});

/* جدول سنجش */
route('GET', '/tanks/:id/calib', 'read', ({ params }) => D.calibChart(params.id));

route('POST', '/tanks/:id/calib', 'setup', ({ user, params, b }) => {
  let rows = b.rows;
  if (typeof b.text === 'string' && b.text.trim()) {
    rows = b.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const p = l.split(/[\s,;\t]+/).filter(Boolean);
      return { dip_mm: N(p[0]), volume_l: N(p[1]) };
    }).filter(r => isFinite(r.dip_mm) && isFinite(r.volume_l));
  }
  if (!Array.isArray(rows) || !rows.length) throw fail(400, 'هیچ سطر معتبری یافت نشد');
  rows.sort((a, b2) => a.dip_mm - b2.dip_mm);
  D.tx(() => {
    D.run(`DELETE FROM tank_calib WHERE tank_id=?`, params.id);
    const st = D.db.prepare(`INSERT OR REPLACE INTO tank_calib (tank_id,dip_mm,volume_l) VALUES (?,?,?)`);
    for (const r of rows) st.run(Number(params.id), R(r.dip_mm, 1), R(r.volume_l, 3));
  });
  D.audit(user, 'بارگذاری جدول سنجش', 'tank', params.id, rows.length + ' سطر');
  return { count: rows.length };
});

/* تولید جدول سنجش خطی ساده (برای تانک استوانه‌ای عمودی یا تخمین اولیه) */
route('POST', '/tanks/:id/calib/linear', 'setup', ({ user, params, b }) => {
  const height = N(b.height_mm), cap = N(b.capacity_l), step = N(b.step_mm, 10) || 10;
  if (height <= 0 || cap <= 0) throw fail(400, 'ارتفاع و ظرفیت باید بزرگتر از صفر باشد');
  const rows = [];
  for (let mm = 0; mm <= height; mm += step) rows.push({ dip_mm: mm, volume_l: R(cap * mm / height, 3) });
  D.tx(() => {
    D.run(`DELETE FROM tank_calib WHERE tank_id=?`, params.id);
    const st = D.db.prepare(`INSERT OR REPLACE INTO tank_calib (tank_id,dip_mm,volume_l) VALUES (?,?,?)`);
    for (const r of rows) st.run(Number(params.id), r.dip_mm, r.volume_l);
  });
  D.audit(user, 'تولید جدول سنجش خطی', 'tank', params.id, rows.length + ' سطر');
  return { count: rows.length };
});

/* ================= دستگاه و نازل ================= */
route('GET', '/dispensers', 'read', ({ q }) => {
  const args = [];
  let w = 'WHERE 1=1';
  if (q.station_id) { w += ' AND d.station_id=?'; args.push(Number(q.station_id)); }
  return D.all(`SELECT d.*, s.name station_name,
      (SELECT COUNT(*) FROM nozzle n WHERE n.dispenser_id=d.id AND n.active=1) nozzle_count
    FROM dispenser d JOIN station s ON s.id=d.station_id ${w} ORDER BY d.code`, ...args);
});

route('POST', '/dispensers', 'setup', ({ user, b }) => {
  req(b, 'station_id', 'استیشن'); req(b, 'code', 'کد');
  const r = D.run(`INSERT INTO dispenser (station_id,code,name,active) VALUES (?,?,?,1)`,
    Number(b.station_id), b.code, b.name || ('دستگاه ' + b.code));
  D.audit(user, 'ثبت دستگاه', 'dispenser', r.lastInsertRowid, b.code);
  return { id: Number(r.lastInsertRowid) };
});

route('GET', '/nozzles', 'read', ({ q }) => {
  const args = []; let w = 'WHERE n.active=1';
  if (q.station_id) { w += ' AND d.station_id=?'; args.push(Number(q.station_id)); }
  if (q.tank_id) { w += ' AND n.tank_id=?'; args.push(Number(q.tank_id)); }
  return D.all(`SELECT n.*, d.code dispenser_code, d.station_id, t.code tank_code, t.name tank_name,
      t.product_id, p.name product_name, p.color
    FROM nozzle n JOIN dispenser d ON d.id=n.dispenser_id
    JOIN tank t ON t.id=n.tank_id JOIN product p ON p.id=t.product_id
    ${w} ORDER BY d.code, n.code`, ...args);
});

route('POST', '/nozzles', 'setup', ({ user, b }) => {
  req(b, 'dispenser_id', 'دستگاه'); req(b, 'tank_id', 'تانک'); req(b, 'code', 'کد');
  const r = D.run(`INSERT INTO nozzle (dispenser_id,tank_id,code,meter_digits,meter_factor,last_reading,active)
    VALUES (?,?,?,?,?,?,1)`, Number(b.dispenser_id), Number(b.tank_id), b.code,
    Number(b.meter_digits) || 6, N(b.meter_factor, 1) || 1, N(b.last_reading));
  D.audit(user, 'ثبت نازل', 'nozzle', r.lastInsertRowid, b.code);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/nozzles/:id', 'setup', ({ user, params, b }) => {
  D.run(`UPDATE nozzle SET tank_id=?,code=?,meter_digits=?,meter_factor=?,active=? WHERE id=?`,
    Number(b.tank_id), b.code, Number(b.meter_digits) || 6, N(b.meter_factor, 1) || 1,
    b.active ? 1 : 0, params.id);
  D.audit(user, 'ویرایش نازل', 'nozzle', params.id, b.code);
});

/* ================= طرف حساب ================= */
route('GET', '/parties', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.kind) { w += ' AND kind=?'; args.push(q.kind); }
  if (q.active !== '0') w += ' AND active=1';
  const rows = D.all(`SELECT * FROM party ${w} ORDER BY name`, ...args);
  /* اپراتور برای انتخاب مشتری/کارمند فقط نام و شناسه را لازم دارد، نه بیلانس و معاش. */
  if (!can(user, 'ops') && !can(user, 'finance'))
    return rows.map(p => ({ id: p.id, kind: p.kind, name: p.name }));
  return rows.map(p => Object.assign({}, p, { balance: D.partyBalance(p.id) }));
});

route('POST', '/parties', 'ops', ({ user, b }) => {
  req(b, 'kind', 'نوع'); req(b, 'name', 'نام');
  const r = D.run(`INSERT INTO party (kind,code,name,phone,address,credit_limit,credit_days,opening_bal,salary,note,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,1)`, b.kind, b.code || null, b.name, b.phone || null,
    b.address || null, N(b.credit_limit), Number(b.credit_days) || 0, N(b.opening_bal),
    N(b.salary), b.note || null);
  D.audit(user, 'ثبت طرف حساب', 'party', r.lastInsertRowid, b.name + ' / ' + b.kind);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/parties/:id', 'ops', ({ user, params, b }) => {
  D.run(`UPDATE party SET name=?,code=?,phone=?,address=?,credit_limit=?,credit_days=?,salary=?,note=?,active=?
         WHERE id=?`, b.name, b.code || null, b.phone || null, b.address || null,
    N(b.credit_limit), Number(b.credit_days) || 0, N(b.salary), b.note || null,
    b.active ? 1 : 0, params.id);
  D.audit(user, 'ویرایش طرف حساب', 'party', params.id, b.name);
});

route('GET', '/parties/:id/ledger', 'finance', ({ params }) => {
  const p = D.get(`SELECT * FROM party WHERE id=?`, params.id);
  if (!p) throw fail(404, 'طرف حساب یافت نشد');
  const rows = D.all(`SELECT * FROM money_move WHERE party_id=? AND account IN ('receivable','payable')
                      ORDER BY doc_date, id`, params.id);
  let bal = N(p.opening_bal);
  const lines = rows.map(m => {
    const signed = (m.account === 'receivable')
      ? (m.direction === 'in' ? m.amount_base : -m.amount_base)
      : (m.direction === 'in' ? m.amount_base : -m.amount_base);
    bal = R(bal + signed, 2);
    return Object.assign({}, m, { signed: R(signed, 2), running: bal });
  });
  return { party: p, opening: N(p.opening_bal), lines, balance: bal };
});

/* ================= نرخ ================= */
route('GET', '/prices', 'read', ({ q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.product_id) { w += ' AND pr.product_id=?'; args.push(Number(q.product_id)); }
  return D.all(`SELECT pr.*, p.name product_name, p.uom, s.name station_name
    FROM price pr JOIN product p ON p.id=pr.product_id
    LEFT JOIN station s ON s.id=pr.station_id
    ${w} ORDER BY pr.effective_from DESC, pr.id DESC LIMIT 300`, ...args);
});

route('GET', '/prices/current', 'read', ({ q }) => {
  const st = q.station_id ? Number(q.station_id) : null;
  const d = docDate(q.date);
  return D.all(`SELECT * FROM product WHERE active=1 ORDER BY id`).map(p => ({
    product_id: p.id, product_name: p.name, uom: p.uom, color: p.color,
    price: D.activePrice(p.id, st, d)
  }));
});

route('POST', '/prices', 'finance', ({ user, b }) => {
  req(b, 'product_id', 'محصول'); req(b, 'price', 'نرخ');
  const eff = docDate(b.effective_from);
  const openShift = D.get(`SELECT COUNT(*) c FROM shift WHERE status='open'
      ${b.station_id ? 'AND station_id=' + Number(b.station_id) : ''}`).c;
  const r = D.run(`INSERT INTO price (station_id,product_id,price,currency,effective_from,note,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?)`, b.station_id ? Number(b.station_id) : null, Number(b.product_id),
    N(b.price), b.currency || D.baseCurrency(), eff, b.note || null, user.id, D.now());
  D.audit(user, 'ثبت نرخ جدید', 'price', r.lastInsertRowid,
    'محصول ' + b.product_id + ' = ' + b.price + ' از ' + eff);
  if (openShift > 0)
    D.raiseAlert(b.station_id || null, 'medium', 'PRICE_MID_SHIFT',
      'تغییر نرخ در حالی که شفت باز است',
      'نرخ جدید ثبت شد ولی ' + openShift + ' شفت باز است. فروش شفت با نرخ قدیم محاسبه می‌شود.',
      'price', Number(r.lastInsertRowid));
  return { id: Number(r.lastInsertRowid), open_shifts: openShift };
});

/* ================= نرخ اسعار ================= */
route('GET', '/fx', 'finance', () => D.all(`SELECT * FROM fx_rate ORDER BY rate_date DESC, ccy LIMIT 200`));

route('POST', '/fx', 'finance', ({ user, b }) => {
  req(b, 'ccy', 'ارز'); req(b, 'rate', 'نرخ');
  D.run(`INSERT INTO fx_rate (rate_date,ccy,rate) VALUES (?,?,?)
         ON CONFLICT(rate_date,ccy) DO UPDATE SET rate=excluded.rate`,
    docDate(b.rate_date), b.ccy, N(b.rate));
  D.audit(user, 'ثبت نرخ اسعار', 'fx_rate', null, b.ccy + '=' + b.rate);
});

/* ================= کاربران ================= */
route('GET', '/users', 'admin', () =>
  D.all(`SELECT u.id,u.username,u.full_name,u.role,u.station_id,u.active,u.created_at,
      s.name station_name FROM app_user u LEFT JOIN station s ON s.id=u.station_id ORDER BY u.id`)
    .map(u => Object.assign(u, { role_name: ROLE_NAMES[u.role] || u.role })));

route('POST', '/users', 'admin', ({ user, b }) => {
  req(b, 'username', 'نام کاربری'); req(b, 'full_name', 'نام کامل');
  req(b, 'role', 'نقش'); req(b, 'pin', 'پین');
  if (!ROLE_CAPS[b.role]) throw fail(400, 'نقش نامعتبر');
  if (String(b.pin).length < 4) throw fail(400, 'پین حداقل ۴ رقم باشد');
  const exists = D.get(`SELECT id FROM app_user WHERE lower(username)=?`, String(b.username).toLowerCase());
  if (exists) throw fail(400, 'این نام کاربری قبلاً ثبت شده');
  const r = D.run(`INSERT INTO app_user (username,full_name,role,station_id,pin_hash,active,created_at)
    VALUES (?,?,?,?,?,1,?)`, String(b.username).trim(), b.full_name, b.role,
    b.station_id ? Number(b.station_id) : null, D.hashPin(b.pin), D.now());
  D.audit(user, 'ثبت کاربر', 'app_user', r.lastInsertRowid, b.username + ' / ' + b.role);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/users/:id', 'admin', ({ user, params, b }) => {
  D.run(`UPDATE app_user SET full_name=?,role=?,station_id=?,active=? WHERE id=?`,
    b.full_name, b.role, b.station_id ? Number(b.station_id) : null, b.active ? 1 : 0, params.id);
  if (b.pin) {
    if (String(b.pin).length < 4) throw fail(400, 'پین حداقل ۴ رقم باشد');
    D.run(`UPDATE app_user SET pin_hash=? WHERE id=?`, D.hashPin(b.pin), params.id);
    D.run(`DELETE FROM session WHERE user_id=?`, params.id);
  }
  D.audit(user, 'ویرایش کاربر', 'app_user', params.id, b.full_name + (b.pin ? ' (پین تغییر کرد)' : ''));
});

/* ================= تنظیمات ================= */
route('GET', '/settings', 'read', () => ({
  company_name: D.setting('company_name', 'شرکت'),
  base_currency: D.baseCurrency(),
  fiscal_start: D.setting('fiscal_start', '01-01'),
  cash_tolerance: D.setting('cash_tolerance', '50'),
  dip_jump_pct: D.setting('dip_jump_pct', '25')
}));

route('POST', '/settings', 'setup', ({ user, b }) => {
  ['company_name', 'base_currency', 'fiscal_start', 'cash_tolerance', 'dip_jump_pct']
    .forEach(k => { if (b[k] !== undefined) D.setSetting(k, b[k]); });
  D.audit(user, 'تغییر تنظیمات', 'setting', null, JSON.stringify(b));
});

/* ================= ثبت وقایع ================= */
route('GET', '/audit', 'admin', ({ q }) => {
  const lim = Math.min(Number(q.limit) || 200, 1000);
  const args = []; let w = 'WHERE 1=1';
  if (q.user_id) { w += ' AND user_id=?'; args.push(Number(q.user_id)); }
  if (q.entity) { w += ' AND entity=?'; args.push(q.entity); }
  return D.all(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ${lim}`, ...args);
});

/* ================= هشدار ================= */
route('GET', '/alerts', 'read', ({ q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.resolved !== '1') w += ' AND resolved=0';
  if (q.station_id) { w += ' AND (station_id IS NULL OR station_id=?)'; args.push(Number(q.station_id)); }
  return D.all(`SELECT a.*, s.name station_name FROM alert a
    LEFT JOIN station s ON s.id=a.station_id ${w} ORDER BY
    CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.at DESC LIMIT 200`, ...args);
});

route('POST', '/alerts/:id/resolve', 'ops', ({ user, params, b }) => {
  if (!b.note || String(b.note).trim().length < 3)
    throw fail(400, 'دلیل بستن هشدار را بنویسید');
  D.run(`UPDATE alert SET resolved=1, resolved_by=?, resolved_at=?, resolve_note=? WHERE id=?`,
    user.id, D.now(), String(b.note).trim(), params.id);
  D.audit(user, 'بستن هشدار', 'alert', params.id, b.note);
});

module.exports = { handle, route, fail, can, need, ROLE_CAPS, ROLE_NAMES, dipVolumes, productOf, docDate, today, req, stationScope };

/* بارگذاری بخش عملیات و راپور (بعد از export تا وابستگی حلقوی نشکند) */
require('./ops');
require('./reports');
