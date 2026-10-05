/* global state, $, esc, Match, Filters, showTab, renderTable, defaultTable, dbFieldIdx, companyGroups, studentContract, jshshirIssues, renderCompanies, editUi, renderEdit */
'use strict';
// Dashboard: barcha asosiy ko'rsatkichlar bir joyda.

const dashUi = { more: new Set() };

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
  state.table.filters = [f];
  if (!state.table.cols.includes(field)) state.table.cols.push(field);
  renderTable();
  showTab('p-table');
}

function openTablePreset(filters) {
  if (!state.table) state.table = defaultTable();
  state.table.filters = filters;
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
  const rows = db.rows, total = rows.length;
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
  const working = pay.length ? state.db.rows.filter((r) => pay.some((i) => filled(r, i))).length : null;
  const stays = stay >= 0 ? state.db.rows.filter((r) => /қолади|qoladi/i.test(String(r[stay] ?? '')) && !/қолмайди|qolmaydi/i.test(String(r[stay] ?? ''))).length : null;
  const comp = companyGroups();
  const compN = comp ? comp.list.length : 0;
  const compWith = comp ? comp.list.filter((c) => c.contract).length : 0;
  const stuWith = state.db.rows.filter((r) => studentContract(r).on).length;
  const iss = jshshirIssues(state.db);
  const problems = iss.bad.length + iss.dups.length;
  const groupsN = gi >= 0 ? new Set(rows.map((r) => r[gi]).filter((v) => v != null)).size : 0;

  const kpis = [
    kpi({ id: 'total', label: "Jami o'quvchilar", icon: '👥', value: total, sub: groupsN ? `${groupsN} ta guruh` : '' }),
    working != null && kpi({ id: 'work', label: 'Ishlaydiganlar (oylik oladi)', icon: '💼', value: working, of: total, pct: pct(working), sub: `${Math.round(pct(working))}% · bosib ro'yxatni oching` }),
    stays != null && kpi({ id: 'stay', label: 'Korxonada ishda qoladi', icon: '🏭', value: stays, of: total, pct: pct(stays), sub: `${Math.round(pct(stays))}%` }),
    comp && kpi({ id: 'comp', label: 'Korxonalar', icon: '🏢', value: compN, sub: `korxona shartnomasi bor: ${compWith} ta`, pct: compN ? (compWith / compN) * 100 : 0 }),
    kpi({ id: 'stuc', label: "O'quvchi shartnomasi", icon: '📄', value: stuWith, of: total, pct: pct(stuWith), sub: `${total - stuWith} ta o'quvchida yo'q`, status: stuWith === total ? 'ok' : 'warn' }),
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
  if (comp) charts.push(barChart('c', "O'quvchilar soni bo'yicha korxonalar", comp.list.map((c) => [c.name, c.rows.length]), { limit: 10, hint: 'bosib korxonani oching' }));
  if (mi >= 0) charts.push(barChart('m', 'Yashash joyi (MFY)', countBy(rows, mi).sort(sortCnt), { limit: 10 }));
  else if (hi >= 0) charts.push(barChart('h', 'Yashash hududi', countBy(rows, hi).sort(sortCnt), { limit: 10 }));

  const d = new Date(state.db.editedAt || state.db.importedAt);
  box.innerHTML = `
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
      const isStay = (v) => /қолади|qoladi/i.test(String(v ?? '')) && !/қолмайди|qolmaydi/i.test(String(v ?? ''));
      const i = state.db.rows.findIndex((r) => isStay(r[stay]));
      if (i >= 0) openTableWith(stay, String(state.view.rows[i][stay]));
    }
    else if (id === 'comp') showTab('p-comp');
    else if (id === 'stuc') openTableWith(state.view.fields.length - 1, '−');
    else if (id === 'issues') { editUi.mode = iss.bad.length ? 'bad' : iss.dups.length ? 'dup' : 'all'; renderEdit(); showTab('p-edit'); }
    else showTab('p-table');
  }));
}
