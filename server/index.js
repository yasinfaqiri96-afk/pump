'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const D = require('./db');
const api = require('./api');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function send(res, code, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(code, h);
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      const idx = path.join(PUBLIC, 'index.html');
      return fs.readFile(idx, (e2, buf) => {
        if (e2) return send(res, 404, 'not found');
        send(res, 200, buf, { 'Content-Type': MIME['.html'] });
      });
    }
    fs.readFile(file, (e, buf) => {
      if (e) return send(res, 500, 'error');
      const ext = path.extname(file).toLowerCase();
      send(res, 200, buf, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    });
  });
}

/* پشت پروکسی (Render، Cloudflare) نشانی واقعی در x-forwarded-for است.
   اولین مقدار نشانی مشتری است؛ بقیه پروکسی‌های میانی‌اند. */
function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').toString();
  if (fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > 8e6) { reject(new Error('حجم درخواست زیاد است')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(new Error('بدنه درخواست معتبر نیست')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const pathname = u.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    try { body = await readBody(req); }
    catch (e) { return send(res, 400, JSON.stringify({ error: e.message }), { 'Content-Type': MIME['.json'] }); }
  }

  const ctx = {
    method: req.method,
    path: pathname.replace(/^\/api/, ''),
    query: u.query,
    body,
    token: (req.headers['x-token'] || u.query.token || '').toString(),
    ip: clientIp(req)
  };

  try {
    const out = await api.handle(ctx);
    send(res, out.code || 200, JSON.stringify(out.body ?? {}), { 'Content-Type': MIME['.json'] });
  } catch (e) {
    const code = e.httpCode || 500;
    if (code >= 500) console.error('[خطا]', ctx.method, ctx.path, e);
    send(res, code, JSON.stringify({ error: e.message || 'خطای داخلی سرور' }),
      { 'Content-Type': MIME['.json'] });
  }
});

require('./seed').ensureSeed();

const Backup = require('./backup');

/* ---------- نگهداری دوره‌ای ----------
   بکاپ خودکار، پاک‌سازی نشست‌های منقضی و کلیدهای کهنه.
   هر ۳۰ دقیقه، و یک بار در شروع. */
function housekeeping() {
  try {
    D.run(`DELETE FROM session WHERE expires_at < ?`, D.now());
    D.purgeIdemKeys();
    Backup.autoTick();
    calibrationWatch();
  } catch (e) { console.error('[نگهداری]', e.message); }
}

/* هشدار کالیبراسیون نزدیک به ختم */
function calibrationWatch() {
  const days = Math.max(1, Number(D.setting('calib_warn_days', '30')) || 30);
  const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const nz = D.all(`SELECT n.id, n.code, n.next_check, d.station_id, d.code dispenser_code
    FROM nozzle n JOIN dispenser d ON d.id=n.dispenser_id
    WHERE n.active=1 AND n.next_check IS NOT NULL AND n.next_check <= ?`, limit);
  for (const n of nz)
    D.raiseAlert(n.station_id, 'medium', 'CALIBRATION_EXPIRED',
      'کالیبراسیون نازل ' + n.dispenser_code + '/' + n.code + ' نزدیک ختم است',
      'تاریخ کنترل بعدی: ' + n.next_check + '. کالیبراسیون نازل را تجدید کنید.',
      'nozzle', n.id);

  const tk = D.all(`SELECT v.tank_id, v.next_check, t.code, t.station_id
    FROM tank_calib_version v JOIN tank t ON t.id=v.tank_id
    WHERE v.id = t.calib_version_id AND v.next_check IS NOT NULL AND v.next_check <= ?`, limit);
  for (const t of tk)
    D.raiseAlert(t.station_id, 'medium', 'CALIBRATION_EXPIRED',
      'جدول سنجش تانک ' + t.code + ' نزدیک ختم است',
      'تاریخ کنترل بعدی: ' + t.next_check + '. جدول سنجش تجدید شود.', 'tank', t.tank_id);
}

housekeeping();
setInterval(housekeeping, 30 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  const nets = require('node:os').networkInterfaces();
  const ips = [];
  for (const k of Object.keys(nets))
    for (const n of nets[k]) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  console.log('');
  console.log('  ██  سیستم مدیریت تانک تیل و پمپ استیشن');
  console.log('  ─────────────────────────────────────────');
  console.log('  دیتابیس :  ' + D.DB_PATH);
  if (D.MIG && D.MIG.applied && D.MIG.applied.length) {
    console.log('  مهاجرت  :  ' + D.MIG.applied.length + ' مورد اجرا شد');
    D.MIG.applied.forEach(m => console.log('             ' + m));
    if (D.MIG.backup) console.log('  بکاپ قبل از مهاجرت: ' + D.MIG.backup);
  }
  console.log('  محلی    :  http://localhost:' + PORT);
  ips.forEach(ip => console.log('  شبکه    :  http://' + ip + ':' + PORT));
  console.log('');
  console.log(process.env.ADMIN_PIN
    ? '  کاربر پیش‌فرض:  admin   —  پین:  از متغیر ADMIN_PIN'
    : '  کاربر پیش‌فرض:  admin   —  پین:  1234');
  console.log('  برای توقف: Ctrl+C');
  console.log('');
});
