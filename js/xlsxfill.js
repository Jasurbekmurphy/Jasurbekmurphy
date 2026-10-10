// Excel (.xlsx) faylga faqat kerakli kataklarning qiymatini yozadi.
// Fayl ichidagi boshqa hamma narsa (formatlash, birlashtirilgan kataklar, formulalar,
// boshqa varaqlar, rasmlar) baytma-bayt o'zgarmasdan qoladi.
(function (g) {
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function colToLetters(c) { // 0 -> A
    let s = '';
    c += 1;
    while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }
  function lettersToCol(s) {
    let c = 0;
    for (const ch of s.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    return c - 1;
  }
  function parseRef(ref) {
    const m = /^([A-Z]+)(\d+)$/i.exec(ref);
    return m ? { c: lettersToCol(m[1]), r: parseInt(m[2], 10) - 1 } : null;
  }

  function resolvePath(target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = ('xl/' + target).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
    return out.join('/');
  }

  async function sheetPath(zip, sheetName) {
    const parser = new DOMParser();
    const wb = parser.parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml');
    const rels = parser.parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml');
    const sheets = [...wb.getElementsByTagName('sheet')];
    const sheet = sheets.find((s) => s.getAttribute('name') === sheetName);
    if (!sheet) throw new Error('Varaq topilmadi: ' + sheetName);
    let rid = sheet.getAttribute('r:id');
    if (!rid) {
      for (const a of sheet.attributes) if (a.localName === 'id') rid = a.value;
    }
    const rel = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
    if (!rel) throw new Error('Varaq fayli topilmadi');
    return resolvePath(rel.getAttribute('Target'));
  }

  /**
   * @param {ArrayBuffer} buf     asl .xlsx fayl
   * @param {string} sheetName    to'ldiriladigan varaq
   * @param {Array<{r:number,c:number,value:any}>} writes  0 dan boshlanuvchi indekslar
   * @param {{styleRow?:number, onlyEmpty?:boolean}} opts
   *        styleRow — yangi yaratilgan kataklar uchun formatlash nusxalanadigan qator
   * @returns {Promise<{blob:Blob, written:number, skipped:number}>}
   */
  async function fillWorkbook(buf, sheetName, writes, opts = {}) {
    const zip = await JSZip.loadAsync(buf);
    const path = await sheetPath(zip, sheetName);
    const doc = new DOMParser().parseFromString(await zip.file(path).async('string'), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Varaq XML faylini o\'qib bo\'lmadi');
    const NS = doc.documentElement.namespaceURI;
    const sheetData = doc.getElementsByTagNameNS(NS, 'sheetData')[0];

    // Qator va kataklar xaritasi (r atributi bo'lmasa — tartib bo'yicha hisoblanadi)
    const rows = new Map();
    let nextRow = 0;
    for (const rowEl of [...sheetData.children]) {
      if (rowEl.localName !== 'row') continue;
      let r = rowEl.getAttribute('r') ? parseInt(rowEl.getAttribute('r'), 10) - 1 : nextRow;
      if (!rowEl.getAttribute('r')) rowEl.setAttribute('r', String(r + 1));
      nextRow = r + 1;
      const cells = new Map();
      let nextCol = 0;
      for (const cEl of [...rowEl.children]) {
        if (cEl.localName !== 'c') continue;
        let pos = cEl.getAttribute('r') ? parseRef(cEl.getAttribute('r')) : null;
        const c = pos ? pos.c : nextCol;
        if (!pos) cEl.setAttribute('r', colToLetters(c) + (r + 1));
        nextCol = c + 1;
        cells.set(c, cEl);
      }
      rows.set(r, { el: rowEl, cells });
    }

    const styleRow = opts.styleRow != null ? rows.get(opts.styleRow) : null;

    // Umumiy matnlar (sharedStrings): t="s" katak ichida faqat raqamli ishora bo'ladi
    let shared = null;
    const ssFile = zip.file('xl/sharedStrings.xml');
    if (ssFile) {
      const ss = new DOMParser().parseFromString(await ssFile.async('string'), 'application/xml');
      shared = [...ss.getElementsByTagNameNS(ss.documentElement.namespaceURI, 'si')].map((si) => si.textContent);
    }

    function getRow(r) {
      let row = rows.get(r);
      if (row) return row;
      const el = doc.createElementNS(NS, 'row');
      el.setAttribute('r', String(r + 1));
      if (styleRow) {
        for (const a of ['ht', 'customHeight', 's', 'customFormat']) {
          if (styleRow.el.hasAttribute(a)) el.setAttribute(a, styleRow.el.getAttribute(a));
        }
      }
      let before = null;
      for (const [rr, info] of rows) if (rr > r && (!before || rr < before.r)) before = { r: rr, el: info.el };
      sheetData.insertBefore(el, before ? before.el : null);
      row = { el, cells: new Map() };
      rows.set(r, row);
      return row;
    }

    function getCell(r, c) {
      const row = getRow(r);
      let el = row.cells.get(c);
      if (el) return el;
      el = doc.createElementNS(NS, 'c');
      el.setAttribute('r', colToLetters(c) + (r + 1));
      const styleCell = styleRow && styleRow.cells.get(c);
      const s = (styleCell && styleCell.getAttribute('s')) || row.el.getAttribute('s');
      if (s) el.setAttribute('s', s);
      let before = null;
      for (const [cc, cel] of row.cells) if (cc > c && (!before || cc < before.c)) before = { c: cc, el: cel };
      row.el.insertBefore(el, before ? before.el : null);
      row.cells.set(c, el);
      // Qatorning "spans" atributi eskirishi mumkin — u ixtiyoriy, olib tashlaymiz
      row.el.removeAttribute('spans');
      return el;
    }

    // Katakda haqiqiy (bo'sh bo'lmagan) qiymat bormi — bo'sh matn ("") va faqat bo'shliqlar bo'sh hisoblanadi
    function hasValue(el) {
      const isShared = el.getAttribute('t') === 's';
      return [...el.children].some((ch) => {
        if (ch.localName === 'is') return ch.textContent.trim() !== '';
        if (ch.localName !== 'v' || ch.textContent === '') return false;
        if (isShared && shared) return String(shared[+ch.textContent] ?? '').trim() !== '';
        return ch.textContent.trim() !== '';
      });
    }

    let written = 0, skipped = 0, maxR = -1, maxC = -1;
    for (const w of writes) {
      if (w.value == null || w.value === '') continue;
      const existing = rows.get(w.r) && rows.get(w.r).cells.get(w.c);
      if (existing) {
        const hasFormula = [...existing.children].some((ch) => ch.localName === 'f');
        if (hasFormula || (opts.onlyEmpty && hasValue(existing))) { skipped++; continue; }
      }
      const el = getCell(w.r, w.c);
      for (const ch of [...el.children]) if (ch.localName === 'v' || ch.localName === 'is') el.removeChild(ch);
      if (typeof w.value === 'number' && isFinite(w.value)) {
        el.removeAttribute('t');
        const v = doc.createElementNS(NS, 'v');
        v.textContent = String(w.value);
        el.appendChild(v);
      } else {
        el.setAttribute('t', 'inlineStr');
        const is = doc.createElementNS(NS, 'is');
        const t = doc.createElementNS(NS, 't');
        t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        t.textContent = String(w.value);
        is.appendChild(t);
        el.appendChild(is);
      }
      written++;
      maxR = Math.max(maxR, w.r);
      maxC = Math.max(maxC, w.c);
    }

    // <dimension> ni yangilash (agar yozilgan joy undan tashqarida bo'lsa)
    const dim = doc.getElementsByTagNameNS(NS, 'dimension')[0];
    if (dim && maxR >= 0) {
      const [a, b] = (dim.getAttribute('ref') || 'A1').split(':');
      const start = parseRef(a) || { r: 0, c: 0 };
      const end = parseRef(b || a) || start;
      const nr = Math.max(end.r, maxR), nc = Math.max(end.c, maxC);
      dim.setAttribute('ref', colToLetters(start.c) + (start.r + 1) + ':' + colToLetters(nc) + (nr + 1));
    }

    let xml = new XMLSerializer().serializeToString(doc);
    if (!xml.startsWith('<?xml')) xml = XML_DECL + xml;
    zip.file(path, xml);

    // Faylni ochganda formulalar (jami, COUNTIFS va h.k.) qayta hisoblansin
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    if (/<calcPr\b/.test(wbXml) && !/fullCalcOnLoad=/.test(wbXml)) {
      zip.file('xl/workbook.xml', wbXml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"'));
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return { blob, written, skipped };
  }

  g.XlsxFill = { fillWorkbook, colToLetters, lettersToCol };
})(typeof window !== 'undefined' ? window : globalThis);
