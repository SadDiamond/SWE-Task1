// Draws the graph: grid, the player's drawing, feedback, and the real curve at the end.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// A drawn line is broken where it jumps more than this between neighbouring columns,
// so the two halves of a hyperbola are not joined by a vertical stroke.
const BIGGEST_STEP = 6;

function svgElement(name, attributes, text) {
  const item = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    item.setAttribute(key, value);
  }
  if (text !== undefined) item.textContent = text;
  return item;
}

// Works out how to place things on the graph at its current size on the page.
// limit is how far the graph goes each way (10), columns is how many values a drawing has.
function scaleFor(svg, limit, columns) {
  const size = svg.clientWidth;
  return {
    size,
    xFor: (input) => ((input + limit) / (2 * limit)) * size,
    yFor: (output) => ((limit - output) / (2 * limit)) * size,
    inputFor: (column) => (column / (columns - 1)) * 2 * limit - limit
  };
}

// Turns a pointer position on the page into a column number and an output.
function graphPosition(svg, event, limit, columns) {
  const corner = svg.getBoundingClientRect();
  const across = (event.clientX - corner.left) / corner.width;
  const down = (event.clientY - corner.top) / corner.height;
  return {
    column: across * (columns - 1),
    output: limit - down * 2 * limit
  };
}

// Splits a list of values into separate lines. A new line starts at a gap, at a big jump,
// or where the label changes (labels are the feedback marks, so each colour is its own line).
function linesFrom(values, labels, scale) {
  const lines = [];
  let current = null;

  values.forEach((value, column) => {
    const previous = column > 0 ? values[column - 1] : null;
    const label = labels ? labels[column] : '';
    const joined = value !== null && previous !== null && Math.abs(value - previous) <= BIGGEST_STEP;

    if (value === null) {
      current = null;
      return;
    }
    const point = `${scale.xFor(scale.inputFor(column)).toFixed(1)} ${scale.yFor(value).toFixed(1)}`;
    if (!current || !joined || current.label !== label) {
      // Start from the previous point when the line carries on, so colours meet without a gap.
      const start = joined
        ? `M${scale.xFor(scale.inputFor(column - 1)).toFixed(1)} ${scale.yFor(previous).toFixed(1)} L${point}`
        : `M${point} L${point}`;
      current = { label, path: start };
      lines.push(current);
    } else {
      current.path += ` L${point}`;
    }
  });
  return lines;
}

function drawGrid(svg, scale, limit) {
  svg.append(svgElement('rect', { class: 'paper', x: 0, y: 0, width: scale.size, height: scale.size }));

  for (let value = -limit; value <= limit; value += 1) {
    if (value === 0) continue;
    const kind = value % 5 === 0 ? 'grid major' : 'grid';
    svg.append(
      svgElement('line', { class: kind, x1: scale.xFor(value), x2: scale.xFor(value), y1: 0, y2: scale.size }),
      svgElement('line', { class: kind, x1: 0, x2: scale.size, y1: scale.yFor(value), y2: scale.yFor(value) })
    );
  }
  svg.append(
    svgElement('line', { class: 'axis', x1: scale.xFor(0), x2: scale.xFor(0), y1: 0, y2: scale.size }),
    svgElement('line', { class: 'axis', x1: 0, x2: scale.size, y1: scale.yFor(0), y2: scale.yFor(0) })
  );

  // Numbers sit beside the axes, every 5.
  for (const value of [-limit, -limit / 2, limit / 2, limit]) {
    const nearEdge = Math.abs(value) === limit;
    const label = String(value).replace('-', '−');
    svg.append(
      svgElement('text', {
        class: 'tick',
        x: scale.xFor(value) + (value < 0 && nearEdge ? 4 : -4),
        y: scale.yFor(0) + 16,
        'text-anchor': value < 0 && nearEdge ? 'start' : 'end'
      }, label),
      svgElement('text', {
        class: 'tick',
        x: scale.xFor(0) - 6,
        y: scale.yFor(value) + (value > 0 && nearEdge ? 14 : -4),
        'text-anchor': 'end'
      }, label)
    );
  }
}

// picture holds everything to show:
//   drawing: the current drawing, marks: feedback for it ('g', 'a', 'r' or null),
//   ghosts: earlier drawings, missed: columns the last go left empty by mistake,
//   exits: where the curve leaves the graph, curve and asymptotes: the answer, once known,
//   pen: the keyboard pen { column, output, down }, or null.
function drawGraph(svg, picture, limit) {
  const columns = picture.drawing.length;
  const scale = scaleFor(svg, limit, columns);
  const summary = svg.querySelector('title');

  svg.replaceChildren(summary);
  svg.setAttribute('viewBox', `0 0 ${scale.size} ${scale.size}`);
  drawGrid(svg, scale, limit);

  picture.ghosts.forEach((ghost) => {
    linesFrom(ghost, null, scale).forEach((line) => {
      svg.append(svgElement('path', { class: 'ghost', d: line.path }));
    });
  });

  // A grey bar along the bottom wherever the last go missed part of the curve.
  const columnWidth = scale.size / (columns - 1);
  picture.missed.forEach((isMissed, column) => {
    if (!isMissed) return;
    svg.append(svgElement('rect', {
      class: 'missed', x: scale.xFor(scale.inputFor(column)) - columnWidth / 2, y: scale.size - 7, width: columnWidth + 0.5, height: 7
    }));
  });

  if (picture.curve) {
    picture.asymptotes.forEach((asymptote) => {
      const line = asymptote.kind === 'vertical'
        ? { x1: scale.xFor(asymptote.input), x2: scale.xFor(asymptote.input), y1: 0, y2: scale.size }
        : {
          x1: 0,
          x2: scale.size,
          y1: scale.yFor(asymptote.slope * -limit + asymptote.start),
          y2: scale.yFor(asymptote.slope * limit + asymptote.start)
        };
      svg.append(svgElement('line', { class: 'asymptote', ...line }));
    });
  }

  linesFrom(picture.drawing, picture.marks, scale).forEach((line) => {
    svg.append(svgElement('path', { class: `stroke ${line.label || 'fresh'}`, d: line.path }));
  });

  // The real curve goes on top of the drawing so it can always be seen.
  if (picture.curve) {
    linesFrom(picture.curve, null, scale).forEach((line) => {
      svg.append(svgElement('path', { class: 'truth', d: line.path }));
    });
  }

  // Small arrows on the top or bottom edge where the curve leaves the graph.
  picture.exits.forEach((exit) => {
    const x = scale.xFor(exit.input);
    const points = exit.side === 'top'
      ? `${x - 8},16 ${x + 8},16 ${x},3`
      : `${x - 8},${scale.size - 16} ${x + 8},${scale.size - 16} ${x},${scale.size - 3}`;
    svg.append(svgElement('polygon', { class: 'exit', points }));
  });

  if (picture.pen) {
    const x = scale.xFor(scale.inputFor(picture.pen.column));
    const y = scale.yFor(picture.pen.output);
    svg.append(svgElement('circle', { class: picture.pen.down ? 'pen down' : 'pen', cx: x, cy: y, r: 8 }));
  }

  const drawn = picture.drawing.filter((value) => value !== null).length;
  summary.textContent = `Graph from −${limit} to ${limit}. `
    + (drawn === 0 ? 'Nothing drawn yet.' : `Your drawing covers about ${Math.round((drawn / columns) * 100)}% of the width.`)
    + (picture.curve ? ' The real curve is shown.' : '');
}
