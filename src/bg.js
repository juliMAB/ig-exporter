/*
 * IG Exporter - service worker.
 * Three jobs only:
 *   1. Toolbar click -> toggle the in-page panel on an Instagram tab.
 *   2. Media downloads, restricted to an explicit CDN host allowlist.
 *   3. JSON (data) downloads, restricted to a sanitized export path.
 * No Instagram API traffic originates here.
 */
'use strict';

var CDN_ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net)\//i;
var EXPORT_NAME = /^ig-exporter\/[A-Za-z0-9_@-]+(\/[A-Za-z0-9_.@-]+)*\.json$/;

function safeExportName(name) {
  if (typeof name !== 'string' || !EXPORT_NAME.test(name)) return null;
  if (/(^|\/)\.\.(\/|$)/.test(name)) return null;
  return name;
}

chrome.action.onClicked.addListener(function (tab) {
  var isIg = tab && tab.url && /^https:\/\/(www\.)?instagram\.com\//.test(tab.url);
  if (isIg && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'igx:toggle' }, function () {
      void chrome.runtime.lastError;
    });
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
});

function startDownload(opts, sendResponse) {
  chrome.downloads.download(opts, function (id) {
    var err = chrome.runtime.lastError;
    if (err) sendResponse({ ok: false, error: err.message });
    else sendResponse({ ok: true, id: id });
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;

  if (msg.type === 'igx:download') {
    if (!CDN_ALLOWED.test(msg.url || '')) {
      sendResponse({ ok: false, error: 'host de descarga no permitido' });
      return;
    }
    var opts = { url: msg.url, conflictAction: 'uniquify', saveAs: false };
    if (typeof msg.filename === 'string' && msg.filename) opts.filename = msg.filename;
    startDownload(opts, sendResponse);
    return true;
  }

  if (msg.type === 'igx:save-json') {
    if (typeof msg.data !== 'string' || !msg.data) {
      sendResponse({ ok: false, error: 'json vacio' });
      return;
    }
    var name = safeExportName(msg.filename);
    if (!name) {
      sendResponse({ ok: false, error: 'nombre de export invalido' });
      return;
    }
    var url = 'data:application/json;charset=utf-8,' + encodeURIComponent(msg.data);
    startDownload({ url: url, filename: name, conflictAction: 'uniquify', saveAs: false }, sendResponse);
    return true;
  }
});
