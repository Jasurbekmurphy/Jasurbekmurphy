/* global Spell, Filters, state, Match, esc, toast, $, saveLocal, onDbChanged, cloudPush, rowKey, companyKey, computeView, renderHeader */
'use strict';
// Bazani ilovaning o'zida tahrirlash, tekshiruv (JShShIR), korxona nomlarini tartiblash,
// va yangi jadvalni bazaga birlashtirish (merge).

// ---------------------------------------------------------------- JShShIR tekshiruvi
function jIndex(db) {
  return db.fields.findIndex((f) => Match.canon(f.name).includes('jshshir'));
}

function jshshirIssues(db) {
  const ji = jIndex(db);
  const bad = [], dups = [];
  if (ji < 0) return { ji, bad, dups };
  const seen = new Map();
  db.rows.forEach((r, i) => {
    const raw = r[ji];
    const d = Match.digits(raw);
    if (raw == null || String(raw).trim() === '' || d.length !== 14 || String(raw).replace(/\s+/g, '') !== d) bad.push(i);
    if (d) { if (!seen.has(d)) seen.set(d, []); seen.get(d).push(i); }
  });
  for (const [d, idxs] of seen) if (idxs.length > 1) dups.push({ j: d, rows: idxs });
  return { ji, bad, dups };
}

// ---------------------------------------------------------------- Korxona nomi shabloni
// Faqat MChJ va YaTT: "NOMI" MCHJ ko'rinishiga keltiriladi. Qolganlariga tegilmaydi.
const COMPANY_TYPES = [
  { re: /(^|[^\p{L}])(мчж|м\.\s?ч\.\s?ж\.?|ооо|mchj|m\.?\s?ch\.?\s?j\.?|ooo)(?=$|[^\p{L}])/iu, cyr: 'МЧЖ', lat: 'MCHJ' },
  { re: /(^|[^\p{L}])(ятт|я\.\s?т\.\s?т\.?|yatt|ya\.?\s?t\.?\s?t\.?)(?=$|[^\p{L}])/iu, cyr: 'ЯТТ', lat: 'YATT' },
];

function normalizeCompany(name) {
  if (name == null) return name;
  const s = String(name);
  for (const t of COMPANY_TYPES) {
    if (!t.re.test(s)) continue;
    let core = s.replace(t.re, '$1')
      .replace(/["«»“”„‟]/g, ' ')
      .replace(/(^|\s)['‘’`]+|['‘’`]+(?=\s|$)/g, '$1')
      .replace(/\s+/g, ' ').trim();
    if (!core) return s;
    const type = /[Ѐ-ӿ]/.test(core) ? t.cyr : t.lat;
    return `"${core}" ${type}`;
  }
  return s;
}

function companyFieldIdx(db) {
  return db.fields.findIndex((f) => Match.canon(f.name).includes('korxonanomi'));
}

function companySuggestions(db) {
  const ci = companyFieldIdx(db);
  if (ci < 0) return [];
  const map = new Map();
  for (const r of db.rows) {
    const v = r[ci];
    if (v == null) continue;
    const n = normalizeCompany(v);
    if (n !== v) {
      const k = v + '\u0000' + n;
      map.set(k, { from: v, to: n, count: (map.get(k)?.count || 0) + 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------- Bazani o'zgartirish
async function dbChanged(msg) {
  state.db.editedAt = Date.now();
  await saveLocal();
  onDbChanged();
  renderEdit();
  if (msg) toast(msg, 'ok');
  cloudPush();
}

function parseInputValue(raw, old) {
  const s = raw.trim();
  if (s === '') return null;
  if (typeof old === 'number' && /^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return s;
}

// ---------------------------------------------------------------- Birlashtirish (merge)
// Yangi fayldagi ustunlarni bazadagi ustunlarga moslash (nom bo'yicha, kirill/lotin farqisiz)
// Kalit ustunlar (F.I.Sh, JShShIR) har qanday yozilishda ham bir-biriga mos keladi
const KEY_CANONS = ['jshshir', 'fish'];
function fieldScore(of, nf) {
  if (of.label === nf.label) return 1.01;
  const a = Match.canon(of.name), b = Match.canon(nf.name);
  for (const k of KEY_CANONS) {
    const ka = a.includes(k), kb = b.includes(k);
    if (ka && kb) return 1;          // ikkalasi ham shu kalit
    if (ka !== kb) return 0;         // biri kalit, ikkinchisi emas — moslanmaydi
  }
  // kirill/lotin farqlari: х/h, қ/q, е/ye, qo'sh harflar
  const fold = (x) => x.replace(/h/g, 'x').replace(/q/g, 'k').replace(/ye/g, 'e').replace(/(.)\1+/g, '$1');
  const fa = fold(a), fb = fold(b);
  const sim = Math.max(Match.similarity(of.name, nf.name), Match.similarity(fa, fb));
  if (fa === fb) return 1;
  // Asosiy so'z bir xil bo'lsa (guruh, korxona, telefon...) — mos deb olinadi, eng o'xshashi tanlanadi
  if (FIELD_WORDS.some((w) => fa.includes(w) && fb.includes(w))) return 0.8 + 0.2 * sim;
  return sim;
}
const FIELD_WORDS = ['gurux', 'korxona', 'telefon', 'boskich', 'toifa', 'tugilgan', 'pasport', 'mfy', 'yonalis', 'talimsakl', 'usta', 'masul', 'buyruk', 'sartnoma'];

function mapFields(oldDb, newDb) {
  const used = new Set();
  return newDb.fields.map((nf) => {
    let best = -1, score = 0;
    oldDb.fields.forEach((of, i) => {
      if (used.has(i)) return;
      const s = fieldScore(of, nf);
      if (s > score) { score = s; best = i; }
    });
    if (score >= 0.75) { used.add(best); return best; }
    return -1;
  });
}

// Yangi faylni bazaga qo'shish rejasi.
// opts.add = false: baza asosiy — faqat bazadagi o'quvchilar yangilanadi, bazada yo'qlari olinmaydi.
// O'quvchi avval JShShIR, so'ng ism-familiya bo'yicha topiladi (kirill/lotin farqi va kichik xatolar hisobga olinadi).
// Ism-familiya ustuni bazada o'zgartirilmaydi; boshqa ustunlar faqat mazmuni farq qilsa yangilanadi.
function mergePlan(oldDb, newDb, opts = {}) {
  const add = opts.add !== false;
  const map = mapFields(oldDb, newDb);
  const newFields = newDb.fields.filter((_, i) => map[i] < 0);
  const fields = oldDb.fields.concat(newFields.map((f) => ({ ...f, col: -1 })));
  let extra = oldDb.fields.length;
  const target = map.map((m) => (m >= 0 ? m : extra++));
  const width = fields.length;
  const rows = oldDb.rows.map((r) => r.concat(Array(width - r.length).fill(null)));
  const keyOf = (db, r) => rowKey(db, r);
  const index = new Map();
  rows.forEach((r, i) => { const k = keyOf(oldDb, r); if (k) index.set(k, i); });
  const oJ = jIndex(oldDb), nJ = jIndex(newDb);
  const oName = oldDb.nameIdx, nName = newDb.nameIdx;
  const gField = (db) => db.fields.findIndex((f) => /gurux|guruh/.test(Match.canon(f.name)));
  const oG = gField(oldDb), nG = gField(newDb);
  // Ism-familiya indeksi
  const toks = oName >= 0 ? rows.map((r) => Match.personTokens(r[oName])) : [];
  const byPKey = new Map();
  toks.forEach((t, i) => { const k = t.join(' '); if (k) { if (!byPKey.has(k)) byPKey.set(k, []); byPKey.get(k).push(i); } });
  const sameGroup = (i, nr) => oG >= 0 && nG >= 0 && Match.norm(rows[i][oG]) && Match.norm(rows[i][oG]) === Match.norm(nr[nG]);
  const used = new Set();

  function findByName(nr) {
    if (oName < 0 || nName < 0) return { at: undefined };
    const t = Match.personTokens(nr[nName]);
    if (t.length < 2) return { at: undefined };
    let c = (byPKey.get(t.join(' ')) || []).filter((i) => !used.has(i));
    if (c.length > 1) { const g = c.filter((i) => sameGroup(i, nr)); if (g.length) c = g; }
    if (c.length === 1) return { at: c[0], exact: true };
    if (c.length > 1) return { at: undefined, ambiguous: c };
    let best = -1, bs = 0, second = 0;
    toks.forEach((tk, i) => {
      if (used.has(i)) return;
      let sc = Match.personScore(t, tk);
      if (!sc) return;
      if (sameGroup(i, nr)) sc += 0.03;
      if (sc > bs) { second = bs; bs = sc; best = i; } else if (sc > second) second = sc;
    });
    if (best >= 0 && bs >= 0.88 && bs - second >= 0.04) return { at: best, score: bs };
    return { at: undefined, near: best >= 0 && bs >= 0.8 ? best : -1 };
  }

  let added = 0, updatedRows = 0, updatedCells = 0, byNameN = 0;
  const changes = [], addedNames = [], skipped = [], fuzzy = [];
  for (const nr of newDb.rows) {
    const k = keyOf(newDb, nr);
    let at = k ? index.get(k) : undefined;
    if (at !== undefined && used.has(at)) continue; // faylda takror
    let how = 'j';
    if (at === undefined) {
      const fileJ = nJ >= 0 ? Match.digits(nr[nJ]) : '';
      const r = findByName(nr);
      // Faylda to'g'ri JShShIR bor, bazadagisi boshqa: faqat ism to'liq mos bo'lsa
      if (r.at !== undefined && fileJ.length === 14 && oJ >= 0) {
        const dbJ = Match.digits(rows[r.at][oJ]);
        if (dbJ.length === 14 && dbJ !== fileJ && !r.exact) r.at = undefined;
      }
      at = r.at;
      how = r.exact ? 'name' : 'fuzzy';
      if (at === undefined && !add) {
        if (skipped.length < 300) skipped.push({ name: nName >= 0 ? nr[nName] : k, near: r.near >= 0 ? rows[r.near][oName] : r.ambiguous ? `${r.ambiguous.length} ta bir xil ism` : '' });
        else skipped.push({});
        continue;
      }
    }
    if (at === undefined) {
      const row = Array(width).fill(null);   // faylda yo'q ustunlar bo'sh qoladi
      nr.forEach((v, i) => { row[target[i]] = v; });
      rows.push(row);
      if (k) index.set(k, rows.length - 1);
      used.add(rows.length - 1);
      added++;
      if (addedNames.length < 300) addedNames.push(nName >= 0 ? nr[nName] : k);
      continue;
    }
    used.add(at);
    if (how !== 'j') byNameN++;
    const row = rows[at];
    if (how === 'fuzzy' && fuzzy.length < 300 && oName >= 0) fuzzy.push({ from: nr[nName], to: row[oName] });
    let n = 0;
    nr.forEach((v, i) => {
      if (v == null || String(v).trim() === '') return;   // bo'sh qiymat bazadagini o'chirmaydi
      const t = target[i];
      if (t === oName && i === nName) return;              // ism-familiya bazadagicha qoladi
      if (!add && t >= oldDb.fields.length) return;        // bazada yo'q ustun olinmaydi
      const old = row[t];
      if (String(old ?? '') === String(v)) return;
      if (old != null && Match.norm(old) === Match.norm(v) && Match.norm(v)) return; // faqat yozuv (kirill/lotin) farqi
      if (changes.length < 300) changes.push({ name: row[oName >= 0 ? oName : 0], field: fields[t].label, from: old, to: v });
      row[t] = v; n++;
    });
    if (n) { updatedRows++; updatedCells += n; }
  }
  const mapping = newDb.fields.map((f, i) => ({ from: f.label, to: map[i] >= 0 ? oldDb.fields[map[i]].label : null }));
  const keepFields = add ? fields : fields.slice(0, oldDb.fields.length);
  const outRows = add ? rows : rows.map((r) => r.slice(0, oldDb.fields.length));
  return { db: { ...oldDb, fields: keepFields, rows: outRows }, added, updatedRows, updatedCells, newFields: add ? newFields : [], ignoredFields: add ? [] : newFields,
    changes, addedNames, mapping, byNameN, skipped, fuzzy, matched: used.size - added };
}

// ---------------------------------------------------------------- TAHRIRLASH paneli (Excel'ga o'xshash jadval)
const editUi = { q: '', mode: 'all', page: 0, cols: null, colsOpen: false, filters: [], filterOpen: false, bulkField: '', bulkVal: '' };

function defaultEditCols(db) {
  const find = (...k) => db.fields.findIndex((f) => k.some((x) => Match.canon(f.name).includes(x)));
  const cols = [db.nameIdx, find('gurux', 'guruh'), jIndex(db), find('telefon'), find('tugilgansana'), find('korxonanomi')];
  return cols.filter((c, k, a) => c >= 0 && a.indexOf(c) === k);
}

let inlineTimer = null;
async function afterInlineEdit() {
  state.db.editedAt = Date.now();
  await saveLocal();
  computeView();
  renderHeader();
  state.stale = true; // boshqa bo'limlar ochilganda yangilanadi
  renderIssueTabs();
  clearTimeout(inlineTimer);
  inlineTimer = setTimeout(() => cloudPush(), 2500);
}

function renderIssueTabs() {
  const el = $('#ed-issues');
  if (!el || !state.db) return;
  const iss = jshshirIssues(state.db);
  const tab = (mode, label, n, cls) => `<button class="issue-tab ${editUi.mode === mode ? 'on' : ''} ${n && cls ? cls : ''}" data-mode="${mode}">${label} <span class="n">${n}</span></button>`;
  const sugg = companySuggestions(state.db).length;
  const spellN = Spell.scan(state.db).length;
  el.innerHTML = tab('all', 'Hamma o\'quvchilar', state.db.rows.length) +
    tab('bad', 'JShShIR xato', iss.bad.length, 'has-bad') +
    tab('dup', 'Takroriy JShShIR', iss.dups.length, 'has-bad') +
    `<button class="issue-tab ${spellN ? 'has-warn' : ''}" id="ed-spell">✍️ Imlo xatolari <span class="n">${spellN}</span></button>` +
    `<button class="issue-tab ${sugg ? 'has-warn' : ''}" id="ed-comp">Korxona nomlarini tartiblash <span class="n">${sugg}</span></button>`;
  el.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { editUi.mode = b.dataset.mode; editUi.page = 0; renderEdit(); }));
  $('#ed-comp').onclick = openCompanyDialog;
  $('#ed-spell').onclick = openSpellDialog;
}

// Joriy filtr/qidiruv/rejimga mos qatorlar (indekslari)
function editIndexes() {
  const db = state.db;
  const iss = jshshirIssues(db);
  let idxs = db.rows.map((_, i) => i);
  if (editUi.mode === 'bad') idxs = iss.bad;
  if (editUi.mode === 'dup') idxs = iss.dups.flatMap((d) => d.rows);
  if (editUi.filters.some(Filters.isActive)) {
    const keep = new Set(Filters.apply(db.rows, editUi.filters));
    idxs = idxs.filter((i) => keep.has(db.rows[i]));
  }
  const q = Match.norm(editUi.q), qd = Match.digits(editUi.q);
  if (q) idxs = idxs.filter((i) => db.rows[i].some((v) => v != null && (Match.norm(v).includes(q) || (qd.length >= 3 && Match.digits(v).includes(qd)))));
  return { idxs, iss };
}

function renderEdit() {
  const box = $('#edit-body');
  if (!box) return;
  const db = state.db;
  if (!db) { box.innerHTML = '<div class="box"><p class="muted">Baza bo\'sh. Avval "Baza" bo\'limida asosiy jadvalni yuklang.</p></div>'; return; }
  if (!editUi.cols || editUi.cols.some((c) => c >= db.fields.length)) editUi.cols = defaultEditCols(db);
  const cols = editUi.cols;
  const nActive = editUi.filters.filter(Filters.isActive).length;

  box.innerHTML = `
    <div class="box">
      <div class="ed-help">💡 <span>Kerakli <b>katakni bosing va yozing</b> — boshqa joyni bosganingizda yoki <b>Enter</b> bosganingizda avtomatik saqlanadi.
        <b>Filtr</b> bilan kerakli o'quvchilarni ajratib, ularni tahrirlang yoki hammasiga bir xil qiymat qo'ying. Qator oxiridagi <b>✎</b> barcha ma'lumotlarni ochadi.</span></div>
      <div class="issue-tabs" id="ed-issues"></div>
      <div class="ed-bar">
        <input type="search" id="ed-q" placeholder="Qidirish: ism, JShShIR, telefon, guruh…" value="${esc(editUi.q)}">
        <button id="ed-ftoggle" class="${editUi.filterOpen || nActive ? 'on-soft' : ''}">⚲ Filtr${nActive ? ` <span class="nbadge">${nActive}</span>` : ''}</button>
        <div class="col-pick">
          <button id="ed-cols">Ustunlar (${cols.length}) ▾</button>
          ${editUi.colsOpen ? `<div class="col-pick-menu">${db.fields.map((f, i) => `<label><input type="checkbox" data-col="${i}" ${cols.includes(i) ? 'checked' : ''}> ${esc(f.label)}</label>`).join('')}</div>` : ''}
        </div>
        <button class="primary" id="ed-add">＋ Yangi o'quvchi</button>
      </div>
      <div class="ed-filter" ${editUi.filterOpen ? '' : 'hidden'}>
        <div class="ed-filter-grid">
          <div>
            <h4>Kimlarni tahrirlaysiz?</h4>
            <div id="ed-filters"></div>
          </div>
          <div class="bulk">
            <h4>Filtrlanganlarning hammasiga qiymat qo'yish</h4>
            <label>Ustun
              <select id="bulk-field"><option value="">Ustunni tanlang…</option>${db.fields.map((f, i) => `<option value="${i}" ${String(editUi.bulkField) === String(i) ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
            </label>
            <label>Yangi qiymat
              <input id="bulk-val" list="bulk-list" value="${esc(editUi.bulkVal)}" placeholder="Masalan: Қолади" autocomplete="off">
              <datalist id="bulk-list">${editUi.bulkField === '' ? '' : [...new Set(db.rows.map((r) => r[+editUi.bulkField]).filter((v) => v != null && String(v).trim()))].slice(0, 200).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
            </label>
            <button class="primary" id="bulk-go">Qo'llash</button>
            <p class="fl-note">Bo'sh qoldirsangiz, o'sha ustun tozalanadi. Qo'llashdan oldin tasdiqlash so'raladi.</p>
          </div>
        </div>
      </div>
      <div id="ed-grid"></div>
    </div>`;

  renderIssueTabs();
  $('#ed-q').oninput = (e) => { editUi.q = e.target.value; editUi.page = 0; renderEditGrid(); };
  $('#ed-ftoggle').onclick = () => { editUi.filterOpen = !editUi.filterOpen; renderEdit(); };
  $('#ed-cols').onclick = () => { editUi.colsOpen = !editUi.colsOpen; renderEdit(); };
  box.querySelectorAll('[data-col]').forEach((cb) => (cb.onchange = () => {
    const c = +cb.dataset.col;
    editUi.cols = cb.checked ? [...editUi.cols, c].sort((a, b) => a - b) : editUi.cols.filter((x) => x !== c);
    renderEdit();
  }));
  $('#ed-add').onclick = () => openRecord(-1);
  if (editUi.filterOpen) {
    Filters.render($('#ed-filters'), db, editUi.filters, () => {
      editUi.page = 0;
      renderEditGrid();
      const n = editUi.filters.filter(Filters.isActive).length;
      $('#ed-ftoggle').innerHTML = `⚲ Filtr${n ? ` <span class="nbadge">${n}</span>` : ''}`;
    });
    $('#bulk-field').onchange = (e) => {
      editUi.bulkField = e.target.value;
      const vals = e.target.value === '' ? [] : [...new Set(db.rows.map((r) => r[+e.target.value]).filter((v) => v != null && String(v).trim()))].slice(0, 200);
      $('#bulk-list').innerHTML = vals.map((v) => `<option value="${esc(v)}">`).join('');
    };
    $('#bulk-val').oninput = (e) => { editUi.bulkVal = e.target.value; };
    $('#bulk-go').onclick = async () => {
      if (editUi.bulkField === '') { toast('Ustunni tanlang', 'err'); return; }
      const fi = +editUi.bulkField;
      const { idxs } = editIndexes();
      if (!idxs.length) { toast('Filtrga mos o\'quvchi yo\'q', 'err'); return; }
      if (!editUi.filters.some(Filters.isActive) && !editUi.q && editUi.mode === 'all' &&
          !confirm('Filtr qo\'yilmagan — bu BARCHA o\'quvchilarga qo\'llanadi. Davom etilsinmi?')) return;
      if (!confirm(`${idxs.length} ta o'quvchining "${db.fields[fi].label}" ustuniga "${editUi.bulkVal || '(bo\'sh)'}" yozilsinmi?`)) return;
      for (const i of idxs) db.rows[i][fi] = parseInputValue(editUi.bulkVal, db.rows[i][fi]);
      await afterInlineEdit();
      renderEditGrid();
      toast(`${idxs.length} ta o'quvchi yangilandi ✓`, 'ok');
    };
  }
  renderEditGrid();
}

function renderEditGrid() {
  const box = $('#ed-grid');
  if (!box) return;
  const db = state.db;
  const cols = editUi.cols;
  const { idxs, iss } = editIndexes();
  const badRows = new Set(iss.bad);
  const dupRows = new Set(iss.dups.flatMap((d) => d.rows));
  const PAGE = 50;
  const pages = Math.max(1, Math.ceil(idxs.length / PAGE));
  editUi.page = Math.min(editUi.page, pages - 1);
  const show = idxs.slice(editUi.page * PAGE, editUi.page * PAGE + PAGE);
  const wideCols = new Set([db.nameIdx, db.fields.findIndex((f) => Match.canon(f.name).includes('korxonanomi'))]);
  const filtered = idxs.length !== db.rows.length;

  box.innerHTML = `
    ${filtered ? `<p class="small ed-count">Ko'rsatilmoqda: <b>${idxs.length}</b> ta o'quvchi (jami ${db.rows.length})</p>` : ''}
    <div class="grid-wrap">
      <table class="grid">
        <thead><tr><th class="num">№</th>${cols.map((c) => `<th>${esc(db.fields[c].name)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${show.map((ri, k) => {
          const r = db.rows[ri];
          return `<tr>
            <td class="num">${editUi.page * PAGE + k + 1}</td>
            ${cols.map((c) => {
              const bad = c === iss.ji && (badRows.has(ri) || dupRows.has(ri));
              const title = c === iss.ji ? (badRows.has(ri) ? "JShShIR 14 ta raqam bo'lishi kerak" : dupRows.has(ri) ? 'Takroriy JShShIR' : '') : '';
              return `<td><input class="cell ${wideCols.has(c) ? 'wide' : ''} ${bad ? 'bad' : ''}" data-ri="${ri}" data-fi="${c}" value="${esc(r[c] ?? '')}" ${title ? `title="${esc(title)}"` : ''} ${c === iss.ji ? 'inputmode="numeric"' : ''}></td>`;
            }).join('')}
            <td class="act"><button data-open="${ri}" title="Barcha ma'lumotlar">✎</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="${cols.length + 2}" class="muted" style="padding:16px">Hech narsa topilmadi.</td></tr>`}</tbody>
      </table>
    </div>
    ${pages > 1 ? `<div class="pager"><button id="ed-prev" ${editUi.page ? '' : 'disabled'}>‹</button><span>${editUi.page + 1} / ${pages} sahifa · ${idxs.length} ta</span><button id="ed-next" ${editUi.page < pages - 1 ? '' : 'disabled'}>›</button></div>` : `<div class="pager">${idxs.length} ta</div>`}`;

  box.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openRecord(+b.dataset.open)));
  const prev = $('#ed-prev'), next = $('#ed-next');
  if (prev) prev.onclick = () => { editUi.page--; renderEditGrid(); };
  if (next) next.onclick = () => { editUi.page++; renderEditGrid(); };

  box.querySelectorAll('input.cell').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const all = [...box.querySelectorAll(`input.cell[data-fi="${inp.dataset.fi}"]`)];
        const nxt = all[all.indexOf(inp) + 1];
        if (nxt) nxt.focus(); else inp.blur();
      } else if (e.key === 'Escape') {
        inp.value = db.rows[+inp.dataset.ri][+inp.dataset.fi] ?? '';
        inp.blur();
      }
    });
    inp.addEventListener('change', async () => {
      const ri = +inp.dataset.ri, fi = +inp.dataset.fi;
      const row = db.rows[ri];
      const v = parseInputValue(inp.value, row[fi]);
      if (String(v ?? '') === String(row[fi] ?? '')) return;
      const oldK = rowKey(db, row);
      row[fi] = v;
      const newK = rowKey(db, row);
      if (oldK && newK && oldK !== newK && oldK in state.marks.stu) {
        state.marks.stu[newK] = state.marks.stu[oldK];
        delete state.marks.stu[oldK];
      }
      inp.classList.remove('saved'); void inp.offsetWidth; inp.classList.add('saved');
      if (fi === iss.ji) {
        const now = jshshirIssues(db);
        const bad = now.bad.includes(ri) || now.dups.some((d) => d.rows.includes(ri));
        inp.classList.toggle('bad', bad);
        inp.title = bad ? "JShShIR 14 ta raqam bo'lishi kerak yoki takroriy" : '';
      }
      await afterInlineEdit();
    });
  });
}

function dialog(html) {
  let dlg = $('#dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'dlg';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  dlg.innerHTML = html;
  if (!dlg.open) dlg.showModal();
  return dlg;
}

function openRecord(ri) {
  const db = state.db;
  const isNew = ri < 0;
  const row = isNew ? db.fields.map(() => null) : db.rows[ri];
  const iss = jshshirIssues(db);
  const nameIdx = db.nameIdx >= 0 ? db.nameIdx : 0;
  const dlg = dialog(`
    <form method="dialog" class="dlg-form">
      <div class="dlg-head">
        <h3>${isNew ? "Yangi o'quvchi" : esc(row[nameIdx] ?? 'Yozuv')}</h3>
        <button type="button" class="icon-btn" data-close aria-label="Yopish">✕</button>
      </div>
      <div class="dlg-body">
        ${db.fields.map((f, i) => `
          <label class="fld ${i === iss.ji ? 'jfld' : ''}">${esc(f.label)}
            ${String(row[i] ?? '').length > 60 || String(row[i] ?? '').includes('\n')
              ? `<textarea data-fi="${i}" rows="2">${esc(row[i] ?? '')}</textarea>`
              : `<input data-fi="${i}" value="${esc(row[i] ?? '')}" ${i === iss.ji ? 'inputmode="numeric" maxlength="20"' : ''}>`}
            ${i === iss.ji ? '<small class="jmsg"></small>' : ''}
          </label>`).join('')}
      </div>
      <div class="dlg-foot">
        ${isNew ? '' : '<button type="button" class="danger" data-del>O\'chirish</button>'}
        <span class="grow"></span>
        <button type="button" data-close>Bekor qilish</button>
        <button type="button" class="primary" data-save>Saqlash</button>
      </div>
    </form>`);
  const jin = iss.ji >= 0 ? dlg.querySelector(`[data-fi="${iss.ji}"]`) : null;
  const checkJ = () => {
    if (!jin) return true;
    const d = Match.digits(jin.value);
    const msg = dlg.querySelector('.jmsg');
    const dupe = d && db.rows.some((r, i) => i !== ri && Match.digits(r[iss.ji]) === d);
    let text = '', ok = true;
    if (!jin.value.trim()) { text = ''; }
    else if (d.length !== 14 || jin.value.replace(/\s+/g, '') !== d) { text = `JShShIR 14 ta raqam bo'lishi kerak (hozir ${d.length} ta)`; ok = false; }
    else if (dupe) { text = 'Bunday JShShIR bazada bor (dublikat)'; ok = false; }
    msg.textContent = text;
    msg.className = 'jmsg ' + (ok ? 'ok' : 'bad');
    jin.classList.toggle('invalid', !ok);
    return ok;
  };
  if (jin) { jin.oninput = checkJ; checkJ(); }
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelector('[data-save]').onclick = async () => {
    if (!checkJ() && !confirm('JShShIR xato yoki takroriy. Baribir saqlansinmi?')) return;
    const vals = db.fields.map((_, i) => {
      const el = dlg.querySelector(`[data-fi="${i}"]`);
      return parseInputValue(el.value, row[i]);
    });
    if (isNew) {
      if (vals.every((v) => v == null)) { dlg.close(); return; }
      db.rows.push(vals);
    } else {
      // Kalit (JShShIR) o'zgarsa — shartnoma belgisini yangi kalitga ko'chirish
      const oldK = rowKey(db, row);
      db.rows[ri] = vals;
      const newK = rowKey(db, vals);
      if (oldK && newK && oldK !== newK && oldK in state.marks.stu) {
        state.marks.stu[newK] = state.marks.stu[oldK];
        delete state.marks.stu[oldK];
      }
    }
    dlg.close();
    await dbChanged(isNew ? "Yangi o'quvchi qo'shildi ✓" : 'Saqlandi ✓');
  };
  const del = dlg.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (!confirm(`"${row[nameIdx] ?? ''}" bazadan o'chirilsinmi?`)) return;
    db.rows.splice(ri, 1);
    dlg.close();
    await dbChanged("O'chirildi");
  };
}

function openCompanyDialog() {
  const db = state.db;
  const sugg = companySuggestions(db);
  if (!sugg.length) { toast("Hamma MChJ/YaTT nomlari allaqachon shablonda ✓", 'ok'); return; }
  const dlg = dialog(`
    <div class="dlg-form">
      <div class="dlg-head"><h3>Korxona nomlarini shablonga keltirish</h3>
        <button type="button" class="icon-btn" data-close aria-label="Yopish">✕</button></div>
      <div class="dlg-body">
        <p class="muted small">Faqat <b>MChJ</b> va <b>YaTT</b> nomlari <code>"NOMI" MCHJ</code> ko'rinishiga keltiriladi. Boshqa nomlarga tegilmaydi. Keraksizini belgidan chiqaring.</p>
        <div class="sugg">${sugg.map((s, i) => `
          <label class="sugg-row"><input type="checkbox" data-si="${i}" checked>
            <span><s>${esc(s.from)}</s><br><b>${esc(s.to)}</b> <span class="muted small">· ${s.count} ta o'quvchi</span></span></label>`).join('')}</div>
      </div>
      <div class="dlg-foot"><span class="grow"></span>
        <button type="button" data-close>Bekor qilish</button>
        <button type="button" class="primary" data-apply>Qo'llash</button></div>
    </div>`);
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelector('[data-apply]').onclick = async () => {
    const ci = companyFieldIdx(db);
    const pick = new Map();
    dlg.querySelectorAll('[data-si]').forEach((cb) => { if (cb.checked) { const s = sugg[+cb.dataset.si]; pick.set(s.from, s.to); } });
    let n = 0;
    for (const r of db.rows) if (pick.has(r[ci])) { r[ci] = pick.get(r[ci]); n++; }
    // korxona shartnomasi belgilarini yangi nomga ko'chirish
    for (const [from, to] of pick) {
      const a = companyKey(from), b = companyKey(to);
      if (a !== b && state.marks.comp[a] && !state.marks.comp[b]) { state.marks.comp[b] = { ...state.marks.comp[a], name: to }; delete state.marks.comp[a]; }
    }
    dlg.close();
    await dbChanged(`${pick.size} ta nom tartiblandi (${n} ta katak) ✓`);
  };
}

// ---------------------------------------------------------------- Imlo xatolarini tuzatish
// Korxona nomi o'zgarsa — shartnoma belgilari va mas'ul biriktirilishini yangi nomga ko'chirish
function migrateCompany(from, to) {
  const a = companyKey(from), b = companyKey(to);
  if (a === b) return;
  if (state.marks.comp[a] && !state.marks.comp[b]) { state.marks.comp[b] = { ...state.marks.comp[a], name: to }; delete state.marks.comp[a]; }
  if (state.resp && state.resp.assign[a] && !state.resp.assign[b]) { state.resp.assign[b] = state.resp.assign[a]; delete state.resp.assign[a]; }
  if (state.resp && state.resp.assignBy && state.resp.assignBy[a] && !state.resp.assignBy[b]) { state.resp.assignBy[b] = state.resp.assignBy[a]; delete state.resp.assignBy[a]; }
}

function applySpell(db, issues) {
  const ci = db.fields.findIndex((f) => Match.canon(f.name).includes('korxonanomi'));
  const moved = new Set();
  for (const it of issues) {
    if (it.fi === ci && !moved.has(it.from)) { migrateCompany(it.from, it.to); moved.add(it.from); }
    db.rows[it.ri][it.fi] = it.to;
  }
}

function openSpellDialog() {
  const db = state.db;
  const issues = Spell.scan(db);
  if (!issues.length) { toast("Imlo xatolari topilmadi ✓", 'ok'); return; }
  const nameIdx = db.nameIdx >= 0 ? db.nameIdx : 0;
  const byField = new Map();
  issues.forEach((it, i) => { if (!byField.has(it.fi)) byField.set(it.fi, []); byField.get(it.fi).push(i); });
  const SHOW = 150;
  const dlg = dialog(`
    <div class="dlg-form">
      <div class="dlg-head"><h3>✍️ Imlo xatolari: ${issues.length} ta</h3><button type="button" class="icon-btn" data-close aria-label="Yopish">✕</button></div>
      <div class="dlg-body" style="display:block">
        <p class="muted small">Ortiqcha bo'shliqlar, kirill so'z ichidagi lotin harflari (yoki aksincha), F.I.Sh dagi katta-kichik harflar va "қизи / ўғли" yozilishi tuzatiladi. Keraksizini belgidan chiqaring.</p>
        ${[...byField].map(([fi, idxs]) => `
          <details class="sp-group" ${byField.size <= 3 ? 'open' : ''}>
            <summary><label class="sp-all" onclick="event.stopPropagation()"><input type="checkbox" data-gall="${fi}" checked></label> <b>${esc(db.fields[fi].label)}</b> <span class="muted">— ${idxs.length} ta</span></summary>
            <div class="sp-list">${idxs.slice(0, SHOW).map((i) => {
              const it = issues[i];
              return `<label class="sp-row"><input type="checkbox" data-si="${i}" data-g="${fi}" checked>
                <span><span class="muted small">${fi === nameIdx ? '' : esc(db.rows[it.ri][nameIdx] ?? '') + ': '}</span><s>${esc(it.from)}</s> → <b>${esc(it.to)}</b></span></label>`;
            }).join('')}${idxs.length > SHOW ? `<p class="fl-note">…va yana ${idxs.length - SHOW} ta (guruh belgilangan bo'lsa, ular ham tuzatiladi)</p>` : ''}</div>
          </details>`).join('')}
      </div>
      <div class="dlg-foot"><span class="grow"></span>
        <button type="button" data-close>Bekor qilish</button>
        <button type="button" class="primary" data-apply>Tuzatish</button></div>
    </div>`);
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelectorAll('[data-gall]').forEach((cb) => (cb.onchange = () => {
    dlg.querySelectorAll(`[data-g="${cb.dataset.gall}"]`).forEach((x) => (x.checked = cb.checked));
  }));
  dlg.querySelector('[data-apply]').onclick = async () => {
    const off = new Set([...dlg.querySelectorAll('[data-si]')].filter((x) => !x.checked).map((x) => +x.dataset.si));
    const groupOff = new Set([...dlg.querySelectorAll('[data-gall]')].filter((x) => !x.checked).map((x) => +x.dataset.gall));
    const pick = issues.filter((it, i) => !off.has(i) && !groupOff.has(it.fi));
    applySpell(db, pick);
    dlg.close();
    await dbChanged(`${pick.length} ta imlo xatosi tuzatildi ✓`);
  };
}
