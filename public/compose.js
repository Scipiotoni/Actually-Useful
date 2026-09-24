/**
 * Turns a project's files into what gets served.
 *
 * A project is a list of files, each with a name ending in .html, .css or .js.
 * Shared verbatim by the browser (live preview) and the server (deploy), so
 * what you preview is what gets published.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Compose = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var FULL_DOC = /<html[\s>]/i;
  var ENTRY = 'index.html';

  // Editable as text, in the editor.
  var TEXT_TYPES = {
    html: 'html', css: 'css', js: 'js',
    json: 'json', svg: 'svg', txt: 'txt', md: 'md',
    // C and C++ sources all share one highlighter.
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'cpp', h: 'cpp', hpp: 'cpp'
  };
  // Kept as base64 and shown read-only.
  var BINARY_TYPES = {
    png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', webp: 'webp',
    avif: 'avif', ico: 'ico', woff2: 'woff2', woff: 'woff',
    // Compiled WebAssembly: how C++ actually runs on a page.
    wasm: 'wasm'
  };
  var TYPES = {};
  Object.keys(TEXT_TYPES).forEach(function (k) { TYPES[k] = TEXT_TYPES[k]; });
  Object.keys(BINARY_TYPES).forEach(function (k) { TYPES[k] = BINARY_TYPES[k]; });

  // Which highlighter a file opens with.
  var MODE_FOR = {
    html: 'html', svg: 'html', css: 'css', js: 'js', json: 'js',
    cpp: 'cpp', txt: 'text', md: 'text'
  };

  var MIME = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    // Served as plain text so a browser shows the source instead of saving it.
    cpp: 'text/plain; charset=utf-8',
    // The exact type WebAssembly.instantiateStreaming insists on.
    wasm: 'application/wasm',
    png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', ico: 'image/x-icon',
    woff2: 'font/woff2', woff: 'font/woff'
  };

  // A path may sit in folders, so a PWA can keep its icons in one.
  var SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]*';
  var FILE_NAME = new RegExp(
    '^(?:' + SEGMENT + '\\/){0,3}' + SEGMENT + '\\.(?:' + Object.keys(TYPES).join('|') + ')$'
  );

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fileType(name) {
    var ext = String(name).split('.').pop().toLowerCase();
    return TYPES[ext] || null;
  }

  function isValidName(name) {
    var text = String(name);
    if (text.length > 120) return false;
    if (text.indexOf('..') !== -1) return false;
    return FILE_NAME.test(text);
  }

  function isBinary(name) {
    var ext = String(name).split('.').pop().toLowerCase();
    return Object.prototype.hasOwnProperty.call(BINARY_TYPES, ext);
  }

  function isText(name) {
    var ext = String(name).split('.').pop().toLowerCase();
    return Object.prototype.hasOwnProperty.call(TEXT_TYPES, ext);
  }

  /** The highlighter a file opens with; plain text for .txt and .md. */
  function editorMode(name) {
    return MODE_FOR[fileType(name)] || 'text';
  }

  function contentType(name) {
    return MIME[fileType(name)] || 'application/octet-stream';
  }

  /** Turns a human name into a URL-safe slug. Always returns something usable. */
  function slugify(name) {
    var s = String(name || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '');
    return s || 'page';
  }

  /** A file name built from a human name, keeping or adding the extension. */
  function fileNameFor(label, type) {
    var base = String(label || '').replace(/\.(html|css|js)$/i, '');
    return slugify(base) + '.' + (type || 'html');
  }

  function isFileObject(value) {
    return Boolean(value) && typeof value === 'object' && typeof value.name === 'string';
  }

  function find(files, name) {
    for (var i = 0; i < files.length; i += 1) {
      if (files[i].name === name) return files[i];
    }
    return null;
  }

  function byType(files, type) {
    return files.filter(function (file) { return fileType(file.name) === type; });
  }

  function styleTag(css) {
    return '<style>\n' + css + '\n</style>';
  }

  function scriptTag(js) {
    // </script> inside the user's JS would close our tag early.
    return '<script>\n' + String(js).replace(/<\/script>/gi, '<\\/script>') + '\n<\/script>';
  }

  function injectBefore(doc, tag, payload) {
    var re = new RegExp('</' + tag + '\\s*>', 'i');
    if (re.test(doc)) return doc.replace(re, payload + '\n</' + tag + '>');
    return doc + '\n' + payload;
  }

  /**
   * Builds the document for one HTML file.
   *
   * A fragment is wrapped in a page skeleton with every stylesheet and script
   * in the project linked for you. A full document (it has an <html> tag) is
   * left alone — you write your own <link> and <script> tags.
   *
   * @param {Array<{name: string, content: string}>} files
   * @param {string} name        which HTML file to build
   * @param {{head?: string, title?: string}} [options]
   */
  function composeFile(files, name, options) {
    options = options || {};
    var file = find(files, name);
    if (!file) return null;

    var html = file.content || '';
    var head = options.head || '';
    var title = options.title || name.replace(/\.html$/, '') || 'Untitled page';

    if (FULL_DOC.test(html)) {
      return head ? injectBefore(html, 'head', head) : html;
    }

    var linked = linkedInto(files);
    var links = linked.styles.map(function (sheet) {
      return '<link rel="stylesheet" href="' + escapeHtml(sheet.name) + '">';
    });
    var scripts = linked.scripts.map(function (script) {
      return '<script src="' + escapeHtml(script.name) + '"><\/script>';
    });

    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escapeHtml(title) + '</title>',
      head,
      links.join('\n'),
      '</head>',
      '<body>',
      html,
      scripts.join('\n'),
      '</body>',
      '</html>'
    ].filter(Boolean).join('\n');
  }

  /**
   * Replaces links to the project's own files with their contents, so a page
   * renders correctly with nothing served — used by the preview and by
   * Download.
   */
  function inlineLocal(doc, files) {
    var out = String(doc);

    out = out.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, function (tag, href) {
      if (!/stylesheet/i.test(tag)) return tag;
      var sheet = find(files, href);
      return sheet ? styleTag(sheet.content || '') : tag;
    });

    out = out.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, function (tag, src) {
      var script = find(files, src);
      return script ? scriptTag(script.content || '') : tag;
    });

    return out;
  }

  /** What the server sends for a given file. HTML is composed; the rest is raw. */
  function serveFile(files, name, options) {
    var file = find(files, name);
    if (!file) return null;
    if (fileType(name) === 'html') return composeFile(files, name, options);
    return file.content || '';
  }

  /** Files a fragment page links automatically: project stylesheets and scripts. */
  function linkedInto(files) {
    return {
      styles: files.filter(function (file) { return fileType(file.name) === 'css'; }),
      scripts: files.filter(function (file) { return fileType(file.name) === 'js'; })
    };
  }

  /** The HTML file a project opens on: index.html, else the first HTML file. */
  function entryOf(files) {
    if (find(files, ENTRY)) return ENTRY;
    var pages = byType(files, 'html');
    return pages.length ? pages[0].name : null;
  }

  var DEFAULTS = { html: ENTRY, css: 'styles.css', js: 'app.js' };

  /**
   * Accepts either the current shape (a files array) or the original
   * three-pane shape, so projects published before multi-file still load.
   */
  function toFiles(input) {
    if (Array.isArray(input)) return input.filter(isFileObject);
    // `files` may hold file objects, or just their names in stored metadata —
    // only the objects are the content.
    if (input && Array.isArray(input.files) && input.files.every(isFileObject)) {
      return input.files.slice();
    }
    if (input && Array.isArray(input.source) && input.source.every(isFileObject)) {
      return input.source.slice();
    }

    var source = (input && input.source) || input || {};
    var files = [];
    ['html', 'css', 'js'].forEach(function (type) {
      var content = source[type];
      if (content === undefined) return;
      // Anything present is carried through, even if it is the wrong type, so
      // validation can report it rather than silently dropping it.
      if (typeof content === 'string' && type !== 'html' && !content.trim()) return;
      files.push({ name: DEFAULTS[type], content: content });
    });
    if (!files.length) files.push({ name: ENTRY, content: '' });
    return files;
  }

  /**
   * Reads a stored project, whichever shape it was written in: flat
   * ({slug, version, source}) as the disk backend writes it, or nested
   * ({meta, source}) as the GitHub backend does. Both exist in the wild.
   */
  function readStored(raw) {
    if (!raw || typeof raw !== 'object') return { meta: {}, files: [] };
    var meta = (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : raw;
    var files = toFiles(raw.source !== undefined ? raw.source : raw);
    return { meta: meta, files: files };
  }

  /** The legacy three-pane composer, kept so old callers keep working. */
  function compose(parts) {
    parts = parts || {};
    var files = toFiles(parts);
    var doc = composeFile(files, ENTRY, { head: parts.head, title: parts.title });
    // The old shape inlined its CSS and JS rather than linking them.
    return inlineLocal(doc, files);
  }

  return {
    compose: compose,
    composeFile: composeFile,
    serveFile: serveFile,
    inlineLocal: inlineLocal,
    entryOf: entryOf,
    toFiles: toFiles,
    readStored: readStored,
    fileType: fileType,
    isValidName: isValidName,
    isBinary: isBinary,
    isText: isText,
    editorMode: editorMode,
    contentType: contentType,
    linkedInto: linkedInto,
    TEXT_TYPES: TEXT_TYPES,
    BINARY_TYPES: BINARY_TYPES,
    fileNameFor: fileNameFor,
    slugify: slugify,
    escapeHtml: escapeHtml,
    find: find,
    byType: byType,
    ENTRY: ENTRY,
    DEFAULTS: DEFAULTS
  };
});
