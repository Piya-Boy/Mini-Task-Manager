'use strict';

/**
 * Syntax-checks every client <script> block and the scripts concatenated in
 * Index.html include order, which catches duplicate top-level declarations.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'client', 'Index.html');
const SCRIPT_BLOCK = /<script>([\s\S]*?)<\/script>/g;

function scriptsOf(file) {
  const source = fs.readFileSync(file, 'utf8');
  return Array.from(source.matchAll(SCRIPT_BLOCK), (m) => m[1]);
}

let failed = false;
const includes = Array.from(fs.readFileSync(INDEX, 'utf8').matchAll(/include_\('([^']+)'\)/g), (m) => m[1]);
const combined = [];

includes.forEach((name) => {
  const file = path.join(ROOT, name + '.html');
  if (!fs.existsSync(file)) {
    console.error('✗ missing include: ' + name);
    failed = true;
    return;
  }
  scriptsOf(file).forEach((code, i) => {
    try {
      new vm.Script(code, { filename: name + '#' + i });
      combined.push(code);
    } catch (error) {
      console.error('✗ ' + name + ': ' + error.message);
      failed = true;
    }
  });
});

try {
  new vm.Script(combined.join('\n;\n'), { filename: 'combined-client.js' });
} catch (error) {
  console.error('✗ combined client scripts: ' + error.message);
  failed = true;
}

if (failed) process.exit(1);
console.log('✓ ' + includes.length + ' includes, ' + combined.length + ' script blocks parse');
