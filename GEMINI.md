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
  kelionai.app (veghea de pe VPS, ~9 minute, măsurat). **NICIODATĂ push direct
  pe master**: ramură → PR → ownerul decide merge-ul.
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

## Verificări OBLIGATORII înainte de orice commit
```bash
cd backend  && npx tsc --noEmit && npx vitest run   # totul verde
cd frontend && npx tsc -b --force   # NU --noEmit: tsconfig.json e „solution" (files:[]) — --noEmit nu verifică NIMIC; Docker rulează tsc -b (măsurat 8 aug: --noEmit verde local, tsc -b roșu în deploy, publicarea blocată 20 min)
node scripts/verifica-sintaxa.mjs                    # din rădăcină; pică pe markere de conflict
```

## Structura, pe scurt (harta completă: AI-HANDOFF.md §2)
- `backend/` — Node + Fastify + TS: rute în `src/routes/`, servicii în `src/services/`
- `frontend/` — React + Vite + TS: `src/pages/Stage.tsx`, `src/components/ChatPanel.tsx`
- `bridge/` — lucrătorul de pe VPS + scripturile de publicare/reparare
- `Dockerfile` — imaginea aplicației (gazda: VPS propriu)

## Dacă schimbi cod, arhitectură sau starea proiectului
Actualizează secțiunea relevantă din `AI-HANDOFF.md` (și §13 „Starea") înainte
să închei. Documentul viu e SINGURUL mecanism de predare între agenți — un
handoff vechi e mai rău decât niciunul.
