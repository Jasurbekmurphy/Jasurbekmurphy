# Jadval Baza

Excel jadvaldan ma'lumotlar bazasi yaratib, topshiriq bilan kelgan boshqa jadvallarni
avtomatik to'ldiradigan veb-ilova. Kompyuterda ham, telefonda ham ishlaydi, internet
bo'lmasa ham ishlaydi.

## Imkoniyatlar

1. **Baza** — asosiy Excel jadvalni (masalan, "Номма ном" varag'i) yuklaysiz, ilova
   sarlavhalarni va o'quvchilar ro'yxatini o'zi topadi. Jadvalga o'zgartirish
   kiritgandan keyin uni qayta yuklasangiz, baza yangilanadi va **nima qo'shilgani,
   o'zgargani, o'chirilgani** ko'rsatiladi (JShShIR bo'yicha solishtiriladi).
2. **To'ldirish** — topshiriq bilan kelgan bo'sh jadvalni (.xlsx) yuklaysiz:
   - ustun nomlari bo'yicha bazadagi mos ustun avtomatik topiladi
     (kirill/lotin farqi, `Ф.И.Ш` / `F.I.Sh` / `FIO` kabi yozuvlar tushuniladi);
   - kerak bo'lsa moslashtirishni qo'lda o'zgartirasiz;
   - **Ro'yxat rejimi**: bazadan (filtr bilan, masalan faqat 50-guruh) yozuvlar ketma-ket yoziladi;
   - **To'ldirish rejimi**: jadvalda allaqachon F.I.Sh yoki JShShIR bor bo'lsa, o'sha odamlarning
     qolgan ma'lumotlari qo'yiladi, topilmaganlar ro'yxati ko'rsatiladi;
   - "To'ldirish va yuklab olish" — fayl **asl ko'rinishida** yuklab olinadi: formatlash,
     chegaralar, birlashtirilgan kataklar, formulalar, boshqa varaqlar o'zgarmaydi —
     faqat ma'lumot yozilgan kataklar o'zgaradi. Telefonda "Ulashish" tugmasi orqali
     to'g'ridan-to'g'ri Telegramga yuborish mumkin.
3. **Jadval** — ixtiyoriy jadval yaratish:
   - **filtrlar**: qiymat tanlash, "bo'sh emas / bo'sh", "matn ichida", **oraliq (dan–gacha)**
     (sana, guruh, raqam uchun); shartlar **VA / YOKI** bilan bog'lanadi;
   - tayyor filtrlar: **⚡ Ishlaydiganlar (oylik oladi)**, **⚡ Korxonada ishda qoladi**;
   - ustunlarni tanlash, tartibini o'zgartirish, saralash, natijadan qatorlar oralig'i, sarlavha;
   - chiroyli formatlangan Excel (chegaralar, muzlatilgan sarlavha, avtofiltr) yuklab olish;
   - tez-tez kerak bo'ladigan jadvalni **shablon** qilib saqlash;
   - tez qidirish va qatorni bosib odamning barcha ma'lumotini ko'rish.
4. **☁️ Bulutli baza (kod bilan)** — bazani boshqa kompyuter va telefonda ochish.

## Xavfsizlik

- Ma'lumotlar (pasport, JShShIR, telefon) qurilmaning brauzerida (IndexedDB) saqlanadi.
- Bulut yoqilsa, baza **qurilmaning o'zida AES-256-GCM bilan shifrlanadi** (kalit kirish
  kodidan PBKDF2-SHA256, 600 000 iteratsiya bilan olinadi) va repozitoriyga faqat
  shifrlangan `data/baza.enc` fayli yoziladi. Kodsiz bu faylni o'qib bo'lmaydi.
- GitHub tokeni ham shu shifrlangan fayl ichida — boshqa qurilmada faqat kod kerak.
- **Kod uzun va murakkab bo'lsin** (kamida 12 belgi, harf + raqam + belgi). Fayl ochiq
  repozitoriyda turgani uchun oddiy kodni taxmin qilib topish mumkin.
- Begona kompyuterda "Shu qurilmada eslab qolish" belgisini olib tashlang.
- Excel fayllar repozitoriyga tushmasligi uchun `.gitignore` da taqiqlangan.

## Ishga tushirish

**Telefonda va kompyuterda (tavsiya):** GitHub Pages orqali —
repozitoriy *Settings → Pages → Branch* da shu branchni tanlang. Keyin
`https://<foydalanuvchi>.github.io/<repo>/` manzilini telefonda oching va brauzer
menyusidan **"Bosh ekranga qo'shish"** ni bosing — ilova kabi ochiladi va oflayn ishlaydi.

Manzil: https://jasurbekmurphy.github.io/Jasurbekmurphy/

## Tuzilishi

| Fayl | Vazifasi |
|---|---|
| `index.html`, `css/style.css` | interfeys |
| `js/app.js` | baza, import/yangilash, moslashtirish, to'ldirish |
| `js/match.js` | ustun nomlarini solishtirish (kirill ↔ lotin) |
| `js/xlsxfill.js` | .xlsx faylga faqat kerakli kataklarni yozish |
| `js/xlsxwrite.js` | yangi formatlangan .xlsx jadval yaratish |
| `js/filters.js` | filtrlar (qiymat, bo'sh, matn, oraliq, VA/YOKI) |
| `js/sync.js` | shifrlash va GitHub orqali bulutli baza |
| `sw.js`, `manifest.webmanifest` | oflayn ishlash va telefonga o'rnatish |
| `vendor/` | SheetJS (o'qish) va JSZip kutubxonalari |
