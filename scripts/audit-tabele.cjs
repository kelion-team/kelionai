const db = require('/app/backend/dist/db.js');
(async () => {
  // Toate tabelele
  const tablesRaw = await db.dbQuery("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const tables = JSON.parse(tablesRaw);
  if (tables.error) { console.log('ERR:', tables.error); return; }
  console.log('=== TABELE ===');
  console.log(tables.rows.map(r => r.tablename).join(', '));

  // Randuri pe fiecare
  console.log('\n=== RANDURI PE TABELA ===');
  for (const t of tables.rows) {
    try {
      const c = JSON.parse(await db.dbQuery(`SELECT COUNT(*) as n FROM ${t.tablename}`));
      console.log(`${t.tablename}: ${c.rows[0].n}`);
    } catch(e) { console.log(`${t.tablename}: ERR ${e.message.slice(0,80)}`); }
  }
})().catch(e => console.log('FATAL:', e.message));
