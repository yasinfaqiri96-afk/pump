/* تبدیل تاریخ هجری شمسی <-> میلادی — بدون وابستگی
   یک منبع مشترک برای سرور و مرورگر. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Jalali = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {

  var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  function jalCal(jy) {
    var bl = breaks.length, gy = jy + 621, leapJ = -14, jp = breaks[0];
    var jm, jump = 0, leap, leapG, march, n, i;
    if (jy < jp || jy >= breaks[bl - 1]) throw new Error('سال خارج از محدوده: ' + jy);
    for (i = 1; i < bl; i += 1) {
      jm = breaks[i]; jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
      + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j, i, gd, gm, gy;
    j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    i = div(mod(j, 1461), 4) * 5 + 308;
    gd = div(mod(i, 153), 5) + 1;
    gm = mod(div(i, 153), 12) + 1;
    gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy), jdn1f = g2d(gy, 3, r.march), jd, jm, k;
    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy: jy, jm: jm, jd: jd }; }
      else k -= 186;
    } else {
      jy -= 1; k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30); jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  var MONTHS = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله',
    'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'];
  var WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* "YYYY-MM-DD" میلادی  ->  "YYYY-MM-DD" شمسی */
  function toShamsi(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    var j = d2j(g2d(+p[0], +p[1], +p[2]));
    return j.jy + '-' + pad2(j.jm) + '-' + pad2(j.jd);
  }

  /* "YYYY-MM-DD" شمسی  ->  "YYYY-MM-DD" میلادی */
  function toGregorian(sh) {
    if (!sh) return '';
    var p = String(sh).slice(0, 10).split('-');
    var g = d2g(j2d(+p[0], +p[1], +p[2]));
    return g.gy + '-' + pad2(g.gm) + '-' + pad2(g.gd);
  }

  function todayShamsi() {
    var d = new Date();
    var j = d2j(g2d(d.getFullYear(), d.getMonth() + 1, d.getDate()));
    return j.jy + '-' + pad2(j.jm) + '-' + pad2(j.jd);
  }

  function todayGregorian() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* "۱۴۰۵ سرطان ۱۲" */
  function longShamsi(sh) {
    if (!sh) return '';
    var p = String(sh).slice(0, 10).split('-');
    return p[0] + ' ' + MONTHS[(+p[1]) - 1] + ' ' + (+p[2]);
  }

  function weekdayOf(greg) {
    var p = String(greg).slice(0, 10).split('-');
    var d = new Date(+p[0], (+p[1]) - 1, +p[2]);
    return WEEKDAYS[d.getDay()];
  }

  /* اول و آخر ماه شمسی به میلادی */
  function shamsiMonthRange(jy, jm) {
    var last = (jm <= 6) ? 31 : (jm <= 11 ? 30 : (jalCal(jy).leap === 1 ? 30 : 29));
    return {
      from: toGregorian(jy + '-' + pad2(jm) + '-01'),
      to: toGregorian(jy + '-' + pad2(jm) + '-' + pad2(last)),
      days: last
    };
  }

  function addDaysGreg(iso, n) {
    var p = String(iso).slice(0, 10).split('-');
    var d = new Date(Date.UTC(+p[0], (+p[1]) - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  return {
    toShamsi: toShamsi, toGregorian: toGregorian,
    todayShamsi: todayShamsi, todayGregorian: todayGregorian,
    longShamsi: longShamsi, weekdayOf: weekdayOf,
    shamsiMonthRange: shamsiMonthRange, addDaysGreg: addDaysGreg,
    MONTHS: MONTHS, WEEKDAYS: WEEKDAYS
  };
});
