/* هسته: حالت، ارتباط با سرور، قالب‌بندی، مسیریاب، اجزای مشترک */
(function () {
  'use strict';

  /* ---------------- حالت ---------------- */
  const S = window.S = {
    token: localStorage.getItem('pump_token') || '',
    user: null,
    meta: null,
    stationId: Number(localStorage.getItem('pump_station') || 0) || null,
    faDigits: localStorage.getItem('pump_fa_digits') === '1',
    navMode: localStorage.getItem('pump_nav_mode') === 'side' ? 'side' : 'top'
  };

  /* ---------------- حالت منو: افقی (top) یا کناری (side) ---------------- */
  function applyNavMode() { document.body.dataset.navMode = S.navMode; }
  window.applyNavMode = applyNavMode;

  function setNavMode(mode) {
    S.navMode = mode === 'side' ? 'side' : 'top';
    localStorage.setItem('pump_nav_mode', S.navMode);
    applyNavMode();
    const app = document.getElementById('app');
    if (app) app.dataset.route = '';   /* اسکلت دوباره ساخته شود */
    render();
  }
  window.setNavMode = setNavMode;
  applyNavMode();

  /* ---------------- ارتباط ---------------- */
  async function api(method, path, body, query) {
    let url = '/api' + path;
    if (query) {
      const qs = Object.keys(query)
        .filter(k => query[k] !== undefined && query[k] !== null && query[k] !== '')
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
      if (qs) url += '?' + qs;
    }
    const res = await fetch(url, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { 'x-token': S.token } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (_) { }
    if (!res.ok) {
      if (res.status === 401 && S.token) { logout(true); }
      throw new Error(data.error || 'خطا در ارتباط با سرور');
    }
    return data;
  }
  window.api = api;
  window.API = {
    get: (p, q) => api('GET', p, null, q),
    post: (p, b) => api('POST', p, b),
    put: (p, b) => api('PUT', p, b)
  };

  /* ---------------- قالب‌بندی ---------------- */
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  function fa(s) {
    if (s === null || s === undefined) return '';
    if (!S.faDigits) return String(s);
    return String(s).replace(/[0-9]/g, d => FA[+d]);
  }
  function toLatin(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/[۰-۹]/g, d => String(FA.indexOf(d)))
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/,/g, '');
  }
  function n(v, dec) {
    const x = Number(toLatin(v));
    if (!isFinite(x)) return dec ? fa((0).toFixed(dec)) : fa('0');
    const s = dec !== undefined
      ? x.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : Math.round(x).toLocaleString('en-US');
    return fa(s);
  }
  /* لیتر: بدون اعشار اضافی */
  function L(v) {
    const x = Number(toLatin(v)) || 0;
    return fa((Math.abs(x) < 1000 ? x.toFixed(2).replace(/\.?0+$/, '') : Math.round(x).toLocaleString('en-US')));
  }
  function money(v) { return n(v, 0); }
  function pct(v) { const x = Number(toLatin(v)) || 0; return fa(x.toFixed(2)) + '%'; }
  function num(v, d) { const x = Number(toLatin(v)); return isFinite(x) ? x : (d === undefined ? 0 : d); }

  function sh(iso) { return iso ? fa(Jalali.toShamsi(iso)) : '—'; }
  function shLong(iso) { return iso ? fa(Jalali.longShamsi(Jalali.toShamsi(iso))) : '—'; }
  function dt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    return fa(Jalali.toShamsi(iso.slice(0, 10)) + '  ' + hh + ':' + mm);
  }
  function timeOf(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return fa(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }
  Object.assign(window, { fa, toLatin, n, L, money, pct, num, sh, shLong, dt, timeOf });

  /* ---------------- HTML ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function h(strings, ...vals) {
    return strings.reduce((a, s, i) => a + s + (i < vals.length ? (vals[i] === null || vals[i] === undefined ? '' : vals[i]) : ''), '');
  }
  window.esc = esc; window.h = h;

  /* ---------------- توست ---------------- */
  function toast(msg, kind) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts no-print'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, kind === 'err' ? 5200 : 2800);
  }
  window.toast = toast;
  window.ok = m => toast(m, 'ok');
  window.err = m => toast(m, 'err');

  /* ---------------- شیت ---------------- */
  function sheet(title, bodyHtml, opts) {
    opts = opts || {};
    close();
    const ov = document.createElement('div');
    ov.className = 'overlay no-print';
    ov.innerHTML = h`
      <div class="sheet ${opts.wide ? 'wide' : ''}">
        <div class="sheet-head">
          <div class="section-title">${esc(title)}</div>
          <button class="btn-icon" data-close>✕</button>
        </div>
        <div class="sheet-body">${bodyHtml}</div>
      </div>`;
    ov.addEventListener('click', e => { if (e.target === ov || e.target.hasAttribute('data-close')) close(); });
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    const first = ov.querySelector('input:not([readonly]),select,textarea');
    if (first) setTimeout(() => first.focus(), 60);
    if (opts.onMount) opts.onMount(ov);
    return ov;
  }
  function close() {
    if (window.jdClose) window.jdClose();
    document.querySelectorAll('.overlay').forEach(o => o.remove());
    document.body.style.overflow = '';
  }
  window.sheet = sheet; window.closeSheet = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  async function confirmBox(title, text, danger) {
    return new Promise(resolve => {
      const ov = sheet(title, h`
        <div class="stack">
          <div class="body-1">${esc(text)}</div>
          <div class="row" style="justify-content:flex-end">
            <button class="btn-ghost" data-no>انصراف</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>تایید</button>
          </div>
        </div>`);
      ov.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
      ov.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
    });
  }
  window.confirmBox = confirmBox;

  /* ---------------- اجزای مشترک ---------------- */
  const UI = window.UI = {
    empty(text, actionHtml) {
      return h`<div class="empty">
        <div class="dots"><i></i><i></i><i></i></div>
        <div class="empty-t">${esc(text || 'موردی یافت نشد')}</div>
        ${actionHtml || ''}
      </div>`;
    },
    loading(text) {
      return h`<div class="empty">
        <div class="dots"><i></i><i></i><i></i></div>
        <div class="empty-t">${esc(text || 'در حال بارگذاری')}</div>
      </div>`;
    },
    stat(num, label, sub, cls) {
      return h`<div class="card stat">
        <div class="stat-num ${cls || ''}">${num}</div>
        <div class="stat-lbl">${esc(label)}</div>
        ${sub ? h`<div class="stat-sub">${sub}</div>` : ''}
      </div>`;
    },
    field(label, inner, hint) {
      return h`<div class="field"><label>${esc(label)}</label>${inner}
        ${hint ? h`<div class="field-hint">${hint}</div>` : ''}</div>`;
    },
    /* فیلد عددی عمداً type=text است تا ارقام فارسی (۱۲۳) هم پذیرفته شود.
       تبدیل به لاتین در readForm انجام می‌گیرد. */
    input(name, opts) {
      opts = opts || {};
      const isNum = opts.type === 'number';
      const t = isNum ? 'text' : (opts.type || 'text');
      let v = opts.value;
      if (v === undefined || v === null) v = '';
      else if (isNum && v !== '') v = fa(v);
      return h`<input class="input ${opts.cls || ''}" name="${name}" type="${t}"
        value="${esc(v)}" placeholder="${esc(opts.ph || '')}"
        ${opts.readonly ? 'readonly' : ''} ${isNum ? 'data-num inputmode="decimal"' : ''}
        ${opts.attrs || ''}>`;
    },
    select(name, options, value, opts) {
      opts = opts || {};
      const o = options.map(x =>
        h`<option value="${esc(x.v)}" ${String(x.v) === String(value) ? 'selected' : ''}>${esc(x.t)}</option>`).join('');
      return h`<select class="input ${opts.cls || ''}" name="${name}" ${opts.attrs || ''}>
        ${opts.blank ? h`<option value="">${esc(opts.blank)}</option>` : ''}${o}</select>`;
    },
    chip(text, kind) { return h`<span class="chip chip-${kind || 'mint'}">${esc(text)}</span>`; },
    banner(kind, text) { return h`<div class="banner banner-${kind}"><div>${text}</div></div>`; },
    card(title, body, actions) {
      return h`<div class="card stack">
        ${title ? h`<div class="row-b"><div class="card-title">${esc(title)}</div>${actions || ''}</div>` : ''}
        ${body}</div>`;
    },
    /* تاریخ شمسی — با تقویم بازشو (کلیک روی فیلد یا آیکن) */
    dateField(label, name, isoValue) {
      const s = isoValue ? Jalali.toShamsi(isoValue) : Jalali.todayShamsi();
      return h`<div class="field"><label>${esc(label)}</label>
        <div class="jdate">
          <input class="input" name="${name}" data-jdate value="${fa(s)}" placeholder="1405-05-29"
            autocomplete="off" inputmode="numeric">
          <button type="button" class="jdate-ico" data-jopen tabindex="-1">${ICON('calendar', 20)}</button>
        </div>
        <div class="field-hint" data-jhint>${esc(fa(Jalali.longShamsi(s)))}</div></div>`;
    }
  };

  /* فورم: خواندن مقادیر با تبدیل ارقام فارسی و تاریخ شمسی */
  window.readForm = function (root) {
    const out = {};
    root.querySelectorAll('input,select,textarea').forEach(el => {
      if (!el.name) return;
      if (el.type === 'checkbox') { out[el.name] = el.checked; return; }
      let v = el.value;
      if (el.hasAttribute('data-jdate')) {
        const lat = toLatin(v).trim();
        try { out[el.name] = lat ? Jalali.toGregorian(lat) : ''; }
        catch (_) { out[el.name] = ''; }
        return;
      }
      if (el.type === 'number' || el.hasAttribute('data-num')) { out[el.name] = toLatin(v).trim(); return; }
      out[el.name] = v;
    });
    return out;
  };

  /* ارقام فارسی داخل input عددی */
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el.matches || !el.matches('input')) return;
    if (el.hasAttribute('data-jdate')) {
      const box = el.closest('.field') || el.parentElement;
      const hint = box && box.querySelector('[data-jhint]');
      if (hint) {
        try {
          const v = toLatin(el.value).trim();
          hint.textContent = /^\d{4}-\d{1,2}-\d{1,2}$/.test(v) ? fa(Jalali.longShamsi(v)) : 'تاریخ نامعتبر';
        } catch (_) { hint.textContent = 'تاریخ نامعتبر'; }
      }
    }
  });

  /* ---------------- تقویم شمسی بازشو ---------------- */
  const JP = { box: null, input: null, y: 0, m: 0 };

  function pad2(x) { return x < 10 ? '0' + x : '' + x; }

  function jdParse(v) {
    const t = toLatin(v || '').trim();
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d };
  }

  /* تعداد روزهای ماه شمسی + شماره ستون روز اول (ستون ۰ = شنبه) */
  function jdMonthInfo(y, m) {
    const r = Jalali.shamsiMonthRange(y, m);
    const p = r.from.split('-');
    const wd = new Date(+p[0], +p[1] - 1, +p[2]).getDay();   /* ۰ = یکشنبه */
    return { days: r.days, offset: (wd + 1) % 7 };
  }

  function jdRender() {
    const info = jdMonthInfo(JP.y, JP.m);
    const cur = jdParse(JP.input.value);
    const t = jdParse(Jalali.todayShamsi());

    let cells = '';
    for (let i = 0; i < info.offset; i++) cells += '<i class="jd-x"></i>';
    for (let d = 1; d <= info.days; d++) {
      const on = cur && cur.y === JP.y && cur.m === JP.m && cur.d === d;
      const td = t.y === JP.y && t.m === JP.m && t.d === d;
      cells += h`<button type="button" class="jd-d ${on ? 'on' : ''} ${td ? 'today' : ''}"
        data-jd="${d}">${fa(d)}</button>`;
    }

    let years = '';
    for (let y = t.y - 80; y <= t.y + 15; y++)
      years += h`<option value="${y}" ${y === JP.y ? 'selected' : ''}>${fa(y)}</option>`;
    const months = Jalali.MONTHS.map((nm, i) =>
      h`<option value="${i + 1}" ${i + 1 === JP.m ? 'selected' : ''}>${esc(nm)}</option>`).join('');
    const wdays = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(x => h`<i>${x}</i>`).join('');

    JP.box.innerHTML = h`
      <div class="jd-head">
        <button type="button" class="jd-nav" data-jnav="-1">${ICON('forward', 18)}</button>
        <select class="jd-sel" data-jm>${months}</select>
        <select class="jd-sel" data-jy>${years}</select>
        <button type="button" class="jd-nav" data-jnav="1">${ICON('back', 18)}</button>
      </div>
      <div class="jd-wd">${wdays}</div>
      <div class="jd-grid">${cells}</div>
      <div class="jd-foot">
        <button type="button" class="jd-act" data-jtoday>امروز</button>
        <button type="button" class="jd-act" data-jclear>پاک کردن</button>
      </div>`;
  }

  function jdPlace() {
    const r = JP.input.getBoundingClientRect(), b = JP.box;
    const bh = b.offsetHeight, bw = b.offsetWidth;
    let top = r.bottom + 6;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 6);
    let left = r.right - bw;                       /* راست‌چین با فیلد (RTL) */
    if (left + bw > window.innerWidth - 8) left = window.innerWidth - bw - 8;
    if (left < 8) left = 8;
    b.style.top = top + 'px';
    b.style.left = left + 'px';
  }

  function jdOpen(input) {
    jdClose();
    const cur = jdParse(input.value) || jdParse(Jalali.todayShamsi());
    JP.input = input; JP.y = cur.y; JP.m = cur.m;
    const box = document.createElement('div');
    box.className = 'jd no-print';
    document.body.appendChild(box);
    JP.box = box;
    jdRender();
    jdPlace();
    box.addEventListener('change', e => {
      const sel = e.target;
      if (sel.hasAttribute('data-jy')) JP.y = Number(sel.value);
      else if (sel.hasAttribute('data-jm')) JP.m = Number(sel.value);
      else return;
      jdRender(); jdPlace();
    });
  }

  function jdClose() {
    if (JP.box) JP.box.remove();
    JP.box = null; JP.input = null;
  }
  window.jdClose = jdClose;

  function jdShift(step) {
    let m = JP.m + step, y = JP.y;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    JP.y = y; JP.m = m;
    jdRender(); jdPlace();
  }

  function jdSet(y, m, d) {
    const days = Jalali.shamsiMonthRange(y, m).days;
    if (d > days) d = days;
    JP.input.value = fa(y + '-' + pad2(m) + '-' + pad2(d));
    JP.input.dispatchEvent(new Event('input', { bubbles: true }));
    JP.input.dispatchEvent(new Event('change', { bubbles: true }));
    jdClose();
  }

  document.addEventListener('click', e => {
    const tgt = e.target;
    if (!tgt.closest) return;

    /* داخل تقویم */
    if (JP.box && JP.box.contains(tgt)) {
      const day = tgt.closest('[data-jd]');
      if (day) { jdSet(JP.y, JP.m, Number(day.dataset.jd)); return; }
      const nav = tgt.closest('[data-jnav]');
      if (nav) { jdShift(Number(nav.dataset.jnav)); return; }
      if (tgt.closest('[data-jtoday]')) {
        const t = jdParse(Jalali.todayShamsi());
        jdSet(t.y, t.m, t.d); return;
      }
      if (tgt.closest('[data-jclear]')) {
        JP.input.value = '';
        JP.input.dispatchEvent(new Event('input', { bubbles: true }));
        jdClose(); return;
      }
      return;
    }

    /* باز کردن */
    const ico = tgt.closest('[data-jopen]');
    if (ico) {
      e.preventDefault();
      const inp = ico.parentElement.querySelector('[data-jdate]');
      if (inp) { inp.focus(); jdOpen(inp); }
      return;
    }
    const inp = tgt.closest('input[data-jdate]');
    if (inp) { jdOpen(inp); return; }

    jdClose();
  });

  /* Esc تقویم را ببندد، نه شیت زیرش را */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && JP.box) { e.stopImmediatePropagation(); jdClose(); }
  }, true);

  window.addEventListener('resize', jdClose);
  window.addEventListener('scroll', jdClose, true);

  /* ---------------- ورود / خروج ---------------- */
  async function logout(silent) {
    try { if (S.token) await api('POST', '/auth/logout', {}); } catch (_) { }
    S.token = ''; S.user = null;
    localStorage.removeItem('pump_token');
    if (!silent) location.hash = '';
    render();
  }
  window.logout = logout;

  /* ---------------- مسیریاب ---------------- */
  const ROUTES = window.ROUTES = {};
  window.page = function (key, def) { ROUTES[key] = def; };

  function currentRoute() {
    const raw = (location.hash || '#/').replace(/^#/, '');
    const [p, qs] = raw.split('?');
    const parts = p.split('/').filter(Boolean);
    const q = {};
    (qs || '').split('&').filter(Boolean).forEach(kv => {
      const [k, v] = kv.split('=');
      q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { key: parts[0] || 'dashboard', param: parts[1] ? decodeURIComponent(parts[1]) : null, q };
  }
  window.currentRoute = currentRoute;
  window.go = function (hash) { location.hash = hash; };

  const NAV = window.NAV = [
    { key: 'dashboard', label: 'خانه', cap: 'read', icon: 'home' },
    { key: 'tanks', label: 'تانک‌ها', cap: 'read', icon: 'tank' },
    { key: 'dip', label: 'دیپ', cap: 'dip', icon: 'ruler' },
    { key: 'shifts', label: 'شفت', cap: 'shift', icon: 'clock' },
    { key: 'receipts', label: 'ورود تیل', cap: 'ops', icon: 'truck' },
    { key: 'bulk', label: 'فروش عمده', cap: 'ops', icon: 'out' },
    { key: 'parties', label: 'مشتریان', cap: 'ops', icon: 'users' },
    { key: 'prices', label: 'نرخ‌نامه', cap: 'read', icon: 'tag' },
    { key: 'expenses', label: 'مصارف', cap: 'finance', icon: 'wallet' },
    { key: 'reports', label: 'راپورها', cap: 'report', icon: 'chart' },
    { key: 'alerts', label: 'هشدارها', cap: 'read', icon: 'bell' },
    { key: 'setup', label: 'تنظیمات', cap: 'read', icon: 'gear' }
  ];

  const BNAV = [
    { key: 'dashboard', label: 'خانه', icon: 'home' },
    { key: 'tanks', label: 'تانک‌ها', icon: 'tank' },
    { key: 'dip', label: 'دیپ', icon: 'ruler' },
    { key: 'alerts', label: 'هشدار', icon: 'bell' },
    { key: 'more', label: 'بیشتر', icon: 'menu' }
  ];

  function can(cap) { return S.user && (S.user.caps || []).indexOf(cap) >= 0; }
  window.can = can;

  /* ---------------- اسکلت ---------------- */
  function shell(routeKey) {
    const links = NAV.filter(x => can(x.cap))
      .map(x => h`<button class="navlink ${x.key === routeKey ? 'active' : ''}" data-nav="${x.key}">${ICON(x.icon, 20)}<span>${esc(x.label)}</span></button>`).join('');
    const bn = BNAV.map(x =>
      h`<button class="${x.key === routeKey ? 'on' : ''}" data-nav="${x.key}">${ICON(x.icon, 24)}<span>${esc(x.label)}</span></button>`).join('');

    const stationOpts = (S.meta ? S.meta.stations : []).map(s =>
      h`<option value="${s.id}" ${String(S.stationId) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

    return h`
      <header class="hdr no-print">
        <div class="hdr-1">
          <div class="logo" data-nav="dashboard" style="cursor:pointer">
            ${LOGO()}
            <div>
              <div class="logo-fa">پمپ استیشن</div>
              <div class="logo-en">PUMP STATION</div>
            </div>
          </div>
          <div class="search">
            ${ICON('search', 24)}
            <input id="globalSearch" placeholder="جستجوی تانک، نازل، مشتری، بارنامه، پلیت…">
          </div>
          <div class="far-side">
            <select class="input" id="stationPick" style="max-width:190px">
              ${(S.meta && S.meta.stations.length > 1) ? '<option value="">همه استیشن‌ها</option>' : ''}
              ${stationOpts}
            </select>
            <button class="btn-ghost" data-navmode
              title="${S.navMode === 'side' ? 'منوی افقی زیر هدر' : 'منوی کناری در کنارهٔ صفحه'}">
              ${ICON(S.navMode === 'side' ? 'rows' : 'sidebar', 16)}
            </button>
            <button class="btn-ghost" data-menu>
              ${ICON('user', 16)}<span>${esc(S.user ? S.user.full_name : '')}</span>
            </button>
          </div>
        </div>
        <div class="hdr-2">
          ${links}
          <div class="search search-mobile">
            ${ICON('search', 24)}
            <input id="globalSearchM" placeholder="جستجوی تانک، نازل، مشتری، بارنامه، پلیت…">
          </div>
        </div>
      </header>
      <div class="shell" id="view"></div>
      <button class="fab no-print" id="fab" title="ثبت سریع دیپ">${ICON('plus', 32)}</button>
      <nav class="bnav no-print">${bn}</nav>`;
  }

  /* ---------------- آیکون‌ها (خطی، تک‌رنگ) ---------------- */
  function ICON(name, size) {
    const s = size || 24;
    const P = {
      home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
      tank: '<rect x="4" y="6" width="16" height="14" rx="4"/><path d="M4 13c3 1.6 5 1.6 8 0s5-1.6 8 0"/><path d="M9 3h6"/>',
      ruler: '<path d="M12 3v18"/><path d="M9 6h3M9 10h3M9 14h3M9 18h3"/><rect x="8" y="3" width="8" height="18" rx="2"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      truck: '<path d="M2 7h11v9H2z"/><path d="M13 10h4l4 3v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
      out: '<path d="M4 7h10v10H4z"/><path d="M14 12h6"/><path d="m17 9 3 3-3 3"/>',
      users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 8.5a3 3 0 0 0 0-1"/><path d="M17 14c2.5.6 4 2.6 4 6"/>',
      tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
      wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="17" cy="14" r="1.4"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      bell: '<path d="M18 15V10a6 6 0 1 0-12 0v5l-2 3h16z"/><path d="M10 21h4"/>',
      gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M17.5 9h2M17.5 12h2"/>',
      rows: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M6.5 12h3M11.5 12h3"/>',
      print: '<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 16h10v5H7z"/>',
      back: '<path d="M15 5l-7 7 7 7"/>',
      forward: '<path d="M9 5l7 7-7 7"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
      check: '<path d="m5 13 4 4 10-10"/>',
      alert: '<path d="M12 4 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
      money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>',
      drop: '<path d="M12 3s6 6.6 6 10.5A6 6 0 0 1 6 13.5C6 9.6 12 3 12 3z"/>'
    };
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  }
  window.ICON = ICON;

  function LOGO() {
    return `<svg viewBox="0 0 40 40" fill="none" stroke="#0B8457" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round">
      <rect x="6" y="9" width="17" height="24" rx="3"/>
      <path d="M6 17h17"/>
      <path d="M23 15h4l4 4v11a2.5 2.5 0 0 1-5 0V22h-3"/>
      <path d="M11 24h7"/></svg>`;
  }

  /* ---------------- رندر ---------------- */
  let rendering = false;
  async function render() {
    if (rendering) return;
    rendering = true;
    try {
      const app = document.getElementById('app');

      if (!S.token) { app.innerHTML = ''; document.body.style.overflow = ''; window.LoginPage(app); return; }

      if (!S.user) {
        try {
          const me = await api('GET', '/auth/me');
          S.user = me.user;
        } catch (_) { S.token = ''; localStorage.removeItem('pump_token'); rendering = false; return render(); }
      }
      if (!S.meta) {
        S.meta = await api('GET', '/meta');
        if (!S.stationId && S.meta.stations.length === 1) S.stationId = S.meta.stations[0].id;
      }

      const r = currentRoute();
      if (!app.querySelector('.hdr') || app.dataset.route !== r.key) {
        app.innerHTML = shell(r.key);
        app.dataset.route = r.key;
        bindShell();
      } else {
        app.querySelectorAll('[data-nav]').forEach(b => {
          if (b.classList.contains('navlink')) b.classList.toggle('active', b.dataset.nav === r.key);
          if (b.parentElement && b.parentElement.classList.contains('bnav')) b.classList.toggle('on', b.dataset.nav === r.key);
        });
      }

      const view = document.getElementById('view');
      const def = ROUTES[r.key];
      if (!def) { view.innerHTML = h`<div class="pad">${UI.empty('این صفحه وجود ندارد')}</div>`; return; }
      view.innerHTML = h`<div class="pad">${UI.loading()}</div>`;
      try { await def(view, r); }
      catch (e) {
        view.innerHTML = h`<div class="pad section"><div class="card">
          ${UI.banner('error', esc(e.message))}</div></div>`;
      }
    } finally { rendering = false; }
  }
  window.render = render;

  function bindShell() {
    const app = document.getElementById('app');
    app.addEventListener('click', e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) {
        if (nav.dataset.nav === 'more') return openMore();
        go('#/' + nav.dataset.nav);
        return;
      }
      if (e.target.closest('[data-navmode]')) return setNavMode(S.navMode === 'side' ? 'top' : 'side');
      if (e.target.closest('[data-menu]')) return openMenu();
    });
    const pick = document.getElementById('stationPick');
    if (pick) pick.onchange = () => {
      S.stationId = pick.value ? Number(pick.value) : null;
      if (S.stationId) localStorage.setItem('pump_station', S.stationId);
      else localStorage.removeItem('pump_station');
      render();
    };
    const fab = document.getElementById('fab');
    if (fab) fab.onclick = () => {
      if (window.QuickDip) window.QuickDip();
      else go('#/dip');
    };
    ['globalSearch', 'globalSearchM'].forEach(id => {
      const gs = document.getElementById(id);
      if (gs) gs.addEventListener('keydown', e => {
        if (e.key === 'Enter' && gs.value.trim()) go('#/search?q=' + encodeURIComponent(gs.value.trim()));
      });
    });
  }

  function openMore() {
    const items = NAV.filter(x => can(x.cap)).map(x =>
      h`<button class="drow clickable" data-go="${x.key}" style="width:100%;border:0;text-align:start">
          <div class="tank-icon" style="width:36px;height:36px">${ICON(x.icon, 18)}</div>
          <div class="drow-main"><div class="drow-t">${esc(x.label)}</div></div>
        </button>`).join('');
    const ov = sheet('منو', h`<div class="stack-s">${items}</div>`);
    ov.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { closeSheet(); go('#/' + b.dataset.go); });
  }

  function openMenu() {
    const u = S.user;
    const ov = sheet('حساب کاربری', h`
      <div class="stack">
        <div class="card card-flat stack-s">
          <div class="card-title">${esc(u.full_name)}</div>
          <div class="muted">${esc(u.username)} — ${esc(u.role_name)}</div>
        </div>
        <div class="row-b">
          <span class="muted">اعداد فارسی</span>
          <button class="btn-ghost ${S.faDigits ? 'on' : ''}" data-digits>${S.faDigits ? 'روشن' : 'خاموش'}</button>
        </div>
        <div class="row-b">
          <span class="muted">حالت منو</span>
          <div class="segs">
            <button class="seg ${S.navMode === 'top' ? 'on' : ''}" data-navset="top">${ICON('rows', 18)}<span>افقی</span></button>
            <button class="seg ${S.navMode === 'side' ? 'on' : ''}" data-navset="side">${ICON('sidebar', 18)}<span>کناری</span></button>
          </div>
        </div>
        <button class="btn btn-primary btn-block" data-logout>خروج از سیستم</button>
      </div>`);
    ov.querySelectorAll('[data-navset]').forEach(b => b.onclick = () => {
      closeSheet(); setNavMode(b.dataset.navset);
    });
    ov.querySelector('[data-digits]').onclick = () => {
      S.faDigits = !S.faDigits;
      localStorage.setItem('pump_fa_digits', S.faDigits ? '1' : '0');
      closeSheet(); render();
    };
    ov.querySelector('[data-logout]').onclick = () => { closeSheet(); logout(); };
  }

  /* ---------------- صفحه ورود ---------------- */
  window.LoginPage = function (app) {
    app.innerHTML = h`
      <div class="login-wrap">
        <div class="login-split">
          <div class="login-brand">
            ${LOGO().replace('stroke="#0B8457"', 'stroke="#ffffff"').replace('viewBox', 'width="64" height="64" viewBox')}
            <div class="b-fa">پمپ استیشن</div>
            <div class="b-en">PUMP STATION</div>
          </div>
          <form id="loginForm" class="login-form">
            <div>
              <div class="section-title">ورود به سیستم</div>
              <div class="muted" style="margin-top:.35rem">سیستم مدیریت تانک تیل و پمپ استیشن</div>
            </div>
            ${UI.field('نام کاربری', UI.input('username', { ph: 'admin', attrs: 'autocomplete=username' }))}
            ${UI.field('پین', h`<input class="input pin-input" name="pin" type="password" inputmode="numeric" placeholder="••••">`)}
            <div id="loginErr"></div>
            <div class="spacer"></div>
            <div class="muted-s">اگر پین را فراموش کرده‌اید، به مدیر سیستم مراجعه کنید.</div>
            <button class="btn btn-primary btn-block" type="submit">ورود</button>
          </form>
        </div>
      </div>`;
    const f = document.getElementById('loginForm');
    f.onsubmit = async ev => {
      ev.preventDefault();
      const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'در حال ورود…';
      try {
        const d = readForm(f);
        const r = await api('POST', '/auth/login', { username: d.username, pin: toLatin(d.pin) });
        S.token = r.token; S.user = r.user; S.meta = null;
        localStorage.setItem('pump_token', r.token);
        if (r.user.station_id) { S.stationId = r.user.station_id; localStorage.setItem('pump_station', r.user.station_id); }
        location.hash = '#/dashboard';
        render();
      } catch (e) {
        document.getElementById('loginErr').innerHTML = UI.banner('error', esc(e.message));
        btn.disabled = false; btn.textContent = 'ورود';
      }
    };
    f.querySelector('[name=username]').focus();
  };

  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', render);
})();
