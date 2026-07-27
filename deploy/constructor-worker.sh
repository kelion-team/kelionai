#!/usr/bin/env bash
# CONSTRUCTORUL — wrapper-ul de cron (Adrian, 27 iul). Un singur agent odată
# (flock), cu TIMEOUT DUR de 30 min: un job nu poate deveni niciodată demon
# (lecția ecosistemului vechi care ardea abonamentul non-stop). Agentul își ia
# singur ordinul din coadă prin API; coada goală = iese în sub o secundă.
set -u
LOCK=/root/kelion/constructor.lock
exec 9>"$LOCK"
flock -n 9 || exit 0
timeout 1800 node /root/kelion/constructor-agent.mjs
