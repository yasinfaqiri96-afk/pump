'use strict';
/* راپورهای عملیاتی و کنترولی — ادامه reports.js
   جدا نگه داشته شده تا هر فایل کوتاه و قابل خواندن بماند. */
const D = require('./db');
const A = require('./api');
const Jalali = require('../public/js/shared/jalali.js');
const { route, docDate, today } = A;
const N = D.num, R = D.round;

function range(q) {
  const to = docDate(q.to || today());
  const from = q.from ? docDate(q.from) : Jalali.addDaysGreg(to, -29);
  return { from, to };
}
function stFilter(q, alias, user) {
  const st = (user && user.station_id) || q.station_id;
  if (!st) return { sql: '', args: [] };
  return { sql: ` AND ${alias}.station_id=?`, args: [Number(st)] };
}
function scopeId(user, q) {
  if (user && user.station_id) return Number(user.station_id);
  return q && q.station_id ? Number(q.station_id) : null;
}

/* ============================================================
   فروش قرضی مشتریان — کدام مشتری چقدر قرضی گرفت
   ============================================================ */
route('GET', '/reports/credit', 'read', ({ user, q }) => {
  const { from, to } = range(q);
  const s = stFilter(q, 'c', user);
  const rows = D.all(`SELECT c.party_id, p.name party_name, p.phone, p.credit_limit,
      COUNT(*) tickets, COALESCE(SUM(c.qty_l),0) liters, COALESCE(SUM(c.amount),0) amount,
      COUNT(DISTINCT c.vehicle_id) vehicles
    FROM credit_ticket c JOIN party p ON p.id=c.party_id
    WHERE c.status='posted' AND c.doc_date>=? AND c.doc_date<=? ${s.sql}
    GROUP BY c.party_id ORDER BY amount DESC`, from, to, ...s.args);

  /* فروش نسیه عمده هم در همین راپور دیده شود */
  const bs = stFilter(q, 'b', user);
  const bulkCredit = D.all(`SELECT b.customer_id party_id, p.name party_name,
      COALESCE(SUM(b.qty_obs),0) liters, COALESCE(SUM(b.amount_base),0) amount
    FROM bulk_sale b JOIN party p ON p.id=b.customer_id
    WHERE b.payment_kind='credit' AND b.status='posted'
      AND b.doc_date>=? AND b.doc_date<=? ${bs.sql}
    GROUP BY b.customer_id ORDER BY amount DESC`, from, to, ...bs.args);

  return {
    from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to),
    rows: rows.map(r => Object.assign({}, r, {
      liters: R(N(r.liters), 2), amount: R(N(r.amount), 2),
      balance: D.partyBalance(r.party_id),
      over_limit: N(r.credit_limit) > 0 && D.partyBalance(r.party_id) > N(r.credit_limit)
    })),
    bulk_credit: bulkCredit.map(r => Object.assign({}, r, {
      liters: R(N(r.liters), 2), amount: R(N(r.amount), 2)
    })),
    totals: {
      liters: R(rows.reduce((a, r) => a + N(r.liters), 0), 2),
      amount: R(rows.reduce((a, r) => a + N(r.amount), 0), 2),
      bulk_amount: R(bulkCredit.reduce((a, r) => a + N(r.amount), 0), 2)
    }
  };
});

/* ============================================================
   فروش بر اساس موتر — کدام موتر چقدر تیل گرفت
   ============================================================ */
route('GET', '/reports/vehicles', 'read', ({ user, q }) => {
  const { from, to } = range(q);
  const s = stFilter(q, 'c', user);
  const args = [from, to, ...s.args];
  let extra = '';
  if (q.party_id) { extra = ' AND c.party_id=?'; args.push(Number(q.party_id)); }
  const rows = D.all(`SELECT c.vehicle_id, COALESCE(v.plate_no,'— بدون موتر —') plate_no,
      v.kind vehicle_kind, v.driver_name, p.name party_name, c.party_id,
      pr.name product_name,
      COUNT(*) tickets, COALESCE(SUM(c.qty_l),0) liters, COALESCE(SUM(c.amount),0) amount,
      MAX(c.doc_date) last_date
    FROM credit_ticket c LEFT JOIN vehicle v ON v.id=c.vehicle_id
    JOIN party p ON p.id=c.party_id LEFT JOIN product pr ON pr.id=c.product_id
    WHERE c.status='posted' AND c.doc_date>=? AND c.doc_date<=? ${s.sql}${extra}
    GROUP BY c.vehicle_id, c.product_id ORDER BY amount DESC LIMIT 300`, ...args);

  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  return {
    from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to), days,
    rows: rows.map(r => Object.assign({}, r, {
      liters: R(N(r.liters), 2), amount: R(N(r.amount), 2),
      per_day: R(N(r.liters) / days, 2),
      per_ticket: N(r.tickets) > 0 ? R(N(r.liters) / N(r.tickets), 2) : 0
    })),
    totals: {
      liters: R(rows.reduce((a, r) => a + N(r.liters), 0), 2),
      amount: R(rows.reduce((a, r) => a + N(r.amount), 0), 2)
    }
  };
});

/* ============================================================
   انتقال بین تانک‌ها
   ============================================================ */
route('GET', '/reports/transfers', 'read', ({ user, q }) => {
  const { from, to } = range(q);
  const s = stFilter(q, 'tr', user);
  const rows = D.all(`SELECT tr.*, f.code from_code, f.name from_name,
      t2.code to_code, t2.name to_name, p.name product_name, p.color, u.full_name created_by_name
    FROM tank_transfer tr JOIN tank f ON f.id=tr.from_tank_id JOIN tank t2 ON t2.id=tr.to_tank_id
    JOIN product p ON p.id=tr.product_id LEFT JOIN app_user u ON u.id=tr.created_by
    WHERE tr.doc_date>=? AND tr.doc_date<=? ${s.sql}
    ORDER BY tr.doc_date DESC, tr.id DESC LIMIT 300`, from, to, ...s.args);
  const posted = rows.filter(r => r.status === 'posted');
  return {
    from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to),
    rows,
    totals: {
      count: posted.length,
      liters: R(posted.reduce((a, r) => a + N(r.qty_l), 0), 2),
      reversed: rows.filter(r => r.status === 'reversed').length
    }
  };
});

/* ============================================================
   تاریخچه نرخ
   ============================================================ */
route('GET', '/reports/prices', 'read', ({ user, q }) => {
  const { from, to } = range(q);
  const st = scopeId(user, q);
  const rows = D.all(`SELECT pr.*, p.name product_name, p.uom, p.color, s.name station_name,
      u.full_name created_by_name
    FROM price pr JOIN product p ON p.id=pr.product_id
    LEFT JOIN station s ON s.id=pr.station_id LEFT JOIN app_user u ON u.id=pr.created_by
    WHERE pr.effective_from>=? AND pr.effective_from<=?
      ${st ? 'AND (pr.station_id IS NULL OR pr.station_id=' + st + ')' : ''}
    ORDER BY pr.effective_from DESC, pr.id DESC LIMIT 300`, from, to);

  /* تغییرات نرخ وسط شفت */
  const chk = D.all(`SELECT c.*, p.name product_name, s.doc_date, s.id shift_id,
      u.full_name created_by_name
    FROM price_checkpoint c JOIN product p ON p.id=c.product_id
    JOIN shift s ON s.id=c.shift_id LEFT JOIN app_user u ON u.id=c.created_by
    WHERE s.doc_date>=? AND s.doc_date<=? ${st ? 'AND s.station_id=' + st : ''}
    ORDER BY c.at DESC LIMIT 200`, from, to);

  return {
    from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to),
    rows, checkpoints: chk,
    current: D.all(`SELECT * FROM product WHERE active=1 ORDER BY id`).map(p => ({
      product_id: p.id, name: p.name, uom: p.uom, color: p.color,
      price: D.activePrice(p.id, st, today())
    }))
  };
});

/* ============================================================
   کالیبراسیون و مهر — نزدیک به ختم
   ============================================================ */
route('GET', '/reports/calibration', 'read', ({ user, q }) => {
  const st = scopeId(user, q);
  const days = Math.max(1, Number(q.days) || Number(D.setting('calib_warn_days', '30')) || 30);
  const limit = Jalali.addDaysGreg(today(), days);

  const nozzles = D.all(`SELECT n.id, n.code, n.meter_factor, n.calib_date, n.next_check,
      d.code dispenser_code, d.station_id, s.name station_name, t.code tank_code,
      (SELECT COUNT(*) FROM nozzle_calib c WHERE c.nozzle_id=n.id) history_count
    FROM nozzle n JOIN dispenser d ON d.id=n.dispenser_id JOIN station s ON s.id=d.station_id
    JOIN tank t ON t.id=n.tank_id
    WHERE n.active=1 ${st ? 'AND d.station_id=' + st : ''}
    ORDER BY (n.next_check IS NULL), n.next_check`);

  const tanks = D.all(`SELECT t.id, t.code, t.name, t.station_id, s.name station_name,
      v.version, v.effective_from, v.next_check, v.certificate_no, v.source, v.point_count,
      (SELECT COUNT(*) FROM tank_calib_version x WHERE x.tank_id=t.id) history_count
    FROM tank t JOIN station s ON s.id=t.station_id
    LEFT JOIN tank_calib_version v ON v.id=t.calib_version_id
    WHERE t.active=1 ${st ? 'AND t.station_id=' + st : ''}
    ORDER BY (v.next_check IS NULL), v.next_check`);

  const flag = x => ({
    expired: !!(x.next_check && x.next_check < today()),
    due_soon: !!(x.next_check && x.next_check >= today() && x.next_check <= limit),
    missing: !x.next_check
  });

  return {
    days, limit, limit_shamsi: Jalali.toShamsi(limit),
    nozzles: nozzles.map(n => Object.assign({}, n, flag(n))),
    tanks: tanks.map(t => Object.assign({}, t, flag(t), { linear_warning: t.source === 'linear' })),
    seals: D.all(`SELECT * FROM equipment_seal WHERE removed_on IS NULL
      ORDER BY applied_on DESC LIMIT 100`)
  };
});

/* ============================================================
   موجودی امانتی — مال ما در برابر مال دیگران
   ============================================================ */
route('GET', '/reports/consignment', 'read', ({ user, q }) => {
  const st = scopeId(user, q);
  const tanks = D.all(`SELECT t.*, p.name product_name, p.uom, p.color, s.name station_name
    FROM tank t JOIN product p ON p.id=t.product_id JOIN station s ON s.id=t.station_id
    WHERE t.active=1 ${st ? 'AND t.station_id=' + st : ''} ORDER BY t.code`);
  const rows = [];
  let ownedTotal = 0, consignTotal = 0;
  for (const t of tanks) {
    const state = D.tankState(t.id);
    const cons = state.consigned.map(c => {
      const p = D.get(`SELECT name, phone FROM party WHERE id=?`, c.party_id);
      return { party_id: c.party_id, party_name: p ? p.name : ('#' + c.party_id), qty_l: c.qty_l };
    });
    const consL = R(cons.reduce((a, c) => a + c.qty_l, 0), 3);
    ownedTotal += state.owned_l;
    consignTotal += consL;
    rows.push({
      tank_id: t.id, code: t.code, name: t.name, product_name: t.product_name,
      uom: t.uom, color: t.color, station_name: t.station_name,
      physical_l: state.qty, owned_l: state.owned_l, consigned_l: consL, owners: cons
    });
  }
  return {
    enabled: D.settingOn('consignment_on', false),
    rows,
    totals: {
      owned_l: R(ownedTotal, 2), consigned_l: R(consignTotal, 2),
      physical_l: R(ownedTotal + consignTotal, 2)
    }
  };
});

/* ============================================================
   وضعیت بکاپ — در بخش کنترول راپورها
   ============================================================ */
route('GET', '/reports/backup', 'setup', () => require('./backup').status());
