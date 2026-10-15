/*
 * IG Exporter - MAIN world bridge (runs inside Instagram's own page context).
 *
 * PASSIVE ONLY. This script never issues a network request. It only:
 *   1. reads the SSR hydration payload the page itself delivers
 *      (window.__additionalDataLoaded), and
 *   2. observes the JSON responses the page itself already fetches
 *      (window.fetch / XMLHttpRequest), cloning them for reading.
 *
 * Everything it captures is the data Instagram already sent to the browser.
 * Nothing here opens a connection, and no /api/ or GraphQL endpoint is called.
 */
(function () {
  'use strict';
  if (window.__igxMainLoaded) return;
  window.__igxMainLoaded = true;

  function isIg(url) {
    return /^https:\/\/([a-z0-9-]+\.)*instagram\.com\//i.test(String(url || ''));
  }

  // Cheap pre-filter: only forward payloads that actually describe media.
  function hasMedia(text) {
    return !!text && (text.indexOf('"image_versions2"') !== -1 ||
      text.indexOf('"video_versions"') !== -1 ||
      text.indexOf('"carousel_media"') !== -1);
  }

  function emit(obj) {
    try {
      window.postMessage({ __igx: true, dir: 'capture', payload: obj }, location.origin);
    } catch (e) { /* ignore */ }
  }

  function harvest(text, url) {
    if (!isIg(url) || !hasMedia(text)) return;
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return; }
    emit(obj);
  }

  // 1) SSR hydration payload the page hands to its own scripts.
  try {
    var orig = window.__additionalDataLoaded;
    window.__additionalDataLoaded = function (name, data) {
      try { if (data && typeof data === 'object') emit(data); } catch (e) { /* ignore */ }
      if (typeof orig === 'function') {
        try { return orig.apply(this, arguments); } catch (e) { /* ignore */ }
      }
    };
  } catch (e) { /* ignore */ }

  // 2) Observe the page's own fetch() calls; never start one of our own.
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        var args = arguments;
        var p = origFetch.apply(this, args);
        try {
          p.then(function (res) {
            try {
              var u = (res && res.url) || (args[0] && args[0].url) || String(args[0] || '');
              if (isIg(u) && res && typeof res.clone === 'function') {
                res.clone().text().then(function (t) { harvest(t, u); }).catch(function () {});
              }
            } catch (e) { /* ignore */ }
            return res;
          }).catch(function () { /* ignore */ });
        } catch (e) { /* ignore */ }
        return p;
      };
    }
  } catch (e) { /* ignore */ }

  // 3) Same for XMLHttpRequest.
  try {
    var XP = XMLHttpRequest.prototype;
    var oOpen = XP.open;
    var oSend = XP.send;
    XP.open = function (m, u) {
      try { this.__igxu = u; } catch (e) { /* ignore */ }
      return oOpen.apply(this, arguments);
    };
    XP.send = function () {
      var self = this;
      try {
        self.addEventListener('load', function () {
          try { harvest(self.responseText, self.__igxu); } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      return oSend.apply(this, arguments);
    };
  } catch (e) { /* ignore */ }
})();
