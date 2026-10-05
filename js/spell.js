/* global Match */
'use strict';
// Imlo tekshiruvi: ortiqcha bo'shliqlar, kirill/lotin harflari aralashuvi,
// F.I.Sh dagi katta-kichik harf xatolari va "қизи / ўғли" qo'shimchalari.
(function (g) {
  // Ko'rinishi bir xil harflar
  const L2C = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
  const C2L = Object.fromEntries(Object.entries(L2C).map(([l, c]) => [c, l]));
  const CYR = /[Ѐ-ӿ]/g, LAT = /[A-Za-z]/g;

  // Bitta so'zdagi aralash harflarni ko'pchilik yozuvga keltirish
  function fixScript(word) {
    const nc = (word.match(CYR) || []).length, nl = (word.match(LAT) || []).length;
    if (!nc || !nl) return word;
    // teng bo'lsa: raqamli kod (pasport seriyasi) — lotin, aks holda kirill
    const toCyr = nc > nl || (nc === nl && !/\d/.test(word));
    return [...word].map((ch) => (toCyr ? L2C[ch] || ch : C2L[ch] || ch)).join('');
  }

  const SUFFIX = {
    'қизи': 'қизи', 'кизи': 'қизи', 'кизы': 'қизи', 'қизы': 'қизи',
    'ўғли': 'ўғли', 'ўгли': 'ўғли', 'угли': 'ўғли', 'уғли': 'ўғли', 'огли': 'ўғли', 'оғли': 'ўғли',
    'qizi': 'qizi', 'kizi': 'qizi',
    "o'g'li": "o'g'li", 'ogli': "o'g'li", "o'gli": "o'g'li", "og'li": "o'g'li", 'ugli': "o'g'li", "u'g'li": "o'g'li",
  };
  const normApos = (s) => s.replace(/[‘’ʻʼ`´]/g, "'");

  function titleCase(word) {
    return word.split('-').map((part) => {
      const chars = [...part];
      const i = chars.findIndex((c) => c.toLowerCase() !== c.toUpperCase());
      if (i < 0) return part;
      return chars.slice(0, i).join('') + chars[i].toUpperCase() + chars.slice(i + 1).join('').toLowerCase();
    }).join('-');
  }

  /**
   * @param {string} v
   * @param {'name'|'company'|'text'} kind
   */
  function fixValue(v, kind) {
    if (typeof v !== 'string') return v;
    let s = v.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
    s = s.split(/(\s+)/).map((w) => (/\s/.test(w) ? w : fixScript(w))).join('');
    if (kind === 'name') {
      s = s.split(' ').map((w) => {
        const k = normApos(w.toLowerCase());
        if (SUFFIX[k]) return SUFFIX[k];
        // lotin yozuvida apostrof bir xil bo'lsin
        if (/[A-Za-z]/.test(w)) w = normApos(w);
        return titleCase(w);
      }).join(' ');
    }
    return s;
  }

  function fieldKind(f) {
    const c = Match.canon(f.name);
    if (c.includes('korxonanomi')) return 'company';
    if (c.includes('fish') || c.includes('familiya')) return 'name';
    if (c.includes('jshshir')) return 'skip';
    return 'text';
  }

  // Bazadagi barcha imlo xatolari: [{ri, fi, from, to}]
  function scan(db) {
    const kinds = db.fields.map((f) => (f.virtual ? 'skip' : fieldKind(f)));
    const out = [];
    db.rows.forEach((r, ri) => {
      kinds.forEach((k, fi) => {
        if (k === 'skip') return;
        const v = r[fi];
        if (typeof v !== 'string') return;
        const to = fixValue(v, k);
        if (to !== v) out.push({ ri, fi, from: v, to });
      });
    });
    return out;
  }

  g.Spell = { fixValue, scan, fixScript, titleCase };
})(typeof window !== 'undefined' ? window : globalThis);
