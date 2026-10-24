require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

(async () => {
  let connection;
  try {
    const username = (await ask('Create organizer username: ')).trim();
    const password = await ask('Create a strong organizer password (input is visible): ');
    if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) throw new Error('Username must be 3–80 letters, numbers, dot, underscore or hyphen.');
    if (password.length < 12) throw new Error('Password must be at least 12 characters.');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'prameya_fest',
      ...(process.env.DB_SSL === 'true' ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } } : {})
    });
    const hash = await bcrypt.hash(password, 12);
    await connection.execute('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)', [username, hash, 'admin']);
    console.log(`Organizer account "${username}" created/updated successfully.`);
  } catch (e) {
    console.error('Could not create organizer:', e.message);
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
    rl.close();
  }
})();
