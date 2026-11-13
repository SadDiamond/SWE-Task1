const path = require('node:path');
const express = require('express');
const { all, initialiseDatabase, run } = require('./db');
const auth = require('./auth');
const rules = require('./rules');

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
// Big enough for the most detailed drawing the game allows, small enough to refuse anything silly.
app.use(express.json({ limit: '100kb' }));

// Security headers: only this site's own scripts, styles and images may load.
app.use((_request, response, next) => {
  response.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  next();
});
app.use(express.static(publicDirectory, { extensions: ['html'] }));
// Works out who is logged in before any route runs. request.user is undefined for a guest.
app.use(auth.loadUser);

// Runs a route and passes any database error to the error handler at the bottom.
function route(handler) {
  return (request, response, next) => handler(request, response).catch(next);
}

/* Accounts */

function cleanText(value, longest) {
  return typeof value === 'string' ? value.trim().slice(0, longest) : '';
}

app.get('/api/me', (request, response) => {
  response.json({ user: request.user || null });
});

app.post('/api/signup', route(async (request, response) => {
  const username = cleanText(request.body.username, 20).toLowerCase();
  const displayName = cleanText(request.body.displayName, 30) || username;
  const password = typeof request.body.password === 'string' ? request.body.password : '';

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return response.status(400).json({ error: 'Usernames are 3 to 20 letters, numbers or underscores.' });
  }
  if (password.length < 8 || password.length > 100) {
    return response.status(400).json({ error: 'Passwords need at least 8 characters.' });
  }
  const taken = await all('SELECT id FROM users WHERE username = ?', [username]);
  if (taken.length > 0) {
    return response.status(409).json({ error: 'That username is taken.' });
  }

  const salt = auth.newSalt();
  const result = await run(
    'INSERT INTO users (username, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)',
    [username, displayName, auth.hashPassword(password, salt), salt]
  );
  await auth.startSession(response, result.id);
  response.status(201).json({ id: result.id });
}));

app.post('/api/login', route(async (request, response) => {
  const username = cleanText(request.body.username, 20).toLowerCase();
  const password = typeof request.body.password === 'string' ? request.body.password : '';

  // The same message is used for a wrong username and a wrong password,
  // so nobody can use this form to find out which usernames exist.
  const users = await all('SELECT * FROM users WHERE username = ?', [username]);
  if (users.length === 0 || !auth.passwordMatches(password, users[0])) {
    return response.status(401).json({ error: 'Wrong username or password.' });
  }
  await run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
  await auth.startSession(response, users[0].id);
  response.json({ id: users[0].id });
}));

app.post('/api/logout', route(async (request, response) => {
  await auth.endSession(request, response);
  response.status(204).end();
}));

/* The game */

async function findMachine(id) {
  const machines = await all(`
    SELECT machines.*, families.name AS family_name
    FROM machines
    INNER JOIN families ON families.id = machines.family_id
    WHERE machines.id = ? AND machines.play_date <= ?
  `, [id, rules.todayDate()]);
  return machines[0];
}

async function findPlay(userId, machineId) {
  const plays = await all('SELECT * FROM plays WHERE user_id = ? AND machine_id = ?', [userId, machineId]);
  return plays[0];
}

// Finds a player's attempt at a curve, starting one if there is none yet.
// It refuses if an earlier curve from the same day is still unfinished, because the three are played in order.
async function openPlay(userId, machine) {
  const earlier = await all(`
    SELECT machines.slot
    FROM machines
    LEFT JOIN plays ON plays.machine_id = machines.id AND plays.user_id = ?
    WHERE machines.play_date = ? AND machines.slot < ?
      AND (plays.id IS NULL OR plays.status = 'playing')
  `, [userId, machine.play_date, machine.slot]);
  if (earlier.length > 0) return { error: 'Finish the earlier curves first.' };

  await run('INSERT OR IGNORE INTO plays (user_id, machine_id) VALUES (?, ?)', [userId, machine.id]);
  const play = await findPlay(userId, machine.id);
  if (play.status !== 'playing') return { error: 'You have already finished this curve.' };
  return { play };
}

// Everything that is revealed once a curve is finished.
function reveal(machine, accuracy, solved, goes, hints) {
  return {
    accuracy,
    solved,
    finished: true,
    score: rules.scoreFor(accuracy, goes, hints),
    curve: rules.visibleCurve(machine),
    familyName: machine.family_name,
    formula: rules.describe(machine),
    asymptotes: rules.asymptotes(machine)
  };
}

// What a logged-in player has already done on a curve, so the page can carry on where they left off.
async function savedState(userId, machine) {
  const play = await findPlay(userId, machine.id);
  if (!play) return null;

  const saved = {
    goes: play.goes,
    dots: rules.hintDots(machine).slice(0, play.hints),
    result: null,
    last: null
  };
  if (play.status !== 'playing') {
    saved.result = reveal(machine, play.accuracy, play.status === 'solved', play.goes, play.hints);
  }
  // The most recent go is marked again so its colours can be shown.
  const goes = await all('SELECT drawing FROM goes WHERE play_id = ? ORDER BY number DESC LIMIT 1', [play.id]);
  if (goes.length > 0) {
    const strokes = JSON.parse(goes[0].drawing);
    const marked = rules.judge(strokes, machine);
    saved.last = { strokes, levels: marked.levels, nudges: marked.nudges, missed: marked.missed };
  }
  return saved;
}

// Today's three curves. Only what the page needs to set up the game; nothing about the curves themselves.
app.get('/api/today', route(async (request, response) => {
  const machines = await rules.machinesFor(rules.todayDate());
  const curves = [];
  for (const machine of machines) {
    curves.push({
      id: machine.id,
      slot: machine.slot,
      // How many strokes make up one go. More than one means the curve has breaks in it.
      strokesPerGo: rules.pieces(machine),
      // How much line the pen can draw in one go.
      ink: rules.inkFor(machine),
      // Where the curve leaves the graph is shown from the start, so the first go is not a blind guess.
      exits: rules.exits(machine),
      saved: request.user ? await savedState(request.user.id, machine) : null
    });
  }

  response.json({
    date: rules.todayDate(),
    limit: rules.LIMIT,
    maxGoes: rules.MAX_GOES,
    maxHints: rules.MAX_HINTS,
    topScore: rules.TOP_SCORE,
    goPenalty: rules.GO_PENALTY,
    hintPenalty: rules.HINT_PENALTY,
    shortestStroke: rules.SHORTEST_STROKE,
    mostPoints: rules.MOST_POINTS,
    curves
  });
}));

// Marks one go: a freehand drawing made of strokes, each a list of [x, y] pen positions.
// For a logged-in player the server keeps count of goes and hints itself and saves the go.
// A guest's page keeps count instead, and nothing is saved.
app.post('/api/machines/:id/go', route(async (request, response) => {
  const { drawing } = request.body;
  let { go, hints } = request.body;

  if (!rules.validDrawing(drawing)) {
    return response.status(400).json({ error: 'That drawing is not in the right format.' });
  }
  const machine = await findMachine(Number.parseInt(request.params.id, 10));
  if (!machine) return response.status(404).json({ error: 'Curve not found.' });

  // The page stops the pen when the ink runs out. This catches a drawing sent some other way.
  // The small allowance covers rounding of pen positions.
  if (rules.inkUsed(drawing) > rules.inkFor(machine) * 1.05) {
    return response.status(400).json({ error: 'That drawing uses more ink than the pen holds.' });
  }

  let play = null;
  if (request.user) {
    const opened = await openPlay(request.user.id, machine);
    if (opened.error) return response.status(409).json({ error: opened.error });
    play = opened.play;
    go = play.goes + 1;
    hints = play.hints;
  } else {
    if (!Number.isInteger(go) || go < 1 || go > rules.MAX_GOES) {
      return response.status(400).json({ error: 'That go number is not valid.' });
    }
    if (!Number.isInteger(hints) || hints < 0 || hints > rules.MAX_HINTS) {
      return response.status(400).json({ error: 'That number of hints is not valid.' });
    }
  }

  const result = rules.judge(drawing, machine);
  const finished = result.solved || go === rules.MAX_GOES;
  const reply = finished
    ? reveal(machine, result.accuracy, result.solved, go, hints)
    : { accuracy: result.accuracy, solved: false, finished: false };
  reply.levels = result.levels;
  reply.nudges = result.nudges;
  reply.missed = result.missed;

  if (play) {
    await run(
      'INSERT INTO goes (play_id, number, drawing, accuracy) VALUES (?, ?, ?, ?)',
      [play.id, go, JSON.stringify(drawing), result.accuracy]
    );
    if (finished) {
      await run(
        `UPDATE plays
         SET goes = ?, status = ?, accuracy = ?, score = ?, finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [go, result.solved ? 'solved' : 'failed', result.accuracy, reply.score, play.id]
      );
    } else {
      await run('UPDATE plays SET goes = ? WHERE id = ?', [go, play.id]);
    }
  }
  response.json(reply);
}));

// Gives one hint: a spot that is on the curve.
// For a logged-in player the server counts the hints. A guest's page says which number it wants.
app.post('/api/machines/:id/hint', route(async (request, response) => {
  const machine = await findMachine(Number.parseInt(request.params.id, 10));
  if (!machine) return response.status(404).json({ error: 'Curve not found.' });

  let { number } = request.body;
  let play = null;
  if (request.user) {
    const opened = await openPlay(request.user.id, machine);
    if (opened.error) return response.status(409).json({ error: opened.error });
    play = opened.play;
    number = play.hints + 1;
  }
  if (!Number.isInteger(number) || number < 1 || number > rules.MAX_HINTS) {
    return response.status(400).json({ error: 'There are no more hints for this curve.' });
  }

  if (play) await run('UPDATE plays SET hints = ? WHERE id = ?', [number, play.id]);
  response.json({ dot: rules.hintDots(machine)[number - 1] });
}));

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'That address does not exist on the server.' });
});

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'The request was not valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'That drawing is too detailed to send. Try a simpler line.' });
  }
  console.error(error);
  response.status(500).json({ error: 'The server could not complete that request.' });
});

initialiseDatabase()
  .then(() => rules.fillHistory())
  .then(() => app.listen(port, () => console.log(`Placeholder running at http://localhost:${port}`)))
  .catch((error) => {
    console.error('Database setup failed:', error);
    process.exitCode = 1;
  });
