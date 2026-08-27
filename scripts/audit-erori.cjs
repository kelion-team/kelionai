const db = require('/app/backend/dist/db.js');
(async () => {
  // client_errors — ultimele 5
  const ce = JSON.parse(await db.dbQuery("SELECT substring(message,1,150) as msg, substring(stack,1,100) as stk, created_at FROM client_errors ORDER BY id DESC LIMIT 5"));
  console.log('=== CLIENT_ERRORS (ultimele 5) ===');
  for (const r of ce.rows) console.log(`[${r.created_at}] ${r.msg}${r.stk ? ' | ' + r.stk : ''}`);

  // Cate pe zi
  const ceDay = JSON.parse(await db.dbQuery("SELECT date(created_at) as d, COUNT(*) as n FROM client_errors GROUP BY d ORDER BY d DESC LIMIT 7"));
  console.log('\n=== CLIENT_ERRORS PE ZI (ultimele 7) ===');
  for (const r of ceDay.rows) console.log(`${r.d}: ${r.n}`);

  // operational_events — distributie pe kind
  const oeKind = JSON.parse(await db.dbQuery("SELECT kind, COUNT(*) as n FROM operational_events GROUP BY kind ORDER BY n DESC LIMIT 15"));
  console.log('\n=== OPERATIONAL_EVENTS PE KIND ===');
  for (const r of oeKind.rows) console.log(`${r.kind}: ${r.n}`);

  // operational_events pe zi
  const oeDay = JSON.parse(await db.dbQuery("SELECT date(created_at) as d, COUNT(*) as n FROM operational_events GROUP BY d ORDER BY d DESC LIMIT 7"));
  console.log('\n=== OPERATIONAL_EVENTS PE ZI ===');
  for (const r of oeDay.rows) console.log(`${r.d}: ${r.n}`);

  // Exista vreun cron/job care sterge din tabelele astea?
  const audit = JSON.parse(await db.dbQuery("SELECT substring(action,1,100) as act, created_at FROM server_ops_audit ORDER BY id DESC LIMIT 10"));
  console.log('\n=== SERVER_OPS_AUDIT (ultimele 10) ===');
  for (const r of audit.rows) console.log(`[${r.created_at}] ${r.act}`);
})().catch(e => console.log('FATAL:', e.message));
