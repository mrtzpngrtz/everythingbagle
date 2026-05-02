/* === TOOLBAR (Draggable + Keyboard Shortcuts) === */
const Toolbar = {
  isDragging: false,
  dragOffset: { x: 0, y: 0 },

  init() {
    this.initDraggable();
    this.initToolButtons();
    this.initKeyboardShortcuts();
    this.initActionButtons();
  },

  initDraggable() {
    const toolbar = document.getElementById('toolbar');
    const handle = document.getElementById('toolbar-handle');

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDragging = true;
      const rect = toolbar.getBoundingClientRect();
      this.dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      handle.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const x = Utils.clamp(e.clientX - this.dragOffset.x, 0, window.innerWidth - 48);
      const y = Utils.clamp(e.clientY - this.dragOffset.y, 40, window.innerHeight - 100);
      toolbar.style.left = x + 'px';
      toolbar.style.top = y + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        const handle = document.getElementById('toolbar-handle');
        if (handle) handle.style.cursor = 'grab';
      }
    });
  },

  initToolButtons() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        App.setTool(btn.dataset.tool);
      });
    });
  },

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.closest('[contenteditable]')) return;

      const key = e.key.toLowerCase();

      // Tool shortcuts (no modifier)
      if (!e.ctrlKey && !e.metaKey) {
        switch (key) {
          case 'v': App.setTool('select'); break;
          case 'h': App.setTool('pan'); break;
          case 't': App.setTool('text'); break;
          case 'e': App.setTool('heading'); break;
          case 'n': App.setTool('note'); break;
          case 'i': App.setTool('image'); break;
          case 'f': App.setTool('file'); break;
          case 'r': App.setTool('rect'); break;
          case 'c': App.setTool('circle'); break;
          case 'a': App.setTool('arrow'); break;
          case 'g': App.setTool('icon'); break;  // Note: Ctrl+G is group (handled below)
          case 'd': App.setTool('todo'); break;
          case 'p': App.setTool('draw'); break;
          case 'k': App.setTool('pin'); break;
          case 'l': App.setTool('llmchat'); break;
          case 'b': App.setTool('calendar'); break;
          case '`':
            document.body.classList.toggle('flow-mode');
            break;
          case 'delete':
          case 'backspace':
            Elements.deleteSelected();
            break;
          case 'escape':
            document.querySelectorAll('.canvas-element.img-pan-mode').forEach(el => el.classList.remove('img-pan-mode'));
            Elements.clearSelection();
            App.setTool('select');
            break;
        }
      }

      // Ctrl shortcuts
      if (e.ctrlKey || e.metaKey) {
        switch (key) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) { App.redo(); } else { App.undo(); }
            break;
          case 'y':
            e.preventDefault();
            App.redo();
            break;
          case 'c':
            e.preventDefault();
            if (e.shiftKey) {
              Elements.copyImageToClipboard();
            } else {
              Elements.copy();
            }
            break;
          case 'v':
            // Paste is handled by the native paste event in dragdrop.js
            // Don't preventDefault here — that would suppress the paste event
            break;
          case 'd':
            e.preventDefault();
            Elements.duplicateSelected();
            break;
          case 's':
            e.preventDefault();
            Storage.showSaveModal();
            break;
          case 'o':
            e.preventDefault();
            Storage.showLoadModal();
            break;
          case 'a':
            e.preventDefault();
            App.elements.forEach(el => Elements.select(el.id, true));
            break;
          case 'g':
            e.preventDefault();
            if (e.shiftKey) { Elements.ungroup(); } else { Elements.group(); }
            break;
          case '=':
          case '+':
            e.preventDefault();
            document.getElementById('zoom-in').click();
            break;
          case '-':
            e.preventDefault();
            document.getElementById('zoom-out').click();
            break;
          case '0':
            e.preventDefault();
            Canvas.fitAll();
            break;
        }
      }
    });
  },

  initActionButtons() {
    document.getElementById('btn-undo').addEventListener('click', () => App.undo());
    document.getElementById('btn-redo').addEventListener('click', () => App.redo());
    document.getElementById('btn-share').addEventListener('click', () => Storage.showShareModal());
  },
};
