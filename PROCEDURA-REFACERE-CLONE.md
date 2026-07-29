# PROCEDURA DE REFACERE — cele 16 clone rămase, rescrise CURAT

> Ordinul lui Adrian: **„scrie procedura de înlocuit toate clonele cu cod fresh
> curat"** + **„0 clone, ăsta e targetul"**.
>
> Documentul complementar `PROCEDURA-ANTI-CLONE.md` spune cum NU mai apar clone
> noi. Ăsta spune cum se **elimină cele care au mai rămas** — nu prin cârpeală
> (extras un helper peste codul vechi), ci prin **rescrierea curată a modulului
> responsabil**, cu comportament dovedit identic.

---

## Principiul de lucru (regula lui Adrian, aplicată)

> „Repari prin rescrierea modulului mic responsabil — fără cârpeli."

Pentru fiecare clonă:
1. **Nu** copiezi codul vechi într-un helper și gata.
2. **Rescrii curat** unitatea responsabilă (tipul, funcția, modulul), cu un
   contract explicit, comentat, testabil.
3. **Dovedești** că nu s-a schimbat comportamentul: `tsc --noEmit`, `vitest`,
   apoi `jscpd` (numărul TREBUIE să scadă), apoi **live cu sha**.
4. Un lot pe rând, **niciodată două loturi în același PR** — dacă pică ceva, se
   vede exact ce.

---

## Inventarul celor 16, împărțit pe loturi de refacere

Măsurat cu `npx jscpd` pe master (`9e6f301`) — 16 clone / 0,59%.

### LOTUL A — contractul API backend↔frontend (3 clone, 98 linii) — **CEL MAI MARE CÂȘTIG**

| Clonă | Ce e de fapt |
|---|---|
| `db.ts:1738` == `frontend/lib/admin.ts:190` (42L) | tipurile `DemoRecent` + `DemoStats`, declarate identic în ambele capete |
| `db.ts:1658` == `frontend/lib/admin.ts:237` (36L) | idem, al doilea bloc |
| `services/stripe.ts:212` == `frontend/lib/admin.ts:63` (20L) | tipul `MoneyCircuit`, declarat în ambele capete |

**De ce există:** backend (Node) și frontend (browser) sunt două build-uri
separate — azi nu au niciun fișier comun, deci fiecare își redeclară forma
datelor care circulă prin API.

**REFACEREA CURATĂ (nu extragere — modul nou):**
1. Creezi pachetul de contract: **`shared/api-types.ts`** (fișier nou, doar
   `export interface` / `export type` — zero logică, zero import de runtime).
2. Rescrii ACOLO tipurile, curat, cu comentariul care spune că sunt **contractul
   HTTP** (nu tipuri interne de DB): `DemoRecent`, `DemoStats`, `MoneyCircuit`.
3. Le legi în ambele capete:
   - backend `tsconfig.json`: adaugi `"../shared"` la `include` (sau `rootDir: "."`
     cu `include: ["src", "../shared"]`);
   - frontend `tsconfig.app.json`: adaugi `"../shared"` la `include`.
   - ATENȚIE: backend e `NodeNext` (importuri cu `.js`), frontend e `bundler`.
     Fișierul fiind **doar tipuri**, se importă cu `import type` — nu produce
     `require`/`import` la runtime, deci nu se ciocnesc rezoluțiile.
4. Ștergi declarațiile vechi din `db.ts`, `stripe.ts`, `frontend/lib/admin.ts` și
   pui `import type { … } from '…/shared/api-types.js'`.
5. Verifici: `cd backend && npx tsc --noEmit` **și** `cd frontend && npx tsc -b`
   (ambele trebuie să treacă), apoi `npx vitest run`, apoi `npx jscpd` → **16 → 13**.

**Risc:** mic (doar tipuri, se șterg la compilare). **Dacă `tsc -b` al frontend-ului
refuză calea în afara rădăcinii**, alternativa curată e un `package.json` minim în
`shared/` declarat ca dependență locală (`"@kelionai/shared": "file:../shared"`).
Nu se forțează cu `paths` hack-uite în ambele configuri — asta ar fi cârpeală.

---

### LOTUL B — cele două motoare de creier (3 clone, 21 linii)

| Clonă | Ce e |
|---|---|
| `geminiDirect.ts:180` == `openrouter.ts:319` (8L) | semnătura funcției de stream (`model, messages, tools, onText, opts`) |
| `geminiDirect.ts:164` == `openrouter.ts:382` (7L) | semnătura funcției non-stream |
| `openrouter.ts:323` == `openrouter.ts:385` (6L) | garda `if (!key) return …` + semnătura, intern |

**De ce există:** amândouă implementează **același contract** al creierului, ca
orchestratorul să le cheme interschimbabil. Nu e cod copiat — e conformitate.

**REFACEREA CURATĂ:**
1. Scrii **`services/brainProvider.ts`** (nou): declari o dată tipul de opțiuni
   (`BrainCallOpts`) și **interfața** `BrainProvider` cu cele două metode
   (`chat`, `chatStream`), plus tipul rezultatului.
2. Rescrii `openrouter.ts` și `geminiDirect.ts` ca **implementări** ale interfeței:
   fiecare exportă un obiect `openrouterProvider` / `geminiProvider` care
   `satisfies BrainProvider`. Semnăturile nu se mai repetă textual — vin din tip.
3. Garda comună (`fără cheie → rezultat gol`) se scrie **o dată**, într-un
   `withKeyGuard(provider, hasKey)` din `brainProvider.ts`.
4. Orchestratorul alege providerul, nu prefixul de model (rămâne compatibil:
   prefixul `gemini-direct/` doar selectează providerul).
5. Verifici: typecheck + `vitest` + `jscpd` → **13 → 10**.

**Risc:** MEDIU — e calea creierului. Se face **singur în PR-ul lui**, cu test de
fum pe ambele providere (`chat` + `chatStream`) înainte de merge.

---

### LOTUL C — definiția uneltei, chat vs voce (1 clonă, 18 linii)

`routes/chat.ts:508` == `services/realtime.ts:244`

**Ce e:** blocuri cu `enum`-uri lungi (schema unei unelte vs lista de unelte a
vocii) pe care detectorul le potrivește pe **structură**, nu pe sens.

**REFACEREA CURATĂ:** enum-urile care descriu ACELEAȘI valori (panourile
aplicației, secțiunile de admin) se scriu o dată în `brainToolDefs.ts` ca
constante (`APP_VIEWS`, `ADMIN_SECTIONS`) și se folosesc în ambele scheme. Dacă
după asta detectorul tot le potrivește (structură pură), se marchează cu
`/* jscpd:ignore-start */ … /* jscpd:ignore-end */` **și cu motivul scris**.

Verificare: → **10 → 9**.

---

### LOTUL D — frontend, sunetul (2 clone, 20 linii)

`lib/audioIO.ts:413` == `lib/micStream.ts:129` și `:423` == `:137`

**Ce e:** aceeași secvență de pregătire a lanțului audio (context, noduri, resample).

**REFACEREA CURATĂ:** modul nou **`lib/audioGraph.ts`** — o funcție care
construiește lanțul o dată, cu parametri (rată, canale, destinație). `audioIO` și
`micStream` o cheamă. Se verifică **live cu microfon real** (regula din
AI-HANDOFF: optimizările pe voce se testează cu voce, nu doar cu typecheck).

Verificare: → **9 → 7**.

---

### LOTUL E — interfața (4 clone: CSS ×3, Stage ×2, Landing↔Stage, AdminPanel)

**Ce e:** reguli CSS și blocuri JSX care seamănă structural.

**REFACEREA CURATĂ:**
- CSS: se scriu **clase utilitare** (sau variabile CSS) pentru tiparul repetat, iar
  cele 2-3 locuri le folosesc. Nu se „unifică" selectori care descriu componente
  diferite.
- JSX: dacă cele două blocuri chiar arată la fel pe ecran → **componentă mică
  comună**; dacă doar seamănă token-wise (butoane diferite, semantică diferită) →
  se lasă și se notează.

Verificare vizuală obligatorie (build frontend + ochi pe pagină), apoi → **7 → 0-3**.

---

## Ordinea de execuție (de ce în ordinea asta)

1. **A** (contract API) — cel mai mare câștig (98 linii), risc mic, deblochează
   principiul „o singură definiție a datelor".
2. **D** (audio) — izolat, ușor de dovedit.
3. **C** (enum-uri unelte) — mic, curat.
4. **E** (interfață) — necesită verificare vizuală.
5. **B** (creierul) — ULTIMUL, e cel mai delicat; se face doar când restul e stabil.

**Un lot = un PR = un deploy = o dovadă live.** Nu se combină.

---

## Definiția lui „terminat", pentru fiecare lot

- [ ] `cd backend && npx tsc --noEmit` → exit 0
- [ ] `cd frontend && npx tsc -b` → exit 0
- [ ] `npx vitest run` → toate verzi (inclusiv paznicul §5)
- [ ] `npx jscpd` → numărul de clone a **SCĂZUT** (se notează: de la X la Y)
- [ ] merge în master → `/api/version` == sha-ul de master + `/health` 200
- [ ] rândul din tabelul de mai sus se taie, cu sha-ul live lângă el

## Ce NU se face niciodată în procedura asta

- nu se unesc două lucruri doar ca să scadă un număr (dacă se sparge o graniță
  reală server↔browser sau se contopesc două implementări ale aceleiași
  interfețe, **numărul rămâne mai mare și motivul se scrie**);
- nu se pun `jscpd:ignore` ca să „dispară" o clonă reală — ignore-ul e permis
  **doar** pentru potriviri pur structurale, cu motivul scris lângă;
- nu se face un lot fără măsurătoarea de după (pasul care a produs 2 clone noi
  pe 29 iul).
