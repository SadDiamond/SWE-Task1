PRAGMA foreign_keys = ON;

-- First version of these tables: three families, and machines tested by typing in whole numbers.
-- Replaced when the game changed to drawing the curve. src/db.js removes the old tables once.
-- CREATE TABLE IF NOT EXISTS machines (
--   id INTEGER PRIMARY KEY,
--   play_date TEXT NOT NULL UNIQUE CHECK (length(play_date) = 10),
--   family_id INTEGER NOT NULL,
--   a INTEGER NOT NULL CHECK (a BETWEEN -9 AND 9 AND a != 0),
--   b INTEGER NOT NULL CHECK (b BETWEEN -20 AND 20),
--   c INTEGER NOT NULL DEFAULT 0 CHECK (c BETWEEN -20 AND 20),
--   difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
--   FOREIGN KEY (family_id) REFERENCES families(id)
-- );

-- People who have signed up. The password itself is never stored, only a hash of it.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 20),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 30),
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 128),
  password_salt TEXT NOT NULL CHECK (length(password_salt) = 32),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row for each browser that is logged in.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY CHECK (length(token) = 64),
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- The kinds of function a daily curve can be.
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 3 AND 30),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 200)
);

-- Second version: one curve a day. Replaced by three curves a day (see slot below).
-- CREATE TABLE IF NOT EXISTS machines (
--   id INTEGER PRIMARY KEY,
--   play_date TEXT NOT NULL UNIQUE CHECK (length(play_date) = 10),
--   family_id INTEGER NOT NULL,
--   a INTEGER NOT NULL CHECK (a BETWEEN -9 AND 9 AND a != 0),
--   b INTEGER NOT NULL CHECK (b BETWEEN -9 AND 9),
--   c INTEGER NOT NULL CHECK (c BETWEEN -9 AND 9),
--   FOREIGN KEY (family_id) REFERENCES families(id)
-- );

-- Three curves for each day: slot 1 is easy, 2 is medium, 3 is hard.
-- a, b and c are whole numbers that src/rules.js turns into the formula.
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY,
  play_date TEXT NOT NULL CHECK (length(play_date) = 10),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  family_id INTEGER NOT NULL,
  a INTEGER NOT NULL CHECK (a BETWEEN -9 AND 9 AND a != 0),
  b INTEGER NOT NULL CHECK (b BETWEEN -9 AND 9),
  c INTEGER NOT NULL CHECK (c BETWEEN -9 AND 9),
  -- Some curves are a mix: a second kind added to the first. These four are empty for a single kind.
  extra_family_id INTEGER,
  extra_a INTEGER CHECK (extra_a BETWEEN -9 AND 9 AND extra_a != 0),
  extra_b INTEGER CHECK (extra_b BETWEEN -9 AND 9),
  extra_c INTEGER CHECK (extra_c BETWEEN -9 AND 9),
  UNIQUE (play_date, slot),
  FOREIGN KEY (family_id) REFERENCES families(id),
  FOREIGN KEY (extra_family_id) REFERENCES families(id)
);

-- One player's attempt at one curve. A player gets one attempt at each curve.
-- accuracy and score are filled in when the attempt is finished.
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  machine_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'solved', 'failed')),
  goes INTEGER NOT NULL DEFAULT 0 CHECK (goes BETWEEN 0 AND 5),
  hints INTEGER NOT NULL DEFAULT 0 CHECK (hints BETWEEN 0 AND 3),
  accuracy INTEGER CHECK (accuracy BETWEEN 0 AND 100),
  score INTEGER CHECK (score BETWEEN 0 AND 1000),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  UNIQUE (user_id, machine_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (machine_id) REFERENCES machines(id)
);

-- Every go within an attempt. The drawing is kept as JSON text: a list of strokes,
-- each a list of [x, y] pen positions, so it can be shown again later.
CREATE TABLE IF NOT EXISTS goes (
  id INTEGER PRIMARY KEY,
  play_id INTEGER NOT NULL,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 5),
  drawing TEXT NOT NULL CHECK (length(drawing) BETWEEN 10 AND 100000),
  accuracy INTEGER NOT NULL CHECK (accuracy BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (play_id, number),
  FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_machines_family ON machines(family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id);
CREATE INDEX IF NOT EXISTS idx_goes_play ON goes(play_id);

INSERT OR IGNORE INTO families (id, name, difficulty, description) VALUES
  (1, 'Straight line', 1, 'Goes up or down by the same amount with every step across.'),
  (2, 'Parabola', 1, 'A smooth U shape, or an upside-down U, with one turning point.'),
  (3, 'V shape', 1, 'Two straight lines meeting at a sharp corner.'),
  (4, 'Cubic', 2, 'A curve with one hill and one dip, heading off in opposite directions at each end.'),
  (5, 'Wave', 2, 'Rises and falls in a repeating pattern, like ripples.'),
  (6, 'Square root', 2, 'Starts at a point, rises quickly, then levels off. Nothing exists before the start.'),
  (7, 'Exponential', 2, 'Almost flat on one side, then shoots away faster and faster on the other.'),
  (8, 'Hyperbola', 3, 'Two separate pieces that hug a vertical line and a flat line without touching them.'),
  (9, 'Slanted hyperbola', 3, 'Two pieces that hug a vertical line and a sloping line.');
