// Davomat botini o'z serveringizda ishga tushirish (Node.js 22.5+, qo'shimcha paketsiz).
//
//   cd bot && cp .env.example .env   # BOT_TOKEN va ADMIN_KEY ni yozing
//   node server.js
//
// Rejimlar:
//   MODE=polling  (standart) — Telegram'dan xabarlarni server o'zi so'raydi; domen/SSL shart emas.
//   MODE=webhook  — Telegram xabarlarni PUBLIC_URL/tg ga yuboradi (https domen kerak).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import worker from './worker.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- .env faylini o'qish (ixtiyoriy)
const envFile = path.join(DIR, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const cfg = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_KEY: process.env.ADMIN_KEY,
  PORT: +(process.env.PORT || 8787),
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || path.join(DIR, 'davomat.db'),
  MODE: (process.env.MODE || 'polling').toLowerCase(),
  PUBLIC_URL: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  TG_API: process.env.TG_API || 'https://api.telegram.org',
};
if (!cfg.BOT_TOKEN || !cfg.ADMIN_KEY) {
  console.error("❌ BOT_TOKEN va ADMIN_KEY kerak (.env faylida yoki muhit o'zgaruvchisi sifatida).");
  process.exit(1);
}

// ---- SQLite (Cloudflare D1 bilan bir xil interfeys)
let sqlite;
try {
  ({ DatabaseSync: sqlite } = await import('node:sqlite'));
} catch {
  console.error('❌ Node.js 22.5 yoki undan yangi versiya kerak (node:sqlite). Hozirgi: ' + process.version);
  process.exit(1);
}
const db = new sqlite(cfg.DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
const DB = {
  prepare(sql) {
    const st = db.prepare(sql);
    let args = [];
    const o = {
      bind(...a) { args = a; return o; },
      async run() { st.run(...args); return { success: true }; },
      async first() { return st.get(...args) ?? null; },
      async all() { return { results: st.all(...args) }; },
    };
    return o;
  },
};
const env = { DB, BOT_TOKEN: cfg.BOT_TOKEN, ADMIN_KEY: cfg.ADMIN_KEY, TG_API: cfg.TG_API };
const base = `http://127.0.0.1:${cfg.PORT}`;
const secret = createHash('sha256').update(cfg.ADMIN_KEY + ':tg').digest('hex').slice(0, 32);

async function tg(method, payload = {}) {
  const res = await fetch(`${cfg.TG_API}/bot${cfg.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return res.json();
}

// ---- HTTP server (sayt API'si va webhook)
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const r = await worker.fetch(new Request(base + req.url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }), env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Xato: ' + e.message);
    }
  });
});

// ---- Polling: Telegram'dan yangilanishlarni so'rab olish
async function poll() {
  await tg('deleteWebhook', { drop_pending_updates: false });
  let offset = 0;
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
      if (!r.ok) { console.error('getUpdates:', r.description); await new Promise((s) => setTimeout(s, 5000)); continue; }
      for (const u of r.result) {
        offset = u.update_id + 1;
        await worker.fetch(new Request(base + '/tg', {
          method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'Content-Type': 'application/json' }, body: JSON.stringify(u),
        }), env).catch((e) => console.error('update xato:', e.message));
      }
    } catch (e) {
      console.error('Tarmoq xatosi:', e.message);
      await new Promise((s) => setTimeout(s, 5000));
    }
  }
}

server.listen(cfg.PORT, cfg.HOST, async () => {
  const me = await tg('getMe').catch(() => ({}));
  if (!me.ok) { console.error("❌ BOT_TOKEN noto'g'ri yoki Telegram'ga ulanib bo'lmadi:", me.description || ''); }
  console.log(`✅ Bot @${me.result ? me.result.username : '?'} — http://${cfg.HOST}:${cfg.PORT} (rejim: ${cfg.MODE})`);
  await tg('setMyCommands', { commands: [{ command: 'davomat', description: 'Davomat qilish' }, { command: 'start', description: 'Boshlash' }] }).catch(() => {});
  if (cfg.MODE === 'webhook') {
    if (!cfg.PUBLIC_URL) { console.error('❌ webhook rejimi uchun PUBLIC_URL kerak'); process.exit(1); }
    const r = await tg('setWebhook', { url: cfg.PUBLIC_URL + '/tg', secret_token: secret, allowed_updates: ['message', 'callback_query'] });
    console.log(r.ok ? `Webhook: ${cfg.PUBLIC_URL}/tg` : 'Webhook xatosi: ' + r.description);
  } else {
    poll();
  }
});

process.on('SIGTERM', () => { server.close(); db.close(); process.exit(0); });
