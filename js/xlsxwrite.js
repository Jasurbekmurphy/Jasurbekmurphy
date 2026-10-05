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
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
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
      return { name, ...sheetXml(sh, L) };
    });

    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sh, i) => `<sheet name="${xmlEsc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((sh, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEsc(sh.name.replace(/'/g, "''"))}'!$A$${sh.headerRow}:$${L(sh.n - 1)}$${sh.lastRow}</definedName>`).join('')}</definedNames></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.file('xl/styles.xml', STYLES);
    sheets.forEach((sh, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sh.xml));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  g.XlsxWrite = { buildWorkbook };
})(typeof window !== 'undefined' ? window : globalThis);
