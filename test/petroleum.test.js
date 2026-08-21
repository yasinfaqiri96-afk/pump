'use strict';
/* تست محاسبات نفتی — بدون دیتابیس، بدون وابستگی بیرونی.
   اجرا:  node --test test/ */
const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/js/shared/petroleum.js');

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps),
  'انتظار ' + b + ' ولی ' + a + ' آمد');

/* ---------------- ۱۷. یکسان‌سازی واحد ثقلت ---------------- */
test('normDensity — kg/m³ و kg/L هر دو به kg/L تبدیل می‌شوند', () => {
  assert.strictEqual(P.normDensity(0.84), 0.84);
  assert.strictEqual(P.normDensity(840), 0.84);
  assert.strictEqual(P.normDensity(745), 0.745);
  assert.strictEqual(P.normDensity(0.745), 0.745);
  assert.strictEqual(P.normDensity(0), 0);
  assert.strictEqual(P.normDensity(-5), 0);
  assert.strictEqual(P.normDensity('abc'), 0);
  assert.strictEqual(P.normDensity(2.5), 0, 'خارج از محدوده فرآورده نفتی');
  assert.strictEqual(P.normDensity(5000), 0, 'خارج از محدوده');
});

/* ---------------- ۱۷. تصحیح حرارت ---------------- */
test('VCF دیزل — مقدار مرجع ASTM D1250', () => {
  /* ρ15 = 840 kg/m³، دیزل: α = 186.9696/840² + 0.4862/840 = 0.00084379 /°C
     در 30°C:  VCF = exp(−α·15·(1+0.8·α·15)) = 0.9872964 */
  const v = P.vcf(0.84, 30, 'diesel');
  near(v, 0.9872964, 1e-6);
  assert.ok(v < 1, 'گرم‌تر از ۱۵ درجه یعنی حجم بیشتر، پس ضریب کمتر از ۱');
});

test('VCF پطرول — ضریب انبساط بزرگ‌تر از دیزل است', () => {
  const gas = P.vcf(0.745, 30, 'gasoline');
  const dsl = P.vcf(0.84, 30, 'diesel');
  assert.ok(gas < dsl, 'پطرول سبک‌تر است پس بیشتر منبسط می‌شود');
  near(gas, 0.98168, 5e-4);
});

test('VCF در ۱۵ درجه دقیقاً ۱ است', () => {
  assert.strictEqual(P.vcf(0.84, 15, 'diesel'), 1);
  assert.strictEqual(P.vcf(0.745, 15, 'gasoline'), 1);
});

test('VCF سردتر از ۱۵ درجه بزرگ‌تر از ۱ است', () => {
  assert.ok(P.vcf(0.84, 5, 'diesel') > 1);
});

test('VCF با ورودی kg/m³ همان نتیجه kg/L را می‌دهد', () => {
  assert.strictEqual(P.vcf(840, 30, 'diesel'), P.vcf(0.84, 30, 'diesel'));
});

test('VCF بدون ثقلت یا برای گاز مایع = ۱', () => {
  assert.strictEqual(P.vcf(0, 40, 'diesel'), 1);
  assert.strictEqual(P.vcf(0.54, 40, 'lpg'), 1);
  assert.strictEqual(P.vcf(0.84, 40, 'none'), 1);
  assert.strictEqual(P.vcf(0.84, NaN, 'diesel'), 1, 'حرارت نامعتبر نباید محاسبه را خراب کند');
});

/* ---------------- ۱۸. لیتر ↔ تُن متریک ---------------- */
test('تبدیل لیتر ۱۵ درجه به تُن متریک', () => {
  /* 10,000 L @ 0.84 kg/L  ->  10000 × (0.84 − 0.0011) / 1000 = 8.389 MT */
  near(P.toMT(10000, 0.84), 8.389, 1e-6);
});

test('تبدیل تُن به لیتر و برگشت — رفت و برگشت باید بسته شود', () => {
  const mt = 30;
  const l15 = P.mtToV15(mt, 0.84);
  near(P.toMT(l15, 0.84), mt, 1e-4);
});

test('تبدیل تُن با ورودی kg/m³ نتیجه یکسان می‌دهد — باگ ۱۰۰۰ برابر رفع شد', () => {
  assert.strictEqual(P.toMT(10000, 840), P.toMT(10000, 0.84));
  assert.strictEqual(P.mtToV15(8.389, 840), P.mtToV15(8.389, 0.84));
});

test('تبدیل تُن بدون ثقلت = صفر (نه NaN)', () => {
  assert.strictEqual(P.toMT(10000, 0), 0);
  assert.strictEqual(P.mtToV15(10, 0), 0);
});

/* ---------------- حجم مشاهده‌ای -> ۱۵ درجه ---------------- */
test('زنجیره کامل: حجم مشاهده‌ای -> لیتر ۱۵ -> تُن', () => {
  const obs = 20000, d15 = 0.84, temp = 32;
  const v15 = P.toV15(obs, d15, temp, 'diesel');
  assert.ok(v15 < obs, 'تیل گرم بیشتر جا می‌گیرد، پس حجم ۱۵ درجه کمتر است');
  const mt = P.toMT(v15, d15);
  near(mt, v15 * (d15 - 0.0011) / 1000, 1e-6);
  /* کسری ناشی از حرارت روی ۲۰ هزار لیتر در ۳۲ درجه حدود ۳۰۰ لیتر است */
  assert.ok(obs - v15 > 200 && obs - v15 < 400, 'اختلاف حرارتی در محدوده منطقی: ' + (obs - v15));
});

test('ثقلت مشاهده‌ای به ثقلت ۱۵ درجه', () => {
  const d15 = P.densityTo15(0.83, 30, 'diesel');
  assert.ok(d15 > 0.83, 'ثقلت در ۱۵ درجه بیشتر از ثقلت گرم است');
  near(d15, 0.84, 0.005);
  assert.strictEqual(P.densityTo15(830, 30, 'diesel'), P.densityTo15(0.83, 30, 'diesel'));
});

/* ---------------- جدول سنجش ---------------- */
const CHART = (() => {
  const c = [];
  for (let mm = 0; mm <= 2000; mm += 10) c.push({ dip_mm: mm, volume_l: 60000 * mm / 2000 });
  return c;
})();

test('دیپ به حجم — درون‌یابی خطی', () => {
  assert.strictEqual(P.dipToVolume(CHART, 0), 0);
  near(P.dipToVolume(CHART, 1000), 30000, 1e-3);
  near(P.dipToVolume(CHART, 1005), 30150, 1e-3, 'بین دو نقطه جدول');
  assert.strictEqual(P.dipToVolume(CHART, 5000), 60000, 'بالاتر از جدول = آخرین نقطه');
  assert.strictEqual(P.dipToVolume([], 100), null, 'بدون جدول سنجش نتیجه‌ای نیست');
});

test('حجم به دیپ — عکس عملیات بالا', () => {
  near(P.volumeToDip(CHART, 30000), 1000, 0.2);
  assert.strictEqual(P.volumeToDip(CHART, 0), 0);
});

/* ---------------- ۸. چرخش کنتور نازل ---------------- */
test('فروش نازل — حالت عادی', () => {
  near(P.nozzleSold(1000, 1500, 6, 0, 0, 1), 500);
});

test('فروش نازل — چرخش کنتور (rollover)', () => {
  /* کنتور ۶ رقمی: از 999,500 به 000,300 چرخیده = ۸۰۰ لیتر */
  near(P.nozzleSold(999500, 300, 6, 0, 0, 1), 800);
});

test('فروش نازل — دو بار چرخش', () => {
  near(P.nozzleSold(999500, 300, 6, 2, 0, 1), 1000800);
});

test('فروش نازل — کسر برگشت تست و ضریب کالیبراسیون', () => {
  near(P.nozzleSold(1000, 1520, 6, 0, 20, 1), 500, 1e-6);
  near(P.nozzleSold(1000, 1500, 6, 0, 0, 1.002), 501, 1e-6);
});

/* ---------------- کسری ---------------- */
test('محاسبه کسری تانک', () => {
  const v = P.variance(9800, 10000, 0);
  assert.strictEqual(v.qty, -200);
  assert.strictEqual(v.pct, -2);
  assert.strictEqual(P.variance(100, 0, 0).pct, 0, 'تقسیم بر صفر نشود');
});
