#!/usr/bin/env bash
# Jadval Baza davomat boti — serverga bir buyruq bilan o'rnatish (Ubuntu / Debian).
#
#   curl -fsSL https://raw.githubusercontent.com/Jasurbekmurphy/Jasurbekmurphy/claude/salom-qudvc3/bot/install.sh -o install.sh && sudo bash install.sh
#
# Qayta ishga tushirsangiz — bot yangilanadi, sozlamalar saqlanadi.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Jasurbekmurphy/Jasurbekmurphy/claude/salom-qudvc3/bot"
DIR=/opt/jadval-bot
SVC=jadval-bot
PORT=8787

G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; B='\033[1;36m'; N='\033[0m'
say()  { echo -e "${B}==>${N} $*"; }
ok()   { echo -e "${G}✔${N} $*"; }
warn() { echo -e "${Y}!${N} $*"; }
die()  { echo -e "${R}✘ $*${N}"; exit 1; }
ask()  { local v; read -r -p "$1" v < /dev/tty; echo "$v"; }

[ "$(id -u)" -eq 0 ] || die "Root huquqi kerak: sudo bash install.sh"
command -v apt-get >/dev/null || die "Bu skript Ubuntu/Debian uchun. Boshqa tizim bo'lsa, bot/SERVER.md ga qarang."

echo -e "\n${G}Jadval Baza — davomat boti o'rnatilmoqda${N}\n"

# ---------------------------------------------------------------- 0. Telegram'ga ulanish
say "Telegram serveriga ulanishni tekshirish…"
curl -fsS -m 15 -o /dev/null https://api.telegram.org || die "Server api.telegram.org ga ulana olmayapti (provayder yoki firewall to'smoqda)."
ok "Telegram'ga ulanish bor"

apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg openssl >/dev/null

# ---------------------------------------------------------------- 1. Sozlamalar
EXIST_TOKEN=""; EXIST_KEY=""; EXIST_DOMAIN=""
if [ -f "$DIR/.env" ]; then
  EXIST_TOKEN=$(grep -E '^BOT_TOKEN=' "$DIR/.env" | cut -d= -f2- || true)
  EXIST_KEY=$(grep -E '^ADMIN_KEY=' "$DIR/.env" | cut -d= -f2- || true)
  EXIST_DOMAIN=$(grep -E '^# DOMAIN=' "$DIR/.env" | cut -d= -f2- || true)
  warn "Oldingi o'rnatish topildi — Enter bossangiz eski qiymat qoladi."
fi

while :; do
  TOKEN=$(ask "1) BotFather bergan bot TOKEN${EXIST_TOKEN:+ [saqlangan]}: ")
  TOKEN=${TOKEN:-$EXIST_TOKEN}
  [ -n "$TOKEN" ] || { warn "Token kiriting (masalan 123456789:AA...)"; continue; }
  ME=$(curl -fsS -m 15 "https://api.telegram.org/bot${TOKEN}/getMe" 2>/dev/null || true)
  if echo "$ME" | grep -q '"ok":true'; then
    BOTNAME=$(echo "$ME" | sed -E 's/.*"username":"([^"]+)".*/\1/')
    ok "Bot topildi: @$BOTNAME"; break
  fi
  warn "Token noto'g'ri. BotFather'dagi tokenni to'liq nusxalang."
done

KEY=$(ask "2) Saytdagi 🎲 kalit (ADMIN_KEY)${EXIST_KEY:+ [saqlangan]} — bo'sh qoldirsangiz yangisi yaratiladi: ")
KEY=${KEY:-$EXIST_KEY}
if [ -z "$KEY" ]; then KEY=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32); NEWKEY=1; fi

IP=$(curl -fsS -4 -m 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DEF_DOMAIN="${EXIST_DOMAIN:-$(echo "$IP" | tr '.' '-').sslip.io}"
DOMAIN=$(ask "3) Domen (Enter = $DEF_DOMAIN): ")
DOMAIN=${DOMAIN:-$DEF_DOMAIN}
DOMAIN=$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##')

# ---------------------------------------------------------------- 2. Node.js 22
need_node=1
if command -v node >/dev/null; then
  V=$(node -p 'process.versions.node' 2>/dev/null || echo 0)
  MAJ=${V%%.*}; MIN=$(echo "$V" | cut -d. -f2)
  if [ "$MAJ" -gt 22 ] || { [ "$MAJ" -eq 22 ] && [ "$MIN" -ge 5 ]; }; then need_node=0; fi
fi
if [ $need_node -eq 1 ]; then
  say "Node.js 22 o'rnatilmoqda…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node -v)"

# ---------------------------------------------------------------- 3. Bot fayllari
say "Bot fayllari yuklanmoqda…"
id -u jadvalbot >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$DIR" jadvalbot
mkdir -p "$DIR"
for f in worker.js server.js package.json; do
  curl -fsSL "$REPO_RAW/$f" -o "$DIR/$f"
done
cat > "$DIR/.env" <<EOF
BOT_TOKEN=$TOKEN
ADMIN_KEY=$KEY
PORT=$PORT
HOST=127.0.0.1
MODE=polling
# DOMAIN=$DOMAIN
EOF
chmod 600 "$DIR/.env"
chown -R jadvalbot:jadvalbot "$DIR"
ok "Fayllar: $DIR"

# ---------------------------------------------------------------- 4. Doimiy xizmat (systemd)
say "Avtomatik ishga tushish sozlanmoqda…"
cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=Jadval Baza davomat boti
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3
User=jadvalbot
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable $SVC >/dev/null 2>&1
systemctl restart $SVC
sleep 3
systemctl is-active --quiet $SVC || { journalctl -u $SVC -n 30 --no-pager; die "Bot ishga tushmadi (yuqoridagi logga qarang)"; }
curl -fsS -m 5 "http://127.0.0.1:$PORT/" >/dev/null || die "Bot porti javob bermayapti"
ok "Bot ishlayapti (Telegram: @$BOTNAME)"

# ---------------------------------------------------------------- 4b. Avtomatik yangilanish
say "Avtomatik yangilanish sozlanmoqda (har 5 daqiqada GitHub tekshiriladi)…"
cat > "$DIR/update.sh" <<'UPD'
#!/usr/bin/env bash
# GitHub'dagi yangi versiyani tekshiradi; o'zgargan bo'lsa — tekshirib, o'rnatib, botni qayta ishga tushiradi.
# Yangi versiya ishlamasa — eski versiyaga qaytadi.
set -uo pipefail
DIR=/opt/jadval-bot
REPO_RAW=$(cat "$DIR/.repo_raw")
SVC=jadval-bot
FILES="worker.js server.js package.json"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
for f in $FILES; do
  curl -fsSL -m 30 "$REPO_RAW/$f?t=$(date +%s)" -o "$TMP/$f" || { echo "yuklab bo'lmadi: $f"; exit 0; }
done
changed=0
for f in $FILES; do cmp -s "$TMP/$f" "$DIR/$f" || changed=1; done
[ $changed -eq 1 ] || exit 0
for f in worker.js server.js; do
  node --check "$TMP/$f" 2>/dev/null || { echo "yangi $f da xato — o'rnatilmadi"; exit 0; }
done
mkdir -p "$DIR/prev"
for f in $FILES; do cp -f "$DIR/$f" "$DIR/prev/$f" 2>/dev/null || true; cp -f "$TMP/$f" "$DIR/$f"; done
chown -R jadvalbot:jadvalbot "$DIR"
systemctl restart "$SVC"; sleep 4
if systemctl is-active --quiet "$SVC" && curl -fsS -m 5 http://127.0.0.1:8787/ >/dev/null; then
  echo "bot yangilandi: $(date '+%F %T')"
else
  echo "yangi versiya ishlamadi — eski versiyaga qaytildi"
  for f in $FILES; do cp -f "$DIR/prev/$f" "$DIR/$f"; done
  chown -R jadvalbot:jadvalbot "$DIR"; systemctl restart "$SVC"
fi
# skriptning o'zini ham yangilab qo'yish
curl -fsSL -m 30 "$REPO_RAW/install.sh" -o "$TMP/install.sh" 2>/dev/null && \
  sed -n '/^cat > "\$DIR\/update.sh" <<.UPD.$/,/^UPD$/p' "$TMP/install.sh" | sed '1d;$d' > "$TMP/update.sh" && \
  bash -n "$TMP/update.sh" && [ -s "$TMP/update.sh" ] && ! cmp -s "$TMP/update.sh" "$DIR/update.sh" && cp -f "$TMP/update.sh" "$DIR/update.sh" && chmod 755 "$DIR/update.sh"
exit 0
UPD
echo "$REPO_RAW" > "$DIR/.repo_raw"
chmod 755 "$DIR/update.sh"
cat > /etc/systemd/system/$SVC-update.service <<EOF
[Unit]
Description=Jadval Baza botini GitHub'dan yangilash
After=network-online.target

[Service]
Type=oneshot
ExecStart=$DIR/update.sh
EOF
cat > /etc/systemd/system/$SVC-update.timer <<EOF
[Unit]
Description=Jadval Baza botini har 5 daqiqada yangilash

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now $SVC-update.timer >/dev/null 2>&1
ok "Avtomatik yangilanish yoqildi (log: journalctl -u $SVC-update)"

# ---------------------------------------------------------------- 5. HTTPS (Caddy)
busy=$(ss -ltnp 2>/dev/null | grep -E ':(80|443)\s' | grep -v caddy || true)
if [ -n "$busy" ]; then
  warn "80/443-port boshqa dastur (nginx/apache) bilan band — Caddy o'rnatilmadi."
  echo "    Mavjud veb-serverga quyidagicha yo'naltiring:  $DOMAIN  →  http://127.0.0.1:$PORT"
  echo "    (nginx: location / { proxy_pass http://127.0.0.1:$PORT; }  + certbot bilan SSL)"
  HTTPS_OK=0
else
  if ! command -v caddy >/dev/null; then
    say "Caddy (HTTPS) o'rnatilmoqda…"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  [ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	reverse_proxy 127.0.0.1:$PORT
}
EOF
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ok "Firewall: 80 va 443 ochildi"
  fi
  systemctl enable caddy >/dev/null 2>&1
  systemctl restart caddy
  say "SSL sertifikat olinmoqda (1 daqiqagacha)…"
  HTTPS_OK=0
  for i in $(seq 1 30); do
    if curl -fsS -m 5 "https://$DOMAIN/" 2>/dev/null | grep -q "ishlayapti"; then HTTPS_OK=1; break; fi
    sleep 3
  done
  [ $HTTPS_OK -eq 1 ] && ok "HTTPS ishlayapti: https://$DOMAIN" || warn "HTTPS hali tayyor emas. Domen DNS'i server IP'siga ($IP) qaraganini tekshiring: journalctl -u caddy -n 50"
fi

# ---------------------------------------------------------------- Yakun
echo
echo -e "${G}══════════════════════════════════════════════════════════${N}"
echo -e "${G} TAYYOR!${N}  Saytda: Mas'ul va davomat → ⚙️ Bot ga kiriting:"
echo
echo -e "   Bot manzili:  ${B}https://$DOMAIN${N}"
echo -e "   Admin kalit:  ${B}$KEY${N}"
[ "${NEWKEY:-0}" = 1 ] && echo -e "   ${Y}(kalit yangi yaratildi — uni saytga aynan shunday kiriting)${N}"
echo
echo -e "   Telegram bot: ${B}https://t.me/$BOTNAME${N}  — havolani mas'ullarga yuboring"
echo -e "${G}══════════════════════════════════════════════════════════${N}"
echo "Loglar: journalctl -u $SVC -f    Qayta ishga tushirish: systemctl restart $SVC"
echo "Bot GitHub'dagi o'zgarishlardan keyin 5 daqiqa ichida o'zi yangilanadi (hozir: sudo $DIR/update.sh)."
