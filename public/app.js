/* Actually Useful — editor, live preview and deploy. */
(function () {
  'use strict';

  var STORAGE_KEY = 'actually-useful:draft:v1';
  var LAYOUT_KEY = 'actually-useful:layout:v1';


  var STARTER = {
    name: 'Hello, Actually Useful',
    active: 'index.html',
    files: [
      {
        name: 'index.html',
        content: [
          '<main class="card">',
          '  <h1>Hello 👋</h1>',
          '  <p>Edit on the left, watch it render on the right, then hit <strong>Deploy</strong>.</p>',
          '  <button id="cheer">Cheer me up</button>',
          '  <p id="out"></p>',
          '  <p><a href="about.html">A second page →</a></p>',
          '</main>'
        ].join('\n')
      },
      {
        name: 'about.html',
        content: [
          '<main class="card">',
          '  <h1>Page two</h1>',
          '  <p>Add as many pages as you like with <strong>＋</strong>, and link them by name.</p>',
          '  <p><a href="index.html">← Back</a></p>',
          '</main>'
        ].join('\n')
      },
      {
        name: 'styles.css',
        content: [
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
          'a { color: #6ea8fe; }',
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
        ].join('\n')
      },
      {
        name: 'app.js',
        content: [
          "var lines = ['You are doing great.', 'Ship it.', 'That looks sharp.'];",
          "var button = document.getElementById('cheer');",
          'if (button) {',
          "  button.addEventListener('click', function () {",
          '    var pick = lines[Math.floor(Math.random() * lines.length)];',
          "    document.getElementById('out').textContent = pick;",
          "    console.log('cheered:', pick);",
          '  });',
          '}'
        ].join('\n')
      }
    ]
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
    tabStrip: $('tab-strip'),
    newFile: $('btn-new-file'),
    fileModal: $('file-modal'),
    fileForm: $('file-form'),
    fileModalTitle: $('file-modal-title'),
    fileName: $('file-name'),
    fileHint: $('file-hint'),
    fileError: $('file-error'),
    fileCancel: $('file-cancel'),
    fileSave: $('file-save'),
    previewPage: null,
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
    bigFile: $('big-file'),
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
  var state = { slug: null, deployed: null, storage: 'disk', files: [], active: 'index.html', previewFile: null, wrapped: false, renderTimer: null, saveTimer: null, consoleCount: 0 };

  // ---------------------------------------------------------------- editors
  // One editor serves every file; switching tabs swaps its contents and mode.
  var editor = new MiniEditor(document.getElementById('ed-main'), {
    mode: 'html',
    ariaLabel: 'Source code',
    onChange: onEdit,
    onCaret: function (at) {
      els.caretPos.textContent = 'Ln ' + at.line + ', Col ' + at.column;
    },
    onColouring: function (on) {
      els.bigFile.hidden = on;
      if (!on) {
        els.bigFile.textContent = 'Large file — colouring off to keep typing quick';
        els.bigFile.title = 'Above ' + Math.round(MiniEditor.COLOUR_LIMIT / 1024) +
          ' KB the editor stops colouring and paints only the lines on screen. ' +
          'A file this size is usually an image pasted into the HTML — upload it ' +
          'under Images instead and the file shrinks back.';
      }
    }
  });
  editors.main = editor;

  /** The project as the API wants it, with the open file's latest text. */
  function source() {
    var files = state.files.map(function (file) {
      return {
        name: file.name,
        content: file.name === state.active ? editor.getValue() : file.content
      };
    });
    return { name: els.name.value.trim() || 'Untitled page', files: files };
  }

  /** Copies what is on screen back into the file list. */
  function commitActive() {
    var file = Compose.find(state.files, state.active);
    if (file) file.content = editor.getValue();
  }

  function load(data) {
    els.name.value = data.name || 'Untitled page';
    state.files = Compose.toFiles(data).map(function (file) {
      return { name: file.name, content: String(file.content || '') };
    });
    if (!state.files.length) state.files = [{ name: Compose.ENTRY, content: '' }];

    state.active = Compose.find(state.files, data.active) ? data.active : Compose.entryOf(state.files);
    state.slug = data.slug || null;
    state.previewFile = null;
    openFile(state.active, true);
    renderTabs();
  }

  function openFile(name, skipCommit) {
    var file = Compose.find(state.files, name);
    if (!file) return;
    if (!skipCommit) commitActive();

    state.active = name;
    editor.setMode(Compose.fileType(name));
    editor.setValue(file.content);
    editor.refresh();
    renderTabs();
    if (!els.findbar.hidden) runFind(false);
  }

  function refreshEditors() { editor.refresh(); }

  // ------------------------------------------------------------------- tabs
  function renderTabs() {
    els.tabStrip.innerHTML = state.files.map(function (file) {
      var on = file.name === state.active;
      return '<button class="tab' + (on ? ' is-active' : '') + '" role="tab" ' +
        'aria-selected="' + on + '" data-file="' + Compose.escapeHtml(file.name) + '" ' +
        'title="Double-click to rename">' +
        '<span class="tab-dot is-' + Compose.fileType(file.name) + '"></span>' +
        '<span class="tab-name">' + Compose.escapeHtml(file.name) + '</span>' +
        (state.files.length > 1
          ? '<span class="tab-close" role="button" data-close="1" aria-label="Delete ' +
            Compose.escapeHtml(file.name) + '">×</span>'
          : '') +
        '</button>';
    }).join('');
  }

  els.tabStrip.addEventListener('click', function (event) {
    var tab = event.target.closest('.tab[data-file]');
    if (!tab) return;
    if (event.target.dataset.close) return deleteFile(tab.dataset.file);
    openFile(tab.dataset.file);
    editor.focus();
  });

  els.tabStrip.addEventListener('dblclick', function (event) {
    var tab = event.target.closest('.tab[data-file]');
    if (tab) openFileModal(tab.dataset.file);
  });

  function deleteFile(name) {
    var pages = Compose.byType(state.files, 'html');
    if (Compose.fileType(name) === 'html' && pages.length === 1) {
      return toast('A project needs at least one page.', 'err');
    }
    if (!window.confirm('Delete ' + name + ' from this project?')) return;

    commitActive();
    state.files = state.files.filter(function (file) { return file.name !== name; });
    if (state.active === name) state.active = Compose.entryOf(state.files) || state.files[0].name;
    if (state.previewFile === name) state.previewFile = null;
    openFile(state.active, true);
    onEdit();
    toast('Deleted ' + name + '. Deploy to publish the change.', 'ok');
  }

  // --------------------------------------------------------- new and rename
  var modal = { type: 'html', renaming: null };

  var HINTS = {
    html: function (name) {
      return 'Saved as <code>' + Compose.escapeHtml(name) + '</code>. Link to it from another page with ' +
        '<code>&lt;a href="' + Compose.escapeHtml(name) + '"&gt;</code>';
    },
    css: function (name) {
      return 'Saved as <code>' + Compose.escapeHtml(name) + '</code> and linked into your pages automatically. ' +
        'In a full HTML document, add it yourself with <code>&lt;link rel="stylesheet" href="' +
        Compose.escapeHtml(name) + '"&gt;</code>';
    },
    js: function (name) {
      return 'Saved as <code>' + Compose.escapeHtml(name) + '</code> and linked into your pages automatically. ' +
        'In a full HTML document, add it yourself with <code>&lt;script src="' +
        Compose.escapeHtml(name) + '"&gt;&lt;/script&gt;</code>';
    }
  };

  function plannedName() {
    return Compose.fileNameFor(els.fileName.value || 'untitled', modal.type);
  }

  function updateHint() {
    els.fileHint.innerHTML = HINTS[modal.type](plannedName());
  }

  function pickType(type) {
    modal.type = type;
    els.fileModal.querySelectorAll('.type-picker button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.type === type));
    });
    updateHint();
  }

  function openFileModal(renaming) {
    modal.renaming = renaming || null;
    els.fileError.hidden = true;
    els.fileModalTitle.textContent = renaming ? 'Rename ' + renaming : 'New file';
    els.fileSave.textContent = renaming ? 'Rename' : 'Create';
    els.fileName.value = renaming ? renaming.replace(/\.(html|css|js)$/, '') : '';
    pickType(renaming ? Compose.fileType(renaming) : 'html');
    els.fileModal.hidden = false;
    els.fileName.focus();
    els.fileName.select();
  }

  function closeFileModal() {
    els.fileModal.hidden = true;
    editor.focus();
  }

  els.newFile.addEventListener('click', function () { openFileModal(null); });
  els.fileCancel.addEventListener('click', closeFileModal);
  els.fileName.addEventListener('input', updateHint);
  els.fileModal.addEventListener('click', function (event) {
    if (event.target === els.fileModal) closeFileModal();
  });
  els.fileModal.querySelectorAll('.type-picker button').forEach(function (button) {
    button.addEventListener('click', function () { pickType(button.dataset.type); });
  });

  els.fileForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var name = plannedName();

    if (!Compose.isValidName(name)) {
      els.fileError.textContent = 'Use letters, digits, dashes or dots.';
      els.fileError.hidden = false;
      return;
    }
    if (name !== modal.renaming && Compose.find(state.files, name)) {
      els.fileError.textContent = 'This project already has a file called ' + name + '.';
      els.fileError.hidden = false;
      return;
    }

    commitActive();
    if (modal.renaming) {
      var file = Compose.find(state.files, modal.renaming);
      file.name = name;
      if (state.active === modal.renaming) state.active = name;
      if (state.previewFile === modal.renaming) state.previewFile = name;
      toast('Renamed to ' + name + '. Links pointing at the old name need updating.', 'ok', 7000);
    } else {
      state.files.push({ name: name, content: NEW_FILE[modal.type](name) });
      state.active = name;
    }

    closeFileModal();
    openFile(state.active, true);
    onEdit();
  });

  var NEW_FILE = {
    html: function (name) {
      return '<h1>' + name.replace(/\.html$/, '') + '</h1>\n<p><a href="index.html">← Back</a></p>';
    },
    css: function () { return '/* Styles for every page in this project */\n'; },
    js: function () { return "// Runs on every page in this project\n"; }
  };

  // ---------------------------------------------------------------- preview
  var PREVIEW_BASE = '<base href="' + location.origin + '/p/x/">';

  var NAV_BRIDGE = [
    '<script>',
    '(function () {',
    '  document.addEventListener("click", function (event) {',
    '    var link = event.target.closest && event.target.closest("a[href]");',
    '    if (!link) return;',
    '    var href = link.getAttribute("href") || "";',
    '    if (/^(?:[a-z]+:|\\/\\/|#)/i.test(href)) return;',
    '    event.preventDefault();',
    '    try { parent.postMessage({ __au: true, nav: href }, "*"); } catch (e) {}',
    '  });',
    '}());',
    '<\/script>'
  ].join('\n');

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
    var page = Compose.find(parts.files, state.previewFile)
      ? state.previewFile
      : Compose.entryOf(parts.files);

    if (!page) {
      els.preview.srcdoc = '<p style="font:14px system-ui;padding:24px">This project has no HTML page.</p>';
      return;
    }

    var doc = Compose.composeFile(parts.files, page, {
      head: PREVIEW_BASE + '\n' + CONSOLE_BRIDGE + '\n' + NAV_BRIDGE,
      title: parts.name
    });
    // Nothing is served yet while drafting, so the project's own stylesheets
    // and scripts are folded in rather than linked.
    els.preview.srcdoc = Compose.inlineLocal(doc, parts.files);

    state.previewFile = page;
    els.previewUrl.textContent = previewLabel(parts, page);
    renderPreviewPage(parts, page);
  }

  /** Lets you jump back to the entry page once you have followed a link. */
  function renderPreviewPage(parts, page) {
    var entry = Compose.entryOf(parts.files);
    if (!els.previewPage) {
      els.previewPage = document.createElement('button');
      els.previewPage.className = 'preview-page';
      els.previewPage.type = 'button';
      els.previewPage.addEventListener('click', function () {
        state.previewFile = null;
        render();
      });
      els.previewUrl.parentNode.insertBefore(els.previewPage, els.previewUrl.nextSibling);
    }
    var showing = page !== entry;
    els.previewPage.hidden = !showing;
    if (showing) {
      els.previewPage.textContent = '← ' + entry;
      els.previewPage.title = 'Back to ' + entry;
    }
  }

  /** Says whether what you are looking at matches what is deployed. */
  function previewLabel(parts, page) {
    var shown = page && page !== Compose.entryOf(parts.files) ? page : '';
    if (!state.slug) return 'preview' + (shown ? ' · ' + shown : ' — not deployed yet');
    return '/p/' + state.slug + '/' + shown + (sameAsDeployed(parts) ? ' · live' : ' · unpublished changes');
  }

  /** Whether what is on screen matches what is published at this slug. */
  function sameAsDeployed(parts) {
    var live = state.deployed;
    if (!live || live.name !== parts.name) return false;
    if (live.files.length !== parts.files.length) return false;
    return parts.files.every(function (file) {
      var published = Compose.find(live.files, file.name);
      return published && published.content === file.content;
    });
  }

  function scheduleRender() {
    if (!els.autoRun.checked) return;
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(render, 400);
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.__au !== true) return;

    if (data.nav !== undefined) {
      var target = String(data.nav).split(/[?#]/)[0].replace(/^\.\//, '');
      if (!target) target = Compose.ENTRY;
      if (Compose.find(state.files, target)) {
        state.previewFile = target;
        return render();
      }
      return toast('This project has no file called <code>' +
        Compose.escapeHtml(target) + '</code>. Add it with ＋.', 'err', 6000);
    }

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
    els.previewUrl.textContent = previewLabel(source(), state.previewFile);
  }

  function saveLocal() {
    commitActive();
    var data = source();
    data.slug = state.slug;
    data.active = state.active;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      els.saveState.textContent = 'Saved locally · ' + new Date().toLocaleTimeString();
      els.saveState.classList.remove('is-dirty');
    } catch (err) {
      // Browsers cap local storage at a few MB; a pasted image blows past it.
      els.saveState.textContent = 'Too large to save in this browser — deploy to keep it';
      els.saveState.classList.add('is-dirty');
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
    if (!parts.files.some(function (file) { return file.content.trim(); })) {
      return toast('Nothing to deploy yet — write some HTML first.', 'err');
    }
    els.deploy.disabled = true;
    els.deploy.textContent = 'Deploying…';

    api('/api/deploys', {
      method: 'POST',
      body: JSON.stringify({
        name: parts.name,
        slug: state.slug || undefined,
        files: parts.files
      })
    }).then(function (site) {
      state.slug = site.slug;
      state.deployed = { name: parts.name, files: parts.files };
      saveLocal();
      els.previewUrl.textContent = previewLabel(parts, state.previewFile);
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
        state.deployed = { name: mine.name, files: Compose.toFiles(mine.source) };
      } else if (state.slug) {
        state.slug = null;
        state.deployed = null;
      }
      els.previewUrl.textContent = previewLabel(source(), state.previewFile);
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
        var files = Compose.toFiles(site.source);
        load({ name: site.name, files: files, slug: site.slug });
        state.deployed = { name: site.name, files: files };
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
  function activeEditor() { return editor; }

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
    editor.clearFind();
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
    editor.setWrap(state.wrapped);
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
      // An <img> belongs in a page, so switch to one if a stylesheet is open.
      if (Compose.fileType(state.active) !== 'html') openFile(Compose.entryOf(state.files));
      editor.insertAtCursor('\n' + tag + '\n');
      return void toast('Inserted into ' + state.active + '.', 'ok');
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
    var page = Compose.find(parts.files, state.previewFile) ? state.previewFile : Compose.entryOf(parts.files);
    if (!page) return toast('There is no page to download.', 'err');

    // Everything the page needs is folded in, so the file works on its own.
    var doc = Compose.inlineLocal(
      Compose.composeFile(parts.files, page, { title: parts.name }),
      parts.files
    );
    var blob = new Blob([doc], { type: 'text/html' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = page;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Downloaded ' + a.download, 'ok');
  });

  // ----------------------------------------------------------------- format
  els.format.addEventListener('click', function () {
    var tidy = Compose.fileType(state.active) === 'html' ? formatMarkup : formatBraces;
    editor.setValue(tidy(editor.getValue()));
    onEdit();
    toast('Re-indented ' + state.active + '.', 'ok');
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
    if (!window.confirm('Clear the editor and start a new project? Deployed pages are not affected.')) return;
    load({ name: 'Untitled page', files: [{ name: Compose.ENTRY, content: '' }], slug: null });
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

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !els.fileModal.hidden) closeFileModal();
  });

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
