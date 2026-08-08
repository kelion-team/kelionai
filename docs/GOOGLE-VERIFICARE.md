# Dosar de verificare Google OAuth — Kelionai (calea 100% gratuită)

> Scop: acces complet la Google pentru ORICE client, **fără plată**, fără ecranul
> roșu „Google hasn't verified this app". Proiect Google Cloud: **28510866860**.
> Homepage + privacy + terms sunt LIVE (verificate: kelionai.app, /privacy, /terms → 200).

## 0. Trei căi, toate gratuite (alege ritmul)

1. **ACUM, gratis, fără nicio verificare — „Test users".** În OAuth consent screen,
   status **Testing**, adaugi până la 100 test users → acces COMPLET la toate
   scope-urile, imediat. Warningul se clichează o dată („Advanced → Continue").
   Token-ul se reîmprospătează la 7 zile. Bun pentru tine + primii clienți.
2. **Verificare Google (scope-uri SENSIBILE) — GRATIS.** Review de branding +
   privacy + demo video. Scoate warningul. Token-ul nu mai expiră la 7 zile.
3. **CASA Tier 2 self-assessment (scope-uri RESTRICTED: Gmail read, Drive read) —
   GRATIS.** Scanare automată printr-un partener; nu e obligatoriu asesor plătit.

## 1. Datele aplicației (de completat în OAuth consent screen)

- **App name:** Kelionai
- **User support email:** contact@kelionai.app
- **Developer contact:** adrianenc11@gmail.com
- **App homepage:** https://kelionai.app
- **Privacy policy:** https://kelionai.app/privacy
- **Terms of service:** https://kelionai.app/terms
- **Authorized domain:** kelionai.app
- **App logo:** logo-ul Kelionai (pătrat, ≥120px, fără colțuri transparente)

## 2. Scope-urile cerute + justificarea (una per scope — se cere la verificare)

Clasificare: **[S]** = sensibil (verificare gratuită) · **[R]** = restricted (CASA gratuit).

| Scope | Tip | Justificare (de ce, ce date, cum) |
|---|---|---|
| `openid`, `email`, `profile` | bază | Autentificarea userului (login). |
| `calendar.events`, `calendar.readonly` | S | Kelion citește agenda și creează evenimente la cererea userului („pune-mi o întâlnire"). |
| `gmail.send` | S | Kelion trimite emailuri în numele userului, la cererea lui explicită. |
| `gmail.readonly` | R | Kelion citește ultimele emailuri și le rezumă când userul întreabă de inbox. |
| `drive.readonly` | R | Kelion găsește și citește fișierele userului („ce am pe Drive despre X"). |
| `tasks` | S | Kelion citește și adaugă în lista de sarcini Google Tasks. |
| `contacts` | S | Kelion caută un contact ca să trimită email / să sune / să programeze. |
| `photoslibrary.readonly` | S | Kelion caută și afișează pozele userului la cerere. |
| `youtube.readonly` | S | Kelion caută și pune videoclipuri pe monitor. |

## 3. Demo video (cerut la verificare — screen recording, ~2-4 min)

Arată, în ordine, pe kelionai.app:
1. **OAuth consent screen** — cum userul se loghează și vede exact scope-urile cerute.
2. Pentru FIECARE scope sensibil/restricted, o secvență în care Kelion îl folosește real:
   - Calendar: „ce am azi în agendă?" → răspuns; „pune-mi o întâlnire mâine la 15" → creat.
   - Gmail: „ce emailuri noi am?" → rezumat; „trimite un email către X" → trimis.
   - Drive: „găsește documentul Y" → listat/citit.
   - Tasks: „adaugă o sarcină" → adăugată.
   - Contacts: „caută contactul Z".
   - Photos: „arată-mi pozele din vacanță".
   - YouTube: „pune un clip cu ...".
3. Arată legătura clară scope ↔ funcție (verificatorul trebuie să vadă DE CE e nevoie de fiecare).

## 4. Pașii de trimitere

1. OAuth consent screen → completează secțiunea 1 de mai sus.
2. Adaugă toate scope-urile de la secțiunea 2.
3. „Publishing status" → **Publish app** → **Prepare for verification**.
4. Încarcă demo video-ul + justificările pe scope.
5. Pentru `gmail.readonly` + `drive.readonly` (restricted) → urmează fluxul **CASA
   Tier 2 self-assessment** (link în emailul Google după trimitere) — gratuit.
6. Trimite. Răspunsul vine pe email (sensibile: zile; CASA: mai lung).

## 5. Dacă vrei să EVIȚI complet CASA și tot gratis, tot public

Scoate cele două scope-uri **restricted** (`gmail.readonly`, `drive.readonly`)
din `backend/src/routes/auth.ts` (`FULL_SCOPES`). Rămâne totul sensibil →
DOAR verificare gratuită, fără CASA. Compromis: Kelion tot poate TRIMITE email
(`gmail.send`) și folosi Calendar/Tasks/Contacts/Photos/YouTube, dar nu mai
CITEȘTE inboxul Gmail și nu mai citește fișiere arbitrare din Drive.
