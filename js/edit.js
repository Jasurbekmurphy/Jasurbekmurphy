/* global state, Store, Match, esc, toast, $, saveLocal, onDbChanged, cloudPush, rowKey, downloadBlob, XlsxWrite, companyKey */
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
function mapFields(oldDb, newDb) {
  const used = new Set();
  return newDb.fields.map((nf) => {
    let best = -1, score = 0;
    oldDb.fields.forEach((of, i) => {
      if (used.has(i)) return;
      const s = of.label === nf.label ? 1.01 : Match.similarity(of.name, nf.name);
      if (s > score) { score = s; best = i; }
    });
    if (score >= 0.8) { used.add(best); return best; }
    return -1;
  });
}

function mergePlan(oldDb, newDb) {
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
  let added = 0, updatedRows = 0, updatedCells = 0;
  const changes = [];
  for (const nr of newDb.rows) {
    const k = keyOf(newDb, nr);
    const at = k ? index.get(k) : undefined;
    if (at === undefined) {
      const row = Array(width).fill(null);
      nr.forEach((v, i) => { row[target[i]] = v; });
      rows.push(row);
      if (k) index.set(k, rows.length - 1);
      added++;
      continue;
    }
    const row = rows[at];
    let n = 0;
    nr.forEach((v, i) => {
      if (v == null || String(v).trim() === '') return;
      const t = target[i];
      if (String(row[t] ?? '') !== String(v)) {
        if (changes.length < 200) changes.push({ name: row[oldDb.nameIdx >= 0 ? oldDb.nameIdx : 0], field: fields[t].label, from: row[t], to: v });
        row[t] = v; n++;
      }
    });
    if (n) { updatedRows++; updatedCells += n; }
  }
  return { db: { ...oldDb, fields, rows }, added, updatedRows, updatedCells, newFields, changes };
}

// ---------------------------------------------------------------- TAHRIRLASH paneli
const editUi = { q: '', mode: 'all', page: 0 };

function renderEdit() {
  const box = $('#edit-body');
  if (!box) return;
  const db = state.db;
  if (!db) { box.innerHTML = '<p class="muted">Baza bo\'sh. Avval "Baza" bo\'limida asosiy jadvalni yuklang.</p>'; return; }
  const iss = jshshirIssues(db);
  const sugg = companySuggestions(db);
  const dupRows = new Set(iss.dups.flatMap((d) => d.rows));
  const badRows = new Set(iss.bad);
  const nameIdx = db.nameIdx >= 0 ? db.nameIdx : 0;
  const gi = db.fields.findIndex((f) => /gurux|guruh/.test(Match.canon(f.name)));

  let idxs = db.rows.map((_, i) => i);
  if (editUi.mode === 'bad') idxs = iss.bad;
  if (editUi.mode === 'dup') idxs = iss.dups.flatMap((d) => d.rows);
  const q = Match.norm(editUi.q), qd = Match.digits(editUi.q);
  if (q) idxs = idxs.filter((i) => db.rows[i].some((v) => v != null && (Match.norm(v).includes(q) || (qd.length >= 3 && Match.digits(v).includes(qd)))));
  const PAGE = 40;
  const pages = Math.max(1, Math.ceil(idxs.length / PAGE));
  editUi.page = Math.min(editUi.page, pages - 1);
  const show = idxs.slice(editUi.page * PAGE, editUi.page * PAGE + PAGE);

  box.innerHTML = `
    <div class="checks">
      <button class="check-card ${iss.bad.length ? 'bad' : 'good'} ${editUi.mode === 'bad' ? 'sel' : ''}" data-mode="bad">
        <b>${iss.bad.length}</b><span>JShShIR xato<br><small>14 ta raqam emas</small></span></button>
      <button class="check-card ${iss.dups.length ? 'bad' : 'good'} ${editUi.mode === 'dup' ? 'sel' : ''}" data-mode="dup">
        <b>${iss.dups.length}</b><span>Takroriy JShShIR<br><small>dublikatlar</small></span></button>
      <button class="check-card ${sugg.length ? 'warn' : 'good'}" id="ed-comp">
        <b>${sugg.length}</b><span>Korxona nomi<br><small>shablonga keltirish</small></span></button>
    </div>
    ${iss.ji < 0 ? '<p class="warn small">Bazada JShShIR ustuni topilmadi.</p>' : ''}
    <div class="ed-tools">
      <input type="search" id="ed-q" placeholder="Qidirish: ism, JShShIR, telefon…" value="${esc(editUi.q)}">
      <button class="primary" id="ed-add">＋ Yangi o'quvchi</button>
    </div>
    ${editUi.mode !== 'all' ? `<p class="small">Ko'rsatilmoqda: <b>${editUi.mode === 'bad' ? 'JShShIR xato bo\'lganlar' : 'takroriy JShShIR'}</b> · <button class="link" id="ed-all">hammasini ko'rsatish</button></p>` : ''}
    <div class="ed-list">${show.map((i) => {
      const r = db.rows[i];
      const flags = (badRows.has(i) ? '<span class="flag bad">JShShIR xato</span>' : '') + (dupRows.has(i) ? '<span class="flag warn">dublikat</span>' : '');
      return `<button class="ed-row" data-ri="${i}">
        <span class="ed-name">${esc(r[nameIdx] ?? '(ismsiz)')}</span>
        <span class="ed-meta">${gi >= 0 && r[gi] != null ? esc(r[gi]) + '-guruh · ' : ''}${iss.ji >= 0 ? esc(r[iss.ji] ?? 'JShShIR yo\'q') : ''} ${flags}</span>
      </button>`;
    }).join('') || '<p class="muted">Hech narsa topilmadi.</p>'}</div>
    ${pages > 1 ? `<div class="pager"><button id="ed-prev" ${editUi.page ? '' : 'disabled'}>‹</button><span>${editUi.page + 1} / ${pages} (${idxs.length} ta)</span><button id="ed-next" ${editUi.page < pages - 1 ? '' : 'disabled'}>›</button></div>` : ''}
    <div class="row-btns">
      <button id="ed-export">Joriy bazani Excel'ga yuklab olish</button>
    </div>
    <p class="muted small">Tahrirlar darhol saqlanadi va bulut orqali boshqa qurilmalarga o'tadi.</p>`;

  $('#ed-q').oninput = (e) => {
    editUi.q = e.target.value; editUi.page = 0;
    const pos = e.target.selectionStart;
    renderEdit();
    const inp = $('#ed-q'); inp.focus(); inp.setSelectionRange(pos, pos);
  };
  box.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
    editUi.mode = editUi.mode === b.dataset.mode ? 'all' : b.dataset.mode; editUi.page = 0; renderEdit();
  }));
  const all = $('#ed-all'); if (all) all.onclick = () => { editUi.mode = 'all'; renderEdit(); };
  $('#ed-comp').onclick = openCompanyDialog;
  $('#ed-add').onclick = () => openRecord(-1);
  box.querySelectorAll('[data-ri]').forEach((b) => (b.onclick = () => openRecord(+b.dataset.ri)));
  const prev = $('#ed-prev'), next = $('#ed-next');
  if (prev) prev.onclick = () => { editUi.page--; renderEdit(); };
  if (next) next.onclick = () => { editUi.page++; renderEdit(); };
  $('#ed-export').onclick = async () => {
    const blob = await XlsxWrite.buildWorkbook({
      title: '', sheetName: db.sheetName || 'Baza',
      headers: db.fields.map((f) => f.name), rows: db.rows,
    });
    downloadBlob(blob, (db.fileName || 'Baza').replace(/\.(xlsx|xlsm|xls)$/i, '') + ' (joriy).xlsx');
  };
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
