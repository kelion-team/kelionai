const db = require('/app/backend/dist/db.js');
(async () => {
  // Voice minutes la 2 noaptea — cine?
  const noapte2 = JSON.parse(await db.dbQuery("SELECT date_trunc('minute', created_at) as m, user_email, cost_usd FROM cost_events WHERE kind = 'voice_minutes' AND created_at >= '2026-08-23T01:00:00' AND created_at < '2026-08-23T03:00:00' ORDER BY m LIMIT 20"));
  console.log('=== VOCE 01:00-03:00 NOAPTEA ===');
  for (const r of noapte2.rows) {
    console.log(`  ${r.m} | ${r.user_email} | $${Number(r.cost_usd).toFixed(4)}`);
  }

  // Cate minute consecutive pe seara 20:55-21:24
  const seara = JSON.parse(await db.dbQuery("SELECT MIN(created_at) as start, MAX(created_at) as end, COUNT(*) as n, SUM(cost_usd) as total FROM cost_events WHERE kind = 'voice_minutes' AND created_at >= '2026-08-22T20:00:00' AND created_at < '2026-08-22T23:00:00'"));
  console.log('\n=== SESSIUNE VOCE 20:00-23:00 ===');
  console.log(`  Start: ${seara.rows[0].start} | End: ${seara.rows[0].end} | ${seara.rows[0].n} min | $${Number(seara.rows[0].total).toFixed(2)}`);

  // Toate sesiunile de voce pe zi (cand au inceput, cat au tinut)
  const sesiuni = JSON.parse(await db.dbQuery(`
    SELECT date(created_at) as zi,
      MIN(date_trunc('hour', created_at)) as prima_ora,
      MAX(date_trunc('hour', created_at)) as ultima_ora,
      COUNT(*) as minute,
      SUM(cost_usd) as total
    FROM cost_events
    WHERE kind = 'voice_minutes' AND created_at >= '2026-08-17'
    GROUP BY zi ORDER BY zi DESC
  `));
  console.log('\n=== SESIUNI VOCE PE ZI ===');
  for (const r of sesiuni.rows) {
    console.log(`  ${r.zi}: ${r.minute} min, $${Number(r.total).toFixed(2)} | ${r.prima_ora} → ${r.ultima_ora}`);
  }

  // Verifica daca exista o sesiune care ruleaza ACUM
  const acum = JSON.parse(await db.dbQuery("SELECT created_at, user_email, cost_usd FROM cost_events WHERE kind = 'voice_minutes' ORDER BY id DESC LIMIT 5"));
  console.log('\n=== ULTIMELE 5 VOICE_MINUTES ===');
  for (const r of acum.rows) {
    console.log(`  ${r.created_at} | ${r.user_email} | $${Number(r.cost_usd).toFixed(4)}`);
  }
})().catch(e => console.log('FATAL:', e.message));
