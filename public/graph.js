// Draws the test results as points on an SVG graph.

const GRAPH = { width: 480, height: 320, left: 50, right: 14, top: 14, bottom: 32 };
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

// tests is a list of { input, output }. minInput and maxInput fix the left and right edges.
function drawGraph(svg, tests, minInput, maxInput) {
  const outputs = tests.map((test) => test.output);
  // The up-down scale always includes 0 and grows to fit the outputs seen so far.
  let low = Math.min(0, ...outputs);
  let high = Math.max(0, ...outputs);
  if (high - low < 10) {
    low -= 5;
    high += 5;
  }
  const step = niceStep(high - low);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;

  const plotWidth = GRAPH.width - GRAPH.left - GRAPH.right;
  const plotHeight = GRAPH.height - GRAPH.top - GRAPH.bottom;
  const xFor = (input) => GRAPH.left + ((input - minInput) / (maxInput - minInput)) * plotWidth;
  const yFor = (output) => GRAPH.top + ((high - output) / (high - low)) * plotHeight;

  const summary = svg.querySelector('title');
  svg.replaceChildren(summary);
  svg.append(svgElement('rect', {
    class: 'graph-paper', x: GRAPH.left, y: GRAPH.top, width: plotWidth, height: plotHeight
  }));

  // Up-and-down grid lines, one every 5 inputs.
  for (let input = minInput; input <= maxInput; input += 5) {
    const x = xFor(input);
    svg.append(
      svgElement('line', { class: input === 0 ? 'axis' : 'grid', x1: x, x2: x, y1: GRAPH.top, y2: GRAPH.top + plotHeight }),
      svgElement('text', { class: 'tick', x, y: GRAPH.height - 10, 'text-anchor': 'middle' }, input)
    );
  }

  // Side-to-side grid lines.
  for (let output = low; output <= high; output += step) {
    const y = yFor(output);
    svg.append(
      svgElement('line', { class: output === 0 ? 'axis' : 'grid', x1: GRAPH.left, x2: GRAPH.left + plotWidth, y1: y, y2: y }),
      svgElement('text', { class: 'tick', x: GRAPH.left - 8, y: y + 4, 'text-anchor': 'end' }, output)
    );
  }

  tests.forEach((test, index) => {
    const isNewest = index === tests.length - 1;
    const point = svgElement('circle', {
      class: isNewest ? 'point newest' : 'point', cx: xFor(test.input), cy: yFor(test.output), r: 5
    });
    point.append(svgElement('title', {}, `Input ${test.input}, output ${test.output}`));
    svg.append(point);
  });

  summary.textContent = tests.length === 0
    ? 'Graph of your tests. No tests yet.'
    : `Graph of your tests. ${tests.length} plotted. The same results are listed in the test log.`;
}
