/* === CANVAS (Pan / Zoom / Grid) === */
const Canvas = {
  panX: 0,
  panY: 0,
  zoom: 1,
  minZoom: 0.1,
  maxZoom: 5,
  isPanning: false,
  lastMouse: { x: 0, y: 0 },
  spaceDown: false,

  container: null,
  canvasEl: null,
  gridSvg: null,

  init() {
    this.container = document.getElementById('canvas-container');
    this.canvasEl = document.getElementById('canvas');
    this.gridSvg = document.getElementById('grid-svg');

    // Center canvas
    this.panX = window.innerWidth / 2;
    this.panY = (window.innerHeight - 40) / 2;

    this.bindEvents();
    this.updateTransform();
    this.drawGrid();
  },

  bindEvents() {
    // Wheel zoom
    this.container.addEventListener('wheel', (e) => {
      // Let scroll pass through to scrollable inner elements
      const scrollable = e.target.closest('.el-text--boxed, .todo-items, .cal-agenda');
      if (scrollable) {
        scrollable.scrollTop += e.deltaY;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = this.container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.zoomAt(mx, my, delta);
    }, { passive: false });

    // Middle mouse pan / space pan / pan tool
    this.container.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && this.spaceDown) || (e.button === 0 && App.currentTool === 'pan')) {
        e.preventDefault();
        this.isPanning = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.container.classList.add('panning');
      }
    });

    window.addEventListener('mousemove', (e) => {
      // Update cursor coords
      if (this.container) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);
        const coordEl = document.getElementById('cursor-coord');
        if (coordEl) {
          coordEl.textContent = `${Math.round(pos.x)}, ${Math.round(pos.y)}`;
        }
      }

      if (this.isPanning) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.panX += dx;
        this.panY += dy;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.updateTransform();
        this.drawGrid();
        Connections.render();
        this.updateMinimap();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        this.container.classList.remove('panning');
      }
    });

    // Space key for pan
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.target.closest('[contenteditable]') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.spaceDown = true;
        this.container.classList.add('panning');
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        if (!this.isPanning) {
          this.container.classList.remove('panning');
        }
      }
    });

    // Zoom buttons
    document.getElementById('zoom-in').addEventListener('click', () => {
      const cx = this.container.clientWidth / 2;
      const cy = this.container.clientHeight / 2;
      this.zoomAt(cx, cy, 1.2);
    });

    document.getElementById('zoom-out').addEventListener('click', () => {
      const cx = this.container.clientWidth / 2;
      const cy = this.container.clientHeight / 2;
      this.zoomAt(cx, cy, 0.8);
    });

    document.getElementById('zoom-fit').addEventListener('click', () => this.fitAll());

    // Resize
    window.addEventListener('resize', Utils.debounce(() => {
      this.drawGrid();
      this.updateMinimap();
    }, 200));
  },

  bindTouchEvents() {
    let touchStartX = 0, touchStartY = 0;
    let lastTouchDist = 0, lastMidX = 0, lastMidY = 0;
    let touchPanning = false;

    this.container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        touchPanning = false;
        lastTouchDist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
        lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      } else if (e.touches.length === 1) {
        const tool = App.currentTool;
        if (tool === 'select' || tool === 'pan') {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          touchPanning = false;
        }
      }
    }, { passive: false });

    this.container.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (lastTouchDist > 0) {
          const factor = dist / lastTouchDist;
          const rect = this.container.getBoundingClientRect();
          const cx = midX - rect.left;
          const cy = midY - rect.top;
          const newZoom = Utils.clamp(this.zoom * factor, this.minZoom, this.maxZoom);
          const scale = newZoom / this.zoom;
          this.panX = cx - (cx - this.panX) * scale + (midX - lastMidX);
          this.panY = cy - (cy - this.panY) * scale + (midY - lastMidY);
          this.zoom = newZoom;
          this.updateTransform();
          this.drawGrid();
          Connections.render();
          this.updateMinimap();
        }
        lastTouchDist = dist;
        lastMidX = midX;
        lastMidY = midY;
      } else if (e.touches.length === 1) {
        const tool = App.currentTool;
        if (tool !== 'select' && tool !== 'pan') return;
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (!touchPanning && Math.sqrt(dx * dx + dy * dy) > 8) {
          touchPanning = true;
          this.container.classList.add('panning');
        }
        if (touchPanning) {
          e.preventDefault();
          this.panX += e.touches[0].clientX - touchStartX;
          this.panY += e.touches[0].clientY - touchStartY;
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          this.updateTransform();
          this.drawGrid();
          Connections.render();
          this.updateMinimap();
        }
      }
    }, { passive: false });

    this.container.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        lastTouchDist = 0;
      }
      if (e.touches.length === 0) {
        if (touchPanning) {
          touchPanning = false;
          this.container.classList.remove('panning');
        }
      }
    });
  },

  zoomAt(cx, cy, factor) {
    const newZoom = Utils.clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const scale = newZoom / this.zoom;
    this.panX = cx - (cx - this.panX) * scale;
    this.panY = cy - (cy - this.panY) * scale;
    this.zoom = newZoom;
    this.updateTransform();
    this.drawGrid();
    Connections.render();
    this.updateMinimap();
  },

  updateTransform() {
    this.canvasEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    document.getElementById('zoom-level').textContent = Math.round(this.zoom * 100);
    if (typeof Collab !== 'undefined') Collab._repositionAllCursors();
    if (typeof Properties !== 'undefined') Properties.updatePosition();
  },

  screenToCanvas(sx, sy) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.panX) / this.zoom,
      y: (sy - rect.top - this.panY) / this.zoom,
    };
  },

  canvasToScreen(cx, cy) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: cx * this.zoom + this.panX + rect.left,
      y: cy * this.zoom + this.panY + rect.top,
    };
  },

  drawGrid() {
    const svg = this.gridSvg;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.innerHTML = '';

    let baseSpacing = 40;
    let spacing = baseSpacing * this.zoom;
    while (spacing < 20) { spacing *= 2; baseSpacing *= 2; }
    while (spacing > 80) { spacing /= 2; baseSpacing /= 2; }

    const offsetX = this.panX % spacing;
    const offsetY = this.panY % spacing;
    const dotSize = Math.max(0.8, this.zoom * 0.9);

    // Dot pattern
    const defs = Utils.createSVGElement('defs');
    const pattern = Utils.createSVGElement('pattern', {
      id: 'grid-dots',
      width: spacing,
      height: spacing,
      patternUnits: 'userSpaceOnUse',
      x: offsetX,
      y: offsetY,
    });
    const isDark = document.body.classList.contains('dark');
    const dot = Utils.createSVGElement('circle', {
      cx: spacing / 2,
      cy: spacing / 2,
      r: dotSize,
      fill: isDark ? '#2A2A2A' : '#DDDDDD',
    });
    pattern.appendChild(dot);
    defs.appendChild(pattern);
    svg.appendChild(defs);

    const rect = Utils.createSVGElement('rect', {
      width: '100%',
      height: '100%',
      fill: 'url(#grid-dots)',
    });
    svg.appendChild(rect);

    // Cross (+) registration markers every 8 grid cells
    const crossStep = baseSpacing * 8;
    const crossSvgStep = crossStep * this.zoom;
    const crossOffX = this.panX % crossSvgStep;
    const crossOffY = this.panY % crossSvgStep;
    const crossColor = isDark ? '#303030' : '#C0C0C0';
    const arm = 7;
    for (let x = crossOffX - crossSvgStep; x < w + crossSvgStep; x += crossSvgStep) {
      for (let y = crossOffY - crossSvgStep; y < h + crossSvgStep; y += crossSvgStep) {
        const hLine = Utils.createSVGElement('line', { x1: x - arm, y1: y, x2: x + arm, y2: y, stroke: crossColor, 'stroke-width': '0.5' });
        const vLine = Utils.createSVGElement('line', { x1: x, y1: y - arm, x2: x, y2: y + arm, stroke: crossColor, 'stroke-width': '0.5' });
        svg.appendChild(hLine);
        svg.appendChild(vLine);
      }
    }

  },

  fitAll() {
    const elements = App.elements;
    if (elements.length === 0) {
      this.panX = this.container.clientWidth / 2;
      this.panY = this.container.clientHeight / 2;
      this.zoom = 1;
      this.updateTransform();
      this.drawGrid();
      Connections.render();
      this.updateMinimap();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach(el => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + (el.width || 100));
      maxY = Math.max(maxY, el.y + (el.height || 100));
    });

    const padding = 80;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const viewW = this.container.clientWidth;
    const viewH = this.container.clientHeight;

    this.zoom = Utils.clamp(Math.min(viewW / contentW, viewH / contentH), this.minZoom, this.maxZoom);
    this.panX = (viewW - contentW * this.zoom) / 2 - minX * this.zoom + padding * this.zoom;
    this.panY = (viewH - contentH * this.zoom) / 2 - minY * this.zoom + padding * this.zoom;

    this.updateTransform();
    this.drawGrid();
    Connections.render();
    this.updateMinimap();
  },

  updateMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    const vp = document.getElementById('minimap-viewport');
    const w = canvas.width;
    const h = canvas.height;

    const isDark = document.body.classList.contains('dark');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = isDark ? '#1A1A1A' : '#FAFAFA';
    ctx.fillRect(0, 0, w, h);

    const elements = App.elements;
    if (elements.length === 0) {
      vp.style.display = 'none';
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach(el => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + (el.width || 100));
      maxY = Math.max(maxY, el.y + (el.height || 100));
    });

    const pad = 100;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const cw = maxX - minX;
    const ch = maxY - minY;
    const scale = Math.min(w / cw, h / ch);

    elements.forEach(el => {
      const ex = (el.x - minX) * scale;
      const ey = (el.y - minY) * scale;
      const ew = (el.width || 100) * scale;
      const eh = (el.height || 60) * scale;

      ctx.fillStyle = isDark ? (el.type === 'image' ? '#333333' : '#2A2A2A') : (el.type === 'image' ? '#CCCCCC' : '#E0E0E0');
      ctx.strokeStyle = isDark ? '#E8E8E8' : '#111111';
      ctx.lineWidth = 0.5;
      ctx.fillRect(ex, ey, Math.max(ew, 2), Math.max(eh, 2));
      ctx.strokeRect(ex, ey, Math.max(ew, 2), Math.max(eh, 2));
    });

    // Viewport rect
    const containerRect = this.container.getBoundingClientRect();
    const vpLeft = (-this.panX / this.zoom - minX) * scale;
    const vpTop = (-this.panY / this.zoom - minY) * scale;
    const vpWidth = (containerRect.width / this.zoom) * scale;
    const vpHeight = (containerRect.height / this.zoom) * scale;

    vp.style.display = 'block';
    vp.style.left = Utils.clamp(vpLeft, 0, w) + 'px';
    vp.style.top = (Utils.clamp(vpTop, 0, h) + 20) + 'px'; // offset for minimap label
    vp.style.width = Math.min(vpWidth, w) + 'px';
    vp.style.height = Math.min(vpHeight, h) + 'px';
  },
};
