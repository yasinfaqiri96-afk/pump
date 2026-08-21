/* صفحات: راپورها، هشدارها، تنظیمات، کاربران، ثبت وقایع، جستجو */
(function () {
  'use strict';
  const q = () => (S.stationId ? { station_id: S.stationId } : {});
  const CCY = () => S.meta.base_currency;

  /* راپورها گروه‌بندی شده — منو بزرگ و گیج‌کننده نشود */
  const GROUPS = [
    {
      g: 'روزانه', items: [
        { k: 'daily', t: 'راپور روزانه استیشن', d: 'یک صفحه: فروش، نقده، قرضی، دیپ، کسری' }
      ]
    },
    {
      g: 'فروش', items: [
        { k: 'profit', t: 'سود و زیان', d: 'سود ناخالص هر محصول، مصارف، سود خالص' },
        { k: 'credit', t: 'فروش قرضی مشتریان', d: 'کدام مشتری چقدر قرضی گرفت' },
        { k: 'vehicles', t: 'فروش بر اساس موتر', d: 'هر موتر قراردادی چقدر تیل گرفت' },
        { k: 'prices', t: 'تاریخچه نرخ', d: 'نرخ‌های ثبت‌شده و تغییر نرخ وسط شفت' }
      ]
    },
    {
      g: 'موجودی', items: [
        { k: 'variance', t: 'کسری تانک', d: 'روند کسری هر تانک و کشف نشتی یا دزدی' },
        { k: 'stockcard', t: 'دفتر موجودی تانک', d: 'هر حرکت لیتر با بیلانس جاری' },
        { k: 'transfers', t: 'انتقال بین تانک‌ها', d: 'کدام تیل کجا رفت' },
        { k: 'transit', t: 'کسری راه ترانسپورتران', d: 'کدام ترانسپورتر مکرر کم می‌آورد' },
        { k: 'consignment', t: 'موجودی امانتی', d: 'مال خود ما در برابر مال دیگران' }
      ]
    },
    {
      g: 'حسابات', items: [
        { k: 'aging', t: 'سن طلبات', d: 'طلبات ۰-۳۰، ۳۱-۶۰، ۶۱-۹۰، بالای ۹۰ روز' },
        { k: 'cash', t: 'جریان نقده', d: 'صندوق، بانک، حواله — ورود و خروج' },
        { k: 'stations', t: 'مقایسه استیشن‌ها', d: 'فروش، سود، کسری کنار هم' }
      ]
    },
    {
      g: 'کنترول', items: [
        { k: 'operator', t: 'کارکرد اپراتور', d: 'فروش، کسری صندوق و روند هر نفر' },
        { k: 'calibration', t: 'کالیبراسیون و مهر', d: 'کدام نازل یا تانک به کنترول ضرورت دارد' }
      ]
    }
  ];

  page('reports', async function (view, r) {
    const key = r.q.r;
    if (!key) {
      view.innerHTML = h`
        <div class="pad section stack">
          <div class="section-title">راپورها</div>
          ${GROUPS.map(gr => h`
            <div class="section">
              <div class="section-title" style="margin-bottom:1rem;font-size:1.05rem">${esc(gr.g)}</div>
              <div class="grid-3">
                ${gr.items.map(x => h`<div class="card card-hover stack-s" data-r="${x.k}">
                  <div class="tank-icon">${ICON('chart', 20)}</div>
                  <div class="card-title">${esc(x.t)}</div>
                  <div class="muted-s">${esc(x.d)}</div>
                </div>`).join('')}
              </div>
            </div>`).join('')}
        </div>`;
      view.querySelectorAll('[data-r]').forEach(c => c.onclick = () => go('#/reports?r=' + c.dataset.r));
      return;
    }
    const fn = {
      daily, variance, operator, transit, profit, aging, cash, stations, stockcard,
      credit, vehicles, transfers, prices, calibration, consignment
    }[key];
    if (!fn) return go('#/reports');
    await fn(view, r);
  });

  /* نوار فیلتر مشترک */
  function filterBar(r, opts) {
    opts = opts || {};
    const to = r.q.to || Jalali.todayGregorian();
    const from = r.q.from || Jalali.addDaysGreg(to, -29);
    return h`
      <div class="card no-print">
        <form id="fltF" class="row" style="align-items:flex-end">
          ${opts.single
        ? UI.dateField('تاریخ', 'date', r.q.date || Jalali.todayGregorian())
        : h`${UI.dateField('از تاریخ', 'from', from)}${UI.dateField('تا تاریخ', 'to', to)}`}
          ${opts.extra || ''}
          <button class="btn btn-primary" type="submit" style="padding:.6rem 1.5rem">نمایش</button>
          <div class="sp"></div>
          <button class="btn-ghost" type="button" onclick="window.print()">${ICON('print', 16)} چاپ</button>
          <button class="btn-ghost" type="button" data-back-rep>راپورهای دیگر</button>
        </form>
      </div>`;
  }
  function bindFilter(view, key) {
    const f = view.querySelector('#fltF');
    if (f) f.onsubmit = ev => {
      ev.preventDefault();
      const d = readForm(f);
      const parts = Object.keys(d).filter(k => d[k]).map(k => k + '=' + encodeURIComponent(d[k]));
      go('#/reports?r=' + key + (parts.length ? '&' + parts.join('&') : ''));
    };
    const b = view.querySelector('[data-back-rep]');
    if (b) b.onclick = () => go('#/reports');
  }
  function head(title, sub) {
    return h`<div class="row-b">
      <div><div class="section-title">${esc(title)}</div>
      ${sub ? h`<div class="muted">${sub}</div>` : ''}</div>
    </div>`;
  }

  /* ---------------- راپور روزانه ---------------- */
  async function daily(view, r) {
    const stationId = S.stationId || (S.meta.stations[0] && S.meta.stations[0].id);
    if (!stationId) { view.innerHTML = h`<div class="pad section">${UI.empty('استیشن را انتخاب کنید')}</div>`; return; }
    const d = await API.get('/reports/daily', { station_id: stationId, date: r.q.date });
    const T = d.totals;

    view.innerHTML = h`
      <div class="pad section stack">
        ${head('راپور روزانه — ' + d.station.name, d.weekday + ' · ' + shLong(d.date))}
        ${filterBar(r, { single: true })}

        ${d.day_closed ? UI.banner('ok', 'این روز بسته شده است'
      + (d.day_close && d.day_close.closed_by_name ? ' — توسط ' + esc(d.day_close.closed_by_name) : '')
      + '. ثبت سند با این تاریخ فقط با اجازه مدیر و دلیل ممکن است.')
      : (can('setup') ? h`<div class="card no-print">
          <div class="row-b">
            <div>
              <div class="card-title">بستن روز</div>
              <div class="muted-s">بعد از بستن، کاربر عادی نمی‌تواند سند این روز را تغییر بدهد.</div>
            </div>
            <button class="btn btn-primary" data-dayclose>بستن روز</button>
          </div>
        </div>` : '')}

        <div class="grid-4 keep">
          ${UI.stat(L(T.total_liters), 'مجموع فروش (لیتر)')}
          ${UI.stat(money(T.total_amount), 'مجموع فروش (' + CCY() + ')')}
          ${UI.stat(money(T.credit), 'فروش قرضی')}
          ${UI.stat(money(T.cash_variance), 'کسر / اضافه صندوق', null, T.cash_variance < 0 ? 'neg' : '')}
        </div>

        <div class="card stack">
          <div class="card-title">وضعیت تانک‌ها</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>تانک</th><th>محصول</th><th class="num">افتتاحیه</th><th class="num">ورودی</th>
              <th class="num">خروجی</th><th class="num">دفتری</th><th class="num">دیپ اخیر</th><th class="num">کسری</th></tr></thead>
            <tbody>${d.tanks.map(t => h`<tr>
              <td>${esc(t.code)}</td><td>${esc(t.product_name)}</td>
              <td class="num">${t.open_l === null ? '—' : L(t.open_l)}</td>
              <td class="num t-pos">${t.in_l ? L(t.in_l) : '—'}</td>
              <td class="num">${t.out_l ? L(t.out_l) : '—'}</td>
              <td class="num">${L(t.book_l)}</td>
              <td class="num">${t.close_l === null ? '—' : L(t.close_l)}</td>
              <td class="num ${t.variance_l < 0 ? 't-neg' : (t.variance_l > 0 ? 't-pos' : '')}">${t.variance_l === null ? '—' : L(t.variance_l)}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>

        <div class="grid-2">
          <div class="card stack">
            <div class="card-title">فروش به تفکیک محصول</div><div class="hair"></div>
            ${d.by_product.length ? d.by_product.map(p => h`<div class="row-b">
              <span class="body-1">${esc(p.name)}</span>
              <span><span class="num-strong">${L(p.liters)}</span> <span class="muted-s">${esc(p.uom)}</span>
                &nbsp;·&nbsp; <span class="num-strong">${money(p.amount)}</span></span>
            </div>`).join('') : h`<div class="muted">فروشی ثبت نشده</div>`}
          </div>
          <div class="card stack">
            <div class="card-title">پول روز</div><div class="hair"></div>
            <div class="row-b"><span class="body-1">نقده</span><span class="num-strong">${money(T.retail_amount
      - d.tenders.reduce((s, t) => s + num(t.amount), 0) - T.credit_tickets)}</span></div>
            ${T.credit_tickets > 0 ? h`<div class="row-b">
              <span class="body-1">فروش قرضی (بلیت موتر)</span>
              <span class="num-strong">${money(T.credit_tickets)}</span></div>` : ''}
            ${d.tenders.map(t => h`<div class="row-b">
              <span class="body-1">${esc(({ credit: 'نسیه بدون بلیت', coupon: 'کوپن', bank: 'بانک', hawala: 'حواله' })[t.kind] || t.kind)}</span>
              <span class="num-strong">${money(t.amount)}</span></div>`).join('')}
            <div class="hair"></div>
            <div class="row-b"><span class="muted">نقده شمرده‌شده</span><span class="num-strong">${money(T.cash_counted)}</span></div>
            <div class="row-b"><span class="muted">مصارف روز</span><span class="num-strong neg">${money(T.expenses)}</span></div>
          </div>
        </div>

        ${d.shifts.length ? h`<div class="card stack">
          <div class="card-title">شفت‌ها</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>اپراتور</th><th>از</th><th>تا</th><th class="num">لیتر</th><th class="num">فروش</th>
              <th class="num">نقده انتظار</th><th class="num">نقده شمرده</th><th class="num">کسر</th></tr></thead>
            <tbody>${d.shifts.map(s => h`<tr>
              <td>${esc(s.operator_name)}</td><td>${timeOf(s.opened_at)}</td><td>${timeOf(s.closed_at)}</td>
              <td class="num">${L(s.total_liters)}</td><td class="num">${money(s.total_amount)}</td>
              <td class="num">${money(s.cash_expected)}</td><td class="num">${money(s.cash_counted)}</td>
              <td class="num ${s.cash_variance < 0 ? 't-neg' : ''}">${money(s.cash_variance)}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : ''}

        ${d.receipts.length ? h`<div class="card stack">
          <div class="card-title">ورود تیل</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>بارنامه</th><th>تهیه‌کننده</th><th>تانک</th><th class="num">لیتر</th><th class="num">تُن</th><th class="num">کسری تُن</th></tr></thead>
            <tbody>${d.receipts.map(x => h`<tr>
              <td>${esc(x.waybill_no || '—')}</td><td>${esc(x.supplier_name || '—')}</td><td>${esc(x.tank_code)}</td>
              <td class="num">${L(x.vol_obs_l)}</td><td class="num">${n(x.qty_mt, 3)}</td>
              <td class="num ${x.variance_mt < 0 ? 't-neg' : ''}">${n(x.variance_mt, 3)}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : ''}

        ${d.credit_tickets.length ? h`<div class="card stack">
          <div class="card-title">فروش قرضی</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>مشتری</th><th>موتر</th><th>محصول</th><th class="num">لیتر</th><th class="num">مبلغ</th></tr></thead>
            <tbody>${d.credit_tickets.map(x => h`<tr>
              <td>${esc(x.party_name)}</td><td>${esc(x.plate_no || '—')}</td>
              <td>${esc(x.product_name || '—')}</td>
              <td class="num">${L(x.qty_l)}</td><td class="num">${money(x.amount)}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="4">مجموع</td><td class="num">${money(T.credit_tickets)}</td></tr></tfoot>
          </table></div>
        </div>` : ''}

        ${d.transfers.length ? h`<div class="card stack">
          <div class="card-title">انتقال بین تانک‌ها</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>از</th><th>به</th><th>محصول</th><th class="num">لیتر</th><th>شرح</th></tr></thead>
            <tbody>${d.transfers.map(x => h`<tr>
              <td>${esc(x.from_code)}</td><td>${esc(x.to_code)}</td><td>${esc(x.product_name)}</td>
              <td class="num">${L(x.qty_l)}</td><td class="muted-s">${esc(x.note || '')}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : ''}
      </div>`;
    bindFilter(view, 'daily');

    const dc = view.querySelector('[data-dayclose]');
    if (dc) dc.onclick = () => DayCloseForm(stationId, d.date, d.totals);
  }

  /* ---------------- بستن روز ---------------- */
  async function DayCloseForm(station, date, totals) {
    const st = await API.get('/day-close', { station_id: station, date });
    if (!st.can_close) {
      return err('اول شفت‌های باز را ببندید: '
        + st.open_shifts.map(x => x.operator_name).join('، '));
    }
    const ov = sheet('بستن روز — ' + shLong(date), h`
      <form id="dcF" class="stack">
        <div class="card card-flat stack-s">
          <div class="row-b"><span class="muted">مجموع فروش</span>
            <span class="num-strong">${L(totals.total_liters)} لیتر · ${money(totals.total_amount)}</span></div>
          <div class="row-b"><span class="muted">نقده شمرده</span><span class="num-strong">${money(totals.cash_counted)}</span></div>
          <div class="row-b"><span class="muted">فروش قرضی</span><span class="num-strong">${money(totals.credit)}</span></div>
          <div class="row-b"><span class="muted">مصارف</span><span class="num-strong neg">${money(totals.expenses)}</span></div>
        </div>
        ${UI.banner('warn', 'بعد از بستن روز، کاربر عادی نمی‌تواند سند این روز یا روزهای قبل را ثبت یا تغییر بدهد. '
      + 'مدیر می‌تواند، ولی دلیل اجباری است و هشدار ثبت می‌شود.')}
        ${UI.field('توضیح', UI.input('note', { ph: 'اختیاری' }))}
        <button class="btn btn-primary btn-block" type="submit">بستن روز</button>
      </form>`);
    onSubmit(ov.querySelector('#dcF'), async d => {
      d.station_id = station; d.doc_date = date;
      await API.post('/day-close', d);
      closeSheet(); ok('روز بسته شد'); render();
    });
  }

  /* ---------------- کسری تانک ---------------- */
  async function variance(view, r) {
    const d = await API.get('/reports/variance', Object.assign({ from: r.q.from, to: r.q.to }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('کسری تانک', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        ${d.rows.length ? h`
          ${d.rows.some(x => x.suspect) ? UI.banner('error',
      'تانک مشکوک: ' + d.rows.filter(x => x.suspect).map(x => esc(x.tank_code)).join('، ')
      + ' — کسری یک‌طرفه مداوم. نشتی تانک یا دزدی سیستماتیک را بررسی کنید.') : ''}
          <div class="card"><div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>تانک</th><th>محصول</th><th class="num">تعداد دیپ</th><th class="num">مجموع کسری</th>
              <th class="num">میانگین ٪</th><th class="num">بدترین</th><th class="num">سوگیری منفی</th><th>ارزیابی</th></tr></thead>
            <tbody>${d.rows.map(x => h`<tr>
              <td>${esc(x.tank_code)}</td><td>${esc(x.product_name)}</td>
              <td class="num">${fa(x.readings)}</td>
              <td class="num ${x.total_var < 0 ? 't-neg' : 't-pos'}">${L(x.total_var)}</td>
              <td class="num ${Math.abs(x.avg_pct) > x.tolerance_pct ? 't-neg' : ''}">${pct(x.avg_pct)}</td>
              <td class="num t-neg">${L(x.worst)}</td>
              <td class="num">${fa(x.negative_bias_pct)}٪</td>
              <td class="${x.suspect ? 't-neg' : 'muted-s'}">${esc(x.verdict)}</td>
            </tr>`).join('')}</tbody></table></div></div>
          <div class="card">
            ${UI.banner('info', '<b>چطور بخوانید:</b> کسری تصادفی (گاهی مثبت گاهی منفی) = خطای اندازه‌گیری، طبیعی است. '
        + 'سوگیری منفی بالای 80٪ یعنی همیشه کم می‌آید — این تصادفی نیست.')}
          </div>` : UI.empty('در این بازه دیپی ثبت نشده')}
      </div>`;
    bindFilter(view, 'variance');
  }

  /* ---------------- اپراتور ---------------- */
  async function operator(view, r) {
    const d = await API.get('/reports/operator', Object.assign({ from: r.q.from, to: r.q.to }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('کارکرد اپراتور', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        ${d.rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>اپراتور</th><th class="num">شفت</th><th class="num">لیتر</th><th class="num">فروش</th>
            <th class="num">کسر صندوق</th><th class="num">شفت با کسری</th><th class="num">نرخ کسری</th><th class="num">بدهی فعلی</th></tr></thead>
          <tbody>${d.rows.map(x => h`<tr>
            <td>${esc(x.operator_name)}</td>
            <td class="num">${fa(x.shifts)}</td>
            <td class="num">${L(x.liters)}</td>
            <td class="num">${money(x.amount)}</td>
            <td class="num ${x.cash_var < 0 ? 't-neg' : 't-pos'}">${money(x.cash_var)}</td>
            <td class="num">${fa(x.short_shifts)}</td>
            <td class="num ${x.short_rate > 50 ? 't-neg' : ''}">${fa(x.short_rate)}٪</td>
            <td class="num">${money(x.balance)}</td>
          </tr>`).join('')}</tbody></table></div></div>` : UI.empty('در این بازه شفت بسته‌شده‌ای نیست')}
      </div>`;
    bindFilter(view, 'operator');
  }

  /* ---------------- ترانزیت ---------------- */
  async function transit(view, r) {
    const d = await API.get('/reports/transit', Object.assign({ from: r.q.from, to: r.q.to }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('کسری ترانزیت ترانسپورتران', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        ${d.rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>ترانسپورتر</th><th class="num">تعداد سفر</th><th class="num">تُن مبدا</th>
            <th class="num">تُن دریافتی</th><th class="num">کسری تُن</th><th class="num">میانگین ٪</th><th>وضعیت</th></tr></thead>
          <tbody>${d.rows.map(x => h`<tr>
            <td>${esc(x.transporter_name)}</td>
            <td class="num">${fa(x.trips)}</td>
            <td class="num">${n(x.src_mt, 3)}</td>
            <td class="num">${n(x.recv_mt, 3)}</td>
            <td class="num ${x.var_mt < 0 ? 't-neg' : 't-pos'}">${n(x.var_mt, 3)}</td>
            <td class="num ${x.avg_pct < -0.5 ? 't-neg' : ''}">${pct(x.avg_pct)}</td>
            <td>${x.suspect ? '<span class="t-neg">مکرر کم می‌آورد — بررسی شود</span>' : '<span class="muted-s">نورمال</span>'}</td>
          </tr>`).join('')}</tbody></table></div></div>` : UI.empty('در این بازه تخلیه‌ای با مقدار مبدا ثبت نشده')}
      </div>`;
    bindFilter(view, 'transit');
  }

  /* ---------------- سود و زیان ---------------- */
  async function profit(view, r) {
    const d = await API.get('/reports/profit', Object.assign({ from: r.q.from, to: r.q.to }, q()));
    const T = d.totals;
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('سود و زیان', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        <div class="grid-4 keep">
          ${UI.stat(money(T.revenue), 'فروش')}
          ${UI.stat(money(T.cost), 'بهای تمام‌شده')}
          ${UI.stat(money(T.gross_profit), 'سود ناخالص', null, 'pos')}
          ${UI.stat(money(T.net_profit), 'سود خالص', 'بعد از مصارف ' + money(T.expenses), T.net_profit < 0 ? 'neg' : 'pos')}
        </div>
        ${d.rows.length ? h`<div class="card stack">
          <div class="card-title">به تفکیک محصول</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>محصول</th><th class="num">مقدار</th><th class="num">فروش</th><th class="num">بها</th>
              <th class="num">سود</th><th class="num">حاشیه</th><th class="num">سود هر واحد</th></tr></thead>
            <tbody>${d.rows.map(x => h`<tr>
              <td>${esc(x.name)}</td>
              <td class="num">${L(x.liters)} <span class="muted-s">${esc(x.uom)}</span></td>
              <td class="num">${money(x.revenue)}</td>
              <td class="num">${money(x.cost)}</td>
              <td class="num ${x.profit < 0 ? 't-neg' : 't-pos'}">${money(x.profit)}</td>
              <td class="num">${fa(x.margin_pct)}٪</td>
              <td class="num">${n(x.per_unit, 2)}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><td>مجموع</td><td class="num">${L(T.liters)}</td><td class="num">${money(T.revenue)}</td>
              <td class="num">${money(T.cost)}</td><td class="num">${money(T.gross_profit)}</td><td></td><td></td></tr></tfoot>
          </table></div>
        </div>` : UI.empty('در این بازه فروشی ثبت نشده')}
        ${d.expense_breakdown.length ? h`<div class="card stack">
          <div class="card-title">مصارف</div><div class="hair"></div>
          ${d.expense_breakdown.map(e => h`<div class="row-b">
            <span class="body-1">${esc(e.category)}</span><span class="num-strong neg">${money(e.amount)}</span></div>`).join('')}
          <div class="hair"></div>
          <div class="row-b"><span class="muted">مجموع مصارف</span><span class="num-strong neg">${money(T.expenses)}</span></div>
        </div>` : ''}
      </div>`;
    bindFilter(view, 'profit');
  }

  /* ---------------- سن طلبات ---------------- */
  async function aging(view, r) {
    const kind = r.q.kind || 'customer';
    const d = await API.get('/reports/aging', { date: r.q.date, kind });
    const T = d.totals;
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('سن طلبات', shLong(d.date))}
        ${filterBar(r, {
      single: true,
      extra: UI.field('گروه', UI.select('kind', [
        { v: 'customer', t: 'مشتریان (طلبات)' }, { v: 'supplier', t: 'تهیه‌کنندگان (قروض)' }], kind))
    })}
        <div class="grid-4 keep">
          ${UI.stat(money(T.b0), '0 تا 30 روز')}
          ${UI.stat(money(T.b30), '31 تا 60 روز')}
          ${UI.stat(money(T.b60), '61 تا 90 روز')}
          ${UI.stat(money(T.b90), 'بالای 90 روز', null, T.b90 > 0 ? 'neg' : '')}
        </div>
        ${d.rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>نام</th><th>تلفن</th><th class="num">0-30</th><th class="num">31-60</th>
            <th class="num">61-90</th><th class="num">+90</th><th class="num">بیلانس</th><th class="num">سقف</th><th>وضعیت</th></tr></thead>
          <tbody>${d.rows.map(x => h`<tr>
            <td>${esc(x.name)}</td><td class="muted-s">${esc(x.phone || '')}</td>
            <td class="num">${x.b0 ? money(x.b0) : '—'}</td>
            <td class="num">${x.b30 ? money(x.b30) : '—'}</td>
            <td class="num">${x.b60 ? money(x.b60) : '—'}</td>
            <td class="num ${x.b90 ? 't-neg' : ''}">${x.b90 ? money(x.b90) : '—'}</td>
            <td class="num">${money(x.balance)}</td>
            <td class="num muted-s">${x.credit_limit ? money(x.credit_limit) : '—'}</td>
            <td>${x.over_limit ? '<span class="t-neg">از سقف گذشته</span>'
        : (x.risky ? '<span class="t-neg">خطرناک</span>' : '<span class="muted-s">نورمال</span>')}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="2">مجموع</td><td class="num">${money(T.b0)}</td><td class="num">${money(T.b30)}</td>
            <td class="num">${money(T.b60)}</td><td class="num">${money(T.b90)}</td>
            <td class="num">${money(T.balance)}</td><td></td><td></td></tr></tfoot>
        </table></div></div>` : UI.empty('بیلانس بازی وجود ندارد')}
      </div>`;
    bindFilter(view, 'aging');
  }

  /* ---------------- جریان نقده ---------------- */
  async function cash(view, r) {
    const d = await API.get('/reports/cash', Object.assign({ from: r.q.from, to: r.q.to }, q()));
    const NAMES = { cash: 'صندوق', bank: 'بانک', hawala: 'حواله' };
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('جریان نقده', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        <div class="grid-3 keep">
          ${d.balances.map(b => UI.stat(money(b.balance), 'موجودی ' + NAMES[b.account])).join('')}
        </div>
        ${d.daily.length ? h`<div class="card stack">
          <div class="card-title">روزانه</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>تاریخ</th><th class="num">ورودی</th><th class="num">خروجی</th><th class="num">خالص</th></tr></thead>
            <tbody>${d.daily.map(x => h`<tr>
              <td>${fa(x.shamsi)}</td>
              <td class="num t-pos">${money(x.inflow)}</td>
              <td class="num">${money(x.outflow)}</td>
              <td class="num ${x.net < 0 ? 't-neg' : 't-pos'}">${money(x.net)}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : UI.empty('در این بازه حرکتی نبوده')}
      </div>`;
    bindFilter(view, 'cash');
  }

  /* ---------------- مقایسه استیشن ---------------- */
  async function stations(view, r) {
    const d = await API.get('/reports/stations', { from: r.q.from, to: r.q.to });
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('مقایسه استیشن‌ها', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        ${d.rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>استیشن</th><th>ولایت</th><th class="num">شفت</th><th class="num">لیتر</th>
            <th class="num">فروش</th><th class="num">مصارف</th><th class="num">کسر صندوق</th><th class="num">کسری تانک</th></tr></thead>
          <tbody>${d.rows.map(x => h`<tr>
            <td>${esc(x.name)}</td><td class="muted-s">${esc(x.province || '')}</td>
            <td class="num">${fa(x.shifts)}</td><td class="num">${L(x.liters)}</td>
            <td class="num">${money(x.amount)}</td><td class="num">${money(x.expenses)}</td>
            <td class="num ${x.cash_variance < 0 ? 't-neg' : ''}">${money(x.cash_variance)}</td>
            <td class="num ${x.tank_variance < 0 ? 't-neg' : ''}">${L(x.tank_variance)}</td>
          </tr>`).join('')}</tbody></table></div></div>` : UI.empty('استیشنی نیست')}
      </div>`;
    bindFilter(view, 'stations');
  }

  /* ---------------- دفتر موجودی ---------------- */
  async function stockcard(view, r) {
    const tanks = await API.get('/tanks', {});
    const tankId = r.q.tank || (tanks[0] && tanks[0].id);
    if (!tankId) { view.innerHTML = h`<div class="pad section">${UI.empty('تانکی وجود ندارد')}</div>`; return; }
    const d = await API.get('/reports/stockcard', { tank_id: tankId, from: r.q.from, to: r.q.to });
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('دفتر موجودی — ' + d.tank.name, 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r, { extra: UI.field('تانک', UI.select('tank', tanks.map(t => ({ v: t.id, t: t.code + ' — ' + t.name })), tankId)) })}
        <div class="grid-3 keep">
          ${UI.stat(L(d.opening), 'موجودی ابتدای دوره')}
          ${UI.stat(fa(d.lines.length), 'تعداد حرکت')}
          ${UI.stat(L(d.closing), 'موجودی آخر دوره')}
        </div>
        ${d.lines.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>تاریخ</th><th>نوع</th><th class="num">ورودی</th><th class="num">خروجی</th>
            <th class="num">بیلانس</th><th class="num">بها/واحد</th><th>شرح</th></tr></thead>
          <tbody>${d.lines.map(l => h`<tr>
            <td>${fa(l.shamsi)}</td>
            <td>${esc((window.SRC || {})[l.source_type] || l.source_type)}</td>
            <td class="num t-pos">${l.direction === 'in' ? L(l.qty_obs) : '—'}</td>
            <td class="num">${l.direction === 'out' ? L(l.qty_obs) : '—'}</td>
            <td class="num">${L(l.running)}</td>
            <td class="num muted-s">${n(l.unit_cost, 2)}</td>
            <td class="muted-s">${esc(l.note || '')}</td>
          </tr>`).join('')}</tbody></table></div></div>` : UI.empty('در این بازه حرکتی نبوده')}
      </div>`;
    bindFilter(view, 'stockcard');
  }

  /* ---------------- فروش قرضی مشتریان ---------------- */
  async function credit(view, r) {
    const d = await API.get('/reports/credit', Object.assign({ from: r.q.from, to: r.q.to }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('فروش قرضی مشتریان', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        <div class="grid-3 keep">
          ${UI.stat(L(d.totals.liters), 'لیتر قرضی از نازل')}
          ${UI.stat(money(d.totals.amount), 'مبلغ قرضی نازل')}
          ${UI.stat(money(d.totals.bulk_amount), 'فروش عمده نسیه')}
        </div>
        ${d.rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>مشتری</th><th>تلفن</th><th class="num">بلیت</th><th class="num">موتر</th>
            <th class="num">لیتر</th><th class="num">مبلغ</th><th class="num">سقف</th><th class="num">طلب فعلی</th></tr></thead>
          <tbody>${d.rows.map(x => h`<tr class="clickable" data-p="${x.party_id}">
            <td>${esc(x.party_name)}</td><td class="muted-s">${esc(x.phone || '—')}</td>
            <td class="num">${fa(x.tickets)}</td><td class="num">${fa(x.vehicles)}</td>
            <td class="num">${L(x.liters)}</td><td class="num">${money(x.amount)}</td>
            <td class="num muted-s">${x.credit_limit > 0 ? money(x.credit_limit) : '—'}</td>
            <td class="num ${x.over_limit ? 't-neg' : ''}">${money(x.balance)}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="4">مجموع</td><td class="num">${L(d.totals.liters)}</td>
            <td class="num">${money(d.totals.amount)}</td><td colspan="2"></td></tr></tfoot>
        </table></div></div>` : UI.empty('در این بازه فروش قرضی ثبت نشده')}

        ${d.bulk_credit.length ? h`<div class="card stack">
          <div class="card-title">فروش عمده نسیه</div><div class="hair"></div>
          ${d.bulk_credit.map(x => h`<div class="row-b">
            <span class="body-1">${esc(x.party_name)}</span>
            <span><span class="num-strong">${L(x.liters)}</span> لیتر ·
              <span class="num-strong">${money(x.amount)}</span></span>
          </div>`).join('')}
        </div>` : ''}
      </div>`;
    bindFilter(view, 'credit');
    view.querySelectorAll('[data-p]').forEach(b => b.onclick = () => go('#/parties/' + b.dataset.p));
  }

  /* ---------------- فروش بر اساس موتر ---------------- */
  async function vehicles(view, r) {
    const d = await API.get('/reports/vehicles',
      Object.assign({ from: r.q.from, to: r.q.to, party_id: r.q.party_id }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('فروش بر اساس موتر', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to)
      + ' · ' + fa(d.days) + ' روز')}
        ${filterBar(r)}
        <div class="grid-2 keep">
          ${UI.stat(L(d.totals.liters), 'مجموع لیتر')}
          ${UI.stat(money(d.totals.amount), 'مجموع مبلغ')}
        </div>
        ${d.rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>نمبر پلیت</th><th>مشتری</th><th>نوع موتر</th><th>محصول</th>
            <th class="num">دفعات</th><th class="num">لیتر</th><th class="num">هر بار</th>
            <th class="num">روزانه</th><th class="num">مبلغ</th><th>آخرین بار</th></tr></thead>
          <tbody>${d.rows.map(x => h`<tr>
            <td class="num-strong">${esc(x.plate_no)}</td><td>${esc(x.party_name)}</td>
            <td class="muted-s">${esc(x.vehicle_kind || '—')}</td>
            <td class="muted-s">${esc(x.product_name || '—')}</td>
            <td class="num">${fa(x.tickets)}</td><td class="num">${L(x.liters)}</td>
            <td class="num">${L(x.per_ticket)}</td><td class="num">${L(x.per_day)}</td>
            <td class="num">${money(x.amount)}</td><td>${sh(x.last_date)}</td>
          </tr>`).join('')}</tbody></table></div></div>
          <div class="card">${UI.banner('info',
        '<b>چطور بخوانید:</b> اگر مصرف روزانه یک موتر ناگهان زیاد شود، یا یک موتر بیشتر از '
        + 'ظرفیت تانک خودش تیل بگیرد، کنترل کنید. این نشانه فروش تیل به شخص دیگر است.')}</div>`
        : UI.empty('در این بازه فروش قرضی موتری ثبت نشده')}
      </div>`;
    bindFilter(view, 'vehicles');
  }

  /* ---------------- انتقال بین تانک‌ها ---------------- */
  async function transfers(view, r) {
    const d = await API.get('/reports/transfers', Object.assign({ from: r.q.from, to: r.q.to }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('انتقال بین تانک‌ها', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        <div class="grid-3 keep">
          ${UI.stat(fa(d.totals.count), 'تعداد انتقال')}
          ${UI.stat(L(d.totals.liters), 'مجموع لیتر')}
          ${UI.stat(fa(d.totals.reversed), 'برگشت‌خورده', null, d.totals.reversed ? 'neg' : '')}
        </div>
        ${d.rows.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>تاریخ</th><th>از تانک</th><th>به تانک</th><th>محصول</th>
            <th class="num">لیتر</th><th class="num">بهای هر لیتر</th><th>ثبت‌کننده</th><th>وضعیت</th></tr></thead>
          <tbody>${d.rows.map(x => h`<tr>
            <td>${sh(x.doc_date)}</td><td>${esc(x.from_code)}</td><td>${esc(x.to_code)}</td>
            <td>${esc(x.product_name)}</td><td class="num">${L(x.qty_l)}</td>
            <td class="num">${n(x.unit_cost, 2)}</td>
            <td class="muted-s">${esc(x.created_by_name || '—')}</td>
            <td>${x.status === 'posted' ? 'ثبت شده'
        : (x.status === 'reversed' ? '<span class="t-neg">برگشت خورده</span>' : 'سند برگشت')}</td>
          </tr>`).join('')}</tbody></table></div></div>` : UI.empty('در این بازه انتقالی ثبت نشده')}
      </div>`;
    bindFilter(view, 'transfers');
  }

  /* ---------------- تاریخچه نرخ ---------------- */
  async function prices(view, r) {
    const d = await API.get('/reports/prices', Object.assign({ from: r.q.from, to: r.q.to }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('تاریخچه نرخ', 'از ' + shLong(d.from) + ' تا ' + shLong(d.to))}
        ${filterBar(r)}
        <div class="grid-4">
          ${d.current.map(p => h`<div class="card stat">
            <div class="stat-num" style="color:${p.color}">${money(p.price)}</div>
            <div class="stat-lbl">${esc(p.name)}</div>
            <div class="stat-sub">نرخ امروز</div>
          </div>`).join('')}
        </div>
        ${d.checkpoints.length ? h`<div class="card stack">
          <div class="card-title">تغییر نرخ وسط شفت</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>تاریخ</th><th>وقت</th><th>محصول</th><th class="num">نرخ قدیم</th>
              <th class="num">نرخ جدید</th><th>شفت</th><th>ثبت‌کننده</th></tr></thead>
            <tbody>${d.checkpoints.map(c => h`<tr>
              <td>${sh(c.doc_date)}</td><td>${timeOf(c.at)}</td><td>${esc(c.product_name)}</td>
              <td class="num">${money(c.old_price)}</td><td class="num">${money(c.new_price)}</td>
              <td><span class="link" data-s="${c.shift_id}">#${fa(c.shift_id)}</span></td>
              <td class="muted-s">${esc(c.created_by_name || '—')}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : ''}
        ${d.rows.length ? h`<div class="card stack">
          <div class="card-title">نرخ‌های ثبت‌شده</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>نافذ از</th><th>محصول</th><th>استیشن</th><th class="num">نرخ</th>
              <th>اسعار</th><th>ثبت‌کننده</th><th>توضیح</th></tr></thead>
            <tbody>${d.rows.map(p => h`<tr>
              <td>${sh(p.effective_from)}</td><td>${esc(p.product_name)}</td>
              <td>${esc(p.station_name || 'همه')}</td><td class="num">${money(p.price)}</td>
              <td>${esc(p.currency)}</td><td class="muted-s">${esc(p.created_by_name || '—')}</td>
              <td class="muted-s">${esc(p.note || '')}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : UI.empty('در این بازه نرخی ثبت نشده')}
      </div>`;
    bindFilter(view, 'prices');
    view.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go('#/shifts/' + b.dataset.s));
  }

  /* ---------------- کالیبراسیون و مهر ---------------- */
  async function calibration(view, r) {
    const d = await API.get('/reports/calibration', q());
    const badge = x => x.expired ? UI.chip('وقتش گذشته', 'red')
      : (x.due_soon ? UI.chip('نزدیک ختم', 'yellow')
        : (x.missing ? UI.chip('تاریخ ثبت نشده', 'grey') : UI.chip('در وقت', 'mint')));

    view.innerHTML = h`
      <div class="pad section stack">
        ${head('کالیبراسیون و مهر', 'کنترول تا ' + fa(d.days) + ' روز آینده')}
        <div class="row no-print">
          <button class="btn-ghost" type="button" onclick="window.print()">${ICON('print', 16)} چاپ</button>
          <button class="btn-ghost" type="button" data-back-rep>راپورهای دیگر</button>
        </div>

        <div class="card stack">
          <div class="card-title">تانک‌ها — جدول سنجش</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>تانک</th><th>استیشن</th><th class="num">نسخه</th><th>نافذ از</th>
              <th class="num">نقاط</th><th>سرتیفیکیت</th><th>کنترول بعدی</th><th>وضعیت</th></tr></thead>
            <tbody>${d.tanks.map(t => h`<tr class="clickable" data-t="${t.id}">
              <td>${esc(t.code)} — ${esc(t.name)}</td><td class="muted-s">${esc(t.station_name)}</td>
              <td class="num">${t.version ? fa(t.version) : '—'}</td>
              <td>${t.effective_from ? sh(t.effective_from) : '—'}</td>
              <td class="num">${fa(t.point_count || 0)}</td>
              <td class="muted-s">${esc(t.certificate_no || '—')}</td>
              <td>${t.next_check ? sh(t.next_check) : '—'}</td>
              <td>${badge(t)}${t.linear_warning ? ' ' + UI.chip('جدول تخمینی', 'yellow') : ''}</td>
            </tr>`).join('')}</tbody></table></div>
          ${d.tanks.some(t => t.linear_warning) ? UI.banner('warn',
      'بعضی تانک‌ها جدول سنجش تخمینی دارند. عدد دیپ آن‌ها دقیق نیست — '
      + 'جدول رسمی سنجش را از اداره معیارات بگیرید و وارد کنید.') : ''}
        </div>

        <div class="card stack">
          <div class="card-title">نازل‌ها — کالیبراسیون کنتور</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>نازل</th><th>تانک</th><th class="num">ضریب</th><th>آخرین کنترول</th>
              <th>کنترول بعدی</th><th class="num">سوابق</th><th>وضعیت</th></tr></thead>
            <tbody>${d.nozzles.map(x => h`<tr>
              <td>${esc(x.dispenser_code)} / ${esc(x.code)}</td><td>${esc(x.tank_code)}</td>
              <td class="num">${fa(x.meter_factor)}</td>
              <td>${x.calib_date ? sh(x.calib_date) : '—'}</td>
              <td>${x.next_check ? sh(x.next_check) : '—'}</td>
              <td class="num">${fa(x.history_count)}</td>
              <td>${badge(x)}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>

        ${d.seals.length ? h`<div class="card stack">
          <div class="card-title">مهرهای فعال</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>تجهیز</th><th class="num">شماره</th><th>شماره مهر</th><th>تاریخ نصب</th><th>نصب‌کننده</th></tr></thead>
            <tbody>${d.seals.map(s => h`<tr>
              <td>${esc({ nozzle: 'نازل', dispenser: 'دستگاه', tank: 'تانک' }[s.entity] || s.entity)}</td>
              <td class="num">${fa(s.entity_id)}</td><td>${esc(s.seal_no)}</td>
              <td>${sh(s.applied_on)}</td><td class="muted-s">${esc(s.applied_by || '—')}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : ''}
      </div>`;
    const b = view.querySelector('[data-back-rep]');
    if (b) b.onclick = () => go('#/reports');
    view.querySelectorAll('[data-t]').forEach(x => x.onclick = () => go('#/tanks/' + x.dataset.t));
  }

  /* ---------------- موجودی امانتی ---------------- */
  async function consignment(view, r) {
    const d = await API.get('/reports/consignment', q());
    view.innerHTML = h`
      <div class="pad section stack">
        ${head('موجودی امانتی', 'مال خود ما در برابر تیل امانتی دیگران')}
        <div class="row no-print">
          <button class="btn-ghost" type="button" onclick="window.print()">${ICON('print', 16)} چاپ</button>
          <button class="btn-ghost" type="button" data-back-rep>راپورهای دیگر</button>
        </div>
        ${d.enabled ? '' : UI.banner('info',
      'ماژول امانتی خاموش است. اگر تیل امانتی دیگران را نگه می‌دارید، '
      + 'از تنظیمات ← عمومی آن را روشن کنید.')}
        <div class="grid-3 keep">
          ${UI.stat(L(d.totals.physical_l), 'موجودی فزیکی (لیتر)')}
          ${UI.stat(L(d.totals.owned_l), 'مال خود ما')}
          ${UI.stat(L(d.totals.consigned_l), 'امانتی دیگران')}
        </div>
        <div class="card"><div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>تانک</th><th>محصول</th><th class="num">فزیکی</th>
            <th class="num">مال ما</th><th class="num">امانتی</th><th>صاحبان</th></tr></thead>
          <tbody>${d.rows.map(x => h`<tr>
            <td>${esc(x.code)} — ${esc(x.name)}</td><td>${esc(x.product_name)}</td>
            <td class="num">${L(x.physical_l)}</td><td class="num">${L(x.owned_l)}</td>
            <td class="num ${x.consigned_l > 0 ? 't-pos' : ''}">${L(x.consigned_l)}</td>
            <td class="muted-s">${x.owners.length
        ? x.owners.map(o => esc(o.party_name) + ' (' + L(o.qty_l) + ')').join('، ') : '—'}</td>
          </tr>`).join('')}</tbody></table></div></div>
      </div>`;
    const b = view.querySelector('[data-back-rep]');
    if (b) b.onclick = () => go('#/reports');
  }

  /* ============================================================
     هشدارها
     ============================================================ */
  const SEV = { high: 'بلند', medium: 'متوسط', low: 'پایین' };
  page('alerts', async function (view, r) {
    const showResolved = r.q.resolved === '1';
    const rows = await API.get('/alerts', Object.assign({ resolved: showResolved ? '1' : '' }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">هشدارها</div>
          <div class="segs">
            <button class="seg ${!showResolved ? 'on' : ''}" data-f="">باز</button>
            <button class="seg ${showResolved ? 'on' : ''}" data-f="1">همه</button>
          </div>
        </div>
        ${rows.length ? h`<div class="stack-s">${rows.map(a => h`
          <div class="card stack-s">
            <div class="alert-row">
              <span class="alert-dot sev-${a.severity}"></span>
              <div class="grow">
                <div class="row-b">
                  <div class="drow-t">${esc(a.title)}</div>
                  ${UI.chip(SEV[a.severity] || a.severity, a.severity === 'high' ? 'red' : (a.severity === 'medium' ? 'orange' : 'grey'))}
                </div>
                <div class="muted-s" style="margin-top:.3rem">${esc(a.detail || '')}</div>
                <div class="muted-s" style="margin-top:.35rem">${dt(a.at)}${a.station_name ? ' · ' + esc(a.station_name) : ''} · کد ${esc(a.code)}</div>
                ${a.resolved ? h`<div class="muted-s" style="margin-top:.35rem">بسته شد: ${esc(a.resolve_note || '')}</div>` : ''}
              </div>
              ${!a.resolved && can('ops') ? h`<button class="btn-ghost btn-sm" data-res="${a.id}">بستن</button>` : ''}
            </div>
          </div>`).join('')}</div>`
        : UI.empty(showResolved ? 'هشداری وجود ندارد' : 'هیچ هشدار بازی نیست — همه چیز نورمال')}
      </div>`;
    view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => go('#/alerts' + (b.dataset.f ? '?resolved=1' : '')));
    view.querySelectorAll('[data-res]').forEach(b => b.onclick = () => {
      const ov = sheet('بستن هشدار', h`
        <form id="alF" class="stack">
          ${UI.field('دلیل / اقدام انجام‌شده', h`<textarea class="input" name="note" placeholder="اجباری — چه کردید؟"></textarea>`)}
          <button class="btn btn-primary btn-block" type="submit">بستن هشدار</button>
        </form>`);
      ov.querySelector('#alF').onsubmit = async ev => {
        ev.preventDefault();
        try {
          await API.post('/alerts/' + b.dataset.res + '/resolve', readForm(ev.target));
          closeSheet(); ok('هشدار بسته شد'); render();
        } catch (e) { err(e.message); }
      };
    });
  });

  /* ============================================================
     تنظیمات
     ============================================================ */
  const TABS = [
    { k: 'stations', t: 'استیشن‌ها' }, { k: 'products', t: 'محصولات' },
    { k: 'tanks', t: 'تانک‌ها' }, { k: 'nozzles', t: 'دستگاه و نازل' },
    { k: 'users', t: 'کاربران', cap: 'admin' }, { k: 'general', t: 'عمومی' },
    { k: 'backup', t: 'بکاپ', cap: 'setup' }, { k: 'audit', t: 'ثبت وقایع', cap: 'admin' }
  ];

  page('setup', async function (view, r) {
    const tab = r.q.t || 'stations';
    const body = await ({
      stations: setupStations, products: setupProducts, tanks: setupTanks,
      nozzles: setupNozzles, users: setupUsers, general: setupGeneral,
      backup: setupBackup, audit: setupAudit
    }[tab] || setupStations)();

    view.innerHTML = h`
      <div class="pad section stack">
        <div class="section-title">تنظیمات</div>
        <div class="segs">${TABS.filter(x => !x.cap || can(x.cap))
        .map(x => h`<button class="seg ${x.k === tab ? 'on' : ''}" data-t="${x.k}">${esc(x.t)}</button>`).join('')}</div>
        ${body.html}
      </div>`;
    view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => go('#/setup?t=' + b.dataset.t));
    if (body.bind) body.bind(view);
  });

  async function setupStations() {
    const rows = await API.get('/stations');
    return {
      html: h`
        <div class="row-b">
          <div class="card-title">استیشن‌ها</div>
          ${can('setup') ? h`<button class="btn btn-primary" data-new>استیشن جدید</button>` : ''}
        </div>
        <div class="stack-s">${rows.map(s => h`
          <div class="drow">
            <div class="drow-main">
              <div class="drow-t">${esc(s.name)} <span class="muted-s">(${esc(s.code)})</span></div>
              <div class="drow-s">${esc(s.province || '')}${s.phone ? ' · ' + esc(s.phone) : ''}
                ${s.license_no ? ' · جواز ' + esc(s.license_no) : ''}${s.license_expiry ? ' · انقضا ' + sh(s.license_expiry) : ''}</div>
            </div>
            ${s.active ? UI.chip('فعال', 'mint') : UI.chip('غیرفعال', 'grey')}
            ${can('setup') ? h`<button class="btn-ghost btn-sm" data-ed='${esc(JSON.stringify(s))}'>ویرایش</button>` : ''}
          </div>`).join('')}</div>`,
      bind(view) {
        const nb = view.querySelector('[data-new]');
        if (nb) nb.onclick = () => stationForm();
        view.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => stationForm(JSON.parse(b.dataset.ed)));
      }
    };
  }
  function stationForm(s) {
    const ov = sheet(s ? 'ویرایش استیشن' : 'استیشن جدید', h`
      <form id="stF" class="stack">
        <div class="grid-2 keep">
          ${s ? '' : UI.field('کد', UI.input('code', { ph: 'ST02' }))}
          ${UI.field('نام', UI.input('name', { value: s && s.name }))}
          ${UI.field('ولایت', UI.input('province', { value: s && s.province }))}
          ${UI.field('تلفن', UI.input('phone', { value: s && s.phone }))}
          ${UI.field('شماره جواز', UI.input('license_no', { value: s && s.license_no }))}
          ${UI.dateField('انقضای جواز', 'license_expiry', s && s.license_expiry)}
        </div>
        ${UI.field('آدرس', UI.input('address', { value: s && s.address }))}
        ${s ? h`<label class="row" style="gap:.4rem"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> <span>فعال</span></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">ذخیره</button>
      </form>`);
    ov.querySelector('#stF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(ev.target);
        if (s) await API.put('/stations/' + s.id, d); else await API.post('/stations', d);
        closeSheet(); S.meta = null; ok('ذخیره شد'); render();
      } catch (e) { err(e.message); }
    };
  }

  async function setupProducts() {
    const rows = await API.get('/products');
    const GRP = { gasoline: 'پطرول', diesel: 'دیزل', jet: 'تیل خاک/جت', lpg: 'گاز مایع', crude: 'خام', none: 'بدون تصحیح' };
    return {
      html: h`
        <div class="row-b">
          <div class="card-title">محصولات</div>
          ${can('setup') ? h`<button class="btn btn-primary" data-new>محصول جدید</button>` : ''}
        </div>
        <div class="stack-s">${rows.map(p => h`
          <div class="drow">
            <div class="tank-icon" style="background:${p.color}22;color:${p.color}">${ICON('drop', 18)}</div>
            <div class="drow-main">
              <div class="drow-t">${esc(p.name)} <span class="muted-s">(${esc(p.code)})</span></div>
              <div class="drow-s">${esc(p.uom)} · گروه ${esc(GRP[p.density_group] || p.density_group)}
                · دانسیته ${fa(p.default_density)} · تولرانس ${fa(p.tolerance_pct)}٪</div>
            </div>
            ${p.is_mass ? UI.chip('بر اساس وزن', 'orange') : ''}
            ${can('setup') ? h`<button class="btn-ghost btn-sm" data-ed='${esc(JSON.stringify(p))}'>ویرایش</button>` : ''}
          </div>`).join('')}</div>`,
      bind(view) {
        const nb = view.querySelector('[data-new]');
        if (nb) nb.onclick = () => productForm();
        view.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => productForm(JSON.parse(b.dataset.ed)));
      }
    };
  }
  function productForm(p) {
    const ov = sheet(p ? 'ویرایش محصول' : 'محصول جدید', h`
      <form id="pdF" class="stack">
        <div class="grid-2 keep">
          ${p ? '' : UI.field('کد', UI.input('code'))}
          ${UI.field('نام', UI.input('name', { value: p && p.name }))}
          ${UI.field('واحد', UI.select('uom', [{ v: 'لیتر', t: 'لیتر' }, { v: 'کیلوگرام', t: 'کیلوگرام' }, { v: 'عدد', t: 'عدد' }], p ? p.uom : 'لیتر'))}
          ${UI.field('گروه دانسیته', UI.select('density_group', [
      { v: 'gasoline', t: 'پطرول' }, { v: 'diesel', t: 'دیزل / فیول اویل' },
      { v: 'jet', t: 'تیل خاک / جت' }, { v: 'lpg', t: 'گاز مایع' },
      { v: 'crude', t: 'خام' }, { v: 'none', t: 'بدون تصحیح حرارت' }], p ? p.density_group : 'diesel'))}
          ${UI.field('دانسیته پیش‌فرض 15°', UI.input('default_density', { type: 'number', value: p ? p.default_density : 0.84 }))}
          ${UI.field('تولرانس کسری ٪', UI.input('tolerance_pct', { type: 'number', value: p ? p.tolerance_pct : 0.5 }))}
        </div>
        ${UI.field('رنگ', UI.input('color', { value: p ? p.color : '#0B8457', type: 'color' }))}
        <label class="row" style="gap:.4rem"><input type="checkbox" name="is_mass" ${p && p.is_mass ? 'checked' : ''}> <span>بر اساس وزن (کیلوگرام) — گاز مایع</span></label>
        ${p ? h`<label class="row" style="gap:.4rem"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> <span>فعال</span></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">ذخیره</button>
      </form>`);
    ov.querySelector('#pdF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(ev.target);
        if (p) await API.put('/products/' + p.id, d); else await API.post('/products', d);
        closeSheet(); S.meta = null; ok('ذخیره شد'); render();
      } catch (e) { err(e.message); }
    };
  }

  async function setupTanks() {
    const rows = await API.get('/tanks', {});
    return {
      html: h`
        <div class="row-b">
          <div class="card-title">تانک‌ها</div>
          ${can('setup') ? h`<button class="btn btn-primary" data-new>تانک جدید</button>` : ''}
        </div>
        <div class="stack-s">${rows.map(t => h`
          <div class="drow">
            <div class="tank-icon" style="background:${t.color}22;color:${t.color}">${ICON('tank', 18)}</div>
            <div class="drow-main">
              <div class="drow-t">${esc(t.code)} — ${esc(t.name)}</div>
              <div class="drow-s">${esc(t.station_name)} · ${esc(t.product_name)} · ظرفیت ${L(t.capacity_l)}</div>
            </div>
            ${t.calib_points ? UI.chip(fa(t.calib_points) + ' نقطه سنجش', 'mint') : UI.chip('بدون جدول سنجش', 'red')}
            <button class="btn-ghost btn-sm" data-calib='${esc(JSON.stringify(t))}'>جدول سنجش</button>
            ${can('setup') ? h`<button class="btn-ghost btn-sm" data-ed='${esc(JSON.stringify(t))}'>ویرایش</button>` : ''}
          </div>`).join('')}</div>`,
      bind(view) {
        const nb = view.querySelector('[data-new]');
        if (nb) nb.onclick = () => window.TankForm();
        view.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => window.TankForm(JSON.parse(b.dataset.ed)));
        view.querySelectorAll('[data-calib]').forEach(b => b.onclick = () => window.CalibForm(JSON.parse(b.dataset.calib)));
      }
    };
  }

  window.TankForm = function (t) {
    const ov = sheet(t ? 'ویرایش تانک' : 'تانک جدید', h`
      <form id="tkF" class="stack">
        ${t ? '' : h`<div class="grid-2 keep">
          ${UI.field('استیشن', UI.select('station_id', S.meta.stations.map(s => ({ v: s.id, t: s.name })), S.stationId || (S.meta.stations[0] && S.meta.stations[0].id)))}
          ${UI.field('محصول', UI.select('product_id', S.meta.products.map(p => ({ v: p.id, t: p.name })), S.meta.products[0] && S.meta.products[0].id))}
        </div>`}
        <div class="grid-2 keep">
          ${t ? '' : UI.field('کد', UI.input('code', { ph: 'T-04' }))}
          ${UI.field('نام', UI.input('name', { value: t && t.name }))}
          ${UI.field('ظرفیت (لیتر)', UI.input('capacity_l', { type: 'number', value: t ? t.capacity_l : 0 }))}
          ${UI.field('ذخیره مرده (لیتر)', UI.input('dead_stock_l', { type: 'number', value: t ? t.dead_stock_l : 0 }))}
          ${UI.field('حد هشدار سطح پایین', UI.input('min_level_l', { type: 'number', value: t ? t.min_level_l : 0 }))}
          ${UI.field('نوع', UI.select('kind', [{ v: 'زیرزمینی', t: 'زیرزمینی' }, { v: 'زمینی', t: 'زمینی' }, { v: 'افقی', t: 'افقی' }], t ? t.kind : 'زیرزمینی'))}
        </div>
        ${t ? '' : h`<div class="grid-2 keep">
          ${UI.field('موجودی افتتاحیه', UI.input('opening_qty', { type: 'number', value: 0 }))}
          ${UI.field('بهای هر واحد افتتاحیه', UI.input('opening_cost', { type: 'number', value: 0 }))}
        </div>`}
        ${t ? h`<label class="row" style="gap:.4rem"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> <span>فعال</span></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">ذخیره</button>
      </form>`);
    ov.querySelector('#tkF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(ev.target);
        if (t) await API.put('/tanks/' + t.id, d);
        else {
          const r = await API.post('/tanks', d);
          closeSheet(); ok('تانک ثبت شد — حالا جدول سنجش را بارگذاری کنید');
          const nt = await API.get('/tanks/' + r.id);
          return window.CalibForm(nt);
        }
        closeSheet(); ok('ذخیره شد'); render();
      } catch (e) { err(e.message); }
    };
  };

  async function setupNozzles() {
    const st = S.stationId || (S.meta.stations[0] && S.meta.stations[0].id);
    const [disp, noz, tanks] = await Promise.all([
      API.get('/dispensers', { station_id: st }),
      API.get('/nozzles', { station_id: st }),
      API.get('/tanks', { station_id: st })
    ]);
    return {
      html: h`
        <div class="row-b">
          <div class="card-title">دستگاه و نازل</div>
          ${can('setup') ? h`<div class="row">
            <button class="btn-ghost" data-newd>دستگاه جدید</button>
            <button class="btn btn-primary" data-newn>نازل جدید</button>
          </div>` : ''}
        </div>
        ${disp.length ? disp.map(d2 => h`
          <div class="card stack-s">
            <div class="row-b">
              <div class="card-title">${esc(d2.name)} <span class="muted-s">(${esc(d2.code)})</span></div>
              ${UI.chip(fa(d2.nozzle_count) + ' نازل', 'mint')}
            </div>
            <div class="hair"></div>
            ${noz.filter(n2 => n2.dispenser_id === d2.id).map(n2 => h`
              <div class="row-b">
                <div>
                  <div class="drow-t">نازل ${esc(n2.code)}</div>
                  <div class="muted-s">${esc(n2.product_name)} · تانک ${esc(n2.tank_code)} · ${fa(n2.meter_digits)} رقم · ضریب ${fa(n2.meter_factor)}</div>
                </div>
                <div class="row">
                  <span class="muted-s">آخرین ریدینگ: <b>${fa(n2.last_reading)}</b></span>
                  ${n2.next_check ? UI.chip('کنترول ' + sh(n2.next_check), 'yellow') : ''}
                  ${can('setup') ? h`<button class="btn-ghost btn-sm" data-cal='${esc(JSON.stringify(n2))}'>مهر و کالیبراسیون</button>` : ''}
                  ${can('setup') ? h`<button class="btn-ghost btn-sm" data-edn='${esc(JSON.stringify(n2))}'>ویرایش</button>` : ''}
                </div>
              </div>`).join('') || h`<div class="muted">نازلی ندارد</div>`}
          </div>`).join('') : UI.empty('دستگاهی ثبت نشده')}`,
      bind(view) {
        const nd = view.querySelector('[data-newd]');
        if (nd) nd.onclick = () => {
          const ov = sheet('دستگاه جدید', h`<form id="dF" class="stack">
            ${UI.field('کد', UI.input('code', { ph: 'D3' }))}
            ${UI.field('نام', UI.input('name', { ph: 'دستگاه 3' }))}
            <button class="btn btn-primary btn-block" type="submit">ثبت</button></form>`);
          ov.querySelector('#dF').onsubmit = async ev => {
            ev.preventDefault();
            try { const d3 = readForm(ev.target); d3.station_id = st; await API.post('/dispensers', d3); closeSheet(); ok('ثبت شد'); render(); }
            catch (e) { err(e.message); }
          };
        };
        const nn = view.querySelector('[data-newn]');
        if (nn) nn.onclick = () => nozzleForm(null, disp, tanks);
        view.querySelectorAll('[data-edn]').forEach(b => b.onclick = () => nozzleForm(JSON.parse(b.dataset.edn), disp, tanks));
        view.querySelectorAll('[data-cal]').forEach(b =>
          b.onclick = () => window.NozzleCalibForm(JSON.parse(b.dataset.cal)));
      }
    };
  }
  function nozzleForm(n2, disp, tanks) {
    if (!disp.length) return err('اول دستگاه ثبت کنید');
    const ov = sheet(n2 ? 'ویرایش نازل ' + n2.code : 'نازل جدید', h`
      <form id="nF" class="stack">
        ${n2 ? '' : UI.field('دستگاه', UI.select('dispenser_id', disp.map(d3 => ({ v: d3.id, t: d3.name })), disp[0].id))}
        ${UI.field('تانک', UI.select('tank_id', tanks.map(t => ({ v: t.id, t: t.code + ' — ' + t.product_name })), n2 && n2.tank_id))}
        <div class="grid-3 keep">
          ${UI.field('کد نازل', UI.input('code', { value: n2 && n2.code, ph: 'N5' }))}
          ${UI.field('ارقام کنتور', UI.input('meter_digits', { type: 'number', value: n2 ? n2.meter_digits : 6 }))}
          ${UI.field('ضریب کنتور', UI.input('meter_factor', { type: 'number', value: n2 ? n2.meter_factor : 1 }))}
        </div>
        ${n2 ? '' : UI.field('قرائت فعلی کنتور', UI.input('last_reading', { type: 'number', value: 0 }))}
        ${n2 ? h`<label class="row" style="gap:.4rem"><input type="checkbox" name="active" ${n2.active ? 'checked' : ''}> <span>فعال</span></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">ذخیره</button>
      </form>`);
    ov.querySelector('#nF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d3 = readForm(ev.target);
        if (n2) await API.put('/nozzles/' + n2.id, d3); else await API.post('/nozzles', d3);
        closeSheet(); ok('ذخیره شد'); render();
      } catch (e) { err(e.message); }
    };
  }

  async function setupUsers() {
    const rows = await API.get('/users');
    return {
      html: h`
        <div class="row-b">
          <div class="card-title">کاربران</div>
          <button class="btn btn-primary" data-new>کاربر جدید</button>
        </div>
        ${UI.banner('warn', 'قاعده تفکیک وظیفه: کسی که دیپ می‌زند نباید فروش ثبت کند، و اپراتور نباید موجودی را تعدیل کند.')}
        <div class="stack-s">${rows.map(u => h`
          <div class="drow">
            <div class="tank-icon" style="width:38px;height:38px">${ICON('user', 18)}</div>
            <div class="drow-main">
              <div class="drow-t">${esc(u.full_name)} <span class="muted-s">(${esc(u.username)})</span></div>
              <div class="drow-s">${esc(u.role_name)}${u.station_name ? ' · ' + esc(u.station_name) : ' · همه استیشن‌ها'}</div>
            </div>
            ${u.active ? UI.chip('فعال', 'mint') : UI.chip('غیرفعال', 'grey')}
            <button class="btn-ghost btn-sm" data-ed='${esc(JSON.stringify(u))}'>ویرایش</button>
          </div>`).join('')}</div>`,
      bind(view) {
        view.querySelector('[data-new]').onclick = () => userForm();
        view.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => userForm(JSON.parse(b.dataset.ed)));
      }
    };
  }
  function userForm(u) {
    const roles = Object.keys(S.meta.role_names).map(k => ({ v: k, t: S.meta.role_names[k] }));
    const ov = sheet(u ? 'ویرایش ' + u.full_name : 'کاربر جدید', h`
      <form id="uF" class="stack">
        <div class="grid-2 keep">
          ${u ? '' : UI.field('نام کاربری', UI.input('username', { ph: 'latin' }))}
          ${UI.field('نام کامل', UI.input('full_name', { value: u && u.full_name }))}
          ${UI.field('نقش', UI.select('role', roles, u && u.role))}
          ${UI.field('استیشن', UI.select('station_id', S.meta.stations.map(s => ({ v: s.id, t: s.name })), u && u.station_id, { blank: 'همه استیشن‌ها' }))}
        </div>
        ${UI.field(u ? 'پین جدید (خالی = بدون تغییر)' : 'پین', UI.input('pin', { type: 'password', ph: '••••' }), 'حداقل 4 رقم')}
        ${u ? h`<label class="row" style="gap:.4rem"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> <span>فعال</span></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">ذخیره</button>
      </form>`);
    ov.querySelector('#uF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(ev.target);
        d.pin = toLatin(d.pin);
        if (u) { if (!d.pin) delete d.pin; await API.put('/users/' + u.id, d); }
        else await API.post('/users', d);
        closeSheet(); ok('ذخیره شد'); render();
      } catch (e) { err(e.message); }
    };
  }

  async function setupGeneral() {
    const [s, fx] = await Promise.all([API.get('/settings'), API.get('/fx')]);
    const chk = (name, on, label, hint) => h`
      <div class="row-b">
        <div>
          <div class="body-1">${esc(label)}</div>
          ${hint ? h`<div class="muted-s">${esc(hint)}</div>` : ''}
        </div>
        <label class="row" style="gap:.4rem">
          <input type="checkbox" name="${name}" ${on ? 'checked' : ''}>
          <span class="muted-s">فعال</span>
        </label>
      </div>`;

    return {
      html: h`
        <div class="card stack">
          <div class="card-title">تنظیمات عمومی</div><div class="hair"></div>
          <form id="gF" class="stack">
            <div class="grid-2 keep">
              ${UI.field('نام شرکت', UI.input('company_name', { value: s.company_name }))}
              ${UI.field('اسعار پایه دفاتر', UI.select('base_currency', [
        { v: 'AFN', t: 'افغانی' }, { v: 'USD', t: 'دالر امریکایی' }], s.base_currency))}
              ${UI.field('حد مجاز کسر صندوق', UI.input('cash_tolerance', { type: 'number', value: s.cash_tolerance }), 'کمتر از این مقدار هشدار نمی‌دهد')}
              ${UI.field('حد پرش دیپ ٪', UI.input('dip_jump_pct', { type: 'number', value: s.dip_jump_pct }), 'تغییر بیش از این درصد ظرفیت = هشدار')}
            </div>

            <div class="hair"></div>
            <div class="card-title" style="font-size:1rem">بخش‌های اختیاری</div>
            <div class="muted-s">وقتی خاموش‌اند، هیچ خانه یا منوی اضافی نشان داده نمی‌شود.</div>
            ${chk('consignment_on', s.consignment_on, 'تیل امانتی',
          'اگر تیل دیگران را در تانک خود نگه می‌دارید')}
            ${chk('orders_on', s.orders_on, 'پیش‌خرید و پیش‌فروش',
          'ثبت معامله‌ای که هنوز تحویل نشده')}
            ${chk('quality_on', s.quality_on, 'کنترول کیفیت محموله',
          'ثبت نتیجه لابراتوار روی ورود تیل')}
            ${chk('transfer_require_dip', s.transfer_require_dip, 'دیپ اجباری در انتقال تیل',
          'دیپ قبل و بعد انتقال حتماً پرسیده شود')}

            ${can('setup') ? h`<button class="btn btn-primary" type="submit" style="align-self:flex-start">ذخیره</button>` : ''}
          </form>
        </div>

        <div class="card stack">
          <div class="row-b">
            <div class="card-title">نرخ اسعار</div>
            ${can('finance') ? h`<button class="btn-ghost btn-sm" data-newfx>ثبت نرخ امروز</button>` : ''}
          </div>
          <div class="hair"></div>
          ${fx.current.length ? fx.current.map(c => h`<div class="row-b">
            <span class="body-1">۱ ${esc(c.ccy)}</span>
            <span class="num-strong">${c.rate > 0 ? money(c.rate) + ' ' + esc(fx.base_currency)
          : '<span class="muted-s">ثبت نشده</span>'}</span>
          </div>`).join('') : h`<div class="muted">نرخی ثبت نشده</div>`}
          <div class="muted-s">نرخ هر معامله روی خود سند می‌ماند و با ثبت نرخ جدید تغییر نمی‌کند.</div>
        </div>

        <div class="card stack">
          <div class="card-title">درباره سیستم</div><div class="hair"></div>
          <div class="muted">سیستم مدیریت تانک تیل و پمپ استیشن — ساخته‌شده برای شرایط واقعی افغانستان.
            کار آفلاین، تقویم هجری شمسی، دفتر موجودی تغییرناپذیر، تحلیل ضد-تقلب.</div>
        </div>`,
      bind(view) {
        const f = view.querySelector('#gF');
        if (f) onSubmit(f, async d => {
          delete d.idem_key;
          await API.post('/settings', d);
          S.meta = null; ok('ذخیره شد'); render();
        });
        const nf = view.querySelector('[data-newfx]');
        if (nf) nf.onclick = () => {
          const ov = sheet('ثبت نرخ اسعار', h`
            <form id="fxF" class="stack">
              ${UI.field('اسعار', UI.select('ccy',
            (S.meta.currencies || ['USD']).filter(c => c !== S.meta.base_currency)
              .map(c => ({ v: c, t: c })), 'USD'))}
              ${UI.field('۱ واحد چند ' + S.meta.base_currency + ' است؟',
            UI.input('rate', { type: 'number', cls: 'big', ph: '68.5' }))}
              ${UI.dateField('تاریخ', 'rate_date')}
              ${UI.field('توضیح', UI.input('note'))}
              <button class="btn btn-primary btn-block" type="submit">ثبت</button>
            </form>`);
          onSubmit(ov.querySelector('#fxF'), async d => {
            await API.post('/fx', d);
            closeSheet(); ok('نرخ ثبت شد'); render();
          });
        };
      }
    };
  }

  /* ---------------- بکاپ ---------------- */
  const KB = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';

  async function setupBackup() {
    const s = await API.get('/backup');
    const hours = s.hours_since;
    const state = hours === null ? { k: 'warn', t: 'هنوز هیچ بکاپی گرفته نشده است' }
      : (hours > Number(s.auto_hours) * 2
        ? { k: 'error', t: 'آخرین بکاپ ' + fa(Math.round(hours)) + ' ساعت پیش بوده — بکاپ بگیرید' }
        : { k: 'ok', t: 'آخرین بکاپ ' + fa(Math.round(hours)) + ' ساعت پیش گرفته شده' });

    return {
      html: h`
        <div class="card stack">
          <div class="row-b">
            <div class="card-title">بکاپ دیتابیس</div>
            ${can('setup') ? h`<button class="btn btn-primary" data-now>گرفتن بکاپ حالا</button>` : ''}
          </div>
          <div class="hair"></div>
          ${UI.banner(state.k, state.t)}
          <div class="grid-3 keep">
            ${UI.stat(s.last_at ? dt(s.last_at) : '—', 'آخرین بکاپ')}
            ${UI.stat(KB(s.db_size_bytes), 'حجم دیتابیس')}
            ${UI.stat(fa(s.files.length), 'بکاپ موجود')}
          </div>
          <div class="row-b">
            <span class="muted">محل بکاپ</span>
            <span class="muted-s" dir="ltr">${esc(s.dir)}</span>
          </div>
          ${UI.banner('info', 'قاعده: هر شب یک بکاپ بگیرید و روی USB یا کمپیوتر دیگر کاپی کنید. '
        + 'اگر هارد خراب شود، تنها همان کاپی بیرونی شما را نجات می‌دهد.')}
        </div>

        <div class="card stack">
          <div class="card-title">تنظیمات بکاپ</div><div class="hair"></div>
          <form id="bsF" class="stack">
            <div class="row-b">
              <div><div class="body-1">بکاپ خودکار روزانه</div>
                <div class="muted-s">سیستم خودش هر روز یک بکاپ می‌گیرد</div></div>
              <label class="row" style="gap:.4rem">
                <input type="checkbox" name="backup_auto" ${s.auto ? 'checked' : ''}>
                <span class="muted-s">فعال</span></label>
            </div>
            <div class="grid-2 keep">
              ${UI.field('هر چند ساعت یک بار', UI.input('backup_auto_hours', { type: 'number', value: s.auto_hours }))}
              ${UI.field('چند بکاپ خودکار نگه داشته شود', UI.input('backup_keep', { type: 'number', value: s.keep }))}
            </div>
            ${UI.field('پوشه بکاپ', UI.input('backup_dir', { value: s.dir === s.default_dir ? '' : s.dir, attrs: 'dir=ltr' }),
          'خالی = پوشه backups داخل برنامه. برای ذخیره روی درایو دیگر یا USB، مسیر کامل را بنویسید — مثلاً D:\\pump-backup')}
            ${can('setup') ? h`<button class="btn btn-primary" type="submit" style="align-self:flex-start">ذخیره</button>` : ''}
          </form>
        </div>

        <div class="card stack">
          <div class="card-title">بکاپ‌های موجود</div><div class="hair"></div>
          ${s.files.length ? h`<div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>نام فایل</th><th>وقت</th><th class="num">حجم</th>
              ${can('admin') ? '<th></th>' : ''}</tr></thead>
            <tbody>${s.files.map(fl => h`<tr>
              <td dir="ltr" style="text-align:start">${esc(fl.name)}</td>
              <td>${dt(fl.mtime)}</td><td class="num">${esc(KB(fl.size_bytes))}</td>
              ${can('admin') ? h`<td><button class="btn-ghost btn-sm" data-restore='${esc(fl.path)}'>برگرداندن</button></td>` : ''}
            </tr>`).join('')}</tbody></table></div>`
        : h`<div class="muted">هیچ فایل بکاپی در این پوشه نیست</div>`}
        </div>`,
      bind(view) {
        const nb = view.querySelector('[data-now]');
        if (nb) nb.onclick = async () => {
          nb.disabled = true; nb.textContent = 'در حال گرفتن بکاپ…';
          try {
            const r = await API.post('/backup/now', {});
            ok('بکاپ گرفته شد — ' + KB(r.size_bytes));
            render();
          } catch (e) { err(e.message); nb.disabled = false; nb.textContent = 'گرفتن بکاپ حالا'; }
        };
        const f = view.querySelector('#bsF');
        if (f) onSubmit(f, async d => {
          delete d.idem_key;
          await API.post('/settings', d);
          ok('ذخیره شد'); render();
        });
        view.querySelectorAll('[data-restore]').forEach(b =>
          b.onclick = () => RestoreForm(b.dataset.restore));
      }
    };
  }

  /* برگرداندن بکاپ — با کنترول سلامت و بکاپ اضطراری */
  async function RestoreForm(file) {
    let v;
    try { v = await API.post('/backup/validate', { file }); }
    catch (e) { return err(e.message); }

    const info = v.info || {};
    const ov = sheet('برگرداندن بکاپ', h`
      <div class="stack" id="rsBox">
        <div class="card card-flat stack-s">
          <div class="row-b"><span class="muted">فایل</span>
            <span class="muted-s" dir="ltr">${esc(file.split(/[\\/]/).pop())}</span></div>
          <div class="row-b"><span class="muted">وقت ساخت</span><span>${dt(info.mtime)}</span></div>
          <div class="row-b"><span class="muted">استیشن</span><span>${esc(info.station || '—')}</span></div>
          <div class="row-b"><span class="muted">تعداد کاربر</span><span>${fa(info.users || 0)}</span></div>
          <div class="row-b"><span class="muted">حرکت موجودی</span><span>${fa(info.stock_moves || 0)}</span></div>
        </div>
        ${v.ok ? UI.banner('ok', 'کنترول سلامت این فایل موفق بود.')
        : UI.banner('error', 'این فایل سالم نیست: ' + esc((v.problems || []).join('؛ ')))}
        ${v.ok ? h`
          <div class="banner banner-error"><div>
            <b>هشدار:</b> با برگرداندن این بکاپ، تمام معاملات ثبت‌شده بعد از
            ${dt(info.mtime)} از بین می‌رود.<br>
            قبل از برگرداندن، سیستم خودش یک بکاپ اضطراری از وضعیت فعلی می‌گیرد.<br>
            بعد از برگرداندن، همه کاربران باید دوباره وارد شوند.
          </div></div>
          ${UI.field('برای تایید، کلمه <b>برگردان</b> را بنویسید',
          h`<input class="input" id="rsConfirm" placeholder="برگردان">`)}
          <button class="btn btn-danger btn-block" id="rsGo">برگرداندن این بکاپ</button>` : ''}
      </div>`);

    const go = ov.querySelector('#rsGo');
    if (go) go.onclick = async () => {
      const t = (ov.querySelector('#rsConfirm').value || '').trim();
      if (t !== 'برگردان') return err('برای تایید، کلمه «برگردان» را دقیقاً بنویسید');
      go.disabled = true; go.textContent = 'در حال برگرداندن…';
      try {
        const r = await API.post('/backup/restore', { file, confirm: true });
        closeSheet();
        ok('بکاپ برگردانده شد. دوباره وارد سیستم شوید.');
        setTimeout(() => logout(), 1200);
        return r;
      } catch (e) { err(e.message); go.disabled = false; go.textContent = 'برگرداندن این بکاپ'; }
    };
  }

  async function setupAudit() {
    const rows = await API.get('/audit', { limit: 250 });
    return {
      html: h`
        <div class="card stack">
          <div class="card-title">ثبت وقایع — تغییرناپذیر</div><div class="hair"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>وقت</th><th>کاربر</th><th>عمل</th><th>موضوع</th><th>جزئیات</th></tr></thead>
            <tbody>${rows.map(a => h`<tr>
              <td>${dt(a.at)}</td><td>${esc(a.user_name || '—')}</td>
              <td>${esc(a.action)}</td><td class="muted-s">${esc(a.entity || '')}${a.entity_id ? ' #' + fa(a.entity_id) : ''}</td>
              <td class="muted-s">${esc(a.detail || '')}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>`
    };
  }

  /* ============================================================
     جستجو
     ============================================================ */
  page('search', async function (view, r) {
    const term = (r.q.q || '').trim();
    if (!term) return go('#/dashboard');
    const t = term.toLowerCase();
    const [tanks, parties, receipts, nozzles] = await Promise.all([
      API.get('/tanks', {}), API.get('/parties', {}),
      API.get('/receipts', { limit: 300 }), API.get('/nozzles', {})
    ]);
    const mt = tanks.filter(x => (x.code + x.name + x.product_name).toLowerCase().includes(t));
    const mp = parties.filter(x => (x.name + (x.code || '') + (x.phone || '')).toLowerCase().includes(t));
    const mr = receipts.filter(x => ((x.waybill_no || '') + (x.truck_plate || '') + (x.seal_in || '') + (x.driver_name || '')).toLowerCase().includes(t));
    const mn = nozzles.filter(x => (x.code + x.dispenser_code).toLowerCase().includes(t));
    const total = mt.length + mp.length + mr.length + mn.length;

    view.innerHTML = h`
      <div class="pad section stack">
        <div class="section-title">نتیجه جستجو: «${esc(term)}»</div>
        ${!total ? UI.empty('چیزی یافت نشد') : ''}
        ${mt.length ? h`<div class="card stack-s"><div class="card-title">تانک‌ها</div><div class="hair"></div>
          ${mt.map(x => h`<div class="row-b link" data-t="${x.id}"><span>${esc(x.code)} — ${esc(x.name)}</span>
            <span class="num-strong">${L(x.book_l)}</span></div>`).join('')}</div>` : ''}
        ${mp.length ? h`<div class="card stack-s"><div class="card-title">طرف حساب</div><div class="hair"></div>
          ${mp.map(x => h`<div class="row-b link" data-p="${x.id}"><span>${esc(x.name)}</span>
            <span class="num-strong">${money(x.balance)}</span></div>`).join('')}</div>` : ''}
        ${mr.length ? h`<div class="card stack-s"><div class="card-title">تخلیه / بارنامه</div><div class="hair"></div>
          ${mr.map(x => h`<div class="row-b"><span>${esc(x.waybill_no || '—')} · پلیت ${esc(x.truck_plate || '—')}</span>
            <span class="muted-s">${sh(x.doc_date)} · ${L(x.vol_obs_l)} لیتر</span></div>`).join('')}</div>` : ''}
        ${mn.length ? h`<div class="card stack-s"><div class="card-title">نازل</div><div class="hair"></div>
          ${mn.map(x => h`<div class="row-b"><span>${esc(x.dispenser_code)}/${esc(x.code)} — ${esc(x.product_name)}</span>
            <span class="muted-s">تانک ${esc(x.tank_code)}</span></div>`).join('')}</div>` : ''}
      </div>`;
    view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => go('#/tanks/' + b.dataset.t));
    view.querySelectorAll('[data-p]').forEach(b => b.onclick = () => go('#/parties/' + b.dataset.p));
  });
})();
