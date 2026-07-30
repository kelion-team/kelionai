# PROCEDURA-PLATI.md

Procedura de conectare a datelor bancare (GoCardless / Bank Account Data) pentru Kelion AI.

Fiecare secțiune spune trei lucruri: **cine face pasul** (Adrian sau aplicația/Kelion), **ce se face exact**, și **cum știi că a mers** (dovada, nu impresia).

Regulă de aur: dacă dovada lipsește, pasul NU e făcut. Nu se trece la următorul.

---

## §1. Ce produs ne trebuie, de fapt

**Cine:** Adrian (o singură dată, la înțelegerea contextului).

GoCardless are mai multe produse separate, cu portaluri separate și cu conturi separate. Ne trebuie **Bank Account Data** (fostul Nordigen) — citire de tranzacții și solduri, în regim read-only.

- `bankaccountdata.gocardless.com` — **ACESTA ne trebuie.** Aici se fac Secret ID / Secret Key pentru citirea conturilor.
- `manage.gocardless.com` — **alt produs** (încasări prin Direct Debit). Nu are cheile noastre. Un cont aici nu deschide nimic pentru noi.
- `developer.gocardless.com` — **documentație pentru alt produs**. Tokenurile de acolo nu funcționează pe Bank Account Data.

**Capcană documentată (căzută în ea azi):** am ajuns pe `manage.` și pe `developer.` și am căutat acolo secțiunea de chei. Nu există. Nu e o eroare de setare — e produs greșit. Dacă în interfață nu apare nicăieri „Bank Account Data" sau „User secrets", ești pe portalul greșit; ieși și mergi pe `bankaccountdata.gocardless.com`.

**Dovada că §1 e în regulă:** adresa din bara de browser începe cu `bankaccountdata.gocardless.com`.

---

## §2. Contul și autentificarea în portal

**Cine:** Adrian. Kelion poate deschide pagina pe monitor, dar login-ul îl faci tu (parolă și 2FA nu se dau unei unelte).

Pași: deschide portalul, „Sign up" dacă nu există cont (email, parolă, confirmare pe email), altfel „Log in".

**Capcană documentată (căzută în ea azi):** pe formularul de login/înregistrare **butoanele rămân moarte** — apeși și nu se întâmplă nimic, fără mesaj de eroare — până când **pornești comutatorul de acceptare a termenilor** (checkbox/toggle „I agree to the Terms"). Nu e pagină stricată și nu e buton nefuncțional: validarea blochează trimiterea în silențiu. Întâi comutatorul, apoi butonul.

**Dovada că §2 a mers:** ești în portal și vezi meniul de cont (nu ecranul de login) după un refresh al paginii.

---

## §3. Generarea cheilor (Secret ID și Secret Key)

**Cine:** Adrian, în portal.

În portal: secțiunea **Developers → User secrets → Create new** (denumire liberă, ex. „kelion-prod"). Se generează două valori:

- `SECRET_ID`
- `SECRET_KEY`

**Atenție:** `SECRET_KEY` se afișează **o singură dată**. Dacă închizi fereastra fără să o copiezi, cheia nu se mai poate recupera — se șterge secretul și se creează altul. Nu e o pierdere gravă, doar repeți pasul.

**Dovada că §3 a mers:** ai ambele valori copiate, iar în listă apare o intrare nouă de secret, cu data de azi.

---

## §4. Ce cere API-ul, în ordine

**Cine:** aplicația (automat). Se trece aici doar pentru a înțelege ce se întâmplă și unde poate cădea.

1. **Token de acces** — cu `SECRET_ID` și `SECRET_KEY` se cere un token `access` (valabil ~24h) și un `refresh` (~30 zile). Aplicația reînnoiește singură.
2. **Lista de instituții** — se cere lista băncilor pentru țara ta (`GB` pentru Regatul Unit) și se alege banca.
3. **Acord de utilizare (agreement)** — se stabilește ce se citește (tranzacții, solduri, detalii) și pe câte zile de istoric.
4. **Cerere de conectare (requisition)** — întoarce un **link de consimțământ**, către banca ta.
5. **Consimțământul** — pasul uman (§5).
6. **Citirea conturilor** — după consimțământ, aplicația obține id-urile de cont și poate citi solduri și tranzacții, **doar citire**.

**Dovada că §4 merge:** cererea de token întoarce cod 200 și un token `access`; lista de instituții întoarce bănci pentru `GB`.

---

## §5. Consimțământul bancar (singurul pas care se repetă)

**Cine:** Adrian. Obligatoriu uman — e autentificare la banca ta.

Kelion deschide linkul de consimțământ pe monitor; tu te autentifici la bancă, confirmi accesul read-only și ești întors în aplicație.

**Termen de expirare:** consimțământul e valabil între **30 și 90 de zile**, după bancă. La expirare **se repetă doar §5** — nu se refac cheile, nu se atinge portalul.

**Dovada că §5 a mers:** starea cererii (requisition) devine `LINKED` și lista de conturi întoarce cel puțin un cont.

---

## §6. Ducerea cheilor pe server

**Cine:** **Kelion.** Acesta e pasul pe care nu trebuie să-l faci tu.

Tu îmi dai cele două valori și spui **„dă drumul"**. Eu:

1. scriu `GOCARDLESS_SECRET_ID` și `GOCARDLESS_SECRET_KEY` în variabilele de mediu ale serverului, prin mecanismul de publicare (nu prin comenzi ad-hoc, care se pierd la redeploy);
2. pornesc publicarea;
3. repornesc aplicația ca să le citească;
4. îți arăt dovada pe monitor.

Reguli ferme:
- cheile **nu se pun niciodată în cod** și nu se comit în depozit;
- cheile **nu se scriu în chat** de către mine, niciodată, nici parțial;
- setarea se face doar prin variabile de mediu, ca să supraviețuiască redeploy-ului.

**Dovada că §6 a mers:** publicarea se încheie verde, iar verificarea de sănătate arată ambele variabile ca „prezente" (prezență, nu valoare).

---

## §7. Verificarea finală, cap-coadă

**Cine:** Kelion, cu raport pe monitor.

Ordinea verificărilor: token obținut → instituții listate → cerere creată → stare `LINKED` → cel puțin un cont citit → un sold citit.

**Dovada că §7 a mers:** toate șase, verzi, în același raport. Dacă una e roșie, mergi la §8 și rezolvi exact acel rând; nu se reia toată procedura.

---

## §8. Tabelul modurilor de eșec

| Ce vezi | Ce înseamnă | Ce faci |
|---|---|---|
| Butoanele de login nu fac nimic, fără eroare | Comutatorul de termeni e oprit | Pornește acceptarea termenilor, apoi apasă din nou (§2) |
| În portal nu găsești „User secrets" | Ești pe `manage.` sau `developer.` — alt produs | Mergi pe `bankaccountdata.gocardless.com` (§1) |
| `401 Unauthorized` la cererea de token | Secret ID / Secret Key greșite, inversate sau cu spațiu la copiere | Recopiază-le; dacă persistă, șterge secretul și fă altul (§3) |
| `401` după ce mergea | Token `access` expirat și `refresh` neefectuat | Reînnoiește tokenul; dacă `refresh` e mort (peste 30 zile), reia autentificarea de la §4.1 |
| `429 Too Many Requests` | Limită de apeluri atinsă (tipic 4 citiri/cont/zi) | Aștepți fereastra următoare; nu reîncerci în buclă |
| Starea cererii rămâne `CREATED` | Consimțământul nu a fost dus până la capăt | Redeschide linkul și finalizează la bancă (§5) |
| Stare `EXPIRED` sau conturile nu se mai citesc | Consimțământul a expirat (30–90 zile) | Repetă **doar** §5 |
| Stare `REJECTED` | Banca a refuzat sau ai anulat în fluxul lor | Creează o cerere nouă și reia §5 |
| Lista de instituții e goală | Cod de țară greșit | Folosește `GB` (§4.2) |
| Aplicația nu vede cheile după setare | Variabile de mediu nescrise sau aplicația nerepornită | Reia §6 și repornește aplicația |
| Linkul de consimțământ dă 404 | Cererea a expirat înainte de folosire (are viață scurtă) | Creează o cerere nouă, folosește linkul imediat |

---

## §9. Cele două variante care scapă complet de portal

Singurii pași care se repetă sunt cei de consimțământ (§5), fiindcă expiră la 30–90 de zile. Portalul, în schimb, poate fi eliminat definitiv din rutina ta:

**Varianta A — import de extras (fără nicio conectare).**
Descarci din banca ta extrasul în format CSV sau OFX și îl încarci în aplicație; ea îl citește și îl clasifică. Zero portal, zero chei, zero expirare. Dezavantaj: nu e automat — încarci fișierul când vrei situația la zi. Avantaj: nu depinde de nimeni din afară și nu se strică niciodată.

**Varianta B — unealta de browser pentru Kelion (recomandată).**
Kelion primește un browser propriu, instalat permanent în imaginea aplicației, și deschide singur portalurile pe monitor: navighează, completează, ajunge exact la ecranul unde trebuie. Tu preiei **doar** la două momente: login-ul (parolă și 2FA) și consimțământul bancar. Restul nu-l mai umbli tu niciodată. Asta rezolvă și eșecul de azi: lansarea browserului a picat fiindcă executabilul Chromium nu e instalat pe server; instalarea se face durabil, prin imaginea aplicației, ca să reziste la redeploy.

Cele două variante se pot folosi împreună: B pentru rutina automată, A ca plasă de siguranță când o bancă face figuri.

---

## §10. Ce NU face aplicația cu banii tăi

Scris explicit, ca să nu existe ambiguitate:

- **Nu mută bani.** Nu iniţiază plăți, nu face transferuri, nu setează Direct Debit, nu autorizează nimic. Accesul este exclusiv de tip **citire**.
- **Nu are drept de scriere** la bancă. Produsul folosit (Bank Account Data) nu oferă tehnic posibilitatea de a plăti.
- **Nu îți cere și nu îți păstrează credențialele bancare.** Utilizatorul și parola de bancă se introduc **doar** pe pagina băncii, în timpul consimțământului. Aplicația nu le vede, nu le stochează, nu le transmite.
- **Nu ține cheile în cod.** Doar în variabile de mediu pe server.
- **Nu afișează și nu trimite cheile în chat**, nici la cerere, nici parțial.
- **Nu partajează datele** citite cu terți; sunt folosite doar pentru funcțiile pe care le ceri în aplicație.
- **Poți retrage accesul oricând**, din banca ta sau prin ștergerea conexiunii; după retragere, citirile se opresc imediat.

---

*Document de procedură operațională. Se actualizează când apare un mod de eșec nou — se adaugă un rând în §8.*
