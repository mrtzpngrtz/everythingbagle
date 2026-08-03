/* === CONNECTIONS / ARROWS === */
const Connections = {
  svg: null,
  drawing: null,

  // Thread physics
  threadSims: new Map(),   // connId -> { particles, restLen }
  _threadGroup: null,
  _physicsRunning: false,
  _lastPhysicsTime: 0,

  // Physics constants
  _N: 16,          // particles per thread
  _GRAVITY: 420,   // canvas units / s²
  _DAMPING: 0.988,
  _ITERS: 12,      // constraint iterations per step
  _SLACK: 1.3,     // rope length = SLACK × straight-line distance

  _nodes: new Map(), // connId -> { hit, main, label, kind }

  init() {
    this.svg = document.getElementById('connections-svg');
    this._ensureDefs();
    // Persistent group for thread paths — appended last so it stays on top
    this._threadGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this._threadGroup.id = 'thread-group';
    this.svg.appendChild(this._threadGroup);
    this.bindEvents();
    this.bindConnectionEvents();
  },

  _ensureDefs() {
    if (this.svg.querySelector('defs')) return;
    const defs = Utils.createSVGElement('defs');
    [['arrowhead', 10, 'auto'], ['arrowhead-start', 0, 'auto-start-reverse']].forEach(([id, refX, orient]) => {
      const marker = Utils.createSVGElement('marker', {
        id, markerWidth: 10, markerHeight: 7, refX, refY: 3.5, orient,
      });
      marker.appendChild(Utils.createSVGElement('polygon', {
        points: '0 0, 10 3.5, 0 7', class: 'connection-arrow',
      }));
      defs.appendChild(marker);
    });
    this.svg.appendChild(defs);
  },

  // Two delegated listeners for the whole SVG. Previously render() attached a
  // fresh dblclick + contextmenu pair per connection — on every pan frame.
  bindConnectionEvents() {
    this.svg.addEventListener('dblclick', (e) => {
      const target = e.target.closest('[data-connection-id]');
      if (!target) return;
      e.stopPropagation();
      const id = target.getAttribute('data-connection-id');
      App.connections = App.connections.filter(c => c.id !== id);
      this.threadSims.delete(id);
      this.render();
      App.saveState();
    });

    this.svg.addEventListener('contextmenu', (e) => {
      const target = e.target.closest('[data-connection-id]');
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const conn = App.connections.find(c => c.id === target.getAttribute('data-connection-id'));
      if (!conn) return;
      const styles = ['curve', 'arrow', 'line'];
      conn.style = styles[(styles.indexOf(conn.style) + 1) % styles.length];
      this.render();
      App.saveState();
    });
  },

  startDrawing(fromId, fromAnchor, event) {
    const fromData = Elements.getData(fromId);
    if (!fromData) return;

    const point = this.getAnchorPoint(fromData, fromAnchor);
    const screenPoint = Canvas.canvasToScreen(point.x, point.y);
    const rect = Canvas.getRect();

    const line = Utils.createSVGElement('line', {
      x1: screenPoint.x - rect.left,
      y1: screenPoint.y - rect.top,
      x2: screenPoint.x - rect.left,
      y2: screenPoint.y - rect.top,
      stroke: '#4a9eff',
      'stroke-width': 2,
      'stroke-dasharray': '6,3',
    });
    this.svg.appendChild(line);
    this.drawing = { fromId, fromAnchor, tempLine: line };
  },

  bindEvents() {
    window.addEventListener('mousemove', (e) => {
      if (!this.drawing) return;
      const rect = Canvas.getRect();
      this.drawing.tempLine.setAttribute('x2', e.clientX - rect.left);
      this.drawing.tempLine.setAttribute('y2', e.clientY - rect.top);
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.drawing) return;

      const target = e.target.closest('.canvas-element');
      if (target && target.dataset.id !== this.drawing.fromId) {
        const toId = target.dataset.id;
        const toData = Elements.getData(toId);
        const canvasPos = Canvas.screenToCanvas(e.clientX, e.clientY);
        const toAnchor = toData.type === 'pin' ? 'center' : this.closestAnchor(toData, canvasPos.x, canvasPos.y);

        const exists = App.connections.some(c =>
          (c.from === this.drawing.fromId && c.to === toId) ||
          (c.from === toId && c.to === this.drawing.fromId)
        );

        if (!exists) {
          const fromData = Elements.getData(this.drawing.fromId);
          const toData = Elements.getData(toId);
          const isThread = fromData?.type === 'pin' || toData?.type === 'pin';
          App.connections.push({
            id: Utils.id(),
            from: this.drawing.fromId,
            fromAnchor: fromData?.type === 'pin' ? 'center' : this.drawing.fromAnchor,
            to: toId,
            toAnchor: toAnchor,
            style: isThread ? 'line' : 'curve',
            label: '',
          });
          if (isThread) this.startPhysicsLoop();
          App.saveState();
        }
      }

      if (this.drawing.tempLine) this.drawing.tempLine.remove();
      this.drawing = null;
      this.render();
    });
  },

  getAnchorPoint(data, anchor) {
    const cx = data.x + data.width / 2;
    const cy = data.y + data.height / 2;
    switch (anchor) {
      case 'top':    return { x: cx, y: data.y };
      case 'bottom': return { x: cx, y: data.y + data.height };
      case 'left':   return { x: data.x, y: cy };
      case 'right':  return { x: data.x + data.width, y: cy };
      default:       return { x: cx, y: cy };
    }
  },

  closestAnchor(data, px, py) {
    const anchors = ['top', 'bottom', 'left', 'right'];
    let closest = 'top', minDist = Infinity;
    anchors.forEach(a => {
      const p = this.getAnchorPoint(data, a);
      const dist = Math.hypot(p.x - px, p.y - py);
      if (dist < minDist) { minDist = dist; closest = a; }
    });
    return closest;
  },

  // ── Physics ────────────────────────────────────────────

  _initThreadSim(connId, p0, p1) {
    const N = this._N;
    const straight = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const restLen = (straight * this._SLACK) / (N - 1);
    const particles = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = p0.x + (p1.x - p0.x) * t;
      // slight initial sag so the thread doesn't start straight
      const y = p0.y + (p1.y - p0.y) * t + Math.sin(t * Math.PI) * straight * 0.1;
      particles.push({ x, y, px: x, py: y });
    }
    this.threadSims.set(connId, { particles, restLen });
  },

  _stepPhysics(dt) {
    const N = this._N;
    const g = this._GRAVITY;
    const damp = this._DAMPING;
    const iters = this._ITERS;
    const clampedDt = Math.min(dt, 0.033);

    App.connections.forEach(conn => {
      const fromData = Elements.getData(conn.from);
      const toData   = Elements.getData(conn.to);
      if (!fromData || !toData) return;
      if (fromData.type !== 'pin' && toData.type !== 'pin') return;

      const p0 = this.getAnchorPoint(fromData, conn.fromAnchor);
      const p1 = this.getAnchorPoint(toData, conn.toAnchor);

      if (!this.threadSims.has(conn.id)) this._initThreadSim(conn.id, p0, p1);
      const sim = this.threadSims.get(conn.id);
      const { particles } = sim;

      // Adjust restLen if pins moved farther apart than initial rope length
      const curDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const effectiveRestLen = Math.max(sim.restLen, curDist / (N - 1));

      // Fix endpoints
      particles[0].x  = p0.x; particles[0].y  = p0.y;
      particles[0].px = p0.x; particles[0].py = p0.y;
      particles[N-1].x  = p1.x; particles[N-1].y  = p1.y;
      particles[N-1].px = p1.x; particles[N-1].py = p1.y;

      // Verlet integrate free particles
      for (let i = 1; i < N - 1; i++) {
        const p = particles[i];
        const vx = (p.x - p.px) * damp;
        const vy = (p.y - p.py) * damp;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + g * clampedDt * clampedDt;
      }

      // Constraint solve
      for (let iter = 0; iter < iters; iter++) {
        for (let i = 0; i < N - 1; i++) {
          const a = particles[i];
          const b = particles[i + 1];
          const aFixed = (i === 0);
          const bFixed = (i + 1 === N - 1);
          const cdx = b.x - a.x;
          const cdy = b.y - a.y;
          const d = Math.hypot(cdx, cdy);
          if (d < 0.0001) continue;
          const diff = (d - effectiveRestLen) / d;
          if (!aFixed && !bFixed) {
            a.x += cdx * diff * 0.5; a.y += cdy * diff * 0.5;
            b.x -= cdx * diff * 0.5; b.y -= cdy * diff * 0.5;
          } else if (aFixed) {
            b.x -= cdx * diff; b.y -= cdy * diff;
          } else {
            a.x += cdx * diff; a.y += cdy * diff;
          }
        }
        // Re-pin endpoints after each iteration
        particles[0].x = p0.x;   particles[0].y = p0.y;
        particles[N-1].x = p1.x; particles[N-1].y = p1.y;
      }
    });
  },

  _smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      // Catmull-Rom → cubic Bézier (tension = 0.5)
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  },

  _drawThreadPaths() {
    const rect = Canvas.getRect();

    // Update paths for existing thread connections
    App.connections.forEach(conn => {
      const fromData = Elements.getData(conn.from);
      const toData   = Elements.getData(conn.to);
      if (!fromData || !toData) return;
      if (fromData.type !== 'pin' && toData.type !== 'pin') return;

      const sim = this.threadSims.get(conn.id);
      if (!sim) return;

      let path = this._threadGroup.querySelector(`[data-connection-id="${conn.id}"]`);
      if (!path) {
        // Wide invisible hit area for thread
        const hitPath = Utils.createSVGElement('path', { 'data-connection-hit': conn.id, fill: 'none' });
        hitPath.setAttribute('stroke', 'transparent'); hitPath.setAttribute('stroke-width', '16'); hitPath.style.pointerEvents = 'stroke'; hitPath.style.cursor = 'pointer';
        hitPath.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          App.connections = App.connections.filter(c => c.id !== conn.id);
          this.threadSims.delete(conn.id);
          hitPath.remove(); path?.remove();
          App.saveState();
        });
        this._threadGroup.appendChild(hitPath);

        path = Utils.createSVGElement('path', {
          class: 'connection-line connection-thread',
          'data-connection-id': conn.id,
          fill: 'none',
        });
        path.style.pointerEvents = 'none';
        path.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          App.connections = App.connections.filter(c => c.id !== conn.id);
          this.threadSims.delete(conn.id);
          path.remove();
          App.saveState();
        });
        path.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // threads don't have style options — skip
        });
        this._threadGroup.appendChild(path);
      }

      const pts = sim.particles.map(p => {
        const s = Canvas.canvasToScreen(p.x, p.y);
        return { x: s.x - rect.left, y: s.y - rect.top };
      });
      const smoothD = this._smoothPath(pts);
      path.setAttribute('d', smoothD);
      const hitP = this._threadGroup.querySelector(`[data-connection-hit="${conn.id}"]`);
      if (hitP) hitP.setAttribute('d', smoothD);
    });

    // Remove stale thread paths and hit areas
    this._threadGroup.querySelectorAll('[data-connection-id]').forEach(el => {
      const id = el.getAttribute('data-connection-id');
      if (!App.connections.find(c => c.id === id)) el.remove();
    });
    this._threadGroup.querySelectorAll('[data-connection-hit]').forEach(el => {
      const id = el.getAttribute('data-connection-hit');
      if (!App.connections.find(c => c.id === id)) el.remove();
    });
  },

  startPhysicsLoop() {
    if (this._physicsRunning) return;
    this._physicsRunning = true;
    this._lastPhysicsTime = performance.now();
    const tick = (now) => {
      if (!this._physicsRunning) return;
      const dt = (now - this._lastPhysicsTime) / 1000;
      this._lastPhysicsTime = now;
      this._stepPhysics(dt);
      this._drawThreadPaths();
      const hasThreads = App.connections.some(conn => {
        const f = Elements.getData(conn.from);
        const t = Elements.getData(conn.to);
        return f?.type === 'pin' || t?.type === 'pin';
      });
      if (hasThreads) {
        requestAnimationFrame(tick);
      } else {
        this._physicsRunning = false;
      }
    };
    requestAnimationFrame(tick);
  },

  // ── Static rendering ───────────────────────────────────

  // Reuses the existing SVG nodes and only writes coordinates. The old version
  // tore the whole SVG down and rebuilt it — plus two listeners per connection —
  // on every pan, zoom, drag and resize event.
  render() {
    const conns = App.connections;
    if (conns.length === 0 && this._nodes.size === 0) return; // nothing to do at all

    const rect = Canvas.getRect();
    const seen = new Set();
    let hasThreads = false;

    conns.forEach(conn => {
      const fromData = Elements.getData(conn.from);
      const toData   = Elements.getData(conn.to);
      if (!fromData || !toData) return;

      // Threads are drawn by the physics loop
      if (fromData.type === 'pin' || toData.type === 'pin') { hasThreads = true; return; }

      const fromPt = this.getAnchorPoint(fromData, conn.fromAnchor);
      const toPt   = this.getAnchorPoint(toData, conn.toAnchor);
      const fromScreen = Canvas.canvasToScreen(fromPt.x, fromPt.y);
      const toScreen   = Canvas.canvasToScreen(toPt.x, toPt.y);

      this._syncConnection(conn, {
        x1: fromScreen.x - rect.left,
        y1: fromScreen.y - rect.top,
        x2: toScreen.x - rect.left,
        y2: toScreen.y - rect.top,
      });
      seen.add(conn.id);
    });

    // Drop nodes for connections that no longer exist
    this._nodes.forEach((node, id) => {
      if (seen.has(id)) return;
      node.hit.remove();
      node.main.remove();
      node.label?.remove();
      this._nodes.delete(id);
    });

    this._drawThreadPaths();
    if (hasThreads) this.startPhysicsLoop();
  },

  _syncConnection(conn, p) {
    const kind = conn.style === 'curve' ? 'curve' : 'line';
    let node = this._nodes.get(conn.id);

    // A style switch changes the element type, so those nodes get replaced
    if (node && node.kind !== kind) {
      node.hit.remove();
      node.main.remove();
      node.label?.remove();
      node = null;
    }

    if (!node) {
      const tag = kind === 'curve' ? 'path' : 'line';
      const hit = Utils.createSVGElement(tag, { 'data-connection-id': conn.id });
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '16');
      if (kind === 'curve') hit.setAttribute('fill', 'none');
      hit.style.pointerEvents = 'stroke';
      hit.style.cursor = 'pointer';
      const main = Utils.createSVGElement(tag, { class: 'connection-line', 'data-connection-id': conn.id });
      main.style.pointerEvents = 'none';
      // Insert before the thread group so threads keep painting on top
      this.svg.insertBefore(hit, this._threadGroup);
      this.svg.insertBefore(main, this._threadGroup);
      node = { hit, main, label: null, kind };
      this._nodes.set(conn.id, node);
    }

    if (kind === 'curve') {
      const dx = Math.abs(p.x2 - p.x1) * 0.5;
      const cp1x = conn.fromAnchor === 'right' ? p.x1 + dx : conn.fromAnchor === 'left' ? p.x1 - dx : p.x1;
      const cp1y = conn.fromAnchor === 'bottom' ? p.y1 + dx : conn.fromAnchor === 'top' ? p.y1 - dx : p.y1;
      const cp2x = conn.toAnchor === 'right' ? p.x2 + dx : conn.toAnchor === 'left' ? p.x2 - dx : p.x2;
      const cp2y = conn.toAnchor === 'bottom' ? p.y2 + dx : conn.toAnchor === 'top' ? p.y2 - dx : p.y2;
      const d = `M ${p.x1} ${p.y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p.x2} ${p.y2}`;
      node.hit.setAttribute('d', d);
      node.main.setAttribute('d', d);
    } else {
      ['x1', 'y1', 'x2', 'y2'].forEach(k => {
        node.hit.setAttribute(k, p[k]);
        node.main.setAttribute(k, p[k]);
      });
    }

    const stroke = conn.color || null;
    const dash = conn.lineStyle === 'dashed' ? '8 4' : conn.lineStyle === 'dotted' ? '3 3' : null;
    this._setAttr(node.main, 'stroke', stroke);
    this._setAttr(node.main, 'stroke-dasharray', dash);
    this._setAttr(node.main, 'marker-end', conn.style !== 'line' ? 'url(#arrowhead)' : null);
    this._setAttr(node.main, 'marker-start', conn.arrowhead === 'both' ? 'url(#arrowhead-start)' : null);

    if (conn.label) {
      if (!node.label) {
        node.label = Utils.createSVGElement('text', { class: 'connection-label' });
        this.svg.insertBefore(node.label, this._threadGroup);
      }
      node.label.setAttribute('x', (p.x1 + p.x2) / 2);
      node.label.setAttribute('y', (p.y1 + p.y2) / 2 - 8);
      if (node.label.textContent !== conn.label) node.label.textContent = conn.label;
    } else if (node.label) {
      node.label.remove();
      node.label = null;
    }
  },

  _setAttr(el, name, value) {
    if (value == null || value === '') el.removeAttribute(name);
    else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, value);
  },

  removeForElement(id) {
    // Clean up thread sims for removed element's connections
    App.connections.filter(c => c.from === id || c.to === id)
      .forEach(c => this.threadSims.delete(c.id));
    App.connections = App.connections.filter(c => c.from !== id && c.to !== id);
    this.render();
  },
};
