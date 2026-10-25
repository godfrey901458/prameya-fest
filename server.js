require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const app = express();
// Hosts like Render/Vercel run the app behind a proxy; trust one hop so rate limiting sees the real client IP.
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const SOLO_EVENTS = ['IT Manager', 'Reel Making'];

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('ERROR: Set JWT_SECRET in your .env file (at least 32 characters).');
  process.exit(1);
}
if (!process.env.DB_NAME || !process.env.DB_USER) {
  console.error('ERROR: Configure DB_HOST, DB_USER and DB_NAME in .env.');
  process.exit(1);
}

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  // Serverless platforms spin up many instances; keep each pool small so free cloud databases are not overwhelmed.
  connectionLimit: process.env.VERCEL ? 2 : 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};
// Managed MySQL providers (TiDB Cloud, Aiven, ...) require TLS; a local XAMPP MySQL does not.
if (process.env.DB_SSL === 'true') {
  poolConfig.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}
const pool = mysql.createPool(poolConfig);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many registration attempts. Please try again later.' })
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) => res.status(429).json({ error: 'Too many failed login attempts. Please wait 15 minutes and try again.' })
});

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Compare phone numbers by their last 10 digits so spacing, punctuation, a leading 0 or a
// +91 country code do not make the same participant look like a new one.
function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function teamKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// A team may enter an event only once. Any earlier entry in the same event with the same team
// name, or sharing a participant phone number, blocks the new one.
async function duplicateEntryError(connection, eventName, teamName, members) {
  const [rows] = await connection.execute(
    `SELECT r.team_name AS teamName, m.phone AS phone
     FROM registrations r
     LEFT JOIN registration_members m ON m.registration_id = r.id
     WHERE r.event_name = ?`,
    [eventName]
  );

  const wantedTeam = teamKey(teamName);
  if (wantedTeam) {
    const clash = rows.find(row => row.teamName && teamKey(row.teamName) === wantedTeam);
    if (clash) return `Team "${clash.teamName}" is already registered for ${eventName}. Each team can enter an event only once.`;
  }

  const wantedPhones = new Set(members.map(member => phoneKey(member.phone)).filter(Boolean));
  const clash = rows.find(row => row.phone && wantedPhones.has(phoneKey(row.phone)));
  if (clash) return `Phone ${clash.phone} is already registered for ${eventName}. Each team can enter this event only once.`;

  return null;
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.admin || req.admin.role !== role) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

// Never expose server-side source, environment files, database scripts, or package metadata.
// Checks every path segment so nested copies of the project cannot leak the same files.
const BLOCKED_FILES = new Set(['server.js', 'database.sql', 'package.json', 'package-lock.json', 'vercel.json', '.env', '.env.example', '.gitignore', 'README.txt']);
const BLOCKED_DIRS = new Set(['scripts', 'node_modules', '.git', '.commandcode', 'PRAMEYA_1.0_Website', ')_Website']);
app.use((req, res, next) => {
  let pathname;
  try {
    pathname = decodeURIComponent(req.path);
  } catch {
    return res.status(400).send('Bad request');
  }
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  const lower = last.toLowerCase();
  const blocked = segments.some(segment => BLOCKED_DIRS.has(segment))
    || BLOCKED_FILES.has(last)
    || pathname === '/api/index.js'
    || lower.endsWith('.zip')
    || lower.endsWith('.sql');
  if (blocked) {
    return res.status(404).send('Not found');
  }
  next();
});

app.use(express.static(path.join(__dirname), { index: 'index.html', extensions: ['html'] }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

async function eventExists(name) {
  const [rows] = await pool.execute('SELECT id FROM events WHERE name = ? LIMIT 1', [name]);
  return rows.length > 0;
}

async function getSetting(name) {
  const [rows] = await pool.execute('SELECT value FROM settings WHERE name = ? LIMIT 1', [name]);
  return rows.length ? rows[0].value : null;
}

async function setSetting(name, value) {
  await pool.execute(
    `INSERT INTO settings (name, value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [name, value]
  );
}

// True while the organizer has closed registration for every event. If the lookup fails the
// window is treated as open, so a settings problem never blocks participants on its own.
async function registrationLocked() {
  try {
    return (await getSetting('registration_locked')) === '1';
  } catch (error) {
    console.error('Registration lock read failed:', error.message);
    return false;
  }
}

app.post('/api/registrations', registrationLimiter, async (req, res) => {
  if (await registrationLocked()) {
    return res.status(403).json({ error: 'Registration is currently closed. The organizers have paused new entries for every event.' });
  }

  const eventName = clean(req.body.eventName, 80);
  const teamName = clean(req.body.teamName, 120);
  const collegeName = clean(req.body.collegeName, 180);
  const rawMembers = Array.isArray(req.body.members) ? req.body.members : [];

  if (!eventName || !collegeName) return res.status(400).json({ error: 'Please complete all required fields.' });
  if (!(await eventExists(eventName))) return res.status(400).json({ error: 'Please select a valid competition.' });

  const solo = SOLO_EVENTS.includes(eventName);
  if (!solo && !teamName) return res.status(400).json({ error: 'Please enter your team name.' });
  if (!rawMembers.length) return res.status(400).json({ error: 'Add at least one member.' });
  if (solo && rawMembers.length > 1) return res.status(400).json({ error: `${eventName} is an individual event. Only one participant can register.` });
  if (!solo && rawMembers.length > 2) return res.status(400).json({ error: 'A maximum of 2 members can register per event.' });

  const members = rawMembers.map((m, index) => ({
    order: index + 1,
    fullName: clean(m && m.name, 120),
    phone: clean(m && m.phone, 25)
  }));

  for (const m of members) {
    if (!m.fullName || !m.phone) return res.status(400).json({ error: 'Enter the name and phone for every member.' });
    if (!/^[0-9+() -]{8,25}$/.test(m.phone)) return res.status(400).json({ error: `Enter a valid phone number for ${m.fullName}.` });
  }

  const code = 'PRM-' + Date.now().toString(36).toUpperCase() + '-' + require('crypto').randomBytes(2).toString('hex').toUpperCase();

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const duplicate = await duplicateEntryError(connection, eventName, teamName, members);
    if (duplicate) {
      await connection.rollback();
      return res.status(409).json({ error: duplicate });
    }

    const [insertResult] = await connection.execute(
      `INSERT INTO registrations (registration_code, event_name, team_name, college_name) VALUES (?, ?, ?, ?)`,
      [code, eventName, teamName || null, collegeName]
    );
    const registrationId = insertResult.insertId;

    for (const m of members) {
      await connection.execute(
        `INSERT INTO registration_members (registration_id, member_order, full_name, phone) VALUES (?, ?, ?, ?)`,
        [registrationId, m.order, m.fullName, m.phone]
      );
    }

    await connection.commit();
    return res.status(201).json({ message: 'Registration submitted successfully.', registrationId: code });
  } catch (error) {
    if (connection) { try { await connection.rollback(); } catch {} }
    console.error('Registration error:', error.message);
    return res.status(500).json({ error: 'Could not save registration. Please try again later.' });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const username = clean(req.body.username, 80);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!username || !password) return res.status(400).json({ error: 'Enter username and password.' });
    const [rows] = await pool.execute('SELECT id, username, password_hash, role, event_name FROM admins WHERE username = ? LIMIT 1', [username]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, eventName: user.event_name || null },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    res.json({ token, username: user.username, role: user.role, eventName: user.event_name || null });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Could not log in. Please try again later.' });
  }
});

app.get('/api/me', auth, (req, res) => {
  res.json({ username: req.admin.username, role: req.admin.role, eventName: req.admin.eventName || null });
});

app.get('/api/events', async (_req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, name, slug FROM events ORDER BY id ASC');
    res.json({ events: rows });
  } catch (error) {
    console.error('Events error:', error.message);
    res.status(500).json({ error: 'Could not load events.' });
  }
});

// Public: lets the registration form show that the organizers have closed new entries.
app.get('/api/settings', async (_req, res) => {
  try {
    res.json({ registrationLocked: (await getSetting('registration_locked')) === '1' });
  } catch (error) {
    console.error('Settings error:', error.message);
    res.status(500).json({ error: 'Could not load settings.' });
  }
});

async function registrationInEvent(code, eventName) {
  if (!code) return false;
  const [rows] = await pool.execute(
    'SELECT id FROM registrations WHERE registration_code = ? AND event_name = ? LIMIT 1',
    [code, eventName]
  );
  return rows.length > 0;
}

async function fetchResults(eventName) {
  let sql = `
    SELECT r.event_name AS eventName,
           r.winner_registration_code AS winnerCode,
           r.runner_registration_code AS runnerCode,
           r.updated_at AS updatedAt,
           w.team_name AS winnerTeam, w.college_name AS winnerCollege, wm.full_name AS winnerMember,
           ru.team_name AS runnerTeam, ru.college_name AS runnerCollege, rum.full_name AS runnerMember
    FROM results r
    LEFT JOIN registrations w ON w.registration_code = r.winner_registration_code
    LEFT JOIN registration_members wm ON wm.registration_id = w.id AND wm.member_order = 1
    LEFT JOIN registrations ru ON ru.registration_code = r.runner_registration_code
    LEFT JOIN registration_members rum ON rum.registration_id = ru.id AND rum.member_order = 1`;
  const params = [];
  if (eventName) { sql += ' WHERE r.event_name = ?'; params.push(eventName); }
  sql += ' ORDER BY r.event_name ASC';
  const [rows] = await pool.execute(sql, params);
  return rows.map(row => ({
    eventName: row.eventName,
    winnerCode: row.winnerCode,
    winnerName: row.winnerTeam || row.winnerMember || row.winnerCode,
    winnerTeam: row.winnerTeam,
    winnerCollege: row.winnerCollege,
    runnerCode: row.runnerCode,
    runnerName: row.runnerCode ? (row.runnerTeam || row.runnerMember || row.runnerCode) : null,
    runnerTeam: row.runnerCode ? row.runnerTeam : null,
    runnerCollege: row.runnerCollege,
    updatedAt: row.updatedAt
  }));
}

async function upsertResult(eventName, winnerCode, runnerCode) {
  await pool.execute(
    `INSERT INTO results (event_name, winner_registration_code, runner_registration_code) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE winner_registration_code = VALUES(winner_registration_code), runner_registration_code = VALUES(runner_registration_code)`,
    [eventName, winnerCode, runnerCode]
  );
}

app.get('/api/results', async (_req, res) => {
  try {
    res.json({ results: await fetchResults() });
  } catch (error) {
    console.error('Results error:', error.message);
    res.status(500).json({ error: 'Could not load results.' });
  }
});

// Every participant (name + phone) for the given registration codes, so results can list them.
async function membersByCode(codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  const map = new Map(unique.map(code => [code, []]));
  if (!unique.length) return map;
  const placeholders = unique.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT r.registration_code AS code, m.member_order AS memberOrder, m.full_name AS name, m.phone AS phone
     FROM registrations r
     LEFT JOIN registration_members m ON m.registration_id = r.id
     WHERE r.registration_code IN (${placeholders})
     ORDER BY m.member_order ASC`,
    unique
  );
  for (const row of rows) {
    if (row.memberOrder != null) map.get(row.code).push({ name: row.name, phone: row.phone });
  }
  return map;
}

// Public scoreboard: for every event, the teams that advanced from each decided round, each
// with their participant names and phone numbers. The final winner and runner-up are
// deliberately withheld so the announcement stays a surprise.
async function fetchScoreboard() {
  const [eventRows] = await pool.execute('SELECT name FROM events ORDER BY id ASC');
  const results = await fetchResults();
  const decidedEvents = new Set(results.filter(row => row.winnerName).map(row => row.eventName));

  const [qualifierRows] = await pool.execute(`
    SELECT rm.event_name AS eventName, rm.round AS round, rm.registration_code AS code,
           r.team_name AS teamName, r.college_name AS college,
           m.member_order AS memberOrder, m.full_name AS memberName, m.phone AS memberPhone
    FROM round_marks rm
    JOIN registrations r ON r.registration_code = rm.registration_code
    LEFT JOIN registration_members m ON m.registration_id = r.id
    WHERE rm.qualified = 1
    ORDER BY rm.event_name ASC, rm.round ASC, rm.marks DESC, r.created_at ASC, m.member_order ASC`);

  const qualifiers = [];
  const qualifierByKey = new Map();
  for (const row of qualifierRows) {
    const key = `${row.eventName}|${row.round}|${row.code}`;
    let team = qualifierByKey.get(key);
    if (!team) {
      team = {
        eventName: row.eventName,
        round: row.round,
        name: row.teamName || row.memberName || row.code,
        college: row.college,
        members: []
      };
      qualifierByKey.set(key, team);
      qualifiers.push(team);
    }
    if (row.memberOrder != null) team.members.push({ name: row.memberName, phone: row.memberPhone });
  }

  return eventRows.map(({ name }) => {
    const plan = roundPlan(name);
    const rounds = [];
    for (let round = 1; round < plan.length; round++) {
      const advancing = qualifiers
        .filter(team => team.eventName === name && team.round === round)
        .map(team => ({ name: team.name, college: team.college, members: team.members }));
      rounds.push({ round, name: plan[round - 1] || '', advancing });
    }
    const status = decidedEvents.has(name) ? 'completed' : (rounds.some(item => item.advancing.length) ? 'live' : 'upcoming');
    return { event: name, totalRounds: plan.length, rounds, status };
  });
}

app.get('/api/scoreboard', async (_req, res) => {
  try {
    res.json({ events: await fetchScoreboard() });
  } catch (error) {
    console.error('Scoreboard error:', error.message);
    res.status(500).json({ error: 'Could not load the scoreboard.' });
  }
});

async function fetchRegistrations(eventName) {
  let sql = `SELECT r.registration_code AS id, r.event_name AS event, r.team_name AS teamName,
                    r.college_name AS college, r.created_at AS createdAt,
                    rm.member_order AS memberOrder, rm.full_name AS fullName, rm.phone AS phone
             FROM registrations r
             LEFT JOIN registration_members rm ON rm.registration_id = r.id`;
  const params = [];
  if (eventName) { sql += ' WHERE r.event_name = ?'; params.push(eventName); }
  sql += ' ORDER BY r.created_at DESC, rm.member_order ASC';
  const [rows] = await pool.execute(sql, params);

  const registrations = [];
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      const registration = { id: row.id, event: row.event, teamName: row.teamName, college: row.college, createdAt: row.createdAt, members: [] };
      byId.set(row.id, registration);
      registrations.push(registration);
    }
    if (row.memberOrder != null) {
      byId.get(row.id).members.push({ name: row.fullName, phone: row.phone });
    }
  }
  return registrations;
}

app.get('/api/admin/registrations', auth, requireRole('admin'), async (req, res) => {
  try {
    const eventName = clean(req.query.event, 80);
    const registrations = await fetchRegistrations(eventName);
    res.json({ registrations });
  } catch (error) {
    console.error('Admin registrations error:', error.message);
    res.status(500).json({ error: 'Could not load registrations.' });
  }
});

app.delete('/api/admin/registrations/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const registrationCode = clean(req.params.id, 32);
    if (!registrationCode) return res.status(400).json({ error: 'A registration ID is required.' });
    const [result] = await pool.execute('DELETE FROM registrations WHERE registration_code = ?', [registrationCode]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Registration was not found. It may already have been deleted.' });
    return res.json({ message: 'Registration deleted successfully.' });
  } catch (error) {
    console.error('Delete registration error:', error.message);
    return res.status(500).json({ error: 'Could not delete registration. Please try again.' });
  }
});

app.get('/api/coordinator/registrations', auth, requireRole('coordinator'), async (req, res) => {
  try {
    const registrations = await fetchRegistrations(req.admin.eventName);
    const [result = null] = await fetchResults(req.admin.eventName);
    res.json({ eventName: req.admin.eventName, registrations, result });
  } catch (error) {
    console.error('Coordinator registrations error:', error.message);
    res.status(500).json({ error: 'Could not load registrations.' });
  }
});

// A coordinator may delete a team registered for their own event (duplicate or mistaken entry).
// Members and round marks cascade away; a stored result that points at it is cleared.
app.delete('/api/coordinator/registrations/:id', auth, requireRole('coordinator'), async (req, res) => {
  try {
    const eventName = req.admin.eventName;
    const registrationCode = clean(req.params.id, 32);
    if (!registrationCode) return res.status(400).json({ error: 'A registration ID is required.' });
    const [result] = await pool.execute(
      'DELETE FROM registrations WHERE registration_code = ? AND event_name = ?',
      [registrationCode, eventName]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'That team was not found for your event.' });
    await pool.execute('DELETE FROM results WHERE event_name = ? AND winner_registration_code = ?', [eventName, registrationCode]);
    await pool.execute('UPDATE results SET runner_registration_code = NULL WHERE event_name = ? AND runner_registration_code = ?', [eventName, registrationCode]);
    return res.json({ message: 'Team deleted.' });
  } catch (error) {
    console.error('Coordinator delete registration error:', error.message);
    return res.status(500).json({ error: 'Could not delete the team. Please try again.' });
  }
});

app.put('/api/coordinator/result', auth, requireRole('coordinator'), async (req, res) => {
  try {
    const eventName = req.admin.eventName;
    const winnerCode = clean(req.body.winnerCode, 32);
    const runnerCode = clean(req.body.runnerCode, 32) || null;
    if (!winnerCode) return res.status(400).json({ error: 'Select a winner.' });
    if (!(await registrationInEvent(winnerCode, eventName))) return res.status(400).json({ error: 'Select a winner registered for your event.' });
    if (runnerCode) {
      if (runnerCode === winnerCode) return res.status(400).json({ error: 'The winner and runner-up must be different.' });
      if (!(await registrationInEvent(runnerCode, eventName))) return res.status(400).json({ error: 'Select a runner-up registered for your event.' });
    }
    await upsertResult(eventName, winnerCode, runnerCode);
    res.json({ message: 'Result saved.' });
  } catch (error) {
    console.error('Coordinator result error:', error.message);
    res.status(500).json({ error: 'Could not save result.' });
  }
});

// ---- Event coordinator: judging rounds (marks + qualification) ----
// Per-event judging plan. The array length is how many rounds the event runs; each entry is
// that round's display name ('' = unnamed, shown as "Round N"). Coding and IT Manager keep
// the default three rounds; Pitch Tank and IT Quiz run two; Reel Making is a single round.
const EVENT_ROUNDS = {
  'Web Designing': ['MCQ Challenge', 'Replica Design', 'Create Your Own Design'],
  'Pitch Tank': ['Technique Round', 'Product Launch'],
  'IT Quiz': ['Preliminary', 'Final'],
  'Reel Making': ['']
};
const DEFAULT_ROUNDS = ['', '', ''];

function roundPlan(eventName) {
  return EVENT_ROUNDS[eventName] || DEFAULT_ROUNDS;
}

function teamLabel(team) {
  return team.teamName || (team.members[0] && team.members[0].name) || team.code;
}

async function fetchRoundEntries(eventName, round) {
  const params = [];
  let sql = `
    SELECT r.registration_code AS code, r.team_name AS teamName, r.college_name AS college,
           r.created_at AS createdAt,
           rm.member_order AS memberOrder, rm.full_name AS fullName, rm.phone AS phone,
           b.marks AS marks, b.qualified AS qualified,`;
  sql += round > 1 ? ' q.marks AS prevMarks' : ' NULL AS prevMarks';
  sql += `
    FROM registrations r
    LEFT JOIN registration_members rm ON rm.registration_id = r.id`;
  if (round > 1) {
    sql += ` JOIN round_marks q ON q.registration_code = r.registration_code AND q.round = ? AND q.qualified = 1`;
    params.push(round - 1);
  }
  sql += ` LEFT JOIN round_marks b ON b.registration_code = r.registration_code AND b.round = ?`;
  params.push(round);
  sql += ` WHERE r.event_name = ? ORDER BY rm.member_order ASC`;
  params.push(eventName);

  const [rows] = await pool.execute(sql, params);
  const teams = [];
  const byCode = new Map();
  for (const row of rows) {
    if (!byCode.has(row.code)) {
      const team = {
        code: row.code,
        teamName: row.teamName,
        college: row.college,
        createdAt: row.createdAt,
        prevMarks: row.prevMarks == null ? null : Number(row.prevMarks),
        marks: row.marks == null ? null : Number(row.marks),
        qualified: !!row.qualified,
        members: []
      };
      byCode.set(row.code, team);
      teams.push(team);
    }
    if (row.memberOrder != null) {
      byCode.get(row.code).members.push({ name: row.fullName, phone: row.phone });
    }
  }

  const rank = value => (value === null ? -Infinity : value);
  teams.sort((a, b) => {
    const byMarks = rank(b.marks) - rank(a.marks);
    if (byMarks) return byMarks;
    const byPrevious = rank(b.prevMarks) - rank(a.prevMarks);
    if (byPrevious) return byPrevious;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  return teams;
}

async function decideEventResult(eventName) {
  const finalRound = roundPlan(eventName).length;
  const scored = (await fetchRoundEntries(eventName, finalRound)).filter(team => team.marks !== null);
  if (!scored.length) return null;
  const winner = scored[0];
  const runner = scored[1] || null;
  await upsertResult(eventName, winner.code, runner ? runner.code : null);
  return {
    winnerCode: winner.code,
    winnerName: teamLabel(winner),
    winnerCollege: winner.college,
    runnerCode: runner ? runner.code : null,
    runnerName: runner ? teamLabel(runner) : null,
    runnerCollege: runner ? runner.college : null
  };
}

app.get('/api/coordinator/rounds', auth, requireRole('coordinator'), async (req, res) => {
  try {
    const round = Number(req.query.round || 1);
    const eventName = req.admin.eventName;
    const rounds = roundPlan(eventName);
    if (!Number.isInteger(round) || round < 1 || round > rounds.length) {
      return res.status(400).json({ error: 'Select a valid round.' });
    }
    const entries = await fetchRoundEntries(eventName, round);
    let decision = null;
    if (round === rounds.length) {
      const [existing] = await fetchResults(eventName);
      decision = existing || null;
    }
    res.json({ round, eventName, rounds, entries, decision });
  } catch (error) {
    console.error('Rounds fetch error:', error.message);
    res.status(500).json({ error: 'Could not load this round.' });
  }
});

app.put('/api/coordinator/rounds/:round', auth, requireRole('coordinator'), async (req, res) => {
  try {
    const round = Number(req.params.round);
    const eventName = req.admin.eventName;
    const rounds = roundPlan(eventName);
    if (!Number.isInteger(round) || round < 1 || round > rounds.length) {
      return res.status(400).json({ error: 'Select a valid round.' });
    }
    const participants = await fetchRoundEntries(eventName, round);
    const allowed = new Set(participants.map(team => team.code));
    const submitted = Array.isArray(req.body.entries) ? req.body.entries : [];

    const updates = [];
    for (const item of submitted) {
      const code = clean(item && item.code, 32);
      const raw = item ? item.marks : '';
      if (!allowed.has(code) || raw === '' || raw === null || raw === undefined) continue;
      const marks = Number(raw);
      if (!Number.isFinite(marks) || marks < 0 || marks > 99999.99) {
        return res.status(400).json({ error: 'Enter a valid mark of 0 or more for every team.' });
      }
      updates.push([eventName, code, round, marks]);
    }
    if (!updates.length) return res.status(400).json({ error: 'Enter at least one mark before submitting.' });

    for (const row of updates) {
      await pool.execute(
        `INSERT INTO round_marks (event_name, registration_code, round, marks) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE marks = VALUES(marks)`,
        row
      );
    }

    const decision = round === rounds.length ? await decideEventResult(eventName) : null;
    res.json({ message: 'Marks saved.', saved: updates.length, decision });
  } catch (error) {
    console.error('Save round marks error:', error.message);
    res.status(500).json({ error: 'Could not save marks.' });
  }
});

app.put('/api/coordinator/rounds/:round/qualify', auth, requireRole('coordinator'), async (req, res) => {
  try {
    const round = Number(req.params.round);
    const eventName = req.admin.eventName;
    const rounds = roundPlan(eventName);
    if (!Number.isInteger(round) || round < 1 || round >= rounds.length) {
      return res.status(400).json({ error: 'The final round does not have qualifiers.' });
    }
    const participants = await fetchRoundEntries(eventName, round);
    const allowed = participants.map(team => team.code);
    const requested = Array.isArray(req.body.codes) ? req.body.codes.map(code => clean(code, 32)) : [];
    const selected = new Set(requested.filter(code => allowed.includes(code)));

    for (const code of allowed) {
      await pool.execute(
        `INSERT INTO round_marks (event_name, registration_code, round, qualified) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE qualified = VALUES(qualified)`,
        [eventName, code, round, selected.has(code) ? 1 : 0]
      );
    }

    const dropped = allowed.filter(code => !selected.has(code));
    if (dropped.length) {
      const placeholders = dropped.map(() => '?').join(',');
      await pool.execute(
        `DELETE FROM round_marks WHERE event_name = ? AND round = ? AND registration_code IN (${placeholders})`,
        [eventName, round + 1, ...dropped]
      );
    }

    res.json({ message: 'Qualifiers saved.', qualifiedCount: selected.size });
  } catch (error) {
    console.error('Save qualifiers error:', error.message);
    res.status(500).json({ error: 'Could not save qualifiers.' });
  }
});

// Every competition with the state of its final result, so the organizer console can show
// which events have published a winner/runner-up (completed) and which are still pending.
async function fetchResultSummary() {
  const results = await fetchResults();
  const byEvent = new Map(results.map(row => [row.eventName, row]));
  const memberMap = await membersByCode(results.flatMap(row => [row.winnerCode, row.runnerCode]));
  const memberNames = code => (memberMap.get(code) || []).map(member => member.name).filter(Boolean);
  const [eventRows] = await pool.execute('SELECT name FROM events ORDER BY id ASC');
  const events = eventRows.map(({ name }) => {
    const row = byEvent.get(name);
    const completed = !!(row && row.winnerName);
    return {
      event: name,
      status: completed ? 'completed' : 'pending',
      winnerName: completed ? row.winnerName : null,
      winnerTeam: completed ? row.winnerTeam : null,
      winnerMembers: completed ? memberNames(row.winnerCode) : [],
      winnerCollege: completed ? row.winnerCollege : null,
      runnerName: completed ? row.runnerName : null,
      runnerTeam: completed ? row.runnerTeam : null,
      runnerMembers: completed && row.runnerCode ? memberNames(row.runnerCode) : [],
      runnerCollege: completed ? row.runnerCollege : null,
      updatedAt: completed ? row.updatedAt : null
    };
  });
  const uploaded = events.filter(item => item.status === 'completed').length;
  return { events, uploaded, total: events.length };
}

app.get('/api/admin/results', auth, requireRole('admin'), async (_req, res) => {
  try {
    res.json(await fetchResultSummary());
  } catch (error) {
    console.error('Admin results error:', error.message);
    res.status(500).json({ error: 'Could not load results.' });
  }
});

app.get('/api/admin/coordinators', auth, requireRole('admin'), async (_req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, username, event_name AS eventName, created_at AS createdAt FROM admins WHERE role = ? ORDER BY id ASC', ['coordinator']);
    res.json({ coordinators: rows });
  } catch (error) {
    console.error('Coordinators list error:', error.message);
    res.status(500).json({ error: 'Could not load coordinators.' });
  }
});

app.post('/api/admin/coordinators', auth, requireRole('admin'), async (req, res) => {
  try {
    const username = clean(req.body.username, 80);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const eventName = clean(req.body.eventName, 80);
    if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–80 letters, numbers, dot, underscore or hyphen.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!eventName) return res.status(400).json({ error: 'Select an event.' });
    if (!(await eventExists(eventName))) return res.status(400).json({ error: 'Select a valid event.' });
    const hash = await bcrypt.hash(password, 12);
    await pool.execute('INSERT INTO admins (username, password_hash, role, event_name) VALUES (?, ?, ?, ?)', [username, hash, 'coordinator', eventName]);
    res.status(201).json({ message: 'Coordinator created.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That username already exists.' });
    console.error('Create coordinator error:', error.message);
    res.status(500).json({ error: 'Could not create coordinator.' });
  }
});

app.put('/api/admin/coordinators/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const eventName = clean(req.body.eventName, 80);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!eventName) return res.status(400).json({ error: 'Select an event.' });
    const fields = ['event_name = ?'];
    const params = [eventName];
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      fields.push('password_hash = ?');
      params.push(await bcrypt.hash(password, 12));
    }
    params.push(id);
    await pool.execute(`UPDATE admins SET ${fields.join(', ')} WHERE id = ? AND role = 'coordinator'`, params);
    res.json({ message: 'Coordinator updated.' });
  } catch (error) {
    console.error('Update coordinator error:', error.message);
    res.status(500).json({ error: 'Could not update coordinator.' });
  }
});

app.delete('/api/admin/coordinators/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [result] = await pool.execute(`DELETE FROM admins WHERE id = ? AND role = 'coordinator'`, [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Coordinator not found.' });
    res.json({ message: 'Coordinator deleted.' });
  } catch (error) {
    console.error('Delete coordinator error:', error.message);
    res.status(500).json({ error: 'Could not delete coordinator.' });
  }
});

app.post('/api/admin/events', auth, requireRole('admin'), async (req, res) => {
  try {
    const name = clean(req.body.name, 80);
    const slug = clean(req.body.slug, 80).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!name || !slug) return res.status(400).json({ error: 'Enter an event name and slug.' });
    await pool.execute('INSERT INTO events (name, slug) VALUES (?, ?)', [name, slug]);
    res.status(201).json({ message: 'Event added.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An event with that name or slug already exists.' });
    console.error('Create event error:', error.message);
    res.status(500).json({ error: 'Could not add event.' });
  }
});

app.put('/api/admin/events/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = clean(req.body.name, 80);
    const slug = clean(req.body.slug, 80).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!name || !slug) return res.status(400).json({ error: 'Enter an event name and slug.' });
    await pool.execute('UPDATE events SET name = ?, slug = ? WHERE id = ?', [name, slug, id]);
    res.json({ message: 'Event updated.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An event with that name or slug already exists.' });
    console.error('Update event error:', error.message);
    res.status(500).json({ error: 'Could not update event.' });
  }
});

app.delete('/api/admin/events/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [result] = await pool.execute('DELETE FROM events WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Event not found.' });
    res.json({ message: 'Event deleted.' });
  } catch (error) {
    console.error('Delete event error:', error.message);
    res.status(500).json({ error: 'Could not delete event.' });
  }
});

// Organizer: open or close new entries for every event at once.
app.put('/api/admin/registration-lock', auth, requireRole('admin'), async (req, res) => {
  try {
    const locked = req.body.locked === true || req.body.locked === 'true';
    await setSetting('registration_locked', locked ? '1' : '0');
    res.json({
      registrationLocked: locked,
      message: locked ? 'Registration is locked for every event.' : 'Registration is open for every event.'
    });
  } catch (error) {
    console.error('Registration lock error:', error.message);
    res.status(500).json({ error: 'Could not update the registration window.' });
  }
});

app.post('/api/admin/logout', (_req, res) => res.json({ message: 'Logged out. Clear the token in this browser.' }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found.' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Local / traditional hosting: check the database, then listen.
// On Vercel the file is imported by api/index.js instead, so it must not call listen().
if (require.main === module) {
  pool.query('SELECT 1')
    .then(() => app.listen(PORT, () => console.log(`PRAMEYA 1.0 running at http://localhost:${PORT}`)))
    .catch((error) => {
      console.error('Database connection failed:', error.message);
      console.error('Check that MySQL is running and your .env settings match database.sql.');
      process.exit(1);
    });
}

module.exports = app;