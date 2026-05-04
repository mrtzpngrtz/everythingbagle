/* === TODO LIST — Canvas Element === */
const Todos = {
  _cachedUsers: null,
  _dragging: null, // { el, data, fromIdx }

  async getUsers() {
    if (this._cachedUsers) return this._cachedUsers;
    try {
      const res = await fetch('/api/users');
      this._cachedUsers = await res.json();
      return this._cachedUsers;
    } catch (err) {
      console.error('Failed to load users:', err);
      return [];
    }
  },

  /** Render a todo element's inner HTML */
  renderInner(data) {
    const items = data.items || [];
    let html = `<div class="todo-header">
      <span class="todo-title">${Utils.escapeHtml(data.title || 'Tasks')}</span>
      <span class="todo-count">${items.filter(i => i.done).length}/${items.length}</span>
    </div>
    <div class="todo-items">`;

    items.forEach((item, idx) => {
      const assigneeHtml = item.assignee
        ? `<span class="todo-assignee" title="${Utils.escapeAttr(item.assignee)}">${Utils.escapeHtml(item.assignee).substring(0, 2).toUpperCase()}</span>`
        : '';
      html += `
        <div class="todo-item ${item.done ? 'done' : ''}${item.important ? ' important' : ''}" data-todo-idx="${idx}" draggable="true">
          <span class="todo-drag" title="Drag to reorder">⠿</span>
          <button class="todo-check" data-todo-idx="${idx}" title="Toggle">${item.done ? '✓' : ''}</button>
          <span class="todo-item-text">${Utils.escapeHtml(item.text)}</span>
          ${assigneeHtml}
          <button class="todo-star" data-todo-idx="${idx}" title="${item.important ? 'Unmark important' : 'Mark important'}">${item.important ? '★' : '☆'}</button>
          <button class="todo-delete" data-todo-idx="${idx}" title="Delete">×</button>
        </div>`;
    });

    html += `</div>
    <button class="todo-add-btn" title="Add item">+ ADD</button>`;
    return html;
  },

  /** Bind events on a rendered todo element */
  bindEvents(el, data) {
    // Toggle checkboxes
    el.querySelectorAll('.todo-check').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.todoIdx);
        if (data.items && data.items[idx] !== undefined) {
          data.items[idx].done = !data.items[idx].done;
          this.refresh(el, data);
          App.saveState();
        }
      });
    });

    // Star / important toggle
    el.querySelectorAll('.todo-star').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.todoIdx);
        if (data.items && data.items[idx] !== undefined) {
          data.items[idx].important = !data.items[idx].important;
          this.refresh(el, data);
          App.saveState();
        }
      });
    });

    // Delete item
    el.querySelectorAll('.todo-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.todoIdx);
        if (data.items) {
          data.items.splice(idx, 1);
          this.refresh(el, data);
          App.saveState();
        }
      });
    });

    // Add item button
    const addBtn = el.querySelector('.todo-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showAddItem(el, data);
      });
    }

    // Double click on item text to edit
    el.querySelectorAll('.todo-item-text').forEach(span => {
      span.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const idx = parseInt(span.closest('.todo-item').dataset.todoIdx);
        this.editItem(el, data, idx);
      });
    });

    // Double click on assignee to change
    el.querySelectorAll('.todo-assignee').forEach(badge => {
      badge.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const idx = parseInt(badge.closest('.todo-item').dataset.todoIdx);
        this.showAssignPicker(el, data, idx, badge);
      });
    });

    // Right-click on item for context menu
    el.querySelectorAll('.todo-item').forEach(itemEl => {
      itemEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(itemEl.dataset.todoIdx);
        this.showItemMenu(el, data, idx, e.clientX, e.clientY);
      });
    });

    // Drag-to-reorder
    this._bindDrag(el, data);
  },

  /** HTML5 drag-to-reorder */
  _bindDrag(el, data) {
    const container = el.querySelector('.todo-items');
    if (!container) return;

    el.querySelectorAll('.todo-item').forEach(itemEl => {
      itemEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.todo-drag')) e.stopPropagation();
      });

      itemEl.addEventListener('dragstart', (e) => {
        // Only initiate drag from the handle
        if (!e.target.closest('.todo-drag') && e.target !== itemEl) {
          e.preventDefault(); return;
        }
        this._dragging = { fromIdx: parseInt(itemEl.dataset.todoIdx), fromId: data.id };
        itemEl.classList.add('todo-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `${data.id}:${itemEl.dataset.todoIdx}`);
        e.stopPropagation();
      });

      itemEl.addEventListener('dragend', (e) => {
        e.stopPropagation();
        itemEl.classList.remove('todo-dragging');
        container.querySelectorAll('.todo-item').forEach(i => i.classList.remove('todo-drag-over'));
        this._dragging = null;
      });

      itemEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.todo-item').forEach(i => i.classList.remove('todo-drag-over'));
        itemEl.classList.add('todo-drag-over');
      });

      itemEl.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.querySelectorAll('.todo-item').forEach(i => i.classList.remove('todo-drag-over'));
        if (!this._dragging) return;
        const { fromIdx, fromId } = this._dragging;
        const toIdx = parseInt(itemEl.dataset.todoIdx);

        if (fromId === data.id) {
          // Same-list reorder
          if (fromIdx === toIdx) return;
          const [moved] = data.items.splice(fromIdx, 1);
          data.items.splice(toIdx, 0, moved);
          this.refresh(el, data);
        } else {
          // Cross-list move
          const srcData = App.elements.find(e => e.id === fromId);
          if (!srcData) return;
          const [moved] = srcData.items.splice(fromIdx, 1);
          data.items.splice(toIdx, 0, moved);
          const srcEl = document.querySelector(`.canvas-element[data-id="${fromId}"]`);
          if (srcEl) this.refresh(srcEl, srcData);
          this.refresh(el, data);
        }
        App.saveState();
      });
    });

    // Drop on container = append to end of list (handles cross-list too)
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this._dragging && this._dragging.fromId !== data.id) {
        container.classList.add('todo-drag-over-container');
      }
    });
    container.addEventListener('dragleave', (e) => {
      if (!container.contains(e.relatedTarget)) {
        container.classList.remove('todo-drag-over-container');
      }
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.remove('todo-drag-over-container');
      if (!this._dragging || this._dragging.fromId === data.id) return;
      // Cross-list drop on empty area = append
      const { fromIdx, fromId } = this._dragging;
      const srcData = App.elements.find(e => e.id === fromId);
      if (!srcData) return;
      const [moved] = srcData.items.splice(fromIdx, 1);
      data.items.push(moved);
      const srcEl = document.querySelector(`.canvas-element[data-id="${fromId}"]`);
      if (srcEl) this.refresh(srcEl, srcData);
      this.refresh(el, data);
      App.saveState();
    });
  },

  /** Refresh the todo element DOM */
  refresh(el, data) {
    const inner = el.querySelector('.el-todo');
    if (!inner) return;
    inner.innerHTML = this.renderInner(data);
    this.bindEvents(el, data);

    const contentHeight = inner.scrollHeight;
    const newHeight = Math.max(120, contentHeight + 4);
    data.height = newHeight;
    el.style.height = newHeight + 'px';
  },

  /** Show inline input to add a new item */
  showAddItem(el, data) {
    const addBtn = el.querySelector('.todo-add-btn');
    if (!addBtn) return;

    const row = document.createElement('div');
    row.className = 'todo-add-row';
    row.innerHTML = `
      <input type="text" class="todo-add-input" placeholder="New task..." />
      <button class="todo-add-confirm" title="Add">✓</button>
      <button class="todo-add-cancel" title="Cancel">✕</button>
    `;
    addBtn.replaceWith(row);

    const input = row.querySelector('.todo-add-input');
    input.focus();

    const doAdd = () => {
      const text = input.value.trim();
      if (text) {
        if (!data.items) data.items = [];
        data.items.push({ text, done: false, assignee: '', important: false });
        this.refresh(el, data);
        App.saveState();
      } else {
        this.refresh(el, data);
      }
    };

    row.querySelector('.todo-add-confirm').addEventListener('click', (e) => { e.stopPropagation(); doAdd(); });
    row.querySelector('.todo-add-cancel').addEventListener('click', (e) => { e.stopPropagation(); this.refresh(el, data); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') doAdd();
      if (e.key === 'Escape') this.refresh(el, data);
    });
  },

  /** Inline edit item text */
  editItem(el, data, idx) {
    const item = data.items[idx];
    if (!item) return;

    const itemEl = el.querySelector(`[data-todo-idx="${idx}"] .todo-item-text`);
    if (!itemEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo-edit-input';
    input.value = item.text;
    itemEl.replaceWith(input);
    input.focus();
    input.select();

    const doSave = () => {
      const newText = input.value.trim();
      if (newText) item.text = newText;
      this.refresh(el, data);
      App.saveState();
    };

    input.addEventListener('blur', doSave);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { input.removeEventListener('blur', doSave); doSave(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', doSave); this.refresh(el, data); }
    });
  },

  /** Show a small context menu for a todo item */
  showItemMenu(el, data, idx, x, y) {
    document.querySelectorAll('.todo-ctx-menu').forEach(m => m.remove());

    const item = data.items[idx];
    const menu = document.createElement('div');
    menu.className = 'todo-ctx-menu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    menu.innerHTML = `
      <div class="todo-ctx-item" data-action="important">${item?.important ? '☆ UNMARK IMPORTANT' : '★ MARK IMPORTANT'}</div>
      <div class="todo-ctx-separator"></div>
      <div class="todo-ctx-item" data-action="sort-important">SORT — IMPORTANT FIRST</div>
      <div class="todo-ctx-item" data-action="sort-done">SORT — UNDONE FIRST</div>
      <div class="todo-ctx-item" data-action="sort-alpha">SORT — A → Z</div>
      <div class="todo-ctx-separator"></div>
      <div class="todo-ctx-item" data-action="assign">ASSIGN USER</div>
      <div class="todo-ctx-item" data-action="unassign">REMOVE ASSIGNEE</div>
      <div class="todo-ctx-separator"></div>
      <div class="todo-ctx-item todo-ctx-danger" data-action="delete">DELETE</div>
    `;
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + 'px';

    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);

    menu.querySelector('[data-action="important"]').addEventListener('click', (e) => {
      e.stopPropagation(); menu.remove();
      if (data.items[idx]) { data.items[idx].important = !data.items[idx].important; this.refresh(el, data); App.saveState(); }
    });

    menu.querySelector('[data-action="sort-important"]').addEventListener('click', (e) => {
      e.stopPropagation(); menu.remove();
      data.items.sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
      this.refresh(el, data); App.saveState();
    });

    menu.querySelector('[data-action="sort-done"]').addEventListener('click', (e) => {
      e.stopPropagation(); menu.remove();
      data.items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
      this.refresh(el, data); App.saveState();
    });

    menu.querySelector('[data-action="sort-alpha"]').addEventListener('click', (e) => {
      e.stopPropagation(); menu.remove();
      data.items.sort((a, b) => a.text.localeCompare(b.text));
      this.refresh(el, data); App.saveState();
    });

    menu.querySelector('[data-action="assign"]').addEventListener('click', (e) => {
      e.stopPropagation(); menu.remove();
      const itemEl = el.querySelector(`[data-todo-idx="${idx}"]`);
      if (itemEl) this.showAssignPicker(el, data, idx, itemEl);
    });

    menu.querySelector('[data-action="unassign"]').addEventListener('click', (e) => {
      e.stopPropagation(); menu.remove();
      if (data.items[idx]) { data.items[idx].assignee = ''; this.refresh(el, data); App.saveState(); }
    });

    menu.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation(); menu.remove();
      data.items.splice(idx, 1);
      this.refresh(el, data); App.saveState();
    });
  },

  /** Show user picker dropdown to assign a user */
  async showAssignPicker(el, data, idx, anchorEl) {
    const users = await this.getUsers();
    document.querySelectorAll('.todo-user-picker').forEach(p => p.remove());

    const picker = document.createElement('div');
    picker.className = 'todo-user-picker';

    const rect = anchorEl.getBoundingClientRect();
    picker.style.left = rect.left + 'px';
    picker.style.top  = (rect.bottom + 4) + 'px';

    let html = '<div class="todo-picker-header">ASSIGN TO</div>';
    html += `<div class="todo-picker-option" data-user="">— None —</div>`;
    users.forEach(u => {
      const active = data.items[idx]?.assignee === u.username ? ' active' : '';
      html += `<div class="todo-picker-option${active}" data-user="${Utils.escapeAttr(u.username)}">${Utils.escapeHtml(u.displayName || u.username)}</div>`;
    });
    picker.innerHTML = html;
    document.body.appendChild(picker);

    const pRect = picker.getBoundingClientRect();
    if (pRect.right  > window.innerWidth)  picker.style.left = (window.innerWidth - pRect.width - 8) + 'px';
    if (pRect.bottom > window.innerHeight) picker.style.top  = (rect.top - pRect.height - 4) + 'px';

    const close = () => { picker.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);

    picker.querySelectorAll('.todo-picker-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        if (data.items[idx]) { data.items[idx].assignee = opt.dataset.user; this.refresh(el, data); App.saveState(); }
        close();
      });
    });
  },
};
