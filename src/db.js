const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const databasePath = path.join(__dirname, '..', 'data', 'app.db');
const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

let database;

function getDatabase() {
  if (database) return database;
  database = new sqlite3.Database(databasePath);
  // SQLite only enforces foreign keys when this is switched on for the connection.
  database.run('PRAGMA foreign_keys = ON');
  return database;
}

// Runs a query that changes data (INSERT, UPDATE, DELETE).
function run(sql, parameters = []) {
  return new Promise((resolve, reject) => {
    getDatabase().run(sql, parameters, function onRun(error) {
      if (error) return reject(error);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

// Runs a SELECT and gives back every row as an array of objects.
function all(sql, parameters = []) {
  return new Promise((resolve, reject) => {
    getDatabase().all(sql, parameters, (error, rows) => {
      if (error) return reject(error);
      resolve(rows);
    });
  });
}

// Raised whenever the tables change shape.
const SCHEMA_VERSION = 3;

function exec(sql) {
  return new Promise((resolve, reject) => {
    getDatabase().exec(sql, (error) => (error ? reject(error) : resolve()));
  });
}

// Creates the tables from database/schema.sql. Safe to run on every start.
async function initialiseDatabase() {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });

  // SQLite keeps a version number inside the database file. If the file was made by an
  // older version of the app, its tables are removed once so the new ones can be created.
  const version = await all('PRAGMA user_version');
  if (version[0].user_version < SCHEMA_VERSION) {
    await exec('DROP TABLE IF EXISTS machines; DROP TABLE IF EXISTS families;');
  }

  await exec(await fs.readFile(schemaPath, 'utf8'));
  await run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

module.exports = { all, initialiseDatabase, run };
