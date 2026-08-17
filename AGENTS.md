# Kelionai — Project Rules (Warp AGENTS.md)

Aceste reguli se aplică automat agenților Warp în acest repo.
Complementează `CLAUDE.md`, `HANDOFF.md`, `STATUS.md`.

## Proprietar și limbă
- Răspunde proprietarului în **română**.
- Owner / sole admin: `adrianenc11@gmail.com`.
- Nu atinge arhiva veche `C:\Users\adria\Downloads\k`.
- Nu inventa stări „OK” fără dovezi (probe HTTP 200, loguri, teste). Kelion nu minte.

## Free-first + auto-escalate (OBLIGATORIU)
1. **Free local first** — chat, constructor, creier/work: încearcă mereu creierul local free (Ollama / Aider free / model rapid free) înainte de orice cloud plătit.
2. **Fără salt nejustificat pe plătit** — eșec free NU înseamnă flip manual pe panel sau abandon. Escaladează automat **în același run** doar dacă există cheie + model paid disponibil ȘI motivul e unul din:
   - free indisponibil / timeout / throttle
   - free nu produce schimbare utilă (no-change)
   - eșec de calitate clar (răspuns gol, eroare de edit, overflow context)
3. **Raportare sursă** — orice răspuns/job trebuie să poată raporta care creier a servit: `free_local` vs `paid_cloud` (model + motiv escaladare).
4. **creier-config** — API-ul de config returnează `preferred: free` + `fallback: paid` ca worker-ul să poată escalada fără schimbare de panel.
5. **Quality ladder** — pe chat/work: model rapid free → model mai puternic free dacă există → paid doar la nevoie reală.
6. **Constructor free path** — forțează Ollama local pe roluri main/editor/weak; șterge config toxic OpenRouter din atelier pe job free; nu lăsa `OPENROUTER_API_KEY` activ pe calea free dacă forțează salt greșit.
7. **Lessons journal** — la eșec: salvează permanent semnătură eroare + metodă de fix; injectează lecțiile în context constructor și în prompturile creierului la job-uri ulterioare.
8. **Context free** — cap pe prompt/history free; wipe history toxic pe overflow; preferă pași mici specifici decât un prompt uriaș.

## Acceptare live (probe)
- Doar **HTTP 200** contează ca succes pe probe live (chat, health, version, constructor).
- Chat admin live: sesiune reală cu cookie `kelionai_session` (JWT mint din backend), nu token intern pe rute care cer cookie.
- Constructor: ordin de probă trebuie să poată ajunge `done` cu Aider+Ollama când free e ținta; dacă escaladează, raportează explicit de ce.
- După fix pe cerință: **build + deploy**, nu stivui multe schimbări nedeployate (owner testează pe kelionai.app).

## Stabilitate produs
- Chat/voce: latență mică; fără delay-uri nejustificate.
- Nu masca erori — audit clar, recovery robust, fără căderi după câteva ture.
- Bari de stare pe monitor pentru orice execuție (chat, deploy, constructor).
- Fix prin rescrierea modulului responsabil mic — fără band-aid-uri.

## Repo / deploy
- Lucru principal: monorepo `C:\Users\adria\Kelionai`; pe VPS calea tipică `/root/kelion` când e accesibil.
- Deploy: Railway service web → `https://kelionai.app` (`railway up --detach` după build).
- Nu reporni servicii bridge masked fără ordin explicit.
- Nu cere chei/parole în chat; folosește env/secret manager.

## Implementare (când modifici cod)
- Funcții pure pentru decizia de escaladare + teste unitare.
- Nu marca free „defect” ca scuză să sari pe paid fără ladder + jurnal.
- Sync master/live după schimbări pe creier/constructor; verifică version/health live.
