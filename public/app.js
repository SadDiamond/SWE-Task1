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

  // The drawing: one output for each column across the graph, null where nothing is drawn.
  let drawing = blank();
  // Feedback for each column from the last check. Cleared wherever the player draws again.
  let marks = blank();
  // A copy of the drawing from every go so far.
  const attempts = [];
  let missed = [];
  let exits = [];
  // The answer, once the round is over.
  let curve = null;
  let asymptotes = [];
  let goes = 0;
  // The keyboard pen. Only shown while the graph is selected with the keyboard.
  const pen = { column: (game.columns - 1) / 2, output: 0, down: false, visible: false };

  function showGraph() {
    drawGraph(graph, {
      drawing,
      marks,
      // The newest attempt is the drawing on screen, so only older ones are shown as faint ghosts.
      ghosts: attempts.slice(0, -1),
      missed,
      exits,
      curve,
      asymptotes,
      pen: pen.visible && !curve ? pen : null
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

  function tool() {
    return find('input[name="tool"]:checked').value;
  }

  // Draws (or rubs out) between two positions on the graph.
  // Every column between them gets a value, so a fast drag leaves no holes.
  function drawBetween(from, to) {
    if (curve) return;
    const first = Math.round(Math.min(from.column, to.column));
    const last = Math.round(Math.max(from.column, to.column));

    for (let column = first; column <= last; column += 1) {
      if (column < 0 || column >= game.columns) continue;
      // How far this column is along the drag, from 0 at "from" to 1 at "to".
      const along = to.column === from.column ? 1 : (column - from.column) / (to.column - from.column);
      const output = from.output + (to.output - from.output) * Math.min(1, Math.max(0, along));
      const onGraph = Math.max(-game.limit, Math.min(game.limit, output));

      drawing[column] = tool() === 'pen' ? Math.round(onGraph * 100) / 100 : null;
      marks[column] = null;
    }
    showGraph();
  }

  /* Drawing with a mouse, finger or stylus */

  let last = null;
  graph.addEventListener('pointerdown', (event) => {
    last = graphPosition(graph, event, game.limit, game.columns);
    graph.setPointerCapture(event.pointerId);
    pen.visible = false;
    message('');
    drawBetween(last, last);
  });
  graph.addEventListener('pointermove', (event) => {
    if (!last) return;
    const here = graphPosition(graph, event, game.limit, game.columns);
    drawBetween(last, here);
    last = here;
  });
  graph.addEventListener('pointerup', () => {
    last = null;
  });
  graph.addEventListener('pointercancel', () => {
    last = null;
  });

  /* Drawing with the keyboard */

  graph.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, 0.25], ArrowDown: [0, -0.25] };
    if (event.key === ' ') {
      event.preventDefault();
      pen.down = !pen.down;
      if (pen.down) drawBetween(pen, pen);
      message(pen.down ? 'Pen down.' : 'Pen up.');
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
    pen.down = false;
    showGraph();
  });

  find('#clear').addEventListener('click', () => {
    drawing = blank();
    marks = blank();
    message('');
    showGraph();
  });

  /* Checking a go */

  function showResult(result) {
    curve = result.curve;
    asymptotes = result.asymptotes;

    find('#result-heading').textContent = result.solved
      ? `Cracked it in ${goesText(goes)}`
      : `Out of goes. Your best was ${result.accuracy}%`;
    find('#result-stars').textContent = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
    find('#result-stars').setAttribute('aria-label', `${result.stars} out of 3 stars`);
    find('#result-family').textContent = result.familyName;
    find('#result-formula').textContent = result.formula;

    find('.tools').hidden = true;
    find('.check-row').hidden = true;
    find('#result').hidden = false;
    graph.classList.add('finished');
  }

  find('#check').addEventListener('click', async () => {
    try {
      const result = await send(`/api/machines/${game.id}/go`, { drawing, go: goes + 1 });
      goes += 1;
      attempts.push([...drawing]);
      marks = result.marks;
      missed = result.missed;
      exits = result.exits;

      showGoes();
      if (result.finished) {
        showResult(result);
        message('');
      } else {
        message(`${result.accuracy}% there. Fix the red and amber parts, then check again.`);
      }
      showGraph();
    } catch (error) {
      message(error.message);
    }
  });

  // The graph is drawn at its real size, so it needs redrawing when the window changes.
  window.addEventListener('resize', showGraph);

  const date = new Date(`${game.date}T00:00`);
  const dateText = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  find('#machine-details').textContent = `No. ${game.id} · ${dateText} · difficulty ${game.difficulty} of 3`;

  showGoes();
  showGraph();
}

start().catch((error) => message(error.message));
