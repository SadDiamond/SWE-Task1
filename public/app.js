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

function starsText(stars) {
  return '★'.repeat(stars) + '☆'.repeat(3 - stars);
}

async function start() {
  const game = await request('/api/today');
  const graph = find('#graph');

  // Everything about one of the day's curves, so switching tabs loses nothing.
  // A stroke is a list of [x, y] pen positions, and a go is made of one or more strokes.
  const rounds = game.curves.map((curve) => ({
    ...curve,
    strokes: [],        // the strokes of the go in progress
    shown: null,        // the last go once marked: { strokes, levels }
    ghost: null,        // the go before that
    missed: [],
    dots: [],           // hint dots the player has asked for
    goes: 0,
    result: null        // the server's final reply once the round is over
  }));
  let round = rounds[0];

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

  /* The three tabs and everything that depends on which curve is chosen */

  function showTabs() {
    const tabs = find('#tabs');
    tabs.replaceChildren();
    rounds.forEach((item) => {
      const button = element('button', undefined, 'tab');
      button.type = 'button';
      button.append(
        element('span', `${item.slot}. ${SLOT_NAMES[item.slot]}`),
        element('span', item.result ? starsText(item.result.stars) : '· · ·', 'tab-stars')
      );
      button.setAttribute('aria-pressed', String(item === round));
      button.addEventListener('click', () => chooseRound(item));
      tabs.append(button);
    });

    const earned = rounds.reduce((total, item) => total + (item.result ? item.result.stars : 0), 0);
    const date = new Date(`${game.date}T00:00`);
    const dateText = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
    find('#machine-details').textContent = `${dateText} · ${earned} of ${rounds.length * 3} stars`;
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
      : `A hint shows one spot on the curve and costs a star. ${hintsLeft} left.`;
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
        ? `Cracked it in ${goesText(round.goes)} with ${result.accuracy}%`
        : `Out of goes. Your last one scored ${result.accuracy}%`;
      find('#result-stars').textContent = starsText(result.stars);
      find('#result-stars').setAttribute('aria-label', `${result.stars} out of 3 stars`);
      find('#result-family').textContent = result.familyName;
      find('#result-formula').textContent = result.formula;

      const unfinished = rounds.find((item) => !item.result);
      find('#next-curve').hidden = !unfinished;
      find('#day-done').hidden = Boolean(unfinished);
    }
    showTabs();
    showGraph();
  }

  function chooseRound(item) {
    if (waiting) return;
    // A half-drawn go is dropped when leaving a curve.
    round.strokes = [];
    round = item;
    clearTimeout(percentTimer);
    percent = null;
    message('');
    showRound();
  }

  find('#next-curve').addEventListener('click', () => {
    chooseRound(rounds.find((item) => !item.result));
    find('#tabs').scrollIntoView({ block: 'nearest' });
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

    stroke.push(rounded(position));
    strokeLength += moved;
    showGraphSoon();
  }

  // Called when the pen is lifted. Once enough strokes are down, the go is sent to be marked.
  async function endStroke() {
    // A stroke the pen barely moved in is treated as a stray tap and undone.
    if (strokeLength < game.shortestStroke) {
      round.strokes.pop();
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
    waiting = false;
    showRound();
  }

  /* Drawing with a mouse, finger or stylus */

  let drawing = false;
  graph.addEventListener('pointerdown', (event) => {
    pen.visible = false;
    drawing = startStroke(graphPosition(graph, event, game.limit));
    if (drawing) graph.setPointerCapture(event.pointerId);
  });
  graph.addEventListener('pointermove', (event) => {
    if (drawing) extendStroke(graphPosition(graph, event, game.limit));
  });
  function liftPointer() {
    if (!drawing) return;
    drawing = false;
    endStroke();
  }
  graph.addEventListener('pointerup', liftPointer);
  graph.addEventListener('pointercancel', liftPointer);

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

  showRound();
}

start().catch((error) => message(error.message));
