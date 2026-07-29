# Kelionai v2 — clean rebuild, Kimi + GLM only
FROM node:22-bookworm-slim
WORKDIR /app

# System deps: python for markitdown, curl for healthchecks
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip curl \
    && pip3 install --break-system-packages --no-cache-dir 'markitdown[pdf,docx,pptx,xlsx,xls]' \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# --- frontend build ---
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
# CONTRACTUL HTTP COMUN (Lotul A): tipurile care circulă prin API sunt declarate
# o SINGURĂ dată, în backend/src/shared, și importate de ambele capete. Aici
# copiem DOAR folderul acela (fișier de tipuri, câțiva KB) — fără el, `tsc -b` al
# frontend-ului nu găsește modulul și build-ul imaginii pică (dovedit: deploy-ul
# 607ce8f, TS2307). Nu copiem tot backend-ul: ar strica ordinea cache-ului.
COPY backend/src/shared ./backend/src/shared
RUN cd frontend && npm run build

# --- backend build ---
COPY backend/package.json backend/package-lock.json ./backend/
# npm install (not ci) to auto-heal any lock drift; production deps only
RUN cd backend && npm install
# Playwright browsers installed at runtime (not build time) — the image builder
# often fails on system deps installation. The backend checks at startup.
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

ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/frontend/dist
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
