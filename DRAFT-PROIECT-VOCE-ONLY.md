# DRAFT — Kelion voce-only (proiect în lucru cu Adrian, 20 aug 2026)

> Document de LUCRU. Deciziile de mai jos sunt luate împreună cu owner-ul, pas cu
> pas. NU e implementat nimic încă — întâi batem logica, apoi codul.

## Problema care a pornit totul
Chatul vocal „pornește 2 sec și se rupe". Cauză MĂSURATĂ live
(`/api/vocal-live/stare`: `cadreAudioDeLaGoogle:15`, `cadreAudioSpreBrowser:9`,
`suprimateDupaTaiere:6`): **două motoare de voce se bat.**
- **Gemini Live** (`vlRef`) — full-duplex, are gura lui, pentru VORBIT.
- **Chirp** (TTS pe server, `{audio}`) — pentru SCRIS.
Pe o tură VORBITĂ pornesc AMÂNDOUĂ; Chirp îi cere gura lui Live → trimite
„întrerupe" → Live e tăiat la ~2s. De-aia se rupe.

## DECIZIA (arhitectura țintă)
1. **Online = chat audio LIVE, DOAR voce. Fără scris pe ecran.**
2. **Un singur motor: Gemini Live.** Fără Chirp online → **zero coliziune → bug-ul dispare din rădăcină.**
3. **Textul se folosește DOAR la salvare** (transcript → memorie/istoric), **invizibil** — nu se afișează, nu se rostește a doua oară.
4. **Scrisul rămâne DOAR pe offline** (rezervă, WebLLM Qwen — el n-are voce live, n-are net).

## Treapta superioară (escaladarea) — logica
1. Vorbești → Gemini Live te aude.
2. Live judecă: UȘOR (conversație) sau GREU (unealtă / gândire adâncă / acțiune)?
3. **Ușor** → Live răspunde singur, cu vocea lui. O gură.
4. **Greu** → Live cheamă serverul (ușa `cere_creierului`), care rulează:
   - creierul PUTERNIC (Gemini Pro),
   - + uneltele (Google, acțiuni).
   Serverul întoarce răspunsul ca TEXT.
5. **Rezultatul greu se rostește tot de Gemini Live** (se dă înapoi în sesiunea
   live), NU de Chirp. Așa rămâne un singur motor.

## NODUL — VERIFICAT DIN COD (20 aug, nu ghicit)
Întrebarea care decidea tot: **poate Gemini Live să rostească, cu vocea lui, un
text venit de la server (rezultatul de la creierul greu)?**
**RĂSPUNS: DA.** Dovadă în `backend/src/services/vocalLive.ts`:
- Live scoate GREUL ca **apel de funcție = TEXT/JSON** (`toolCall.functionCalls`,
  ~l.480–483). NU e audio între Live și superior.
- Serverul rulează creierul superior (Gemini Pro + unelte) și dă rezultatul
  înapoi tot **TEXT/JSON** (`toolResponse.functionResponses`, ~l.743).
- Live primește textul și **rostește el, cu vocea lui** (audio spre user). Există
  și `anunta(text)` = server bagă un text, Live răspunde cu gura lui
  (`clientContent … turnComplete:true`, ~l.561/730).

### CANALUL ușor↔greu = TEXT, NU audio (întrebarea lui Adrian, răspuns măsurat)
- Audio e DOAR user↔Live.
- Între Live și creierul superior: **funcție (apel + răspuns), text/JSON.**
- „Live vorbește audio cu superiorul pe canal ascuns" — **nu există.**
- „Se face text → superior → text înapoi → Live aduce audio" — **exact asta e.**

### Consecința
**Un singur motor (Gemini Live) e de ajuns, inclusiv la GREU. Chirp NU e necesar.**
Cinstit: implicit Live REFORMULEAZĂ, nu citește cuvânt-cu-cuvânt. Când vrem EXACT
(cifră, adresă), îi punem în instrucțiune „rostește exact textul dintre
ghilimele". Reglabil, nu blocaj.

## Ce NU s-a decis încă / următorii pași
- Verificarea nodului de mai sus (Live rostește text injectat?).
- Detaliul escaladării (cum decide Live „greu", cum se întoarce rezultatul în
  sesiune, ce se salvează).
- Offline: cum rămâne (text) fără să strice povestea online (voce).
- (În paralel, decis separat) constructorul = Devin, extern, pe cheia owner-ului.

## Reguli de lucru (owner)
- Fără grabă. Se notează ce se vorbește, se stă la rând cu logica programului.
- Nimic „gata" fără dovadă măsurată. Valorile neverificate = „nu pot verifica".
