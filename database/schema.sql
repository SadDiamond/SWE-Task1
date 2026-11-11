PRAGMA foreign_keys = ON;

-- The kinds of rule a machine can hide.
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 3 AND 20),
  formula TEXT NOT NULL CHECK (length(formula) BETWEEN 3 AND 40),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 200)
);

-- One machine for each day. a, b and c are the numbers in its family's formula.
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY,
  play_date TEXT NOT NULL UNIQUE CHECK (length(play_date) = 10),
  family_id INTEGER NOT NULL,
  a INTEGER NOT NULL CHECK (a BETWEEN -9 AND 9 AND a != 0),
  b INTEGER NOT NULL CHECK (b BETWEEN -20 AND 20),
  c INTEGER NOT NULL DEFAULT 0 CHECK (c BETWEEN -20 AND 20),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  FOREIGN KEY (family_id) REFERENCES families(id)
);

CREATE INDEX IF NOT EXISTS idx_machines_family ON machines(family_id);

INSERT OR IGNORE INTO families (id, name, formula, description) VALUES
  (1, 'Straight line', 'a × x + b',
   'Multiplies the input by one number, then adds another. Outputs go up or down by the same amount each step.'),
  (2, 'Curve', 'a × x² + b × x + c',
   'Uses the input squared, so outputs bend into a U shape or an upside-down U.'),
  (3, 'Remainder', '(a × x + b) mod c',
   'Works something out, then keeps only the remainder after dividing by c. Outputs repeat in a cycle.');
