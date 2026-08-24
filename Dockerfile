# syntax=docker/dockerfile:1.7
# Runtime web OpenAI-only, non-root, construit din lockfile-uri.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066

FROM ${NODE_IMAGE} AS dependinte
WORKDIR /build
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --no-audit --no-fund
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund

FROM dependinte AS constructie
WORKDIR /build
COPY frontend ./frontend
COPY config ./config
COPY scripts/genereaza-config-platforme.mjs ./scripts/genereaza-config-platforme.mjs
COPY backend/src/shared ./backend/src/shared
RUN cd frontend && npm run build
COPY backend ./backend
RUN cd backend && npm run build

FROM dependinte AS module-runtime
RUN cd backend && npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# Chromium, fetch-ul arbitrar și parsarea documentelor trăiesc în servicii
# izolate. Containerul public păstrează numai bibliotecile runtime ale API-ului.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      procps libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/node/.cache \
    && chown -R node:node /home/node /app

COPY --chown=node:node --from=module-runtime /build/backend/node_modules ./backend/node_modules
COPY --chown=node:node --from=constructie /build/backend/dist ./backend/dist
COPY --chown=node:node --from=constructie /build/backend/migrations ./backend/migrations
COPY --chown=node:node --from=constructie /build/config ./config
COPY --chown=node:node backend/package.json ./backend/package.json
COPY --chown=node:node --from=constructie /build/frontend/dist ./frontend/dist

ENV NODE_ENV=production \
    PORT=8080 \
    FRONTEND_DIST=/app/frontend/dist \
    HOME=/home/node

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/livez').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "backend/dist/index.js"]
