const db = require('/app/backend/dist/db.js');
(async () => {
  // Cine consuma voce pe email
  const peEmail = JSON.parse(await db.dbQuery("SELECT user_email, COUNT(*) as n, SUM(cost_usd) as total FROM cost_events WHERE kind = 'voice_minutes' AND created_at >= '2026-08-01' GROUP BY user_email ORDER BY total DESC"));
  console.log('=== CINE CONSUMĂ VOCE (August) ===');
  for (const r of peEmail.rows) {
    console.log(`  ${r.user_email}: ${r.n} min, $${Number(r.total).toFixed(2)}`);
  }

  // Toate emailurile care au folosit aplicatia
  const toti = JSON.parse(await db.dbQuery("SELECT DISTINCT user_email FROM cost_events WHERE created_at >= '2026-08-01' ORDER BY user_email"));
  console.log('\n=== TOȚI UTILIZATORII (August) ===');
  for (const r of toti.rows) console.log(`  ${r.user_email}`);

  // Cine a consuma azi pe ora
  const azi = JSON.parse(await db.dbQuery("SELECT user_email, COUNT(*) as n, SUM(cost_usd) as total, MIN(created_at) as prima, MAX(created_at) as ultima FROM cost_events WHERE kind = 'voice_minutes' AND created_at >= '2026-08-23' GROUP BY user_email ORDER BY total DESC"));
  console.log('\n=== CINE CONSUMĂ VOCE AZI ===');
  for (const r of azi.rows) {
    console.log(`  ${r.user_email}: ${r.n} min, $${Number(r.total).toFixed(2)} | ${r.prima} → ${r.ultima}`);
  }

  // Sesiuni vocale deschise acum
  const sesiuni = JSON.parse(await db.dbQuery("SELECT key, value FROM kv_state WHERE key LIKE 'vocal-live%'"));
  console.log('\n=== SESIUNI VOCE ÎN KV ===');
  for (const r of sesiuni.rows) {
    console.log(`  ${r.key}: ${r.value}`);
  }
})().catch(e => console.log('FATAL:', e.message));
