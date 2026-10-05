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

  // ---- Shaxs ism-familiyasi: kirill/lotin va yozilishdagi farqlarga chidamli solishtirish
  const PMAP = { ...MAP, ў: 'o', ғ: 'g', қ: 'k', ҳ: 'x', ц: 's', е: 'e', ё: 'yo', ю: 'yu', я: 'ya', й: 'y', ы: 'i' };
  const SUFFIX = new Set(['qizi', 'kizi', 'kizy', 'qizy', 'ogli', 'ugli', 'ogly', 'ugly', 'oglu', 'uglu']);
  function personTokens(s) {
    if (s == null) return [];
    let t = '';
    for (const ch of String(s).toLowerCase()) t += ch in PMAP ? PMAP[ch] : ch;
    t = t.replace(/[’‘ʻʼ'`´]/g, '').replace(/[^a-z]+/g, ' ');
    return t.split(' ').filter(Boolean).map((w) => w
      .replace(/q/g, 'k').replace(/h/g, 'x').replace(/w/g, 'v')
      .replace(/(dj|zh)/g, 'j').replace(/ts/g, 's').replace(/ye/g, 'e').replace(/iy/g, 'i').replace(/yu/g, 'u').replace(/yo/g, 'o')
      .replace(/(.)\1+/g, '$1'))
      .filter((w) => !SUFFIX.has(w));
  }
  const personKey = (s) => personTokens(s).join(' ');

  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  const wsim = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);

  // 0..1: familiya va ism majburiy mos bo'lishi kerak, otasining ismi qo'shimcha
  function personScore(a, b) {
    const x = Array.isArray(a) ? a : personTokens(a), y = Array.isArray(b) ? b : personTokens(b);
    if (x.length < 2 || y.length < 2) return x.length && x.join(' ') === y.join(' ') ? 1 : 0;
    const f = wsim(x[0], y[0]), i = wsim(x[1], y[1]);
    if (f < 0.75 || i < 0.75) return 0;
    if (x.length > 2 && y.length > 2) {
      const o = wsim(x.slice(2).join(''), y.slice(2).join(''));
      return 0.4 * f + 0.4 * i + 0.2 * o;
    }
    return 0.5 * f + 0.5 * i - (x.length !== y.length ? 0.02 : 0); // otasining ismi bittasida yo'q
  }
  function digits(s) { return s == null ? '' : String(s).replace(/\D+/g, ''); }

  g.Match = { norm, canon, similarity, nameKey, digits, personTokens, personKey, personScore, THRESHOLD: 0.6 };
})(typeof window !== 'undefined' ? window : globalThis);
