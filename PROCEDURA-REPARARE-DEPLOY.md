# PROCEDURĂ: Reparare + Deploy unul câte unul

> Executant: Kelion (pe VPS). Orchestrator: Kimi. Fără viteză, cu verificare.

---

## REGULA DE AUR

**NICIODATĂ** nu modifici 2 ordine în același timp. Una → build → deploy → verificare live → următoarea.

## PASUL 0: Pregătire (înainte de ORICE ordine)

```bash
cd /root/kelion/repo
# Asigură-te că ești pe master curat
git fetch origin
git reset --hard origin/master

# Verificare stare servicii
systemctl status kelion-bridge kelion-builder --no-pager

# Verificare versiune live (referință — trebuie să se schimbe după deploy)
curl -s https://kelionai.app/api/version
```

Salvează output-ul. Dacă ceva e oprit, pornește înainte să continui.

---

## PENTRU FIECARE ORDINĂ (1 → 7)

### 1. Creează branch separat

```bash
git checkout -b fix/ordinea-N
```

### 2. Repară codul

Modifică doar fișierele necesare pentru această ordine.

### 3. Build + test (pe VPS, NU pe Railway)

```bash
cd /root/kelion/repo/backend
npm ci
npm run build
npm test
```

Dacă **oricare** dintre comenzi dă eroare → STOP. Nu deploya. Repară eroarea și reia de la pasul 3.

### 4. Deploy pe Railway (DOAR dacă build-ul a trecut)

```bash
cd /root/kelion/repo
bridge/kelion-github publish fix/ordinea-N "Fix ordinea N" "Descriere scurtă"
```

Sau, dacă `kelion-github` nu merge:
```bash
git checkout master
git merge fix/ordinea-N
git push origin master
# Așteaptă 2-3 minute pentru GitHub Actions (deploy.yml)
```

### 5. Verificare LIVE (obligatoriu — așteaptă 60 secunde după push)

```bash
sleep 60
curl -s https://kelionai.app/api/version
curl -s https://kelionai.app/health
```

Compară `api/version` cu ce ai salvat la Pasul 0. Dacă **NU s-a schimbat**, deploy-ul a eșuat.

### 6. Dacă deploy-ul a eșuat sau live-ul cade — ROLLBACK

```bash
# Înapoi la master curat
git checkout master
git reset --hard origin/master

# Repornește serviciile cu codul curat
systemctl restart kelion-bridge

# Verifică că live-ul a revenit
curl -s https://kelionai.app/health
```

După rollback, analizează log-ul pentru a înțelege de ce a căzut:
```bash
journalctl -u kelion-bridge -n 100 --no-pager
```

Repară eroarea și reia de la Pasul 2.

### 7. Dacă totul e OK — merge în master și șterge branch-ul

```bash
git checkout master
git merge fix/ordinea-N
git push origin master
git branch -d fix/ordinea-N
```

Salvează noul `api/version` ca referință pentru următoarea ordine.

---

## ORDINELE DE EXECUTAT

### Ordinea 1: Curățare Antropic → Kimi/GLM
**Fișiere:** `bridge/kelion-bridge-linux.mjs`, `backend/src/services/brain.ts`, `backend/src/services/brain-types.ts`, `backend/src/routes/admin.ts`, `bridge/claude-munca`, `bridge/kelion-builder-server.mjs`, `bridge/kelion-native-coder.mjs`
**Verificare:** `grep -ri "anthropic\|claude" backend/src bridge/ --include="*.ts" --include="*.mjs" --include="*.js" || echo "CURAT"`

### Ordinea 2: Reparare TypeScript `chat.ts` (liniile ~1837-1960)
**Fișier:** `backend/src/routes/chat.ts`
**Verificare:** `cd backend && npm run build` fără erori TS.

### Ordinea 3: Reparare logică `bridge.ts`
**Fișier:** `backend/src/routes/bridge.ts`
**Repară:** `delegate` (implementare reală), `code_execution` (sandbox vm), `request_repair` (+ await)
**Verificare:** `npm run build` fără erori.

### Ordinea 4: React hydration #418/#423 + SVG viewBox
**Fișiere:** `frontend/src/pages/Stage.tsx`, `frontend/src/components/ChatPanel.tsx`, toate SVG-urile cu `viewBox` care conțin `%` sau `px`
**Verificare:** Consola browserului fără #418, #423, erori SVG.

### Ordinea 5: Quota bar verticală 0-100% + failover vizual Kimi→GLM
**Fișiere:** Backend (endpoint `/api/quota`), Frontend (componentă `QuotaBar`)
**Verificare:** Bară vizibilă, culoare se schimbă, la 403 Kimi trece pe GLM.

### Ordinea 6: Admin panel funcțional (scroll, butoane, câmpuri)
**Fișiere:** CSS admin (scroll), handler-uri butoane, formulare
**Verificare:** Adminul poate scroll-ui, butoanele răspund, toate câmpurile se văd.

### Ordinea 7: Stripe + sistem credite end-to-end
**Fișiere:** `backend/src/routes/stripe.ts` (sau similar), frontend pagină credite, admin tranzacții
**Verificare:** Plată test cu card `4242 4242 4242 4242` → credite apar în cont.

---

## COMANDĂ RAPIDĂ (pentru Kelion)

```bash
# După fiecare deploy REUȘIT, confirmă:
echo "Ordinea N - DEPLOY OK" >> /root/kelion/repo/DEPLOY-LOG.md
date -u +"%Y-%m-%dT%H:%M:%SZ" >> /root/kelion/repo/DEPLOY-LOG.md
curl -s https://kelionai.app/api/version >> /root/kelion/repo/DEPLOY-LOG.md
echo "---" >> /root/kelion/repo/DEPLOY-LOG.md
git add DEPLOY-LOG.md && git commit -m "log: deploy ordinea N OK" && git push origin master
```

---

**Începe cu Ordinea 1. Nu trece la 2 până nu vezi `api/version` schimbat și `health` = 200.**
