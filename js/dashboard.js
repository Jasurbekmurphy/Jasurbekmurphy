/* global companyKey, state, $, esc, Match, Filters, showTab, renderTable, defaultTable, dbFieldIdx, companyGroups, studentContract, jshshirIssues, renderCompanies, editUi, renderEdit */
'use strict';
// Dashboard: barcha asosiy ko'rsatkichlar bir joyda.

const dashUi = { more: new Set(), course: '' };

const courseIdx = () => dbFieldIdx('bosqich', 'kurs');
const courseLabel = (v) => (/kurs|курс/i.test(String(v)) ? String(v) : `${v}-kurs`);

// Tanlangan kurs bo'yicha filtr (Jadval bo'limiga o'tganda ham qo'llanadi)
function courseFilters() {
  const ci = courseIdx();
  if (!dashUi.course || ci < 0) return [];
  const f = Filters.newFilter(ci);
  f.values = [dashUi.course];
  return [f];
}

function countBy(rows, idx) {
  const m = new Map();
  for (const r of rows) {
    const v = r[idx];
    const k = v == null || String(v).trim() === '' ? "(bo'sh)" : String(v).replace(/\s+/g, ' ').trim();
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m];
}

function openTableWith(field, value) {
  if (!state.table) state.table = defaultTable();
  const f = Filters.newFilter(field);
  f.values = [value === "(bo'sh)" ? '' : value];
  state.table.filters = [...courseFilters(), f];
  if (!state.table.cols.includes(field)) state.table.cols.push(field);
  renderTable();
  showTab('p-table');
}

function openTablePreset(filters) {
  if (!state.table) state.table = defaultTable();
  state.table.filters = [...courseFilters(), ...filters];
  renderTable();
  showTab('p-table');
}

function barChart(id, title, entries, opts = {}) {
  const total = entries.reduce((n, e) => n + e[1], 0);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  const limit = opts.limit || 8;
  const open = dashUi.more.has(id);
  const shown = open ? entries : entries.slice(0, limit);
  return `
    <div class="box ${opts.span ? 'span2' : ''}">
      <div class="chart-head"><h3>${esc(title)}</h3><span>${opts.unit || "o'quvchi"} · jami ${total}</span></div>
      <div class="bars">${shown.map(([label, n]) => `
        <button class="bar-row" data-chart="${id}" data-v="${esc(label)}" aria-label="${esc(label)}: ${n}">
          <span class="bar-label">${esc(label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span>
          <span class="bar-val">${n}</span>
          <span class="tip">${esc(label)} — ${n} ta (${Math.round((n / Math.max(1, total)) * 100)}%)${opts.hint ? ' · ' + opts.hint : ''}</span>
        </button>`).join('')}</div>
      ${entries.length > limit ? `<button class="more-btn" data-more="${id}">${open ? 'Kamroq ko\'rsatish' : `Yana ${entries.length - limit} tasini ko'rsatish`}</button>` : ''}
    </div>`;
}

function kpi(o) {
  return `<button class="kpi ${o.status ? 'st-' + o.status : ''}" data-kpi="${o.id}">
    <div class="kpi-top"><span class="kpi-label">${esc(o.label)}</span><span class="kpi-ico" aria-hidden="true">${o.icon}</span></div>
    <div class="kpi-val">${o.value}${o.of != null ? ` <small>/ ${o.of}</small>` : ''}</div>
    ${o.pct != null ? `<div class="meter" role="img" aria-label="${Math.round(o.pct)}%"><i style="width:${Math.min(100, o.pct)}%"></i></div>` : ''}
    <div class="kpi-sub">${o.sub || ''}</div>
  </button>`;
}

function renderDashboard() {
  const box = $('#dash-body');
  if (!box) return;
  const db = state.view;
  if (!db) {
    box.innerHTML = `
      <div class="box empty-hero">
        <div class="big">📊</div>
        <h2>Baza hali bo'sh</h2>
        <p class="muted">Boshlash uchun asosiy Excel jadvalni yuklang yoki bulutdagi bazani kod bilan oching.</p>
        <button class="primary" data-go="p-db">Bazaga o'tish</button>
      </div>`;
    box.querySelector('[data-go]').onclick = () => showTab('p-db');
    return;
  }
  // Kurs bo'yicha filtr: butun dashboard shu kursga moslanadi
  const ci = courseIdx();
  const courses = ci >= 0 ? countBy(state.db.rows, ci).filter(([v]) => v !== "(bo'sh)").sort((a, b) => a[0].localeCompare(b[0], 'uz', { numeric: true })) : [];
  if (dashUi.course && !courses.some(([v]) => v === dashUi.course)) dashUi.course = '';
  const idx = state.db.rows.map((_, i) => i).filter((i) => !dashUi.course || String(state.db.rows[i][ci] ?? '').trim() === dashUi.course);
  const raw = idx.map((i) => state.db.rows[i]);
  const rows = idx.map((i) => db.rows[i]), total = rows.length;
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const gi = dbFieldIdx('gurux', 'guruh');
  const yi = dbFieldIdx('talimyonalishi', 'yonalish');
  const si = dbFieldIdx('talimshakli');
  const ti = dbFieldIdx('toifasi');
  const hi = dbFieldIdx('yashashhududinomi');
  const mi = dbFieldIdx('mfy');
  const stay = dbFieldIdx('ishdaqolad');
  const pay = state.db.fields.map((f, i) => (Match.canon(f.name).includes('oylik') && !Match.canon(f.name).endsWith('asosi') ? i : -1)).filter((i) => i >= 0);
  const filled = (r, i) => r[i] != null && String(r[i]).trim() !== '';
  const isWorking = (r) => pay.some((i) => filled(r, i));
  const isStay = (r) => /қолади|qoladi/i.test(String(r[stay] ?? '')) && !/қолмайди|qolmaydi/i.test(String(r[stay] ?? ''));
  const working = pay.length ? raw.filter(isWorking).length : null;
  const stays = stay >= 0 ? raw.filter(isStay).length : null;
  const comp = companyGroups();
  const cfi = dbFieldIdx('korxonanomi', 'korxona');
  const compKeys = new Set(cfi >= 0 ? raw.map((r) => r[cfi]).filter((v) => v != null && String(v).trim()).map(companyKey) : []);
  const compList = comp ? comp.list.filter((c) => compKeys.has(c.key) && !c.inst) : [];
  const compN = compList.length;
  const compWith = compList.filter((c) => c.contract).length;
  const stuWith = raw.filter((r) => studentContract(r).on).length;
  const instN = raw.filter((r) => studentContract(r).na).length;
  const need = total - instN;
  const iss = jshshirIssues(state.db);
  const problems = iss.bad.length + iss.dups.length;
  const groupsN = gi >= 0 ? new Set(rows.map((r) => r[gi]).filter((v) => v != null)).size : 0;

  const kpis = [
    kpi({ id: 'total', label: "Jami o'quvchilar", icon: '👥', value: total, sub: groupsN ? `${groupsN} ta guruh` : '' }),
    working != null && kpi({ id: 'work', label: 'Ishlaydiganlar (oylik oladi)', icon: '💼', value: working, of: total, pct: pct(working), sub: `${Math.round(pct(working))}% · bosib ro'yxatni oching` }),
    stays != null && kpi({ id: 'stay', label: 'Korxonada ishda qoladi', icon: '🏭', value: stays, of: total, pct: pct(stays), sub: `${Math.round(pct(stays))}%` }),
    comp && kpi({ id: 'comp', label: 'Korxonalar', icon: '🏢', value: compN, sub: `korxona shartnomasi bor: ${compWith} ta`, pct: compN ? (compWith / compN) * 100 : 0 }),
    kpi({ id: 'stuc', label: "O'quvchi shartnomasi", icon: '📄', value: stuWith, of: need, pct: need ? (stuWith / need) * 100 : 0,
      sub: `${need - stuWith} ta o'quvchida yo'q` + (instN ? ` · 🎓 ${instN} ta ta'lim muassasasida` : ''), status: stuWith === need ? 'ok' : 'warn' }),
    kpi({ id: 'issues', label: "Ma'lumotdagi xatolar", icon: problems ? '⚠️' : '✓', value: problems, status: problems ? 'bad' : 'ok',
      sub: problems ? `JShShIR xato: ${iss.bad.length} · dublikat: ${iss.dups.length}` : 'JShShIR hammasi to\'g\'ri' }),
  ].filter(Boolean);

  const sortNum = (a, b) => a[0].localeCompare(b[0], 'uz', { numeric: true });
  const sortCnt = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uz');
  const charts = [];
  if (gi >= 0) charts.push(barChart('g', 'Guruhlar bo\'yicha', countBy(rows, gi).sort(sortNum), { limit: 12, hint: 'bosib ro\'yxatni oching' }));
  if (yi >= 0) charts.push(barChart('y', "Ta'lim yo'nalishlari", countBy(rows, yi).sort(sortCnt)));
  if (si >= 0) charts.push(barChart('s', "Ta'lim shakli", countBy(rows, si).sort(sortCnt)));
  if (ti >= 0) charts.push(barChart('t', 'Toifalar', countBy(rows, ti).sort(sortCnt)));
  if (comp) {
    const per = new Map();
    raw.forEach((r) => { if (cfi >= 0 && r[cfi] != null && String(r[cfi]).trim()) { const k = companyKey(r[cfi]); per.set(k, (per.get(k) || 0) + 1); } });
    charts.push(barChart('c', "O'quvchilar soni bo'yicha korxonalar", compList.map((c) => [c.name, per.get(c.key) || 0]).sort((a, b) => b[1] - a[1]), { limit: 10, hint: 'bosib korxonani oching' }));
  }
  if (mi >= 0) charts.push(barChart('m', 'Yashash joyi (MFY)', countBy(rows, mi).sort(sortCnt), { limit: 10 }));
  else if (hi >= 0) charts.push(barChart('h', 'Yashash hududi', countBy(rows, hi).sort(sortCnt), { limit: 10 }));

  const d = new Date(state.db.editedAt || state.db.importedAt);
  const courseCards = courses.map(([v, n]) => {
    const cr = state.db.rows.filter((r) => String(r[ci] ?? '').trim() === v);
    const g = gi >= 0 ? new Set(cr.map((r) => r[gi]).filter((x) => x != null)).size : 0;
    const w = pay.length ? cr.filter(isWorking).length : null;
    const st = stay >= 0 ? cr.filter(isStay).length : null;
    return `<button class="course-card ${dashUi.course === v ? 'on' : ''}" data-course="${esc(v)}">
      <span class="cc-title">${esc(courseLabel(v))}</span>
      <span class="cc-num">${n} <small>o'quvchi</small></span>
      <span class="cc-meta">${g ? `${g} ta guruh` : ''}${w != null ? ` · ishlaydi: ${w}` : ''}${st != null ? ` · qoladi: ${st}` : ''}</span>
    </button>`;
  }).join('');
  box.innerHTML = `
    ${courses.length ? `
    <div class="course-bar">
      <div class="seg course-seg">
        <button data-course="" class="${dashUi.course ? '' : 'on'}">Hammasi</button>
        ${courses.map(([v]) => `<button data-course="${esc(v)}" class="${dashUi.course === v ? 'on' : ''}">${esc(courseLabel(v))}</button>`).join('')}
      </div>
      <span class="muted small">${dashUi.course ? `Faqat ${esc(courseLabel(dashUi.course))} ko'rsatilmoqda` : 'Barcha kurslar'}</span>
    </div>
    <div class="courses">${courseCards}</div>` : ''}
    <div class="kpis">${kpis.join('')}</div>
    <div class="box">
      <div class="chart-head"><h3>Tezkor amallar</h3><span>Oxirgi o'zgarish: ${d.toLocaleDateString('uz')} ${d.toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="quick">
        <button data-go="p-db">＋ Fayl qo'shish</button>
        <button data-go="p-fill">⇪ Shablonni to'ldirish</button>
        <button data-go="p-table">▦ Jadval yaratish</button>
      </div>
    </div>
    <div class="dash-grid">${charts.join('')}</div>`;

  const fieldOf = { g: gi, y: yi, s: si, t: ti, m: mi, h: hi };
  box.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => showTab(b.dataset.go)));
  box.querySelectorAll('[data-course]').forEach((b) => (b.onclick = () => {
    dashUi.course = b.classList.contains('course-card') && dashUi.course === b.dataset.course ? '' : b.dataset.course;
    renderDashboard();
  }));
  box.querySelectorAll('[data-more]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.more;
    if (dashUi.more.has(id)) dashUi.more.delete(id); else dashUi.more.add(id);
    renderDashboard();
  }));
  box.querySelectorAll('.bar-row').forEach((b) => (b.onclick = () => {
    const id = b.dataset.chart, v = b.dataset.v;
    if (id === 'c') {
      state.compUi.q = v;
      renderCompanies();
      showTab('p-comp');
      return;
    }
    openTableWith(fieldOf[id], v);
  }));
  box.querySelectorAll('[data-kpi]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.kpi;
    if (id === 'work') openTablePreset(pay.map((field, k) => ({ ...Filters.newFilter(field), op: 'notempty', join: k ? 'or' : 'and' })));
    else if (id === 'stay') {
      const i = state.db.rows.findIndex((r) => isStay(r));
      if (i >= 0) openTableWith(stay, String(state.view.rows[i][stay]));
    }
    else if (id === 'comp') showTab('p-comp');
    else if (id === 'stuc') openTableWith(state.view.fields.length - 1, '−');
    else if (id === 'issues') { editUi.mode = iss.bad.length ? 'bad' : iss.dups.length ? 'dup' : 'all'; renderEdit(); showTab('p-edit'); }
    else showTab('p-table');
  }));
}
