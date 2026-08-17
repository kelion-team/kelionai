# KELION-VPS-ORDERS — Ce face Kelion Builder pe VPS

> **Pentru:** Kelion Builder (pe VPS 164.68.120.87)
> **De la:** Kimi (chat local) — trimite ce nu poate executa remote
> **Data:** 2026-07-16
> **Status:** Deploy curat consolidat pus pe master. Așteaptă execuție VPS.

---

## ✅ CE A FĂCUT DEJA KIMI (chat)

1. **Fix TS6133** — scos `fetchHistory` + `PurchaseRecord` neutilizate din `CustomerSettings.tsx`.
2. **Curățare Antropic** — scan complet: **0 referințe** `antropic` / `claude` / `Anthropic` în repo.
3. **Commit deploy curat** — `STATUS.md` actualizat, master stabil.
4. **Aider identificat** — deja instalat (`23c83508`) cu config Kimi/GLM.

---

## 🔴 ORDINE PENTRU KELION BUILDER (pe VPS)

### ORDIN #1 — React Hydration #418/#423
**Loc:** `frontend/src/routes/Chat.tsx` sau componentele care fac SSR.
**Problemă:** Minified React error #418 (hydration mismatch) + #423.
**Acțiune:**
```bash
# Pe VPS, în /root/kelion/repo:
grep -n "dangerouslySetInnerHTML\|useEffect\|typeof window" frontend/src/routes/Chat.tsx
# Verifică dacă serverul randează altceva decât clientul (ex: date.now(), Math.random(), localStorage)
# Fix: mută orice referință la `window` / `localStorage` / `navigator` în `useEffect` (client-only)
```

### ORDIN #2 — Quota Bar Orizontală
**Loc:** `frontend/src/components/AdminPanel.tsx` (sau unde e bara verticală).
**Acțiune:**
- Muta cele 2 bare verticale (Kimi + GLM) **sub logo-ul Kelionai**, în stânga-sus, **orizontal**.
- CSS: `display: flex; flex-direction: row; gap: 8px;` în loc de `flex-direction: column`.

### ORDIN #3 — Admin Panel Scroll + Butoane
**Loc:** `frontend/src/components/AdminPanel.tsx`.
**Acțiune:**
- Adaugă `overflow-y: auto; max-height: 90vh;` pe containerul principal.
- Verifică că toate câmpurile (input, select, textarea) sunt focusable și butoanele răspund la click.
- Test: deschide admin panel, încearcă scroll pe laptop + mobil.

### ORDIN #4 — Voce Full-Duplex Sub 1s
**Loc:** `frontend/src/lib/audioIO.ts`, `backend/src/services/audio.ts`.
**Acțiune:**
- Verifică bufferSize = 128 în `getUserMedia` constraints.
- Adaugă VAD open-source (`@ricky0123/vad-web`) sau simulează cu Web Audio API `ScriptProcessorNode`.
- Filtre zgomot: testează `RNNoise` (wasm) sau noise gate simplu în Web Audio.
- Test: măsura round-trip time (RTT) de la vorbit până la răspuns audio. Target < 1000ms.

### ORDIN #5 — Aider Verificare + Test
**Loc:** VPS, `/root/kelion/repo`.
**Acțiune:**
```bash
which aider
aider --version
# Dacă nu e în PATH:
cd /root/kelion/repo && npx aider --version
# Test: deschide un fișier mic și cere-i să modifice ceva
aider --model kimi --api-key $(cat kimi-key.txt) src/test-aider.ts
```

### ORDIN #6 — Stripe End-to-End Test
**Loc:** `backend/src/routes/billing.ts`, `frontend/src/lib/billing.ts`.
**Acțiune:**
- Test checkout cu card test Stripe: `4242 4242 4242 4242`, orice dată viitoare, orice CVC.
- Verifică webhook-ul `/api/billing/webhook` — log primește evenimentul `checkout.session.completed`?
- Verifică că creditul apare în wallet după plată.

### ORDIN #7 — Auto-Backup + Rollback
**Loc:** VPS, `/root/kelion/repo`.
**Acțiune:**
```bash
# Script backup zilnic (pune în crontab):
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/kelion/backups"
mkdir -p $BACKUP_DIR
tar czf $BACKUP_DIR/kelion_$DATE.tar.gz /root/kelion/repo --exclude=node_modules --exclude=.git
# Păstrează ultimele 7 backup-uri
ls -t $BACKUP_DIR | tail -n +8 | xargs -I {} rm $BACKUP_DIR/{}
```
- Adaugă în `crontab -e`: `0 3 * * * /root/kelion/backup.sh`
- Rollback: `cd /root/kelion/repo && git reset --hard HEAD~1 && npm run build && pm2 restart kelion` (sau ce folosești pentru restart)

---

## 🟡 INSTRUCȚIUNI DE RAPORTARE

După fiecare ordin executat, Kelion Builder trimite un **scurt raport** pe canalul comun (sau în fișier `KELION-REPORT.md` în repo):
- Status: `[DONE]` / `[BLOCKED]` / `[IN PROGRESS]`
- Ce s-a modificat exact (fișier, linie, funcție)
- Eroare întâlnită (dacă există) + mesajul complet

**NU** începe un ordin nou până când cel anterior nu e raportat `[DONE]` sau `[BLOCKED]` cu motiv.

---

## 🔑 ACCES CHEI (pe VPS, deja acolo)

```bash
cat /root/kelion/kimi-key.txt      # KIMI_API_KEY
cat /root/kelion/glm-key.txt       # GLM_API_KEY
```

**Regulă de fier:** nicio publicare pe lângă pipeline (Railway a fost scos, 22 iul 2026). Codul intră DOAR prin `git push` pe master.

---

## 🎯 PRIORITATE

1. ORDIN #1 (Hydration) — afectează toți userii
2. ORDIN #2 (Quota Bar) — vizibil imediat
3. ORDIN #3 (Admin Panel) — blocant pentru management
4. ORDIN #5 (Aider Verify) — necesar pentru autonomie coding
5. ORDIN #6 (Stripe Test) — pentru monetizare
6. ORDIN #4 (Voce) — complex, lasă-l la urmă
7. ORDIN #7 (Backup) — infrastructură critică
