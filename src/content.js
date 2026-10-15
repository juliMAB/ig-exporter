/*
 * IG Exporter - content script (isolated world).
 *
 * PASSIVE ONLY. Reads what Instagram already rendered/sent in the current tab.
 * It never fetches a post URL and never contacts the Instagram API.
 *
 * Data sources, in order:
 *   1. JSON already embedded in the page (SSR <script type="application/json">).
 *   2. Payloads the page itself delivered, captured by the MAIN-world bridge
 *      (window.__additionalDataLoaded / its own fetch/XHR responses).
 *
 * Saving happens through chrome.* APIs only (downloads + storage.local).
 */
(function () {
  'use strict';
  if (window.__igxContentLoaded) return;
  window.__igxContentLoaded = true;

  var PREFIX = 'ig-exporter';
  var state = {
    busy: false,
    stop: false,
    posts: [],
    panel: null,
    visible: false,
    logEl: null,
    countEl: null
  };

  /* ---------- passive capture bus (MAIN world -> here) ---------- */

  var captures = [];      // payloads the page itself delivered
  var pending = {};       // URL -> waiter, for result waits on captured blobs
  var reqSeq = 0;

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__igx !== true || d.dir !== 'capture') return;
    captures.push(d.payload);
    if (captures.length > 40) captures.shift();
  });

  /* ---------- page detection ---------- */

  function postCodeFromPath() {
    var m = location.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[2] : null;
  }

  function isPostPage() { return !!postCodeFromPath(); }
  function isSavedPage() { return /\/saved\//.test(location.pathname); }
  function isProfilePage() {
    return /^\/[A-Za-z0-9_.]+\/?$/.test(location.pathname) && !isSavedPage();
  }

  function collectionKey() {
    var box = document.querySelector('main[role="main"]');
    var active = null;
    if (box) active = box.querySelector('a[aria-current="page"], a[href*="/saved/"] span');
    var id = null;
    if (active) {
      var a = active.closest ? active.closest('a') : null;
      if (a && a.href) {
        var m = a.href.match(/\/saved\/([^\/]+)\/(\d+)/);
        if (m) id = m[2];
      }
    }
    return id || (location.pathname.replace(/\/$/, '') || '/saved');
  }

  // Post links rendered in the current view (grid, profile, feed...).
  function collectCodesFromDom() {
    var seen = {};
    var out = [];
    var links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    for (var i = 0; i < links.length; i++) {
      var m = (links[i].getAttribute('href') || '').match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
      if (m && !seen[m[2]]) { seen[m[2]] = 1; out.push(m[2]); }
    }
    return out;
  }

  // The HTML the page currently holds (no request).
  function pageHtml() {
    try { return document.documentElement ? document.documentElement.innerHTML : ''; } catch (e) { return ''; }
  }

  // Parse what the page currently holds, filtered to one code when asked.
  // DOM blobs are parsed as HTML; captured payloads are parsed as objects.
  function postsFromPage(code) {
    var ctx = code ? { code: code, url: 'https://www.instagram.com/p/' + code + '/' } : {};
    var posts = [];
    try { posts = posts.concat(window.IGX.findPosts(pageHtml(), ctx)); } catch (e) { /* ignore */ }
    try { posts = posts.concat(window.IGX.findPostsInBlobs(captures, ctx)); } catch (e) { /* ignore */ }

    var seen = {};
    var out = [];
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i];
      if (code && p.shortcode !== code) continue;
      if (seen[p.shortcode]) continue;
      seen[p.shortcode] = 1;
      out.push(p);
    }
    return out;
  }

  /* ---------- storage helpers ---------- */

  function getDone(key) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(key, function (res) {
        var v = res && res[key];
        resolve(v && v.done ? v.done : {});
      });
    });
  }

  function setDone(key, done) {
    return new Promise(function (resolve) {
      var obj = {};
      obj[key] = { done: done, updated_at: new Date().toISOString() };
      chrome.storage.local.set(obj, function () { resolve(); });
    });
  }

  /* ---------- saving ---------- */

  function jsonName(post) {
    return window.IGXN.jsonName(PREFIX, post.owner && post.owner.username, post.shortcode);
  }

  function mediaName(post, i, kind, url) {
    return window.IGXN.mediaName(PREFIX, post.owner && post.owner.username, post.shortcode, i, post.media.length, kind, url);
  }

  function downloadUrl(url, filename) {
    return new Promise(function (resolve, reject) {
      var msg = { type: 'igx:download', url: url };
      if (filename) msg.filename = filename;
      chrome.runtime.sendMessage(msg, function (res) {
        var err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!res || !res.ok) return reject(new Error((res && res.error) || 'descarga fallida'));
        resolve(res.id);
      });
    });
  }

  function downloadJson(obj, filename) {
    var text = JSON.stringify(obj, null, 2);
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ type: 'igx:save-json', data: text, filename: filename }, function (res) {
        var err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!res || !res.ok) return reject(new Error((res && res.error) || 'guardado JSON fallido'));
        resolve(res.id);
      });
    });
  }

  async function savePost(post, saveMedia) {
    await downloadJson(post, jsonName(post));
    if (!saveMedia || !post.media || !post.media.length) return 0;
    var n = 0;
    for (var i = 0; i < post.media.length; i++) {
      var m = post.media[i];
      if (!m || !m.url) continue;
      try { await downloadUrl(m.url, mediaName(post, i, m.kind, m.url)); n++; } catch (e) { /* skip */ }
      await sleep(250);
    }
    return n;
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ---------- UI ---------- */

  function log(msg) {
    if (!state.logEl) return;
    var line = document.createElement('div');
    line.textContent = msg;
    state.logEl.appendChild(line);
    state.logEl.scrollTop = state.logEl.scrollHeight;
  }

  function setCount(text) {
    if (state.countEl) state.countEl.textContent = text;
  }

  function toggle(force) {
    if (!state.panel) {
      buildPanel();
      state.visible = true;
    } else {
      state.visible = force != null ? !!force : !state.visible;
    }
    state.panel.style.display = state.visible ? 'block' : 'none';
    if (state.visible) refreshButtons();
  }

  function refreshButtons() {
    if (!state.panel || !state.panel.shadowRoot) return;
    var sh = state.panel.shadowRoot;
    var btnPost = sh.querySelector('#igx-post');
    var btnCol = sh.querySelector('#igx-col');
    if (!btnPost || !btnCol) return;
    if (isPostPage()) {
      btnPost.style.display = 'inline-block';
      btnPost.textContent = 'Guardar esta publicacion';
    } else {
      btnPost.style.display = 'none';
    }
    if (isSavedPage() || isProfilePage()) {
      btnCol.style.display = 'inline-block';
      btnCol.textContent = 'Extraer lo que hay en pantalla';
    } else {
      btnCol.style.display = 'none';
    }
    setCount(isPostPage() ? 'Publicacion: ' + postCodeFromPath() : 'Coleccion: ' + collectionKey());
  }

  function buildPanel() {
    var host = document.createElement('div');
    host.id = 'igx-panel-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;right:18px;bottom:18px;display:block;';
    var sh = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;display:block}',
      '.box{width:320px;background:#141414;color:#eee;border:1px solid #3a3a3a;border-radius:12px;',
      'font:13px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5);overflow:hidden}',
      '.hd{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1c1c1c;',
      'border-bottom:1px solid #3a3a3a;font-weight:600}',
      '.hd button{background:none;border:0;color:#bbb;font-size:16px;cursor:pointer}',
      '.bd{padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.row{display:flex;gap:8px;flex-wrap:wrap}',
      'button.act{flex:1;padding:9px 10px;border-radius:8px;border:1px solid #444;background:#2a2a2a;color:#eee;',
      'cursor:pointer;font:inherit}',
      'button.act:hover{background:#333}',
      'button.act[disabled]{opacity:.5;cursor:default}',
      'label.chk{display:flex;gap:8px;align-items:center;cursor:pointer;color:#ccc}',
      '.count{color:#8ab4f8;font-size:12px}',
      '.log{max-height:150px;overflow:auto;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px;',
      'padding:8px;font:11px/1.5 ui-monospace,monospace;color:#9fd39f;white-space:pre-wrap;word-break:break-word}',
      '.hint{color:#888;font-size:11px}'
    ].join('');
    sh.appendChild(style);

    var box = document.createElement('div');
    box.className = 'box';
    box.innerHTML = [
      '<div class="hd"><span>IG Exporter</span><button id="igx-x" title="Cerrar">x</button></div>',
      '<div class="bd">',
      '<div class="count" id="igx-count">-</div>',
      '<div class="row"><button class="act" id="igx-post">Guardar esta publicacion</button></div>',
      '<div class="row"><button class="act" id="igx-col">Extraer lo que hay en pantalla</button></div>',
      '<label class="chk"><input type="checkbox" id="igx-media" checked> Descargar imagenes y videos</label>',
      '<div class="row"><button class="act" id="igx-stop" style="display:none">Detener</button></div>',
      '<div class="log" id="igx-log"></div>',
      '<div class="hint">100% pasivo: lee solo lo que la pagina ya muestra. Cero requests a Instagram.</div>',
      '</div>'
    ].join('');
    sh.appendChild(box);
    document.documentElement.appendChild(host);

    state.panel = host;
    state.logEl = sh.querySelector('#igx-log');
    state.countEl = sh.querySelector('#igx-count');

    sh.querySelector('#igx-x').addEventListener('click', function () { toggle(false); });
    sh.querySelector('#igx-post').addEventListener('click', onSavePost);
    sh.querySelector('#igx-col').addEventListener('click', onExtractCollection);
    sh.querySelector('#igx-stop').addEventListener('click', function () {
      state.stop = true;
      log('Deteniendo...');
    });

    refreshButtons();
  }

  function setBusy(busy) {
    state.busy = busy;
    if (!state.panel) return;
    var sh = state.panel.shadowRoot;
    var buttons = sh.querySelectorAll('button.act');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].id === 'igx-stop') continue;
      buttons[i].disabled = busy;
    }
    sh.querySelector('#igx-stop').style.display = busy ? 'inline-block' : 'none';
  }

  /* ---------- actions ---------- */

  async function onSavePost() {
    if (state.busy) return;
    var code = postCodeFromPath();
    if (!code) { log('No estas en una publicacion.'); return; }
    setBusy(true);
    log('Leyendo ' + code + ' desde la pagina (sin requests)...');
    try {
      await sleep(600); // let an in-flight page payload land
      var posts = postsFromPage(code);
      if (!posts.length) {
        var d = window.IGX.diagnose(pageHtml());
        d.captured = captures.length;
        log('Sin datos en la pagina. Diagnostico: ' + JSON.stringify(d));
        log('Tip: abri la publicacion y espera a que cargue del todo, luego reintenta.');
      } else {
        var post = posts[0];
        state.posts = posts;
        var saveMedia = state.panel.shadowRoot.querySelector('#igx-media').checked;
        log('OK: @' + (post.owner && post.owner.username) + ' | ' + post.media.length + ' media(s)');
        var n = await savePost(post, saveMedia);
        log('Datos guardados (JSON)' + (saveMedia ? ' + medios: ' + n : '') + '.');
      }
    } catch (e) {
      log('Error: ' + e.message);
    }
    setBusy(false);
  }

  async function onExtractCollection() {
    if (state.busy) return;
    setBusy(true);
    state.stop = false;
    var saveMedia = state.panel.shadowRoot.querySelector('#igx-media').checked;
    var key = 'igx:queue:' + collectionKey();
    var done = await getDone(key);

    var codes = collectCodesFromDom();
    // Whatever the page already describes, even without a visible link.
    var ready = postsFromPage(null);
    var found = {};
    for (var r = 0; r < ready.length; r++) found[ready[r].shortcode] = ready[r];

    var targets = {};
    for (var i = 0; i < codes.length; i++) targets[codes[i]] = true;
    for (var c in found) if (found.hasOwnProperty(c)) targets[c] = true;
    var all = Object.keys(targets);
    var queue = [];
    for (var q = 0; q < all.length; q++) if (!done[all[q]]) queue.push(all[q]);

    if (!all.length) {
      log('No hay nada en pantalla todavia. Scrolleá la grilla y reintentá.');
      setBusy(false);
      return;
    }
    log('En pantalla: ' + all.length + ' | pendientes: ' + queue.length + '.');
    if (!queue.length) { log('Nada nuevo. Todo ya estaba guardado.'); setBusy(false); return; }

    var ok = 0;
    for (var j = 0; j < queue.length; j++) {
      if (state.stop) break;
      var code = queue[j];
      var post = found[code];
      if (!post) {
        var list = postsFromPage(code);
        post = list[0];
      }
      if (!post) { log('[' + (j + 1) + '/' + queue.length + '] ' + code + ': sin datos cargados'); continue; }
      log('[' + (j + 1) + '/' + queue.length + '] ' + code);
      try {
        await savePost(post, saveMedia);
        done[code] = true;
        await setDone(key, done);
        ok++;
      } catch (e) {
        log('  error: ' + e.message);
      }
      await sleep(300);
    }
    log('Listo: ' + ok + '/' + queue.length + ' guardadas.');
    if (ok < queue.length && !state.stop) {
      log('Scrolleá mas abajo y volvé a apretar para traer el resto.');
    }
    setBusy(false);
  }

  /* ---------- wiring ---------- */

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'igx:toggle') toggle();
  });

  var lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (state.panel && state.panel.style.display !== 'none') refreshButtons();
    }
  }, 1200);
})();
