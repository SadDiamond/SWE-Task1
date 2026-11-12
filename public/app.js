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

async function start() {
  const game = await request('/api/today');
  const graph = find('#graph');
  const blank = () => new Array(game.columns).fill(null);

  // The strokes of the go in progress: one output for each column, null where nothing is drawn.
  let drawing = blank();
  // What the drawing looked like before the current stroke, in case the stroke is too short to count.
  let beforeStroke = blank();
  // The first and last column the current stroke has touched.
  let strokeSpan = null;
  let strokesDone = 0;

  // The last go once it has been marked: { drawing, levels }. The go before it is the ghost.
  let shown = null;
  let ghost = null;
  let percent = null;
  let missed = [];
  let exits = [];
  // The answer, once the round is over.
  let curve = null;
  let asymptotes = [];
  let goes = 0;
  // True while waiting for the server to mark a go.
  let waiting = false;
  // The keyboard pen. Only shown while the graph is selected with the keyboard.
  const pen = { column: (game.columns - 1) / 2, output: 0, down: false, visible: false };

  function showGraph() {
    drawGraph(graph, {
      drawing, shown, ghost, percent, missed, exits, curve, asymptotes, pen: pen.visible && !curve ? pen : null
    }, game.limit);
  }

  function showGoes() {
    const dots = find('#goes');
    dots.replaceChildren();
    for (let index = 0; index < game.maxGoes; index += 1) {
      dots.append(element('span', undefined, index < goes ? 'go used' : 'go'));
    }
    find('#goes-text').textContent = `${goesText(game.maxGoes - goes)} left`;
  }

  /* Strokes */

  function startStroke() {
    if (curve || waiting) return false;
    // The first stroke of a new go pushes the last marked go into the background.
    if (strokesDone === 0 && shown) {
      ghost = shown;
      shown = null;
      percent = null;
      missed = [];
    }
    beforeStroke = [...drawing];
    strokeSpan = null;
    message('');
    return true;
  }

  // Draws between two positions on the graph.
  // Every column between them gets a value, so a fast drag leaves no holes.
  function drawBetween(from, to) {
    const first = Math.max(0, Math.round(Math.min(from.column, to.column)));
    const last = Math.min(game.columns - 1, Math.round(Math.max(from.column, to.column)));

    for (let column = first; column <= last; column += 1) {
      // How far this column is along the drag, from 0 at "from" to 1 at "to".
      const along = to.column === from.column ? 1 : (column - from.column) / (to.column - from.column);
      const output = from.output + (to.output - from.output) * Math.min(1, Math.max(0, along));
      const onGraph = Math.max(-game.limit, Math.min(game.limit, output));
      drawing[column] = Math.round(onGraph * 100) / 100;
    }
    if (first <= last) {
      strokeSpan = strokeSpan
        ? { first: Math.min(strokeSpan.first, first), last: Math.max(strokeSpan.last, last) }
        : { first, last };
    }
    showGraph();
  }

  // Called when the pen is lifted. Once enough strokes are down, the go is sent to be marked.
  async function endStroke() {
    const length = strokeSpan ? strokeSpan.last - strokeSpan.first : 0;
    if (length < game.shortestStroke) {
      drawing = beforeStroke;
      showGraph();
      return message('That was too short to count. Draw a longer line.');
    }

    strokesDone += 1;
    if (strokesDone < game.strokes) {
      return message(`Piece ${strokesDone} of ${game.strokes} drawn. Now draw the next piece.`);
    }

    waiting = true;
    try {
      const result = await send(`/api/machines/${game.id}/go`, { drawing, go: goes + 1 });
      goes += 1;
      shown = { drawing, levels: result.levels };
      percent = result.accuracy;
      missed = result.missed;
      exits = result.exits;
      showGoes();
      if (result.finished) {
        showResult(result);
      } else {
        message(`${result.accuracy}%. Trace the green parts and fix the rest.`);
      }
    } catch (error) {
      message(error.message);
    }
    // Whether it worked or not, the next go starts from a clean drawing.
    drawing = blank();
    strokesDone = 0;
    waiting = false;
    showGraph();
  }

  function showResult(result) {
    curve = result.curve;
    asymptotes = result.asymptotes;

    // The big score is cleared so it does not cover the real curve.
    percent = null;
    find('#result-heading').textContent = result.solved
      ? `Cracked it in ${goesText(goes)} with ${result.accuracy}%`
      : `Out of goes. Your last one scored ${result.accuracy}%`;
    find('#result-stars').textContent = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
    find('#result-stars').setAttribute('aria-label', `${result.stars} out of 3 stars`);
    find('#result-family').textContent = result.familyName;
    find('#result-formula').textContent = result.formula;

    find('#result').hidden = false;
    find('#stroke-info').hidden = true;
    graph.classList.add('finished');
    message('');
  }

  /* Drawing with a mouse, finger or stylus */

  let last = null;
  graph.addEventListener('pointerdown', (event) => {
    if (!startStroke()) return;
    last = graphPosition(graph, event, game.limit, game.columns);
    graph.setPointerCapture(event.pointerId);
    pen.visible = false;
    drawBetween(last, last);
  });
  graph.addEventListener('pointermove', (event) => {
    if (!last) return;
    const here = graphPosition(graph, event, game.limit, game.columns);
    drawBetween(last, here);
    last = here;
  });
  function liftPointer() {
    if (!last) return;
    last = null;
    endStroke();
  }
  graph.addEventListener('pointerup', liftPointer);
  graph.addEventListener('pointercancel', liftPointer);

  /* Drawing with the keyboard */

  graph.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, 0.25], ArrowDown: [0, -0.25] };

    if (event.key === ' ') {
      event.preventDefault();
      if (pen.down) {
        pen.down = false;
        endStroke();
      } else if (startStroke()) {
        pen.down = true;
        drawBetween(pen, pen);
        message('Pen down. Move with the arrow keys, then press Space to lift it.');
      }
    }
    if (moves[event.key]) {
      event.preventDefault();
      const before = { column: pen.column, output: pen.output };
      pen.column = Math.max(0, Math.min(game.columns - 1, pen.column + moves[event.key][0]));
      pen.output = Math.max(-game.limit, Math.min(game.limit, pen.output + moves[event.key][1]));
      if (pen.down) drawBetween(before, pen);
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
  const dateText = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  find('#machine-details').textContent = `No. ${game.id} · ${dateText} · difficulty ${game.difficulty} of 3`;
  find('#stroke-info').textContent = game.strokes === 1
    ? 'One stroke per go. Lift your pen and it is marked.'
    : `This curve is in ${game.strokes} pieces, so each go is ${game.strokes} strokes.`;

  showGoes();
  showGraph();
}

start().catch((error) => message(error.message));
