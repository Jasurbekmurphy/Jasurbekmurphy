/* global state, $, esc, toast, Match, saveLocal, cloudPush, companyGroups, studentContract, studentKey, dbFieldIdx, XlsxWrite, downloadBlob */
'use strict';
// Mas'ul shaxslar va Telegram bot orqali davomat.

const attUi = {
  sub: 'att', date: '', data: null, err: '', loading: false, at: 0, timer: null, status: null,
  q: '', open: new Set(), aq: '', agroup: '', afree: false, pushedAt: 0, pushing: false,
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
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: 'Bearer ' + state.bot.key, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Bot xatosi: ' + res.status));
  return data;
}

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
    const pid = state.resp.assign[c.key];
    if (!pid || !state.resp.people.some((p) => p.id === pid)) continue;
    const s = [];
    for (const r of c.rows) s.push([await stuHash(r), String(r[nameIdx] ?? ''), gi >= 0 ? String(r[gi] ?? '') : '']);
    s.sort((a, b) => a[2].localeCompare(b[2], 'uz', { numeric: true }) || a[1].localeCompare(b[1], 'uz'));
    companies.push({ k: c.key, n: c.name, p: pid, s });
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
      <button data-sub="bot" class="${attUi.sub === 'bot' ? 'on' : ''}">⚙️ Bot</button>
    </div>`;
  const body = attUi.sub === 'people' ? peopleHtml() : attUi.sub === 'bot' ? botHtml() : attHtml();
  box.innerHTML = tabs + body;
  box.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = async () => {
    attUi.sub = b.dataset.sub;
    renderAttendance();
    if (attUi.sub === 'att') loadAttendance();
    if (attUi.sub !== 'att') { await loadStatus(); renderAttendance(); }
  }));
  if (attUi.sub === 'people') bindPeople(box);
  else if (attUi.sub === 'bot') bindBot(box);
  else bindAtt(box);
}

// ---------------------------------------------------------------- 📊 Davomat
function attModel() {
  const { list, gi } = attCompanies();
  const nameIdx = state.view.nameIdx >= 0 ? state.view.nameIdx : 0;
  const items = new Map(((attUi.data && attUi.data.items) || []).map((x) => [x.ck, x]));
  const people = new Map(state.resp.people.map((p) => [p.id, p]));
  const assigned = list.filter((c) => people.has(state.resp.assign[c.key]));
  const groups = new Map();
  for (const c of assigned) {
    const pid = state.resp.assign[c.key];
    if (!groups.has(pid)) groups.set(pid, []);
    const it = items.get(c.key);
    groups.get(pid).push({ c, it });
  }
  return { list, gi, nameIdx, items, people, assigned, groups, free: list.length - assigned.length };
}

function attHtml() {
  if (!botReady()) {
    return `<div class="box empty-hero"><div class="big">🤖</div><h2>Bot hali ulanmagan</h2>
      <p class="muted">Davomatni ko'rish uchun avval Telegram botni ulang.</p>
      <button class="primary" data-sub2="bot">⚙️ Bot sozlamasiga o'tish</button></div>`;
  }
  const m = attModel();
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
      <button id="att-xl">⬇ Excel</button>
    </div>
    <p class="muted small att-live">${attUi.err ? `<span class="bad">⚠ ${esc(attUi.err)}</span>` : attUi.at ? `${isToday ? '🟢 Jonli: har 30 soniyada yangilanadi · ' : ''}oxirgi yangilanish ${new Date(attUi.at).toLocaleTimeString('uz')}` : 'Yuklanmoqda…'}</p>
    <div class="stats">
      <div><b>${m.assigned.length}</b><span>korxona (mas'ul bor)</span></div>
      <div class="ok"><b>${went}</b><span>✅ borildi</span></div>
      <div class="bad"><b>${missed}</b><span>❌ bormadi</span></div>
      <div class="ok"><b>${yes}</b><span>o'quvchi keldi</span></div>
      <div class="warn"><b>${no}</b><span>o'quvchi kelmadi</span></div>
    </div>
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
  for (const c of list) { const pid = state.resp.assign[c.key]; if (pid) cnt.set(pid, (cnt.get(pid) || 0) + 1); }
  const groupVals = gi >= 0 ? [...new Set(list.flatMap((c) => c.rows.map((r) => String(r[gi] ?? '').trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uz', { numeric: true })) : [];
  const q = Match.norm(attUi.aq);
  let comps = list;
  if (q) comps = comps.filter((c) => Match.norm(c.name).includes(q));
  if (attUi.agroup) comps = comps.filter((c) => c.rows.some((r) => String(r[gi] ?? '').trim() === attUi.agroup));
  if (attUi.afree) comps = comps.filter((c) => !state.resp.assign[c.key]);
  const opts = (sel) => `<option value="">— biriktirilmagan —</option>${state.resp.people.map((p) => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  const free = list.filter((c) => !state.resp.assign[c.key]).length;

  return `
    <div class="att-grid">
      <div class="box">
        <h3>Mas'ul shaxslar (${state.resp.people.length})</h3>
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
        <div class="a-list">${comps.map((c) => `
          <div class="a-row ${state.resp.assign[c.key] ? 'on' : ''}">
            <div class="a-name"><b>${esc(c.name)}</b><span class="muted small">${c.rows.length} o'quvchi${gi >= 0 ? ' · ' + [...new Set(c.rows.map((r) => r[gi]))].map(esc).join(', ') : ''}</span></div>
            <select data-assign="${esc(c.key)}">${opts(state.resp.assign[c.key] || '')}</select>
          </div>`).join('') || '<p class="muted small">Korxona topilmadi.</p>'}</div>
        <div class="row-btns">
          <button class="primary" id="a-push" ${botReady() ? '' : 'disabled'}>${attUi.pushing ? 'Yuborilmoqda…' : "🔄 Ro'yxatni botga yuborish"}</button>
        </div>
        <p class="fl-note">${botReady() ? (attUi.pushedAt ? `Oxirgi yuborilgan: ${new Date(attUi.pushedAt).toLocaleTimeString('uz')}. ` : '') + "O'zgarishlar bir necha soniyadan keyin botga avtomatik yuboriladi." : 'Bot ulanmagan — "⚙️ Bot" bo\'limida sozlang.'}</p>
      </div>
    </div>`;
}

function bindPeople(box) {
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
    s.closest('.a-row').classList.toggle('on', !!s.value);
    await respChanged();
  }));
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
        <label>Bot manzili (Cloudflare Worker)
          <input id="b-url" value="${esc(state.bot.url)}" placeholder="https://jadval-bot.sizning-nom.workers.dev">
        </label>
        <label style="margin-top:10px">Admin kalit (ADMIN_KEY)
          <div class="key-row"><input id="b-key" type="password" value="${esc(state.bot.key)}" autocomplete="off"><button type="button" id="b-gen" title="Yangi kalit yaratish">🎲</button><button type="button" id="b-show">👁</button></div>
        </label>
        <div class="row-btns"><button class="primary" id="b-save">Saqlash va tekshirish</button></div>
        <div class="b-status">${!botReady() ? '<p class="muted small">Bot hali ulanmagan.</p>'
          : !st ? '<p class="muted small">Tekshirilmoqda…</p>'
          : st.error ? `<p class="bad small">⚠ ${esc(st.error)}</p>`
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
