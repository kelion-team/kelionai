const db = require('/app/backend/dist/db.js');
(async () => {
  // Ce se intampla noaptea 22-02? voice_minutes in detaliu
  const noapte = JSON.parse(await db.dbQuery("SELECT date_trunc('minute', created_at) as m, COUNT(*) as n, SUM(cost_usd) as total FROM cost_events WHERE kind = 'voice_minutes' AND created_at >= '2026-08-22T22:00:00' AND created_at < '2026-08-23T03:00:00' GROUP BY m ORDER BY m LIMIT 30"));
  console.log('=== VOCE NOAPTEA 22:00-03:00 (pe minut) ===');
  for (const r of noapte.rows) {
    console.log(`  ${r.m}: ${r.n} evenimente, $${Number(r.total).toFixed(4)}`);
  }

  // Sesiuni de voce active acum
  const sesiuni = JSON.parse(await db.dbQuery("SELECT * FROM kv_state WHERE key LIKE '%vocal-live%' OR key LIKE '%voce%' OR key LIKE '%session%'"));
  console.log('\n=== KV SESIUNI VOCE ===');
  for (const r of sesiuni.rows) {
    console.log(`  ${r.key}: ${String(r.value).slice(0, 100)}`);
  }

  // Mesaje in perioada 22-02
  const msgNoapte = JSON.parse(await db.dbQuery("SELECT role, COUNT(*) as n, date_trunc('hour', created_at) as h FROM messages WHERE created_at >= '2026-08-22T22:00:00' AND created_at < '2026-08-23T03:00:00' GROUP BY h, role ORDER BY h"));
  console.log('\n=== MESAJE NOAPTEA 22-02 ===');
  for (const r of msgNoapte.rows) {
    console.log(`  ${r.h}: ${r.role} = ${r.n}`);
  }

  // Health beats (daca sistemul era treaz noaptea)
  const health = JSON.parse(await db.dbQuery("SELECT * FROM health_beats ORDER BY id DESC LIMIT 5"));
  console.log('\n=== HEALTH BEATS (ultimele 5) ===');
  for (const r of health.rows) {
    console.log(`  ${JSON.stringify(r).slice(0, 150)}`);
  }
})().catch(e => console.log('FATAL:', e.message));
