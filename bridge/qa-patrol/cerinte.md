# REGISTRUL DE CERINȚE (acceptare) — ce TREBUIE să facă Kelionai

Ăsta e „ce ar trebui" cu care se compară „ce face" ca să iasă un BUG. Fără el,
nicio mașină (nici QA-ul, nici Kelion) nu poate ști că o funcție s-a stricat sau
lipsește — un răspuns „greșit dar valid" (200 OK) nu lasă urmă, iar codul care nu
există nu dă eroare. (Adrian, 14 iul: „ce trebuie să depisteze QA toate astea și
să le raporteze într-o listă către Kelion.")

## Cum lucrează Kelion cu registrul ăsta
- Îl **citește** când verifică sănătatea unei funcții (e în repo, lazy-load).
- **QA-patrol** (`kelion-qa-patrol.mjs`) transformă criteriile MAȘINĂ-verificabile
  de mai jos în probe reale; când ceva NU e 200, **informează creierul** (notă în
  caiet) — NU blochează și NU comandă. Creierul decide ce/cine și verifică până e 200.
- Criteriile marcate **[live]** cer testul lui Adrian cu microfon/cameră reale —
  QA nu le poate sintetiza; Kelion i le cere lui Adrian, nu le declară „merg" singur.

---

## Creier / modele
- **merge dacă:** `/api/version` întoarce 200 cu `{v}` proaspăt. `[QA: version]`
- **merge dacă:** creierul e Kimi 2.7 (`kimi-k2-thinking`) primar, GLM `glm-5.2`
  rezervă — verificat că endpointul le servește 200. `[vps-diag]`
- **merge dacă:** chatul public răspunde ne-gol la un mesaj real. `[QA: chat-public]`

## Voce — identificare vorbitor
- **merge dacă:** genul (bărbat/femeie) se detectează din pitch la fiecare tură cu
  voce. Salvat în tabelul `voiceprints`. `[QA: biometrie-contract]`
- **merge dacă:** când vorbește TITULARUL, creierul primește „SPEAKER: titular";
  când vorbește ALTCINEVA, primește „ALTCINEVA — nu titularul". Referința
  titularului NU se corupe când vorbește altcineva. `[live]`
- **merge dacă:** identificarea NU adaugă latență pe chat (citiri paralele, scrieri
  fire-and-forget). `[cod: Promise.all + void save în chat.ts]`

## Față — recunoașterea persoanei (cameră)
- **merge dacă:** modelele face-api se servesc din `/models` (altfel fața nu poate
  rula). `[QA: face-models]`
- **merge dacă:** când camera e pornită, descriptorul feței se extrage în FUNDAL,
  fără buton, fără să încetinească chatul. `[cod: faceprint.ts lazy + getPending]`
- **merge dacă:** fața titularului e recunoscută ca „titular"; o altă față ca
  „altcineva". Salvat în tabelul `faceprints`. `[live]`

## Voce live / full-duplex
- **merge dacă:** chatul e audio→audio (STT → creier → TTS Chirp 3 HD). `[live]`
- **merge dacă:** primul cuvânt începe rapid pe calea de chat streaming
  (TTFB măsurat ~0.8s). `[QA: chat-public timing]`
- **merge dacă:** pe calea full-duplex (LiveKit, admin) se poate vorbi PESTE Kelion
  și el aude (barge-in); serverul LiveKit + agentul de voce sunt sus. `[vps-diag + live]`

## Cameră / vedere
- **merge dacă:** camera pornește și trimite cadre la creier; cadrele negre (lentilă
  acoperită) sunt respinse, nu trimise. `[live]`

## Publicare / deploy
- **merge dacă:** producția = `master`, 100% sincron; nimic nu publică cod mai vechi
  (verificare anti-fantomă: `/api/version` TREBUIE să se schimbe la deploy). `[deploy.yml]`
- **merge dacă:** cheia GitHub poate publica (PR/merge). `[kelion-github doctor]`

---

## Ce NU poate prinde QA singur (limitele — de spus cinstit)
- Corectitudinea BIOMETRICĂ reală (voce/față) — cere input real (microfon/cameră);
  doar Adrian o validează `[live]`. QA verifică doar că traseul nu crapă (200, nu 500).
- „Sună natural / arată bine" — judecată umană, nu probă automată.
Când un criteriu e `[live]`, Kelion îi CERE lui Adrian să confirme, nu declară el.
