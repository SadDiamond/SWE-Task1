const path = require('node:path');
const express = require('express');
const { all, initialiseDatabase } = require('./db');
const rules = require('./rules');

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

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

// Runs a route and passes any database error to the error handler at the bottom.
function route(handler) {
  return (request, response, next) => handler(request, response).catch(next);
}

// Today's curve. Only what the page needs to set up the game; nothing about the curve itself.
app.get('/api/today', route(async (_request, response) => {
  const machine = await rules.machineFor(rules.todayDate());
  response.json({
    id: machine.id,
    date: machine.play_date,
    difficulty: machine.difficulty,
    limit: rules.LIMIT,
    columns: rules.COLUMNS,
    maxGoes: rules.MAX_GOES
  });
}));

// Checks one go: a freehand drawing with one value (or null) for each column of the graph.
app.post('/api/machines/:id/go', route(async (request, response) => {
  const id = Number.parseInt(request.params.id, 10);
  const { drawing, go } = request.body;

  const validDrawing = Array.isArray(drawing)
    && drawing.length === rules.COLUMNS
    && drawing.every((value) => value === null
      || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= rules.LIMIT));
  if (!validDrawing) {
    return response.status(400).json({ error: 'That drawing is not in the right format.' });
  }
  if (drawing.every((value) => value === null)) {
    return response.status(400).json({ error: 'Draw something on the graph first.' });
  }
  if (!Number.isInteger(go) || go < 1 || go > rules.MAX_GOES) {
    return response.status(400).json({ error: 'That go number is not valid.' });
  }

  const machines = await all(`
    SELECT machines.*, families.name AS family_name
    FROM machines
    INNER JOIN families ON families.id = machines.family_id
    WHERE machines.id = ? AND machines.play_date <= ?
  `, [id, rules.todayDate()]);
  if (machines.length === 0) return response.status(404).json({ error: 'Curve not found.' });

  const machine = machines[0];
  const curve = rules.visibleCurve(machine);
  const result = rules.judge(drawing, curve);
  const finished = result.solved || go === rules.MAX_GOES;

  const reply = {
    marks: result.marks,
    missed: result.missed,
    accuracy: result.accuracy,
    solved: result.solved,
    finished,
    exits: rules.exits(machine)
  };
  // The real curve is only sent once the round is over.
  if (finished) {
    reply.curve = curve;
    reply.stars = rules.starsFor(result.solved, go);
    reply.familyName = machine.family_name;
    reply.formula = rules.describe(machine);
    reply.asymptotes = rules.asymptotes(machine);
  }
  response.json(reply);
}));

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'That address does not exist on the server.' });
});

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'The request was not valid JSON.' });
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
