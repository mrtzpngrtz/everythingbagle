(function () {
  var BREAKPOINT = 768;

  function isMobile() {
    return window.innerWidth <= BREAKPOINT;
  }

  function applyMobileMode() {
    document.body.classList.toggle('mobile-mode', isMobile());
  }

  function openSheet(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeSheet(id) {
    document.getElementById(id).classList.add('hidden');
  }

  function syncActiveTool() {
    var tool = (typeof App !== 'undefined' && App.currentTool) ? App.currentTool : 'select';
    document.querySelectorAll('#mobile-bar .mb-btn[data-tool]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  function init() {
    applyMobileMode();
    window.addEventListener('resize', applyMobileMode);

    // Patch App.setTool to keep bar in sync
    if (typeof App !== 'undefined' && App.setTool) {
      var _origSetTool = App.setTool.bind(App);
      App.setTool = function (tool) {
        _origSetTool(tool);
        syncActiveTool();
      };
    }

    syncActiveTool();

    // Tool buttons (Select, Pan)
    document.querySelectorAll('#mobile-bar .mb-btn[data-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof App !== 'undefined') App.setTool(btn.dataset.tool);
        syncActiveTool();
      });
    });

    // Undo
    document.getElementById('mb-undo-btn').addEventListener('click', function () {
      var btn = document.getElementById('btn-undo');
      if (btn) btn.click();
    });

    // Open add sheet
    document.getElementById('mb-add-btn').addEventListener('click', function () {
      openSheet('mobile-add-sheet');
    });

    // Open menu sheet
    document.getElementById('mb-menu-btn').addEventListener('click', function () {
      openSheet('mobile-menu-sheet');
    });

    // Sheet overlay taps close the sheet
    document.querySelectorAll('.sheet-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function () {
        var sheet = overlay.parentElement;
        if (sheet) sheet.classList.add('hidden');
      });
    });

    // Add sheet element buttons
    document.querySelectorAll('#mobile-add-sheet .sheet-btn[data-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof App !== 'undefined') App.setTool(btn.dataset.tool);
        closeSheet('mobile-add-sheet');
        syncActiveTool();
      });
    });

    // Menu action buttons
    document.querySelectorAll('#mobile-menu-sheet .mobile-menu-item[data-action]').forEach(function (item) {
      item.addEventListener('click', function () {
        var action = item.dataset.action;
        closeSheet('mobile-menu-sheet');
        if (action === 'darkmode') {
          var dmBtn = document.getElementById('btn-darkmode');
          if (dmBtn) dmBtn.click();
        } else if (action === 'boards') {
          var swBtn = document.getElementById('board-switcher-btn');
          if (swBtn) swBtn.click();
        } else if (action === 'share') {
          var shareBtn = document.getElementById('btn-share');
          if (shareBtn) shareBtn.click();
        } else if (action === 'zoom-fit') {
          var zfBtn = document.getElementById('zoom-fit');
          if (zfBtn) zfBtn.click();
        } else if (action === 'settings') {
          window.location.href = '/settings';
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
