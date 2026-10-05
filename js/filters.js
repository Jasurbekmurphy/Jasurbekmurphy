/* global Match */
// Filtrlar: qiymat tanlash, bo'sh / bo'sh emas, matn ichida, oraliq (dan–gacha).
// Shartlar "VA" / "YOKI" bilan bog'lanadi: YOKI bilan bog'langanlar bitta guruh,
// guruhlar o'zaro VA bilan. Masalan: A YOKI B, VA C  =>  (A ∨ B) ∧ C
(function (g) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const OPS = [
    ['in', 'Tanlash'],
    ['range', 'Oraliq'],
    ['contains', "So'z bor"],
    ['notempty', "To'ldirilgan"],
    ['empty', "Bo'sh"],
  ];

  // Taqqoslash uchun: raqam yoki sana (kk.oo.yyyy -> yyyymmdd)
  function comparable(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const s = String(v).trim();
    let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
    if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
    const n = Number(s.replace(',', '.'));
    return s !== '' && isFinite(n) ? n : null;
  }

  function isActive(f) {
    if (f.field === '' || f.field == null) return false;
    if (f.op === 'in') return f.values && f.values.length > 0;
    if (f.op === 'contains') return !!(f.text && f.text.trim());
    if (f.op === 'range') return comparable(f.from) != null || comparable(f.to) != null;
    return true;
  }

  function test(f, row) {
    const v = row[f.field];
    const empty = v == null || String(v).trim() === '';
    switch (f.op) {
      case 'in': return f.values.includes(String(v ?? ''));
      case 'notempty': return !empty;
      case 'empty': return empty;
      case 'contains': {
        const q = Match.norm(f.text);
        return !empty && Match.norm(v).includes(q);
      }
      case 'range': {
        const x = comparable(v);
        if (x == null) return false;
        const a = comparable(f.from), b = comparable(f.to);
        return (a == null || x >= a) && (b == null || x <= b);
      }
      default: return true;
    }
  }

  function apply(rows, filters) {
    const active = (filters || []).filter(isActive);
    if (!active.length) return rows;
    const groups = [];
    for (const f of active) {
      if (f.join === 'or' && groups.length) groups[groups.length - 1].push(f);
      else groups.push([f]);
    }
    return rows.filter((r) => groups.every((grp) => grp.some((f) => test(f, r))));
  }

  function newFilter(field = '') { return { field, op: 'in', values: [], text: '', from: '', to: '', join: 'and' }; }

  // Tayyor filtrlar: bazadagi ustun nomlariga qarab
  function presets(db) {
    const out = [];
    const idx = (pred) => db.fields.map((f, i) => (pred(Match.canon(f.name)) ? i : -1)).filter((i) => i >= 0);
    const pay = idx((c) => c.includes('oylik') && !c.endsWith('asosi'));
    if (pay.length) {
      out.push({
        name: 'Ishlaydiganlar (oylik oladi)',
        filters: pay.map((field, k) => ({ ...newFilter(field), op: 'notempty', join: k ? 'or' : 'and' })),
      });
    }
    const stay = idx((c) => c.includes('ishdaqolad'));
    if (stay.length) {
      out.push({ name: 'Korxonada ishda qoladi', filters: [{ ...newFilter(stay[0]), values: ['Қолади'] }] });
    }
    return out;
  }

  // Shartning qisqa matni (masalan: "Гурухи: 50 – 52")
  function describe(db, f) {
    const name = db.fields[f.field] ? db.fields[f.field].name : '';
    switch (f.op) {
      case 'in': return `${name}: ${f.values.length <= 3 ? f.values.map((v) => v || "(bo'sh)").join(', ') : f.values.length + ' ta qiymat'}`;
      case 'notempty': return `${name}: to'ldirilgan`;
      case 'empty': return `${name}: bo'sh`;
      case 'contains': return `${name}: «${f.text}»`;
      case 'range': return `${name}: ${f.from || '…'} – ${f.to || '…'}`;
      default: return name;
    }
  }

  /**
   * Filtr muharriri.
   * @param {HTMLElement} box
   * @param {{fields:Array, rows:Array}} db
   * @param {Array} filters  (joyida o'zgartiriladi)
   * @param {Function} onChange
   */
  function render(box, db, filters, onChange) {
    const pre = presets(db);
    const valueCounts = (field) => {
      const counts = new Map();
      for (const r of db.rows) { const v = String(r[field] ?? ''); counts.set(v, (counts.get(v) || 0) + 1); }
      return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'uz', { numeric: true }));
    };
    const fieldSelect = (fi, f) => `
      <select data-fi="${fi}" class="filter-field">
        <option value="">Ustunni tanlang…</option>
        ${db.fields.map((x, i) => `<option value="${i}" ${f.field === i ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
      </select>`;

    box.innerHTML = `
      <div class="fl">
      ${pre.length ? `<div class="fl-presets"><span class="fl-cap">Tayyor:</span>${pre.map((p, i) => `<button class="pill" data-preset="${i}">${esc(p.name)}</button>`).join('')}</div>` : ''}
      ${filters.map((f, fi) => {
        let body = '';
        if (f.field !== '') {
          if (f.op === 'in') {
            const vc = valueCounts(f.field);
            body = `${vc.length > 8 ? `<input type="search" class="chip-search" placeholder="Qiymat qidirish…">` : ''}
              <div class="chips">${vc.map(([v, n]) =>
              `<label class="chip ${f.values.includes(v) ? 'on' : ''}"><input type="checkbox" data-fi="${fi}" value="${esc(v)}" ${f.values.includes(v) ? 'checked' : ''}><span class="cv">${esc(v || "(bo'sh)")}</span><span class="cn">${n}</span></label>`).join('')}</div>`;
          } else if (f.op === 'contains') {
            body = `<input type="search" class="fl-input" data-fi="${fi}" data-k="text" value="${esc(f.text)}" placeholder="Qidiriladigan so'z, masalan: MChJ">`;
          } else if (f.op === 'range') {
            body = `<div class="range">
              <label><span>dan</span><input data-fi="${fi}" data-k="from" value="${esc(f.from)}" placeholder="50 yoki 01.01.2009" inputmode="decimal"></label>
              <label><span>gacha</span><input data-fi="${fi}" data-k="to" value="${esc(f.to)}" placeholder="52 yoki 31.12.2009" inputmode="decimal"></label>
            </div><p class="fl-note">Chegaralar ham kiradi: 50 – 52 → 50, 51 va 52.</p>`;
          }
        }
        return `
          ${fi > 0 ? `<div class="fl-join"><div class="seg">
              <button data-join="${fi}" data-v="and" class="${f.join !== 'or' ? 'on' : ''}">VA</button>
              <button data-join="${fi}" data-v="or" class="${f.join === 'or' ? 'on' : ''}">YOKI</button>
            </div><span class="fl-hint">${f.join === 'or' ? 'ikkalasidan biri bajarilsa yetarli' : 'ikkala shart ham bajarilsin'}</span></div>` : ''}
          <div class="cond ${isActive(f) ? 'active' : ''}">
            <div class="cond-head">
              <span class="cond-no">${fi + 1}</span>
              ${fieldSelect(fi, f)}
              <button class="icon-btn" data-rm="${fi}" title="Shartni o'chirish" aria-label="O'chirish">✕</button>
            </div>
            ${f.field !== '' ? `<div class="ops">${OPS.map(([v, t]) => `<button class="op ${f.op === v ? 'on' : ''}" data-op="${v}" data-fi="${fi}">${t}</button>`).join('')}</div>` : '<p class="fl-note">Qaysi ustun bo\'yicha filtrlashni tanlang.</p>'}
            ${body}
          </div>`;
      }).join('')}
      <div class="fl-actions">
        <button class="add-filter dashed">＋ Shart qo'shish</button>
        ${filters.length ? '<button class="clear-filters link">Hammasini tozalash</button>' : ''}
      </div>
      </div>`;

    const rerender = () => { render(box, db, filters, onChange); onChange(); };
    box.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => {
      filters.splice(0, filters.length, ...JSON.parse(JSON.stringify(pre[+b.dataset.preset].filters)));
      rerender();
    }));
    box.querySelectorAll('.filter-field').forEach((s) => (s.onchange = () => {
      const f = filters[+s.dataset.fi];
      f.field = s.value === '' ? '' : +s.value;
      f.values = [];
      rerender();
    }));
    box.querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => {
      filters[+b.dataset.fi].op = b.dataset.op;
      rerender();
    }));
    box.querySelectorAll('.chips input[type=checkbox]').forEach((cb) => (cb.onchange = () => {
      const f = filters[+cb.dataset.fi];
      f.values = cb.checked ? [...f.values, cb.value] : f.values.filter((v) => v !== cb.value);
      cb.closest('.chip').classList.toggle('on', cb.checked);
      cb.closest('.cond').classList.toggle('active', isActive(f));
      onChange();
    }));
    box.querySelectorAll('.chip-search').forEach((inp) => (inp.oninput = () => {
      const q = Match.norm(inp.value);
      inp.nextElementSibling.querySelectorAll('.chip').forEach((ch) => {
        ch.hidden = !!q && !Match.norm(ch.querySelector('.cv').textContent).includes(q);
      });
    }));
    box.querySelectorAll('input[data-k]').forEach((inp) => (inp.oninput = () => {
      const f = filters[+inp.dataset.fi];
      f[inp.dataset.k] = inp.value;
      inp.closest('.cond').classList.toggle('active', isActive(f));
      onChange();
    }));
    box.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => {
      filters[+b.dataset.join].join = b.dataset.v;
      rerender();
    }));
    box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { filters.splice(+b.dataset.rm, 1); rerender(); }));
    box.querySelector('.add-filter').onclick = () => { filters.push(newFilter()); rerender(); };
    const clr = box.querySelector('.clear-filters');
    if (clr) clr.onclick = () => { filters.splice(0); rerender(); };
  }

  g.Filters = { apply, render, newFilter, comparable, isActive, describe };
})(typeof window !== 'undefined' ? window : globalThis);
