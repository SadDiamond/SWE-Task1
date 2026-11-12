// Draws the graph: test points, the player's drawing and, at the end, the real curve.
// The graph can be moved and zoomed.

const MARGIN = { left: 52, right: 12, top: 12, bottom: 32 };

// Measures the graph on the page so it is drawn at its real size.
// This keeps the numbers readable on a phone instead of shrinking with the picture.
function measure(svg) {
  const width = svg.clientWidth;
  const height = svg.clientHeight;
  return {
    width,
    height,
    plotWidth: width - MARGIN.left - MARGIN.right,
    plotHeight: height - MARGIN.top - MARGIN.bottom
  };
}

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
// This one shows every allowed input and stretches up and down to fit the given outputs.
function fitView(outputs, minInput, maxInput) {
  let low = Math.min(0, ...outputs);
  let high = Math.max(0, ...outputs);
  if (high - low < 10) {
    low -= 5;
    high += 5;
  }
  const step = niceStep(high - low);
  return {
    left: minInput - 1,
    right: maxInput + 1,
    low: Math.floor(low / step) * step - step,
    high: Math.ceil(high / step) * step + step
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

// Turns a pointer position on the page into an input and output on the graph.
function graphPosition(svg, event, view) {
  const size = measure(svg);
  const corner = svg.getBoundingClientRect();
  const x = event.clientX - corner.left;
  const y = event.clientY - corner.top;
  return {
    input: view.left + ((x - MARGIN.left) / size.plotWidth) * (view.right - view.left),
    output: view.high - ((y - MARGIN.top) / size.plotHeight) * (view.high - view.low)
  };
}

// Builds an SVG path through a list of values (one for each input, starting at firstInput).
// Gaps (undefined values) break the line.
function linePath(values, firstInput, xFor, yFor) {
  let path = '';
  let penDown = false;
  values.forEach((value, index) => {
    if (value === undefined) {
      penDown = false;
      return;
    }
    path += `${penDown ? 'L' : 'M'}${xFor(firstInput + index).toFixed(1)} ${yFor(value).toFixed(1)} `;
    penDown = true;
  });
  return path;
}

// picture holds everything to show:
//   tests: [{ input, output }], drawing: values or undefined for each input,
//   truth: the real outputs (only after answering), firstInput: the input the lists start at,
//   showGaps: shade the inputs that have not been drawn yet.
function drawGraph(svg, picture, view) {
  const size = measure(svg);
  const bottom = MARGIN.top + size.plotHeight;
  const xFor = (input) => MARGIN.left + ((input - view.left) / (view.right - view.left)) * size.plotWidth;
  const yFor = (output) => MARGIN.top + ((view.high - output) / (view.high - view.low)) * size.plotHeight;
  const lastInput = picture.firstInput + picture.drawing.length - 1;

  const summary = svg.querySelector('title');
  svg.replaceChildren(summary);
  svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);

  // Everything is clipped to the paper so lines do not spill over the numbers.
  const clip = svgElement('clipPath', { id: 'paper-clip' });
  clip.append(svgElement('rect', { x: MARGIN.left, y: MARGIN.top, width: size.plotWidth, height: size.plotHeight }));
  const paper = svgElement('g', { 'clip-path': 'url(#paper-clip)' });
  svg.append(clip, svgElement('rect', {
    class: 'paper', x: MARGIN.left, y: MARGIN.top, width: size.plotWidth, height: size.plotHeight
  }), paper);

  if (picture.showGaps) {
    picture.drawing.forEach((value, index) => {
      if (value !== undefined) return;
      const input = picture.firstInput + index;
      paper.append(svgElement('rect', {
        class: 'gap', x: xFor(input - 0.5), y: MARGIN.top, width: xFor(1) - xFor(0), height: size.plotHeight
      }));
    });
  }

  // Up-and-down grid lines with the input written underneath.
  const stepX = niceStep(view.right - view.left);
  for (let input = Math.ceil(view.left / stepX) * stepX; input <= view.right; input += stepX) {
    const x = xFor(input);
    paper.append(svgElement('line', { class: input === 0 ? 'axis' : 'grid', x1: x, x2: x, y1: MARGIN.top, y2: bottom }));
    svg.append(svgElement('text', { class: 'tick', x, y: size.height - 10, 'text-anchor': 'middle' }, input));
  }

  // Side-to-side grid lines with the output written on the left.
  const stepY = niceStep(view.high - view.low);
  for (let output = Math.ceil(view.low / stepY) * stepY; output <= view.high; output += stepY) {
    const y = yFor(output);
    paper.append(svgElement('line', { class: output === 0 ? 'axis' : 'grid', x1: MARGIN.left, x2: MARGIN.left + size.plotWidth, y1: y, y2: y }));
    svg.append(svgElement('text', { class: 'tick', x: MARGIN.left - 8, y: y + 4, 'text-anchor': 'end' }, output));
  }

  // The edges of what can be tested and drawn.
  for (const edge of [picture.firstInput - 0.5, lastInput + 0.5]) {
    paper.append(svgElement('line', { class: 'edge', x1: xFor(edge), x2: xFor(edge), y1: MARGIN.top, y2: bottom }));
  }

  paper.append(svgElement('path', { class: 'drawing', d: linePath(picture.drawing, picture.firstInput, xFor, yFor) }));
  if (picture.truth) {
    paper.append(svgElement('path', { class: 'truth', d: linePath(picture.truth, picture.firstInput, xFor, yFor) }));
  }

  picture.tests.forEach((test, index) => {
    const isNewest = index === picture.tests.length - 1;
    const point = svgElement('circle', {
      class: isNewest ? 'point newest' : 'point', cx: xFor(test.input), cy: yFor(test.output), r: 5
    });
    point.append(svgElement('title', {}, `Input ${test.input}, output ${test.output}`));
    paper.append(point);
  });

  const drawn = picture.drawing.filter((value) => value !== undefined).length;
  summary.textContent = `Graph. ${picture.tests.length} tests plotted. `
    + `Your drawing covers ${drawn} of ${picture.drawing.length} inputs.`
    + (picture.truth ? ' The real curve is shown in red.' : '');
}

// Lets the player drag, scroll, press keys or use buttons on the graph.
// controls: getView(), setView(view), getMode() returning 'draw' or 'move', onDraw(from, to).
function addGraphControls(svg, controls) {
  let last = null;

  svg.addEventListener('pointerdown', (event) => {
    last = event;
    svg.setPointerCapture(event.pointerId);
    if (controls.getMode() === 'draw') {
      const here = graphPosition(svg, event, controls.getView());
      controls.onDraw(here, here);
    }
  });

  svg.addEventListener('pointermove', (event) => {
    if (!last) return;
    const view = controls.getView();

    if (controls.getMode() === 'draw') {
      controls.onDraw(graphPosition(svg, last, view), graphPosition(svg, event, view));
    } else {
      // How far the pointer moved, as a fraction of the paper.
      const size = measure(svg);
      const across = (event.clientX - last.clientX) / size.plotWidth;
      const up = (event.clientY - last.clientY) / size.plotHeight;
      controls.setView(moveView(view, -across, up));
    }
    last = event;
  });

  svg.addEventListener('pointerup', () => {
    last = null;
  });
  svg.addEventListener('pointercancel', () => {
    last = null;
  });

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    controls.setView(zoomView(controls.getView(), event.deltaY < 0 ? 0.8 : 1.25));
  }, { passive: false });

  svg.addEventListener('keydown', (event) => {
    const moves = {
      ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1]
    };
    if (moves[event.key]) {
      event.preventDefault();
      controls.setView(moveView(controls.getView(), ...moves[event.key]));
    }
    if (event.key === '+' || event.key === '=') controls.setView(zoomView(controls.getView(), 0.8));
    if (event.key === '-') controls.setView(zoomView(controls.getView(), 1.25));
  });
}
