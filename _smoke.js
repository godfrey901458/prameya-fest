require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });
  const [events] = await pool.execute('SELECT name FROM events ORDER BY id ASC');
  const [results] = await pool.execute('SELECT event_name AS eventName, winner_registration_code AS winnerCode, runner_registration_code AS runnerCode, updated_at AS updatedAt FROM results');
  const byEvent = new Map(results.map(r => [r.eventName, r]));
  const summary = events.map(({ name }) => {
    const row = byEvent.get(name);
    const completed = !!(row && row.winnerCode);
    return { event: name, status: completed ? 'completed' : 'pending', winnerCode: completed ? row.winnerCode : null, updatedAt: completed ? row.updatedAt : null };
  });
  console.log(JSON.stringify({
    events: summary,
    uploaded: summary.filter(e => e.status === 'completed').length,
    total: summary.length
  }, null, 2));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
