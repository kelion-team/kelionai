// Script CLI interactiv care numără de la 1 la comanda stop.
// Rulează o buclă asincronă în terminal care incrementează și afișează un contor la fiecare 500ms,
// oprindu-se instant când utilizatorul scrie 'stop' în consolă.

import readline from 'node:readline';

let counter = 1;
let intervalId = null;

// Inițializează interfața de citire stdin
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

console.log('Sistemul de numărare a pornit. Scrie "stop" pentru a opri.');

// Bucla asincronă care rulează la fiecare 500ms
intervalId = setInterval(() => {
  console.log(counter);
  counter++;
}, 500);

// Ascultă comenzile din consolă
rl.on('line', (line) => {
  const command = line.trim().toLowerCase();
  if (command === 'stop') {
    clearInterval(intervalId);
    console.log('Numărătoarea a fost oprită.');
    rl.close();
    process.exit(0);
  }
});

// Tratează închiderea prin Ctrl+C sau alte semnale
rl.on('SIGINT', () => {
  clearInterval(intervalId);
  console.log('\nNumărătoarea a fost oprită prin semnal extern.');
  rl.close();
  process.exit(0);
});
