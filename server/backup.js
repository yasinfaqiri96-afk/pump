'use strict';
const fs = require('node:fs');
const path = require('node:path');
const D = require('./db');

const DIR = path.join(D.ROOT, 'backups');
const KEEP_DAYS = 14;

function stamp(d) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kabul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function createDailyBackup() {
  if (process.env.PUMP_DISABLE_BACKUP === '1') return null;
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, 'pump-' + stamp(new Date()) + '.db');
  if (!fs.existsSync(file)) {
    const safe = file.replace(/'/g, "''");
    D.db.exec("VACUUM INTO '" + safe + "'");
    console.log('  ✓ بکاپ روزانه: ' + file);
  }
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const name of fs.readdirSync(DIR)) {
    if (!/^pump-\d{4}-\d{2}-\d{2}\.db$/.test(name)) continue;
    const full = path.join(DIR, name);
    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
  }
  return file;
}

function startAutomaticBackups() {
  try { createDailyBackup(); }
  catch (e) { console.error('[بکاپ] بکاپ خودکار ساخته نشد:', e.message); }
  const timer = setInterval(() => {
    try { createDailyBackup(); }
    catch (e) { console.error('[بکاپ] بکاپ خودکار ساخته نشد:', e.message); }
  }, 6 * 3600 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { createDailyBackup, startAutomaticBackups };
