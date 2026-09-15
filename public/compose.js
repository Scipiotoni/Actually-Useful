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
  var FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,59}\.(html|css|js)$/;
  var ENTRY = 'index.html';

  var TYPES = { html: 'html', css: 'css', js: 'js' };

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
    return FILE_NAME.test(String(name));
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

    var links = byType(files, 'css').map(function (sheet) {
      return '<link rel="stylesheet" href="' + escapeHtml(sheet.name) + '">';
    });
    var scripts = byType(files, 'js').map(function (script) {
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
    fileType: fileType,
    isValidName: isValidName,
    fileNameFor: fileNameFor,
    slugify: slugify,
    escapeHtml: escapeHtml,
    find: find,
    byType: byType,
    ENTRY: ENTRY,
    DEFAULTS: DEFAULTS
  };
});
