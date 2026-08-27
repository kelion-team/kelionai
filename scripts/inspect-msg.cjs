const db = require('/app/backend/dist/db.js');
(async () => {
  const cols = await db.dbQuery("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='messages' ORDER BY ordinal_position");
  console.log('COLS:', JSON.stringify(cols.rows));
  const roles = await db.dbQuery("SELECT role, COUNT(*) as n FROM messages GROUP BY role ORDER BY n DESC");
  console.log('ROLES:', JSON.stringify(roles.rows));
  const last = await db.dbQuery('SELECT role, substring(text,1,120) as text, created_at FROM messages ORDER BY id DESC LIMIT 5');
  console.log('LAST5:', JSON.stringify(last.rows));
  const first = await db.dbQuery('SELECT role, substring(text,1,120) as text, created_at FROM messages ORDER BY id ASC LIMIT 1');
  console.log('FIRST:', JSON.stringify(first.rows));
  const users = await db.dbQuery("SELECT user_email, COUNT(*) as n FROM messages GROUP BY user_email ORDER BY n DESC LIMIT 5");
  console.log('USERS:', JSON.stringify(users.rows));
})().catch(e => console.log('err:', e.message));
