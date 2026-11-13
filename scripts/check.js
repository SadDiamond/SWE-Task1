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
assert.strictEqual(rules.evaluate({ family_id: CUBIC, a: 2, b: 1, c: 4 }, 3), -3);
assert.strictEqual(rules.evaluate({ family_id: CUBIC, a: 2, b: 1, c: 4 }, 5), 0, 'a cubic crosses zero at b + c');
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
assert.strictEqual(rules.describe({ family_id: CUBIC, a: 2, b: 1, c: 4 }), 'y = 0.125(x + 3)(x − 1)(x − 5)');
assert.strictEqual(rules.describe({ family_id: CUBIC, a: -16, b: 0, c: 4 }), 'y = −(x + 4)x(x − 4)');
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

// Judging a drawing. A drawing is a list of strokes, each a list of [x, y] pen positions.
// This turns a curve into a single stroke that follows it exactly, moved sideways and up if asked.
function traced(values, across = 0, up = 0) {
  const stroke = [];
  values.forEach((value, column) => {
    if (value !== null) stroke.push([rules.inputFor(column) + across, value + up]);
  });
  return [stroke.filter(([x, y]) => Math.abs(x) <= 10 && Math.abs(y) <= 10)];
}

const perfect = rules.judge(traced(curve), steep);
assert.strictEqual(perfect.accuracy, 100);
assert.strictEqual(perfect.solved, true);

// A steep line drawn 0.4 to one side is over a unit out straight up and down,
// but only a little way from the real line, so it must still score well.
const sideways = rules.judge(traced(curve, 0.4), steep);
assert.ok(sideways.accuracy >= 85, `a steep line drawn just to one side scores ${sideways.accuracy}`);
assert.ok(!sideways.missed.includes(true), 'the curve is not missed when the drawing is right beside it');

// A gentle line drawn one unit too high really is about one unit away.
const gentle = { family_id: LINE, a: 1, b: 0, c: 0 };
const raised = rules.judge(traced(rules.visibleCurve(gentle), 0, 1), gentle);
assert.ok(raised.levels[0].includes(1) && !raised.levels[0].includes(0), 'one unit off is level 1, not spot on');
assert.ok(raised.accuracy >= 70 && raised.accuracy <= 80, `one unit off scores about 75, got ${raised.accuracy}`);

// A flat line across the top is nowhere near.
const flat = rules.judge([[[-10, 9], [10, 9]]], steep);
assert.ok(flat.accuracy < 25, `a flat line across the top scores badly, got ${flat.accuracy}`);
assert.ok(flat.missed.includes(true), 'most of the curve is missed');

// Nudges point from a badly-off line towards the curve, and say nothing about how far.
// A real drawing has a pen position every little way, so this builds a flat line like that.
function flatLine(height) {
  const stroke = [];
  for (let x = -10; x <= 10; x += 0.1) stroke.push([Math.round(x * 10) / 10, height]);
  return [stroke];
}
const high = rules.judge(flatLine(9), gentle);
assert.ok(high.nudges.length > 3, 'a line that is way off gets several nudges');
assert.ok(high.nudges.every((nudge) => Math.abs(Math.hypot(nudge.across, nudge.up) - 1) < 0.02), 'every nudge is the same length');
assert.ok(high.nudges.every((nudge) => nudge.up < 0), 'a line far above the curve is nudged downwards');
const below = rules.judge(flatLine(-9), gentle);
assert.ok(below.nudges.every((nudge) => nudge.up > 0), 'a line far below the curve is nudged upwards');
assert.strictEqual(perfect.nudges.length, 0, 'a line on the curve gets no nudges');
assert.strictEqual(raised.nudges.length, 0, 'a line that is only a little off gets no nudges');

// Starter dots are on the curve: three for easy, two for medium, one for hard.
for (const slot of [1, 2, 3]) {
  const machine = { ...rules.makeMachine('2026-11-13', slot), slot };
  const dots = rules.starterDots(machine);
  assert.strictEqual(dots.length, 4 - slot);
  dots.forEach(([x, y]) => {
    assert.ok(Math.abs(rules.evaluate(machine, x) - y) < 0.01, 'each dot sits on the curve');
  });
}

// Drawings do not have to be functions: a vertical line and a loop are both accepted and marked.
const vertical = rules.judge([[[0, -9], [0, 9]]], steep);
assert.ok(vertical.accuracy > flat.accuracy, 'a vertical line through a steep curve beats a flat one');
const loop = [[[3, 0], [0, 3], [-3, 0], [0, -3], [3, 0]]];
assert.strictEqual(rules.validDrawing(loop), true);
assert.strictEqual(rules.judge(loop, steep).levels[0].length, 5);

// Scribbling over everything covers the curve but most of the ink is wasted, so it scores badly.
const scribble = [];
for (let y = -9; y <= 9; y += 1) scribble.push([[-10, y], [10, y]]);
assert.strictEqual(rules.validDrawing(scribble), false, 'too many strokes are refused');
const zigzag = [[]];
for (let x = -10; x <= 10; x += 0.5) zigzag[0].push([x, (x * 2) % 2 === 0 ? -9 : 9]);
assert.ok(rules.judge(zigzag, steep).accuracy < 60, 'a zigzag over the whole graph does not pass');

// Drawings that are the wrong shape are refused.
assert.strictEqual(rules.validDrawing([]), false);
assert.strictEqual(rules.validDrawing([[[0, 0]]]), false, 'a stroke needs at least two positions');
assert.strictEqual(rules.validDrawing([[[0, 0], [1, 99]]]), false, 'positions must be on the graph');
assert.strictEqual(rules.validDrawing([[[0, 0], ['1', 1]]]), false, 'positions must be numbers');
assert.strictEqual(rules.validDrawing('nope'), false);

assert.strictEqual(rules.pieces(steep), 1);
assert.strictEqual(rules.pieces(hyperbola), 2, 'a hyperbola is in two pieces');
assert.strictEqual(rules.pieces({ family_id: EXPONENTIAL, a: 1, b: 1, c: 0 }), 1, 'a flat asymptote does not split a curve');

assert.strictEqual(rules.starsFor(true, 1), 3);
assert.strictEqual(rules.starsFor(true, 4), 2);
assert.strictEqual(rules.starsFor(true, 5), 1);
assert.strictEqual(rules.starsFor(false, 5), 0);

// A year of curves: three a day, easy to hard, valid numbers, enough on screen, same every time.
const seen = new Set();
for (let day = 0; day < 365; day += 1) {
  const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
  for (const slot of [1, 2, 3]) {
    const machine = rules.makeMachine(date, slot);
    const visible = rules.visibleCurve(machine).filter((output) => output !== null).length;

    assert.deepStrictEqual(rules.makeMachine(date, slot), machine);
    assert.ok(machine.a !== 0 && Math.abs(machine.a) <= 9 && Math.abs(machine.b) <= 9 && Math.abs(machine.c) <= 9);
    assert.ok(visible >= COLUMNS * 0.3, `enough of the curve is visible on ${date}`);
    assert.ok(!rules.describe(machine).includes('NaN') && !rules.describe(machine).includes('undefined'));
    seen.add(machine.family_id);
  }
  assert.ok([LINE, PARABOLA, V_SHAPE].includes(rules.makeMachine(date, 1).family_id), 'slot 1 is an easy family');
  assert.ok([HYPERBOLA, SLANTED].includes(rules.makeMachine(date, 3).family_id), 'slot 3 is a hard family');
}
assert.strictEqual(seen.size, 9, 'every family turns up during the year');

console.log('All rule checks passed.');
