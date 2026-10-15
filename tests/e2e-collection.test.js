/*
 * E2E: collection/grid flow against MOCKED responses.
 *   node tests/e2e-collection.test.js
 *
 * Page: /juli_aguirr/saved/w/18001979710698013/ with 3 post links in the grid
 * AND the 3 post payloads already embedded (as if the page had loaded them).
 *
 * Expect: one JSON per on-screen post, no Instagram request from the extension,
 * and idempotence on re-run.
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

const CODES = ['ColAAA1', 'ColBBB2', 'ColCCC3'];

function postBlob(code) {
  const item = {
    code: code, pk: 'p' + code, taken_at: 1700000000, media_type: 1, product_type: null,
    caption: { text: 'de la coleccion w' }, user: { pk: '1', username: 'juli_aguirr', full_name: 'Juli' },
    like_count: 5, comment_count: 1,
    image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/' + code + '.jpg', width: 1080, height: 1080 }] },
    video_versions: [], carousel_media: null
  };
  return { 'xdt_api__v1__media__shortcode__web_info': { items: [item] } };
}

function gridHtml() {
  const links = CODES.map((c) => '<a href="/p/' + c + '/"><img src="https://scontent.cdninstagram.com/t.jpg"></a>').join('');
  const blobs = CODES.map((c) =>
    '<script type="application/json">' + JSON.stringify(postBlob(c)) + '</script>').join('');
  return '<!doctype html><html><head><title>saved</title>' + blobs +
    '</head><body><main role="main">' + links + '</main></body></html>';
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igx-col-prof-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: EXEC, headless: false, acceptDownloads: true,
    args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-extensions-except=' + EXT_DIR, '--load-extension=' + EXT_DIR]
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  const igRequests = [];
  await ctx.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    if (/instagram\.com/.test(url)) igRequests.push({ url: url, type: req.resourceType() });
    if (/instagram\.com\/juli_aguirr\/saved\/w\//.test(url)) return route.fulfill({ status: 200, contentType: 'text/html', body: gridHtml() });
    if (/cdninstagram\.com|fbcdn\.net/.test(url)) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('IMG') });
    return route.continue();
  });

  try {
    await page.goto('https://www.instagram.com/juli_aguirr/saved/w/18001979710698013/', { waitUntil: 'domcontentloaded' });
    let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/*' }))[0].id);
    await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'igx:toggle' }), tabId);
    await page.waitForFunction(() => {
      const h = document.getElementById('igx-panel-host');
      return h && h.shadowRoot && h.shadowRoot.querySelector('#igx-col');
    }, null, { timeout: 9000 });

    const btn = await page.evaluate(() => {
      const b = document.getElementById('igx-panel-host').shadowRoot.querySelector('#igx-col');
      return { display: getComputedStyle(b).display, text: b.textContent };
    });
    assert.notStrictEqual(btn.display, 'none', 'boton de coleccion oculto');

    const igBefore = igRequests.length;
    await page.locator('#igx-col').click();
    await page.waitForFunction(() => {
      const l = document.getElementById('igx-panel-host').shadowRoot.querySelector('#igx-log');
      return /Listo:|Nada nuevo|No hay nada/.test(l.textContent);
    }, null, { timeout: 60000 });

    const log = await page.evaluate(() => document.getElementById('igx-panel-host').shadowRoot.querySelector('#igx-log').textContent);

    // PASSIVITY: no extension-initiated Instagram requests during extraction.
    const extCalls = igRequests.slice(igBefore).filter((r) => r.type !== 'document');
    assert.strictEqual(extCalls.length, 0, 'requests a IG desde la extension: ' + JSON.stringify(extCalls));

    const dl = await sw.evaluate(async () => (await chrome.downloads.search({})).map((i) => ({ url: i.url, state: i.state })));
    const jsonDl = dl.filter((d) => String(d.url).startsWith('data:application/json'));
    const payloads = jsonDl.map((d) => JSON.parse(decodeURIComponent(String(d.url).replace(/^data:application\/json;charset=utf-8,/, ''))));
    const codes = payloads.map((p) => p.shortcode).sort();

    assert.ok(/Listo: 3\/3/.test(log), 'log inesperado: ' + log);
    assert.strictEqual(jsonDl.length, 3, 'esperaba 3 JSON, hubo ' + jsonDl.length);
    assert.deepStrictEqual(codes, CODES.slice().sort(), 'codigos extraidos: ' + codes.join(','));

    // idempotence: re-run does not re-download
    await page.locator('#igx-col').click();
    await page.waitForFunction(() => {
      const l = document.getElementById('igx-panel-host').shadowRoot.querySelector('#igx-log');
      return /Nada nuevo/.test(l.textContent);
    }, null, { timeout: 15000 });
    const dl2 = await sw.evaluate(async () => (await chrome.downloads.search({})).filter((i) => String(i.url).startsWith('data:application/json')).length);

    console.log('COLLECTION E2E OK');
    console.log(JSON.stringify({
      log: log,
      jsonDownloads: jsonDl.length,
      codes: codes,
      afterRerunJsonDownloads: dl2,
      idempotent: dl2 === jsonDl.length,
      extensionIgRequests: extCalls.length
    }, null, 2));
  } catch (e) {
    console.error('E2E COLECCION FALLO:', e.message);
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
  }
}

main();
