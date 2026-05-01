/* === FLOATING PROPERTIES POPUP — Swiss Industrial Style === */
const Properties = {
  currentId: null,

  show(data) {
    if (!data) return;
    if (data.type === 'llmchat' || data.type === 'calendar') { this.hide(); return; }
    this.currentId = data.id;
    const panel = document.getElementById('properties-panel');
    const content = document.getElementById('props-content');
    panel.classList.remove('hidden');

    // Position popup next to the element
    this.positionPopup(data);

    const ratioLocked = !!data.lockedRatio;
    const ratioPresets = [['1:1', 1], ['4:3', 4/3], ['3:2', 3/2], ['16:9', 16/9]];
    let html = `
      <div class="prop-group">
        <div class="prop-label">01 — ${data.type.toUpperCase()}</div>
        <div class="prop-slider-row">
          <span class="prop-slider-label">W</span>
          <input class="prop-slider" type="range" data-prop="width" value="${Math.round(data.width)}" min="40" max="800" />
          <span class="prop-slider-value" data-display="width">${Math.round(data.width)}</span>
        </div>
        <div class="prop-slider-row">
          <span class="prop-slider-label">H</span>
          <input class="prop-slider" type="range" data-prop="height" value="${Math.round(data.height)}" min="20" max="800" />
          <span class="prop-slider-value" data-display="height">${Math.round(data.height)}</span>
        </div>
        <div class="prop-ratio-row">
          <button class="prop-ratio-lock ${ratioLocked ? 'active' : ''}" id="prop-ratio-lock" title="Lock aspect ratio">${ratioLocked ? '⊠' : '⊡'}</button>
          <div class="prop-ratio-presets">
            ${ratioPresets.map(([label, r]) => `<div class="prop-ratio-preset" data-ratio="${r}">${label}</div>`).join('')}
          </div>
        </div>
      </div>
    `;

    if (data.type === 'text' || data.type === 'heading') {
      const ta = data.textAlign || 'left';
      html += `
        <div class="prop-group">
          <div class="prop-label">02 — SIZE</div>
          <div class="prop-slider-row">
            <span class="prop-slider-label">Aa</span>
            <input class="prop-slider" type="range" data-prop="fontSize" value="${data.fontSize || 14}" min="8" max="120" />
            <span class="prop-slider-value" data-display="fontSize">${data.fontSize || 14}</span>
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">03 — COLOR</div>
          <div class="color-row">
            ${Utils.ELEMENT_COLORS.map(c => `<div class="color-option ${data.color === c ? 'active' : ''}" style="background:${c}" data-color="${c}" data-prop="color"></div>`).join('')}
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">04 — FORMAT</div>
          <div class="fmt-row">
            <button class="fmt-btn" data-cmd="bold"      title="Bold"><b>B</b></button>
            <button class="fmt-btn" data-cmd="italic"    title="Italic"><i>I</i></button>
            <button class="fmt-btn" data-cmd="underline" title="Underline"><u>U</u></button>
            <div class="fmt-sep"></div>
            <button class="fmt-btn fmt-align ${ta==='left'   ? 'active':''}" data-align="left"   title="Align left">&#8676;</button>
            <button class="fmt-btn fmt-align ${ta==='center' ? 'active':''}" data-align="center" title="Center">&#8596;</button>
            <button class="fmt-btn fmt-align ${ta==='right'  ? 'active':''}" data-align="right"  title="Align right">&#8677;</button>
          </div>
        </div>
      `;
    }

    if (data.type === 'heading') {
      const currentWeight = data.fontWeight || '700';
      html += `
        <div class="prop-group">
          <div class="prop-label">04 — WEIGHT</div>
          <div class="weight-row">
            ${[['100','Thin'],['300','Light'],['500','Medium'],['700','Bold']].map(([w, label]) =>
              `<div class="weight-option ${currentWeight === w ? 'active' : ''}" data-weight="${w}">${label}</div>`
            ).join('')}
          </div>
        </div>
      `;
    }

    if (data.type === 'note') {
      html += `
        <div class="prop-group">
          <div class="prop-label">02 — ACCENT</div>
          <div class="color-row">
            ${Utils.NOTE_COLORS.map(c => {
              const bg = c.name === 'default' ? '#FFFFFF' : c.name === 'blue' ? '#0066FF' : c.name === 'green' ? '#00AA44' : c.name === 'pink' ? '#FF0066' : c.name === 'purple' ? '#7700FF' : '#FF4500';
              return `<div class="color-option ${data.noteColor === c.name ? 'active' : ''}" style="background:${bg};border:1px solid #CCC" data-notecolor="${c.name}" data-prop="noteColor" title="${c.label}"></div>`;
            }).join('')}
          </div>
        </div>
      `;
    }

    if (data.type === 'rect' || data.type === 'circle') {
      html += `
        <div class="prop-group">
          <div class="prop-label">02 — BORDER</div>
          <div class="color-row">
            ${Utils.BORDER_COLORS.map(c => `<div class="color-option ${data.borderColor === c ? 'active' : ''}" style="background:${c}" data-bordercolor="${c}" data-prop="borderColor"></div>`).join('')}
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">03 — FILL</div>
          <div class="color-row">
            <div class="color-option ${data.fillColor === 'transparent' ? 'active' : ''}" style="background:transparent;border:1px dashed #999" data-fillcolor="transparent" data-prop="fillColor"></div>
            ${Utils.ELEMENT_COLORS.map(c => `<div class="color-option ${data.fillColor === c + '22' ? 'active' : ''}" style="background:${c}22" data-fillcolor="${c}22" data-prop="fillColor"></div>`).join('')}
          </div>
        </div>
      `;
    }

    if (data.type === 'icon') {
      html += `
        <div class="prop-group">
          <div class="prop-label">02 — SIZE</div>
          <div class="prop-slider-row">
            <span class="prop-slider-label">Aa</span>
            <input class="prop-slider" type="range" data-prop="fontSize" value="${data.fontSize || 48}" min="16" max="256" />
            <span class="prop-slider-value" data-display="fontSize">${data.fontSize || 48}</span>
          </div>
        </div>
      `;
    }

    if (data.type === 'image') {
      const ct = data.cropTop || 0, cr = data.cropRight || 0, cb = data.cropBottom || 0, cl = data.cropLeft || 0;
      const hasCrop = ct || cr || cb || cl;
      const isFrameMode = !!document.querySelector(`.canvas-element.img-frame-mode[data-id="${data.id}"]`);
      const rot = data.rotation || 0;
      const tags = data.tags || [];
      html += `
        <div class="prop-group" id="prop-tags-group">
          <div class="prop-label">02 — TAGS</div>
          <div class="prop-tags">
            ${tags.map(t => `<span class="prop-tag">${Utils.escapeHtml(t)}<button class="prop-tag-remove" data-tag="${Utils.escapeAttr(t)}">×</button></span>`).join('')}
          </div>
          <div class="prop-tag-input-row">
            <input class="prop-input prop-tag-input" type="text" placeholder="ADD TAG…" maxlength="32" />
            <button class="prop-btn prop-tag-add-btn">+</button>
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">03 — ROTATE</div>
          <div class="prop-btn-row">
            <button class="prop-btn" data-rotate="-90">↺ CCW</button>
            <button class="prop-btn" data-rotate="90">↻ CW</button>
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">04 — SCALE</div>
          <div class="prop-slider-row">
            <span class="prop-slider-label">%</span>
            <input class="prop-slider" type="range" data-prop="scale" value="100" min="10" max="300" />
            <span class="prop-slider-value" data-display="scale">100</span>
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">05 — ZOOM</div>
          <div class="prop-slider-row">
            <span class="prop-slider-label">⌖</span>
            <input class="prop-slider" type="range" data-prop="imageZoom"
                   value="${data.imageZoom || 100}" min="100" max="300" step="1" />
            <span class="prop-slider-value" data-display="imageZoom">${data.imageZoom || 100}</span>
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">06 — FRAME</div>
          <div class="prop-btn-row">
            <button class="prop-btn prop-frame-edit-btn${isFrameMode ? ' active' : ''}">${isFrameMode ? 'DONE' : 'EDIT FRAME'}</button>
            ${hasCrop ? `<button class="prop-btn prop-frame-reset-btn">RESET</button>` : ''}
          </div>
        </div>
      `;
    }

    if (data.type === 'todo') {
      html += `
        <div class="prop-group">
          <div class="prop-label">02 — TITLE</div>
          <input class="prop-input prop-text-input" type="text" data-prop="title" value="${Utils.escapeAttr(data.title || 'Tasks')}" />
        </div>
      `;
    }

    if (data.type === 'draw') {
      const sw = data.strokeWidth || 2;
      const ss = data.strokeStyle || 'solid';
      const sc = data.strokeColor || '#111111';
      html += `
        <div class="prop-group">
          <div class="prop-label">02 — COLOR</div>
          <div class="color-row">
            ${Utils.ELEMENT_COLORS.map(c => `<div class="color-option ${sc === c ? 'active' : ''}" style="background:${c}" data-color="${c}" data-prop="strokeColor"></div>`).join('')}
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">03 — SIZE</div>
          <div class="prop-slider-row">
            <span class="prop-slider-label">W</span>
            <input class="prop-slider" type="range" data-prop="strokeWidth" value="${sw}" min="1" max="40" />
            <span class="prop-slider-value" data-display="strokeWidth">${sw}</span>
          </div>
        </div>
        <div class="prop-group">
          <div class="prop-label">04 — STROKE</div>
          <div class="weight-row">
            ${[['solid','——'],['dashed','- -'],['dotted','···']].map(([s, label]) =>
              `<div class="weight-option ${ss === s ? 'active' : ''}" data-stroke="${s}">${label}</div>`
            ).join('')}
          </div>
        </div>
      `;
    }

    content.innerHTML = html;

    // Bind sliders
    content.querySelectorAll('.prop-slider').forEach(slider => {
      const prop = slider.dataset.prop;
      const valueDisplay = content.querySelector(`[data-display="${prop}"]`);

      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        if (valueDisplay) valueDisplay.textContent = Math.round(val);

        if (prop === 'scale') {
          const origData = Elements.getData(data.id);
          if (origData && origData._origW) {
            Elements.updateElement(data.id, {
              width: origData._origW * val / 100,
              height: origData._origH * val / 100,
            });
          }
        } else if ((prop === 'width' || prop === 'height') && Elements.getData(data.id)?.lockedRatio) {
          const current = Elements.getData(data.id);
          const ratio = current.width / current.height;
          if (prop === 'width') {
            const newH = Math.round(val / ratio);
            content.querySelector('[data-display="height"]').textContent = newH;
            content.querySelector('[data-prop="height"]').value = newH;
            Elements.updateElement(data.id, { width: val, height: newH });
          } else {
            const newW = Math.round(val * ratio);
            content.querySelector('[data-display="width"]').textContent = newW;
            content.querySelector('[data-prop="width"]').value = newW;
            Elements.updateElement(data.id, { height: val, width: newW });
          }
        } else {
          Elements.updateElement(data.id, { [prop]: val });
        }
        Connections.render();
      });

      slider.addEventListener('change', () => {
        App.saveState();
      });

      if (prop === 'scale' && data.type === 'image') {
        if (!data._origW) {
          data._origW = data.width;
          data._origH = data.height;
        }
      }
    });

    // Bind ratio lock button
    const ratioLockBtn = content.querySelector('#prop-ratio-lock');
    if (ratioLockBtn) {
      ratioLockBtn.addEventListener('click', () => {
        const current = Elements.getData(data.id);
        Elements.updateElement(data.id, { lockedRatio: !current.lockedRatio });
        this.show(Elements.getData(data.id));
        App.saveState();
      });
    }

    // Bind ratio presets
    content.querySelectorAll('.prop-ratio-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const ratio = parseFloat(btn.dataset.ratio);
        const current = Elements.getData(data.id);
        const newH = Math.round(current.width / ratio);
        Elements.updateElement(data.id, { height: newH, lockedRatio: true });
        this.show(Elements.getData(data.id));
        App.saveState();
      });
    });

    // Bind rotate buttons
    content.querySelectorAll('.prop-btn[data-rotate]').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.rotate, 10);
        const current = Elements.getData(data.id);
        const newRot = ((current.rotation || 0) + delta + 360) % 360;
        Elements.updateElement(data.id, { rotation: newRot });
        App.saveState();
      });
    });

    // Bind number inputs
    content.querySelectorAll('.prop-input').forEach(input => {
      input.addEventListener('change', () => {
        const prop = input.dataset.prop;
        let val = input.type === 'number' ? parseFloat(input.value) : input.value;
        Elements.updateElement(data.id, { [prop]: val });
        Connections.render();
        App.saveState();
      });
    });

    // Bind tag UI
    const tagInput = content.querySelector('.prop-tag-input');
    const tagAddBtn = content.querySelector('.prop-tag-add-btn');
    if (tagInput && tagAddBtn) {
      const addTag = () => {
        const val = tagInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!val) return;
        const cur = Elements.getData(data.id);
        const tags = [...new Set([...(cur.tags || []), val])];
        Elements.updateElement(data.id, { tags });
        App.saveState();
        this.show(Elements.getData(data.id));
      };
      tagAddBtn.addEventListener('click', addTag);
      tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
    }
    content.querySelectorAll('.prop-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        const cur = Elements.getData(data.id);
        Elements.updateElement(data.id, { tags: (cur.tags || []).filter(t => t !== tag) });
        App.saveState();
        this.show(Elements.getData(data.id));
      });
    });

    // Bind frame edit / reset buttons
    const frameEditBtn = content.querySelector('.prop-frame-edit-btn');
    if (frameEditBtn) {
      frameEditBtn.addEventListener('click', () => {
        const active = !!document.querySelector(`.canvas-element.img-frame-mode[data-id="${data.id}"]`);
        if (active) {
          Elements.exitFrameMode(data.id, true);
          frameEditBtn.textContent = 'EDIT FRAME';
          frameEditBtn.classList.remove('active');
        } else {
          Elements.enterFrameMode(data.id);
          frameEditBtn.textContent = 'DONE';
          frameEditBtn.classList.add('active');
        }
      });
    }
    const frameResetBtn = content.querySelector('.prop-frame-reset-btn');
    if (frameResetBtn) {
      frameResetBtn.addEventListener('click', () => {
        Elements.updateElement(data.id, { cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 });
        Elements.updateCropHandles(data.id);
        App.saveState();
        this.show(Elements.getData(data.id));
      });
    }

    // Bind color options
    content.querySelectorAll('.color-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const prop = opt.dataset.prop;
        const val = opt.dataset.color || opt.dataset.notecolor || opt.dataset.bordercolor || opt.dataset.fillcolor;
        Elements.updateElement(data.id, { [prop]: val });
        this.show(Elements.getData(data.id));
        App.saveState();
      });
    });

    // Bind weight / stroke options
    content.querySelectorAll('.weight-option').forEach(opt => {
      opt.addEventListener('click', () => {
        if (opt.dataset.stroke !== undefined) {
          Elements.updateElement(data.id, { strokeStyle: opt.dataset.stroke });
        } else {
          Elements.updateElement(data.id, { fontWeight: opt.dataset.weight });
        }
        this.show(Elements.getData(data.id));
        App.saveState();
      });
    });

    // Bind format buttons (B/I/U) — mousedown+preventDefault keeps focus in contenteditable
    content.querySelectorAll('.fmt-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const editable = Elements.getDom(data.id)?.querySelector('[contenteditable="true"]');
        if (!editable) return;
        document.execCommand(btn.dataset.cmd, false, null);
        // Save formatted content
        const d = Elements.getData(data.id);
        if (d) {
          d.content = Elements.sanitizeContent(editable.innerHTML);
          App.saveState();
        }
      });
    });

    // Bind alignment buttons
    content.querySelectorAll('.fmt-btn[data-align]').forEach(btn => {
      btn.addEventListener('click', () => {
        Elements.updateElement(data.id, { textAlign: btn.dataset.align });
        // Update active state without full re-render
        content.querySelectorAll('.fmt-btn[data-align]').forEach(b => b.classList.toggle('active', b === btn));
        App.saveState();
      });
    });
  },

  positionPopup(data) {
    const panel = document.getElementById('properties-panel');
    const screenPos = Canvas.canvasToScreen(data.x + data.width, data.y);
    const panelW = 220;
    const gap = 12;

    let left = screenPos.x + gap;
    let top = screenPos.y;

    if (left + panelW > window.innerWidth - 16) {
      const leftPos = Canvas.canvasToScreen(data.x, data.y);
      left = leftPos.x - panelW - gap;
    }
    if (left < 70) left = 70;
    if (top < 50) top = 50;
    if (top + 300 > window.innerHeight) top = window.innerHeight - 320;

    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  },

  hide() {
    this.currentId = null;
    document.getElementById('properties-panel').classList.add('hidden');
  },

  updatePosition() {
    if (!this.currentId) return;
    const data = Elements.getData(this.currentId);
    if (data) this.positionPopup(data);
  },
};

document.getElementById('close-properties')?.addEventListener('click', () => Properties.hide());
