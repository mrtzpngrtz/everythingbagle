/* === EVERTHINGBAGLE — Admin CMS === */
const Admin = {
  currentUser: null,

  async init() {
    // Check auth
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (!data.user || data.user.role !== 'admin') {
        window.location.href = '/login';
        return;
      }
      this.currentUser = data.user;
      document.getElementById('admin-username').textContent = data.user.username;
    } catch {
      window.location.href = '/login';
      return;
    }

    this.initNav();
    this.initLogout();
    this.initModals();
    this.loadOverview();
    this.loadUsers();
    this.loadBoards();
    this.loadSuggestions();

    document.getElementById('btn-add-user').addEventListener('click', () => this.showCreateUserModal());

    console.log('EVERTHINGBAGLE Admin — Ready');
  },

  // ═══ NAVIGATION ═══
  initNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById('section-' + btn.dataset.section).classList.add('active');
      });
    });
  },

  initLogout() {
    document.getElementById('admin-logout').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  },

  // ═══ MODALS ═══
  initModals() {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeModal();
    });
  },

  showModal(title, bodyHtml, footerHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml;
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  },

  // ═══ OVERVIEW ═══
  async loadOverview() {
    try {
      const res = await fetch('/api/admin/stats');
      const stats = await res.json();
      document.getElementById('stat-users').textContent = stats.totalUsers;
      document.getElementById('stat-boards').textContent = stats.totalBoards;
      document.getElementById('stat-elements').textContent = stats.totalElements;
      document.getElementById('stat-suggestions').textContent = stats.totalSuggestions;
      document.getElementById('stat-uploads').textContent = this.formatSize(stats.uploadsSize);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }

    try {
      const res = await fetch('/api/admin/settings');
      const settings = await res.json();
      const toggle = document.getElementById('toggle-registration');
      const label = document.getElementById('toggle-registration-label');
      toggle.checked = settings.registrationEnabled;
      label.textContent = settings.registrationEnabled ? 'ENABLED' : 'DISABLED';

      toggle.addEventListener('change', async () => {
        const r = await fetch('/api/admin/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationEnabled: toggle.checked }),
        });
        const updated = await r.json();
        label.textContent = updated.registrationEnabled ? 'ENABLED' : 'DISABLED';
      });
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  },

  // ═══ USERS ═══
  async loadUsers() {
    try {
      const res = await fetch('/api/admin/users');
      const users = await res.json();
      const tbody = document.getElementById('users-tbody');
      tbody.innerHTML = '';

      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No users found</td></tr>';
        return;
      }

      users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${this.esc(user.username)}</strong></td>
          <td>${this.esc(user.displayName)}</td>
          <td><span class="role-badge ${user.role}">${user.role.toUpperCase()}</span></td>
          <td>${user.boardCount}</td>
          <td>${this.timeAgo(user.lastLogin)}</td>
          <td>${this.timeAgo(user.created)}</td>
          <td>
            <div class="action-btns">
              <button class="action-btn" data-action="edit" data-id="${user.id}">EDIT</button>
              <button class="action-btn" data-action="resetpw" data-id="${user.id}">PWD</button>
              <button class="action-btn danger" data-action="delete" data-id="${user.id}" data-username="${this.esc(user.username)}">DEL</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind actions
      tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const user = users.find(u => u.id === btn.dataset.id);
          if (user) this.showEditUserModal(user);
        });
      });

      tbody.querySelectorAll('[data-action="resetpw"]').forEach(btn => {
        btn.addEventListener('click', () => this.showResetPasswordModal(btn.dataset.id));
      });

      tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => this.deleteUser(btn.dataset.id, btn.dataset.username));
      });

    } catch (err) {
      console.error('Failed to load users:', err);
    }
  },

  showCreateUserModal() {
    const body = `
      <div class="modal-group">
        <label class="modal-label">USERNAME</label>
        <input class="modal-input" id="m-username" placeholder="username" />
      </div>
      <div class="modal-group">
        <label class="modal-label">DISPLAY NAME</label>
        <input class="modal-input" id="m-displayname" placeholder="Display Name (optional)" />
      </div>
      <div class="modal-group">
        <label class="modal-label">PASSWORD</label>
        <input class="modal-input" id="m-password" type="password" placeholder="password" />
      </div>
      <div class="modal-group">
        <label class="modal-label">ROLE</label>
        <select class="modal-select" id="m-role">
          <option value="user">USER</option>
          <option value="admin">ADMIN</option>
        </select>
      </div>
      <div id="m-error" class="modal-error"></div>
    `;
    const footer = `
      <button class="modal-btn secondary" onclick="Admin.closeModal()">CANCEL</button>
      <button class="modal-btn" id="m-create-btn">CREATE →</button>
    `;
    this.showModal('CREATE USER', body, footer);

    document.getElementById('m-create-btn').addEventListener('click', async () => {
      const username = document.getElementById('m-username').value.trim();
      const displayName = document.getElementById('m-displayname').value.trim();
      const password = document.getElementById('m-password').value;
      const role = document.getElementById('m-role').value;
      const errorEl = document.getElementById('m-error');

      if (!username || !password) {
        errorEl.textContent = 'Username and password required';
        return;
      }

      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, displayName, role }),
        });
        const data = await res.json();
        if (data.success) {
          this.closeModal();
          this.loadUsers();
          this.loadOverview();
        } else {
          errorEl.textContent = data.error || 'Failed';
        }
      } catch {
        errorEl.textContent = 'Connection error';
      }
    });
  },

  showEditUserModal(user) {
    const body = `
      <div class="modal-group">
        <label class="modal-label">USERNAME</label>
        <input class="modal-input" value="${this.esc(user.username)}" disabled style="opacity:0.5" />
      </div>
      <div class="modal-group">
        <label class="modal-label">DISPLAY NAME</label>
        <input class="modal-input" id="m-edit-displayname" value="${this.esc(user.displayName)}" />
      </div>
      <div class="modal-group">
        <label class="modal-label">ROLE</label>
        <select class="modal-select" id="m-edit-role">
          <option value="user" ${user.role === 'user' ? 'selected' : ''}>USER</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>ADMIN</option>
        </select>
      </div>
      <div id="m-error" class="modal-error"></div>
    `;
    const footer = `
      <button class="modal-btn secondary" onclick="Admin.closeModal()">CANCEL</button>
      <button class="modal-btn" id="m-save-btn">SAVE →</button>
    `;
    this.showModal('EDIT USER', body, footer);

    document.getElementById('m-save-btn').addEventListener('click', async () => {
      const displayName = document.getElementById('m-edit-displayname').value.trim();
      const role = document.getElementById('m-edit-role').value;
      const errorEl = document.getElementById('m-error');

      try {
        const res = await fetch(`/api/admin/users/${user.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName, role }),
        });
        const data = await res.json();
        if (data.success) {
          this.closeModal();
          this.loadUsers();
        } else {
          errorEl.textContent = data.error || 'Failed';
        }
      } catch {
        errorEl.textContent = 'Connection error';
      }
    });
  },

  showResetPasswordModal(userId) {
    const body = `
      <div class="modal-group">
        <label class="modal-label">NEW PASSWORD</label>
        <input class="modal-input" id="m-newpw" type="password" placeholder="New password..." />
      </div>
      <div class="modal-group">
        <label class="modal-label">CONFIRM PASSWORD</label>
        <input class="modal-input" id="m-newpw2" type="password" placeholder="Confirm..." />
      </div>
      <div id="m-error" class="modal-error"></div>
    `;
    const footer = `
      <button class="modal-btn secondary" onclick="Admin.closeModal()">CANCEL</button>
      <button class="modal-btn" id="m-resetpw-btn">RESET →</button>
    `;
    this.showModal('RESET PASSWORD', body, footer);

    document.getElementById('m-resetpw-btn').addEventListener('click', async () => {
      const pw = document.getElementById('m-newpw').value;
      const pw2 = document.getElementById('m-newpw2').value;
      const errorEl = document.getElementById('m-error');

      if (!pw || pw.length < 3) { errorEl.textContent = 'Min 3 characters'; return; }
      if (pw !== pw2) { errorEl.textContent = 'Passwords do not match'; return; }

      try {
        const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: pw }),
        });
        const data = await res.json();
        if (data.success) {
          this.closeModal();
        } else {
          errorEl.textContent = data.error || 'Failed';
        }
      } catch {
        errorEl.textContent = 'Connection error';
      }
    });
  },

  async deleteUser(id, username) {
    if (!confirm(`Delete user "${username}" and all their boards?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.loadUsers();
        this.loadOverview();
        this.loadBoards();
      } else {
        alert(data.error || 'Failed to delete user');
      }
    } catch {
      alert('Connection error');
    }
  },

  // ═══ BOARDS ═══
  async loadBoards() {
    try {
      const res = await fetch('/api/admin/boards');
      const boards = await res.json();
      const tbody = document.getElementById('boards-tbody');
      tbody.innerHTML = '';

      if (boards.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No boards found</td></tr>';
        return;
      }

      boards.forEach(board => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${this.esc(board.name)}</strong></td>
          <td>${this.esc(board.owner)}</td>
          <td>${board.elementCount}</td>
          <td>${this.timeAgo(board.lastEdit)}</td>
          <td>${this.timeAgo(board.created)}</td>
          <td>
            <div class="action-btns">
              <button class="action-btn" data-action="share-board" data-owner="${this.esc(board.owner)}" data-name="${this.esc(board.name)}">SHARE</button>
              <button class="action-btn danger" data-action="delete-board" data-owner="${this.esc(board.owner)}" data-name="${this.esc(board.name)}">DELETE</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('[data-action="share-board"]').forEach(btn => {
        btn.addEventListener('click', () => this.showShareModal(btn.dataset.owner, btn.dataset.name));
      });

      tbody.querySelectorAll('[data-action="delete-board"]').forEach(btn => {
        btn.addEventListener('click', () => this.deleteBoard(btn.dataset.owner, btn.dataset.name));
      });

    } catch (err) {
      console.error('Failed to load boards:', err);
    }
  },

  async deleteBoard(owner, name) {
    if (!confirm(`Delete board "${name}" owned by ${owner}?`)) return;
    try {
      const res = await fetch(`/api/admin/boards/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.loadBoards();
        this.loadOverview();
      } else {
        alert(data.error || 'Failed');
      }
    } catch {
      alert('Connection error');
    }
  },

  // ═══ SUGGESTIONS ═══
  async loadSuggestions() {
    try {
      const res = await fetch('/api/admin/suggestions');
      const suggestions = await res.json();
      const list = document.getElementById('suggestions-list');
      list.innerHTML = '';

      if (suggestions.length === 0) {
        list.innerHTML = '<div class="empty-state">No suggestions yet</div>';
        return;
      }

      suggestions.forEach((s, idx) => {
        const row = document.createElement('div');
        row.className = 'suggestion-row' + (s.done ? ' done' : '');
        const bullet = s.done ? '✓' : '→';
        const bulletClass = s.done ? 'suggestion-bullet done' : 'suggestion-bullet';
        const doneInfo = s.done && s.doneBy ? ` · done by ${this.esc(s.doneBy)}` : '';
        const toggleLabel = s.done ? 'OPEN' : 'DONE';
        const toggleClass = s.done ? 'suggestion-toggle reopen' : 'suggestion-toggle';
        row.innerHTML = `
          <span class="${bulletClass}">${bullet}</span>
          <div class="suggestion-content">
            <div class="suggestion-text">${this.esc(s.text)}</div>
            <div class="suggestion-meta">${s.user ? this.esc(s.user) + ' · ' : ''}${this.timeAgo(s.time)}${doneInfo}</div>
          </div>
          <div class="suggestion-actions-admin">
            <button class="${toggleClass}" data-idx="${idx}" title="${toggleLabel}">${toggleLabel}</button>
            <button class="suggestion-delete" data-idx="${idx}" title="Delete">✕</button>
          </div>
        `;
        list.appendChild(row);
      });

      list.querySelectorAll('.suggestion-toggle').forEach(btn => {
        btn.addEventListener('click', () => this.toggleSuggestionDone(parseInt(btn.dataset.idx)));
      });

      list.querySelectorAll('.suggestion-delete').forEach(btn => {
        btn.addEventListener('click', () => this.deleteSuggestion(parseInt(btn.dataset.idx)));
      });

    } catch (err) {
      console.error('Failed to load suggestions:', err);
    }
  },

  async toggleSuggestionDone(idx) {
    try {
      const res = await fetch(`/api/admin/suggestions/${idx}/toggle-done`, { method: 'PATCH' });
      const data = await res.json();
      if (data.success) {
        this.loadSuggestions();
      }
    } catch {
      alert('Connection error');
    }
  },

  async deleteSuggestion(idx) {
    try {
      const res = await fetch(`/api/admin/suggestions/${idx}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.loadSuggestions();
        this.loadOverview();
      }
    } catch {
      alert('Connection error');
    }
  },

  // ═══ SHARE BOARD ═══
  async showShareModal(owner, boardName) {
    // Load users and current collaborators
    let users = [];
    let collaborators = [];
    try {
      const [usersRes, collabRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch(`/api/admin/boards/${encodeURIComponent(owner)}/${encodeURIComponent(boardName)}/collaborators`),
      ]);
      users = await usersRes.json();
      collaborators = await collabRes.json();
    } catch {
      alert('Failed to load data');
      return;
    }

    // Filter out the owner from user options
    const availableUsers = users.filter(u => u.username !== owner && !collaborators.includes(u.username));

    const body = `
      <div class="modal-group">
        <label class="modal-label">BOARD</label>
        <input class="modal-input" value="${this.esc(boardName)} (by ${this.esc(owner)})" disabled style="opacity:0.5" />
      </div>
      <div class="modal-group">
        <label class="modal-label">ADD USER</label>
        <div style="display:flex;gap:6px">
          <select class="modal-select" id="m-share-user" style="flex:1">
            <option value="">— Select user —</option>
            ${availableUsers.map(u => `<option value="${this.esc(u.username)}">${this.esc(u.username)} (${this.esc(u.displayName)})</option>`).join('')}
          </select>
          <button class="modal-btn" id="m-add-collab" style="width:auto;padding:6px 14px">ADD</button>
        </div>
      </div>
      <div class="modal-group">
        <label class="modal-label">COLLABORATORS</label>
        <div id="m-collab-list">
          ${collaborators.length === 0
            ? '<div class="empty-state" style="padding:10px 0">No collaborators yet</div>'
            : collaborators.map(c => `
              <div class="collab-row" data-user="${this.esc(c)}">
                <span class="collab-name">${this.esc(c)}</span>
                <button class="action-btn danger collab-remove" data-user="${this.esc(c)}">REMOVE</button>
              </div>
            `).join('')}
        </div>
      </div>
      <div id="m-error" class="modal-error"></div>
    `;
    const footer = `
      <button class="modal-btn secondary" onclick="Admin.closeModal()">CLOSE</button>
    `;
    this.showModal('SHARE BOARD', body, footer);

    // Add collaborator
    document.getElementById('m-add-collab').addEventListener('click', async () => {
      const select = document.getElementById('m-share-user');
      const username = select.value;
      if (!username) return;
      const errorEl = document.getElementById('m-error');
      try {
        const res = await fetch(`/api/admin/boards/${encodeURIComponent(owner)}/${encodeURIComponent(boardName)}/collaborators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: username }),
        });
        const data = await res.json();
        if (data.success) {
          this.showShareModal(owner, boardName); // Re-render
        } else {
          errorEl.textContent = data.error || 'Failed';
        }
      } catch {
        errorEl.textContent = 'Connection error';
      }
    });

    // Remove collaborator
    document.querySelectorAll('.collab-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const user = btn.dataset.user;
        const errorEl = document.getElementById('m-error');
        try {
          const res = await fetch(`/api/admin/boards/${encodeURIComponent(owner)}/${encodeURIComponent(boardName)}/collaborators/${encodeURIComponent(user)}`, {
            method: 'DELETE',
          });
          const data = await res.json();
          if (data.success) {
            this.showShareModal(owner, boardName); // Re-render
          } else {
            errorEl.textContent = data.error || 'Failed';
          }
        } catch {
          errorEl.textContent = 'Connection error';
        }
      });
    });
  },

  // ═══ UTILS ═══
  esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  timeAgo(isoStr) {
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

  formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },
};

document.addEventListener('DOMContentLoaded', () => Admin.init());
