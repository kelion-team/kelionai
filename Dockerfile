# Kelionai v2 — clean rebuild, Kimi + GLM only
FROM node:22-bookworm-slim
WORKDIR /app

# System deps: python for markitdown, curl for healthchecks, git for the workers
#
# ── LUCRĂTORII (Adrian, 31 iul: „trebuie pornite toate 3, fiecare independent")
# `git` e obligatoriu: toți trei sunt git-nativi, iar `.dockerignore` exclude
# `.git`, deci fiecare lucrător își clonează propriul repo la cerere.
#
# Aider (pip) și Cline (npm) — comenzi verificate în documentația lor oficială,
# 31 iul. Cline cere Node 20+; imaginea e pe 22.
#
# OpenHands NU e aici, INTENȚIONAT: documentația lui nu confirmă o comandă de
# instalare care să dea CLI-ul headless (`openhands --headless -t`) — arată și
# npm, și Docker, fără să spună care produce binarul. Nu pun în imagine o
# comandă despre care nu sunt sigur; s-ar instala „ceva" și am raporta că merge.
# Panoul îl detectează la rulare, spune că lipsește, și merge mai departe cu
# ceilalți doi. Se adaugă aici după ce comanda e probată pe VPS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip curl git libgomp1 \
    && pip3 install --break-system-packages --no-cache-dir 'markitdown[pdf,docx,pptx,xlsx,xls]' aider-chat \
    && npm install -g cline @google/gemini-cli \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
# libgomp1: runtime OpenMP pentru binarul nativ sherpa-onnx (amprentă vocală
# neurală, services/voiceEmbedding.ts). Fără el, `require('sherpa-onnx-node')` ar
# arunca la ÎNCĂRCARE — dar serviciul e lazy și cade grațios; îl punem oricum ca
# recunoașterea neurală să meargă real în prod, nu pe fallback.

# AMPRENTĂ VOCALĂ NEURALĂ — DESCĂRCATĂ DEVREME, CA SĂ SE CACHE-UIASCĂ (Adrian, 6 aug:
# „5 minute e maximul, oricât de mare ar fi"). Modelul wespeaker ResNet34 (26MB,
# licență curată comercial) NU e în git (gitignore). ÎNAINTE stătea DUPĂ `COPY . .`,
# deci ORICE commit invalida cache-ul și curl-ul re-descărca 26MB la FIECARE build.
# Aici e devreme, pe un strat STABIL (depinde doar de apt-ul de sus): se descarcă O
# DATĂ și se refolosește din cache la fiecare deploy următor. `--connect-timeout` taie
# conexiunea moartă în 15s, `--max-time` descărcarea agățată în 180s. La eșec → `|| echo`
# → build sănătos, voiceEmbedding.ts cade grațios pe fallback (regula #1). Straturile
# COPY de mai jos DOAR adaugă fișiere — modelul din /app/backend/models supraviețuiește.
RUN mkdir -p /app/backend/models \
    && (curl -fsSL --connect-timeout 15 --max-time 180 --retry 2 --retry-delay 3 \
        -o /app/backend/models/wespeaker_en_voxceleb_resnet34.onnx \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx" \
        || echo "model voce: descărcare eșuată/expirată la build — voiceEmbedding cade grațios (fallback)")

# ── DEPENDENȚELE AMÂNDUROR CAPETELOR, ÎNAINTE DE ORICE SURSĂ (8 aug 2026) ────
# Adrian: „identifică de ce e așa de mare timpul de construcție și publicare".
# Cache-ul Docker e SECVENȚIAL: dacă un strat se invalidează, TOT ce vine după el
# se reconstruiește — chiar dacă fișierele lui n-au fost atinse. Înainte, ordinea
# era: [copiez sursele frontend] → [build frontend] → [copiez package.json backend]
# → [npm install backend]. Adică ORICE virgulă schimbată în frontend invalida
# stratul cu dependențele backend și le reinstala pe toate, deși `package.json` nu
# fusese atins de luni de zile. Iar PR-urile care ating ambele capete — cazul
# obișnuit — plăteau de fiecare dată.
#
# Acum amândouă instalările stau pe straturi STABILE, care depind doar de
# fișierele de dependențe. O schimbare de cod invalidează doar BUILD-urile, nu și
# instalările.
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY backend/package.json backend/package-lock.json ./backend/
# npm install (nu ci) ca să repare singur o derivă de lock; doar dependențe de producție.
# RETRY pe eroarea TRECĂTOARE `esbuild ETXTBSY` (3 aug: deploy-ul 96437bc a picat
# aici — esbuild rulează `esbuild --version` imediat după ce-și scrie binarul, iar
# uneori fișierul e încă „busy"). O a doua încercare după o scurtă pauză trece de
# cursa asta; fără ea, publicarea moare tăcut și live-ul rămâne pe build-ul vechi.
# Nu ascunde erori reale: dacă pică și a doua oară (lipsă modul, lock stricat),
# build-ul tot cade.
RUN cd backend && (npm install || (echo "npm install: reîncerc după eroare trecătoare (ex. esbuild ETXTBSY)" && sleep 5 && npm install))

# --- frontend build ---
COPY frontend ./frontend
# CONTRACTUL HTTP COMUN (Lotul A): tipurile care circulă prin API sunt declarate
# o SINGURĂ dată, în backend/src/shared, și importate de ambele capete. Aici
# copiem DOAR folderul acela (fișier de tipuri, câțiva KB) — fără el, `tsc -b` al
# frontend-ului nu găsește modulul și build-ul imaginii pică (dovedit: deploy-ul
# 607ce8f, TS2307). Nu copiem tot backend-ul: ar strica ordinea cache-ului.
COPY backend/src/shared ./backend/src/shared
RUN cd frontend && npm run build

# --- backend build ---
# Playwright browsers are NOT in the image (the VPS image builder often fails
# on system deps installation). They are installed by deploy.sh step 4b right
# after the container starts, into the persistent /root/kelion/pw-cache volume
# — measured 3 Aug: nothing else installed them, so the hands' browser was
# dead on every deploy while an old comment here claimed "the backend checks
# at startup" (it never did).
COPY backend ./backend
RUN cd backend && npm run build

# ACCES INTEGRAL LA SURSE (Adrian, 25 iul: „full acces la toate sursele soft"):
# tot repo-ul intră în imagine (deploy/, .github/, docs, scripturi — ce exclude
# .dockerignore rămâne afară: .git, node_modules, dist, .env). Uneltele
# list/read/search_source ale lui Kelion văd astfel TOT softul, nu doar
# backend+frontend; iar deploy/last-updates.txt (scris de deploy.sh înainte de
# build) devine canalul lui de update. Stratul e ultimul → nu strică cache-ul
# build-urilor de mai sus.
COPY . .
# (Modelul vocal neural se descarcă DEVREME, sus — vezi blocul de după apt — ca să se
# cache-uiască; nu se mai re-descarcă la fiecare commit. `COPY . .` doar adaugă fișiere,
# nu șterge — modelul din /app/backend/models rămâne.)

ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/frontend/dist
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
