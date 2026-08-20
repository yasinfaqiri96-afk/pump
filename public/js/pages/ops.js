/* صفحات: ورود تیل، فروش عمده، طرف حساب، نرخ، مصارف */
(function () {
  'use strict';
  const q = () => (S.stationId ? { station_id: S.stationId } : {});
  const PORTS = ['حیرتان', 'تورغندی', 'اسلام‌قلعه', 'نیمروز', 'تورخم', 'سپین‌بولدک', 'آقینه', 'داخلی'];
  const PAY = [{ v: 'credit', t: 'نسیه' }, { v: 'cash', t: 'نقده' }, { v: 'hawala', t: 'حواله' }, { v: 'bank', t: 'بانک' }];

  /* ============================================================
     ورود تیل / تخلیه
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
          <div class="drow">
            <div class="drow-part1">
              <div class="tank-icon" style="background:${x.color}22;color:${x.color}">${ICON('truck', 20)}</div>
              <div class="drow-main">
                <div class="drow-t">${esc(x.waybill_no || 'بدون بارنامه')} — ${esc(x.product_name)}</div>
                <div class="drow-s">${sh(x.doc_date)} · تانک ${esc(x.tank_code)} · ${esc(x.supplier_name || 'بدون تهیه‌کننده')}
                  ${x.truck_plate ? ' · پلیت ' + esc(x.truck_plate) : ''}${x.entry_port ? ' · ' + esc(x.entry_port) : ''}</div>
              </div>
            </div>
            <div class="drow-part2">
              <div class="drow-item"><span class="k">لیتر</span><span class="v ">${L(x.vol_obs_l)}</span></div>
              <div class="drow-item"><span class="k">تُن</span><span class="v ">${n(x.qty_mt, 3)}</span></div>
              <div class="drow-item"><span class="k">کسری تُن</span><span class="v ${x.variance_mt < 0 ? 'neg' : (x.variance_mt > 0 ? 'pos' : '')}">${n(x.variance_mt, 3)}</span></div>
              <div class="drow-item"><span class="k">بها</span><span class="v ">${money(x.total_cost)}</span></div>
              ${x.quality_ok ? '' : UI.chip('کیفیت رد', 'red')}
            </div>
          </div>`).join('')}</div>` : UI.empty('هیچ تخلیه‌ای ثبت نشده')}
      </div>`;
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => ReceiptForm(r.q.tank ? Number(r.q.tank) : null);
    if (r.q.tank && can('ops')) ReceiptForm(Number(r.q.tank));
  });

  async function ReceiptForm(tankId) {
    const [tanks, sups, trns] = await Promise.all([
      API.get('/tanks', q()),
      API.get('/parties', { kind: 'supplier' }),
      API.get('/parties', { kind: 'transporter' })
    ]);
    if (!tanks.length) return err('اول تانک ثبت کنید');

    const ov = sheet('ثبت تخلیه تانکر', h`
      <form id="rcF" class="stack">
        <div class="card-title">1 — سند و تانکر</div>
        <div class="grid-2">
          ${UI.dateField('تاریخ', 'doc_date')}
          ${UI.field('شماره بارنامه', UI.input('waybill_no', { ph: 'WB-…' }))}
          ${UI.field('تهیه‌کننده', UI.select('supplier_id', sups.map(x => ({ v: x.id, t: x.name })), '', { blank: '— انتخاب —' }))}
          ${UI.field('ترانسپورتر', UI.select('transporter_id', trns.map(x => ({ v: x.id, t: x.name })), '', { blank: '— انتخاب —' }))}
          ${UI.field('نمبر پلیت تانکر', UI.input('truck_plate', { ph: 'کابل 1234' }))}
          ${UI.field('نام راننده', UI.input('driver_name'))}
          ${UI.field('بندر ورود', UI.select('entry_port', PORTS.map(p => ({ v: p, t: p })), '', { blank: '— انتخاب —' }))}
          ${UI.field('تلفن راننده', UI.input('driver_phone'))}
        </div>
        <div class="grid-2 keep">
          ${UI.field('شماره مهر مبدا', UI.input('seal_out'), 'از بارنامه')}
          ${UI.field('شماره مهر مقصد', UI.input('seal_in'), 'مهر واقعی روی تانکر')}
        </div>

        <div class="hair"></div>
        <div class="card-title">2 — مقدار مبدا</div>
        <div class="grid-3 keep">
          ${UI.field('مقدار مبدا (تُن)', UI.input('src_qty_mt', { type: 'number', ph: '0' }))}
          ${UI.field('دانسیته مبدا 15°', UI.input('src_density15', { type: 'number', ph: '0.84' }))}
          ${UI.field('حرارت مبدا °C', UI.input('src_temp', { type: 'number' }))}
        </div>

        <div class="hair"></div>
        <div class="card-title">3 — دیپ و تخلیه</div>
        ${UI.field('تانک', UI.select('tank_id', tanks.map(t => ({ v: t.id, t: t.code + ' — ' + t.name + ' (' + t.product_name + ')' })), tankId || tanks[0].id))}
        <div class="grid-2 keep">
          ${UI.field('دیپ قبل تخلیه (mm)', UI.input('dip_before_mm', { type: 'number' }))}
          ${UI.field('آب قبل (mm)', UI.input('water_before_mm', { type: 'number', value: 0 }))}
          ${UI.field('دیپ بعد تخلیه (mm)', UI.input('dip_after_mm', { type: 'number' }))}
          ${UI.field('آب بعد (mm)', UI.input('water_after_mm', { type: 'number', value: 0 }))}
        </div>
        <div class="grid-2 keep">
          ${UI.field('حرارت نمونه °C', UI.input('temp_c', { type: 'number', ph: '25' }))}
          ${UI.field('دانسیته 15° مقصد', UI.input('density15', { type: 'number', ph: 'خودکار' }))}
        </div>
        <div class="banner banner-info"><div>قاعده: 30 دقیقه بعد از تخلیه دیپ بزنید تا سطح آرام شود.</div></div>
        <div id="rcPrev"></div>

        <div class="hair"></div>
        <div class="card-title">4 — بها</div>
        <div class="grid-3 keep">
          ${UI.field('قیمت هر لیتر', UI.input('unit_cost', { type: 'number' }))}
          ${UI.field('مصارف جانبی', UI.input('other_cost', { type: 'number', value: 0 }), 'کرایه، گمرک، تخلیه')}
          ${UI.field('نوع پرداخت', UI.select('payment_kind', PAY, 'credit'))}
        </div>
        <div class="grid-2 keep">
          ${UI.field('ارز', UI.select('currency', [{ v: 'AFN', t: 'افغانی' }, { v: 'USD', t: 'دالر' }, { v: 'PKR', t: 'کلدار' }, { v: 'IRR', t: 'تومان' }], S.meta.base_currency))}
          ${UI.field('نرخ تبادله', UI.input('fx_rate', { type: 'number', value: 1 }), '1 اگر ارز پایه است')}
        </div>

        <div class="hair"></div>
        <div class="row-b">
          <span class="muted">کیفیت محموله</span>
          <label class="row" style="gap:.4rem"><input type="checkbox" name="quality_bad"> <span>رد شد / مشکوک</span></label>
        </div>
        ${UI.field('یادداشت کیفیت / توضیح', UI.input('quality_note', { ph: 'اختیاری' }))}
        <button class="btn btn-primary btn-block" type="submit">ثبت تخلیه</button>
      </form>`, { wide: true });

    const f = ov.querySelector('#rcF');
    let timer = null;
    async function preview() {
      const d = readForm(f);
      if (!d.dip_after_mm) { f.querySelector('#rcPrev').innerHTML = ''; return; }
      try {
        const p = await API.post('/receipts/calc', {
          tank_id: d.tank_id, dip_before_mm: d.dip_before_mm, water_before_mm: d.water_before_mm,
          dip_after_mm: d.dip_after_mm, water_after_mm: d.water_after_mm,
          temp_c: d.temp_c, density15: d.density15, src_qty_mt: d.src_qty_mt
        });
        f.querySelector('#rcPrev').innerHTML = h`
          <div class="card card-flat stack-s">
            <div class="grid-4 keep">
              <div class="stat"><div class="stat-num sm">${L(p.vol_obs_l)}</div><div class="stat-lbl">لیتر دریافتی</div></div>
              <div class="stat"><div class="stat-num sm">${L(p.vol15_l)}</div><div class="stat-lbl">لیتر در 15°</div></div>
              <div class="stat"><div class="stat-num sm">${n(p.qty_mt, 3)}</div><div class="stat-lbl">تُن متریک</div></div>
              <div class="stat"><div class="stat-num sm ${p.variance_mt < 0 ? 'neg' : 'pos'}">${n(p.variance_mt, 3)}</div><div class="stat-lbl">کسری ترانزیت (تُن)</div></div>
            </div>
            <div class="muted-s txt-c">ضریب VCF ${fa(p.vcf)} · قبل ${L(p.vol_before_l)} · بعد ${L(p.vol_after_l)} · جای خالی تانک ${L(p.capacity_free)}</div>
            ${p.overflow ? UI.banner('error', 'سطح بعد از تخلیه از ظرفیت تانک می‌گذرد. عدد را کنترل کنید.') : ''}
            ${p.over_tolerance ? UI.banner('error', 'کسری ترانزیت ' + pct(p.variance_pct) + ' از تولرانس ' + pct(p.tolerance_pct) + ' گذشته — هشدار ثبت می‌شود.') : ''}
          </div>`;
      } catch (e) { f.querySelector('#rcPrev').innerHTML = UI.banner('error', esc(e.message)); }
    }
    f.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 250); });
    f.querySelector('[name=tank_id]').addEventListener('change', preview);

    f.onsubmit = async ev => {
      ev.preventDefault();
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const d = readForm(f);
        d.quality_ok = !d.quality_bad; delete d.quality_bad;
        const res = await API.post('/receipts', d);
        closeSheet();
        ok('تخلیه ثبت شد — ' + L(res.vol_obs_l) + ' لیتر / ' + n(res.qty_mt, 3) + ' تُن');
        render();
      } catch (e) { err(e.message); btn.disabled = false; }
    };
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
            </div>
            <div class="drow-part2">
              <div class="drow-item"><span class="k">لیتر</span><span class="v ">${L(x.qty_obs)}</span></div>
              <div class="drow-item"><span class="k">نرخ</span><span class="v ">${money(x.unit_price)}</span></div>
              <div class="drow-item"><span class="k">مبلغ</span><span class="v ">${money(x.amount)}</span></div>
              ${UI.chip(({ credit: 'نسیه', cash: 'نقده', hawala: 'حواله', bank: 'بانک' })[x.payment_kind] || x.payment_kind,
        x.payment_kind === 'credit' ? 'yellow' : 'mint')}
            </div>
          </div>`).join('')}</div>` : UI.empty('هیچ فروش عمده‌ای ثبت نشده')}
      </div>`;
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => BulkForm();
  });

  async function BulkForm() {
    const [tanks, custs] = await Promise.all([API.get('/tanks', q()), API.get('/parties', { kind: 'customer' })]);
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
        <div class="grid-3 keep">
          ${UI.field('مقدار (لیتر)', UI.input('qty_obs', { type: 'number', cls: 'big' }))}
          ${UI.field('حرارت °C', UI.input('temp_c', { type: 'number' }))}
          ${UI.field('دانسیته 15°', UI.input('density15', { type: 'number', ph: 'خودکار' }))}
        </div>
        <div class="grid-2 keep">
          ${UI.field('مبنای قیمت', UI.select('price_basis', [
      { v: 'liter', t: 'هر لیتر مشاهده‌ای' }, { v: 'liter15', t: 'هر لیتر در 15°' }, { v: 'mt', t: 'هر تُن متریک' }], 'liter'))}
          ${UI.field('نرخ واحد', UI.input('unit_price', { type: 'number', ph: 'نرخ‌نامه' }))}
        </div>
        <div class="grid-3 keep">
          ${UI.field('نمبر پلیت', UI.input('truck_plate'))}
          ${UI.field('شماره مهر', UI.input('seal_no'))}
          ${UI.field('راننده', UI.input('driver_name'))}
        </div>
        <div id="bkPrev"></div>
        ${UI.field('توضیح', UI.input('note'))}
        <button class="btn btn-primary btn-block" type="submit">ثبت فروش</button>
      </form>`, { wide: true });

    const f = ov.querySelector('#bkF');
    function preview() {
      const d = readForm(f);
      const t = tanks.find(x => String(x.id) === String(d.tank_id));
      const qty = num(d.qty_obs);
      if (!t || qty <= 0) { f.querySelector('#bkPrev').innerHTML = ''; return; }
      const d15 = num(d.density15) || num(t.default_density) || 0.84;
      const vcf = Petro.vcf(d15, num(d.temp_c) || 15, t.density_group);
      const q15 = qty * vcf, mt = Petro.toMT(q15, d15);
      const price = num(d.unit_price);
      const base = d.price_basis === 'mt' ? mt : (d.price_basis === 'liter15' ? q15 : qty);
      const amount = base * price;
      const cost = qty * num(t.wac);
      f.querySelector('#bkPrev').innerHTML = h`
        <div class="card card-flat stack-s">
          <div class="grid-4 keep">
            <div class="stat"><div class="stat-num sm">${L(q15)}</div><div class="stat-lbl">لیتر 15°</div></div>
            <div class="stat"><div class="stat-num sm">${n(mt, 3)}</div><div class="stat-lbl">تُن</div></div>
            <div class="stat"><div class="stat-num sm">${money(amount)}</div><div class="stat-lbl">مبلغ</div></div>
            <div class="stat"><div class="stat-num sm ${amount - cost < 0 ? 'neg' : 'pos'}">${money(amount - cost)}</div><div class="stat-lbl">سود ناخالص</div></div>
          </div>
          ${qty > num(t.book_l) ? UI.banner('error', 'مقدار از موجودی تانک (' + L(t.book_l) + ') بیشتر است.') : ''}
        </div>`;
    }
    f.addEventListener('input', preview);
    f.onsubmit = async ev => {
      ev.preventDefault();
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const res = await API.post('/bulk', readForm(f));
        closeSheet(); ok('فروش ثبت شد — سود ' + money(res.profit)); render();
      } catch (e) {
        if (/سقف اعتبار/.test(e.message) && can('finance')) {
          const yes = await confirmBox('عبور از سقف اعتبار', e.message + '\nبا مسئولیت خودتان ادامه می‌دهید؟', true);
          if (yes) {
            try {
              const d = readForm(f); d.override_credit = true;
              await API.post('/bulk', d); closeSheet(); ok('ثبت شد — هشدار ایجاد شد'); render(); return;
            } catch (e2) { err(e2.message); }
          }
        } else err(e.message);
        btn.disabled = false;
      }
    };
  }

  /* ============================================================
     طرف حساب
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
          ${UI.field('کد', UI.input('code', { value: p && p.code }))}
          ${UI.field('تلفن', UI.input('phone', { value: p && p.phone }))}
          ${UI.field('آدرس', UI.input('address', { value: p && p.address }))}
        </div>
        <div class="grid-3 keep">
          ${UI.field('سقف اعتبار', UI.input('credit_limit', { type: 'number', value: (p && p.credit_limit) || 0 }))}
          ${UI.field('مدت اعتبار (روز)', UI.input('credit_days', { type: 'number', value: (p && p.credit_days) || 0 }))}
          ${UI.field('معاش ماهانه', UI.input('salary', { type: 'number', value: (p && p.salary) || 0 }))}
        </div>
        ${p ? '' : UI.field('بیلانس افتتاحیه', UI.input('opening_bal', { type: 'number', value: 0 }), 'مثبت = او به ما بدهکار')}
        ${UI.field('یادداشت', UI.input('note', { value: p && p.note }))}
        ${p ? h`<label class="row" style="gap:.4rem"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> <span>فعال</span></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">${p ? 'ذخیره' : 'ثبت'}</button>
      </form>`);
    ov.querySelector('#pF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(ev.target);
        if (p) await API.put('/parties/' + p.id, d); else await API.post('/parties', d);
        closeSheet(); ok('ذخیره شد'); render();
      } catch (e) { err(e.message); }
    };
  }
  window.PartyForm = PartyForm;

  function PaymentForm(p) {
    const stationId = S.stationId || (S.meta.stations[0] && S.meta.stations[0].id);
    const ov = sheet((p.balance >= 0 ? 'دریافت از ' : 'پرداخت به ') + p.name, h`
      <form id="payF" class="stack">
        <div class="card card-flat stack-s">
          <div class="row-b"><span class="muted">بیلانس فعلی</span>
            <span class="num-strong ${p.balance > 0 ? 'pos' : 'neg'}">${money(p.balance)}</span></div>
        </div>
        ${UI.field('نوع', UI.select('direction', [
      { v: 'receive', t: 'دریافت پول از ' + p.name }, { v: 'pay', t: 'پرداخت پول به ' + p.name }],
      p.balance >= 0 ? 'receive' : 'pay'))}
        ${UI.field('مبلغ', UI.input('amount', { type: 'number', cls: 'big' }))}
        <div class="grid-2 keep">
          ${UI.field('روش', UI.select('method', [
        { v: 'cash', t: 'نقده' }, { v: 'hawala', t: 'حواله' },
        { v: 'bank', t: 'بانک' }, { v: 'cheque', t: 'چک' }], 'cash'))}
          ${UI.field('شماره حواله / مرجع', UI.input('ref_no'))}
        </div>
        <div class="grid-2 keep">
          ${UI.field('ارز', UI.select('currency', [{ v: 'AFN', t: 'افغانی' }, { v: 'USD', t: 'دالر' }, { v: 'PKR', t: 'کلدار' }], S.meta.base_currency))}
          ${UI.field('نرخ تبادله', UI.input('fx_rate', { type: 'number', value: 1 }))}
        </div>
        ${UI.dateField('تاریخ', 'doc_date')}
        ${UI.field('توضیح', UI.input('note'))}
        <button class="btn btn-primary btn-block" type="submit">ثبت</button>
      </form>`);
    ov.querySelector('#payF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(ev.target);
        d.party_id = p.id; d.station_id = stationId;
        const r = await API.post('/payments', d);
        closeSheet(); ok('ثبت شد — بیلانس جدید ' + money(r.balance)); render();
      } catch (e) { err(e.message); }
    };
  }
  window.PaymentForm = PaymentForm;

  async function partyLedger(view, id) {
    const d = await API.get('/parties/' + id + '/ledger');
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
  }

  /* ============================================================
     نرخ‌نامه
     ============================================================ */
  page('prices', async function (view) {
    const [cur, hist] = await Promise.all([
      API.get('/prices/current', q()), API.get('/prices')
    ]);
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">نرخ‌نامه</div>
          ${can('finance') ? h`<button class="btn btn-primary" data-new>ثبت نرخ جدید</button>` : ''}
        </div>
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
            <thead><tr><th>از تاریخ</th><th>محصول</th><th>استیشن</th><th class="num">نرخ</th><th>ارز</th><th>توضیح</th></tr></thead>
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
    if (nb) nb.onclick = () => PriceForm();
  });

  function PriceForm() {
    const ov = sheet('ثبت نرخ جدید', h`
      <form id="prF" class="stack">
        ${UI.banner('info', 'نرخ قدیم پاک نمی‌شود. سطر جدید با تاریخ اجرا ثبت می‌گردد و تاریخچه محفوظ می‌ماند.')}
        ${UI.field('محصول', UI.select('product_id', S.meta.products.map(p => ({ v: p.id, t: p.name })), S.meta.products[0] && S.meta.products[0].id))}
        ${UI.field('نرخ', UI.input('price', { type: 'number', cls: 'big' }))}
        <div class="grid-2 keep">
          ${UI.field('ارز', UI.select('currency', [{ v: 'AFN', t: 'افغانی' }, { v: 'USD', t: 'دالر' }], S.meta.base_currency))}
          ${UI.dateField('اجرا از تاریخ', 'effective_from')}
        </div>
        ${UI.field('استیشن', UI.select('station_id', S.meta.stations.map(s => ({ v: s.id, t: s.name })), S.stationId || '', { blank: 'همه استیشن‌ها' }))}
        ${UI.field('توضیح', UI.input('note', { ph: 'مثلاً: مطابق نرخ‌نامه رسمی' }))}
        <button class="btn btn-primary btn-block" type="submit">ثبت نرخ</button>
      </form>`);
    ov.querySelector('#prF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const r = await API.post('/prices', readForm(ev.target));
        closeSheet();
        if (r.open_shifts > 0) err('نرخ ثبت شد ولی ' + fa(r.open_shifts) + ' شفت باز است — هشدار ایجاد شد');
        else ok('نرخ ثبت شد');
        render();
      } catch (e) { err(e.message); }
    };
  }

  /* ============================================================
     مصارف
     ============================================================ */
  const CATS = ['معاش', 'کرایه', 'برق', 'ترمیم', 'ترانسپورت', 'مالیه', 'قرطاسیه', 'متفرقه'];

  page('expenses', async function (view) {
    const rows = await API.get('/expenses', q());
    const total = rows.reduce((s, x) => s + num(x.amount) * num(x.fx_rate, 1), 0);
    view.innerHTML = h`
      <div class="pad section stack">
        <div class="row-b">
          <div class="section-title">مصارف</div>
          ${can('finance') ? h`<button class="btn btn-primary" data-new>ثبت مصرف</button>` : ''}
        </div>
        <div class="grid-3 keep">
          ${UI.stat(money(total), 'مجموع مصارف نمایش‌داده‌شده')}
          ${UI.stat(fa(rows.length), 'تعداد سند')}
          ${UI.stat(esc(S.meta.base_currency), 'ارز پایه')}
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
            </div>
          </div>`).join('')}</div>` : UI.empty('مصرفی ثبت نشده')}
      </div>`;
    const nb = view.querySelector('[data-new]');
    if (nb) nb.onclick = () => ExpenseForm();
  });

  async function ExpenseForm() {
    const emps = await API.get('/parties', { kind: 'employee' });
    const stationId = S.stationId || (S.meta.stations[0] && S.meta.stations[0].id);
    const ov = sheet('ثبت مصرف', h`
      <form id="exF" class="stack">
        ${UI.field('نوع مصرف', UI.select('category', CATS.map(c => ({ v: c, t: c })), 'متفرقه'))}
        ${UI.field('مبلغ', UI.input('amount', { type: 'number', cls: 'big' }))}
        <div class="grid-2 keep">
          ${UI.field('روش پرداخت', UI.select('method', [
      { v: 'cash', t: 'نقده' }, { v: 'bank', t: 'بانک' }, { v: 'hawala', t: 'حواله' }], 'cash'))}
          ${UI.dateField('تاریخ', 'doc_date')}
        </div>
        ${UI.field('طرف حساب', UI.select('party_id', emps.map(e => ({ v: e.id, t: e.name })), '', { blank: '— اختیاری —' }))}
        ${UI.field('شماره مرجع', UI.input('ref_no'))}
        ${UI.field('توضیح', UI.input('note'))}
        <button class="btn btn-primary btn-block" type="submit">ثبت</button>
      </form>`);
    ov.querySelector('#exF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(ev.target); d.station_id = stationId;
        await API.post('/expenses', d);
        closeSheet(); ok('مصرف ثبت شد'); render();
      } catch (e) { err(e.message); }
    };
  }

  /* ============================================================
     تعدیل / جنراتور / انتقال / جدول سنجش
     ============================================================ */
  window.AdjustForm = function (t) {
    const ov = sheet('تعدیل موجودی — ' + t.name, h`
      <form id="adF" class="stack">
        ${UI.banner('warn', 'هر تعدیل در ثبت وقایع می‌ماند. تعدیل مکرر توسط یک کاربر هشدار ایجاد می‌کند.')}
        ${UI.field('نوع', UI.select('kind', [
      { v: 'genset', t: 'مصرف تیل جنراتور (خروج)' },
      { v: 'adjust', t: 'تعدیل موجودی' }], 'genset'))}
        ${UI.field('مقدار (لیتر)', UI.input('qty', { type: 'number', cls: 'big' }), 'منفی = خروج · مثبت = ورود')}
        ${UI.dateField('تاریخ', 'doc_date')}
        ${UI.field('دلیل', h`<textarea class="input" name="reason" placeholder="دلیل کامل — اجباری"></textarea>`)}
        <button class="btn btn-primary btn-block" type="submit">ثبت</button>
      </form>`);
    const f = ov.querySelector('#adF');
    f.querySelector('[name=kind]').addEventListener('change', e => {
      const qf = f.querySelector('[name=qty]');
      if (e.target.value === 'genset' && num(qf.value) > 0) qf.value = '-' + toLatin(qf.value);
    });
    f.onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(f);
        d.tank_id = t.id;
        if (d.kind === 'genset' && num(d.qty) > 0) d.qty = -num(d.qty);
        const r = await API.post('/stock/adjust', d);
        closeSheet(); ok('ثبت شد — موجودی جدید ' + L(r.book_l)); render();
      } catch (e) { err(e.message); }
    };
  };

  window.TransferForm = async function (t) {
    const tanks = (await API.get('/tanks', {})).filter(x => x.id !== t.id && x.product_id === t.product_id);
    if (!tanks.length) return err('تانک دیگری با همین محصول وجود ندارد');
    const ov = sheet('انتقال از ' + t.name, h`
      <form id="trF" class="stack">
        ${UI.field('تانک مقصد', UI.select('to_tank_id', tanks.map(x => ({ v: x.id, t: x.code + ' — ' + x.name + ' · ' + L(x.book_l) })), tanks[0].id))}
        ${UI.field('مقدار (لیتر)', UI.input('qty', { type: 'number', cls: 'big' }), 'موجودی مبدا: ' + L(t.book_l))}
        ${UI.dateField('تاریخ', 'doc_date')}
        <button class="btn btn-primary btn-block" type="submit">انتقال</button>
      </form>`);
    ov.querySelector('#trF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const d = readForm(ev.target); d.from_tank_id = t.id;
        await API.post('/stock/transfer', d);
        closeSheet(); ok('انتقال ثبت شد'); render();
      } catch (e) { err(e.message); }
    };
  };

  window.CalibForm = function (t) {
    const ov = sheet('جدول سنجش — ' + t.name, h`
      <div class="stack">
        <div class="segs">
          <button class="seg on" data-tab="paste">چسپاندن جدول واقعی</button>
          <button class="seg" data-tab="linear">تولید خطی (تخمینی)</button>
        </div>

        <form id="cpF" class="stack" data-pane="paste">
          ${UI.banner('info', 'هر سطر: <b>دیپ_میلی‌متر</b> فاصله <b>حجم_لیتر</b>. جدول واقعی سنجش تانک را از شرکت سازنده یا اداره معیارات بگیرید.')}
          <textarea class="input" name="text" rows="12" dir="ltr"
            placeholder="0 0&#10;10 285&#10;20 572&#10;30 861&#10;..."></textarea>
          <button class="btn btn-primary btn-block" type="submit">بارگذاری جدول</button>
        </form>

        <form id="clF" class="stack hide" data-pane="linear">
          ${UI.banner('warn', 'جدول خطی فقط برای تانک استوانه‌ای عمودی درست است. برای تانک افقی خطای بزرگ می‌دهد — جدول واقعی را وارد کنید.')}
          <div class="grid-3 keep">
            ${UI.field('ارتفاع تانک (mm)', UI.input('height_mm', { type: 'number', value: 2000 }))}
            ${UI.field('ظرفیت (لیتر)', UI.input('capacity_l', { type: 'number', value: t.capacity_l }))}
            ${UI.field('گام (mm)', UI.input('step_mm', { type: 'number', value: 10 }))}
          </div>
          <button class="btn btn-primary btn-block" type="submit">تولید جدول</button>
        </form>
      </div>`, { wide: true });

    ov.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      ov.querySelectorAll('.seg').forEach(x => x.classList.toggle('on', x === b));
      ov.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hide', p.dataset.pane !== b.dataset.tab));
    });
    ov.querySelector('#cpF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const r = await API.post('/tanks/' + t.id + '/calib', { text: toLatin(readForm(ev.target).text) });
        closeSheet(); ok(fa(r.count) + ' سطر ثبت شد'); render();
      } catch (e) { err(e.message); }
    };
    ov.querySelector('#clF').onsubmit = async ev => {
      ev.preventDefault();
      try {
        const r = await API.post('/tanks/' + t.id + '/calib/linear', readForm(ev.target));
        closeSheet(); ok(fa(r.count) + ' سطر تولید شد'); render();
      } catch (e) { err(e.message); }
    };
  };
})();
