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
  evaluate, fillHistory, machineFor, makeMachine, sameRule, todayDate
};
