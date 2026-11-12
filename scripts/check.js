// Self-check for the machine rules. Run with: npm test
const assert = require('node:assert');
const {
  CURVE, LINE, REMAINDER, accuracy, allOutputs, describe, evaluate, finalScore, makeMachine, sameRule, starsFor
} = require('../src/rules');

const line = { family_id: LINE, a: 3, b: -2, c: 0 };
assert.strictEqual(evaluate(line, 0), -2);
assert.strictEqual(evaluate(line, 4), 10);
assert.strictEqual(evaluate(line, -5), -17);

const curve = { family_id: CURVE, a: 1, b: -2, c: 5 };
assert.strictEqual(evaluate(curve, 0), 5);
assert.strictEqual(evaluate(curve, 3), 8);
assert.strictEqual(evaluate(curve, -3), 20);

const remainder = { family_id: REMAINDER, a: 2, b: 1, c: 5 };
assert.strictEqual(evaluate(remainder, 0), 1);
assert.strictEqual(evaluate(remainder, 4), 4);
assert.strictEqual(evaluate(remainder, -1), 4, 'remainders are never negative');

// The same rule written two ways should match; different rules should not.
assert.strictEqual(sameRule(remainder, { family_id: REMAINDER, a: 7, b: 6, c: 5 }), true);
assert.strictEqual(sameRule(line, { family_id: CURVE, a: 0, b: 3, c: -2 }), true);
assert.strictEqual(sameRule(line, { family_id: LINE, a: 3, b: -1, c: 0 }), false);

// Scoring a drawing.
const truth = allOutputs(line);
assert.strictEqual(truth.length, 41);
assert.strictEqual(accuracy(truth, truth), 100, 'a perfect drawing scores 100');
assert.strictEqual(accuracy(truth.map(() => 9999), truth), 0, 'a drawing nowhere near scores 0');
const slightlyOff = accuracy(truth.map((value) => value + 3), truth);
assert.ok(slightlyOff > 70 && slightlyOff < 100, 'a close drawing scores high but not full marks');

assert.strictEqual(finalScore(90, true, 4), 106);
assert.strictEqual(finalScore(90, false, 10), 90);
assert.strictEqual(starsFor(106), 3);
assert.strictEqual(starsFor(85), 2);
assert.strictEqual(starsFor(60), 1);
assert.strictEqual(starsFor(59), 0);

assert.strictEqual(describe(line), 'y = 3x − 2');
assert.strictEqual(describe(curve), 'y = x² − 2x + 5');
assert.strictEqual(describe({ family_id: CURVE, a: -1, b: 0, c: 4 }), 'y = −x² + 4');
assert.strictEqual(describe(remainder), 'y = remainder of (2x + 1) ÷ 5');

// A year of machines: each is valid and the same date always gives the same machine.
for (let day = 0; day < 365; day += 1) {
  const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
  const machine = makeMachine(date);

  assert.deepStrictEqual(makeMachine(date), machine);
  assert.ok(machine.a !== 0 && machine.a >= -9 && machine.a <= 9, `a is in range on ${date}`);
  assert.ok(machine.b >= -20 && machine.b <= 20, `b is in range on ${date}`);
  assert.ok(machine.c >= -20 && machine.c <= 20, `c is in range on ${date}`);
  assert.ok(machine.difficulty >= 1 && machine.difficulty <= 3);
  const outputs = [evaluate(machine, 0), evaluate(machine, 1), evaluate(machine, 2)];
  assert.ok(new Set(outputs).size > 1, `the machine on ${date} must not give the same output for everything`);
}

console.log('All rule checks passed.');
