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
    document.title = `EVERTHINGBAGLE — ${this.currentBoard}`;
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
    const payload = await res.json();
    const keys = payload.keys || payload; // backwards compat
    const boardId = payload.boardId || null;
    body.innerHTML = '';

    // MCP endpoint hint
    if (boardId) {
      const hint = document.createElement('div');
      hint.className = 'key-reveal-hint';
      hint.style.cssText = 'margin-bottom:12px;padding-bottom:10px;border-bottom:var(--border-light)';
      hint.innerHTML = `Claude.ai connector URL: <code style="user-select:all">${location.origin}/mcp/${encodeURIComponent(payload.owner || '') || '…'}/${boardId}</code>`;
      body.appendChild(hint);
    }

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
        <div class="key-reveal-hint">Claude.ai connector URL: <code>${location.origin}/mcp/${data.owner || ''}/${boardId || ''}</code></div>
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
      // Adapt stored colors to current dark/light mode on load
      App.swapElementColors(false, document.body.classList.contains('dark'));
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

      const pinned = this.getPinnedBoards();
      const sorted = [...boards].sort((a, b) => {
        const ap = !a.shared && pinned.includes(a.name) ? 0 : 1;
        const bp = !b.shared && pinned.includes(b.name) ? 0 : 1;
        return ap - bp;
      });

      const hasPinned = sorted.some(b => !b.shared && pinned.includes(b.name));
      let sectionShown = { pinned: false, rest: false };

      sorted.forEach(board => {
        const isShared = board.shared;
        const isPinned = !isShared && pinned.includes(board.name);

        if (hasPinned) {
          if (isPinned && !sectionShown.pinned) {
            const h = document.createElement('div');
            h.className = 'dash-section-header';
            h.textContent = 'PINNED';
            grid.appendChild(h);
            sectionShown.pinned = true;
          } else if (!isPinned && !sectionShown.rest) {
            const h = document.createElement('div');
            h.className = 'dash-section-header';
            h.textContent = 'ALL BOARDS';
            grid.appendChild(h);
            sectionShown.rest = true;
          }
        }

        const card = document.createElement('div');
        card.className = 'dash-card' + (isPinned ? ' is-pinned' : '');

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
        meta.innerHTML = `<span>${board.elementCount || 0} elements · edited ${this.formatTimeAgo(board.lastEdit)}</span>`;

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

  async _embedFiles(elements, onProgress) {
    const targets = elements.filter(el =>
      (el.type === 'image' || el.type === 'file') && el.url && el.url.startsWith('/uploads/'));
    let done = 0;

    // Batched instead of all-at-once: boards with many uploads would otherwise
    // open hundreds of parallel fetches and hold every decoded file at peak.
    for (let i = 0; i < targets.length; i += 4) {
      await Promise.all(targets.slice(i, i + 4).map(async el => {
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
        done++;
        if (onProgress) onProgress(done, targets.length);
      }));
    }
  },

  // Serialises a board into JSON chunks rather than one string. A single
  // JSON.stringify() of a board with embedded files can exceed the engine's
  // max string length (~512MB in V8) and throws RangeError.
  _boardJsonParts(out) {
    const parts = ['{"elements":['];
    out.elements.forEach((el, i) => {
      if (i) parts.push(',');
      const embedded = el._embedded;
      if (embedded === undefined) {
        parts.push(JSON.stringify(el));
      } else {
        const rest = { ...el };
        delete rest._embedded;
        const head = JSON.stringify(rest);
        parts.push(head === '{}' ? '{"_embedded":' : head.slice(0, -1) + ',"_embedded":');
        parts.push(JSON.stringify(embedded));
        parts.push('}');
      }
    });
    parts.push('],"connections":', JSON.stringify(out.connections));
    parts.push(',"viewport":', JSON.stringify(out.viewport), '}');
    return parts;
  },

  // Writes straight to the chosen file, so nothing bigger than one chunk is ever
  // held in memory. A blob download of a multi-hundred-MB board can be silently
  // truncated by the browser's blob storage limits.
  async _writeParts(handle, parts) {
    const writable = await handle.createWritable();
    try {
      let buf = '';
      for (const part of parts) {
        buf += part;
        if (buf.length >= 4 * 1024 * 1024) { await writable.write(buf); buf = ''; }
      }
      if (buf) await writable.write(buf);
    } finally {
      await writable.close();
    }
  },

  _downloadViaBlob(parts, filename) {
    const blob = new Blob(parts, { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.click();
    // Revoking while the browser is still writing truncates the file — hold the
    // URL until the page goes away instead of guessing at a timeout.
    window.addEventListener('pagehide', () => URL.revokeObjectURL(blobUrl), { once: true });
    return blob.size;
  },

  async _uploadEmbedded(el) {
    const res = await fetch(el._embedded);
    const blob = await res.blob();
    const formData = new FormData();
    formData.append('file', blob, el.originalName || `file_${el.id}`);

    // The server rate-limits uploads (30/min) — a board with more files than that
    // would otherwise lose every attachment past the limit.
    for (let attempt = 0; attempt < 4; attempt++) {
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      if (uploadRes.status === 429) {
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
      if (!uploadRes.ok) throw new Error(`upload failed (${uploadRes.status})`);
      const uploadData = await uploadRes.json();
      if (uploadData.url) el.url = uploadData.url;
      return;
    }
    throw new Error('upload rate limit');
  },

  async _reuploadEmbedded(elements, onProgress) {
    const targets = elements.filter(el => el._embedded);
    let done = 0, failed = 0;

    for (let i = 0; i < targets.length; i += 3) {
      await Promise.all(targets.slice(i, i + 3).map(async el => {
        try {
          await this._uploadEmbedded(el);
        } catch (err) {
          failed++;
          console.warn('Could not re-upload embedded file:', el.originalName, err);
        }
        delete el._embedded;
        done++;
        if (onProgress) onProgress(done, targets.length);
      }));
    }
    return { total: targets.length, failed };
  },

  async downloadBoardByName(name, owner, btn) {
    const orig = btn ? btn.textContent : null;
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
    const filename = `${name}_${ts}.json`;

    // Ask for the target file first — the picker needs the click's user gesture,
    // which is gone by the time the board and its files are fetched.
    let handle = null;
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Board JSON', accept: { 'application/json': ['.json'] } }],
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        handle = null; // picker unavailable (e.g. cross-origin frame) → blob fallback
      }
    }

    if (btn) { btn.textContent = '…'; btn.disabled = true; }
    try {
      const url = this.getBoardApiPath(name, owner);
      const res = await fetch(url);
      const data = await res.json();
      const elements = (data.elements || []).map(el => ({ ...el }));
      await this._embedFiles(elements, (done, total) => {
        if (btn && total > 1) btn.textContent = `${done}/${total}`;
      });
      if (btn) btn.textContent = '…';
      const out = { elements, connections: data.connections || [], viewport: data.viewport || {} };
      const parts = this._boardJsonParts(out);
      const size = parts.reduce((n, p) => n + p.length, 0);

      if (handle) await this._writeParts(handle, parts);
      else this._downloadViaBlob(parts, filename);

      Utils.toast(`Exported ${name} · ${Utils.formatFileSize(size)}`);
    } catch (err) {
      console.error('Board export failed:', err);
      await Dialog.alert('Export failed: ' + err.message, 'ERROR');
    } finally {
      if (btn) { btn.textContent = orig; btn.disabled = false; }
    }
  },

  async importBoardFromJson(file) {
    let data;
    try {
      const text = await file.text();
      // A cut-off export parses as "Unexpected end of JSON input" — say so plainly
      // instead of blaming the format.
      if (!text.trimEnd().endsWith('}')) {
        throw new Error(`file is incomplete (${Utils.formatFileSize(file.size)}) — the download was cut off, export it again`);
      }
      data = JSON.parse(text);
      if (!Array.isArray(data.elements)) throw new Error('Missing elements array');
    } catch (err) {
      const msg = err instanceof RangeError
        ? `file is too large to read in the browser (${Utils.formatFileSize(file.size)})`
        : err.message;
      await Dialog.alert('Invalid board file: ' + msg, 'ERROR');
      return;
    }

    const defaultName = file.name.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const name = await Dialog.prompt('Import as board name:', defaultName, 'IMPORT BOARD');
    if (!name || !name.trim()) return;
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    const elements = data.elements;
    const result = await this._reuploadEmbedded(elements, (done, total) => {
      if (total > 1) Utils.toast(`Restoring files ${done}/${total}`, 1200);
    });

    const saveRes = await fetch(`/api/boards/${encodeURIComponent(cleanName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elements,
        connections: data.connections || [],
        viewport: data.viewport || { panX: 0, panY: 0, zoom: 1 },
      }),
    });

    if (!saveRes.ok) {
      await Dialog.alert(`Could not save board (${saveRes.status})`, 'ERROR');
      return;
    }
    if (result.failed) {
      await Dialog.alert(`Imported, but ${result.failed} of ${result.total} files could not be restored.`, 'WARNING');
    }

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
