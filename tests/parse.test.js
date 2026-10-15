/*
 * Offline tests for src/parse.js  ->  node tests/parse.test.js
 * No network. Fixtures mimic Instagram's SSR HTML shape.
 */
'use strict';

const assert = require('assert');
const IGX = require('../src/parse.js');

function mkItem(opts) {
  return {
    code: opts.code,
    pk: opts.pk,
    taken_at: opts.taken_at || 1700000000,
    media_type: opts.media_type,
    product_type: opts.product_type || null,
    caption: opts.caption != null ? { text: opts.caption } : null,
    user: { pk: '12345', username: opts.user || 'juli_aguirr', full_name: 'Juli' },
    like_count: opts.like_count != null ? opts.like_count : 10,
    comment_count: 2,
    image_versions2: { candidates: opts.images || [] },
    video_versions: opts.videos || [],
    carousel_media: opts.carousel || null
  };
}

function wrapBlob(key, items, escaped) {
  const obj = {};
  obj[key] = { items: items };
  let text = JSON.stringify(obj);
  if (escaped) {
    text = text.replace(/"/g, '&quot;').replace(/'/g, '&#0?39;');
  }
  return '<script type="application/json">' + text + '</script>';
}

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { console.error('  FAIL - ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

/* ---------- fixture 1: single image post ---------- */
const htmlImage = '<html><head>' +
  wrapBlob('xdt_api__v1__media__shortcode__web_info', [
    mkItem({
      code: 'ABC123', pk: '111', media_type: 1, user: 'juli_aguirr', caption: 'hola <mundo> & "amigos"',
      images: [
        { url: 'https://scontent.cdninstagram.com/v/small.jpg', width: 320, height: 320 },
        { url: 'https://scontent.cdninstagram.com/v/big.jpg', width: 1080, height: 1080 }
      ]
    })
  ]) + '</head><body></body></html>';

/* ---------- fixture 2: carousel with video, blob JSON-escaped ---------- */
const carousel = [
  { pk: '201', image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/c1.jpg', width: 1080, height: 1080 }] } },
  { pk: '202', video_versions: [{ url: 'https://scontent.cdninstagram.com/c2.mp4', width: 1080, height: 1920, type: 101 }] }
];
const htmlCarousel = '<html><head>' +
  wrapBlob('xdt_api__v1__media__info', [
    mkItem({
      code: 'CAR9', pk: '200', media_type: 8, product_type: 'carousel_container',
      user: 'otro_user', caption: 'multiple', images: [{ url: 'https://scontent.cdninstagram.com/cover.jpg', width: 1080, height: 1350 }],
      carousel: carousel
    })
  ], true) + '</head></html>';

/* ---------- fixture 3: additionalDataLoaded fallback ---------- */
const htmlExtra = '<html><head><script>' +
  'window.__additionalDataLoaded("extra", ' +
  JSON.stringify({ graphql: { shortcode_media: mkItem({ code: 'EXT1', pk: '300', media_type: 2, videos: [{ url: 'https://scontent.cdninstagram.com/extra.mp4', width: 720, height: 1280 }], images: [{ url: 'https://scontent.cdninstagram.com/th.jpg', width: 640, height: 640 }] }) } }) +
  ');</script></head></html>';

/* ---------- fixture 4: nothing usable ---------- */
const htmlEmpty = '<html><head><script type="application/json">{"a":{"b":1}}</script></head></html>';

console.log('parse.js tests');

ok('extrae imagen, elige la de mayor resolucion y decodifica caption', () => {
  const posts = IGX.findPosts(htmlImage, { code: 'ABC123' });
  assert.strictEqual(posts.length, 1);
  const p = posts[0];
  assert.strictEqual(p.shortcode, 'ABC123');
  assert.strictEqual(p.owner.username, 'juli_aguirr');
  assert.strictEqual(p.caption, 'hola <mundo> & "amigos"');
  assert.strictEqual(p.media.length, 1);
  assert.strictEqual(p.media[0].kind, 'image');
  assert.strictEqual(p.media[0].url, 'https://scontent.cdninstagram.com/v/big.jpg');
  assert.strictEqual(p.media[0].width, 1080);
  assert.strictEqual(p.url, 'https://www.instagram.com/p/ABC123/');
});

ok('carousel JSON-escapeado: 2 media, orden preservado, video tipo 2', () => {
  const posts = IGX.findPosts(htmlCarousel, { code: 'CAR9' });
  assert.strictEqual(posts.length, 1);
  const p = posts[0];
  assert.strictEqual(p.media_type, 8);
  assert.strictEqual(p.is_carousel, true);
  assert.strictEqual(p.media.length, 2);
  assert.strictEqual(p.media[0].url, 'https://scontent.cdninstagram.com/c1.jpg');
  assert.strictEqual(p.media[1].kind, 'video');
  assert.strictEqual(p.media[1].url, 'https://scontent.cdninstagram.com/c2.mp4');
  assert.strictEqual(p.caption, 'multiple');
});

ok('carousel: no promueve hijos a posts independientes', () => {
  const posts = IGX.findPosts(htmlCarousel, {});
  assert.strictEqual(posts.length, 1, 'esperaba 1 post, no los hijos del carrusel');
});

ok('fallback por window.__additionalDataLoaded', () => {
  const posts = IGX.findPosts(htmlExtra, { code: 'EXT1' });
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].shortcode, 'EXT1');
  assert.strictEqual(posts[0].media_type, 2);
  assert.strictEqual(posts[0].media[0].kind, 'video');
  assert.strictEqual(posts[0].media[0].url, 'https://scontent.cdninstagram.com/extra.mp4');
});

ok('pagina sin datos -> []', () => {
  assert.deepStrictEqual(IGX.findPosts(htmlEmpty, {}), []);
});

ok('diagnose informa conteos', () => {
  const d = IGX.diagnose(htmlImage);
  assert.strictEqual(d.jsonBlobs, 1);
  assert.strictEqual(d.webInfoItems, 1);
});

ok('taken_at_iso se calcula', () => {
  const p = IGX.findPosts(htmlImage, { code: 'ABC123' })[0];
  assert.strictEqual(p.taken_at_iso, new Date(1700000000 * 1000).toISOString());
});

console.log('\n' + passed + ' checks passed');
