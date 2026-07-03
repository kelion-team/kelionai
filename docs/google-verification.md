# Verificare Google OAuth — Kelion (kelionai.app)

Scopul: să dispară avertismentul „Google hasn't verified this app" la login, ca să
poți deschide aplicația publicului larg (peste 100 de useri, fără avertisment).
Proiect Google Cloud: **gen-lang-client-0460348646**.

> Nu e urgent. Până faci asta, aplicația merge cu tine (admin) + până la 100 de
> „test users". E relevant DOAR când scalezi public.

## Scopurile pe care le cere aplicația
- **Restricționate (declanșează auditul CASA):** `gmail.readonly`, `drive.readonly`
- **Sensibile:** `gmail.send`, `calendar.events`, `calendar.readonly`, `tasks`, `contacts.readonly`
- **De bază (fără verificare):** `openid`, `email`, `profile`, `userinfo.*`

## Pasul 0 — Adaugă test users (funcționează ACUM, fără verificare)
Console → APIs & Services → **OAuth consent screen** → **Test users** → Add users.
Până la 100 de emailuri; ei folosesc aplicația (cu un avertisment pe care-l trec).
Link: https://console.cloud.google.com/apis/credentials/consent?project=gen-lang-client-0460348646

## Pasul 1 — Completează OAuth consent screen
Aceeași pagină. Trebuie completate TOATE:
- App name: **Kelion**
- User support email
- App logo (120×120, fundal curat)
- **App home page:** https://kelionai.app
- **Privacy policy:** https://kelionai.app/privacy  (există deja)
- **Terms of service:** https://kelionai.app/terms  (există deja)
- **Authorized domains:** `kelionai.app`
- Developer contact email

## Pasul 2 — Verifică domeniul kelionai.app
1. Google Search Console: https://search.google.com/search-console
2. Add property → Domain → `kelionai.app` → verifici prin DNS TXT (adaugi un
   record TXT la registrarul domeniului).
3. Înapoi în consent screen, domeniul apare la „Authorized domains".

## Pasul 3 — Trimite la verificare
1. Consent screen → **Publishing status** → schimbă din „Testing" în **In production**.
2. Apasă **Prepare for verification / Submit for verification**.
3. Pentru fiecare scop sensibil/restricționat scrii **de ce** îl folosește app-ul
   (ex: „gmail.readonly — ca asistentul să-ți citească emailurile la cerere").
4. Înregistrezi un **video demo** (YouTube unlisted): arăți ecranul de consimțământ
   Google + cum folosește app-ul fiecare permisiune.
5. Trimiți.

## Pasul 4 — Auditul CASA (doar pentru scopurile restricționate)
`gmail.readonly` + `drive.readonly` cer un **audit de securitate CASA Tier 2**,
făcut de un terț autorizat, **anual, contra cost** (sute–mii $), durează săptămâni.

### Alternativa ca să EVIȚI CASA
Scoți cele două scopuri restricționate (`gmail.readonly`, `drive.readonly`) și
păstrezi restul. Verificarea devine mult mai ușoară, fără CASA. Pierzi doar:
- „citește-mi emailurile" (rămâne „trimite email" via `gmail.send`)
- „caută în Drive"
Păstrezi: calendar, tasks, contacte, trimitere email, plus toate skill-urile non-Google.

## Durată estimată
- Fără scopuri restricționate: câteva zile–săptămâni.
- Cu CASA (Gmail/Drive read): săptămâni–luni + cost anual.

## Rezumat decizie
- Vrei lansare rapidă/ieftină public → scoate `gmail.readonly`+`drive.readonly`, fă verificarea ușoară.
- Vrei toate feature-urile Gmail/Drive citire → treci prin CASA (timp + bani).
