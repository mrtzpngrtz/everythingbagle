/* === COLLAB — Real-Time Collaboration via WebSocket === */
const Collab = {

  // ─── State ───────────────────────────────────────────
  ws: null,
  connected: false,
  currentRoom: null,
  peers: {},              // username → { displayName, color, cursorEl, lastCanvasX, lastCanvasY, _hideTimer }
  _broadcastTimer: null,
  _lastCursorTime: 0,

  // ─── Public API ──────────────────────────────────────

  /** Called from Storage.load() after board data is set */
  joinBoard(boardName, boardOwner) {
    const owner = boardOwner || (App.currentUser && App.currentUser.username);
    if (!owner) return;
    const room = `${owner}/${boardName}`;

    if (this.currentRoom === room && this.connected) return;

    this.currentRoom = room;

    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this._connect();
    } else {
      this._send({ type: 'join', room });
    }
  },

  /** Called before board switch, logout, or page unload */
  leaveBoard() {
    clearTimeout(this._broadcastTimer);
    if (this.connected && this.currentRoom) {
      this._send({ type: 'leave', room: this.currentRoom });
    }
    this.currentRoom = null;
    this._removeAllCursors();
    this._updatePresenceUI([]);
  },

  /** Debounced 300ms — called from App.saveState() */
  broadcastState() {
    clearTimeout(this._broadcastTimer);
    this._broadcastTimer = setTimeout(() => {
      if (!this.connected || !this.currentRoom) return;
      this._send({
        type: 'state',
        room: this.currentRoom,
        elements: JSON.parse(JSON.stringify(App.elements)),
        connections: JSON.parse(JSON.stringify(App.connections)),
        seq: Date.now(),
      });
    }, 300);
  },

  /** Throttled 50ms — called from window mousemove */
  broadcastCursor(canvasX, canvasY) {
    if (!this.connected || !this.currentRoom) return;
    const now = Date.now();
    if (now - this._lastCursorTime < 50) return;
    this._lastCursorTime = now;
    this._send({ type: 'cursor', room: this.currentRoom, x: canvasX, y: canvasY });
  },

  // ─── Internal: Connection ────────────────────────────

  _connect() {
    // Clean up any existing socket
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.connected = true;
      const dot = document.getElementById('collab-status-dot');
      if (dot) { dot.classList.add('online'); dot.title = 'Collaboration: live'; }
      if (this.currentRoom) this._send({ type: 'join', room: this.currentRoom });
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this.handleMessage(msg);
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      const dot = document.getElementById('collab-status-dot');
      if (dot) { dot.classList.remove('online'); dot.title = 'Collaboration: reconnecting...'; }
      this._removeAllCursors();
      this._updatePresenceUI([]);
      // Auto-reconnect after 3s if we still have a room
      setTimeout(() => {
        if (this.currentRoom) this._connect();
      }, 3000);
    });

    this.ws.addEventListener('error', () => {
      // close event fires after error and handles reconnect
    });
  },

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  },

  // ─── Internal: Message Handling ──────────────────────

  handleMessage(msg) {
    switch (msg.type) {
      case 'state':    this.applyRemoteState(msg); break;
      case 'cursor':   this._renderCursor(msg); break;
      case 'presence': this._updatePresenceUI(msg.users); break;
    }
  },

  // ─── Internal: State Merge ───────────────────────────

  applyRemoteState(msg) {
    // Collect IDs of elements currently being interacted with locally
    const locallyActiveIds = new Set();
    if (Elements.dragging && Elements.dragStart) {
      (Elements.dragStart.origins || []).forEach(o => locallyActiveIds.add(o.id));
    }
    if (Elements.resizing) locallyActiveIds.add(Elements.resizing.id);
    document.querySelectorAll('[contenteditable="true"]').forEach(el => {
      const domEl = el.closest('.canvas-element');
      if (domEl) locallyActiveIds.add(domEl.dataset.id);
    });

    const remoteElements = msg.elements || [];
    const remoteConnections = msg.connections || [];

    if (locallyActiveIds.size === 0) {
      // No local interaction — replace everything
      App.elements = remoteElements;
      App.connections = remoteConnections;
    } else {
      // Smart merge: keep local version for actively-interacted elements
      const localMap = new Map(App.elements.map(e => [e.id, e]));
      const remoteMap = new Map(remoteElements.map(e => [e.id, e]));

      const merged = [];
      remoteMap.forEach((remoteEl, id) => {
        merged.push(locallyActiveIds.has(id) ? (localMap.get(id) || remoteEl) : remoteEl);
      });
      // Keep locally active elements that aren't in remote yet (just created)
      locallyActiveIds.forEach(id => {
        if (!remoteMap.has(id) && localMap.has(id)) merged.push(localMap.get(id));
      });

      App.elements = merged;
      App.connections = remoteConnections;
    }

    // Re-render without touching undo history
    Elements.maxZIndex = App.elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 1);
    Elements.clearSelection();
    Elements.renderAll();
    Connections.render();
    Canvas.updateMinimap();
  },

  // ─── Internal: Cursor Rendering ──────────────────────

  _renderCursor(msg) {
    if (!msg.from) return;

    let peer = this.peers[msg.from];
    if (!peer) {
      peer = { displayName: msg.displayName || msg.from, color: null, cursorEl: null, lastCanvasX: 0, lastCanvasY: 0, _hideTimer: null };
      this.peers[msg.from] = peer;
    }
    if (msg.displayName) peer.displayName = msg.displayName;
    if (!peer.color) peer.color = this._colorFor(msg.from);

    peer.lastCanvasX = msg.x;
    peer.lastCanvasY = msg.y;

    if (!peer.cursorEl) peer.cursorEl = this._createCursorEl(msg.from, peer.displayName, peer.color);

    this._positionCursor(peer, msg.x, msg.y);

    // Auto-hide after 5s of no movement
    clearTimeout(peer._hideTimer);
    peer._hideTimer = setTimeout(() => {
      if (peer.cursorEl) peer.cursorEl.style.display = 'none';
    }, 5000);
  },

  _positionCursor(peer, canvasX, canvasY) {
    if (!peer.cursorEl || !Canvas.container) return;
    const screen = Canvas.canvasToScreen(canvasX, canvasY);
    const containerRect = Canvas.getRect();
    peer.cursorEl.style.left = (screen.x - containerRect.left) + 'px';
    peer.cursorEl.style.top  = (screen.y - containerRect.top)  + 'px';
    peer.cursorEl.style.display = 'block';
  },

  /** Called from Canvas.updateTransform() to reposition cursors after pan/zoom */
  _repositionAllCursors() {
    Object.values(this.peers).forEach(peer => {
      if (peer.cursorEl && peer.cursorEl.style.display !== 'none') {
        this._positionCursor(peer, peer.lastCanvasX, peer.lastCanvasY);
      }
    });
  },

  _createCursorEl(username, displayName, color) {
    const el = document.createElement('div');
    el.className = 'collab-cursor';
    el.dataset.user = username;
    el.innerHTML = `
      <div class="collab-cursor-dot" style="background:${color}"></div>
      <div class="collab-cursor-label" style="background:${color}">${displayName}</div>
    `;
    Canvas.container.appendChild(el);
    return el;
  },

  _removeAllCursors() {
    Object.values(this.peers).forEach(peer => {
      if (peer.cursorEl) peer.cursorEl.remove();
      clearTimeout(peer._hideTimer);
    });
    this.peers = {};
  },

  // ─── Internal: Presence UI ───────────────────────────

  _updatePresenceUI(users) {
    // Update peer color/displayName from presence data
    users.forEach(u => {
      if (!this.peers[u.username]) this.peers[u.username] = {};
      this.peers[u.username].color = u.color;
      this.peers[u.username].displayName = u.displayName;
      // Update existing cursor colors
      const peer = this.peers[u.username];
      if (peer.cursorEl) {
        const dot = peer.cursorEl.querySelector('.collab-cursor-dot');
        const label = peer.cursorEl.querySelector('.collab-cursor-label');
        if (dot) dot.style.background = u.color;
        if (label) label.style.background = u.color;
      }
    });

    // Remove peers no longer in room
    const current = new Set(users.map(u => u.username));
    Object.keys(this.peers).forEach(username => {
      if (!current.has(username)) {
        const peer = this.peers[username];
        if (peer.cursorEl) peer.cursorEl.remove();
        clearTimeout(peer._hideTimer);
        delete this.peers[username];
      }
    });

    // Render presence dots — filter out self
    const presenceEl = document.getElementById('collab-presence');
    if (!presenceEl) return;
    const selfUsername = App.currentUser && App.currentUser.username;
    const others = users.filter(u => u.username !== selfUsername);

    if (others.length === 0) {
      presenceEl.style.display = 'none';
      return;
    }
    presenceEl.style.display = 'flex';
    presenceEl.innerHTML = '';
    others.forEach(u => {
      const dot = document.createElement('div');
      dot.className = 'presence-dot';
      dot.style.background = u.color;
      dot.title = u.displayName || u.username;
      dot.textContent = (u.displayName || u.username).slice(0, 2).toUpperCase();
      presenceEl.appendChild(dot);
    });
  },

  // ─── Internal: Utilities ─────────────────────────────

  _colorFor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360},65%,50%)`;
  },
};

// Broadcast cursor position on mousemove (throttled inside broadcastCursor)
window.addEventListener('mousemove', (e) => {
  if (!Collab.connected || !Collab.currentRoom) return;
  if (!Canvas || !Canvas.container) return;
  const pos = Canvas.screenToCanvas(e.clientX, e.clientY);
  Collab.broadcastCursor(pos.x, pos.y);
});

// Graceful leave on tab close / navigate away
window.addEventListener('beforeunload', () => {
  Collab.leaveBoard();
});
