# Supliment aprobat: politica și continuitatea contului după login Kelion

Aprobat:5septembrie2026, cerere explicită transmisă din conversația01a071d8-0b46-7483-acb7-b1f4ae3a01df. Stare: CERINȚĂ, NEIMPLEMENTATĂ și NEVERIFICATĂ pe live. Completează integrarea autentificării din proiectul aprobat v1.1; nu schimbă prioritatea PR1662→acelașiConstructor666.

După autentificarea prin Kelion, contul autorizat conectat trebuie să regăsească politica permanentă de comutare după limite, preferințele model/efort și continuitatea sarcinilor, contextului și checkpointurilor. Utilizatorul nu trebuie să repete discuțiile și deciziile aprobate.

Politica aprobată:

- Când limita principală are cel mult10% rămas, se folosește Spark numai dacă limita sa separată este disponibilă.
- Se revine la modelul preferat când limita principală are cel puțin20% disponibil în toate ferestrele relevante.
- Constructor preferat:gpt-6-astra/ultra; coordonare:gpt-6-astra/medium. Spark:xhigh dacă efectiv suportat, altfel maximul suportat verificat.
- Modelele care împart aceeași limită nu creează cotă nouă. Se folosesc numai limite reale ale contului corect; indisponibilitatea citirii nu înseamnă cotă zero sau cotă suficientă.
- Politica este asociată contului autorizat și sincronizată fără automatizări ori executanți dubli între Codex și Kelion. Nu autorizează cumpărări sau resetări plătite.

Loginul nu este dovadă de transfer automat al istoricului, cotelor sau automatizării. În implementare trebuie verificate explicit integrările și datele accesibile și raportate limitările. Automatizarea Codex locală existentă nu dovedește livrarea integrării Kelion sau independența de laptop.

Acceptare: după login și relogin, Kelion regăsește politica și sarcina în curs cu deciziile, starea și următorul pas; comută potrivit limitelor contului corect și revine fără pierderea contextului, fără restart de proiect și fără dublarea muncii. Rezultatul trebuie verificat pe traseul real autentificare→politică→sarcină→comutare→reluare. Până la această probă, suplimentul rămâne cerință, nu funcție finalizată.
