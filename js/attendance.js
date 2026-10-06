/* global state, $, esc, toast, Match, saveLocal, cloudPush, companyGroups, studentContract, studentKey, dbFieldIdx, XlsxWrite, downloadBlob, readWorkbook, readFile, companyKey, dialog, refreshDashAtt */
'use strict';
// Mas'ul shaxslar va Telegram bot orqali davomat.

const attUi = {
  sub: 'att', date: '', data: null, err: '', loading: false, at: 0, timer: null, status: null,
  q: '', open: new Set(), splitOpen: new Set(), aq: '', agroup: '', afree: false, pushedAt: 0, pushing: false,
};
const hashCache = new Map();
const tkToday = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
const botReady = () => !!(state.bot && state.bot.url && state.bot.key);
const GUIDE_URL = 'https://github.com/Jasurbekmurphy/Jasurbekmurphy/blob/claude/salom-qudvc3/bot/README.md';

// O'quvchi botga JShShIR o'rniga qisqa xesh bilan yuboriladi
async function stuHash(row) {
  const k = studentKey(row);
  if (!k) return '';
  if (hashCache.has(k)) return hashCache.get(k);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jb:' + k));
  const h = [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
  hashCache.set(k, h);
  return h;
}

async function botApi(path, opts = {}) {
  const url = state.bot.url.replace(/\/+$/, '') + path;
  if (!/^https:\/\//i.test(url) && location.protocol === 'https:') throw new Error("Bot manzili https:// bilan boshlanishi kerak");
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: { Authorization: 'Bearer ' + state.bot.key, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
  } catch (e) {
    throw new Error("Serverga ulanib bo'lmadi. Manzilni brauzerda ochib ko'ring — \"Jadval Baza davomat boti ishlayapti ✅\" chiqishi kerak. Chiqmasa: HTTPS (Caddy) yoki 443-port ishlamayapti.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Bot xatosi: ' + res.status));
  return data;
}

// ---- 3+3 tizim: guruhlar haftaning qaysi kunlari korxonada bo'ladi
// '' = har kuni, '123' = Du–Chor, '456' = Pay–Shan (qolgan kunlari texnikumda)
const SCHED = [['', 'Har kuni'], ['123', 'Du–Chor'], ['456', 'Pay–Shan']];
const schedLabel = (d) => (SCHED.find(([k]) => k === d) || ['', d])[1];
const groupKey = (g) => String(g ?? '').replace(/\s+/g, ' ').trim();
const groupDays = (g) => ((state.resp.sched || {})[groupKey(g)] || '');
const rowDays = (r, gi) => (gi >= 0 ? groupDays(r[gi]) : '');
const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay(); // 0 = yakshanba
const dueOn = (r, gi, date) => { const d = rowDays(r, gi); return !d || d.includes(String(weekdayOf(date))); };

// ---- Kunlarga qarab mas'ul: bitta korxonaga Du–Chor bir mas'ul, Pay–Shan boshqa mas'ul borishi mumkin
// resp.assign[ck] — asosiy mas'ul; resp.assignBy[ck] = {'123': pid, '456': pid} — kunlar bo'yicha
const HALVES = [['123', 'Du–Chor'], ['456', 'Pay–Shan']];
const halfOf = (wd) => (wd >= 1 && wd <= 3 ? '123' : wd >= 4 ? '456' : '');
const splitOf = (ck) => (state.resp.assignBy || {})[ck] || null;
function ownerOn(ck, wd) {
  const by = splitOf(ck), h = halfOf(wd);
  return (by && h && by[h]) || state.resp.assign[ck] || '';
}
// Korxonaga biriktirilgan barcha mas'ullar (asosiy + kunlar bo'yicha)
const ownersOf = (ck) => [...new Set([state.resp.assign[ck], ...Object.values(splitOf(ck) || {})].filter(Boolean))];

// Davomat uchun korxonalar: ta'lim muassasasi va shartnoma talab qilinmaydiganlar chiqariladi
function attCompanies() {
  const data = companyGroups();
  if (!data) return { list: [], gi: -1 };
  return {
    gi: data.gi,
    list: data.list.filter((c) => !c.inst).map((c) => ({ ...c, rows: c.rows.filter((r) => !studentContract(r).na) })).filter((c) => c.rows.length),
  };
}

async function buildRoster() {
  const { list, gi } = attCompanies();
  const nameIdx = state.view.nameIdx >= 0 ? state.view.nameIdx : 0;
  const companies = [];
  for (const c of list) {
    const valid = (id) => !!id && state.resp.people.some((p) => p.id === id);
    const pid = valid(state.resp.assign[c.key]) ? state.resp.assign[c.key] : '';
    const pd = {};
    for (const [h] of HALVES) { const x = (splitOf(c.key) || {})[h]; if (valid(x)) pd[h] = x; }
    if (!pid && !Object.keys(pd).length) continue;
    const s = [];
    for (const r of c.rows) s.push([await stuHash(r), String(r[nameIdx] ?? ''), gi >= 0 ? String(r[gi] ?? '') : '', rowDays(r, gi)]);
    s.sort((a, b) => a[2].localeCompare(b[2], 'uz', { numeric: true }) || a[1].localeCompare(b[1], 'uz'));
    companies.push({ k: c.key, n: c.name, p: pid, ...(Object.keys(pd).length ? { pd } : {}), s });
  }
  return { people: state.resp.people.map(({ id, name, tg, phone }) => ({ id, name, tg, phone })), companies };
}

async function pushRoster(silent) {
  if (!botReady() || !state.db) return;
  attUi.pushing = true;
  try {
    await botApi('/api/roster', { method: 'POST', body: JSON.stringify(await buildRoster()) });
    attUi.pushedAt = Date.now();
    if (!silent) toast("Ro'yxat botga yuborildi ✓", 'ok');
  } catch (e) {
    toast('Botga yuborilmadi: ' + e.message, 'err');
  }
  attUi.pushing = false;
  if (attUi.sub === 'people') renderAttendance();
}

let respTimer = null;
async function respChanged() {
  await saveLocal();
  clearTimeout(respTimer);
  respTimer = setTimeout(() => { pushRoster(true); cloudPush(); }, 2500);
}

async function loadStatus() {
  if (!botReady()) return;
  try { attUi.status = await botApi('/api/status'); } catch (e) { attUi.status = { error: e.message }; }
}

async function loadAttendance() {
  if (!botReady() || attUi.loading) return;
  attUi.loading = true;
  try {
    attUi.data = await botApi('/api/attendance?date=' + encodeURIComponent(attUi.date || tkToday()));
    attUi.err = '';
    attUi.at = Date.now();
  } catch (e) {
    attUi.err = e.message;
  }
  attUi.loading = false;
  if (!$('#p-att').hidden && attUi.sub === 'att') renderAttendance();
}

// Bo'lim ochiq va bugungi kun tanlangan bo'lsa — har 30 soniyada yangilanadi
function attTick() {
  clearInterval(attUi.timer);
  attUi.timer = setInterval(() => {
    if (!$('#p-att').hidden && attUi.sub === 'att' && (attUi.date || tkToday()) === tkToday() && !document.hidden) loadAttendance();
  }, 30000);
}

function renderAttendance() {
  const box = $('#att-body');
  if (!box) return;
  if (!state.db) { box.innerHTML = '<div class="box"><p class="muted">Baza bo\'sh. Avval "Baza" bo\'limida asosiy jadvalni yuklang.</p></div>'; return; }
  if (!attUi.date) attUi.date = tkToday();
  const tabs = `
    <div class="seg wide att-tabs">
      <button data-sub="att" class="${attUi.sub === 'att' ? 'on' : ''}">📊 Davomat</button>
      <button data-sub="people" class="${attUi.sub === 'people' ? 'on' : ''}">👤 Mas'ullar</button>
      <button data-sub="sched" class="${attUi.sub === 'sched' ? 'on' : ''}">📅 3+3</button>
      <button data-sub="bot" class="${attUi.sub === 'bot' ? 'on' : ''}">⚙️ Bot</button>
    </div>`;
  const body = attUi.sub === 'people' ? peopleHtml() : attUi.sub === 'bot' ? botHtml() : attUi.sub === 'sched' ? schedHtml() : attHtml();
  box.innerHTML = tabs + body;
  box.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = async () => {
    attUi.sub = b.dataset.sub;
    renderAttendance();
    if (attUi.sub === 'att') loadAttendance();
    if (attUi.sub === 'people' || attUi.sub === 'bot') { await loadStatus(); renderAttendance(); }
  }));
  if (attUi.sub === 'people') bindPeople(box);
  else if (attUi.sub === 'sched') bindSched(box);
  else if (attUi.sub === 'bot') bindBot(box);
  else bindAtt(box);
}

// ---------------------------------------------------------------- 📊 Davomat
function attModel() {
  const all = attCompanies();
  const gi = all.gi;
  const date = attUi.date || tkToday();
  // Shu kuni korxonada bo'lishi kerak bo'lgan o'quvchilar (3+3 jadval bo'yicha)
  const list = all.list.map((c) => ({ ...c, rows: c.rows.filter((r) => dueOn(r, gi, date)) })).filter((c) => c.rows.length);
  const nameIdx = state.view.nameIdx >= 0 ? state.view.nameIdx : 0;
  const items = new Map(((attUi.data && attUi.data.items) || []).map((x) => [x.ck, x]));
  const people = new Map(state.resp.people.map((p) => [p.id, p]));
  const wd = weekdayOf(date);
  const own = (c) => ownerOn(c.key, wd);
  const offToday = all.list.filter((c) => people.has(own(c))).length - list.filter((c) => people.has(own(c))).length;
  const assigned = list.filter((c) => people.has(own(c)));
  const groups = new Map();
  for (const c of assigned) {
    const pid = own(c);
    if (!groups.has(pid)) groups.set(pid, []);
    const it = items.get(c.key);
    groups.get(pid).push({ c, it });
  }
  return { list, gi, nameIdx, items, people, assigned, groups, free: list.length - assigned.length, offToday };
}

function attHtml() {
  if (!botReady()) {
    return `<div class="box empty-hero"><div class="big">🤖</div><h2>Bot hali ulanmagan</h2>
      <p class="muted">Davomatni ko'rish uchun avval Telegram botni ulang.</p>
      <button class="primary" data-sub2="bot">⚙️ Bot sozlamasiga o'tish</button></div>`;
  }
  const m = attModel();
  if (!m.assigned.length && m.offToday) {
    return `<div class="att-bar"><label>Sana <input type="date" id="att-date" value="${esc(attUi.date)}" max="${tkToday()}"></label><button id="att-month">📅 Oylik jadval (Excel)</button></div>
      <div class="box empty-hero"><div class="big">💤</div><h2>Bu kuni korxonalarda o'quvchi yo'q</h2>
      <p class="muted">3+3 jadval bo'yicha ${m.offToday} ta korxonadagi o'quvchilar bu kuni texnikumda.</p></div>`;
  }
  if (!m.assigned.length) {
    return `<div class="box empty-hero"><div class="big">👤</div><h2>Mas'ullar biriktirilmagan</h2>
      <p class="muted">Avval mas'ul shaxslarni qo'shing va ularga korxonalarni biriktiring.</p>
      <button class="primary" data-sub2="people">👤 Mas'ullarga o'tish</button></div>`;
  }
  let went = 0, missed = 0, yes = 0, no = 0;
  for (const [, arr] of m.groups) for (const { c, it } of arr) {
    if (it) {
      went++;
      for (const r of c.rows) { const v = it.marks[hashCache.get(studentKey(r))]; if (v === 1) yes++; else if (v === 0) no++; }
    } else missed++;
  }
  const isToday = attUi.date === tkToday();
  const q = Match.norm(attUi.q);
  const time = (ms) => new Date(ms).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' });
  const blocks = [...m.groups].map(([pid, arr]) => {
    const p = m.people.get(pid);
    let rows = arr;
    if (q) rows = rows.filter(({ c }) => Match.norm(c.name).includes(q) || Match.norm(p.name).includes(q));
    if (!rows.length) return '';
    const done = arr.filter((x) => x.it).length;
    return `
      <div class="box att-person">
        <div class="att-ph">
          <div><b>${esc(p.name)}</b> <span class="muted small">${p.tg ? '@' + esc(String(p.tg).replace(/^@/, '')) : ''} ${esc(p.phone || '')}</span></div>
          <span class="badge ${done === arr.length ? 'ok' : 'bad-b'}">${done}/${arr.length} korxona</span>
        </div>
        ${rows.map(({ c, it }) => {
          let y = 0, n = 0;
          if (it) for (const r of c.rows) { const v = it.marks[hashCache.get(studentKey(r))]; if (v === 1) y++; else if (v === 0) n++; }
          const open = attUi.open.has(c.key);
          return `
            <div class="att-row ${it ? 'done' : 'miss'}">
              <button class="att-main" data-open="${esc(c.key)}">
                <span class="att-name">${esc(c.name)}</span>
                <span class="att-st">${it
                  ? `<span class="st ok">✅ Borildi · ${time(it.at)}</span><span class="st-n">keldi <b>${y}</b> · kelmadi <b>${n}</b></span>`
                  : `<span class="st bad">❌ ${isToday ? 'Bormadi (hali belgilanmagan)' : 'Bormadi'}</span><span class="st-n">${c.rows.length} o'quvchi</span>`}</span>
              </button>
              ${open ? `<div class="att-stu">${c.rows.map((r) => {
                const v = it ? it.marks[hashCache.get(studentKey(r))] : undefined;
                return `<div class="as-row"><span>${v === 1 ? '✅' : v === 0 ? '❌' : '⬜'}</span><span class="grow">${esc(r[m.nameIdx])}</span><span class="muted">${m.gi >= 0 ? esc(r[m.gi] ?? '') : ''}</span></div>`;
              }).join('')}</div>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  }).join('');

  return `
    <div class="att-bar">
      <label>Sana <input type="date" id="att-date" value="${esc(attUi.date)}" max="${tkToday()}"></label>
      <button id="att-refresh">⟳ Yangilash</button>
      <input type="search" id="att-q" placeholder="Korxona yoki mas'ul…" value="${esc(attUi.q)}">
      <button id="att-xl">⬇ Kunlik Excel</button>
      <button id="att-month">📅 Oylik jadval (Excel)</button>
    </div>
    <p class="muted small att-live">${attUi.err ? `<span class="bad">⚠ ${esc(attUi.err)}</span>` : attUi.at ? `${isToday ? '🟢 Jonli: har 30 soniyada yangilanadi · ' : ''}oxirgi yangilanish ${new Date(attUi.at).toLocaleTimeString('uz')}` : 'Yuklanmoqda…'}</p>
    <div class="stats">
      <div><b>${m.assigned.length}</b><span>korxona (mas'ul bor)</span></div>
      <div class="ok"><b>${went}</b><span>✅ borildi</span></div>
      <div class="bad"><b>${missed}</b><span>❌ bormadi</span></div>
      <div class="ok"><b>${yes}</b><span>o'quvchi keldi</span></div>
      <div class="warn"><b>${no}</b><span>o'quvchi kelmadi</span></div>
    </div>
    ${m.offToday ? `<p class="small muted">💤 ${m.offToday} ta korxonada bu kuni o'quvchi yo'q (3+3 jadval bo'yicha texnikumda).</p>` : ''}
    ${m.free ? `<p class="small warn">⚠ ${m.free} ta korxonaga mas'ul biriktirilmagan — <button class="link" data-sub2="people">biriktirish</button></p>` : ''}
    ${blocks || '<p class="muted">Hech narsa topilmadi.</p>'}`;
}

function bindAtt(box) {
  box.querySelectorAll('[data-sub2]').forEach((b) => (b.onclick = async () => { attUi.sub = b.dataset.sub2; await loadStatus(); renderAttendance(); }));
  if (!botReady()) return;
  // xeshlar tayyor bo'lmasa — hisoblab, qayta chizish
  const rows = state.view.rows.filter((r) => !hashCache.has(studentKey(r)));
  if (rows.length) { Promise.all(rows.map(stuHash)).then(() => renderAttendance()); return; }
  const d = $('#att-date');
  if (!d) return;
  d.onchange = () => { attUi.date = d.value || tkToday(); attUi.data = null; attUi.at = 0; renderAttendance(); loadAttendance(); };
  $('#att-month').onclick = openMonthDialog;
  if (!$('#att-refresh')) { if (!attUi.data && !attUi.loading && !attUi.err) loadAttendance(); return; }
  $('#att-refresh').onclick = () => loadAttendance();
  $('#att-q').oninput = (e) => {
    attUi.q = e.target.value;
    const pos = e.target.selectionStart;
    renderAttendance();
    const i = $('#att-q'); i.focus(); i.setSelectionRange(pos, pos);
  };
  box.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.open;
    if (attUi.open.has(k)) attUi.open.delete(k); else attUi.open.add(k);
    renderAttendance();
  }));
  $('#att-xl').onclick = async () => {
    const m = attModel();
    const out = [];
    for (const [pid, arr] of m.groups) for (const { c, it } of arr) for (const r of c.rows) {
      const v = it ? it.marks[hashCache.get(studentKey(r))] : undefined;
      out.push([m.people.get(pid).name, c.name, it ? 'Borildi' : 'Bormadi', it ? new Date(it.at).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' }) : '',
        r[m.nameIdx], m.gi >= 0 ? r[m.gi] : '', v === 1 ? 'Keldi' : v === 0 ? 'Kelmadi' : '—']);
    }
    const blob = await XlsxWrite.buildWorkbook({ title: `Davomat — ${attUi.date}`, sheetName: 'Davomat',
      headers: ['№', "Mas'ul", 'Korxona', "Mas'ul bordimi", 'Vaqt', "O'quvchi", 'Guruh', 'Davomat'], rows: out.map((r, i) => [i + 1, ...r]) });
    downloadBlob(blob, `Davomat ${attUi.date}.xlsx`);
  };
  if (!attUi.data && !attUi.loading && !attUi.err) loadAttendance();
}

// ---------------------------------------------------------------- 👤 Mas'ullar
function peopleHtml() {
  const binds = new Set(((attUi.status && attUi.status.binds) || []).map((b) => b.pid));
  const { list, gi } = attCompanies();
  const cnt = new Map();
  for (const c of list) for (const pid of ownersOf(c.key)) cnt.set(pid, (cnt.get(pid) || 0) + 1);
  const groupVals = gi >= 0 ? [...new Set(list.flatMap((c) => c.rows.map((r) => String(r[gi] ?? '').trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uz', { numeric: true })) : [];
  const q = Match.norm(attUi.aq);
  let comps = list;
  if (q) comps = comps.filter((c) => Match.norm(c.name).includes(q));
  if (attUi.agroup) comps = comps.filter((c) => c.rows.some((r) => String(r[gi] ?? '').trim() === attUi.agroup));
  if (attUi.afree) comps = comps.filter((c) => !ownersOf(c.key).length);
  const opts = (sel) => `<option value="">— biriktirilmagan —</option>${state.resp.people.map((p) => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const free = list.filter((c) => !ownersOf(c.key).length).length;
  // Korxonadagi guruhlar va ularning kunlari
  const halvesOf = (c) => {
    const m = { '': new Set(), '123': new Set(), '456': new Set() };
    if (gi >= 0) for (const r of c.rows) { const g = groupKey(r[gi]); if (g) m[groupDays(g)] ? m[groupDays(g)].add(g) : m[''].add(g); }
    return m;
  };

  return `
    <div class="att-grid">
      <div class="box">
        <h3>Mas'ul shaxslar (${state.resp.people.length})</h3>
        <div class="p-xl">
          <button id="p-tpl" type="button">📥 Excel shablon</button>
          <label class="file-btn">📤 Excel'dan yuklash<input type="file" id="p-xlfile" accept=".xlsx,.xlsm,.xls"></label>
        </div>
        <p class="fl-note" style="margin-bottom:10px">Shablonni yuklab oling, to'ldiring va qaytarib yuklang. Yoki pastda bittadan qo'shing.</p>
        <form id="p-add" class="p-form">
          <input id="pa-name" placeholder="F.I.Sh *" required>
          <input id="pa-tg" placeholder="Telegram: @username">
          <input id="pa-ph" placeholder="Telefon: 90 123 45 67" inputmode="tel">
          <button class="primary" type="submit">＋ Qo'shish</button>
        </form>
        <p class="fl-note">Mas'ul botga kirganda Telegram username yoki telefon raqami orqali avtomatik taniladi.</p>
        <div class="p-list">${state.resp.people.map((p) => `
          <div class="p-card">
            <div class="p-top">
              <b>${esc(p.name)}</b>
              ${botReady() && attUi.status && !attUi.status.error ? (binds.has(p.id) ? '<span class="badge ok">🤖 botga ulangan</span>' : '<span class="badge bad-b">botga kirmagan</span>') : ''}
            </div>
            <div class="p-meta">${p.tg ? '✈️ @' + esc(String(p.tg).replace(/^@/, '')) : ''} ${p.phone ? '📞 ' + esc(p.phone) : ''} · 🏢 ${cnt.get(p.id) || 0} ta korxona</div>
            <div class="p-act"><button data-pedit="${esc(p.id)}">✏️</button><button class="danger" data-pdel="${esc(p.id)}">🗑</button></div>
          </div>`).join('') || '<p class="muted small">Hali mas\'ul qo\'shilmagan.</p>'}</div>
      </div>
      <div class="box">
        <h3>Korxonalarga biriktirish</h3>
        <div class="a-bar">
          <input type="search" id="a-q" placeholder="Korxona nomi…" value="${esc(attUi.aq)}">
          <select id="a-group"><option value="">Barcha guruhlar</option>${groupVals.map((g) => `<option ${attUi.agroup === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" id="a-free" ${attUi.afree ? 'checked' : ''}> Faqat biriktirilmaganlar (${free})</label>
        </div>
        ${state.resp.people.length ? `<div class="a-bulk"><span class="small">Ro'yxatdagi ${comps.length} ta korxonani</span>
          <select id="a-bulk-p">${opts('')}</select><button id="a-bulk-go">biriktirish</button></div>` : '<p class="small warn">Avval chap tomonda mas\'ul qo\'shing.</p>'}
        ${state.resp.people.length ? `<div class="a-auto"><button id="a-auto">🤖 Ustalar bo'yicha kunlarga taqsimlash</button><span class="small muted">3+3 jadvalga qarab: har kunlari korxonaga o'sha kunlari keladigan guruhlarning ustasi biriktiriladi.</span></div>` : ''}
        <div class="a-list">${comps.map((c) => `
          ${(() => {
            const hv = halvesOf(c), by = splitOf(c.key), open = !!by || attUi.splitOpen.has(c.key);
            const both = hv['123'].size && hv['456'].size;
            const gtxt = [['', ''], ['123', 'Du–Chor: '], ['456', 'Pay–Shan: ']].filter(([k]) => hv[k].size).map(([k, l]) => l + [...hv[k]].join(', ')).join(' · ');
            return `<div class="a-row ${ownersOf(c.key).length ? 'on' : ''} ${open ? 'split' : ''}">
            <div class="a-name"><b>${esc(c.name)}</b><span class="muted small">${c.rows.length} o'quvchi${gtxt ? ' · ' + esc(gtxt) : ''}</span></div>
            <div class="a-sel">
              <select data-assign="${esc(c.key)}" title="${open ? "Qolgan kunlar uchun asosiy mas'ul" : "Mas'ul"}">${opts(state.resp.assign[c.key] || '')}</select>
              <button type="button" class="a-split-btn ${open ? 'on' : ''} ${both && !by ? 'hint' : ''}" data-split="${esc(c.key)}" title="Kunlar bo'yicha har xil mas'ul">📅⇄</button>
            </div>
            ${open ? `<div class="a-halves">${HALVES.map(([h, l]) => `<label><span>${l}</span><select data-assignh="${h}" data-ck="${esc(c.key)}"><option value="">= asosiy mas'ul</option>${state.resp.people.map((p) => `<option value="${esc(p.id)}" ${(by || {})[h] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
          </div>`;
          })()}`).join('') || '<p class="muted small">Korxona topilmadi.</p>'}</div>
        <div class="row-btns">
          <button class="primary" id="a-push" ${botReady() ? '' : 'disabled'}>${attUi.pushing ? 'Yuborilmoqda…' : "🔄 Ro'yxatni botga yuborish"}</button>
        </div>
        <p class="fl-note">${botReady() ? (attUi.pushedAt ? `Oxirgi yuborilgan: ${new Date(attUi.pushedAt).toLocaleTimeString('uz')}. ` : '') + "O'zgarishlar bir necha soniyadan keyin botga avtomatik yuboriladi." : 'Bot ulanmagan — "⚙️ Bot" bo\'limida sozlang.'}</p>
      </div>
    </div>`;
}

function bindPeople(box) {
  $('#p-tpl').onclick = downloadPeopleTemplate;
  $('#p-xlfile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importPeopleFile(f); };
  $('#p-add').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#pa-name').value.trim();
    if (!name) return;
    const tg = $('#pa-tg').value.trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@?/, '@').replace(/^@$/, '');
    state.resp.people.push({ id: 'p' + Date.now().toString(36), name, tg, phone: $('#pa-ph').value.trim() });
    await respChanged();
    renderAttendance();
    toast("Mas'ul qo'shildi ✓", 'ok');
  };
  box.querySelectorAll('[data-pdel]').forEach((b) => (b.onclick = async () => {
    const p = state.resp.people.find((x) => x.id === b.dataset.pdel);
    if (!confirm(`"${p.name}" o'chirilsinmi? Unga biriktirilgan korxonalar bo'shaydi.`)) return;
    state.resp.people = state.resp.people.filter((x) => x.id !== p.id);
    for (const k of Object.keys(state.resp.assign)) if (state.resp.assign[k] === p.id) delete state.resp.assign[k];
    cleanSplits();
    await respChanged();
    renderAttendance();
  }));
  box.querySelectorAll('[data-pedit]').forEach((b) => (b.onclick = async () => {
    const p = state.resp.people.find((x) => x.id === b.dataset.pedit);
    const name = prompt('F.I.Sh:', p.name); if (name === null) return;
    const tg = prompt('Telegram username (@...):', p.tg || ''); if (tg === null) return;
    const phone = prompt('Telefon:', p.phone || ''); if (phone === null) return;
    Object.assign(p, { name: name.trim() || p.name, tg: tg.trim(), phone: phone.trim() });
    await respChanged();
    renderAttendance();
  }));
  const keepFocus = (id, fn) => { const el = $(id); el.oninput = el.onchange = (e) => { const pos = e.target.selectionStart; fn(e); renderAttendance(); const n = $(id); if (n.setSelectionRange && pos != null) { n.focus(); n.setSelectionRange(pos, pos); } }; };
  keepFocus('#a-q', (e) => { attUi.aq = e.target.value; });
  $('#a-group').onchange = (e) => { attUi.agroup = e.target.value; renderAttendance(); };
  $('#a-free').onchange = (e) => { attUi.afree = e.target.checked; renderAttendance(); };
  box.querySelectorAll('[data-assign]').forEach((s) => (s.onchange = async () => {
    if (s.value) state.resp.assign[s.dataset.assign] = s.value; else delete state.resp.assign[s.dataset.assign];
    s.closest('.a-row').classList.toggle('on', !!ownersOf(s.dataset.assign).length);
    await respChanged();
  }));
  box.querySelectorAll('[data-assignh]').forEach((s) => (s.onchange = async () => {
    const ck = s.dataset.ck;
    state.resp.assignBy = { ...(state.resp.assignBy || {}) };
    const by = { ...(state.resp.assignBy[ck] || {}) };
    if (s.value) by[s.dataset.assignh] = s.value; else delete by[s.dataset.assignh];
    if (Object.keys(by).length) state.resp.assignBy[ck] = by; else delete state.resp.assignBy[ck];
    attUi.splitOpen.add(ck);
    await respChanged();
    renderAttendance();
  }));
  box.querySelectorAll('[data-split]').forEach((b) => (b.onclick = async () => {
    const ck = b.dataset.split;
    if (splitOf(ck)) {
      if (!confirm("Kunlar bo'yicha mas'ullar olib tashlansinmi? Faqat asosiy mas'ul qoladi.")) return;
      delete state.resp.assignBy[ck];
      attUi.splitOpen.delete(ck);
      await respChanged();
    } else if (attUi.splitOpen.has(ck)) attUi.splitOpen.delete(ck);
    else attUi.splitOpen.add(ck);
    renderAttendance();
  }));
  const au = $('#a-auto');
  if (au) au.onclick = openAutoSplit;
  const bg = $('#a-bulk-go');
  if (bg) bg.onclick = async () => {
    const pid = $('#a-bulk-p').value;
    const keys = [...box.querySelectorAll('[data-assign]')].map((s) => s.dataset.assign);
    const p = state.resp.people.find((x) => x.id === pid);
    if (!confirm(`${keys.length} ta korxona ${p ? `"${p.name}"ga biriktirilsinmi` : "mas'ulsiz qoldirilsinmi"}?`)) return;
    for (const k of keys) { if (pid) state.resp.assign[k] = pid; else delete state.resp.assign[k]; }
    await respChanged();
    renderAttendance();
  };
  $('#a-push').onclick = () => pushRoster(false);
}

// ---------------------------------------------------------------- ⚙️ Bot
function botHtml() {
  const st = attUi.status;
  return `
    <div class="att-grid">
      <div class="box">
        <h3>Botni ulash</h3>
        <label>Bot manzili (server yoki Cloudflare)
          <input id="b-url" value="${esc(state.bot.url)}" placeholder="https://1-2-3-4.sslip.io">
        </label>
        <label style="margin-top:10px">Admin kalit (ADMIN_KEY)
          <div class="key-row"><input id="b-key" type="password" value="${esc(state.bot.key)}" autocomplete="off"><button type="button" id="b-gen" title="Yangi kalit yaratish">🎲</button><button type="button" id="b-show">👁</button></div>
        </label>
        <div class="row-btns"><button class="primary" id="b-save">Saqlash va tekshirish</button></div>
        <div class="b-status">${!botReady() ? '<p class="muted small">Bot hali ulanmagan.</p>'
          : !st ? '<p class="muted small">Tekshirilmoqda…</p>'
          : st.error ? `<p class="bad small">⚠ ${esc(st.error)}</p><p class="small"><a href="${esc(state.bot.url)}/" target="_blank" rel="noopener">🔗 ${esc(state.bot.url)}/ — brauzerda ochib tekshirish</a></p>`
          : `<p class="ok"><b>✅ Ulangan: @${esc(st.bot || '?')}</b></p>
             <p class="small">Botga ulangan mas'ullar: <b>${(st.binds || []).length}</b> / ${state.resp.people.length} · botdagi korxonalar: ${st.companies}</p>
             <p class="small"><a href="https://t.me/${esc(st.bot || '')}" target="_blank" rel="noopener">t.me/${esc(st.bot || '')}</a> — shu havolani mas'ullarga yuboring.</p>`}</div>
        <p class="fl-note">Manzil va kalit bulut orqali boshqa qurilmalaringizga ham (shifrlangan holda) o'tadi.</p>
      </div>
      <div class="box">
        <h3>O'rnatish</h3>
        <p class="small"><b>O'z serveringiz bo'lsa:</b> <a href="https://github.com/Jasurbekmurphy/Jasurbekmurphy/blob/claude/salom-qudvc3/bot/SERVER.md" target="_blank" rel="noopener">📖 serverga o'rnatish yo'riqnomasi</a> (Node.js + Caddy). Bot manzili: <code>https://&lt;server manzili&gt;</code>.</p>
        <p class="small muted">Server bo'lmasa — bepul Cloudflare orqali:</p>
        <ol class="guide">
          <li><b>Bot yarating:</b> Telegram'da <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> → <code>/newbot</code> → nom bering → <b>token</b>ni nusxalang.</li>
          <li><b>Kalit:</b> chapdagi 🎲 tugmasini bosing — admin kalit yaratiladi, uni ham nusxalang.</li>
          <li><b>Cloudflare:</b> <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">dash.cloudflare.com</a> da bepul ro'yxatdan o'ting.</li>
          <li><b>Baza:</b> Storage &amp; Databases → <b>D1</b> → Create → nom: <code>jadval-bot</code>.</li>
          <li><b>Worker:</b> Workers &amp; Pages → Create → Hello World → nom: <code>jadval-bot</code> → Deploy → <b>Edit code</b> → ichini o'chirib, <a href="https://github.com/Jasurbekmurphy/Jasurbekmurphy/blob/claude/salom-qudvc3/bot/worker.js" target="_blank" rel="noopener">bot/worker.js</a> kodini qo'ying → Deploy.</li>
          <li><b>Sozlamalar:</b> Worker → Settings → <b>Bindings</b> → D1 → nom <code>DB</code>, baza <code>jadval-bot</code>. <b>Variables and Secrets</b> → Secret <code>BOT_TOKEN</code> (token) va Secret <code>ADMIN_KEY</code> (kalit).</li>
          <li><b>Ishga tushirish:</b> brauzerda <code>https://&lt;worker manzili&gt;/setup?key=&lt;kalit&gt;</code> ni oching → "✅ Tayyor" chiqadi.</li>
          <li>Worker manzili va kalitni shu yerga kiriting va <b>Saqlash</b>ni bosing.</li>
        </ol>
        <p class="small"><a href="${GUIDE_URL}" target="_blank" rel="noopener">📖 Batafsil yo'riqnoma (rasmlar tartibida)</a></p>
      </div>
    </div>`;
}

function bindBot(box) {
  $('#b-gen').onclick = () => {
    const a = crypto.getRandomValues(new Uint8Array(24));
    $('#b-key').value = [...a].map((b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
    $('#b-key').type = 'text';
    toast("Kalit yaratildi — uni nusxalab, Cloudflare'ga ADMIN_KEY sifatida qo'ying");
  };
  $('#b-show').onclick = () => { const k = $('#b-key'); k.type = k.type === 'password' ? 'text' : 'password'; };
  $('#b-save').onclick = async () => {
    state.bot = { url: $('#b-url').value.trim().replace(/\/+$/, ''), key: $('#b-key').value.trim() };
    await saveLocal();
    attUi.status = null;
    renderAttendance();
    await loadStatus();
    renderAttendance();
    if (attUi.status && !attUi.status.error) { toast('Bot ulandi ✓', 'ok'); pushRoster(true); }
    cloudPush();
  };
  if (botReady() && !attUi.status) loadStatus().then(() => { if (attUi.sub === 'bot') renderAttendance(); });
}

attTick();

// ---------------------------------------------------------------- Mas'ullarni Excel orqali qo'shish
function peopleCompanies(pid) {
  return attCompanies().list.filter((c) => ownersOf(c.key).includes(pid)).map((c) => {
    const by = splitOf(c.key);
    const hs = by ? HALVES.filter(([h]) => (by[h] || state.resp.assign[c.key]) === pid).map(([, l]) => l) : [];
    return by && hs.length < 2 ? `${c.name} (${hs.join(', ')})` : c.name;
  });
}

async function downloadPeopleTemplate() {
  if (!state.db) return;
  const { list, gi } = attCompanies();
  const pname = (pid) => (state.resp.people.find((p) => p.id === pid) || {}).name || '';
  const blob = await XlsxWrite.buildWorkbook({ sheets: [
    {
      sheetName: "Mas'ullar",
      title: "Mas'ullar: har qatorga bitta mas'ul. Korxonalarni ; bilan ajrating yoki \"Korxonalar\" varag'ida mas'ul ismini yozing",
      headers: ['F.I.Sh *', 'Telegram (@username)', 'Telefon', 'Korxonalar (; bilan ajrating)'],
      rows: state.resp.people.map((p) => [p.name, p.tg || '', p.phone || '', peopleCompanies(p.id).join('; ')]),
      blankRows: 30,
      minWidths: [34, 22, 18, 60],
    },
    {
      sheetName: 'Korxonalar',
      title: "Korxonalar: \"Mas'ul\" ustuniga mas'ulning F.I.Sh ini yozing (Mas'ullar varag'idagidek)",
      headers: ['№', 'Korxona nomi', "O'quvchilar", 'Guruhlar', "Mas'ul (F.I.Sh)"],
      rows: list.map((c, i) => [i + 1, c.name, c.rows.length, gi >= 0 ? [...new Set(c.rows.map((r) => r[gi]).filter((v) => v != null))].join(', ') : '', pname(state.resp.assign[c.key])]),
      minWidths: [5, 44, 12, 16, 34],
    },
  ] });
  downloadBlob(blob, "Mas'ullar shabloni.xlsx");
}

// Sarlavha qatorini topish: kerakli kalit so'zlarning hammasi bor qator
function findHeader(sheet, needs) {
  for (let r = 0; r < Math.min(sheet.rows, 12); r++) {
    const canon = sheet.grid[r].map((v) => (v == null ? '' : Match.canon(v)));
    const cols = {};
    for (const [k, test] of Object.entries(needs)) cols[k] = canon.findIndex(test);
    const found = Object.values(cols).filter((c) => c >= 0);
    // kamida 2 ta ustun, hammasi har xil katakda (sarlavha bitta birlashtirilgan matn emas)
    if (found.length >= 2 && cols.name >= 0 && new Set(found).size === found.length) return { row: r, cols };
  }
  return null;
}

function companyMatcher() {
  const { list } = attCompanies();
  const byKey = new Map(list.map((c) => [companyKey(c.name), c]));
  return (text) => {
    const t = String(text || '').trim();
    if (!t) return null;
    const exact = byKey.get(companyKey(t));
    if (exact) return exact;
    let best = null, score = 0;
    for (const c of list) {
      const sc = Match.similarity(c.name, t);
      if (sc > score) { score = sc; best = c; }
    }
    return score >= 0.82 ? best : null;
  };
}

async function importPeopleFile(file) {
  let wb;
  try { wb = readWorkbook(await readFile(file)); } catch (e) { toast("Faylni o'qib bo'lmadi: " + e.message, 'err'); return; }
  const people = state.resp.people.map((p) => ({ ...p }));
  const nk = (s) => Match.nameKey(s);
  const ph9 = (s) => Match.digits(s).slice(-9);
  const tgk = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();
  const findPerson = (name, tg, phone) => people.find((p) => (name && nk(p.name) === nk(name)) || (tg && tgk(p.tg) && tgk(p.tg) === tgk(tg)) || (phone && ph9(phone).length === 9 && ph9(p.phone) === ph9(phone)));
  const matchCompany = companyMatcher();
  const added = [], updated = new Set(), assigns = new Map(), missComp = new Set(), missPerson = new Set();

  for (const name of wb.names) {
    const sh = wb.sheets[name];
    // 1) Mas'ullar varag'i
    const hp = findHeader(sh, {
      name: (c) => c.includes('fish') && !c.includes('masul'),
      tg: (c) => c.includes('telegram') || c.includes('username'),
      phone: (c) => c.includes('telefon'),
      comps: (c) => c.includes('korxona'),
    });
    if (hp && (hp.cols.tg >= 0 || hp.cols.phone >= 0)) {
      for (let r = hp.row + 1; r < sh.rows; r++) {
        const row = sh.grid[r];
        const pn = String(row[hp.cols.name] ?? '').trim();
        if (!pn) continue;
        let tg = hp.cols.tg >= 0 ? String(row[hp.cols.tg] ?? '').trim() : '';
        tg = tg.replace(/^https?:\/\/t\.me\//i, '');
        if (tg && !tg.startsWith('@')) tg = '@' + tg;
        const phone = hp.cols.phone >= 0 ? String(row[hp.cols.phone] ?? '').trim() : '';
        let p = findPerson(pn, tg, phone);
        if (!p) {
          p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: pn, tg, phone };
          people.push(p); added.push(p);
        } else {
          const before = JSON.stringify(p);
          p.name = pn; if (tg) p.tg = tg; if (phone) p.phone = phone;
          if (JSON.stringify(p) !== before && !added.includes(p)) updated.add(p);
        }
        if (hp.cols.comps >= 0 && row[hp.cols.comps] != null) {
          for (const part of String(row[hp.cols.comps]).split(/[;\n]+/)) {
            const t = part.trim();
            if (!t) continue;
            const c = matchCompany(t);
            if (c) assigns.set(c.key, p.id); else missComp.add(t);
          }
        }
      }
      continue;
    }
    // 2) Korxonalar varag'i (korxona + mas'ul)
    const hc = findHeader(sh, {
      name: (c) => c.includes('korxona'),
      who: (c) => c.includes('masul'),
    });
    if (hc && hc.cols.who >= 0) {
      for (let r = hc.row + 1; r < sh.rows; r++) {
        const row = sh.grid[r];
        const cn = String(row[hc.cols.name] ?? '').trim();
        const who = String(row[hc.cols.who] ?? '').trim();
        if (!cn || !who) continue;
        const c = matchCompany(cn);
        if (!c) { missComp.add(cn); continue; }
        const p = findPerson(who, '', '');
        if (p) assigns.set(c.key, p.id); else missPerson.add(who);
      }
    }
  }

  const changedAssign = [...assigns].filter(([k, pid]) => state.resp.assign[k] !== pid);
  if (!added.length && !updated.size && !changedAssign.length) {
    toast(missComp.size || missPerson.size ? "O'zgarish yo'q — ba'zi nomlar topilmadi" : "Faylda yangi ma'lumot topilmadi", missComp.size || missPerson.size ? 'err' : '');
    if (!missComp.size && !missPerson.size) return;
  }
  const pn = (pid) => (people.find((p) => p.id === pid) || {}).name || '';
  const cname = new Map(attCompanies().list.map((c) => [c.key, c.name]));
  const dlg = dialog(`
    <div class="dlg-form">
      <div class="dlg-head"><h3>Excel'dan mas'ullar</h3><button type="button" class="icon-btn" data-close aria-label="Yopish">✕</button></div>
      <div class="dlg-body" style="display:block">
        <div class="stats">
          <div class="ok"><b>+${added.length}</b><span>yangi mas'ul</span></div>
          <div class="warn"><b>${updated.size}</b><span>yangilanadi</span></div>
          <div><b>${changedAssign.length}</b><span>korxona biriktiriladi</span></div>
        </div>
        ${added.length ? `<details open><summary>Yangi mas'ullar</summary><ul class="small">${added.map((p) => `<li><b>${esc(p.name)}</b> ${esc(p.tg || '')} ${esc(p.phone || '')}</li>`).join('')}</ul></details>` : ''}
        ${changedAssign.length ? `<details ${changedAssign.length <= 30 ? 'open' : ''}><summary>Biriktirishlar</summary><ul class="small">${changedAssign.map(([k, pid]) => `<li>${esc(cname.get(k))} → <b>${esc(pn(pid))}</b>${state.resp.assign[k] ? ` <span class="muted">(oldin: ${esc(pn(state.resp.assign[k]))})</span>` : ''}</li>`).join('')}</ul></details>` : ''}
        ${missComp.size ? `<details open><summary class="bad">Topilmagan korxonalar (${missComp.size})</summary><ul class="small">${[...missComp].map((t) => `<li>${esc(t)}</li>`).join('')}</ul><p class="fl-note">Nomni "Korxonalar" varag'idagidek yozing.</p></details>` : ''}
        ${missPerson.size ? `<details open><summary class="bad">Topilmagan mas'ullar (${missPerson.size})</summary><ul class="small">${[...missPerson].map((t) => `<li>${esc(t)}</li>`).join('')}</ul><p class="fl-note">Avval "Mas'ullar" varag'iga qo'shing.</p></details>` : ''}
      </div>
      <div class="dlg-foot"><span class="grow"></span>
        <button type="button" data-close>Bekor qilish</button>
        <button type="button" class="primary" data-apply ${added.length || updated.size || changedAssign.length ? '' : 'disabled'}>Saqlash</button></div>
    </div>`);
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelector('[data-apply]').onclick = async () => {
    state.resp.people = people;
    for (const [k, pid] of changedAssign) state.resp.assign[k] = pid;
    dlg.close();
    await respChanged();
    renderAttendance();
    toast(`Saqlandi: +${added.length} mas'ul, ${changedAssign.length} ta biriktirish ✓`, 'ok');
  };
}

// ---------------------------------------------------------------- 📅 3+3 jadval (guruhlar kunlari)
function schedGroups() {
  const db = state.view;
  const gi = dbFieldIdx('gurux', 'guruh');
  if (!db || gi < 0) return { gi, list: [] };
  const ci = dbFieldIdx('bosqich', 'kurs');
  const m = new Map();
  for (const r of db.rows) {
    const g = groupKey(r[gi]);
    if (!g) continue;
    if (!m.has(g)) m.set(g, { g, kurs: ci >= 0 ? String(r[ci] ?? '').trim() : '', n: 0, work: 0 });
    const x = m.get(g);
    x.n++;
    if (!studentContract(r).na) x.work++;
  }
  return { gi, list: [...m.values()].sort((a, b) => a.kurs.localeCompare(b.kurs, 'uz', { numeric: true }) || a.g.localeCompare(b.g, 'uz', { numeric: true })) };
}

function schedHtml() {
  const { gi, list } = schedGroups();
  if (gi < 0) return '<div class="box"><p class="muted">Bazada guruh ustuni topilmadi.</p></div>';
  const sched = state.resp.sched || {};
  const wd = weekdayOf(tkToday());
  const WDN = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
  const todayN = list.filter((x) => x.work && (!sched[x.g] || sched[x.g].includes(String(wd)))).length;
  const cnt = (d) => list.filter((x) => (sched[x.g] || '') === d).length;
  const kurslar = [...new Set(list.map((x) => x.kurs).filter(Boolean))];
  return `
    <div class="box">
      <h3>📅 3+3 tizim: guruhlar korxonaga qaysi kunlari boradi</h3>
      <p class="small muted">Har bir guruh uchun tanlang. Qolgan kunlari o'quvchilar texnikumda bo'ladi — bot o'sha kuni ularni mas'ulga ko'rsatmaydi, davomat va oylik jadvalda bu kunlar bo'yalgan bo'ladi.
        Bitta korxonada ikki guruh turli kunlarda bo'lsa (masalan 56-guruh Du–Chor, 65-guruh Pay–Shan), korxona bo'linmaydi: mas'ul har kuni faqat o'sha kungi guruhni ko'radi.</p>
      <div class="sched-sum">
        <span class="da-chip">Har kuni <b>${cnt('')}</b></span>
        <span class="da-chip ok">Du–Chor <b>${cnt('123')}</b></span>
        <span class="da-chip part">Pay–Shan <b>${cnt('456')}</b></span>
        <span class="muted small">· Bugun (${WDN[wd]}) korxonada: <b>${todayN}</b> ta guruh</span>
      </div>
      ${kurslar.length > 1 ? `<div class="sched-bulk small">Tez belgilash: ${kurslar.map((k) => `<span class="sb-k">${esc(k)}-kurs: ${SCHED.map(([d, l]) => `<button data-sbulk="${esc(k)}" data-d="${d}">${l}</button>`).join('')}</span>`).join('')}</div>` : ''}
      <div class="sched-list">${list.map((x) => `
        <div class="sched-row ${sched[x.g] === '123' ? 'a' : sched[x.g] === '456' ? 'b' : ''}">
          <div class="sched-name"><b>${esc(x.g)}${/guruh|гурух/i.test(x.g) ? '' : '-guruh'}</b><span class="muted small">${x.kurs ? esc(x.kurs) + '-kurs · ' : ''}${x.n} o'quvchi${x.work !== x.n ? ` · korxonada ${x.work}` : ''}</span></div>
          <div class="seg sched-seg">${SCHED.map(([d, l]) => `<button data-sg="${esc(x.g)}" data-d="${d}" class="${(sched[x.g] || '') === d ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>`).join('')}</div>
    </div>`;
}

function bindSched(box) {
  const set = async (groups, d) => {
    state.resp.sched = { ...(state.resp.sched || {}) };
    for (const g of groups) { if (d) state.resp.sched[g] = d; else delete state.resp.sched[g]; }
    await respChanged();
    renderAttendance();
    if (typeof refreshDashAtt === 'function') refreshDashAtt();
  };
  box.querySelectorAll('[data-sg]').forEach((b) => (b.onclick = () => set([b.dataset.sg], b.dataset.d)));
  box.querySelectorAll('[data-sbulk]').forEach((b) => (b.onclick = () => {
    const gs = schedGroups().list.filter((x) => x.kurs === b.dataset.sbulk).map((x) => x.g);
    if (confirm(`${b.dataset.sbulk}-kursning ${gs.length} ta guruhi "${schedLabel(b.dataset.d)}" qilinsinmi?`)) set(gs, b.dataset.d);
  }));
}

// ---------------------------------------------------------------- 📅 Oylik davomat jadvali (Excel)
const MONTHS_CYR = ['Январ', 'Феврал', 'Март', 'Апрел', 'Май', 'Июн', 'Июл', 'Август', 'Сентябр', 'Октябр', 'Ноябр', 'Декабр'];

async function fetchMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = (d) => `${ym}-${String(d).padStart(2, '0')}`;
  let items;
  const r = await botApi(`/api/attendance?from=${day(1)}&to=${day(n)}`);
  if (r.range) items = r.items;
  else {
    // eski server: kunma-kun so'rash
    items = [];
    for (let d = 1; d <= n && day(d) <= tkToday(); d++) {
      const x = await botApi('/api/attendance?date=' + day(d));
      items.push(...(x.items || []).map((it) => ({ ...it, date: day(d) })));
    }
  }
  const byDate = new Map();
  for (const it of items) {
    if (!byDate.has(it.date)) byDate.set(it.date, new Map());
    byDate.get(it.date).set(it.ck, it);
  }
  return { y, m, n, day, byDate };
}

function openMonthDialog() {
  const ym = (attUi.date || tkToday()).slice(0, 7);
  const dlg = dialog(`
    <form method="dialog" class="dlg-form">
      <div class="dlg-head"><h3>📅 Oylik davomat jadvali</h3><button type="button" class="icon-btn" data-close aria-label="Yopish">✕</button></div>
      <div class="dlg-body">
        <label>Oy <input type="month" id="mo-ym" value="${ym}" max="${tkToday().slice(0, 7)}"></label>
        <label>Ko'rinishi
          <select id="mo-split">
            <option value="one">Bitta varaq — korxonalar bo'yicha tartiblangan</option>
            <option value="comp">Har korxona alohida varaqda</option>
            <option value="person">Har mas'ul alohida varaqda</option>
          </select>
        </label>
        <label>Mas'ul
          <select id="mo-p"><option value="">Hammasi</option>${state.resp.people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        </label>
        <p class="small muted">Belgilar: <b>+</b> keldi, <b>н</b> kelmadi. Kulrang kataklar — o'quvchi u kuni texnikumda (3+3) yoki yakshanba.</p>
      </div>
      <div class="dlg-foot"><button type="button" data-close>Bekor qilish</button><button type="button" class="primary" id="mo-go">⬇ Yuklab olish</button></div>
    </form>`);
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelector('#mo-go').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Tayyorlanmoqda…';
    try {
      await downloadMonth(dlg.querySelector('#mo-ym').value || ym, dlg.querySelector('#mo-split').value, dlg.querySelector('#mo-p').value);
      dlg.close();
    } catch (err) {
      console.error(err);
      toast("Jadval tayyorlanmadi: " + err.message, 'err');
      btn.disabled = false; btn.textContent = '⬇ Yuklab olish';
    }
  };
}

async function downloadMonth(ym, split, onlyPid) {
  if (!botReady()) throw new Error('Bot ulanmagan');
  await Promise.all(state.view.rows.map(stuHash));
  const M = await fetchMonth(ym);
  const { list, gi } = attCompanies();
  const nameIdx = state.view.nameIdx >= 0 ? state.view.nameIdx : 0;
  const ci = dbFieldIdx('bosqich', 'kurs');
  const ii = dbFieldIdx('talimmuassasasinomi');
  const inst = (ii >= 0 && state.db.rows.map((r) => String(r[ii] ?? '').trim()).find(Boolean)) || 'Техникум';
  const instName = inst.replace(/поли(техникум)/gi, '$1').replace(/poli(texnikum)/gi, '$1');
  const people = new Map(state.resp.people.map((p) => [p.id, p]));

  const comps = list
    .map((c) => ({ c, pid: state.resp.assign[c.key] || ownersOf(c.key)[0] || '' }))
    .filter((x) => !onlyPid || ownersOf(x.c.key).includes(onlyPid))
    .sort((a, b) => (people.get(a.pid)?.name || 'я').localeCompare(people.get(b.pid)?.name || 'я', 'uz') || a.c.name.localeCompare(b.c.name, 'uz'));
  if (!comps.length) throw new Error("Tanlangan mas'ulga korxona biriktirilmagan");

  const rowsOf = (x) => {
    const sorted = x.c.rows.slice().sort((a, b) => String(a[gi] ?? '').localeCompare(String(b[gi] ?? ''), 'uz', { numeric: true }) || String(a[nameIdx] ?? '').localeCompare(String(b[nameIdx] ?? ''), 'uz'));
    return sorted.map((r) => {
      const h = hashCache.get(studentKey(r));
      let yes = 0, no = 0;
      const marks = [], off = [];
      for (let d = 1; d <= M.n; d++) {
        const date = M.day(d);
        const isOff = weekdayOf(date) === 0 || !dueOn(r, gi, date);
        off.push(isOff);
        const it = M.byDate.get(date) && M.byDate.get(date).get(x.c.key);
        const v = it ? it.marks[h] : undefined;
        if (v === 1) { yes++; marks.push('+'); } else if (v === 0) { no++; marks.push('н'); } else marks.push('');
      }
      const kurs = ci >= 0 ? r[ci] : '';
      // O'quvchining kunlariga qarab mas'ul (Du–Chor / Pay–Shan har xil bo'lishi mumkin)
      const dys = rowDays(r, gi);
      const ws = dys ? [+dys[0]] : [1, 4];
      const masul = [...new Set(ws.map((w) => people.get(ownerOn(x.c.key, w))?.name).filter(Boolean))].join(' / ');
      return { cells: [String(r[nameIdx] ?? ''), kurs == null ? '' : kurs, gi >= 0 ? r[gi] ?? '' : '', x.c.name], marks, off, total: yes || no ? `${yes} / ${no}` : '', masul };
    });
  };

  const title = `${instName} ўқувчилари давомати (${MONTHS_CYR[M.m - 1]} ойи учун, ${M.y} й.)`;
  const sheet = (name, xs) => ({ sheetName: name, title, monthLabel: `${MONTHS_CYR[M.m - 1]} ойи`, days: M.n, weekdays: Array.from({ length: M.n }, (_, i) => weekdayOf(M.day(i + 1))), rows: xs.flatMap(rowsOf) });
  let sheets;
  if (split === 'comp') sheets = comps.map((x) => sheet(x.c.name, [x]));
  else if (split === 'person') {
    const by = new Map();
    for (const x of comps) { const k = x.pid || '-'; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
    sheets = [...by].map(([pid, xs]) => sheet(people.get(pid)?.name || "Mas'ulsiz", xs));
  } else sheets = [sheet('Davomat', comps)];
  const blob = await XlsxWrite.buildRegister({ sheets });
  downloadBlob(blob, `Davomat ${ym}.xlsx`);
  toast('Oylik jadval tayyor ✓', 'ok');
}

// Mavjud bo'lmagan mas'ullarga ishora qiluvchi kunlik biriktirishlarni tozalash
function cleanSplits() {
  const ids = new Set(state.resp.people.map((p) => p.id));
  const by = state.resp.assignBy || {};
  for (const ck of Object.keys(by)) {
    for (const h of Object.keys(by[ck])) if (!ids.has(by[ck][h])) delete by[ck][h];
    if (!Object.keys(by[ck]).length) delete by[ck];
  }
}

// ---------------------------------------------------------------- 🤖 Ustalar bo'yicha avtomatik taqsimlash
function autoSplitPlan(onlyBoth) {
  const { list, gi } = attCompanies();
  const ui = dbFieldIdx('ustasi', 'usta');
  if (ui < 0) return { error: "Bazada usta ustuni topilmadi" };
  const people = state.resp.people.map((p) => ({ p, t: Match.personTokens(p.name) }));
  const cache = new Map(), unknown = new Map();
  const personOf = (name) => {
    const k = Match.personKey(name);
    if (!k) return null;
    if (cache.has(k)) return cache.get(k);
    let best = null, bs = 0;
    for (const x of people) { const sc = Match.personScore(Match.personTokens(name), x.t); if (sc > bs) { bs = sc; best = x.p; } }
    const r = bs >= 0.85 ? best : null;
    cache.set(k, r);
    return r;
  };
  const changes = [];
  for (const c of list) {
    const pick = {};
    for (const [h] of HALVES) {
      const rows = c.rows.filter((r) => { const d = rowDays(r, gi); return !d || d === h; });
      if (!rows.length) continue;
      const cnt = new Map();
      for (const r of rows) {
        const u = String(r[ui] ?? '').trim();
        if (!u) continue;
        const p = personOf(u);
        if (!p) { unknown.set(u, (unknown.get(u) || 0) + 1); continue; }
        cnt.set(p.id, (cnt.get(p.id) || 0) + 1);
      }
      const top = [...cnt].sort((a, b) => b[1] - a[1])[0];
      if (top) pick[h] = top[0];
    }
    const hs = Object.keys(pick);
    if (!hs.length) continue;
    const differ = hs.length === 2 && pick['123'] !== pick['456'];
    if (onlyBoth && !differ) continue;
    const next = differ ? { main: state.resp.assign[c.key] || pick['123'], by: pick } : { main: pick[hs[0]], by: null };
    const cur = { main: state.resp.assign[c.key] || '', by: splitOf(c.key) };
    if (JSON.stringify(next) === JSON.stringify({ main: cur.main, by: cur.by || null })) continue;
    changes.push({ c, next, cur });
  }
  return { changes, unknown: [...unknown].sort((a, b) => b[1] - a[1]) };
}

function openAutoSplit() {
  let onlyBoth = true;
  const pn = (id) => (state.resp.people.find((p) => p.id === id) || {}).name || '—';
  const draw = () => {
    const plan = autoSplitPlan(onlyBoth);
    const desc = (x) => (x.by ? HALVES.map(([h, l]) => `${l}: <b>${esc(pn(x.by[h] || x.main))}</b>`).join(' · ') : `<b>${esc(pn(x.main))}</b>`);
    const dlg = dialog(`
      <form method="dialog" class="dlg-form">
        <div class="dlg-head"><h3>🤖 Ustalar bo'yicha taqsimlash</h3><button type="button" class="icon-btn" data-close aria-label="Yopish">✕</button></div>
        <div class="dlg-body" style="grid-template-columns:1fr">
          ${plan.error ? `<p class="bad">${esc(plan.error)}</p>` : `
          <p class="small muted">Har korxonaning Du–Chor va Pay–Shan kunlari uchun o'sha kunlari keladigan guruhlardagi eng ko'p o'quvchining ustasi mas'ul qilib tanlanadi (usta mas'ullar ro'yxatida bo'lishi kerak). Avval "📅 3+3" bo'limida guruh kunlarini belgilang.</p>
          <label class="check"><input type="checkbox" id="as-both" ${onlyBoth ? 'checked' : ''}> Faqat ikki xil kunli korxonalar (boshqa korxonalarning mas'uliga tegilmasin)</label>
          <p><b>${plan.changes.length}</b> ta korxona o'zgaradi.</p>
          ${plan.changes.length ? `<ul class="small as-list">${plan.changes.slice(0, 200).map((x) => `<li><b>${esc(x.c.name)}</b><br>${desc(x.next)}${x.cur.main || x.cur.by ? ` <span class="muted">(oldin: ${x.cur.by ? HALVES.map(([h, l]) => `${l}: ${esc(pn(x.cur.by[h] || x.cur.main))}`).join(' · ') : esc(pn(x.cur.main))})</span>` : ''}</li>`).join('')}</ul>` : ''}
          ${plan.unknown.length ? `<details><summary class="warn small">Mas'ullar ro'yxatida topilmagan ustalar (${plan.unknown.length})</summary><ul class="small">${plan.unknown.map(([u, n]) => `<li>${esc(u)} — ${n} o'quvchi</li>`).join('')}</ul><p class="small muted">Ularni "Mas'ullar" ro'yxatiga qo'shsangiz, taqsimlashda hisobga olinadi.</p></details>` : ''}`}
        </div>
        <div class="dlg-foot"><button type="button" data-close>Bekor qilish</button><button type="button" class="primary" id="as-go" ${plan.changes && plan.changes.length ? '' : 'disabled'}>Qo'llash</button></div>
      </form>`);
    dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
    const cb = dlg.querySelector('#as-both');
    if (cb) cb.onchange = () => { onlyBoth = cb.checked; draw(); };
    dlg.querySelector('#as-go').onclick = async () => {
      state.resp.assignBy = { ...(state.resp.assignBy || {}) };
      for (const x of plan.changes) {
        state.resp.assign[x.c.key] = x.next.main;
        if (x.next.by) state.resp.assignBy[x.c.key] = x.next.by; else delete state.resp.assignBy[x.c.key];
      }
      dlg.close();
      await respChanged();
      renderAttendance();
      toast(`${plan.changes.length} ta korxona taqsimlandi ✓`, 'ok');
    };
  };
  draw();
}
