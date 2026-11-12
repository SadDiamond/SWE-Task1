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

// Splits a list of values into separate lines. A new line starts at a gap or a big jump.
function linesFrom(values, scale) {
  const lines = [];
  let current = null;

  values.forEach((value, column) => {
    const previous = column > 0 ? values[column - 1] : null;
    if (value === null) {
      current = null;
      return;
    }
    const point = `${scale.xFor(scale.inputFor(column)).toFixed(1)} ${scale.yFor(value).toFixed(1)}`;
    const joined = previous !== null && Math.abs(value - previous) <= BIGGEST_STEP;
    if (!current || !joined) {
      current = { path: `M${point} L${point}` };
      lines.push(current);
    } else {
      current.path += ` L${point}`;
    }
  });
  return lines;
}

// Draws a marked attempt: every short piece of the line gets the colour of its level.
// levels holds 0 (spot on) to 4 (way off) for each column.
function drawMarked(group, values, levels, scale) {
  values.forEach((value, column) => {
    if (value === null) return;
    const previous = column > 0 ? values[column - 1] : null;
    const joined = previous !== null && Math.abs(value - previous) <= BIGGEST_STEP;
    const x = scale.xFor(scale.inputFor(column));
    const y = scale.yFor(value);

    group.append(svgElement('line', {
      class: `mark l${levels[column]}`,
      x1: joined ? scale.xFor(scale.inputFor(column - 1)) : x,
      y1: joined ? scale.yFor(previous) : y,
      x2: x,
      y2: y
    }));
  });
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
//   drawing: the strokes of the go in progress,
//   shown: the last go once marked { drawing, levels }, ghost: the go before that,
//   percent: the score to show over the graph, missed: columns the last go left empty by mistake,
//   exits: where the curve leaves the graph, curve and asymptotes: the answer, once known,
//   live: the pointer positions of the stroke being drawn right now,
//   pen: the keyboard pen { column, output, down }, or null.
function drawGraph(svg, picture, limit) {
  const columns = picture.drawing.length;
  const scale = scaleFor(svg, limit, columns);

  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${scale.size} ${scale.size}`);
  drawGrid(svg, scale, limit);

  if (picture.ghost) {
    const faded = svgElement('g', { class: 'faded' });
    drawMarked(faded, picture.ghost.drawing, picture.ghost.levels, scale);
    svg.append(faded);
  }

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

  if (picture.shown) {
    drawMarked(svg, picture.shown.drawing, picture.shown.levels, scale);
  }
  linesFrom(picture.drawing, scale).forEach((line) => {
    svg.append(svgElement('path', { class: 'stroke', d: line.path }));
  });

  // The stroke being drawn right now, straight from the pointer so it appears without any delay.
  if (picture.live.length > 0) {
    const points = picture.live
      .map((spot) => `${scale.xFor(scale.inputFor(spot.column)).toFixed(1)} ${scale.yFor(spot.output).toFixed(1)}`);
    svg.append(svgElement('path', { class: 'stroke', d: `M${points[0]} L${points.join(' L')}` }));
  }

  // The real curve goes on top of the drawing so it can always be seen.
  if (picture.curve) {
    linesFrom(picture.curve, scale).forEach((line) => {
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

  // The score, written large across the middle of the graph.
  if (picture.percent !== null) {
    svg.append(svgElement('text', {
      class: 'percent',
      x: scale.size / 2,
      y: scale.size / 2,
      'font-size': scale.size * 0.24,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle'
    }, `${picture.percent}%`));
  }

  // A description for screen readers. It is a label and not a <title>, so it does not pop up on hover.
  svg.setAttribute('aria-label', `Graph from −${limit} to ${limit}.`
    + (picture.percent !== null ? ` Your last go scored ${picture.percent}%.` : '')
    + (picture.curve ? ' The real curve is shown.' : ''));
}
