/* === SAMESAMEBUTDIFFERENT — Main App === */
const App = {
  elements: [],
  connections: [],
  currentTool: 'select',
  activeFilters: new Set(),
  _pendingImagePos: null,
  currentUser: null,

  async init() {
    // Load current user
    await this.loadCurrentUser();

    Canvas.init();
    Elements.init();
    Connections.init();
    Toolbar.init();
    ContextMenu.init();
    Storage.init();
    DragDrop.init();
    IconPicker.init();
    FileViewer.init();
    Suggestions.init();
    DrawOptions.init();
    this.initFilters();

    // Push initial empty state
    History.push({ elements: [], connections: [] });
    History.updateButtons();

    // Dark mode (apply before board renders)
    this.initDarkMode();

    // Load board from URL params — redirect home if missing
    const params = new URLSearchParams(window.location.search);
    const boardName = params.get('board');
    if (!boardName) { window.location.href = '/'; return; }
    await Storage.load(boardName, params.get('owner') || null);

    // Click brand name to go home (saves first)
    document.querySelector('.brand-name').style.cursor = 'pointer';
    document.querySelector('.brand-name').addEventListener('click', async () => {
      if (App.elements.length > 0) await Storage.save(Storage.currentBoard);
      window.location.href = '/';
    });

    // Logout
    this.initLogout();

    this.initMobileMode();

    console.log('SAMESAMEBUTDIFFERENT v0.8.1 — Ready');
    console.log('Keys: V=Select H=Pan T=Text N=Note R=Rect A=Arrow D=Todo P=Draw K=Pin Space=Pan');
  },

  async loadCurrentUser() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await res.json();
      this.currentUser = data.user;
      const nameBtn = document.getElementById('btn-profile');
      if (nameBtn) nameBtn.textContent = data.user.displayName || data.user.username;
      if (data.user.role === 'admin') {
        const adminBtn = document.getElementById('btn-admin');
        if (adminBtn) adminBtn.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    }
  },

  initFilters() {
    const toggleBtn = document.getElementById('btn-filter-toggle');
    const panel = document.getElementById('filter-panel');
    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('hidden');
      });
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter;
        if (this.activeFilters.has(f)) {
          this.activeFilters.delete(f);
          btn.classList.remove('active');
        } else {
          this.activeFilters.add(f);
          btn.classList.add('active');
        }
        Elements.applyFilters();
        if (toggleBtn) toggleBtn.classList.toggle('has-active', this.activeFilters.size > 0);
      });
    });
  },

  initLogout() {
    const btn = document.getElementById('btn-logout');
    if (btn) {
      btn.addEventListener('click', async () => {
        Collab.leaveBoard();
        if (this.elements.length > 0) await Storage.save(Storage.currentBoard);
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      });
    }
  },



  initMobileMode() {
    const isMobile = window.innerWidth <= 768;
    const stored = localStorage.getItem('wms-mobilemode');
    const active = stored === 'true' || (stored === null && isMobile);
    if (active) {
      document.body.classList.add('mobile-mode');
      this.setTool('pan');
    }

    const syncMobileBar = () => {
      const tool = this.currentTool;
      document.querySelectorAll('.mb-btn').forEach(b => b.classList.remove('active'));
      if (tool === 'select') document.getElementById('mb-select')?.classList.add('active');
    };

    // Wrap setTool to sync mobile bar
    const origSetTool = this.setTool.bind(this);
    this.setTool = (tool) => {
      origSetTool(tool);
      syncMobileBar();
    };

    // Bottom bar buttons
    document.getElementById('mb-fit')?.addEventListener('click', () => Canvas.fitAll());
    document.getElementById('mb-select')?.addEventListener('click', () => this.setTool('select'));
    document.getElementById('mb-undo')?.addEventListener('click', () => this.undo());

    document.getElementById('mb-add')?.addEventListener('click', () => {
      document.getElementById('mobile-add-sheet')?.classList.remove('hidden');
    });
    document.getElementById('mb-menu')?.addEventListener('click', () => {
      document.getElementById('mobile-menu-sheet')?.classList.remove('hidden');
    });

    // Add sheet
    document.querySelectorAll('#mobile-add-sheet .sheet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('mobile-add-sheet').classList.add('hidden');
        this.setTool(btn.dataset.tool);
      });
    });
    document.querySelector('#mobile-add-sheet .sheet-overlay')?.addEventListener('click', () => {
      document.getElementById('mobile-add-sheet').classList.add('hidden');
    });

    // Menu sheet
    document.querySelector('#mobile-menu-sheet .sheet-overlay')?.addEventListener('click', () => {
      document.getElementById('mobile-menu-sheet').classList.add('hidden');
    });
    document.getElementById('mm-darkmode')?.addEventListener('click', () => {
      document.getElementById('mobile-menu-sheet').classList.add('hidden');
      document.getElementById('btn-darkmode').click();
    });
    document.getElementById('mm-save')?.addEventListener('click', () => {
      document.getElementById('mobile-menu-sheet').classList.add('hidden');
      document.getElementById('btn-save').click();
    });
    document.getElementById('mm-fit')?.addEventListener('click', () => {
      document.getElementById('mobile-menu-sheet').classList.add('hidden');
      Canvas.fitAll();
    });
    document.getElementById('mm-desktop')?.addEventListener('click', () => {
      document.getElementById('mobile-menu-sheet').classList.add('hidden');
      document.body.classList.remove('mobile-mode');
      localStorage.setItem('wms-mobilemode', 'false');
      // Re-centre canvas container via CSS defaults
      Canvas.container.style.removeProperty('bottom');
    });

    syncMobileBar();
  },

  initDarkMode() {
    const saved = localStorage.getItem('wms-darkmode');
    if (saved === 'true') {
      document.body.classList.add('dark');
    }
    document.getElementById('btn-darkmode').addEventListener('click', () => {
      const wasDark = document.body.classList.contains('dark');
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      localStorage.setItem('wms-darkmode', isDark);
      // Swap draw settings default color
      if (isDark && Elements.drawSettings.strokeColor === '#111111') Elements.drawSettings.strokeColor = '#E0E0E0';
      else if (!isDark && Elements.drawSettings.strokeColor === '#E0E0E0') Elements.drawSettings.strokeColor = '#111111';
      DrawOptions._syncUI();
      // Swap element colors for dark/light
      this.swapElementColors(wasDark, isDark);
      Elements.renderAll();
      Canvas.drawGrid();
      Connections.render();
      Canvas.updateMinimap();
    });
  },

  /** Swap hardcoded black/white colors on elements when toggling dark mode */
  swapElementColors(wasDark, isDark) {
    const lightDarks = ['#111111', '#000000', '#222222', '#333333'];
    const lightLights = ['#FFFFFF', '#F2F2F2', '#E8E8E8', '#EEEEEE'];

    this.elements.forEach(el => {
      if (isDark && !wasDark) {
        // Light → Dark: flip dark colors to light
        if (el.color && lightDarks.includes(el.color.toUpperCase())) {
          el.color = '#E0E0E0';
        }
        if (el.borderColor && lightDarks.includes(el.borderColor.toUpperCase())) {
          el.borderColor = '#E8E8E8';
        }
      } else if (!isDark && wasDark) {
        // Dark → Light: flip light colors to dark
        if (el.color && lightLights.includes(el.color.toUpperCase())) {
          el.color = '#111111';
        }
        if (el.color === '#E0E0E0') {
          el.color = '#111111';
        }
        if (el.borderColor && (lightLights.includes(el.borderColor.toUpperCase()) || el.borderColor === '#E8E8E8')) {
          el.borderColor = '#111111';
        }
      }
      // Also swap stroke color for draw elements
      if (el.type === 'draw') {
        if (isDark && !wasDark && lightDarks.includes((el.strokeColor || '').toUpperCase())) {
          el.strokeColor = '#E0E0E0';
        } else if (!isDark && wasDark && (lightLights.includes((el.strokeColor || '').toUpperCase()) || el.strokeColor === '#E0E0E0')) {
          el.strokeColor = '#111111';
        }
      }
    });
  },

  setTool(tool) {
    this.currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    const container = Canvas.container;
    container.className = '';
    if (tool === 'pan') container.classList.add('panning');
    else if (['text'].includes(tool)) container.classList.add('tool-text');
    else if (['rect', 'circle', 'note'].includes(tool)) container.classList.add('tool-rect');
    else if (tool === 'arrow') container.classList.add('tool-arrow');
    else if (tool === 'draw') container.classList.add('tool-draw');

    DrawOptions.toggle(tool === 'draw');

    if (tool === 'icon') {
      const center = Canvas.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      IconPicker.show(center.x, center.y);
    }
  },

  saveState() {
    History.push({
      elements: JSON.parse(JSON.stringify(this.elements)),
      connections: JSON.parse(JSON.stringify(this.connections)),
    });
    Collab.broadcastState();
  },

  undo() {
    const state = History.undo();
    if (state) {
      this.elements = state.elements;
      this.connections = state.connections;
      Elements.clearSelection();
      Elements.renderAll();
      Connections.render();
      Canvas.updateMinimap();
    }
  },

  redo() {
    const state = History.redo();
    if (state) {
      this.elements = state.elements;
      this.connections = state.connections;
      Elements.clearSelection();
      Elements.renderAll();
      Connections.render();
      Canvas.updateMinimap();
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
