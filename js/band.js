/* global state, $, esc, toast, Match, saveLocal, cloudPush, studentKey, dbFieldIdx, XlsxWrite, downloadBlob, readWorkbook, readFile, dialog, findHeader */
'use strict';
// Bandlik: o'quvchi rasmiy qayerda ishlaydi, maosh qanday olinadi (oylik / naqd) va oylik miqdori.
// Ma'lumot bazaning ustunlariga tegmaydi — alohida saqlanadi: state.band[studentKey] = { w, t, s }
//   w — rasmiy ish joyi, t — 'oylik' | 'naqd', s — oylik (so'm)

const bandUi = { q: '', group: '', kurs: '', show: 'all', limit: 100 };
const PAY = [['oylik', '💳 Oylik'], ['naqd', '💵 Naqd']];
const payLabel = (t) => (t === 'naqd' ? 'Naqd pul' : t === 'oylik' ? 'Oylik' : '');
const fmtSum = (n) => (n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '');
const bandOf = (r) => (state.band || {})[studentKey(r)] || {};

let bandTimer = null;
async function bandChanged() {
  await saveLocal();
  clearTimeout(bandTimer);
  bandTimer = setTimeout(() => cloudPush(), 2500);
}

function setBand(key, patch) {
  state.band = { ...(state.band || {}) };
  const v = { ...(state.band[key] || {}), ...patch };
  for (const k of Object.keys(v)) if (v[k] === '' || v[k] == null || v[k] === 0) delete v[k];
  if (Object.keys(v).length) state.band[key] = v; else delete state.band[key];
}

function bandRows() {
  const db = state.view;
  const gi = dbFieldIdx('gurux', 'guruh'), ci = dbFieldIdx('bosqich', 'kurs');
  const ni = db.nameIdx >= 0 ? db.nameIdx : 0;
  const q = Match.norm(bandUi.q);
  const all = db.rows.map((r, i) => ({ r, raw: state.db.rows[i], i }));
  const rows = all.filter(({ r, raw }) => {
    if (bandUi.group && String(r[gi] ?? '').trim() !== bandUi.group) return false;
    if (bandUi.kurs && String(r[ci] ?? '').trim() !== bandUi.kurs) return false;
    const b = bandOf(raw);
    if (bandUi.show === 'work' && !b.w) return false;
    if (bandUi.show === 'nowork' && b.w) return false;
    if (bandUi.show === 'oylik' && b.t !== 'oylik') return false;
    if (bandUi.show === 'naqd' && b.t !== 'naqd') return false;
    if (q && !Match.norm(r[ni]).includes(q) && !Match.norm(b.w).includes(q)) return false;
    return true;
  });
  return { all, rows, gi, ci, ni };
}

function bandStats(list) {
  let work = 0, oylik = 0, naqd = 0, sum = 0, sumN = 0;
  for (const { raw } of list) {
    const b = bandOf(raw);
    if (b.w) work++;
    if (b.t === 'oylik') oylik++;
    if (b.t === 'naqd') naqd++;
    if (b.s) { sum += b.s; sumN++; }
  }
  return { total: list.length, work, oylik, naqd, avg: sumN ? Math.round(sum / sumN) : 0 };
}

function bandStatsHtml(st) {
  return `
    <div><b>${st.total}</b><span>o'quvchi</span></div>
    <div class="ok"><b>${st.work}</b><span>rasmiy ishlaydi</span></div>
    <div><b>${st.oylik}</b><span>💳 oylik</span></div>
    <div class="warn"><b>${st.naqd}</b><span>💵 naqd pul</span></div>
    <div><b>${st.avg ? fmtSum(st.avg) : '—'}</b><span>o'rtacha oylik, so'm</span></div>`;
}

function renderBand() {
  const box = $('#band-body');
  if (!box) return;
  if (!state.db || !state.view) { box.innerHTML = '<div class="box"><p class="muted">Baza bo\'sh. Avval "Baza" bo\'limida asosiy jadvalni yuklang.</p></div>'; return; }
  const { all, rows, gi, ci, ni } = bandRows();
  const vals = (idx) => (idx < 0 ? [] : [...new Set(all.map(({ r }) => String(r[idx] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uz', { numeric: true })));
  const shown = rows.slice(0, bandUi.limit);
  box.innerHTML = `
    <div class="box">
      <div class="stats" id="band-stats">${bandStatsHtml(bandStats(rows))}</div>
      <div class="band-bar">
        <input type="search" id="bd-q" placeholder="F.I.Sh yoki ish joyi…" value="${esc(bandUi.q)}">
        ${ci >= 0 ? `<select id="bd-kurs"><option value="">Barcha kurslar</option>${vals(ci).map((v) => `<option value="${esc(v)}" ${bandUi.kurs === v ? 'selected' : ''}>${esc(v)}-kurs</option>`).join('')}</select>` : ''}
        ${gi >= 0 ? `<select id="bd-group"><option value="">Barcha guruhlar</option>${vals(gi).map((v) => `<option ${bandUi.group === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}
        <select id="bd-show">
          ${[['all', 'Hammasi'], ['work', 'Ishlaydiganlar'], ['nowork', 'Ish joyi yozilmagan'], ['oylik', '💳 Oylik oladiganlar'], ['naqd', '💵 Naqd oladiganlar']].map(([k, l]) => `<option value="${k}" ${bandUi.show === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="band-xl">
        <button id="bd-xl">⬇ Excel</button>
        <label class="file-btn">📤 Excel'dan yuklash<input type="file" id="bd-file" accept=".xlsx,.xlsm,.xls"></label>
        <span class="small muted">Excel'ni yuklab oling, to'ldiring va qaytarib yuklang — o'quvchilar JShShIR yoki F.I.Sh bo'yicha topiladi.</span>
      </div>
    </div>
    <div class="box band-list">
      <div class="band-row band-head"><span>№</span><span>F.I.Sh</span><span>Rasmiy ish joyi</span><span>To'lov turi</span><span>Oylik, so'm</span></div>
      ${shown.map(({ r, raw }, k) => {
        const b = bandOf(raw), key = studentKey(raw);
        return `<div class="band-row ${b.w ? 'on' : ''}" data-k="${esc(key)}">
          <span class="bd-n">${k + 1}</span>
          <span class="bd-name"><b>${esc(r[ni] ?? '')}</b><span class="muted small">${gi >= 0 ? esc(r[gi] ?? '') + '-guruh' : ''}${ci >= 0 && r[ci] != null ? ' · ' + esc(r[ci]) + '-kurs' : ''}</span></span>
          <input class="bd-w" data-f="w" value="${esc(b.w || '')}" placeholder="Ish joyi (tashkilot nomi)…">
          <span class="seg bd-t">${PAY.map(([t, l]) => `<button type="button" data-t="${t}" class="${b.t === t ? 'on' : ''}">${l}</button>`).join('')}</span>
          <input class="bd-s" data-f="s" value="${esc(fmtSum(b.s))}" inputmode="numeric" placeholder="0">
        </div>`;
      }).join('') || '<p class="muted">Hech kim topilmadi.</p>'}
      ${rows.length > shown.length ? `<button class="more-btn" id="bd-more">Yana ${Math.min(100, rows.length - shown.length)} ta ko'rsatish (jami ${rows.length})</button>` : ''}
    </div>`;
  bindBand(box, rows);
}

function bindBand(box, rows) {
  const keepFocus = (id, fn) => {
    const el = $(id);
    if (!el) return;
    el.oninput = (e) => { const pos = e.target.selectionStart; fn(e.target.value); bandUi.limit = 100; renderBand(); const n = $(id); n.focus(); n.setSelectionRange(pos, pos); };
  };
  keepFocus('#bd-q', (v) => { bandUi.q = v; });
  const sel = (id, k) => { const el = $(id); if (el) el.onchange = () => { bandUi[k] = el.value; bandUi.limit = 100; renderBand(); }; };
  sel('#bd-kurs', 'kurs'); sel('#bd-group', 'group'); sel('#bd-show', 'show');
  const more = $('#bd-more');
  if (more) more.onclick = () => { bandUi.limit += 100; renderBand(); };
  const refreshStats = () => { const el = $('#band-stats'); if (el) el.innerHTML = bandStatsHtml(bandStats(rows)); };
  box.querySelectorAll('.band-row[data-k]').forEach((row) => {
    const key = row.dataset.k;
    row.querySelector('.bd-w').onchange = async (e) => {
      setBand(key, { w: e.target.value.replace(/\s+/g, ' ').trim() });
      row.classList.toggle('on', !!(state.band[key] || {}).w);
      refreshStats();
      await bandChanged();
    };
    const s = row.querySelector('.bd-s');
    s.oninput = () => { const d = Match.digits(s.value).slice(0, 12); const pos = s.value.length - s.selectionStart; s.value = fmtSum(d); const p = Math.max(0, s.value.length - pos); s.setSelectionRange(p, p); };
    s.onchange = async () => { setBand(key, { s: +Match.digits(s.value) || 0 }); refreshStats(); await bandChanged(); };
    row.querySelectorAll('[data-t]').forEach((b) => (b.onclick = async () => {
      const cur = (state.band[key] || {}).t;
      const t = cur === b.dataset.t ? '' : b.dataset.t;
      setBand(key, { t });
      row.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === t));
      refreshStats();
      await bandChanged();
    }));
  });
  $('#bd-xl').onclick = downloadBand;
  $('#bd-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBand(f); };
}

async function downloadBand() {
  const { rows, gi, ci, ni } = bandRows();
  const ji = state.db.fields.findIndex((f) => Match.canon(f.name).includes('jshshir'));
  const out = rows.map(({ r, raw }, k) => {
    const b = bandOf(raw);
    return [k + 1, r[ni] ?? '', ji >= 0 ? String(raw[ji] ?? '') : '', ci >= 0 ? r[ci] ?? '' : '', gi >= 0 ? r[gi] ?? '' : '', b.w || '', payLabel(b.t), b.s || ''];
  });
  const blob = await XlsxWrite.buildWorkbook({
    title: "O'quvchilar bandligi", sheetName: 'Bandlik',
    headers: ['№', 'F.I.Sh', 'JShShIR', 'Kurs', 'Guruh', 'Rasmiy ish joyi', "To'lov turi (oylik / naqd)", "Oylik (so'm)"],
    rows: out, minWidths: [5, 34, 16, 6, 8, 34, 16, 14],
  });
  downloadBlob(blob, 'Bandlik.xlsx');
}

async function importBand(file) {
  let wb;
  try { wb = readWorkbook(await readFile(file)); } catch (e) { toast("Faylni o'qib bo'lmadi: " + e.message, 'err'); return; }
  const raws = state.db.rows;
  const ji = state.db.fields.findIndex((f) => Match.canon(f.name).includes('jshshir'));
  const ni = state.db.nameIdx >= 0 ? state.db.nameIdx : 0;
  const byJ = new Map();
  if (ji >= 0) raws.forEach((r) => { const d = Match.digits(r[ji]); if (d.length === 14) byJ.set(d, r); });
  const toks = raws.map((r) => Match.personTokens(r[ni]));
  const findRow = (j, name) => {
    const d = Match.digits(j);
    if (d.length === 14 && byJ.has(d)) return byJ.get(d);
    const t = Match.personTokens(name);
    if (t.length < 2) return null;
    let best = -1, bs = 0, second = 0;
    toks.forEach((tk, i) => { const sc = Match.personScore(t, tk); if (sc > bs) { second = bs; bs = sc; best = i; } else if (sc > second) second = sc; });
    return best >= 0 && bs >= 0.88 && bs - second >= 0.04 ? raws[best] : null;
  };
  const updates = new Map(), missing = [];
  for (const name of wb.names) {
    const sh = wb.sheets[name];
    const h = findHeader(sh, {
      name: (c) => c.includes('fish') || c.includes('familiya'),
      j: (c) => c.includes('jshshir'),
      w: (c) => c.includes('ishjoyi') || c.includes('ishlayd') || c.includes('bandlik'),
      t: (c) => c.includes('tolovturi') || c.includes('naqd'),
      s: (c) => (c.includes('oylik') || c.includes('maosh')) && !c.includes('naqd') && !c.includes('tolovturi'),
    });
    if (!h || (h.cols.w < 0 && h.cols.t < 0 && h.cols.s < 0)) continue;
    for (let r = h.row + 1; r < sh.rows; r++) {
      const g = sh.grid[r];
      const nm = h.cols.name >= 0 ? String(g[h.cols.name] ?? '').trim() : '';
      const j = h.cols.j >= 0 ? g[h.cols.j] : '';
      const w = h.cols.w >= 0 ? String(g[h.cols.w] ?? '').replace(/\s+/g, ' ').trim() : '';
      const tRaw = h.cols.t >= 0 ? Match.norm(g[h.cols.t]) : '';
      const t = /naqd|nakd/.test(tRaw) ? 'naqd' : /oylik|karta|plastik|bank/.test(tRaw) ? 'oylik' : '';
      const s = h.cols.s >= 0 ? +Match.digits(g[h.cols.s]) || 0 : 0;
      if (!w && !t && !s) continue;
      const row = findRow(j, nm);
      if (!row) { if (nm || j) missing.push(nm || String(j)); continue; }
      const patch = {};
      if (w) patch.w = w;
      if (t) patch.t = t;
      if (s) patch.s = s;
      updates.set(studentKey(row), { ...(updates.get(studentKey(row)) || {}), ...patch });
    }
  }
  if (!updates.size && !missing.length) { toast("Faylda bandlik ustunlari topilmadi (Rasmiy ish joyi / To'lov turi / Oylik)", 'err'); return; }
  const dlg = dialog(`
    <form method="dialog" class="dlg-form">
      <div class="dlg-head"><h3>📤 Bandlik ma'lumotlarini yuklash</h3><button type="button" class="icon-btn" data-close aria-label="Yopish">✕</button></div>
      <div class="dlg-body" style="grid-template-columns:1fr">
        <p><b>${updates.size}</b> ta o'quvchi topildi va yangilanadi. Faylda bo'sh kataklar bazadagini o'chirmaydi.</p>
        ${missing.length ? `<details><summary class="warn">Bazada topilmadi — olinmaydi (${missing.length})</summary><ul class="small">${missing.slice(0, 200).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></details>` : ''}
      </div>
      <div class="dlg-foot"><button type="button" data-close>Bekor qilish</button><button type="button" class="primary" id="bi-go" ${updates.size ? '' : 'disabled'}>Yuklash</button></div>
    </form>`);
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelector('#bi-go').onclick = async () => {
    for (const [k, patch] of updates) setBand(k, patch);
    dlg.close();
    await bandChanged();
    renderBand();
    toast(`${updates.size} ta o'quvchining bandligi yangilandi ✓`, 'ok');
  };
}
