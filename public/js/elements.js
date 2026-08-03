/* === ELEMENTS === */
const Elements = {
  selected: [],
  dragging: null,
  resizing: null,
  imgPanning: null,
  cropDragging: null,
  dragStart: null,
  resizeStart: null,
  clipboard: [],
  maxZIndex: 1,
  get drawSettings() {
    if (!this._drawSettings) {
      const dark = document.body?.classList.contains('dark');
      this._drawSettings = { strokeColor: dark ? '#E0E0E0' : '#111111', strokeWidth: 2, strokeStyle: 'solid' };
    }
    return this._drawSettings;
  },
  set drawSettings(v) { this._drawSettings = v; },

  _dashArray(style, width) {
    const w = width || 2;
    if (style === 'dashed') return `${w * 4},${w * 2}`;
    if (style === 'dotted') return `${w},${w * 2}`;
    return null;
  },

  // Media keeps its aspect ratio while scaling unless the user says otherwise.
  // An explicit lockedRatio (properties panel) always wins over the default.
  isRatioLocked(data) {
    if (!data) return false;
    if (data.lockedRatio !== undefined) return !!data.lockedRatio;
    if (data.type === 'image' || data.type === 'icon' || data.type === 'draw') return true;
    if (data.type === 'file' && data.thumbnailUrl) return true;
    return false;
  },

  init() {
    // Marks the read-only viewer so CSS can make the ▶ overlay clickable there.
    // In the editor its children stay non-interactive so dragging keeps working.
    if (App.READ_ONLY) document.body.classList.add('read-only');
    if (!App.READ_ONLY) this.bindCanvasEvents();
    this.bindViewerEvents();
  },

  bindViewerEvents() {
    const container = Canvas.container;
    container.addEventListener('click', (e) => {
      if (!e.target.closest('.file-play')) return;
      const elementDom = e.target.closest('.canvas-element');
      if (!elementDom) return;
      const data = this.getData(elementDom.dataset.id);
      if (data?.url) FileViewer.open(data);
    });
    container.addEventListener('dblclick', (e) => {
      if (App.READ_ONLY) {
        const elementDom = e.target.closest('.canvas-element');
        if (!elementDom) return;
        const data = this.getData(elementDom.dataset.id);
        if (!data) return;
        if (data.type === 'file' && data.url) FileViewer.open(data);
        if (data.type === 'image' && data.url) FileViewer.openImage(data.url, data.originalName || 'image');
      }
    });
  },

  create(type, x, y, extra = {}) {
    const dark = document.body.classList.contains('dark');
    const defaultColor = dark ? '#E8E8E8' : '#111111';
    const defaults = {
      id: Utils.id(),
      type,
      x, y,
      width: 200,
      height: 120,
      zIndex: ++this.maxZIndex,
      locked: false,
      color: defaultColor,
      borderColor: defaultColor,
      ...extra,
    };

    switch (type) {
      case 'text':
        defaults.width = 200;
        defaults.height = 30;
        defaults.content = extra.content || '';
        defaults.fontSize = 14;
        defaults.boxed = extra.boxed || false;
        defaults.textAlign = extra.textAlign || 'left';
        break;
      case 'heading':
        defaults.width = 500;
        defaults.height = 70;
        defaults.content = extra.content || 'Headline';
        defaults.fontSize = 50;
        break;
      case 'note':
        defaults.width = 220;
        defaults.height = 160;
        defaults.content = extra.content || '';
        defaults.noteColor = extra.noteColor || 'default';
        break;
      case 'image':
        defaults.width = extra.width || 300;
        defaults.height = extra.height || 200;
        defaults.url = extra.url || '';
        defaults.originalName = extra.originalName || '';
        defaults.imageZoom = extra.imageZoom || 100;
        break;
      case 'file':
        // Video thumbnails pass their own dimensions so the card keeps the clip's ratio
        defaults.width = extra.width || 160;
        defaults.height = extra.height || 120;
        defaults.url = extra.url || '';
        defaults.originalName = extra.originalName || 'file';
        defaults.fileSize = extra.fileSize || 0;
        defaults.mimetype = extra.mimetype || '';
        break;
      case 'rect':
        defaults.width = extra.width || 200;
        defaults.height = extra.height || 150;
        defaults.fillColor = 'transparent';
        break;
      case 'circle':
        defaults.width = extra.width || 150;
        defaults.height = extra.height || 150;
        defaults.fillColor = 'transparent';
        break;
      case 'icon':
        defaults.width = 48;
        defaults.height = 48;
        defaults.fontSize = 48;
        defaults.icon = extra.icon || '●';
        break;
      case 'todo':
        defaults.width = 260;
        defaults.height = 200;
        defaults.title = extra.title || 'Tasks';
        defaults.items = extra.items || [];
        break;
      case 'draw':
        defaults.points = extra.points || [];
        defaults.strokeColor = extra.strokeColor || Elements.drawSettings.strokeColor;
        defaults.strokeWidth = extra.strokeWidth || Elements.drawSettings.strokeWidth;
        defaults.strokeStyle = extra.strokeStyle || Elements.drawSettings.strokeStyle || 'solid';
        defaults.width = extra.width || 100;
        defaults.height = extra.height || 100;
        break;
      case 'pin':
        defaults.width = 28;
        defaults.height = 28;
        break;
      case 'llmchat':
        defaults.width = 360;
        defaults.height = 480;
        defaults.title = extra.title || 'Chat';
        defaults.messages = extra.messages || [];
        break;
      case 'calendar': {
        const now = new Date();
        defaults.width = 280;
        defaults.height = 300;
        defaults.viewYear   = extra.viewYear   || now.getFullYear();
        defaults.viewMonth  = extra.viewMonth  || (now.getMonth() + 1);
        defaults.calendarId = extra.calendarId || 'primary';
        defaults.viewMode   = extra.viewMode   || 'month';
        break;
      }
    }

    return defaults;
  },

  renderElement(data) {
    const el = document.createElement('div');
    el.className = 'canvas-element';
    el.dataset.id = data.id;
    if (data.groupId) el.dataset.groupId = data.groupId;
    el.style.left = data.x + 'px';
    el.style.top = data.y + 'px';
    el.style.width = data.width + 'px';
    el.style.height = ((data.type === 'text' && !data.boxed) || data.type === 'heading') ? 'auto' : data.height + 'px';
    el.style.zIndex = data.zIndex;

    if (data.locked) el.classList.add('locked');

    let inner;
    switch (data.type) {
      case 'text':
        inner = document.createElement('div');
        inner.className = 'el-text' + (data.boxed ? ' el-text--boxed' : '');
        inner.innerHTML = DOMPurify.sanitize(data.content || '', { ALLOWED_TAGS: ['b','strong','i','em','u','br'] });
        inner.style.fontSize = (data.fontSize || 14) + 'px';
        if (data.color) inner.style.color = data.color;
        inner.style.textAlign = data.textAlign || 'left';
        el.appendChild(inner);
        if (data.boxed) {
          const expandBtn = document.createElement('div');
          expandBtn.className = 'text-expand-btn';
          expandBtn.textContent = '+';
          expandBtn.title = 'Expand to fit content';
          expandBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const d = this.getData(data.id);
            if (d) {
              const newH = inner.scrollHeight + 20;
              this.updateElement(data.id, { height: newH });
              d.height = newH;
              App.saveState();
              this.checkTextOverflow(el);
            }
          });
          el.appendChild(expandBtn);
          el.style.overflow = 'visible';
          setTimeout(() => this.checkTextOverflow(el), 0);
        }
        break;

      case 'heading':
        inner = document.createElement('div');
        inner.className = 'el-heading';
        inner.innerHTML = DOMPurify.sanitize(data.content || '', { ALLOWED_TAGS: ['b','strong','i','em','u','br'] });
        inner.style.fontSize = (data.fontSize || 50) + 'px';
        if (data.color) inner.style.color = data.color;
        inner.style.fontWeight = data.fontWeight || '700';
        el.appendChild(inner);
        break;

      case 'note':
        inner = document.createElement('div');
        inner.className = 'el-note';
        if (data.noteColor && data.noteColor !== 'default') {
          inner.classList.add('note-' + data.noteColor);
        }
        inner.innerHTML = DOMPurify.sanitize(data.content || '', { ALLOWED_TAGS: ['b','strong','i','em','u','br'] });
        inner.style.width = '100%';
        inner.style.height = '100%';
        el.appendChild(inner);
        break;

      case 'image':
        inner = document.createElement('div');
        inner.className = 'el-image';
        inner.style.width = '100%';
        inner.style.height = '100%';
        if (data.cropTop || data.cropRight || data.cropBottom || data.cropLeft) {
          inner.style.clipPath = `inset(${data.cropTop||0}% ${data.cropRight||0}% ${data.cropBottom||0}% ${data.cropLeft||0}%)`;
        }
        if (data.url) {
          const img = document.createElement('img');
          // Canvas paints the downscaled variant; data.url stays the original for
          // the viewer, clipboard and export.
          img.src = data.displayUrl || data.url;
          img.alt = data.originalName || '';
          img.draggable = false;
          img.decoding = 'async';
          img.loading = 'lazy';
          if (data.displayW) { img.width = data.displayW; img.height = data.displayH; }
          img.style.transform = `translate(${data.imgOffsetX||0}px, ${data.imgOffsetY||0}px) scale(${(data.imageZoom || 100) / 100})`;
          img.style.transformOrigin = 'center center';
          inner.appendChild(img);
        }
        el.appendChild(inner);
        break;

      case 'file':
        inner = document.createElement('div');
        inner.className = 'el-file';
        inner.style.width = '100%';
        inner.style.height = '100%';
        if (data.thumbnailUrl) {
          inner.classList.add('el-file--video');
          inner.innerHTML = `
            <img class="file-thumb" src="${data.thumbnailUrl}" alt="">
            <div class="file-play">▶</div>
            <div class="file-overlay">
              <div class="file-name">${Utils.escapeHtml(data.originalName)}</div>
              <div class="file-size">${Utils.formatFileSize(data.fileSize)}</div>
            </div>`;
        } else {
          inner.innerHTML = `
            <div class="file-icon">${Utils.getFileIcon(data.mimetype, data.originalName)}</div>
            <div class="file-name">${Utils.escapeHtml(data.originalName)}</div>
            <div class="file-size">${Utils.formatFileSize(data.fileSize)}</div>`;
        }
        el.appendChild(inner);
        break;

      case 'rect':
        inner = document.createElement('div');
        inner.className = 'el-rect';
        inner.style.width = '100%';
        inner.style.height = '100%';
        inner.style.borderColor = data.borderColor || '#111111';
        inner.style.backgroundColor = data.fillColor || 'transparent';
        el.appendChild(inner);
        break;

      case 'circle':
        inner = document.createElement('div');
        inner.className = 'el-circle';
        inner.style.width = '100%';
        inner.style.height = '100%';
        inner.style.borderColor = data.borderColor || '#111111';
        inner.style.backgroundColor = data.fillColor || 'transparent';
        el.appendChild(inner);
        break;

      case 'icon':
        inner = document.createElement('div');
        inner.className = 'el-icon';
        inner.textContent = data.icon;
        inner.style.fontSize = (data.fontSize || 48) + 'px';
        inner.style.width = '100%';
        inner.style.height = '100%';
        el.appendChild(inner);
        break;

      case 'todo':
        inner = document.createElement('div');
        inner.className = 'el-todo';
        inner.style.width = '100%';
        inner.style.height = '100%';
        inner.innerHTML = Todos.renderInner(data);
        el.appendChild(inner);
        // Bind todo-specific events after appending to DOM
        setTimeout(() => Todos.bindEvents(el, data), 0);
        break;

      case 'pin':
        inner = document.createElement('div');
        inner.className = 'el-pin';
        el.appendChild(inner);
        el.style.overflow = 'visible';
        break;

      case 'llmchat':
        inner = document.createElement('div');
        inner.className = 'el-llmchat';
        inner.innerHTML = LLMChat.renderInner(data);
        el.appendChild(inner);
        setTimeout(() => LLMChat.bindEvents(el, data), 0);
        break;

      case 'calendar':
        inner = document.createElement('div');
        inner.className = 'el-calendar';
        inner.innerHTML = CalendarEl.renderInner(data);
        el.appendChild(inner);
        setTimeout(() => CalendarEl.bindEvents(el, data), 0);
        break;

      case 'draw':
        inner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        inner.setAttribute('class', 'el-draw');
        inner.setAttribute('width', data.width);
        inner.setAttribute('height', data.height);
        inner.setAttribute('viewBox', `0 0 ${data.width} ${data.height}`);
        // Stretch with the element box instead of letterboxing on free resize
        inner.setAttribute('preserveAspectRatio', 'none');
        inner.style.width = '100%';
        inner.style.height = '100%';
        if (data.points && data.points.length > 1) {
          const pathD = data.points.map((p, i) => (i === 0 ? `M${p.x} ${p.y}` : `L${p.x} ${p.y}`)).join(' ');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathD);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', data.strokeColor || '#111111');
          path.setAttribute('stroke-width', data.strokeWidth || 2);
          path.setAttribute('stroke-linecap', 'round');
          path.setAttribute('stroke-linejoin', 'round');
          const da = Elements._dashArray(data.strokeStyle, data.strokeWidth || 2);
          if (da) path.setAttribute('stroke-dasharray', da);
          inner.appendChild(path);
        }
        el.appendChild(inner);
        break;
    }

    // Apply rotation for all element types
    if (data.rotation) el.style.transform = `rotate(${data.rotation}deg)`;

    // Connection anchors — pins get a single center ring anchor, others get 4 edge anchors
    if (data.type === 'pin') {
      const ring = document.createElement('div');
      ring.className = 'connection-anchor pin-ring';
      ring.dataset.anchor = 'center';
      el.appendChild(ring);
    } else {
      ['top', 'bottom', 'left', 'right'].forEach(pos => {
        const anchor = document.createElement('div');
        anchor.className = 'connection-anchor ' + pos;
        anchor.dataset.anchor = pos;
        el.appendChild(anchor);
      });
    }

    Canvas.canvasEl.appendChild(el);
    Canvas.invalidateMinimap(); // covers every creation path, not just the ones that remember
    return el;
  },

  renderAll() {
    Canvas.canvasEl.innerHTML = '';
    App.elements.forEach(data => this.renderElement(data));
    this.selected.forEach(id => {
      const dom = this.getDom(id);
      if (dom) this.showSelected(dom);
    });
    this.applyFilters();
  },

  applyFilters() {
    const filters = App.activeFilters;
    const hasFilters = filters.size > 0;

    // Show/hide connections SVG for thread filter
    const connSvg = document.getElementById('connections-svg');
    if (connSvg) {
      connSvg.style.display = (!hasFilters || filters.has('thread')) ? '' : 'none';
    }

    Canvas.canvasEl.querySelectorAll('.canvas-element').forEach(el => {
      if (!hasFilters) { el.classList.remove('filter-hidden'); return; }
      const data = this.getData(el.dataset.id);
      if (!data) return;
      const matches =
        (filters.has('image') && data.type === 'image') ||
        (filters.has('video') && data.type === 'file' && data.thumbnailUrl) ||
        (filters.has('text') && ['text', 'heading', 'note'].includes(data.type)) ||
        (filters.has('chat') && data.type === 'llmchat');
      el.classList.toggle('filter-hidden', !matches);
    });
  },

  getDom(id) {
    return Canvas.canvasEl.querySelector(`[data-id="${id}"]`);
  },

  getData(id) {
    return App.elements.find(el => el.id === id);
  },

  showSelected(dom) {
    dom.classList.add('selected');
    const data = this.getData(dom.dataset.id);
    if (data?.type !== 'pin' && !dom.querySelector('.resize-handle')) {
      ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].forEach(dir => {
        const handle = document.createElement('div');
        handle.className = 'resize-handle ' + dir;
        handle.dataset.resize = dir;
        dom.appendChild(handle);
      });
      const rotHandle = document.createElement('div');
      rotHandle.className = 'rotate-handle';
      dom.appendChild(rotHandle);
    }
  },

  clearSelection() {
    this.selected = [];
    document.querySelectorAll('.canvas-element.selected').forEach(el => {
      el.classList.remove('selected');
      el.querySelectorAll('.resize-handle, .rotate-handle').forEach(h => h.remove());
    });
    document.getElementById('properties-panel').classList.add('hidden');
  },

  enterFrameMode(id) {
    document.querySelectorAll('.canvas-element.img-frame-mode').forEach(el => {
      if (el.dataset.id !== id) this.exitFrameMode(el.dataset.id, false);
    });
    const dom = document.querySelector(`.canvas-element[data-id="${id}"]`);
    if (!dom) return;
    dom.classList.add('img-pan-mode', 'img-frame-mode');
    this.updateCropHandles(id);
  },

  updateCropHandles(id) {
    const dom = document.querySelector(`.canvas-element[data-id="${id}"]`);
    if (!dom) return;
    dom.querySelectorAll('.crop-handle').forEach(h => h.remove());
    const data = this.getData(id);
    if (!data) return;
    const sides = [
      { cls: 'crop-handle-top',    style: `top:${data.cropTop||0}%` },
      { cls: 'crop-handle-bottom', style: `bottom:${data.cropBottom||0}%` },
      { cls: 'crop-handle-left',   style: `left:${data.cropLeft||0}%` },
      { cls: 'crop-handle-right',  style: `right:${data.cropRight||0}%` },
    ];
    sides.forEach(({ cls, style }) => {
      const h = document.createElement('div');
      h.className = `crop-handle ${cls}`;
      h.setAttribute('style', style);
      dom.appendChild(h);
    });
  },

  exitFrameMode(id, save = true) {
    const dom = document.querySelector(`.canvas-element[data-id="${id}"]`);
    if (!dom) return;
    dom.classList.remove('img-pan-mode', 'img-frame-mode');
    dom.querySelectorAll('.crop-handle').forEach(h => h.remove());
    if (save) App.saveState();
  },

  select(id, additive = false) {
    if (!additive) this.clearSelection();
    if (!this.selected.includes(id)) {
      this.selected.push(id);
    }
    const dom = this.getDom(id);
    if (dom) this.showSelected(dom);
    if (this.selected.length === 1) {
      Properties.show(this.getData(id));
    }
  },

  deleteSelected() {
    if (this.selected.length === 0) return;
    this.selected.forEach(id => {
      App.connections = App.connections.filter(c => c.from !== id && c.to !== id);
      App.elements = App.elements.filter(el => el.id !== id);
      const dom = this.getDom(id);
      if (dom) dom.remove();
    });
    this.clearSelection();
    App.saveState();
    Connections.render();
    Canvas.updateMinimap();
  },

  duplicateSelected() {
    const newIds = [];
    const groupMap = {};
    this.selected.forEach(id => {
      const data = this.getData(id);
      if (!data) return;
      const clone = { ...JSON.parse(JSON.stringify(data)), id: Utils.id(), x: data.x + 20, y: data.y + 20, zIndex: ++this.maxZIndex };
      if (clone.groupId) {
        if (!groupMap[clone.groupId]) groupMap[clone.groupId] = Utils.id();
        clone.groupId = groupMap[clone.groupId];
      }
      App.elements.push(clone);
      this.renderElement(clone);
      newIds.push(clone.id);
    });
    this.clearSelection();
    newIds.forEach(id => this.select(id, true));
    App.saveState();
    Canvas.updateMinimap();
  },

  copy() {
    this.clipboard = this.selected.map(id => JSON.parse(JSON.stringify(this.getData(id)))).filter(Boolean);
    this._pendingInternalPaste = this.clipboard.length > 0;
  },

  copyImageToClipboard() {
    if (this.selected.length !== 1) return;
    const data = this.getData(this.selected[0]);
    if (!data || data.type !== 'image' || !data.url) return;

    fetch(data.url)
      .then(r => r.blob())
      .then(blob => {
        // Convert to PNG if needed (browsers require image/png for ClipboardItem)
        if (blob.type === 'image/png') return blob;
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.toBlob(resolve, 'image/png');
          };
          img.src = URL.createObjectURL(blob);
        });
      })
      .then(pngBlob => navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]))
      .then(() => Utils.toast('Image copied to clipboard'))
      .catch(() => Utils.toast('Could not copy image'));
  },

  paste() {
    if (this.clipboard.length === 0) return;
    const newIds = [];
    const groupMap = {};
    this.clipboard.forEach(data => {
      const clone = { ...data, id: Utils.id(), x: data.x + 40, y: data.y + 40, zIndex: ++this.maxZIndex };
      if (clone.groupId) {
        if (!groupMap[clone.groupId]) groupMap[clone.groupId] = Utils.id();
        clone.groupId = groupMap[clone.groupId];
      }
      App.elements.push(clone);
      this.renderElement(clone);
      newIds.push(clone.id);
    });
    this.clearSelection();
    newIds.forEach(id => this.select(id, true));
    this.clipboard = this.clipboard.map(d => ({ ...d, x: d.x + 40, y: d.y + 40 }));
    App.saveState();
  },

  bringToFront() {
    this.selected.forEach(id => {
      const data = this.getData(id);
      if (data) {
        data.zIndex = ++this.maxZIndex;
        const dom = this.getDom(id);
        if (dom) dom.style.zIndex = data.zIndex;
      }
    });
    App.saveState();
  },

  sendToBack() {
    this.selected.forEach(id => {
      const data = this.getData(id);
      if (data) {
        data.zIndex = 0;
        const dom = this.getDom(id);
        if (dom) dom.style.zIndex = 0;
      }
    });
    App.saveState();
  },

  toggleLock() {
    this.selected.forEach(id => {
      const data = this.getData(id);
      if (data) {
        data.locked = !data.locked;
        const dom = this.getDom(id);
        if (dom) dom.classList.toggle('locked', data.locked);
      }
    });
    App.saveState();
  },

  group() {
    if (this.selected.length < 2) return;
    const groupId = Utils.id();
    this.selected.forEach(id => {
      const data = this.getData(id);
      if (data) {
        data.groupId = groupId;
        const dom = this.getDom(id);
        if (dom) dom.dataset.groupId = groupId;
      }
    });
    App.saveState();
  },

  ungroup() {
    if (this.selected.length === 0) return;
    const groupIds = new Set(this.selected.map(id => this.getData(id)?.groupId).filter(Boolean));
    if (groupIds.size === 0) return;
    App.elements.forEach(el => {
      if (el.groupId && groupIds.has(el.groupId)) {
        delete el.groupId;
        const dom = this.getDom(el.id);
        if (dom) delete dom.dataset.groupId;
      }
    });
    App.saveState();
  },

  updateElement(id, props) {
    const data = this.getData(id);
    if (!data) return;
    Object.assign(data, props);
    const dom = this.getDom(id);
    if (!dom) return;

    // Safety net for the minimap cache: any geometry change makes it stale.
    // rAF coalescing caps this at one redraw per frame.
    if (props.x !== undefined || props.y !== undefined ||
        props.width !== undefined || props.height !== undefined) {
      Canvas.invalidateMinimap();
    }

    if (props.x !== undefined) dom.style.left = props.x + 'px';
    if (props.y !== undefined) dom.style.top = props.y + 'px';
    if (props.width !== undefined) dom.style.width = props.width + 'px';
    if (props.height !== undefined && (data.type !== 'text' || data.boxed) && data.type !== 'heading') dom.style.height = props.height + 'px';
    if (props.zIndex !== undefined) dom.style.zIndex = props.zIndex;
    if (props.rotation !== undefined) dom.style.transform = data.rotation ? `rotate(${data.rotation}deg)` : '';

    if (data.type === 'text') {
      const textEl = dom.querySelector('.el-text');
      if (props.content !== undefined) textEl.innerHTML = props.content;
      if (props.fontSize !== undefined) textEl.style.fontSize = props.fontSize + 'px';
      if (props.color !== undefined) textEl.style.color = props.color;
      if (props.textAlign !== undefined) textEl.style.textAlign = props.textAlign;
    }
    if (data.type === 'heading') {
      const headingEl = dom.querySelector('.el-heading');
      if (props.content !== undefined) headingEl.textContent = props.content;
      if (props.fontSize !== undefined) headingEl.style.fontSize = props.fontSize + 'px';
      if (props.color !== undefined) headingEl.style.color = props.color;
      if (props.fontWeight !== undefined) headingEl.style.fontWeight = props.fontWeight;
    }
    if (data.type === 'note') {
      const noteEl = dom.querySelector('.el-note');
      if (props.content !== undefined) noteEl.textContent = props.content;
      if (props.noteColor !== undefined) {
        noteEl.className = 'el-note';
        if (props.noteColor !== 'default') noteEl.classList.add('note-' + props.noteColor);
      }
    }
    if (data.type === 'rect') {
      const rectEl = dom.querySelector('.el-rect');
      if (props.borderColor !== undefined) rectEl.style.borderColor = props.borderColor;
      if (props.fillColor !== undefined) rectEl.style.backgroundColor = props.fillColor;
    }
    if (data.type === 'circle') {
      const circleEl = dom.querySelector('.el-circle');
      if (props.borderColor !== undefined) circleEl.style.borderColor = props.borderColor;
      if (props.fillColor !== undefined) circleEl.style.backgroundColor = props.fillColor;
    }
    if (data.type === 'draw') {
      const pathEl = dom.querySelector('.el-draw path');
      if (pathEl) {
        if (props.strokeColor !== undefined) pathEl.setAttribute('stroke', props.strokeColor);
        if (props.strokeWidth !== undefined) pathEl.setAttribute('stroke-width', props.strokeWidth);
        if (props.strokeStyle !== undefined || props.strokeWidth !== undefined) {
          const da = Elements._dashArray(data.strokeStyle, data.strokeWidth);
          if (da) pathEl.setAttribute('stroke-dasharray', da);
          else pathEl.removeAttribute('stroke-dasharray');
        }
      }
    }
    if (data.type === 'icon') {
      const iconEl = dom.querySelector('.el-icon');
      if (props.icon !== undefined) iconEl.textContent = props.icon;
      if (props.fontSize !== undefined) iconEl.style.fontSize = props.fontSize + 'px';
    }
    if (data.type === 'image') {
      const imgEl = dom.querySelector('.el-image img');
      if (imgEl && (props.url !== undefined || props.displayUrl !== undefined)) {
        const nextSrc = data.displayUrl || data.url;
        if (imgEl.getAttribute('src') !== nextSrc) imgEl.src = nextSrc;
      }
      if (imgEl && (props.imageZoom !== undefined || props.imgOffsetX !== undefined || props.imgOffsetY !== undefined)) {
        imgEl.style.transform = `translate(${data.imgOffsetX||0}px, ${data.imgOffsetY||0}px) scale(${(data.imageZoom||100) / 100})`;
      }
      if (props.cropTop !== undefined || props.cropRight !== undefined ||
          props.cropBottom !== undefined || props.cropLeft !== undefined) {
        const imgDiv = dom.querySelector('.el-image');
        const ct = data.cropTop||0, cr = data.cropRight||0, cb = data.cropBottom||0, cl = data.cropLeft||0;
        imgDiv.style.clipPath = (ct||cr||cb||cl) ? `inset(${ct}% ${cr}% ${cb}% ${cl}%)` : '';
      }
    }
    if (data.type === 'todo') {
      if (props.title !== undefined) {
        Todos.refresh(dom, data);
      }
    }
  },

  // Dragging a handle scales the whole selection when more than one element is
  // selected. Groups come along automatically — clicking a member selects them all.
  _resizeTargets(id) {
    if (this.selected.length > 1 && this.selected.includes(id)) {
      return this.selected.map(sid => this.getData(sid)).filter(d => d && !d.locked);
    }
    const data = this.getData(id);
    return data ? [data] : [];
  },

  _buildResizeState(data, dir, e) {
    const targets = this._resizeTargets(data.id);
    const items = targets.map(d => ({
      id: d.id,
      type: d.type,
      x: d.x, y: d.y, w: d.width, h: d.height,
      fontSize: d.fontSize,
      strokeWidth: d.type === 'draw' ? d.strokeWidth : undefined,
    }));
    const minX = Math.min(...items.map(i => i.x));
    const minY = Math.min(...items.map(i => i.y));
    const maxX = Math.max(...items.map(i => i.x + i.w));
    const maxY = Math.max(...items.map(i => i.y + i.h));

    return {
      id: data.id,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      origX: data.x,
      origY: data.y,
      origW: data.width,
      origH: data.height,
      origRatio: data.width / data.height,
      origFontSize: data.fontSize,
      multi: items.length > 1,
      items,
      bx: minX, by: minY,
      bw: (maxX - minX) || 1,
      bh: (maxY - minY) || 1,
      minItemW: Math.min(...items.map(i => i.w)) || 1,
      minItemH: Math.min(...items.map(i => i.h)) || 1,
      // One locked member is enough to scale the whole selection uniformly.
      ratioLocked: targets.some(d => this.isRatioLocked(d)),
    };
  },

  // Scale every selected element around the fixed corner of the selection box.
  _resizeMulti(r, dx, dy, constrain) {
    const anchorX = r.dir.includes('w') ? r.bx + r.bw : r.bx;
    const anchorY = r.dir.includes('n') ? r.by + r.bh : r.by;

    let sx = 1, sy = 1;
    if (r.dir.includes('e')) sx = (r.bw + dx) / r.bw;
    if (r.dir.includes('w')) sx = (r.bw - dx) / r.bw;
    if (r.dir.includes('s')) sy = (r.bh + dy) / r.bh;
    if (r.dir.includes('n')) sy = (r.bh - dy) / r.bh;

    if (constrain) {
      const s = r.dir.length === 1
        ? (r.dir === 'e' || r.dir === 'w' ? sx : sy)
        : Math.max(sx, sy);
      sx = sy = s;
    }

    // Floor the scale so the smallest member never collapses.
    const minSx = 8 / r.minItemW;
    const minSy = 6 / r.minItemH;
    if (constrain) {
      const s = Math.max(sx, minSx, minSy);
      sx = sy = s;
    } else {
      sx = Math.max(sx, minSx);
      sy = Math.max(sy, minSy);
    }

    const fontScale = constrain ? sx : Math.sqrt(sx * sy);
    r.items.forEach(it => {
      const props = {
        x: anchorX + (it.x - anchorX) * sx,
        y: anchorY + (it.y - anchorY) * sy,
      };
      // Pins are fixed-size markers — they move with the selection but don't grow
      if (it.type === 'pin') { this.updateElement(it.id, props); return; }
      props.width = it.w * sx;
      props.height = it.h * sy;
      if (it.fontSize) props.fontSize = Math.max(6, Math.round(it.fontSize * fontScale));
      if (it.strokeWidth) props.strokeWidth = Math.max(0.5, it.strokeWidth * fontScale);
      this.updateElement(it.id, props);
    });
  },

  // Both run inside the frame scheduler and read this._pointer rather than a
  // captured event, so scheduling them repeatedly within one frame is a no-op.
  _applyDrag() {
    if (!this.dragging || !this.dragStart || !this._pointer) return;
    const pos = Canvas.screenToCanvas(this._pointer.x, this._pointer.y);
    const dx = pos.x - this.dragStart.mx;
    const dy = pos.y - this.dragStart.my;
    this.dragStart.origins.forEach(({ id, x, y }) => {
      this.updateElement(id, { x: x + dx, y: y + dy });
    });
    Connections.render();
    Properties.updatePosition();
  },

  _applyResize() {
    const r = this.resizing;
    if (!r || !this._pointer) return;
    const dx = (this._pointer.x - r.startX) / Canvas.zoom;
    const dy = (this._pointer.y - r.startY) / Canvas.zoom;
    const data = this.getData(r.id);

    // Ratio stays locked by default for media; Shift flips whatever the default is.
    const constrain = r.ratioLocked !== !!this._pointer.shift;

    if (r.multi) {
      this._resizeMulti(r, dx, dy, constrain);
    } else {
      let newX = r.origX, newY = r.origY, newW = r.origW, newH = r.origH;

      if (r.dir.includes('e')) newW = Math.max(40, r.origW + dx);
      if (r.dir.includes('w')) { newW = Math.max(40, r.origW - dx); newX = r.origX + (r.origW - newW); }
      if (r.dir.includes('s')) newH = Math.max(30, r.origH + dy);
      if (r.dir.includes('n')) { newH = Math.max(30, r.origH - dy); newY = r.origY + (r.origH - newH); }

      if (constrain && r.origW && r.origH) {
        const ratio = r.origRatio || (r.origW / r.origH);
        if (r.dir === 'e' || r.dir === 'w') {
          // Edge handle: drive the other axis from the one being dragged
          newH = Math.max(30, newW / ratio);
          newW = newH * ratio;
        } else if (r.dir === 'n' || r.dir === 's') {
          newW = Math.max(40, newH * ratio);
          newH = newW / ratio;
        } else {
          // Corner handle: use the larger scale to avoid shrinking one axis below min
          const scale = Math.max(newW / r.origW, newH / r.origH);
          newW = Math.max(40, r.origW * scale);
          newH = Math.max(30, newW / ratio);
          newW = newH * ratio;
        }
        if (r.dir.includes('w')) newX = r.origX + r.origW - newW;
        if (r.dir.includes('n')) newY = r.origY + r.origH - newH;
      }

      this.updateElement(r.id, { x: newX, y: newY, width: newW, height: newH });
      // Scale icon font proportionally with resize
      if (data && data.type === 'icon' && r.origFontSize && r.origW) {
        const newFontSize = Math.max(8, Math.round(r.origFontSize * (newW / r.origW)));
        this.updateElement(r.id, { fontSize: newFontSize });
      }
    }

    Connections.render();
    Properties.updatePosition();
  },

  bindCanvasEvents() {
    const container = Canvas.container;
    let marqueeStart = null;
    let marqueeActive = false;
    let drawingShape = null;
    let drawingStart = null;
    let drawingPath = null; // freehand draw

    container.addEventListener('mousedown', (e) => {
      if (Canvas.isPanning || Canvas.spaceDown) return;
      if (e.button !== 0) return;

      const target = e.target;

      // Don't interfere with active text editing (allow cursor placement + text selection)
      if (target.closest('[contenteditable="true"]')) return;

      const elementDom = target.closest('.canvas-element');
      const tool = App.currentTool;

      if (target.classList.contains('connection-anchor')) {
        const parentEl = target.closest('.canvas-element');
        const anchor = target.dataset.anchor;
        Connections.startDrawing(parentEl.dataset.id, anchor, e);
        return;
      }

      if (target.classList.contains('resize-handle')) {
        const parentEl = target.closest('.canvas-element');
        const data = this.getData(parentEl.dataset.id);
        if (data && !data.locked) {
          // Clear first: a leftover pointer from an earlier gesture would make
          // mouseup apply a bogus delta on a click without movement.
          this._pointer = null;
          this.resizing = this._buildResizeState(data, target.dataset.resize, e);
        }
        return;
      }

      if (target.classList.contains('rotate-handle')) {
        const parentEl = target.closest('.canvas-element');
        const data = this.getData(parentEl.dataset.id);
        if (data && !data.locked) {
          const rect = parentEl.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          this.rotating = {
            id: data.id,
            cx, cy,
            startAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
            origRotation: data.rotation || 0,
          };
        }
        return;
      }

      // Don't start dragging if interacting with todo elements
      if (target.closest('.todo-check') || target.closest('.todo-add-btn') ||
          target.closest('.todo-add-row') || target.closest('.todo-edit-input') ||
          target.closest('.todo-drag') || target.closest('.todo-star')) {
        return;
      }

      // Don't start dragging if interacting with llmchat content area
      if (target.closest('.llm-messages') || target.closest('.llm-input-row') || target.closest('.llm-status')) {
        return;
      }

      // Crop handle drag (frame mode)
      if (tool === 'select' && target.classList.contains('crop-handle') && elementDom) {
        const id = elementDom.dataset.id;
        const data = this.getData(id);
        if (data) {
          const handleType = ['top','bottom','left','right'].find(t => target.classList.contains('crop-handle-' + t));
          this.cropDragging = {
            id, handleType,
            startX: e.clientX, startY: e.clientY,
            origTop:    data.cropTop    || 0,
            origBottom: data.cropBottom || 0,
            origLeft:   data.cropLeft   || 0,
            origRight:  data.cropRight  || 0,
            elemW: data.width,
            elemH: data.height,
          };
          e.stopPropagation();
          return;
        }
      }

      // Image pan mode: drag inside a pan-mode image moves its content
      if (tool === 'select' && elementDom && elementDom.classList.contains('img-pan-mode')) {
        const id = elementDom.dataset.id;
        const data = this.getData(id);
        if (data && data.type === 'image') {
          this.imgPanning = {
            id,
            startX: e.clientX,
            startY: e.clientY,
            origX: data.imgOffsetX || 0,
            origY: data.imgOffsetY || 0,
          };
          e.stopPropagation();
          return;
        }
      }

      if (tool === 'select') {
        if (elementDom) {
          const id = elementDom.dataset.id;
          const data = this.getData(id);
          if (data && data.locked) return;

          if (e.shiftKey) {
            this.select(id, true);
          } else if (data.groupId && !this.selected.includes(id)) {
            // Auto-select all group members
            this.clearSelection();
            App.elements.filter(el => el.groupId === data.groupId).forEach(el => this.select(el.id, true));
          } else if (!this.selected.includes(id)) {
            this.select(id);
          }

          const pos = Canvas.screenToCanvas(e.clientX, e.clientY);
          this._pointer = null;
          this.dragging = true;
          this.dragStart = {
            mx: pos.x, my: pos.y,
            origins: this.selected.map(sid => {
              const d = this.getData(sid);
              return { id: sid, x: d.x, y: d.y };
            }),
          };
        } else {
          this.clearSelection();
          marqueeStart = { x: e.clientX, y: e.clientY };
          marqueeActive = true;
        }
        return;
      }

      const canvasPos = Canvas.screenToCanvas(e.clientX, e.clientY);

      if (tool === 'text') {
        drawingStart = canvasPos;
        drawingShape = { type: 'text', x: canvasPos.x, y: canvasPos.y, width: 0, height: 0 };
        return;
      }

      if (tool === 'heading') {
        const data = this.create('heading', canvasPos.x, canvasPos.y);
        App.elements.push(data);
        this.renderElement(data);
        this.select(data.id);
        setTimeout(() => this.startEditing(data.id), 50);
        App.setTool('select');
        App.saveState();
        return;
      }

      if (tool === 'icon') {
        IconPicker.show(canvasPos.x, canvasPos.y);
        return;
      }

      if (tool === 'image') {
        document.getElementById('file-input').click();
        App._pendingImagePos = canvasPos;
        return;
      }

      if (tool === 'file') {
        const fi = document.getElementById('file-input');
        fi.accept = '*';
        fi.click();
        App._pendingImagePos = canvasPos;
        return;
      }

      if (tool === 'todo') {
        const data = this.create('todo', canvasPos.x, canvasPos.y);
        App.elements.push(data);
        this.renderElement(data);
        this.select(data.id);
        App.setTool('select');
        App.saveState();
        Canvas.updateMinimap();
        return;
      }

      if (tool === 'pin') {
        const data = this.create('pin', canvasPos.x - 14, canvasPos.y - 14);
        App.elements.push(data);
        this.renderElement(data);
        this.select(data.id);
        App.setTool('select');
        App.saveState();
        Canvas.updateMinimap();
        return;
      }

      if (tool === 'llmchat') {
        const data = this.create('llmchat', canvasPos.x, canvasPos.y);
        App.elements.push(data);
        this.renderElement(data);
        this.select(data.id);
        App.setTool('select');
        App.saveState();
        Canvas.updateMinimap();
        return;
      }

      if (tool === 'calendar') {
        const data = this.create('calendar', canvasPos.x, canvasPos.y);
        App.elements.push(data);
        this.renderElement(data);
        this.select(data.id);
        App.setTool('select');
        App.saveState();
        Canvas.updateMinimap();
        return;
      }

      if (tool === 'draw') {
        drawingPath = { points: [canvasPos], startPos: canvasPos };
        const pvg = document.getElementById('preview-svg');
        const ds = Elements.drawSettings;
        const da = Elements._dashArray(ds.strokeStyle, ds.strokeWidth);
        pvg.innerHTML = `<path id="draw-preview-path" fill="none" stroke="${ds.strokeColor}" stroke-width="${ds.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${da ? ` stroke-dasharray="${da}"` : ''}/>`;
        return;
      }

      if (['rect', 'circle', 'note'].includes(tool)) {
        drawingStart = canvasPos;
        drawingShape = { type: tool, x: canvasPos.x, y: canvasPos.y, width: 0, height: 0 };
        return;
      }

      if (tool === 'arrow') {
        if (elementDom) {
          Connections.startDrawing(elementDom.dataset.id, 'center', e);
        }
        return;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.rotating) {
        const r = this.rotating;
        const angle = Math.atan2(e.clientY - r.cy, e.clientX - r.cx) * 180 / Math.PI;
        let newRotation = (r.origRotation + angle - r.startAngle) % 360;
        if (newRotation < 0) newRotation += 360;
        if (e.shiftKey) newRotation = Math.round(newRotation / 15) * 15;
        this.updateElement(r.id, { rotation: newRotation });
        return;
      }

      if (this.cropDragging) {
        const d = this.cropDragging;
        const dx = (e.clientX - d.startX) / (d.elemW * Canvas.zoom) * 100;
        const dy = (e.clientY - d.startY) / (d.elemH * Canvas.zoom) * 100;
        const clamp = v => Math.max(0, Math.min(90, v));
        const updates = {};
        if (d.handleType === 'top')    updates.cropTop    = clamp(d.origTop    + dy);
        if (d.handleType === 'bottom') updates.cropBottom = clamp(d.origBottom - dy);
        if (d.handleType === 'left')   updates.cropLeft   = clamp(d.origLeft   + dx);
        if (d.handleType === 'right')  updates.cropRight  = clamp(d.origRight  - dx);
        this.updateElement(d.id, updates);
        this.updateCropHandles(d.id);
        return;
      }

      if (this.imgPanning) {
        const dx = (e.clientX - this.imgPanning.startX) / Canvas.zoom;
        const dy = (e.clientY - this.imgPanning.startY) / Canvas.zoom;
        this.updateElement(this.imgPanning.id, {
          imgOffsetX: this.imgPanning.origX + dx,
          imgOffsetY: this.imgPanning.origY + dy,
        });
        return;
      }

      // Drag and resize are applied once per frame instead of once per pointer
      // event — the work is identical, it just stops running 3-10x per frame.
      if (this.dragging && this.dragStart) {
        this._pointer = { x: e.clientX, y: e.clientY };
        Frame.schedule('input', () => this._applyDrag());
        return;
      }

      if (this.resizing) {
        this._pointer = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
        Frame.schedule('input', () => this._applyResize());
        return;
      }

      if (marqueeActive && marqueeStart) {
        const box = document.getElementById('selection-box');
        const x = Math.min(marqueeStart.x, e.clientX);
        const y = Math.min(marqueeStart.y, e.clientY);
        const w = Math.abs(e.clientX - marqueeStart.x);
        const h = Math.abs(e.clientY - marqueeStart.y);
        box.classList.remove('hidden');
        box.style.left = x + 'px';
        box.style.top = y + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
        return;
      }

      // Freehand draw live preview
      if (drawingPath) {
        const pos = Canvas.screenToCanvas(e.clientX, e.clientY);
        drawingPath.points.push(pos);
        const path = document.getElementById('draw-preview-path');
        if (path) {
          const cRect = Canvas.getRect();
          const d = drawingPath.points.map((p, i) => {
            const s = Canvas.canvasToScreen(p.x, p.y);
            return (i === 0 ? 'M' : 'L') + (s.x - cRect.left).toFixed(1) + ' ' + (s.y - cRect.top).toFixed(1);
          }).join(' ');
          path.setAttribute('d', d);
        }
        return;
      }

      if (drawingShape && drawingStart) {
        const pos = Canvas.screenToCanvas(e.clientX, e.clientY);
        drawingShape.width = Math.abs(pos.x - drawingStart.x);
        drawingShape.height = Math.abs(pos.y - drawingStart.y);
        drawingShape.x = Math.min(pos.x, drawingStart.x);
        drawingShape.y = Math.min(pos.y, drawingStart.y);

        // Live shape preview in screen space
        const pvg = document.getElementById('preview-svg');
        const cRect = Canvas.getRect();
        const tl = Canvas.canvasToScreen(drawingShape.x, drawingShape.y);
        const br = Canvas.canvasToScreen(drawingShape.x + drawingShape.width, drawingShape.y + drawingShape.height);
        const px = tl.x - cRect.left, py = tl.y - cRect.top;
        const pw = br.x - tl.x, ph = br.y - tl.y;
        const stroke = `stroke="${document.body.classList.contains('dark') ? '#E0E0E0' : '#111111'}" stroke-width="1" stroke-dasharray="5,3" fill="none"`;
        if (drawingShape.type === 'circle') {
          pvg.innerHTML = `<ellipse cx="${px + pw/2}" cy="${py + ph/2}" rx="${pw/2}" ry="${ph/2}" ${stroke}/>`;
        } else if (drawingShape.type === 'text') {
          const tc = document.body.classList.contains('dark') ? '#E0E0E0' : '#111111';
          pvg.innerHTML = `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" ${stroke}/>` +
            `<text x="${px + 6}" y="${py + 16}" font-size="11" font-family="monospace" fill="${tc}" opacity="0.5">T</text>`;
        } else {
          pvg.innerHTML = `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" ${stroke}/>`;
        }
      }
    });

    window.addEventListener('mouseup', (_e) => {
      if (this.rotating) {
        this.rotating = null;
        App.saveState();
        return;
      }

      if (this.cropDragging) {
        this.cropDragging = null;
        App.saveState();
        return;
      }

      if (this.imgPanning) {
        this.imgPanning = null;
        App.saveState();
        return;
      }

      // Apply the last pointer position before tearing the gesture down, so a
      // frame still sitting in the scheduler can't be lost.
      if (this.dragging) {
        Frame.cancel('input');
        this._applyDrag();
        this.dragging = false;
        this.dragStart = null;
        App.saveState();
        Canvas.updateMinimap();
      }

      if (this.resizing) {
        Frame.cancel('input');
        this._applyResize();
        this.resizing.items.forEach(it => {
          const dom = this.getDom(it.id);
          if (dom) this.checkTextOverflow(dom);
        });
        this.resizing = null;
        App.saveState();
        Canvas.updateMinimap();
      }

      if (marqueeActive) {
        const box = document.getElementById('selection-box');
        if (!box.classList.contains('hidden')) {
          const bx = parseFloat(box.style.left);
          const by = parseFloat(box.style.top);
          const bw = parseFloat(box.style.width);
          const bh = parseFloat(box.style.height);

          App.elements.forEach(data => {
            const sp = Canvas.canvasToScreen(data.x, data.y);
            const ep = Canvas.canvasToScreen(data.x + (data.width || 50), data.y + (data.height || 50));
            if (sp.x < bx + bw && ep.x > bx && sp.y < by + bh && ep.y > by) {
              this.select(data.id, true);
            }
          });
        }
        box.classList.add('hidden');
        marqueeActive = false;
        marqueeStart = null;
      }

      // Finalize freehand drawing
      if (drawingPath) {
        const pts = drawingPath.points;
        document.getElementById('preview-svg').innerHTML = '';

        if (pts.length > 2) {
          // Calculate bounding box
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          pts.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          });
          const pad = 4;
          minX -= pad; minY -= pad; maxX += pad; maxY += pad;
          const w = maxX - minX;
          const h = maxY - minY;
          // Normalize points relative to origin
          const normalized = pts.map(p => ({ x: p.x - minX, y: p.y - minY }));
          const ds = Elements.drawSettings;
          const data = this.create('draw', minX, minY, {
            points: normalized,
            width: Math.max(w, 10),
            height: Math.max(h, 10),
            strokeColor: ds.strokeColor,
            strokeWidth: ds.strokeWidth,
            strokeStyle: ds.strokeStyle,
          });
          App.elements.push(data);
          this.renderElement(data);
          this.select(data.id);
          App.saveState();
          Canvas.updateMinimap();
        }
        drawingPath = null;
        // Stay in draw tool for continuous drawing
      }

      if (drawingShape && drawingStart) {
        const isDrawn = drawingShape.width > 20 && drawingShape.height > 20;
        if (drawingShape.type === 'text') {
          let data;
          if (isDrawn) {
            data = this.create('text', drawingShape.x, drawingShape.y, {
              width: Math.max(drawingShape.width, 80),
              height: Math.max(drawingShape.height, 40),
              boxed: true,
            });
          } else {
            // Click without drag → small inline text at click point
            data = this.create('text', drawingShape.x, drawingShape.y);
          }
          App.elements.push(data);
          this.renderElement(data);
          this.select(data.id);
          App.saveState();
          Canvas.updateMinimap();
          setTimeout(() => this.startEditing(data.id), 50);
        } else if (drawingShape.width > 10 || drawingShape.height > 10) {
          const data = this.create(drawingShape.type, drawingShape.x, drawingShape.y, {
            width: Math.max(drawingShape.width, 40),
            height: Math.max(drawingShape.height, 30),
          });
          App.elements.push(data);
          this.renderElement(data);
          this.select(data.id);
          App.saveState();
          Canvas.updateMinimap();
        }
        document.getElementById('preview-svg').innerHTML = '';
        drawingShape = null;
        drawingStart = null;
        App.setTool('select');
      }
    });

    container.addEventListener('dblclick', (e) => {
      const elementDom = e.target.closest('.canvas-element');
      if (!elementDom) return;
      const data = this.getData(elementDom.dataset.id);
      if (!data || data.locked) return;

      if (data.type === 'text' || data.type === 'note' || data.type === 'heading') {
        this.startEditing(data.id);
      }
      if (data.type === 'file' && data.url) {
        FileViewer.open(data);
      }
      if (data.type === 'image' && data.url) {
        FileViewer.openImage(data.url, data.originalName || 'image');
      }
      // todo double-click is handled by Todos.bindEvents
    });

    // Exit image pan mode / frame mode when clicking elsewhere
    container.addEventListener('mousedown', (e) => {
      const panEls = container.querySelectorAll('.canvas-element.img-pan-mode:not(.img-frame-mode)');
      panEls.forEach(el => {
        if (!el.contains(e.target)) el.classList.remove('img-pan-mode');
      });
      const frameEls = container.querySelectorAll('.canvas-element.img-frame-mode');
      frameEls.forEach(el => {
        if (!el.contains(e.target)) this.exitFrameMode(el.dataset.id, false);
      });
    }, true); // capture phase so it fires before other handlers

    container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const elementDom = e.target.closest('.canvas-element');
      if (elementDom) {
        // Don't show main context menu if right-clicking a todo item
        if (e.target.closest('.todo-item')) return;
        const id = elementDom.dataset.id;
        if (!this.selected.includes(id)) this.select(id);
      }
      ContextMenu.show(e.clientX, e.clientY);
    });
  },

  checkTextOverflow(dom) {
    const textEl = dom.querySelector('.el-text--boxed');
    const btn = dom.querySelector('.text-expand-btn');
    if (!textEl || !btn) return;
    btn.classList.toggle('visible', textEl.scrollHeight > textEl.clientHeight + 2);
  },

  sanitizeContent(html) {
    // Convert block-level wrappers (Chrome/Edge use <div> for newlines) to <br>
    let s = html
      .replace(/<div>/gi, '<br>').replace(/<\/div>/gi, '')
      .replace(/<p>/gi, '<br>').replace(/<\/p>/gi, '');
    // Remove leading <br> that Chrome prepends
    s = s.replace(/^(<br\s*\/?>)+/i, '');
    // Strip all tags except safe inline formatting
    s = s.replace(/<(?!\/?(?:b|strong|i|em|u|br)\b)[^>]*>/gi, '');
    return s;
  },

  startEditing(id) {
    const dom = this.getDom(id);
    const data = this.getData(id);
    if (!dom || !data) return;

    const editable = dom.querySelector('.el-text, .el-note, .el-heading');
    if (!editable) return;

    editable.setAttribute('contenteditable', 'true');
    editable.focus();

    // Select all only for empty elements; otherwise leave cursor where user clicked
    if (!editable.textContent.trim()) {
      const range = document.createRange();
      range.selectNodeContents(editable);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const stopEditing = () => {
      editable.removeAttribute('contenteditable');
      data.content = this.sanitizeContent(editable.innerHTML);
      if ((data.type === 'text' && !data.boxed) || data.type === 'heading') {
        data.height = editable.offsetHeight;
      }
      App.saveState();
      editable.removeEventListener('blur', stopEditing);
      this.checkTextOverflow(dom);
    };

    editable.addEventListener('blur', stopEditing);
    editable.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') editable.blur();
      e.stopPropagation();
    });
  },
};
