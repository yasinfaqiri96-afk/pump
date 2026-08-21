'use strict';
/* تست عملیات — روی یک دیتابیس موقت، از راه همان API واقعی.
   اجرا:  node --test test/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* دیتابیس موقت مخصوص همین اجرا */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-test-'));
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
process.env.PUMP_DB = path.join(TMP, 'data', 'pump.db');
process.env.NODE_ENV = 'test';

const D = require('../server/db');
const api = require('../server/api');
require('../server/seed').ensureSeed();
const Petro = require('../public/js/shared/petroleum.js');
const Jalali = require('../public/js/shared/jalali.js');

/* ---------- کمک‌کننده ---------- */
let TOKEN = '';
async function call(method, p, body, query, token) {
  const out = await api.handle({
    method, path: p, body: body || {}, query: query || {},
    token: token === undefined ? TOKEN : token, ip: '127.0.0.1'
  });
  return out.body;
}
async function fails(fn, match) {
  try { await fn(); }
  catch (e) { if (match) assert.match(e.message, match, 'پیام خطا: ' + e.message); return e; }
  assert.fail('انتظار خطا بود ولی عملیات موفق شد');
}
const N = v => { const x = Number(v); return isFinite(x) ? x : 0; };
const uid = (() => { let i = 0; return () => 'k' + (++i) + '-' + Date.now(); })();
const today = () => Jalali.todayGregorian();
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps === undefined ? 0.01 : eps),
  'انتظار ' + b + ' ولی ' + a + ' آمد');

/* ---------- شناسه‌های داده اولیه ---------- */
let ST, TANK_P, TANK_D1, TANK_D2, NZ, OPERATOR, CUSTOMER, SUPPLIER, VEHICLE, PROD_D, PROD_P;

test('راه‌اندازی: ورود و خواندن داده اولیه', async () => {
  const r = await call('POST', '/auth/login', { username: 'admin', pin: '1234' }, {}, '');
  assert.ok(r.token, 'توکن گرفته شد');
  TOKEN = r.token;
  assert.strictEqual(r.user.role, 'owner');

  const meta = await call('GET', '/meta');
  ST = meta.stations[0].id;
  PROD_P = meta.products.find(p => p.code === 'PET').id;
  PROD_D = meta.products.find(p => p.code === 'DSL').id;

  const tanks = await call('GET', '/tanks');
  TANK_P = tanks.find(t => t.code === 'T-01').id;
  TANK_D1 = tanks.find(t => t.code === 'T-02').id;
  TANK_D2 = tanks.find(t => t.code === 'T-03').id;
  assert.strictEqual(tanks.find(t => t.code === 'T-02').book_l, 41200);

  const nz = await call('GET', '/nozzles', null, { station_id: ST });
  NZ = nz;
  assert.strictEqual(nz.length, 4);

  const parties = await call('GET', '/parties', null, { kind: 'employee' });
  OPERATOR = parties[0].id;
  CUSTOMER = (await call('GET', '/parties', null, { kind: 'customer' }))[0].id;
  SUPPLIER = (await call('GET', '/parties', null, { kind: 'supplier' }))[0].id;
  VEHICLE = (await call('GET', '/vehicles', null, { party_id: CUSTOMER }))[0].id;
});

/* ============================================================
   ۱ — ورود تیل موفق  /  ۱۷ — حرارت و ثقلت  /  ۱۸ — لیتر ↔ تُن
   ============================================================ */
let RECEIPT_ID;
test('۱ — ثبت ورود تیل: موجودی، بهای تمام‌شده، تُن و VCF درست محاسبه می‌شود', async () => {
  const bookBefore = (await call('GET', '/tanks/' + TANK_D1)).book_l;

  const r = await call('POST', '/receipts', {
    idem_key: uid(), tank_id: TANK_D1, doc_date: today(),
    supplier_id: SUPPLIER, waybill_no: 'WB-1001', truck_plate: '۱۱۱۱ هرات',
    dip_before_mm: 1000, dip_after_mm: 1500,      // 30,000 -> 45,000 لیتر
    temp_c: 32, density15: 0.84,
    src_qty_mt: 12.5, src_density15: 0.84,
    unit_cost: 68, other_cost: 5000, payment_kind: 'credit'
  });
  RECEIPT_ID = r.id;

  assert.strictEqual(r.vol_obs_l, 15000, 'حجم مشاهده‌ای = اختلاف دو دیپ');

  /* حجم در ۱۵ درجه با VCF واقعی */
  const vcf = Petro.vcf(0.84, 32, 'diesel');
  near(r.vol15_l, 15000 * vcf, 0.01);
  assert.ok(r.vol15_l < 15000, 'تیل ۳۲ درجه گرم است، حجم ۱۵ درجه کمتر می‌شود');

  /* ۱۸ — تبدیل به تُن متریک */
  near(r.qty_mt, Petro.toMT(r.vol15_l, 0.84), 1e-6);
  /* 15,000 L @32°C → VCF 0.985596 → 14,783.9 L@15 → ×0.8389 kg/L → 12.402 MT */
  near(r.qty_mt, 12.402, 0.002);

  /* کسری ترانزیت */
  near(r.variance_mt, r.qty_mt - 12.5, 1e-6);

  /* بهای تمام‌شده شامل مصارف جانبی */
  assert.strictEqual(r.total_cost, 68 * 15000 + 5000);

  const t = await call('GET', '/tanks/' + TANK_D1);
  assert.strictEqual(t.book_l, bookBefore + 15000, 'موجودی تانک زیاد شد');

  /* WAC: (41200×66 + 1,025,000) / 56,200 */
  const expectedWac = (41200 * 66 + (68 * 15000 + 5000)) / 56200;
  near(t.wac, expectedWac, 0.0001);

  /* بدهی به تهیه‌کننده ساخته شد */
  const sup = (await call('GET', '/parties', null, { kind: 'supplier' })).find(x => x.id === SUPPLIER);
  assert.strictEqual(sup.balance, -(68 * 15000 + 5000), 'منفی = ما به او قرض داریم');
});

/* ============================================================
   ۳ — جلوگیری از ثبت دوباره
   ============================================================ */
test('۳ — ورود تیل تکراری با همان کلید، دو بار ثبت نمی‌شود', async () => {
  const key = uid();
  const body = {
    idem_key: key, tank_id: TANK_D2, doc_date: today(),
    supplier_id: SUPPLIER, waybill_no: 'WB-1002',
    dip_before_mm: 600, dip_after_mm: 700,        // 18,000 -> 21,000
    temp_c: 25, density15: 0.84, unit_cost: 67
  };
  const before = (await call('GET', '/tanks/' + TANK_D2)).book_l;
  const r1 = await call('POST', '/receipts', body);
  const r2 = await call('POST', '/receipts', body);          // کاربر دوباره دکمه را زد
  const after = (await call('GET', '/tanks/' + TANK_D2)).book_l;

  assert.strictEqual(r2.duplicate, true, 'درخواست دوم به عنوان تکراری شناخته شد');
  assert.strictEqual(r1.id, r2.id, 'همان سند اول برگردانده شد');
  assert.strictEqual(after - before, 3000, 'موجودی فقط یک بار زیاد شد');

  const cnt = D.get(`SELECT COUNT(*) c FROM receipt WHERE waybill_no='WB-1002'`).c;
  assert.strictEqual(cnt, 1, 'فقط یک سند در دیتابیس است');
});

/* ============================================================
   ۴ و ۵ — انتقال بین تانک و انتقال بها
   ============================================================ */
test('۴ و ۵ — انتقال تیل: موجودی جابه‌جا و بها منتقل می‌شود', async () => {
  const fromBefore = await call('GET', '/tanks/' + TANK_D1);
  const toBefore = await call('GET', '/tanks/' + TANK_D2);
  const fromWac = fromBefore.wac, toWac = toBefore.wac;
  assert.notStrictEqual(Math.round(fromWac * 100), Math.round(toWac * 100),
    'برای معنادار بودن تست، بهای دو تانک باید فرق کند');

  const qty = 10000;
  const r = await call('POST', '/transfers', {
    idem_key: uid(), from_tank_id: TANK_D1, to_tank_id: TANK_D2,
    qty_l: qty, doc_date: today(), note: 'تست انتقال'
  });

  assert.strictEqual(r.unit_cost, fromWac, 'بهای منتقل‌شده = بهای تانک مبدا');
  near(r.from_book, fromBefore.book_l - qty, 0.001);
  near(r.to_book, toBefore.book_l + qty, 0.001);

  /* بهای مقصد باید میانگین موزون دوباره محاسبه شود */
  const expected = (toBefore.book_l * toWac + qty * fromWac) / (toBefore.book_l + qty);
  near(r.to_wac, expected, 0.001);

  /* هر دو حرکت به یک سند انتقال وصل‌اند */
  const moves = D.all(`SELECT * FROM stock_move WHERE source_type='transfer' AND source_id=?`, r.id);
  assert.strictEqual(moves.length, 2);
  assert.strictEqual(moves.filter(m => m.direction === 'out').length, 1);
  assert.strictEqual(moves.filter(m => m.direction === 'in').length, 1);

  /* انتقال هیچ فروش یا سودی نمی‌سازد */
  const mm = D.get(`SELECT COUNT(*) c FROM money_move WHERE source_type='transfer'`).c;
  assert.strictEqual(mm, 0, 'انتقال هیچ حرکت پولی نمی‌سازد');
});

test('۶ — انتقال بیش از موجودی رد می‌شود و هیچ چیز ثبت نمی‌گردد', async () => {
  const before = await call('GET', '/tanks/' + TANK_D2);
  const movesBefore = D.get(`SELECT COUNT(*) c FROM stock_move`).c;

  await fails(() => call('POST', '/transfers', {
    idem_key: uid(), from_tank_id: TANK_D2, to_tank_id: TANK_D1,
    qty_l: before.book_l + 1, doc_date: today()
  }), /موجودی تانک مبدا کافی نیست/);

  assert.strictEqual((await call('GET', '/tanks/' + TANK_D2)).book_l, before.book_l);
  assert.strictEqual(D.get(`SELECT COUNT(*) c FROM stock_move`).c, movesBefore,
    'هیچ حرکت موجودی ثبت نشد');
});

test('انتقال به تانک با محصول متفاوت رد می‌شود', async () => {
  await fails(() => call('POST', '/transfers', {
    idem_key: uid(), from_tank_id: TANK_D1, to_tank_id: TANK_P, qty_l: 100
  }), /محصول دو تانک یکی نیست/);
});

test('۲۰ — برگشت انتقال: سند معکوس ساخته می‌شود، سند اصلی حذف نمی‌گردد', async () => {
  const t = await call('POST', '/transfers', {
    idem_key: uid(), from_tank_id: TANK_D1, to_tank_id: TANK_D2, qty_l: 500, doc_date: today()
  });
  const beforeFrom = (await call('GET', '/tanks/' + TANK_D1)).book_l;

  await fails(() => call('POST', '/transfers/' + t.id + '/reverse', { reason: 'کم' }),
    /دلیل برگشت انتقال/);

  const rev = await call('POST', '/transfers/' + t.id + '/reverse',
    { idem_key: uid(), reason: 'مقدار اشتباه وارد شده بود' });

  assert.ok(rev.id > t.id);
  const orig = D.get(`SELECT * FROM tank_transfer WHERE id=?`, t.id);
  assert.strictEqual(orig.status, 'reversed', 'سند اصلی حذف نشد، فقط برگشت‌خورده علامت خورد');
  near((await call('GET', '/tanks/' + TANK_D1)).book_l, beforeFrom + 500, 0.001);
});

/* ============================================================
   ۷، ۸، ۱۳ — شفت
   ============================================================ */
let SHIFT_ID;
test('۷ — باز کردن شفت و ثبت قرائت ابتدایی نازل‌ها', async () => {
  const r = await call('POST', '/shifts/open', {
    idem_key: uid(), station_id: ST, operator_id: OPERATOR, float_amount: 5000,
    doc_date: today(),
    nozzles: NZ.map(n => ({ nozzle_id: n.id, opening: 1000 }))
  });
  SHIFT_ID = r.id;
  const s = await call('GET', '/shifts/' + SHIFT_ID);
  assert.strictEqual(s.status, 'open');
  assert.strictEqual(s.readings.length, 4);
  assert.ok(s.readings.every(x => x.price > 0), 'نرخ هر نازل از نرخ‌نامه گرفته شد');
});

test('شفت دوم در همان استیشن باز نمی‌شود', async () => {
  await fails(() => call('POST', '/shifts/open',
    { idem_key: uid(), station_id: ST, operator_id: OPERATOR }), /شفت باز/);
});

/* ============================================================
   ۱۱ و ۱۲ — فروش قرضی مشتری قراردادی
   ============================================================ */
let TICKET_ID;
test('۱۱ — ثبت فروش قرضی از نازل برای موتر مشتری', async () => {
  const balBefore = (await call('GET', '/parties/' + CUSTOMER + '/ledger')).balance;
  const r = await call('POST', '/credit-tickets', {
    idem_key: uid(), shift_id: SHIFT_ID, party_id: CUSTOMER, vehicle_id: VEHICLE,
    nozzle_id: NZ.find(n => n.tank_id === TANK_D1).id,
    qty_l: 200, unit_price: 73, ticket_no: 'TK-1'
  });
  TICKET_ID = r.id;
  assert.strictEqual(r.amount, 14600);
  assert.strictEqual(r.balance, balBefore + 14600, 'طلب مشتری همان لحظه زیاد شد');
});

test('۱۲ — فروش قرضی هیچ حرکت موجودی نمی‌سازد (شمارش دوگانه رخ نمی‌دهد)', async () => {
  const c = D.get(`SELECT COUNT(*) c FROM stock_move WHERE source_type='credit_ticket'`).c;
  assert.strictEqual(c, 0, 'لیتر بلیت قبلاً در کنتور نازل حساب شده است');
});

test('فروش قرضی بیش از سقف اعتبار بدون اجازه رد می‌شود', async () => {
  await fails(() => call('POST', '/credit-tickets', {
    idem_key: uid(), shift_id: SHIFT_ID, party_id: CUSTOMER, vehicle_id: VEHICLE,
    qty_l: 100000, unit_price: 73, product_id: PROD_D
  }), /سقف اعتبار/);
});

/* ============================================================
   ۹ و ۱۰ — تغییر نرخ وسط شفت
   ============================================================ */
test('۹ — نقطه کنترل نرخ: ریدینگ همه نازل‌های آن محصول لازم است', async () => {
  const impact = await call('GET', '/shifts/' + SHIFT_ID + '/price-impact', null,
    { product_id: PROD_D });
  assert.strictEqual(impact.nozzles.length, 2, 'دو نازل دیزل دارد');
  assert.strictEqual(impact.current_price, 73);

  await fails(() => call('POST', '/shifts/' + SHIFT_ID + '/price-checkpoint', {
    idem_key: uid(), product_id: PROD_D, new_price: 76,
    readings: [{ nozzle_id: impact.nozzles[0].nozzle_id, reading: 1500 }]
  }), /ریدینگ فعلی نازل/);

  const r = await call('POST', '/shifts/' + SHIFT_ID + '/price-checkpoint', {
    idem_key: uid(), product_id: PROD_D, new_price: 76,
    readings: impact.nozzles.map(n => ({ nozzle_id: n.nozzle_id, reading: 1500 })),
    note: 'نرخ رسمی جدید'
  });
  assert.strictEqual(r.old_price, 73);
  assert.strictEqual(r.new_price, 76);
});

test('۱۰ — نقطه کنترل دوم در همان شفت', async () => {
  const impact = await call('GET', '/shifts/' + SHIFT_ID + '/price-impact', null,
    { product_id: PROD_D });
  assert.strictEqual(impact.current_price, 76, 'نرخ جاری همان نرخ نقطه کنترل قبلی است');
  assert.ok(impact.nozzles.every(n => n.last_boundary === 1500), 'مرز جدید ثبت شده');

  await fails(() => call('POST', '/shifts/' + SHIFT_ID + '/price-checkpoint', {
    idem_key: uid(), product_id: PROD_D, new_price: 74,
    readings: impact.nozzles.map(n => ({ nozzle_id: n.nozzle_id, reading: 1400 }))
  }), /از عدد قبلی/);

  const r = await call('POST', '/shifts/' + SHIFT_ID + '/price-checkpoint', {
    idem_key: uid(), product_id: PROD_D, new_price: 74,
    readings: impact.nozzles.map(n => ({ nozzle_id: n.nozzle_id, reading: 1800 }))
  });
  assert.strictEqual(r.old_price, 76);
  assert.strictEqual(D.get(`SELECT COUNT(*) c FROM price_checkpoint WHERE shift_id=?`, SHIFT_ID).c, 2);
});

/* ============================================================
   ۲ — برگشت معامله در صورت خطا (هیچ حالت نیمه‌ثبت‌شده)
   ============================================================ */
test('۲ — اگر بستن شفت وسط کار خطا بدهد، هیچ چیز ثبت نمی‌شود', async () => {
  const movesBefore = D.get(`SELECT COUNT(*) c FROM stock_move`).c;
  const moneyBefore = D.get(`SELECT COUNT(*) c FROM money_move`).c;
  const segBefore = D.get(`SELECT COUNT(*) c FROM nozzle_segment`).c;

  /* نازل آخر ریدینگ ندارد — خطا بعد از پردازش نازل‌های قبلی رخ می‌دهد */
  await fails(() => call('POST', '/shifts/' + SHIFT_ID + '/close', {
    idem_key: uid(),
    readings: NZ.slice(0, 3).map(n => ({ nozzle_id: n.id, closing: 2000 })),
    cash_counted: 1000
  }), /ریدینگ اخیر نازل/);

  assert.strictEqual(D.get(`SELECT COUNT(*) c FROM stock_move`).c, movesBefore);
  assert.strictEqual(D.get(`SELECT COUNT(*) c FROM money_move`).c, moneyBefore);
  assert.strictEqual(D.get(`SELECT COUNT(*) c FROM nozzle_segment`).c, segBefore);
  assert.strictEqual(D.get(`SELECT status FROM shift WHERE id=?`, SHIFT_ID).status, 'open',
    'شفت باز ماند');
  const nz = D.get(`SELECT closing FROM nozzle_reading WHERE shift_id=? LIMIT 1`, SHIFT_ID);
  assert.strictEqual(nz.closing, null, 'هیچ ریدینگی نیمه‌ثبت نشد');
});

/* ============================================================
   ۷، ۸، ۱۳ — بستن شفت با چرخش کنتور، نقاط نرخ، نقده و قرضی
   ============================================================ */
let CLOSE;
test('۷ + ۸ + ۱۳ — بستن شفت: تقسیم نرخ، چرخش کنتور، تسویه نقده و قرضی', async () => {
  const dieselNz = NZ.filter(n => n.tank_id === TANK_D1 || n.tank_id === TANK_D2);
  const petrolNz = NZ.filter(n => n.tank_id === TANK_P);

  const readings = [
    /* دیزل: 1000 -> 1500 (@73)، 1500 -> 1800 (@76)، 1800 -> 2000 (@74) */
    ...dieselNz.map(n => ({ nozzle_id: n.id, closing: 2000 })),
    /* پطرول نازل اول: چرخش کنتور — از 1000 به 500 با یک چرخش ۶ رقمی */
    { nozzle_id: petrolNz[0].id, closing: 500, rollovers: 1 },
    { nozzle_id: petrolNz[1].id, closing: 1200, test_return_l: 20 }
  ];

  /* فروش مورد انتظار */
  const dieselAmountPerNozzle = 500 * 73 + 300 * 76 + 200 * 74;   // = 36,500+22,800+14,800
  const dieselTotal = dieselAmountPerNozzle * 2;
  const petrol1Sold = 999500;                                      // چرخش کامل کنتور
  const petrol2Sold = 200 - 20;                                    // منهای برگشت تست
  const petrolTotal = (petrol1Sold + petrol2Sold) * 78;
  const expectedAmount = dieselTotal + petrolTotal;
  const expectedLiters = 1000 * 2 + petrol1Sold + petrol2Sold;

  const tenders = [{ kind: 'bank', amount: 50000 }];
  const ticketTotal = 14600;
  const cashCounted = expectedAmount - 50000 - ticketTotal;

  CLOSE = await call('POST', '/shifts/' + SHIFT_ID + '/close', {
    idem_key: uid(), readings, tenders, cash_counted: cashCounted
  });

  near(CLOSE.total_liters, expectedLiters, 0.01);
  near(CLOSE.total_amount, expectedAmount, 0.01);
  assert.strictEqual(CLOSE.credit_tickets, ticketTotal, 'بلیت‌های قرضی از نقده کم شدند');
  assert.strictEqual(CLOSE.other_tenders, 50000);
  near(CLOSE.cash_expected, cashCounted, 0.01);
  near(CLOSE.cash_variance, 0, 0.01, 'تسویه بسته شد: نقده + بانک + قرضی = فروش');

  /* بخش‌های نرخ ثبت شدند */
  const segs = D.all(`SELECT * FROM nozzle_segment WHERE shift_id=? AND nozzle_id=?`,
    SHIFT_ID, dieselNz[0].id);
  assert.strictEqual(segs.length, 3, 'سه بازه نرخ');
  assert.deepStrictEqual(segs.map(s => s.price), [73, 76, 74]);
  assert.deepStrictEqual(segs.map(s => s.sold_l), [500, 300, 200]);
});

test('۸ — چرخش کنتور درست حساب شد', async () => {
  const petrolNz = NZ.filter(n => n.tank_id === TANK_P);
  const r = D.get(`SELECT sold_l FROM nozzle_reading WHERE shift_id=? AND nozzle_id=?`,
    SHIFT_ID, petrolNz[0].id);
  assert.strictEqual(r.sold_l, 999500, '1,000 -> 500 با یک چرخش ۶ رقمی = 999,500 لیتر');
});

test('۱۲ — لیتر فروش قرضی دوباره از موجودی کم نشد', async () => {
  const shiftOut = D.get(`SELECT COALESCE(SUM(qty_obs),0) v FROM stock_move
    WHERE source_type='shift' AND source_id=? AND direction='out'`, SHIFT_ID).v;
  const nozzleSold = D.get(`SELECT COALESCE(SUM(sold_l),0) v FROM nozzle_reading
    WHERE shift_id=?`, SHIFT_ID).v;
  near(shiftOut, nozzleSold, 0.01,
    'خروج موجودی دقیقاً برابر فروش کنتور است — نه یک لیتر بیشتر بابت بلیت قرضی');
});

/* ============================================================
   محافظت از اشتباه تایپی در ریدینگ کنتور
   عدد کمتر از قبلی نباید بی‌صدا به «چرخش کنتور» تعبیر شود —
   یک تایپ اشتباه به ~۱،۰۰۰،۰۰۰ لیتر تبدیل می‌شد.
   ============================================================ */
test('ریدینگ کمتر از عدد قبلی بدون تایید چرخش رد می‌شود', async () => {
  const live = await call('GET', '/nozzles', null, { station_id: ST });
  const base = Math.max(5000, ...live.map(n => N(n.last_reading))) + 1000;
  const op = (await call('GET', '/parties', null, { kind: 'employee' }))[0].id;
  const s = await call('POST', '/shifts/open', {
    idem_key: uid(), station_id: ST, operator_id: op,
    nozzles: live.map(n => ({ nozzle_id: n.id, opening: base }))
  });

  await fails(() => call('POST', '/shifts/' + s.id + '/close', {
    idem_key: uid(),
    readings: live.map((n, i) => ({ nozzle_id: n.id, closing: i === 0 ? base - 1000 : base + 1000 })),
    cash_counted: 0
  }), /کمتر است/);

  /* با تایید صریح چرخش، قبول می‌شود */
  const r = await call('POST', '/shifts/' + s.id + '/close', {
    idem_key: uid(),
    readings: live.map((n, i) => ({
      nozzle_id: n.id, closing: i === 0 ? base - 1000 : base + 1000, rollovers: i === 0 ? 1 : 0
    })),
    cash_counted: 0
  });
  assert.ok(r.total_liters > 999000, 'چرخش تاییدشده باید حساب شود');
});

/* شفت تازه روی آخرین ریدینگ واقعی هر نازل باز می‌شود */
async function openShiftHere(extra) {
  const op = (await call('GET', '/parties', null, { kind: 'employee' }))[0].id;
  const live = await call('GET', '/nozzles', null, { station_id: ST });
  return call('POST', '/shifts/open', Object.assign({
    idem_key: uid(), station_id: ST, operator_id: op,
    nozzles: live.map(n => ({ nozzle_id: n.id, opening: n.last_reading }))
  }, extra || {}));
}

test('ریدینگ بزرگ‌تر از ظرفیت کنتور رد می‌شود', async () => {
  const live = await call('GET', '/nozzles', null, { station_id: ST });
  const s = await openShiftHere();
  /* کنتور ۶ رقمی: 15001500 غیرممکن است — تایپ اشتباه */
  await fails(() => call('POST', '/shifts/' + s.id + '/close', {
    idem_key: uid(),
    readings: live.map((n, i) => ({
      nozzle_id: n.id, closing: i === 0 ? 15001500 : n.last_reading
    })),
    cash_counted: 0
  }), /از ظرفیت کنتور/);

  await call('POST', '/shifts/' + s.id + '/close', {
    idem_key: uid(),
    readings: live.map(n => ({ nozzle_id: n.id, closing: n.last_reading })),
    cash_counted: 0
  });
});

test('نقطه کنترل نرخ هم ریدینگ غیرممکن را رد می‌کند', async () => {
  const live = await call('GET', '/nozzles', null, { station_id: ST });
  const s = await openShiftHere();
  const im = await call('GET', '/shifts/' + s.id + '/price-impact', null, { product_id: PROD_D });

  await fails(() => call('POST', '/shifts/' + s.id + '/price-checkpoint', {
    idem_key: uid(), product_id: PROD_D, new_price: 80,
    readings: im.nozzles.map(n => ({ nozzle_id: n.nozzle_id, reading: 15001500 }))
  }), /از ظرفیت کنتور/);

  await fails(() => call('POST', '/shifts/' + s.id + '/price-checkpoint', {
    idem_key: uid(), product_id: PROD_D, new_price: 80,
    readings: im.nozzles.map(n => ({ nozzle_id: n.nozzle_id, reading: '' }))
  }), /ریدینگ فعلی نازل/);

  await call('POST', '/shifts/' + s.id + '/close', {
    idem_key: uid(),
    readings: live.map(n => ({ nozzle_id: n.id, closing: n.last_reading })),
    cash_counted: 0
  });
});

test('شفت بسته دوباره بسته نمی‌شود', async () => {
  await fails(() => call('POST', '/shifts/' + SHIFT_ID + '/close',
    { idem_key: uid(), readings: [], cash_counted: 0 }), /قبلاً بسته شده/);
});

/* ============================================================
   ۱۹ — اسعار
   ============================================================ */
test('۱۹ — معامله به دالر: نرخ تاریخی روی سند می‌ماند', async () => {
  await call('POST', '/fx', { ccy: 'USD', rate: 70, rate_date: today() });

  const before = (await call('GET', '/parties/' + SUPPLIER + '/ledger')).balance;
  await call('POST', '/payments', {
    idem_key: uid(), station_id: ST, party_id: SUPPLIER, direction: 'pay',
    amount: 1000, currency: 'USD', method: 'hawala', doc_date: today()
  });
  const after = (await call('GET', '/parties/' + SUPPLIER + '/ledger')).balance;
  assert.strictEqual(after - before, 70000, '۱۰۰۰ دالر × ۷۰ = ۷۰,۰۰۰ افغانی');

  const mm = D.get(`SELECT * FROM money_move WHERE source_type='payment' AND account='payable'
                    ORDER BY id DESC LIMIT 1`);
  assert.strictEqual(mm.currency, 'USD');
  assert.strictEqual(mm.amount, 1000);
  assert.strictEqual(mm.fx_rate, 70);
  assert.strictEqual(mm.amount_base, 70000);

  /* نرخ فردا تغییر می‌کند — سند دیروز نباید تکان بخورد */
  await call('POST', '/fx', { ccy: 'USD', rate: 90, rate_date: Jalali.addDaysGreg(today(), 1) });
  const again = D.get(`SELECT * FROM money_move WHERE id=?`, mm.id);
  assert.strictEqual(again.amount_base, 70000, 'نرخ تاریخی سند تغییر نکرد');
  assert.strictEqual((await call('GET', '/parties/' + SUPPLIER + '/ledger')).balance, after);
});

test('اسعار بدون نرخ ثبت‌شده رد می‌شود', async () => {
  await fails(() => call('POST', '/expenses', {
    idem_key: uid(), station_id: ST, category: 'کرایه', amount: 100, currency: 'EUR'
  }), /نرخ EUR ثبت نشده است/);
});

/* ============================================================
   ۲۰ — برگشت فروش عمده
   ============================================================ */
test('۲۰ — فروش عمده و برگشت آن', async () => {
  const t = await call('GET', '/tanks/' + TANK_D2);
  const sale = await call('POST', '/bulk', {
    idem_key: uid(), station_id: ST, tank_id: TANK_D2, customer_id: CUSTOMER,
    qty_obs: 3000, unit_price: 72, payment_kind: 'cash', doc_date: today(),
    temp_c: 25, density15: 0.84, invoice_no: 'INV-1'
  });
  assert.strictEqual(sale.amount, 216000);
  near((await call('GET', '/tanks/' + TANK_D2)).book_l, t.book_l - 3000, 0.001);

  const rev = await call('POST', '/bulk/' + sale.id + '/reverse',
    { idem_key: uid(), reason: 'مشتری تیل را پس آورد' });
  assert.ok(rev.id);
  assert.strictEqual(D.get(`SELECT status FROM bulk_sale WHERE id=?`, sale.id).status, 'reversed');
  near((await call('GET', '/tanks/' + TANK_D2)).book_l, t.book_l, 0.001, 'موجودی برگشت');

  /* اثر پولی صفر شد */
  const net = D.get(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_base
      ELSE -amount_base END),0) v FROM money_move
    WHERE account='sales' AND source_type='bulk_sale'
      AND source_id IN (?,?)`, sale.id, rev.id).v;
  assert.strictEqual(net, 0, 'فروش و برگشت همدیگر را خنثی کردند');
});

test('فروش عمده بیش از موجودی رد می‌شود', async () => {
  const t = await call('GET', '/tanks/' + TANK_P);
  await fails(() => call('POST', '/bulk', {
    idem_key: uid(), station_id: ST, tank_id: TANK_P, qty_obs: t.book_l + 1000,
    unit_price: 78, payment_kind: 'cash'
  }), /موجودی تانک کافی نیست/);
});

/* ============================================================
   ۱۶ — صلاحیت
   ============================================================ */
test('۱۶ — اپراتور نمی‌تواند موجودی را تعدیل کند و دیپ‌زن نمی‌تواند شفت ببندد', async () => {
  await call('POST', '/users', {
    username: 'op1', full_name: 'اپراتور تست', role: 'operator', pin: '4321', station_id: ST
  });
  await call('POST', '/users', {
    username: 'dip1', full_name: 'دیپ‌زن تست', role: 'dipper', pin: '4321', station_id: ST
  });
  const op = await call('POST', '/auth/login', { username: 'op1', pin: '4321' }, {}, '');
  const dp = await call('POST', '/auth/login', { username: 'dip1', pin: '4321' }, {}, '');

  await fails(() => call('POST', '/stock/adjust',
    { tank_id: TANK_D1, qty: -50, reason: 'تست' }, {}, op.token), /صلاحیت کافی ندارید/);
  await fails(() => call('POST', '/prices',
    { product_id: PROD_D, price: 100 }, {}, op.token), /صلاحیت کافی ندارید/);
  await fails(() => call('POST', '/shifts/open',
    { station_id: ST, operator_id: OPERATOR }, {}, dp.token), /صلاحیت کافی ندارید/);
  await fails(() => call('POST', '/backup/now', {}, {}, op.token), /صلاحیت کافی ندارید/);

  /* دیپ‌زن باید بتواند دیپ بزند */
  const r = await call('POST', '/dips',
    { idem_key: uid(), tank_id: TANK_D1, dip_mm: 1200, temp_c: 25 }, {}, dp.token);
  assert.ok(r.id, 'دیپ‌زن دیپ ثبت کرده می‌تواند');
});

test('کاربر محدود به یک استیشن به استیشن دیگر دسترسی ندارد', async () => {
  await call('POST', '/stations', { code: 'ST02', name: 'استیشن دوم' });
  const st2 = (await call('GET', '/stations')).find(x => x.code === 'ST02').id;
  const op = await call('POST', '/auth/login', { username: 'op1', pin: '4321' }, {}, '');
  await fails(() => call('POST', '/shifts/open',
    { station_id: st2, operator_id: OPERATOR }, {}, op.token), /دسترسی ندارید/);
});

/* ============================================================
   ۲۱ — بکاپ
   ============================================================ */
let BACKUP_FILE;
test('۲۱ — گرفتن بکاپ', async () => {
  const r = await call('POST', '/backup/now', { note: 'تست' });
  BACKUP_FILE = r.file;
  assert.ok(fs.existsSync(BACKUP_FILE), 'فایل بکاپ ساخته شد');
  assert.ok(r.size_bytes > 4096, 'فایل خالی نیست');

  const st = await call('GET', '/backup');
  assert.ok(st.last_at, 'وقت آخرین بکاپ ثبت شد');
  assert.ok(st.files.some(f => f.path === BACKUP_FILE), 'در فهرست بکاپ‌ها دیده می‌شود');
});

test('۲۲ — کنترل سلامت بکاپ: فایل سالم قبول، فایل خراب رد', async () => {
  const good = await call('POST', '/backup/validate', { file: BACKUP_FILE });
  assert.strictEqual(good.ok, true, good.problems.join('؛ '));
  assert.ok(good.info.users > 0);
  assert.ok(good.info.schema_version >= 18);

  const bad = path.join(TMP, 'garbage.db');
  fs.writeFileSync(bad, Buffer.alloc(8192, 7));
  const r = await call('POST', '/backup/validate', { file: bad });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.length > 0);

  await fails(() => call('POST', '/backup/restore', { file: bad, confirm: true }),
    /سالم نیست/);

  const missing = await call('POST', '/backup/validate', { file: path.join(TMP, 'nope.db') });
  assert.strictEqual(missing.ok, false);
  assert.deepStrictEqual(missing.problems, ['فایل یافت نشد']);
});

/* ============================================================
   ۱۴ و ۱۵ — بستن روز و ثبت با تاریخ گذشته
   ============================================================ */
let DAYCLOSE_ID;
test('۱۴ — بستن روز', async () => {
  const st = await call('GET', '/day-close', null, { station_id: ST, date: today() });
  assert.strictEqual(st.closed, false);
  assert.strictEqual(st.can_close, true, 'شفت بازی نمانده');

  const r = await call('POST', '/day-close', { idem_key: uid(), station_id: ST, doc_date: today() });
  DAYCLOSE_ID = r.id;
  assert.ok(r.total_liters > 0);
  assert.strictEqual(r.credit_amount, 14600, 'فروش قرضی امروز در سند روز آمد');

  const st2 = await call('GET', '/day-close', null, { station_id: ST, date: today() });
  assert.strictEqual(st2.closed, true);

  await fails(() => call('POST', '/day-close',
    { idem_key: uid(), station_id: ST, doc_date: today() }), /قبلاً بسته شده/);
});

test('۱۵ — بعد از بستن روز: کاربر عادی رد، مدیر با دلیل اجباری', async () => {
  const op = await call('POST', '/auth/login', { username: 'op1', pin: '4321' }, {}, '');
  await fails(() => call('POST', '/dips',
    { tank_id: TANK_D1, dip_mm: 1100, doc_date: today() }, {}, op.token),
    /صلاحیت کافی ندارید|بسته شده است/);

  /* مالک بدون دلیل هم نمی‌تواند */
  await fails(() => call('POST', '/expenses', {
    idem_key: uid(), station_id: ST, category: 'برق', amount: 500, doc_date: today()
  }), /دلیل ثبت با تاریخ گذشته/);

  const alertsBefore = D.get(`SELECT COUNT(*) c FROM alert WHERE code='BACKDATE_AFTER_CLOSE'`).c;
  const r = await call('POST', '/expenses', {
    idem_key: uid(), station_id: ST, category: 'برق', amount: 500, doc_date: today(),
    backdate_reason: 'رسید برق دیر رسید و باید در همان روز ثبت شود'
  });
  assert.ok(r.id, 'با دلیل ثبت شد');
  assert.ok(D.get(`SELECT COUNT(*) c FROM alert WHERE code='BACKDATE_AFTER_CLOSE'`).c > alertsBefore,
    'هشدار BACKDATE_AFTER_CLOSE ساخته شد');
  const e = D.get(`SELECT backdate_reason FROM expense WHERE id=?`, r.id);
  assert.match(e.backdate_reason, /رسید برق/, 'دلیل روی خود سند ماند');
});

test('باز کردن دوباره روز بسته‌شده: فقط مالک، با دلیل و هشدار', async () => {
  await fails(() => call('POST', '/day-close/' + DAYCLOSE_ID + '/reopen', { reason: 'x' }),
    /دلیل باز کردن دوباره روز/);
  await call('POST', '/day-close/' + DAYCLOSE_ID + '/reopen',
    { reason: 'سند فراموش‌شده باید اضافه شود' });
  assert.strictEqual(D.get(`SELECT status FROM day_close WHERE id=?`, DAYCLOSE_ID).status, 'reopened');
  assert.ok(D.get(`SELECT COUNT(*) c FROM alert WHERE code='DAY_REOPENED'`).c > 0);

  /* حالا دوباره سند عادی ثبت می‌شود */
  const r = await call('POST', '/expenses',
    { idem_key: uid(), station_id: ST, category: 'قرطاسیه', amount: 200, doc_date: today() });
  assert.ok(r.id);
});

/* ============================================================
   دفتر تغییرناپذیر و ثبت وقایع
   ============================================================ */
test('هیچ سند مالی یا موجودی حذف نمی‌شود', async () => {
  const rows = D.all(`SELECT name FROM sqlite_master WHERE type='trigger'`);
  assert.ok(Array.isArray(rows));
  /* اسناد برگشت‌خورده هنوز در دیتابیس‌اند */
  assert.ok(D.get(`SELECT COUNT(*) c FROM bulk_sale WHERE status='reversed'`).c > 0);
  assert.ok(D.get(`SELECT COUNT(*) c FROM tank_transfer WHERE status='reversed'`).c > 0);
});

test('هر عمل مهم در ثبت وقایع ثبت شده است', async () => {
  const acts = D.all(`SELECT DISTINCT action FROM audit_log`).map(r => r.action);
  for (const a of ['ثبت تخلیه', 'انتقال تیل بین تانک', 'بستن شفت', 'ثبت فروش قرضی',
    'تغییر نرخ در شفت جاری', 'بستن روز', 'گرفتن بکاپ', 'ثبت با تاریخ بسته‌شده'])
    assert.ok(acts.indexOf(a) >= 0, 'در ثبت وقایع نیست: ' + a);
});

/* ============================================================
   ۲۲ — برگرداندن بکاپ (آخرین تست — دیتابیس عوض می‌شود)
   ============================================================ */
test('۲۲ — برگرداندن بکاپ: داده بعد از بکاپ می‌رود، بکاپ اضطراری ساخته می‌شود', async () => {
  /* یک سند جدید بعد از بکاپ */
  const marker = 'MARKER-' + Date.now();
  await call('POST', '/parties', { kind: 'customer', name: marker });
  assert.ok(D.get(`SELECT id FROM party WHERE name=?`, marker), 'قبل از برگرداندن موجود است');

  await fails(() => call('POST', '/backup/restore', { file: BACKUP_FILE }), /باید تایید کنید/);

  const r = await call('POST', '/backup/restore', { file: BACKUP_FILE, confirm: true });
  assert.strictEqual(r.ok, true);
  assert.ok(fs.existsSync(r.emergency_backup), 'بکاپ اضطراری قبل از برگرداندن گرفته شد');

  assert.strictEqual(D.get(`SELECT id FROM party WHERE name=?`, marker), undefined,
    'داده بعد از بکاپ برگشت خورد');
  assert.ok(D.get(`SELECT COUNT(*) c FROM stock_move`).c > 0, 'داده قبلی سر جایش است');
  assert.strictEqual(D.get(`SELECT COUNT(*) c FROM session`).c, 0,
    'همه نشست‌ها بسته شد — کاربران دوباره وارد شوند');
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { } });
