/* Actually Useful — editor, live preview and deploy. */
(function () {
  'use strict';

  var STORAGE_KEY = 'actually-useful:draft:v1';
  var LAYOUT_KEY = 'actually-useful:layout:v1';
  var PANES = ['html', 'css', 'js'];

  var STARTER = {
    name: 'Hello, Actually Useful',
    html: [
      '<main class="card">',
      '  <h1>Hello 👋</h1>',
      '  <p>Edit on the left, watch it render on the right, then hit <strong>Deploy</strong>.</p>',
      '  <button id="cheer">Cheer me up</button>',
      '  <p id="out"></p>',
      '</main>'
    ].join('\n'),
    css: [
      'body {',
      '  margin: 0;',
      '  min-height: 100vh;',
      '  display: grid;',
      '  place-items: center;',
      '  background: linear-gradient(135deg, #1f2937, #0f172a);',
      '  font-family: system-ui, sans-serif;',
      '  color: #e5e7eb;',
      '}',
      '',
      '.card {',
      '  max-width: 34rem;',
      '  padding: 2.5rem;',
      '  background: rgba(255, 255, 255, 0.04);',
      '  border: 1px solid rgba(255, 255, 255, 0.1);',
      '  border-radius: 16px;',
      '  text-align: center;',
      '}',
      '',
      'button {',
      '  padding: 0.6rem 1.2rem;',
      '  border: 0;',
      '  border-radius: 8px;',
      '  background: #3d7dfd;',
      '  color: #fff;',
      '  font-size: 1rem;',
      '  cursor: pointer;',
      '}'
    ].join('\n'),
    js: [
      "var lines = ['You are doing great.', 'Ship it.', 'That looks sharp.'];",
      "document.getElementById('cheer').addEventListener('click', function () {",
      "  var pick = lines[Math.floor(Math.random() * lines.length)];",
      "  document.getElementById('out').textContent = pick;",
      "  console.log('cheered:', pick);",
      '});'
    ].join('\n')
  };

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    name: $('project-name'),
    autoRun: $('auto-run'),
    run: $('btn-run'),
    download: $('btn-download'),
    deploy: $('btn-deploy'),
    sites: $('btn-sites'),
    sitesCount: $('sites-count'),
    format: $('btn-format'),
    reset: $('btn-reset'),
    preview: $('preview'),
    previewStage: $('preview-stage'),
    previewUrl: $('preview-url'),
    consoleBtn: $('btn-console'),
    consoleCount: $('console-count'),
    consolePanel: $('console'),
    consoleLog: $('console-log'),
    clearConsole: $('btn-clear-console'),
    drawer: $('drawer'),
    imageDrawer: $('image-drawer'),
    images: $('btn-images'),
    imagesCount: $('images-count'),
    closeImages: $('btn-close-images'),
    dropzone: $('dropzone'),
    imageInput: $('image-input'),
    pick: $('btn-pick'),
    imageList: $('image-list'),
    closeDrawer: $('btn-close-drawer'),
    siteList: $('site-list'),
    workspace: $('workspace'),
    splitter: $('splitter'),
    saveState: $('save-state'),
    caretPos: $('caret-pos'),
    wrap: $('btn-wrap'),
    shortcuts: $('btn-shortcuts'),
    shortcutDrawer: $('shortcut-drawer'),
    closeShortcuts: $('btn-close-shortcuts'),
    shortcutList: $('shortcut-list'),
    findbar: $('findbar'),
    findInput: $('find-input'),
    findCount: $('find-count'),
    findPrev: $('find-prev'),
    findNext: $('find-next'),
    findCase: $('find-case'),
    findClose: $('find-close'),
    replaceInput: $('replace-input'),
    replaceOne: $('replace-one'),
    replaceAll: $('replace-all'),
    toasts: $('toasts')
  };

  var editors = {};
  var state = { slug: null, deployed: null, storage: 'disk', pane: 'html', wrapped: false, renderTimer: null, saveTimer: null, consoleCount: 0 };

  // ---------------------------------------------------------------- editors
  PANES.forEach(function (pane) {
    editors[pane] = new MiniEditor(document.getElementById('ed-' + pane), {
      mode: pane,
      ariaLabel: pane.toUpperCase() + ' source',
      onChange: onEdit,
      onCaret: function (at) {
        els.caretPos.textContent = 'Ln ' + at.line + ', Col ' + at.column;
      }
    });
  });

  function source() {
    return {
      name: els.name.value.trim() || 'Untitled page',
      html: editors.html.getValue(),
      css: editors.css.getValue(),
      js: editors.js.getValue()
    };
  }

  function load(data) {
    els.name.value = data.name || 'Untitled page';
    PANES.forEach(function (pane) { editors[pane].setValue(data[pane] || ''); });
    state.slug = data.slug || null;
    refreshEditors();
  }

  function refreshEditors() {
    PANES.forEach(function (pane) { editors[pane].refresh(); });
  }

  // ------------------------------------------------------------------- tabs
  document.querySelectorAll('.tab[data-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var target = tab.dataset.tab;
      document.querySelectorAll('.tab[data-tab]').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      document.querySelectorAll('.editor-host').forEach(function (host) {
        host.classList.toggle('is-active', host.dataset.editor === target);
      });
      state.pane = target;
      editors[target].refresh();
      editors[target].focus();
      if (!els.findbar.hidden) runFind();
    });
  });

  // ---------------------------------------------------------------- preview
  var PREVIEW_BASE = '<base href="' + location.origin + '/p/">';

  var CONSOLE_BRIDGE = [
    '<script>',
    '(function () {',
    '  function send(level, args) {',
    '    try {',
    '      parent.postMessage({ __au: true, level: level, text: Array.prototype.map.call(args, format).join(" ") }, "*");',
    '    } catch (e) {}',
    '  }',
    '  function format(v) {',
    '    if (typeof v === "string") return v;',
    '    if (v instanceof Error) return v.stack || (v.name + ": " + v.message);',
    '    try { return JSON.stringify(v); } catch (e) { return String(v); }',
    '  }',
    '  ["log", "info", "warn", "error", "debug"].forEach(function (level) {',
    '    var original = console[level];',
    '    console[level] = function () { send(level === "debug" ? "log" : level, arguments); original.apply(console, arguments); };',
    '  });',
    '  window.addEventListener("error", function (e) {',
    '    send("error", [(e.message || "Error") + " (line " + e.lineno + ")"]);',
    '  });',
    '  window.addEventListener("unhandledrejection", function (e) {',
    '    send("error", ["Unhandled promise rejection: " + format(e.reason)]);',
    '  });',
    '}());',
    '<\/script>'
  ].join('\n');

  function render() {
    clearTimeout(state.renderTimer);
    var parts = source();
    els.preview.srcdoc = Compose.compose({
      html: parts.html,
      css: parts.css,
      js: parts.js,
      title: parts.name,
      head: PREVIEW_BASE + '\n' + CONSOLE_BRIDGE
    });
    els.previewUrl.textContent = previewLabel(parts);
  }

  /** Says whether what you are looking at matches what is deployed. */
  function previewLabel(parts) {
    if (!state.slug) return 'preview — not deployed yet';
    var live = state.deployed;
    var same = live &&
      live.name === parts.name &&
      live.html === parts.html &&
      live.css === parts.css &&
      live.js === parts.js;
    return '/p/' + state.slug + (same ? ' · live' : ' · unpublished changes');
  }

  function scheduleRender() {
    if (!els.autoRun.checked) return;
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(render, 400);
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.__au !== true) return;
    appendConsole(data.level, data.text);
  });

  function appendConsole(level, text) {
    var li = document.createElement('li');
    li.className = 'level-' + (level || 'log');
    li.textContent = text;
    els.consoleLog.appendChild(li);
    els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
    state.consoleCount += 1;
    els.consoleCount.textContent = String(state.consoleCount);
    els.consoleCount.classList.toggle('pill-quiet', level !== 'error');
  }

  function clearConsole() {
    els.consoleLog.innerHTML = '';
    state.consoleCount = 0;
    els.consoleCount.textContent = '0';
    els.consoleCount.classList.add('pill-quiet');
  }

  els.preview.addEventListener('load', function () { /* keep logs across reloads */ });
  els.clearConsole.addEventListener('click', clearConsole);
  els.consoleBtn.addEventListener('click', function () {
    var show = els.consolePanel.hidden;
    els.consolePanel.hidden = !show;
    els.consoleBtn.setAttribute('aria-expanded', String(show));
  });

  // -------------------------------------------------------- viewport picker
  document.querySelectorAll('.chip[data-width]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.chip[data-width]').forEach(function (c) {
        c.classList.toggle('is-active', c === chip);
      });
      var width = chip.dataset.width;
      var constrained = width !== 'auto';
      els.previewStage.classList.toggle('is-constrained', constrained);
      els.preview.style.width = constrained ? width + 'px' : '100%';
      els.preview.style.maxWidth = '100%';
      els.preview.style.flex = constrained ? '0 0 auto' : '';
    });
  });

  // ------------------------------------------------------------ persistence
  function onEdit() {
    markDirty();
    scheduleRender();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveLocal, 500);
  }

  els.name.addEventListener('input', onEdit);

  function markDirty() {
    els.saveState.textContent = 'Unsaved changes…';
    els.saveState.classList.add('is-dirty');
    els.previewUrl.textContent = previewLabel(source());
  }

  function saveLocal() {
    var data = source();
    data.slug = state.slug;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      els.saveState.textContent = 'Saved locally · ' + new Date().toLocaleTimeString();
      els.saveState.classList.remove('is-dirty');
    } catch (err) {
      els.saveState.textContent = 'Could not save locally';
    }
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) { /* fall through to starter */ }
    return null;
  }

  // ----------------------------------------------------------------- deploy
  var OFFLINE = location.protocol === 'file:';
  var NO_SERVER =
    'No deploy server here. Deploying needs the app to be running: from the project folder ' +
    'run "npm start", then open http://127.0.0.1:3000';

  function api(path, options) {
    return fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options))
      .catch(function () { throw new Error(NO_SERVER); })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || 'Request failed (' + res.status + ')');
          return body;
        });
      });
  }

  function deploy() {
    var parts = source();
    if (!parts.html.trim() && !parts.css.trim() && !parts.js.trim()) {
      return toast('Nothing to deploy yet — write some HTML first.', 'err');
    }
    els.deploy.disabled = true;
    els.deploy.textContent = 'Deploying…';

    api('/api/deploys', {
      method: 'POST',
      body: JSON.stringify({
        name: parts.name,
        slug: state.slug || undefined,
        html: parts.html,
        css: parts.css,
        js: parts.js
      })
    }).then(function (site) {
      state.slug = site.slug;
      state.deployed = { name: parts.name, html: parts.html, css: parts.css, js: parts.js };
      saveLocal();
      els.previewUrl.textContent = previewLabel(parts);
      var shareUrl = site.permanentUrl || site.url;
      toast(
        'Deployed v' + site.version + ' → <a href="' + shareUrl + '" target="_blank" rel="noopener">' +
        Compose.escapeHtml(shareUrl) + '</a>' +
        (site.permanentUrl ? '<br><small>GitHub Pages takes a moment to build the first time.</small>' : ''),
        'ok',
        site.permanentUrl ? 12000 : 9000
      );
      return loadSites();
    }).catch(function (err) {
      toast('Deploy failed: ' + err.message, 'err');
    }).finally(function () {
      els.deploy.disabled = false;
      els.deploy.textContent = 'Deploy';
    });
  }

  function loadSites() {
    return api('/api/deploys').then(function (data) {
      var sites = data.deploys || [];
      renderSites(sites);
      // Re-link a restored draft with what is actually live at its slug.
      var mine = state.slug && sites.filter(function (s) { return s.slug === state.slug; })[0];
      if (mine) {
        state.deployed = {
          name: mine.name,
          html: mine.source.html,
          css: mine.source.css,
          js: mine.source.js
        };
      } else if (state.slug) {
        state.slug = null;
        state.deployed = null;
      }
      els.previewUrl.textContent = previewLabel(source());
    }).catch(function () {
      els.sitesCount.textContent = '0';
      els.siteList.innerHTML = '<li class="empty">' + Compose.escapeHtml(NO_SERVER) + '</li>';
    });
  }

  function renderSites(sites) {
    els.sitesCount.textContent = String(sites.length);
    if (!sites.length) {
      els.siteList.innerHTML = '<li class="empty">No pages deployed yet. Hit <strong>Deploy</strong> to publish one.</li>';
      return;
    }
    els.siteList.innerHTML = sites.map(function (site) {
      var live = site.slug === state.slug ? ' · editing' : '';
      var share = site.permanentUrl || site.url;
      return '<li class="site" data-slug="' + site.slug + '" data-share="' + Compose.escapeHtml(share) + '">' +
        '<div class="site-title"><strong>' + Compose.escapeHtml(site.name) + '</strong>' +
        '<span class="site-meta">v' + site.version + ' · ' + relTime(site.updatedAt) + live + '</span></div>' +
        '<a class="site-url" href="' + share + '" target="_blank" rel="noopener">' +
        Compose.escapeHtml(share) + '</a>' +
        (site.permanentUrl
          ? '<span class="site-meta">also at ' + Compose.escapeHtml(site.url) + ' while this server is awake</span>'
          : '') +
        '<div class="site-actions">' +
        '<button class="icon-btn" data-action="open">Open</button>' +
        '<button class="icon-btn" data-action="copy">Copy link</button>' +
        '<button class="icon-btn" data-action="edit">Load into editor</button>' +
        '<button class="icon-btn danger" data-action="delete">Delete</button>' +
        '</div></li>';
    }).join('');
  }

  els.siteList.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var item = button.closest('.site');
    var slug = item.dataset.slug;
    var url = item.dataset.share || item.querySelector('.site-url').href;

    if (button.dataset.action === 'open') return void window.open(url, '_blank', 'noopener');

    if (button.dataset.action === 'copy') {
      return void copyText(url).then(function (ok) {
        toast(ok ? 'Link copied.' : 'Copy failed — the link is ' + url, ok ? 'ok' : 'err');
      });
    }

    if (button.dataset.action === 'edit') {
      return void api('/api/deploys/' + slug).then(function (site) {
        load({
          name: site.name,
          html: site.source.html,
          css: site.source.css,
          js: site.source.js,
          slug: site.slug
        });
        state.deployed = {
          name: site.name,
          html: site.source.html,
          css: site.source.css,
          js: site.source.js
        };
        saveLocal();
        render();
        loadSites();
        toast('Loaded “' + site.name + '”. Deploy will update the same URL.', 'ok');
      }).catch(function (err) { toast(err.message, 'err'); });
    }

    if (button.dataset.action === 'delete') {
      if (!window.confirm('Delete the deployed page at /p/' + slug + '? This cannot be undone.')) return;
      return void api('/api/deploys/' + slug, { method: 'DELETE' }).then(function () {
        if (state.slug === slug) {
          state.slug = null;
          saveLocal();
        }
        toast('Deleted /p/' + slug, 'ok');
        return loadSites();
      }).catch(function (err) { toast(err.message, 'err'); });
    }
  });

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve(ok);
    } catch (err) {
      return Promise.resolve(false);
    }
  }

  function relTime(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    if (!isFinite(diff)) return 'just now';
    var mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.round(hours / 24) + 'd ago';
  }

  // ------------------------------------------------------------------- find
  function activeEditor() { return editors[state.pane]; }

  function findOptions() {
    return { caseSensitive: els.findCase.getAttribute('aria-pressed') === 'true' };
  }

  function runFind(step) {
    var query = els.findInput.value;
    var total = activeEditor().findAll(query, findOptions());

    els.findInput.classList.toggle('no-match', Boolean(query) && total === 0);
    if (!query) {
      els.findCount.textContent = 'no results';
      return 0;
    }
    if (!total) {
      els.findCount.textContent = 'not found';
      return 0;
    }
    if (step !== false) {
      var index = activeEditor().stepMatch(false, activeEditor().getSelection().start);
      els.findCount.textContent = (index + 1) + ' of ' + total;
    } else {
      els.findCount.textContent = total + (total === 1 ? ' result' : ' results');
    }
    return total;
  }

  function stepFind(backwards) {
    var total = activeEditor().matches.length;
    if (!total) { if (!runFind()) return; total = activeEditor().matches.length; }
    var index = activeEditor().stepMatch(backwards);
    els.findCount.textContent = (index + 1) + ' of ' + total;
  }

  function openFind(withReplace) {
    var selection = activeEditor().getSelection();
    if (selection.end > selection.start) {
      var picked = activeEditor().getValue().slice(selection.start, selection.end);
      if (picked.indexOf('\n') === -1) els.findInput.value = picked;
    }
    els.findbar.hidden = false;
    runFind(false);
    (withReplace ? els.replaceInput : els.findInput).focus();
    els.findInput.select();
  }

  function closeFind() {
    els.findbar.hidden = true;
    PANES.forEach(function (pane) { editors[pane].clearFind(); });
    activeEditor().focus();
  }

  function replaceCurrent() {
    var editor = activeEditor();
    if (!editor.matches.length) { runFind(); return; }
    var selection = editor.getSelection();
    var current = editor.matches[editor.matchIndex];

    // Only replace a hit the caret is actually sitting on.
    if (!current || selection.start !== current.start || selection.end !== current.end) {
      return void stepFind(false);
    }
    editor.replaceRange(current.start, current.end, els.replaceInput.value);
    runFind(false);
    editor.stepMatch(false, current.start + els.replaceInput.value.length);
    els.findCount.textContent = editor.matches.length
      ? (editor.matchIndex + 1) + ' of ' + editor.matches.length
      : 'not found';
  }

  function replaceEverything() {
    var editor = activeEditor();
    var query = els.findInput.value;
    if (!query) return;

    var total = editor.findAll(query, findOptions());
    if (!total) return void toast('Nothing to replace.', 'err');

    var value = editor.getValue();
    var replacement = els.replaceInput.value;
    var out = '';
    var last = 0;
    editor.matches.forEach(function (match) {
      out += value.slice(last, match.start) + replacement;
      last = match.end;
    });
    out += value.slice(last);

    editor.replaceRange(0, value.length, out);
    editor.clearFind();
    els.findCount.textContent = 'not found';
    onEdit();
    toast('Replaced ' + total + ' occurrence' + (total === 1 ? '' : 's') + '.', 'ok');
  }

  els.findInput.addEventListener('input', function () { runFind(false); });
  els.findCase.addEventListener('click', function () {
    var on = els.findCase.getAttribute('aria-pressed') === 'true';
    els.findCase.setAttribute('aria-pressed', String(!on));
    runFind(false);
  });
  els.findNext.addEventListener('click', function () { stepFind(false); });
  els.findPrev.addEventListener('click', function () { stepFind(true); });
  els.findClose.addEventListener('click', closeFind);
  els.replaceOne.addEventListener('click', replaceCurrent);
  els.replaceAll.addEventListener('click', replaceEverything);

  els.findbar.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); return closeFind(); }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.target === els.replaceInput) return replaceCurrent();
    stepFind(event.shiftKey);
  });

  // ------------------------------------------------------------- word wrap
  els.wrap.addEventListener('click', function () {
    state.wrapped = !state.wrapped;
    els.wrap.setAttribute('aria-pressed', String(state.wrapped));
    PANES.forEach(function (pane) { editors[pane].setWrap(state.wrapped); });
    try { localStorage.setItem('actually-useful:wrap', state.wrapped ? '1' : '0'); } catch (err) { /* ignore */ }
  });

  // ------------------------------------------------------------- shortcuts
  var SHORTCUTS = [
    ['Editing', [
      ['Tab', 'Indent the selected lines'],
      ['Shift Tab', 'Outdent the selected lines'],
      ['Ctrl /', 'Comment or uncomment the lines'],
      ['Alt ↑ / Alt ↓', 'Move the lines up or down'],
      ['Ctrl D', 'Duplicate the line or selection'],
      ['Ctrl Shift K', 'Delete the line'],
      ['Home', 'Jump to the first character, then the margin'],
      ['Ctrl Z / Ctrl Shift Z', 'Undo and redo']
    ]],
    ['Searching', [
      ['Ctrl F', 'Find'],
      ['Ctrl H', 'Find and replace'],
      ['Enter / Shift Enter', 'Next and previous result'],
      ['Ctrl G', 'Go to a line number'],
      ['Esc', 'Close the find bar']
    ]],
    ['The page', [
      ['Ctrl Enter', 'Render the preview now'],
      ['Ctrl S', 'Deploy']
    ]]
  ];

  function renderShortcuts() {
    els.shortcutList.innerHTML = SHORTCUTS.map(function (group) {
      return '<div class="group">' + group[0] + '</div>' + group[1].map(function (row) {
        var keys = row[0].split(' / ').map(function (combo) {
          return combo.split(' ').map(function (key) {
            return '<kbd>' + Compose.escapeHtml(key) + '</kbd>';
          }).join(' ');
        }).join(' <span>or</span> ');
        return '<dt>' + keys + '</dt><dd>' + Compose.escapeHtml(row[1]) + '</dd>';
      }).join('');
    }).join('');
  }

  els.shortcuts.addEventListener('click', function () {
    var show = els.shortcutDrawer.hidden;
    if (show) {
      renderShortcuts();
      els.drawer.hidden = true;
      els.imageDrawer.hidden = true;
    }
    els.shortcutDrawer.hidden = !show;
  });
  els.closeShortcuts.addEventListener('click', function () { els.shortcutDrawer.hidden = true; });

  // ----------------------------------------------------------------- images
  function loadImages() {
    return api('/api/assets').then(function (data) {
      renderImages(data.assets || []);
    }).catch(function () {
      els.imageList.innerHTML = '<li class="empty">' + Compose.escapeHtml(NO_SERVER) + '</li>';
    });
  }

  function renderImages(assets) {
    els.imagesCount.textContent = String(assets.length);
    els.imagesCount.classList.toggle('pill-quiet', assets.length === 0);

    if (!assets.length) {
      els.imageList.innerHTML = '<li class="empty">No images yet.</li>';
      return;
    }
    els.imageList.innerHTML = assets.map(function (asset) {
      var src = '/assets/' + encodeURIComponent(asset.name);
      return '<li class="image" data-name="' + Compose.escapeHtml(asset.name) + '" ' +
        'data-path="' + Compose.escapeHtml(asset.path) + '">' +
        '<span class="image-thumb" style="background-image:url(' + src + ')"></span>' +
        '<span class="image-meta">' +
        '<span class="image-name">' + Compose.escapeHtml(asset.name) + '</span>' +
        '<span class="image-size">' + formatSize(asset.size) + '</span>' +
        '</span>' +
        '<span class="image-actions">' +
        '<button class="icon-btn" data-action="insert">Insert</button>' +
        '<button class="icon-btn" data-action="copy">Copy tag</button>' +
        '<button class="icon-btn danger" data-action="delete">Delete</button>' +
        '</span></li>';
    }).join('');
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function imageTag(path, name) {
    return '<img src="' + path + '" alt="' + name.replace(/\.[^.]*$/, '').replace(/-/g, ' ') + '">';
  }

  /** Uploads one file and returns its stored path. */
  function uploadImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      reader.onload = function () {
        api('/api/assets', {
          method: 'POST',
          body: JSON.stringify({ name: file.name, data: reader.result })
        }).then(resolve, reject);
      };
      reader.readAsDataURL(file);
    });
  }

  function uploadAll(files) {
    var list = Array.prototype.slice.call(files);
    if (!list.length) return;

    toast('Uploading ' + list.length + ' image' + (list.length === 1 ? '' : 's') + '…', '', 2000);
    var done = [];
    var failed = [];

    list.reduce(function (chain, file) {
      return chain.then(function () {
        return uploadImage(file).then(function (asset) { done.push(asset); },
          function (err) { failed.push(file.name + ': ' + err.message); });
      });
    }, Promise.resolve()).then(function () {
      loadImages();
      if (done.length) {
        var first = done[0];
        toast(
          'Added ' + done.length + ' image' + (done.length === 1 ? '' : 's') +
          '. Use <code>' + Compose.escapeHtml(first.path) + '</code> in your HTML.',
          'ok',
          8000
        );
      }
      failed.forEach(function (message) { toast(message, 'err', 8000); });
    });
  }

  els.pick.addEventListener('click', function () { els.imageInput.click(); });
  els.imageInput.addEventListener('change', function () {
    uploadAll(els.imageInput.files);
    els.imageInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    els.dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      els.dropzone.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    els.dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      els.dropzone.classList.remove('is-over');
    });
  });
  els.dropzone.addEventListener('drop', function (event) {
    if (event.dataTransfer && event.dataTransfer.files) uploadAll(event.dataTransfer.files);
  });

  els.imageList.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var item = button.closest('.image');
    var name = item.dataset.name;
    var path = item.dataset.path;
    var tag = imageTag(path, name);

    if (button.dataset.action === 'insert') {
      // Switch first: the pane has to be visible for the caret to land.
      document.querySelector('.tab[data-tab="html"]').click();
      editors.html.insertAtCursor('\n' + tag + '\n');
      return void toast('Inserted into your HTML.', 'ok');
    }

    if (button.dataset.action === 'copy') {
      return void copyText(tag).then(function (ok) {
        toast(ok ? 'Copied ' + Compose.escapeHtml(tag) : 'Copy failed — the path is ' + path,
          ok ? 'ok' : 'err');
      });
    }

    if (button.dataset.action === 'delete') {
      if (!window.confirm('Delete ' + name + '? Pages already using it will show a broken image.')) return;
      return void api('/api/assets/' + encodeURIComponent(name), { method: 'DELETE' })
        .then(function () {
          toast('Deleted ' + name, 'ok');
          return loadImages();
        })
        .catch(function (err) { toast(err.message, 'err'); });
    }
  });

  els.images.addEventListener('click', function () {
    var show = els.imageDrawer.hidden;
    els.imageDrawer.hidden = !show;
    els.images.setAttribute('aria-expanded', String(show));
    if (show) {
      els.drawer.hidden = true;
      els.sites.setAttribute('aria-expanded', 'false');
      loadImages();
    }
  });
  els.closeImages.addEventListener('click', function () {
    els.imageDrawer.hidden = true;
    els.images.setAttribute('aria-expanded', 'false');
  });

  // --------------------------------------------------------------- download
  els.download.addEventListener('click', function () {
    var parts = source();
    var doc = Compose.compose({ html: parts.html, css: parts.css, js: parts.js, title: parts.name });
    var blob = new Blob([doc], { type: 'text/html' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = Compose.slugify(parts.name) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Downloaded ' + a.download, 'ok');
  });

  // ----------------------------------------------------------------- format
  els.format.addEventListener('click', function () {
    editors.html.setValue(formatMarkup(editors.html.getValue()));
    editors.css.setValue(formatBraces(editors.css.getValue()));
    editors.js.setValue(formatBraces(editors.js.getValue()));
    toast('Re-indented all three panes.', 'ok');
  });

  var VOID_TAGS = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr|!doctype)$/i;

  /** Re-indents markup one tag per line. Deliberately simple: structure only. */
  function formatMarkup(src) {
    var tokens = src.replace(/>\s*</g, '>\n<').split('\n');
    var depth = 0;
    return tokens.map(function (line) {
      var text = line.trim();
      if (!text) return '';
      var closing = /^<\//.test(text);
      if (closing) depth = Math.max(0, depth - 1);
      var out = '  '.repeat(depth) + text;
      var opening = /^<[a-z!]/i.test(text) && !closing && !/\/>$/.test(text);
      var tag = (text.match(/^<\s*([a-z0-9!-]+)/i) || [])[1] || '';
      var selfContained = /<\/[a-z0-9-]+>\s*$/i.test(text) && !closing;
      if (opening && !VOID_TAGS.test(tag) && !selfContained) depth += 1;
      return out;
    }).filter(function (line, i, all) {
      return line !== '' || (i > 0 && all[i - 1] !== '');
    }).join('\n');
  }

  /** Re-indents brace-delimited code (CSS / JS). */
  function formatBraces(src) {
    var depth = 0;
    return src.split('\n').map(function (line) {
      var text = line.trim();
      if (!text) return '';
      var leadingClosers = (text.match(/^[}\])]+/) || [''])[0].length;
      var out = '  '.repeat(Math.max(0, depth - leadingClosers)) + text;
      var opens = (text.match(/[{[(]/g) || []).length;
      var closes = (text.match(/[}\])]/g) || []).length;
      depth = Math.max(0, depth + opens - closes);
      return out;
    }).join('\n');
  }

  // ------------------------------------------------------------------ reset
  els.reset.addEventListener('click', function () {
    if (!window.confirm('Clear the editor and start a new page? Deployed pages are not affected.')) return;
    load({ name: 'Untitled page', html: '', css: '', js: '', slug: null });
    state.deployed = null;
    clearConsole();
    saveLocal();
    render();
    loadSites();
  });

  // ----------------------------------------------------------------- drawer
  els.sites.addEventListener('click', function () {
    var show = els.drawer.hidden;
    els.drawer.hidden = !show;
    els.sites.setAttribute('aria-expanded', String(show));
    if (show) {
      els.imageDrawer.hidden = true;
      els.images.setAttribute('aria-expanded', 'false');
      loadSites();
    }
  });
  els.closeDrawer.addEventListener('click', function () {
    els.drawer.hidden = true;
    els.sites.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!els.findbar.hidden) return closeFind();
    if (!els.drawer.hidden) els.closeDrawer.click();
    if (!els.imageDrawer.hidden) els.closeImages.click();
    if (!els.shortcutDrawer.hidden) els.shortcutDrawer.hidden = true;
  });

  // --------------------------------------------------------------- splitter
  (function splitter() {
    var dragging = false;

    function setRatio(ratio) {
      var clamped = Math.min(0.85, Math.max(0.15, ratio));
      els.workspace.style.gridTemplateColumns = (clamped * 100) + '% 6px 1fr';
      try { localStorage.setItem(LAYOUT_KEY, String(clamped)); } catch (err) { /* ignore */ }
    }

    try {
      var saved = parseFloat(localStorage.getItem(LAYOUT_KEY));
      if (saved > 0) setRatio(saved);
    } catch (err) { /* ignore */ }

    els.splitter.addEventListener('pointerdown', function (event) {
      dragging = true;
      els.splitter.classList.add('is-dragging');
      els.splitter.setPointerCapture(event.pointerId);
      els.preview.style.pointerEvents = 'none';
    });
    els.splitter.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var box = els.workspace.getBoundingClientRect();
      setRatio((event.clientX - box.left) / box.width);
    });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      els.splitter.addEventListener(type, function () {
        if (!dragging) return;
        dragging = false;
        els.splitter.classList.remove('is-dragging');
        els.preview.style.pointerEvents = '';
        refreshEditors();
      });
    });
    els.splitter.addEventListener('keydown', function (event) {
      var step = event.key === 'ArrowLeft' ? -0.03 : event.key === 'ArrowRight' ? 0.03 : 0;
      if (!step) return;
      event.preventDefault();
      var current = els.workspace.getBoundingClientRect().width;
      var editorWidth = els.workspace.querySelector('.pane-editor').getBoundingClientRect().width;
      setRatio(editorWidth / current + step);
      refreshEditors();
    });
  }());

  // ----------------------------------------------------------------- toasts
  function toast(message, kind, ms) {
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' is-' + kind : '');
    node.innerHTML = message;
    els.toasts.appendChild(node);
    setTimeout(function () { node.remove(); }, ms || 4000);
  }

  // ------------------------------------------------------------------ boot
  els.run.addEventListener('click', render);
  els.deploy.addEventListener('click', deploy);
  els.autoRun.addEventListener('change', function () { if (els.autoRun.checked) render(); });

  document.addEventListener('keydown', function (event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    var key = event.key.toLowerCase();

    if (key === 's') { event.preventDefault(); return deploy(); }
    if (event.key === 'Enter') { event.preventDefault(); return render(); }
    if (key === 'f') { event.preventDefault(); return openFind(false); }
    if (key === 'h') { event.preventDefault(); return openFind(true); }
    if (key === 'g') {
      event.preventDefault();
      var answer = window.prompt('Go to line');
      var line = parseInt(answer, 10);
      if (line > 0) activeEditor().gotoLine(line);
      return;
    }
  });

  window.addEventListener('resize', refreshEditors);

  try {
    if (localStorage.getItem('actually-useful:wrap') === '1') els.wrap.click();
  } catch (err) { /* no storage, no preference */ }

  load(loadLocal() || STARTER);
  saveLocal();
  render();
  loadSites();
  if (!OFFLINE) loadImages();

  if (!OFFLINE) {
    api('/api/config').then(function (config) {
      document.getElementById('logout').hidden = !config.auth;
      state.storage = config.storage || 'disk';
      if (state.storage === 'github') {
        els.drawer.querySelector('.drawer-note').textContent =
          'Pages are committed to your GitHub repository and served by GitHub Pages, ' +
          'so they survive restarts. A new page can take a minute to appear the first time.';
      }
    }).catch(function () { /* the drawer already reports an unreachable server */ });
  }

  if (OFFLINE) {
    els.drawer.querySelector('.drawer-note').textContent = NO_SERVER;
    els.previewUrl.textContent = 'preview — opened from a file, deploying is off';
    toast('Editing and preview work, but <strong>Deploy</strong> needs the server. ' +
          'Run <code>npm start</code> and open http://127.0.0.1:3000', '', 12000);
  }
}());
