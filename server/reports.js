'use strict';
const D = require('./db');
const A = require('./api');
const Jalali = require('../public/js/shared/jalali.js');
const { route, fail, docDate, today } = A;
const N = D.num, R = D.round;

function range(q) {
  const to = docDate(q.to || today());
  const from = q.from ? docDate(q.from) : Jalali.addDaysGreg(to, -29);
  return { from, to };
}
function stFilter(q, alias) {
  if (!q.station_id) return { sql: '', args: [] };
  return { sql: ` AND ${alias}.station_id=?`, args: [Number(q.station_id)] };
}

/* ============================================================
   داشبورد
   ============================================================ */
route('GET', '/reports/dashboard', 'read', ({ user, q }) => {
  const stationId = q.station_id ? Number(q.station_id) : (user.station_id || null);
  const d = today();
  const f = stationId ? ' AND station_id=' + stationId : '';

  const tanks = D.all(`SELECT t.*, p.name product_name, p.color, p.uom, s.name station_name
    FROM tank t JOIN product p ON p.id=t.product_id JOIN station s ON s.id=t.station_id
    WHERE t.active=1 ${stationId ? 'AND t.station_id=' + stationId : ''}
    ORDER BY s.name, t.code`).map(t => {
    const book = D.tankBook(t.id);
    const cap = N(t.capacity_l);
    const lastDip = D.get(`SELECT read_at, variance_l, variance_pct FROM dip
                           WHERE tank_id=? ORDER BY read_at DESC LIMIT 1`, t.id);
    return {
      id: t.id, code: t.code, name: t.name, product_name: t.product_name, color: t.color,
      uom: t.uom, station_name: t.station_name, capacity_l: cap, book_l: book,
      fill_pct: cap > 0 ? R(book / cap * 100, 1) : 0,
      low: cap > 0 && book <= N(t.min_level_l),
      last_dip_at: lastDip ? lastDip.read_at : null,
      last_variance_l: lastDip ? lastDip.variance_l : null,
      last_variance_pct: lastDip ? lastDip.variance_pct : null
    };
  });

  const todaySales = D.get(`SELECT COALESCE(SUM(total_amount),0) amt, COALESCE(SUM(total_liters),0) lit
    FROM shift WHERE doc_date=? AND status='closed' ${f}`, d);
  const todayBulk = D.get(`SELECT COALESCE(SUM(amount*fx_rate),0) amt, COALESCE(SUM(qty_obs),0) lit
    FROM bulk_sale WHERE doc_date=? ${f}`, d);

  const cash = D.get(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_base ELSE -amount_base END),0) v
    FROM money_move WHERE account='cash' ${f}`);
  const bank = D.get(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_base ELSE -amount_base END),0) v
    FROM money_move WHERE account IN ('bank','hawala') ${f}`);

  const receivable = D.all(`SELECT id FROM party WHERE kind='customer' AND active=1`)
    .reduce((s, p) => s + Math.max(D.partyBalance(p.id), 0), 0);
  const payable = D.all(`SELECT id FROM party WHERE kind='supplier' AND active=1`)
    .reduce((s, p) => s + Math.min(D.partyBalance(p.id), 0), 0);

  return {
    date: d, date_shamsi: Jalali.toShamsi(d), weekday: Jalali.weekdayOf(d),
    tanks,
    today_liters: R(N(todaySales.lit) + N(todayBulk.lit), 2),
    today_amount: R(N(todaySales.amt) + N(todayBulk.amt), 2),
    cash: R(N(cash.v), 2), bank: R(N(bank.v), 2),
    receivable: R(receivable, 2), payable: R(Math.abs(payable), 2),
    open_shifts: D.all(`SELECT s.id, s.opened_at, p.name operator_name, st.name station_name
      FROM shift s JOIN party p ON p.id=s.operator_id JOIN station st ON st.id=s.station_id
      WHERE s.status='open' ${stationId ? 'AND s.station_id=' + stationId : ''}`),
    alerts: D.all(`SELECT * FROM alert WHERE resolved=0
      ${stationId ? 'AND (station_id IS NULL OR station_id=' + stationId + ')' : ''}
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, at DESC LIMIT 8`),
    prices: D.all(`SELECT * FROM product WHERE active=1 ORDER BY id`).map(p => ({
      product_id: p.id, name: p.name, uom: p.uom, color: p.color,
      price: D.activePrice(p.id, stationId, d)
    })),
    last7: (() => {
      const out = [];
      for (let i = 6; i >= 0; i--) {
        const dd = Jalali.addDaysGreg(d, -i);
        const a = D.get(`SELECT COALESCE(SUM(total_amount),0) amt, COALESCE(SUM(total_liters),0) lit
          FROM shift WHERE doc_date=? AND status='closed' ${f}`, dd);
        const bl = D.get(`SELECT COALESCE(SUM(amount*fx_rate),0) amt, COALESCE(SUM(qty_obs),0) lit
          FROM bulk_sale WHERE doc_date=? ${f}`, dd);
        out.push({
          date: dd, shamsi: Jalali.toShamsi(dd),
          liters: R(N(a.lit) + N(bl.lit), 1), amount: R(N(a.amt) + N(bl.amt), 2)
        });
      }
      return out;
    })()
  };
});

/* ============================================================
   راپور روزانه استیشن
   ============================================================ */
route('GET', '/reports/daily', 'read', ({ q }) => {
  const stationId = Number(q.station_id || 0);
  if (!stationId) throw fail(400, 'استیشن را انتخاب کنید');
  const d = docDate(q.date || today());
  const st = D.get(`SELECT * FROM station WHERE id=?`, stationId);

  const shifts = D.all(`SELECT s.*, p.name operator_name FROM shift s
    JOIN party p ON p.id=s.operator_id WHERE s.station_id=? AND s.doc_date=?
    ORDER BY s.opened_at`, stationId, d);

  const byProduct = D.all(`SELECT pr.id, pr.name, pr.uom, pr.color,
      COALESCE(SUM(r.sold_l),0) liters, COALESCE(SUM(r.amount),0) amount
    FROM nozzle_reading r JOIN shift s ON s.id=r.shift_id JOIN product pr ON pr.id=r.product_id
    WHERE s.station_id=? AND s.doc_date=? GROUP BY pr.id ORDER BY pr.id`, stationId, d);

  const tenders = D.all(`SELECT t.kind, COALESCE(SUM(t.amount),0) amount FROM shift_tender t
    JOIN shift s ON s.id=t.shift_id WHERE s.station_id=? AND s.doc_date=? GROUP BY t.kind`, stationId, d);

  const receipts = D.all(`SELECT r.*, t.code tank_code, p.name product_name, sp.name supplier_name
    FROM receipt r JOIN tank t ON t.id=r.tank_id JOIN product p ON p.id=r.product_id
    LEFT JOIN party sp ON sp.id=r.supplier_id
    WHERE r.station_id=? AND r.doc_date=?`, stationId, d);

  const bulk = D.all(`SELECT b.*, c.name customer_name, t.code tank_code, p.name product_name
    FROM bulk_sale b LEFT JOIN party c ON c.id=b.customer_id JOIN tank t ON t.id=b.tank_id
    JOIN product p ON p.id=b.product_id WHERE b.station_id=? AND b.doc_date=?`, stationId, d);

  const expenses = D.all(`SELECT * FROM expense WHERE station_id=? AND doc_date=?`, stationId, d);

  const tankRows = D.all(`SELECT t.*, p.name product_name, p.color, p.uom FROM tank t
    JOIN product p ON p.id=t.product_id WHERE t.station_id=? AND t.active=1 ORDER BY t.code`, stationId)
    .map(t => {
      const open = D.get(`SELECT vol_net_l FROM dip WHERE tank_id=? AND doc_date=? AND kind='open'
                          ORDER BY read_at LIMIT 1`, t.id, d);
      const close = D.get(`SELECT vol_net_l, book_l, variance_l, variance_pct FROM dip
                           WHERE tank_id=? AND doc_date=? ORDER BY read_at DESC LIMIT 1`, t.id, d);
      const inQ = D.get(`SELECT COALESCE(SUM(qty_obs),0) v FROM stock_move
                         WHERE tank_id=? AND doc_date=? AND direction='in'`, t.id, d);
      const outQ = D.get(`SELECT COALESCE(SUM(qty_obs),0) v FROM stock_move
                          WHERE tank_id=? AND doc_date=? AND direction='out'`, t.id, d);
      return {
        id: t.id, code: t.code, name: t.name, product_name: t.product_name, color: t.color, uom: t.uom,
        open_l: open ? N(open.vol_net_l) : null,
        in_l: R(N(inQ.v), 2), out_l: R(N(outQ.v), 2),
        close_l: close ? N(close.vol_net_l) : null,
        book_l: close ? N(close.book_l) : D.tankBook(t.id, d),
        variance_l: close ? N(close.variance_l) : null,
        variance_pct: close ? N(close.variance_pct) : null
      };
    });

  const retailAmt = shifts.reduce((s, x) => s + N(x.total_amount), 0);
  const retailLit = shifts.reduce((s, x) => s + N(x.total_liters), 0);
  const bulkAmt = bulk.reduce((s, x) => s + N(x.amount) * N(x.fx_rate, 1), 0);
  const bulkLit = bulk.reduce((s, x) => s + N(x.qty_obs), 0);
  const expAmt = expenses.reduce((s, x) => s + N(x.amount) * N(x.fx_rate, 1), 0);
  const cashVar = shifts.reduce((s, x) => s + N(x.cash_variance), 0);

  return {
    station: st, date: d, date_shamsi: Jalali.toShamsi(d),
    date_long: Jalali.longShamsi(Jalali.toShamsi(d)), weekday: Jalali.weekdayOf(d),
    shifts, by_product: byProduct, tenders, receipts, bulk, expenses, tanks: tankRows,
    totals: {
      retail_liters: R(retailLit, 2), retail_amount: R(retailAmt, 2),
      bulk_liters: R(bulkLit, 2), bulk_amount: R(bulkAmt, 2),
      total_liters: R(retailLit + bulkLit, 2), total_amount: R(retailAmt + bulkAmt, 2),
      expenses: R(expAmt, 2), cash_variance: R(cashVar, 2),
      credit: R(tenders.filter(t => t.kind === 'credit').reduce((s, t) => s + N(t.amount), 0), 2)
    }
  };
});

/* ============================================================
   کسری تانک — روند
   ============================================================ */
route('GET', '/reports/variance', 'read', ({ q }) => {
  const { from, to } = range(q);
  const s = stFilter(q, 'd');
  const rows = D.all(`SELECT d.tank_id, t.code tank_code, t.name tank_name, p.name product_name, p.color,
      p.tolerance_pct, COUNT(*) readings,
      COALESCE(SUM(d.variance_l),0) total_var,
      COALESCE(AVG(d.variance_pct),0) avg_pct,
      COALESCE(MIN(d.variance_l),0) worst,
      SUM(CASE WHEN d.variance_l<0 THEN 1 ELSE 0 END) neg_count
    FROM dip d JOIN tank t ON t.id=d.tank_id JOIN product p ON p.id=t.product_id
    WHERE d.doc_date>=? AND d.doc_date<=? ${s.sql}
    GROUP BY d.tank_id ORDER BY total_var`, from, to, ...s.args);

  return {
    from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to),
    rows: rows.map(r => {
      const bias = r.readings > 0 ? R(N(r.neg_count) / N(r.readings) * 100, 1) : 0;
      const avg = Math.abs(N(r.avg_pct)), tol = N(r.tolerance_pct, 0.5);
      /* «مشکوک» فقط وقتی هردو شرط باشد: سوگیری یک‌طرفه مداوم، و بزرگی کسری معنادار.
         سوگیری تنها کافی نیست — تبخیر و خطای اندازه‌گیری هم همیشه منفی است. */
      const suspect = bias >= 80 && N(r.readings) >= 5 && avg > tol / 2;
      return Object.assign({}, r, {
        total_var: R(N(r.total_var), 2), avg_pct: R(N(r.avg_pct), 3),
        negative_bias_pct: bias, suspect,
        verdict: suspect ? 'کسری یک‌طرفه مداوم و معنادار — نشتی تانک یا دزدی را بررسی کنید'
          : (avg > tol ? 'میانگین کسری بالای تولرانس — کنترل شود'
            : (bias >= 80 ? 'همیشه کمی منفی ولی داخل تولرانس — طبیعی (تبخیر و خطای اندازه‌گیری)'
              : 'در حد نورمال'))
      });
    }),
    series: D.all(`SELECT d.doc_date, t.code tank_code, d.variance_l, d.variance_pct
      FROM dip d JOIN tank t ON t.id=d.tank_id
      WHERE d.doc_date>=? AND d.doc_date<=? ${s.sql} ORDER BY d.doc_date`, from, to, ...s.args)
  };
});

/* ============================================================
   کارکرد اپراتور
   ============================================================ */
route('GET', '/reports/operator', 'read', ({ q }) => {
  const { from, to } = range(q);
  const s = stFilter(q, 's');
  const rows = D.all(`SELECT s.operator_id, p.name operator_name, COUNT(*) shifts,
      COALESCE(SUM(s.total_liters),0) liters, COALESCE(SUM(s.total_amount),0) amount,
      COALESCE(SUM(s.cash_variance),0) cash_var,
      SUM(CASE WHEN s.cash_variance<0 THEN 1 ELSE 0 END) short_shifts
    FROM shift s JOIN party p ON p.id=s.operator_id
    WHERE s.status='closed' AND s.doc_date>=? AND s.doc_date<=? ${s.sql}
    GROUP BY s.operator_id ORDER BY cash_var`, from, to, ...s.args);
  return {
    from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to),
    rows: rows.map(r => Object.assign({}, r, {
      liters: R(N(r.liters), 2), amount: R(N(r.amount), 2), cash_var: R(N(r.cash_var), 2),
      balance: D.partyBalance(r.operator_id),
      short_rate: N(r.shifts) > 0 ? R(N(r.short_shifts) / N(r.shifts) * 100, 1) : 0
    }))
  };
});

/* ============================================================
   سن طلبات
   ============================================================ */
route('GET', '/reports/aging', 'read', ({ q }) => {
  const d = docDate(q.date || today());
  const kind = q.kind || 'customer';
  const parties = D.all(`SELECT * FROM party WHERE kind=? AND active=1`, kind);
  const buckets = [];
  for (const p of parties) {
    const bal = D.partyBalance(p.id);
    if (Math.abs(bal) < 0.5) continue;
    const rows = D.all(`SELECT doc_date, account, direction, amount_base FROM money_move
      WHERE party_id=? AND account IN ('receivable','payable') ORDER BY doc_date`, p.id);
    let b0 = 0, b30 = 0, b60 = 0, b90 = 0;
    let remaining = bal;
    for (let i = rows.length - 1; i >= 0 && remaining > 0.5; i--) {
      const m = rows[i];
      const signed = m.direction === 'in' ? N(m.amount_base) : -N(m.amount_base);
      if (signed <= 0) continue;
      const take = Math.min(signed, remaining);
      const days = Math.round((new Date(d) - new Date(m.doc_date)) / 86400000);
      if (days <= 30) b0 += take; else if (days <= 60) b30 += take;
      else if (days <= 90) b60 += take; else b90 += take;
      remaining -= take;
    }
    buckets.push({
      id: p.id, name: p.name, phone: p.phone, credit_limit: N(p.credit_limit),
      credit_days: p.credit_days, balance: bal,
      b0: R(b0, 2), b30: R(b30, 2), b60: R(b60, 2), b90: R(b90, 2),
      over_limit: N(p.credit_limit) > 0 && bal > N(p.credit_limit),
      risky: b90 > 0
    });
  }
  buckets.sort((a, b) => b.balance - a.balance);
  return {
    date: d, date_shamsi: Jalali.toShamsi(d), kind, rows: buckets,
    totals: buckets.reduce((t, x) => ({
      balance: R(t.balance + x.balance, 2), b0: R(t.b0 + x.b0, 2), b30: R(t.b30 + x.b30, 2),
      b60: R(t.b60 + x.b60, 2), b90: R(t.b90 + x.b90, 2)
    }), { balance: 0, b0: 0, b30: 0, b60: 0, b90: 0 })
  };
});

/* ============================================================
   سود ناخالص
   ============================================================ */
route('GET', '/reports/profit', 'read', ({ q }) => {
  const { from, to } = range(q);
  const st = q.station_id ? Number(q.station_id) : null;
  const f = st ? ' AND station_id=' + st : '';

  const rows = D.all(`SELECT id, name, uom, color FROM product WHERE active=1 ORDER BY id`).map(p => {
    const retail = D.get(`SELECT COALESCE(SUM(r.sold_l),0) lit, COALESCE(SUM(r.amount),0) amt
      FROM nozzle_reading r JOIN shift s ON s.id=r.shift_id
      WHERE r.product_id=? AND s.doc_date>=? AND s.doc_date<=? AND s.status='closed'
      ${st ? 'AND s.station_id=' + st : ''}`, p.id, from, to);
    const bulk = D.get(`SELECT COALESCE(SUM(qty_obs),0) lit, COALESCE(SUM(amount*fx_rate),0) amt,
        COALESCE(SUM(cost_amount),0) cost
      FROM bulk_sale WHERE product_id=? AND doc_date>=? AND doc_date<=? ${f}`, p.id, from, to);
    const cogsRetail = D.get(`SELECT COALESCE(SUM(qty_obs*unit_cost),0) c FROM stock_move
      WHERE product_id=? AND direction='out' AND source_type='shift'
        AND doc_date>=? AND doc_date<=? ${f}`, p.id, from, to);

    const lit = R(N(retail.lit) + N(bulk.lit), 2);
    const rev = R(N(retail.amt) + N(bulk.amt), 2);
    const cost = R(N(cogsRetail.c) + N(bulk.cost), 2);
    return {
      product_id: p.id, name: p.name, uom: p.uom, color: p.color,
      liters: lit, revenue: rev, cost: cost, profit: R(rev - cost, 2),
      margin_pct: rev > 0 ? R((rev - cost) / rev * 100, 2) : 0,
      per_unit: lit > 0 ? R((rev - cost) / lit, 4) : 0
    };
  }).filter(r => r.liters > 0 || r.revenue > 0);

  const exp = D.get(`SELECT COALESCE(SUM(amount*fx_rate),0) v FROM expense
    WHERE doc_date>=? AND doc_date<=? ${f}`, from, to);
  const gross = rows.reduce((s, r) => s + r.profit, 0);

  return {
    from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to),
    rows,
    totals: {
      liters: R(rows.reduce((s, r) => s + r.liters, 0), 2),
      revenue: R(rows.reduce((s, r) => s + r.revenue, 0), 2),
      cost: R(rows.reduce((s, r) => s + r.cost, 0), 2),
      gross_profit: R(gross, 2),
      expenses: R(N(exp.v), 2),
      net_profit: R(gross - N(exp.v), 2)
    },
    expense_breakdown: D.all(`SELECT category, COALESCE(SUM(amount*fx_rate),0) amount
      FROM expense WHERE doc_date>=? AND doc_date<=? ${f} GROUP BY category ORDER BY amount DESC`, from, to)
  };
});

/* ============================================================
   جریان نقده
   ============================================================ */
route('GET', '/reports/cash', 'read', ({ q }) => {
  const { from, to } = range(q);
  const s = stFilter(q, 'm');
  const rows = D.all(`SELECT m.account, m.method, m.direction,
      COALESCE(SUM(m.amount_base),0) amount, COUNT(*) cnt
    FROM money_move m WHERE m.account IN ('cash','bank','hawala')
      AND m.doc_date>=? AND m.doc_date<=? ${s.sql}
    GROUP BY m.account, m.method, m.direction`, from, to, ...s.args);

  const balances = ['cash', 'bank', 'hawala'].map(a => {
    const st2 = stFilter(q, 'm');
    const r = D.get(`SELECT COALESCE(SUM(CASE WHEN m.direction='in' THEN m.amount_base
        ELSE -m.amount_base END),0) v FROM money_move m WHERE m.account=? ${st2.sql}`, a, ...st2.args);
    return { account: a, balance: R(N(r.v), 2) };
  });

  const daily = D.all(`SELECT m.doc_date,
      COALESCE(SUM(CASE WHEN m.direction='in' THEN m.amount_base ELSE 0 END),0) inflow,
      COALESCE(SUM(CASE WHEN m.direction='out' THEN m.amount_base ELSE 0 END),0) outflow
    FROM money_move m WHERE m.account IN ('cash','bank','hawala')
      AND m.doc_date>=? AND m.doc_date<=? ${s.sql}
    GROUP BY m.doc_date ORDER BY m.doc_date`, from, to, ...s.args)
    .map(r => Object.assign(r, { shamsi: Jalali.toShamsi(r.doc_date), net: R(N(r.inflow) - N(r.outflow), 2) }));

  return { from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to), rows, balances, daily };
});

/* ============================================================
   کسری ترانزیت هر ترانسپورتر
   ============================================================ */
route('GET', '/reports/transit', 'read', ({ q }) => {
  const { from, to } = range(q);
  const s = stFilter(q, 'r');
  const rows = D.all(`SELECT r.transporter_id, COALESCE(p.name,'— بدون ترانسپورتر —') transporter_name,
      COUNT(*) trips, COALESCE(SUM(r.src_qty_mt),0) src_mt, COALESCE(SUM(r.qty_mt),0) recv_mt,
      COALESCE(SUM(r.variance_mt),0) var_mt, COALESCE(AVG(r.variance_pct),0) avg_pct
    FROM receipt r LEFT JOIN party p ON p.id=r.transporter_id
    WHERE r.doc_date>=? AND r.doc_date<=? AND r.src_qty_mt>0 ${s.sql}
    GROUP BY r.transporter_id ORDER BY var_mt`, from, to, ...s.args);
  return {
    from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to),
    rows: rows.map(r => Object.assign({}, r, {
      src_mt: R(N(r.src_mt), 3), recv_mt: R(N(r.recv_mt), 3),
      var_mt: R(N(r.var_mt), 3), avg_pct: R(N(r.avg_pct), 3),
      suspect: N(r.avg_pct) < -0.5 && N(r.trips) >= 3
    }))
  };
});

/* ============================================================
   مقایسه استیشن‌ها
   ============================================================ */
route('GET', '/reports/stations', 'read', ({ q }) => {
  const { from, to } = range(q);
  const rows = D.all(`SELECT * FROM station WHERE active=1 ORDER BY name`).map(s => {
    const sh = D.get(`SELECT COALESCE(SUM(total_liters),0) lit, COALESCE(SUM(total_amount),0) amt,
        COALESCE(SUM(cash_variance),0) cv, COUNT(*) n
      FROM shift WHERE station_id=? AND status='closed' AND doc_date>=? AND doc_date<=?`, s.id, from, to);
    const bl = D.get(`SELECT COALESCE(SUM(qty_obs),0) lit, COALESCE(SUM(amount*fx_rate),0) amt
      FROM bulk_sale WHERE station_id=? AND doc_date>=? AND doc_date<=?`, s.id, from, to);
    const ex = D.get(`SELECT COALESCE(SUM(amount*fx_rate),0) v FROM expense
      WHERE station_id=? AND doc_date>=? AND doc_date<=?`, s.id, from, to);
    const dv = D.get(`SELECT COALESCE(SUM(d.variance_l),0) v FROM dip d
      WHERE d.station_id=? AND d.doc_date>=? AND d.doc_date<=?`, s.id, from, to);
    return {
      id: s.id, name: s.name, province: s.province,
      liters: R(N(sh.lit) + N(bl.lit), 2), amount: R(N(sh.amt) + N(bl.amt), 2),
      shifts: sh.n, cash_variance: R(N(sh.cv), 2),
      expenses: R(N(ex.v), 2), tank_variance: R(N(dv.v), 2)
    };
  });
  return { from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to), rows };
});

/* ============================================================
   دفتر موجودی یک تانک
   ============================================================ */
route('GET', '/reports/stockcard', 'read', ({ q }) => {
  const tankId = Number(q.tank_id || 0);
  if (!tankId) throw fail(400, 'تانک را انتخاب کنید');
  const { from, to } = range(q);
  const t = D.get(`SELECT t.*, p.name product_name, p.uom FROM tank t
    JOIN product p ON p.id=t.product_id WHERE t.id=?`, tankId);
  if (!t) throw fail(404, 'تانک یافت نشد');

  const opening = D.tankBook(tankId, Jalali.addDaysGreg(from, -1));
  const moves = D.all(`SELECT * FROM stock_move WHERE tank_id=? AND doc_date>=? AND doc_date<=?
    ORDER BY doc_date, id`, tankId, from, to);
  let bal = opening;
  const lines = moves.map(m => {
    bal = R(bal + (m.direction === 'in' ? N(m.qty_obs) : -N(m.qty_obs)), 3);
    return Object.assign({}, m, { running: bal, shamsi: Jalali.toShamsi(m.doc_date) });
  });
  return {
    tank: t, from, to, from_shamsi: Jalali.toShamsi(from), to_shamsi: Jalali.toShamsi(to),
    opening, closing: bal, lines,
    dips: D.all(`SELECT * FROM dip WHERE tank_id=? AND doc_date>=? AND doc_date<=?
      ORDER BY read_at`, tankId, from, to)
  };
});
