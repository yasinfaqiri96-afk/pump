'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'data', 'test-' + process.pid + '.db');
process.env.PUMP_DB = file;
process.env.PUMP_DISABLE_BACKUP = '1';

const D = require('../server/db');
const A = require('../server/api');

D.run(`INSERT INTO setting(key,value) VALUES ('base_currency','AFN')`);
D.run(`INSERT INTO station(id,code,name,active) VALUES (1,'HRT','هرات',1),(2,'KBL','کابل',1)`);
D.run(`INSERT INTO product(id,code,name,uom,density_group,default_density,tolerance_pct,color,active)
       VALUES (1,'DSL','دیزل','لیتر','diesel',0.84,0.5,'#000',1)`);
D.run(`INSERT INTO tank(id,station_id,product_id,code,name,capacity_l,opening_qty,opening_cost,active)
       VALUES (1,1,1,'T1','تانک هرات',10000,5000,50,1),(2,2,1,'T2','تانک کابل',10000,5000,50,1)`);
for (const id of [1, 2]) {
  D.run(`INSERT INTO tank_calib(tank_id,dip_mm,volume_l) VALUES (?,?,?),(?,?,?)`, id, 0, 0, id, 1000, 10000);
}
D.run(`INSERT INTO app_user(id,username,full_name,role,station_id,pin_hash,active,created_at)
       VALUES (1,'op','اپراتور','operator',1,?,1,?)`, D.hashPin('9876'), D.now());
D.run(`INSERT INTO session(token,user_id,created_at,expires_at) VALUES ('test-token',1,?,?)`,
  D.now(), new Date(Date.now() + 3600000).toISOString());

test('دیپ بیرون جدول و آب بیشتر از دیپ رد می‌شود', () => {
  assert.throws(() => A.dipVolumes(1, 1001, 0), /محدوده جدول سنجش/);
  assert.throws(() => A.dipVolumes(1, 100, 101), /آب نمی‌تواند/);
  assert.equal(A.dipVolumes(1, 500, 10).net, 4900);
});

test('کاربر استیشن به استیشن دیگر دسترسی ندارد', async () => {
  await assert.rejects(() => A.handle({
    method: 'GET', path: '/tanks', query: { station_id: '2' }, body: {}, token: 'test-token', ip: 'test'
  }), e => e.httpCode === 403 && /دسترسی/.test(e.message));
});

test('نرخ ارزی با نرخ همان تاریخ به افغانی تبدیل می‌شود', () => {
  D.run(`INSERT INTO fx_rate(rate_date,ccy,rate) VALUES ('2026-01-01','USD',70)`);
  D.run(`INSERT INTO price(station_id,product_id,price,currency,effective_from,created_by,created_at)
         VALUES (1,1,1,'USD','2026-01-01',1,?)`, D.now());
  assert.equal(D.activePrice(1, 1, '2026-02-01'), 70);
});

test.after(() => {
  D.db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(file + suffix); } catch (_) { }
  }
});
