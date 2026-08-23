# Kelionai — ghid pentru ORICE agent AI care lucrează în repo-ul ăsta

Fișierul ăsta e citit automat de agenții pe modele Gemini (Gemini CLI,
aplicații desktop cu Gemini). E copia 1:1 a lui `AGENTS.md`; același ghid
pentru Claude e `CLAUDE.md`. **Dacă editezi regulile, editează toate trei.**

Proiectul: **Kelion** — asistent AI viu (avatar 3D, voce, vedere, skilluri
Google), în producție la **kelionai.app**. Ownerul: Adrian
(adrianenc11@gmail.com), singurul admin. **Răspunde-i în ROMÂNĂ.**

## Citește ÎNTÂI, în ordinea asta
1. **`AI-HANDOFF.md`** — SURSA DE ADEVĂR, întreținută activ: arhitectura
   completă, fiecare rută/serviciu/componentă, schema DB, banii, CI, ce e mort
   și ce e viu. (`HANDOFF.md` și `STATUS.md` sunt vechi — nu te lua după ele.)
2. **`RAMAS-DE-FACUT.md`** — lista ownerului cu ce NU e făcut și ce NU merge,
   cu dovezi pe fiecare rând.

## Regulile care NU se negociază
- **Production = master.** Orice merge pe master SE PUBLICĂ AUTOMAT pe
  kelionai.app (veghea de pe VPS, ~9 minute, măsurat). **O SINGURĂ RAMURĂ:
  master.** Interzis să creezi ramuri auxiliare (enhance/*, fix/*, etc.) —
  lucrezi direct pe master, commit + push pe master. Greșeala din 22 aug 2026
  (3 ramuri create inutil) a costat timp și confuzie. **NU se repetă.**
- **Nimic nu e „gata" fără verificare LIVE cu dovadă măsurată** (curl pe
  kelionai.app; `/api/version` arată SHA-ul care chiar rulează). Ownerul
  testează live, nu local.
- **O valoare care nu vine dintr-o măsurătoare reușită = „nu pot verifica".**
  Niciodată un număr inventat; niciodată un 0 rămas dintr-un request picat
  prezentat ca fapt; un 2xx cu `ok:false` în corp e un DEFECT, nu un succes.
- **Nu rula operații în masă pe ce n-ai citit.** (`git add -A` pe un merge
  conflictual a băgat odată markere `<<<<<<<` în cod viu.)
- **Chat/voce = latență mică** (prima vorbă sub 1s). Nu adăuga NIMIC pe drumul
  unei fraze — orice verificare grea merge în faza de decizie, nu în vorbire.
- **Repară rescriind modulul mic responsabil** — fără petice peste petice.
- Nu atinge `C:\Users\adria\Downloads\k` — e proiectul VECHI, arhivat.
- Când ownerul contrazice un raport al tău, PRIMUL loc în care cauți e propriul
  tău cod care a produs raportul. De obicei el are dreptate.
- **VERIFICĂ ÎNAINTE ce există deja** (owner, 23 aug 2026: „implementeaza-ti
  sa verifici pentru orice faci daca nu exista oportunitatea de a folosi ce
  exista sau a fost deja implementat"). Înainte să creezi o funcție, componentă,
  rută, pattern sau badge — caută în codebase dacă există deja. Caz real: am
  creat un badge text pentru emoții când avatarul avea morph targets ARKit.
  Poarta: `node scripts/verifica-duplicari.mjs` — pică build-ul pe duplicări.

## Verificări OBLIGATORII înainte de orice commit
```bash
cd backend  && npx tsc --noEmit && npx vitest run   # totul verde
cd frontend && npx tsc -b --force   # NU --noEmit: tsconfig.json e „solution" (files:[]) — --noEmit nu verifică NIMIC; Docker rulează tsc -b (măsurat 8 aug: --noEmit verde local, tsc -b roșu în deploy, publicarea blocată 20 min)
node scripts/verifica-sintaxa.mjs                    # din rădăcină; pică pe markere de conflict
node scripts/verifica-hardcodari.mjs                 # pică pe cifre/stări hardcodate
node scripts/verifica-duplicari.mjs                  # pică pe funcții/rute/pattern-uri duplicate
```

## Structura, pe scurt (harta completă: AI-HANDOFF.md §2)
- `backend/` — Node + Fastify + TS: rute în `src/routes/`, servicii în `src/services/`
- `frontend/` — React + Vite + TS: `src/pages/Stage.tsx`, `src/components/ChatPanel.tsx`
- `deploy/` — scripturile de publicare/reparare de pe VPS (`bridge/` NU mai
  există — șters 23 iul; referințele la el sunt istorie, nu arhitectură)
- `Dockerfile` — imaginea aplicației (gazda: VPS propriu)

## Dacă schimbi cod, arhitectură sau starea proiectului
Actualizează secțiunea relevantă din `AI-HANDOFF.md` (și §13 „Starea") înainte
să închei. Documentul viu e SINGURUL mecanism de predare între agenți — un
handoff vechi e mai rău decât niciunul.


## LEGEA ANTI-HARDCODARE (owner, 16 aug 2026 — LEGE pentru ORICE AI care lucrează aici)
Ordinul verbatim: „creiaza legi si mecanisme automate de cautare a hardocodului
pe aplicatie, si explicat oricarui ai vine foarte clare ca nu e admis hardcodat
pe aplicatie".
- **NU e admis hardcodat pe aplicație**: nicio cifră de bani, prag, tarif, nume
  de model AI sau stare arătată omului nu se scrie de mână în cod — totul vine
  dintr-o sursă VIE (config/env/kv/DB/server/unealtă). O cifră scrisă de mână
  minte în ziua în care realitatea se schimbă (măsurat: tarife inventate
  24/48/200 vs realele 6/12/50; modelul pensionat care a tăcut zile întregi).
- **Poarta automată**: `node scripts/verifica-hardcodari.mjs` — pică build-ul
  pe hardcod negăzduit. O rulezi la fiecare livrare, ca pe tsc.
- **Excepția se declară PE LINIE, cu motiv**: `// hardcod-permis: <motivul>`.
  Fără motiv scris lângă faptă, poarta pică. Nu există listă ascunsă.
- În creierele live, legea e în promptul de sistem (LEGILE ADMINULUI, chat.ts):
  LEGEA FAPTEI + LEGEA MĂSURĂTORII + LEGEA ANTI-HARDCODARE — plus POARTA
  FAPTELOR care demască automat pretențiile fără unealtă executată.
