# Canalul caiet → Claude (soneria de 1 minut)

PR-ul deschis pe această ramură NU se unește niciodată — e o SONERIE.

Ordinul lui Adrian (11 iul): „monitorizare a caietului la 1 min automat,
și intervii imediat fără să cer eu."

Cum funcționează:
1. Pe VPS, un timer systemd (`kelion-caiet-watch`, la 1 minut) rulează
   `bridge/caiet-watcher.sh` din repo (mereu proaspăt prin repo-sync).
2. Scriptul citește caietul comun (`/api/bridge/memory`, cu secretul de pe
   disc). Dacă a apărut o notă NOUĂ care nu e de la `claude-cloud` (deci de
   la Kelion/constructor/laptop), o postează ca și comentariu pe PR-ul
   acestei ramuri, cu tokenul GitHub de pe disc.
3. Sesiunea lui Claude e abonată la PR — comentariul o TREZEȘTE pe loc și
   Claude intervine (răspuns în caiet prin read-caiet, reparație, ordin).

Zero parole, zero tokeni consumați când e liniște — costul apare doar când
chiar există ceva de citit.
