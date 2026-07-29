# PROCEDURA ANTI-CLONE — cum rămâne codul unic, permanent

> Ordinul lui Adrian: **„folosești principiul permanent unic fără duplicate"** și
> **„0 clone, ăsta e targetul"**. Documentul ăsta nu e teorie: e procedura scoasă
> din cauzele REALE care au produs cele ~50 de clone găsite pe 29 iulie 2026 —
> inclusiv **2 clone pe care le-a produs chiar AI-ul care le curăța**, în aceeași zi.

---

## 1. Ce ESTE și ce NU este o clonă

**CLONĂ REALĂ (se elimină, fără discuție):** aceeași logică, copiată în 2+ locuri,
care POATE trăi într-o singură sursă.
- antetele + corpul cererii către creier, copiate în 5 funcții → `orFetch`/`orBody`
- apelul GitHub copiat în 2 fișiere → `services/githubApi.ts`
- bucla SSE copiată în openrouter + gemini → `services/sse.ts`
- executorul unei unelte, copiat în chat.ts și realtime.ts → `services/adminTools.ts`

**NU e clonă (nu se forțează — a le uni SPARGE aplicația):**
- **backend ↔ frontend** (`db.ts` ↔ `frontend/lib/admin.ts`): aceleași *tipuri de
  contract API*, dar runtime-uri diferite (Node vs browser). Nu pot importa același
  modul peste HTTP.
- **semnături de interfață** (`geminiDirect` ↔ `openrouter`): doi furnizori care
  implementează ACELAȘI contract, ca orchestratorul să-i cheme interschimbabil.
  Asta e conformitate, nu copiere.
- **CSS/JSX coincidental**: reguli sau blocuri de interfață care seamănă token-wise
  fără să aibă logică comună.

Regula de decizie, în două întrebări:
1. *Dacă schimb regula asta, trebuie să editez în 2 locuri ca să rămână corect?*
   → **DA = clonă reală, se extrage.**
2. *Le pot uni fără să traversez o graniță de runtime (server↔browser) sau să
   contopesc două implementări ale aceleiași interfețe?* → **NU = se lasă, cu
   motivul scris lângă ea.**

---

## 2. Cauzele reale (de ce au apărut, ca să nu reapară)

Măsurat, nu presupus:

| Cauză | Exemplu real | Antidot |
|---|---|---|
| **Copy-paste sub viteză** | antetele OpenRouter în 5 funcții | pasul 3.1 (caută înainte să scrii) |
| **Două rute paralele** (chat + voce) | executorii uneltelor, oglindiți manual | **orice unealtă nouă intră ÎNTÂI în sursa comună**, niciodată direct în rută |
| **Mai mulți furnizori** (OpenRouter/Gemini) | bucla SSE hand-rolled de 2 ori | scheletul comun în `services/`, procesarea specifică la apelant |
| **Definiții LOCALE într-o rută** | `BROWSER_TOOLS`, `COST_TOOL` etc. erau `const` în chat.ts → vocea n-avea cum să le ceară | **definițiile de unelte NU stau în rute**, stau în `brainToolDefs.ts` |
| **Curățenie fără verificare** | AI-ul a mutat 7 cazuri în sursa comună dar a UITAT să le șteargă din chat.ts → 2 clone NOI | pasul 3.4 (măsoară DUPĂ, nu doar înainte) |

---

## 3. PROCEDURA (obligatorie la fiecare schimbare)

### 3.1 ÎNAINTE de a scrie o funcție nouă — caută dacă există deja
```bash
grep -rn "<numele funcției sau 3 cuvinte din corp>" backend/src frontend/src
```
Dacă găsești ceva asemănător: **folosește-l sau extrage-l**, nu scrie al doilea.

### 3.2 Locul corect al lucrurilor (unde se pune ce)
| Ce | Unde stă | NICIODATĂ |
|---|---|---|
| definiția unei unelte (`Tool`) | `services/brainToolDefs.ts` | `const` local într-o rută |
| execuția unei unelte partajate | `services/adminTools.ts` (`execSharedAdminTool` / `execUserScopedTool`) | copiat în chat.ts ȘI realtime.ts |
| apel HTTP către un serviciu extern | un `services/<serviciu>.ts` cu un singur `fetch` | `fetch` repetat în fiecare funcție |
| formatare/conversie folosită de 2 rute | `services/` (ex. `timeContext.ts`) | duplicat în ambele |

### 3.3 Când extragi — comportament IDENTIC, doar mutat
- păstrează **ordinea parametrilor**, **formele de retur**, **timeout-urile**,
  **cheile de idempotență**. Diferențele reale (ex. 20s vs 15s) devin **parametru
  cu valoare implicită**, nu două copii.
- rulează după fiecare extragere: `npx tsc --noEmit` **și** `npx vitest run`.

### 3.4 DUPĂ schimbare — măsoară (pasul pe care AI-ul l-a sărit și a produs 2 clone)
```bash
npx --yes jscpd                      # din rădăcina repo-ului
```
Compară numărul cu cel de dinainte. **Dacă a crescut, ai introdus o clonă —
o repari ACUM, în aceeași schimbare, nu „mai târziu".**

Cauza tipică: ai pus logica în sursa comună dar ai **uitat să ștergi originalul**.

### 3.5 Nu lăsa un „handler orfan"
Când muți execuția în sursa comună, ruta trebuie să **delege**, nu să păstreze
copia:
```ts
if (USER_SCOPED_TOOLS.has(name)) {
  const out = await execUserScopedTool(name, args, email, isAdmin)
  if (out !== null) return out
}
```
Și **ștergi** vechiul `case`. Paznicul (`brainCapabilities.test.ts`) acceptă ambele
căi ca handler valid — deci nu ai scuză să ții copia „ca să treacă testul".

---

## 4. Plasa automată (rulează singură, la fiecare PR)

- **`.jscpd.json`** — detectorul de duplicate (token-based, min 50 token / 5 linii).
- **`.github/workflows/pr-verify.yml`** — pasul *„Duplicare (jscpd)"* rulează la
  FIECARE pull request și **pică roșu peste pragul de 2%** (azi: 0,59%).
- **`brainCapabilities.test.ts`** — paznicul §5: dacă o capabilitate există dar
  creierul nu ajunge la ea pe vreo cale, CI-ul pică. Include acum și paznicul de
  regresie **adormite pe voce = 0**.

Detectorul e informativ (nu blochează merge-ul, prin ordinul „CI informativ"), dar
**duplicarea devine VIZIBILĂ automat** — nu se mai poate strecura pe tăcute.

---

## 5. Starea măsurată (de referință, la ultima curățare)

| Moment | Clone | % |
|---|---|---|
| Înainte de curățare (29 iul) | **50** | 1,51% |
| După curățarea clonelor reale | **16** | 0,59% |
| După §1 (unelte pe voce) — 2 clone introduse din neatenție | 18 | 0,63% |
| După repararea lor (aceeași zi) | **16** | 0,59% |

Cele **16 rămase sunt din categoria „NU e clonă"** (§1 de mai sus): tipuri de
contract backend↔frontend, semnături de interfață între furnizori, CSS/JSX
coincidental. **Zero absolut nu e atins prin forțarea lor** — s-ar sparge granițe
reale (server↔browser) sau s-ar contopi două implementări care TREBUIE să rămână
separate. Ținta operațională e deci: **zero clone REALE**, iar cele inevitabile
rămân **enumerate și motivate**, niciodată ascunse.

Dacă o clonă din listă devine reductibilă (ex. apare un pachet de tipuri partajat
între backend și frontend), se elimină atunci — și se taie din listă aici.
