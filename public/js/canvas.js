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
    this._coordEl = document.getElementById('cursor-coord');
    this._zoomEl = document.getElementById('zoom-level');

    // Center canvas
    this.panX = window.innerWidth / 2;
    this.panY = (window.innerHeight - 40) / 2;

    // The container moves and resizes with flow mode and the sidebar, so watch it
    // rather than sprinkling invalidateRect() through every toggle.
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.invalidateRect()).observe(this.container);
    }
    window.addEventListener('scroll', () => this.invalidateRect(), true);
    window.addEventListener('resize', () => this.invalidateRect());

    this.bindEvents();
    this.updateTransform();
    this.initGrid();
    this.applyGrid();
  },

  // screenToCanvas/canvasToScreen used to call getBoundingClientRect() every
  // invocation — once per connection endpoint per frame, interleaved with SVG
  // writes, which forces a layout each time.
  getRect() {
    if (!this._rect) this._rect = this.container.getBoundingClientRect();
    return this._rect;
  },

  invalidateRect() { this._rect = null; },

  bindEvents() {
    // Wheel zoom
    this.container.addEventListener('wheel', (e) => {
      // Let scroll pass through to scrollable inner elements
      const scrollable = e.target.closest('.el-text--boxed, .todo-items, .cal-agenda, .llm-messages');
      if (scrollable) {
        scrollable.scrollTop += e.deltaY;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = this.getRect();
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
      this._lastPointer = { x: e.clientX, y: e.clientY };
      Frame.schedule('overlays', () => this.updateCursorReadout());

      if (this.isPanning) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.panX += dx;
        this.panY += dy;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        // Only now is the view genuinely moving — a mousedown alone must not
        // disable hit-testing, or the click that follows lands on the container.
        this.container.classList.add('pan-active');
        this.scheduleViewUpdate();
      }
    });

    window.addEventListener('mouseup', (e) => {
      this.container.classList.remove('pan-active');
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
      this.invalidateRect();
      this.applyGrid();
      this.invalidateMinimap();
      this.updateMinimap();
    }, 200));
  },

  updateCursorReadout() {
    if (!this._coordEl || !this._lastPointer) return;
    const pos = this.screenToCanvas(this._lastPointer.x, this._lastPointer.y);
    this._coordEl.textContent = `${Math.round(pos.x)}, ${Math.round(pos.y)}`;
  },

  // Everything pan/zoom touches, collapsed into one frame
  scheduleViewUpdate() {
    Frame.schedule('transform', () => this.updateTransform());
    Frame.schedule('grid', () => this.applyGrid());
    Frame.schedule('connections', () => Connections.render());
    // drawMinimapContent is a no-op unless something marked the map dirty, so
    // this stays cheap while still picking up geometry changes.
    Frame.schedule('minimap', () => { this.drawMinimapContent(); this.updateMinimapViewport(); });
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
          const rect = this.getRect();
          const cx = midX - rect.left;
          const cy = midY - rect.top;
          const newZoom = Utils.clamp(this.zoom * factor, this.minZoom, this.maxZoom);
          const scale = newZoom / this.zoom;
          this.panX = cx - (cx - this.panX) * scale + (midX - lastMidX);
          this.panY = cy - (cy - this.panY) * scale + (midY - lastMidY);
          this.zoom = newZoom;
          this.scheduleViewUpdate();
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
          this.container.classList.add('pan-active');
          this.scheduleViewUpdate();
        }
      }
    }, { passive: false });

    this.container.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        lastTouchDist = 0;
      }
      if (e.touches.length === 0) {
        this.container.classList.remove('pan-active');
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
    this.scheduleViewUpdate();
  },

  updateTransform() {
    this.canvasEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    if (this._zoomEl) this._zoomEl.textContent = Math.round(this.zoom * 100);
    if (typeof Collab !== 'undefined') Collab._repositionAllCursors();
    if (typeof Properties !== 'undefined') Properties.updatePosition();
  },

  screenToCanvas(sx, sy) {
    const rect = this.getRect();
    return {
      x: (sx - rect.left - this.panX) / this.zoom,
      y: (sy - rect.top - this.panY) / this.zoom,
    };
  },

  canvasToScreen(cx, cy) {
    const rect = this.getRect();
    return {
      x: cx * this.zoom + this.panX + rect.left,
      y: cy * this.zoom + this.panY + rect.top,
    };
  },

  // The grid used to be torn down and rebuilt — 250-500 <line> nodes — on every
  // single mousemove. Both layers are patterns now: the nodes are created once
  // and panning only moves the pattern origin.
  initGrid() {
    const svg = this.gridSvg;
    svg.innerHTML = `
      <defs>
        <pattern id="grid-dots" patternUnits="userSpaceOnUse">
          <circle class="grid-dot"/>
        </pattern>
        <pattern id="grid-crosses" patternUnits="userSpaceOnUse">
          <line class="grid-cross" data-cross="h"/>
          <line class="grid-cross" data-cross="v"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-dots)"/>
      <rect width="100%" height="100%" fill="url(#grid-crosses)"/>`;
    this._grid = {
      dots: svg.querySelector('#grid-dots'),
      dot: svg.querySelector('.grid-dot'),
      crosses: svg.querySelector('#grid-crosses'),
      ch: svg.querySelector('[data-cross="h"]'),
      cv: svg.querySelector('[data-cross="v"]'),
    };
  },

  applyGrid() {
    const g = this._grid;
    if (!g) return;

    let baseSpacing = 40;
    let spacing = baseSpacing * this.zoom;
    while (spacing < 20) { spacing *= 2; baseSpacing *= 2; }
    while (spacing > 80) { spacing /= 2; baseSpacing /= 2; }

    g.dots.setAttribute('width', spacing);
    g.dots.setAttribute('height', spacing);
    g.dots.setAttribute('x', this.panX % spacing);
    g.dots.setAttribute('y', this.panY % spacing);
    g.dot.setAttribute('cx', spacing / 2);
    g.dot.setAttribute('cy', spacing / 2);
    g.dot.setAttribute('r', Math.max(0.8, this.zoom * 0.9));

    // Cross (+) registration markers every 8 grid cells. The cross sits at the
    // tile centre so its arms aren't clipped by the tile edge.
    const step = baseSpacing * 8 * this.zoom;
    const c = step / 2;
    const arm = 7;
    g.crosses.setAttribute('width', step);
    g.crosses.setAttribute('height', step);
    g.crosses.setAttribute('x', (this.panX % step) - c);
    g.crosses.setAttribute('y', (this.panY % step) - c);
    g.ch.setAttribute('x1', c - arm); g.ch.setAttribute('y1', c);
    g.ch.setAttribute('x2', c + arm); g.ch.setAttribute('y2', c);
    g.cv.setAttribute('x1', c); g.cv.setAttribute('y1', c - arm);
    g.cv.setAttribute('x2', c); g.cv.setAttribute('y2', c + arm);
  },

  // Kept for the existing call sites; colours now come from CSS variables so a
  // theme switch needs no redraw at all.
  drawGrid() { this.applyGrid(); },

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

  _mm: { minX: 0, minY: 0, scale: 1, dirty: true, empty: true },

  invalidateMinimap() { this._mm.dirty = true; },

  // Content only needs redrawing when elements change; panning just moves the
  // viewport rectangle, which is four style writes.
  drawMinimapContent() {
    if (!this._mm.dirty) return;
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const isDark = document.body.classList.contains('dark');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = isDark ? '#1A1A1A' : '#FAFAFA';
    ctx.fillRect(0, 0, w, h);

    const elements = App.elements;
    this._mm.empty = elements.length === 0;
    this._mm.dirty = false;
    if (this._mm.empty) {
      const vp = document.getElementById('minimap-viewport');
      if (vp) vp.style.display = 'none';
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
    const scale = Math.min(w / (maxX - minX), h / (maxY - minY));
    this._mm.minX = minX;
    this._mm.minY = minY;
    this._mm.scale = scale;

    // Two buckets, so the canvas state is set twice instead of 4x per element
    const buckets = [
      { list: elements.filter(el => el.type === 'image'), fill: isDark ? '#333333' : '#CCCCCC' },
      { list: elements.filter(el => el.type !== 'image'), fill: isDark ? '#2A2A2A' : '#E0E0E0' },
    ];
    ctx.strokeStyle = isDark ? '#E8E8E8' : '#111111';
    ctx.lineWidth = 0.5;
    buckets.forEach(({ list, fill }) => {
      if (!list.length) return;
      ctx.fillStyle = fill;
      ctx.beginPath();
      list.forEach(el => {
        ctx.rect(
          (el.x - minX) * scale, (el.y - minY) * scale,
          Math.max((el.width || 100) * scale, 2), Math.max((el.height || 60) * scale, 2),
        );
      });
      ctx.fill();
      ctx.stroke();
    });
  },

  updateMinimapViewport() {
    // Never trust a latched 'empty' — elements can appear through paths that
    // only invalidate, and the viewport rect would stay hidden forever.
    if (this._mm.dirty) this.drawMinimapContent();
    if (this._mm.empty) return;
    const canvas = document.getElementById('minimap-canvas');
    const vp = document.getElementById('minimap-viewport');
    if (!canvas || !vp) return;

    const { minX, minY, scale } = this._mm;
    const rect = this.getRect();
    const vpLeft = (-this.panX / this.zoom - minX) * scale;
    const vpTop = (-this.panY / this.zoom - minY) * scale;

    vp.style.display = 'block';
    vp.style.left = Utils.clamp(vpLeft, 0, canvas.width) + 'px';
    vp.style.top = (Utils.clamp(vpTop, 0, canvas.height) + 20) + 'px'; // offset for minimap label
    vp.style.width = Math.min((rect.width / this.zoom) * scale, canvas.width) + 'px';
    vp.style.height = Math.min((rect.height / this.zoom) * scale, canvas.height) + 'px';
  },

  updateMinimap() {
    this.invalidateMinimap();
    this.drawMinimapContent();
    this.updateMinimapViewport();
  },
};
