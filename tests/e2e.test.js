/*
 * E2E: load the MV3 extension in real Chromium and run the full flow against
 * MOCKED instagram.com responses (no real Instagram traffic).
 *
 *   node tests/e2e.test.js
 *
 * Verifies:
 *   - the extension loads (background SW + MAIN-world bridge + content script)
 *   - clicking the toolbar action opens the in-page panel
 *   - "Guardar esta publicacion" reads the data straight from the rendered page
 *   - it writes JSON + media via chrome.downloads
 *   - PASSIVITY: the extension issues NO request of its own to Instagram
 *     (only the page's own document load appears in the request log).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright-core');

const EXT_DIR = path.resolve(__dirname, '..');
const EXEC = process.env.CHROME_PATH ||
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');

const CODE = 'E2Ecode1';
const MOCK_MEDIA = Buffer.from('FAKEIMAGEBYTES');

function mockPostHtml() {
  const item = {
    code: CODE,
    pk: '999001',
    taken_at: 1700000000,
    media_type: 8,
    product_type: 'carousel_container',
    caption: { text: 'post de prueba e2e' },
    user: { pk: '1', username: 'juli_aguirr', full_name: 'Juli' },
    like_count: 42,
    comment_count: 7,
    image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/cover.jpg', width: 1080, height: 1350 }] },
    video_versions: [],
    carousel_media: [
      { pk: '9a', image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/m1.jpg', width: 1080, height: 1080 }] } },
      { pk: '9b', video_versions: [{ url: 'https://scontent.cdninstagram.com/m2.mp4', width: 1080, height: 1920, type: 101 }] }
    ]
  };
  const blob = { 'xdt_api__v1__media__shortcode__web_info': { items: [item] } };
  return '<!doctype html><html><head><meta charset="utf-8"><title>IG</title>' +
    '<script type="application/json">' + JSON.stringify(blob) + '</script>' +
    '</head><body><h1>mock</h1></body></html>';
}

async function main() {
  assert.ok(fs.existsSync(EXEC), 'chromium no encontrado: ' + EXEC);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igx-profile-'));
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igx-dl-'));

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: EXEC,
    headless: false,
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions-except=' + EXT_DIR,
      '--load-extension=' + EXT_DIR
    ]
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e && e.message)));

  // Request log: to prove the extension stays passive, we record every request
  // the browser makes and later assert none of them is an extension-initiated
  // Instagram call (only the top-level document navigation is allowed).
  const igRequests = [];

  await ctx.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    if (/instagram\.com/.test(url)) igRequests.push({ url: url, type: req.resourceType(), initiator: req.frame() ? 'frame' : 'other' });
    if (/instagram\.com\/p\//.test(url)) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: mockPostHtml() });
    }
    if (/cdninstagram\.com|fbcdn\.net/.test(url)) {
      const isVideo = /\.mp4/.test(url);
      return route.fulfill({
        status: 200,
        contentType: isVideo ? 'video/mp4' : 'image/jpeg',
        body: MOCK_MEDIA
      });
    }
    return route.continue();
  });

  let result = { steps: [] };
  try {
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    result.extId = extId;
    result.steps.push('service worker: ' + sw.url());

    await page.goto('https://www.instagram.com/p/' + CODE + '/', { waitUntil: 'domcontentloaded' });

    const main = await page.evaluate(() => ({
      bridge: typeof window.__igxMainLoaded !== 'undefined',
      igx: typeof window.IGX !== 'undefined',
      posts: (window.IGX ? window.IGX.findPosts(document.documentElement.innerHTML, { code: 'E2Ecode1' }) : []).length
    }));
    assert.ok(main.bridge, 'MAIN-world bridge no inyectada');
    assert.ok(main.igx, 'parser IGX no inyectado');
    assert.strictEqual(main.posts, 1, 'parser no encontro el post mock');
    result.steps.push('bridge + parser OK (posts=' + main.posts + ')');

    const tabId = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
      return tabs.length ? tabs[0].id : null;
    });
    assert.ok(tabId != null, 'no hay tab de instagram');
    await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'igx:toggle' }), tabId);
    await page.waitForSelector('#igx-panel-host', { state: 'attached', timeout: 8000 });
    await page.waitForFunction(() => {
      const h = document.getElementById('igx-panel-host');
      return h && h.shadowRoot && h.shadowRoot.querySelector('#igx-post');
    }, null, { timeout: 8000 });
    result.steps.push('panel abierto');

    const igBefore = igRequests.length;

    await page.locator('#igx-post').click();

    await page.waitForFunction(() => {
      const h = document.getElementById('igx-panel-host');
      const log = h && h.shadowRoot.querySelector('#igx-log');
      return log && /Datos guardados|Error:|Sin datos/.test(log.textContent);
    }, null, { timeout: 25000 });

    const logText = await page.evaluate(() => {
      const h = document.getElementById('igx-panel-host');
      return h.shadowRoot.querySelector('#igx-log').textContent;
    });
    assert.ok(/OK:/.test(logText), 'log sin OK: ' + logText);
    assert.ok(/Datos guardados/.test(logText), 'log sin confirmacion de guardado: ' + logText);
    result.log = logText;
    result.steps.push('extraccion desde el DOM OK');

    // PASSIVITY CHECK: after the click, the extension must not have added a
    // single Instagram request (a fetch/xhr) of its own.
    const igAfter = igRequests.length;
    const added = igRequests.slice(igBefore);
    const extCalls = added.filter((r) => r.type !== 'document');
    result.igRequestsTotal = igAfter;
    result.igRequestsAddedByExtension = extCalls.length;
    assert.strictEqual(extCalls.length, 0,
      'la extension disparo requests a Instagram: ' + JSON.stringify(extCalls));
    result.steps.push('pasividad verificada: 0 requests a IG desde la extension');

    await page.waitForTimeout(2500);
    const dl = await sw.evaluate(async () => {
      const items = await chrome.downloads.search({});
      return items.map((i) => ({ url: i.url, state: i.state, error: i.error, bytes: i.bytesReceived }));
    });
    const jsonDl = dl.filter((d) => String(d.url).startsWith('data:application/json'));
    const mediaDl = dl.filter((d) => /^https:\/\/[^/]*cdninstagram\.com/.test(String(d.url)));
    console.log('DL URLs:', JSON.stringify(dl.map((d) => [String(d.url).slice(0, 70), d.state])));
    assert.strictEqual(jsonDl.length, 1, 'esperaba 1 JSON, hubo ' + jsonDl.length);
    assert.strictEqual(jsonDl[0].state, 'complete', 'JSON no completo: ' + jsonDl[0].error);
    assert.ok(jsonDl[0].bytes > 0, 'JSON vacio');
    assert.strictEqual(mediaDl.length, 2, 'esperaba 2 medios, hubo ' + mediaDl.length);

    const payload = JSON.parse(decodeURIComponent(jsonDl[0].url.replace(/^data:application\/json;charset=utf-8,/, '')));
    assert.strictEqual(payload.shortcode, CODE);
    assert.strictEqual(payload.owner.username, 'juli_aguirr');
    assert.strictEqual(payload.media.length, 2);
    result.record = { shortcode: payload.shortcode, user: payload.owner.username, media: payload.media.length, caption: payload.caption };
    result.steps.push('descargas: 1 JSON + 2 medios, JSON una sola vez');

    console.log('E2E OK');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('E2E FALLO:', e.message);
    if (errors.length) console.error('errores de pagina:', errors.slice(0, 10));
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
  }
}

main();
