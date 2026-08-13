#!/usr/bin/env bash
# CONSTRUCTORUL — wrapper-ul de cron (Adrian, 27 iul). Un singur agent odată
# (flock), cu TIMEOUT DUR de 30 min: un job nu poate deveni niciodată demon
# (lecția ecosistemului vechi care ardea abonamentul non-stop). Agentul își ia
# singur ordinul din coadă prin API; coada goală = iese în sub o secundă.
set -u
LOCK=/root/kelion/constructor.lock
exec 9>"$LOCK"
flock -n 9 || exit 0
# TIMEOUT + OMORÂREA ORFANILOR (owner, 13 aug, incident VPS 1000%): `timeout`
# omoară doar procesul node PĂRINTE; build-urile copil (npm/tsc/vite din atelier,
# măsurat: un `npm run build` a durat 10+ MINUTE pe mașina sufocată) reparinte la
# init și ard mai departe, iar următorul cron (2 min) pornește altele peste ele →
# sufocare. `-k 30` trimite SIGKILL dacă node nu moare în 30s după SIGTERM; apoi
# omorâm orice a mai rămas viu din atelier, ca să nu se stivuiască orfani.
timeout -k 30 1800 node /root/kelion/constructor-agent.mjs
pkill -9 -f '/root/kelion/atelier' 2>/dev/null || true
