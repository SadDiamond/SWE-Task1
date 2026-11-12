// Draws the test results as points on an SVG graph that can be moved and zoomed.

const GRAPH = { width: 480, height: 320, left: 50, right: 14, top: 14, bottom: 32 };
const PLOT_WIDTH = GRAPH.width - GRAPH.left - GRAPH.right;
const PLOT_HEIGHT = GRAPH.height - GRAPH.top - GRAPH.bottom;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes, text) {
  const item = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    item.setAttribute(key, value);
  }
  if (text !== undefined) item.textContent = text;
  return item;
}

// Picks a gap between grid lines (1, 2, 5, 10, 20, 50 ...) that gives about five lines.
function niceStep(range) {
  let step = 1;
  const multipliers = [2, 2.5, 2];
  let index = 0;
  while (range / step > 6) {
    step *= multipliers[index % 3];
    index += 1;
  }
  return step;
}

// A view is the part of the graph on screen: left and right are inputs, low and high are outputs.
// This one shows every allowed input and stretches up and down to fit the results so far.
function fitView(tests, minInput, maxInput) {
  const outputs = tests.map((test) => test.output);
  let low = Math.min(0, ...outputs);
  let high = Math.max(0, ...outputs);
  if (high - low < 10) {
    low -= 5;
    high += 5;
  }
  const step = niceStep(high - low);
  return {
    left: minInput,
    right: maxInput,
    low: Math.floor(low / step) * step,
    high: Math.ceil(high / step) * step
  };
}

// Slides the view. Amounts are fractions of the screen, e.g. 0.1 is a tenth of the width.
function moveView(view, across, up) {
  const width = view.right - view.left;
  const height = view.high - view.low;
  return {
    left: view.left + across * width,
    right: view.right + across * width,
    low: view.low + up * height,
    high: view.high + up * height
  };
}

// Zooms about the centre. A factor below 1 zooms in, above 1 zooms out.
function zoomView(view, factor) {
  const width = (view.right - view.left) * factor;
  const height = (view.high - view.low) * factor;
  // Stops the view becoming too small to show whole numbers or too large to be useful.
  if (width < 4 || width > 400) return view;

  const middleX = (view.left + view.right) / 2;
  const middleY = (view.low + view.high) / 2;
  return {
    left: middleX - width / 2,
    right: middleX + width / 2,
    low: middleY - height / 2,
    high: middleY + height / 2
  };
}

function drawGraph(svg, tests, view) {
  const xFor = (input) => GRAPH.left + ((input - view.left) / (view.right - view.left)) * PLOT_WIDTH;
  const yFor = (output) => GRAPH.top + ((view.high - output) / (view.high - view.low)) * PLOT_HEIGHT;

  const summary = svg.querySelector('title');
  svg.replaceChildren(summary);
  svg.append(svgElement('rect', {
    class: 'graph-screen', x: GRAPH.left, y: GRAPH.top, width: PLOT_WIDTH, height: PLOT_HEIGHT
  }));

  // Up-and-down grid lines with the input written underneath.
  const stepX = niceStep(view.right - view.left);
  for (let input = Math.ceil(view.left / stepX) * stepX; input <= view.right; input += stepX) {
    const x = xFor(input);
    svg.append(
      svgElement('line', { class: input === 0 ? 'axis' : 'grid', x1: x, x2: x, y1: GRAPH.top, y2: GRAPH.top + PLOT_HEIGHT }),
      svgElement('text', { class: 'tick', x, y: GRAPH.height - 10, 'text-anchor': 'middle' }, input)
    );
  }

  // Side-to-side grid lines with the output written on the left.
  const stepY = niceStep(view.high - view.low);
  for (let output = Math.ceil(view.low / stepY) * stepY; output <= view.high; output += stepY) {
    const y = yFor(output);
    svg.append(
      svgElement('line', { class: output === 0 ? 'axis' : 'grid', x1: GRAPH.left, x2: GRAPH.left + PLOT_WIDTH, y1: y, y2: y }),
      svgElement('text', { class: 'tick', x: GRAPH.left - 8, y: y + 4, 'text-anchor': 'end' }, output)
    );
  }

  let hidden = 0;
  tests.forEach((test, index) => {
    const onScreen = test.input >= view.left && test.input <= view.right
      && test.output >= view.low && test.output <= view.high;
    if (!onScreen) {
      hidden += 1;
      return;
    }
    const isNewest = index === tests.length - 1;
    const point = svgElement('circle', {
      class: isNewest ? 'point newest' : 'point', cx: xFor(test.input), cy: yFor(test.output), r: 5
    });
    point.append(svgElement('title', {}, `Input ${test.input}, output ${test.output}`));
    svg.append(point);
  });

  if (tests.length === 0) {
    summary.textContent = 'Graph of your tests. No tests yet.';
  } else {
    const offScreen = hidden > 0 ? ` ${hidden} off screen.` : '';
    summary.textContent = `Graph of your tests. ${tests.length} plotted.${offScreen} The same results are in the test log.`;
  }
}

// Lets the player drag, scroll, press keys or use buttons to move around the graph.
// getView gives the current view; setView is called with the new one.
function addGraphControls(svg, getView, setView) {
  let dragFrom = null;

  svg.addEventListener('pointerdown', (event) => {
    dragFrom = { x: event.clientX, y: event.clientY };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragFrom) return;
    // How far the pointer moved, as a fraction of the plotted area.
    const size = svg.getBoundingClientRect();
    const across = (event.clientX - dragFrom.x) / (size.width * (PLOT_WIDTH / GRAPH.width));
    const up = (event.clientY - dragFrom.y) / (size.height * (PLOT_HEIGHT / GRAPH.height));
    dragFrom = { x: event.clientX, y: event.clientY };
    setView(moveView(getView(), -across, up));
  });
  svg.addEventListener('pointerup', () => {
    dragFrom = null;
  });
  svg.addEventListener('pointercancel', () => {
    dragFrom = null;
  });

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    setView(zoomView(getView(), event.deltaY < 0 ? 0.8 : 1.25));
  }, { passive: false });

  svg.addEventListener('keydown', (event) => {
    const moves = {
      ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1]
    };
    if (moves[event.key]) {
      event.preventDefault();
      setView(moveView(getView(), ...moves[event.key]));
    }
    if (event.key === '+' || event.key === '=') setView(zoomView(getView(), 0.8));
    if (event.key === '-') setView(zoomView(getView(), 1.25));
  });
}
