const { all, run } = require('./db');

const LINE = 1;
const CURVE = 2;
const REMAINDER = 3;

// Inputs a player is allowed to test, and the range used to compare two rules.
const MIN_INPUT = -20;
const MAX_INPUT = 20;
const DAYS_OF_HISTORY = 30;
// How many tests a player gets on one machine.
const MAX_TESTS = 10;

// Works out what a machine gives back for an input.
function evaluate(machine, x) {
  if (machine.family_id === LINE) {
    return machine.a * x + machine.b;
  }
  if (machine.family_id === CURVE) {
    return machine.a * x * x + machine.b * x + machine.c;
  }
  // Remainder: the extra "+ c) % c" keeps the answer positive when the input is negative.
  const value = machine.a * x + machine.b;
  return ((value % machine.c) + machine.c) % machine.c;
}

// Two rules count as the same if they agree on every input a player could test.
// This means a guess written a different way is still accepted.
function sameRule(first, second) {
  for (let x = MIN_INPUT; x <= MAX_INPUT; x += 1) {
    if (evaluate(first, x) !== evaluate(second, x)) return false;
  }
  return true;
}

// Every output the machine gives, from the smallest allowed input to the largest.
function allOutputs(machine) {
  const outputs = [];
  for (let x = MIN_INPUT; x <= MAX_INPUT; x += 1) {
    outputs.push(evaluate(machine, x));
  }
  return outputs;
}

// How close a drawing is to the real outputs, as a percentage.
// drawing and truth are lists with one number for each input.
// A point scores full marks when exact and nothing once it is 15% of the graph's height away.
function accuracy(drawing, truth) {
  const height = Math.max(10, Math.max(...truth) - Math.min(...truth));
  const tolerance = height * 0.15;
  let total = 0;

  truth.forEach((output, index) => {
    const error = Math.abs(drawing[index] - output);
    total += Math.max(0, 1 - error / tolerance);
  });
  return Math.round((total / truth.length) * 100);
}

// Final score: accuracy, plus 10 for naming the right type, plus 1 for every test not used.
function finalScore(accuracyPercent, typeCorrect, testsUsed) {
  return accuracyPercent + (typeCorrect ? 10 : 0) + (MAX_TESTS - testsUsed);
}

function starsFor(score) {
  if (score >= 100) return 3;
  if (score >= 80) return 2;
  if (score >= 60) return 1;
  return 0;
}

// Writes "+ 3" or "− 3" for the end of a formula, or nothing for zero.
function signed(number, letter = '') {
  if (number === 0) return '';
  return ` ${number < 0 ? '−' : '+'} ${Math.abs(number)}${letter}`;
}

// The machine's rule written out, e.g. "y = 3x − 2".
function describe(machine) {
  const lead = (number, letters) => {
    if (number === 1) return letters;
    if (number === -1) return `−${letters}`;
    return `${String(number).replace('-', '−')}${letters}`;
  };

  if (machine.family_id === LINE) {
    return `y = ${lead(machine.a, 'x')}${signed(machine.b)}`;
  }
  if (machine.family_id === CURVE) {
    return `y = ${lead(machine.a, 'x²')}${signed(machine.b, 'x')}${signed(machine.c)}`;
  }
  return `y = remainder of (${lead(machine.a, 'x')}${signed(machine.b)}) ÷ ${machine.c}`;
}

// Gives the same "random" numbers every time for the same seed,
// so a date always produces the same machine.
function numberMaker(seed) {
  let value = seed;
  return (limit) => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return Math.floor((value / 2147483648) * limit);
  };
}

function dayNumber(date) {
  return Math.floor(Date.parse(date) / 86400000);
}

function todayDate() {
  return new Date().toLocaleDateString('en-CA');
}

// A whole number from low to high, never zero.
function nonZero(next, low, high) {
  let value = 0;
  while (value === 0) value = low + next(high - low + 1);
  return value;
}

// Builds the machine for a date. Difficulty decides the family and how big the numbers are.
function makeMachine(date) {
  const next = numberMaker(dayNumber(date) * 7919);
  const difficulty = 1 + next(3);

  if (difficulty === 1) {
    return { family_id: LINE, a: 1 + next(5), b: next(21) - 10, c: 0, difficulty };
  }
  if (difficulty === 2 && next(2) === 0) {
    return { family_id: LINE, a: nonZero(next, -9, 9), b: next(41) - 20, c: 0, difficulty };
  }
  if (difficulty === 2) {
    return { family_id: CURVE, a: 1, b: next(7) - 3, c: next(21) - 10, difficulty };
  }
  if (next(2) === 0) {
    return { family_id: CURVE, a: nonZero(next, -3, 3), b: next(19) - 9, c: next(41) - 20, difficulty };
  }

  // Remainder: a must not be a multiple of c, or every output would be the same.
  const c = 3 + next(7);
  const a = 1 + next(c - 1);
  return { family_id: REMAINDER, a, b: next(c), c, difficulty };
}

// Finds the machine for a date, creating and saving it the first time it is asked for.
async function machineFor(date) {
  const made = makeMachine(date);
  await run(
    `INSERT OR IGNORE INTO machines (play_date, family_id, a, b, c, difficulty)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [date, made.family_id, made.a, made.b, made.c, made.difficulty]
  );
  const machines = await all('SELECT * FROM machines WHERE play_date = ?', [date]);
  return machines[0];
}

// Makes sure the last month of machines exists, so there are past days to play.
async function fillHistory() {
  const today = dayNumber(todayDate());
  for (let day = today - DAYS_OF_HISTORY; day <= today; day += 1) {
    await machineFor(new Date(day * 86400000).toISOString().slice(0, 10));
  }
}

module.exports = {
  CURVE, LINE, MAX_INPUT, MAX_TESTS, MIN_INPUT, REMAINDER,
  accuracy, allOutputs, describe, evaluate, fillHistory, finalScore, machineFor, makeMachine, sameRule, starsFor, todayDate
};
