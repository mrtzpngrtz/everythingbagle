/* === STORAGE (Save/Load/Board Switcher) === */
const Storage = {
  autoSaveInterval: null,
  currentBoard: 'default',
  currentBoardOwner: null,  // null = own board, string = shared board owner
  dropdownOpen: false,
  boardSort: localStorage.getItem('ssbd_board_sort') || 'date',

  getPinnedBoards() {
    try { return JSON.parse(localStorage.getItem('ssbd_pinned_boards') || '[]'); }
    catch { return []; }
  },

  setPinnedBoards(arr) {
    localStorage.setItem('ssbd_pinned_boards', JSON.stringify(arr));
  },

  togglePin(name) {
    const pins = this.getPinnedBoards();
    const idx = pins.indexOf(name);
    if (idx >= 0) pins.splice(idx, 1); else pins.unshift(name);
    this.setPinnedBoards(pins);
    if (document.getElementById('board-dropdown-list')) this.refreshDropdownList();
  },

  init() {
    this.autoSaveInterval = setInterval(() => this.autoSave(), 30000);

    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.modal').classList.add('hidden'));
    });
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    });

    document.getElementById('save-confirm').addEventListener('click', () => {
      const name = document.getElementById('board-name-input').value.trim();
      if (name) { this.save(name); document.getElementById('save-modal').classList.add('hidden'); }
    });
    document.getElementById('board-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('save-confirm').click();
    });

    this.initBoardSwitcher();

  },

  initBoardSwitcher() {
    const btn = document.getElementById('board-switcher-btn');
    const newBtn = document.getElementById('new-board-btn');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dropdownOpen ? this.closeDropdown() : this.openDropdown();
    });

    document.addEventListener('click', (e) => {
      if (this.dropdownOpen && !e.target.closest('#board-switcher')) this.closeDropdown();
    });

    newBtn.addEventListener('click', (e) => { e.stopPropagation(); this.createNewBoard(); });

    document.querySelectorAll('.board-sort-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.boardSort = b.dataset.sort;
        localStorage.setItem('ssbd_board_sort', this.boardSort);
        this.refreshDropdownList();
      });
    });
  },

  openDropdown() {
    document.getElementById('board-dropdown').classList.remove('hidden');
    this.dropdownOpen = true;
    this.refreshDropdownList();
  },

  closeDropdown() {
    document.getElementById('board-dropdown')?.classList.add('hidden');
    this.dropdownOpen = false;
  },

  formatTimeAgo(isoStr) {
    if (!isoStr) return '—';
    const now = Date.now();
    const diff = now - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(isoStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  },

  formatDateTime(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  },

  async refreshDropdownList() {
    const list = document.getElementById('board-dropdown-list');

    // Update sort button active states
    document.querySelectorAll('.board-sort-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sort === this.boardSort);
    });

    try {
      const res = await fetch('/api/boards');
      const boards = await res.json();
      list.innerHTML = '';

      if (boards.length === 0) {
        list.innerHTML = '<div style="padding:12px;font-family:var(--font-mono);font-size:10px;color:var(--dark-grey)">No boards yet</div>';
        return;
      }

      const pinned = this.getPinnedBoards();

      // Sort by selected mode
      const sorted = [...boards];
      if (this.boardSort === 'name') {
        sorted.sort((a, b) => a.name.localeCompare(b.name));
      } else if (this.boardSort === 'size') {
        sorted.sort((a, b) => (b.elementCount || 0) - (a.elementCount || 0));
      } else {
        sorted.sort((a, b) => new Date(b.lastEdit || 0) - new Date(a.lastEdit || 0));
      }
      // Pinned always float to top
      sorted.sort((a, b) => (pinned.includes(a.name) ? 0 : 1) - (pinned.includes(b.name) ? 0 : 1));

      sorted.forEach(board => {
        const isShared = board.shared;
        const isCurrent = board.name === this.currentBoard && (isShared ? this.currentBoardOwner === board.owner : !this.currentBoardOwner);
        const isPinned = pinned.includes(board.name);

        const item = document.createElement('div');
        item.className = 'board-dropdown-item' + (isCurrent ? ' active' : '') + (isPinned ? ' pinned' : '');

        const left = document.createElement('div');
        left.className = 'board-item-left';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'board-name';
        nameSpan.textContent = isShared ? `${board.name} (${board.owner})` : board.name;

        const info = document.createElement('div');
        info.className = 'board-info';
        info.innerHTML = `<span>${board.elementCount || 0} items</span><span>·</span><span>${this.formatTimeAgo(board.lastEdit)}</span>${isShared ? '<span>·</span><span style="color:var(--accent)">SHARED</span>' : ''}`;

        left.appendChild(nameSpan);
        left.appendChild(info);

        if (isPinned) {
          const pinDot = document.createElement('span');
          pinDot.className = 'board-pin-dot';
          pinDot.textContent = '★';
          pinDot.title = 'Pinned';
          item.appendChild(pinDot);
        }

        item.appendChild(left);

        left.addEventListener('click', (e) => {
          e.stopPropagation();
          Collab.leaveBoard();
          if (App.elements.length > 0) this.save(this.currentBoard);
          this.load(board.name, isShared ? board.owner : null);
          this.closeDropdown();
        });

        list.appendChild(item);
      });
    } catch (err) {
      console.error('Failed to list boards:', err);
    }
  },

  async renameBoard(oldName) {
    const newName = await Dialog.prompt('Rename board:', oldName, 'RENAME BOARD');
    if (!newName || !newName.trim() || newName.trim() === oldName) return;

    const cleanName = newName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const res = await fetch(`/api/boards/${encodeURIComponent(oldName)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: cleanName }),
      });
      const data = await res.json();
      if (data.success) {
        if (this.currentBoard === oldName) {
          this.currentBoard = cleanName;
          this.updateBoardName();
        }
        this.refreshDropdownList();
        console.log(`Board renamed: "${oldName}" → "${cleanName}"`);
      } else {
        await Dialog.alert(data.error || 'Rename failed', 'ERROR');
      }
    } catch (err) {
      console.error('Rename failed:', err);
    }
  },

  async createNewBoard() {
    const name = await Dialog.prompt('Board name:', '', 'NEW BOARD');
    if (!name || !name.trim()) return;
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    Collab.leaveBoard();
    if (App.elements.length > 0) await this.save(this.currentBoard);

    App.elements = [];
    App.connections = [];
    this.currentBoard = cleanName;
    this.updateBoardName();

    Elements.clearSelection();
    Elements.renderAll();
    Connections.render();
    Canvas.panX = window.innerWidth / 2;
    Canvas.panY = (window.innerHeight - 40) / 2;
    Canvas.zoom = 1;
    Canvas.updateTransform();
    Canvas.drawGrid();
    Canvas.updateMinimap();
    History.clear();
    History.push({ elements: [], connections: [] });

    await this.save(cleanName);
    this.closeDropdown();
    console.log(`New board "${cleanName}" created`);
  },

  async deleteBoard(name) {
    try {
      await fetch(`/api/boards/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (name === this.currentBoard) {
        const res = await fetch('/api/boards');
        const boards = await res.json();
        const remaining = boards.filter(b => b.name !== name);
        if (remaining.length > 0) {
          this.load(remaining[0].name);
        } else {
          App.elements = [];
          App.connections = [];
          this.currentBoard = 'default';
          this.updateBoardName();
          Elements.clearSelection();
          Elements.renderAll();
          Connections.render();
          Canvas.updateMinimap();
          History.clear();
          History.push({ elements: [], connections: [] });
        }
      }
      this.refreshDropdownList();
      console.log(`Board "${name}" deleted`);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  },

  updateBoardName() {
    const el = document.getElementById('current-board-name');
    if (el) el.textContent = this.currentBoard;
    document.title = `SAMESAMEBUTDIFFERENT — ${this.currentBoard}`;
  },

  async openKeysModal(boardName) {
    this.closeDropdown();
    document.getElementById('board-keys-modal-name').textContent = boardName;
    document.getElementById('board-keys-modal').classList.remove('hidden');
    await this.renderKeysModal(boardName);
    document.getElementById('board-keys-close').onclick = () =>
      document.getElementById('board-keys-modal').classList.add('hidden');
  },

  async renderKeysModal(boardName) {
    const body = document.getElementById('board-keys-body');
    body.innerHTML = '<div style="padding:12px;font-family:var(--font-mono);font-size:10px;color:var(--dark-grey)">Loading…</div>';
    const res = await fetch(`/api/boards/${encodeURIComponent(boardName)}/keys`);
    const keys = await res.json();
    body.innerHTML = '';

    // Key list
    if (keys.length === 0) {
      body.innerHTML += '<div class="keys-empty">No keys yet</div>';
    } else {
      keys.forEach(k => {
        const row = document.createElement('div');
        row.className = 'key-row';
        row.innerHTML = `
          <div class="key-row-left">
            <span class="key-label">${DOMPurify.sanitize(k.label)}</span>
            <span class="key-meta">${k.readOnly ? 'READ-ONLY' : 'READ/WRITE'} · created ${this.formatTimeAgo(k.createdAt)}${k.lastUsed ? ' · used ' + this.formatTimeAgo(k.lastUsed) : ''}</span>
          </div>
          <button class="key-revoke-btn board-action-btn board-action-delete" data-id="${k.id}" title="Revoke">✕</button>
        `;
        row.querySelector('.key-revoke-btn').addEventListener('click', async () => {
          if (!await Dialog.confirm(`Revoke key "${k.label}"?`)) return;
          await fetch(`/api/boards/${encodeURIComponent(boardName)}/keys/${k.id}`, { method: 'DELETE' });
          this.renderKeysModal(boardName);
        });
        body.appendChild(row);
      });
    }

    // Generate new key form
    const form = document.createElement('div');
    form.className = 'key-generate-form';
    form.innerHTML = `
      <input type="text" class="key-label-input" placeholder="LABEL (e.g. Claude Desktop)" maxlength="64" />
      <label class="key-readonly-label"><input type="checkbox" id="key-readonly-cb"> READ-ONLY</label>
      <button class="btn-primary key-generate-btn">GENERATE KEY →</button>
    `;
    body.appendChild(form);

    form.querySelector('.key-generate-btn').addEventListener('click', async () => {
      const label = form.querySelector('.key-label-input').value.trim() || 'API Key';
      const readOnly = form.querySelector('#key-readonly-cb').checked;
      const r = await fetch(`/api/boards/${encodeURIComponent(boardName)}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, readOnly }),
      });
      const data = await r.json();
      // Show key once
      body.innerHTML = '';
      const reveal = document.createElement('div');
      reveal.className = 'key-reveal';
      reveal.innerHTML = `
        <div class="key-reveal-label">COPY NOW — shown once</div>
        <div class="key-reveal-value" id="key-reveal-value">${data.key}</div>
        <div class="key-reveal-hint">Base URL for MCP: <code>${location.origin}</code></div>
        <button class="btn-primary key-copy-btn">COPY KEY</button>
        <button class="key-done-btn topbar-btn" style="margin-left:8px">DONE</button>
      `;
      reveal.querySelector('.key-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(data.key);
        reveal.querySelector('.key-copy-btn').textContent = 'COPIED ✓';
      });
      reveal.querySelector('.key-done-btn').addEventListener('click', () => this.renderKeysModal(boardName));
      body.appendChild(reveal);
    });
  },

  getBoardApiPath(name, owner) {
    if (owner) return `/api/boards/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    return `/api/boards/${encodeURIComponent(name)}`;
  },

  generateThumbnail() {
    const elements = App.elements;
    if (elements.length === 0) return null;

    const W = 320, H = 200;
    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const ctx = offscreen.getContext('2d');
    const isDark = document.body.classList.contains('dark');

    ctx.fillStyle = isDark ? '#1A1A1A' : '#F2F2F2';
    ctx.fillRect(0, 0, W, H);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach(el => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + (el.width || 100));
      maxY = Math.max(maxY, el.y + (el.height || 60));
    });

    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const cw = maxX - minX, ch = maxY - minY;
    const scale = Math.min(W / cw, H / ch);
    const offsetX = (W - cw * scale) / 2;
    const offsetY = (H - ch * scale) / 2;

    const NOTE_COLORS = { blue: '#0066FF', green: '#00AA44', pink: '#FF0066', purple: '#7700FF', orange: '#FF4500' };

    elements.forEach(el => {
      const ex = (el.x - minX) * scale + offsetX;
      const ey = (el.y - minY) * scale + offsetY;
      const ew = Math.max((el.width || 100) * scale, 2);
      const eh = Math.max((el.height || 60) * scale, 2);
      ctx.save();

      if (el.type === 'note') {
        ctx.fillStyle = isDark ? '#2A2A2A' : '#FFFEF0';
        ctx.fillRect(ex, ey, ew, eh);
        const accent = NOTE_COLORS[el.noteColor] || (isDark ? '#555' : '#CCC');
        ctx.fillStyle = accent;
        ctx.fillRect(ex, ey, Math.max(2, 3 * scale), eh);
      } else if (el.type === 'image') {
        ctx.fillStyle = isDark ? '#333' : '#DDD';
        ctx.fillRect(ex, ey, ew, eh);
        ctx.strokeStyle = isDark ? '#444' : '#BBB';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(ex, ey, ew, eh);
        // small photo icon lines
        if (ew > 8 && eh > 6) {
          ctx.strokeStyle = isDark ? '#555' : '#AAA';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          const mx = ex + ew * 0.5, my = ey + eh * 0.6;
          ctx.moveTo(ex + ew * 0.15, ey + eh * 0.75);
          ctx.lineTo(mx - ew * 0.15, my - eh * 0.2);
          ctx.lineTo(mx + ew * 0.15, my);
          ctx.lineTo(ex + ew * 0.85, ey + eh * 0.55);
          ctx.stroke();
        }
      } else if (el.type === 'rect') {
        ctx.fillStyle = el.fillColor && el.fillColor !== 'transparent' ? el.fillColor : (isDark ? '#2A2A2A' : '#E8E8E8');
        ctx.fillRect(ex, ey, ew, eh);
        ctx.strokeStyle = el.borderColor || (isDark ? '#666' : '#444');
        ctx.lineWidth = 0.5;
        ctx.strokeRect(ex, ey, ew, eh);
      } else if (el.type === 'circle') {
        ctx.fillStyle = el.fillColor && el.fillColor !== 'transparent' ? el.fillColor : (isDark ? '#2A2A2A' : '#E8E8E8');
        ctx.strokeStyle = el.borderColor || (isDark ? '#666' : '#444');
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.ellipse(ex + ew / 2, ey + eh / 2, ew / 2, eh / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (el.type === 'text') {
        ctx.fillStyle = isDark ? '#CCC' : '#333';
        const fs = Math.max(5, Math.min(9, eh * 0.7));
        ctx.font = `${fs}px sans-serif`;
        ctx.fillText((el.content || '').slice(0, 30), ex, ey + fs);
      } else if (el.type === 'icon') {
        ctx.font = `${Math.max(8, Math.min(eh, ew) * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el.content || '●', ex + ew / 2, ey + eh / 2);
      } else {
        ctx.fillStyle = isDark ? '#2A2A2A' : '#E0E0E0';
        ctx.fillRect(ex, ey, ew, eh);
        ctx.strokeStyle = isDark ? '#444' : '#CCC';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(ex, ey, ew, eh);
      }
      ctx.restore();
    });

    return offscreen.toDataURL('image/jpeg', 0.75);
  },

  async save(name) {
    this.currentBoard = name;
    this.updateBoardName();
    const thumbnail = this.generateThumbnail();
    const data = {
      elements: App.elements,
      connections: App.connections,
      viewport: { panX: Canvas.panX, panY: Canvas.panY, zoom: Canvas.zoom },
      ...(thumbnail ? { thumbnail } : {}),
    };
    try {
      const url = this.getBoardApiPath(name, this.currentBoardOwner);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (err) {
      console.error('Save failed:', err);
    }
  },

  async load(name, owner) {
    try {
      this.currentBoardOwner = owner || null;
      const url = this.getBoardApiPath(name, owner);
      const res = await fetch(url);
      const data = await res.json();

      App.elements = data.elements || [];
      App.connections = data.connections || [];
      this.currentBoard = name;
      this.updateBoardName();

      if (data.viewport) {
        Canvas.panX = data.viewport.panX;
        Canvas.panY = data.viewport.panY;
        Canvas.zoom = data.viewport.zoom;
        Canvas.updateTransform();
        Canvas.drawGrid();
      }

      Elements.maxZIndex = App.elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 1);
      Elements.clearSelection();
      Elements.renderAll();
      Connections.render();
      Canvas.updateMinimap();
      History.clear();
      History.push({ elements: App.elements, connections: App.connections });
      Collab.joinBoard(name, owner || null);

      console.log(`Board "${name}" loaded${owner ? ` (shared by ${owner})` : ''}`);
    } catch (err) {
      console.error('Load failed:', err);
    }
  },

  autoSave() {
    if (App.elements.length > 0) this.save(this.currentBoard);
  },

  showSaveModal() {
    const modal = document.getElementById('save-modal');
    document.getElementById('save-modal-title').textContent = 'SAVE BOARD';
    const confirm = document.getElementById('save-confirm');
    const input = document.getElementById('board-name-input');
    confirm.textContent = 'SAVE →';
    confirm.classList.remove('hidden');
    input.classList.remove('hidden');
    input.value = this.currentBoard;
    modal.classList.remove('hidden');
    input.focus();
    input.select();
    this.loadBoardList(document.getElementById('board-list'), false);
  },

  async showShareModal() {
    // Only owner can share (not shared boards)
    if (this.currentBoardOwner) return;
    const modal = document.getElementById('share-modal');
    const body = document.getElementById('share-modal-body');
    body.innerHTML = '<div style="padding:12px;font-family:var(--font-mono);font-size:10px;color:var(--dark-grey)">Loading…</div>';
    modal.classList.remove('hidden');

    // Fetch current share status
    const res = await fetch(`/api/boards/${encodeURIComponent(this.currentBoard)}/share`);
    const state = res.ok ? await res.json() : { enabled: false, shareToken: null, hasPassword: false };
    this._renderShareModal(body, state);
  },

  _renderShareModal(body, state) {
    const origin = window.location.origin;
    const shareUrl = state.shareToken ? `${origin}/share/${state.shareToken}` : '';

    body.innerHTML = `
      <div class="share-status-row">
        <span class="share-status-label">SHARING</span>
        <button id="share-toggle" class="share-toggle ${state.enabled ? 'active' : ''}">
          ${state.enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      ${state.enabled ? `
        <div class="share-section-label">LINK</div>
        <div class="share-link-row">
          <input class="share-link-input" type="text" value="${Utils.escapeAttr(shareUrl)}" readonly id="share-link-val" onclick="this.select()" />
          <button class="share-copy-btn" id="share-copy-btn">COPY</button>
        </div>
        <div class="share-section-label" style="margin-top:14px">PASSWORD${state.hasPassword ? ' <span style="color:var(--accent)">✓</span>' : ''}</div>
        <div class="share-pw-row">
          <input class="share-pw-input" type="password" id="share-pw-input" placeholder="${state.hasPassword ? 'change or clear to remove…' : 'optional…'}" autocomplete="new-password" />
          <button class="share-pw-save" id="share-pw-save">SET</button>
          ${state.hasPassword ? `<button class="share-pw-remove" id="share-pw-remove">REMOVE</button>` : ''}
        </div>
      ` : '<div class="share-off-hint">Enable sharing to generate a link anyone can open.</div>'}
    `;

    // Toggle on/off
    document.getElementById('share-toggle').addEventListener('click', async () => {
      if (state.enabled) {
        await fetch(`/api/boards/${encodeURIComponent(this.currentBoard)}/share`, { method: 'DELETE' });
        const newState = { enabled: false, shareToken: null, hasPassword: false };
        this._renderShareModal(body, newState);
      } else {
        const r = await fetch(`/api/boards/${encodeURIComponent(this.currentBoard)}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        const newState = await r.json();
        this._renderShareModal(body, { enabled: true, shareToken: newState.shareToken, hasPassword: newState.hasPassword });
      }
    });

    if (!state.enabled) return;

    // Copy link
    document.getElementById('share-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(shareUrl).then(() => {
        const btn = document.getElementById('share-copy-btn');
        if (btn) { btn.textContent = 'COPIED!'; setTimeout(() => { btn.textContent = 'COPY'; }, 2000); }
      });
    });

    // Set password
    document.getElementById('share-pw-save').addEventListener('click', async () => {
      const pw = document.getElementById('share-pw-input').value;
      const r = await fetch(`/api/boards/${encodeURIComponent(this.currentBoard)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const newState = await r.json();
      this._renderShareModal(body, { enabled: true, shareToken: newState.shareToken, hasPassword: newState.hasPassword });
    });

    // Remove password
    document.getElementById('share-pw-remove')?.addEventListener('click', async () => {
      const r = await fetch(`/api/boards/${encodeURIComponent(this.currentBoard)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: '' }),
      });
      const newState = await r.json();
      this._renderShareModal(body, { enabled: true, shareToken: newState.shareToken, hasPassword: false });
    });
  },

  showLoadModal() {
    const modal = document.getElementById('save-modal');
    document.getElementById('save-modal-title').textContent = 'LOAD BOARD';
    document.getElementById('save-confirm').classList.add('hidden');
    document.getElementById('board-name-input').classList.add('hidden');
    modal.classList.remove('hidden');
    this.loadBoardList(document.getElementById('board-list'), true);
  },

  // ═══ DASHBOARD ═══
  showDashboard() {
    const dash = document.getElementById('boards-dashboard');
    dash.classList.remove('hidden');
    document.getElementById('topbar').classList.add('topbar-dashboard');
    this.refreshDashboard();
  },

  hideDashboard() {
    document.getElementById('boards-dashboard').classList.add('hidden');
    document.getElementById('topbar').classList.remove('topbar-dashboard');
  },

  async refreshDashboard() {
    const grid = document.getElementById('dashboard-grid');
    try {
      const res = await fetch('/api/boards');
      const boards = await res.json();
      grid.innerHTML = '';

      if (boards.length === 0) {
        grid.innerHTML = '<div style="padding:20px;font-family:var(--font-mono);font-size:11px;color:var(--dark-grey);letter-spacing:1px;grid-column:1/-1">No boards yet. Create your first board above.</div>';
        return;
      }

      boards.forEach(board => {
        const isShared = board.shared;
        const card = document.createElement('div');
        card.className = 'dash-card';

        // Thumbnail
        const thumbUrl = isShared
          ? `/api/boards/${encodeURIComponent(board.owner)}/${encodeURIComponent(board.name)}/thumb`
          : `/api/boards/${encodeURIComponent(board.name)}/thumb`;
        const thumb = document.createElement('div');
        thumb.className = 'dash-card-thumb';
        const img = document.createElement('img');
        img.src = thumbUrl;
        img.alt = '';
        img.onerror = () => { thumb.classList.add('no-thumb'); };
        thumb.appendChild(img);
        card.appendChild(thumb);

        const body = document.createElement('div');
        body.className = 'dash-card-body';

        const name = document.createElement('div');
        name.className = 'dash-card-name';
        name.textContent = board.name;

        const meta = document.createElement('div');
        meta.className = 'dash-card-meta';
        meta.innerHTML = `
          <span>${board.elementCount || 0} elements</span>
          <span>edited ${this.formatTimeAgo(board.lastEdit)}</span>
          ${board.created ? `<span>created ${this.formatDateTime(board.created)}</span>` : ''}
        `;

        if (isShared) {
          const badge = document.createElement('div');
          badge.className = 'dash-card-badge';
          badge.textContent = `SHARED BY ${board.owner.toUpperCase()}`;
          body.appendChild(badge);
        }

        body.appendChild(name);
        body.appendChild(meta);
        card.appendChild(body);

        // Footer with persistent action buttons
        const footer = document.createElement('div');
        footer.className = 'dash-card-footer';

        const footerLeft = document.createElement('div');
        footerLeft.className = 'dash-card-footer-left';

        const footerRight = document.createElement('div');
        footerRight.className = 'dash-card-footer-right';

        if (!isShared) {
          const pinned = this.getPinnedBoards();
          const isPinned = pinned.includes(board.name);

          const pinBtn = document.createElement('button');
          pinBtn.className = 'dash-card-btn' + (isPinned ? ' is-pinned' : '');
          pinBtn.textContent = '★';
          pinBtn.title = isPinned ? 'Unpin' : 'Pin to top';
          pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePin(board.name);
            this.refreshDashboard();
          });
          footerLeft.appendChild(pinBtn);

          const keyBtn = document.createElement('button');
          keyBtn.className = 'dash-card-btn';
          keyBtn.textContent = '⚿';
          keyBtn.title = 'MCP / API Keys';
          keyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openKeysModal(board.name);
          });
          footerLeft.appendChild(keyBtn);

          const renameBtn = document.createElement('button');
          renameBtn.className = 'dash-card-btn';
          renameBtn.textContent = '✎';
          renameBtn.title = 'Rename';
          renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.renameBoard(board.name).then(() => this.refreshDashboard());
          });
          footerRight.appendChild(renameBtn);

          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'dash-card-btn danger';
          deleteBtn.textContent = '✕';
          deleteBtn.title = 'Delete';
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (await Dialog.confirm(`Delete board "${board.name}"?`)) {
              await this.deleteBoardOnly(board.name);
              this.refreshDashboard();
            }
          });
          footerRight.appendChild(deleteBtn);
        }

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'dash-card-btn';
        downloadBtn.textContent = '↓';
        downloadBtn.title = 'Download as JSON';
        downloadBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.downloadBoardByName(board.name, isShared ? board.owner : null, downloadBtn);
        });
        footerRight.appendChild(downloadBtn);

        footer.appendChild(footerLeft);
        footer.appendChild(footerRight);
        card.appendChild(footer);

        card.addEventListener('click', () => {
          const params = new URLSearchParams({ board: board.name });
          if (isShared) params.set('owner', board.owner);
          window.location.href = '/canvas?' + params.toString();
        });

        grid.appendChild(card);
      });
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  },

  async deleteBoardOnly(name) {
    try {
      await fetch(`/api/boards/${encodeURIComponent(name)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Delete failed:', err);
    }
  },

  initDashboard() {
    const importInput = document.getElementById('dashboard-import-input');
    document.getElementById('dashboard-import-board').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        this.importBoardFromJson(e.target.files[0]);
        e.target.value = '';
      }
    });

    document.getElementById('dashboard-new-board').addEventListener('click', async () => {
      const name = await Dialog.prompt('Board name:', '', 'NEW BOARD');
      if (!name || !name.trim()) return;
      const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      await fetch(`/api/boards/${encodeURIComponent(cleanName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements: [], connections: [], viewport: { panX: 0, panY: 0, zoom: 1 } }),
      });
      window.location.href = `/canvas?board=${encodeURIComponent(cleanName)}`;
    });
  },

  async _embedFiles(elements) {
    await Promise.all(elements.map(async el => {
      if ((el.type === 'image' || el.type === 'file') && el.url && el.url.startsWith('/uploads/')) {
        try {
          const res = await fetch(el.url);
          const blob = await res.blob();
          el._embedded = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (err) {
          console.warn('Could not embed file:', el.url, err);
        }
      }
    }));
  },

  async _reuploadEmbedded(elements) {
    await Promise.all(elements.map(async el => {
      if (el._embedded) {
        try {
          const res = await fetch(el._embedded);
          const blob = await res.blob();
          const formData = new FormData();
          formData.append('file', blob, el.originalName || `file_${el.id}`);
          const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
          const uploadData = await uploadRes.json();
          if (uploadData.url) el.url = uploadData.url;
        } catch (err) {
          console.warn('Could not re-upload embedded file:', err);
        }
        delete el._embedded;
      }
    }));
  },

  async downloadBoardByName(name, owner, btn) {
    const orig = btn ? btn.textContent : null;
    if (btn) { btn.textContent = '…'; btn.disabled = true; }
    try {
      const url = this.getBoardApiPath(name, owner);
      const res = await fetch(url);
      const data = await res.json();
      const elements = JSON.parse(JSON.stringify(data.elements || []));
      await this._embedFiles(elements);
      const out = { elements, connections: data.connections || [], viewport: data.viewport || {} };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
      a.download = `${name}_${ts}.json`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } finally {
      if (btn) { btn.textContent = orig; btn.disabled = false; }
    }
  },

  async importBoardFromJson(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
      if (!Array.isArray(data.elements)) throw new Error('Missing elements array');
    } catch (err) {
      await Dialog.alert('Invalid board file: ' + err.message, 'ERROR');
      return;
    }

    const defaultName = file.name.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const name = await Dialog.prompt('Import as board name:', defaultName, 'IMPORT BOARD');
    if (!name || !name.trim()) return;
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    const elements = data.elements;
    await this._reuploadEmbedded(elements);

    await fetch(`/api/boards/${encodeURIComponent(cleanName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elements,
        connections: data.connections || [],
        viewport: data.viewport || { panX: 0, panY: 0, zoom: 1 },
      }),
    });

    this.refreshDashboard();
  },

  async loadBoardList(container, clickToLoad) {
    try {
      const res = await fetch('/api/boards');
      const boards = await res.json();
      container.innerHTML = '';

      if (boards.length === 0) {
        container.innerHTML = '<div style="color:var(--dark-grey);font-family:var(--font-mono);font-size:10px;padding:10px;">No saved boards yet</div>';
        return;
      }

      boards.forEach(board => {
        const item = document.createElement('div');
        item.className = 'board-item';
        item.innerHTML = `<span>${board.name}</span><span style="font-size:9px;color:var(--dark-grey)">${board.elementCount} items · ${this.formatTimeAgo(board.lastEdit)}</span>`;
        if (board.name === this.currentBoard) {
          item.style.borderLeftColor = 'var(--accent)';
          item.style.borderLeftWidth = '3px';
        }
        item.addEventListener('click', () => {
          if (clickToLoad) {
            this.load(board.name);
            document.getElementById('save-modal').classList.add('hidden');
          } else {
            document.getElementById('board-name-input').value = board.name;
          }
        });
        container.appendChild(item);
      });
    } catch (err) {
      console.error('Failed to list boards:', err);
    }
  },
};
