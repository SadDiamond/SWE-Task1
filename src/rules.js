const { all, run } = require('./db');

// The graph window: inputs and outputs both run from -10 to 10.
const LIMIT = 10;
// The curve is checked at every 0.1 across the window: -10.0, -9.9 ... 10.0.
const STEPS_PER_UNIT = 10;
const COLUMNS = 2 * LIMIT * STEPS_PER_UNIT + 1;

const MAX_GOES = 5;
// A drawing this accurate (as a percentage) counts as solved.
const SOLVED_AT = 85;
// How far off a drawn point can be for each level of closeness.
// Level 0 is within 0.5 (spot on), level 1 within 1, and so on. Anything further is level 4.
const BANDS = [0.5, 1, 1.5, 2.5];
// The pen must travel at least this far (in graph units) for a stroke to count,
// so a stray tap does not use up a go.
const SHORTEST_STROKE = 1.5;
// The real curve is treated as broken where it jumps more than this between neighbouring columns.
const BIGGEST_STEP = 6;
// How many columns either side to look when measuring how far a point is from the curve.
const REACH = 30;
// The most pen positions one go may contain, so a request cannot be made enormous.
const MOST_POINTS = 3000;
const DAYS_OF_HISTORY = 30;

const LINE = 1;
const PARABOLA = 2;
const V_SHAPE = 3;
const CUBIC = 4;
const WAVE = 5;
const ROOT = 6;
const EXPONENTIAL = 7;
const HYPERBOLA = 8;
const SLANTED = 9;

// The input for a column number: column 0 is -10, column 100 is 0, column 200 is 10.
function inputFor(column) {
  return column / STEPS_PER_UNIT - LIMIT;
}

// Works out the curve's output for an input. Gives null where the curve does not exist.
function evaluate(machine, x) {
  const { a, b, c } = machine;

  switch (machine.family_id) {
    case LINE:
      return (a / 2) * x + b;
    case PARABOLA:
      return (a / 4) * (x - b) ** 2 + c;
    case V_SHAPE:
      return (a / 2) * Math.abs(x - b) + c;
    case CUBIC:
      // Written with its three crossing points (b - c, b and b + c) so it always has a clear hill and dip.
      return (a / 16) * (x - b + c) * (x - b) * (x - b - c);
    case WAVE:
      return a * Math.sin((Math.PI * x) / b) + c;
    case ROOT:
      return x < b ? null : a * Math.sqrt(x - b) + c;
    case EXPONENTIAL:
      return a * 2 ** (x / b) + c;
    case HYPERBOLA:
      return x === b ? null : a / (x - b) + c;
    default:
      // Slanted hyperbola
      return x === b ? null : (c / 2) * x + a / (x - b);
  }
}

// The curve as a list with one output for each column.
// A column is null where the curve does not exist or is off the top or bottom of the graph.
function visibleCurve(machine) {
  const curve = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    const output = evaluate(machine, inputFor(column));
    const onScreen = output !== null && Math.abs(output) <= LIMIT;
    curve.push(onScreen ? Math.round(output * 100) / 100 : null);
  }
  return curve;
}

// The places where the curve leaves or comes back onto the graph, through the top or the bottom.
function exits(machine) {
  const found = [];
  let before = null;

  for (let column = 0; column < COLUMNS; column += 1) {
    const output = evaluate(machine, inputFor(column));
    let now = 'on';
    if (output === null) now = 'none';
    else if (output > LIMIT) now = 'top';
    else if (output < -LIMIT) now = 'bottom';

    // An exit is a step between "on the graph" and "off the top or bottom".
    const offEdge = now === 'on' ? before : now;
    const crossed = before !== null && now !== before && (now === 'on' || before === 'on');
    if (crossed && (offEdge === 'top' || offEdge === 'bottom')) {
      found.push({ input: Math.round(inputFor(column) * 10) / 10, side: offEdge });
    }
    before = now;
  }
  return found;
}

// The curve as a list with one output for each column, including parts that are off the
// top or bottom of the graph. Null only where the curve does not exist.
function wholeCurve(machine) {
  const curve = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    curve.push(evaluate(machine, inputFor(column)));
  }
  return curve;
}

// The shortest distance from the point (x, y) to the straight piece of line from (x1, y1) to (x2, y2).
function distanceToPiece(x, y, x1, y1, x2, y2) {
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  // How far along the piece the closest spot is: 0 at the start, 1 at the end.
  let along = lengthSquared === 0 ? 0 : ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSquared;
  along = Math.max(0, Math.min(1, along));
  return Math.hypot(x - (x1 + along * (x2 - x1)), y - (y1 + along * (y2 - y1)));
}

// The shortest distance from a point to the real curve, measured in any direction.
// Measuring straight up and down would be unfair on steep curves, where being a little
// to one side looks like a huge error.
// curve is a list with one output for each column.
function distanceToCurve(x, y, curve) {
  const nearest = Math.round((x + LIMIT) * STEPS_PER_UNIT);
  const first = Math.max(0, nearest - REACH);
  const last = Math.min(COLUMNS - 1, nearest + REACH);
  let best = Infinity;

  for (let column = first; column <= last; column += 1) {
    const here = curve[column];
    if (here === null) continue;
    const next = column < last ? curve[column + 1] : null;
    const joined = next !== null && Math.abs(next - here) <= BIGGEST_STEP;

    best = Math.min(best, joined
      ? distanceToPiece(x, y, inputFor(column), here, inputFor(column + 1), next)
      : Math.hypot(x - inputFor(column), y - here));
  }
  return best;
}

// The shortest distance from a point to anything the player drew.
// strokes is a list of strokes, and each stroke is a list of [x, y] pen positions.
function distanceToDrawing(x, y, strokes) {
  let best = Infinity;
  for (const stroke of strokes) {
    for (let index = 0; index < stroke.length - 1; index += 1) {
      const [x1, y1] = stroke[index];
      const [x2, y2] = stroke[index + 1];
      best = Math.min(best, distanceToPiece(x, y, x1, y1, x2, y2));
    }
  }
  return best;
}

// Turns a distance into a level: 0 (spot on) up to 4 (way off).
function levelFor(distance) {
  // Rounded so that tiny decimal errors do not push a point into the next band.
  const rounded = Math.round(distance * 100) / 100;
  const level = BANDS.findIndex((band) => rounded <= band);
  return level === -1 ? BANDS.length : level;
}

// Marks a drawing against the real curve.
// The drawing can be any shape: loops, vertical lines and doubling back are all allowed.
// Half the score is how much of the drawn line lies on the curve.
// The other half is how much of the visible curve the drawing covers.
// levels: for each stroke, a level from 0 to 4 for each pen position.
// missed: for each column, true where the curve is on the graph but the drawing is nowhere near.
function judge(strokes, machine) {
  const whole = wholeCurve(machine);
  const visible = visibleCurve(machine);

  // Part one: the drawing. Each piece of line counts by its length, so drawing slowly
  // (which makes more pen positions) is worth no more than drawing quickly.
  let inkLength = 0;
  let inkOnCurve = 0;
  const levels = strokes.map((stroke) => stroke.map(([x, y], index) => {
    const level = levelFor(distanceToCurve(x, y, whole));
    if (index > 0) {
      const [previousX, previousY] = stroke[index - 1];
      const length = Math.hypot(x - previousX, y - previousY);
      inkLength += length;
      inkOnCurve += length * (1 - level / BANDS.length);
    }
    return level;
  }));

  // Part two: the curve. Every visible column is checked to see how near the drawing comes.
  let curvePoints = 0;
  let curveCovered = 0;
  const missed = visible.map((output, column) => {
    if (output === null) return false;
    const level = levelFor(distanceToDrawing(inputFor(column), output, strokes));
    curvePoints += 1;
    curveCovered += 1 - level / BANDS.length;
    return level === BANDS.length;
  });

  const precision = inkLength === 0 ? 0 : inkOnCurve / inkLength;
  const coverage = curvePoints === 0 ? 0 : curveCovered / curvePoints;
  const accuracy = Math.round(((precision + coverage) / 2) * 100);
  return { levels, missed, accuracy, solved: accuracy >= SOLVED_AT };
}

// Checks that a drawing sent by the browser is the right shape before it is marked:
// a list of strokes, each a list of [x, y] pairs that are numbers inside the graph.
function validDrawing(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0 || strokes.length > 10) return false;

  let points = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) return false;
    points += stroke.length;
    for (const point of stroke) {
      const isPair = Array.isArray(point) && point.length === 2
        && point.every((value) => typeof value === 'number' && Math.abs(value) <= LIMIT);
      if (!isPair) return false;
    }
  }
  return points <= MOST_POINTS;
}

// How many separate pieces the curve is in: one more than its vertical asymptotes.
// The player gets this many strokes in each go.
function pieces(machine) {
  return 1 + asymptotes(machine).filter((line) => line.kind === 'vertical').length;
}

// Stars for a finished round: fewer goes is better, and unsolved gets none.
function starsFor(solved, goes) {
  if (!solved) return 0;
  if (goes <= 2) return 3;
  if (goes <= 4) return 2;
  return 1;
}

/* Writing the formula out */

// Turns -0.5 into "−0.5" and drops pointless decimals.
function text(number) {
  return String(Math.round(number * 10000) / 10000).replace('-', '−');
}

// A multiplier in front of something: 1 disappears, -1 becomes just a minus sign.
function times(number) {
  if (number === 1) return '';
  if (number === -1) return '−';
  return text(number);
}

// "x − 2", "x + 3" or just "x".
function shifted(amount) {
  if (amount === 0) return 'x';
  return amount > 0 ? `x − ${amount}` : `x + ${-amount}`;
}

// " + 3", " − 3" or nothing, for the end of a formula.
function plus(number) {
  if (number === 0) return '';
  return number > 0 ? ` + ${text(number)}` : ` − ${text(-number)}`;
}

function bracket(amount) {
  return amount === 0 ? 'x' : `(${shifted(amount)})`;
}

function describe(machine) {
  const { a, b, c } = machine;

  switch (machine.family_id) {
    case LINE:
      return `y = ${times(a / 2)}x${plus(b)}`;
    case PARABOLA:
      return `y = ${times(a / 4)}${bracket(b)}²${plus(c)}`;
    case V_SHAPE:
      return `y = ${times(a / 2)}|${shifted(b)}|${plus(c)}`;
    case CUBIC:
      return `y = ${times(a / 16)}${bracket(b - c)}${bracket(b)}${bracket(b + c)}`;
    case WAVE:
      return `y = ${a === 1 ? '' : `${a} `}sin(πx ÷ ${b})${plus(c)}`;
    case ROOT:
      return `y = ${times(a)}√(${shifted(b)})${plus(c)}`;
    case EXPONENTIAL: {
      let power = `2^(x ÷ ${text(b)})`;
      if (b === 1) power = '2^x';
      if (b === -1) power = '2^(−x)';
      const front = Math.abs(a) === 1 ? times(a) : `${text(a)} × `;
      return `y = ${front}${power}${plus(c)}`;
    }
    case HYPERBOLA:
      return `y = ${text(a)} ÷ ${bracket(b)}${plus(c)}`;
    default:
      return `y = ${times(c / 2)}x ${a > 0 ? '+' : '−'} ${Math.abs(a)} ÷ ${bracket(b)}`;
  }
}

// The lines a curve gets close to but never touches. Shown only when the answer is revealed.
function asymptotes(machine) {
  const { b, c } = machine;
  if (machine.family_id === HYPERBOLA) {
    return [{ kind: 'vertical', input: b }, { kind: 'sloped', slope: 0, start: c }];
  }
  if (machine.family_id === SLANTED) {
    return [{ kind: 'vertical', input: b }, { kind: 'sloped', slope: c / 2, start: 0 }];
  }
  if (machine.family_id === EXPONENTIAL) {
    return [{ kind: 'sloped', slope: 0, start: c }];
  }
  return [];
}

/* Making each day's curve */

// Gives the same "random" numbers every time for the same seed,
// so a date always produces the same curve.
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

// Picks the numbers for one curve of the given family.
function randomMachine(next, familyId) {
  // between(-3, 3) gives a whole number from -3 to 3. nonZero never gives 0.
  const between = (low, high) => low + next(high - low + 1);
  const nonZero = (low, high) => {
    let value = 0;
    while (value === 0) value = between(low, high);
    return value;
  };
  const pick = (choices) => choices[next(choices.length)];

  switch (familyId) {
    case LINE:
      return { a: nonZero(-6, 6), b: between(-6, 6), c: 0 };
    case PARABOLA:
      return { a: pick([-4, -2, -1, 1, 2, 4]), b: between(-5, 5), c: between(-8, 8) };
    case V_SHAPE:
      return { a: nonZero(-4, 4), b: between(-5, 5), c: between(-6, 6) };
    case CUBIC:
      return { a: nonZero(-3, 3), b: between(-3, 3), c: pick([4, 5]) };
    case WAVE:
      return { a: between(1, 5), b: between(2, 5), c: between(-4, 4) };
    case ROOT:
      return { a: nonZero(-3, 3), b: between(-9, 0), c: between(-6, 6) };
    case EXPONENTIAL:
      return { a: nonZero(-3, 3), b: nonZero(-3, 3), c: between(-6, 6) };
    case HYPERBOLA:
      return { a: nonZero(-6, 6), b: between(-5, 5), c: between(-5, 5) };
    default:
      return { a: pick([-6, -4, -2, 2, 4, 6]), b: between(-4, 4), c: pick([-2, -1, 1, 2]) };
  }
}

// Which families belong to each of the day's three curves: easy, medium and hard.
const FAMILIES_FOR_SLOT = {
  1: [LINE, PARABOLA, V_SHAPE],
  2: [CUBIC, WAVE, ROOT, EXPONENTIAL],
  3: [HYPERBOLA, SLANTED]
};

// Builds one of the three curves for a date. slot is 1 (easy), 2 (medium) or 3 (hard).
function makeMachine(date, slot) {
  const next = numberMaker(dayNumber(date) * 7919 + slot * 104729);
  const choices = FAMILIES_FOR_SLOT[slot];
  const familyId = choices[next(choices.length)];

  // Keep trying until a good part of the curve is actually on the graph.
  let machine;
  let onScreen = 0;
  while (onScreen < COLUMNS * 0.3) {
    machine = { family_id: familyId, ...randomMachine(next, familyId) };
    onScreen = visibleCurve(machine).filter((output) => output !== null).length;
  }
  return machine;
}

// Finds the three curves for a date, creating and saving them the first time they are asked for.
async function machinesFor(date) {
  for (const slot of [1, 2, 3]) {
    const made = makeMachine(date, slot);
    await run(
      'INSERT OR IGNORE INTO machines (play_date, slot, family_id, a, b, c) VALUES (?, ?, ?, ?, ?, ?)',
      [date, slot, made.family_id, made.a, made.b, made.c]
    );
  }
  return all(`
    SELECT machines.*, families.name AS family_name, families.difficulty
    FROM machines
    INNER JOIN families ON families.id = machines.family_id
    WHERE machines.play_date = ?
    ORDER BY machines.slot
  `, [date]);
}

// Makes sure the last month of curves exists, so there are past days to play.
async function fillHistory() {
  const today = dayNumber(todayDate());
  for (let day = today - DAYS_OF_HISTORY; day <= today; day += 1) {
    await machinesFor(new Date(day * 86400000).toISOString().slice(0, 10));
  }
}

module.exports = {
  COLUMNS, LIMIT, MAX_GOES, MOST_POINTS, SHORTEST_STROKE, STEPS_PER_UNIT,
  LINE, PARABOLA, V_SHAPE, CUBIC, WAVE, ROOT, EXPONENTIAL, HYPERBOLA, SLANTED,
  asymptotes, describe, evaluate, exits, fillHistory, inputFor, judge, machinesFor, makeMachine,
  pieces, starsFor, todayDate, validDrawing, visibleCurve, wholeCurve
};
