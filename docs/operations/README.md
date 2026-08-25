# Memoria operațională KelionAI

Acest director este checkpointul durabil comun pentru owner și agenții care
lucrează la KelionAI. El completează Git, GitHub Actions și Deployments; nu le
înlocuiește.

Ordinea de reluare este:

1. citește `CURRENT.md`;
2. verifică branch-ul și commiturile indicate față de Git/GitHub;
3. confirmă din nou sondele live înaintea unei mutații;
4. execută numai `Următorul pas sigur`;
5. actualizează `CURRENT.md` când starea verificată s-a schimbat.

`CURRENT.md` descrie exclusiv adevărul curent. Istoria rămâne în commituri,
PR-uri, Actions și Deployments. Nu se adaugă aici chei, tokenuri, valori de
mediu, IP-uri, dumpuri, loguri brute, date personale sau rezultate neverificate.

Un upgrade Codex poate opri procesele și agenții activi. După redeschidere,
agentul reia din acest checkpoint, nu presupune că o comandă aflată în execuție
a continuat și nu declară succes fără dovezi noi.
