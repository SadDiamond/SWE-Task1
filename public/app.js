function find(selector) {
  return document.querySelector(selector);
}

function message(text) {
  find('#form-status').textContent = text;
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

async function start() {
  const machine = await request('/api/today');
  const date = new Date(`${machine.date}T00:00`);
  const dateText = date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  find('#machine-details').textContent =
    `Machine ${machine.id} · ${dateText} · difficulty ${machine.difficulty} of 3`;
}

start().catch((error) => message(error.message));
