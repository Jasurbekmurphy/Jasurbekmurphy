// O'zbek tili: kirill ↔ lotin o'giruvchi (rasmiy imlo qoidalariga yaqin).
(function (g) {
  const VOWELS_CYR = 'аеёиоуўэюяы';

  const C2L = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
    м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch',
    ш: 'sh', щ: 'sh', ъ: "'", ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
  };

  const isUpper = (ch) => ch !== ch.toLowerCase();
  const isCyr = (ch) => /[Ѐ-ӿ]/.test(ch);

  function toLatin(s) {
    if (s == null || typeof s !== 'string' || !/[Ѐ-ӿ]/.test(s)) return s;
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const lo = ch.toLowerCase();
      if (!isCyr(ch)) { out += ch; continue; }
      const prev = s[i - 1] ? s[i - 1].toLowerCase() : '';
      let t;
      if (lo === 'е') {
        // so'z boshida yoki unli/ъ/ь dan keyin: "ye"
        t = (!prev || !isCyr(prev) || VOWELS_CYR.includes(prev) || prev === 'ъ' || prev === 'ь') ? 'ye' : 'e';
      } else if (lo === 'ц') {
        t = (!prev || !isCyr(prev) || VOWELS_CYR.includes(prev)) ? 'ts' : 's';
      } else {
        t = C2L[lo];
        if (t === undefined) { out += ch; continue; }
      }
      if (isUpper(ch) && t) {
        const isL = (c) => c && c.toLowerCase() !== c.toUpperCase();
        const next = s[i + 1], prv = s[i - 1];
        const capsWord = (isL(next) && isUpper(next)) || (isL(prv) && isUpper(prv) && !isL(next));
        t = capsWord ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1);
      }
      out += t;
    }
    return out;
  }

  const APOS = "['‘’ʻʼ`´]";
  const L2C_MULTI = [
    [new RegExp('o' + APOS, 'gi'), 'ў'],
    [new RegExp('g' + APOS, 'gi'), 'ғ'],
    [/sh/gi, 'ш'], [/ch/gi, 'ч'], [/yo/gi, 'ё'], [/yu/gi, 'ю'], [/ya/gi, 'я'], [/ye/gi, 'е'],
  ];
  const L2C = {
    a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м',
    n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з', c: 'с', w: 'в',
  };

  function toCyrillic(s) {
    if (s == null || typeof s !== 'string' || !/[A-Za-z]/.test(s)) return s;
    // Rim raqamlari, lotin qisqartmalari (MFY, IT...) va raqam-harf kodlar o'zgarmasin
    return s.replace(/[A-Za-z'‘’ʻʼ`´]+/g, (word) => {
      if (/^[IVXLCDM]+$/.test(word) && word.length <= 4) return word;
      let w = word;
      const upperWord = w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
      // ko'p harfli birikmalar
      for (const [re, cyr] of L2C_MULTI) {
        w = w.replace(re, (m) => (isUpper(m[0]) ? cyr.toUpperCase() : cyr));
      }
      let out = '';
      for (let i = 0; i < w.length; i++) {
        const ch = w[i];
        const lo = ch.toLowerCase();
        if (/['‘’ʻʼ`´]/.test(ch)) { out += i > 0 && i < w.length - 1 ? 'ъ' : ch; continue; }
        if (lo === 'e' && i === 0) { out += isUpper(ch) ? 'Э' : 'э'; continue; }
        const t = L2C[lo];
        if (!t) { out += ch; continue; }
        out += isUpper(ch) ? t.toUpperCase() : t;
      }
      return upperWord ? out.toUpperCase() : out;
    });
  }

  function convert(v, mode) {
    if (typeof v !== 'string' || !mode || mode === 'orig') return v;
    return mode === 'lat' ? toLatin(v) : toCyrillic(v);
  }

  g.Translit = { toLatin, toCyrillic, convert };
})(typeof window !== 'undefined' ? window : globalThis);
