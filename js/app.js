/* global XLSX, Match, XlsxFill */
'use strict';

// ---------------------------------------------------------------- yordamchilar
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pad = (n) => String(n).padStart(2, '0');
const L = (c) => XlsxFill.colToLetters(c);

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), 3500);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ---------------------------------------------------------------- IndexedDB
const Store = (() => {
  let dbp;
  function open() {
    dbp = dbp || new Promise((resolve, reject) => {
      const req = indexedDB.open('jadval-baza', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  }
  return {
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
  };
})();

// ---------------------------------------------------------------- Excel o'qish
function cellValue(cell) {
  if (!cell || cell.v == null) return null;
  if (cell.t === 'n') {
    if (cell.z && XLSX.SSF.is_date(cell.z)) {
      const d = XLSX.SSF.parse_date_code(cell.v);
      if (d) return pad(d.d) + '.' + pad(d.m) + '.' + d.y;
    }
    return cell.v;
  }
  if (cell.t === 'b') return cell.v ? 'Ha' : "Yo'q";
  if (cell.t === 'e') return null;
  let s = String(cell.v).trim();
  if (s === '') return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // 14/03/2009 -> 14.03.2009
  if (m) s = pad(m[1]) + '.' + pad(m[2]) + '.' + m[3];
  return s;
}

function readSheet(ws) {
  const ref = ws['!ref'];
  if (!ref) return { grid: [], rows: 0, cols: 0, merges: [] };
  const range = XLSX.utils.decode_range(ref);
  const grid = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row = [];
    for (let c = 0; c <= range.e.c; c++) row.push(cellValue(ws[XLSX.utils.encode_cell({ r, c })]));
    grid.push(row);
  }
  return { grid, rows: range.e.r + 1, cols: range.e.c + 1, merges: ws['!merges'] || [] };
}

function readWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellNF: true, cellFormula: false, cellStyles: false });
  const sheets = {};
  for (const name of wb.SheetNames) sheets[name] = readSheet(wb.Sheets[name]);
  return { names: wb.SheetNames, sheets };
}

function mergedValue(sheet, r, c) {
  const v = sheet.grid[r] && sheet.grid[r][c];
  if (v != null) return v;
  for (const m of sheet.merges) {
    if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) return sheet.grid[m.s.r][m.s.c];
  }
  return null;
}

const isNumHeader = (t) => /^(№|n|no|#|т\/р|t\/r|р\/т)\.?$/i.test(String(t ?? '').trim());
const isX = (v) => /^[xх]$/i.test(String(v).trim());

// ---------------------------------------------------------------- Asosiy jadvaldan baza
function detectMasterHeader(sheet) {
  const counts = [];
  for (let r = 0; r < Math.min(sheet.rows, 15); r++) {
    counts.push(sheet.grid[r].filter((v) => typeof v === 'string').length);
  }
  const max = Math.max(0, ...counts);
  const r = counts.findIndex((n) => n >= 3 && n >= 0.6 * max);
  return r < 0 ? 0 : r;
}

function isNumberingRow(row) {
  const nums = row.filter((v) => v != null);
  return nums.length >= 3 && nums.every((v, i) => Number(v) === i + 1);
}

function buildMaster(sheet, headerRow) {
  const header = sheet.grid[headerRow] || [];
  const used = [];
  header.forEach((h, c) => { if (h != null && String(h).trim()) used.push(c); });
  const names = used.map((c) => String(header[c]).replace(/\s+/g, ' ').trim());
  const fields = used.map((c, i) => {
    // Takroriy nom: birinchisi o'z nomida qoladi, keyingilariga oldingi ustun nomi qo'shiladi
    const dup = names.indexOf(names[i]) !== i;
    let label = names[i];
    if (dup) {
      const prev = i > 0 ? names[i - 1].split(' ').slice(0, 4).join(' ') : '';
      label = names[i] + (prev ? ' — ' + prev : ' (' + L(c) + ')');
    }
    return { col: c, name: names[i], label, num: isNumHeader(names[i]) };
  });

  const findField = (canonKey) => fields.findIndex((f) => Match.canon(f.name).includes(canonKey));
  const nameIdx = findField('fish');
  const jIdx = findField('jshshir');

  const rows = [];
  for (let r = headerRow + 1; r < sheet.rows; r++) {
    const raw = sheet.grid[r];
    const vals = fields.map((f) => raw[f.col]);
    const filled = vals.filter((v) => v != null);
    if (!filled.length || filled.every(isX) || isNumberingRow(raw)) continue;
    if (nameIdx >= 0 && vals[nameIdx] == null) continue;
    if (nameIdx < 0 && filled.length < 3) continue;
    rows.push(vals);
  }
  return { fields, rows, nameIdx, keyIdx: jIdx >= 0 ? jIdx : nameIdx, headerRow };
}

function parseMaster(buf, preferredSheet) {
  const wb = readWorkbook(buf);
  const options = wb.names.map((name) => {
    const sheet = wb.sheets[name];
    const m = buildMaster(sheet, detectMasterHeader(sheet));
    return { name, master: m };
  });
  let pick = options.find((o) => o.name === preferredSheet);
  if (!pick) pick = options.reduce((a, b) => (b.master.rows.length > a.master.rows.length ? b : a));
  return { sheetNames: wb.names, sheetName: pick.name, ...pick.master };
}

function rowKey(db, row) {
  const v = row[db.keyIdx];
  if (v == null) return '';
  return Match.canon(db.fields[db.keyIdx].name).includes('jshshir') ? Match.digits(v) : Match.nameKey(v);
}

function diffMasters(oldDb, newDb) {
  if (!oldDb) return null;
  const oldMap = new Map(oldDb.rows.map((r) => [rowKey(oldDb, r), r]));
  const newMap = new Map(newDb.rows.map((r) => [rowKey(newDb, r), r]));
  const added = [], removed = [], changed = [];
  for (const [k, r] of newMap) {
    const o = oldMap.get(k);
    if (!o) { added.push(r); continue; }
    const diffs = [];
    newDb.fields.forEach((f, i) => {
      const oi = oldDb.fields.findIndex((of) => of.label === f.label);
      const ov = oi >= 0 ? o[oi] : null;
      if (String(ov ?? '') !== String(r[i] ?? '')) diffs.push({ field: f.label, from: ov, to: r[i] });
    });
    if (diffs.length) changed.push({ row: r, diffs });
  }
  for (const [k, r] of oldMap) if (!newMap.has(k)) removed.push(r);
  return { added, removed, changed };
}

// ---------------------------------------------------------------- Holat
const state = {
  db: null,        // { fields, rows, nameIdx, keyIdx, sheetName, fileName, importedAt, file }
  pending: null,   // tasdiqlanmagan yangi import
  tpl: null,       // to'ldiriladigan shablon
};

// ---------------------------------------------------------------- Tablar
function showTab(id) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== id));
  try { localStorage.setItem('tab', id); } catch (e) { /* ixtiyoriy */ }
}

// ---------------------------------------------------------------- BAZA paneli
function renderDbStatus() {
  const box = $('#db-status');
  const db = state.db;
  if (!db) {
    box.innerHTML = `<p class="muted">Baza hali bo'sh. Asosiy Excel jadvalni yuklang.</p>`;
    $('#db-actions').hidden = true;
    return;
  }
  const d = new Date(db.importedAt);
  box.innerHTML = `
    <div class="stats">
      <div><b>${db.rows.length}</b><span>yozuv</span></div>
      <div><b>${db.fields.length}</b><span>ustun</span></div>
    </div>
    <p class="muted">Fayl: <b>${esc(db.fileName)}</b> · varaq: <b>${esc(db.sheetName)}</b><br>
    Yangilangan: ${d.toLocaleDateString('uz')} ${d.toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' })}<br>
    Kalit ustun: <b>${esc(db.fields[db.keyIdx]?.label || '—')}</b></p>`;
  $('#db-actions').hidden = false;
}

async function onMasterFile(file) {
  try {
    const buf = await readFile(file);
    const parsed = parseMaster(buf);
    state.pending = { ...parsed, fileName: file.name, file: buf };
    renderPending();
  } catch (e) {
    console.error(e);
    toast('Faylni o\'qib bo\'lmadi: ' + e.message, 'err');
  }
}

function renderPending() {
  const p = state.pending;
  const box = $('#db-pending');
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  const diff = diffMasters(state.db, p);
  let diffHtml = '';
  if (diff) {
    const nm = (r) => esc(r[p.nameIdx >= 0 ? p.nameIdx : 0]);
    diffHtml = `
      <div class="stats">
        <div class="ok"><b>+${diff.added.length}</b><span>yangi</span></div>
        <div class="warn"><b>${diff.changed.length}</b><span>o'zgargan</span></div>
        <div class="bad"><b>−${diff.removed.length}</b><span>o'chirilgan</span></div>
      </div>
      ${diff.changed.length ? `<details><summary>O'zgarishlar ro'yxati</summary><ul class="difflist">${diff.changed.slice(0, 100).map((c) =>
        `<li><b>${nm(c.row)}</b>${c.diffs.map((d) => `<div class="small">${esc(d.field)}: <s>${esc(d.from ?? '—')}</s> → ${esc(d.to ?? '—')}</div>`).join('')}</li>`).join('')}</ul></details>` : ''}
      ${diff.added.length ? `<details><summary>Yangi qo'shilganlar</summary><ul>${diff.added.slice(0, 100).map((r) => `<li>${nm(r)}</li>`).join('')}</ul></details>` : ''}
      ${diff.removed.length ? `<details><summary>O'chirilganlar</summary><ul>${diff.removed.slice(0, 100).map((r) => `<li>${esc(r[state.db.nameIdx >= 0 ? state.db.nameIdx : 0])}</li>`).join('')}</ul></details>` : ''}`;
  }
  box.innerHTML = `
    <h3>Tekshirish: ${esc(p.fileName)}</h3>
    <label>Varaq
      <select id="pending-sheet">${p.sheetNames.map((n) => `<option ${n === p.sheetName ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    </label>
    <p><b>${p.rows.length}</b> ta yozuv, <b>${p.fields.length}</b> ta ustun topildi (sarlavha ${p.headerRow + 1}-qatorda).</p>
    <details><summary>Ustunlar</summary><ol class="small">${p.fields.map((f) => `<li>${esc(f.label)}</li>`).join('')}</ol></details>
    ${diffHtml}
    <div class="row-btns">
      <button class="primary" id="pending-save">${state.db ? 'Bazani yangilash' : 'Bazaga saqlash'}</button>
      <button id="pending-cancel">Bekor qilish</button>
    </div>`;
  $('#pending-sheet').onchange = (e) => {
    const re = parseMaster(p.file, e.target.value);
    state.pending = { ...re, fileName: p.fileName, file: p.file };
    renderPending();
  };
  $('#pending-cancel').onclick = () => { state.pending = null; renderPending(); };
  $('#pending-save').onclick = async () => {
    const db = { ...state.pending, importedAt: Date.now() };
    delete db.sheetNames;
    await Store.set('db', db);
    state.db = db;
    state.pending = null;
    renderPending();
    renderDbStatus();
    renderBrowse();
    if (state.tpl) renderTemplate();
    toast('Baza saqlandi ✓', 'ok');
  };
}

// ---------------------------------------------------------------- KO'RISH paneli
function renderBrowse() {
  const list = $('#browse-list');
  const db = state.db;
  if (!db) { list.innerHTML = '<p class="muted">Baza bo\'sh.</p>'; return; }
  const q = Match.norm($('#browse-q').value);
  const qd = Match.digits($('#browse-q').value);
  let rows = db.rows;
  if (q) {
    rows = rows.filter((r) => r.some((v) => v != null && (Match.norm(v).includes(q) ||
      (qd.length >= 3 && Match.digits(v).includes(qd)))));
  }
  const nameIdx = db.nameIdx >= 0 ? db.nameIdx : 0;
  const show = rows.slice(0, 100);
  list.innerHTML = `<p class="muted small">${rows.length} ta natija${rows.length > show.length ? ` (birinchi ${show.length} tasi)` : ''}</p>` +
    show.map((r) => `
      <details class="card">
        <summary><b>${esc(r[nameIdx])}</b><span class="small muted">${esc(db.keyIdx !== nameIdx ? r[db.keyIdx] ?? '' : '')}</span></summary>
        <table class="kv">${db.fields.map((f, i) => r[i] == null ? '' : `<tr><th>${esc(f.label)}</th><td>${esc(r[i])}</td></tr>`).join('')}</table>
      </details>`).join('');
}

// ---------------------------------------------------------------- TO'LDIRISH paneli
function bestField(text) {
  const db = state.db;
  if (isNumHeader(text)) return { idx: '__num__', score: 1 };
  let best = { idx: '', score: 0 };
  db.fields.forEach((f, i) => {
    if (f.num) return;
    const s = Math.max(Match.similarity(text, f.name), Match.similarity(text, f.label));
    if (s > best.score + 1e-9) best = { idx: i, score: s };
  });
  return best.score >= Match.THRESHOLD ? best : { idx: '', score: best.score };
}

function headerText(sheet, r, c) {
  const own = mergedValue(sheet, r, c);
  const above = r > 0 ? mergedValue(sheet, r - 1, c) : null;
  return { own, above };
}

function columnMatch(sheet, r, c) {
  const { own, above } = headerText(sheet, r, c);
  if (own == null && above == null) return { idx: '', score: 0, text: '' };
  const cands = [own, above, [above, own].filter(Boolean).join(' ')].filter((t) => t != null && t !== '');
  let best = { idx: '', score: 0 };
  for (const t of cands) {
    const b = bestField(t);
    if (b.idx !== '' && b.score > best.score) best = b;
  }
  return { ...best, text: own != null ? String(own) : String(above) };
}

function detectTemplateHeader(sheet) {
  let bestR = 0, bestN = -1;
  for (let r = 0; r < Math.min(sheet.rows, 25); r++) {
    let n = 0;
    for (let c = 0; c < sheet.cols; c++) {
      const v = sheet.grid[r][c];
      if (v != null && typeof v === 'string' && bestField(v).idx !== '') n++;
    }
    if (n > bestN) { bestN = n; bestR = r; }
  }
  return bestR;
}

function detectStartRow(sheet, headerRow) {
  let r = headerRow + 1;
  while (r < sheet.rows) {
    const row = sheet.grid[r];
    const filled = row.filter((v) => v != null);
    if (filled.length && (filled.every(isX) || isNumberingRow(row))) { r++; continue; }
    // birlashtirilgan sarlavhaning davomi (ikkinchi qavat sarlavha)
    if (filled.length && filled.every((v) => typeof v === 'string') && r === headerRow + 1 &&
        filled.filter((v) => bestField(v).idx !== '').length >= 2) { r++; continue; }
    break;
  }
  return r;
}

async function onTemplateFile(file) {
  if (!state.db) { toast('Avval bazaga asosiy jadvalni yuklang', 'err'); return; }
  if (!/\.xlsx$|\.xlsm$/i.test(file.name)) { toast('Faqat .xlsx formatidagi fayl qo\'llab-quvvatlanadi', 'err'); return; }
  try {
    const buf = await readFile(file);
    const wb = readWorkbook(buf);
    state.tpl = { file: buf, fileName: file.name, wb, filters: [] };
    selectTemplateSheet(wb.names[0]);
  } catch (e) {
    console.error(e);
    toast('Faylni o\'qib bo\'lmadi: ' + e.message, 'err');
  }
}

function selectTemplateSheet(name) {
  const t = state.tpl;
  t.sheetName = name;
  t.sheet = t.wb.sheets[name];
  t.headerRow = detectTemplateHeader(t.sheet);
  setupTemplateColumns();
}

function setupTemplateColumns() {
  const t = state.tpl;
  const sheet = t.sheet;
  t.startRow = detectStartRow(sheet, t.headerRow);
  t.columns = [];
  for (let c = 0; c < sheet.cols; c++) {
    const m = columnMatch(sheet, t.headerRow, c);
    if (!m.text) continue;
    t.columns.push({ c, text: m.text, field: m.idx, auto: m.idx !== '' });
  }
  // Rejim: shablonda kalit ustun (JShShIR yoki F.I.Sh) to'ldirilgan bo'lsa — mavjud qatorlarni to'ldirish
  const keyCol = findTemplateKeyCol();
  t.mode = keyCol && countKeyValues(keyCol) > 0 ? 'lookup' : 'list';
  renderTemplate();
}

function findTemplateKeyCol() {
  const t = state.tpl, db = state.db;
  const prefer = [db.keyIdx, db.nameIdx].filter((i) => i >= 0);
  const cols = prefer.map((idx) => t.columns.find((x) => x.field === idx)).filter(Boolean);
  // Qiymatlari to'ldirilgan kalit ustun ustun turadi (masalan, JShShIR bo'sh, F.I.Sh bor)
  return cols.find((col) => t.sheet && countKeyValues(col) > 0) || cols[0] || null;
}

function countKeyValues(col) {
  const t = state.tpl;
  let n = 0;
  for (let r = t.startRow; r < t.sheet.rows; r++) if (t.sheet.grid[r][col.c] != null) n++;
  return n;
}

function filteredRows() {
  const db = state.db;
  return db.rows.filter((r) => state.tpl.filters.every((f) => f.field === '' || f.values.length === 0 ||
    f.values.includes(String(r[f.field] ?? ''))));
}

function buildLookupIndex(idx) {
  const db = state.db;
  const isJ = Match.canon(db.fields[idx].name).includes('jshshir');
  const key = (v) => (isJ ? Match.digits(v) : Match.nameKey(v));
  const exact = new Map(), short = new Map();
  for (const r of db.rows) {
    const k = key(r[idx]);
    if (!k) continue;
    if (!exact.has(k)) exact.set(k, r);
    if (!isJ) {
      const s = k.split(' ').slice(0, 2).join(' ');
      short.set(s, short.has(s) ? null : r); // null — bir nechta mos keladi
    }
  }
  return (v) => {
    const k = key(v);
    if (!k) return null;
    if (exact.has(k)) return exact.get(k);
    if (!isJ) return short.get(k.split(' ').slice(0, 2).join(' ')) || null;
    return null;
  };
}

function buildWrites() {
  const t = state.tpl, db = state.db;
  const writes = [], outRows = [], notFound = [];
  const cols = t.columns.filter((x) => x.field !== '');
  const valueOf = (col, row, i) => (col.field === '__num__' ? i + 1 : row[col.field]);

  if (t.mode === 'lookup') {
    const keyCol = findTemplateKeyCol();
    if (!keyCol) return { writes, outRows, notFound, error: 'Kalit ustun (JShShIR yoki F.I.Sh) moslashtirilmagan' };
    const find = buildLookupIndex(keyCol.field);
    let i = 0;
    for (let r = t.startRow; r < t.sheet.rows; r++) {
      const kv = t.sheet.grid[r][keyCol.c];
      if (kv == null) continue;
      const row = find(kv);
      if (!row) { notFound.push({ r, v: kv }); continue; }
      const out = {};
      for (const col of cols) {
        if (col === keyCol || col.field === '__num__') continue;
        writes.push({ r, c: col.c, value: row[col.field] });
        out[col.c] = row[col.field];
      }
      out[keyCol.c] = kv;
      outRows.push({ r, out });
      i++;
    }
  } else {
    filteredRows().forEach((row, i) => {
      const r = t.startRow + i;
      const out = {};
      for (const col of cols) {
        const v = valueOf(col, row, i);
        writes.push({ r, c: col.c, value: v });
        out[col.c] = v;
      }
      outRows.push({ r, out });
    });
  }
  return { writes, outRows, notFound };
}

function fieldOptions(selected) {
  const db = state.db;
  return `<option value="">— bo'sh qoldirish —</option>
    <option value="__num__" ${selected === '__num__' ? 'selected' : ''}>№ (tartib raqami 1, 2, 3…)</option>` +
    db.fields.map((f, i) => f.num ? '' : `<option value="${i}" ${selected === i ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
}

function renderFilters() {
  const t = state.tpl, db = state.db;
  const box = $('#tpl-filters');
  box.innerHTML = t.filters.map((f, fi) => {
    let valuesHtml = '';
    if (f.field !== '') {
      const counts = new Map();
      for (const r of db.rows) { const v = String(r[f.field] ?? ''); counts.set(v, (counts.get(v) || 0) + 1); }
      valuesHtml = `<div class="chips">${[...counts].sort((a, b) => a[0].localeCompare(b[0], 'uz', { numeric: true })).map(([v, n]) =>
        `<label class="chip"><input type="checkbox" data-fi="${fi}" value="${esc(v)}" ${f.values.includes(v) ? 'checked' : ''}> ${esc(v || '(bo\'sh)')} <span class="muted">${n}</span></label>`).join('')}</div>`;
    }
    return `<div class="filter">
      <div class="filter-head">
        <select data-fi="${fi}" class="filter-field">
          <option value="">Ustunni tanlang…</option>
          ${db.fields.map((x, i) => `<option value="${i}" ${f.field === i ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
        </select>
        <button class="icon" data-rm="${fi}" title="O'chirish">✕</button>
      </div>${valuesHtml}</div>`;
  }).join('');
  box.querySelectorAll('.filter-field').forEach((s) => (s.onchange = () => {
    const f = t.filters[+s.dataset.fi];
    f.field = s.value === '' ? '' : +s.value;
    f.values = [];
    renderFilters();
    renderPreview();
  }));
  box.querySelectorAll('input[type=checkbox]').forEach((cb) => (cb.onchange = () => {
    const f = t.filters[+cb.dataset.fi];
    f.values = cb.checked ? [...f.values, cb.value] : f.values.filter((v) => v !== cb.value);
    renderPreview();
  }));
  box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => {
    t.filters.splice(+b.dataset.rm, 1);
    renderFilters();
    renderPreview();
  }));
}

function renderTemplate() {
  const t = state.tpl;
  const box = $('#tpl-body');
  if (!t) { box.hidden = true; return; }
  box.hidden = false;
  const sheet = t.sheet;
  box.innerHTML = `
    <h3>${esc(t.fileName)}</h3>
    <div class="grid2">
      <label>Varaq
        <select id="tpl-sheet">${t.wb.names.map((n) => `<option ${n === t.sheetName ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      </label>
      <label>Sarlavha qatori
        <input type="number" id="tpl-header" min="1" max="${sheet.rows}" value="${t.headerRow + 1}">
      </label>
      <label>Ma'lumot yoziladigan birinchi qator
        <input type="number" id="tpl-start" min="1" value="${t.startRow + 1}">
      </label>
      <label>Rejim
        <select id="tpl-mode">
          <option value="list" ${t.mode === 'list' ? 'selected' : ''}>Ro'yxatni yozish (bazadan tanlab)</option>
          <option value="lookup" ${t.mode === 'lookup' ? 'selected' : ''}>Jadvaldagi odamlar ma'lumotini to'ldirish</option>
        </select>
      </label>
    </div>
    <p class="hint small">${t.mode === 'lookup'
      ? 'Jadvalda allaqachon bor F.I.Sh yoki JShShIR bo\'yicha bazadan topib, qolgan ustunlar to\'ldiriladi.'
      : 'Bazadagi (filtrlangan) yozuvlar birinchi qatordan boshlab ketma-ket yoziladi.'}</p>

    <h4>Ustunlarni moslashtirish</h4>
    <p class="muted small">Har bir ustunga bazadan qaysi ma'lumot qo'yilishini tekshiring. Avtomatik topilganlar ✓ bilan belgilangan.</p>
    <div class="maplist">
      ${t.columns.length ? t.columns.map((col, i) => `
        <div class="maprow ${col.field !== '' ? 'on' : ''}">
          <div class="mapsrc"><span class="col">${L(col.c)}</span> ${esc(col.text)} ${col.auto && col.field !== '' ? '<span class="ok">✓</span>' : ''}</div>
          <select data-ci="${i}">${fieldOptions(col.field)}</select>
        </div>`).join('') : '<p class="muted">Bu qatorda sarlavha topilmadi. Sarlavha qatorini o\'zgartiring.</p>'}
    </div>

    <div id="tpl-filter-wrap" ${t.mode === 'lookup' ? 'hidden' : ''}>
      <h4>Filtr (ixtiyoriy)</h4>
      <p class="muted small">Masalan: faqat 50-guruh yoki faqat "Дуал" ta'lim shakli.</p>
      <div id="tpl-filters"></div>
      <button id="tpl-add-filter">+ Filtr qo'shish</button>
    </div>
    <label class="check"><input type="checkbox" id="tpl-onlyempty" ${t.onlyEmpty !== false ? 'checked' : ''}> Faqat bo'sh kataklarni to'ldirish (bor ma'lumotni o'chirmaslik)</label>

    <h4>Natija</h4>
    <div id="tpl-preview"></div>
    <div class="row-btns">
      <button class="primary" id="tpl-go">To'ldirish va yuklab olish</button>
      <button id="tpl-share" hidden>Ulashish (Telegram…)</button>
    </div>`;

  $('#tpl-sheet').onchange = (e) => selectTemplateSheet(e.target.value);
  $('#tpl-header').onchange = (e) => { t.headerRow = Math.max(0, +e.target.value - 1); setupTemplateColumns(); };
  $('#tpl-start').onchange = (e) => { t.startRow = Math.max(0, +e.target.value - 1); renderPreview(); };
  $('#tpl-mode').onchange = (e) => { t.mode = e.target.value; renderTemplate(); };
  $('#tpl-onlyempty').onchange = (e) => { t.onlyEmpty = e.target.checked; };
  box.querySelectorAll('select[data-ci]').forEach((s) => (s.onchange = () => {
    const col = t.columns[+s.dataset.ci];
    col.field = s.value === '' || s.value === '__num__' ? s.value : +s.value;
    col.auto = false;
    s.closest('.maprow').classList.toggle('on', s.value !== '');
    renderPreview();
  }));
  $('#tpl-add-filter').onclick = () => { t.filters.push({ field: '', values: [] }); renderFilters(); };
  $('#tpl-go').onclick = generate;
  renderFilters();
  renderPreview();
}

function renderPreview() {
  const t = state.tpl;
  const res = buildWrites();
  const cols = t.columns.filter((x) => x.field !== '');
  const box = $('#tpl-preview');
  if (res.error) { box.innerHTML = `<p class="bad">${esc(res.error)}</p>`; return; }
  if (!cols.length) { box.innerHTML = '<p class="bad">Birorta ustun moslashtirilmagan.</p>'; return; }

  // Ro'yxat rejimida mavjud ma'lumot ustiga yozilishi haqida ogohlantirish
  let overlap = 0;
  if (t.mode === 'list') {
    for (const w of res.writes) {
      const ex = t.sheet.grid[w.r] && t.sheet.grid[w.r][w.c];
      if (ex != null && w.value != null) overlap++;
    }
  }
  const show = res.outRows.slice(0, 5);
  box.innerHTML = `
    <p><b>${res.outRows.length}</b> ta qator to'ldiriladi${t.mode === 'list' && res.outRows.length ? ` (${t.startRow + 1}–${t.startRow + res.outRows.length}-qatorlar)` : ''}.</p>
    ${res.notFound.length ? `<details class="bad"><summary>${res.notFound.length} ta odam bazadan topilmadi</summary><ul>${res.notFound.map((n) => `<li>${n.r + 1}-qator: ${esc(n.v)}</li>`).join('')}</ul></details>` : ''}
    ${overlap ? `<p class="warn small">Diqqat: ${overlap} ta katakda allaqachon ma'lumot bor${t.onlyEmpty !== false ? ' — ular o\'zgartirilmaydi' : ' — ular ustidan yoziladi'}.</p>` : ''}
    ${show.length ? `<div class="scroll"><table class="prev"><thead><tr><th>#</th>${cols.map((c) => `<th>${esc(c.text)}</th>`).join('')}</tr></thead>
      <tbody>${show.map((o) => `<tr><td>${o.r + 1}</td>${cols.map((c) => `<td>${esc(o.out[c.c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}`;
}

async function generate() {
  const t = state.tpl;
  const res = buildWrites();
  if (res.error || !res.writes.length) { toast(res.error || 'Yoziladigan ma\'lumot yo\'q', 'err'); return; }
  try {
    const out = await XlsxFill.fillWorkbook(t.file, t.sheetName, res.writes, {
      styleRow: t.startRow,
      onlyEmpty: t.onlyEmpty !== false,
    });
    const name = t.fileName.replace(/\.(xlsx|xlsm)$/i, '') + ' (to\'ldirilgan).xlsx';
    downloadBlob(out.blob, name);
    toast(`Tayyor: ${out.written} ta katak to'ldirildi${out.skipped ? `, ${out.skipped} tasi o'tkazib yuborildi` : ''} ✓`, 'ok');
    const file = new File([out.blob], name, { type: out.blob.type });
    const shareBtn = $('#tpl-share');
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      shareBtn.hidden = false;
      shareBtn.onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
    }
  } catch (e) {
    console.error(e);
    toast('Xatolik: ' + e.message, 'err');
  }
}

// ---------------------------------------------------------------- Ishga tushirish
async function init() {
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  let tab = 'p-db';
  try { tab = localStorage.getItem('tab') || tab; } catch (e) { /* ixtiyoriy */ }

  $('#master-file').onchange = (e) => { if (e.target.files[0]) onMasterFile(e.target.files[0]); e.target.value = ''; };
  $('#tpl-file').onchange = (e) => { if (e.target.files[0]) onTemplateFile(e.target.files[0]); e.target.value = ''; };
  $('#browse-q').oninput = renderBrowse;
  $('#db-download').onclick = () => {
    const db = state.db;
    downloadBlob(new Blob([db.file], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), db.fileName);
  };
  $('#db-clear').onclick = async () => {
    if (!confirm('Bazadagi barcha ma\'lumot shu qurilmadan o\'chirilsinmi?')) return;
    await Store.del('db');
    state.db = null;
    renderDbStatus();
    renderBrowse();
  };

  try {
    state.db = (await Store.get('db')) || null;
  } catch (e) {
    toast('Brauzer xotirasiga kirib bo\'lmadi', 'err');
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  renderDbStatus();
  renderBrowse();
  showTab(state.db ? tab : 'p-db');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
