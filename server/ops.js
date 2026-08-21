'use strict';
const D = require('./db');
const A = require('./api');
const Petro = require('../public/js/shared/petroleum.js');
const Jalali = require('../public/js/shared/jalali.js');
const {
  route, fail, dipVolumes, productOf, docDate, today, req,
  numField, densityField, guardDate, stationScope
} = A;
const N = D.num, R = D.round;

/* ---------- کمکی مشترک ---------- */

/* اسعار سند: مبلغ به ارز سند + نرخ + مبلغ به ارز پایه */
function money(b, amountField, label, dd) {
  const currency = String(b.currency || D.baseCurrency()).toUpperCase();
  const amount = numField(b, amountField, label, { positive: true });
  let fx = 1;
  if (currency !== D.baseCurrency()) {
    fx = N(b.fx_rate);
    if (!fx) fx = D.fxRate(currency, dd);
    if (!fx) throw fail(400, 'نرخ ' + currency + ' ثبت نشده است. '
      + 'اول در نرخ‌نامه ← نرخ اسعار، نرخ امروز را وارد کنید.');
  }
  return { currency, amount: R(amount, 2), fx_rate: fx, amount_base: R(amount * fx, 2) };
}

function tankFull(tankId) {
  const t = D.get(`SELECT t.*, p.density_group, p.default_density, p.tolerance_pct, p.uom, p.is_mass,
                     p.name product_name
                   FROM tank t JOIN product p ON p.id=t.product_id WHERE t.id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');
  return t;
}

/* حساب صندوق/بانک/حواله از روش پرداخت */
function payAccount(method) {
  return method === 'bank' ? 'bank' : (method === 'hawala' ? 'hawala' : 'cash');
}

/* کنترل سقف اعتبار مشتری */
function creditGuard(user, b, stationId, partyId, amountBase, where) {
  if (!partyId) return;
  const p = D.get(`SELECT * FROM party WHERE id=?`, Number(partyId));
  if (!p) throw fail(404, 'مشتری یافت نشد');
  const limit = N(p.credit_limit);
  if (limit <= 0) return;
  const bal = D.partyBalance(p.id);
  if (bal + amountBase <= limit) return;
  if (!b.override_credit)
    throw fail(400, 'مشتری ' + p.name + ' از سقف اعتبار می‌گذرد. '
      + 'طلب فعلی ' + R(bal, 0) + ' + ' + R(amountBase, 0) + ' از سقف ' + R(limit, 0) + ' بیشتر می‌شود.');
  const reason = String(b.override_reason || '').trim();
  if (reason.length < 3) throw fail(400, 'برای عبور از سقف اعتبار، دلیل را بنویسید');
  D.raiseAlert(stationId, 'high', 'CREDIT_OVERRIDE',
    'عبور از سقف اعتبار با اجازه مدیر',
    'مشتری ' + p.name + ' — طلب ' + R(bal, 0) + ' — مبلغ جدید ' + R(amountBase, 0)
    + ' — سقف ' + R(limit, 0) + ' — ' + where + ' — کاربر ' + user.full_name
    + ' — دلیل: ' + reason, 'party', p.id);
  D.audit(user, 'عبور از سقف اعتبار', 'party', p.id, where + ' — ' + amountBase + ' — دلیل: ' + reason);
}

/* ============================================================
   دیپ
   ============================================================ */

/* پیش‌نمایش: قبل از ثبت، عدد را نشان بده */
route('GET', '/dips/preview', 'read', ({ q }) => {
  const tankId = Number(q.tank_id);
  const t = tankFull(tankId);
  const v = dipVolumes(tankId, q.dip_mm, q.water_mm);
  const book = D.tankBook(tankId);
  const d15 = densityField(q, 'density15', t.default_density);
  const temp = q.temp_c === '' || q.temp_c === undefined ? 15 : N(q.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const varr = Petro.variance(v.net, book, 0);
  const prev = D.get(`SELECT dip_mm, vol_net_l, read_at FROM dip WHERE tank_id=? ORDER BY read_at DESC LIMIT 1`, tankId);
  return {
    tank: t, gross: v.gross, water: v.water, net: v.net,
    vol15: R(v.net * vcf, 3), vcf: vcf, qty_mt: Petro.toMT(v.net * vcf, d15),
    book_l: book, variance_l: varr.qty, variance_pct: varr.pct,
    tolerance_pct: N(t.tolerance_pct, 0.5),
    over_tolerance: Math.abs(varr.pct) > N(t.tolerance_pct, 0.5),
    fill_pct: N(t.capacity_l) > 0 ? R(v.net / N(t.capacity_l) * 100, 1) : 0,
    previous: prev || null
  };
});

route('GET', '/dips', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND d.station_id=?'; args.push(Number(st)); }
  if (q.tank_id) { w += ' AND d.tank_id=?'; args.push(Number(q.tank_id)); }
  if (q.from) { w += ' AND d.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND d.doc_date<=?'; args.push(q.to); }
  const lim = Math.min(Number(q.limit) || 100, 500);
  const off = Math.max(0, Number(q.offset) || 0);
  return D.all(`SELECT d.*, t.code tank_code, t.name tank_name, p.name product_name, p.color,
      u.full_name read_by_name
    FROM dip d JOIN tank t ON t.id=d.tank_id JOIN product p ON p.id=t.product_id
    LEFT JOIN app_user u ON u.id=d.read_by
    ${w} ORDER BY d.read_at DESC LIMIT ${lim} OFFSET ${off}`, ...args);
});

/* یک ثبت دیپ — همیشه داخل معامله (خودش یا معامله بیرونی) */
function insertDip(user, b, shiftId) {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const t = tankFull(tankId);
  if (b.dip_mm === undefined || b.dip_mm === null || b.dip_mm === '')
    throw fail(400, 'عدد دیپ را وارد کنید');
  const dipMm = numField(b, 'dip_mm', 'عدد دیپ', { min: 0 });
  const dd = docDate(b.doc_date);
  const backdate = guardDate(user, t.station_id, dd, b, 'دیپ تانک ' + t.code);

  const v = dipVolumes(tankId, dipMm, b.water_mm);
  const d15 = densityField(b, 'density15', t.default_density);
  const temp = b.temp_c === '' || b.temp_c === undefined ? 15 : N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const book = D.tankBook(tankId, dd);
  const varr = Petro.variance(v.net, book, 0);

  return D.tx(() => {
    const r = D.run(`INSERT INTO dip
      (station_id,tank_id,read_at,doc_date,kind,dip_mm,water_mm,temp_c,density15,
       vol_gross_l,vol_water_l,vol_net_l,vol15_l,book_l,variance_l,variance_pct,
       shift_id,read_by,note,calib_version_id,backdate_reason,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      t.station_id, tankId, b.read_at || D.now(), dd, b.kind || 'spot',
      dipMm, N(b.water_mm), temp, d15,
      v.gross, v.water, v.net, R(v.net * vcf, 3), book, varr.qty, varr.pct,
      shiftId || null, user.id, b.note || null, v.version_id, backdate, D.now());
    const id = Number(r.lastInsertRowid);

    /* ---- کنترل‌های ضد-تقلب ---- */
    const tol = N(t.tolerance_pct, 0.5);
    if (Math.abs(varr.pct) > tol)
      D.raiseAlert(t.station_id, Math.abs(varr.pct) > tol * 2 ? 'high' : 'medium',
        'DIP_VARIANCE', 'کسری تانک ' + t.code + ' بیش از حد مجاز',
        'آخرین کسری ' + varr.qty + ' لیتر (' + varr.pct + '٪) در برابر تولرانس ' + tol + '٪',
        'tank', tankId);

    const prev = D.get(`SELECT dip_mm, vol_net_l, read_at FROM dip
                        WHERE tank_id=? AND id<>? ORDER BY read_at DESC LIMIT 1`, tankId, id);
    if (prev) {
      if (N(prev.dip_mm) === dipMm)
        D.raiseAlert(t.station_id, 'medium', 'DIP_REPEATED',
          'دیپ تکراری در تانک ' + t.code,
          'عدد دیپ عیناً برابر دیپ قبلی است (' + dipMm + ' mm). احتمال کاپی کردن بدون اندازه‌گیری.',
          'dip', id);

      /* پرش دیپ فقط وقتی غیرعادی است که تخلیه یا انتقالی در این فاصله ثبت نشده باشد.
         تخلیه قانونی تانکر طبیعتاً سطح را زیاد بالا می‌برد. */
      const bigMove = D.get(`SELECT COUNT(*) c FROM stock_move
         WHERE tank_id=? AND created_at > ? AND source_type IN ('receipt','transfer','adjust')`,
        tankId, prev.read_at);
      if (!bigMove.c) {
        const jump = N(D.setting('dip_jump_pct', '25'));
        const capL = N(t.capacity_l) || 1;
        const delta = Math.abs(v.net - N(prev.vol_net_l)) / capL * 100;
        if (delta > jump)
          D.raiseAlert(t.station_id, 'medium', 'DIP_JUMP',
            'پرش غیرعادی دیپ در تانک ' + t.code,
            'تغییر ' + R(delta, 1) + '٪ ظرفیت نسبت به دیپ قبلی، بدون ثبت تخلیه یا انتقال. کنترل شود.',
            'tank', tankId);
      }
    }
    D.audit(user, 'ثبت دیپ', 'dip', id,
      'تانک ' + t.code + ' — ' + dipMm + 'mm — خالص ' + v.net + ' لیتر — کسری ' + varr.qty);
    return {
      id, gross: v.gross, water: v.water, net: v.net, book_l: book,
      variance_l: varr.qty, variance_pct: varr.pct
    };
  });
}
A.insertDip = insertDip;

route('POST', '/dips', 'dip', ({ user, b }) =>
  D.idempotent(b.idem_key, 'dip', user, () => insertDip(user, b, b.shift_id)));

/* ============================================================
   شفت
   ============================================================ */
route('GET', '/shifts', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND s.station_id=?'; args.push(Number(st)); }
  if (q.status) { w += ' AND s.status=?'; args.push(q.status); }
  if (q.from) { w += ' AND s.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND s.doc_date<=?'; args.push(q.to); }
  const lim = Math.min(Number(q.limit) || 60, 300);
  const off = Math.max(0, Number(q.offset) || 0);
  return D.all(`SELECT s.*, p.name operator_name, st.name station_name
    FROM shift s JOIN party p ON p.id=s.operator_id JOIN station st ON st.id=s.station_id
    ${w} ORDER BY s.opened_at DESC LIMIT ${lim} OFFSET ${off}`, ...args);
});

route('GET', '/shifts/:id', 'read', ({ params }) => {
  const s = D.get(`SELECT s.*, p.name operator_name, st.name station_name
    FROM shift s JOIN party p ON p.id=s.operator_id JOIN station st ON st.id=s.station_id
    WHERE s.id=?`, params.id);
  if (!s) throw fail(404, 'شفت یافت نشد');
  s.readings = D.all(`SELECT r.*, n.code nozzle_code, n.meter_digits, n.meter_factor,
      d.code dispenser_code, t.code tank_code, pr.name product_name, pr.color
    FROM nozzle_reading r JOIN nozzle n ON n.id=r.nozzle_id
    JOIN dispenser d ON d.id=n.dispenser_id JOIN tank t ON t.id=r.tank_id
    JOIN product pr ON pr.id=r.product_id
    WHERE r.shift_id=? ORDER BY d.code, n.code`, params.id);
  s.tenders = D.all(`SELECT t.*, p.name party_name FROM shift_tender t
    LEFT JOIN party p ON p.id=t.party_id WHERE t.shift_id=?`, params.id);
  s.dips = D.all(`SELECT d.*, t.code tank_code FROM dip d JOIN tank t ON t.id=d.tank_id
    WHERE d.shift_id=? ORDER BY d.read_at`, params.id);
  s.checkpoints = D.all(`SELECT c.*, p.name product_name FROM price_checkpoint c
    JOIN product p ON p.id=c.product_id WHERE c.shift_id=? ORDER BY c.at, c.id`, params.id);
  /* ریدینگ نازل‌ها در هر نقطه کنترل — مرورگر با همین، فروش را زنده حساب می‌کند */
  for (const c of s.checkpoints)
    c.readings = D.all(`SELECT nozzle_id, reading, rollovers FROM price_checkpoint_reading
                        WHERE checkpoint_id=?`, c.id);
  s.segments = D.all(`SELECT g.*, n.code nozzle_code FROM nozzle_segment g
    JOIN nozzle n ON n.id=g.nozzle_id WHERE g.shift_id=? ORDER BY g.nozzle_id, g.seq`, params.id);
  s.credit_tickets = D.all(`SELECT c.*, p.name party_name, v.plate_no, pr.name product_name
    FROM credit_ticket c JOIN party p ON p.id=c.party_id
    LEFT JOIN vehicle v ON v.id=c.vehicle_id LEFT JOIN product pr ON pr.id=c.product_id
    WHERE c.shift_id=? AND c.status='posted' ORDER BY c.id`, params.id);
  s.credit_total = R(s.credit_tickets.reduce((a, x) => a + N(x.amount), 0), 2);
  return s;
});

/* باز کردن شفت */
route('POST', '/shifts/open', 'shift', ({ user, b }) => {
  const stationId = stationScope(user, req(b, 'station_id', 'استیشن'));
  const operatorId = Number(req(b, 'operator_id', 'اپراتور'));
  const open = D.get(`SELECT id FROM shift WHERE station_id=? AND status='open'`, stationId);
  if (open) throw fail(400, 'یک شفت باز در این استیشن وجود دارد. اول آن را ببندید.');

  const dd = docDate(b.doc_date);
  guardDate(user, stationId, dd, b, 'باز کردن شفت');

  return D.idempotent(b.idem_key, 'shift_open', user, () => D.tx(() => {
    const r = D.run(`INSERT INTO shift
      (station_id,operator_id,code,doc_date,opened_at,float_amount,status,opened_by,note)
      VALUES (?,?,?,?,?,?, 'open', ?,?)`,
      stationId, operatorId, b.code || null, dd, b.opened_at || D.now(),
      numField(b, 'float_amount', 'صندوق افتتاحیه', { optional: true, min: 0 }), user.id, b.note || null);
    const shiftId = Number(r.lastInsertRowid);

    const nozzles = D.all(`SELECT n.*, t.product_id FROM nozzle n
      JOIN dispenser d ON d.id=n.dispenser_id JOIN tank t ON t.id=n.tank_id
      WHERE d.station_id=? AND n.active=1`, stationId);
    if (!nozzles.length) throw fail(400, 'برای این استیشن نازل فعال ثبت نشده است');

    const given = {};
    (b.nozzles || []).forEach(x => given[Number(x.nozzle_id)] = N(x.opening));

    const noPrice = [];
    for (const n of nozzles) {
      const opening = given[n.id] !== undefined ? given[n.id] : N(n.last_reading);
      if (opening < N(n.last_reading) - 0.001)
        throw fail(400, 'قرائت ابتدایی نازل ' + n.code + ' از آخرین قرائت ثبت‌شده ('
          + N(n.last_reading) + ') کمتر است. عدد را کنترل کنید.');
      const price = D.activePrice(n.product_id, stationId, dd);
      if (price <= 0) {
        const pn = D.get(`SELECT name FROM product WHERE id=?`, n.product_id);
        if (noPrice.indexOf(pn.name) < 0) noPrice.push(pn.name);
      }
      D.run(`INSERT INTO nozzle_reading (shift_id,nozzle_id,tank_id,product_id,opening,price,meter_factor_used)
             VALUES (?,?,?,?,?,?,?)`, shiftId, n.id, n.tank_id, n.product_id, opening, price,
        N(n.meter_factor, 1) || 1);
    }
    if (noPrice.length)
      throw fail(400, 'برای این محصولات نرخ ثبت نشده است: ' + noPrice.join('، ')
        + '. اول در بخش نرخ‌نامه نرخ را ثبت کنید.');

    (b.dips || []).forEach(dp => insertDip(user, Object.assign({}, dp, { kind: 'open', doc_date: dd }), shiftId));

    D.audit(user, 'باز کردن شفت', 'shift', shiftId,
      'استیشن ' + stationId + ' — ' + nozzles.length + ' نازل — صندوق افتتاحیه ' + N(b.float_amount));
    return { id: shiftId };
  }));
});

/* ---------- تقسیم فروش نازل بین بازه‌های نرخ ---------- */
/* اگر وسط شفت نرخ تغییر کرده باشد، فروش هر نازل به چند بخش تقسیم می‌شود:
   شروع → نقطه کنترل ۱ (نرخ قدیم)، نقطه ۱ → نقطه ۲، ... ، آخرین نقطه → ختم (نرخ جدید). */
function buildSegments(reading, closing, rollovers, testReturn, checkpoints) {
  const digits = reading.meter_digits || 6;
  const factor = N(reading.meter_factor_used, N(reading.meter_factor, 1)) || 1;
  const mine = checkpoints
    .filter(c => c.product_id === reading.product_id && c.reading !== undefined && c.reading !== null)
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  const points = [{ value: N(reading.opening), rollovers: 0, checkpoint: null }];
  for (const c of mine) points.push({ value: N(c.reading), rollovers: Number(c.rollovers) || 0, checkpoint: c });
  points.push({ value: N(closing), rollovers: Number(rollovers) || 0, checkpoint: null });

  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], bpt = points[i];
    const price = a.checkpoint ? N(a.checkpoint.new_price)
      : (mine.length ? N(mine[0].old_price) : N(reading.price));
    const isLast = i === points.length - 1;
    const sold = Petro.nozzleSold(a.value, bpt.value, digits, bpt.rollovers,
      isLast ? N(testReturn) : 0, factor);
    segs.push({
      seq: i, checkpoint_id: a.checkpoint ? a.checkpoint.id : (i === 1 ? null : null),
      opening: a.value, closing: bpt.value, rollovers: bpt.rollovers,
      sold_l: R(sold, 3), price: R(price, 4), amount: R(sold * price, 2)
    });
  }
  return segs;
}
A.buildSegments = buildSegments;

/* بستن شفت */
route('POST', '/shifts/:id/close', 'shift', ({ user, params, b }) => {
  const s = D.get(`SELECT * FROM shift WHERE id=?`, params.id);
  if (!s) throw fail(404, 'شفت یافت نشد');
  if (s.status === 'closed') throw fail(400, 'این شفت قبلاً بسته شده است');
  stationScope(user, s.station_id);
  guardDate(user, s.station_id, s.doc_date, b, 'بستن شفت #' + s.id);

  const readings = D.all(`SELECT r.*, n.meter_digits, n.meter_factor, n.code nozzle_code
    FROM nozzle_reading r JOIN nozzle n ON n.id=r.nozzle_id WHERE r.shift_id=?`, params.id);
  if (!readings.length) throw fail(400, 'این شفت هیچ نازلی ندارد');

  /* نقاط کنترل نرخ این شفت، با ریدینگ هر نازل */
  const chkRows = D.all(`SELECT * FROM price_checkpoint WHERE shift_id=? ORDER BY at, id`, params.id);
  const chkReadings = D.all(`SELECT * FROM price_checkpoint_reading
    WHERE checkpoint_id IN (SELECT id FROM price_checkpoint WHERE shift_id=?)`, params.id);

  const given = {};
  (b.readings || []).forEach(x => given[Number(x.nozzle_id)] = x);

  return D.idempotent(b.idem_key, 'shift_close', user, () => D.tx(() => {
    let totalL = 0, totalAmount = 0;
    const perTank = {};
    const soldByProduct = {};

    D.run(`DELETE FROM nozzle_segment WHERE shift_id=?`, params.id);

    for (const r of readings) {
      const g = given[r.nozzle_id] || {};
      if (g.closing === undefined || g.closing === null || g.closing === '')
        throw fail(400, 'ریدینگ اخیر نازل ' + r.nozzle_code + ' وارد نشده است');
      const closing = Number(String(g.closing).trim());
      if (!isFinite(closing) || closing < 0)
        throw fail(400, 'ریدینگ نازل ' + r.nozzle_code + ' درست نیست');
      const meterMax = Math.pow(10, r.meter_digits || 6);
      if (closing >= meterMax)
        throw fail(400, 'ریدینگ نازل ' + r.nozzle_code + ' از ظرفیت کنتور ('
          + (r.meter_digits || 6) + ' رقم) بیشتر است. عدد را کنترل کنید.');
      const rollovers = Number(g.rollovers) || 0;
      const testReturn = N(g.test_return_l);
      if (testReturn < 0) throw fail(400, 'برگشت تست نازل ' + r.nozzle_code + ' نمی‌تواند منفی باشد');

      const chk = chkRows.map(c => {
        const rr = chkReadings.find(x => x.checkpoint_id === c.id && x.nozzle_id === r.nozzle_id);
        return Object.assign({}, c, { reading: rr ? rr.reading : null, rollovers: rr ? rr.rollovers : 0 });
      });
      const segs = buildSegments(r, closing, rollovers, testReturn, chk);

      let sold = 0, amount = 0;
      for (const sg of segs) {
        /* ریدینگ کمتر از عدد قبلی معمولاً اشتباه تایپی است، نه چرخش کنتور.
           بدون تایید صریح کاربر، یک عدد اشتباه به ~۱،۰۰۰،۰۰۰ لیتر تبدیل می‌شد. */
        if (sg.closing < sg.opening && !sg.rollovers)
          throw fail(400, 'ریدینگ نازل ' + r.nozzle_code + ' (' + sg.closing
            + ') از عدد قبلی (' + sg.opening + ') کمتر است. '
            + 'اگر کنتور واقعاً چرخیده، در «چرخش کنتور» عدد ۱ را بنویسید.');
        if (sg.sold_l < 0) throw fail(400,
          'فروش منفی در نازل ' + r.nozzle_code + '. ریدینگ‌ها را کنترل کنید.');
        if (sg.sold_l > 0 && sg.price <= 0) throw fail(400,
          'نرخ نازل ' + r.nozzle_code + ' صفر است. اول نرخ محصول را در نرخ‌نامه ثبت کنید.');
        sold += sg.sold_l; amount += sg.amount;
        D.run(`INSERT INTO nozzle_segment
          (shift_id,nozzle_id,seq,checkpoint_id,opening,closing,rollovers,sold_l,price,amount)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
          s.id, r.nozzle_id, sg.seq, sg.checkpoint_id, sg.opening, sg.closing,
          sg.rollovers, sg.sold_l, sg.price, sg.amount);
      }
      sold = R(sold, 3); amount = R(amount, 2);
      const avgPrice = sold > 0 ? R(amount / sold, 4) : N(r.price);

      D.run(`UPDATE nozzle_reading SET closing=?,rollovers=?,test_return_l=?,sold_l=?,price=?,amount=?
             WHERE id=?`, closing, rollovers, testReturn, sold, avgPrice, amount, r.id);
      D.run(`UPDATE nozzle SET last_reading=? WHERE id=?`, closing, r.nozzle_id);

      totalL = R(totalL + sold, 3);
      totalAmount = R(totalAmount + amount, 2);
      perTank[r.tank_id] = R(N(perTank[r.tank_id]) + sold, 3);
      soldByProduct[r.product_id] = R(N(soldByProduct[r.product_id]) + sold, 3);

      if (testReturn > 0)
        D.addStockMove({
          doc_date: s.doc_date, station_id: s.station_id, tank_id: r.tank_id,
          product_id: r.product_id, direction: 'in', qty_obs: testReturn,
          source_type: 'test_return', source_id: s.id,
          note: 'برگشت تست نازل ' + r.nozzle_code, unit_cost: D.tankWac(r.tank_id)
        }, user);
    }

    /* خروج موجودی هر تانک */
    for (const tankId of Object.keys(perTank)) {
      const qty = perTank[tankId];
      if (qty <= 0) continue;
      const t = D.get(`SELECT id, code, product_id FROM tank WHERE id=?`, Number(tankId));
      const bookBefore = D.tankBook(Number(tankId));
      if (qty > bookBefore)
        D.raiseAlert(s.station_id, 'high', 'NEGATIVE_STOCK',
          'فروش بیش از موجودی تانک ' + t.code,
          'فروش شفت ' + R(qty, 2) + ' لیتر در برابر موجودی دفتری ' + R(bookBefore, 2)
          + ' لیتر. یا دیپ افتتاحیه غلط است، یا ورود تیل ثبت نشده، یا فروش خارج سیستم انجام شده.',
          'shift', s.id);
      D.addStockMove({
        doc_date: s.doc_date, station_id: s.station_id, tank_id: Number(tankId),
        product_id: t.product_id, direction: 'out', qty_obs: qty,
        unit_cost: D.tankWac(Number(tankId)),
        source_type: 'shift', source_id: s.id, note: 'فروش شفت #' + s.id
      }, user);
    }

    /* ---- فروش قرضی نازل (بلیت‌های همین شفت) ----
       این‌ها لیتر جدا ندارند — لیترشان قبلاً در ریدینگ نازل حساب شده.
       فقط از نقده مورد انتظار کم می‌شوند. طلب مشتری هنگام ثبت بلیت ساخته شد. */
    const tickets = D.all(`SELECT * FROM credit_ticket WHERE shift_id=? AND status='posted'`, s.id);
    const ticketTotal = R(tickets.reduce((a, x) => a + N(x.amount), 0), 2);
    const ticketLiters = {};
    for (const tk of tickets)
      ticketLiters[tk.product_id] = R(N(ticketLiters[tk.product_id]) + N(tk.qty_l), 3);
    for (const pid of Object.keys(ticketLiters)) {
      if (ticketLiters[pid] > N(soldByProduct[pid]) + 0.5) {
        const pn = D.get(`SELECT name FROM product WHERE id=?`, Number(pid));
        D.raiseAlert(s.station_id, 'high', 'CREDIT_TICKET_EXCESS',
          'فروش قرضی بیشتر از فروش نازل — ' + (pn ? pn.name : pid),
          'مجموع بلیت‌های قرضی ' + ticketLiters[pid] + ' لیتر است ولی کنتور نازل‌ها فقط '
          + N(soldByProduct[pid]) + ' لیتر نشان می‌دهد. بلیت‌ها یا ریدینگ کنترل شود.',
          'shift', s.id);
      }
    }

    /* ---- قبض‌های دستی: کوپن، بانک، حواله، نسیه بدون بلیت ---- */
    D.run(`DELETE FROM shift_tender WHERE shift_id=?`, params.id);
    let nonCash = 0;
    for (const t of (b.tenders || [])) {
      const amt = N(t.amount);
      if (amt <= 0) continue;
      D.run(`INSERT INTO shift_tender (shift_id,kind,party_id,amount,ref_no,note)
             VALUES (?,?,?,?,?,?)`, params.id, t.kind, t.party_id ? Number(t.party_id) : null,
        amt, t.ref_no || null, t.note || null);
      nonCash = R(nonCash + amt, 2);

      if (t.kind === 'credit') {
        if (!t.party_id) throw fail(400, 'برای فروش نسیه، مشتری را انتخاب کنید');
        creditGuard(user, b, s.station_id, Number(t.party_id), amt, 'فروش نسیه شفت #' + s.id);
        D.addMoneyMove({
          doc_date: s.doc_date, station_id: s.station_id, account: 'receivable',
          party_id: Number(t.party_id), direction: 'in', amount: amt, method: 'credit',
          source_type: 'shift', source_id: s.id, note: 'فروش نسیه شفت #' + s.id
        }, user);
      } else {
        D.addMoneyMove({
          doc_date: s.doc_date, station_id: s.station_id, account: payAccount(t.kind),
          party_id: t.party_id ? Number(t.party_id) : null, direction: 'in', amount: amt,
          method: t.kind, ref_no: t.ref_no || null,
          source_type: 'shift', source_id: s.id, note: 'قبض ' + t.kind + ' شفت #' + s.id
        }, user);
      }
    }

    /* تسویه:  فروش = نقده + قبض‌ها + بلیت‌های قرضی */
    const cashExpected = R(totalAmount - nonCash - ticketTotal, 2);
    const cashCounted = N(b.cash_counted);
    if (cashCounted < 0) throw fail(400, 'نقده شمرده‌شده نمی‌تواند منفی باشد');
    const cashVar = R(cashCounted - cashExpected, 2);

    if (cashCounted > 0 || cashExpected > 0)
      D.addMoneyMove({
        doc_date: s.doc_date, station_id: s.station_id, account: 'cash',
        direction: 'in', amount: cashCounted, method: 'cash',
        source_type: 'shift', source_id: s.id, note: 'نقده شمرده شفت #' + s.id
      }, user);

    D.addMoneyMove({
      doc_date: s.doc_date, station_id: s.station_id, account: 'sales',
      direction: 'in', amount: totalAmount, method: 'mixed',
      source_type: 'shift', source_id: s.id, note: 'فروش خرده شفت #' + s.id
    }, user);

    (b.dips || []).forEach(dp => insertDip(user, Object.assign({}, dp, { kind: 'close', doc_date: s.doc_date }), s.id));

    D.run(`UPDATE shift SET closed_at=?,total_liters=?,total_amount=?,cash_expected=?,
        cash_counted=?,cash_variance=?,status='closed',closed_by=?,note=COALESCE(?,note)
        WHERE id=?`,
      b.closed_at || D.now(), totalL, totalAmount, cashExpected, cashCounted, cashVar,
      user.id, b.note || null, params.id);

    /* کسری صندوق -> بدهی اپراتور */
    const tolCash = N(D.setting('cash_tolerance', '50'));
    if (cashVar < -tolCash) {
      D.addMoneyMove({
        doc_date: s.doc_date, station_id: s.station_id, account: 'receivable',
        party_id: s.operator_id, direction: 'in', amount: Math.abs(cashVar), method: 'credit',
        source_type: 'shift', source_id: s.id, note: 'کسری صندوق شفت #' + s.id
      }, user);
      D.raiseAlert(s.station_id, Math.abs(cashVar) > tolCash * 10 ? 'high' : 'medium',
        'CASH_SHORT', 'کسری صندوق در شفت #' + s.id,
        'کسری ' + Math.abs(cashVar) + ' — به حساب اپراتور منظور شد.', 'shift', s.id);
    } else if (cashVar > tolCash * 10) {
      /* اضافه بزرگ صندوق هم علامت است: فروش ثبت‌نشده یا پوشاندن کسری قبلی */
      D.raiseAlert(s.station_id, 'medium', 'CASH_OVER',
        'اضافه غیرعادی صندوق در شفت #' + s.id,
        'اضافه ' + cashVar + ' نسبت به فروش ثبت‌شده. یا فروشی خارج از سیستم انجام شده،'
        + ' یا ریدینگ نازل کمتر از واقع ثبت شده.', 'shift', s.id);
    }

    D.audit(user, 'بستن شفت', 'shift', s.id,
      'فروش ' + totalL + ' لیتر — ' + totalAmount + ' — قرضی ' + ticketTotal
      + ' — کسری صندوق ' + cashVar);

    return {
      id: s.id, total_liters: totalL, total_amount: totalAmount,
      credit_tickets: ticketTotal, other_tenders: nonCash,
      cash_expected: cashExpected, cash_counted: cashCounted, cash_variance: cashVar
    };
  }));
});

/* ============================================================
   ورود تیل (تخلیه)
   ============================================================ */
route('GET', '/receipts', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND r.station_id=?'; args.push(Number(st)); }
  if (q.from) { w += ' AND r.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND r.doc_date<=?'; args.push(q.to); }
  const lim = Math.min(Number(q.limit) || 80, 400);
  const off = Math.max(0, Number(q.offset) || 0);
  return D.all(`SELECT r.*, s.name supplier_name, tr.name transporter_name,
      t.code tank_code, p.name product_name, p.color, st.name station_name,
      (SELECT result FROM quality_check qc WHERE qc.receipt_id=r.id ORDER BY qc.id DESC LIMIT 1) quality_result
    FROM receipt r LEFT JOIN party s ON s.id=r.supplier_id
    LEFT JOIN party tr ON tr.id=r.transporter_id
    JOIN tank t ON t.id=r.tank_id JOIN product p ON p.id=r.product_id
    JOIN station st ON st.id=r.station_id
    ${w} ORDER BY r.doc_date DESC, r.id DESC LIMIT ${lim} OFFSET ${off}`, ...args);
});

route('GET', '/receipts/:id', 'read', ({ params }) => {
  const r = D.get(`SELECT r.*, s.name supplier_name, tr.name transporter_name,
      t.code tank_code, t.name tank_name, p.name product_name, st.name station_name
    FROM receipt r LEFT JOIN party s ON s.id=r.supplier_id
    LEFT JOIN party tr ON tr.id=r.transporter_id
    JOIN tank t ON t.id=r.tank_id JOIN product p ON p.id=r.product_id
    JOIN station st ON st.id=r.station_id WHERE r.id=?`, params.id);
  if (!r) throw fail(404, 'سند تخلیه یافت نشد');
  r.quality = D.all(`SELECT * FROM quality_check WHERE receipt_id=? ORDER BY id DESC`, params.id);
  r.moves = D.all(`SELECT * FROM stock_move WHERE source_type='receipt' AND source_id=?`, params.id);
  return r;
});

/* محاسبه بدون ثبت */
route('POST', '/receipts/calc', 'read', ({ b }) => {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const t = tankFull(tankId);
  const before = dipVolumes(tankId, b.dip_before_mm, b.water_before_mm);
  const after = dipVolumes(tankId, b.dip_after_mm, b.water_after_mm);
  const volObs = R(after.net - before.net, 3);
  const d15 = densityField(b, 'density15', t.default_density);
  const temp = b.temp_c === '' || b.temp_c === undefined ? 15 : N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const vol15 = R(volObs * vcf, 3);
  const mt = Petro.toMT(vol15, d15);
  const srcMt = N(b.src_qty_mt);
  const varMt = R(mt - srcMt, 6);
  const varPct = srcMt > 0 ? R(varMt / srcMt * 100, 3) : 0;
  const srcD = Petro.normDensity(b.src_density15);
  return {
    vol_before_l: before.net, vol_after_l: after.net, vol_obs_l: volObs,
    vcf, vol15_l: vol15, qty_mt: mt,
    src_qty15: srcD ? Petro.mtToV15(srcMt, srcD) : 0,
    variance_mt: varMt, variance_pct: varPct,
    tolerance_pct: N(t.tolerance_pct, 0.5),
    over_tolerance: srcMt > 0 && Math.abs(varPct) > N(t.tolerance_pct, 0.5),
    capacity_free: R(N(t.capacity_l) - after.net, 3),
    overflow: N(t.capacity_l) > 0 && after.net > N(t.capacity_l)
  };
});

route('POST', '/receipts', 'ops', ({ user, b }) => {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const t = tankFull(tankId);
  stationScope(user, t.station_id);

  const dd = docDate(b.doc_date);
  const backdate = guardDate(user, t.station_id, dd, b, 'ورود تیل');

  const before = dipVolumes(tankId, b.dip_before_mm, b.water_before_mm);
  const after = dipVolumes(tankId, b.dip_after_mm, b.water_after_mm);
  const volObs = R(after.net - before.net, 3);
  if (volObs <= 0) throw fail(400, 'دیپ بعد از تخلیه باید بزرگتر از دیپ قبل باشد');

  const d15 = densityField(b, 'density15', t.default_density);
  const temp = b.temp_c === '' || b.temp_c === undefined ? 15 : N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const vol15 = R(volObs * vcf, 3);
  const mt = Petro.toMT(vol15, d15);
  const srcMt = N(b.src_qty_mt);
  const srcD15 = Petro.normDensity(b.src_density15);
  const varMt = R(mt - srcMt, 6);
  const varPct = srcMt > 0 ? R(varMt / srcMt * 100, 3) : 0;

  const currency = String(b.currency || D.baseCurrency()).toUpperCase();
  let fx = 1;
  if (currency !== D.baseCurrency()) {
    fx = N(b.fx_rate) || D.fxRate(currency, dd);
    if (!fx) throw fail(400, 'نرخ ' + currency + ' ثبت نشده است. اول نرخ اسعار را وارد کنید.');
  }
  const unitCost = numField(b, 'unit_cost', 'قیمت هر لیتر', { optional: true, min: 0 });
  const otherCost = numField(b, 'other_cost', 'مصارف جانبی', { optional: true, min: 0 });
  const goodsCcy = R(unitCost * volObs, 2);           // به ارز سند
  const goodsBase = R(goodsCcy * fx, 2);              // به ارز پایه
  const totalCost = R(goodsBase + otherCost, 2);      // ارز پایه (مصارف جانبی همیشه پایه)
  const landedUnit = volObs > 0 ? R(totalCost / volObs, 6) : 0;

  const ownerId = D.settingOn('consignment_on', false) && b.owner_party_id
    ? Number(b.owner_party_id) : null;

  return D.idempotent(b.idem_key, 'receipt', user, () => D.tx(() => {
    const r = D.run(`INSERT INTO receipt
      (station_id,supplier_id,transporter_id,tank_id,product_id,doc_date,waybill_no,truck_plate,
       driver_name,driver_phone,entry_port,seal_out,seal_in,src_qty_mt,src_density15,src_temp,src_qty15,
       dip_before_mm,water_before_mm,dip_after_mm,water_after_mm,vol_before_l,vol_after_l,
       temp_c,density15,vol_obs_l,vcf,vol15_l,qty_mt,variance_mt,variance_pct,
       unit_cost,other_cost,total_cost,total_cost_ccy,currency,fx_rate,quality_ok,quality_note,payment_kind,
       calib_version_id,owner_party_id,order_id,backdate_reason,status,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,?)`,
      t.station_id, b.supplier_id ? Number(b.supplier_id) : null,
      b.transporter_id ? Number(b.transporter_id) : null, tankId, t.product_id, dd,
      b.waybill_no || null, b.truck_plate || null, b.driver_name || null, b.driver_phone || null,
      b.entry_port || null, b.seal_out || null, b.seal_in || null,
      srcMt, srcD15 || null, N(b.src_temp) || null,
      srcD15 ? Petro.mtToV15(srcMt, srcD15) : 0,
      N(b.dip_before_mm), N(b.water_before_mm), N(b.dip_after_mm), N(b.water_after_mm),
      before.net, after.net, temp, d15, volObs, vcf, vol15, mt, varMt, varPct,
      unitCost, otherCost, totalCost, goodsCcy, currency, fx,
      b.quality_ok === false ? 0 : 1, b.quality_note || null, b.payment_kind || 'credit',
      after.version_id, ownerId, b.order_id ? Number(b.order_id) : null, backdate,
      b.note || null, user.id, D.now());
    const id = Number(r.lastInsertRowid);

    D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
      direction: 'in', qty_obs: volObs, temp_c: temp, density15: d15, vcf, qty15: vol15,
      qty_mt: mt, unit_cost: landedUnit, source_type: 'receipt', source_id: id,
      owner_party_id: ownerId,
      note: 'تخلیه بارنامه ' + (b.waybill_no || '—')
    }, user);

    /* تیل امانتی خرید نیست — بدهی به تهیه‌کننده ساخته نمی‌شود */
    if (totalCost > 0 && !ownerId) {
      const kind = b.payment_kind || 'credit';
      if (kind === 'credit') {
        D.addMoneyMove({
          doc_date: dd, station_id: t.station_id, account: 'payable',
          party_id: b.supplier_id ? Number(b.supplier_id) : null, direction: 'out',
          amount: totalCost, source_type: 'receipt', source_id: id, method: 'credit',
          note: 'خرید تیل — بارنامه ' + (b.waybill_no || '—')
            + (currency !== D.baseCurrency() ? ' — ' + goodsCcy + ' ' + currency + ' @ ' + fx : '')
        }, user);
      } else {
        D.addMoneyMove({
          doc_date: dd, station_id: t.station_id, account: payAccount(kind),
          party_id: b.supplier_id ? Number(b.supplier_id) : null, direction: 'out',
          amount: totalCost, method: kind, ref_no: b.ref_no || null,
          source_type: 'receipt', source_id: id, note: 'پرداخت خرید تیل'
        }, user);
      }
    }

    /* سند کنترل کیفیت */
    if (D.settingOn('quality_on', true) &&
      (b.quality_ok === false || b.quality_result || b.quality_note || b.lab_name || b.quality_certificate_no)) {
      const result = b.quality_result || (b.quality_ok === false ? 'fail' : 'pass');
      D.run(`INSERT INTO quality_check
        (receipt_id,station_id,tank_id,sample_date,density15,temp_c,water_ppm,result,
         lab_name,certificate_no,note,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, t.station_id, tankId, docDate(b.quality_sample_date || dd), d15, temp,
        b.water_ppm === '' || b.water_ppm === undefined ? null : N(b.water_ppm),
        result, b.lab_name || null, b.quality_certificate_no || null,
        b.quality_note || null, user.id, D.now());
      if (result === 'fail')
        D.run(`UPDATE receipt SET quality_ok=0 WHERE id=?`, id);
    }

    /* سفارش مربوطه به‌روز شود */
    if (b.order_id) {
      D.run(`UPDATE fuel_order SET delivered_l = delivered_l + ?,
             status = CASE WHEN delivered_l + ? >= qty_l THEN 'received' ELSE 'in_transit' END
             WHERE id=?`, volObs, volObs, Number(b.order_id));
    }

    /* ---- کنترل‌های ضد-تقلب ---- */
    const tol = N(t.tolerance_pct, 0.5);
    if (srcMt > 0 && Math.abs(varPct) > tol)
      D.raiseAlert(t.station_id, Math.abs(varPct) > tol * 2 ? 'high' : 'medium',
        'TRANSIT_LOSS', 'کسری ترانزیت بیش از حد — بارنامه ' + (b.waybill_no || '—'),
        'مبدا ' + srcMt + ' MT، دریافتی ' + mt + ' MT، کسری ' + varMt + ' MT (' + varPct + '٪). '
        + 'ترانسپورتر: ' + (b.transporter_id ? (D.get('SELECT name FROM party WHERE id=?', Number(b.transporter_id)) || {}).name : '—'),
        'receipt', id);

    if (b.seal_out && b.seal_in && String(b.seal_out).trim() !== String(b.seal_in).trim())
      D.raiseAlert(t.station_id, 'high', 'SEAL_MISMATCH',
        'شماره مهر نمی‌خواند — بارنامه ' + (b.waybill_no || '—'),
        'مهر مبدا: ' + b.seal_out + ' — مهر مقصد: ' + b.seal_in + '. احتمال باز شدن تانکر در راه.',
        'receipt', id);

    if (srcD15 && d15) {
      const dDiff = Math.abs(d15 - srcD15);
      if (dDiff > 0.008)
        D.raiseAlert(t.station_id, 'high', 'DENSITY_MISMATCH',
          'اختلاف ثقلت مبدا و مقصد — بارنامه ' + (b.waybill_no || '—'),
          'مبدا ' + srcD15 + ' — مقصد ' + d15 + ' (اختلاف ' + R(dDiff, 5) + '). احتمال تعویض محموله.',
          'receipt', id);
    }

    if (b.quality_ok === false || b.quality_result === 'fail')
      D.raiseAlert(t.station_id, 'high', 'QUALITY_FAIL',
        'محموله با کیفیت نامناسب ثبت شد — بارنامه ' + (b.waybill_no || '—'),
        b.quality_note || 'بدون توضیح', 'receipt', id);

    if (N(t.capacity_l) > 0 && after.net > N(t.capacity_l))
      D.raiseAlert(t.station_id, 'high', 'TANK_OVERFLOW',
        'سطح تانک ' + t.code + ' از ظرفیت گذشت',
        'بعد تخلیه ' + after.net + ' لیتر در برابر ظرفیت ' + t.capacity_l, 'receipt', id);

    D.audit(user, 'ثبت تخلیه', 'receipt', id,
      'تانک ' + t.code + ' — ' + volObs + ' لیتر — ' + mt + ' MT — کسری ' + varMt + ' MT'
      + (ownerId ? ' — امانتی' : ''));

    return {
      id, vol_obs_l: volObs, vol15_l: vol15, qty_mt: mt,
      variance_mt: varMt, variance_pct: varPct, total_cost: totalCost
    };
  }));
});

/* برگشت سند تخلیه — حذف نمی‌شود، سند معکوس ساخته می‌گردد */
route('POST', '/receipts/:id/reverse', 'setup', ({ user, params, b }) => {
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) throw fail(400, 'دلیل برگشت سند را کامل بنویسید');
  const r = D.get(`SELECT * FROM receipt WHERE id=?`, params.id);
  if (!r) throw fail(404, 'سند تخلیه یافت نشد');
  if (r.status !== 'posted') throw fail(400, 'این سند قبلاً برگشت خورده است');
  stationScope(user, r.station_id);
  const dd = docDate(b.doc_date || today());

  return D.idempotent(b.idem_key, 'receipt_reverse', user, () => D.tx(() => {
    const book = D.tankBook(r.tank_id);
    if (N(r.vol_obs_l) > book)
      throw fail(400, 'برگشت ممکن نیست: موجودی فعلی تانک (' + R(book, 2)
        + ' لیتر) از مقدار این سند کمتر است. اول موجودی را کنترل کنید.');

    const rev = D.run(`INSERT INTO receipt
      (station_id,supplier_id,transporter_id,tank_id,product_id,doc_date,waybill_no,
       vol_obs_l,vol15_l,qty_mt,unit_cost,other_cost,total_cost,currency,fx_rate,
       density15,temp_c,vcf,payment_kind,status,reversal_of,reverse_reason,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'reversal',?,?,?,?,?)`,
      r.station_id, r.supplier_id, r.transporter_id, r.tank_id, r.product_id, dd,
      (r.waybill_no || '') + ' (برگشت)', -N(r.vol_obs_l), -N(r.vol15_l), -N(r.qty_mt),
      r.unit_cost, -N(r.other_cost), -N(r.total_cost), r.currency, r.fx_rate,
      r.density15, r.temp_c, r.vcf, r.payment_kind, params.id, reason,
      'برگشت سند تخلیه #' + params.id, user.id, D.now());
    const revId = Number(rev.lastInsertRowid);

    D.addStockMove({
      doc_date: dd, station_id: r.station_id, tank_id: r.tank_id, product_id: r.product_id,
      direction: 'out', qty_obs: N(r.vol_obs_l), unit_cost: D.tankWac(r.tank_id),
      source_type: 'receipt', source_id: revId, reversal_of: params.id,
      owner_party_id: r.owner_party_id || null,
      note: 'برگشت تخلیه #' + params.id + ' — ' + reason
    }, user);

    if (N(r.total_cost) > 0 && !r.owner_party_id) {
      const acct = r.payment_kind === 'credit' ? 'payable' : payAccount(r.payment_kind);
      D.addMoneyMove({
        doc_date: dd, station_id: r.station_id, account: acct, party_id: r.supplier_id,
        direction: acct === 'payable' ? 'in' : 'in', amount: N(r.total_cost),
        method: r.payment_kind, source_type: 'receipt', source_id: revId,
        reversal_of: params.id, note: 'برگشت خرید تیل #' + params.id
      }, user);
    }

    D.run(`UPDATE receipt SET status='reversed', reverse_reason=? WHERE id=?`, reason, params.id);
    D.audit(user, 'برگشت سند تخلیه', 'receipt', params.id, reason);
    D.raiseAlert(r.station_id, 'medium', 'DOC_REVERSED', 'سند تخلیه برگشت خورد',
      'بارنامه ' + (r.waybill_no || '#' + params.id) + ' — ' + N(r.vol_obs_l)
      + ' لیتر — کاربر ' + user.full_name + ' — دلیل: ' + reason, 'receipt', Number(params.id));
    return { id: revId, reversed: Number(params.id) };
  }));
});

/* ============================================================
   فروش عمده (تانکر خروجی)
   ============================================================ */
route('GET', '/bulk', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND b.station_id=?'; args.push(Number(st)); }
  if (q.from) { w += ' AND b.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND b.doc_date<=?'; args.push(q.to); }
  if (q.customer_id) { w += ' AND b.customer_id=?'; args.push(Number(q.customer_id)); }
  const lim = Math.min(Number(q.limit) || 100, 400);
  const off = Math.max(0, Number(q.offset) || 0);
  return D.all(`SELECT b.*, c.name customer_name, t.code tank_code, p.name product_name, p.color,
      st.name station_name
    FROM bulk_sale b LEFT JOIN party c ON c.id=b.customer_id
    JOIN tank t ON t.id=b.tank_id JOIN product p ON p.id=b.product_id
    JOIN station st ON st.id=b.station_id
    ${w} ORDER BY b.doc_date DESC, b.id DESC LIMIT ${lim} OFFSET ${off}`, ...args);
});

route('POST', '/bulk', 'ops', ({ user, b }) => {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const qty = numField(b, 'qty_obs', 'مقدار لیتر', { positive: true });
  const t = tankFull(tankId);
  stationScope(user, t.station_id);

  const dd = docDate(b.doc_date);
  const backdate = guardDate(user, t.station_id, dd, b, 'فروش عمده');

  /* فروش مستقیم (پا به پا): جنس خریداری‌شده مستقیم به مشتری می‌رود.
     موجودی تانک کنترل نمی‌شود چون همان لحظه وارد و خارج می‌گردد. */
  const saleKind = b.sale_kind === 'direct' ? 'direct' : 'stock';
  const book = D.tankBook(tankId);
  if (saleKind === 'stock' && qty > book)
    throw fail(400, 'موجودی تانک کافی نیست. موجودی دفتری: ' + R(book, 2) + ' لیتر');

  const d15 = densityField(b, 'density15', t.default_density);
  const temp = b.temp_c === '' || b.temp_c === undefined ? 15 : N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const qty15 = R(qty * vcf, 3);
  const mt = Petro.toMT(qty15, d15);

  const basis = b.price_basis || 'liter';
  const unitPrice = N(b.unit_price) || D.activePrice(t.product_id, t.station_id, dd);
  if (unitPrice <= 0) throw fail(400, 'نرخ فروش را وارد کنید یا در نرخ‌نامه ثبت کنید');
  const base = basis === 'mt' ? mt : (basis === 'liter15' ? qty15 : qty);

  const currency = String(b.currency || D.baseCurrency()).toUpperCase();
  let fx = 1;
  if (currency !== D.baseCurrency()) {
    fx = N(b.fx_rate) || D.fxRate(currency, dd);
    if (!fx) throw fail(400, 'نرخ ' + currency + ' ثبت نشده است. اول نرخ اسعار را وارد کنید.');
  }
  const amount = R(base * unitPrice, 2);          // ارز سند
  const amountBase = R(amount * fx, 2);           // ارز پایه

  /* بهای تمام‌شده: در فروش مستقیم، بهای خرید همان معامله؛ در غیر آن WAC تانک */
  const directCost = saleKind === 'direct'
    ? numField(b, 'direct_unit_cost', 'قیمت خرید هر لیتر', { positive: true }) : 0;
  const wac = saleKind === 'direct' ? directCost : D.tankWac(tankId);
  const costAmount = R(qty * wac, 2);

  const payKind = b.payment_kind || 'credit';
  const customerId = b.customer_id ? Number(b.customer_id) : null;
  if (payKind === 'credit' && !customerId)
    throw fail(400, 'برای فروش نسیه، مشتری را انتخاب کنید');

  return D.idempotent(b.idem_key, 'bulk', user, () => D.tx(() => {
    if (payKind === 'credit')
      creditGuard(user, b, t.station_id, customerId, amountBase, 'فروش عمده');

    const r = D.run(`INSERT INTO bulk_sale
      (station_id,customer_id,tank_id,product_id,doc_date,invoice_no,qty_obs,temp_c,density15,
       vcf,qty15,qty_mt,price_basis,unit_price,amount,amount_base,cost_amount,currency,fx_rate,
       truck_plate,seal_no,driver_name,payment_kind,sale_kind,owner_party_id,order_id,
       backdate_reason,status,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'posted',?,?,?)`,
      t.station_id, customerId, tankId, t.product_id, dd,
      b.invoice_no || null, qty, temp, d15, vcf, qty15, mt, basis, unitPrice, amount, amountBase,
      costAmount, currency, fx, b.truck_plate || null, b.seal_no || null, b.driver_name || null,
      payKind, saleKind,
      D.settingOn('consignment_on', false) && b.owner_party_id ? Number(b.owner_party_id) : null,
      b.order_id ? Number(b.order_id) : null, backdate,
      b.note || null, user.id, D.now());
    const id = Number(r.lastInsertRowid);

    /* فروش مستقیم: اول ورود (خرید)، بعد خروج (فروش) — موجودی آزاد نمی‌ماند */
    if (saleKind === 'direct') {
      D.addStockMove({
        doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
        direction: 'in', qty_obs: qty, temp_c: temp, density15: d15, vcf, qty15, qty_mt: mt,
        unit_cost: directCost, source_type: 'bulk_sale', source_id: id,
        note: 'خرید برای فروش مستقیم #' + id
      }, user);
      /* بدهی تهیه‌کننده */
      if (b.supplier_id)
        D.addMoneyMove({
          doc_date: dd, station_id: t.station_id, account: 'payable',
          party_id: Number(b.supplier_id), direction: 'out', amount: costAmount,
          method: 'credit', source_type: 'bulk_sale', source_id: id,
          note: 'خرید مستقیم برای فروش #' + id
        }, user);
    }

    D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
      direction: 'out', qty_obs: qty, temp_c: temp, density15: d15, vcf, qty15, qty_mt: mt,
      unit_cost: wac, source_type: 'bulk_sale', source_id: id,
      owner_party_id: b.owner_party_id ? Number(b.owner_party_id) : null,
      note: (saleKind === 'direct' ? 'فروش مستقیم ' : 'فروش عمده ') + (b.invoice_no || '#' + id)
    }, user);

    D.addMoneyMove({
      doc_date: dd, station_id: t.station_id, account: 'sales', direction: 'in',
      amount, currency, fx_rate: fx, method: payKind,
      source_type: 'bulk_sale', source_id: id, note: 'فروش عمده #' + id
    }, user);

    D.addMoneyMove({
      doc_date: dd, station_id: t.station_id,
      account: payKind === 'credit' ? 'receivable' : payAccount(payKind),
      party_id: customerId, direction: 'in',
      amount, currency, fx_rate: fx, method: payKind, ref_no: b.ref_no || null,
      source_type: 'bulk_sale', source_id: id,
      note: (payKind === 'credit' ? 'فروش عمده نسیه #' : 'دریافت فروش عمده #') + id
    }, user);

    if (b.order_id)
      D.run(`UPDATE fuel_order SET delivered_l = delivered_l + ?,
             status = CASE WHEN delivered_l + ? >= qty_l THEN 'delivered' ELSE status END
             WHERE id=?`, qty, qty, Number(b.order_id));

    D.audit(user, saleKind === 'direct' ? 'ثبت فروش مستقیم' : 'ثبت فروش عمده', 'bulk_sale', id,
      'تانک ' + t.code + ' — ' + qty + ' لیتر — ' + amount + ' ' + currency);
    return {
      id, qty15, qty_mt: mt, amount, amount_base: amountBase,
      cost_amount: costAmount, profit: R(amountBase - costAmount, 2)
    };
  }));
});

route('POST', '/bulk/:id/reverse', 'setup', ({ user, params, b }) => {
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) throw fail(400, 'دلیل برگشت سند را کامل بنویسید');
  const s = D.get(`SELECT * FROM bulk_sale WHERE id=?`, params.id);
  if (!s) throw fail(404, 'سند فروش یافت نشد');
  if (s.status !== 'posted') throw fail(400, 'این سند قبلاً برگشت خورده است');
  stationScope(user, s.station_id);
  const dd = docDate(b.doc_date || today());

  return D.idempotent(b.idem_key, 'bulk_reverse', user, () => D.tx(() => {
    const rev = D.run(`INSERT INTO bulk_sale
      (station_id,customer_id,tank_id,product_id,doc_date,invoice_no,qty_obs,temp_c,density15,
       vcf,qty15,qty_mt,price_basis,unit_price,amount,amount_base,cost_amount,currency,fx_rate,
       payment_kind,sale_kind,status,reversal_of,reverse_reason,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'reversal',?,?,?,?,?)`,
      s.station_id, s.customer_id, s.tank_id, s.product_id, dd,
      (s.invoice_no || '') + ' (برگشت)', -N(s.qty_obs), s.temp_c, s.density15, s.vcf,
      -N(s.qty15), -N(s.qty_mt), s.price_basis, s.unit_price, -N(s.amount),
      -N(s.amount_base), -N(s.cost_amount), s.currency, s.fx_rate, s.payment_kind,
      s.sale_kind, params.id, reason, 'برگشت فروش #' + params.id, user.id, D.now());
    const revId = Number(rev.lastInsertRowid);

    D.addStockMove({
      doc_date: dd, station_id: s.station_id, tank_id: s.tank_id, product_id: s.product_id,
      direction: 'in', qty_obs: N(s.qty_obs), unit_cost: N(s.cost_amount) / (N(s.qty_obs) || 1),
      source_type: 'bulk_sale', source_id: revId, reversal_of: params.id,
      owner_party_id: s.owner_party_id || null,
      note: 'برگشت فروش عمده #' + params.id + ' — ' + reason
    }, user);

    D.addMoneyMove({
      doc_date: dd, station_id: s.station_id, account: 'sales', direction: 'out',
      amount: N(s.amount), currency: s.currency, fx_rate: N(s.fx_rate, 1),
      method: s.payment_kind, source_type: 'bulk_sale', source_id: revId,
      reversal_of: params.id, note: 'برگشت فروش عمده #' + params.id
    }, user);
    D.addMoneyMove({
      doc_date: dd, station_id: s.station_id,
      account: s.payment_kind === 'credit' ? 'receivable' : payAccount(s.payment_kind),
      party_id: s.customer_id, direction: 'out', amount: N(s.amount),
      currency: s.currency, fx_rate: N(s.fx_rate, 1), method: s.payment_kind,
      source_type: 'bulk_sale', source_id: revId, reversal_of: params.id,
      note: 'برگشت طلب فروش عمده #' + params.id
    }, user);

    D.run(`UPDATE bulk_sale SET status='reversed', reverse_reason=? WHERE id=?`, reason, params.id);
    D.audit(user, 'برگشت فروش عمده', 'bulk_sale', params.id, reason);
    D.raiseAlert(s.station_id, 'medium', 'DOC_REVERSED', 'سند فروش عمده برگشت خورد',
      'فاکتور ' + (s.invoice_no || '#' + params.id) + ' — ' + N(s.qty_obs)
      + ' لیتر — کاربر ' + user.full_name + ' — دلیل: ' + reason, 'bulk_sale', Number(params.id));
    return { id: revId, reversed: Number(params.id) };
  }));
});

/* ============================================================
   پرداخت / دریافت پول
   ============================================================ */
route('POST', '/payments', 'finance', ({ user, b }) => {
  const partyId = Number(req(b, 'party_id', 'طرف حساب'));
  const p = D.get(`SELECT * FROM party WHERE id=?`, partyId);
  if (!p) throw fail(404, 'طرف حساب یافت نشد');
  const stationId = stationScope(user, req(b, 'station_id', 'استیشن'));
  const dd = docDate(b.doc_date);
  guardDate(user, stationId, dd, b, 'پرداخت/دریافت پول');

  const m = money(b, 'amount', 'مبلغ', dd);
  const method = b.method || 'cash';
  const isReceive = b.direction !== 'pay';   // پیش‌فرض: دریافت از مشتری

  return D.idempotent(b.idem_key, 'payment', user, () => D.tx(() => {
    D.addMoneyMove({
      doc_date: dd, station_id: stationId, account: payAccount(method),
      party_id: partyId, direction: isReceive ? 'in' : 'out',
      amount: m.amount, currency: m.currency, fx_rate: m.fx_rate,
      method, ref_no: b.ref_no || null, source_type: 'payment', source_id: null,
      note: (isReceive ? 'دریافت از ' : 'پرداخت به ') + p.name + (b.note ? ' — ' + b.note : '')
    }, user);

    D.addMoneyMove({
      doc_date: dd, station_id: stationId,
      account: isReceive ? 'receivable' : 'payable',
      party_id: partyId, direction: isReceive ? 'out' : 'in',
      amount: m.amount, currency: m.currency, fx_rate: m.fx_rate,
      method, ref_no: b.ref_no || null, source_type: 'payment', source_id: null,
      note: (isReceive ? 'تسویه طلب ' : 'تسویه قرض ') + p.name
    }, user);

    D.audit(user, isReceive ? 'دریافت پول' : 'پرداخت پول', 'party', partyId,
      p.name + ' — ' + m.amount + ' ' + m.currency
      + (m.currency !== D.baseCurrency() ? ' (نرخ ' + m.fx_rate + ' = ' + m.amount_base + ')' : '')
      + ' — ' + method + (b.ref_no ? ' — ' + b.ref_no : ''));
    return { balance: D.partyBalance(partyId), amount_base: m.amount_base };
  }));
});

/* ============================================================
   مصارف
   ============================================================ */
route('GET', '/expenses', 'read', ({ user, q }) => {
  const args = []; let w = "WHERE e.status='posted'";
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND e.station_id=?'; args.push(Number(st)); }
  if (q.from) { w += ' AND e.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND e.doc_date<=?'; args.push(q.to); }
  if (q.category) { w += ' AND e.category=?'; args.push(q.category); }
  const lim = Math.min(Number(q.limit) || 100, 400);
  const off = Math.max(0, Number(q.offset) || 0);
  return D.all(`SELECT e.*, p.name party_name, s.name station_name FROM expense e
    LEFT JOIN party p ON p.id=e.party_id JOIN station s ON s.id=e.station_id
    ${w} ORDER BY e.doc_date DESC, e.id DESC LIMIT ${lim} OFFSET ${off}`, ...args);
});

route('POST', '/expenses', 'finance', ({ user, b }) => {
  const stationId = stationScope(user, req(b, 'station_id', 'استیشن'));
  req(b, 'category', 'نوع مصرف');
  const dd = docDate(b.doc_date);
  const backdate = guardDate(user, stationId, dd, b, 'ثبت مصرف');
  const m = money(b, 'amount', 'مبلغ', dd);
  const method = b.method || 'cash';

  return D.idempotent(b.idem_key, 'expense', user, () => D.tx(() => {
    const r = D.run(`INSERT INTO expense
      (station_id,doc_date,category,party_id,amount,amount_base,currency,fx_rate,method,ref_no,
       note,backdate_reason,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'posted',?,?)`,
      stationId, dd, b.category, b.party_id ? Number(b.party_id) : null, m.amount,
      m.amount_base, m.currency, m.fx_rate, method, b.ref_no || null, b.note || null,
      backdate, user.id, D.now());
    const id = Number(r.lastInsertRowid);
    D.addMoneyMove({
      doc_date: dd, station_id: stationId, account: 'expense',
      party_id: b.party_id ? Number(b.party_id) : null,
      direction: 'out', amount: m.amount, currency: m.currency, fx_rate: m.fx_rate, method,
      source_type: 'expense', source_id: id, note: b.category + (b.note ? ' — ' + b.note : '')
    }, user);
    D.addMoneyMove({
      doc_date: dd, station_id: stationId, account: payAccount(method),
      direction: 'out', amount: m.amount, currency: m.currency, fx_rate: m.fx_rate, method,
      source_type: 'expense', source_id: id, note: 'پرداخت مصرف: ' + b.category
    }, user);
    D.audit(user, 'ثبت مصرف', 'expense', id, b.category + ' — ' + m.amount + ' ' + m.currency);
    return { id, amount_base: m.amount_base };
  }));
});

route('POST', '/expenses/:id/reverse', 'finance', ({ user, params, b }) => {
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) throw fail(400, 'دلیل برگشت مصرف را کامل بنویسید');
  const e = D.get(`SELECT * FROM expense WHERE id=?`, params.id);
  if (!e) throw fail(404, 'مصرف یافت نشد');
  if (e.status !== 'posted') throw fail(400, 'این مصرف قبلاً برگشت خورده است');
  stationScope(user, e.station_id);
  const dd = docDate(b.doc_date || today());
  return D.idempotent(b.idem_key, 'expense_reverse', user, () => D.tx(() => {
    const r = D.run(`INSERT INTO expense
      (station_id,doc_date,category,party_id,amount,amount_base,currency,fx_rate,method,
       note,status,reversal_of,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'reversal',?,?,?)`,
      e.station_id, dd, e.category, e.party_id, -N(e.amount), -N(e.amount_base),
      e.currency, e.fx_rate, e.method, 'برگشت مصرف #' + params.id + ' — ' + reason,
      params.id, user.id, D.now());
    const id = Number(r.lastInsertRowid);
    D.addMoneyMove({
      doc_date: dd, station_id: e.station_id, account: 'expense', party_id: e.party_id,
      direction: 'in', amount: N(e.amount), currency: e.currency, fx_rate: N(e.fx_rate, 1),
      method: e.method, source_type: 'expense', source_id: id, reversal_of: Number(params.id),
      note: 'برگشت مصرف #' + params.id
    }, user);
    D.addMoneyMove({
      doc_date: dd, station_id: e.station_id, account: payAccount(e.method),
      direction: 'in', amount: N(e.amount), currency: e.currency, fx_rate: N(e.fx_rate, 1),
      method: e.method, source_type: 'expense', source_id: id, reversal_of: Number(params.id),
      note: 'برگشت پرداخت مصرف #' + params.id
    }, user);
    D.run(`UPDATE expense SET status='reversed' WHERE id=?`, params.id);
    D.audit(user, 'برگشت مصرف', 'expense', params.id, reason);
    return { id };
  }));
});

/* ============================================================
   تعدیل موجودی / مصرف جنراتور — سند مستقل و قابل برگشت
   ============================================================ */
route('GET', '/stock/adjust', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND a.station_id=?'; args.push(Number(st)); }
  if (q.tank_id) { w += ' AND a.tank_id=?'; args.push(Number(q.tank_id)); }
  return D.all(`SELECT a.*, t.code tank_code, p.name product_name, u.full_name created_by_name
    FROM stock_adjust a JOIN tank t ON t.id=a.tank_id JOIN product p ON p.id=a.product_id
    LEFT JOIN app_user u ON u.id=a.created_by
    ${w} ORDER BY a.doc_date DESC, a.id DESC LIMIT 200`, ...args);
});

route('POST', '/stock/adjust', 'ops', ({ user, b }) => {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const qty = numField(b, 'qty', 'مقدار لیتر');
  const reason = String(req(b, 'reason', 'دلیل')).trim();
  if (reason.length < 3) throw fail(400, 'دلیل را کامل بنویسید');
  if (qty === 0) throw fail(400, 'مقدار نمی‌تواند صفر باشد');
  const t = tankFull(tankId);
  stationScope(user, t.station_id);
  const dd = docDate(b.doc_date);
  const backdate = guardDate(user, t.station_id, dd, b, 'تعدیل موجودی');
  const kind = b.kind === 'genset' ? 'genset' : 'adjust';

  if (qty < 0) {
    const book = D.tankBook(tankId);
    if (Math.abs(qty) > book)
      throw fail(400, 'موجودی تانک کافی نیست. موجودی دفتری: ' + R(book, 2) + ' لیتر');
  }

  return D.idempotent(b.idem_key, 'adjust', user, () => D.tx(() => {
    const wac = D.tankWac(tankId);
    const doc = D.run(`INSERT INTO stock_adjust
      (station_id,tank_id,product_id,doc_date,kind,qty_l,unit_cost,reason,backdate_reason,
       status,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'posted',?,?)`,
      t.station_id, tankId, t.product_id, dd, kind, qty, wac, reason, backdate,
      user.id, D.now());
    const docId = Number(doc.lastInsertRowid);

    const id = D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
      direction: qty > 0 ? 'in' : 'out', qty_obs: Math.abs(qty),
      unit_cost: wac, source_type: kind, source_id: docId, note: reason
    }, user);

    /* مصرف جنراتور یک مصرف واقعی است — به دفتر مصارف هم برود */
    if (kind === 'genset') {
      const cost = R(Math.abs(qty) * wac, 2);
      if (cost > 0) {
        const ex = D.run(`INSERT INTO expense
          (station_id,doc_date,category,amount,amount_base,currency,fx_rate,method,note,
           status,created_by,created_at)
          VALUES (?,?,?,?,?,?,1,'internal',?, 'posted',?,?)`,
          t.station_id, dd, 'تیل جنراتور', cost, cost, D.baseCurrency(),
          'مصرف ' + Math.abs(qty) + ' لیتر از تانک ' + t.code, user.id, D.now());
        D.addMoneyMove({
          doc_date: dd, station_id: t.station_id, account: 'expense', direction: 'out',
          amount: cost, method: 'internal', source_type: 'expense',
          source_id: Number(ex.lastInsertRowid), note: 'تیل جنراتور — تانک ' + t.code
        }, user);
      }
    }

    const cnt = D.get(`SELECT COUNT(*) c FROM stock_adjust
       WHERE kind='adjust' AND created_by=? AND doc_date>=date(?, '-30 day')`, user.id, dd).c;
    if (kind === 'adjust' && cnt >= 3)
      D.raiseAlert(t.station_id, 'high', 'ADJUST_FREQUENT',
        'تعدیل مکرر موجودی توسط یک کاربر',
        user.full_name + ' در ۳۰ روز گذشته ' + cnt + ' بار موجودی را تعدیل کرده است.',
        'app_user', user.id);

    D.audit(user, kind === 'genset' ? 'ثبت مصرف جنراتور' : 'تعدیل موجودی', 'tank', tankId,
      qty + ' لیتر — ' + reason);
    return { id: docId, move_id: id, book_l: D.tankBook(tankId) };
  }));
});
