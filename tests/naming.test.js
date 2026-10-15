/*
 * Offline tests for src/naming.js  ->  node tests/naming.test.js
 */
'use strict';

const assert = require('assert');
const N = require('../src/naming.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { console.error('  FAIL - ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

console.log('naming.js tests');

ok('jsonName arma ruta por usuario y codigo', () => {
  assert.strictEqual(N.jsonName('ig-exporter', 'juli_aguirr', 'ABC123'), 'ig-exporter/juli_aguirr/ABC123.json');
});

ok('sanitiza caracteres peligrosos del usuario', () => {
  assert.strictEqual(N.jsonName('ig-exporter', 'a/../b', 'C1'), 'ig-exporter/a_.._b/C1.json');
});

ok('sin usuario usa fallback', () => {
  assert.strictEqual(N.jsonName('ig-exporter', '', 'C1'), 'ig-exporter/cuenta/C1.json');
});

ok('mediaName agrega sufijo solo en carrusel', () => {
  assert.strictEqual(
    N.mediaName('ig-exporter', 'u', 'C1', 0, 3, 'image', 'https://x/a.jpg'),
    'ig-exporter/u/C1_1.jpg');
  assert.strictEqual(
    N.mediaName('ig-exporter', 'u', 'C1', 0, 1, 'image', 'https://x/a.jpg'),
    'ig-exporter/u/C1.jpg');
});

ok('extension por tipo y url', () => {
  assert.strictEqual(N.extFor('video', 'https://x/a.mp4'), 'mp4');
  assert.strictEqual(N.extFor('image', 'https://x/a.JPEG?x=1'), 'jpg');
  assert.strictEqual(N.extFor('image', 'https://x/noext'), 'jpg');
});

ok('recorta nombres muy largos', () => {
  const n = N.jsonName('ig-exporter', 'x'.repeat(200), 'C1');
  assert.ok(n.length < 120, 'nombre demasiado largo: ' + n.length);
});

console.log('\n' + passed + ' checks passed');
