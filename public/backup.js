/*
 * Backup files: the editor's project and learning progress in one JSON file,
 * so work can be kept (and moved to another browser) without any server.
 * Shared by the editor, Learn mode and the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Backup = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'actually-useful-backup';
  var VERSION = 1;
  // Where each part lives in the browser (the editor and Learn share an origin).
  var KEYS = { editor: 'actually-useful:draft:v1', learn: 'au-learn-progress-v1' };

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** A backup document from the parts that exist (either may be missing). */
  function create(parts, now) {
    var at = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now);
    return {
      format: FORMAT,
      version: VERSION,
      createdAt: at.toISOString(),
      editor: isObject(parts && parts.editor) ? parts.editor : null,
      learn: isObject(parts && parts.learn) ? parts.learn : null
    };
  }

  function fileName(now) {
    var d = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now);
    return 'actually-useful-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
  }

  /**
   * Reads a backup file's text. Also accepts the progress-only files that
   * Learn mode exported before backups existed.
   * @returns {{editor: object|null, learn: object|null, createdAt: string}}
   */
  function parse(text) {
    var data;
    try {
      data = JSON.parse(String(text));
    } catch (e) {
      throw new Error('That file is not a backup (it is not JSON).');
    }
    if (!isObject(data)) throw new Error('That file is not a backup.');

    if (data.format === FORMAT) {
      if (Number(data.version) > VERSION) {
        throw new Error('This backup was made by a newer version of the app. Update the app, then restore it.');
      }
      var editor = isObject(data.editor) ? data.editor : null;
      var learn = isObject(data.learn) ? data.learn : null;
      if (editor && !Array.isArray(editor.files) && typeof editor.html !== 'string') {
        throw new Error('The project in this backup is damaged.');
      }
      if (!editor && !learn) throw new Error('This backup is empty.');
      return { editor: editor, learn: learn, createdAt: String(data.createdAt || '') };
    }

    // Older Learn export: {progress: {...}}, or the progress object itself.
    var progress = isObject(data.progress) ? data.progress : (isObject(data.items) ? data : null);
    if (progress) return { editor: null, learn: progress, createdAt: '' };
    throw new Error('That file is not an Actually Useful backup.');
  }

  /** Everything this browser holds, as a backup document. */
  function collect(storage, now) {
    var read = function (key) {
      try {
        var raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    };
    return create({ editor: read(KEYS.editor), learn: read(KEYS.learn) }, now);
  }

  /** Hands the browser a file to save. */
  function download(doc, name) {
    var blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name || fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  /** What a backup holds, in words, for confirmations and messages. */
  function describe(parsed) {
    var parts = [];
    if (parsed.editor) {
      var files = Array.isArray(parsed.editor.files) ? parsed.editor.files.length : 1;
      parts.push('the project "' + (parsed.editor.name || 'Untitled page') + '" (' + files + (files === 1 ? ' file' : ' files') + ')');
    }
    if (parsed.learn) {
      var items = isObject(parsed.learn.items) ? Object.keys(parsed.learn.items).length : 0;
      parts.push('learning progress (' + items + (items === 1 ? ' item' : ' items') + ')');
    }
    return parts.join(' and ');
  }

  return {
    FORMAT: FORMAT,
    VERSION: VERSION,
    KEYS: KEYS,
    create: create,
    parse: parse,
    collect: collect,
    download: download,
    describe: describe,
    fileName: fileName
  };
}));
