// Self-check for the curve rules. Run with: npm test
const assert = require('node:assert');
const rules = require('../src/rules');

const {
  COLUMNS, LINE, PARABOLA, V_SHAPE, CUBIC, WAVE, ROOT, EXPONENTIAL, HYPERBOLA, SLANTED
} = rules;

// Outputs for known inputs.
assert.strictEqual(rules.evaluate({ family_id: LINE, a: 3, b: -2, c: 0 }, 4), 4);
assert.strictEqual(rules.evaluate({ family_id: PARABOLA, a: 4, b: 1, c: -3 }, 3), 1);
assert.strictEqual(rules.evaluate({ family_id: V_SHAPE, a: 2, b: 0, c: 0 }, -5), 5);
assert.strictEqual(rules.evaluate({ family_id: CUBIC, a: 1, b: 0, c: 1 }, 2), 2);
assert.strictEqual(rules.evaluate({ family_id: WAVE, a: 3, b: 4, c: 1 }, 2), 4);
assert.strictEqual(rules.evaluate({ family_id: ROOT, a: 2, b: -4, c: 0 }, 0), 4);
assert.strictEqual(rules.evaluate({ family_id: ROOT, a: 2, b: -4, c: 0 }, -5), null, 'no square root before the start');
assert.strictEqual(rules.evaluate({ family_id: EXPONENTIAL, a: 1, b: 2, c: -1 }, 4), 3);
assert.strictEqual(rules.evaluate({ family_id: HYPERBOLA, a: 6, b: 2, c: 1 }, 5), 3);
assert.strictEqual(rules.evaluate({ family_id: HYPERBOLA, a: 6, b: 2, c: 1 }, 2), null, 'nothing exists on the asymptote');
assert.strictEqual(rules.evaluate({ family_id: SLANTED, a: 4, b: 0, c: 2 }, 2), 4);

// Formulas written out.
assert.strictEqual(rules.describe({ family_id: LINE, a: 3, b: -2, c: 0 }), 'y = 1.5x − 2');
assert.strictEqual(rules.describe({ family_id: LINE, a: -2, b: 0, c: 0 }), 'y = −x');
assert.strictEqual(rules.describe({ family_id: PARABOLA, a: 2, b: 3, c: -4 }), 'y = 0.5(x − 3)² − 4');
assert.strictEqual(rules.describe({ family_id: PARABOLA, a: 4, b: 0, c: 0 }), 'y = x²');
assert.strictEqual(rules.describe({ family_id: V_SHAPE, a: -2, b: -1, c: 5 }), 'y = −|x + 1| + 5');
assert.strictEqual(rules.describe({ family_id: WAVE, a: 3, b: 4, c: 1 }), 'y = 3 sin(πx ÷ 4) + 1');
assert.strictEqual(rules.describe({ family_id: ROOT, a: 2, b: -3, c: -1 }), 'y = 2√(x + 3) − 1');
assert.strictEqual(rules.describe({ family_id: EXPONENTIAL, a: 2, b: 3, c: -4 }), 'y = 2 × 2^(x ÷ 3) − 4');
assert.strictEqual(rules.describe({ family_id: EXPONENTIAL, a: -1, b: 1, c: 0 }), 'y = −2^x');
assert.strictEqual(rules.describe({ family_id: HYPERBOLA, a: 3, b: 2, c: 1 }), 'y = 3 ÷ (x − 2) + 1');
assert.strictEqual(rules.describe({ family_id: SLANTED, a: -4, b: 1, c: 1 }), 'y = 0.5x − 4 ÷ (x − 1)');

// The visible curve: one value for each column, null where the curve is off the graph.
const steep = { family_id: LINE, a: 6, b: 0, c: 0 };
const curve = rules.visibleCurve(steep);
assert.strictEqual(curve.length, COLUMNS);
assert.strictEqual(curve[100], 0, 'the middle column is input 0');
assert.strictEqual(curve[0], null, 'y = 3x is off the bottom at the left edge');

// Exits: y = 3x leaves through the bottom on the left and the top on the right.
assert.deepStrictEqual(rules.exits(steep).map((exit) => exit.side), ['bottom', 'top']);
const hyperbola = { family_id: HYPERBOLA, a: 3, b: 0, c: 0 };
assert.deepStrictEqual(rules.exits(hyperbola).map((exit) => exit.side), ['bottom', 'top']);
assert.strictEqual(rules.asymptotes(hyperbola).length, 2);
assert.strictEqual(rules.asymptotes(steep).length, 0);

// Judging a drawing.
const perfect = rules.judge(curve, steep);
assert.strictEqual(perfect.accuracy, 100);
assert.strictEqual(perfect.solved, true);

const empty = rules.judge(curve.map(() => null), steep);
assert.strictEqual(empty.accuracy, 0);
assert.ok(empty.missed.includes(true), 'an empty drawing misses the curve');

// A steep line drawn 0.4 to one side is over a unit out straight up and down,
// but only a little way from the real line, so it must still score well.
const beside = new Array(COLUMNS).fill(null);
curve.forEach((value, column) => {
  if (value !== null && column + 4 < COLUMNS) beside[column + 4] = value;
});
const sideways = rules.judge(beside, steep);
assert.ok(sideways.accuracy >= 85, `a steep line drawn just to one side scores ${sideways.accuracy}`);
assert.ok(!sideways.missed.includes(true), 'the curve is not missed when the drawing is right beside it');

// A gentle line drawn one unit too high really is one unit away.
const gentle = { family_id: LINE, a: 1, b: 0, c: 0 };
const gentleCurve = rules.visibleCurve(gentle);
const raised = rules.judge(gentleCurve.map((value) => value + 1), gentle);
assert.ok(raised.levels.includes(1) && !raised.levels.includes(0), 'one unit off is level 1, not spot on');
assert.ok(raised.accuracy >= 70 && raised.accuracy <= 80, `one unit off scores about 75, got ${raised.accuracy}`);

const scribble = rules.judge(curve.map(() => 9), steep);
assert.ok(scribble.accuracy < 25, `a flat line across the top scores badly, got ${scribble.accuracy}`);
assert.strictEqual(scribble.levels[0], 4, 'drawing far from the curve is the worst level');

assert.strictEqual(rules.pieces(steep), 1);
assert.strictEqual(rules.pieces(hyperbola), 2, 'a hyperbola is in two pieces');
assert.strictEqual(rules.pieces({ family_id: EXPONENTIAL, a: 1, b: 1, c: 0 }), 1, 'a flat asymptote does not split a curve');

assert.strictEqual(rules.starsFor(true, 1), 3);
assert.strictEqual(rules.starsFor(true, 4), 2);
assert.strictEqual(rules.starsFor(true, 5), 1);
assert.strictEqual(rules.starsFor(false, 5), 0);

// A year of curves: valid numbers, enough of the curve on screen, same curve for the same date.
const seen = new Set();
for (let day = 0; day < 365; day += 1) {
  const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
  const machine = rules.makeMachine(date);
  const visible = rules.visibleCurve(machine).filter((output) => output !== null).length;

  assert.deepStrictEqual(rules.makeMachine(date), machine);
  assert.ok(machine.a !== 0 && Math.abs(machine.a) <= 9 && Math.abs(machine.b) <= 9 && Math.abs(machine.c) <= 9);
  assert.ok(visible >= COLUMNS * 0.3, `enough of the curve is visible on ${date}`);
  assert.ok(!rules.describe(machine).includes('NaN') && !rules.describe(machine).includes('undefined'));
  seen.add(machine.family_id);
}
assert.strictEqual(seen.size, 9, 'every family turns up during the year');

console.log('All rule checks passed.');
