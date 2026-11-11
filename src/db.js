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

// Creates the tables from database/schema.sql. Safe to run on every start.
async function initialiseDatabase() {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const schema = await fs.readFile(schemaPath, 'utf8');
  await new Promise((resolve, reject) => {
    getDatabase().exec(schema, (error) => (error ? reject(error) : resolve()));
  });
}

module.exports = { all, initialiseDatabase, run };
