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
  templates: [],   // saqlangan jadval shablonlari
  table: null,     // "Jadval" panelidagi joriy sozlama
  view: null,      // baza + qo'shimcha (virtual) ustunlar: shartnoma belgilari
  marks: { comp: {}, stu: {} }, // korxona va o'quvchi shartnomasi belgilari
  compUi: { q: '', show: 'all', open: new Set() },
  cloud: { session: null, token: '', sha: null, remember: true, dirty: false, remote: undefined },
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
    state.db = db;
    state.pending = null;
    await saveLocal();
    renderPending();
    onDbChanged();
    toast('Baza saqlandi ✓', 'ok');
    cloudPush();
  };
}

// ---------------------------------------------------------------- TO'LDIRISH paneli
function bestField(text) {
  const db = state.view;
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
  if (!state.view) { toast('Avval bazaga asosiy jadvalni yuklang', 'err'); return; }
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
  const t = state.tpl, db = state.view;
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
  return Filters.apply(state.view.rows, state.tpl.filters);
}

function buildLookupIndex(idx) {
  const db = state.view;
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
  const t = state.tpl, db = state.view;
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
  const db = state.view;
  return `<option value="">— bo'sh qoldirish —</option>
    <option value="__num__" ${selected === '__num__' ? 'selected' : ''}>№ (tartib raqami 1, 2, 3…)</option>` +
    db.fields.map((f, i) => f.num ? '' : `<option value="${i}" ${selected === i ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
}

function renderFilters() {
  Filters.render($('#tpl-filters'), state.view, state.tpl.filters, renderPreview);
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
      <p class="muted small">Masalan: faqat 50-guruh, faqat ishlaydiganlar yoki tug'ilgan sanasi oralig'i.</p>
      <div id="tpl-filters"></div>
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

// ---------------------------------------------------------------- Umumiy: saqlash va yangilash
async function saveLocal() {
  const c = state.cloud;
  if (c.session && !c.remember) {
    // "Eslab qolmaslik" rejimi: bu qurilmada hech narsa qoldirilmaydi
    await Store.del('db');
    await Store.del('templates');
    await Store.del('marks');
    return;
  }
  if (state.db) await Store.set('db', state.db); else await Store.del('db');
  await Store.set('templates', state.templates);
  await Store.set('marks', state.marks);
}

function onDbChanged() {
  computeView();
  renderDbStatus();
  renderCompanies();
  if (state.db && !state.table) state.table = defaultTable();
  renderTable();
  if (state.tpl && state.db) renderTemplate();
  renderCloud();
}

// ---------------------------------------------------------------- JADVAL paneli (ixtiyoriy jadval)
function findFieldIdx(...keys) {
  return state.view.fields.findIndex((f) => keys.some((k) => Match.canon(f.name).includes(k)));
}

function defaultTable() {
  const db = state.view;
  const cols = [db.nameIdx, findFieldIdx('gurux', 'guruh'), findFieldIdx('telefon')].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
  return { q: '', filters: [], cols: cols.length ? cols : db.fields.map((_, i) => i).slice(0, 5), num: true, sort: '', dir: 1, title: '', from: '', to: '' };
}

// Shablonlar ustun nomi bilan saqlanadi — asosiy jadvalda ustunlar tartibi o'zgarsa ham ishlaydi
function toPortable(t) {
  const lab = (i) => (i === '' || i == null ? '' : state.view.fields[i]?.label);
  return { ...t, q: '', cols: t.cols.map(lab), sort: lab(t.sort), filters: t.filters.map((f) => ({ ...f, field: lab(f.field) })) };
}
function fromPortable(t) {
  const idx = (l) => (l === '' || l == null ? '' : state.view.fields.findIndex((f) => f.label === l));
  return {
    ...defaultTable(), ...t, q: '',
    cols: t.cols.map(idx).filter((i) => i !== '' && i >= 0),
    sort: idx(t.sort) >= 0 ? idx(t.sort) : '',
    filters: t.filters.map((f) => ({ ...f, field: idx(f.field) })).filter((f) => f.field !== '' && f.field >= 0),
  };
}

function tableRows() {
  const t = state.table, db = state.view;
  let rows = Filters.apply(db.rows, t.filters);
  const q = Match.norm(t.q), qd = Match.digits(t.q);
  if (q) rows = rows.filter((r) => r.some((v) => v != null && (Match.norm(v).includes(q) || (qd.length >= 3 && Match.digits(v).includes(qd)))));
  if (t.sort !== '') {
    const k = t.sort;
    rows = [...rows].sort((a, b) => {
      const x = Filters.comparable(a[k]), y = Filters.comparable(b[k]);
      const c = x != null && y != null ? x - y : String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'uz', { numeric: true });
      return c * t.dir;
    });
  }
  const from = parseInt(t.from, 10), to = parseInt(t.to, 10);
  if (from > 0 || to > 0) rows = rows.slice(from > 0 ? from - 1 : 0, to > 0 ? to : undefined);
  return rows;
}

function renderTable() {
  const box = $('#tb-body');
  if (!state.view) { box.innerHTML = '<p class="muted">Baza bo\'sh. Avval "Baza" bo\'limida asosiy jadvalni yuklang.</p>'; return; }
  const t = state.table, db = state.view;
  const unused = db.fields.map((_, i) => i).filter((i) => !t.cols.includes(i) && !db.fields[i].num);
  box.innerHTML = `
    ${state.templates.length ? `<h4>Saqlangan jadvallar</h4><div class="presets">${state.templates.map((tp, i) =>
      `<span class="tpl-chip"><button class="chip-btn" data-load="${i}">📋 ${esc(tp.name)}</button><button class="icon" data-del="${i}" title="O'chirish">✕</button></span>`).join('')}</div>` : ''}
    <input type="search" id="tb-q" placeholder="Tez qidirish: ism, JShShIR, telefon…" value="${esc(t.q)}">
    <details class="sect" open><summary><h4>Filtr</h4></summary><div id="tb-filters"></div></details>
    <details class="sect"><summary><h4>Ustunlar <span class="muted small">(${t.cols.length} ta tanlangan)</span></h4></summary>
      <label class="check"><input type="checkbox" id="tb-num" ${t.num ? 'checked' : ''}> Boshida № (tartib raqami) ustuni</label>
      <div class="collist">${t.cols.map((c, k) => `
        <div class="colrow"><span class="grow">${k + 1}. ${esc(db.fields[c].label)}</span>
          <button class="icon" data-up="${k}" ${k ? '' : 'disabled'} title="Yuqoriga">↑</button>
          <button class="icon" data-down="${k}" ${k < t.cols.length - 1 ? '' : 'disabled'} title="Pastga">↓</button>
          <button class="icon" data-rmcol="${k}" title="Olib tashlash">✕</button></div>`).join('')}</div>
      ${unused.length ? `<select id="tb-addcol"><option value="">+ Ustun qo'shish…</option>${unused.map((i) => `<option value="${i}">${esc(db.fields[i].label)}</option>`).join('')}</select>` : ''}
      <div class="row-btns"><button id="tb-allcols">Hamma ustunlar</button><button id="tb-nocols">Tozalash</button></div>
    </details>
    <details class="sect"><summary><h4>Saralash, oraliq, sarlavha</h4></summary>
      <div class="grid2">
        <label>Saralash
          <select id="tb-sort"><option value="">Bazadagi tartibda</option>${db.fields.map((f, i) => f.num ? '' : `<option value="${i}" ${t.sort === i ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
        </label>
        <label>Yo'nalish
          <select id="tb-dir"><option value="1" ${t.dir === 1 ? 'selected' : ''}>O'sish (A→Я, 1→9)</option><option value="-1" ${t.dir === -1 ? 'selected' : ''}>Kamayish</option></select>
        </label>
        <label>Natijadan: qatordan
          <input type="number" id="tb-from" min="1" value="${esc(t.from)}" placeholder="1">
        </label>
        <label>qatorgacha
          <input type="number" id="tb-to" min="1" value="${esc(t.to)}" placeholder="oxirigacha">
        </label>
      </div>
      <label>Jadval sarlavhasi (ixtiyoriy)
        <input type="search" id="tb-title" value="${esc(t.title)}" placeholder="Masalan: 50-guruh ishlaydigan o'quvchilar ro'yxati">
      </label>
    </details>
    <div id="tb-result"></div>`;

  const upd = () => renderTableResult();
  Filters.render($('#tb-filters'), db, t.filters, upd);
  $('#tb-q').oninput = (e) => { t.q = e.target.value; upd(); };
  $('#tb-num').onchange = (e) => { t.num = e.target.checked; upd(); };
  $('#tb-sort').onchange = (e) => { t.sort = e.target.value === '' ? '' : +e.target.value; upd(); };
  $('#tb-dir').onchange = (e) => { t.dir = +e.target.value; upd(); };
  $('#tb-from').oninput = (e) => { t.from = e.target.value; upd(); };
  $('#tb-to').oninput = (e) => { t.to = e.target.value; upd(); };
  $('#tb-title').oninput = (e) => { t.title = e.target.value; };
  const keepOpen = () => {
    const open = [...box.querySelectorAll('details.sect')].map((d) => d.open);
    renderTable();
    box.querySelectorAll('details.sect').forEach((d, i) => (d.open = open[i]));
  };
  box.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { const k = +b.dataset.up; [t.cols[k - 1], t.cols[k]] = [t.cols[k], t.cols[k - 1]]; keepOpen(); }));
  box.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => { const k = +b.dataset.down; [t.cols[k + 1], t.cols[k]] = [t.cols[k], t.cols[k + 1]]; keepOpen(); }));
  box.querySelectorAll('[data-rmcol]').forEach((b) => (b.onclick = () => { t.cols.splice(+b.dataset.rmcol, 1); keepOpen(); }));
  const add = $('#tb-addcol');
  if (add) add.onchange = () => { if (add.value !== '') { t.cols.push(+add.value); keepOpen(); } };
  $('#tb-allcols').onclick = () => { t.cols = db.fields.map((_, i) => i).filter((i) => !db.fields[i].num); keepOpen(); };
  $('#tb-nocols').onclick = () => { t.cols = []; keepOpen(); };
  box.querySelectorAll('[data-load]').forEach((b) => (b.onclick = () => {
    state.table = fromPortable(state.templates[+b.dataset.load]);
    renderTable();
    toast('"' + state.templates[+b.dataset.load].name + '" ochildi');
  }));
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const tp = state.templates[+b.dataset.del];
    if (!confirm('"' + tp.name + '" shabloni o\'chirilsinmi?')) return;
    state.templates.splice(+b.dataset.del, 1);
    await saveLocal();
    renderTable();
    cloudPush();
  }));
  renderTableResult();
}

function renderTableResult() {
  const t = state.table, db = state.view;
  const rows = tableRows();
  const show = rows.slice(0, 50);
  const heads = (t.num ? ['№'] : []).concat(t.cols.map((c) => db.fields[c].name));
  $('#tb-result').innerHTML = `
    <h4>Natija: ${rows.length} ta</h4>
    ${resultBreakdown(rows)}
    ${t.cols.length ? `<div class="scroll"><table class="prev"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${show.map((r, i) => `<tr data-ri="${db.rows.indexOf(r)}">${t.num ? `<td>${i + 1}</td>` : ''}${t.cols.map((c) => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${rows.length > show.length ? `<p class="muted small">Ko'rinishda birinchi ${show.length} tasi. Excel faylda hammasi (${rows.length} ta) bo'ladi.</p>` : ''}
      <p class="muted small">Qatorni bossangiz, o'sha odamning barcha ma'lumoti ochiladi.</p>`
    : '<p class="bad">Kamida bitta ustun tanlang.</p>'}
    <div class="row-btns">
      <button class="primary" id="tb-dl" ${t.cols.length && rows.length ? '' : 'disabled'}>Excel yuklab olish</button>
      <button id="tb-save">Shablon sifatida saqlash</button>
      <button id="tb-share" hidden>Ulashish (Telegram…)</button>
    </div>`;
  $('#tb-result').querySelectorAll('tbody tr[data-ri]').forEach((tr) => (tr.onclick = () => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); return; }
    const r = db.rows[+tr.dataset.ri];
    const d = document.createElement('tr');
    d.className = 'detail';
    d.innerHTML = `<td colspan="${heads.length}"><table class="kv">${db.fields.map((f, i) => r[i] == null ? '' : `<tr><th>${esc(f.label)}</th><td>${esc(r[i])}</td></tr>`).join('')}</table></td>`;
    tr.after(d);
  }));
  $('#tb-dl').onclick = downloadTable;
  $('#tb-save').onclick = async () => {
    const name = prompt('Shablon nomi (masalan: "50-guruh ishlaydiganlar"):', t.title || '');
    if (!name) return;
    const tp = { ...toPortable(t), name };
    const ex = state.templates.findIndex((x) => x.name === name);
    if (ex >= 0) state.templates[ex] = tp; else state.templates.push(tp);
    await saveLocal();
    renderTable();
    toast('Shablon saqlandi ✓', 'ok');
    cloudPush();
  };
}

async function downloadTable() {
  const t = state.table, db = state.view;
  const rows = tableRows();
  const headers = (t.num ? ['№'] : []).concat(t.cols.map((c) => db.fields[c].name));
  const data = rows.map((r, i) => (t.num ? [i + 1] : []).concat(t.cols.map((c) => r[c] ?? null)));
  const blob = await XlsxWrite.buildWorkbook({ title: t.title.trim(), sheetName: t.title.trim() || 'Jadval', headers, rows: data });
  const name = (t.title.trim() || 'Jadval').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.xlsx';
  downloadBlob(blob, name);
  toast(`Tayyor: ${rows.length} ta qator ✓`, 'ok');
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    const b = $('#tb-share');
    b.hidden = false;
    b.onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
  }
}

function resultBreakdown(rows) {
  const t = state.table, db = state.view;
  const fields = [...new Set(t.filters.filter(Filters.isActive).map((f) => f.field))];
  if (!fields.length) return '';
  return `<div class="breakdown">${fields.map((fi) => {
    const counts = new Map();
    for (const r of rows) { const v = String(r[fi] ?? '') || "(bo'sh)"; counts.set(v, (counts.get(v) || 0) + 1); }
    const list = [...counts].sort((a, b) => a[0].localeCompare(b[0], 'uz', { numeric: true }));
    return `<div><span class="bd-name">${esc(db.fields[fi].name)}:</span> ${list.slice(0, 12).map(([v, n]) =>
      `<span class="bd-item">${esc(v.length > 30 ? v.slice(0, 30) + '…' : v)} <b>${n}</b></span>`).join('')}${list.length > 12 ? ` <span class="muted">+${list.length - 12}</span>` : ''}</div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- SHARTNOMA belgilari va virtual ustunlar
const companyKey = (name) => Match.norm(name).replace(/\s+/g, '');

function dbFieldIdx(...keys) {
  if (!state.db) return -1;
  return state.db.fields.findIndex((f) => keys.some((k) => Match.canon(f.name).includes(k)));
}

function studentKey(row) { return rowKey(state.db, row); }

function companyContract(name) {
  const m = state.marks.comp[companyKey(name)];
  return !!(m && m.c);
}

function studentContract(row) {
  const k = studentKey(row);
  if (k in state.marks.stu) return { on: !!state.marks.stu[k], src: 'mark' };
  const xi = dbFieldIdx('ikkitamonlama', 'shartnoma');
  return { on: xi >= 0 && row[xi] != null && String(row[xi]).trim() !== '', src: 'excel' };
}

function computeView() {
  const db = state.db;
  if (!db) { state.view = null; return; }
  const ci = dbFieldIdx('korxonanomi', 'korxona');
  const fields = db.fields.concat([
    { col: -1, name: 'Korxona shartnomasi', label: 'Korxona shartnomasi (+/−)', virtual: true },
    { col: -1, name: "O'quvchi shartnomasi", label: "O'quvchi shartnomasi (+/−)", virtual: true },
  ]);
  const rows = db.rows.map((r) => r.concat([
    ci >= 0 && r[ci] != null ? (companyContract(r[ci]) ? '+' : '−') : null,
    studentContract(r).on ? '+' : '−',
  ]));
  state.view = { ...db, fields, rows };
}

let marksTimer = null;
async function marksChanged() {
  await saveLocal();
  computeView();
  renderCompanies();
  if (state.table) renderTable(); // filtrdagi "+/−" qiymatlar ham yangilansin
  if (state.tpl) renderTemplate();
  clearTimeout(marksTimer);
  marksTimer = setTimeout(() => cloudPush(), 2000);
}

// ---------------------------------------------------------------- KORXONALAR paneli
function companyGroups() {
  const db = state.db;
  const ci = dbFieldIdx('korxonanomi', 'korxona');
  if (ci < 0) return null;
  const gi = dbFieldIdx('gurux', 'guruh');
  const ri = dbFieldIdx('masulhodim');
  const ui = dbFieldIdx('ustasi');
  const phoneAfter = (i) => (i >= 0 && db.fields[i + 1] && Match.canon(db.fields[i + 1].name).includes('telefon') ? i + 1 : -1);
  const map = new Map();
  for (const r of db.rows) {
    const name = r[ci];
    if (name == null || String(name).trim() === '') continue;
    const k = companyKey(name);
    if (!k) continue;
    if (!map.has(k)) map.set(k, { key: k, names: new Map(), rows: [], people: new Map(), masters: new Map() });
    const c = map.get(k);
    c.names.set(name, (c.names.get(name) || 0) + 1);
    c.rows.push(r);
    const add = (m, i) => { if (i >= 0 && r[i]) { const tel = phoneAfter(i) >= 0 ? r[phoneAfter(i)] : ''; m.set(r[i] + (tel ? ' · ' + tel : ''), 1); } };
    add(c.people, ri);
    add(c.masters, ui);
  }
  const list = [...map.values()].map((c) => {
    const name = [...c.names].sort((a, b) => b[1] - a[1])[0][0];
    const groups = new Map();
    for (const r of c.rows) { const gname = gi >= 0 ? String(r[gi] ?? '—') : '—'; groups.set(gname, (groups.get(gname) || 0) + 1); }
    const withContract = c.rows.filter((r) => studentContract(r).on).length;
    return { ...c, name, groups: [...groups].sort((a, b) => a[0].localeCompare(b[0], 'uz', { numeric: true })), contract: companyContract(name), withContract };
  });
  list.sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name, 'uz'));
  return { list, gi };
}

function renderCompanies() {
  const box = $('#comp-body');
  if (!box) return;
  if (!state.db) { box.innerHTML = '<p class="muted">Baza bo\'sh. Avval "Baza" bo\'limida asosiy jadvalni yuklang.</p>'; return; }
  const data = companyGroups();
  if (!data) { box.innerHTML = '<p class="muted">Bazada korxona nomi ustuni topilmadi.</p>'; return; }
  const ui = state.compUi, db = state.db;
  const nameIdx = db.nameIdx >= 0 ? db.nameIdx : 0;
  const ti = dbFieldIdx('telefon');
  const all = data.list;
  let list = all;
  const q = Match.norm(ui.q);
  if (q) list = list.filter((c) => Match.norm(c.name).includes(q) || c.rows.some((r) => Match.norm(r[nameIdx]).includes(q)));
  if (ui.show === 'yes') list = list.filter((c) => c.contract);
  if (ui.show === 'no') list = list.filter((c) => !c.contract);
  const students = all.reduce((n, c) => n + c.rows.length, 0);
  const stuWith = all.reduce((n, c) => n + c.withContract, 0);
  const compWith = all.filter((c) => c.contract).length;

  box.innerHTML = `
    <div class="stats">
      <div><b>${all.length}</b><span>korxona</span></div>
      <div class="ok"><b>${compWith}</b><span>korxona shartnomasi bor</span></div>
      <div class="${stuWith < students ? 'warn' : 'ok'}"><b>${stuWith}/${students}</b><span>o'quvchi shartnomasi</span></div>
    </div>
    <input type="search" id="comp-q" placeholder="Korxona yoki o'quvchi nomi…" value="${esc(ui.q)}">
    <div class="seg wide" id="comp-show">
      <button data-show="all" class="${ui.show === 'all' ? 'on' : ''}">Hammasi (${all.length})</button>
      <button data-show="yes" class="${ui.show === 'yes' ? 'on' : ''}">Shartnoma bor (${compWith})</button>
      <button data-show="no" class="${ui.show === 'no' ? 'on' : ''}">Shartnoma yo'q (${all.length - compWith})</button>
    </div>
    <div class="comp-list">${list.map((c) => `
      <details class="comp ${c.contract ? 'has' : ''}" data-key="${esc(c.key)}" ${ui.open.has(c.key) ? 'open' : ''}>
        <summary>
          <div class="comp-top">
            <div class="comp-name">${esc(c.name)}</div>
            <button class="ct ${c.contract ? 'on' : ''}" data-ckey="${esc(c.key)}" data-cname="${esc(c.name)}" title="Korxona bilan shartnoma">${c.contract ? '＋ Shartnoma bor' : "− Shartnoma yo'q"}</button>
          </div>
          <div class="comp-sub">
            <span>👥 ${c.rows.length} o'quvchi</span>
            <span class="${c.withContract === c.rows.length ? 'ok' : 'warn'}">📄 o'quvchi shartnomasi ${c.withContract}/${c.rows.length}</span>
          </div>
          <div class="gchips">${c.groups.map(([gname, n]) => `<span class="gchip">${esc(gname)}-guruh <b>${n}</b></span>`).join('')}</div>
        </summary>
        <div class="comp-body">
          ${c.people.size ? `<p class="small"><span class="muted">Korxonadan mas'ul:</span> ${[...c.people.keys()].map(esc).join('; ')}</p>` : ''}
          ${c.masters.size ? `<p class="small"><span class="muted">Usta:</span> ${[...c.masters.keys()].map(esc).join('; ')}</p>` : ''}
          <div class="scroll"><table class="prev stu">
            <thead><tr><th>№</th><th>F.I.Sh</th><th>Shartnoma</th><th>Guruh</th><th>Telefon</th></tr></thead>
            <tbody>${c.rows.map((r, i) => { const sc = studentContract(r); return `<tr>
              <td>${i + 1}</td><td class="wrap">${esc(r[nameIdx])}</td>
              <td><button class="ct sm ${sc.on ? 'on' : ''}" data-skey="${esc(studentKey(r))}" data-on="${sc.on ? 1 : 0}" title="${sc.src === 'excel' ? 'Excel jadvalidagi shartnoma ustunidan' : 'Qo\'lda belgilangan'}">${sc.on ? '＋ bor' : "− yo'q"}</button></td>
              <td>${esc(data.gi >= 0 ? r[data.gi] ?? '' : '')}</td><td>${esc(ti >= 0 ? r[ti] ?? '' : '')}</td>
            </tr>`; }).join('')}</tbody>
          </table></div>
          <div class="row-btns">
            <button data-allstu="${esc(c.key)}" data-v="1">Hammasiga ＋</button>
            <button data-allstu="${esc(c.key)}" data-v="0">Hammasiga −</button>
            <button data-xlcomp="${esc(c.key)}">O'quvchilar ro'yxati (Excel)</button>
          </div>
        </div>
      </details>`).join('') || '<p class="muted">Hech narsa topilmadi.</p>'}</div>
    <div class="row-btns"><button class="primary" id="comp-xl">Korxonalar ro'yxatini Excel'ga</button></div>`;

  $('#comp-q').oninput = (e) => {
    ui.q = e.target.value;
    const pos = e.target.selectionStart;
    renderCompanies();
    const inp = $('#comp-q'); inp.focus(); inp.setSelectionRange(pos, pos);
  };
  box.querySelectorAll('[data-show]').forEach((b) => (b.onclick = () => { ui.show = b.dataset.show; renderCompanies(); }));
  box.querySelectorAll('details.comp').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) ui.open.add(d.dataset.key); else ui.open.delete(d.dataset.key);
  }));
  box.querySelectorAll('[data-ckey]').forEach((b) => (b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.ckey;
    const cur = state.marks.comp[k] || {};
    state.marks.comp[k] = { ...cur, c: !cur.c, name: b.dataset.cname, at: Date.now() };
    marksChanged();
  }));
  box.querySelectorAll('[data-skey]').forEach((b) => (b.onclick = () => {
    state.marks.stu[b.dataset.skey] = b.dataset.on !== '1';
    marksChanged();
  }));
  const byKey = (k) => all.find((c) => c.key === k);
  box.querySelectorAll('[data-allstu]').forEach((b) => (b.onclick = () => {
    for (const r of byKey(b.dataset.allstu).rows) state.marks.stu[studentKey(r)] = b.dataset.v === '1';
    marksChanged();
  }));
  box.querySelectorAll('[data-xlcomp]').forEach((b) => (b.onclick = async () => {
    const c = byKey(b.dataset.xlcomp);
    const rows = c.rows.map((r, i) => [i + 1, r[nameIdx], data.gi >= 0 ? r[data.gi] : null, ti >= 0 ? r[ti] : null, studentContract(r).on ? '+' : '−']);
    const blob = await XlsxWrite.buildWorkbook({ title: c.name + ' — o\'quvchilar', sheetName: 'O\'quvchilar', headers: ['№', 'F.I.Sh', 'Guruh', 'Telefon', "O'quvchi shartnomasi"], rows });
    downloadBlob(blob, c.name.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60) + '.xlsx');
  }));
  $('#comp-xl').onclick = async () => {
    const rows = list.map((c, i) => [i + 1, c.name, c.rows.length, c.groups.map(([gname, n]) => `${gname} (${n})`).join(', '),
      c.contract ? '+' : '−', `${c.withContract}/${c.rows.length}`, [...c.people.keys()].join('; ')]);
    const blob = await XlsxWrite.buildWorkbook({ title: 'Korxonalar ro\'yxati', sheetName: 'Korxonalar',
      headers: ['№', 'Korxona nomi', "O'quvchilar soni", 'Guruhlar', 'Korxona shartnomasi', "O'quvchi shartnomalari", "Korxonadan mas'ul"], rows });
    downloadBlob(blob, 'Korxonalar.xlsx');
  };
}

// ---------------------------------------------------------------- BULUT (kod bilan)
function cloudPayload() {
  return { v: 1, savedAt: Date.now(), token: state.cloud.token, templates: state.templates, marks: state.marks, db: { ...state.db, file: Sync.toB64(state.db.file) } };
}

async function applyPayload(p) {
  const file = Sync.fromB64(p.db.file);
  state.db = { ...p.db, file: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) };
  state.templates = p.templates || [];
  state.marks = p.marks || { comp: {}, stu: {} };
  state.cloud.token = p.token || state.cloud.token;
  state.table = null;
  await saveLocal();
}

async function saveCloudState() {
  const c = state.cloud;
  if (!c.session || !c.remember) { await Store.del('cloud'); return; }
  await Store.set('cloud', { key: c.session.key, salt: c.session.salt, iter: c.session.iter, token: c.token, sha: c.sha, dirty: c.dirty, at: c.at });
}

let pushing = null;
async function cloudPush() {
  const c = state.cloud;
  if (!c.session || !state.db) return;
  if (pushing) { c.again = true; return; }
  c.again = false;
  pushing = (async () => {
    try {
      c.status = 'Yuborilmoqda…';
      renderCloud();
      const text = await Sync.seal(c.session, cloudPayload());
      c.sha = await Sync.putRemote(c.token, text, c.sha);
      c.dirty = false;
      c.at = Date.now();
      c.status = '';
      toast('Bulutga saqlandi ☁️ ✓', 'ok');
    } catch (e) {
      c.dirty = true;
      c.status = 'Yuborilmadi: ' + e.message;
      toast('Bulutga yuborilmadi: ' + e.message, 'err');
    }
    await saveCloudState();
    renderCloud();
  })();
  await pushing;
  pushing = null;
  if (c.again) cloudPush(); // yuborish paytida yana o'zgarish bo'lgan
}

async function cloudPull(manual) {
  const c = state.cloud;
  if (!c.session) return;
  try {
    const remote = await Sync.fetchRemote(c.token);
    if (!remote) { if (manual) toast('Bulutda baza topilmadi', 'err'); return; }
    if (remote.sha === c.sha && state.db) { if (manual) toast('Baza allaqachon eng yangi ✓', 'ok'); return; }
    let opened;
    try {
      opened = await Sync.open(remote.text, null, c.session.key);
    } catch (e) {
      // Kod boshqa qurilmada o'zgartirilgan — qaytadan kod so'raladi
      c.session = null;
      await saveCloudState();
      renderCloud();
      toast('Bulutdagi baza kodi o\'zgargan. Yangi kodni kiriting.', 'err');
      return;
    }
    await applyPayload(opened.payload);
    c.sha = remote.sha;
    c.at = Date.now();
    await saveCloudState();
    onDbChanged();
    toast('Baza bulutdan yangilandi ☁️ ✓', 'ok');
  } catch (e) {
    if (manual) toast(e.message, 'err');
  }
}

async function cloudOpen(code, remember) {
  const c = state.cloud;
  const remote = await Sync.fetchRemote('');
  if (!remote) throw new Error('Bulutda baza hali yo\'q');
  const { payload, session } = await Sync.open(remote.text, code);
  c.session = session;
  c.remember = remember;
  c.sha = remote.sha;
  c.at = Date.now();
  c.dirty = false;
  await applyPayload(payload);
  await saveCloudState();
  onDbChanged();
  toast('Baza ochildi ✓', 'ok');
}

async function cloudSetup(code, token, remember) {
  const c = state.cloud;
  c.session = await Sync.newSession(code);
  c.token = token.trim();
  c.remember = remember;
  try {
    c.sha = await Sync.remoteSha(c.token);
  } catch (e) {
    c.session = null;
    throw e;
  }
  await saveLocal();
  await cloudPush();
  if (c.dirty) { c.session = null; await saveCloudState(); renderCloud(); throw new Error(c.status || 'Yuborilmadi'); }
}

function renderCloud() {
  const box = $('#cloud-box');
  const c = state.cloud;
  if (c.session) {
    box.innerHTML = `
      <h2>☁️ Bulutli baza <span class="badge ok">ulangan</span></h2>
      <p class="muted small">Baza shifrlangan holda saqlanadi. Boshqa kompyuter yoki telefonda shu sahifani ochib, kodni kiritsangiz bo'ldi.
      ${c.at ? `<br>Oxirgi sinxronlash: ${new Date(c.at).toLocaleString('uz')}` : ''}
      ${c.remember ? '' : '<br><b>Bu qurilmada eslab qolinmaydi</b> — sahifa yopilganda ma\'lumot o\'chadi.'}</p>
      ${c.status ? `<p class="${c.dirty ? 'bad' : 'muted'} small">${esc(c.status)}</p>` : ''}
      <div class="row-btns">
        <button id="cl-pull">Bulutdan yangilash</button>
        <button id="cl-push" class="${c.dirty ? 'primary' : ''}">Bulutga yuborish</button>
      </div>
      <details><summary class="small">Boshqa amallar</summary>
        <div class="row-btns">
          <button id="cl-recode">Kodni o'zgartirish</button>
          <button id="cl-logout" class="danger">Bu qurilmadan chiqish</button>
        </div>
      </details>`;
    $('#cl-pull').onclick = () => cloudPull(true);
    $('#cl-push').onclick = () => cloudPush();
    $('#cl-recode').onclick = async () => {
      const a = prompt('Yangi kod (kamida 8 belgi):');
      if (!a) return;
      if (a.length < 8) { toast('Kod kamida 8 belgidan iborat bo\'lsin', 'err'); return; }
      if (prompt('Yangi kodni qaytadan kiriting:') !== a) { toast('Kodlar mos kelmadi', 'err'); return; }
      c.session = await Sync.newSession(a);
      await cloudPush();
      await saveCloudState();
      toast('Kod o\'zgartirildi. Boshqa qurilmalarda yangi kodni kiriting.', 'ok');
    };
    $('#cl-logout').onclick = async () => {
      if (!confirm('Bu qurilmadan baza va kod o\'chirilsinmi? (Bulutdagi baza saqlanib qoladi)')) return;
      state.cloud = { session: null, token: '', sha: null, remember: true, dirty: false, remote: true };
      state.db = null; state.templates = []; state.table = null; state.marks = { comp: {}, stu: {} };
      await Store.del('cloud'); await Store.del('db'); await Store.del('templates'); await Store.del('marks');
      onDbChanged();
    };
    return;
  }

  if (c.remote === undefined) {
    box.innerHTML = '<h2>☁️ Bulutli baza</h2><p class="muted small">Tekshirilmoqda…</p>';
    return;
  }
  const openForm = `
    <form id="cl-open" class="stack">
      <label>Kirish kodi<input type="password" id="cl-code" autocomplete="current-password" required></label>
      <label class="check"><input type="checkbox" id="cl-remember" checked> Shu qurilmada eslab qolish (begona kompyuterda belgini olib tashlang)</label>
      <button class="primary" type="submit">Bazani ochish</button>
    </form>`;
  const setupForm = `
    <form id="cl-setup" class="stack">
      ${state.db ? '' : '<p class="bad small">Avval yuqorida asosiy jadvalni yuklang.</p>'}
      <label>Yangi kirish kodi (kamida 8 belgi, harf va raqam aralash)<input type="password" id="cs-code" autocomplete="new-password" minlength="8" required></label>
      <label>Kodni takrorlang<input type="password" id="cs-code2" autocomplete="new-password" minlength="8" required></label>
      <label>GitHub token <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">(yaratish)</a><input type="password" id="cs-token" autocomplete="off" required placeholder="github_pat_…"></label>
      <details class="small"><summary>Token qanday yaratiladi?</summary>
        <ol>
          <li>"yaratish" havolasini oching (GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token).</li>
          <li><b>Token name</b>: istalgan nom, masalan "Jadval Baza". <b>Expiration</b>: 1 yil.</li>
          <li><b>Repository access</b>: "Only select repositories" → <b>${esc(Sync.CONFIG.repo)}</b>.</li>
          <li><b>Permissions → Repository permissions → Contents</b>: "Read and write".</li>
          <li><b>Generate token</b> ni bosing va chiqqan tokenni shu yerga qo'ying.</li>
        </ol>
        Token faqat bir marta kiritiladi: u ham baza bilan birga shifrlanib saqlanadi, boshqa qurilmalarda faqat kod kerak bo'ladi.</details>
      <label class="check"><input type="checkbox" id="cs-remember" checked> Shu qurilmada eslab qolish</label>
      <button class="primary" type="submit" ${state.db ? '' : 'disabled'}>Bulutni sozlash va bazani yuborish</button>
    </form>`;
  box.innerHTML = `
    <h2>☁️ Bulutli baza</h2>
    ${c.remote
      ? `<p class="muted small">Bulutda shifrlangan baza bor. Ochish uchun kodni kiriting.</p>${openForm}
         <details class="small"><summary>Kodni unutdim / qaytadan sozlash</summary>
           <p class="muted">Yangi kod bilan sozlansa, bulutdagi eski baza shu qurilmadagi baza bilan almashtiriladi.</p>${setupForm}</details>`
      : `<p class="muted small">Bazani boshqa kompyuter va telefonda ham ochish uchun bir marta sozlang. Ma'lumot shu qurilmada shifrlanadi va GitHub'ga faqat shifrlangan holda yoziladi — kodsiz uni hech kim o'qiy olmaydi.</p>${setupForm}`}`;

  const of = $('#cl-open');
  if (of) of.onsubmit = async (e) => {
    e.preventDefault();
    const btn = of.querySelector('button');
    btn.disabled = true; btn.textContent = 'Ochilmoqda…';
    try { await cloudOpen($('#cl-code').value, $('#cl-remember').checked); } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Bazani ochish'; }
  };
  const sf = $('#cl-setup');
  if (sf) sf.onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#cs-code').value;
    if (code !== $('#cs-code2').value) { toast('Kodlar mos kelmadi', 'err'); return; }
    if (code.length < 8) { toast('Kod kamida 8 belgidan iborat bo\'lsin', 'err'); return; }
    if (c.remote && !confirm('Bulutdagi baza shu qurilmadagi baza bilan almashtirilsinmi?')) return;
    const btn = sf.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Yuborilmoqda…';
    try {
      await cloudSetup(code, $('#cs-token').value, $('#cs-remember').checked);
      renderCloud();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false; btn.textContent = 'Bulutni sozlash va bazani yuborish';
    }
  };
}

// ---------------------------------------------------------------- Ishga tushirish
async function init() {
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  let tab = 'p-db';
  try { tab = localStorage.getItem('tab') || tab; } catch (e) { /* ixtiyoriy */ }
  if (!$('#' + tab)) tab = 'p-db';

  $('#master-file').onchange = (e) => { if (e.target.files[0]) onMasterFile(e.target.files[0]); e.target.value = ''; };
  $('#tpl-file').onchange = (e) => { if (e.target.files[0]) onTemplateFile(e.target.files[0]); e.target.value = ''; };
  $('#db-download').onclick = () => {
    const db = state.db;
    downloadBlob(new Blob([db.file], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), db.fileName);
  };
  $('#db-clear').onclick = async () => {
    if (!confirm('Bazadagi barcha ma\'lumot shu qurilmadan o\'chirilsinmi?' + (state.cloud.session ? ' (Bulutdagi nusxa saqlanib qoladi)' : ''))) return;
    await Store.del('db');
    state.db = null;
    state.table = null;
    onDbChanged();
  };

  try {
    state.db = (await Store.get('db')) || null;
    state.templates = (await Store.get('templates')) || [];
    state.marks = (await Store.get('marks')) || { comp: {}, stu: {} };
    const saved = await Store.get('cloud');
    if (saved && saved.key) {
      Object.assign(state.cloud, { session: { key: saved.key, salt: saved.salt, iter: saved.iter }, token: saved.token, sha: saved.sha, dirty: !!saved.dirty, at: saved.at, remember: true });
    }
  } catch (e) {
    toast('Brauzer xotirasiga kirib bo\'lmadi', 'err');
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  onDbChanged();
  showTab(state.db ? tab : 'p-db');

  const hadController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
    // Yangi versiya o'rnatilganda sahifani bir marta avtomatik yangilash
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      location.reload();
    });
  }

  // Bulut: ulangan bo'lsa — yangilanishni tekshirish; bo'lmasa — bulutda baza bormi
  if (state.cloud.session) {
    if (state.cloud.dirty) cloudPush(); else cloudPull(false);
  } else {
    Sync.remoteSha('').then((sha) => { state.cloud.remote = !!sha; }).catch(() => { state.cloud.remote = false; }).then(renderCloud);
  }
}

init();
