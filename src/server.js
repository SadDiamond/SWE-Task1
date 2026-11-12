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

// Today's machine. The rule (family, a, b, c) is deliberately left out.
app.get('/api/today', route(async (_request, response) => {
  const machine = await rules.machineFor(rules.todayDate());
  response.json({
    id: machine.id,
    date: machine.play_date,
    difficulty: machine.difficulty,
    maxTests: rules.MAX_TESTS,
    minInput: rules.MIN_INPUT,
    maxInput: rules.MAX_INPUT
  });
}));

// Runs one test on a machine: a number goes in, a number comes out.
app.post('/api/machines/:id/test', route(async (request, response) => {
  const id = Number.parseInt(request.params.id, 10);
  const input = request.body.input;

  if (!Number.isInteger(input) || input < rules.MIN_INPUT || input > rules.MAX_INPUT) {
    return response.status(400).json({
      error: `Enter a whole number from ${rules.MIN_INPUT} to ${rules.MAX_INPUT}.`
    });
  }

  const machines = await all('SELECT * FROM machines WHERE id = ? AND play_date <= ?', [id, rules.todayDate()]);
  if (machines.length === 0) return response.status(404).json({ error: 'Machine not found.' });

  response.json({ input, output: rules.evaluate(machines[0], input) });
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
