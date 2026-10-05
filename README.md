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
3. **Qidirish** — bazadan ism, JShShIR, telefon, guruh bo'yicha tez qidirish.

## Xavfsizlik

Ma'lumotlar (pasport, JShShIR, telefon) **faqat sizning qurilmangiz brauzerida**
(IndexedDB) saqlanadi va hech qanday serverga yuborilmaydi. Excel fayllar
repozitoriyga tushmasligi uchun `.gitignore` da taqiqlangan. Har bir qurilmada
(kompyuter, telefon) asosiy jadvalni bir marta yuklash kerak.

## Ishga tushirish

**Telefonda va kompyuterda (tavsiya):** GitHub Pages orqali —
repozitoriy *Settings → Pages → Branch* da shu branchni tanlang. Keyin
`https://<foydalanuvchi>.github.io/<repo>/` manzilini telefonda oching va brauzer
menyusidan **"Bosh ekranga qo'shish"** ni bosing — ilova kabi ochiladi va oflayn ishlaydi.

**Kompyuterda lokal:** papkada `python3 -m http.server` ni ishga tushirib,
`http://localhost:8000` ni oching (yoki `index.html` ni to'g'ridan-to'g'ri oching).

## Tuzilishi

| Fayl | Vazifasi |
|---|---|
| `index.html`, `css/style.css` | interfeys |
| `js/app.js` | baza, import/yangilash, moslashtirish, to'ldirish |
| `js/match.js` | ustun nomlarini solishtirish (kirill ↔ lotin) |
| `js/xlsxfill.js` | .xlsx faylga faqat kerakli kataklarni yozish |
| `sw.js`, `manifest.webmanifest` | oflayn ishlash va telefonga o'rnatish |
| `vendor/` | SheetJS (o'qish) va JSZip kutubxonalari |
