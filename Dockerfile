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
RUN cd frontend && npm run build

# --- backend build ---
COPY backend/package.json backend/package-lock.json ./backend/
# npm install (not ci) to auto-heal any lock drift; production deps only
RUN cd backend && npm install
# Playwright browsers installed at runtime (not build time) — Railway builder
# often fails on system deps installation. The backend checks at startup.
COPY backend ./backend
RUN cd backend && npm run build

ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/frontend/dist
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
