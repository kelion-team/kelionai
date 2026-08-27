const db = require('/app/backend/dist/db.js');
(async () => {
  // 1. Cost total pe luna August 2026
  const costLuna = JSON.parse(await db.dbQuery("SELECT kind, COUNT(*) as n, SUM(cost_usd) as total FROM cost_events WHERE created_at >= '2026-08-01' GROUP BY kind ORDER BY total DESC"));
  console.log('=== COST PE LUNA AUGUST 2026 ===');
  let total = 0;
  for (const r of costLuna.rows) {
    console.log(`  ${r.kind}: ${r.n} evenimente, $${Number(r.total).toFixed(2)}`);
    total += Number(r.total);
  }
  console.log(`  TOTAL LUNA: $${total.toFixed(2)}`);

  // 2. Cost pe zi (ultimele 7 zile)
  const costZi = JSON.parse(await db.dbQuery("SELECT date(created_at) as d, COUNT(*) as n, SUM(cost_usd) as total FROM cost_events WHERE created_at >= '2026-08-17' GROUP BY d ORDER BY d DESC"));
  console.log('\n=== COST PE ZI ===');
  for (const r of costZi.rows) {
    console.log(`  ${r.d}: ${r.n} evenimente, $${Number(r.total).toFixed(2)}`);
  }

  // 3. Cost azi pe ora
  const costOra = JSON.parse(await db.dbQuery("SELECT date_trunc('hour', created_at) as h, COUNT(*) as n, SUM(cost_usd) as total FROM cost_events WHERE created_at >= '2026-08-23' GROUP BY h ORDER BY h DESC LIMIT 15"));
  console.log('\n=== COST AZI PE ORA ===');
  for (const r of costOra.rows) {
    console.log(`  ${r.h}: ${r.n} evenimente, $${Number(r.total).toFixed(4)}`);
  }

  // 4. Cele mai scumpe 10 evenimente azi
  const top = JSON.parse(await db.dbQuery("SELECT kind, cost_usd, user_email, created_at FROM cost_events WHERE created_at >= '2026-08-23' ORDER BY cost_usd DESC LIMIT 10"));
  console.log('\n=== CELE MAI SCUMPE 10 AZI ===');
  for (const r of top.rows) {
    console.log(`  $${Number(r.cost_usd).toFixed(4)} ${r.kind} [${r.created_at}] ${r.user_email}`);
  }

  // 5. Mesaje chat azi
  const msg = JSON.parse(await db.dbQuery("SELECT role, COUNT(*) as n FROM messages WHERE created_at >= '2026-08-23' GROUP BY role"));
  console.log('\n=== MESAJE AZI ===');
  for (const r of msg.rows) console.log(`  ${r.role}: ${r.n}`);

  // 6. Total evenimente cost (toate timpurile)
  const tot = JSON.parse(await db.dbQuery("SELECT COUNT(*) as n, SUM(cost_usd) as total FROM cost_events"));
  console.log(`\n=== TOTAL TOATE TIMPURILE: ${tot.rows[0].n} evenimente, $${Number(tot.rows[0].total).toFixed(2)} ===`);
})().catch(e => console.log('FATAL:', e.message));
