const path = require('node:path');
const express = require('express');
const { all, initialiseDatabase } = require('./db');
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

// Runs a route and passes any database error to the error handler at the bottom.
function route(handler) {
  return (request, response, next) => handler(request, response).catch(next);
}

// Today's three curves. Only what the page needs to set up the game; nothing about the curves themselves.
app.get('/api/today', route(async (_request, response) => {
  const machines = await rules.machinesFor(rules.todayDate());
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
    curves: machines.map((machine) => ({
      id: machine.id,
      slot: machine.slot,
      // How many strokes make up one go. More than one means the curve has breaks in it.
      strokesPerGo: rules.pieces(machine),
      // How much line the pen can draw in one go.
      ink: rules.inkFor(machine),
      // Where the curve leaves the graph is shown from the start, so the first go is not a blind guess.
      exits: rules.exits(machine)
    }))
  });
}));

// Marks one go: a freehand drawing made of strokes, each a list of [x, y] pen positions.
app.post('/api/machines/:id/go', route(async (request, response) => {
  const id = Number.parseInt(request.params.id, 10);
  const { drawing, go, hints } = request.body;

  if (!rules.validDrawing(drawing)) {
    return response.status(400).json({ error: 'That drawing is not in the right format.' });
  }
  if (!Number.isInteger(go) || go < 1 || go > rules.MAX_GOES) {
    return response.status(400).json({ error: 'That go number is not valid.' });
  }
  if (!Number.isInteger(hints) || hints < 0 || hints > rules.MAX_HINTS) {
    return response.status(400).json({ error: 'That number of hints is not valid.' });
  }

  const machines = await all(`
    SELECT machines.*, families.name AS family_name
    FROM machines
    INNER JOIN families ON families.id = machines.family_id
    WHERE machines.id = ? AND machines.play_date <= ?
  `, [id, rules.todayDate()]);
  if (machines.length === 0) return response.status(404).json({ error: 'Curve not found.' });

  const machine = machines[0];
  // The page stops the pen when the ink runs out. This catches a drawing sent some other way.
  // The small allowance covers rounding of pen positions.
  if (rules.inkUsed(drawing) > rules.inkFor(machine) * 1.05) {
    return response.status(400).json({ error: 'That drawing uses more ink than the pen holds.' });
  }
  const result = rules.judge(drawing, machine);
  const finished = result.solved || go === rules.MAX_GOES;

  const reply = {
    levels: result.levels,
    nudges: result.nudges,
    missed: result.missed,
    accuracy: result.accuracy,
    solved: result.solved,
    finished
  };
  // The real curve is only sent once the round is over.
  if (finished) {
    reply.curve = rules.visibleCurve(machine);
    reply.score = rules.scoreFor(result.accuracy, go, hints);
    reply.familyName = machine.family_name;
    reply.formula = rules.describe(machine);
    reply.asymptotes = rules.asymptotes(machine);
  }
  response.json(reply);
}));

// Gives one hint: a spot that is on the curve. number is 1 for the first hint, 2 for the second, and so on.
app.post('/api/machines/:id/hint', route(async (request, response) => {
  const id = Number.parseInt(request.params.id, 10);
  const { number } = request.body;
  if (!Number.isInteger(number) || number < 1 || number > rules.MAX_HINTS) {
    return response.status(400).json({ error: 'There are no more hints for this curve.' });
  }

  const machines = await all('SELECT * FROM machines WHERE id = ? AND play_date <= ?', [id, rules.todayDate()]);
  if (machines.length === 0) return response.status(404).json({ error: 'Curve not found.' });

  response.json({ dot: rules.hintDots(machines[0])[number - 1] });
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
