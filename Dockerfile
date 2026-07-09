# Kelionai v1 — single service: build frontend + backend, backend serves the SPA.
FROM node:22-bookworm-slim
WORKDIR /app

# --- MarkItDown: convert uploaded documents (PDF / DOCX / PPTX / XLSX / …) to
# Markdown so Kelion and its agents can actually read them. Installed early so
# this heavy layer is cached and not rebuilt when app code changes. ---
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
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
# Chromium for Kelion's browsing tool (server-hosted computer-use: navigate,
# click, type, screenshot — see services/browser.ts). --with-deps pulls the
# Debian libs headless Chromium needs that aren't in the slim base image.
RUN cd backend && npx playwright install --with-deps chromium
COPY backend ./backend
RUN cd backend && npm run build

# --- production image ---
FROM node:22-bookworm-slim
WORKDIR /app

# Re-install system deps in the final stage (since it's a new stage)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip curl \
    && pip3 install --break-system-packages --no-cache-dir 'markitdown[pdf,docx,pptx,xlsx,xls]' \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=0 /app/frontend/dist ./frontend/dist
COPY --from=0 /app/backend/dist ./backend/dist
COPY --from=0 /app/backend/node_modules ./backend/node_modules
COPY --from=0 /app/backend/package.json ./backend/package.json
# Also need playwright browsers in the final image if we want to use them
COPY --from=0 /root/.cache/ms-playwright /root/.cache/ms-playwright

ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/frontend/dist
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
