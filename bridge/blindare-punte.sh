#!/bin/bash
# BLINDAREA PUNTII KELION — rulat pe serverul Contabo prin BLINDEAZA-PUNTEA.cmd.
# Dupa asta puntea NU mai are voie sa pice:
#   1. systemd o reporneste ETERN la orice cadere (fara limita de incercari)
#   2. porneste singura la reboot-ul serverului
#   3. un caine de paza (cron, la fiecare minut) o reinvie si cand e vie dar
#      blocata (nu mai trage joburi) — vazut prin /api/bridge/health
# FARA `set -e`: fiecare pas ruleaza pana la capat chiar daca unul da o eroare
# ne-fatala, ca sa nu mai ramana watchdog-ul neinstalat (bug-ul precedent).

echo "=== 1/5 Repornire eterna (systemd override) ==="
mkdir -p /etc/systemd/system/kelion-bridge.service.d
cat > /etc/systemd/system/kelion-bridge.service.d/override.conf <<'OVR'
[Unit]
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=2
OVR
systemctl daemon-reload
systemctl enable kelion-bridge >/dev/null 2>&1 || true
systemctl restart kelion-bridge
sleep 2
echo -n "stare punte: "; systemctl is-active kelion-bridge

echo "=== 2/5 Pool elastic de reparatori (service + restart) ==="
POOL_SRC=/root/kelion/repo/bridge/kelion-repairer-pool.service
POOL_DST=/etc/systemd/system/kelion-repairer-pool.service
if [ -f "$POOL_SRC" ]; then
  cp "$POOL_SRC" "$POOL_DST"
  chmod 644 "$POOL_DST"
  systemctl daemon-reload
  systemctl enable kelion-repairer-pool >/dev/null 2>&1 || true
  systemctl restart kelion-repairer-pool
  sleep 1
  echo -n "stare pool reparatori: "; systemctl is-active kelion-repairer-pool
  # Builder-ul clasic se opreste: pool-ul preia ordinele.
  systemctl stop kelion-builder >/dev/null 2>&1 || true
  echo "oprit kelion-builder (pool activ)"
else
  echo "(fișier service pool negăsit — sar)"
fi

echo "=== 3/5 Caine de paza (la fiecare minut) ==="
cat > /root/kelion/watchdog.sh <<'WD'
#!/bin/bash
# kelion-bridge nu are voie sa pice: repornita cand e moarta SAU vie-dar-blocata.
set -a; . /root/kelion/claude.env 2>/dev/null; set +a
if ! systemctl is-active --quiet kelion-bridge; then
  echo "$(date -Is) moarta - repornesc" >> /root/kelion/watchdog.log
  systemctl restart kelion-bridge
  exit 0
fi
resp=$(curl -s -m 10 -H "x-bridge-secret: $BRIDGE_SECRET" https://kelionai.app/api/bridge/health)
if echo "$resp" | grep -q '"online":false'; then
  echo "$(date -Is) vie dar nu trage joburi - repornesc" >> /root/kelion/watchdog.log
  systemctl restart kelion-bridge
fi
WD
chmod +x /root/kelion/watchdog.sh
( crontab -l 2>/dev/null | grep -v watchdog.sh ; echo "* * * * * /root/kelion/watchdog.sh" ) | crontab -
echo "caine de paza instalat: $(crontab -l | grep -c watchdog.sh) intrare"

echo "=== 4/5 Cine trimite bataia generica 'Sesiune de lucru activa pe laptop' ==="
grep -rln "Sesiune de lucru" /root/kelion/ 2>/dev/null || echo "(nu e pe serverul asta)"

echo "=== 5/5 Jurnal punte (ultimele 5 linii) ==="
journalctl -u kelion-bridge -n 5 --no-pager -o cat 2>/dev/null | tail -5 || true

echo ""
echo "GATA — puntea e blindata: repornire eterna + pool reparatori activ + paznic la 1 minut + pornire la reboot."
