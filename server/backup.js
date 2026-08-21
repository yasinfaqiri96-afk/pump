'use strict';
/* ============================================================
   بکاپ و برگرداندن بکاپ
   روش: VACUUM INTO — یک فایل واحد، فشرده، بدون WAL جانبی.
   بکاپ می‌تواند در پوشه داخلی یا روی درایو/USB دیگر ذخیره شود.
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const D = require('./db');
const Jalali = require('../public/js/shared/jalali.js');

const DEFAULT_DIR = path.join(D.ROOT, 'backups');

/* جدول‌هایی که وجودشان یعنی فایل واقعاً دیتابیس این سیستم است */
const REQUIRED = ['app_user', 'station', 'tank', 'stock_move', 'money_move'];

function backupDir() {
  const custom = D.setting('backup_dir', '');
  const dir = custom && String(custom).trim() ? String(custom).trim() : DEFAULT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* نام فایل: pump-1405-05-20-1800.db  (تاریخ شمسی + ساعت) */
function stamp() {
  const d = new Date();
  const sh = Jalali.todayShamsi();
  const p2 = x => String(x).padStart(2, '0');
  return sh + '-' + p2(d.getHours()) + p2(d.getMinutes());
}

function safeSql(p) { return p.replace(/'/g, "''"); }

function backupNow(kind, user, opts) {
  opts = opts || {};
  const dir = opts.dir ? String(opts.dir) : backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'pump-' + stamp() + (kind === 'auto' ? '-auto' : '') +
    (kind === 'pre_restore' ? '-pre-restore' : '') + '.db');

  /* اگر همان ثانیه دو بار زده شود، فایل قبلی پاک نشود */
  let target = file, i = 2;
  while (fs.existsSync(target)) { target = file.replace(/\.db$/, '-' + i + '.db'); i++; }

  D.exec(`VACUUM INTO '${safeSql(target)}'`);
  const size = fs.statSync(target).size;

  D.run(`INSERT INTO backup_log (at,kind,file_path,size_bytes,ok,message,created_by)
         VALUES (?,?,?,?,1,?,?)`,
    D.now(), kind, target, size, opts.note || null, user ? user.id : null);
  D.setSetting('backup_last_at', D.now());
  D.setSetting('backup_last_file', target);

  prune(dir);
  return { file: target, size_bytes: size, at: D.now() };
}

/* نگهداری تعداد محدود بکاپ خودکار — دیسک پمپ استیشن پر نشود */
function prune(dir) {
  const keep = Math.max(3, Number(D.setting('backup_keep', '20')) || 20);
  let files;
  try { files = fs.readdirSync(dir).filter(f => /^pump-.*-auto.*\.db$/.test(f)); }
  catch (_) { return; }
  if (files.length <= keep) return;
  const stat = files.map(f => {
    const p = path.join(dir, f);
    let m = 0; try { m = fs.statSync(p).mtimeMs; } catch (_) { }
    return { p, m };
  }).sort((a, b) => b.m - a.m);
  for (const x of stat.slice(keep)) { try { fs.unlinkSync(x.p); } catch (_) { } }
}

function list(limit) {
  const dir = backupDir();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).map(f => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { name: f, path: p, size_bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() };
    }).sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  } catch (_) { }
  return files.slice(0, limit || 50);
}

/* ---------- کنترل سلامت فایل بکاپ قبل از برگرداندن ---------- */
function validate(file) {
  const out = { ok: false, problems: [], info: {} };
  if (!file || !fs.existsSync(file)) { out.problems.push('فایل یافت نشد'); return out; }
  const st = fs.statSync(file);
  if (!st.isFile() || st.size < 4096) { out.problems.push('فایل خالی یا خراب است'); return out; }
  out.info.size_bytes = st.size;
  out.info.mtime = new Date(st.mtimeMs).toISOString();

  let t = null;
  try {
    t = new DatabaseSync(file, { readOnly: true });
    const chk = t.prepare(`PRAGMA quick_check`).get();
    const val = chk ? Object.values(chk)[0] : '';
    if (String(val).toLowerCase() !== 'ok') out.problems.push('کنترل سلامت SQLite ناکام: ' + val);

    const names = new Set(t.prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all().map(r => r.name));
    for (const r of REQUIRED)
      if (!names.has(r)) out.problems.push('جدول ' + r + ' در این فایل نیست');

    if (names.has('app_user')) {
      const c = t.prepare(`SELECT COUNT(*) c FROM app_user`).get().c;
      out.info.users = c;
      if (!c) out.problems.push('در این فایل هیچ کاربری نیست');
    }
    if (names.has('schema_version')) {
      const v = t.prepare(`SELECT MAX(id) v FROM schema_version`).get();
      out.info.schema_version = v ? v.v : 0;
    } else out.info.schema_version = 0;
    if (names.has('stock_move'))
      out.info.stock_moves = t.prepare(`SELECT COUNT(*) c FROM stock_move`).get().c;
    if (names.has('station')) {
      const s = t.prepare(`SELECT name FROM station ORDER BY id LIMIT 1`).get();
      out.info.station = s ? s.name : null;
    }
  } catch (e) {
    out.problems.push('باز کردن فایل ناکام شد: ' + e.message);
  } finally { try { if (t) t.close(); } catch (_) { } }

  out.ok = out.problems.length === 0;
  return out;
}

/* ---------- برگرداندن بکاپ ---------- */
function restore(file, user) {
  const v = validate(file);
  if (!v.ok) { const e = new Error('این فایل بکاپ سالم نیست: ' + v.problems.join('؛ ')); e.httpCode = 400; throw e; }

  /* اول از دیتابیس فعلی بکاپ اضطراری گرفته شود */
  const emergency = backupNow('pre_restore', user, { note: 'قبل از برگرداندن ' + path.basename(file) });

  const target = D.DB_PATH;
  D.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  try { D.handle().close(); } catch (_) { }

  try {
    for (const suffix of ['-wal', '-shm']) {
      const p = target + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    fs.copyFileSync(file, target);
  } catch (e) {
    /* تلاش برای بازگرداندن وضعیت قبلی */
    try { fs.copyFileSync(emergency.file, target); } catch (_) { }
    D.reopen();
    const err = new Error('برگرداندن بکاپ ناکام شد: ' + e.message);
    err.httpCode = 500;
    throw err;
  }

  D.reopen();
  D.run(`DELETE FROM session`);          // همه باید دوباره وارد شوند
  D.audit(user, 'برگرداندن بکاپ', 'backup', null,
    'فایل ' + path.basename(file) + ' — بکاپ اضطراری: ' + path.basename(emergency.file));
  D.run(`INSERT INTO backup_log (at,kind,file_path,size_bytes,ok,message,created_by)
         VALUES (?,?,?,?,1,?,?)`,
    D.now(), 'restore', file, v.info.size_bytes || 0,
    'برگردانده شد — بکاپ اضطراری ' + emergency.file, user ? user.id : null);

  return { ok: true, restored: path.basename(file), emergency_backup: emergency.file, info: v.info };
}

/* ---------- بکاپ خودکار ---------- */
function hoursSinceLast() {
  const last = D.setting('backup_last_at', '');
  if (!last) return Infinity;
  const t = Date.parse(last);
  if (!isFinite(t)) return Infinity;
  return (Date.now() - t) / 3600000;
}

function autoTick() {
  try {
    const every = Math.max(1, Number(D.setting('backup_auto_hours', '24')) || 24);
    if (D.settingOn('backup_auto', true) && hoursSinceLast() >= every)
      backupNow('auto', null, { note: 'بکاپ خودکار' });

    const overdue = Math.max(2, Number(D.setting('backup_overdue_hours', '48')) || 48);
    if (hoursSinceLast() >= overdue)
      D.raiseAlert(null, 'medium', 'BACKUP_OVERDUE', 'بکاپ گرفته نشده است',
        'آخرین بکاپ بیش از ' + Math.round(hoursSinceLast()) + ' ساعت پیش بوده. '
        + 'در تنظیمات ← بکاپ، یک بکاپ بگیرید و روی USB کاپی کنید.', 'backup', null);
  } catch (e) {
    console.error('[بکاپ خودکار]', e.message);
  }
}

function status() {
  const dir = backupDir();
  const last = D.get(`SELECT * FROM backup_log ORDER BY id DESC LIMIT 1`);
  return {
    dir,
    default_dir: DEFAULT_DIR,
    auto: D.settingOn('backup_auto', true),
    auto_hours: Number(D.setting('backup_auto_hours', '24')),
    keep: Number(D.setting('backup_keep', '20')),
    last_at: D.setting('backup_last_at', ''),
    last_file: D.setting('backup_last_file', ''),
    hours_since: hoursSinceLast() === Infinity ? null : Math.round(hoursSinceLast() * 10) / 10,
    last_log: last || null,
    files: list(30),
    db_path: D.DB_PATH,
    db_size_bytes: (() => { try { return fs.statSync(D.DB_PATH).size; } catch (_) { return 0; } })()
  };
}

module.exports = { backupNow, list, validate, restore, autoTick, status, backupDir, DEFAULT_DIR };
