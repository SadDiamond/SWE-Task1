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
  UNIQUE (play_date, slot),
  FOREIGN KEY (family_id) REFERENCES families(id)
);

CREATE INDEX IF NOT EXISTS idx_machines_family ON machines(family_id);

INSERT OR IGNORE INTO families (id, name, difficulty, description) VALUES
  (1, 'Straight line', 1, 'Goes up or down by the same amount with every step across.'),
  (2, 'Parabola', 1, 'A smooth U shape, or an upside-down U, with one turning point.'),
  (3, 'V shape', 1, 'Two straight lines meeting at a sharp corner.'),
  (4, 'Cubic', 2, 'An S-shaped curve that flattens in the middle then climbs or falls steeply.'),
  (5, 'Wave', 2, 'Rises and falls in a repeating pattern, like ripples.'),
  (6, 'Square root', 2, 'Starts at a point, rises quickly, then levels off. Nothing exists before the start.'),
  (7, 'Exponential', 2, 'Almost flat on one side, then shoots away faster and faster on the other.'),
  (8, 'Hyperbola', 3, 'Two separate pieces that hug a vertical line and a flat line without touching them.'),
  (9, 'Slanted hyperbola', 3, 'Two pieces that hug a vertical line and a sloping line.');
