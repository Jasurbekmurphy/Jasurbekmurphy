/* global bandOf, bandUi, renderBand, fmtSum, dueOn, ownerOn, weekdayOf, attCompanies, botReady, botApi, tkToday, stuHash, hashCache, studentKey, attUi, renderAttendance, toast, Spell, companyKey, state, $, esc, Match, Filters, showTab, renderTable, defaultTable, dbFieldIdx, companyGroups, studentContract, jshshirIssues, renderCompanies, editUi, renderEdit */
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

// Virtual ustun (shartnoma belgilari) — yozuv rejimidan qat'i nazar o'zgarmas belgi bo'yicha
const vfield = (vid) => state.view.fields.findIndex((f) => f.vid === vid);

function openTableWith(field, value) {
  if (field == null || field < 0) throw new Error('ustun topilmadi');
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
  const orderWith = compList.filter((c) => c.order).length;
  const stuWith = raw.filter((r) => studentContract(r).on).length;
  const instN = raw.filter((r) => studentContract(r).src === 'inst').length;
  const cat4N = raw.filter((r) => studentContract(r).src === 'cat4').length;
  const need = total - instN - cat4N;
  const iss = jshshirIssues(state.db);
  const spellN = Spell.scan(state.db).length;
  const problems = iss.bad.length + iss.dups.length;
  // Bandlik (alohida bo'lim ma'lumotlari)
  const bands = raw.map(bandOf);
  const bWork = bands.filter((x) => x.w).length;
  const bOylik = bands.filter((x) => x.t === 'oylik').length;
  const bNaqd = bands.filter((x) => x.t === 'naqd').length;
  const bSums = bands.filter((x) => x.s).map((x) => x.s);
  const bAvg = bSums.length ? Math.round(bSums.reduce((a, b) => a + b, 0) / bSums.length) : 0;
  const groupsN = gi >= 0 ? new Set(rows.map((r) => r[gi]).filter((v) => v != null)).size : 0;

  const kpis = [
    kpi({ id: 'total', label: "Jami o'quvchilar", icon: '👥', value: total, sub: groupsN ? `${groupsN} ta guruh` : '' }),
    working != null && kpi({ id: 'work', label: 'Ishlaydiganlar (oylik oladi)', icon: '💼', value: working, of: total, pct: pct(working), sub: `${Math.round(pct(working))}% · bosib ro'yxatni oching` }),
    stays != null && kpi({ id: 'stay', label: 'Korxonada ishda qoladi', icon: '🏭', value: stays, of: total, pct: pct(stays), sub: `${Math.round(pct(stays))}%` }),
    comp && kpi({ id: 'comp', label: 'Korxonalar', icon: '🏢', value: compN, sub: `🤝 hamkorlik: ${compWith} · 📋 buyruq: ${orderWith}`, pct: compN ? (compWith / compN) * 100 : 0 }),
    kpi({ id: 'stuc', label: "O'quvchi shartnomasi", icon: '📄', value: stuWith, of: need, pct: need ? (stuWith / need) * 100 : 0,
      sub: `${need - stuWith} ta o'quvchida yo'q` + (instN ? ` · 🎓 ${instN} ta ta'lim muassasasida` : '') + (cat4N ? ` · ${cat4N} ta 4-toifa` : ''), status: stuWith === need ? 'ok' : 'warn' }),
    kpi({ id: 'band', label: 'Bandlik (rasmiy ishlaydi)', icon: '💼', value: bWork, of: total, pct: pct(bWork),
      sub: bWork || bOylik || bNaqd ? `💳 oylik: ${bOylik} · 💵 naqd: ${bNaqd}${bAvg ? ` · o'rtacha ${fmtSum(bAvg)} so'm` : ''}` : "hali kiritilmagan · bosib Bandlik bo'limini oching" }),
    cat4N ? kpi({ id: 'cat4', label: '4-toifa (korxonasiz)', icon: '🚫', value: cat4N, of: total, pct: pct(cat4N), sub: "korxonaga biriktirilmagan o'quvchilar · bosib ro'yxatni oching", status: 'warn' }) : null,
    kpi({ id: 'issues', label: "Ma'lumotdagi xatolar", icon: problems ? '⚠️' : '✓', value: problems, status: problems ? 'bad' : 'ok',
      sub: (problems ? `JShShIR xato: ${iss.bad.length} · dublikat: ${iss.dups.length}` : 'JShShIR hammasi to\'g\'ri') + (spellN ? ` · ✍️ imlo: ${spellN}` : '') }),
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
  if (bWork) {
    const per = new Map();
    for (const x of bands) if (x.w) per.set(x.w, (per.get(x.w) || 0) + 1);
    charts.push(barChart('b', 'Bandlik: ish joylari', [...per].sort(sortCnt), { limit: 10, hint: "bosib ro'yxatni oching" }));
    const pays = [['Oylik', bOylik], ['Naqd pul', bNaqd], ["Ko'rsatilmagan", bWork - bOylik - bNaqd]].filter(([, n]) => n > 0);
    charts.push(barChart('bt', "Bandlik: to'lov turi", pays, { hint: "bosib ro'yxatni oching" }));
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
    <div id="dash-att">${dashAttHtml()}</div>
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
    if (id === 'b' || id === 'bt') {
      Object.assign(bandUi, { q: id === 'b' ? v : '', group: '', kurs: dashUi.course || '', limit: 100,
        show: id === 'b' ? 'work' : v === 'Oylik' ? 'oylik' : v === 'Naqd pul' ? 'naqd' : 'work' });
      renderBand();
      showTab('p-band');
      return;
    }
    if (id === 'c') {
      state.compUi.q = v;
      renderCompanies();
      showTab('p-comp');
      return;
    }
    openTableWith(fieldOf[id], v);
  }));
  bindDashAtt();
  box.querySelectorAll('[data-kpi]').forEach((b) => (b.onclick = () => { try { kpiClick(b); } catch (e) { console.error(e); toast("Ochib bo'lmadi: " + e.message, 'err'); } }));
  function kpiClick(b) {
    const id = b.dataset.kpi;
    if (id === 'work') openTablePreset(pay.map((field, k) => ({ ...Filters.newFilter(field), op: 'notempty', join: k ? 'or' : 'and' })));
    else if (id === 'stay') {
      const i = state.db.rows.findIndex((r) => isStay(r));
      if (i >= 0) openTableWith(stay, String(state.view.rows[i][stay]));
    }
    else if (id === 'comp') showTab('p-comp');
    else if (id === 'band') { Object.assign(bandUi, { q: '', group: '', kurs: dashUi.course || '', show: 'all', limit: 100 }); renderBand(); showTab('p-band'); }
    else if (id === 'cat4') openTableWith(vfield('stu'), '4-toifa');
    else if (id === 'stuc') openTableWith(vfield('stu'), '−');
    else if (id === 'issues') { editUi.mode = iss.bad.length ? 'bad' : iss.dups.length ? 'dup' : 'all'; renderEdit(); showTab('p-edit'); }
    else showTab('p-table');
  }
}

// ---------------------------------------------------------------- Bugungi davomat
const dashAtt = { data: null, date: '', at: 0, err: '', loading: false, hashing: false, timer: null };

async function loadDashAtt() {
  if (!botReady() || dashAtt.loading) return;
  dashAtt.loading = true;
  const date = tkToday();
  try {
    dashAtt.data = await botApi('/api/attendance?date=' + date);
    dashAtt.date = date;
    dashAtt.err = '';
    dashAtt.at = Date.now();
  } catch (e) {
    dashAtt.err = e.message;
  }
  dashAtt.loading = false;
  refreshDashAtt();
}

function refreshDashAtt() {
  const el = $('#dash-att');
  if (!el) return;
  el.innerHTML = dashAttHtml();
  bindDashAtt();
}

function dashAttModel() {
  const ci = courseIdx();
  const inCourse = (r) => !dashUi.course || ci < 0 || String(r[ci] ?? '').trim() === dashUi.course;
  const { list, gi } = attCompanies();
  const day = tkToday();
  const items = new Map(((dashAtt.date === tkToday() && dashAtt.data && dashAtt.data.items) || []).map((x) => [x.ck, x]));
  const people = new Map(state.resp.people.map((p) => [p.id, p]));
  const per = new Map();
  const tot = { comp: 0, went: 0, yes: 0, no: 0, none: 0, free: 0, freeStu: 0 };
  for (const c of list) {
    const rows = c.rows.filter((r) => inCourse(r) && dueOn(r, gi, day)); // 3+3: bugun korxonada bo'ladiganlar
    if (!rows.length) continue;
    const pid = ownerOn(c.key, weekdayOf(day));
    if (!people.has(pid)) { tot.free++; tot.freeStu += rows.length; continue; }
    const it = items.get(c.key);
    if (!per.has(pid)) per.set(pid, { p: people.get(pid), comp: 0, went: 0, yes: 0, no: 0, none: 0, last: 0 });
    const g = per.get(pid);
    g.comp++; tot.comp++;
    if (it) { g.went++; tot.went++; g.last = Math.max(g.last, it.at || 0); }
    for (const r of rows) {
      const v = it ? it.marks[hashCache.get(studentKey(r))] : undefined;
      const k = v === 1 ? 'yes' : v === 0 ? 'no' : 'none';
      g[k]++; tot[k]++;
    }
  }
  const list2 = [...per.values()].map((g) => ({ ...g, st: g.went === g.comp ? 'ok' : g.went ? 'part' : 'none' }));
  const order = { none: 0, part: 1, ok: 2 };
  list2.sort((a, b) => order[a.st] - order[b.st] || a.p.name.localeCompare(b.p.name, 'uz'));
  return { tot, list: list2 };
}

function dashAttHtml() {
  if (!botReady() || !state.db) return '';
  if (!state.resp.people.length) return '';
  if (dashAtt.hashing || state.view.rows.some((r) => !hashCache.has(studentKey(r)))) {
    if (!dashAtt.hashing) {
      dashAtt.hashing = true;
      Promise.all(state.view.rows.map(stuHash)).then(() => { dashAtt.hashing = false; refreshDashAtt(); });
    }
    return '<div class="box dash-att"><p class="muted">Davomat tayyorlanmoqda…</p></div>';
  }
  const { tot, list } = dashAttModel();
  if (!list.length) return '';
  const stu = tot.yes + tot.no + tot.none;
  const pc = (n) => (stu ? (n / stu) * 100 : 0);
  const time = (ms) => new Date(ms).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' });
  const pOk = list.filter((g) => g.st === 'ok').length, pPart = list.filter((g) => g.st === 'part').length, pNone = list.length - pOk - pPart;
  const stLabel = { ok: '✅ Borgan', part: '🟡 Qisman borgan', none: '⬜ Bormagan · belgilanmagan' };
  const status = dashAtt.err ? `<span class="bad">⚠ ${esc(dashAtt.err)}</span>`
    : dashAtt.at ? `🟢 Jonli · ${time(dashAtt.at)}` : 'Yuklanmoqda…';
  return `
    <div class="box dash-att">
      <div class="chart-head"><h3>📋 Bugungi davomat · ${esc(tkToday().split('-').reverse().join('.'))}</h3><span>${status}</span></div>
      <div class="da-sum">
        <div class="da-col">
          <div class="da-h">Mas'ullar <b>${list.length}</b></div>
          <div class="da-chips">
            <span class="da-chip ok">✅ Borgan <b>${pOk}</b></span>
            ${pPart ? `<span class="da-chip part">🟡 Qisman <b>${pPart}</b></span>` : ''}
            <span class="da-chip none">⬜ Bormagan <b>${pNone}</b></span>
          </div>
          <div class="muted small">Korxonalar: ${tot.went} / ${tot.comp} ga borildi${tot.free ? ` · ${tot.free} tasiga mas'ul yo'q` : ''}</div>
        </div>
        <div class="da-col">
          <div class="da-h">O'quvchilar <b>${stu}</b></div>
          <div class="da-stack" role="img" aria-label="keldi ${tot.yes}, kelmadi ${tot.no}, belgilanmagan ${tot.none}">
            <i class="ok" style="width:${pc(tot.yes)}%"></i><i class="bad" style="width:${pc(tot.no)}%"></i><i class="none" style="width:${pc(tot.none)}%"></i>
          </div>
          <div class="da-chips">
            <span class="da-chip ok">✅ Keldi <b>${tot.yes}</b></span>
            <span class="da-chip bad">❌ Kelmadi <b>${tot.no}</b></span>
            <span class="da-chip none">⬜ Belgilanmagan <b>${tot.none}</b></span>
          </div>
        </div>
      </div>
      <div class="da-list">${list.map((g) => `
        <button class="da-row ${g.st}" data-att-open="${esc(g.p.name)}">
          <span class="da-name"><b>${esc(g.p.name)}</b><span class="da-st">${stLabel[g.st]}${g.last ? ' · ' + time(g.last) : ''}</span></span>
          <span class="da-nums">
            <span title="Korxonalar">🏢 ${g.went}/${g.comp}</span>
            <span class="ok" title="Keldi">✅ ${g.yes}</span>
            <span class="bad" title="Kelmadi">❌ ${g.no}</span>
            <span class="none" title="Belgilanmagan">⬜ ${g.none}</span>
          </span>
        </button>`).join('')}</div>
    </div>`;
}

function bindDashAtt() {
  const el = $('#dash-att');
  if (!el) return;
  el.querySelectorAll('[data-att-open]').forEach((b) => (b.onclick = () => {
    attUi.sub = 'att';
    attUi.date = tkToday();
    attUi.q = b.dataset.attOpen;
    attUi.data = null; attUi.at = 0; attUi.err = '';
    renderAttendance();
    showTab('p-att');
  }));
  if (botReady() && state.resp.people.length && !dashAtt.loading && (!dashAtt.at || dashAtt.date !== tkToday() || Date.now() - dashAtt.at > 30000) && !dashAtt.err) loadDashAtt();
}

// Dashboard ochiq bo'lsa — har 30 soniyada yangilanadi
dashAtt.timer = setInterval(() => {
  const p = $('#p-dash');
  if (p && !p.hidden && !document.hidden && botReady()) { dashAtt.err = ''; loadDashAtt(); }
}, 30000);
