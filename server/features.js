'use strict';
const D = require('./db');
const A = require('./api');
const Petro = require('../public/js/shared/petroleum.js');
const Jalali = require('../public/js/shared/jalali.js');
const {
  route, fail, dipVolumes, docDate, today, req,
  numField, densityField, guardDate, stationScope
} = A;
const N = D.num, R = D.round;

function payAccount(method) {
  return method === 'bank' ? 'bank' : (method === 'hawala' ? 'hawala' : 'cash');
}

/* ============================================================
   ۱ — انتقال تیل میان تانک‌ها
   دو حرکت موجودی، هر دو متعلق به یک سند انتقال.
   بها با تیل منتقل می‌شود؛ هیچ سود یا فروشی ساخته نمی‌گردد.
   ============================================================ */
route('GET', '/transfers', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND tr.station_id=?'; args.push(Number(st)); }
  if (q.tank_id) { w += ' AND (tr.from_tank_id=? OR tr.to_tank_id=?)'; args.push(Number(q.tank_id), Number(q.tank_id)); }
  if (q.from) { w += ' AND tr.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND tr.doc_date<=?'; args.push(q.to); }
  const lim = Math.min(Number(q.limit) || 100, 400);
  return D.all(`SELECT tr.*, f.code from_code, f.name from_name, t2.code to_code, t2.name to_name,
      p.name product_name, p.color, u.full_name created_by_name
    FROM tank_transfer tr
    JOIN tank f ON f.id=tr.from_tank_id JOIN tank t2 ON t2.id=tr.to_tank_id
    JOIN product p ON p.id=tr.product_id LEFT JOIN app_user u ON u.id=tr.created_by
    ${w} ORDER BY tr.doc_date DESC, tr.id DESC LIMIT ${lim}`, ...args);
});

route('POST', '/transfers', 'ops', ({ user, b }) => {
  const fromId = Number(req(b, 'from_tank_id', 'تانک مبدا'));
  const toId = Number(req(b, 'to_tank_id', 'تانک مقصد'));
  const qty = numField(b, 'qty_l', 'مقدار لیتر', { positive: true });
  if (fromId === toId) throw fail(400, 'تانک مبدا و مقصد نمی‌تواند یکی باشد');

  const tf = D.get(`SELECT t.*, p.density_group, p.default_density, p.name product_name
                    FROM tank t JOIN product p ON p.id=t.product_id WHERE t.id=?`, fromId);
  const tt = D.get(`SELECT t.*, p.name product_name FROM tank t
                    JOIN product p ON p.id=t.product_id WHERE t.id=?`, toId);
  if (!tf || !tt) throw fail(404, 'تانک یافت نشد');
  if (tf.product_id !== tt.product_id)
    throw fail(400, 'محصول دو تانک یکی نیست: ' + tf.product_name + ' و ' + tt.product_name);
  if (tf.station_id !== tt.station_id)
    throw fail(400, 'انتقال بین دو استیشن پشتیبانی نمی‌شود. برای این کار از فروش عمده استفاده کنید.');
  stationScope(user, tf.station_id);

  const dd = docDate(b.doc_date);
  const backdate = guardDate(user, tf.station_id, dd, b, 'انتقال تیل');

  const book = D.tankBook(fromId);
  if (qty > book)
    throw fail(400, 'موجودی تانک مبدا کافی نیست. موجودی: ' + R(book, 2) + ' لیتر');
  if (N(tt.capacity_l) > 0 && D.tankBook(toId) + qty > N(tt.capacity_l))
    throw fail(400, 'تانک مقصد جا ندارد. جای خالی: '
      + R(N(tt.capacity_l) - D.tankBook(toId), 2) + ' لیتر');

  /* دیپ قبل/بعد اختیاری است مگر تنظیمات استیشن آن را اجباری کند */
  const needDip = D.settingOn('transfer_require_dip', false);
  if (needDip && (b.dip_before_mm === undefined || b.dip_before_mm === ''
    || b.dip_after_mm === undefined || b.dip_after_mm === ''))
    throw fail(400, 'در تنظیمات، دیپ قبل و بعد انتقال اجباری است');

  const d15 = densityField(b, 'density15', tf.default_density);
  const temp = b.temp_c === '' || b.temp_c === undefined ? 15 : N(b.temp_c, 15);
  const vcf = Petro.vcf(d15, temp, tf.density_group);

  return D.idempotent(b.idem_key, 'transfer', user, () => D.tx(() => {
    const wac = D.tankWac(fromId);            // بهای واحد مبدا — همین با تیل می‌رود
    const cost = R(qty * wac, 2);

    const r = D.run(`INSERT INTO tank_transfer
      (station_id,from_tank_id,to_tank_id,product_id,doc_date,qty_l,unit_cost,cost_amount,
       dip_before_mm,dip_after_mm,temp_c,density15,status,backdate_reason,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'posted',?,?,?,?)`,
      tf.station_id, fromId, toId, tf.product_id, dd, qty, wac, cost,
      b.dip_before_mm === '' || b.dip_before_mm === undefined ? null : N(b.dip_before_mm),
      b.dip_after_mm === '' || b.dip_after_mm === undefined ? null : N(b.dip_after_mm),
      temp, d15, backdate, b.note || null, user.id, D.now());
    const id = Number(r.lastInsertRowid);

    D.addStockMove({
      doc_date: dd, station_id: tf.station_id, tank_id: fromId, product_id: tf.product_id,
      direction: 'out', qty_obs: qty, temp_c: temp, density15: d15, vcf,
      qty15: R(qty * vcf, 3), qty_mt: Petro.toMT(qty * vcf, d15),
      unit_cost: wac, source_type: 'transfer', source_id: id,
      note: 'انتقال به تانک ' + tt.code
    }, user);
    D.addStockMove({
      doc_date: dd, station_id: tt.station_id, tank_id: toId, product_id: tt.product_id,
      direction: 'in', qty_obs: qty, temp_c: temp, density15: d15, vcf,
      qty15: R(qty * vcf, 3), qty_mt: Petro.toMT(qty * vcf, d15),
      unit_cost: wac, source_type: 'transfer', source_id: id,
      note: 'انتقال از تانک ' + tf.code
    }, user);

    D.audit(user, 'انتقال تیل بین تانک', 'tank_transfer', id,
      qty + ' لیتر از ' + tf.code + ' به ' + tt.code + ' — بهای هر لیتر ' + wac);
    return {
      id, qty_l: qty, unit_cost: wac, cost_amount: cost,
      from_book: D.tankBook(fromId), to_book: D.tankBook(toId), to_wac: D.tankWac(toId)
    };
  }));
});

/* اصلاح انتقال = سند برگشت، نه حذف */
route('POST', '/transfers/:id/reverse', 'ops', ({ user, params, b }) => {
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) throw fail(400, 'دلیل برگشت انتقال را کامل بنویسید');
  const t = D.get(`SELECT * FROM tank_transfer WHERE id=?`, params.id);
  if (!t) throw fail(404, 'سند انتقال یافت نشد');
  if (t.status !== 'posted') throw fail(400, 'این انتقال قبلاً برگشت خورده است');
  stationScope(user, t.station_id);
  const dd = docDate(b.doc_date || today());

  return D.idempotent(b.idem_key, 'transfer_reverse', user, () => D.tx(() => {
    const backBook = D.tankBook(t.to_tank_id);
    if (N(t.qty_l) > backBook)
      throw fail(400, 'برگشت ممکن نیست: موجودی تانک مقصد ('
        + R(backBook, 2) + ' لیتر) از مقدار انتقال کمتر است.');

    const r = D.run(`INSERT INTO tank_transfer
      (station_id,from_tank_id,to_tank_id,product_id,doc_date,qty_l,unit_cost,cost_amount,
       status,reversal_of,reason,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?, 'reversal',?,?,?,?,?)`,
      t.station_id, t.to_tank_id, t.from_tank_id, t.product_id, dd, N(t.qty_l),
      N(t.unit_cost), N(t.cost_amount), params.id, reason,
      'برگشت انتقال #' + params.id, user.id, D.now());
    const id = Number(r.lastInsertRowid);
    const wacBack = D.tankWac(t.to_tank_id);

    D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: t.to_tank_id, product_id: t.product_id,
      direction: 'out', qty_obs: N(t.qty_l), unit_cost: wacBack,
      source_type: 'transfer', source_id: id, reversal_of: Number(params.id),
      note: 'برگشت انتقال #' + params.id
    }, user);
    D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: t.from_tank_id, product_id: t.product_id,
      direction: 'in', qty_obs: N(t.qty_l), unit_cost: wacBack,
      source_type: 'transfer', source_id: id, reversal_of: Number(params.id),
      note: 'برگشت انتقال #' + params.id
    }, user);

    D.run(`UPDATE tank_transfer SET status='reversed', reason=? WHERE id=?`, reason, params.id);
    D.audit(user, 'برگشت انتقال تیل', 'tank_transfer', params.id, reason);
    return { id, reversed: Number(params.id) };
  }));
});

/* ============================================================
   ۲ — موترهای مشتری و فروش قرضی از نازل
   ============================================================ */
route('GET', '/vehicles', 'read', ({ q }) => {
  const args = []; let w = 'WHERE 1=1';
  if (q.party_id) { w += ' AND v.party_id=?'; args.push(Number(q.party_id)); }
  if (q.active !== '0') w += ' AND v.active=1';
  if (q.plate) { w += ' AND v.plate_no LIKE ?'; args.push('%' + q.plate + '%'); }
  return D.all(`SELECT v.*, p.name party_name, pr.name product_name FROM vehicle v
    JOIN party p ON p.id=v.party_id LEFT JOIN product pr ON pr.id=v.product_id
    ${w} ORDER BY p.name, v.plate_no LIMIT 500`, ...args);
});

route('POST', '/vehicles', 'ops', ({ user, b }) => {
  const partyId = Number(req(b, 'party_id', 'مشتری'));
  const plate = String(req(b, 'plate_no', 'نمبر پلیت')).trim();
  const dup = D.get(`SELECT id FROM vehicle WHERE party_id=? AND plate_no=? AND active=1`, partyId, plate);
  if (dup) throw fail(400, 'این نمبر پلیت قبلاً برای همین مشتری ثبت شده است');
  const r = D.run(`INSERT INTO vehicle
    (party_id,plate_no,kind,product_id,driver_name,driver_phone,credit_limit,note,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,1,?)`,
    partyId, plate, b.kind || null, b.product_id ? Number(b.product_id) : null,
    b.driver_name || null, b.driver_phone || null,
    numField(b, 'credit_limit', 'سقف اعتبار موتر', { optional: true, min: 0 }),
    b.note || null, D.now());
  D.audit(user, 'ثبت موتر مشتری', 'vehicle', r.lastInsertRowid, plate);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/vehicles/:id', 'ops', ({ user, params, b }) => {
  D.run(`UPDATE vehicle SET plate_no=?,kind=?,product_id=?,driver_name=?,driver_phone=?,
         credit_limit=?,note=?,active=? WHERE id=?`,
    String(req(b, 'plate_no', 'نمبر پلیت')).trim(), b.kind || null,
    b.product_id ? Number(b.product_id) : null, b.driver_name || null, b.driver_phone || null,
    numField(b, 'credit_limit', 'سقف اعتبار موتر', { optional: true, min: 0 }),
    b.note || null, b.active === false ? 0 : 1, params.id);
  D.audit(user, 'ویرایش موتر مشتری', 'vehicle', params.id, b.plate_no);
});

/* ---------- بلیت فروش قرضی ----------
   لیتر این بلیت قبلاً در ریدینگ نازل حساب شده. پس هیچ stock_move
   ساخته نمی‌شود — فقط مشخص می‌کند این بخش از فروش شفت نقد نیست. */
route('GET', '/credit-tickets', 'read', ({ user, q }) => {
  const args = []; let w = "WHERE c.status='posted'";
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND c.station_id=?'; args.push(Number(st)); }
  if (q.shift_id) { w += ' AND c.shift_id=?'; args.push(Number(q.shift_id)); }
  if (q.party_id) { w += ' AND c.party_id=?'; args.push(Number(q.party_id)); }
  if (q.vehicle_id) { w += ' AND c.vehicle_id=?'; args.push(Number(q.vehicle_id)); }
  if (q.from) { w += ' AND c.doc_date>=?'; args.push(q.from); }
  if (q.to) { w += ' AND c.doc_date<=?'; args.push(q.to); }
  const lim = Math.min(Number(q.limit) || 100, 500);
  const off = Math.max(0, Number(q.offset) || 0);
  return D.all(`SELECT c.*, p.name party_name, v.plate_no, v.driver_name vehicle_driver,
      pr.name product_name, n.code nozzle_code, u.full_name created_by_name
    FROM credit_ticket c JOIN party p ON p.id=c.party_id
    LEFT JOIN vehicle v ON v.id=c.vehicle_id LEFT JOIN product pr ON pr.id=c.product_id
    LEFT JOIN nozzle n ON n.id=c.nozzle_id LEFT JOIN app_user u ON u.id=c.created_by
    ${w} ORDER BY c.doc_date DESC, c.id DESC LIMIT ${lim} OFFSET ${off}`, ...args);
});

route('POST', '/credit-tickets', 'shift', ({ user, b }) => {
  const partyId = Number(req(b, 'party_id', 'مشتری'));
  const p = D.get(`SELECT * FROM party WHERE id=?`, partyId);
  if (!p) throw fail(404, 'مشتری یافت نشد');

  let shift = null, stationId = null, productId = null, nozzleId = null;
  if (b.shift_id) {
    shift = D.get(`SELECT * FROM shift WHERE id=?`, Number(b.shift_id));
    if (!shift) throw fail(404, 'شفت یافت نشد');
    if (shift.status !== 'open') throw fail(400, 'این شفت بسته شده است. بلیت قرضی ثبت نمی‌شود.');
    stationId = shift.station_id;
  } else {
    stationId = stationScope(user, req(b, 'station_id', 'استیشن'));
  }
  stationScope(user, stationId);

  if (b.nozzle_id) {
    nozzleId = Number(b.nozzle_id);
    const nz = D.get(`SELECT n.*, t.product_id FROM nozzle n JOIN tank t ON t.id=n.tank_id
                      WHERE n.id=?`, nozzleId);
    if (!nz) throw fail(404, 'نازل یافت نشد');
    productId = nz.product_id;
  } else if (b.product_id) productId = Number(b.product_id);

  const dd = docDate(b.doc_date || (shift ? shift.doc_date : null));
  const backdate = guardDate(user, stationId, dd, b, 'فروش قرضی');

  const qty = numField(b, 'qty_l', 'مقدار لیتر', { positive: true });
  let price = N(b.unit_price);
  if (!price && productId) price = D.activePrice(productId, stationId, dd);
  if (price <= 0) throw fail(400, 'نرخ فروش را وارد کنید');
  const amount = b.amount === undefined || b.amount === '' ? R(qty * price, 2) : N(b.amount);
  if (amount <= 0) throw fail(400, 'مبلغ باید بزرگتر از صفر باشد');

  /* سقف اعتبار موتر */
  let vehicle = null;
  if (b.vehicle_id) {
    vehicle = D.get(`SELECT * FROM vehicle WHERE id=?`, Number(b.vehicle_id));
    if (!vehicle) throw fail(404, 'موتر یافت نشد');
    if (vehicle.party_id !== partyId) throw fail(400, 'این موتر مربوط این مشتری نیست');
    if (N(vehicle.credit_limit) > 0) {
      const used = D.get(`SELECT COALESCE(SUM(amount),0) v FROM credit_ticket
        WHERE vehicle_id=? AND status='posted' AND doc_date>=date(?, '-30 day')`,
        vehicle.id, dd).v;
      if (N(used) + amount > N(vehicle.credit_limit) && !b.override_credit)
        throw fail(400, 'موتر ' + vehicle.plate_no + ' از سقف ماهانه خود می‌گذرد ('
          + R(N(used), 0) + ' + ' + R(amount, 0) + ' > ' + R(N(vehicle.credit_limit), 0) + ')');
    }
  }

  return D.idempotent(b.idem_key, 'credit_ticket', user, () => D.tx(() => {
    /* سقف اعتبار مشتری */
    const limit = N(p.credit_limit);
    if (limit > 0) {
      const bal = D.partyBalance(partyId);
      if (bal + amount > limit) {
        if (!b.override_credit)
          throw fail(400, 'مشتری ' + p.name + ' از سقف اعتبار می‌گذرد. طلب فعلی '
            + R(bal, 0) + ' — سقف ' + R(limit, 0));
        const reason = String(b.override_reason || '').trim();
        if (reason.length < 3) throw fail(400, 'برای عبور از سقف اعتبار، دلیل را بنویسید');
        D.raiseAlert(stationId, 'high', 'CREDIT_OVERRIDE',
          'عبور از سقف اعتبار در فروش قرضی',
          'مشتری ' + p.name + (vehicle ? ' — موتر ' + vehicle.plate_no : '')
          + ' — مبلغ ' + amount + ' — طلب ' + R(bal, 0) + ' — سقف ' + R(limit, 0)
          + ' — کاربر ' + user.full_name + ' — دلیل: ' + reason, 'party', partyId);
      }
    }

    const r = D.run(`INSERT INTO credit_ticket
      (station_id,shift_id,doc_date,party_id,vehicle_id,nozzle_id,product_id,qty_l,unit_price,
       amount,ticket_no,driver_name,status,backdate_reason,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'posted',?,?,?,?)`,
      stationId, shift ? shift.id : null, dd, partyId,
      vehicle ? vehicle.id : null, nozzleId, productId, qty, price, amount,
      b.ticket_no || null, b.driver_name || (vehicle ? vehicle.driver_name : null),
      backdate, b.note || null, user.id, D.now());
    const id = Number(r.lastInsertRowid);

    /* فقط طلب — بدون حرکت موجودی (لیتر در کنتور نازل حساب شده) */
    D.addMoneyMove({
      doc_date: dd, station_id: stationId, account: 'receivable', party_id: partyId,
      direction: 'in', amount, method: 'credit',
      source_type: 'credit_ticket', source_id: id,
      note: 'فروش قرضی' + (vehicle ? ' — موتر ' + vehicle.plate_no : '')
        + ' — ' + qty + ' لیتر'
    }, user);

    D.audit(user, 'ثبت فروش قرضی', 'credit_ticket', id,
      p.name + (vehicle ? ' / ' + vehicle.plate_no : '') + ' — ' + qty + ' لیتر — ' + amount);
    return { id, amount, balance: D.partyBalance(partyId) };
  }));
});

route('POST', '/credit-tickets/:id/reverse', 'ops', ({ user, params, b }) => {
  const reason = String(b.reason || '').trim();
  if (reason.length < 3) throw fail(400, 'دلیل برگشت بلیت را بنویسید');
  const t = D.get(`SELECT * FROM credit_ticket WHERE id=?`, params.id);
  if (!t) throw fail(404, 'بلیت یافت نشد');
  if (t.status !== 'posted') throw fail(400, 'این بلیت قبلاً برگشت خورده است');
  stationScope(user, t.station_id);
  const dd = docDate(b.doc_date || today());
  return D.idempotent(b.idem_key, 'ticket_reverse', user, () => D.tx(() => {
    const r = D.run(`INSERT INTO credit_ticket
      (station_id,shift_id,doc_date,party_id,vehicle_id,nozzle_id,product_id,qty_l,unit_price,
       amount,status,reversal_of,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'reversal',?,?,?,?)`,
      t.station_id, t.shift_id, dd, t.party_id, t.vehicle_id, t.nozzle_id, t.product_id,
      -N(t.qty_l), t.unit_price, -N(t.amount), params.id,
      'برگشت بلیت #' + params.id + ' — ' + reason, user.id, D.now());
    D.addMoneyMove({
      doc_date: dd, station_id: t.station_id, account: 'receivable', party_id: t.party_id,
      direction: 'out', amount: N(t.amount), method: 'credit',
      source_type: 'credit_ticket', source_id: Number(r.lastInsertRowid),
      reversal_of: Number(params.id), note: 'برگشت فروش قرضی #' + params.id
    }, user);
    D.run(`UPDATE credit_ticket SET status='reversed' WHERE id=?`, params.id);
    D.audit(user, 'برگشت فروش قرضی', 'credit_ticket', params.id, reason);
    return { id: Number(r.lastInsertRowid) };
  }));
});

/* ============================================================
   ۳ — تغییر نرخ وسط شفت
   ============================================================ */

/* کدام نازل‌ها هنگام تغییر نرخ باید ریدینگ داده شوند */
route('GET', '/shifts/:id/price-impact', 'read', ({ params, q }) => {
  const s = D.get(`SELECT * FROM shift WHERE id=?`, params.id);
  if (!s) throw fail(404, 'شفت یافت نشد');
  const productId = Number(q.product_id);
  const rows = D.all(`SELECT r.nozzle_id, r.opening, r.price, n.code nozzle_code,
      n.meter_digits, d.code dispenser_code
    FROM nozzle_reading r JOIN nozzle n ON n.id=r.nozzle_id
    JOIN dispenser d ON d.id=n.dispenser_id
    WHERE r.shift_id=? AND r.product_id=? ORDER BY d.code, n.code`, params.id, productId);
  /* آخرین مرز هر نازل: ریدینگ آخرین نقطه کنترل، وگرنه قرائت ابتدایی */
  for (const r of rows) {
    const last = D.get(`SELECT pr.reading FROM price_checkpoint_reading pr
      JOIN price_checkpoint c ON c.id=pr.checkpoint_id
      WHERE c.shift_id=? AND c.product_id=? AND pr.nozzle_id=?
      ORDER BY c.at DESC, c.id DESC LIMIT 1`, params.id, productId, r.nozzle_id);
    r.last_boundary = last ? N(last.reading) : N(r.opening);
  }
  const lastChk = D.get(`SELECT new_price FROM price_checkpoint
    WHERE shift_id=? AND product_id=? ORDER BY at DESC, id DESC LIMIT 1`, params.id, productId);
  return {
    shift: { id: s.id, doc_date: s.doc_date, station_id: s.station_id },
    current_price: lastChk ? N(lastChk.new_price) : (rows[0] ? N(rows[0].price) : 0),
    nozzles: rows
  };
});

route('POST', '/shifts/:id/price-checkpoint', 'finance', ({ user, params, b }) => {
  const s = D.get(`SELECT * FROM shift WHERE id=?`, params.id);
  if (!s) throw fail(404, 'شفت یافت نشد');
  if (s.status !== 'open') throw fail(400, 'این شفت بسته است. نرخ آن تغییر نمی‌کند.');
  stationScope(user, s.station_id);
  const productId = Number(req(b, 'product_id', 'محصول'));
  const newPrice = numField(b, 'new_price', 'نرخ جدید', { positive: true });

  const nozzles = D.all(`SELECT r.*, n.code nozzle_code, n.meter_digits FROM nozzle_reading r
    JOIN nozzle n ON n.id=r.nozzle_id WHERE r.shift_id=? AND r.product_id=?`, params.id, productId);
  if (!nozzles.length) throw fail(400, 'در این شفت نازلی برای این محصول نیست');

  const lastChk = D.get(`SELECT * FROM price_checkpoint WHERE shift_id=? AND product_id=?
    ORDER BY at DESC, id DESC LIMIT 1`, params.id, productId);
  const oldPrice = lastChk ? N(lastChk.new_price) : N(nozzles[0].price);
  if (R(oldPrice, 4) === R(newPrice, 4)) throw fail(400, 'نرخ جدید با نرخ فعلی یکی است');

  const given = {};
  (b.readings || []).forEach(x => given[Number(x.nozzle_id)] = x);
  for (const nz of nozzles) {
    const g = given[nz.nozzle_id];
    if (!g || g.reading === undefined || g.reading === null || g.reading === '')
      throw fail(400, 'ریدینگ فعلی نازل ' + nz.nozzle_code + ' را وارد کنید');
    const lastB = lastChk
      ? N((D.get(`SELECT reading FROM price_checkpoint_reading
                  WHERE checkpoint_id=? AND nozzle_id=?`, lastChk.id, nz.nozzle_id) || {}).reading)
      : N(nz.opening);
    const val = Number(String(g.reading).trim());
    const rolls = Number(g.rollovers) || 0;
    if (!isFinite(val) || val < 0)
      throw fail(400, 'ریدینگ نازل ' + nz.nozzle_code + ' درست نیست');
    const meterMax = Math.pow(10, nz.meter_digits || 6);
    if (val >= meterMax)
      throw fail(400, 'ریدینگ نازل ' + nz.nozzle_code + ' از ظرفیت کنتور ('
        + (nz.meter_digits || 6) + ' رقم) بیشتر است. عدد را کنترل کنید.');
    if (val < lastB && !rolls)
      throw fail(400, 'ریدینگ نازل ' + nz.nozzle_code + ' از عدد قبلی (' + lastB
        + ') کمتر است. اگر کنتور چرخیده، تعداد چرخش را وارد کنید.');
  }

  return D.idempotent(b.idem_key, 'price_checkpoint', user, () => D.tx(() => {
    /* نرخ جدید در نرخ‌نامه هم ثبت شود تا شفت‌های بعدی همان را بگیرند */
    let priceId = b.price_id ? Number(b.price_id) : null;
    if (!priceId) {
      const pr = D.run(`INSERT INTO price
        (station_id,product_id,price,currency,effective_from,note,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
        s.station_id, productId, newPrice, D.baseCurrency(), s.doc_date,
        b.note || 'تغییر نرخ در شفت #' + s.id, user.id, D.now());
      priceId = Number(pr.lastInsertRowid);
    }

    const c = D.run(`INSERT INTO price_checkpoint
      (shift_id,product_id,price_id,at,old_price,new_price,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      s.id, productId, priceId, b.at || D.now(), oldPrice, newPrice,
      b.note || null, user.id, D.now());
    const cid = Number(c.lastInsertRowid);

    for (const nz of nozzles) {
      const g = given[nz.nozzle_id];
      D.run(`INSERT OR REPLACE INTO price_checkpoint_reading
        (checkpoint_id,nozzle_id,reading,rollovers) VALUES (?,?,?,?)`,
        cid, nz.nozzle_id, Number(String(g.reading).trim()), Number(g.rollovers) || 0);
    }

    const pn = D.get(`SELECT name FROM product WHERE id=?`, productId);
    D.audit(user, 'تغییر نرخ در شفت جاری', 'shift', s.id,
      (pn ? pn.name : productId) + ': ' + oldPrice + ' → ' + newPrice
      + ' — ریدینگ ' + nozzles.length + ' نازل ثبت شد');
    D.raiseAlert(s.station_id, 'low', 'PRICE_MID_SHIFT_APPLIED',
      'نرخ در شفت جاری تغییر کرد',
      (pn ? pn.name : '') + ' از ' + oldPrice + ' به ' + newPrice
      + ' — فروش شفت #' + s.id + ' به دو بخش تقسیم می‌شود.', 'shift', s.id);
    return { id: cid, old_price: oldPrice, new_price: newPrice, price_id: priceId };
  }));
});

/* ============================================================
   ۴ — بستن روز
   ============================================================ */
route('GET', '/day-close', 'read', ({ user, q }) => {
  const stationId = Number(q.station_id || user.station_id || 0);
  if (!stationId) throw fail(400, 'استیشن را انتخاب کنید');
  const d = docDate(q.date);
  const row = D.get(`SELECT dc.*, u.full_name closed_by_name, u2.full_name reopened_by_name
    FROM day_close dc LEFT JOIN app_user u ON u.id=dc.closed_by
    LEFT JOIN app_user u2 ON u2.id=dc.reopened_by
    WHERE dc.station_id=? AND dc.doc_date=?`, stationId, d);
  const lastClosed = D.get(`SELECT doc_date FROM day_close
    WHERE station_id=? AND status='closed' ORDER BY doc_date DESC LIMIT 1`, stationId);
  const openShifts = D.all(`SELECT s.id, p.name operator_name FROM shift s
    JOIN party p ON p.id=s.operator_id
    WHERE s.station_id=? AND s.doc_date<=? AND s.status='open'`, stationId, d);
  return {
    date: d, date_shamsi: Jalali.toShamsi(d), station_id: stationId,
    closed: !!(row && row.status === 'closed'), record: row || null,
    last_closed_date: lastClosed ? lastClosed.doc_date : null,
    open_shifts: openShifts,
    can_close: !openShifts.length,
    history: D.all(`SELECT dc.*, u.full_name closed_by_name FROM day_close dc
      LEFT JOIN app_user u ON u.id=dc.closed_by
      WHERE dc.station_id=? ORDER BY dc.doc_date DESC LIMIT 30`, stationId)
  };
});

route('POST', '/day-close', 'setup', ({ user, b }) => {
  const stationId = stationScope(user, req(b, 'station_id', 'استیشن'));
  const d = docDate(b.doc_date);
  const exists = D.get(`SELECT * FROM day_close WHERE station_id=? AND doc_date=?`, stationId, d);
  if (exists && exists.status === 'closed') throw fail(400, 'این روز قبلاً بسته شده است');

  const openShifts = D.get(`SELECT COUNT(*) c FROM shift
    WHERE station_id=? AND doc_date<=? AND status='open'`, stationId, d).c;
  if (openShifts) throw fail(400, 'اول شفت‌های باز را ببندید. ' + openShifts + ' شفت باز است.');

  return D.idempotent(b.idem_key, 'day_close', user, () => D.tx(() => {
    const sh = D.get(`SELECT COALESCE(SUM(total_liters),0) lit, COALESCE(SUM(total_amount),0) amt,
        COALESCE(SUM(cash_counted),0) cash
      FROM shift WHERE station_id=? AND doc_date=? AND status='closed'`, stationId, d);
    const bulk = D.get(`SELECT COALESCE(SUM(qty_obs),0) lit, COALESCE(SUM(amount_base),0) amt
      FROM bulk_sale WHERE station_id=? AND doc_date=? AND status='posted'`, stationId, d);
    const cred = D.get(`SELECT COALESCE(SUM(amount),0) v FROM credit_ticket
      WHERE station_id=? AND doc_date=? AND status='posted'`, stationId, d);
    const exp = D.get(`SELECT COALESCE(SUM(amount_base),0) v FROM expense
      WHERE station_id=? AND doc_date=? AND status='posted'`, stationId, d);

    const totalL = R(N(sh.lit) + N(bulk.lit), 2);
    const totalA = R(N(sh.amt) + N(bulk.amt), 2);

    if (exists)
      D.run(`UPDATE day_close SET status='closed', total_liters=?, total_amount=?, cash_amount=?,
             credit_amount=?, expense_amount=?, note=?, closed_by=?, closed_at=?,
             reopened_by=NULL, reopened_at=NULL, reopen_reason=NULL
             WHERE id=?`,
        totalL, totalA, R(N(sh.cash), 2), R(N(cred.v), 2), R(N(exp.v), 2),
        b.note || null, user.id, D.now(), exists.id);
    else
      D.run(`INSERT INTO day_close
        (station_id,doc_date,status,total_liters,total_amount,cash_amount,credit_amount,
         expense_amount,note,closed_by,closed_at)
        VALUES (?,?, 'closed',?,?,?,?,?,?,?,?)`,
        stationId, d, totalL, totalA, R(N(sh.cash), 2), R(N(cred.v), 2), R(N(exp.v), 2),
        b.note || null, user.id, D.now());

    const row = D.get(`SELECT * FROM day_close WHERE station_id=? AND doc_date=?`, stationId, d);
    D.audit(user, 'بستن روز', 'day_close', row.id,
      Jalali.toShamsi(d) + ' — فروش ' + totalL + ' لیتر — ' + totalA);
    return {
      id: row.id, date: d, total_liters: totalL, total_amount: totalA,
      cash_amount: R(N(sh.cash), 2), credit_amount: R(N(cred.v), 2), expense_amount: R(N(exp.v), 2)
    };
  }));
});

/* باز کردن دوباره روز — فقط مالک، با دلیل اجباری */
route('POST', '/day-close/:id/reopen', 'admin', ({ user, params, b }) => {
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) throw fail(400, 'دلیل باز کردن دوباره روز را کامل بنویسید');
  const row = D.get(`SELECT * FROM day_close WHERE id=?`, params.id);
  if (!row) throw fail(404, 'سند بستن روز یافت نشد');
  if (row.status !== 'closed') throw fail(400, 'این روز باز است');
  D.tx(() => {
    D.run(`UPDATE day_close SET status='reopened', reopened_by=?, reopened_at=?, reopen_reason=?
           WHERE id=?`, user.id, D.now(), reason, params.id);
    D.audit(user, 'باز کردن دوباره روز بسته‌شده', 'day_close', params.id,
      Jalali.toShamsi(row.doc_date) + ' — دلیل: ' + reason);
    D.raiseAlert(row.station_id, 'high', 'DAY_REOPENED', 'روز بسته‌شده دوباره باز شد',
      'روز ' + Jalali.toShamsi(row.doc_date) + ' توسط ' + user.full_name
      + ' دوباره باز شد. دلیل: ' + reason, 'day_close', Number(params.id));
  });
  return { ok: true };
});

/* ============================================================
   ۸ — کنترل کیفیت (سند مستقل، قابل بازرسی)
   ============================================================ */
route('GET', '/quality', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND q.station_id=?'; args.push(Number(st)); }
  if (q.receipt_id) { w += ' AND q.receipt_id=?'; args.push(Number(q.receipt_id)); }
  if (q.result) { w += ' AND q.result=?'; args.push(q.result); }
  return D.all(`SELECT q.*, r.waybill_no, t.code tank_code, u.full_name created_by_name
    FROM quality_check q LEFT JOIN receipt r ON r.id=q.receipt_id
    LEFT JOIN tank t ON t.id=q.tank_id LEFT JOIN app_user u ON u.id=q.created_by
    ${w} ORDER BY q.sample_date DESC, q.id DESC LIMIT 200`, ...args);
});

route('POST', '/quality', 'ops', ({ user, b }) => {
  const result = b.result || 'pending';
  if (['pass', 'fail', 'pending'].indexOf(result) < 0) throw fail(400, 'نتیجه نامعتبر است');
  let stationId = b.station_id ? Number(b.station_id) : null, tankId = b.tank_id ? Number(b.tank_id) : null;
  if (b.receipt_id) {
    const r = D.get(`SELECT * FROM receipt WHERE id=?`, Number(b.receipt_id));
    if (!r) throw fail(404, 'سند تخلیه یافت نشد');
    stationId = r.station_id; tankId = r.tank_id;
  }
  if (stationId) stationScope(user, stationId);
  return D.tx(() => {
    const r = D.run(`INSERT INTO quality_check
      (receipt_id,station_id,tank_id,sample_date,density15,temp_c,water_ppm,result,
       lab_name,certificate_no,note,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.receipt_id ? Number(b.receipt_id) : null, stationId, tankId,
      docDate(b.sample_date), densityField(b, 'density15', 0) || null,
      b.temp_c === '' || b.temp_c === undefined ? null : N(b.temp_c),
      b.water_ppm === '' || b.water_ppm === undefined ? null : N(b.water_ppm),
      result, b.lab_name || null, b.certificate_no || null, b.note || null, user.id, D.now());
    if (b.receipt_id)
      D.run(`UPDATE receipt SET quality_ok=?, quality_note=COALESCE(?,quality_note) WHERE id=?`,
        result === 'fail' ? 0 : 1, b.note || null, Number(b.receipt_id));
    if (result === 'fail')
      D.raiseAlert(stationId, 'high', 'QUALITY_FAIL', 'کیفیت محموله رد شد',
        (b.lab_name ? 'لابراتوار ' + b.lab_name + ' — ' : '') + (b.note || 'بدون توضیح'),
        'receipt', b.receipt_id ? Number(b.receipt_id) : null);
    D.audit(user, 'ثبت کنترل کیفیت', 'quality_check', r.lastInsertRowid,
      'نتیجه: ' + result + (b.receipt_id ? ' — بارنامه #' + b.receipt_id : ''));
    return { id: Number(r.lastInsertRowid) };
  });
});

/* ============================================================
   ۱۱ — امانتی: تسویه (خرید تیل امانتی)
   ============================================================ */
route('POST', '/consignment/settle', 'finance', ({ user, b }) => {
  if (!D.settingOn('consignment_on', false)) throw fail(400, 'ماژول امانتی خاموش است');
  const tankId = Number(req(b, 'tank_id', 'تانک'));
  const ownerId = Number(req(b, 'owner_party_id', 'صاحب تیل'));
  const qty = numField(b, 'qty_l', 'مقدار لیتر', { positive: true });
  const unitCost = numField(b, 'unit_cost', 'قیمت هر لیتر', { positive: true });
  const t = D.get(`SELECT * FROM tank WHERE id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');
  stationScope(user, t.station_id);
  const dd = docDate(b.doc_date);
  guardDate(user, t.station_id, dd, b, 'تسویه امانتی');

  const st = D.tankState(tankId);
  const held = (st.consigned.find(c => c.party_id === ownerId) || {}).qty_l || 0;
  if (qty > held) throw fail(400, 'مقدار امانتی این شخص در تانک ' + R(held, 2) + ' لیتر است');

  return D.idempotent(b.idem_key, 'consign_settle', user, () => D.tx(() => {
    /* از حساب امانتی خارج، به حساب خودمان وارد */
    D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
      direction: 'out', qty_obs: qty, unit_cost: 0, owner_party_id: ownerId,
      source_type: 'adjust', source_id: null, note: 'تسویه امانتی — خروج از حساب امانت'
    }, user);
    D.addStockMove({
      doc_date: dd, station_id: t.station_id, tank_id: tankId, product_id: t.product_id,
      direction: 'in', qty_obs: qty, unit_cost: unitCost,
      source_type: 'adjust', source_id: null, note: 'تسویه امانتی — خرید از صاحب تیل'
    }, user);
    D.addMoneyMove({
      doc_date: dd, station_id: t.station_id, account: 'payable', party_id: ownerId,
      direction: 'out', amount: R(qty * unitCost, 2), method: 'credit',
      source_type: 'consignment', source_id: null,
      note: 'خرید ' + qty + ' لیتر تیل امانتی از تانک ' + t.code
    }, user);
    D.audit(user, 'تسویه تیل امانتی', 'tank', tankId,
      qty + ' لیتر از صاحب #' + ownerId + ' به قیمت ' + unitCost);
    return { ok: true, owned_l: D.tankState(tankId).owned_l };
  }));
});

/* ============================================================
   ۱۲ — پیش‌خرید و پیش‌فروش (ماژول اختیاری)
   ============================================================ */
function ordersOn() {
  if (!D.settingOn('orders_on', false))
    throw fail(400, 'ماژول پیش‌خرید و پیش‌فروش خاموش است. از تنظیمات روشن کنید.');
}

const ORDER_STATUS = {
  purchase: ['open', 'in_transit', 'received', 'closed', 'cancelled'],
  sale: ['open', 'in_transit', 'delivered', 'closed', 'cancelled']
};

route('GET', '/orders', 'read', ({ user, q }) => {
  const args = []; let w = 'WHERE 1=1';
  const st = user.station_id || q.station_id;
  if (st) { w += ' AND o.station_id=?'; args.push(Number(st)); }
  if (q.kind) { w += ' AND o.kind=?'; args.push(q.kind); }
  if (q.status) { w += ' AND o.status=?'; args.push(q.status); }
  if (q.open === '1') w += " AND o.status NOT IN ('closed','cancelled')";
  return D.all(`SELECT o.*, p.name party_name, pr.name product_name, pr.color
    FROM fuel_order o LEFT JOIN party p ON p.id=o.party_id
    JOIN product pr ON pr.id=o.product_id
    ${w} ORDER BY o.doc_date DESC, o.id DESC LIMIT 200`, ...args);
});

route('POST', '/orders', 'ops', ({ user, b }) => {
  ordersOn();
  const stationId = stationScope(user, req(b, 'station_id', 'استیشن'));
  const kind = b.kind === 'sale' ? 'sale' : 'purchase';
  const productId = Number(req(b, 'product_id', 'محصول'));
  const qty = numField(b, 'qty_l', 'مقدار لیتر', { positive: true });
  const price = numField(b, 'unit_price', 'نرخ', { optional: true, min: 0 });
  const dd = docDate(b.doc_date);
  const currency = String(b.currency || D.baseCurrency()).toUpperCase();
  let fx = 1;
  if (currency !== D.baseCurrency()) {
    fx = N(b.fx_rate) || D.fxRate(currency, dd);
    if (!fx) throw fail(400, 'نرخ ' + currency + ' ثبت نشده است');
  }
  const r = D.run(`INSERT INTO fuel_order
    (station_id,kind,party_id,product_id,doc_date,due_date,qty_l,qty_mt,unit_price,currency,
     fx_rate,amount,prepaid,status,ref_no,note,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'open',?,?,?,?)`,
    stationId, kind, b.party_id ? Number(b.party_id) : null, productId, dd,
    b.due_date ? docDate(b.due_date) : null, qty, N(b.qty_mt), price, currency, fx,
    R(qty * price, 2), numField(b, 'prepaid', 'پیش‌پرداخت', { optional: true, min: 0 }),
    b.ref_no || null, b.note || null, user.id, D.now());
  D.audit(user, kind === 'sale' ? 'ثبت پیش‌فروش' : 'ثبت پیش‌خرید', 'fuel_order',
    r.lastInsertRowid, qty + ' لیتر');
  return { id: Number(r.lastInsertRowid) };
});

route('POST', '/orders/:id/status', 'ops', ({ user, params, b }) => {
  ordersOn();
  const o = D.get(`SELECT * FROM fuel_order WHERE id=?`, params.id);
  if (!o) throw fail(404, 'سفارش یافت نشد');
  stationScope(user, o.station_id);
  const st = String(req(b, 'status', 'وضعیت'));
  if ((ORDER_STATUS[o.kind] || []).indexOf(st) < 0) throw fail(400, 'وضعیت نامعتبر است');
  D.run(`UPDATE fuel_order SET status=?, note=COALESCE(?,note) WHERE id=?`, st, b.note || null, params.id);
  D.audit(user, 'تغییر وضعیت سفارش', 'fuel_order', params.id, o.status + ' → ' + st);
  return { ok: true };
});
