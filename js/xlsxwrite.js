/* global JSZip, XlsxFill */
// Yangi, chiroyli formatlangan .xlsx jadval yaratish (sarlavha, chegaralar, ustun kengligi,
// muzlatilgan sarlavha qatori va avtofiltr bilan).
(function (g) {
  const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
    // XML da ruxsat etilmagan boshqaruv belgilarini olib tashlash
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="9"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function cell(ref, v, s) {
    if (v == null || v === '') return `<c r="${ref}" s="${s}"/>`;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${s === 1 ? 4 : s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }

  // Bitta varaq XML'i
  function sheetXml(t, L) {
    const n = Math.max(1, t.headers.length);
    let r = 1;
    const rowsXml = [];
    let merge = '';
    if (t.title) {
      rowsXml.push(`<row r="1" ht="36" customHeight="1">${cell('A1', t.title, 3)}</row>`);
      if (n > 1) merge = `<mergeCells count="1"><mergeCell ref="A1:${L(n - 1)}1"/></mergeCells>`;
      r = 3;
    }
    const headerRow = r;
    rowsXml.push(`<row r="${r}">${t.headers.map((h, c) => cell(L(c) + r, h, 2)).join('')}</row>`);
    for (const row of t.rows) {
      r++;
      rowsXml.push(`<row r="${r}">${row.map((v, c) => cell(L(c) + r, v, 1)).join('')}</row>`);
    }
    // Bo'sh qatorlar (shablon uchun — chegarali kataklar)
    for (let k = 0; k < (t.blankRows || 0); k++) {
      r++;
      rowsXml.push(`<row r="${r}">${t.headers.map((_, c) => cell(L(c) + r, null, 1)).join('')}</row>`);
    }
    // Ustun kengligi: eng uzun qiymatga qarab (6…50)
    const widths = t.headers.map((h, c) => {
      let w = Math.min(String(h).length, 30);
      for (const row of t.rows) w = Math.max(w, String(row[c] ?? '').length);
      return Math.max(6, Math.min(50, Math.max(w + 2, (t.minWidths && t.minWidths[c]) || 0)));
    });
    const lastRef = L(n - 1) + Math.max(r, headerRow);
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
<autoFilter ref="A${headerRow}:${lastRef}"/>
${merge}
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToHeight="0"/>
</worksheet>`;
    return { xml, headerRow, lastRow: Math.max(r, headerRow), n };
  }

  /**
   * Bitta varaq: {title?, sheetName?, headers, rows}
   * Bir nechta varaq: {sheets: [{title?, sheetName, headers, rows, blankRows?}, ...]}
   * @returns {Promise<Blob>}
   */
  async function buildWorkbook(t) {
    const L = XlsxFill.colToLetters;
    const list = t.sheets || [t];
    const used = new Set();
    const sheets = list.map((sh, i) => {
      let name = (sh.sheetName || 'Jadval').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Jadval';
      while (used.has(name.toLowerCase())) name = (name.slice(0, 28) + ' ' + (i + 1));
      used.add(name.toLowerCase());
      return { name, ...(t._xml || sheetXml)(sh, L) };
    });

    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sh, i) => `<sheet name="${xmlEsc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${t._xml ? '' : sheets.map((sh, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEsc(sh.name.replace(/'/g, "''"))}'!$A$${sh.headerRow}:$${L(sh.n - 1)}$${sh.lastRow}</definedName>`).join('')}</definedNames></workbook>`.replace('<definedNames></definedNames>', ''));
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.file('xl/styles.xml', STYLES);
    sheets.forEach((sh, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sh.xml));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---- Oylik davomat jadvali (qog'oz shakli): №, F.I.Sh, Kurs, Guruh, Korxona, 1..31 kun, Jami, Mas'ul
  // sheets: [{sheetName, title, monthLabel, days, weekdays[], rows: [{cells:[fish,kurs,guruh,korxona], marks[], off[], total, masul}]}]
  function registerXml(t, L) {
    const n = t.days;
    const D0 = 5;                       // F ustundan kunlar
    const tc = D0 + n, mc = tc + 1;     // Jami, Mas'ul
    const last = L(mc);
    const rows = [], merges = [];
    rows.push(`<row r="1" ht="30" customHeight="1">${cell('A1', t.title, 3)}</row>`);
    merges.push(`A1:${last}1`);
    rows.push(`<row r="2">${cell('B2', 'Гуруҳ раҳбари (мураббий): ______________________', 6)}</row>`);
    rows.push(`<row r="3">${cell('B3', 'Техникум директори: ______________________', 6)}</row>`);
    const h1 = 5, h2 = 6;
    const fixed = ['№', 'Ф.И.Ш', 'Курс (босқич)', 'Гуруҳ', 'Бириктирилган корхона номи'];
    let r5 = fixed.map((h, c) => cell(L(c) + h1, h, 2)).join('');
    r5 += cell(L(D0) + h1, t.monthLabel, 2);
    for (let d = 1; d < n; d++) r5 += cell(L(D0 + d) + h1, null, 2);
    r5 += cell(L(tc) + h1, 'Жами келган / қолдирган кун', 8) + cell(L(mc) + h1, 'Масъул ходим', 2);
    rows.push(`<row r="${h1}" ht="22" customHeight="1">${r5}</row>`);
    let r6 = fixed.map((_, c) => cell(L(c) + h2, null, 2)).join('');
    for (let d = 0; d < n; d++) r6 += cell(L(D0 + d) + h2, d + 1, t.weekdays[d] === 0 ? 9 : 8);
    r6 += cell(L(tc) + h2, null, 8) + cell(L(mc) + h2, null, 2);
    rows.push(`<row r="${h2}" ht="22" customHeight="1">${r6}</row>`);
    fixed.forEach((_, c) => merges.push(`${L(c)}${h1}:${L(c)}${h2}`));
    merges.push(`${L(D0)}${h1}:${L(D0 + n - 1)}${h1}`, `${L(tc)}${h1}:${L(tc)}${h2}`, `${L(mc)}${h1}:${L(mc)}${h2}`);
    let r = h2;
    t.rows.forEach((x, i) => {
      r++;
      let xml = cell('A' + r, i + 1, 4) + x.cells.map((v, c) => cell(L(c + 1) + r, v, c === 1 || c === 2 ? 4 : 1)).join('');
      for (let d = 0; d < n; d++) {
        const v = x.marks[d];
        xml += cell(L(D0 + d) + r, v, v === 'н' ? 7 : x.off[d] ? 5 : 4);
      }
      xml += cell(L(tc) + r, x.total, 4) + cell(L(mc) + r, x.masul, 1);
      rows.push(`<row r="${r}">${xml}</row>`);
    });
    const widths = [4, 34, 8, 8, 26, ...Array(n).fill(3.6), 11, 26];
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${last}${Math.max(r, h2)}"/>
<sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="${h2}" topLeftCell="C${h2 + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>
<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
    return { xml, headerRow: h2, lastRow: Math.max(r, h2), n: mc + 1 };
  }

  async function buildRegister(t) {
    return buildWorkbook({ ...t, _xml: registerXml });
  }

  g.XlsxWrite = { buildWorkbook, buildRegister };
})(typeof window !== 'undefined' ? window : globalThis);
