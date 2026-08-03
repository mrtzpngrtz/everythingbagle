/* === UTILS === */
const Utils = {
  id: () => 'el_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),

  clamp: (val, min, max) => Math.min(Math.max(val, min), max),

  formatFileSize: (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  getFileIcon: (mimetype, name) => {
    if (mimetype && mimetype.startsWith('image/')) return '◻';
    const ext = name ? name.split('.').pop().toLowerCase() : '';
    const icons = {
      pdf: '▤', doc: '▤', docx: '▤', txt: '▤',
      xls: '▦', xlsx: '▦', csv: '▦',
      zip: '▣', rar: '▣',
      mp3: '▶', wav: '▶', mp4: '▶', mov: '▶',
      svg: '◈', ai: '◈', psd: '◈', fig: '◈',
      js: '◇', ts: '◇', py: '◇', html: '◇', css: '◇',
      json: '◇', md: '▤',
    };
    return icons[ext] || '◻';
  },

  throttle: (fn, delay) => {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= delay) {
        last = now;
        fn(...args);
      }
    };
  },

  debounce: (fn, delay) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  _uploadOnce: (file, onProgress, filename) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    if (filename) formData.append('file', file, filename);
    else formData.append('file', file);
    if (onProgress) {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
      });
    }
    xhr.addEventListener('load', () => {
      if (xhr.status === 429) {
        const err = new Error('Rate limited');
        err.rateLimited = true;
        return reject(err);
      }
      try { resolve(JSON.parse(xhr.responseText)); }
      catch { reject(new Error('Upload failed')); }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.open('POST', '/api/upload');
    xhr.send(formData);
  }),

  // The server allows 30 uploads/min. Since an image now costs two uploads
  // (original + display variant), hitting the limit is routine — wait it out
  // rather than dropping the file.
  async uploadFile(file, onProgress, filename) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await Utils._uploadOnce(file, onProgress, filename);
      } catch (err) {
        if (!err.rateLimited || attempt >= 3) throw err;
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  },

  _variantType() {
    if (!Utils.__variantType) {
      Utils.__variantType = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
        ? 'image/webp' : 'image/jpeg';
    }
    return Utils.__variantType;
  },

  // Produces a canvas-sized copy of an image so the browser doesn't hold a
  // 4686x2634 bitmap (~47 MB decoded) to paint a 400px box. Returns null when
  // the source is already small enough or can't be decoded — callers then just
  // keep using the original.
  async downscaleImage(src, maxEdge = 1600, quality = 0.85) {
    // GIFs are left alone — a downscale would flatten the animation to one frame
    if (src.type === 'image/gif') return null;

    // Without WebP encoding the fallback is JPEG, which has no alpha channel —
    // a transparent PNG would come back flattened onto black. Keep the original.
    const type = Utils._variantType();
    if (type !== 'image/webp' && (src.type === 'image/png' || src.type === 'image/avif')) return null;

    let bmp;
    try {
      bmp = await createImageBitmap(src, { resizeQuality: 'high' });
    } catch {
      return null; // SVG, corrupt, or an unsupported codec
    }

    const nw = bmp.width, nh = bmp.height;
    const ratio = Math.min(maxEdge / nw, maxEdge / nh, 1);
    if (ratio === 1 && src.size && src.size < 400 * 1024) { bmp.close(); return null; }

    const cw = Math.max(1, Math.round(nw * ratio));
    const ch = Math.max(1, Math.round(nh * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, cw, ch);
    bmp.close();

    const blob = await new Promise(r => canvas.toBlob(r, type, quality));
    canvas.width = canvas.height = 0; // release the backing store now, not at GC time
    if (!blob || (src.size && blob.size >= src.size)) return null;

    return { blob, width: cw, height: ch, naturalWidth: nw, naturalHeight: nh, type };
  },

  // Resolves { url, width, height } — dimensions let the canvas element take the
  // clip's aspect ratio — or null when the video can't be decoded.
  extractVideoThumbnail: (file) => new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = url;
    video.addEventListener('loadeddata', () => { video.currentTime = 0.1; });
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        const MAX = 480;
        const ratio = Math.min(MAX / video.videoWidth, MAX / video.videoHeight, 1);
        canvas.width  = Math.round(video.videoWidth  * ratio);
        canvas.height = Math.round(video.videoHeight * ratio);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({
          url: canvas.toDataURL('image/jpeg', 0.75),
          width: video.videoWidth,
          height: video.videoHeight,
        });
      } catch { URL.revokeObjectURL(url); resolve(null); }
    });
    video.addEventListener('error', () => { URL.revokeObjectURL(url); resolve(null); });
  }),

  SVG_NS: 'http://www.w3.org/2000/svg',

  createSVGElement: (tag, attrs = {}) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  },

  // Icons — geometric/emoji set
  ICONS: [
    '⭐', '❤️', '🔥', '💡', '🎯', '🚀', '💎', '🏆', '🎨', '🎭',
    '📌', '📍', '🔖', '🏷️', '💬', '💭', '🗨️', '📢', '🔔', '💰',
    '✅', '❌', '⚠️', '❓', '❗', '💯', '●', '○', '◆', '◇',
    '■', '□', '▲', '△', '▼', '▽', '◀', '▶', '★', '☆',
    '👤', '👥', '🤝', '👍', '👎', '👀', '🧠', '💪', '✍️', '→',
    '←', '↑', '↓', '↗', '↘', '↙', '↖', '↔', '↕', '⟶',
    '📁', '📂', '📄', '📝', '📊', '📈', '📉', '📋', '📎', '🔗',
    '⚙️', '🔧', '🔨', '🛠️', '🧪', '🔬', '🧩', '🗝️', '🔒', '🔓',
    '●', '◐', '◑', '◒', '◓', '◔', '◕', '⊕', '⊖', '⊗',
    '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  ],

  NOTE_COLORS: [
    { name: 'default', class: '', label: 'DEFAULT' },
    { name: 'blue', class: 'note-blue', label: 'BLUE' },
    { name: 'green', class: 'note-green', label: 'GREEN' },
    { name: 'pink', class: 'note-pink', label: 'PINK' },
    { name: 'purple', class: 'note-purple', label: 'PURPLE' },
    { name: 'orange', class: 'note-orange', label: 'ORANGE' },
  ],

  ELEMENT_COLORS: [
    '#111111', '#333333', '#555555', '#999999', '#CCCCCC',
    '#FF4500', '#FF0066', '#0066FF', '#00AA44', '#7700FF',
  ],

  BORDER_COLORS: [
    '#111111', '#333333', '#555555', '#999999', '#CCCCCC',
    '#FF4500', '#FF0066', '#0066FF', '#00AA44', '#7700FF',
  ],

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  toast(msg, duration = 2000) {
    const t = document.createElement('div');
    t.className = 'util-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('util-toast--visible'));
    setTimeout(() => {
      t.classList.remove('util-toast--visible');
      setTimeout(() => t.remove(), 300);
    }, duration);
  },
};

/* === FRAME SCHEDULER ===
   Pointer events fire far more often than the screen refreshes — a 1000 Hz mouse
   produced a dozen full grid/connection/minimap rebuilds per frame. Tasks are
   named and last-write-wins, so scheduling the same task repeatedly within one
   frame collapses to a single run, in a fixed order. */
const Frame = {
  _tasks: new Map(),
  _queued: false,
  _order: ['input', 'transform', 'grid', 'connections', 'minimap', 'overlays'],

  schedule(name, fn) {
    this._tasks.set(name, fn);
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => this._flush());
  },

  cancel(name) { this._tasks.delete(name); },

  _run(name, fn) {
    // One throwing task must not break the rAF chain for everything else
    try { fn(); } catch (err) { console.error('[Frame]', name, err); }
  },

  _flush() {
    this._queued = false;
    const tasks = this._tasks;
    this._tasks = new Map(); // anything scheduled during the flush lands next frame
    this._order.forEach(name => {
      const fn = tasks.get(name);
      if (fn) { tasks.delete(name); this._run(name, fn); }
    });
    tasks.forEach((fn, name) => this._run(name, fn));
  },
};

/* === DIALOG (app-styled alert / confirm / prompt) === */
const Dialog = {
  _show(title, bodyHtml, onMount) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal modal-dialog';
      overlay.style.cssText = 'display:flex;';
      overlay.innerHTML = `
        <div class="modal-content modal-sm">
          <div class="modal-header">
            <span class="modal-idx">●</span>
            <span>${Utils.escapeHtml(title)}</span>
          </div>
          <div class="modal-body">${bodyHtml}</div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (val) => { overlay.remove(); resolve(val); };
      onMount(overlay, done);
    });
  },

  alert(message, title = 'NOTICE') {
    return this._show(title,
      `<p class="dlg-msg">${Utils.escapeHtml(message)}</p>
       <button class="btn-primary dlg-ok">OK</button>`,
      (el, done) => {
        el.querySelector('.dlg-ok').addEventListener('click', () => done());
        el.querySelector('.dlg-ok').focus();
      });
  },

  confirm(message, title = 'CONFIRM') {
    return this._show(title,
      `<p class="dlg-msg">${Utils.escapeHtml(message)}</p>
       <div class="dlg-row">
         <button class="btn-primary dlg-ok">OK</button>
         <button class="btn-dialog-cancel dlg-cancel">CANCEL</button>
       </div>`,
      (el, done) => {
        el.querySelector('.dlg-ok').addEventListener('click', () => done(true));
        el.querySelector('.dlg-cancel').addEventListener('click', () => done(false));
        el.addEventListener('click', e => { if (e.target === el) done(false); });
        el.querySelector('.dlg-ok').focus();
      });
  },

  prompt(message, defaultValue = '', title = 'INPUT') {
    return this._show(title,
      `<p class="dlg-msg">${Utils.escapeHtml(message)}</p>
       <input type="text" class="dlg-input" value="${Utils.escapeAttr(defaultValue)}">
       <div class="dlg-row">
         <button class="btn-primary dlg-ok">OK</button>
         <button class="btn-dialog-cancel dlg-cancel">CANCEL</button>
       </div>`,
      (el, done) => {
        const input = el.querySelector('.dlg-input');
        el.querySelector('.dlg-ok').addEventListener('click', () => done(input.value));
        el.querySelector('.dlg-cancel').addEventListener('click', () => done(null));
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') done(input.value);
          if (e.key === 'Escape') done(null);
        });
        el.addEventListener('click', e => { if (e.target === el) done(null); });
        input.focus();
        input.select();
      });
  },
};
