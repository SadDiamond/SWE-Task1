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

function countText(count, word) {
  return count === 1 ? `1 ${word}` : `${count} ${word}s`;
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
  const machine = await request('/api/today');
  const families = await request('/api/families');
  const graph = find('#graph');
  const input = find('#input');
  const inputCount = machine.maxInput - machine.minInput + 1;

  // Every test run so far, in the order they were made: { input, output }.
  const tests = [];
  // The player's drawing: one output for each input, undefined where nothing is drawn yet.
  let drawing = new Array(inputCount).fill(undefined);
  // The real outputs. Only known after the answer has been checked.
  let truth = null;
  // The part of the graph on screen. null means "fit everything", until the player moves it.
  let view = null;

  function mode() {
    return find('input[name="mode"]:checked').value;
  }

  function currentView() {
    if (view) return view;
    // The fitted view follows the test results, and the real curve once it is known.
    // It must not follow the drawing, or the graph would rescale under the player's pen.
    const outputs = tests.map((test) => test.output).concat(truth || []);
    return fitView(outputs, machine.minInput, machine.maxInput);
  }

  function showGraph() {
    const picture = { tests, drawing, truth, firstInput: machine.minInput, showGaps: mode() === 'draw' && !truth };
    drawGraph(graph, picture, currentView());
    // While drawing, the graph must not scroll the page under the player's finger.
    graph.classList.toggle('drawing-mode', mode() === 'draw' && !truth);
  }

  function setView(newView) {
    view = newView;
    showGraph();
  }

  /* Step 1: testing */

  function showEnergy() {
    const left = machine.maxTests - tests.length;
    find('#energy-text').textContent = `${countText(left, 'test')} left`;

    const cells = find('#energy-cells');
    cells.replaceChildren();
    for (let index = 0; index < machine.maxTests; index += 1) {
      cells.append(element('span', undefined, index < left ? 'cell full' : 'cell'));
    }
    find('#test-form button').disabled = left === 0;
    input.disabled = left === 0;
  }

  // The log is sorted by input, because patterns are easier to see that way.
  function showLog() {
    const rows = find('#log-rows');
    const sorted = tests
      .map((test, index) => ({ ...test, number: index + 1 }))
      .sort((first, second) => first.input - second.input);

    rows.replaceChildren();
    sorted.forEach((test) => {
      const row = document.createElement('tr');
      const heading = element('th', test.input);
      heading.scope = 'row';
      row.append(heading, element('td', test.output), element('td', `#${test.number}`));
      if (test.number === tests.length) row.className = 'newest';
      rows.append(row);
    });
    find('#log-table').hidden = tests.length === 0;
    find('#log-empty').hidden = tests.length > 0;
  }

  find('#test-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = Number(input.value);

    // Testing the same number twice would waste a test.
    const earlier = tests.find((test) => test.input === value);
    if (earlier) {
      return message(`You already tested ${value}. It gave ${earlier.output}. No test was used.`);
    }
    try {
      tests.push(await send(`/api/machines/${machine.id}/test`, { input: value }));
      showEnergy();
      showLog();
      // Go back to the fitted view so the new point is always visible.
      setView(null);
      message('');
      input.select();
    } catch (error) {
      message(error.message);
    }
  });

  /* Step 2: drawing */

  function showProgress() {
    const missing = drawing.filter((value) => value === undefined).length;
    find('#draw-progress').textContent = missing === 0
      ? 'Your drawing covers every input.'
      : `${countText(missing, 'input')} still to draw. They are shaded on the graph.`;
  }

  // Called while the player drags in Draw mode. from and to are positions on the graph.
  // Every whole-number input between the two positions gets a value, so fast drags leave no holes.
  function draw(from, to) {
    if (truth) return;
    const first = Math.round(Math.min(from.input, to.input));
    const last = Math.round(Math.max(from.input, to.input));

    for (let x = first; x <= last; x += 1) {
      if (x < machine.minInput || x > machine.maxInput) continue;
      // How far x is along the drag, from 0 at "from" to 1 at "to".
      const along = to.input === from.input ? 1 : (x - from.input) / (to.input - from.input);
      const output = from.output + (to.output - from.output) * Math.min(1, Math.max(0, along));
      drawing[x - machine.minInput] = Math.round(output);
    }
    showGraph();
    showProgress();
    message('');
  }

  find('#clear-drawing').addEventListener('click', () => {
    drawing = new Array(inputCount).fill(undefined);
    showGraph();
    showProgress();
  });

  /* Step 3: naming the type */

  families.forEach((family) => {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'family';
    radio.value = family.id;
    label.append(radio, element('strong', family.name), element('span', family.description));
    find('#family-list').append(label);
  });

  /* Checking the answer */

  find('#submit-answer').addEventListener('click', async () => {
    const chosen = find('input[name="family"]:checked');
    if (drawing.includes(undefined)) {
      return message('Finish your drawing first. The shaded inputs still need a value.');
    }
    if (!chosen) return message('Choose which type of function you think it is.');

    try {
      const result = await send(`/api/machines/${machine.id}/answer`, {
        drawing,
        familyId: Number(chosen.value),
        testsUsed: tests.length
      });
      truth = result.truth;

      find('#result-score').textContent = `${result.score} points`;
      find('#result-stars').textContent = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
      find('#result-stars').setAttribute('aria-label', `${result.stars} out of 3 stars`);
      find('#result-accuracy').textContent = `${result.accuracy}%`;
      find('#result-type').textContent = result.typeCorrect
        ? `${result.familyName}. You got it, +10.`
        : `${result.familyName}. Not what you picked.`;
      find('#result-tests').textContent = `${machine.maxTests - tests.length}, +1 each`;
      find('#result-formula').textContent = result.formula;

      // Drawing is finished, so dragging now only moves the graph.
      find('input[name="mode"][value="move"]').checked = true;
      find('.switch').hidden = true;
      find('#play').hidden = true;
      find('#result').hidden = false;
      setView(null);
      find('#result-heading').scrollIntoView({ block: 'nearest' });
    } catch (error) {
      message(error.message);
    }
  });

  /* Graph controls */

  addGraphControls(graph, { getView: currentView, setView, getMode: mode, onDraw: draw });
  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', showGraph);
  });
  find('#zoom-in').addEventListener('click', () => setView(zoomView(currentView(), 0.8)));
  find('#zoom-out').addEventListener('click', () => setView(zoomView(currentView(), 1.25)));
  find('#zoom-fit').addEventListener('click', () => setView(null));

  // The graph is drawn at its real size, so it needs redrawing when the window changes.
  window.addEventListener('resize', showGraph);

  const date = new Date(`${machine.date}T00:00`);
  const dateText = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  find('#machine-details').textContent = `No. ${machine.id} · ${dateText} · difficulty ${machine.difficulty} of 3`;
  find('#input-help').textContent = `Whole numbers from ${machine.minInput} to ${machine.maxInput}.`;
  input.min = machine.minInput;
  input.max = machine.maxInput;

  showEnergy();
  showLog();
  showProgress();
  showGraph();
}

start().catch((error) => message(error.message));
