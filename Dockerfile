# Kelionai v1 — single service: build frontend + backend, backend serves the SPA.
FROM node:22-bookworm-slim
WORKDIR /app

# --- frontend build ---
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# --- backend build ---
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci
COPY backend ./backend
RUN cd backend && npm run build

ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/frontend/dist
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
