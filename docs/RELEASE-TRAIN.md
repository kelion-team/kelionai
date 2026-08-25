# Release train: o singură verificare completă

Schimbările dependente se publică într-un singur release train. Scopul este să
evităm ciclurile repetate de rebase, CI și deploy, fără a reduce niciuna dintre
porțile de siguranță.

1. Creează o ramură nouă din `origin/master` curent.
2. Pune în aceeași ramură toate corecțiile care trebuie să ajungă împreună.
3. Rulează `node scripts/release-train-preflight.mjs`, apoi porțile locale din
   `AGENTS.md`.
4. Deschide un singur PR. `pr-verify` blochează CI-ul complet dacă ramura nu
   conține masterul curent sau worktree-ul nu este curat.
5. După verde, se face rebase merge; deploy-ul acceptă numai commitul din
   `master` cu dovada CI și imaginile semnate.

O schimbare independentă poate avea propriul train. O schimbare care depinde de
un PR deschis nu pornește încă un PR: se adaugă aceluiași train înainte de
preflight. Dacă `master` avansează între preflight și merge, trainul se
actualizează o singură dată, apoi rulează din nou poarta completă.

## Setări GitHub necesare ownerului

Repository settings → Branches → `master` trebuie să impună:

- branch up to date înainte de merge;
- check obligatoriu `pr-verify / container-isolation`;
- cel puțin un review uman eligibil;
- doar **Rebase and merge** pentru release train;
- merge queue pentru trenuri concurente, cu `pr-verify` rulat pe merge group.

Aceste setări nu pot fi schimbate din codul unui PR și nu trebuie ocolite.
