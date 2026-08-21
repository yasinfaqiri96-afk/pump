/* صفحات: ورود تیل، فروش عمده، طرف حساب و موترها، نرخ، مصارف، انتقال */
(function () {
  'use strict';
  const q = () => (S.stationId ? { station_id: S.stationId } : {});
  const PORTS = ['حیرتان', 'تورغندی', 'اسلام‌قلعه', 'نیمروز', 'تورخم', 'سپین‌بولدک', 'آقینه', 'داخلی'];
  const PAY = [{ v: 'credit', t: 'نسیه' }, { v: 'cash', t: 'نقده' }, { v: 'hawala', t: 'حواله' }, { v: 'bank', t: 'بانک' }];
  const stationId = () => S.stationId || (S.meta.stations[0] && S.meta.stations[0].id);

  /* ---------- اسعار: انتخاب ارز + نرخ خودکار روز ---------- */
  function ccyOptions() {
    return (S.meta.currencies || ['AFN', 'USD']).map(c => ({ v: c, t: CCY_NAME[c] || c }));
  }
  const CCY_NAME = { AFN: 'افغانی', USD: 'دالر', PKR: 'کلدار', IRR: 'تومان', EUR: 'یورو' };

  function ccyFields(amountLabel, amountName) {
    return h`
      <div class="grid-2 keep">
        ${UI.field(amountLabel, UI.input(amountName || 'amount', { type: 'number', cls: 'big' }))}
        ${UI.field('اسعار', UI.select('currency', ccyOptions(), S.meta.base_currency))}
      </div>
      <div class="hide" data-fxbox>
        ${UI.field('نرخ اسعار', UI.input('fx_rate', { type: 'number', value: 1 }),
      'نرخ همین معامله — بعداً تغییر نمی‌کند')}
        <div class="field-calc" data-fxcalc></div>
      </div>`;
  }

  /* نرخ روز را خودکار می‌آورد و مبلغ به افغانی را نشان می‌دهد */
  function bindCcy(form, amountName) {
    const sel = form.querySelector('[name=currency]');
    const box = form.querySelector('[data-fxbox]');
    const rate = form.querySelector('[name=fx_rate]');
    const calc = form.querySelector('[data-fxcalc]');
    if (!sel || !box) return;
    async function sync() {
      const isBase = sel.value === S.meta.base_currency;
      box.classList.toggle('hide', isBase);
      if (isBase) { rate.value = 1; calc.textContent = ''; return; }
      if (num(rate.value) <= 1) {
        try {
          const r = await API.get('/fx/rate', { ccy: sel.value, date: readForm(form).doc_date || '' });
          if (r.rate > 0) rate.value = fa(r.rate);
        } catch (_) { }
      }
      show();
    }
    function show() {
      const d = readForm(form);
      const amt = num(d[amountName || 'amount']), fx = num(d.fx_rate);
      calc.textContent = (amt > 0 && fx > 0)
        ? 'برابر ' + money(amt * fx) + ' ' + S.meta.base_currency
        : 'نرخ اسعار را وارد کنید';
    }
    sel.addEventListener('change', sync);
    form.addEventListener('input', () => { if (sel.value !== S.meta.base_currency) show(); });
    sync();
  }

  /* ============================================================
     ورود تیل / تخلیه — فورم پله‌ای
     ============================================================ */
  page('receipts', async function (view, r) {
    const rows = await API.get('/receipts', Object.assign({ limit: 60 }, q()));
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">ورود تیل — تخلیه تانکر</div>
          ${can('ops') ? h`<button class="btn btn-primary" data-new>ثبت تخلیه جدید</button>` : ''}
        </div>
        ${rows.length ? h`<div class="stack-s">${rows.map(x => h`
          <div class="drow ${x.status === 'reversed' ? 'muted' : ''}">
            <div class="drow-part1">
              <div class="tank-icon" style="background:${x.color}22;color:${x.color}">${ICON('truck', 20)}</div>
              <div class="drow-main">
                <div class="drow-t">${esc(x.waybill_no || 'بدون بارنامه')} — ${esc(x.product_name)}</div>
                <div class="drow-s">${sh(x.doc_date)} · تانک ${esc(x.tank_code)} · ${esc(x.supplier_name || 'بدون تهیه‌کننده')}
                  ${x.truck_plate ? ' · پلیت ' + esc(x.truck_plate) : ''}${x.entry_port ? ' · ' + esc(x.entry_port) : ''}</div>
              </div>
              ${x.status === 'reversed' ? UI.chip('برگشت خورده', 'grey') : ''}
              ${x.owner_party_id ? UI.chip('امانتی', 'blue') : ''}
            </div>
            <div class="drow-part2">
              <div class="drow-item"><span class="k">لیتر</span><span class="v ">${L(x.vol_obs_l)}</span></div>
              <div class="drow-item"><span class="k">تُن</span><span class="v ">${n(x.qty_mt, 3)}</span></div>
              <div class="drow-item"><span class="k">کسری تُن</span><span class="v ${x.variance_mt < 0 ? 'neg' : (x.variance_mt > 0 ? 'pos' : '')}">${n(x.variance_mt, 3)}</span></div>
              <div class="drow-item"><span class="k">بها</span><span class="v ">${money(x.total_cost)}</span></div>
              ${x.quality_result === 'fail' || x.quality_ok === 0 ? UI.chip('کیفیت رد', 'red') : ''}
              ${can('setup') && x.status === 'posted' ? h`<button class="btn-ghost btn-sm" data-rev="${x.id}">برگشت</button>` : ''}
            </div>
          </div>`).join('')}</div>` : UI.empty('هیچ تخلیه‌ای ثبت نشده')}
      </div>`;
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => ReceiptForm(r.q.tank ? Number(r.q.tank) : null);
    view.querySelectorAll('[data-rev]').forEach(b =>
      b.onclick = () => ReverseForm('/receipts/' + b.dataset.rev + '/reverse', 'برگشت سند تخلیه'));
    if (r.q.tank && can('ops')) ReceiptForm(Number(r.q.tank));
  });

  /* فورم عمومی برگشت سند */
  function ReverseForm(url, title) {
    const ov = sheet(title, h`
      <form id="rvF" class="stack">
        ${UI.banner('warn', 'سند حذف نمی‌شود. یک سند معکوس ساخته می‌شود و هر دو در دفتر می‌مانند.')}
        ${UI.field('دلیل برگشت', h`<textarea class="input" name="reason" rows="3"
          placeholder="اجباری — چرا این سند برگشت می‌خورد؟"></textarea>`)}
        ${UI.dateField('تاریخ سند برگشت', 'doc_date')}
        <button class="btn btn-danger btn-block" type="submit">ثبت برگشت</button>
      </form>`);
    onSubmit(ov.querySelector('#rvF'), async d => {
      await API.post(url, d);
      closeSheet(); ok('سند برگشت ثبت شد'); render();
    });
  }
  window.ReverseForm = ReverseForm;

  async function ReceiptForm(tankId) {
    const [tanks, sups, trns] = await Promise.all([
      API.get('/tanks', q()),
      API.get('/parties', { kind: 'supplier' }),
      API.get('/parties', { kind: 'transporter' })
    ]);
    if (!tanks.length) return err('اول تانک ثبت کنید');
    const consign = S.meta.features && S.meta.features.consignment;

    const steps = [
      {
        title: 'تانکر', body: h`
          <div class="grid-2">
            ${UI.dateField('تاریخ', 'doc_date')}
            ${UI.field('شماره بارنامه', UI.input('waybill_no', { ph: 'WB-…' }))}
            ${UI.field('تهیه‌کننده', UI.select('supplier_id', sups.map(x => ({ v: x.id, t: x.name })), '', { blank: '— انتخاب —' }))}
            ${UI.field('نمبر پلیت تانکر', UI.input('truck_plate', { ph: '۱۲۳۴ هرات' }))}
          </div>
          ${UI.more('جزئیات بیشتر تانکر', h`
            <div class="grid-2 keep">
              ${UI.field('ترانسپورتر', UI.select('transporter_id', trns.map(x => ({ v: x.id, t: x.name })), '', { blank: '— انتخاب —' }))}
              ${UI.field('نام راننده', UI.input('driver_name'))}
              ${UI.field('تلفن راننده', UI.input('driver_phone'))}
              ${UI.field('بندر ورود', UI.select('entry_port', PORTS.map(p => ({ v: p, t: p })), '', { blank: '— انتخاب —' }))}
            </div>
            <div class="grid-2 keep">
              ${UI.field('شماره مهر مبدا', UI.input('seal_out'), 'از بارنامه')}
              ${UI.field('شماره مهر مقصد', UI.input('seal_in'), 'مهر واقعی روی تانکر')}
            </div>`)}`
      },
      {
        title: 'مقدار مبدا', body: h`
          ${UI.field('تانک', UI.select('tank_id', tanks.map(t => ({
          v: t.id, t: t.code + ' — ' + t.name + ' (' + t.product_name + ') · موجودی ' + L(t.book_l)
        })), tankId || tanks[0].id))}
          <div class="grid-2 keep">
            ${UI.field('مقدار مبدا (تُن)', UI.input('src_qty_mt', { type: 'number', ph: '0' }),
          'از بارنامه — برای کنترل کسری راه')}
            ${UI.field('ثقلت مبدا', UI.input('src_density15', { type: 'number', ph: '0.84 یا 840' }))}
          </div>
          ${UI.more('جزئیات بیشتر مبدا', h`
            ${UI.field('حرارت مبدا °C', UI.input('src_temp', { type: 'number' }))}
            ${consign ? UI.field('صاحب تیل (امانتی)',
            UI.select('owner_party_id', sups.map(x => ({ v: x.id, t: x.name })), '', { blank: '— مال خود ما —' }),
            'اگر این تیل امانتی است، صاحب آن را انتخاب کنید') : ''}`)}`
      },
      {
        title: 'دیپ', body: h`
          <div class="banner banner-info"><div>قاعده: ۳۰ دقیقه بعد از تخلیه دیپ بزنید تا سطح آرام شود.</div></div>
          <div class="grid-2 keep">
            ${UI.field('دیپ قبل تخلیه (mm)', UI.input('dip_before_mm', { type: 'number', cls: 'big' }))}
            ${UI.field('دیپ بعد تخلیه (mm)', UI.input('dip_after_mm', { type: 'number', cls: 'big' }))}
          </div>
          <div class="grid-2 keep">
            ${UI.field('حرارت نمونه °C', UI.input('temp_c', { type: 'number', ph: '25' }))}
            ${UI.field('ثقلت مقصد', UI.input('density15', { type: 'number', ph: 'خودکار' }))}
          </div>
          ${UI.more('آب ته تانک', h`
            <div class="grid-2 keep">
              ${UI.field('آب قبل (mm)', UI.input('water_before_mm', { type: 'number', value: 0 }))}
              ${UI.field('آب بعد (mm)', UI.input('water_after_mm', { type: 'number', value: 0 }))}
            </div>`)}
          <div id="rcPrev"></div>`
      },
      {
        title: 'قیمت و تایید', body: h`
          <div class="grid-2 keep">
            ${UI.field('قیمت هر لیتر', UI.input('unit_cost', { type: 'number', cls: 'big' }))}
            ${UI.field('نوع پرداخت', UI.select('payment_kind', PAY, 'credit'))}
          </div>
          ${UI.field('مصارف جانبی', UI.input('other_cost', { type: 'number', value: 0 }),
          'کرایه، گمرک، تخلیه — به ' + S.meta.base_currency)}
          ${UI.more('اسعار غیر از ' + S.meta.base_currency, h`
            <div class="grid-2 keep">
              ${UI.field('اسعار', UI.select('currency', ccyOptions(), S.meta.base_currency))}
              ${UI.field('نرخ اسعار', UI.input('fx_rate', { type: 'number', value: 1 }))}
            </div>`)}
          ${UI.more('کنترول کیفیت', h`
            ${UI.field('نتیجه', UI.select('quality_result', [
            { v: 'pass', t: 'تایید' }, { v: 'pending', t: 'در انتظار' }, { v: 'fail', t: 'رد' }], 'pass'))}
            <div class="grid-2 keep">
              ${UI.field('نام لابراتوار', UI.input('lab_name'))}
              ${UI.field('شماره سرتیفیکیت', UI.input('quality_certificate_no'))}
            </div>
            ${UI.field('یادداشت کیفیت', UI.input('quality_note'))}`)}
          ${UI.field('توضیح', UI.input('note', { ph: 'اختیاری' }))}
          <div id="rcSum"></div>`
      }
    ];

    const ov = sheet('ثبت تخلیه تانکر', h`
      <form id="rcF" class="stack">${UI.wizard(steps, 'ثبت تخلیه')}</form>`, { wide: true });

    const f = ov.querySelector('#rcF');
    let timer = null, lastPrev = null;

    async function preview() {
      const d = readForm(f);
      if (!d.dip_after_mm || !d.dip_before_mm) { f.querySelector('#rcPrev').innerHTML = ''; return; }
      try {
        const p = await API.post('/receipts/calc', {
          tank_id: d.tank_id, dip_before_mm: d.dip_before_mm, water_before_mm: d.water_before_mm,
          dip_after_mm: d.dip_after_mm, water_after_mm: d.water_after_mm,
          temp_c: d.temp_c, density15: d.density15, src_qty_mt: d.src_qty_mt
        });
        lastPrev = p;
        f.querySelector('#rcPrev').innerHTML = h`
          <div class="card card-flat stack-s">
            <div class="grid-3 keep">
              <div class="stat"><div class="stat-num sm">${L(p.vol_obs_l)}</div><div class="stat-lbl">حجم ثبت‌شده (لیتر)</div></div>
              <div class="stat"><div class="stat-num sm">${L(p.vol15_l)}</div><div class="stat-lbl">حجم اصلاح‌شده (لیتر)</div></div>
              <div class="stat"><div class="stat-num sm">${n(p.qty_mt, 3)}</div><div class="stat-lbl">تُن متریک</div></div>
            </div>
            <div class="muted-s txt-c">اصلاح بر اساس حرارت و ثقلت خودکار انجام شد
              · جای خالی تانک ${L(p.capacity_free)} لیتر</div>
            ${p.overflow ? UI.banner('error', 'سطح بعد از تخلیه از ظرفیت تانک می‌گذرد. عدد را کنترل کنید.') : ''}
            ${p.over_tolerance ? UI.banner('error', 'کسری راه ' + pct(p.variance_pct)
            + ' از حد مجاز ' + pct(p.tolerance_pct) + ' گذشته — هشدار ثبت می‌شود.') : ''}
          </div>`;
        summary();
      } catch (e) { f.querySelector('#rcPrev').innerHTML = UI.banner('error', esc(e.message)); }
    }

    function summary() {
      const d = readForm(f);
      const box = f.querySelector('#rcSum');
      if (!box || !lastPrev) return;
      const fx = num(d.fx_rate) || 1;
      const goods = num(d.unit_cost) * lastPrev.vol_obs_l * fx;
      const total = goods + num(d.other_cost);
      box.innerHTML = h`
        <div class="card card-flat stack-s">
          <div class="row-b"><span class="muted">حجم دریافتی</span>
            <span class="num-strong">${L(lastPrev.vol_obs_l)} لیتر</span></div>
          <div class="row-b"><span class="muted">بهای تیل</span><span class="num-strong">${money(goods)}</span></div>
          <div class="row-b"><span class="muted">مصارف جانبی</span><span class="num-strong">${money(num(d.other_cost))}</span></div>
          <div class="hair"></div>
          <div class="row-b"><span class="body-1">مجموع بها</span>
            <span class="stat-num sm">${money(total)} ${esc(S.meta.base_currency)}</span></div>
          <div class="row-b"><span class="muted">بهای هر لیتر تمام‌شده</span>
            <span class="num-strong">${n(lastPrev.vol_obs_l > 0 ? total / lastPrev.vol_obs_l : 0, 2)}</span></div>
        </div>`;
    }

    f.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { preview(); summary(); }, 250); });
    f.querySelector('[name=tank_id]').addEventListener('change', preview);

    bindWizard(f, {
      validate(step, d) {
        if (step === 1 && !d.tank_id) { err('تانک را انتخاب کنید'); return false; }
        if (step === 2) {
          if (!d.dip_before_mm || !d.dip_after_mm) { err('دیپ قبل و بعد تخلیه را وارد کنید'); return false; }
          if (num(d.dip_after_mm) <= num(d.dip_before_mm)) {
            err('دیپ بعد از تخلیه باید بزرگتر از دیپ قبل باشد'); return false;
          }
          summary();
        }
        return true;
      }
    });

    onSubmit(f, async d => {
      d.quality_ok = d.quality_result !== 'fail';
      const res = await API.post('/receipts', d);
      closeSheet();
      ok(res.duplicate ? 'این سند قبلاً ثبت شده بود'
        : 'تخلیه ثبت شد — ' + L(res.vol_obs_l) + ' لیتر / ' + n(res.qty_mt, 3) + ' تُن');
      render();
    });
  }
  window.ReceiptForm = ReceiptForm;

  /* ============================================================
     فروش عمده
     ============================================================ */
  page('bulk', async function (view) {
    const rows = await API.get('/bulk', q());
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">فروش عمده — تانکر خروجی</div>
          ${can('ops') ? h`<button class="btn btn-primary" data-new>فروش عمده جدید</button>` : ''}
        </div>
        ${rows.length ? h`<div class="stack-s">${rows.map(x => h`
          <div class="drow">
            <div class="drow-part1">
              <div class="tank-icon" style="background:${x.color}22;color:${x.color}">${ICON('out', 20)}</div>
              <div class="drow-main">
                <div class="drow-t">${esc(x.customer_name || 'نقده')} — ${esc(x.product_name)}</div>
                <div class="drow-s">${sh(x.doc_date)} · ${esc(x.invoice_no || '#' + x.id)} · تانک ${esc(x.tank_code)}
                  ${x.truck_plate ? ' · پلیت ' + esc(x.truck_plate) : ''}</div>
              </div>
              ${x.sale_kind === 'direct' ? UI.chip('فروش مستقیم', 'blue') : ''}
              ${x.status === 'reversed' ? UI.chip('برگشت خورده', 'grey') : ''}
            </div>
            <div class="drow-part2">
              <div class="drow-item"><span class="k">لیتر</span><span class="v ">${L(x.qty_obs)}</span></div>
              <div class="drow-item"><span class="k">نرخ</span><span class="v ">${money(x.unit_price)}</span></div>
              <div class="drow-item"><span class="k">مبلغ</span><span class="v ">${money(x.amount)} ${esc(x.currency)}</span></div>
              ${UI.chip(({ credit: 'نسیه', cash: 'نقده', hawala: 'حواله', bank: 'بانک' })[x.payment_kind] || x.payment_kind,
        x.payment_kind === 'credit' ? 'yellow' : 'mint')}
              ${can('setup') && x.status === 'posted' ? h`<button class="btn-ghost btn-sm" data-rev="${x.id}">برگشت</button>` : ''}
            </div>
          </div>`).join('')}</div>` : UI.empty('هیچ فروش عمده‌ای ثبت نشده')}
      </div>`;
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => BulkForm();
    view.querySelectorAll('[data-rev]').forEach(b =>
      b.onclick = () => ReverseForm('/bulk/' + b.dataset.rev + '/reverse', 'برگشت فروش عمده'));
  });

  async function BulkForm() {
    const [tanks, custs, sups] = await Promise.all([
      API.get('/tanks', q()), API.get('/parties', { kind: 'customer' }),
      API.get('/parties', { kind: 'supplier' })
    ]);
    if (!tanks.length) return err('اول تانک ثبت کنید');

    const ov = sheet('فروش عمده', h`
      <form id="bkF" class="stack">
        <div class="grid-2">
          ${UI.dateField('تاریخ', 'doc_date')}
          ${UI.field('شماره فاکتور', UI.input('invoice_no'))}
          ${UI.field('مشتری', UI.select('customer_id', custs.map(x => ({ v: x.id, t: x.name + '  (بیلانس ' + money(x.balance) + ')' })), '', { blank: '— نقده بدون مشتری —' }))}
          ${UI.field('نوع پرداخت', UI.select('payment_kind', PAY, 'credit'))}
        </div>
        ${UI.field('تانک', UI.select('tank_id', tanks.map(t => ({ v: t.id, t: t.code + ' — ' + t.name + ' · موجودی ' + L(t.book_l) })), tanks[0].id))}
        <div class="grid-2 keep">
          ${UI.field('مقدار (لیتر)', UI.input('qty_obs', { type: 'number', cls: 'big' }))}
          ${UI.field('نرخ هر لیتر', UI.input('unit_price', { type: 'number', ph: 'نرخ‌نامه' }))}
        </div>
        <div id="bkPrev"></div>
        ${UI.more('جزئیات بیشتر', h`
          <div class="grid-2 keep">
            ${UI.field('حرارت °C', UI.input('temp_c', { type: 'number' }))}
            ${UI.field('ثقلت', UI.input('density15', { type: 'number', ph: 'خودکار' }))}
          </div>
          ${UI.field('مبنای قیمت', UI.select('price_basis', [
      { v: 'liter', t: 'هر لیتر (عادی)' }, { v: 'liter15', t: 'هر لیتر در ۱۵ درجه' },
      { v: 'mt', t: 'هر تُن متریک' }], 'liter'))}
          <div class="grid-3 keep">
            ${UI.field('نمبر پلیت', UI.input('truck_plate'))}
            ${UI.field('شماره مهر', UI.input('seal_no'))}
            ${UI.field('راننده', UI.input('driver_name'))}
          </div>
          <div class="grid-2 keep">
            ${UI.field('اسعار', UI.select('currency', ccyOptions(), S.meta.base_currency))}
            ${UI.field('نرخ اسعار', UI.input('fx_rate', { type: 'number', value: 1 }))}
          </div>`)}
        ${UI.more('فروش مستقیم (پا به پا)', h`
          ${UI.banner('info', 'جنس خریداری‌شده مستقیم به مشتری می‌رود و در موجودی آزاد نمی‌ماند.')}
          <label class="row" style="gap:.4rem"><input type="checkbox" name="direct"> <span>این یک فروش مستقیم است</span></label>
          <div class="grid-2 keep">
            ${UI.field('تهیه‌کننده', UI.select('supplier_id', sups.map(x => ({ v: x.id, t: x.name })), '', { blank: '— انتخاب —' }))}
            ${UI.field('قیمت خرید هر لیتر', UI.input('direct_unit_cost', { type: 'number' }))}
          </div>`)}
        ${UI.field('توضیح', UI.input('note'))}
        <button class="btn btn-primary btn-block" type="submit">ثبت فروش</button>
      </form>`, { wide: true });

    const f = ov.querySelector('#bkF');
    function preview() {
      const d = readForm(f);
      const t = tanks.find(x => String(x.id) === String(d.tank_id));
      const qty = num(d.qty_obs);
      if (!t || qty <= 0) { f.querySelector('#bkPrev').innerHTML = ''; return; }
      const d15 = Petro.normDensity(num(d.density15)) || num(t.default_density) || 0.84;
      const vcf = Petro.vcf(d15, num(d.temp_c) || 15, t.density_group);
      const q15 = qty * vcf, mt = Petro.toMT(q15, d15);
      const price = num(d.unit_price);
      const base = d.price_basis === 'mt' ? mt : (d.price_basis === 'liter15' ? q15 : qty);
      const amount = base * price;
      const cost = qty * (d.direct ? num(d.direct_unit_cost) : num(t.wac));
      f.querySelector('#bkPrev').innerHTML = h`
        <div class="card card-flat stack-s">
          <div class="grid-3 keep">
            <div class="stat"><div class="stat-num sm">${n(mt, 3)}</div><div class="stat-lbl">تُن</div></div>
            <div class="stat"><div class="stat-num sm">${money(amount)}</div><div class="stat-lbl">مبلغ</div></div>
            <div class="stat"><div class="stat-num sm ${amount - cost < 0 ? 'neg' : 'pos'}">${money(amount - cost)}</div><div class="stat-lbl">سود</div></div>
          </div>
          ${!d.direct && qty > num(t.book_l) ? UI.banner('error', 'مقدار از موجودی تانک (' + L(t.book_l) + ') بیشتر است.') : ''}
        </div>`;
    }
    f.addEventListener('input', preview);

    onSubmit(f, async d => {
      if (d.direct) d.sale_kind = 'direct';
      d.station_id = stationId();
      try {
        const res = await API.post('/bulk', d);
        closeSheet(); ok('فروش ثبت شد — سود ' + money(res.profit)); render();
      } catch (e) {
        if (/سقف اعتبار/.test(e.message) && can('finance')) {
          const yes = await confirmBox('عبور از سقف اعتبار', e.message + '  ادامه می‌دهید؟', true);
          if (!yes) throw e;
          d.override_credit = true;
          d.override_reason = 'تایید مدیر هنگام ثبت فروش عمده';
          await API.post('/bulk', d);
          closeSheet(); ok('ثبت شد — هشدار ایجاد شد'); render();
        } else throw e;
      }
    });
  }

  /* ============================================================
     طرف حساب و موترها
     ============================================================ */
  const KINDS = [
    { v: 'customer', t: 'مشتریان' }, { v: 'supplier', t: 'تهیه‌کنندگان' },
    { v: 'transporter', t: 'ترانسپورتران' }, { v: 'employee', t: 'کارمندان' }
  ];

  page('parties', async function (view, r) {
    if (r.param) return partyLedger(view, r.param);
    const kind = r.q.kind || 'customer';
    const rows = await API.get('/parties', { kind });

    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">طرف حساب‌ها</div>
          ${can('ops') ? h`<button class="btn btn-primary" data-new>ثبت جدید</button>` : ''}
        </div>
        <div class="segs">${KINDS.map(k => h`<button class="seg ${k.v === kind ? 'on' : ''}" data-kind="${k.v}">${esc(k.t)}</button>`).join('')}</div>
        ${rows.length ? h`<div class="stack-s">${rows.map(p => h`
          <div class="drow clickable" data-p="${p.id}">
            <div class="drow-part1">
              <div class="tank-icon" style="width:38px;height:38px">${ICON('user', 18)}</div>
              <div class="drow-main">
                <div class="drow-t">${esc(p.name)}</div>
                <div class="drow-s">${esc(p.code || '')}${p.phone ? ' · ' + esc(p.phone) : ''}
                  ${p.credit_limit > 0 ? ' · سقف ' + money(p.credit_limit) : ''}</div>
              </div>
              ${p.credit_limit > 0 && p.balance > p.credit_limit ? UI.chip('از سقف گذشته', 'red') : ''}
            </div>
            <div class="drow-part2">
              <div class="drow-cell">
                <div class="drow-num ${p.balance > 0 ? 'pos' : (p.balance < 0 ? 'neg' : '')}">${money(p.balance)}</div>
                <div class="meta-k">${p.balance >= 0 ? 'طلب ما' : 'قرض ما'}</div>
              </div>
              ${can('finance') ? h`<button class="btn-ghost btn-sm" data-pay="${p.id}">پرداخت / دریافت</button>` : ''}
            </div>
          </div>`).join('')}</div>` : UI.empty('در این گروه کسی ثبت نشده')}
      </div>`;

    view.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => go('#/parties?kind=' + b.dataset.kind));
    view.querySelectorAll('[data-p]').forEach(b => b.onclick = () => go('#/parties/' + b.dataset.p));
    view.querySelectorAll('[data-pay]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      PaymentForm(rows.find(x => String(x.id) === b.dataset.pay));
    });
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => PartyForm(kind);
  });

  function PartyForm(kind, p) {
    const ov = sheet(p ? 'ویرایش ' + p.name : 'ثبت طرف حساب', h`
      <form id="pF" class="stack">
        ${p ? '' : UI.field('نوع', UI.select('kind', KINDS.map(k => ({ v: k.v, t: k.t })), kind))}
        <div class="grid-2 keep">
          ${UI.field('نام', UI.input('name', { value: p && p.name }))}
          ${UI.field('تلفن', UI.input('phone', { value: p && p.phone }))}
        </div>
        <div class="grid-2 keep">
          ${UI.field('سقف اعتبار', UI.input('credit_limit', { type: 'number', value: (p && p.credit_limit) || 0 }),
      'صفر = بدون سقف')}
          ${UI.field('مدت اعتبار (روز)', UI.input('credit_days', { type: 'number', value: (p && p.credit_days) || 0 }))}
        </div>
        ${UI.more('جزئیات بیشتر', h`
          <div class="grid-2 keep">
            ${UI.field('کد', UI.input('code', { value: p && p.code }))}
            ${UI.field('آدرس', UI.input('address', { value: p && p.address }))}
            ${UI.field('معاش ماهانه', UI.input('salary', { type: 'number', value: (p && p.salary) || 0 }))}
            ${p ? '' : UI.field('بیلانس افتتاحیه', UI.input('opening_bal', { type: 'number', value: 0 }), 'مثبت = او به ما بدهکار')}
          </div>
          ${UI.field('یادداشت', UI.input('note', { value: p && p.note }))}`)}
        ${p ? h`<label class="row" style="gap:.4rem"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> <span>فعال</span></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">${p ? 'ذخیره' : 'ثبت'}</button>
      </form>`);
    onSubmit(ov.querySelector('#pF'), async d => {
      if (p) await API.put('/parties/' + p.id, d); else await API.post('/parties', d);
      closeSheet(); ok('ذخیره شد'); render();
    });
  }
  window.PartyForm = PartyForm;

  /* ---------- موترهای مشتری ---------- */
  function VehicleForm(partyId, v) {
    const ov = sheet(v ? 'ویرایش موتر' : 'ثبت موتر', h`
      <form id="vF" class="stack">
        ${UI.field('نمبر پلیت', UI.input('plate_no', { value: v && v.plate_no, cls: 'big', ph: '۱۲۳۴ هرات' }))}
        <div class="grid-2 keep">
          ${UI.field('نوع موتر', UI.input('kind', { value: v && v.kind, ph: 'تانکر / باربری / سواری' }))}
          ${UI.field('نوع تیل', UI.select('product_id', S.meta.products.map(p => ({ v: p.id, t: p.name })),
      (v && v.product_id) || '', { blank: '— هر نوع —' }))}
        </div>
        ${UI.more('جزئیات بیشتر', h`
          <div class="grid-2 keep">
            ${UI.field('نام راننده', UI.input('driver_name', { value: v && v.driver_name }))}
            ${UI.field('تلفن راننده', UI.input('driver_phone', { value: v && v.driver_phone }))}
          </div>
          ${UI.field('سقف ماهانه این موتر', UI.input('credit_limit', { type: 'number', value: (v && v.credit_limit) || 0 }),
        'صفر = بدون سقف جداگانه')}
          ${UI.field('نوت', UI.input('note', { value: v && v.note }))}`)}
        ${v ? h`<label class="row" style="gap:.4rem"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> <span>فعال</span></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">${v ? 'ذخیره' : 'ثبت موتر'}</button>
      </form>`);
    onSubmit(ov.querySelector('#vF'), async d => {
      d.party_id = partyId;
      if (v) await API.put('/vehicles/' + v.id, d); else await API.post('/vehicles', d);
      closeSheet(); ok('ذخیره شد'); render();
    });
  }
  window.VehicleForm = VehicleForm;

  function PaymentForm(p) {
    const ov = sheet((p.balance >= 0 ? 'دریافت پول از ' : 'پرداخت پول به ') + p.name, h`
      <form id="payF" class="stack">
        <div class="card card-flat stack-s">
          <div class="row-b"><span class="muted">بیلانس فعلی</span>
            <span class="num-strong ${p.balance > 0 ? 'pos' : 'neg'}">${money(p.balance)}</span></div>
        </div>
        ${UI.field('نوع', UI.select('direction', [
      { v: 'receive', t: 'دریافت پول از ' + p.name }, { v: 'pay', t: 'پرداخت پول به ' + p.name }],
      p.balance >= 0 ? 'receive' : 'pay'))}
        ${ccyFields('مبلغ')}
        <div class="grid-2 keep">
          ${UI.field('روش', UI.select('method', [
        { v: 'cash', t: 'نقده' }, { v: 'hawala', t: 'حواله' },
        { v: 'bank', t: 'بانک' }, { v: 'cheque', t: 'چک' }], 'cash'))}
          ${UI.dateField('تاریخ', 'doc_date')}
        </div>
        ${UI.more('جزئیات بیشتر', h`
          ${UI.field('شماره حواله / مرجع', UI.input('ref_no'))}
          ${UI.field('توضیح', UI.input('note'))}`)}
        <button class="btn btn-primary btn-block" type="submit">ثبت</button>
      </form>`);
    const f = ov.querySelector('#payF');
    bindCcy(f, 'amount');
    onSubmit(f, async d => {
      d.party_id = p.id; d.station_id = stationId();
      const r = await API.post('/payments', d);
      closeSheet(); ok('ثبت شد — بیلانس جدید ' + money(r.balance)); render();
    });
  }
  window.PaymentForm = PaymentForm;

  async function partyLedger(view, id) {
    const [d, vehicles] = await Promise.all([
      API.get('/parties/' + id + '/ledger'),
      API.get('/vehicles', { party_id: id })
    ]);
    const isCustomer = d.party.kind === 'customer';

    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row">
          <button class="btn-icon" data-back>${ICON('back', 18)}</button>
          <div class="section-title">${esc(d.party.name)}</div>
          ${UI.chip((KINDS.find(k => k.v === d.party.kind) || {}).t || d.party.kind, 'mint')}
          <div class="sp"></div>
          ${can('finance') ? h`<button class="btn btn-primary" data-pay>پرداخت / دریافت</button>` : ''}
          ${can('ops') ? h`<button class="btn-ghost" data-edit>ویرایش</button>` : ''}
        </div>

        <div class="grid-4 keep">
          ${UI.stat(money(d.balance), d.balance >= 0 ? 'طلب ما از او' : 'قرض ما به او', null, d.balance >= 0 ? 'pos' : 'neg')}
          ${UI.stat(money(d.opening), 'بیلانس افتتاحیه')}
          ${UI.stat(money(d.party.credit_limit), 'سقف اعتبار')}
          ${UI.stat(fa(d.party.credit_days), 'مدت اعتبار (روز)')}
        </div>

        ${isCustomer ? h`<div class="card stack">
          <div class="row-b">
            <div class="card-title">موترها</div>
            ${can('ops') ? h`<button class="btn-ghost btn-sm" data-nv>ثبت موتر</button>` : ''}
          </div>
          <div class="hair"></div>
          ${vehicles.length ? h`<div class="stack-s">${vehicles.map(v => h`
            <div class="row-b">
              <div>
                <div class="drow-t" style="font-size:1rem">${esc(v.plate_no)}</div>
                <div class="muted-s">${esc(v.kind || '')}${v.product_name ? ' · ' + esc(v.product_name) : ''}${v.driver_name ? ' · ' + esc(v.driver_name) : ''}</div>
              </div>
              <div class="row">
                ${v.credit_limit > 0 ? UI.chip('سقف ' + money(v.credit_limit), 'yellow') : ''}
                ${can('ops') ? h`<button class="btn-ghost btn-sm" data-ev='${esc(JSON.stringify(v))}'>ویرایش</button>` : ''}
              </div>
            </div>`).join('')}</div>`
        : h`<div class="muted">موتری ثبت نشده. برای فروش قرضی از نازل، موترهای این مشتری را ثبت کنید.</div>`}
        </div>` : ''}

        <div class="card stack">
          <div class="card-title">دفتر معین</div><div class="hair"></div>
          ${d.lines.length ? h`<div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>تاریخ</th><th>شرح</th><th>روش</th><th class="num">بدهکار</th><th class="num">بستانکار</th><th class="num">بیلانس</th></tr></thead>
            <tbody>${d.lines.map(l => h`<tr>
              <td>${sh(l.doc_date)}</td>
              <td class="muted-s">${esc(l.note || '')}</td>
              <td>${esc(({ cash: 'نقده', hawala: 'حواله', bank: 'بانک', credit: 'نسیه', cheque: 'چک' })[l.method] || l.method || '')}</td>
              <td class="num">${l.signed > 0 ? money(l.signed) : '—'}</td>
              <td class="num">${l.signed < 0 ? money(-l.signed) : '—'}</td>
              <td class="num">${money(l.running)}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="5">بیلانس نهایی</td><td class="num">${money(d.balance)}</td></tr></tfoot>
          </table></div>` : h`<div class="muted">هیچ حرکتی ثبت نشده</div>`}
        </div>
      </div>`;
    view.querySelector('[data-back]').onclick = () => go('#/parties?kind=' + d.party.kind);
    const pb = view.querySelector('[data-pay]');
    if (pb) pb.onclick = () => PaymentForm(Object.assign({}, d.party, { balance: d.balance }));
    const eb = view.querySelector('[data-edit]');
    if (eb) eb.onclick = () => PartyForm(d.party.kind, d.party);
    const nv = view.querySelector('[data-nv]');
    if (nv) nv.onclick = () => VehicleForm(Number(id));
    view.querySelectorAll('[data-ev]').forEach(b =>
      b.onclick = () => VehicleForm(Number(id), JSON.parse(b.dataset.ev)));
  }

  /* ============================================================
     نرخ‌نامه
     ============================================================ */
  page('prices', async function (view) {
    const [cur, hist, shifts] = await Promise.all([
      API.get('/prices/current', q()), API.get('/prices'),
      API.get('/shifts', Object.assign({ status: 'open' }, q()))
    ]);
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">نرخ‌نامه</div>
          ${can('finance') ? h`<button class="btn btn-primary" data-new>ثبت نرخ جدید</button>` : ''}
        </div>
        ${shifts.length && can('finance') ? UI.banner('info',
      'یک شفت باز است. اگر نرخ را همین حالا تبدیل کنید، سیستم ریدینگ فعلی نازل‌ها را می‌پرسد '
      + 'و فروش شفت را به دو بخش تقسیم می‌کند.') : ''}
        <div class="grid-4">
          ${cur.map(p => h`<div class="card stat">
            <div class="stat-num" style="color:${p.color}">${money(p.price)}</div>
            <div class="stat-lbl">${esc(p.name)}</div>
            <div class="stat-sub">${S.meta.base_currency} / ${esc(p.uom)}</div>
          </div>`).join('')}
        </div>
        <div class="section">
          <div class="section-title" style="margin-bottom:1rem">تاریخچه نرخ</div>
          ${hist.length ? h`<div class="card"><div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>از تاریخ</th><th>محصول</th><th>استیشن</th><th class="num">نرخ</th><th>اسعار</th><th>توضیح</th></tr></thead>
            <tbody>${hist.map(p => h`<tr>
              <td>${sh(p.effective_from)}</td>
              <td>${esc(p.product_name)}</td>
              <td>${esc(p.station_name || 'همه')}</td>
              <td class="num">${money(p.price)}</td>
              <td>${esc(p.currency)}</td>
              <td class="muted-s">${esc(p.note || '')}</td>
            </tr>`).join('')}</tbody></table></div></div>` : UI.empty('نرخی ثبت نشده')}
        </div>
      </div>`;
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => PriceForm(shifts);
  });

  function PriceForm(openShifts) {
    const shift = (openShifts || [])[0];
    const ov = sheet('ثبت نرخ جدید', h`
      <form id="prF" class="stack">
        ${UI.banner('info', 'نرخ قدیم پاک نمی‌شود. سطر جدید با تاریخ اجرا ثبت می‌گردد.')}
        ${UI.field('محصول', UI.select('product_id', S.meta.products.map(p => ({ v: p.id, t: p.name })), S.meta.products[0] && S.meta.products[0].id))}
        ${UI.field('نرخ جدید', UI.input('price', { type: 'number', cls: 'big' }))}
        ${shift ? h`
          <div class="card card-flat stack-s">
            <div class="card-title" style="font-size:.95rem">نرخ جدید از کی فعال شود؟</div>
            <label class="row" style="gap:.5rem">
              <input type="radio" name="when" value="next" checked>
              <span>از <b>شفت بعدی</b> — ساده‌ترین حالت</span></label>
            <label class="row" style="gap:.5rem">
              <input type="radio" name="when" value="now">
              <span>همین حالا، در <b>شفت جاری</b> — ریدینگ نازل‌ها پرسیده می‌شود</span></label>
          </div>` : ''}
        ${UI.more('جزئیات بیشتر', h`
          ${UI.dateField('اجرا از تاریخ', 'effective_from')}
          ${UI.field('استیشن', UI.select('station_id', S.meta.stations.map(s => ({ v: s.id, t: s.name })), S.stationId || '', { blank: 'همه استیشن‌ها' }))}
          ${UI.field('توضیح', UI.input('note', { ph: 'مثلاً: مطابق نرخ‌نامه رسمی' }))}`)}
        <button class="btn btn-primary btn-block" type="submit">ثبت نرخ</button>
      </form>`);
    onSubmit(ov.querySelector('#prF'), async d => {
      if (shift && d.when === 'now') {
        closeSheet();
        return MidShiftPriceForm(shift.id, Number(d.product_id), num(d.price), d.note);
      }
      const r = await API.post('/prices', d);
      closeSheet();
      ok('نرخ ثبت شد' + (r.open_shifts > 0 ? ' — از شفت بعدی فعال می‌شود' : ''));
      render();
    });
  }

  /* تغییر نرخ در شفت جاری — ریدینگ نازل‌های همان محصول پرسیده می‌شود */
  async function MidShiftPriceForm(shiftId, productId, newPrice, note) {
    const im = await API.get('/shifts/' + shiftId + '/price-impact', { product_id: productId });
    if (!im.nozzles.length) return err('در این شفت نازلی برای این محصول نیست');
    const pn = (S.meta.products.find(p => p.id === productId) || {}).name || '';

    const ov = sheet('تغییر نرخ در شفت جاری — ' + pn, h`
      <form id="msF" class="stack">
        <div class="card card-flat stack-s">
          <div class="row-b"><span class="muted">نرخ فعلی</span><span class="num-strong">${money(im.current_price)}</span></div>
          <div class="row-b"><span class="muted">نرخ جدید</span><span class="num-strong pos">${money(newPrice)}</span></div>
        </div>
        ${UI.banner('info', 'ریدینگ فعلی هر نازل را از روی کنتور بخوانید و وارد کنید. '
      + 'فروش تا این عدد با نرخ قدیم و بعد از آن با نرخ جدید حساب می‌شود.')}
        <div class="stack-s">
          ${im.nozzles.map(nz => h`
            <div class="row-b card card-flat card-tight">
              <div>
                <div class="drow-t" style="font-size:1rem">${esc(nz.dispenser_code)} / ${esc(nz.nozzle_code)}</div>
                <div class="muted-s">عدد قبلی: ${fa(nz.last_boundary)}</div>
              </div>
              <input class="input" style="max-width:170px" data-num name="rd_${nz.nozzle_id}"
                inputmode="decimal" placeholder="ریدینگ فعلی">
            </div>`).join('')}
        </div>
        <button class="btn btn-primary btn-block" type="submit">ثبت تغییر نرخ</button>
      </form>`, { wide: true });

    onSubmit(ov.querySelector('#msF'), async d => {
      /* خانه خالی نباید بی‌صدا صفر شود — سرور باید آن را رد کند */
      const readings = im.nozzles.map(nz => {
        const raw = String(d['rd_' + nz.nozzle_id] === undefined ? '' : d['rd_' + nz.nozzle_id]).trim();
        if (raw === '') throw new Error('ریدینگ فعلی نازل '
          + nz.dispenser_code + '/' + nz.nozzle_code + ' را وارد کنید');
        return { nozzle_id: nz.nozzle_id, reading: raw };
      });
      await API.post('/shifts/' + shiftId + '/price-checkpoint', {
        idem_key: d.idem_key, product_id: productId, new_price: newPrice, readings, note
      });
      closeSheet(); ok('نرخ تغییر کرد — فروش شفت به دو بخش تقسیم می‌شود'); render();
    });
  }
  window.MidShiftPriceForm = MidShiftPriceForm;

  /* ============================================================
     مصارف
     ============================================================ */
  const CATS = ['معاش', 'کرایه', 'برق', 'ترمیم', 'ترانسپورت', 'مالیه', 'قرطاسیه', 'تیل جنراتور', 'متفرقه'];

  page('expenses', async function (view) {
    const rows = await API.get('/expenses', q());
    const total = rows.reduce((s, x) => s + num(x.amount_base !== null && x.amount_base !== undefined
      ? x.amount_base : num(x.amount) * num(x.fx_rate, 1)), 0);
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">مصارف</div>
          ${can('finance') ? h`<button class="btn btn-primary" data-new>ثبت مصرف</button>` : ''}
        </div>
        <div class="grid-3 keep">
          ${UI.stat(money(total), 'مجموع مصارف نمایش‌داده‌شده')}
          ${UI.stat(fa(rows.length), 'تعداد سند')}
          ${UI.stat(esc(S.meta.base_currency), 'اسعار پایه')}
        </div>
        ${rows.length ? h`<div class="stack-s">${rows.map(x => h`
          <div class="drow">
            <div class="drow-part1">
              <div class="tank-icon" style="width:38px;height:38px">${ICON('wallet', 18)}</div>
              <div class="drow-main">
                <div class="drow-t">${esc(x.category)}${x.party_name ? ' — ' + esc(x.party_name) : ''}</div>
                <div class="drow-s">${sh(x.doc_date)} · ${esc(x.station_name)}${x.note ? ' · ' + esc(x.note) : ''}</div>
              </div>
            </div>
            <div class="drow-part2">
              <div class="drow-item"><span class="k">${esc(x.currency)}</span><span class="v neg">${money(x.amount)}</span></div>
              ${can('finance') ? h`<button class="btn-ghost btn-sm" data-rev="${x.id}">برگشت</button>` : ''}
            </div>
          </div>`).join('')}</div>` : UI.empty('مصرفی ثبت نشده')}
      </div>`;
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => ExpenseForm();
    view.querySelectorAll('[data-rev]').forEach(b =>
      b.onclick = () => ReverseForm('/expenses/' + b.dataset.rev + '/reverse', 'برگشت مصرف'));
  });

  async function ExpenseForm() {
    const emps = await API.get('/parties', { kind: 'employee' });
    const ov = sheet('ثبت مصرف', h`
      <form id="exF" class="stack">
        ${UI.field('نوع مصرف', UI.select('category', CATS.map(c => ({ v: c, t: c })), 'متفرقه'))}
        ${ccyFields('مبلغ')}
        <div class="grid-2 keep">
          ${UI.field('روش پرداخت', UI.select('method', [
      { v: 'cash', t: 'نقده' }, { v: 'bank', t: 'بانک' }, { v: 'hawala', t: 'حواله' }], 'cash'))}
          ${UI.dateField('تاریخ', 'doc_date')}
        </div>
        ${UI.more('جزئیات بیشتر', h`
          ${UI.field('طرف حساب', UI.select('party_id', emps.map(e => ({ v: e.id, t: e.name })), '', { blank: '— اختیاری —' }))}
          ${UI.field('شماره مرجع', UI.input('ref_no'))}
          ${UI.field('توضیح', UI.input('note'))}`)}
        <button class="btn btn-primary btn-block" type="submit">ثبت</button>
      </form>`);
    const f = ov.querySelector('#exF');
    bindCcy(f, 'amount');
    onSubmit(f, async d => {
      d.station_id = stationId();
      await API.post('/expenses', d);
      closeSheet(); ok('مصرف ثبت شد'); render();
    });
  }

  /* ============================================================
     تعدیل / جنراتور / انتقال / جدول سنجش
     ============================================================ */
  window.AdjustForm = function (t) {
    const ov = sheet('اصلاح موجودی — ' + t.name, h`
      <form id="adF" class="stack">
        ${UI.banner('warn', 'هر اصلاح در ثبت وقایع می‌ماند. اصلاح مکرر توسط یک کاربر هشدار ایجاد می‌کند.')}
        ${UI.field('نوع', UI.select('kind', [
      { v: 'genset', t: 'مصرف تیل جنراتور (خروج)' },
      { v: 'adjust', t: 'اصلاح موجودی' }], 'genset'))}
        ${UI.field('مقدار (لیتر)', UI.input('qty', { type: 'number', cls: 'big' }), 'منفی = خروج · مثبت = ورود')}
        ${UI.field('دلیل', h`<textarea class="input" name="reason" rows="2" placeholder="دلیل کامل — اجباری"></textarea>`)}
        ${UI.more('جزئیات بیشتر', UI.dateField('تاریخ', 'doc_date'))}
        <button class="btn btn-primary btn-block" type="submit">ثبت</button>
      </form>`);
    const f = ov.querySelector('#adF');
    f.querySelector('[name=kind]').addEventListener('change', e => {
      const qf = f.querySelector('[name=qty]');
      if (e.target.value === 'genset' && num(qf.value) > 0) qf.value = '-' + toLatin(qf.value);
    });
    onSubmit(f, async d => {
      d.tank_id = t.id;
      if (d.kind === 'genset' && num(d.qty) > 0) d.qty = -num(d.qty);
      const r = await API.post('/stock/adjust', d);
      closeSheet(); ok('ثبت شد — موجودی جدید ' + L(r.book_l)); render();
    });
  };

  /* ---------- انتقال تیل بین تانک‌ها ---------- */
  window.TransferForm = async function (t) {
    const tanks = (await API.get('/tanks', q()))
      .filter(x => x.id !== t.id && x.product_id === t.product_id && x.station_id === t.station_id);
    if (!tanks.length) return err('تانک دیگری با همین محصول در این استیشن نیست');
    const needDip = S.meta.features && S.meta.features.transfer_require_dip;

    const ov = sheet('انتقال تیل از ' + t.name, h`
      <form id="trF" class="stack">
        ${UI.field('تانک مقصد', UI.select('to_tank_id', tanks.map(x => ({
      v: x.id, t: x.code + ' — ' + x.name + ' · موجودی ' + L(x.book_l)
    })), tanks[0].id))}
        ${UI.field('مقدار (لیتر)', UI.input('qty_l', { type: 'number', cls: 'big' }),
      'موجودی تانک مبدا: ' + L(t.book_l) + ' لیتر')}
        ${UI.dateField('تاریخ', 'doc_date')}
        ${UI.field('توضیح', UI.input('note', { ph: 'اختیاری' }))}
        <div id="trPrev"></div>
        ${UI.more('دیپ قبل و بعد' + (needDip ? ' (اجباری)' : ' (اختیاری)'), h`
          <div class="grid-2 keep">
            ${UI.field('دیپ قبل (mm)', UI.input('dip_before_mm', { type: 'number' }))}
            ${UI.field('دیپ بعد (mm)', UI.input('dip_after_mm', { type: 'number' }))}
          </div>
          <div class="grid-2 keep">
            ${UI.field('حرارت °C', UI.input('temp_c', { type: 'number' }))}
            ${UI.field('ثقلت', UI.input('density15', { type: 'number', ph: 'خودکار' }))}
          </div>`, needDip)}
        <button class="btn btn-primary btn-block" type="submit">ثبت انتقال</button>
      </form>`);

    const f = ov.querySelector('#trF');
    function preview() {
      const d = readForm(f);
      const to = tanks.find(x => String(x.id) === String(d.to_tank_id));
      const qty = num(d.qty_l);
      const box = f.querySelector('#trPrev');
      if (!to || qty <= 0) { box.innerHTML = ''; return; }
      box.innerHTML = h`
        <div class="card card-flat stack-s">
          <div class="row-b"><span class="muted">${esc(t.code)} بعد از انتقال</span>
            <span class="num-strong ${qty > num(t.book_l) ? 'neg' : ''}">${L(num(t.book_l) - qty)} لیتر</span></div>
          <div class="row-b"><span class="muted">${esc(to.code)} بعد از انتقال</span>
            <span class="num-strong">${L(num(to.book_l) + qty)} لیتر</span></div>
          ${qty > num(t.book_l) ? UI.banner('error', 'مقدار از موجودی تانک مبدا بیشتر است.') : ''}
          ${to.capacity_l > 0 && num(to.book_l) + qty > num(to.capacity_l)
          ? UI.banner('error', 'تانک مقصد جا ندارد.') : ''}
        </div>`;
    }
    f.addEventListener('input', preview);
    f.querySelector('[name=to_tank_id]').addEventListener('change', preview);

    onSubmit(f, async d => {
      d.from_tank_id = t.id;
      const r = await API.post('/transfers', d);
      closeSheet();
      ok('انتقال ثبت شد — ' + L(r.qty_l) + ' لیتر');
      render();
    });
  };

  /* ---------- جدول سنجش تانک — نسخه‌دار ---------- */
  window.CalibForm = async function (t) {
    const v = await API.get('/tanks/' + t.id + '/calib/versions');
    const ov = sheet('جدول سنجش — ' + t.name, h`
      <div class="stack">
        <div class="card card-flat stack-s">
          <div class="row-b">
            <span class="muted">جدول سنجش فعلی</span>
            <span class="num-strong">${v.versions.length ? 'نسخه ' + fa(v.versions[0].version) + ' · '
        + fa(v.versions[0].point_count) + ' نقطه' : 'ثبت نشده'}</span>
          </div>
          ${v.versions.length && v.versions[0].source === 'linear'
        ? UI.banner('warn', 'این جدول تخمینی (خطی) است. برای دقت واقعی، جدول رسمی سنجش تانک را وارد کنید.') : ''}
        </div>

        <div class="segs">
          <button class="seg on" data-tab="paste">جدول واقعی</button>
          <button class="seg" data-tab="linear">تولید تخمینی</button>
          <button class="seg" data-tab="hist">تاریخچه</button>
        </div>

        <form id="cpF" class="stack" data-pane="paste">
          ${UI.banner('info', 'هر سطر: <b>دیپ_میلی‌متر</b> فاصله <b>حجم_لیتر</b>. جدول رسمی را از شرکت سازنده یا اداره معیارات بگیرید.')}
          <textarea class="input" name="text" rows="10" dir="ltr"
            placeholder="0 0&#10;10 285&#10;20 572&#10;30 861&#10;..."></textarea>
          ${UI.more('معلومات سرتیفیکیت', h`
            <div class="grid-2 keep">
              ${UI.field('شماره سرتیفیکیت', UI.input('certificate_no'))}
              ${UI.field('صادرکننده', UI.input('issued_by', { ph: 'اداره معیارات' }))}
              ${UI.dateField('نافذ از تاریخ', 'effective_from')}
              ${UI.dateField('کنترول بعدی', 'next_check')}
            </div>
            ${UI.field('نوت', UI.input('note'))}`)}
          <button class="btn btn-primary btn-block" type="submit">ثبت نسخه جدید</button>
        </form>

        <form id="clF" class="stack hide" data-pane="linear">
          ${UI.banner('warn', 'جدول خطی فقط برای تانک استوانه‌ای عمودی درست است. برای تانک افقی خطای بزرگ می‌دهد.')}
          <div class="grid-3 keep">
            ${UI.field('ارتفاع تانک (mm)', UI.input('height_mm', { type: 'number', value: 2000 }))}
            ${UI.field('ظرفیت (لیتر)', UI.input('capacity_l', { type: 'number', value: t.capacity_l }))}
            ${UI.field('گام (mm)', UI.input('step_mm', { type: 'number', value: 10 }))}
          </div>
          <button class="btn btn-primary btn-block" type="submit">تولید جدول</button>
        </form>

        <div class="stack hide" data-pane="hist">
          ${v.versions.length ? h`<div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>نسخه</th><th>نافذ از</th><th>نوع</th><th class="num">نقاط</th>
              <th>سرتیفیکیت</th><th>ثبت‌کننده</th></tr></thead>
            <tbody>${v.versions.map(x => h`<tr ${x.id === v.current_id ? 'style="font-weight:600"' : ''}>
              <td>${fa(x.version)}${x.id === v.current_id ? ' (فعلی)' : ''}</td>
              <td>${sh(x.effective_from)}</td>
              <td>${x.source === 'linear' ? 'تخمینی' : 'واقعی'}</td>
              <td class="num">${fa(x.point_count)}</td>
              <td class="muted-s">${esc(x.certificate_no || '—')}</td>
              <td class="muted-s">${esc(x.created_by_name || '—')}</td>
            </tr>`).join('')}</tbody></table></div>
            <div class="muted-s">نسخه‌های قدیم پاک نمی‌شوند — دیپ‌های گذشته با جدول همان زمان قابل بررسی‌اند.</div>`
        : h`<div class="muted">تاریخچه‌ای نیست</div>`}
        </div>
      </div>`, { wide: true });

    ov.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      ov.querySelectorAll('.seg').forEach(x => x.classList.toggle('on', x === b));
      ov.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hide', p.dataset.pane !== b.dataset.tab));
    });
    onSubmit(ov.querySelector('#cpF'), async d => {
      d.text = toLatin(d.text);
      const r = await API.post('/tanks/' + t.id + '/calib', d);
      closeSheet(); ok('نسخه ' + fa(r.version) + ' با ' + fa(r.count) + ' نقطه ثبت شد'); render();
    });
    onSubmit(ov.querySelector('#clF'), async d => {
      const r = await API.post('/tanks/' + t.id + '/calib/linear', d);
      closeSheet(); ok('نسخه ' + fa(r.version) + ' تولید شد'); render();
    });
  };

  /* ---------- مهر و کالیبراسیون نازل ---------- */
  window.NozzleCalibForm = async function (nz) {
    const [hist, seals] = await Promise.all([
      API.get('/nozzles/' + nz.id + '/calib'),
      API.get('/seals', { entity: 'nozzle', entity_id: nz.id })
    ]);
    const ov = sheet('مهر و کالیبراسیون — نازل ' + nz.code, h`
      <div class="stack">
        <div class="segs">
          <button class="seg on" data-tab="cal">کالیبراسیون</button>
          <button class="seg" data-tab="seal">مهر</button>
        </div>

        <div class="stack" data-pane="cal">
          <form id="ncF" class="stack">
            <div class="grid-2 keep">
              ${UI.field('ضریب کالیبراسیون', UI.input('meter_factor', { type: 'number', value: nz.meter_factor || 1 }),
      '۱ = کنتور درست است')}
              ${UI.dateField('تاریخ کنترول', 'effective_from')}
            </div>
            ${UI.more('جزئیات بیشتر', h`
              <div class="grid-2 keep">
                ${UI.field('خطا در ۵ لیتر (ml)', UI.input('error_ml', { type: 'number' }))}
                ${UI.dateField('کنترول بعدی', 'next_check')}
                ${UI.field('شماره سرتیفیکیت', UI.input('certificate_no'))}
                ${UI.field('کنترول‌کننده', UI.input('checked_by'))}
              </div>
              ${UI.field('نوت', UI.input('note'))}`)}
            <button class="btn btn-primary btn-block" type="submit">ثبت کالیبراسیون</button>
          </form>
          ${hist.length ? h`<div class="card stack-s">
            <div class="card-title">تاریخچه</div><div class="hair"></div>
            <div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>از تاریخ</th><th class="num">ضریب</th><th>سرتیفیکیت</th><th>ثبت‌کننده</th></tr></thead>
              <tbody>${hist.map(c => h`<tr>
                <td>${sh(c.effective_from)}</td><td class="num">${fa(c.meter_factor)}</td>
                <td class="muted-s">${esc(c.certificate_no || '—')}</td>
                <td class="muted-s">${esc(c.created_by_name || '—')}</td>
              </tr>`).join('')}</tbody></table></div>
          </div>` : ''}
        </div>

        <div class="stack hide" data-pane="seal">
          <form id="nsF" class="stack">
            <div class="grid-2 keep">
              ${UI.field('شماره مهر', UI.input('seal_no'))}
              ${UI.dateField('تاریخ نصب', 'applied_on')}
            </div>
            ${UI.field('نوت', UI.input('note'))}
            <button class="btn btn-primary btn-block" type="submit">ثبت مهر</button>
          </form>
          ${seals.length ? h`<div class="card stack-s">
            <div class="card-title">تاریخچه مهر</div><div class="hair"></div>
            ${seals.map(s => h`<div class="row-b">
              <span>${esc(s.seal_no)} <span class="muted-s">· ${sh(s.applied_on)}</span></span>
              ${s.removed_on ? UI.chip('باز شده ' + sh(s.removed_on), 'grey') : UI.chip('فعال', 'mint')}
            </div>`).join('')}
          </div>` : ''}
        </div>
      </div>`, { wide: true });

    ov.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      ov.querySelectorAll('.seg').forEach(x => x.classList.toggle('on', x === b));
      ov.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hide', p.dataset.pane !== b.dataset.tab));
    });
    onSubmit(ov.querySelector('#ncF'), async d => {
      await API.post('/nozzles/' + nz.id + '/calib', d);
      closeSheet(); ok('کالیبراسیون ثبت شد'); render();
    });
    onSubmit(ov.querySelector('#nsF'), async d => {
      d.entity = 'nozzle'; d.entity_id = nz.id;
      await API.post('/seals', d);
      closeSheet(); ok('مهر ثبت شد'); render();
    });
  };
})();
