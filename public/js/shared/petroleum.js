/* محاسبات نفتی — ASTM D1250 / API MPMS 11.1
   یک منبع مشترک برای سرور و مرورگر. هیچ وابستگی. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Petro = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /* ضرایب انبساط حجمی هر گروه محصول */
  var GROUPS = {
    crude: { k0: 613.9723, k1: 0.0, name: 'خام' },
    gasoline: { k0: 346.4228, k1: 0.4388, name: 'پطرول' },
    jet: { k0: 594.5418, k1: 0.0, name: 'تیل خاک / جت' },
    diesel: { k0: 186.9696, k1: 0.4862, name: 'دیزل / فیول اویل' },
    lpg: { k0: 0, k1: 0, name: 'گاز مایع' },
    none: { k0: 0, k1: 0, name: 'بدون تصحیح' }
  };

  function round(v, d) {
    if (v === null || v === undefined || isNaN(v)) return 0;
    var f = Math.pow(10, d === undefined ? 4 : d);
    return Math.round(v * f) / f;
  }

  /* ضریب تصحیح حجم به ۱۵ درجه سانتی‌گراد
     ورودی density15 به kg/لیتر (مثلاً 0.84) — فرمول ASTM با kg/m³ کار می‌کند. */
  function vcf(density15, tempC, group) {
    var g = GROUPS[group] || GROUPS.none;
    if (!density15 || (!g.k0 && !g.k1)) return 1;
    var rho = density15 > 10 ? density15 : density15 * 1000;   // kg/m³
    var alpha = g.k0 / (rho * rho) + g.k1 / rho;               // 1/°C
    var dt = tempC - 15;
    var v = Math.exp(-alpha * dt * (1 + 0.8 * alpha * dt));
    if (!isFinite(v) || v < 0.8 || v > 1.2) return 1;
    return round(v, 7);
  }

  /* حجم مشاهده‌ای -> حجم در ۱۵ درجه */
  function toV15(volObs, density15, tempC, group) {
    return round(volObs * vcf(density15, tempC, group), 4);
  }

  /* حجم ۱۵ درجه -> تُن متریک (با تصحیح وزن در هوا) */
  function toMT(v15, density15) {
    if (!density15) return 0;
    return round(v15 * (density15 - 0.0011) / 1000, 6);
  }

  /* تُن متریک -> حجم در ۱۵ درجه */
  function mtToV15(mt, density15) {
    if (!density15 || density15 <= 0.0011) return 0;
    return round(mt * 1000 / (density15 - 0.0011), 4);
  }

  /* دانسیته مشاهده‌ای -> دانسیته در ۱۵ درجه (حل تکراری) */
  function densityTo15(densObs, tempC, group) {
    if (!densObs) return 0;
    var d = densObs;
    for (var i = 0; i < 25; i++) {
      var f = vcf(d, tempC, group);
      var nd = densObs / f;
      if (Math.abs(nd - d) < 1e-7) { d = nd; break; }
      d = nd;
    }
    return round(d, 5);
  }

  /* دیپ (mm) -> حجم (لیتر) با درون‌یابی خطی روی جدول سنجش تانک
     chart = [{dip_mm, volume_l}, ...] مرتب صعودی */
  function dipToVolume(chart, dipMm) {
    if (!chart || !chart.length) return null;
    if (dipMm <= chart[0].dip_mm) {
      if (dipMm <= 0) return 0;
      // درون‌یابی خطی از صفر تا اولین نقطه
      return round(chart[0].volume_l * (dipMm / (chart[0].dip_mm || 1)), 4);
    }
    var last = chart[chart.length - 1];
    if (dipMm >= last.dip_mm) return round(last.volume_l, 4);
    var lo = 0, hi = chart.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (chart[mid].dip_mm <= dipMm) lo = mid; else hi = mid;
    }
    var a = chart[lo], b = chart[hi];
    var span = b.dip_mm - a.dip_mm;
    if (span === 0) return round(a.volume_l, 4);
    var t = (dipMm - a.dip_mm) / span;
    return round(a.volume_l + t * (b.volume_l - a.volume_l), 4);
  }

  /* حجم (لیتر) -> دیپ (mm) — برای پیش‌بینی و کنترل */
  function volumeToDip(chart, volume) {
    if (!chart || !chart.length) return null;
    if (volume <= 0) return 0;
    var last = chart[chart.length - 1];
    if (volume >= last.volume_l) return last.dip_mm;
    var lo = 0, hi = chart.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (chart[mid].volume_l <= volume) lo = mid; else hi = mid;
    }
    var a = chart[lo], b = chart[hi];
    var span = b.volume_l - a.volume_l;
    if (span === 0) return a.dip_mm;
    return round(a.dip_mm + (volume - a.volume_l) / span * (b.dip_mm - a.dip_mm), 1);
  }

  /* فروش نازل با در نظر گرفتن چرخش کنتور */
  function nozzleSold(opening, closing, digits, rollovers, testReturn, factor) {
    digits = digits || 6;
    rollovers = rollovers || 0;
    testReturn = testReturn || 0;
    factor = factor || 1;
    var raw = closing - opening;
    if (raw < 0) { raw += Math.pow(10, digits); rollovers = Math.max(rollovers, 1); }
    if (rollovers > 1) raw += Math.pow(10, digits) * (rollovers - 1);
    return round((raw - testReturn) * factor, 3);
  }

  /* کسری: فزیکی منهای دفتری */
  function variance(physical, book, inflow) {
    var v = round(physical - book, 3);
    var base = Math.abs(book) + Math.abs(inflow || 0);
    var pct = base > 0 ? round(v / base * 100, 3) : 0;
    return { qty: v, pct: pct };
  }

  return {
    GROUPS: GROUPS, vcf: vcf, toV15: toV15, toMT: toMT, mtToV15: mtToV15,
    densityTo15: densityTo15, dipToVolume: dipToVolume, volumeToDip: volumeToDip,
    nozzleSold: nozzleSold, variance: variance, round: round
  };
});
