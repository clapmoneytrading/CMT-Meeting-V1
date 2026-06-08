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
);

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
);

CREATE INDEX IF NOT EXISTS idx_events_meeting_created
ON meeting_events (meeting_id, created_at);

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
);

CREATE INDEX IF NOT EXISTS idx_recordings_meeting_created
ON meeting_recordings (meeting_id, created_at);
