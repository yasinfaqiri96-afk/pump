'use strict';
const D = require('./db');
const A = require('./api');
const Petro = require('../public/js/shared/petroleum.js');
const { route, fail, dipVolumes, productOf, docDate, today, req } = A;
const N = D.num, R = D.round;

/* ============================================================
   دیپ
   ============================================================ */

/* پیش‌نمایش: قبل از ثبت، عدد را نشان بده */
route('GET', '/dips/preview', 'read', ({ q }) => {
  const tankId = Number(q.tank_id);
  const t = D.get(`SELECT t.*, p.density_group, p.default_density, p.tolerance_pct, p.uom
                   FROM tank t JOIN product p ON p.id=t.product_id WHERE t.id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');
  const v = dipVolumes(tankId, q.dip_mm, q.water_mm);
  const book = D.tankBook(tankId);
  const d15 = N(q.density15, N(t.default_density));
  const temp = N(q.temp_c, 15);
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

route('GET', '/dips', 'read', ({ q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.station_id) { w += ' AND d.station_id=?'; args.push(Number(q.station_id)); }
  if (q.tank_id) { w += ' AND d.tank_id=?'; args.push(Number(q.tank_id)); }
  if (q.from) { w += ' AND d.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND d.doc_date<=?'; args.push(q.to); }
  const lim = Math.min(Number(q.limit) || 100, 500);
  return D.all(`SELECT d.*, t.code tank_code, t.name tank_name, p.name product_name, p.color,
      u.full_name read_by_name
    FROM dip d JOIN tank t ON t.id=d.tank_id JOIN product p ON p.id=t.product_id
    LEFT JOIN app_user u ON u.id=d.read_by
    ${w} ORDER BY d.read_at DESC LIMIT ${lim}`, ...args);
});

function insertDip(user, b, shiftId) {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const t = D.get(`SELECT t.*, p.density_group, p.default_density, p.tolerance_pct
                   FROM tank t JOIN product p ON p.id=t.product_id WHERE t.id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');
  if (b.dip_mm === undefined || b.dip_mm === null || b.dip_mm === '')
    throw fail(400, 'عدد دیپ الزامی است');

  const v = dipVolumes(tankId, b.dip_mm, b.water_mm);
  const d15 = N(b.density15, N(t.default_density));
  const temp = N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const dd = docDate(b.doc_date);
  const book = D.tankBook(tankId, dd);
  const varr = Petro.variance(v.net, book, 0);

  const r = D.run(`INSERT INTO dip
    (station_id,tank_id,read_at,doc_date,kind,dip_mm,water_mm,temp_c,density15,
     vol_gross_l,vol_water_l,vol_net_l,vol15_l,book_l,variance_l,variance_pct,
     shift_id,read_by,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    t.station_id, tankId, b.read_at || D.now(), dd, b.kind || 'spot',
    N(b.dip_mm), N(b.water_mm), temp, d15,
    v.gross, v.water, v.net, R(v.net * vcf, 3), book, varr.qty, varr.pct,
    shiftId || null, user.id, b.note || null, D.now());
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
    if (N(prev.dip_mm) === N(b.dip_mm))
      D.raiseAlert(t.station_id, 'medium', 'DIP_REPEATED',
        'دیپ تکراری در تانک ' + t.code,
        'عدد دیپ عیناً برابر دیپ قبلی است (' + N(b.dip_mm) + ' mm). احتمال کاپی کردن بدون اندازه‌گیری.',
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
    'تانک ' + t.code + ' — ' + N(b.dip_mm) + 'mm — خالص ' + v.net + ' لیتر — کسری ' + varr.qty);
  return { id, gross: v.gross, water: v.water, net: v.net, book_l: book, variance_l: varr.qty, variance_pct: varr.pct };
}

route('POST', '/dips', 'dip', ({ user, b }) => insertDip(user, b, b.shift_id));

/* ============================================================
   شفت
   ============================================================ */
route('GET', '/shifts', 'read', ({ q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.station_id) { w += ' AND s.station_id=?'; args.push(Number(q.station_id)); }
  if (q.status) { w += ' AND s.status=?'; args.push(q.status); }
  if (q.from) { w += ' AND s.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND s.doc_date<=?'; args.push(q.to); }
  const lim = Math.min(Number(q.limit) || 60, 300);
  return D.all(`SELECT s.*, p.name operator_name, st.name station_name
    FROM shift s JOIN party p ON p.id=s.operator_id JOIN station st ON st.id=s.station_id
    ${w} ORDER BY s.opened_at DESC LIMIT ${lim}`, ...args);
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
  return s;
});

/* باز کردن شفت */
route('POST', '/shifts/open', 'shift', ({ user, b }) => {
  const stationId = Number(req(b, 'station_id', 'استیشن'));
  const operatorId = Number(req(b, 'operator_id', 'اپراتور'));
  const open = D.get(`SELECT id FROM shift WHERE station_id=? AND status='open'`, stationId);
  if (open) throw fail(400, 'یک شفت باز در این استیشن وجود دارد. اول آن را ببندید.');

  const dd = docDate(b.doc_date);
  return D.tx(() => {
    const r = D.run(`INSERT INTO shift
      (station_id,operator_id,code,doc_date,opened_at,float_amount,status,opened_by,note)
      VALUES (?,?,?,?,?,?, 'open', ?,?)`,
      stationId, operatorId, b.code || null, dd, b.opened_at || D.now(),
      N(b.float_amount), user.id, b.note || null);
    const shiftId = Number(r.lastInsertRowid);

    const nozzles = D.all(`SELECT n.*, t.product_id FROM nozzle n
      JOIN dispenser d ON d.id=n.dispenser_id JOIN tank t ON t.id=n.tank_id
      WHERE d.station_id=? AND n.active=1`, stationId);
    const given = {};
    (b.nozzles || []).forEach(x => given[Number(x.nozzle_id)] = N(x.opening));

    const noPrice = [];
    for (const n of nozzles) {
      const opening = given[n.id] !== undefined ? given[n.id] : N(n.last_reading);
      const price = D.activePrice(n.product_id, stationId, dd);
      if (price <= 0) {
        const pn = D.get(`SELECT name FROM product WHERE id=?`, n.product_id);
        if (noPrice.indexOf(pn.name) < 0) noPrice.push(pn.name);
      }
      D.run(`INSERT INTO nozzle_reading (shift_id,nozzle_id,tank_id,product_id,opening,price)
             VALUES (?,?,?,?,?,?)`, shiftId, n.id, n.tank_id, n.product_id, opening, price);
    }
    if (noPrice.length)
      throw fail(400, 'برای این محصولات نرخ ثبت نشده است: ' + noPrice.join('، ')
        + '. اول در بخش نرخ‌نامه نرخ را ثبت کنید.');

    (b.dips || []).forEach(dp => insertDip(user, Object.assign({}, dp, { kind: 'open', doc_date: dd }), shiftId));

    D.audit(user, 'باز کردن شفت', 'shift', shiftId,
      'استیشن ' + stationId + ' — ' + nozzles.length + ' نازل — صندوق افتتاحیه ' + N(b.float_amount));
    return { id: shiftId };
  });
});

/* بستن شفت */
route('POST', '/shifts/:id/close', 'shift', ({ user, params, b }) => {
  const s = D.get(`SELECT * FROM shift WHERE id=?`, params.id);
  if (!s) throw fail(404, 'شفت یافت نشد');
  if (s.status === 'closed') throw fail(400, 'این شفت قبلاً بسته شده است');

  const readings = D.all(`SELECT r.*, n.meter_digits, n.meter_factor, n.code nozzle_code
    FROM nozzle_reading r JOIN nozzle n ON n.id=r.nozzle_id WHERE r.shift_id=?`, params.id);
  const given = {};
  (b.readings || []).forEach(x => given[Number(x.nozzle_id)] = x);

  return D.tx(() => {
    let totalL = 0, totalAmount = 0;
    const perTank = {};

    for (const r of readings) {
      const g = given[r.nozzle_id] || {};
      if (g.closing === undefined || g.closing === null || g.closing === '')
        throw fail(400, 'قرائت اخیر نازل ' + r.nozzle_code + ' وارد نشده است');
      const closing = N(g.closing);
      const rollovers = Number(g.rollovers) || 0;
      const testReturn = N(g.test_return_l);
      const sold = Petro.nozzleSold(N(r.opening), closing, r.meter_digits, rollovers, testReturn, r.meter_factor);
      if (sold < 0) throw fail(400, 'فروش منفی در نازل ' + r.nozzle_code + '. قرائت را کنترل کنید.');
      const price = N(r.price) || D.activePrice(r.product_id, s.station_id, s.doc_date);
      if (sold > 0 && price <= 0)
        throw fail(400, 'نرخ نازل ' + r.nozzle_code + ' صفر است. اول نرخ محصول را در نرخ‌نامه ثبت کنید.');
      const amount = R(sold * price, 2);

      D.run(`UPDATE nozzle_reading SET closing=?,rollovers=?,test_return_l=?,sold_l=?,price=?,amount=?
             WHERE id=?`, closing, rollovers, testReturn, sold, price, amount, r.id);
      D.run(`UPDATE nozzle SET last_reading=? WHERE id=?`, closing, r.nozzle_id);

      totalL = R(totalL + sold, 3);
      totalAmount = R(totalAmount + amount, 2);
      perTank[r.tank_id] = R(N(perTank[r.tank_id]) + sold, 3);

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
          'فروش شفت ' + D.round(qty, 2) + ' لیتر در برابر موجودی دفتری ' + D.round(bookBefore, 2)
          + ' لیتر. یا دیپ افتتاحیه غلط است، یا ورود تیل ثبت نشده، یا فروش خارج سیستم انجام شده.',
          'shift', s.id);
      D.addStockMove({
        doc_date: s.doc_date, station_id: s.station_id, tank_id: Number(tankId),
        product_id: t.product_id, direction: 'out', qty_obs: qty,
        unit_cost: D.tankWac(Number(tankId)),
        source_type: 'shift', source_id: s.id, note: 'فروش شفت #' + s.id
      }, user);
    }

    /* قبض‌ها: نسیه، کوپن، بانک، حواله */
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
        const p = D.get(`SELECT * FROM party WHERE id=?`, Number(t.party_id));
        const bal = D.partyBalance(p.id);
        if (N(p.credit_limit) > 0 && bal + amt > N(p.credit_limit)) {
          if (!b.override_credit) throw fail(400,
            'مشتری ' + p.name + ' از سقف اعتبار می‌گذرد (بیلانس ' + bal + ' + ' + amt + ' > ' + p.credit_limit + ')');
          D.raiseAlert(s.station_id, 'high', 'CREDIT_OVERRIDE',
            'عبور از سقف اعتبار با اجازه مدیر',
            'مشتری ' + p.name + ' — بیلانس ' + bal + ' — فروش نسیه ' + amt + ' — سقف ' + p.credit_limit,
            'shift', s.id);
        }
        D.addMoneyMove({
          doc_date: s.doc_date, station_id: s.station_id, account: 'receivable',
          party_id: p.id, direction: 'in', amount: amt, method: 'credit',
          source_type: 'shift', source_id: s.id, note: 'فروش نسیه شفت #' + s.id
        }, user);
      } else {
        D.addMoneyMove({
          doc_date: s.doc_date, station_id: s.station_id,
          account: t.kind === 'bank' ? 'bank' : (t.kind === 'hawala' ? 'hawala' : 'cash'),
          party_id: t.party_id ? Number(t.party_id) : null, direction: 'in', amount: amt,
          method: t.kind, ref_no: t.ref_no || null,
          source_type: 'shift', source_id: s.id, note: 'قبض ' + t.kind + ' شفت #' + s.id
        }, user);
      }
    }

    const cashExpected = R(totalAmount - nonCash, 2);
    const cashCounted = N(b.cash_counted);
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
        + ' یا قرائت نازل کمتر از واقع ثبت شده.', 'shift', s.id);
    }

    D.audit(user, 'بستن شفت', 'shift', s.id,
      'فروش ' + totalL + ' لیتر — ' + totalAmount + ' — کسری صندوق ' + cashVar);

    return {
      id: s.id, total_liters: totalL, total_amount: totalAmount,
      cash_expected: cashExpected, cash_counted: cashCounted, cash_variance: cashVar
    };
  });
});

/* ============================================================
   ورود تیل (تخلیه)
   ============================================================ */
route('GET', '/receipts', 'read', ({ q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.station_id) { w += ' AND r.station_id=?'; args.push(Number(q.station_id)); }
  if (q.from) { w += ' AND r.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND r.doc_date<=?'; args.push(q.to); }
  const lim = Math.min(Number(q.limit) || 80, 400);
  return D.all(`SELECT r.*, s.name supplier_name, tr.name transporter_name,
      t.code tank_code, p.name product_name, p.color, st.name station_name
    FROM receipt r LEFT JOIN party s ON s.id=r.supplier_id
    LEFT JOIN party tr ON tr.id=r.transporter_id
    JOIN tank t ON t.id=r.tank_id JOIN product p ON p.id=r.product_id
    JOIN station st ON st.id=r.station_id
    ${w} ORDER BY r.doc_date DESC, r.id DESC LIMIT ${lim}`, ...args);
});

/* محاسبه بدون ثبت */
route('POST', '/receipts/calc', 'read', ({ b }) => {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const t = D.get(`SELECT t.*, p.density_group, p.default_density, p.tolerance_pct
                   FROM tank t JOIN product p ON p.id=t.product_id WHERE t.id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');
  const before = dipVolumes(tankId, b.dip_before_mm, b.water_before_mm);
  const after = dipVolumes(tankId, b.dip_after_mm, b.water_after_mm);
  const volObs = R(after.net - before.net, 3);
  const d15 = N(b.density15, N(t.default_density));
  const temp = N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const vol15 = R(volObs * vcf, 3);
  const mt = Petro.toMT(vol15, d15);
  const srcMt = N(b.src_qty_mt);
  const varMt = R(mt - srcMt, 6);
  const varPct = srcMt > 0 ? R(varMt / srcMt * 100, 3) : 0;
  return {
    vol_before_l: before.net, vol_after_l: after.net, vol_obs_l: volObs,
    vcf, vol15_l: vol15, qty_mt: mt,
    src_qty15: N(b.src_density15) ? Petro.mtToV15(srcMt, N(b.src_density15)) : 0,
    variance_mt: varMt, variance_pct: varPct,
    tolerance_pct: N(t.tolerance_pct, 0.5),
    over_tolerance: srcMt > 0 && Math.abs(varPct) > N(t.tolerance_pct, 0.5),
    capacity_free: R(N(t.capacity_l) - after.net, 3),
    overflow: N(t.capacity_l) > 0 && after.net > N(t.capacity_l)
  };
});

route('POST', '/receipts', 'ops', ({ user, b }) => {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const t = D.get(`SELECT t.*, p.density_group, p.default_density, p.tolerance_pct
                   FROM tank t JOIN product p ON p.id=t.product_id WHERE t.id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');

  const dd = docDate(b.doc_date);
  const before = dipVolumes(tankId, b.dip_before_mm, b.water_before_mm);
  const after = dipVolumes(tankId, b.dip_after_mm, b.water_after_mm);
  const volObs = R(after.net - before.net, 3);
  if (volObs <= 0) throw fail(400, 'دیپ بعد از تخلیه باید بزرگتر از دیپ قبل باشد');

  const d15 = N(b.density15, N(t.default_density));
  const temp = N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const vol15 = R(volObs * vcf, 3);
  const mt = Petro.toMT(vol15, d15);
  const srcMt = N(b.src_qty_mt);
  const varMt = R(mt - srcMt, 6);
  const varPct = srcMt > 0 ? R(varMt / srcMt * 100, 3) : 0;

  const currency = b.currency || D.baseCurrency();
  const fx = N(b.fx_rate, 1) || 1;
  const unitCost = N(b.unit_cost);                 // به ارز سند، هر لیتر مشاهده‌ای
  const otherCost = N(b.other_cost);               // ارز پایه
  const goodsBase = R(unitCost * volObs * fx, 2);
  const totalCost = R(goodsBase + otherCost, 2);
  const landedUnit = volObs > 0 ? R(totalCost / volObs, 6) : 0;

  return D.tx(() => {
    const r = D.run(`INSERT INTO receipt
      (station_id,supplier_id,transporter_id,tank_id,product_id,doc_date,waybill_no,truck_plate,
       driver_name,driver_phone,entry_port,seal_out,seal_in,src_qty_mt,src_density15,src_temp,src_qty15,
       dip_before_mm,water_before_mm,dip_after_mm,water_after_mm,vol_before_l,vol_after_l,
       temp_c,density15,vol_obs_l,vcf,vol15_l,qty_mt,variance_mt,variance_pct,
       unit_cost,other_cost,total_cost,currency,fx_rate,quality_ok,quality_note,payment_kind,
       status,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,?)`,
      t.station_id, b.supplier_id ? Number(b.supplier_id) : null,
      b.transporter_id ? Number(b.transporter_id) : null, tankId, t.product_id, dd,
      b.waybill_no || null, b.truck_plate || null, b.driver_name || null, b.driver_phone || null,
      b.entry_port || null, b.seal_out || null, b.seal_in || null,
      srcMt, N(b.src_density15) || null, N(b.src_temp) || null,
      N(b.src_density15) ? Petro.mtToV15(srcMt, N(b.src_density15)) : 0,
      N(b.dip_before_mm), N(b.water_before_mm), N(b.dip_after_mm), N(b.water_after_mm),
      before.net, after.net, temp, d15, volObs, vcf, vol15, mt, varMt, varPct,
      unitCost, otherCost, totalCost, currency, fx,
      b.quality_ok === false ? 0 : 1, b.quality_note || null, b.payment_kind || 'credit',
      b.note || null, user.id, D.now());
    const id = Number(r.lastInsertRowid);

    D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
      direction: 'in', qty_obs: volObs, temp_c: temp, density15: d15, vcf, qty15: vol15,
      qty_mt: mt, unit_cost: landedUnit, source_type: 'receipt', source_id: id,
      note: 'تخلیه بارنامه ' + (b.waybill_no || '—')
    }, user);

    if (totalCost > 0) {
      if ((b.payment_kind || 'credit') === 'credit') {
        D.addMoneyMove({
          doc_date: dd, station_id: t.station_id, account: 'payable',
          party_id: b.supplier_id ? Number(b.supplier_id) : null, direction: 'out',
          amount: totalCost, source_type: 'receipt', source_id: id, method: 'credit',
          note: 'خرید تیل — بارنامه ' + (b.waybill_no || '—')
        }, user);
      } else {
        D.addMoneyMove({
          doc_date: dd, station_id: t.station_id,
          account: b.payment_kind === 'bank' ? 'bank' : (b.payment_kind === 'hawala' ? 'hawala' : 'cash'),
          party_id: b.supplier_id ? Number(b.supplier_id) : null, direction: 'out',
          amount: totalCost, method: b.payment_kind, ref_no: b.ref_no || null,
          source_type: 'receipt', source_id: id, note: 'پرداخت خرید تیل'
        }, user);
      }
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

    if (N(b.src_density15) && d15) {
      const dDiff = Math.abs(d15 - N(b.src_density15));
      if (dDiff > 0.008)
        D.raiseAlert(t.station_id, 'high', 'DENSITY_MISMATCH',
          'اختلاف دانسیته مبدا و مقصد — بارنامه ' + (b.waybill_no || '—'),
          'مبدا ' + N(b.src_density15) + ' — مقصد ' + d15 + ' (اختلاف ' + R(dDiff, 5) + '). احتمال تعویض محموله.',
          'receipt', id);
    }

    if (b.quality_ok === false)
      D.raiseAlert(t.station_id, 'high', 'QUALITY_FAIL',
        'محموله با کیفیت نامناسب ثبت شد — بارنامه ' + (b.waybill_no || '—'),
        b.quality_note || 'بدون توضیح', 'receipt', id);

    if (N(t.capacity_l) > 0 && after.net > N(t.capacity_l))
      D.raiseAlert(t.station_id, 'high', 'TANK_OVERFLOW',
        'سطح تانک ' + t.code + ' از ظرفیت گذشت',
        'بعد تخلیه ' + after.net + ' لیتر در برابر ظرفیت ' + t.capacity_l, 'receipt', id);

    D.audit(user, 'ثبت تخلیه', 'receipt', id,
      'تانک ' + t.code + ' — ' + volObs + ' لیتر — ' + mt + ' MT — کسری ' + varMt + ' MT');

    return { id, vol_obs_l: volObs, vol15_l: vol15, qty_mt: mt, variance_mt: varMt, variance_pct: varPct, total_cost: totalCost };
  });
});

/* ============================================================
   فروش عمده (تانکر خروجی)
   ============================================================ */
route('GET', '/bulk', 'read', ({ q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.station_id) { w += ' AND b.station_id=?'; args.push(Number(q.station_id)); }
  if (q.from) { w += ' AND b.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND b.doc_date<=?'; args.push(q.to); }
  return D.all(`SELECT b.*, c.name customer_name, t.code tank_code, p.name product_name, p.color,
      st.name station_name
    FROM bulk_sale b LEFT JOIN party c ON c.id=b.customer_id
    JOIN tank t ON t.id=b.tank_id JOIN product p ON p.id=b.product_id
    JOIN station st ON st.id=b.station_id
    ${w} ORDER BY b.doc_date DESC, b.id DESC LIMIT 200`, ...args);
});

route('POST', '/bulk', 'ops', ({ user, b }) => {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const qty = N(req(b, 'qty_obs', 'مقدار'));
  if (qty <= 0) throw fail(400, 'مقدار باید بزرگتر از صفر باشد');
  const t = D.get(`SELECT t.*, p.density_group, p.default_density FROM tank t
                   JOIN product p ON p.id=t.product_id WHERE t.id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');

  const dd = docDate(b.doc_date);
  const book = D.tankBook(tankId);
  if (qty > book) throw fail(400,
    'موجودی تانک کافی نیست. موجودی دفتری: ' + book + ' لیتر');

  const d15 = N(b.density15, N(t.default_density));
  const temp = N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, t.density_group);
  const qty15 = R(qty * vcf, 3);
  const mt = Petro.toMT(qty15, d15);

  const basis = b.price_basis || 'liter';
  const unitPrice = N(b.unit_price) || D.activePrice(t.product_id, t.station_id, dd);
  const base = basis === 'mt' ? mt : (basis === 'liter15' ? qty15 : qty);
  const amount = R(base * unitPrice, 2);
  const wac = D.tankWac(tankId);
  const costAmount = R(qty * wac, 2);
  const currency = b.currency || D.baseCurrency();
  const fx = N(b.fx_rate, 1) || 1;

  return D.tx(() => {
    if ((b.payment_kind || 'credit') === 'credit' && b.customer_id) {
      const p = D.get(`SELECT * FROM party WHERE id=?`, Number(b.customer_id));
      const bal = D.partyBalance(p.id);
      if (N(p.credit_limit) > 0 && bal + amount * fx > N(p.credit_limit)) {
        if (!b.override_credit) throw fail(400,
          'مشتری ' + p.name + ' از سقف اعتبار می‌گذرد (بیلانس ' + bal + ' — سقف ' + p.credit_limit + ')');
        D.raiseAlert(t.station_id, 'high', 'CREDIT_OVERRIDE',
          'عبور از سقف اعتبار در فروش عمده',
          'مشتری ' + p.name + ' — مبلغ ' + amount, 'bulk_sale', null);
      }
    }

    const r = D.run(`INSERT INTO bulk_sale
      (station_id,customer_id,tank_id,product_id,doc_date,invoice_no,qty_obs,temp_c,density15,
       vcf,qty15,qty_mt,price_basis,unit_price,amount,cost_amount,currency,fx_rate,
       truck_plate,seal_no,driver_name,payment_kind,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      t.station_id, b.customer_id ? Number(b.customer_id) : null, tankId, t.product_id, dd,
      b.invoice_no || null, qty, temp, d15, vcf, qty15, mt, basis, unitPrice, amount, costAmount,
      currency, fx, b.truck_plate || null, b.seal_no || null, b.driver_name || null,
      b.payment_kind || 'credit', b.note || null, user.id, D.now());
    const id = Number(r.lastInsertRowid);

    D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
      direction: 'out', qty_obs: qty, temp_c: temp, density15: d15, vcf, qty15, qty_mt: mt,
      unit_cost: wac, source_type: 'bulk_sale', source_id: id,
      note: 'فروش عمده ' + (b.invoice_no || '#' + id)
    }, user);

    D.addMoneyMove({
      doc_date: dd, station_id: t.station_id, account: 'sales', direction: 'in',
      amount, currency, fx_rate: fx, method: b.payment_kind || 'credit',
      source_type: 'bulk_sale', source_id: id, note: 'فروش عمده #' + id
    }, user);

    if ((b.payment_kind || 'credit') === 'credit') {
      D.addMoneyMove({
        doc_date: dd, station_id: t.station_id, account: 'receivable',
        party_id: b.customer_id ? Number(b.customer_id) : null, direction: 'in',
        amount, currency, fx_rate: fx, method: 'credit',
        source_type: 'bulk_sale', source_id: id, note: 'فروش عمده نسیه #' + id
      }, user);
    } else {
      D.addMoneyMove({
        doc_date: dd, station_id: t.station_id,
        account: b.payment_kind === 'bank' ? 'bank' : (b.payment_kind === 'hawala' ? 'hawala' : 'cash'),
        party_id: b.customer_id ? Number(b.customer_id) : null, direction: 'in',
        amount, currency, fx_rate: fx, method: b.payment_kind, ref_no: b.ref_no || null,
        source_type: 'bulk_sale', source_id: id, note: 'دریافت فروش عمده #' + id
      }, user);
    }

    D.audit(user, 'ثبت فروش عمده', 'bulk_sale', id,
      'تانک ' + t.code + ' — ' + qty + ' لیتر — ' + amount + ' ' + currency);
    return { id, qty15, qty_mt: mt, amount, cost_amount: costAmount, profit: R(amount * fx - costAmount, 2) };
  });
});

/* ============================================================
   پرداخت / دریافت
   ============================================================ */
route('POST', '/payments', 'finance', ({ user, b }) => {
  const partyId = Number(req(b, 'party_id', 'طرف حساب'));
  const amount = N(req(b, 'amount', 'مبلغ'));
  if (amount <= 0) throw fail(400, 'مبلغ باید بزرگتر از صفر باشد');
  const p = D.get(`SELECT * FROM party WHERE id=?`, partyId);
  if (!p) throw fail(404, 'طرف حساب یافت نشد');
  const stationId = Number(req(b, 'station_id', 'استیشن'));
  const dd = docDate(b.doc_date);
  const method = b.method || 'cash';
  const currency = b.currency || D.baseCurrency();
  const fx = N(b.fx_rate, 1) || 1;
  const isReceive = b.direction !== 'pay';   // پیش‌فرض: دریافت از مشتری

  return D.tx(() => {
    D.addMoneyMove({
      doc_date: dd, station_id: stationId,
      account: method === 'bank' ? 'bank' : (method === 'hawala' ? 'hawala' : 'cash'),
      party_id: partyId, direction: isReceive ? 'in' : 'out', amount, currency, fx_rate: fx,
      method, ref_no: b.ref_no || null, source_type: 'payment', source_id: null,
      note: (isReceive ? 'دریافت از ' : 'پرداخت به ') + p.name + (b.note ? ' — ' + b.note : '')
    }, user);

    D.addMoneyMove({
      doc_date: dd, station_id: stationId,
      account: isReceive ? 'receivable' : 'payable',
      party_id: partyId, direction: isReceive ? 'out' : 'in', amount, currency, fx_rate: fx,
      method, ref_no: b.ref_no || null, source_type: 'payment', source_id: null,
      note: (isReceive ? 'تسویه طلب ' : 'تسویه قرض ') + p.name
    }, user);

    D.audit(user, isReceive ? 'دریافت پول' : 'پرداخت پول', 'party', partyId,
      p.name + ' — ' + amount + ' ' + currency + ' — ' + method + (b.ref_no ? ' — ' + b.ref_no : ''));
    return { balance: D.partyBalance(partyId) };
  });
});

/* ============================================================
   مصارف
   ============================================================ */
route('GET', '/expenses', 'read', ({ q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.station_id) { w += ' AND e.station_id=?'; args.push(Number(q.station_id)); }
  if (q.from) { w += ' AND e.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND e.doc_date<=?'; args.push(q.to); }
  return D.all(`SELECT e.*, p.name party_name, s.name station_name FROM expense e
    LEFT JOIN party p ON p.id=e.party_id JOIN station s ON s.id=e.station_id
    ${w} ORDER BY e.doc_date DESC, e.id DESC LIMIT 200`, ...args);
});

route('POST', '/expenses', 'finance', ({ user, b }) => {
  const stationId = Number(req(b, 'station_id', 'استیشن'));
  const amount = N(req(b, 'amount', 'مبلغ'));
  req(b, 'category', 'نوع مصرف');
  const dd = docDate(b.doc_date);
  const currency = b.currency || D.baseCurrency();
  const fx = N(b.fx_rate, 1) || 1;
  return D.tx(() => {
    const r = D.run(`INSERT INTO expense
      (station_id,doc_date,category,party_id,amount,currency,fx_rate,method,ref_no,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      stationId, dd, b.category, b.party_id ? Number(b.party_id) : null, amount,
      currency, fx, b.method || 'cash', b.ref_no || null, b.note || null, user.id, D.now());
    const id = Number(r.lastInsertRowid);
    D.addMoneyMove({
      doc_date: dd, station_id: stationId, account: 'expense', party_id: b.party_id ? Number(b.party_id) : null,
      direction: 'out', amount, currency, fx_rate: fx, method: b.method || 'cash',
      source_type: 'expense', source_id: id, note: b.category + (b.note ? ' — ' + b.note : '')
    }, user);
    D.addMoneyMove({
      doc_date: dd, station_id: stationId,
      account: (b.method === 'bank') ? 'bank' : (b.method === 'hawala' ? 'hawala' : 'cash'),
      direction: 'out', amount, currency, fx_rate: fx, method: b.method || 'cash',
      source_type: 'expense', source_id: id, note: 'پرداخت مصرف: ' + b.category
    }, user);
    D.audit(user, 'ثبت مصرف', 'expense', id, b.category + ' — ' + amount);
    return { id };
  });
});

/* ============================================================
   مصرف تیل جنراتور / تعدیل موجودی
   ============================================================ */
route('POST', '/stock/adjust', 'ops', ({ user, b }) => {
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const qty = N(req(b, 'qty', 'مقدار'));
  const reason = String(req(b, 'reason', 'دلیل')).trim();
  if (reason.length < 3) throw fail(400, 'دلیل را کامل بنویسید');
  if (qty === 0) throw fail(400, 'مقدار نمی‌تواند صفر باشد');
  const t = D.get(`SELECT * FROM tank WHERE id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');
  const dd = docDate(b.doc_date);
  const kind = b.kind === 'genset' ? 'genset' : 'adjust';

  const id = D.addStockMove({
    doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
    direction: qty > 0 ? 'in' : 'out', qty_obs: Math.abs(qty),
    unit_cost: D.tankWac(tankId), source_type: kind, source_id: null, note: reason
  }, user);

  const cnt = D.get(`SELECT COUNT(*) c FROM stock_move
     WHERE source_type='adjust' AND created_by=? AND doc_date>=date(?, '-30 day')`, user.id, dd).c;
  if (kind === 'adjust' && cnt >= 3)
    D.raiseAlert(t.station_id, 'high', 'ADJUST_FREQUENT',
      'تعدیل مکرر موجودی توسط یک کاربر',
      user.full_name + ' در ۳۰ روز گذشته ' + cnt + ' بار موجودی را تعدیل کرده است.',
      'stock_move', id);

  D.audit(user, kind === 'genset' ? 'ثبت مصرف جنراتور' : 'تعدیل موجودی', 'tank', tankId,
    qty + ' لیتر — ' + reason);
  return { id, book_l: D.tankBook(tankId) };
});

/* انتقال بین تانک */
route('POST', '/stock/transfer', 'ops', ({ user, b }) => {
  const from = Number(req(b, 'from_tank_id', 'تانک مبدا'));
  const to = Number(req(b, 'to_tank_id', 'تانک مقصد'));
  const qty = N(req(b, 'qty', 'مقدار'));
  if (from === to) throw fail(400, 'تانک مبدا و مقصد یکی است');
  if (qty <= 0) throw fail(400, 'مقدار باید بزرگتر از صفر باشد');
  const tf = D.get(`SELECT * FROM tank WHERE id=?`, from);
  const tt = D.get(`SELECT * FROM tank WHERE id=?`, to);
  if (!tf || !tt) throw fail(404, 'تانک یافت نشد');
  if (tf.product_id !== tt.product_id) throw fail(400, 'محصول دو تانک یکسان نیست');
  const book = D.tankBook(from);
  if (qty > book) throw fail(400, 'موجودی تانک مبدا کافی نیست (' + book + ' لیتر)');
  const dd = docDate(b.doc_date);
  const wac = D.tankWac(from);
  return D.tx(() => {
    D.addStockMove({
      doc_date: dd, station_id: tf.station_id, tank_id: from, product_id: tf.product_id,
      direction: 'out', qty_obs: qty, unit_cost: wac, source_type: 'transfer',
      note: 'انتقال به تانک ' + tt.code
    }, user);
    D.addStockMove({
      doc_date: dd, station_id: tt.station_id, tank_id: to, product_id: tt.product_id,
      direction: 'in', qty_obs: qty, unit_cost: wac, source_type: 'transfer',
      note: 'انتقال از تانک ' + tf.code
    }, user);
    D.audit(user, 'انتقال بین تانک', 'tank', from, qty + ' لیتر به تانک ' + tt.code);
    return { ok: true };
  });
});
