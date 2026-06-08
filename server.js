require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const port = Number(process.env.PORT || 5050);
const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const jitsiDomain = process.env.JITSI_DOMAIN || 'meet.jit.si';
const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || 'change-this-session-secret';
const defaultAdminEmail = 'admin@example.com';
const defaultAdminPassword = 'change_me_strong_password';
const effectiveAdminEmail = adminEmail || defaultAdminEmail;
const effectiveAdminPassword = adminPassword || defaultAdminPassword;

let pool;

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ message: 'Admin login required' });
  }
  next();
}

function randomRoomName() {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `class-${now}-${rand}`;
}

async function initDatabase() {
  const sqliteFile = process.env.SQLITE_FILE || path.join(__dirname, 'data', 'cmt_meeting.sqlite');
  fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });

  pool = await open({
    filename: sqliteFile,
    driver: sqlite3.Database
  });

  await pool.exec('PRAGMA foreign_keys = ON;');

  await pool.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      host_name TEXT NOT NULL,
      host_email TEXT,
      scheduled_at TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'live', 'ended')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      ended_at TEXT
    )
  `);

  await pool.exec(`
    CREATE TABLE IF NOT EXISTS meeting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_name TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meeting_id)
        REFERENCES meetings(id)
        ON DELETE CASCADE
    )
  `);

  await pool.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_meeting_created
    ON meeting_events (meeting_id, created_at)
  `);

  await pool.exec(`
    CREATE TABLE IF NOT EXISTS meeting_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'jitsi',
      recording_url TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meeting_id)
        REFERENCES meetings(id)
        ON DELETE CASCADE
    )
  `);

  await pool.exec(`
    CREATE INDEX IF NOT EXISTS idx_recordings_meeting_created
    ON meeting_recordings (meeting_id, created_at)
  `);
}

app.use(express.json());
app.use(
  session({
    name: 'cmt_admin_sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000
    }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'cmt-meeting' });
});

app.get('/api/config', (_req, res) => {
  res.json({ jitsiDomain, appBaseUrl });
});

app.get('/api/auth/me', (req, res) => {
  res.json({
    isAdmin: Boolean(req.session && req.session.isAdmin),
    email: req.session && req.session.email ? req.session.email : null
  });
});

app.post('/api/auth/login', (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');

  if (email !== effectiveAdminEmail || password !== effectiveAdminPassword) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  req.session.isAdmin = true;
  req.session.email = effectiveAdminEmail;
  res.json({ ok: true, isAdmin: true, email: effectiveAdminEmail });
});

app.post('/api/auth/logout', (req, res) => {
  if (!req.session) {
    return res.json({ ok: true });
  }

  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ message: 'Could not logout' });
    }
    res.clearCookie('cmt_admin_sid');
    res.json({ ok: true });
  });
});

app.get('/api/meetings', async (_req, res, next) => {
  try {
    const rows = await pool.all(
      `SELECT id, room_name, title, host_name, host_email, scheduled_at, status, created_at, started_at, ended_at
       FROM meetings
       ORDER BY created_at DESC
       LIMIT 25`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/meetings', async (req, res, next) => {
  try {
    if (!req.session || !req.session.isAdmin) {
      return res.status(401).json({ message: 'Only admin can create meetings' });
    }

    const { title, hostName, hostEmail, scheduledAt } = req.body || {};

    if (!title || !hostName) {
      return res.status(400).json({ message: 'title and hostName are required' });
    }

    const roomName = randomRoomName();
    const result = await pool.run(
      `INSERT INTO meetings (room_name, title, host_name, host_email, scheduled_at)
       VALUES (?, ?, ?, ?, ?)` ,
      [roomName, title.trim(), hostName.trim(), hostEmail || null, scheduledAt || null]
    );

    const shareUrl = `${appBaseUrl}/meeting/${roomName}`;

    res.status(201).json({
      id: result.lastID,
      roomName,
      shareUrl,
      title: title.trim(),
      hostName: hostName.trim()
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/meetings/:roomName', async (req, res, next) => {
  try {
    const rows = await pool.all(
      `SELECT id, room_name, title, host_name, host_email, scheduled_at, status, created_at, started_at, ended_at
       FROM meetings
       WHERE room_name = ?`,
      [req.params.roomName]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    const meeting = rows[0];

    const recordings = await pool.all(
      `SELECT id, provider, recording_url, notes, created_at
       FROM meeting_recordings
       WHERE meeting_id = ?
       ORDER BY created_at DESC`,
      [meeting.id]
    );

    const isAdmin = Boolean(req.session && req.session.isAdmin);
    res.json({ ...meeting, recordings, isAdmin });
  } catch (error) {
    next(error);
  }
});

app.post('/api/meetings/:roomName/events', async (req, res, next) => {
  try {
    const { type, actorName, payload } = req.body || {};
    if (!type) {
      return res.status(400).json({ message: 'type is required' });
    }

    const meetingRows = await pool.all(
      'SELECT id FROM meetings WHERE room_name = ?',
      [req.params.roomName]
    );

    if (!meetingRows.length) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    const meetingId = meetingRows[0].id;

    await pool.run(
      `INSERT INTO meeting_events (meeting_id, event_type, actor_name, payload_json)
       VALUES (?, ?, ?, ?)`,
      [meetingId, type, actorName || null, payload ? JSON.stringify(payload) : null]
    );

    if (type === 'meeting_joined') {
      await pool.run(
        `UPDATE meetings
         SET status = 'live', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
         WHERE id = ?`,
        [meetingId]
      );
    }

    if (type === 'meeting_left') {
      await pool.run(
        `UPDATE meetings
         SET status = CASE WHEN status = 'live' THEN 'ended' ELSE status END,
             ended_at = CASE WHEN status = 'live' THEN CURRENT_TIMESTAMP ELSE ended_at END
         WHERE id = ?`,
        [meetingId]
      );
    }

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/meetings/:roomName/recordings', async (req, res, next) => {
  try {
    if (!req.session || !req.session.isAdmin) {
      return res.status(401).json({ message: 'Only admin can save recording links' });
    }

    const { provider, recordingUrl, notes } = req.body || {};
    if (!recordingUrl) {
      return res.status(400).json({ message: 'recordingUrl is required' });
    }

    const meetingRows = await pool.all(
      'SELECT id FROM meetings WHERE room_name = ?',
      [req.params.roomName]
    );

    if (!meetingRows.length) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    const meetingId = meetingRows[0].id;

    const result = await pool.run(
      `INSERT INTO meeting_recordings (meeting_id, provider, recording_url, notes)
       VALUES (?, ?, ?, ?)`,
      [meetingId, provider || 'jitsi', recordingUrl, notes || null]
    );

    res.status(201).json({ id: result.lastID, ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/meetings/:roomName', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.run('DELETE FROM meetings WHERE room_name = ?', [req.params.roomName]);

    if (!result.changes) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/meeting/:roomName', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'meeting.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error', details: err.message });
});

async function start() {
  try {
    await initDatabase();
    app.listen(port, () => {
      console.log(`CMT Meeting server running on ${appBaseUrl}`);
      console.log(`Jitsi domain: ${jitsiDomain}`);
      if (!adminEmail || !adminPassword) {
        console.warn('ADMIN_EMAIL or ADMIN_PASSWORD is not set. Using fallback defaults from .env.example.');
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

start();
