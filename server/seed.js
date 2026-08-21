'use strict';
const D = require('./db');
const Jalali = require('../public/js/shared/jalali.js');

/* داده اولیه — نمونه واقع‌نما از هرات.
   تمام نام‌ها ساختگی است و به هیچ شخص یا شرکت واقعی مربوط نیست. */
function ensureSeed() {
  const has = D.get(`SELECT COUNT(*) c FROM app_user`).c;
  if (has > 0) return;

  const now = D.now();
  const today = Jalali.todayGregorian();

  D.setSetting('company_name', 'شرکت تیل هرات (نمونه)');
  D.setSetting('base_currency', 'AFN');
  D.setSetting('cash_tolerance', '50');
  D.setSetting('dip_jump_pct', '25');
  D.setSetting('fiscal_start', '01-01');
  D.setSetting('backup_auto', '1');
  D.setSetting('backup_auto_hours', '24');
  D.setSetting('backup_keep', '20');
  D.setSetting('backup_overdue_hours', '48');
  D.setSetting('quality_on', '1');
  D.setSetting('consignment_on', '0');     // ماژول امانتی — پیش‌فرض خاموش
  D.setSetting('orders_on', '0');          // پیش‌خرید/پیش‌فروش — پیش‌فرض خاموش
  D.setSetting('transfer_require_dip', '0');
  D.setSetting('calib_warn_days', '30');

  /* کاربر مالک.
     پین از متغیر محیطی ADMIN_PIN خوانده می‌شود. در حالت production
     بدون این متغیر سیستم بالا نمی‌آید تا پین پیش‌فرض روی اینترنت باز نماند. */
  const adminPin = process.env.ADMIN_PIN || '';
  if (!adminPin && process.env.NODE_ENV === 'production')
    throw new Error('ADMIN_PIN تنظیم نشده است. برای اجرای production این متغیر محیطی الزامی است.');
  D.run(`INSERT INTO app_user (username,full_name,role,station_id,pin_hash,active,created_at)
         VALUES ('admin','مدیر سیستم','owner',NULL,?,1,?)`, D.hashPin(adminPin || '1234'), now);

  /* محصولات */
  const products = [
    ['PET', 'پطرول', 'لیتر', 'gasoline', 0.745, 0.6, 0, '#0B8457'],
    ['DSL', 'دیزل', 'لیتر', 'diesel', 0.840, 0.5, 0, '#0B6784'],
    ['KER', 'تیل خاک', 'لیتر', 'jet', 0.800, 0.5, 0, '#6ABBAB'],
    ['LPG', 'گاز مایع', 'کیلوگرام', 'lpg', 0.540, 0.8, 1, '#FF4200']
  ];
  const pIds = {};
  for (const p of products) {
    const r = D.run(`INSERT INTO product (code,name,uom,density_group,default_density,tolerance_pct,is_mass,color,active)
      VALUES (?,?,?,?,?,?,?,?,1)`, ...p);
    pIds[p[0]] = Number(r.lastInsertRowid);
  }

  /* استیشن نمونه — هرات */
  const s = D.run(`INSERT INTO station (code,name,province,address,phone,license_no,active)
    VALUES ('ST01','پمپ استیشن هرات','هرات','سرک عمومی هرات — اسلام‌قلعه','0790000000','HRT-0000',1)`);
  const stationId = Number(s.lastInsertRowid);

  /* تانک‌ها + جدول سنجش نسخه ۱ */
  const tanks = [
    // کد، نام، محصول، ظرفیت، ذخیره مرده، حد هشدار، موجودی افتتاحیه، بهای واحد
    ['T-01', 'تانک پطرول ۱', pIds.PET, 40000, 500, 4000, 26500, 71],
    ['T-02', 'تانک دیزل ۱', pIds.DSL, 60000, 800, 6000, 41200, 66],
    ['T-03', 'تانک دیزل ۲', pIds.DSL, 60000, 800, 6000, 18400, 66]
  ];
  const tankIds = {};
  for (const t of tanks) {
    const r = D.run(`INSERT INTO tank
      (station_id,product_id,code,name,capacity_l,dead_stock_l,min_level_l,kind,opening_qty,opening_cost,active)
      VALUES (?,?,?,?,?,?,?, 'زیرزمینی', ?, ?, 1)`,
      stationId, t[2], t[0], t[1], t[3], t[4], t[5], t[6], t[7]);
    const id = Number(r.lastInsertRowid);
    tankIds[t[0]] = id;

    /* جدول سنجش نمونه: ارتفاع ۲۰۰۰ mm، گام ۱۰ mm — نسخه ۱ */
    const v = D.run(`INSERT INTO tank_calib_version
      (tank_id,version,effective_from,source,point_count,note,created_by,created_at)
      VALUES (?,1,?, 'linear', ?, ?, 1, ?)`,
      id, today, 201, 'جدول نمونه — جدول واقعی سنجش تانک را جایگزین کنید', now);
    const vid = Number(v.lastInsertRowid);
    for (let mm = 0; mm <= 2000; mm += 10) {
      const vol = D.round(t[3] * mm / 2000, 3);
      D.run(`INSERT INTO tank_calib_point (version_id,dip_mm,volume_l) VALUES (?,?,?)`, vid, mm, vol);
      D.run(`INSERT INTO tank_calib (tank_id,dip_mm,volume_l) VALUES (?,?,?)`, id, mm, vol);
    }
    D.run(`UPDATE tank SET calib_version_id=? WHERE id=?`, vid, id);
  }

  /* دستگاه و نازل */
  const d1 = Number(D.run(`INSERT INTO dispenser (station_id,code,name,active) VALUES (?,?,?,1)`,
    stationId, 'D1', 'دستگاه ۱').lastInsertRowid);
  const d2 = Number(D.run(`INSERT INTO dispenser (station_id,code,name,active) VALUES (?,?,?,1)`,
    stationId, 'D2', 'دستگاه ۲').lastInsertRowid);
  const nozzles = [
    [d1, tankIds['T-01'], 'N1'],
    [d1, tankIds['T-02'], 'N2'],
    [d2, tankIds['T-01'], 'N3'],
    [d2, tankIds['T-03'], 'N4']
  ];
  for (const n of nozzles) {
    const r = D.run(`INSERT INTO nozzle (dispenser_id,tank_id,code,meter_digits,meter_factor,last_reading,calib_date,active)
           VALUES (?,?,?,6,1,0,?,1)`, n[0], n[1], n[2], today);
    D.run(`INSERT INTO nozzle_calib (nozzle_id,effective_from,meter_factor,note,created_by,created_at)
           VALUES (?,?,1,?,1,?)`, Number(r.lastInsertRowid), today, 'کالیبراسیون اولیه', now);
  }

  /* نرخ اولیه با تاریخ اجرای گذشته تا اسناد قدیمی هم نرخ پیدا کنند */
  const priceStart = Jalali.addDaysGreg(today, -365);
  const prices = [[pIds.PET, 78], [pIds.DSL, 73], [pIds.KER, 70], [pIds.LPG, 67]];
  for (const p of prices)
    D.run(`INSERT INTO price (station_id,product_id,price,currency,effective_from,note,created_by,created_at)
           VALUES (NULL,?,?, 'AFN', ?, 'نرخ اولیه سیستم', 1, ?)`, p[0], p[1], priceStart, now);

  /* نرخ اسعار نمونه */
  D.run(`INSERT INTO fx_rate (rate_date,ccy,rate,note,created_at) VALUES (?, 'USD', 68.5, ?, ?)`,
    today, 'نرخ نمونه — نرخ واقعی روز را ثبت کنید', now);
  D.run(`INSERT INTO fx_rate (rate_date,ccy,rate,note,created_at) VALUES (?, 'PKR', 0.245, ?, ?)`,
    today, 'نرخ نمونه', now);

  /* طرف حساب نمونه */
  const parties = [
    ['employee', 'EMP01', 'اپراتور شفت صبح', '0790000001', 0, 0, 0, 12000],
    ['employee', 'EMP02', 'دیپ‌زن استیشن', '0790000002', 0, 0, 0, 10000],
    ['customer', 'CUS01', 'شرکت ترانسپورتی نمونه هرات', '0790000003', 200000, 30, 0, 0],
    ['customer', 'CUS02', 'شرکت ساختمانی نمونه', '0790000004', 150000, 15, 0, 0],
    ['supplier', 'SUP01', 'وارد کننده تیل نمونه', '0790000005', 0, 0, 0, 0],
    ['transporter', 'TRN01', 'ترانسپورت تانکر نمونه', '0790000006', 0, 0, 0, 0]
  ];
  const partyIds = {};
  for (const p of parties) {
    const r = D.run(`INSERT INTO party (kind,code,name,phone,credit_limit,credit_days,opening_bal,salary,active)
           VALUES (?,?,?,?,?,?,?,?,1)`, ...p);
    partyIds[p[1]] = Number(r.lastInsertRowid);
  }

  /* موترهای مشتری قراردادی — برای فروش قرضی از نازل */
  const vehicles = [
    [partyIds.CUS01, '۱۲۳۴ هرات', 'تانکر باربری', pIds.DSL, 'راننده موتر ۱'],
    [partyIds.CUS01, '۵۶۷۸ هرات', 'موتر باربری', pIds.DSL, 'راننده موتر ۲'],
    [partyIds.CUS02, '۹۰۱۲ هرات', 'موتر سواری', pIds.PET, 'راننده موتر ۳']
  ];
  for (const v of vehicles)
    D.run(`INSERT INTO vehicle (party_id,plate_no,kind,product_id,driver_name,credit_limit,active,created_at)
           VALUES (?,?,?,?,?,0,1,?)`, v[0], v[1], v[2], v[3], v[4], now);

  D.audit(null, 'راه‌اندازی اولیه سیستم', 'setting', null,
    'استیشن هرات، ۴ محصول، ۳ تانک، ۴ نازل، مشتریان و موترهای نمونه ایجاد شد');

  console.log('  ✓ داده اولیه ساخته شد (پمپ استیشن هرات، ۳ تانک، ۴ نازل، ۴ محصول، ۳ موتر)');
}

module.exports = { ensureSeed };
