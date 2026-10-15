/*
 * IG Exporter - local file naming (pure functions, no DOM, no network).
 * Classic script in the browser (attaches to globalThis.IGXN) and a CommonJS
 * module for offline tests.
 */
(function (root) {
  'use strict';

  function sanitize(s, fallback) {
    var v = String(s == null ? '' : s).replace(/[^A-Za-z0-9_.@-]+/g, '_').replace(/^_+|_+$/g, '');
    if (v.length > 80) v = v.slice(0, 80);
    return v || (fallback || 'sin_nombre');
  }

  function cleanUser(u) { return sanitize(u, 'cuenta'); }
  function cleanCode(c) { return sanitize(c, 'post'); }

  function jsonName(prefix, user, code) {
    return prefix + '/' + cleanUser(user) + '/' + cleanCode(code) + '.json';
  }

  function extFor(kind, url) {
    if (kind === 'video') return 'mp4';
    var m = String(url || '').split('?')[0].match(/\.(jpg|jpeg|png|webp|heic)$/i);
    if (!m) return 'jpg';
    var e = m[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
  }

  function mediaName(prefix, user, code, index, total, kind, url) {
    var suffix = total > 1 ? '_' + (index + 1) : '';
    return prefix + '/' + cleanUser(user) + '/' + cleanCode(code) + suffix + '.' + extFor(kind, url);
  }

  var api = { sanitize: sanitize, jsonName: jsonName, mediaName: mediaName, extFor: extFor };
  root.IGXN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
