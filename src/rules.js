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
// Nudges appear on parts of a drawing at this level or worse, one for every so many units of line.
const NUDGE_FROM_LEVEL = 3;
const NUDGE_SPACING = 1.5;
// The pen gets the curve's length times this much ink, and never less than SMALLEST_INK,
// which is enough for one line right across the graph and a bit more.
const INK_TO_SPARE = 1.5;
const SMALLEST_INK = 30;
// How much of the graph's width a curve must be visible across before it is used.
const SHARE_ON_SCREEN = 0.5;
// The most pen positions one go may contain, so a request cannot be made enormous.
const MOST_POINTS = 3000;
const DAYS_OF_HISTORY = 30;

const LINE = 1;
const PARABOLA = 2;
const V_SHAPE = 3;
const CUBIC = 4;
const WAVE = 5;
const CUBE_ROOT = 6;
const EXPONENTIAL = 7;
const HYPERBOLA = 8;
const SLANTED = 9;

// The input for a column number: column 0 is -10, column 100 is 0, column 200 is 10.
function inputFor(column) {
  return column / STEPS_PER_UNIT - LIMIT;
}

// Works out one part of a curve for an input. Gives null where that part does not exist.
// a, b and c are whole numbers; the divisions turn them into gentle slopes like 0.5 or 0.25.
function partValue(familyId, a, b, c, x) {
  switch (familyId) {
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
    case CUBE_ROOT:
      return a * Math.cbrt(x - b) + c;
    case EXPONENTIAL:
      return a * 2 ** (x / b) + c;
    case HYPERBOLA:
      return x === b ? null : a / (x - b) + c;
    default:
      // Slanted hyperbola
      return x === b ? null : (c / 2) * x + a / (x - b);
  }
}

// Works out the curve's output for an input. Gives null where the curve does not exist.
// A curve is one kind on its own, or a mix: a main part with a second, gentler part added on.
function evaluate(machine, x) {
  const main = partValue(machine.family_id, machine.a, machine.b, machine.c, x);
  if (main === null || !machine.extra_family_id) return main;

  const extra = partValue(machine.extra_family_id, machine.extra_a, machine.extra_b, machine.extra_c, x);
  return extra === null ? null : main + extra;
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

// The spot on the straight piece of line from (x1, y1) to (x2, y2) that is closest to the point (x, y).
function closestOnPiece(x, y, x1, y1, x2, y2) {
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  // How far along the piece the closest spot is: 0 at the start, 1 at the end.
  let along = lengthSquared === 0 ? 0 : ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSquared;
  along = Math.max(0, Math.min(1, along));
  return { x: x1 + along * (x2 - x1), y: y1 + along * (y2 - y1) };
}

function distanceToPiece(x, y, x1, y1, x2, y2) {
  const spot = closestOnPiece(x, y, x1, y1, x2, y2);
  return Math.hypot(x - spot.x, y - spot.y);
}

// Finds the spot on the real curve closest to a point, measured in any direction.
// Measuring straight up and down would be unfair on steep curves, where being a little
// to one side looks like a huge error.
// curve is a list with one output for each column. Gives { distance, x, y }.
function nearestOnCurve(x, y, curve) {
  const nearest = Math.round((x + LIMIT) * STEPS_PER_UNIT);
  const first = Math.max(0, nearest - REACH);
  const last = Math.min(COLUMNS - 1, nearest + REACH);
  let best = { distance: Infinity, x: null, y: null };

  for (let column = first; column <= last; column += 1) {
    const here = curve[column];
    if (here === null) continue;
    const next = column < last ? curve[column + 1] : null;
    const joined = next !== null && Math.abs(next - here) <= BIGGEST_STEP;

    const spot = joined
      ? closestOnPiece(x, y, inputFor(column), here, inputFor(column + 1), next)
      : { x: inputFor(column), y: here };
    const distance = Math.hypot(x - spot.x, y - spot.y);
    if (distance < best.distance) best = { distance, ...spot };
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
  // Nudges are small arrows on the badly-off parts of the line, pointing towards the curve.
  const nudges = [];
  let sinceNudge = NUDGE_SPACING / 2;

  const levels = strokes.map((stroke) => stroke.map(([x, y], index) => {
    const spot = nearestOnCurve(x, y, whole);
    const level = levelFor(spot.distance);
    if (index > 0) {
      const [previousX, previousY] = stroke[index - 1];
      const length = Math.hypot(x - previousX, y - previousY);
      inkLength += length;
      inkOnCurve += length * (1 - level / BANDS.length);
      sinceNudge += length;
    }
    // One nudge for every stretch of line, and only where the line is well off.
    // It gives the direction to the curve but always has the same length, so not the distance.
    if (level >= NUDGE_FROM_LEVEL && sinceNudge >= NUDGE_SPACING && spot.distance < Infinity) {
      nudges.push({
        x,
        y,
        across: Math.round(((spot.x - x) / spot.distance) * 100) / 100,
        up: Math.round(((spot.y - y) / spot.distance) * 100) / 100
      });
      sinceNudge = 0;
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
  return { levels, nudges, missed, accuracy, solved: accuracy >= SOLVED_AT };
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

// How many hints a player can ask for on one curve. Each one costs points.
const MAX_HINTS = 3;

// The hint dots for a curve: spots that are on it, spread evenly along the visible part.
// They are only handed out one at a time, when the player asks for a hint.
function hintDots(machine) {
  const visible = [];
  visibleCurve(machine).forEach((output, column) => {
    if (output !== null) visible.push([Math.round(inputFor(column) * 10) / 10, output]);
  });

  const dots = [];
  for (let index = 1; index <= MAX_HINTS; index += 1) {
    dots.push(visible[Math.floor((visible.length * index) / (MAX_HINTS + 1))]);
  }
  // The middle dot is given first, because it is the most useful on its own.
  return [dots[1], dots[0], dots[2]];
}

// How much ink the pen has for one go on this curve, in graph units of line.
// It is the length of the visible curve with some to spare, so the curve can be drawn in full
// but the whole graph cannot be scribbled over to make the colours give the answer away.
function inkFor(machine) {
  const visible = visibleCurve(machine);
  let length = 0;
  for (let column = 1; column < COLUMNS; column += 1) {
    const here = visible[column];
    const before = visible[column - 1];
    if (here !== null && before !== null && Math.abs(here - before) <= BIGGEST_STEP) {
      length += Math.hypot(1 / STEPS_PER_UNIT, here - before);
    }
  }
  return Math.round(Math.max(SMALLEST_INK, length * INK_TO_SPARE));
}

// The total length of line in a drawing.
function inkUsed(strokes) {
  let length = 0;
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      length += Math.hypot(stroke[index][0] - stroke[index - 1][0], stroke[index][1] - stroke[index - 1][1]);
    }
  }
  return length;
}

// How many separate pieces the curve is in: one more than its vertical asymptotes.
// The player gets this many strokes in each go.
function pieces(machine) {
  return 1 + asymptotes(machine).filter((line) => line.kind === 'vertical').length;
}

// Every curve is scored out of 1000.
const TOP_SCORE = 1000;
// Points lost for each go after the first, and for each hint used.
const GO_PENALTY = 100;
const HINT_PENALTY = 150;

// The score for a finished curve. Accuracy sets the starting amount (100% is 1000),
// then extra goes and hints take points away. It never drops below zero.
function scoreFor(accuracy, goes, hints) {
  const score = accuracy * (TOP_SCORE / 100) - GO_PENALTY * (goes - 1) - HINT_PENALTY * hints;
  return Math.max(0, Math.round(score));
}

/* Writing the formula out in LaTeX */

// The largest whole number that divides both a and b.
function commonFactor(a, b) {
  return b === 0 ? Math.abs(a) : commonFactor(b, a % b);
}

// A multiplier in front of something, written as a fraction in its simplest form.
// 1 disappears, -1 becomes just a minus sign, and 6 over 4 becomes \frac{3}{2}.
function multiplier(top, bottom) {
  const factor = commonFactor(top, bottom);
  const sign = top < 0 ? '-' : '';
  const above = Math.abs(top) / factor;
  const below = bottom / factor;

  if (below === 1) return above === 1 ? sign : `${sign}${above}`;
  return `${sign}\\frac{${above}}{${below}}`;
}

// "x - 2", "x + 3" or just "x".
function shifted(amount) {
  if (amount === 0) return 'x';
  return amount > 0 ? `x - ${amount}` : `x + ${-amount}`;
}

// " + 3", " - 3" or nothing, for the end of a formula.
function plus(number) {
  if (number === 0) return '';
  return number > 0 ? ` + ${number}` : ` - ${-number}`;
}

function bracket(amount) {
  return amount === 0 ? 'x' : `(${shifted(amount)})`;
}

// One part of a curve written in LaTeX, without the "y =" in front.
function expression(familyId, a, b, c) {
  switch (familyId) {
    case LINE:
      return `${multiplier(a, 2)}x${plus(b)}`;
    case PARABOLA:
      return `${multiplier(a, 4)}${bracket(b)}^2${plus(c)}`;
    case V_SHAPE:
      return `${multiplier(a, 2)}\\left|${shifted(b)}\\right|${plus(c)}`;
    case CUBIC:
      return `${multiplier(a, 16)}${bracket(b - c)}${bracket(b)}${bracket(b + c)}`;
    case WAVE:
      return `${multiplier(a, 1)}\\sin\\left(\\frac{\\pi x}{${b}}\\right)${plus(c)}`;
    case CUBE_ROOT:
      return `${multiplier(a, 1)}\\sqrt[3]{${shifted(b)}}${plus(c)}`;
    case EXPONENTIAL: {
      // The power is x divided by b: 2^x, 2^{-x}, 2^{\frac{x}{3}} or 2^{-\frac{x}{3}}.
      const size = Math.abs(b) === 1 ? 'x' : `\\frac{x}{${Math.abs(b)}}`;
      const power = `2^{${b < 0 ? '-' : ''}${size}}`;
      const front = Math.abs(a) === 1 ? multiplier(a, 1) : `${a} \\times `;
      return `${front}${power}${plus(c)}`;
    }
    case HYPERBOLA:
      return `${a < 0 ? '-' : ''}\\frac{${Math.abs(a)}}{${shifted(b)}}${plus(c)}`;
    default:
      // Slanted hyperbola
      return `${multiplier(c, 2)}x ${a > 0 ? '+' : '-'} \\frac{${Math.abs(a)}}{${shifted(b)}}`;
  }
}

// The whole formula in LaTeX, e.g. "y = \frac{1}{2}x + 2\sin\left(\frac{\pi x}{3}\right)".
function describe(machine) {
  const main = expression(machine.family_id, machine.a, machine.b, machine.c);
  if (!machine.extra_family_id) return `y = ${main}`;

  const extra = expression(machine.extra_family_id, machine.extra_a, machine.extra_b, machine.extra_c);
  // A second part that starts with a minus sign is taken away instead of added.
  return extra.startsWith('-') ? `y = ${main} - ${extra.slice(1)}` : `y = ${main} + ${extra}`;
}

// The lines a curve gets close to but never touches. Shown only when the answer is revealed.
function asymptotes(machine) {
  const { b, c } = machine;
  const lines = [];
  const hugsVertical = machine.family_id === HYPERBOLA || machine.family_id === SLANTED;
  if (hugsVertical) lines.push({ kind: 'vertical', input: b });

  // The other line a hyperbola or exponential settles towards. A straight line added on tilts it.
  // With any other second part the curve no longer settles towards a straight line, so none is drawn.
  let tilt = 0;
  if (machine.extra_family_id === LINE) tilt = machine.extra_a / 2;
  else if (machine.extra_family_id) return lines;

  if (machine.family_id === HYPERBOLA || machine.family_id === EXPONENTIAL) {
    lines.push({ kind: 'sloped', slope: tilt, start: c });
  }
  if (machine.family_id === SLANTED) {
    lines.push({ kind: 'sloped', slope: c / 2 + tilt, start: 0 });
  }
  return lines;
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
    case CUBE_ROOT:
      return { a: nonZero(-3, 3), b: between(-5, 5), c: between(-5, 5) };
    case EXPONENTIAL:
      return { a: nonZero(-3, 3), b: nonZero(-3, 3), c: between(-6, 6) };
    case HYPERBOLA:
      return { a: nonZero(-6, 6), b: between(-5, 5), c: between(-5, 5) };
    default:
      return { a: pick([-6, -4, -2, 2, 4, 6]), b: between(-4, 4), c: pick([-2, -1, 1, 2]) };
  }
}

// The recipes for each of the day's three curves: easy, medium and hard.
// A recipe is a main kind on its own, or a main kind with a second kind added to it.
const RECIPES_FOR_SLOT = {
  1: [[LINE], [PARABOLA], [V_SHAPE]],
  2: [[CUBIC], [WAVE], [CUBE_ROOT], [EXPONENTIAL],
    [LINE, WAVE], [PARABOLA, WAVE], [V_SHAPE, LINE], [CUBE_ROOT, LINE]],
  3: [[HYPERBOLA], [SLANTED],
    [HYPERBOLA, PARABOLA], [HYPERBOLA, WAVE], [HYPERBOLA, V_SHAPE], [CUBIC, WAVE], [EXPONENTIAL, LINE]]
};

// Picks the numbers for a second part. They are kept small so the main shape still shows through,
// and the part has no number added on the end, which keeps the formula tidy.
function randomExtra(next, familyId) {
  const between = (low, high) => low + next(high - low + 1);
  const pick = (choices) => choices[next(choices.length)];

  switch (familyId) {
    case LINE:
      return { extra_a: pick([-3, -2, -1, 1, 2, 3]), extra_b: 0, extra_c: 0 };
    case WAVE:
      return { extra_a: between(1, 2), extra_b: between(2, 4), extra_c: 0 };
    case PARABOLA:
      return { extra_a: pick([-1, 1]), extra_b: between(-3, 3), extra_c: 0 };
    default:
      // V shape
      return { extra_a: pick([-2, -1, 1, 2]), extra_b: between(-3, 3), extra_c: 0 };
  }
}

// Builds one of the three curves for a date. slot is 1 (easy), 2 (medium) or 3 (hard).
function makeMachine(date, slot) {
  const next = numberMaker(dayNumber(date) * 7919 + slot * 104729);
  const recipes = RECIPES_FOR_SLOT[slot];
  const [familyId, extraFamilyId] = recipes[next(recipes.length)];

  // Keep trying until the curve crosses at least half the width of the graph.
  // A curve that only shows in one corner is confusing, because most of the graph is empty.
  let machine;
  let onScreen = 0;
  while (onScreen < COLUMNS * SHARE_ON_SCREEN) {
    machine = {
      family_id: familyId,
      ...randomMachine(next, familyId),
      extra_family_id: null,
      extra_a: null,
      extra_b: null,
      extra_c: null
    };
    if (extraFamilyId) {
      machine = { ...machine, extra_family_id: extraFamilyId, ...randomExtra(next, extraFamilyId) };
    }
    onScreen = visibleCurve(machine).filter((output) => output !== null).length;
  }
  return machine;
}

// The SQL that reads curves with the names of their kinds. extra_name is empty for a single kind.
const MACHINE_SELECT = `
  SELECT machines.*, families.name AS family_name, families.difficulty, extras.name AS extra_name
  FROM machines
  INNER JOIN families ON families.id = machines.family_id
  LEFT JOIN families AS extras ON extras.id = machines.extra_family_id
`;

// The name shown for a curve's kind, e.g. "Hyperbola" or "Straight line + wave".
function kindName(machine) {
  return machine.extra_name
    ? `${machine.family_name} + ${machine.extra_name.toLowerCase()}`
    : machine.family_name;
}

// Finds the three curves for a date, creating and saving them the first time they are asked for.
async function machinesFor(date) {
  for (const slot of [1, 2, 3]) {
    const made = makeMachine(date, slot);
    await run(
      `INSERT OR IGNORE INTO machines
         (play_date, slot, family_id, a, b, c, extra_family_id, extra_a, extra_b, extra_c)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, slot, made.family_id, made.a, made.b, made.c,
        made.extra_family_id, made.extra_a, made.extra_b, made.extra_c]
    );
  }
  return all(`${MACHINE_SELECT} WHERE machines.play_date = ? ORDER BY machines.slot`, [date]);
}

// Makes sure the last month of curves exists, so there are past days to play.
async function fillHistory() {
  const today = dayNumber(todayDate());
  for (let day = today - DAYS_OF_HISTORY; day <= today; day += 1) {
    await machinesFor(new Date(day * 86400000).toISOString().slice(0, 10));
  }
}

module.exports = {
  COLUMNS, GO_PENALTY, HINT_PENALTY, MACHINE_SELECT, LIMIT, MAX_GOES, MAX_HINTS, MOST_POINTS, TOP_SCORE, SHORTEST_STROKE, STEPS_PER_UNIT,
  LINE, PARABOLA, V_SHAPE, CUBIC, WAVE, CUBE_ROOT, EXPONENTIAL, HYPERBOLA, SLANTED,
  asymptotes, describe, evaluate, exits, fillHistory, inputFor, judge, machinesFor, makeMachine,
  hintDots, inkFor, inkUsed, kindName, pieces, scoreFor, todayDate, validDrawing, visibleCurve, wholeCurve
};
