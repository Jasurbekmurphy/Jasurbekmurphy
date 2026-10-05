# Davomat botini o'z serveringizga o'rnatish

Bot oddiy Node.js dasturi, qo'shimcha paket o'rnatish shart emas.
Davomat serverdagi `davomat.db` (SQLite) faylida saqlanadi.
Quyidagi buyruqlar **Ubuntu / Debian** uchun (root yoki `sudo` bilan).

> Cloudflare yo'riqnomasi ([README.md](README.md)) kerak emas — bu uning o'rnini bosadi.

## ⚡ Eng oson yo'l — bitta buyruq

Serverga SSH orqali kiring va quyidagini bajaring:

```bash
curl -fsSL https://raw.githubusercontent.com/Jasurbekmurphy/Jasurbekmurphy/claude/salom-qudvc3/bot/install.sh -o install.sh && sudo bash install.sh
```

Skript bot tokenini so'raydi va qolgan hammasini (Node.js, bot, avtomatik ishga tushish,
HTTPS, firewall) o'zi sozlaydi. Oxirida saytga kiritiladigan **manzil** va **kalit**ni chiqaradi.
Botni yangilash uchun ham shu buyruqni qayta bajaring.

Quyida — xuddi shu ishlarni qo'lda bajarish.

## 1. Node.js 22 o'rnatish

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
node -v        # v22.5 yoki undan yuqori bo'lishi kerak
```

## 2. Bot fayllarini joylash

```bash
sudo useradd -r -s /usr/sbin/nologin jadvalbot || true
sudo mkdir -p /opt/jadval-bot && cd /opt/jadval-bot
for f in worker.js server.js package.json .env.example jadval-bot.service Caddyfile; do
  sudo curl -fsSLO "https://raw.githubusercontent.com/Jasurbekmurphy/Jasurbekmurphy/claude/salom-qudvc3/bot/$f"
done
sudo cp .env.example .env
sudo nano .env      # BOT_TOKEN va ADMIN_KEY ni yozing, saqlang (Ctrl+O, Enter, Ctrl+X)
sudo chown -R jadvalbot:jadvalbot /opt/jadval-bot
sudo chmod 600 /opt/jadval-bot/.env
```

- **BOT_TOKEN** — Telegram'da @BotFather → `/newbot` bergan token.
- **ADMIN_KEY** — saytdagi **Mas'ul va davomat → ⚙️ Bot → 🎲** tugmasi bilan yaratilgan kalit.

Tekshirish: `sudo -u jadvalbot node server.js` → `✅ Bot @... — ...` chiqsa, `Ctrl+C` bosing.

## 3. Doimiy ishlashi (server qayta yonganda ham)

```bash
sudo cp jadval-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jadval-bot
sudo systemctl status jadval-bot      # active (running) bo'lishi kerak
journalctl -u jadval-bot -f           # loglarni ko'rish (chiqish: Ctrl+C)
```

Shu bosqichdan keyin **bot Telegram'da ishlaydi** (polling rejimi — domen shart emas).

## 4. Sayt ulanishi uchun HTTPS (Caddy)

Sayt `https://` da bo'lgani uchun brauzer serverga faqat **https** orqali ulanadi.
Caddy sertifikatni avtomatik oladi va yangilab turadi.

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile` faylini (`sudo nano /etc/caddy/Caddyfile`) shunday yozing:

```
bot.sizning-domen.uz {
	reverse_proxy 127.0.0.1:8787
}
```

- **Domen bo'lsa:** domen DNS'ida `A` yozuvini server IP'siga yo'naltiring.
- **Domen bo'lmasa:** IP manzildan bepul nom: `185.22.33.44` → `185-22-33-44.sslip.io`
  (o'z IP'ingizni yozing, nuqtalar o'rniga chiziqcha).

```bash
sudo systemctl reload caddy
sudo ufw allow 80,443/tcp 2>/dev/null || true    # firewall yoqilgan bo'lsa
```

Brauzerda `https://<manzil>/` ni oching → **"Jadval Baza davomat boti ishlayapti ✅"**.

> Serverda boshqa sayt **nginx** bilan ishlayotgan bo'lsa (80/443 band), Caddy o'rniga
> nginx'ga `location / { proxy_pass http://127.0.0.1:8787; }` qo'shing va
> sertifikatni certbot bilan oling.

## 5. Saytga ulash

Saytda **Mas'ul va davomat → ⚙️ Bot**:
- Bot manzili: `https://<manzil>` (4-qadamdagi)
- Admin kalit: `.env` dagi `ADMIN_KEY`
- **Saqlash va tekshirish** → "✅ Ulangan: @bot_nomi"

> Eslatma: o'z serveringizda `/setup?key=...` manzilini **ochmang** — u Cloudflare uchun.
> Server polling rejimida webhookni o'zi o'chirib turadi.

## Foydali buyruqlar

| Vazifa | Buyruq |
|---|---|
| Qayta ishga tushirish | `sudo systemctl restart jadval-bot` |
| Loglar | `journalctl -u jadval-bot -n 100` |
| Botni yangilash | 2-qadamdagi `for … curl` qatorini qayta bajaring, keyin `restart` |
| Bazadan nusxa | `sudo cp /opt/jadval-bot/davomat.db ~/davomat-$(date +%F).db` |

## Docker bo'lsa (ixtiyoriy, 1–3-qadamlar o'rniga)

```bash
cd /opt/jadval-bot && sudo curl -fsSLO https://raw.githubusercontent.com/Jasurbekmurphy/Jasurbekmurphy/claude/salom-qudvc3/bot/Dockerfile
sudo docker build -t jadval-bot .
sudo docker run -d --name jadval-bot --restart=always --env-file .env -e HOST=0.0.0.0 \
  -p 127.0.0.1:8787:8787 -v jadval-bot-data:/data jadval-bot
```
