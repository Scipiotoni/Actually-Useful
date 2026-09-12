'use strict';

const { slugify } = require('../public/compose.js');

const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const ASSET_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml'
};

/**
 * Identifies an image by its actual bytes rather than by the name it was
 * uploaded under, so a renamed file cannot smuggle in another format.
 * @returns {string|null} the canonical extension
 */
function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const hex = buffer.subarray(0, 12);

  if (hex.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (hex[0] === 0xff && hex[1] === 0xd8 && hex[2] === 0xff) return 'jpg';
  if (hex.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (hex.subarray(0, 4).toString('latin1') === 'RIFF' && hex.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (hex.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'avif';
    return null;
  }

  // SVG is text; look past a BOM, whitespace, comments and the XML prolog.
  const head = buffer.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^<(\?xml|!--|!DOCTYPE svg|svg)[\s>]/i.test(head)) return 'svg';

  return null;
}

function contentType(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return TYPES[ext] || 'application/octet-stream';
}

/** Builds a safe, stable file name from what the browser reported. */
function assetName(original, extension) {
  const base = String(original || '').replace(/\.[^.]*$/, '');
  const slug = slugify(base).slice(0, 60) || 'image';
  return `${slug}.${extension}`;
}

/** Appends -2, -3 ... until the name is free. */
function nextFreeName(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = name.slice(0, dot);
  const ext = name.slice(dot);
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

/**
 * Turns an uploaded data: URL into bytes, refusing anything that is not one of
 * the image formats above.
 * @returns {{ok: true, buffer: Buffer, extension: string} | {ok: false, status: number, error: string}}
 */
function decodeUpload(dataUrl) {
  if (typeof dataUrl !== 'string') {
    return { ok: false, status: 400, error: '"data" must be a data: URL' };
  }
  const match = dataUrl.match(/^data:([^;,]*)?(;base64)?,(.*)$/s);
  if (!match || !match[2]) {
    return { ok: false, status: 400, error: 'Expected a base64 data: URL' };
  }

  let buffer;
  try {
    buffer = Buffer.from(match[3], 'base64');
  } catch {
    return { ok: false, status: 400, error: 'Could not decode the upload' };
  }
  if (!buffer.length) return { ok: false, status: 400, error: 'The file is empty' };
  if (buffer.length > MAX_ASSET_BYTES) {
    return { ok: false, status: 413, error: 'Images must be 5 MB or smaller' };
  }

  const extension = sniff(buffer);
  if (!extension) {
    return {
      ok: false,
      status: 415,
      error: 'Not a supported image. Use PNG, JPEG, GIF, WebP, AVIF or SVG.'
    };
  }
  return { ok: true, buffer, extension };
}

module.exports = {
  MAX_ASSET_BYTES,
  ASSET_NAME_RE,
  TYPES,
  sniff,
  contentType,
  assetName,
  nextFreeName,
  decodeUpload
};
