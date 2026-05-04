/* === LLM CHAT ELEMENT === */
const LLMChat = {

  renderInner(data) {
    const msgs = data.messages || [];
    const messagesHtml = msgs.map(m => this._msgHtml(m)).join('');
    const user = (typeof App !== 'undefined' && App.currentUser) ? App.currentUser : null;
    const modelLabel = (user?.llmModel || user?.llmProvider || '').toUpperCase();
    return `
      <div class="llm-header">
        <span class="llm-title">${Utils.escapeHtml(data.title || 'Chat')}</span>
        ${modelLabel ? `<span class="llm-model-tag">${Utils.escapeHtml(modelLabel)}</span>` : ''}
      </div>
      <div class="llm-messages">${messagesHtml}</div>
      <div class="llm-input-row">
        <textarea class="llm-input" placeholder="Message… (Shift+Enter for newline)" rows="2"></textarea>
        <button class="llm-send" title="Send (Enter)">↑</button>
      </div>
      <div class="llm-status"></div>`;
  },

  _msgHtml(m) {
    const isUser = m.role === 'user';
    const escaped = Utils.escapeHtml(m.content).replace(/\n/g, '<br>');
    return `<div class="llm-msg ${isUser ? 'llm-msg--user' : 'llm-msg--assistant'}"><div class="llm-msg-bubble">${escaped}</div></div>`;
  },

  bindEvents(el, data) {
    const sendBtn  = el.querySelector('.llm-send');
    const input    = el.querySelector('.llm-input');
    const msgsEl   = el.querySelector('.llm-messages');
    if (!sendBtn || !input) return;

    this._scrollBottom(msgsEl);

    const send = async () => {
      const text = input.value.trim();
      if (!text) return;

      const d = Elements.getData(data.id);
      if (!d) return;

      d.messages = d.messages || [];
      d.messages.push({ role: 'user', content: text });
      input.value = '';
      this._refreshMessages(el, d);

      const status = el.querySelector('.llm-status');
      sendBtn.disabled = true;
      if (status) { status.textContent = '…'; status.classList.add('llm-status--loading'); }

      try {
        const res = await fetch('/api/llm/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: d.messages }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'API error');

        d.messages.push({ role: 'assistant', content: result.message });
        this._refreshMessages(el, d);
        App.saveState();
      } catch (err) {
        if (status) {
          status.textContent = '⚠ ' + err.message;
          status.classList.remove('llm-status--loading');
          setTimeout(() => { status.textContent = ''; }, 6000);
        }
      } finally {
        sendBtn.disabled = false;
        if (status && status.classList.contains('llm-status--loading')) {
          status.textContent = '';
          status.classList.remove('llm-status--loading');
        }
      }
    };

    sendBtn.addEventListener('click', (e) => { e.stopPropagation(); send(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    // Rename on dblclick of title
    const titleEl = el.querySelector('.llm-title');
    if (titleEl) {
      titleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        titleEl.contentEditable = 'true';
        titleEl.style.overflow = 'visible';
        titleEl.focus();
        const range = document.createRange();
        range.selectNodeContents(titleEl);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        const save = () => {
          titleEl.contentEditable = 'false';
          titleEl.style.overflow = '';
          const newTitle = titleEl.textContent.trim() || 'Chat';
          titleEl.textContent = newTitle;
          const d = Elements.getData(data.id);
          if (d) { d.title = newTitle; App.saveState(); }
        };
        titleEl.addEventListener('blur', save, { once: true });
        titleEl.addEventListener('keydown', function onKey(ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); titleEl.blur(); }
          if (ev.key === 'Escape') {
            titleEl.textContent = data.title || 'Chat';
            titleEl.contentEditable = 'false';
            titleEl.style.overflow = '';
            titleEl.removeEventListener('keydown', onKey);
          }
        });
      });
    }
  },

  _refreshMessages(el, data) {
    const msgsEl = el.querySelector('.llm-messages');
    if (!msgsEl) return;
    msgsEl.innerHTML = (data.messages || []).map(m => this._msgHtml(m)).join('');
    this._scrollBottom(msgsEl);
  },

  _scrollBottom(el) {
    if (el) el.scrollTop = el.scrollHeight;
  },
};
