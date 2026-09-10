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
    closeDrawer: $('btn-close-drawer'),
    siteList: $('site-list'),
    workspace: $('workspace'),
    splitter: $('splitter'),
    saveState: $('save-state'),
    toasts: $('toasts')
  };

  var editors = {};
  var state = { slug: null, deployed: null, renderTimer: null, saveTimer: null, consoleCount: 0 };

  // ---------------------------------------------------------------- editors
  PANES.forEach(function (pane) {
    editors[pane] = new MiniEditor(document.getElementById('ed-' + pane), {
      mode: pane,
      ariaLabel: pane.toUpperCase() + ' source',
      onChange: onEdit
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
      editors[target].refresh();
      editors[target].focus();
    });
  });

  // ---------------------------------------------------------------- preview
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
      head: CONSOLE_BRIDGE
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
      toast(
        'Deployed v' + site.version + ' → <a href="' + site.url + '" target="_blank" rel="noopener">' +
        Compose.escapeHtml(site.url) + '</a>',
        'ok',
        9000
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
      return '<li class="site" data-slug="' + site.slug + '">' +
        '<div class="site-title"><strong>' + Compose.escapeHtml(site.name) + '</strong>' +
        '<span class="site-meta">v' + site.version + ' · ' + relTime(site.updatedAt) + live + '</span></div>' +
        '<a class="site-url" href="' + site.url + '" target="_blank" rel="noopener">' +
        Compose.escapeHtml(site.url) + '</a>' +
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
    var url = item.querySelector('.site-url').href;

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
    if (show) loadSites();
  });
  els.closeDrawer.addEventListener('click', function () {
    els.drawer.hidden = true;
    els.sites.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !els.drawer.hidden) els.closeDrawer.click();
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
    if (event.key === 's') { event.preventDefault(); deploy(); }
    if (event.key === 'Enter') { event.preventDefault(); render(); }
  });

  window.addEventListener('resize', refreshEditors);

  load(loadLocal() || STARTER);
  saveLocal();
  render();
  loadSites();

  if (OFFLINE) {
    els.drawer.querySelector('.drawer-note').textContent = NO_SERVER;
    els.previewUrl.textContent = 'preview — opened from a file, deploying is off';
    toast('Editing and preview work, but <strong>Deploy</strong> needs the server. ' +
          'Run <code>npm start</code> and open http://127.0.0.1:3000', '', 12000);
  }
}());
