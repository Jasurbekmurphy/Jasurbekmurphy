// Jadval Baza — davomat boti.
// Ikki xil ishlaydi: Cloudflare Worker + D1 yoki o'z serveringizda (server.js orqali, SQLite).
//
// Kerakli sozlamalar (Cloudflare → Worker → Settings):
//   BOT_TOKEN  — BotFather bergan token (Secret)
//   ADMIN_KEY  — sayt bilan bog'lanish uchun maxfiy kalit (Secret)
//   DB         — D1 ma'lumotlar bazasi (Binding)
//
// Yo'llar:
//   POST /tg               — Telegram webhook
//   GET  /setup?key=...    — webhookni o'rnatish (bir marta ochiladi)
//   GET  /api/status       — bot holati, ulangan mas'ullar   (Authorization: Bearer ADMIN_KEY)
//   POST /api/roster       — mas'ullar, korxonalar, o'quvchilar ro'yxati (saytdan)
//   GET  /api/attendance?date=YYYY-MM-DD — kunlik davomat
//   GET  /api/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD — oraliq (oylik jadval uchun)
//
// O'quvchi: [xesh, ism, guruh, kunlar]. kunlar — korxonaga boradigan hafta kunlari
// ("123" = Du–Chor, "456" = Pay–Shan, bo'sh = har kuni, Du–Shan). Boshqa kunlari texnikumda.

const PAGE = 25; // bitta sahifadagi o'quvchilar soni
const MENU = '📋 Davomat';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)',
  'CREATE TABLE IF NOT EXISTS binds (uid INTEGER PRIMARY KEY, pid TEXT, name TEXT, at INTEGER)',
  'CREATE TABLE IF NOT EXISTS att (date TEXT, ck TEXT, pid TEXT, uid INTEGER, at INTEGER, marks TEXT, PRIMARY KEY (date, ck))',
  'CREATE TABLE IF NOT EXISTS draft (uid INTEGER, ck TEXT, date TEXT, marks TEXT, PRIMARY KEY (uid, ck))',
];

// Toshkent vaqti (UTC+5)
const nowTk = () => new Date(Date.now() + 5 * 3600 * 1000);
const today = () => nowTk().toISOString().slice(0, 10);
const weekday = () => nowTk().getUTCDay(); // 0 = yakshanba
const WD = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
// Bugun korxonada bo'lishi kerak bo'lgan o'quvchilar (indekslari)
// kunlar bo'sh bo'lsa — dushanbadan shanbagacha (yakshanba dam)
const dueIdx = (c) => c.s.map((s, i) => i).filter((i) => String(c.s[i][3] || '123456').includes(String(weekday())));
// Korxonaning bugungi mas'uli: Du–Chor va Pay–Shan uchun har xil bo'lishi mumkin (pd)
const ownerNow = (c) => { const w = weekday(), h = w >= 1 && w <= 3 ? '123' : w >= 4 ? '456' : ''; return (c.pd && h && c.pd[h]) || c.p; };
const hhmm = (ms) => new Date(ms + 5 * 3600 * 1000).toISOString().slice(11, 16);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const digits = (s) => String(s ?? '').replace(/\D+/g, '');
const normTg = (s) => String(s ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '').toLowerCase();

let ready = false;
async function init(env) {
  if (ready) return;
  for (const s of SCHEMA) await env.DB.prepare(s).run();
  ready = true;
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const webhookSecret = async (env) => (await sha(env.ADMIN_KEY + ':tg')).slice(0, 32);

async function tg(env, method, payload) {
  const res = await fetch(`${env.TG_API || 'https://api.telegram.org'}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}

// ---------------------------------------------------------------- Ma'lumotlar
async function kvGet(env, k) {
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  return r ? JSON.parse(r.v) : null;
}
async function kvSet(env, k, v) {
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, JSON.stringify(v)).run();
}
const getRoster = async (env) => (await kvGet(env, 'roster')) || { v: '0', people: [], companies: [] };
const getBind = (env, uid) => env.DB.prepare('SELECT * FROM binds WHERE uid = ?').bind(uid).first();

async function getMarks(env, uid, ck) {
  const d = await env.DB.prepare('SELECT * FROM draft WHERE uid = ? AND ck = ?').bind(uid, ck).first();
  if (d && d.date === today()) return JSON.parse(d.marks);
  const a = await env.DB.prepare('SELECT marks FROM att WHERE date = ? AND ck = ?').bind(today(), ck).first();
  return a ? JSON.parse(a.marks) : {};
}
async function setDraft(env, uid, ck, marks) {
  await env.DB.prepare('INSERT OR REPLACE INTO draft (uid, ck, date, marks) VALUES (?, ?, ?, ?)')
    .bind(uid, ck, today(), JSON.stringify(marks)).run();
}

// ---------------------------------------------------------------- Bot
const menuKeyboard = { keyboard: [[{ text: MENU }]], resize_keyboard: true, is_persistent: true };

async function bindUser(env, from, pid, roster) {
  const p = roster.people.find((x) => x.id === pid);
  await env.DB.prepare('INSERT OR REPLACE INTO binds (uid, pid, name, at) VALUES (?, ?, ?, ?)')
    .bind(from.id, pid, p ? p.name : '', Date.now()).run();
  return p;
}

async function onStart(env, msg) {
  const from = msg.from;
  const roster = await getRoster(env);
  const bound = await getBind(env, from.id);
  if (bound && roster.people.some((p) => p.id === bound.pid)) {
    const p = roster.people.find((x) => x.id === bound.pid);
    return tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `Assalomu alaykum, ${p.name}!\n\nDavomat qilish uchun pastdagi «${MENU}» tugmasini bosing.`, reply_markup: menuKeyboard });
  }
  const un = normTg(from.username);
  const byUser = un && roster.people.find((p) => normTg(p.tg) === un);
  if (byUser) {
    await bindUser(env, from, byUser.id, roster);
    return tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `Assalomu alaykum, ${byUser.name}! Siz mas'ul sifatida ulandingiz ✅\n\nDavomat qilish uchun «${MENU}» tugmasini bosing.`, reply_markup: menuKeyboard });
  }
  return tg(env, 'sendMessage', {
    chat_id: msg.chat.id,
    text: "Assalomu alaykum! Sizni mas'ullar ro'yxatidan topish uchun telefon raqamingizni yuboring 👇",
    reply_markup: { keyboard: [[{ text: '📱 Telefon raqamni yuborish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
  });
}

async function onContact(env, msg) {
  const c = msg.contact;
  if (c.user_id && c.user_id !== msg.from.id) {
    return tg(env, 'sendMessage', { chat_id: msg.chat.id, text: "Iltimos, o'zingizning raqamingizni yuboring." });
  }
  const roster = await getRoster(env);
  const ph = digits(c.phone_number).slice(-9);
  const p = ph.length === 9 && roster.people.find((x) => digits(x.phone).slice(-9) === ph);
  if (!p) {
    return tg(env, 'sendMessage', { chat_id: msg.chat.id, text: "Kechirasiz, siz mas'ullar ro'yxatida topilmadingiz. Admin bilan bog'laning.", reply_markup: { remove_keyboard: true } });
  }
  await bindUser(env, msg.from, p.id, roster);
  return tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `Rahmat, ${p.name}! Siz mas'ul sifatida ulandingiz ✅\n\nDavomat qilish uchun «${MENU}» tugmasini bosing.`, reply_markup: menuKeyboard });
}

async function myCompanies(env, uid) {
  const bound = await getBind(env, uid);
  const roster = await getRoster(env);
  if (!bound) return { roster, list: null };
  const all = roster.companies.map((c, ci) => ({ ...c, ci }));
  const list = all.filter((c) => ownerNow(c) === bound.pid);
  // boshqa kunlari shu mas'ulga tegishli korxonalar
  const later = all.filter((c) => ownerNow(c) !== bound.pid && [c.p, ...Object.values(c.pd || {})].includes(bound.pid));
  return { roster, list, later, pid: bound.pid };
}

async function companiesView(env, uid) {
  const { roster, list, later, pid } = await myCompanies(env, uid);
  if (!list) return { text: "Siz hali ulanmagansiz. /start buyrug'ini yuboring." };
  const days = (c) => [['123', 'Du–Chor'], ['456', 'Pay–Shan']].filter(([h]) => ((c.pd && c.pd[h]) || c.p) === c.me).map(([, l]) => l).join(', ');
  const laterTxt = later.length ? `\n\n🗓 Boshqa kunlardagi korxonalaringiz:\n${later.map((c) => `• ${esc(c.n)} — ${days({ ...c, me: pid })}`).join('\n')}` : '';
  if (!list.length && !later.length) return { text: "Sizga hozircha korxona biriktirilmagan. Admin bilan bog'laning." };
  if (!list.length) return { text: `📅 ${today()} · ${WD[weekday()]}\n\n💤 Bugun sizga korxona yo'q.${laterTxt}`, parse_mode: 'HTML' };
  const done = new Set((await env.DB.prepare('SELECT ck FROM att WHERE date = ?').bind(today()).all()).results.map((r) => r.ck));
  const todayList = list.map((c) => ({ ...c, due: dueIdx(c).length })).filter((c) => c.due);
  const rest = list.length - todayList.length;
  const head = `📅 ${today()} · ${WD[weekday()]}`;
  if (!todayList.length) return { text: weekday() === 0 ? `${head}\n\n💤 Bugun yakshanba — dam olish kuni.` : `${head}\n\n💤 Bugun sizning korxonalaringizda o'quvchi yo'q — ular texnikumda.` };
  return {
    text: `${head}\nKorxonani tanlang:${rest ? `\n\n<i>💤 Yana ${rest} ta korxonada bugun o'quvchi yo'q (texnikumda).</i>` : ''}`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: todayList.map((c) => [{ text: `${done.has(c.k) ? '✅' : '⬜'} ${c.n} (${c.due})`, callback_data: `c:${roster.v}:${c.ci}:0` }]),
    },
  };
}

function companyView(roster, ci, marks, pg) {
  const c = roster.companies[ci];
  const due = dueIdx(c);
  const n = due.length;
  const pages = Math.max(1, Math.ceil(n / PAGE));
  pg = Math.min(Math.max(0, pg), pages - 1);
  let yes = 0, no = 0;
  for (const i of due) { const v = marks[c.s[i][0]]; if (v === 1) yes++; else if (v === 0) no++; }
  const icon = (v) => (v === 1 ? '✅' : v === 0 ? '❌' : '⬜');
  const rows = due.slice(pg * PAGE, pg * PAGE + PAGE).map((si) => {
    const s = c.s[si];
    return [{ text: `${icon(marks[s[0]])} ${s[1]}${s[2] ? ' · ' + s[2] : ''}`.slice(0, 64), callback_data: `t:${roster.v}:${ci}:${si}:${pg}` }];
  });
  if (pages > 1) {
    rows.push([
      { text: pg > 0 ? '◀️' : ' ', callback_data: pg > 0 ? `p:${roster.v}:${ci}:${pg - 1}` : 'noop' },
      { text: `${pg + 1} / ${pages}`, callback_data: 'noop' },
      { text: pg < pages - 1 ? '▶️' : ' ', callback_data: pg < pages - 1 ? `p:${roster.v}:${ci}:${pg + 1}` : 'noop' },
    ]);
  }
  rows.push([
    { text: '✅ Hammasi keldi', callback_data: `a:${roster.v}:${ci}:1:${pg}` },
    { text: '❌ Hammasi kelmadi', callback_data: `a:${roster.v}:${ci}:0:${pg}` },
  ]);
  rows.push([
    { text: '⬅️ Orqaga', callback_data: 'b' },
    { text: '💾 Saqlash', callback_data: `s:${roster.v}:${ci}` },
  ]);
  return {
    text: `🏢 <b>${esc(c.n)}</b>\n📅 ${today()}\n\n✅ Keldi: <b>${yes}</b>   ❌ Kelmadi: <b>${no}</b>   ⬜ Belgilanmagan: <b>${n - yes - no}</b>\n\n<i>O'quvchi ustiga bosing:\n⬜ → ✅ keldi → ❌ kelmadi</i>`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows },
  };
}

async function onCallback(env, cq) {
  const uid = cq.from.id;
  const chat = cq.message.chat.id, mid = cq.message.message_id;
  const parts = cq.data.split(':');
  const act = parts[0];
  const edit = (view) => tg(env, 'editMessageText', { chat_id: chat, message_id: mid, ...view });
  const answer = (text, alert) => tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: !!alert });

  if (act === 'noop') return answer();
  if (act === 'b') { await edit(await companiesView(env, uid)); return answer(); }

  const { roster, list, pid } = await myCompanies(env, uid);
  if (!list) return answer("Avval /start yuboring", true);
  if (parts[1] !== String(roster.v)) {
    await edit(await companiesView(env, uid));
    return answer("Ro'yxat yangilangan, qaytadan tanlang", true);
  }
  const ci = +parts[2];
  const c = roster.companies[ci];
  if (!c || ownerNow(c) !== pid) return answer("Bu korxona bugun sizga biriktirilmagan", true);
  const marks = await getMarks(env, uid, c.k);

  if (act === 'c' || act === 'p') {
    await edit(companyView(roster, ci, marks, +parts[3] || 0));
    return answer();
  }
  if (act === 't') {
    const s = c.s[+parts[3]];
    if (!s) return answer();
    marks[s[0]] = marks[s[0]] === 1 ? 0 : 1; // ⬜ → ✅ → ❌ → ✅
    await setDraft(env, uid, c.k, marks);
    await edit(companyView(roster, ci, marks, +parts[4] || 0));
    return answer(marks[s[0]] === 1 ? '✅ Keldi' : '❌ Kelmadi');
  }
  if (act === 'a') {
    for (const i of dueIdx(c)) marks[c.s[i][0]] = +parts[3];
    await setDraft(env, uid, c.k, marks);
    await edit(companyView(roster, ci, marks, +parts[4] || 0));
    return answer(parts[3] === '1' ? 'Hammasi keldi' : 'Hammasi kelmadi');
  }
  if (act === 's') {
    const due = dueIdx(c).map((i) => c.s[i]);
    if (!due.length) return answer("Bugun bu korxonada o'quvchi yo'q", true);
    for (const k of Object.keys(marks)) if (!due.some((s) => s[0] === k)) delete marks[k];
    const left = due.filter((s) => marks[s[0]] !== 1 && marks[s[0]] !== 0).length;
    if (left) return answer(`Hamma o'quvchini belgilang — yana ${left} ta qoldi`, true);
    const at = Date.now();
    await env.DB.prepare('INSERT OR REPLACE INTO att (date, ck, pid, uid, at, marks) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(today(), c.k, pid, uid, at, JSON.stringify(marks)).run();
    await env.DB.prepare('DELETE FROM draft WHERE uid = ? AND ck = ?').bind(uid, c.k).run();
    const yes = due.filter((s) => marks[s[0]] === 1).length;
    await edit({
      text: `✅ <b>Davomat saqlandi</b>\n\n🏢 ${esc(c.n)}\n📅 ${today()}  🕒 ${hhmm(at)}\n\n✅ Keldi: <b>${yes}</b>\n❌ Kelmadi: <b>${due.length - yes}</b>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: "✏️ O'zgartirish", callback_data: `c:${roster.v}:${ci}:0` }, { text: '📋 Boshqa korxona', callback_data: 'b' }]] },
    });
    return answer('Saqlandi ✅');
  }
  return answer();
}

async function handleUpdate(update, env) {
  if (update.callback_query) return onCallback(env, update.callback_query);
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return;
  if (msg.contact) return onContact(env, msg);
  const text = (msg.text || '').trim();
  if (text === MENU || text === '/davomat') {
    const bound = await getBind(env, msg.from.id);
    if (!bound) return onStart(env, msg);
    return tg(env, 'sendMessage', { chat_id: msg.chat.id, ...(await companiesView(env, msg.from.id)) });
  }
  return onStart(env, msg);
}

// ---------------------------------------------------------------- HTTP
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

async function api(req, env, url) {
  const auth = req.headers.get('Authorization') || '';
  if (!env.ADMIN_KEY || auth !== 'Bearer ' + env.ADMIN_KEY) return json({ error: "Kalit noto'g'ri" }, 401);
  if (url.pathname === '/api/status') {
    const me = await tg(env, 'getMe', {});
    const roster = await getRoster(env);
    const binds = (await env.DB.prepare('SELECT pid, uid, name, at FROM binds').all()).results;
    return json({ ok: true, bot: me.result ? me.result.username : null, roster_v: roster.v, companies: roster.companies.length, binds });
  }
  if (url.pathname === '/api/roster' && req.method === 'POST') {
    const r = await req.json();
    if (!r || !Array.isArray(r.people) || !Array.isArray(r.companies)) return json({ error: "Noto'g'ri ro'yxat" }, 400);
    r.v = Date.now().toString(36);
    await kvSet(env, 'roster', r);
    // ro'yxatdan chiqarilgan mas'ullarning ulanishini o'chirish
    const ids = new Set(r.people.map((p) => p.id));
    for (const b of (await env.DB.prepare('SELECT uid, pid FROM binds').all()).results) {
      if (!ids.has(b.pid)) await env.DB.prepare('DELETE FROM binds WHERE uid = ?').bind(b.uid).run();
    }
    return json({ ok: true, v: r.v });
  }
  if (url.pathname === '/api/attendance') {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if (re.test(from || '') && re.test(to || '')) {
      const rows = (await env.DB.prepare('SELECT date, ck, pid, uid, at, marks FROM att WHERE date >= ? AND date <= ?').bind(from, to).all()).results;
      return json({ ok: true, range: true, from, to, today: today(), items: rows.map((r) => ({ ...r, marks: JSON.parse(r.marks) })) });
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : today();
    const rows = (await env.DB.prepare('SELECT ck, pid, uid, at, marks FROM att WHERE date = ?').bind(date).all()).results;
    return json({ ok: true, date, today: today(), items: rows.map((r) => ({ ...r, marks: JSON.parse(r.marks) })) });
  }
  return json({ error: 'Topilmadi' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (!env.DB) return json({ error: "D1 bazasi ulanmagan (DB binding)" }, 500);
      await init(env);
      if (url.pathname === '/tg' && req.method === 'POST') {
        if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await webhookSecret(env)) return new Response('forbidden', { status: 403 });
        await handleUpdate(await req.json(), env);
        return new Response('ok');
      }
      if (url.pathname === '/setup') {
        if (url.searchParams.get('key') !== env.ADMIN_KEY) return new Response("Kalit noto'g'ri", { status: 401 });
        const r = await tg(env, 'setWebhook', {
          url: `${url.origin}/tg`, secret_token: await webhookSecret(env),
          allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
        });
        await tg(env, 'setMyCommands', { commands: [{ command: 'davomat', description: 'Davomat qilish' }, { command: 'start', description: 'Boshlash' }] });
        const me = await tg(env, 'getMe', {});
        return new Response(r.ok
          ? `✅ Tayyor! Bot @${me.result && me.result.username} ishga tushdi.\n\nSaytga shu manzilni kiriting: ${url.origin}`
          : `❌ Xato: ${r.description || 'BOT_TOKEN ni tekshiring'}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      if (url.pathname.startsWith('/api/')) return api(req, env, url);
      return new Response('Jadval Baza davomat boti ishlayapti ✅', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};
