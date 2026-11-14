// Draws the graph: grid, the player's strokes, marking, and the real curve at the end.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// The real curve is broken where it jumps more than this between neighbouring columns,
// so the two halves of a hyperbola are not joined by a vertical line.
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
// limit is how far the graph goes each way (10).
function scaleFor(svg, limit) {
  const size = svg.clientWidth;
  return {
    size,
    xFor: (x) => ((x + limit) / (2 * limit)) * size,
    yFor: (y) => ((limit - y) / (2 * limit)) * size
  };
}

// Turns a pointer position on the page into a position on the graph.
function graphPosition(svg, event, limit) {
  const corner = svg.getBoundingClientRect();
  const across = (event.clientX - corner.left) / corner.width;
  const down = (event.clientY - corner.top) / corner.height;
  const clamp = (value) => Math.max(-limit, Math.min(limit, value));
  return {
    x: clamp(across * 2 * limit - limit),
    y: clamp(limit - down * 2 * limit)
  };
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

// One stroke as an SVG path. A stroke is a list of [x, y] pen positions.
function strokePath(stroke, scale) {
  const points = stroke.map(([x, y]) => `${scale.xFor(x).toFixed(1)} ${scale.yFor(y).toFixed(1)}`);
  return `M${points[0]} L${points.join(' L')}`;
}

// Draws marked strokes: every short piece of line gets the colour of its level.
// levels matches strokes: a number from 0 (spot on) to 4 (way off) for each pen position.
// Pieces in a row with the same level share one path, which keeps the graph to a few elements.
function drawMarked(group, strokes, levels, scale) {
  const at = ([x, y]) => `${scale.xFor(x).toFixed(1)} ${scale.yFor(y).toFixed(1)}`;
  strokes.forEach((stroke, strokeIndex) => {
    let path = null;
    for (let index = 1; index < stroke.length; index += 1) {
      const level = levels[strokeIndex][index];
      if (path && path.level === level) {
        path.d += ` L${at(stroke[index])}`;
      } else {
        if (path) group.append(svgElement('path', { class: `mark l${path.level}`, d: path.d }));
        path = { level, d: `M${at(stroke[index - 1])} L${at(stroke[index])}` };
      }
    }
    if (path) group.append(svgElement('path', { class: `mark l${path.level}`, d: path.d }));
  });
}

// Redraws only the stroke being drawn, which is far quicker than rebuilding the whole graph.
// drawGraph marks that stroke's path as live.
function drawLiveStroke(svg, stroke, limit) {
  const path = svg.querySelector('.stroke.live');
  if (path) path.setAttribute('d', strokePath(stroke, scaleFor(svg, limit)));
}

// Draws the nudges: short arrows from a badly-off part of the line towards the real curve.
// Each nudge is { x, y, across, up }, where across and up give the direction as a step of length 1.
function drawNudges(group, nudges, scale) {
  nudges.forEach((nudge) => {
    const startX = scale.xFor(nudge.x);
    const startY = scale.yFor(nudge.y);
    // On screen "up" is a smaller y, so the upward part of the direction is taken away.
    const tipX = startX + nudge.across * 26;
    const tipY = startY - nudge.up * 26;
    // The two sides of the arrowhead are the direction turned a little either way, pointing back.
    const head = [0.5, -0.5].map((turn) => {
      const backX = -nudge.across * Math.cos(turn) - nudge.up * Math.sin(turn);
      const backY = nudge.up * Math.cos(turn) - nudge.across * Math.sin(turn);
      return `M${tipX.toFixed(1)} ${tipY.toFixed(1)} l${(backX * 9).toFixed(1)} ${(backY * 9).toFixed(1)}`;
    });
    group.append(svgElement('path', {
      class: 'nudge',
      d: `M${startX.toFixed(1)} ${startY.toFixed(1)} L${tipX.toFixed(1)} ${tipY.toFixed(1)} ${head.join(' ')}`
    }));
  });
}

// The real curve arrives as one output for each column across the graph, null where there is nothing.
// This splits it into separate lines at the gaps and at big jumps.
function curvePaths(curve, scale, limit) {
  const xForColumn = (column) => scale.xFor((column / (curve.length - 1)) * 2 * limit - limit);
  const paths = [];
  let current = null;

  curve.forEach((value, column) => {
    const previous = column > 0 ? curve[column - 1] : null;
    if (value === null) {
      current = null;
      return;
    }
    const point = `${xForColumn(column).toFixed(1)} ${scale.yFor(value).toFixed(1)}`;
    const joined = previous !== null && Math.abs(value - previous) <= BIGGEST_STEP;
    if (current === null || !joined) {
      current = paths.push(`M${point} L${point}`) - 1;
    } else {
      paths[current] += ` L${point}`;
    }
  });
  return paths;
}

// picture holds everything to show:
//   strokes: the strokes of the go in progress,
//   shown: the last go once marked { strokes, levels, nudges }, ghost: the go before that,
//   dots: clue spots on the curve, shown from the start,
//   percent: the score to show over the graph, missed: columns the last go was nowhere near,
//   exits: where the curve leaves the graph, curve and asymptotes: the answer, once known,
//   pen: the keyboard pen { x, y, down }, or null.
function drawGraph(svg, picture, limit) {
  const scale = scaleFor(svg, limit);

  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${scale.size} ${scale.size}`);
  drawGrid(svg, scale, limit);

  if (picture.ghost) {
    const faded = svgElement('g', { class: 'faded' });
    drawMarked(faded, picture.ghost.strokes, picture.ghost.levels, scale);
    svg.append(faded);
  }

  // A grey bar along the bottom wherever the last go was nowhere near the curve.
  const columnWidth = scale.size / Math.max(1, picture.missed.length - 1);
  picture.missed.forEach((isMissed, column) => {
    if (!isMissed) return;
    svg.append(svgElement('rect', {
      class: 'missed', x: column * columnWidth - columnWidth / 2, y: scale.size - 7, width: columnWidth + 0.5, height: 7
    }));
  });

  // Once the answer is showing, the last go is faded too so the real curve stands out.
  if (picture.shown) {
    const group = svgElement('g', { class: picture.curve ? 'faded' : '' });
    drawMarked(group, picture.shown.strokes, picture.shown.levels, scale);
    if (!picture.curve) drawNudges(group, picture.shown.nudges, scale);
    svg.append(group);
  }
  picture.strokes.forEach((stroke, index) => {
    const live = index === picture.strokes.length - 1;
    svg.append(svgElement('path', { class: live ? 'stroke live' : 'stroke', d: strokePath(stroke, scale) }));
  });

  // The answer goes on top of the drawing so it can always be seen. It is drawn inside a group
  // with a "wobble" filter, which nudges every part of each line by a small uneven amount so the
  // curve and its asymptotes look drawn by hand instead of plotted by a computer.
  if (picture.curve) {
    const filter = svgElement('filter', {
      id: 'wobble', filterUnits: 'userSpaceOnUse', x: 0, y: 0, width: scale.size, height: scale.size
    });
    filter.append(
      svgElement('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.022, numOctaves: 2, seed: 4, result: 'noise' }),
      svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: 11, xChannelSelector: 'R', yChannelSelector: 'G' })
    );
    const answer = svgElement('g', { filter: 'url(#wobble)' });

    picture.asymptotes.forEach((asymptote) => {
      const line = asymptote.kind === 'vertical'
        ? { x1: scale.xFor(asymptote.input), x2: scale.xFor(asymptote.input), y1: 0, y2: scale.size }
        : {
          x1: 0,
          x2: scale.size,
          y1: scale.yFor(asymptote.slope * -limit + asymptote.start),
          y2: scale.yFor(asymptote.slope * limit + asymptote.start)
        };
      answer.append(svgElement('line', { class: 'asymptote', ...line }));
    });
    curvePaths(picture.curve, scale, limit).forEach((path) => {
      answer.append(svgElement('path', { class: 'truth', d: path }));
    });
    svg.append(filter, answer);
  }

  // Small arrows on the top or bottom edge where the curve leaves the graph.
  picture.exits.forEach((exit) => {
    const x = scale.xFor(exit.input);
    const points = exit.side === 'top'
      ? `${x - 8},16 ${x + 8},16 ${x},3`
      : `${x - 8},${scale.size - 16} ${x + 8},${scale.size - 16} ${x},${scale.size - 3}`;
    svg.append(svgElement('polygon', { class: 'exit', points }));
  });

  // The clue dots: spots that are on the curve, shown from the start.
  picture.dots.forEach(([x, y]) => {
    svg.append(svgElement('circle', { class: 'dot', cx: scale.xFor(x), cy: scale.yFor(y), r: 6 }));
  });

  if (picture.pen) {
    svg.append(svgElement('circle', {
      class: picture.pen.down ? 'pen down' : 'pen', cx: scale.xFor(picture.pen.x), cy: scale.yFor(picture.pen.y), r: 8
    }));
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
