'use strict';

/**
 * Builds a single static page that talks to the Apps Script web app through
 * doPost (server/HttpApi.gs) instead of google.script.run. Host it anywhere
 * outside script.google.com so users signed in to several Google accounts are
 * not redirected to /macros/u/N/.
 *
 * Usage: node tools/build-static.js --api-url https://script.google.com/macros/s/<id>/exec [--out dist]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INCLUDE = /<\?!=\s*include_\('([^']+)'\)\s*\?>/g;
const INITIAL_DATA = /<script>window\.__INITIAL_DATA__ = <\?!= initialData \?>;<\/script>/;
const API_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

function buildStatic(apiUrl) {
  let html = fs.readFileSync(path.join(ROOT, 'client', 'Index.html'), 'utf8');
  html = html.replace(INCLUDE, (_, file) => fs.readFileSync(path.join(ROOT, file + '.html'), 'utf8'));
  if (!INITIAL_DATA.test(html)) throw new Error('initial data placeholder not found in client/Index.html');
  html = html.replace(INITIAL_DATA, () =>
    '<script>window.__INITIAL_DATA__ = null; window.__API_URL__ = ' + JSON.stringify(apiUrl).replace(/</g, '\\u003c') + ';</script>');
  html = html.replace('<head>', '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Mini Tasks</title>');
  if (/<\?/.test(html)) throw new Error('unresolved template tag left in output');
  return html;
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag) => (args.indexOf(flag) !== -1 ? args[args.indexOf(flag) + 1] : undefined);
  const apiUrl = value('--api-url') || process.env.API_URL;
  const outDir = path.resolve(ROOT, value('--out') || 'dist');
  if (!apiUrl || !API_URL_PATTERN.test(apiUrl)) {
    console.error('✗ --api-url must be the web app URL: https://script.google.com/macros/s/<id>/exec (without /u/N/)');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'index.html');
  fs.writeFileSync(file, buildStatic(apiUrl));
  console.log('✓ ' + path.relative(ROOT, file));
}

if (require.main === module) main();

module.exports = { buildStatic };
