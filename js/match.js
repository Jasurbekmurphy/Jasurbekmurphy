// Sarlavhalarni (ustun nomlarini) solishtirish: kirill/lotin farqi, tinish belgilari,
// qisqartmalar (Ф.И.Ш / F.I.O) e'tiborga olinmaydi.
(function (g) {
  const MAP = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
    ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
  };

  // Har bir guruhning birinchi elementi — kanonik shakl.
  const ALIASES = [
    ['fish', 'familiyaismisharifi', 'familiyaismisharif', 'familiyaismi', 'familiyasiismi', 'ismifamiliyasi', 'fio'],
    ['jshshir', 'pinfl', 'jshshr', 'jshir'],
    ['tugilgansana', 'tugilgankun'],
    ['pasport', 'passport'],
    ['telefon', 'tel'],
  ];

  function translit(s) {
    let o = '';
    for (const ch of String(s).toLowerCase()) o += ch in MAP ? MAP[ch] : ch;
    return o;
  }

  function norm(s) {
    if (s == null) return '';
    return translit(s).replace(/[’‘ʻʼ'`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function canon(s) {
    let c = norm(s).replace(/ /g, '');
    for (const group of ALIASES) {
      for (const a of group.slice(1)) {
        if (a === 'tel') {
          if (c === 'tel' || c.startsWith('telraq')) c = 'telefon' + c.slice(3);
        } else if (c.includes(a)) {
          c = c.split(a).join(group[0]);
        }
      }
    }
    return c;
  }

  function bigrams(s) {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const b = s.slice(i, i + 2);
      m.set(b, (m.get(b) || 0) + 1);
    }
    return m;
  }

  function similarity(a, b) {
    const x = canon(a), y = canon(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    let score = 0;
    if (short.length >= 4 && long.includes(short)) score = 0.6 + 0.4 * (short.length / long.length);
    const bx = bigrams(x), by = bigrams(y);
    let common = 0, total = 0;
    for (const [k, v] of bx) { total += v; if (by.has(k)) common += Math.min(v, by.get(k)); }
    for (const v of by.values()) total += v;
    if (total) score = Math.max(score, (2 * common) / total);
    return score;
  }

  // Ism-familiyani solishtirish uchun kalit
  function nameKey(s) { return norm(s); }
  function digits(s) { return s == null ? '' : String(s).replace(/\D+/g, ''); }

  g.Match = { norm, canon, similarity, nameKey, digits, THRESHOLD: 0.6 };
})(typeof window !== 'undefined' ? window : globalThis);
