'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildStatic } = require('../tools/build-static');

const API_URL = 'https://script.google.com/macros/s/AKfycbTEST_id-123/exec';

test('static build inlines every include and wires the fetch transport', () => {
  const html = buildStatic(API_URL);
  assert.doesNotMatch(html, /<\?/);
  assert.match(html, /<title>Mini Tasks<\/title>/);
  assert.match(html, /name="viewport"/);
  assert.ok(html.includes('window.__INITIAL_DATA__ = null; window.__API_URL__ = ' + JSON.stringify(API_URL) + ';'));
  assert.match(html, /id="task-modal"/);
  assert.match(html, /const Api = /);
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (m) => m[1]);
  assert.doesNotThrow(() => new vm.Script(scripts.join('\n;\n')));
});

test('static build escapes the API URL so it cannot close the script tag', () => {
  const html = buildStatic('x</script><script>alert(1)</script>');
  assert.doesNotMatch(html, /<\/script><script>alert/);
});
