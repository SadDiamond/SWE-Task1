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
  const form = find('#test-form');
  const input = find('#input');
  const graph = find('#graph');
  // Every test run so far, in the order they were made: { input, output }.
  const tests = [];
  // The part of the graph on screen. null means "fit everything", until the player moves it.
  let view = null;

  function currentView() {
    return view || fitView(tests, machine.minInput, machine.maxInput);
  }

  function showGraph() {
    drawGraph(graph, tests, currentView());
  }

  function setView(newView) {
    view = newView;
    showGraph();
  }

  function showEnergy() {
    const left = machine.maxTests - tests.length;
    find('#energy-text').textContent = `${countText(left, 'test')} left`;

    const cells = find('#energy-cells');
    cells.replaceChildren();
    for (let index = 0; index < machine.maxTests; index += 1) {
      cells.append(element('span', undefined, index < left ? 'cell full' : 'cell'));
    }
    form.querySelector('button').disabled = left === 0;
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

  // Restarts the short "working" animation on the machine box.
  function runAnimation() {
    const box = find('.box');
    box.classList.remove('working');
    box.offsetWidth; // reading this makes the browser notice the class was removed
    box.classList.add('working');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = Number(input.value);

    // Testing the same number twice would waste a test, so the earlier result is shown again.
    const earlier = tests.find((test) => test.input === value);
    if (earlier) {
      find('#output').textContent = earlier.output;
      return message(`You already tested ${value}. No test was used.`);
    }
    try {
      const result = await send(`/api/machines/${machine.id}/test`, { input: value });
      tests.push(result);
      find('#output').textContent = result.output;
      showEnergy();
      showLog();
      // Go back to the fitted view so the new point is always visible.
      setView(null);
      runAnimation();
      message(tests.length === machine.maxTests ? 'That was your last test.' : '');
      input.select();
    } catch (error) {
      message(error.message);
    }
  });

  const date = new Date(`${machine.date}T00:00`);
  const dateText = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  find('#machine-details').textContent = `No. ${machine.id} · ${dateText} · difficulty ${machine.difficulty} of 3`;
  find('#input-help').textContent = `Whole numbers from ${machine.minInput} to ${machine.maxInput}.`;
  input.min = machine.minInput;
  input.max = machine.maxInput;

  addGraphControls(graph, currentView, setView);
  find('#zoom-in').addEventListener('click', () => setView(zoomView(currentView(), 0.8)));
  find('#zoom-out').addEventListener('click', () => setView(zoomView(currentView(), 1.25)));
  find('#zoom-fit').addEventListener('click', () => setView(null));

  showEnergy();
  showLog();
  showGraph();
}

start().catch((error) => message(error.message));
