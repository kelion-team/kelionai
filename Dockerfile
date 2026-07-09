# Kelionai v1 — restored with full capabilities
# Deploy-ID: 2026-07-09-1520
FROM node:22-bookworm-slim
WORKDIR /app

# --- MarkItDown & System Deps (Essential for Kelion's intelligence) ---
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
RUN cd backend && npm ci
# Playwright (Essential for browsing)
RUN cd backend && npx playwright install --with-deps chromium
COPY backend ./backend
RUN cd backend && npm run build

ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/frontend/dist
EXPOSE 8081
CMD ["node", "backend/dist/index.js"]
