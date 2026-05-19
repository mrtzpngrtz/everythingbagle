/* === SHARE PAGE — Live read-only board viewer === */
const Share = {
  token: null,
  _ws: null,
  _wsRetry: null,

  async init() {
    // Dark mode
    if (localStorage.getItem('wms-darkmode') === 'true') document.body.classList.add('dark');
    document.getElementById('btn-darkmode')?.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      localStorage.setItem('wms-darkmode', document.body.classList.contains('dark'));
      Canvas.drawGrid();
    });

    // Get token from URL path: /share/:token
    const token = window.location.pathname.split('/share/')[1]?.split('/')[0];
    if (!token) { this.showError(); return; }
    this.token = token;

    Canvas.init();
    Elements.init(); // READ_ONLY=true, so bindCanvasEvents is skipped
    Connections.init();
    FileViewer.init();

    await this.loadBoard(null);
  },

  async loadBoard(password) {
    try {
      const res = await fetch(`/api/share/${this.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (res.status === 401 && data.needsPassword) {
        this.showPasswordForm();
        return;
      }
      if (!res.ok) { this.showError(); return; }

      const boardName = data.meta?.boardName || data.meta?.name || 'Shared Board';
      const titleEl = document.getElementById('share-board-title');
      if (titleEl) titleEl.textContent = boardName;
      document.title = `EVERTHINGBAGLE — ${boardName}`;

      App.elements = data.elements || [];
      App.connections = data.connections || [];
      Elements.renderAll();
      Connections.render();
      Canvas.fitAll();
      Canvas.updateMinimap();

      // Connect WebSocket for live updates
      this._connectLive();
    } catch (err) {
      console.error('Share load error:', err);
      this.showError();
    }
  },

  _connectLive() {
    clearTimeout(this._wsRetry);
    if (this._ws) { try { this._ws.close(); } catch {} this._ws = null; }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}?token=${this.token}`);
    this._ws = ws;

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'state') {
        App.elements = msg.elements || [];
        App.connections = msg.connections || [];
        Elements.renderAll();
        Connections.render();
        Canvas.updateMinimap();
      }
    });

    ws.addEventListener('close', () => {
      this._ws = null;
      // Auto-reconnect after 3s
      this._wsRetry = setTimeout(() => this._connectLive(), 3000);
    });

    ws.addEventListener('error', () => {});
  },

  showPasswordForm() {
    document.getElementById('share-password-overlay').classList.remove('hidden');
    document.getElementById('share-password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = document.getElementById('share-password-input').value;
      const errEl = document.getElementById('share-password-error');
      errEl.classList.add('hidden');

      const res = await fetch(`/api/share/${this.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json();

      if (res.status === 401) {
        errEl.textContent = 'Wrong password';
        errEl.classList.remove('hidden');
        document.getElementById('share-password-input').value = '';
        return;
      }
      if (!res.ok) { this.showError(); return; }

      document.getElementById('share-password-overlay').classList.add('hidden');

      const boardName = data.meta?.boardName || data.meta?.name || 'Shared Board';
      const titleEl = document.getElementById('share-board-title');
      if (titleEl) titleEl.textContent = boardName;
      document.title = `EVERTHINGBAGLE — ${boardName}`;

      App.elements = data.elements || [];
      App.connections = data.connections || [];
      Elements.renderAll();
      Connections.render();
      Canvas.fitAll();
      Canvas.updateMinimap();

      this._connectLive();
    });
  },

  showError() {
    document.getElementById('share-error').classList.remove('hidden');
  },
};

document.addEventListener('DOMContentLoaded', () => Share.init());
