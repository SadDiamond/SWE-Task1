const crypto = require('node:crypto');
const { all, run } = require('./db');

const SESSION_DAYS = 30;

// Passwords are never stored. Only a salted scrypt hash is kept, which cannot be turned back
// into the password. scrypt is slow on purpose, so guessing passwords takes a very long time.
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function passwordMatches(password, user) {
  const given = Buffer.from(hashPassword(password, user.password_salt), 'hex');
  const stored = Buffer.from(user.password_hash, 'hex');
  return crypto.timingSafeEqual(given, stored);
}

function readCookie(request, name) {
  const cookies = (request.headers.cookie || '').split('; ');
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : '';
}

async function startSession(response, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await run(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
    [token, userId]
  );
  response.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  });
}

async function endSession(request, response) {
  await run('DELETE FROM sessions WHERE token = ?', [readCookie(request, 'session')]);
  response.clearCookie('session');
}

// Runs before every route: works out who is logged in from the session cookie.
async function loadUser(request, _response, next) {
  try {
    const token = readCookie(request, 'session');
    if (token) {
      const users = await all(`
        SELECT users.id, users.username, users.display_name, users.created_at
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ? AND sessions.expires_at > datetime('now')
      `, [token]);
      request.user = users[0];
    }
    next();
  } catch (error) {
    next(error);
  }
}

function requireUser(request, response, next) {
  if (!request.user) return response.status(401).json({ error: 'Log in to do that.' });
  next();
}

module.exports = { endSession, hashPassword, loadUser, newSalt, passwordMatches, requireUser, startSession };
