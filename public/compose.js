/**
 * Builds a single standalone HTML document out of the three editor panes.
 * Shared verbatim by the browser (live preview) and the server (deploy),
 * so what you preview is byte-for-byte what gets published.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Compose = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var FULL_DOC = /<html[\s>]/i;

  function styleTag(css) {
    return '<style>\n' + css + '\n</style>';
  }

  function scriptTag(js) {
    // </script> inside the user's JS would close our tag early.
    return '<script>\n' + js.replace(/<\/script>/gi, '<\\/script>') + '\n<\/script>';
  }

  function injectBefore(doc, tag, payload) {
    var re = new RegExp('</' + tag + '\\s*>', 'i');
    if (re.test(doc)) return doc.replace(re, payload + '\n</' + tag + '>');
    return doc + '\n' + payload;
  }

  /**
   * @param {{html?: string, css?: string, js?: string, title?: string, head?: string}} parts
   * @returns {string} a complete HTML document
   */
  function compose(parts) {
    var html = (parts && parts.html) || '';
    var css = (parts && parts.css) || '';
    var js = (parts && parts.js) || '';
    var head = (parts && parts.head) || '';
    var title = (parts && parts.title) || 'Untitled page';

    if (FULL_DOC.test(html)) {
      var doc = html;
      if (head) doc = injectBefore(doc, 'head', head);
      if (css.trim()) doc = injectBefore(doc, 'head', styleTag(css));
      if (js.trim()) doc = injectBefore(doc, 'body', scriptTag(js));
      return doc;
    }

    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escapeHtml(title) + '</title>',
      head,
      css.trim() ? styleTag(css) : '',
      '</head>',
      '<body>',
      html,
      js.trim() ? scriptTag(js) : '',
      '</body>',
      '</html>'
    ].filter(Boolean).join('\n');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  return { compose: compose, slugify: slugify, escapeHtml: escapeHtml };
});
