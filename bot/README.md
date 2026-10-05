# Davomat boti — o'rnatish yo'riqnomasi

> **O'z serveringiz bormi?** Unda [SERVER.md](SERVER.md) ga qarang — Cloudflare kerak emas.

Mas'ul shaxslar Telegram bot orqali korxonadagi o'quvchilar davomatini belgilaydi.
Natija saytdagi **"Mas'ul va davomat"** bo'limida jonli ko'rinadi.

Bot **Cloudflare Workers** da bepul ishlaydi (karta talab qilinmaydi).
Bir marta o'rnatiladi, taxminan 15 daqiqa.

## Botga nima yuboriladi?

Faqat davomat uchun kerakli minimum: mas'ul ismi / Telegram / telefon, korxona nomi,
o'quvchining **ism-familiyasi va guruhi**. JShShIR, pasport, telefon raqamlari
yuborilmaydi (o'quvchi qisqa shifrlangan kod bilan aniqlanadi).

---

## 1. Telegram bot yaratish

1. Telegram'da **@BotFather** ni oching → `/newbot`.
2. Bot nomini yozing (masalan: `Davomat Paxtaobod`).
3. Username yozing, oxiri `bot` bilan tugashi kerak (masalan: `paxtaobod_davomat_bot`).
4. BotFather bergan **token**ni nusxalang (`123456789:AA...` ko'rinishida).

## 2. Admin kalit

Saytda **Mas'ul va davomat → ⚙️ Bot** bo'limidagi **🎲** tugmasini bosing —
tasodifiy kalit yaratiladi. Uni nusxalab qo'ying (keyingi qadamlarda kerak).

## 3. Cloudflare

1. <https://dash.cloudflare.com/sign-up> — email bilan bepul ro'yxatdan o'ting.
2. **D1 baza:** chap menyu → **Storage & Databases → D1 SQL Database → Create** →
   nomi: `jadval-bot` → **Create**.
3. **Worker:** chap menyu → **Compute (Workers) → Workers & Pages → Create →
   Start with Hello World** → nomi: `jadval-bot` → **Deploy**.
4. **Kod:** **Edit code** tugmasini bosing → chap tomondagi `worker.js` ichini
   to'liq o'chiring → shu papkadagi [`worker.js`](worker.js) faylining **hammasini**
   nusxalab qo'ying → o'ng yuqorida **Deploy**.
5. **Bazani ulash:** Worker sahifasi → **Settings → Bindings → Add → D1 database** →
   Variable name: `DB`, D1 database: `jadval-bot` → **Add/Deploy**.
6. **Maxfiy sozlamalar:** **Settings → Variables and Secrets → Add**:
   - Type **Secret**, Name `BOT_TOKEN`, Value — 1-qadamdagi token;
   - Type **Secret**, Name `ADMIN_KEY`, Value — 2-qadamdagi kalit;
   - **Deploy**.

## 4. Botni ishga tushirish

Worker manzilini oling (Worker sahifasida, masalan
`https://jadval-bot.ismingiz.workers.dev`) va brauzerda oching:

```
https://jadval-bot.ismingiz.workers.dev/setup?key=ADMIN_KEY
```

(`ADMIN_KEY` o'rniga o'z kalitingiz). **"✅ Tayyor! Bot @... ishga tushdi"** chiqishi kerak.

## 5. Saytga ulash

Saytda **Mas'ul va davomat → ⚙️ Bot**:
- **Bot manzili:** `https://jadval-bot.ismingiz.workers.dev`
- **Admin kalit:** 2-qadamdagi kalit
- **Saqlash va tekshirish** → "✅ Ulangan: @bot_nomi".

## 6. Ishlatish

1. **👤 Mas'ullar** bo'limida mas'ullarni qo'shing (F.I.Sh, Telegram username va/yoki telefon).
2. Har bir korxonaga mas'ul tanlang (guruh bo'yicha filtr va "ro'yxatdagilarning hammasini
   biriktirish" tugmasi bor). Ro'yxat botga avtomatik yuboriladi.
3. Mas'ullarga bot havolasini yuboring (`t.me/bot_nomi`). Ular **Start** bosadi —
   bot ularni username yoki telefon raqami orqali taniydi.
4. Mas'ul korxonaga borib: **📋 Davomat** → korxonani tanlaydi → har bir o'quvchini bosib
   ✅ keldi / ❌ kelmadi qiladi → **💾 Saqlash**.
5. Saytda **📊 Davomat** bo'limi har 30 soniyada yangilanadi. Bugun davomat yubormagan
   mas'ulning korxonasi **"❌ Bormadi"** deb ko'rinadi. Istalgan kunni tanlab ko'rish va
   Excel'ga yuklab olish mumkin.

## Muammo bo'lsa

| Belgi | Sabab |
|---|---|
| `/setup` da "Kalit noto'g'ri" | Manzildagi `key=` qiymati `ADMIN_KEY` bilan bir xil emas |
| `/setup` da "BOT_TOKEN ni tekshiring" | Token noto'g'ri nusxalangan |
| "D1 bazasi ulanmagan" | 5-qadam: Binding nomi aynan `DB` bo'lishi kerak |
| Saytda "Kalit noto'g'ri" | Saytdagi kalit Cloudflare'dagi `ADMIN_KEY` bilan bir xil emas |
| Bot mas'ulni tanimaydi | Saytda username yoki telefon to'g'ri yozilganini tekshiring va ro'yxatni botga qayta yuboring |
| Bot javob bermayapti | `/setup?key=...` ni qayta oching |

Bepul tarif: kuniga 100 000 so'rov va 5 GB baza — yuzlab mas'ul uchun yetarli.
