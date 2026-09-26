/* Actually Useful — editor, live preview and deploy. */
(function () {
  'use strict';

  // Each account has its own draft (see backup.js); the main one keeps the original key.
  var STORAGE_KEY = Backup.KEYS.editor;
  var PAGES = Backup.PAGES;
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
    binaryView: $('ed-binary'),
    binaryThumb: $('binary-thumb'),
    binaryName: $('binary-name'),
    binarySize: $('binary-size'),
    binaryRef: $('binary-ref'),
    importBtn: $('btn-import'),
    importModal: $('import-modal'),
    importFiles: $('import-files'),
    importFolder: $('import-folder'),
    importPickFiles: $('import-pick-files'),
    importPickFolder: $('import-pick-folder'),
    importCancel: $('import-cancel'),
    dropveil: $('dropveil'),
    editorHost: $('ed-main'),
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
  var state = { slug: null, deployed: null, storage: 'disk', files: [], active: 'index.html', previewFile: null, wrapped: false, quotaWarned: false, tabSignature: null, renderTimer: null, saveTimer: null, consoleCount: 0 };

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

  /** Whether the open file is one the editor actually holds. */
  function editingText() {
    return Boolean(state.active) && !Compose.isBinary(state.active);
  }

  /** The project as the API wants it, with the open file's latest text. */
  function source() {
    var files = state.files.map(function (file) {
      // A binary is never in the editor, so its bytes must not be taken from it.
      var live = editingText() && file.name === state.active;
      return { name: file.name, content: live ? editor.getValue() : file.content };
    });
    return { name: els.name.value.trim() || 'Untitled page', files: files };
  }

  /** Copies what is on screen back into the file list. */
  function commitActive() {
    if (!editingText()) return;
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

    if (Compose.isBinary(name)) {
      showBinary(file);
      renderTabs();
      return;
    }

    els.binaryView.hidden = true;
    els.editorHost.hidden = false;
    editor.setMode(Compose.editorMode(name));
    editor.setValue(file.content);
    editor.refresh();
    renderTabs();
    if (!els.findbar.hidden) runFind(false);
  }

  /** Binary files are shown, not edited: size, a thumbnail, and their path. */
  function showBinary(file) {
    els.editorHost.hidden = true;
    els.binaryView.hidden = false;

    var bytes = Math.ceil((file.content || '').replace(/\s+/g, '').length * 3 / 4);
    els.binaryName.textContent = file.name;
    els.binarySize.textContent = formatSize(bytes);
    els.binaryRef.textContent = Compose.fileType(file.name) === 'woff2' ||
      Compose.fileType(file.name) === 'woff'
      ? 'url("' + file.name + '")'
      : '<img src="' + file.name + '">';

    var previewable = /^(png|jpg|gif|webp|avif|ico)$/.test(Compose.fileType(file.name));
    if (previewable && file.content) {
      els.binaryThumb.className = 'binary-thumb';
      els.binaryThumb.style.backgroundImage =
        'url("data:' + Compose.contentType(file.name) + ';base64,' + file.content.replace(/\s+/g, '') + '")';
      els.binaryThumb.textContent = '';
    } else {
      els.binaryThumb.className = 'binary-thumb is-blank';
      els.binaryThumb.style.backgroundImage = '';
      els.binaryThumb.textContent = '.' + Compose.fileType(file.name);
    }
  }

  function refreshEditors() { editor.refresh(); }

  // ------------------------------------------------------------------- tabs
  function renderTabs() {
    var signature = state.files.map(function (file) { return file.name; }).join('\n');

    // Rebuilding the strip on every click destroyed the element mid-gesture,
    // so a double-click to rename never landed. When only the selection
    // changed, move the marker instead of replacing the tabs.
    if (signature === state.tabSignature) {
      Array.prototype.forEach.call(els.tabStrip.children, function (tab) {
        var on = tab.dataset.file === state.active;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', String(on));
      });
      return;
    }
    state.tabSignature = signature;

    els.tabStrip.innerHTML = state.files.map(function (file) {
      var on = file.name === state.active;
      return '<button class="tab' + (on ? ' is-active' : '') + '" role="tab" ' +
        'aria-selected="' + on + '" data-file="' + Compose.escapeHtml(file.name) + '" ' +
        'title="Double-click to rename">' +
        '<span class="tab-dot is-' +
        (Compose.isBinary(file.name) ? 'binary' : Compose.fileType(file.name)) + '"></span>' +
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
      return 'Saved as <code>' + name + '</code>. Link to it from another page with ' +
        '<code>&lt;a href="' + name + '"&gt;</code>';
    },
    css: function (name) {
      return 'Saved as <code>' + name + '</code> and linked into your pages automatically. ' +
        'In a full HTML document, add it yourself with <code>&lt;link rel="stylesheet" href="' +
        name + '"&gt;</code>';
    },
    js: function (name) {
      return 'Saved as <code>' + name + '</code> and linked into your pages automatically. ' +
        'In a full HTML document, add it yourself with <code>&lt;script src="' + name +
        '"&gt;&lt;/script&gt;</code>';
    },
    cpp: function (name) {
      return 'Saved as <code>' + name + '</code> and published as readable source. ' +
        'A browser cannot run C++ directly — compile it to <code>.wasm</code> and load ' +
        'that from a script to run it on the page.';
    },
    other: function (name) {
      return 'Saved as <code>' + name + '</code> and published at that path.';
    }
  };

  /**
   * The name the file will get. An extension you type yourself wins over the
   * picker, so "notes.md" or "icons/logo.png" arrive as written.
   */
  function plannedName() {
    var typed = String(els.fileName.value || '').trim();
    if (Compose.fileType(typed) && Compose.isValidName(typed)) return typed;
    return Compose.fileNameFor(typed || 'untitled', modal.type);
  }

  function updateHint() {
    var name = plannedName();
    var hint = HINTS[Compose.fileType(name)] || HINTS.other;
    els.fileHint.innerHTML = hint(Compose.escapeHtml(name));
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
    var kind = renaming ? Compose.fileType(renaming) : 'html';
    pickType(HINTS[kind] && kind !== 'other' ? kind : 'html');
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
      var starter = NEW_FILE[Compose.fileType(name)];
      state.files.push({ name: name, content: starter ? starter(name) : '' });
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
    js: function () { return '// Runs on every page in this project\n'; },
    cpp: function () {
      return [
        '#include <iostream>',
        '',
        '// Compile with Emscripten to run this on the page:',
        '//   emcc main.cpp -o main.js -s EXPORTED_FUNCTIONS=_main',
        '// then import the .js and .wasm it produces.',
        'int main() {',
        '    std::cout << "Hello from C++" << std::endl;',
        '    return 0;',
        '}',
        ''
      ].join('\n');
    },
    json: function () { return '{\n  \n}\n'; },
    md: function (name) { return '# ' + name.replace(/\.md$/, '') + '\n'; },
    txt: function () { return ''; },
    svg: function () { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>\n'; }
  };

  // ---------------------------------------------------------------- preview
  var PREVIEW_BASE = '<base href="' + location.origin + PAGES + 'x/">';

  // A service worker cannot register inside the preview iframe, so say so once
  // rather than letting the call throw.
  var WORKER_BRIDGE = [
    '<script>',
    '(function () {',
    '  function note(script) {',
    '    try {',
    '      parent.postMessage({ __au: true, level: "info", text:',
    '        "Service worker " + JSON.stringify(String(script)) + " is not registered in the preview — it runs once deployed." }, "*");',
    '    } catch (e) {}',
    '    return Promise.resolve({',
    '      scope: location.href, installing: null, waiting: null, active: null,',
    '      addEventListener: function () {}, update: function () { return Promise.resolve(); },',
    '      unregister: function () { return Promise.resolve(true); }',
    '    });',
    '  }',
    '  var present = false;',
    '  // Reading the property throws outright in a sandboxed frame, so guard it.',
    '  try { present = Boolean(navigator.serviceWorker); } catch (e) { present = false; }',
    '  try {',
    '    if (present) { navigator.serviceWorker.register = note; }',
    '    else {',
    '      Object.defineProperty(navigator, "serviceWorker", {',
    '        configurable: true,',
    '        value: { register: note, ready: new Promise(function () {}),',
    '                 getRegistration: function () { return Promise.resolve(undefined); },',
    '                 getRegistrations: function () { return Promise.resolve([]); },',
    '                 addEventListener: function () {} }',
    '      });',
    '    }',
    '  } catch (e) {}',
    '}());',
    '<\/script>'
  ].join('\n');

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

    var urls = previewAssets(parts.files);
    var doc = Compose.composeFile(parts.files, page, {
      head: PREVIEW_BASE + '\n' + fetchBridge(urls) + '\n' + CONSOLE_BRIDGE +
        '\n' + WORKER_BRIDGE + '\n' + NAV_BRIDGE,
      title: parts.name
    });
    // Nothing is served yet while drafting, so the project's own stylesheets
    // and scripts are folded in, and its assets are pointed at blob URLs.
    els.preview.srcdoc = withPreviewAssets(Compose.inlineLocal(doc, parts.files), urls);

    state.previewFile = page;
    els.previewUrl.textContent = previewLabel(parts, page);
    renderPreviewPage(parts, page);
  }

  /**
   * Points every reference to a project file at an inline data: URL, so
   * images, icons and fonts render before anything is deployed. Links between
   * pages are left alone — those switch the previewed page instead.
   *
   * These have to be data: URLs rather than blob: ones. The preview runs
   * sandboxed without allow-same-origin, which is what stops a page you are
   * writing from reaching into the editor; an opaque origin like that cannot
   * read a blob URL minted out here, but a data: URL carries its own bytes.
   */
  function previewAssets(files) {
    var urls = {};
    files.forEach(function (file) {
      if (Compose.fileType(file.name) === 'html') return;
      var type = Compose.contentType(file.name);
      urls[file.name] = Compose.isBinary(file.name)
        ? 'data:' + type + ';base64,' + (file.content || '').replace(/\s+/g, '')
        : 'data:' + type + ';base64,' + b64(file.content || '');
    });
    return urls;
  }

  function withPreviewAssets(doc, urls) {

    var replaceRef = function (text) {
      return text.replace(/(src|href)=("|')([^"']+)\2/gi, function (whole, attr, quote, ref) {
        var clean = ref.replace(/^\.\//, '').split(/[?#]/)[0];
        return urls[clean] ? attr + '=' + quote + urls[clean] + quote : whole;
      });
    };

    // Inside CSS too, or url(icon.png) in a stylesheet would not resolve.
    var out = doc.replace(/<style>([\s\S]*?)<\/style>/gi, function (whole, css) {
      return '<style>' + css.replace(/url\((["']?)([^)"']+)\1\)/gi, function (ref, quote, target) {
        var clean = target.replace(/^\.\//, '').split(/[?#]/)[0];
        return urls[clean] ? 'url(' + quote + urls[clean] + quote + ')' : ref;
      }) + '</style>';
    });

    // <a href> keeps its plain name so following it switches the preview.
    return out.replace(/<(?!a\b)([a-z][\w-]*)\b([^>]*)>/gi, function (whole, tag, attrs) {
      return '<' + tag + replaceRef(attrs) + '>';
    });
  }

  /**
   * Nothing is served while drafting, so a fetch for one of the project's own
   * files is answered from the copy carried in the page. It is what makes
   * fetch("data.json") — or WebAssembly.instantiateStreaming(fetch("app.wasm"))
   * — behave in the preview the way it will once deployed.
   */
  function fetchBridge(urls) {
    return [
      '<script>',
      '(function () {',
      '  var files = ' + JSON.stringify(urls) + ';',
      '  var original = window.fetch ? window.fetch.bind(window) : null;',
      '  if (!original) return;',
      '  window.fetch = function (input, init) {',
      '    try {',
      '      var url = String((input && input.url) || input || "");',
      '      var key = url.replace(/^\\.\\//, "").split(/[?#]/)[0];',
      '      if (Object.prototype.hasOwnProperty.call(files, key)) {',
      '        return original(files[key], init);',
      '      }',
      '    } catch (e) {}',
      '    return original(input, init);',
      '  };',
      '}());',
      '<\/script>'
    ].join('\n');
  }

  /** UTF-8 safe base64, since btoa alone rejects anything outside Latin-1. */
  function b64(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
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
    return PAGES + state.slug + '/' + shown + (sameAsDeployed(parts) ? ' · live' : ' · unpublished changes');
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

  // Browsers give a page a few MB; warn while there is still room to act.
  var QUOTA_BYTES = 5 * 1024 * 1024;
  var QUOTA_WARN_AT = 0.8;

  function saveLocal() {
    commitActive();
    var data = source();
    data.slug = state.slug;
    data.active = state.active;

    var payload = JSON.stringify(data);
    var share = payload.length / QUOTA_BYTES;
    if (share >= QUOTA_WARN_AT && !state.quotaWarned) {
      state.quotaWarned = true;
      toast('This project is using about ' + Math.round(share * 100) + '% of what this ' +
        'browser will store. Deploy it, or move big images into <strong>Images</strong>, ' +
        'before it stops saving.', 'err', 12000);
    }
    if (share < QUOTA_WARN_AT * 0.75) state.quotaWarned = false;

    try {
      localStorage.setItem(STORAGE_KEY, payload);
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
      if (!window.confirm('Delete the deployed page at ' + PAGES + slug + '? This cannot be undone.')) return;
      return void api('/api/deploys/' + slug, { method: 'DELETE' }).then(function () {
        if (state.slug === slug) {
          state.slug = null;
          saveLocal();
        }
        toast('Deleted ' + PAGES + slug, 'ok');
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

  // ----------------------------------------------------------------- import
  var IMPORT_LIMITS = { files: 60, textBytes: 2 * 1024 * 1024, binaryBytes: 5 * 1024 * 1024 };

  /** Reads one dropped or chosen file into a project file. */
  function readImported(file, pathName) {
    return new Promise(function (resolve) {
      var name = String(pathName || file.name).replace(/^\/+/, '');
      // A folder pick reports "myapp/index.html"; drop the wrapping folder.
      if (name.indexOf('/') !== -1 && els.importFolder.dataset.stripRoot === '1') {
        name = name.split('/').slice(1).join('/');
      }

      if (!Compose.isValidName(name)) {
        return resolve({ error: name + ' — unsupported file type' });
      }

      var binary = Compose.isBinary(name);
      var cap = binary ? IMPORT_LIMITS.binaryBytes : IMPORT_LIMITS.textBytes;
      if (file.size > cap) {
        return resolve({ error: name + ' — larger than ' + formatSize(cap) });
      }

      var reader = new FileReader();
      reader.onerror = function () { resolve({ error: name + ' — could not be read' }); };
      reader.onload = function () {
        if (binary) {
          resolve({ file: { name: name, content: String(reader.result).replace(/^data:[^,]*,/, '') } });
        } else {
          resolve({ file: { name: name, content: String(reader.result) } });
        }
      };
      if (binary) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  }

  function importAll(list, paths) {
    var items = Array.prototype.slice.call(list);
    if (!items.length) return;

    commitActive();
    Promise.all(items.map(function (file, i) {
      return readImported(file, paths ? paths[i] : null);
    })).then(function (results) {
      var added = [];
      var replaced = [];
      var failed = [];

      results.forEach(function (result) {
        if (result.error) return failed.push(result.error);
        var existing = Compose.find(state.files, result.file.name);
        if (existing) {
          existing.content = result.file.content;
          replaced.push(result.file.name);
        } else {
          if (state.files.length >= IMPORT_LIMITS.files) {
            return failed.push(result.file.name + ' — the project is full (' + IMPORT_LIMITS.files + ' files)');
          }
          state.files.push(result.file);
          added.push(result.file.name);
        }
      });

      if (added.length || replaced.length) {
        var open = added[0] || replaced[0];
        var page = Compose.entryOf(state.files);
        state.active = Compose.find(state.files, state.active) ? state.active : (page || open);
        openFile(state.active, true);
        onEdit();

        var parts = [];
        if (added.length) parts.push('Added ' + added.length);
        if (replaced.length) parts.push('replaced ' + replaced.length);
        toast(parts.join(', ') + '. Deploy to publish.', 'ok');
      }
      failed.slice(0, 4).forEach(function (message) { toast(message, 'err', 7000); });
      if (failed.length > 4) toast((failed.length - 4) + ' more files were skipped.', 'err', 7000);
    });
  }

  els.importBtn.addEventListener('click', function () { els.importModal.hidden = false; });
  els.importCancel.addEventListener('click', function () { els.importModal.hidden = true; });
  els.importModal.addEventListener('click', function (event) {
    if (event.target === els.importModal) els.importModal.hidden = true;
  });
  els.importPickFiles.addEventListener('click', function () {
    els.importFolder.dataset.stripRoot = '0';
    els.importFiles.click();
  });
  els.importPickFolder.addEventListener('click', function () {
    els.importFolder.dataset.stripRoot = '1';
    els.importFolder.click();
  });

  els.importFiles.addEventListener('change', function () {
    els.importModal.hidden = true;
    importAll(els.importFiles.files);
    els.importFiles.value = '';
  });
  els.importFolder.addEventListener('change', function () {
    els.importModal.hidden = true;
    var picked = Array.prototype.slice.call(els.importFolder.files);
    importAll(picked, picked.map(function (file) {
      return file.webkitRelativePath || file.name;
    }));
    els.importFolder.value = '';
  });

  // Dropping files anywhere over the editor adds them to the project.
  var dragDepth = 0;
  window.addEventListener('dragenter', function (event) {
    if (!event.dataTransfer || event.dataTransfer.types.indexOf('Files') === -1) return;
    dragDepth += 1;
    els.dropveil.hidden = false;
  });
  window.addEventListener('dragover', function (event) {
    if (els.dropveil.hidden) return;
    event.preventDefault();
  });
  window.addEventListener('dragleave', function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.dropveil.hidden = true;
  });
  window.addEventListener('drop', function (event) {
    if (!event.dataTransfer || event.dataTransfer.types.indexOf('Files') === -1) return;
    event.preventDefault();
    dragDepth = 0;
    els.dropveil.hidden = true;
    // The Images drawer has its own drop handler for picture uploads.
    if (event.target.closest && event.target.closest('#dropzone')) return;
    importAll(event.dataTransfer.files);
  });

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
      ['&gt;', 'In HTML, writes the closing tag and puts the caret between'],
      ['&lt;/', 'Completes whichever tag is still open'],
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
      var src = PAGES + 'assets/' + encodeURIComponent(asset.name);
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

  // ----------------------------------------------------------------- backup
  // One file with this project and the Learn progress kept in this
  // browser. In the open version it is the only way work leaves the browser.
  var backupModal = $('backup-modal');
  var backupFile = $('backup-file');

  function openBackup() { backupModal.hidden = false; }
  function closeBackup() { backupModal.hidden = true; }

  function downloadBackup() {
    saveLocal();
    var doc = Backup.collect(localStorage);
    Backup.download(doc, Backup.fileName());
    closeBackup();
    toast('Backup downloaded — ' + Compose.escapeHtml(Backup.describe(doc)) + '.', 'ok', 6000);
  }

  function restoreBackup(text) {
    var parsed;
    try {
      parsed = Backup.parse(text);
    } catch (err) {
      return toast(Compose.escapeHtml(err.message), 'err', 7000);
    }
    if (parsed.editor && !window.confirm(
      'Restore ' + Backup.describe(parsed) + '?\n\n' +
      'The project in the editor is replaced by the one in the backup. ' +
      'Learning progress is merged, so nothing you have done there is lost.')) return;

    if (parsed.learn && window.LearnEngine) {
      var current = null;
      try { current = JSON.parse(localStorage.getItem(Backup.KEYS.learn) || 'null'); } catch (err) { current = null; }
      var merged = LearnEngine.mergeProgress(current || LearnEngine.emptyProgress(), parsed.learn);
      try {
        localStorage.setItem(Backup.KEYS.learn, JSON.stringify(merged));
      } catch (err) {
        return toast('This browser has no room to store the learning progress.', 'err', 7000);
      }
    }
    if (parsed.editor) {
      load(parsed.editor);
      saveLocal();
      render();
    }
    closeBackup();
    toast('Restored ' + Compose.escapeHtml(Backup.describe(parsed)) + '.', 'ok', 6000);
  }

  $('btn-backup').addEventListener('click', openBackup);
  $('backup-download').addEventListener('click', downloadBackup);
  $('backup-cancel').addEventListener('click', closeBackup);
  $('backup-restore').addEventListener('click', function () { backupFile.value = ''; backupFile.click(); });
  backupFile.addEventListener('change', function () {
    var file = backupFile.files[0];
    if (!file) return;
    file.text().then(restoreBackup, function () { toast('Could not read that file.', 'err'); });
  });
  backupModal.addEventListener('click', function (event) {
    if (event.target === backupModal) closeBackup();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !backupModal.hidden) closeBackup();
  });

  // ------------------------------------------------------------------ boot
  els.run.addEventListener('click', render);
  els.deploy.addEventListener('click', deploy);
  els.autoRun.addEventListener('change', function () { if (els.autoRun.checked) render(); });

  document.addEventListener('keydown', function (event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    var key = event.key.toLowerCase();

    if (key === 's') {
      event.preventDefault();
      if (state.open) {
        saveLocal();
        return toast('Saved in this browser. Publishing is off in the open version — ' +
          'use <strong>Backup</strong> to keep a copy.', '', 6000);
      }
      return deploy();
    }
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
      if (config.account && config.account !== 'main') {
        // Say which account this is, so the two are never confused.
        document.getElementById('logout').textContent = 'Sign out (account 2)';
        document.body.classList.add('is-second-account');
      }
      state.storage = config.storage || 'disk';
      if (config.open) enterOpenMode();
      if (state.storage === 'github') {
        els.drawer.querySelector('.drawer-note').textContent =
          'Pages are committed to your GitHub repository and served by GitHub Pages, ' +
          'so they survive restarts. A new page can take a minute to appear the first time.';
      }
    }).catch(function () { /* the drawer already reports an unreachable server */ });
  }

  /** The open version: no publishing, so no Deploy, Pages or Images. */
  function enterOpenMode() {
    state.open = true;
    document.body.classList.add('is-open-version');
    [els.deploy, els.sites, $('btn-images')].forEach(function (button) { if (button) button.hidden = true; });
    $('backup-note').textContent = 'This is the open version: nothing is published or kept on the server. ' +
      'Your project and learning progress live in this browser — download a backup now and then ' +
      'so clearing the browser can never cost you your work.';
    els.previewUrl.textContent = 'preview — open version, publishing is off';
  }

  if (OFFLINE) {
    els.drawer.querySelector('.drawer-note').textContent = NO_SERVER;
    els.previewUrl.textContent = 'preview — opened from a file, deploying is off';
    toast('Editing and preview work, but <strong>Deploy</strong> needs the server. ' +
          'Run <code>npm start</code> and open http://127.0.0.1:3000', '', 12000);
  }
}());
