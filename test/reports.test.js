'use strict';
/* تست راپورها — هر مسیر راپور باید بدون خطا جواب بدهد و شکل درست داشته باشد. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-rep-'));
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
process.env.PUMP_DB = path.join(TMP, 'data', 'pump.db');
process.env.NODE_ENV = 'test';

const D = require('../server/db');
const api = require('../server/api');
require('../server/seed').ensureSeed();
const Jalali = require('../public/js/shared/jalali.js');

let TOKEN = '';
async function call(method, p, body, query) {
  const out = await api.handle({
    method, path: p, body: body || {}, query: query || {}, token: TOKEN, ip: '127.0.0.1'
  });
  return out.body;
}
const uid = (() => { let i = 0; return () => 'r' + (++i) + '-' + Date.now(); })();
const today = () => Jalali.todayGregorian();

let ST, TANK_D1, TANK_D2, CUSTOMER, VEHICLE, NZ;

test('راه‌اندازی داده برای راپورها', async () => {
  TOKEN = (await api.handle({
    method: 'POST', path: '/auth/login', body: { username: 'admin', pin: '1234' },
    query: {}, token: '', ip: '1.1.1.1'
  })).body.token;

  const meta = await call('GET', '/meta');
  ST = meta.stations[0].id;
  const tanks = await call('GET', '/tanks');
  TANK_D1 = tanks.find(t => t.code === 'T-02').id;
  TANK_D2 = tanks.find(t => t.code === 'T-03').id;
  CUSTOMER = (await call('GET', '/parties', null, { kind: 'customer' }))[0].id;
  VEHICLE = (await call('GET', '/vehicles', null, { party_id: CUSTOMER }))[0].id;
  NZ = await call('GET', '/nozzles', null, { station_id: ST });

  /* یک شفت کامل با فروش قرضی، یک انتقال، یک مصرف */
  const op = (await call('GET', '/parties', null, { kind: 'employee' }))[0].id;
  const s = await call('POST', '/shifts/open', {
    idem_key: uid(), station_id: ST, operator_id: op,
    nozzles: NZ.map(n => ({ nozzle_id: n.id, opening: 0 }))
  });
  await call('POST', '/credit-tickets', {
    idem_key: uid(), shift_id: s.id, party_id: CUSTOMER, vehicle_id: VEHICLE,
    nozzle_id: NZ[1].id, qty_l: 150, unit_price: 73
  });
  await call('POST', '/shifts/' + s.id + '/close', {
    idem_key: uid(),
    readings: NZ.map(n => ({ nozzle_id: n.id, closing: 400 })),
    cash_counted: 1
  });
  await call('POST', '/transfers', {
    idem_key: uid(), from_tank_id: TANK_D1, to_tank_id: TANK_D2, qty_l: 1000
  });
  await call('POST', '/expenses', {
    idem_key: uid(), station_id: ST, category: 'برق', amount: 3000
  });
  await call('POST', '/dips', { idem_key: uid(), tank_id: TANK_D1, dip_mm: 1300, temp_c: 26 });
});

const GETS = [
  ['/reports/dashboard', {}],
  ['/reports/daily', {}],
  ['/reports/variance', {}],
  ['/reports/operator', {}],
  ['/reports/transit', {}],
  ['/reports/profit', {}],
  ['/reports/aging', {}],
  ['/reports/cash', {}],
  ['/reports/stations', {}],
  ['/reports/credit', {}],
  ['/reports/vehicles', {}],
  ['/reports/transfers', {}],
  ['/reports/prices', {}],
  ['/reports/calibration', {}],
  ['/reports/consignment', {}],
  ['/reports/backup', {}]
];

for (const [p, q] of GETS)
  test('راپور بدون خطا جواب می‌دهد: ' + p, async () => {
    const r = await call('GET', p, null, Object.assign({ station_id: ST }, q));
    assert.ok(r && typeof r === 'object', 'جواب خالی نیست');
  });

test('دفتر موجودی تانک', async () => {
  const r = await call('GET', '/reports/stockcard', null, { tank_id: TANK_D1, station_id: ST });
  assert.ok(r.lines.length > 0, 'حرکت موجودی دارد');
  const last = r.lines[r.lines.length - 1];
  assert.strictEqual(last.running, r.closing, 'بیلانس جاری آخر = موجودی نهایی');
});

test('راپور فروش قرضی مشتری را نشان می‌دهد', async () => {
  const r = await call('GET', '/reports/credit', null, { station_id: ST });
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].liters, 150);
  assert.strictEqual(r.rows[0].amount, 150 * 73);
  assert.strictEqual(r.rows[0].balance, 150 * 73, 'طلب مشتری برابر بلیت‌هایش است');
});

test('راپور فروش بر اساس موتر', async () => {
  const r = await call('GET', '/reports/vehicles', null, { station_id: ST });
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].liters, 150);
  assert.ok(r.rows[0].plate_no);
  assert.strictEqual(r.rows[0].tickets, 1);
});

test('راپور انتقال بین تانک‌ها', async () => {
  const r = await call('GET', '/reports/transfers', null, { station_id: ST });
  assert.strictEqual(r.totals.count, 1);
  assert.strictEqual(r.totals.liters, 1000);
});

test('راپور کالیبراسیون: جدول خطی علامت هشدار می‌گیرد', async () => {
  const r = await call('GET', '/reports/calibration', null, { station_id: ST });
  assert.strictEqual(r.tanks.length, 3);
  assert.ok(r.tanks.every(t => t.linear_warning), 'جدول نمونه خطی است و باید هشدار بدهد');
  assert.ok(r.nozzles.every(n => n.history_count >= 1), 'هر نازل تاریخچه کالیبراسیون دارد');
});

test('راپور روزانه: فروش قرضی و انتقال را نشان می‌دهد', async () => {
  const r = await call('GET', '/reports/daily', null, { station_id: ST, date: today() });
  assert.strictEqual(r.credit_tickets.length, 1);
  assert.strictEqual(r.transfers.length, 1);
  assert.strictEqual(r.totals.credit_tickets, 150 * 73);
  assert.strictEqual(r.day_closed, false);
  assert.ok(r.totals.total_liters > 0);
});

test('راپور سود: درآمد منهای بهای تمام‌شده', async () => {
  const r = await call('GET', '/reports/profit', null, { station_id: ST });
  assert.ok(r.rows.length > 0);
  for (const row of r.rows)
    assert.strictEqual(row.profit, D.round(row.revenue - row.cost, 2), 'سود = درآمد − بها');
  assert.strictEqual(r.totals.net_profit,
    D.round(r.totals.gross_profit - r.totals.expenses, 2), 'سود خالص = سود ناخالص − مصارف');
});

test('راپور امانتی وقتی ماژول خاموش است هم کار می‌کند', async () => {
  const r = await call('GET', '/reports/consignment', null, { station_id: ST });
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(r.totals.consigned_l, 0, 'هیچ تیل امانتی نیست');
  assert.ok(r.totals.owned_l > 0);
});

test('امانتی: ورود تیل امانتی جدا از مال خود ما شمرده می‌شود', async () => {
  await call('POST', '/settings', { consignment_on: '1' });
  const owner = (await call('GET', '/parties', null, { kind: 'supplier' }))[0].id;
  const before = await call('GET', '/tanks/' + TANK_D2);

  await call('POST', '/receipts', {
    idem_key: uid(), tank_id: TANK_D2, doc_date: today(),
    owner_party_id: owner, waybill_no: 'WB-CONS',
    dip_before_mm: 200, dip_after_mm: 400,     // T-03 ظرفیت 60,000 -> 30 L/mm -> 6,000 لیتر
    temp_c: 25, density15: 0.84, unit_cost: 0
  });

  const after = await call('GET', '/tanks/' + TANK_D2);
  assert.strictEqual(after.book_l, before.book_l + 6000, 'موجودی فزیکی زیاد شد');
  assert.strictEqual(after.owned_l, before.owned_l, 'مال خود ما تغییر نکرد');
  assert.strictEqual(after.consigned_l, 6000, 'شش هزار لیتر امانتی');

  const rep = await call('GET', '/reports/consignment', null, { station_id: ST });
  assert.strictEqual(rep.enabled, true);
  assert.strictEqual(rep.totals.consigned_l, 6000);

  /* تیل امانتی خرید نیست — بدهی به تهیه‌کننده ساخته نشد */
  const bal = (await call('GET', '/parties/' + owner + '/ledger')).balance;
  assert.strictEqual(bal, 0, 'تیل امانتی قرض ما نیست');

  await call('POST', '/settings', { consignment_on: '0' });
});

test('ماژول‌های خاموش، مسیر خود را رد می‌کنند', async () => {
  try {
    await call('POST', '/orders', { station_id: ST, kind: 'purchase', product_id: 1, qty_l: 100 });
    assert.fail('باید رد می‌شد');
  } catch (e) { assert.match(e.message, /خاموش است/); }

  await call('POST', '/settings', { orders_on: '1' });
  const o = await call('POST', '/orders', {
    station_id: ST, kind: 'purchase', product_id: 1, qty_l: 5000, unit_price: 65
  });
  assert.ok(o.id);
  const list = await call('GET', '/orders', null, { station_id: ST });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].status, 'open');
  await call('POST', '/orders/' + o.id + '/status', { status: 'in_transit' });
  assert.strictEqual((await call('GET', '/orders', null, { station_id: ST }))[0].status, 'in_transit');
  await call('POST', '/settings', { orders_on: '0' });
});

test('صفحه‌بندی: offset و limit کار می‌کند', async () => {
  const all = await call('GET', '/dips', null, { station_id: ST, limit: 100 });
  if (all.length > 1) {
    const page2 = await call('GET', '/dips', null, { station_id: ST, limit: 1, offset: 1 });
    assert.strictEqual(page2.length, 1);
    assert.strictEqual(page2[0].id, all[1].id);
  }
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { } });
