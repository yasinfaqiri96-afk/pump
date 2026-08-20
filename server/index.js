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
    token: (req.headers['x-token'] || u.query.token || '').toString()
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

server.listen(PORT, HOST, () => {
  const nets = require('node:os').networkInterfaces();
  const ips = [];
  for (const k of Object.keys(nets))
    for (const n of nets[k]) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  console.log('');
  console.log('  ██  سیستم مدیریت تانک تیل و پمپ استیشن');
  console.log('  ─────────────────────────────────────────');
  console.log('  دیتابیس :  ' + D.DB_PATH);
  console.log('  محلی    :  http://localhost:' + PORT);
  ips.forEach(ip => console.log('  شبکه    :  http://' + ip + ':' + PORT));
  console.log('');
  console.log('  کاربر پیش‌فرض:  admin   —  پین:  1234');
  console.log('  برای توقف: Ctrl+C');
  console.log('');
});
