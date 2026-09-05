# Incident: CI Doctor — testul textual al heartbeatului

Stare: cauză reprodusă, corecție și peer review trecute pe VPS; noul CI și publicarea live sunt încă necesare.

## Simptom, mediu și cauză

[Run33968908143/job101314219700](https://github.com/kelion-team/kelionai/actions/runs/33968908143/job/101314219700), head32a1d7636edf1ca4d17dad3b13b00e20ca9fccd4: verify a trecut, inclusiv453teste statice/452PASS/0FAIL/1SKIP. Container-isolation a construit imaginile, apoi doctor-repair-scope.test.mjs a avut12PASS/1FAIL.

Testul13, linia246, cerea textual ca doctorCapability să urmeze imediat după state:'ready'. Publisherul transmite în continuare doctorCapability:measureDoctorCapability(), dar între ele are câmpul legitim detail. Backendul acceptă detail limitat la240caractere și validează separat capabilitatea strictă. Claimul face o nouă măsurătoare. Cauza este presupunerea de ordine/adiacență din test, nu absența protecției din producție.

Această suită este în etapa separată container-isolation, care nu a rulat la primul CI din cauza verify. Porțile anterioare de candidat nu reprezintă dovada executării acestei suite pe ultima sursă. Lipsa a devenit vizibilă în etapa omisă anterior; nu se pretinde că fusese trecută.

## Metoda corecției și de ce funcționează

Au fost înlocuite numai cele două expresii regulate publisher cu teste care selectează AST cele două apeluri postInternal reale din runOnce și execută expresiile originale, dublând strict măsurarea și transportul. Se verifică endpointurile și contextul autentificării, două măsurători independente și transmiterea exactă a rezultatului măsurat, inclusiv null când capabilitatea este indisponibilă.

Regresia mută sursa în memorie pentru a omite ori fabrica doctorCapability și dovedește că proba refuză fiecare mutant. Câmpul de diagnostic nu mai face testul să eșueze, dar lipsa ori fabricarea protecției rămâne detectabilă. Niciun cod de producție, limită Doctor sau flag CI nu a fost schimbat.

## Probe, responsabil și criteriu de închidere

Lovelace a reprodus exact comanda Doctor a workflowului în container VPS izolat cu imaginea de test pinuită: înainte12PASS/1FAIL; după15/15PASS, zero omise,6,684s. TestSHA256:9baa07297ecfa87b6fe1dcdb77de98c3d6abb3c167cb56428248088d89e694df.

Dalton a aprobat independent diff-ul și traseul publisher→auth→backend, a executat separat capabilitatea runtime5/5PASS și handoff identități3/3PASS. Runtime-ul de test folosit pentru handoff nu este imaginea app a noului SHA; aceasta este limită declarată, nu probă de release.

Responsabil corecție:Lovelace; control independent:Dalton; integrare/CI/deploy:root. Închiderea necesită toate verificările GitHub pe commitul corectat, inclusiv întreaga etapă container-isolation. Rezolvarea ordinului666 și publicarea lui au dovezi proprii; nu sunt înlocuite de acest incident.
