'use strict';
const D = require('./db');
const Jalali = require('../public/js/shared/jalali.js');

function ensureSeed() {
  const has = D.get(`SELECT COUNT(*) c FROM app_user`).c;
  if (has > 0) return;

  const now = D.now();
  const today = Jalali.todayGregorian();

  D.setSetting('company_name', 'شرکت نفتی نمونه');
  D.setSetting('base_currency', 'AFN');
  D.setSetting('cash_tolerance', '50');
  D.setSetting('dip_jump_pct', '25');
  D.setSetting('fiscal_start', '01-01');

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
    ['KER', 'تیل خاک', 'لیتر', 'jet', 0.800, 0.5, 0, '#6ABBAB']
  ];
  const pIds = {};
  for (const p of products) {
    const r = D.run(`INSERT INTO product (code,name,uom,density_group,default_density,tolerance_pct,is_mass,color,active)
      VALUES (?,?,?,?,?,?,?,?,1)`, ...p);
    pIds[p[0]] = Number(r.lastInsertRowid);
  }

  /* استیشن نمونه */
  const s = D.run(`INSERT INTO station (code,name,province,address,phone,active)
    VALUES ('ST01','استیشن مرکزی','هرات','سرک عمومی','0700000000',1)`);
  const stationId = Number(s.lastInsertRowid);

  /* تانک‌های نمونه. جدول سنجش عمداً ساخته نمی‌شود؛ برای تانک افقی جدول خطی خطرناک است. */
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
  }

  /* دستگاه و نازل */
  const d1 = Number(D.run(`INSERT INTO dispenser (station_id,code,name,active) VALUES (?,?,?,1)`,
    stationId, 'D1', 'دستگاه ۱').lastInsertRowid);
  const d2 = Number(D.run(`INSERT INTO dispenser (station_id,code,name,active) VALUES (?,?,?,1)`,
    stationId, 'D2', 'دستگاه ۲').lastInsertRowid);
  const nozzles = [
    [d1, tankIds['T-01'], 'N1', 6, 1],
    [d1, tankIds['T-02'], 'N2', 6, 1],
    [d2, tankIds['T-01'], 'N3', 6, 1],
    [d2, tankIds['T-03'], 'N4', 6, 1]
  ];
  for (const n of nozzles)
    D.run(`INSERT INTO nozzle (dispenser_id,tank_id,code,meter_digits,meter_factor,last_reading,active)
           VALUES (?,?,?,?,?,0,1)`, ...n);

  /* نرخ اولیه */
  /* نرخ اولیه با تاریخ اجرای گذشته تا اسناد قدیمی هم نرخ پیدا کنند */
  const priceStart = Jalali.addDaysGreg(today, -365);
  const prices = [[pIds.PET, 78], [pIds.DSL, 73], [pIds.KER, 70]];
  for (const p of prices)
    D.run(`INSERT INTO price (station_id,product_id,price,currency,effective_from,note,created_by,created_at)
           VALUES (NULL,?,?, 'AFN', ?, 'نرخ اولیه سیستم', 1, ?)`, p[0], p[1], priceStart, now);

  /* طرف حساب نمونه */
  const parties = [
    ['employee', 'EMP01', 'اپراتور نمونه', '0700000001', 0, 0, 0, 12000],
    ['customer', 'CUS01', 'شرکت ترانسپورتی نمونه', '0700000002', 200000, 30, 0, 0],
    ['supplier', 'SUP01', 'وارد کننده نمونه', '0700000003', 0, 0, 0, 0],
    ['transporter', 'TRN01', 'ترانسپورت نمونه', '0700000004', 0, 0, 0, 0]
  ];
  for (const p of parties)
    D.run(`INSERT INTO party (kind,code,name,phone,credit_limit,credit_days,opening_bal,salary,active)
           VALUES (?,?,?,?,?,?,?,?,1)`, ...p);

  D.audit(null, 'راه‌اندازی اولیه سیستم', 'setting', null,
    'استیشن، محصولات، تانک‌ها، نازل‌ها و نرخ اولیه ایجاد شد');

  console.log('  ✓ داده اولیه ساخته شد (استیشن هرات، ۳ تانک، ۴ نازل، ۳ محصول)');
}

module.exports = { ensureSeed };
