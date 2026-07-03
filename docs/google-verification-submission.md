# Google OAuth verification — text gata de lipit

Proiect: **gen-lang-client-0460348646** · App: **Kelion** · Domeniu: **kelionai.app**
Prerechizite confirmate: privacy `https://kelionai.app/privacy`, terms `https://kelionai.app/terms` (ambele live).

## Scopurile aplicației (exact)
- De bază (fără justificare): `openid`, `email`, `profile`
- Sensibile: `calendar.readonly`, `calendar.events`, `gmail.send`, `tasks`, `contacts.readonly`
- **Restricționate (declanșează CASA):** `gmail.readonly`, `drive.readonly`

---

## Justificări per scope (copiază în „Scope justification")

**calendar.readonly**
> Kelion reads the user's upcoming Google Calendar events so it can tell the user, on request, what is on their schedule (e.g. "what do I have today?"). Read-only; no narrower scope exposes upcoming events.

**calendar.events**
> Kelion creates calendar events the user explicitly dictates (e.g. "add a meeting tomorrow at 3pm"). Limited to event creation the user requests.

**gmail.readonly** (restricted)
> On the user's request ("read my latest emails"), Kelion fetches recent message metadata (subject, sender, date, short snippet) to summarize the inbox aloud. Read-only, metadata-focused; no non-restricted scope provides message content.

**gmail.send**
> Kelion sends emails the user dictates to it ("email John that I'll be late"). Send-only; it does not read mailbox content with this scope.

**drive.readonly** (restricted)
> On request ("find my budget document"), Kelion searches the user's Drive by file name and returns the matching file name + link so the user can open it. Read-only; no narrower scope allows searching the user's own files.

**tasks**
> Kelion reads the user's Google Tasks and adds tasks the user dictates ("add buy milk to my tasks"). Needed for both listing and creating tasks.

**contacts.readonly**
> When the user asks to reach someone ("what's Ana's email?"), Kelion looks up that contact's email/phone. Read-only lookup of the user's own contacts.

**Common note (add to each if asked "why not narrower"):**
> Each scope maps to a single assistant capability the user invokes explicitly by voice or text. Data is used only to answer that immediate request and is not stored, sold, or transferred to third parties (see our Limited Use disclosure in the privacy policy).

---

## Scenariu video demo (YouTube unlisted, ~2-3 min)
1. Arată URL-ul `kelionai.app` și butonul de login Google.
2. Arată **ecranul de consimțământ Google** cu lista de permisiuni (integral).
3. După login, demonstrează pe rând, cu voce/text:
   - „ce am azi în calendar?" → răspunde din Calendar (calendar.readonly)
   - „adaugă o întâlnire mâine la 15" → creează event (calendar.events)
   - „citește-mi ultimele emailuri" → rezumă inbox (gmail.readonly)
   - „trimite un email către … " → trimite (gmail.send)
   - „caută documentul X în Drive" → găsește fișier (drive.readonly)
   - „adaugă … la task-uri" + „ce task-uri am?" (tasks)
   - „ce email are [contact]?" (contacts.readonly)
4. Arată pagina de privacy (`/privacy`) cu secțiunea Limited Use.

## Checklist submisie
1. Consent screen complet (nume Kelion, logo, support email, home `kelionai.app`, privacy, terms, authorized domain `kelionai.app`, developer email).
2. Verifică domeniul în Search Console (DNS TXT) → apare la Authorized domains.
3. Publishing status → **In production** → **Submit for verification**.
4. Lipești justificările de mai sus + linkul video.
5. Pentru `gmail.readonly` + `drive.readonly`: Google cere **CASA Tier 2** (audit anual, contra cost) — vei fi direcționat către un evaluator autorizat.

## Dacă vrei să eviți CASA (opțional)
Scoți DOAR `gmail.readonly` + `drive.readonly` din `backend/src/routes/auth.ts`. Pierzi „citește-mi emailurile" și „caută în Drive"; păstrezi trimitere email, calendar, tasks, contacte + tot restul. (Owner a cerut să NU scoatem nimic → implicit mergem pe CASA.)
