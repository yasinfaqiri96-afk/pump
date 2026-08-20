/* صفحات: داشبورد، تانک‌ها، دیپ، شفت */
(function () {
  'use strict';

  const q = () => (S.stationId ? { station_id: S.stationId } : {});

  /* ============================================================
     داشبورد
     ============================================================ */
  page('dashboard', async function (view) {
    const d = await API.get('/reports/dashboard', q());

    const tankCards = d.tanks.length ? d.tanks.map(t => {
      const pct2 = Math.max(0, Math.min(100, t.fill_pct));
      const bar = t.low ? 'var(--secondry-1)' : (t.color || 'var(--prime-1)');
      const varChip = t.last_variance_l === null ? ''
        : (Math.abs(t.last_variance_l) < 0.5 ? UI.chip('بدون کسری', 'mint')
          : UI.chip((t.last_variance_l < 0 ? 'کسری ' : 'ازدیاد ') + L(Math.abs(t.last_variance_l)),
            t.last_variance_l < 0 ? 'red' : 'blue'));
      return h`
        <div class="card tank-card card-hover" data-tank="${t.id}">
          <div class="tank-head">
            <div class="tank-icon" style="background:${t.color}22;color:${t.color}">${ICON('drop', 22)}</div>
            <div class="grow">
              <div class="drow-t">${esc(t.name)}</div>
              <div class="muted-s">${esc(t.product_name)} · ${esc(t.code)}${d.tanks.some(x => x.station_name !== t.station_name) ? ' · ' + esc(t.station_name) : ''}</div>
            </div>
            ${t.low ? UI.chip('سطح پایین', 'red') : UI.chip('فعال', 'mint')}
          </div>
          <div>
            <div class="row-b" style="margin-bottom:.35rem">
              <span class="meta-v">${L(t.book_l)} <span class="muted-s">${esc(t.uom)}</span></span>
              <span class="muted-s">${fa(t.fill_pct)}٪ از ${L(t.capacity_l)}</span>
            </div>
            <div class="tank-gauge"><i style="width:${pct2}%;background:${bar}"></i></div>
          </div>
          <div class="row-b">
            <span class="muted-s">${t.last_dip_at ? 'آخرین دیپ: ' + dt(t.last_dip_at) : 'دیپ ثبت نشده'}</span>
            ${varChip}
          </div>
        </div>`;
    }).join('') : UI.empty('هیچ تانکی ثبت نشده است',
      h`<button class="btn btn-primary" data-go-setup>ثبت اولین تانک</button>`);

    const alerts = d.alerts.length ? d.alerts.slice(0, 5).map(a => h`
      <div class="alert-row">
        <span class="alert-dot sev-${a.severity}"></span>
        <div class="grow">
          <div class="drow-t" style="font-size:.9rem">${esc(a.title)}</div>
          <div class="muted-s">${dt(a.at)}</div>
        </div>
      </div>`).join('<div class="hair"></div>')
      : h`<div class="muted">هیچ هشدار بازی وجود ندارد</div>`;

    const maxAmt = Math.max(1, ...d.last7.map(x => x.amount));
    const hasSales = d.last7.some(x => x.amount > 0);
    const bars = d.last7.map(x => h`
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:.4rem">
        <div class="muted-s nowrap" style="font-size:.7rem">${x.amount ? money(x.amount) : ''}</div>
        <div style="width:100%;height:96px;display:flex;align-items:flex-end;
          background:var(--n-grey-01);border-radius:8px;overflow:hidden">
          <div style="width:100%;height:${x.amount ? Math.max(6, x.amount / maxAmt * 100) : 0}%;
            background:var(--prime-1);border-radius:8px 8px 0 0"></div>
        </div>
        <div class="muted-s nowrap">${fa(x.shamsi.slice(5))}</div>
      </div>`).join('');

    view.innerHTML = h`
      <div class="hero">
        <div>
          <h1>${esc(S.meta.company)}</h1>
          <div class="sub">${esc(d.weekday)} · ${shLong(d.date)}${S.stationId ? ' · ' + esc((S.meta.stations.find(x => x.id === S.stationId) || {}).name || '') : ''}</div>
        </div>
      </div>

      <div class="pad overlap stack">
        <div class="grid-4 keep">
          ${UI.stat(L(d.today_liters), 'فروش امروز (لیتر)')}
          ${UI.stat(money(d.today_amount), 'فروش امروز (' + S.meta.base_currency + ')')}
          ${UI.stat(money(d.cash), 'موجودی صندوق')}
          ${UI.stat(money(d.receivable), 'طلبات از مشتریان', null, d.receivable > 0 ? '' : '')}
        </div>

        ${d.open_shifts.length ? h`<div class="card">
          ${UI.banner('warn', 'شفت باز: ' + d.open_shifts.map(s => esc(s.operator_name) + ' — از ' + timeOf(s.opened_at)).join(' ، ')
        + ' &nbsp; <span class="link" data-go-shifts>رفتن به شفت</span>')}
        </div>` : ''}

        <div class="grid-main">
          <div class="stack">
            <div class="row-b">
              <div class="section-title">تانک‌ها</div>
              <button class="btn-ghost" data-go-tanks>همه تانک‌ها</button>
            </div>
            <div class="grid-2">${tankCards}</div>

            <div class="section">
              <div class="section-title" style="margin-bottom:1rem">فروش هفت روز گذشته</div>
              <div class="card">
                <div style="display:flex;gap:.5rem;align-items:flex-end">${bars}</div>
                ${hasSales ? '' : h`<div class="muted-s txt-c" style="margin-top:.75rem">هنوز شفت بسته‌شده‌ای در این هفت روز نیست</div>`}
              </div>
            </div>
          </div>

          <div class="stack">
            <div class="card stack-s">
              <div class="card-title">نرخ امروز</div>
              <div class="hair"></div>
              ${d.prices.map(p => h`<div class="row-b">
                <span class="body-1">${esc(p.name)}</span>
                <span class="num-strong">${money(p.price)} <span class="muted-s">/ ${esc(p.uom)}</span></span>
              </div>`).join('')}
              <button class="btn btn-primary btn-block" data-go-prices style="margin-top:.5rem">مدیریت نرخ</button>
            </div>

            <div class="card stack-s">
              <div class="row-b">
                <div class="card-title">هشدارها</div>
                ${d.alerts.length ? UI.chip(fa(d.alerts.length), 'red') : ''}
              </div>
              <div class="hair"></div>
              ${alerts}
              ${d.alerts.length ? h`<button class="btn-ghost w-100" data-go-alerts style="justify-content:center;margin-top:.5rem">دیدن همه</button>` : ''}
            </div>

            <div class="card stack-s">
              <div class="card-title">خزانه</div>
              <div class="hair"></div>
              <div class="row-b"><span class="muted">صندوق</span><span class="num-strong">${money(d.cash)}</span></div>
              <div class="row-b"><span class="muted">بانک و حواله</span><span class="num-strong">${money(d.bank)}</span></div>
              <div class="row-b"><span class="muted">طلبات</span><span class="num-strong pos">${money(d.receivable)}</span></div>
              <div class="row-b"><span class="muted">قروض</span><span class="num-strong neg">${money(d.payable)}</span></div>
            </div>
          </div>
        </div>
      </div>`;

    view.querySelectorAll('[data-tank]').forEach(c => c.onclick = () => go('#/tanks/' + c.dataset.tank));
    const map = { 'data-go-tanks': 'tanks', 'data-go-prices': 'prices', 'data-go-alerts': 'alerts', 'data-go-setup': 'setup', 'data-go-shifts': 'shifts' };
    Object.keys(map).forEach(k => view.querySelectorAll('[' + k + ']').forEach(b => b.onclick = () => go('#/' + map[k])));
  });

  /* ============================================================
     تانک‌ها
     ============================================================ */
  page('tanks', async function (view, r) {
    if (r.param) return tankDetail(view, r.param);
    const tanks = await API.get('/tanks', q());
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">تانک‌ها</div>
          ${can('setup') ? h`<button class="btn btn-primary" data-new>تانک جدید</button>` : ''}
        </div>
        ${tanks.length ? h`<div class="grid-3">${tanks.map(tankCard).join('')}</div>`
        : UI.empty('هیچ تانکی ثبت نشده است')}
      </div>`;
    view.querySelectorAll('[data-tank]').forEach(c => c.onclick = () => go('#/tanks/' + c.dataset.tank));
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => window.TankForm();
  });

  function tankCard(t) {
    const pct2 = Math.max(0, Math.min(100, t.fill_pct));
    const bar = t.low ? 'var(--secondry-1)' : (t.color || 'var(--prime-1)');
    return h`
      <div class="card tank-card card-hover" data-tank="${t.id}">
        <div class="tank-head">
          <div class="tank-icon" style="background:${t.color}22;color:${t.color}">${ICON('drop', 22)}</div>
          <div class="grow">
            <div class="drow-t">${esc(t.name)}</div>
            <div class="muted-s">${esc(t.product_name)} · ${esc(t.code)}</div>
          </div>
          ${t.calib_points ? '' : UI.chip('بدون جدول سنجش', 'yellow')}
        </div>
        <div>
          <div class="row-b" style="margin-bottom:.35rem">
            <span class="meta-v">${L(t.book_l)} <span class="muted-s">${esc(t.uom)}</span></span>
            <span class="muted-s">${fa(t.fill_pct)}٪</span>
          </div>
          <div class="tank-gauge"><i style="width:${pct2}%;background:${bar}"></i></div>
        </div>
        <div class="tank-meta">
          <div><div class="meta-k">ظرفیت</div><div class="meta-v">${L(t.capacity_l)}</div></div>
          <div><div class="meta-k">بهای تمام‌شده</div><div class="meta-v">${n(t.wac, 2)}</div></div>
          <div><div class="meta-k">آخرین دیپ</div><div class="meta-v" style="font-size:.8rem">${t.last_dip_at ? sh(t.last_dip_at) : '—'}</div></div>
        </div>
      </div>`;
  }

  async function tankDetail(view, id) {
    const t = await API.get('/tanks/' + id);
    const pct2 = Math.max(0, Math.min(100, t.fill_pct));
    const moves = t.recent_moves.length ? h`
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>تاریخ</th><th>نوع</th><th class="num">ورودی</th><th class="num">خروجی</th><th>شرح</th></tr></thead>
        <tbody>${t.recent_moves.map(m => h`<tr>
          <td>${sh(m.doc_date)}</td>
          <td>${esc(SRC[m.source_type] || m.source_type)}</td>
          <td class="num t-pos">${m.direction === 'in' ? L(m.qty_obs) : '—'}</td>
          <td class="num">${m.direction === 'out' ? L(m.qty_obs) : '—'}</td>
          <td class="muted-s">${esc(m.note || '')}</td>
        </tr>`).join('')}</tbody></table></div>` : h`<div class="muted">حرکتی ثبت نشده</div>`;

    const dips = t.recent_dips.length ? h`
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>وقت</th><th class="num">دیپ</th><th class="num">آب</th><th class="num">خالص</th><th class="num">دفتری</th><th class="num">کسری</th></tr></thead>
        <tbody>${t.recent_dips.map(x => h`<tr>
          <td>${dt(x.read_at)}</td>
          <td class="num">${fa(x.dip_mm)}</td>
          <td class="num">${fa(x.water_mm)}</td>
          <td class="num">${L(x.vol_net_l)}</td>
          <td class="num">${L(x.book_l)}</td>
          <td class="num ${x.variance_l < 0 ? 't-neg' : (x.variance_l > 0 ? 't-pos' : '')}">${L(x.variance_l)}</td>
        </tr>`).join('')}</tbody></table></div>` : h`<div class="muted">دیپی ثبت نشده</div>`;

    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row">
          <button class="btn-icon" data-back>${ICON('back', 18)}</button>
          <div class="section-title">${esc(t.name)}</div>
          ${UI.chip(t.product_name, 'mint')}
        </div>

        <div class="grid-main">
          <div class="stack">
            <div class="card stack">
              <div class="tank-head">
                <div class="tank-icon" style="background:${t.color}22;color:${t.color}">${ICON('drop', 24)}</div>
                <div class="grow">
                  <div class="card-title">${esc(t.code)} — ${esc(t.station_name)}</div>
                  <div class="muted-s">${esc(t.kind)} · ${esc(t.product_name)}</div>
                </div>
              </div>
              <div>
                <div class="row-b" style="margin-bottom:.4rem">
                  <span class="stat-num sm">${L(t.book_l)} <span class="muted-s">${esc(t.uom)}</span></span>
                  <span class="muted-s">${fa(t.fill_pct)}٪ از ${L(t.capacity_l)}</span>
                </div>
                <div class="tank-gauge"><i style="width:${pct2}%;background:${t.low ? 'var(--secondry-1)' : t.color}"></i></div>
              </div>
              <div class="grid-4 keep">
                <div class="stat"><div class="stat-num sm">${L(t.capacity_l)}</div><div class="stat-lbl">ظرفیت</div></div>
                <div class="stat"><div class="stat-num sm">${L(t.dead_stock_l)}</div><div class="stat-lbl">ذخیره مرده</div></div>
                <div class="stat"><div class="stat-num sm">${n(t.wac, 2)}</div><div class="stat-lbl">بهای هر ${esc(t.uom)}</div></div>
                <div class="stat"><div class="stat-num sm">${fa(t.calib_points)}</div><div class="stat-lbl">نقاط سنجش</div></div>
              </div>
            </div>

            <div class="card stack">
              <div class="card-title">آخرین دیپ‌ها</div><div class="hair"></div>${dips}
            </div>

            <div class="card stack">
              <div class="card-title">حرکت موجودی</div><div class="hair"></div>${moves}
            </div>
          </div>

          <div class="stack">
            <div class="card stack-s">
              <div class="card-title">عملیات</div><div class="hair"></div>
              ${can('dip') ? h`<button class="btn btn-primary btn-block" data-dip>ثبت دیپ</button>` : ''}
              ${can('ops') ? h`<button class="btn-ghost w-100" data-recv style="justify-content:center">ثبت تخلیه</button>` : ''}
              ${can('ops') ? h`<button class="btn-ghost w-100" data-adj style="justify-content:center">تعدیل / مصرف جنراتور</button>` : ''}
              ${can('ops') ? h`<button class="btn-ghost w-100" data-tr style="justify-content:center">انتقال به تانک دیگر</button>` : ''}
              <button class="btn-ghost w-100" data-card style="justify-content:center">دفتر موجودی</button>
            </div>
            ${can('setup') ? h`<div class="card stack-s">
              <div class="card-title">جدول سنجش</div><div class="hair"></div>
              <div class="muted-s">${t.calib_points ? fa(t.calib_points) + ' نقطه ثبت شده' : 'ثبت نشده — دیپ کار نمی‌کند'}</div>
              <button class="btn-ghost w-100" data-calib style="justify-content:center">بارگذاری جدول</button>
            </div>` : ''}
          </div>
        </div>
      </div>`;

    view.querySelector('[data-back]').onclick = () => go('#/tanks');
    const on = (sel, fn) => { const e = view.querySelector(sel); if (e) e.onclick = fn; };
    on('[data-dip]', () => window.DipForm(t.id));
    on('[data-recv]', () => go('#/receipts?tank=' + t.id));
    on('[data-adj]', () => window.AdjustForm(t));
    on('[data-tr]', () => window.TransferForm(t));
    on('[data-calib]', () => window.CalibForm(t));
    on('[data-card]', () => go('#/reports?r=stockcard&tank=' + t.id));
  }

  const SRC = window.SRC = {
    opening: 'افتتاحیه', receipt: 'تخلیه', shift: 'فروش شفت', bulk_sale: 'فروش عمده',
    transfer: 'انتقال', adjust: 'تعدیل', genset: 'جنراتور', test_return: 'برگشت تست'
  };

  /* ============================================================
     دیپ
     ============================================================ */
  page('dip', async function (view) {
    const [tanks, dips] = await Promise.all([
      API.get('/tanks', q()),
      API.get('/dips', Object.assign({ limit: 60 }, q()))
    ]);

    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">دیپ و کسری</div>
          ${can('dip') ? h`<button class="btn btn-primary" data-new>ثبت دیپ جدید</button>` : ''}
        </div>

        <div class="grid-3">
          ${tanks.map(t => h`<div class="card card-hover stack-s" data-dip="${t.id}">
            <div class="tank-head">
              <div class="tank-icon" style="background:${t.color}22;color:${t.color}">${ICON('ruler', 20)}</div>
              <div class="grow">
                <div class="drow-t">${esc(t.name)}</div>
                <div class="muted-s">${t.last_dip_at ? 'آخرین: ' + dt(t.last_dip_at) : 'بدون دیپ'}</div>
              </div>
            </div>
            <div class="row-b">
              <span class="muted-s">دفتری</span><span class="num-strong">${L(t.book_l)}</span>
            </div>
            ${t.last_variance_l !== null && t.last_variance_l !== undefined ? h`<div class="row-b">
              <span class="muted-s">آخرین کسری</span>
              <span class="num-strong ${t.last_variance_l < 0 ? 'neg' : 'pos'}">${L(t.last_variance_l)}</span>
            </div>` : ''}
          </div>`).join('')}
        </div>

        <div class="section">
          <div class="section-title" style="margin-bottom:1rem">تاریخچه دیپ</div>
          ${dips.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>وقت</th><th>تانک</th><th class="num">دیپ mm</th><th class="num">آب</th>
              <th class="num">خالص</th><th class="num">دفتری</th><th class="num">کسری</th><th class="num">٪</th><th>دیپ‌زن</th></tr></thead>
            <tbody>${dips.map(x => h`<tr>
              <td>${dt(x.read_at)}</td>
              <td>${esc(x.tank_code)} — ${esc(x.product_name)}</td>
              <td class="num">${fa(x.dip_mm)}</td>
              <td class="num">${fa(x.water_mm)}</td>
              <td class="num">${L(x.vol_net_l)}</td>
              <td class="num">${L(x.book_l)}</td>
              <td class="num ${x.variance_l < 0 ? 't-neg' : (x.variance_l > 0 ? 't-pos' : '')}">${L(x.variance_l)}</td>
              <td class="num ${Math.abs(x.variance_pct) > 0.5 ? 't-neg' : ''}">${pct(x.variance_pct)}</td>
              <td class="muted-s">${esc(x.read_by_name || '')}</td>
            </tr>`).join('')}</tbody></table></div></div>` : UI.empty('هنوز دیپی ثبت نشده')}
        </div>
      </div>`;

    view.querySelectorAll('[data-dip]').forEach(c => c.onclick = () => window.DipForm(Number(c.dataset.dip)));
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => window.DipForm();
  });

  /* فورم دیپ — با پیش‌نمایش زنده */
  window.DipForm = async function (tankId, shiftId, kind) {
    const tanks = await API.get('/tanks', q());
    if (!tanks.length) return err('اول تانک ثبت کنید');
    const sel = tankId || tanks[0].id;

    const ov = sheet('ثبت دیپ', h`
      <form id="dipF" class="stack">
        ${UI.field('تانک', UI.select('tank_id', tanks.map(t => ({ v: t.id, t: t.code + ' — ' + t.name + ' (' + t.product_name + ')' })), sel))}
        <div class="grid-2 keep">
          ${UI.field('دیپ (میلی‌متر)', UI.input('dip_mm', { type: 'number', cls: 'big', ph: '0' }))}
          ${UI.field('دیپ آب (میلی‌متر)', UI.input('water_mm', { type: 'number', value: 0 }))}
        </div>
        <div class="grid-2 keep">
          ${UI.field('درجه حرارت (°C)', UI.input('temp_c', { type: 'number', ph: '25' }))}
          ${UI.field('دانسیته 15°', UI.input('density15', { type: 'number', ph: 'خودکار' }))}
        </div>
        ${UI.field('نوع', UI.select('kind', [
      { v: 'spot', t: 'دیپ عادی' }, { v: 'open', t: 'افتتاحیه شفت' },
      { v: 'close', t: 'اختتامیه شفت' }, { v: 'pre_unload', t: 'قبل تخلیه' },
      { v: 'post_unload', t: 'بعد تخلیه' }], kind || 'spot'))}
        ${UI.field('توضیح', UI.input('note', { ph: 'اختیاری' }))}
        <div id="dipPrev"></div>
        <button class="btn btn-primary btn-block" type="submit">ثبت دیپ</button>
      </form>`);

    const f = ov.querySelector('#dipF');
    let timer = null;
    async function preview() {
      const d = readForm(f);
      if (!d.dip_mm) { document.getElementById('dipPrev').innerHTML = ''; return; }
      try {
        const p = await API.get('/dips/preview', {
          tank_id: d.tank_id, dip_mm: d.dip_mm, water_mm: d.water_mm || 0,
          temp_c: d.temp_c || 15, density15: d.density15 || ''
        });
        const cls = p.over_tolerance ? 'error' : (Math.abs(p.variance_pct) > 0.1 ? 'warn' : 'ok');
        document.getElementById('dipPrev').innerHTML = h`
          <div class="card card-flat stack-s">
            <div class="grid-3 keep">
              <div class="stat"><div class="stat-num sm">${L(p.net)}</div><div class="stat-lbl">حجم خالص</div></div>
              <div class="stat"><div class="stat-num sm">${L(p.book_l)}</div><div class="stat-lbl">موجودی دفتری</div></div>
              <div class="stat"><div class="stat-num sm ${p.variance_l < 0 ? 'neg' : 'pos'}">${L(p.variance_l)}</div><div class="stat-lbl">کسری / ازدیاد</div></div>
            </div>
            <div class="muted-s txt-c">پرشدگی ${fa(p.fill_pct)}٪ · ضریب VCF ${fa(p.vcf)} · حجم 15° ${L(p.vol15)}
              ${p.water > 0 ? ' · آب ' + L(p.water) : ''}</div>
            ${UI.banner(cls, p.over_tolerance
            ? 'کسری ' + pct(p.variance_pct) + ' از تولرانس ' + pct(p.tolerance_pct) + ' گذشته — بعد از ثبت هشدار ایجاد می‌شود.'
            : 'کسری ' + pct(p.variance_pct) + ' — در حد مجاز.')}
          </div>`;
      } catch (e) { document.getElementById('dipPrev').innerHTML = UI.banner('error', esc(e.message)); }
    }
    f.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 220); });
    f.querySelector('[name=tank_id]').addEventListener('change', preview);

    f.onsubmit = async ev => {
      ev.preventDefault();
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const d = readForm(f);
        if (shiftId) d.shift_id = shiftId;
        const r = await API.post('/dips', d);
        closeSheet();
        ok('دیپ ثبت شد — کسری ' + L(r.variance_l) + ' لیتر');
        render();
      } catch (e) { err(e.message); btn.disabled = false; }
    };
  };

  window.QuickDip = () => window.DipForm();

  /* ============================================================
     شفت
     ============================================================ */
  page('shifts', async function (view, r) {
    if (r.param) return shiftDetail(view, r.param);
    const shifts = await API.get('/shifts', Object.assign({ limit: 40 }, q()));
    const open = shifts.filter(s => s.status === 'open');

    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">شفت‌ها</div>
          ${can('shift') && !open.length ? h`<button class="btn btn-primary" data-open>باز کردن شفت</button>` : ''}
        </div>

        ${open.length ? h`<div class="stack">${open.map(s => h`
          <div class="card stack">
            <div class="row-b">
              <div>
                <div class="card-title">شفت باز — ${esc(s.operator_name)}</div>
                <div class="muted-s">${esc(s.station_name)} · از ${dt(s.opened_at)}</div>
              </div>
              ${UI.chip('باز', 'green')}
            </div>
            <div class="row">
              <button class="btn btn-primary" data-close-shift="${s.id}">بستن شفت</button>
              <button class="btn-ghost" data-view="${s.id}">جزئیات</button>
            </div>
          </div>`).join('')}</div>` : ''}

        <div class="section">
          <div class="section-title" style="margin-bottom:1rem">تاریخچه</div>
          ${shifts.filter(s => s.status === 'closed').length ? h`<div class="stack-s">
            ${shifts.filter(s => s.status === 'closed').map(s => h`
              <div class="drow clickable" data-view="${s.id}">
                <div class="drow-part1">
                  <div class="drow-main">
                    <div class="drow-t">${esc(s.operator_name)}</div>
                    <div class="drow-s">${sh(s.doc_date)} · ${timeOf(s.opened_at)} تا ${timeOf(s.closed_at)} · ${esc(s.station_name)}</div>
                  </div>
                </div>
                <div class="drow-part2">
                  <div class="drow-item"><span class="k">لیتر</span><span class="v ">${L(s.total_liters)}</span></div>
                  <div class="drow-item"><span class="k">فروش</span><span class="v ">${money(s.total_amount)}</span></div>
                  <div class="drow-item"><span class="k">کسر صندوق</span><span class="v ${s.cash_variance < 0 ? 'neg' : (s.cash_variance > 0 ? 'pos' : '')}">${money(s.cash_variance)}</span></div>
                </div>
              </div>`).join('')}
          </div>` : UI.empty('شفت بسته‌شده‌ای وجود ندارد')}
        </div>
      </div>`;

    const ob = view.querySelector('[data-open]');
    if (ob) ob.onclick = () => OpenShiftForm();
    view.querySelectorAll('[data-view]').forEach(b => b.onclick = () => go('#/shifts/' + b.dataset.view));
    view.querySelectorAll('[data-close-shift]').forEach(b =>
      b.onclick = e => { e.stopPropagation(); CloseShiftForm(Number(b.dataset.closeShift)); });
  });

  async function OpenShiftForm() {
    const stationId = S.stationId || (S.meta.stations[0] && S.meta.stations[0].id);
    if (!stationId) return err('استیشن را انتخاب کنید');
    const [ops, nozzles] = await Promise.all([
      API.get('/parties', { kind: 'employee' }),
      API.get('/nozzles', { station_id: stationId })
    ]);
    if (!ops.length) return err('اول اپراتور را در بخش مشتریان/کارمندان ثبت کنید');
    if (!nozzles.length) return err('برای این استیشن نازل ثبت نشده است');

    const ov = sheet('باز کردن شفت', h`
      <form id="osF" class="stack">
        ${UI.field('اپراتور', UI.select('operator_id', ops.map(o => ({ v: o.id, t: o.name })), ops[0].id))}
        ${UI.field('صندوق افتتاحیه', UI.input('float_amount', { type: 'number', value: 0 }))}
        ${UI.dateField('تاریخ', 'doc_date')}
        <div class="hair"></div>
        <div class="card-title">قرائت ابتدایی نازل‌ها</div>
        <div class="muted-s">عدد کنتور هر نازل در شروع شفت. پیش‌فرض = آخرین قرائت ثبت‌شده.</div>
        <div class="stack-s">
          ${nozzles.map(nz => h`<div class="row-b card card-flat card-tight">
            <div>
              <div class="drow-t">${esc(nz.dispenser_code)} / ${esc(nz.code)}</div>
              <div class="muted-s">${esc(nz.product_name)} · تانک ${esc(nz.tank_code)}</div>
            </div>
            <input class="input" style="max-width:170px" data-num name="nz_${nz.id}"
              value="${fa(nz.last_reading)}" inputmode="decimal">
          </div>`).join('')}
        </div>
        <button class="btn btn-primary btn-block" type="submit">باز کردن شفت</button>
      </form>`, { wide: true });

    ov.querySelector('#osF').onsubmit = async ev => {
      ev.preventDefault();
      const btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const d = readForm(ev.target);
        const list = nozzles.map(nz => ({ nozzle_id: nz.id, opening: num(d['nz_' + nz.id]) }));
        await API.post('/shifts/open', {
          station_id: stationId, operator_id: d.operator_id,
          float_amount: d.float_amount, doc_date: d.doc_date, nozzles: list
        });
        closeSheet(); ok('شفت باز شد'); render();
      } catch (e) { err(e.message); btn.disabled = false; }
    };
  }

  async function CloseShiftForm(shiftId) {
    const s = await API.get('/shifts/' + shiftId);
    const customers = await API.get('/parties', { kind: 'customer' });

    const ov = sheet('بستن شفت — ' + s.operator_name, h`
      <form id="csF" class="stack">
        <div class="card card-flat stack-s">
          <div class="muted-s">شروع: ${dt(s.opened_at)} · صندوق افتتاحیه: ${money(s.float_amount)}</div>
        </div>

        <div class="card-title">قرائت اخیر نازل‌ها</div>
        <div class="stack-s" id="nzRows">
          ${s.readings.map(r2 => h`
            <div class="card card-flat card-tight stack-s" data-nz="${r2.nozzle_id}">
              <div class="row-b">
                <div>
                  <div class="drow-t">${esc(r2.dispenser_code)} / ${esc(r2.nozzle_code)}</div>
                  <div class="muted-s">${esc(r2.product_name)} · نرخ ${money(r2.price)}</div>
                </div>
                <div class="txt-e">
                  <div class="meta-k">قرائت ابتدایی</div>
                  <div class="meta-v">${fa(r2.opening)}</div>
                </div>
              </div>
              <div class="grid-3 keep">
                ${UI.field('قرائت اخیر', UI.input('cl_' + r2.nozzle_id, { type: 'number', ph: '0' }))}
                ${UI.field('برگشت تست (لیتر)', UI.input('tr_' + r2.nozzle_id, { type: 'number', value: 0 }))}
                ${UI.field('چرخش کنتور', UI.input('ro_' + r2.nozzle_id, { type: 'number', value: 0 }))}
              </div>
              <div class="field-calc" data-calc="${r2.nozzle_id}">—</div>
            </div>`).join('')}
        </div>

        <div class="hair"></div>
        <div class="card-title">تفکیک قبض</div>
        <div class="muted-s">هر چه نقده نیست این‌جا ثبت شود. باقی‌مانده = نقده.</div>
        <div class="grid-2">
          ${UI.field('فروش نسیه', UI.input('credit_amount', { type: 'number', value: 0 }))}
          ${UI.field('مشتری نسیه', UI.select('credit_party', customers.map(c => ({ v: c.id, t: c.name })), '', { blank: '— انتخاب —' }))}
          ${UI.field('کوپن', UI.input('coupon_amount', { type: 'number', value: 0 }))}
          ${UI.field('بانک / حواله', UI.input('bank_amount', { type: 'number', value: 0 }))}
        </div>

        <div class="hair"></div>
        <div class="grid-2 keep">
          ${UI.field('نقده شمرده‌شده', UI.input('cash_counted', { type: 'number', cls: 'big', ph: '0' }))}
          <div class="card card-flat stack-s" style="justify-content:center">
            <div class="row-b"><span class="muted-s">مجموع فروش</span><span class="num-strong" id="sumSale">0</span></div>
            <div class="row-b"><span class="muted-s">نقده مورد انتظار</span><span class="num-strong" id="sumExp">0</span></div>
            <div class="row-b"><span class="muted-s">کسر / اضافه</span><span class="num-strong" id="sumVar">0</span></div>
          </div>
        </div>
        ${UI.field('توضیح', UI.input('note', { ph: 'اختیاری' }))}
        <div id="csWarn"></div>
        <button class="btn btn-primary btn-block" type="submit">بستن شفت</button>
      </form>`, { wide: true });

    const f = ov.querySelector('#csF');
    function recalc() {
      const d = readForm(f);
      let total = 0;
      s.readings.forEach(r2 => {
        const cl = num(d['cl_' + r2.nozzle_id]);
        const tr = num(d['tr_' + r2.nozzle_id]);
        const ro = num(d['ro_' + r2.nozzle_id]);
        const cell = f.querySelector('[data-calc="' + r2.nozzle_id + '"]');
        if (!d['cl_' + r2.nozzle_id]) { cell.textContent = '—'; return; }
        const sold = Petro.nozzleSold(num(r2.opening), cl, r2.meter_digits, ro, tr, r2.meter_factor);
        const amt = sold * num(r2.price);
        total += amt;
        cell.innerHTML = sold < 0
          ? '<span class="neg">قرائت اشتباه است</span>'
          : 'فروش ' + L(sold) + ' لیتر = ' + money(amt) + ' ' + S.meta.base_currency;
      });
      const nonCash = num(d.credit_amount) + num(d.coupon_amount) + num(d.bank_amount);
      const expected = total - nonCash;
      const counted = num(d.cash_counted);
      f.querySelector('#sumSale').textContent = money(total);
      f.querySelector('#sumExp').textContent = money(expected);
      const varEl = f.querySelector('#sumVar');
      const v = counted - expected;
      varEl.textContent = money(v);
      varEl.className = 'num-strong ' + (v < -1 ? 'neg' : (v > 1 ? 'pos' : ''));
      f.querySelector('#csWarn').innerHTML = (counted > 0 && Math.abs(v) > 50)
        ? UI.banner(v < 0 ? 'error' : 'warn',
          v < 0 ? 'کسری صندوق ' + money(Math.abs(v)) + ' — به حساب اپراتور منظور می‌شود.'
            : 'اضافه صندوق ' + money(v) + ' — دلیل را در توضیح بنویسید.')
        : '';
    }
    f.addEventListener('input', recalc);
    recalc();

    f.onsubmit = async ev => {
      ev.preventDefault();
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const d = readForm(f);
        const readings = s.readings.map(r2 => ({
          nozzle_id: r2.nozzle_id, closing: num(d['cl_' + r2.nozzle_id]),
          test_return_l: num(d['tr_' + r2.nozzle_id]), rollovers: num(d['ro_' + r2.nozzle_id])
        }));
        const tenders = [];
        if (num(d.credit_amount) > 0) tenders.push({ kind: 'credit', party_id: d.credit_party, amount: num(d.credit_amount) });
        if (num(d.coupon_amount) > 0) tenders.push({ kind: 'coupon', amount: num(d.coupon_amount) });
        if (num(d.bank_amount) > 0) tenders.push({ kind: 'bank', amount: num(d.bank_amount) });
        const res = await API.post('/shifts/' + shiftId + '/close', {
          readings, tenders, cash_counted: num(d.cash_counted), note: d.note
        });
        closeSheet();
        ok('شفت بسته شد — فروش ' + L(res.total_liters) + ' لیتر');
        render();
      } catch (e) { err(e.message); btn.disabled = false; }
    };
  }
  window.CloseShiftForm = CloseShiftForm;

  async function shiftDetail(view, id) {
    const s = await API.get('/shifts/' + id);
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row">
          <button class="btn-icon" data-back>${ICON('back', 18)}</button>
          <div class="section-title">شفت #${fa(s.id)} — ${esc(s.operator_name)}</div>
          ${UI.chip(s.status === 'open' ? 'باز' : 'بسته', s.status === 'open' ? 'green' : 'grey')}
          <div class="sp"></div>
          <button class="btn-ghost no-print" onclick="window.print()">${ICON('print', 16)} چاپ</button>
        </div>

        <div class="grid-4 keep">
          ${UI.stat(L(s.total_liters), 'مجموع لیتر')}
          ${UI.stat(money(s.total_amount), 'مجموع فروش')}
          ${UI.stat(money(s.cash_counted), 'نقده شمرده')}
          ${UI.stat(money(s.cash_variance), 'کسر / اضافه صندوق', null, s.cash_variance < 0 ? 'neg' : (s.cash_variance > 0 ? 'pos' : ''))}
        </div>

        <div class="card stack">
          <div class="card-title">نازل‌ها</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>دستگاه/نازل</th><th>محصول</th><th class="num">ابتدایی</th><th class="num">اخیر</th>
              <th class="num">تست</th><th class="num">فروش لیتر</th><th class="num">نرخ</th><th class="num">مبلغ</th></tr></thead>
            <tbody>${s.readings.map(r2 => h`<tr>
              <td>${esc(r2.dispenser_code)} / ${esc(r2.nozzle_code)}</td>
              <td>${esc(r2.product_name)}</td>
              <td class="num">${fa(r2.opening)}</td>
              <td class="num">${r2.closing === null ? '—' : fa(r2.closing)}</td>
              <td class="num">${L(r2.test_return_l)}</td>
              <td class="num">${L(r2.sold_l)}</td>
              <td class="num">${money(r2.price)}</td>
              <td class="num">${money(r2.amount)}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="5">مجموع</td><td class="num">${L(s.total_liters)}</td><td></td>
              <td class="num">${money(s.total_amount)}</td></tr></tfoot>
          </table></div>
        </div>

        ${s.tenders.length ? h`<div class="card stack">
          <div class="card-title">تفکیک قبض</div><div class="hair"></div>
          ${s.tenders.map(t => h`<div class="row-b">
            <span class="body-1">${esc(TENDER[t.kind] || t.kind)}${t.party_name ? ' — ' + esc(t.party_name) : ''}</span>
            <span class="num-strong">${money(t.amount)}</span></div>`).join('')}
          <div class="hair"></div>
          <div class="row-b"><span class="muted">نقده مورد انتظار</span><span class="num-strong">${money(s.cash_expected)}</span></div>
        </div>` : ''}

        ${s.dips.length ? h`<div class="card stack">
          <div class="card-title">دیپ‌های شفت</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>وقت</th><th>تانک</th><th>نوع</th><th class="num">خالص</th><th class="num">دفتری</th><th class="num">کسری</th></tr></thead>
            <tbody>${s.dips.map(x => h`<tr>
              <td>${timeOf(x.read_at)}</td><td>${esc(x.tank_code)}</td>
              <td>${x.kind === 'open' ? 'افتتاحیه' : (x.kind === 'close' ? 'اختتامیه' : 'عادی')}</td>
              <td class="num">${L(x.vol_net_l)}</td><td class="num">${L(x.book_l)}</td>
              <td class="num ${x.variance_l < 0 ? 't-neg' : ''}">${L(x.variance_l)}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : ''}

        ${s.status === 'open' && can('shift') ? h`<button class="btn btn-primary" data-close>بستن این شفت</button>` : ''}
      </div>`;
    view.querySelector('[data-back]').onclick = () => go('#/shifts');
    const cb = view.querySelector('[data-close]');
    if (cb) cb.onclick = () => CloseShiftForm(s.id);
  }

  const TENDER = { credit: 'نسیه', coupon: 'کوپن', bank: 'بانک', hawala: 'حواله', cash: 'نقده' };
})();
