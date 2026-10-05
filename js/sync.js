// Bulutli baza: ma'lumot qurilmaning o'zida AES-256-GCM bilan shifrlanadi va GitHub
// repozitoriyga faqat shifrlangan holda yoziladi. Kodni bilmagan odam faylni o'qiy olmaydi.
// GitHub tokeni ham shu shifrlangan fayl ichida saqlanadi — boshqa qurilmada faqat kod kerak.
(function (g) {
  const CONFIG = {
    owner: 'Jasurbekmurphy',
    repo: 'Jasurbekmurphy',
    branch: 'claude/salom-qudvc3',
    path: 'data/baza.enc',
  };
  const ITER = 600000;
  const API = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.path}`;
  const enc = new TextEncoder(), dec = new TextDecoder();

  function toB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64.replace(/\s+/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  const canZip = typeof CompressionStream !== 'undefined';

  async function deriveKey(password, salt, iter = ITER) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function seal(session, obj) {
    let bytes = enc.encode(JSON.stringify(obj));
    let z = '';
    if (canZip) { bytes = await pipe(bytes, new CompressionStream('gzip')); z = 'gzip'; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.key, bytes);
    return JSON.stringify({ v: 1, alg: 'AES-256-GCM/PBKDF2-SHA256', iter: session.iter, salt: toB64(session.salt), iv: toB64(iv), z, data: toB64(ct) });
  }

  async function open(envelopeText, password, key) {
    const e = JSON.parse(envelopeText);
    const salt = fromB64(e.salt);
    key = key || await deriveKey(password, salt, e.iter);
    let bytes;
    try {
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(e.iv) }, key, fromB64(e.data)));
    } catch (err) {
      throw new Error("Kod noto'g'ri");
    }
    if (e.z === 'gzip') bytes = await pipe(bytes, new DecompressionStream('gzip'));
    return { payload: JSON.parse(dec.decode(bytes)), session: { key, salt, iter: e.iter } };
  }

  async function newSession(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { key: await deriveKey(password, salt, ITER), salt, iter: ITER };
  }

  function headers(token, raw) {
    const h = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  async function apiError(res) {
    if (res.status === 401) return new Error("GitHub token noto'g'ri yoki muddati tugagan");
    if (res.status === 403 || res.status === 404) {
      const t = await res.text().catch(() => '');
      if (/rate limit/i.test(t)) return new Error("GitHub so'rovlar chegarasi tugadi, birozdan keyin urinib ko'ring");
      return new Error("GitHub token ushbu repozitoriyga yozish huquqiga ega emas");
    }
    return new Error('GitHub xatosi: ' + res.status);
  }

  // Bulutdagi faylning ma'lumoti: { sha, text } yoki null (hali yo'q)
  async function fetchRemote(token) {
    const url = `${API}?ref=${encodeURIComponent(CONFIG.branch)}&t=${Date.now()}`;
    const res = await fetch(url, { headers: headers(token), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw await apiError(res);
    const meta = await res.json();
    let text;
    if (meta.content && meta.encoding === 'base64') {
      text = dec.decode(fromB64(meta.content));
    } else {
      const raw = await fetch(url, { headers: headers(token, true), cache: 'no-store' });
      if (!raw.ok) throw await apiError(raw);
      text = await raw.text();
    }
    return { sha: meta.sha, text };
  }

  async function remoteSha(token) {
    const res = await fetch(`${API}?ref=${encodeURIComponent(CONFIG.branch)}&t=${Date.now()}`, { headers: headers(token), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw await apiError(res);
    return (await res.json()).sha;
  }

  async function putRemote(token, text, sha) {
    const body = (s) => JSON.stringify({
      message: 'Baza yangilandi (shifrlangan)',
      content: toB64(enc.encode(text)),
      branch: CONFIG.branch,
      ...(s ? { sha: s } : {}),
    });
    const res = await fetch(API, { method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: body(sha) });
    if (res.status === 409 || res.status === 422) {
      // Boshqa qurilma oraliqda yozgan — ustidan yozilmaydi, avval birlashtirish kerak
      const err = new Error('Bulutdagi baza boshqa qurilmada o\'zgargan');
      err.conflict = true;
      throw err;
    }
    if (!res.ok) throw await apiError(res);
    return (await res.json()).content.sha;
  }

  g.Sync = { CONFIG, toB64, fromB64, seal, open, newSession, fetchRemote, remoteSha, putRemote };
})(typeof window !== 'undefined' ? window : globalThis);
