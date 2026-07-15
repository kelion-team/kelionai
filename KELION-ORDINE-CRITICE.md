# KELION — ORDINE CRITICE (de executat imediat)

> Sursa: Kimi (orchestrator). Executant: Kelion (pe VPS). Nu discuta, nu analiza, executa.

---

## ORDINEA 1: Curatare TOTALA Antropic → Kimi/GLM

**Fisiere de modificat (cauta "claude", "anthropic", "CLAUDE", "ANTHROPIC" case-insensitive):**

1. `bridge/kelion-bridge-linux.mjs`
   - Inlocuieste `spawn(CLAUDE, ...)` cu apel API Kimi (HTTP POST la `https://api.moonshot.cn/v1/chat/completions`)
   - Inlocuieste toate referintele la `CLAUDE` cu `KIMI_API` sau `GLM_API`
   - Pastreaza aceeasi logica de fallback (Kimi primar, GLM rezerva)

2. `backend/src/services/brain.ts`
   - Elimina orice import sau referinta la `@anthropic-ai/sdk` sau `claude`
   - Inlocuieste cu apeluri la `kimiChat` si `glmChat` (foloseste functiile existente pentru Kimi/GLM)

3. `backend/src/services/brain-types.ts`
   - Sterge tipurile `AnthropicMessage`, `ClaudeResponse`, etc.
   - Adauga tipuri pentru `KimiMessage`, `GLMMessage` daca lipsesc

4. `backend/src/routes/admin.ts`
   - Daca exista referinte la costuri Anthropic sau chei Claude, inlocuieste cu Kimi/GLM

5. `bridge/claude-munca` (director sau fisier)
   - Redenumeste in `kimi-munca` sau `kelion-munca`
   - Inlocuieste continutul referitor la Claude cu Kimi

6. `bridge/kelion-builder-server.mjs`
   - Inlocuieste apelurile la Claude cu Kimi

7. `bridge/kelion-native-coder.mjs`
   - Inlocuieste apelurile la Claude cu Kimi

**Dupa modificare:**
```bash
grep -ri "anthropic\|claude" backend/src bridge/ --include="*.ts" --include="*.mjs" --include="*.js" || echo "CURAT"
```
Trebuie sa returneze doar `CURAT` (zero matchuri in codul activ).

---

## ORDINEA 2: Reparare erori TypeScript in `backend/src/routes/chat.ts`

**Erori identificate (linii ~1837-1960):**

| Eroare | Linie | Reparatie |
|--------|-------|-----------|
| TS2554: Expected 2 args, got 0 | 1837, 1842, 1862 | Adauga argumentele lipsa la apelul functiei |
| TS2554: Expected 3 args, got 1 | 1847, 1852 | Completeaza cu argumentele obligatorii |
| TS2554: Expected 4 args, got 2 | 1857 | Completeaza cu argumentele obligatorii |
| TS2698: Spread types may only be created from object types | 1863 | Inlocuieste spread pe non-obj cu Object.assign sau alt pattern |
| TS2345: Argument of type 'string' is not assignable | 1885 | Converteste/casteaza tipul corect |
| TS2554: Expected 2 args, got 5 | 1932 | Reduce la 2 argumente sau schimba functia apelata |
| TS2554: Expected 3 args, got 2 | 1958 | Completeaza cu al 3-lea argument |

**Actiune:** Deschide fisierul, navigheaza la liniile indicate, si corecteaza fiecare apel conform semnaturii functiei tinta. Nu sterge randuri, corecteaza-le.

**Verificare:**
```bash
cd backend && npm run build
```
Trebuie sa treaca fara erori TS.

---

## ORDINEA 3: Reparare logica in `backend/src/routes/bridge.ts`

**Probleme identificate in `handleToolCall`:**

1. **`case 'delegate'`** — este stub (returneaza doar JSON static).
   - Implementeaza apel real catre agentul specificat (`args.agent`)
   - Foloseste `AGENTS[agentKey]` si trimite task-ul prin API
   - Asteapta raspunsul si returneaza rezultatul real

2. **`case 'code_execution'`** — este stub (returneaza doar mesaj static).
   - Implementeaza executia in sandbox folosind `vm` module (Node.js)
   - sau foloseste `node:vm` cu context limitat
   - Returneaza output real sau eroare

3. **`case 'request_repair'`** — `openRequirement(description)` nu are `await`.
   - Adauga `await` in fata: `await openRequirement(description)`

4. **Valori hardcodate:**
   - `'kelion'` in `forget_memory` → foloseste constanta `DEFAULT_MEMORY_NAMESPACE`
   - `'map'` in `prepare_promo_clip` → foloseste constanta `DEFAULT_PROMO_NAMESPACE`

**Verificare:** `npm run build` trece fara erori.

---

## ORDINEA 4: React hydration #418/#423 + SVG viewBox

**Problema:** Erori in consola browser:
- `Error: Minified React error #418` — hydration mismatch (server renders something different from client)
- `Error: Minified React error #423` — same
- `Error: <svg> attribute viewBox: Expected number, "0 0 100% 58px"` — viewBox primeste string cu `%` si `px` in loc de numere

**Actiuni:**

1. **SVG viewBox:**
   - Cauta in `frontend/src/` toate `<svg` cu `viewBox`
   - Inlocuieste valorile care contin `%` sau `px` cu numere pure (ex: `viewBox="0 0 100 58"`)
   - Fisiere posibile: componente cu iconite, logo, etc.

2. **Hydration mismatch #418/#423:**
   - Cauta in `frontend/src/pages/Stage.tsx` si `frontend/src/components/ChatPanel.tsx`
   - Identifica elemente care randeaza diferit pe server vs client (ex: date dinamice, `new Date()`, `Math.random()`, dimensiuni fereastra)
   - Foloseste `useEffect` pentru randarea conditionata pe client
   - sau foloseste `suppressHydrationWarning` pe elementele cu continut dinamic
   - Verifica daca exista texte cu whitespace extra intre server si client

**Verificare:** Deschide aplicatia in browser, consola trebuie sa NU mai arate #418, #423, sau erori SVG.

---

## ORDINEA 5: Quota bar verticala 0-100% + failover vizual Kimi→GLM

**Cerinta:**
- Bar verticala care arata cata quota mai are Kimi (0-100%)
- Cand Kimi ajunge la limita (403 / quota exceeded), bara trece automat pe GLM
- Userul trebuie sa vada vizual: "Kimi: 45%" sau "GLM: activ"

**Actiuni:**

1. **Backend:** Adauga endpoint `/api/quota` care returneaza:
   ```json
   { "provider": "kimi", "used_percent": 45, "remaining": 5500, "limit": 10000 }
   ```
   - Citeste cotalele din `tier-state.json` sau din variabilele de mediu `KIMI_API_KEY` / `GLM_API_KEY`
   - Cand primesti 403 de la Kimi, intoarce `provider: "glm"`

2. **Frontend:** Adauga componenta `QuotaBar` in `ChatPanel.tsx` sau langa avatar:
   - Bar verticala subtire, colorata (verde >50%, galben 20-50%, rosu <20%)
   - Text mic: provider + procent
   - La switch pe GLM, schimba culoarea in albastru si textul in "GLM"

3. **Failover:** Logica existenta de failover trebuie sa fie vizibila pentru user, nu doar in backend.

---

## ORDINEA 6: Admin panel functional (scroll, butoane, toate campurile)

**Probleme:**
- Panel-ul admin nu are scroll (continutul e taiat)
- Butoanele nu raspund
- Unele campuri nu se afiseaza

**Actiuni:**

1. **CSS:** Adauga `overflow-y: auto` si `max-height: 100vh` pe containerul admin panel
2. **React:** Verifica daca butoanele au handler-uri atasate (`onClick`)
3. **Formulare:** Verifica daca toate input-urile au `name`, `value`, si `onChange`
4. **Date:** Asigura-te ca endpoint-urile `/api/admin/*` returneaza JSON valid si nu 403 pentru adminul logat

**Verificare:** Intra ca admin pe `/admin`, testeaza fiecare buton si fiecare tab.

---

## ORDINEA 7: Stripe + sistem credite (verificare logica end-to-end)

**Cerinta:**
- Userul cumpara credite prin Stripe
- Adminul vede tranzactiile si balanta fiecarui user
- Sistemul de preturi e clar (ex: 10 EUR = 1000 credite)

**Actiuni:**

1. **Backend:** Verifica rutele `/api/stripe/*`:
   - Creare PaymentIntent sau Checkout Session
   - Webhook Stripe care adauga credite la plata confirmata
   - Endpoint pentru balanta userului curent

2. **Frontend:** Verifica pagina de cumparare credite:
   - Butoane cu sume clare (5 EUR, 10 EUR, 50 EUR)
   - Fiecare buton declanseaza Stripe Checkout sau PaymentElement
   - Dupa plata, redirect success cu actualizare balanta

3. **Admin:**
   - Tabel cu tranzactii: user, suma, credite, status, data
   - Filtrare dupa status (succeeded, failed, pending)

4. **Test:** Fa o plata test cu cardul Stripe test (`4242 4242 4242 4242`) si confirma ca creditele apar in cont.

---

## PROCEDURA DE EXECUTIE (respecta strict)

1. **Pentru fiecare ordine:**
   ```bash
   git checkout -b fix/ordinea-X
   # modifica codul
   npm run build  # backend + frontend
   npm test       # daca exista
   git commit -m "fix: ordinea X - descriere scurta"
   ```

2. **Dupa toate cele 7:**
   ```bash
   git checkout master
   git merge fix/ordinea-1 fix/ordinea-2 ...  # sau un singur branch cu toate
   bridge/kelion-github publish master "Fix: 7 ordine critice" "Curatare Antropic, reparare TS, hydration, quota, admin, Stripe"
   ```

3. **Verificare live:**
   ```bash
   curl -s https://kelionai.app/api/version
   curl -s https://kelionai.app/health
   ```

---

## REGULA DE FIER

- **NICIODATA** `railway up` direct
- **NICIODATA** force-push
- **INTOTDEAUNA** build + test inainte de commit
- **INTOTDEAUNA** verificare live cu curl dupa deploy

Executa. Raporteaza progresul la fiecare ordine terminata.
