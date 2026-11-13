function find(selector) {
  return document.querySelector(selector);
}

function message(text) {
  find('#form-status').textContent = text;
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

// Makes an element holding a formula. The server sends the formula as MathML, which it built
// from the curve's own numbers, so it is safe to put straight into the page.
function mathNode(markup) {
  const holder = document.createElement('span');
  holder.className = 'math';
  holder.innerHTML = markup;
  return holder;
}

// "1 go" or "3 goes".
function goesText(count) {
  return count === 1 ? '1 go' : `${count} goes`;
}

// Fetches JSON from the server and turns a failed request into a readable error.
async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (_error) {
    throw new Error('You are offline. This needs a connection to the server.');
  }

  const isJson = (response.headers.get('Content-Type') || '').includes('application/json');
  const data = isJson ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || 'The request could not be completed.');
  return data;
}

function send(url, body) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const SLOT_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
// A new pen position is only kept once the pen has moved this far (in graph units),
// which keeps a drawing to a sensible size however slowly it is drawn.
const PEN_SPACING = 0.05;

// A pen position as [x, y], rounded to two decimal places.
// More decimals than that cannot be seen and only make the drawing bigger to send.
function rounded(position) {
  return [Math.round(position.x * 100) / 100, Math.round(position.y * 100) / 100];
}

// Who is logged in, or null for a guest. Set once when the page loads.
let currentUser = null;

async function todayPage() {
  const game = await request('/api/today');
  const graph = find('#graph');

  // Everything about one of the day's curves, so switching tabs loses nothing.
  // A stroke is a list of [x, y] pen positions, and a go is made of one or more strokes.
  // For a logged-in player, curve.saved holds what they have already done today.
  const rounds = game.curves.map((curve) => {
    const saved = curve.saved;
    return {
      ...curve,
      strokes: [],                                    // the strokes of the go in progress
      inkSpent: 0,                                    // how much line has been drawn in the go in progress
      shown: saved && saved.last ? saved.last : null, // the last go once marked: { strokes, levels, nudges }
      ghost: null,                                    // the go before that
      missed: saved && saved.last ? saved.last.missed : [],
      dots: saved ? saved.dots : [],                  // hint dots the player has asked for
      goes: saved ? saved.goes : 0,
      history: [],                                    // every drawing sent for marking, in order
      result: saved ? saved.result : null             // the server's final reply once the round is over
    };
  });
  // Carry on with the first curve that is not finished yet.
  let round = rounds.find((item) => !item.result) || rounds[rounds.length - 1];

  // How far the pen has travelled in the stroke being drawn, in graph units.
  let strokeLength = 0;
  // The marked goes on screen before the stroke began, in case it has to be undone.
  let beforeMarks = null;
  let percent = null;
  // True while waiting for the server to mark a go.
  let waiting = false;
  // The keyboard pen. Only shown while the graph is selected with the keyboard.
  const pen = { x: 0, y: 0, down: false, visible: false };

  function showGraph() {
    drawGraph(graph, {
      strokes: round.strokes,
      shown: round.shown,
      // At the end only the last go is kept on screen, behind the real curve.
      ghost: round.result ? null : round.ghost,
      percent,
      missed: round.missed,
      exits: round.exits,
      dots: round.dots,
      curve: round.result ? round.result.curve : null,
      asymptotes: round.result ? round.result.asymptotes : [],
      pen: pen.visible && !round.result ? pen : null
    }, game.limit);
  }

  // The ink meter: how much of this go's ink is left.
  function showInk() {
    const left = Math.max(0, Math.round((1 - round.inkSpent / round.ink) * 100));
    find('#ink-level').style.width = `${left}%`;
    find('.ink-bar').setAttribute('aria-valuenow', left);
    find('#ink').hidden = Boolean(round.result);
  }

  // Redraws on the next screen refresh. Pointer events arrive faster than the screen updates,
  // so this stops the graph being rebuilt more often than anyone could see.
  let drawQueued = false;
  function showGraphSoon() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      showGraph();
    });
  }

  // Shows the score over the graph, then takes it away again after a moment.
  let percentTimer = null;
  function flashPercent(value) {
    percent = value;
    clearTimeout(percentTimer);
    percentTimer = setTimeout(() => {
      percent = null;
      showGraph();
    }, 1800);
  }

  /* Progress through the day's three curves, and the score */

  // Counts a number up on screen from one value to another, over about a second.
  // People who have asked their device for less motion get the final number straight away.
  function countUp(target, from, to) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || from === to) {
      target.textContent = to;
      return;
    }
    const length = 900;
    const began = performance.now();
    function step(now) {
      const done = Math.min(1, (now - began) / length);
      // Easing: quick at first, slowing as it reaches the final number.
      const eased = 1 - (1 - done) ** 3;
      target.textContent = Math.round(from + (to - from) * eased);
      if (done < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function totalScore() {
    return rounds.reduce((total, item) => total + (item.result ? item.result.score : 0), 0);
  }

  // The total in the header. It is remembered so the next change can count up from it.
  let totalOnScreen = 0;
  function showTotal() {
    countUp(find('#total'), totalOnScreen, totalScore());
    totalOnScreen = totalScore();
  }

  // The three curves are played in order. This shows which are done, which is being played
  // and which are still locked. It is a list, not buttons: the player cannot skip ahead.
  // True while the end screen is showing. It has been seen once this is ever set.
  let summaryOpen = false;
  let summarySeen = false;

  function showProgress() {
    const list = find('#tabs');
    const allDone = rounds.every((item) => item.result);
    list.replaceChildren();

    rounds.forEach((item) => {
      let state = 'locked';
      let note = 'Locked';
      if (item.result) {
        state = 'done';
        note = `${item.result.score}`;
      } else if (item === round) {
        state = 'current';
        note = 'Now';
      }
      const label = [element('span', `${item.slot}. ${SLOT_NAMES[item.slot]}`), element('span', note, 'tab-score')];
      const step = element('li', undefined, `tab ${state}`);

      // Once the whole run is finished, each step becomes a button for looking back at that curve.
      if (allDone) {
        const button = element('button', undefined, 'tab-button');
        button.type = 'button';
        button.append(...label);
        button.setAttribute('aria-label', `Look back at the ${SLOT_NAMES[item.slot].toLowerCase()} curve`);
        button.addEventListener('click', () => lookBack(item));
        if (!summaryOpen && item === round) step.classList.add('viewing');
        step.append(button);
      } else {
        step.append(...label);
        if (state === 'current') step.setAttribute('aria-current', 'step');
      }
      list.append(step);
    });
  }

  // Shows a finished curve again: the real curve, the last go and the score.
  function lookBack(item) {
    round = item;
    summaryOpen = false;
    find('.layout').classList.remove('ended');
    find('#summary').hidden = true;
    message('');
    showRound();
  }

  function showRound() {
    const dots = find('#goes');
    dots.replaceChildren();
    for (let index = 0; index < game.maxGoes; index += 1) {
      dots.append(element('span', undefined, index < round.goes ? 'go used' : 'go'));
    }
    find('#goes-text').textContent = `${goesText(game.maxGoes - round.goes)} left`;

    const hintsLeft = game.maxHints - round.dots.length;
    find('#hint').disabled = hintsLeft === 0;
    find('#hint-text').textContent = hintsLeft === 0
      ? 'No hints left for this curve.'
      : `A hint shows one spot on the curve and costs ${game.hintPenalty} points. ${hintsLeft} left.`;
    find('#hint-text').hidden = Boolean(round.result);

    find('#stroke-info').textContent = round.strokesPerGo === 1
      ? 'One stroke per go. Lift your pen and it is marked.'
      : `This curve is in ${round.strokesPerGo} pieces, so each go is ${round.strokesPerGo} strokes.`;
    find('#stroke-info').hidden = Boolean(round.result);
    find('.under-graph').hidden = Boolean(round.result);
    graph.classList.toggle('finished', Boolean(round.result));

    find('#result').hidden = !round.result;
    if (round.result) {
      const result = round.result;
      find('#result-heading').textContent = result.solved
        ? `Cracked it in ${goesText(round.goes)}`
        : 'Out of goes';
      find('#result-top').textContent = `/ ${game.topScore}`;
      // The score counts up from zero. The total in the header climbs too, further down.
      countUp(find('#result-score'), 0, result.score);

      // How the score was reached, one line for each thing that changed it.
      const extraGoes = round.goes - 1;
      const lines = [`${result.accuracy}% accurate: ${result.accuracy * (game.topScore / 100)}`];
      if (extraGoes > 0) lines.push(`${goesText(extraGoes).replace('go', 'extra go')}: −${extraGoes * game.goPenalty}`);
      if (round.dots.length > 0) {
        lines.push(`${round.dots.length === 1 ? '1 hint' : `${round.dots.length} hints`}: −${round.dots.length * game.hintPenalty}`);
      }
      find('#result-working').replaceChildren(...lines.map((line) => element('li', line)));
      find('#result-family').textContent = result.familyName;
      find('#result-formula').replaceChildren(mathNode(result.formulaMath));

      const more = rounds.some((item) => !item.result);
      let nextLabel = 'Next curve';
      if (!more) nextLabel = summarySeen ? "Back to today's result" : "See today's result";
      find('#next-curve').textContent = nextLabel;
    }
    showProgress();
    showTotal();
    showInk();
    showGraph();
  }

  /* The end screen */

  function showSummary() {
    const rows = find('#summary-rows');
    rows.replaceChildren();
    rounds.forEach((item, index) => {
      const row = document.createElement('li');
      // Each row arrives a little after the one before it.
      row.style.setProperty('--order', index);
      const detail = `${item.result.familyName} · ${goesText(item.goes)}`
        + (item.dots.length > 0 ? ` · ${item.dots.length === 1 ? '1 hint' : `${item.dots.length} hints`}` : '');
      row.append(
        element('span', SLOT_NAMES[item.slot], 'summary-name'),
        element('span', detail, 'summary-detail'),
        element('span', item.result.score, 'summary-score')
      );
      rows.append(row);
    });

    // A guest is offered the chance to keep this score. Their run is put aside in the browser
    // so it can be sent to the server once they have logged in.
    find('#save-prompt').hidden = Boolean(currentUser);
    if (!currentUser) {
      localStorage.setItem(PENDING_RUN, JSON.stringify({
        date: game.date,
        curves: rounds.map((item) => ({ id: item.id, hints: item.dots.length, goes: item.history }))
      }));
    }

    summaryOpen = true;
    summarySeen = true;
    showProgress();
    find('.layout').classList.add('ended');
    find('#summary').hidden = false;
    countUp(find('#summary-total'), 0, totalScore());
    find('#summary-heading').focus();
  }

  find('#next-curve').addEventListener('click', () => {
    const next = rounds.find((item) => !item.result);
    if (!next) return showSummary();

    round = next;
    clearTimeout(percentTimer);
    percent = null;
    message('');
    showRound();
    find('#tabs').scrollIntoView({ block: 'nearest' });
  });

  find('#copy-result').addEventListener('click', async () => {
    const date = new Date(`${game.date}T00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long' });
    const scores = rounds.map((item) => `${SLOT_NAMES[item.slot]} ${item.result.score}`).join(' · ');
    const text = `Placeholder, ${date}\n${scores}\nTotal ${totalScore()}`;
    try {
      await navigator.clipboard.writeText(text);
      find('#copy-status').textContent = 'Copied.';
    } catch (_error) {
      find('#copy-status').textContent = text;
    }
  });

  find('#hint').addEventListener('click', async () => {
    if (waiting || round.result) return;
    const asking = round;
    try {
      const hint = await send(`/api/machines/${asking.id}/hint`, { number: asking.dots.length + 1 });
      asking.dots.push(hint.dot);
      showRound();
    } catch (error) {
      message(error.message);
    }
  });

  /* Strokes */

  function startStroke(position) {
    if (round.result || waiting) return false;
    beforeMarks = { shown: round.shown, ghost: round.ghost, missed: round.missed };
    // The first stroke of a new go pushes the last marked go into the background.
    if (round.strokes.length === 0 && round.shown) {
      round.ghost = round.shown;
      round.shown = null;
      round.missed = [];
    }
    clearTimeout(percentTimer);
    percent = null;
    strokeLength = 0;
    round.strokes.push([rounded(position)]);
    message('');
    showGraph();
    return true;
  }

  // Adds a pen position to the stroke being drawn.
  function extendStroke(position) {
    const stroke = round.strokes[round.strokes.length - 1];
    const [lastX, lastY] = stroke[stroke.length - 1];
    const moved = Math.hypot(position.x - lastX, position.y - lastY);
    if (moved < PEN_SPACING) return;
    // The server refuses drawings with too many positions, so the pen stops adding them at the limit.
    const points = round.strokes.reduce((total, item) => total + item.length, 0);
    if (points >= game.mostPoints) return;
    // When the ink for this go has run out, the pen stops leaving a line.
    if (round.inkSpent + moved > round.ink) {
      return message('Out of ink for this go. Lift your pen to have it marked.');
    }

    stroke.push(rounded(position));
    strokeLength += moved;
    round.inkSpent += moved;
    showInk();
    showGraphSoon();
  }

  // Called when the pen is lifted. Once enough strokes are down, the go is sent to be marked.
  async function endStroke() {
    // A stroke the pen barely moved in is treated as a stray tap and undone.
    if (strokeLength < game.shortestStroke) {
      round.strokes.pop();
      round.inkSpent -= strokeLength;
      showInk();
      round.shown = beforeMarks.shown;
      round.ghost = beforeMarks.ghost;
      round.missed = beforeMarks.missed;
      showGraph();
      return message('That was too short to count. Draw a longer line.');
    }
    if (round.strokes.length < round.strokesPerGo) {
      showGraph();
      return message(`Piece ${round.strokes.length} of ${round.strokesPerGo} drawn. Now draw the next piece.`);
    }

    waiting = true;
    const marking = round;
    try {
      const result = await send(`/api/machines/${marking.id}/go`, {
        drawing: marking.strokes, go: marking.goes + 1, hints: marking.dots.length
      });
      marking.goes += 1;
      marking.history.push(marking.strokes);
      marking.shown = { strokes: marking.strokes, levels: result.levels, nudges: result.nudges };
      marking.missed = result.missed;
      if (result.finished) {
        marking.result = result;
        message('');
      } else {
        flashPercent(result.accuracy);
        message(`${result.accuracy}%. Trace the green parts and fix the rest.`);
      }
    } catch (error) {
      message(error.message);
    }
    // Whether it worked or not, the next go starts from a clean drawing.
    marking.strokes = [];
    marking.inkSpent = 0;
    waiting = false;
    showRound();
  }

  /* Drawing with a mouse, finger or stylus */

  let drawing = false;
  graph.addEventListener('pointerdown', (event) => {
    // Only the main button draws. A right-click opens a menu, and the page never hears that
    // button being released, which would leave the pen stuck down.
    if (event.button !== 0 || drawing) return;
    pen.visible = false;
    drawing = startStroke(graphPosition(graph, event, game.limit));
    // Capturing the pointer keeps the stroke going if the pen slides off the edge of the graph.
    if (drawing) graph.setPointerCapture(event.pointerId);
  });
  graph.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    // If no button is held any more, the release was missed (for example it happened outside
    // the browser window), so the stroke ends here instead of carrying on by itself.
    if (event.buttons === 0) return liftPointer();
    extendStroke(graphPosition(graph, event, game.limit));
  });
  function liftPointer() {
    if (!drawing) return;
    drawing = false;
    endStroke();
  }
  // A stroke can end in several ways, and every one of them must lift the pen:
  // releasing on the graph or anywhere else on the page, the browser cancelling the touch,
  // the graph losing hold of the pointer, or the player switching to another window.
  graph.addEventListener('pointerup', liftPointer);
  graph.addEventListener('pointercancel', liftPointer);
  graph.addEventListener('lostpointercapture', liftPointer);
  window.addEventListener('pointerup', liftPointer);
  window.addEventListener('blur', liftPointer);
  // Stops the right-click menu opening over the graph in the middle of a game.
  graph.addEventListener('contextmenu', (event) => event.preventDefault());

  /* Drawing with the keyboard */

  graph.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, 0.2], ArrowDown: [0, -0.2] };

    if (event.key === ' ') {
      event.preventDefault();
      if (pen.down) {
        pen.down = false;
        endStroke();
      } else if (startStroke(pen)) {
        pen.down = true;
        message('Pen down. Move with the arrow keys, then press Space to lift it.');
      }
    }
    if (moves[event.key]) {
      event.preventDefault();
      pen.x = Math.max(-game.limit, Math.min(game.limit, pen.x + moves[event.key][0]));
      pen.y = Math.max(-game.limit, Math.min(game.limit, pen.y + moves[event.key][1]));
      if (pen.down) extendStroke(pen);
    }
    pen.visible = true;
    showGraph();
  });
  graph.addEventListener('blur', () => {
    pen.visible = false;
    showGraph();
  });

  // The graph is drawn at its real size, so it needs redrawing when the window changes.
  window.addEventListener('resize', showGraph);

  const date = new Date(`${game.date}T00:00`);
  find('#today-date').textContent = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  showRound();
  // If all three were finished on an earlier visit, go straight to the end screen.
  if (rounds.every((item) => item.result)) showSummary();
}

/* The history page */

const STATUS_NAMES = { solved: 'Cracked', failed: 'Out of goes' };

// Writes a date such as 2026-11-13 as "13 Nov 2026".
function shortDate(date) {
  return new Date(`${date}T00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Adds a row to a table. The first value becomes the row heading, and numbers line up on the right.
function addRow(body, values) {
  const row = document.createElement('tr');
  values.forEach((value, index) => {
    const cell = document.createElement(index === 0 ? 'th' : 'td');
    if (index === 0) cell.scope = 'row';
    if (typeof value === 'number') cell.className = 'number';
    // append accepts plain text, numbers and ready-made elements alike.
    cell.append(value);
    row.append(cell);
  });
  body.append(row);
}

// Shows the page's content to a logged-in player, or a note asking a guest to log in.
function membersOnly() {
  find('#guest').hidden = Boolean(currentUser);
  find('#content').hidden = !currentUser;
  return Boolean(currentUser);
}

// The "Curve" cell of the history table: the kind's name, then its formula.
function curveCell(row) {
  const cell = document.createElement('span');
  cell.append(`${row.familyName}: `, mathNode(row.formulaMath));
  return cell;
}

async function historyPage() {
  if (!membersOnly()) return;
  const form = find('#filters');

  const families = await request('/api/families');
  families.forEach((family) => find('#family').add(new Option(family.name, family.id)));

  // Asks the server for the list again whenever a filter or the order changes.
  async function load() {
    const choices = new URLSearchParams(new FormData(form));
    const rows = await request(`/api/history?${choices}`);

    const body = find('#history-rows');
    body.replaceChildren();
    rows.forEach((row) => {
      addRow(body, [
        shortDate(row.date),
        SLOT_NAMES[row.slot],
        curveCell(row),
        STATUS_NAMES[row.status],
        row.goes,
        row.hints,
        row.score
      ]);
    });
    find('#count').textContent = rows.length === 0
      ? 'Nothing matches. Finish a curve, or loosen the filters.'
      : `${rows.length} ${rows.length === 1 ? 'curve' : 'curves'}`;
  }

  form.addEventListener('change', () => load().catch((error) => message(error.message)));
  await load();
}

/* The stats page */

async function statsPage() {
  if (!membersOnly()) return;
  const stats = await request('/api/stats');
  const totals = stats.totals;
  const days = (count) => (count === 1 ? '1 day' : `${count} days`);

  find('#stat-points').textContent = totals.points;
  find('#stat-days').textContent = totals.days;
  find('#stat-streak').textContent = days(stats.streak.current);
  find('#stat-best-streak').textContent = days(stats.streak.best);
  find('#stat-cracked').textContent = `${totals.cracked} of ${totals.played}`;
  find('#stat-average').textContent = totals.average_score ?? '–';
  find('#stat-goes').textContent = totals.average_goes ?? '–';
  find('#stat-best-day').textContent = stats.bestDay
    ? `${stats.bestDay.points} on ${shortDate(stats.bestDay.date)}`
    : '–';

  stats.byDifficulty.forEach((row) => {
    addRow(find('#difficulty-rows'), [SLOT_NAMES[row.slot], row.played, row.cracked, row.average_score, row.average_goes]);
  });
  stats.byFamily.forEach((row) => {
    addRow(find('#family-rows'), [row.name, row.played, row.cracked, row.average_score, row.best_score]);
  });
}

/* The account page */

// Sends a form to the server and shows the error if it is refused.
function onSubmit(form, action) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await action(Object.fromEntries(new FormData(form)));
    } catch (error) {
      message(error.message);
    }
  });
}

async function accountPage() {
  find('#logged-out').hidden = Boolean(currentUser);
  find('#logged-in').hidden = !currentUser;

  onSubmit(find('#login-form'), async (fields) => {
    await send('/api/login', fields);
    location.href = '/';
  });
  onSubmit(find('#signup-form'), async (fields) => {
    await send('/api/signup', fields);
    location.href = '/';
  });
  if (!currentUser) return;

  find('#account-name').textContent = currentUser.display_name;
  find('#account-username').textContent = currentUser.username;
  // The database stores times in UTC, so "Z" is added before turning it into a local date.
  find('#account-created').textContent = new Date(`${currentUser.created_at.replace(' ', 'T')}Z`)
    .toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  find('#logout-button').addEventListener('click', async () => {
    await request('/api/logout', { method: 'POST' });
    location.href = '/';
  });
}

/* Saving a guest's run after they log in */

// The name the finished run is kept under in the browser's storage.
const PENDING_RUN = 'pendingRun';

// If this browser holds a guest run from today, it is sent to the server go by go.
// The server marks and scores every drawing itself, exactly as if the player had been logged in.
async function savePendingRun() {
  const stored = localStorage.getItem(PENDING_RUN);
  if (!stored) return;
  localStorage.removeItem(PENDING_RUN);

  const run = JSON.parse(stored);
  const today = await request('/api/today');
  // An old run, or an account that has already played today, is left alone.
  if (run.date !== today.date || today.curves.some((curve) => curve.saved)) return;

  for (const curve of run.curves) {
    for (let hint = 0; hint < curve.hints; hint += 1) {
      await send(`/api/machines/${curve.id}/hint`, {});
    }
    for (const drawing of curve.goes) {
      await send(`/api/machines/${curve.id}/go`, { drawing });
    }
  }
}

/* Starting the right page */

const pages = { today: todayPage, account: accountPage, history: historyPage, stats: statsPage };

async function start() {
  const me = await request('/api/me');
  currentUser = me.user;
  if (currentUser) {
    find('#account-link').textContent = currentUser.display_name;
    await savePendingRun();
  }
  await pages[document.body.dataset.page]();
}

start().catch((error) => message(error.message));
