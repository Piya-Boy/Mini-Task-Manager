'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, PUSH_ORDER } = require('./gas-harness');
const { solidPng } = require('./png');

const PNG = solidPng(4, 4, [79, 70, 229]).toString('base64');
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString('base64');
const WEBP_HEADER = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]).toString('base64');

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.data;
}

function err(result, code) {
  assert.equal(result.ok, false, 'expected failure');
  if (code) assert.equal(result.error.code, code, result.error.message);
  return result.error;
}

function setup() {
  const gas = createGas();
  const create = (fields, requestId) =>
    ok(gas.run('apiCreateTask', Object.assign({ title: 'Task', status: 'todo', priority: '' }, fields), requestId)).task;
  const tasksSheet = () => gas.state.spreadsheets.get(gas.resourceId('SPREADSHEET_ID')).getSheetByName('Tasks');
  return { gas, create, tasksSheet };
}

test('loads in any file order (no cross-file globals at load time)', () => {
  const reversed = PUSH_ORDER.slice().reverse();
  const gas = createGas({ order: reversed });
  assert.deepEqual(ok(gas.run('apiListTasks')), { tasks: [] });
});

test('without configured IDs, first call creates spreadsheet and folder and stores their IDs', () => {
  const gas = createGas({ resourceIds: { SPREADSHEET_ID: '', IMAGE_FOLDER_ID: '' } });
  ok(gas.run('apiListTasks'));
  const ss = gas.state.spreadsheets.get(gas.state.properties.get('SPREADSHEET_ID'));
  assert.deepEqual(ss.getSheets().map((s) => s.getName()), ['Tasks', 'Images', 'Links']);
  assert.ok(gas.state.folders.get(gas.state.properties.get('IMAGE_FOLDER_ID')));
});

test('configured IDs in CONFIG are used and nothing new is created', () => {
  const { gas, create } = setup();
  const ssId = gas.eval('CONFIG.RESOURCE_IDS.SPREADSHEET_ID');
  const folderId = gas.eval('CONFIG.RESOURCE_IDS.IMAGE_FOLDER_ID');
  assert.ok(ssId && folderId, 'CONFIG.RESOURCE_IDS should be filled');

  const task = create({ title: 'uses existing' });
  ok(gas.run('apiUploadImage', task.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG }));

  assert.equal(gas.state.spreadsheets.size, 1);
  assert.equal(gas.state.folders.size, 1);
  assert.equal(gas.state.properties.size, 0);
  const sheetNames = gas.state.spreadsheets.get(ssId).getSheets().map((s) => s.getName());
  assert.ok(sheetNames.includes('Tasks') && sheetNames.includes('Images'));
});

test('create validates input and returns a JSON-safe task', () => {
  const { gas, create } = setup();
  err(gas.run('apiCreateTask', { title: '   ', status: 'todo' }), 'VALIDATION');
  err(gas.run('apiCreateTask', { title: 'x', status: 'blocked' }), 'VALIDATION');
  err(gas.run('apiCreateTask', { title: 'x', status: 'todo', priority: 'urgent' }), 'VALIDATION');
  err(gas.run('apiCreateTask', { title: 'x'.repeat(201), status: 'todo' }), 'VALIDATION');
  err(gas.run('apiCreateTask', 'not an object'), 'VALIDATION');

  const task = create({ title: '  เปลี่ยนโคมไฟ  ', description: 'line1\r\nline2', priority: 'high' });
  assert.match(task.task_id, /^t_[0-9a-f-]{36}$/);
  assert.equal(task.title, 'เปลี่ยนโคมไฟ');
  assert.equal(task.description, 'line1\nline2');
  assert.equal(typeof task.updated_at, 'number');
  assert.deepEqual(task.images, []);
  assert.deepEqual(Object.keys(task).sort(),
    ['created_at', 'description', 'images', 'links', 'position', 'priority', 'status', 'task_id', 'title', 'updated_at']);
});

test('user text that looks like a formula is stored as text', () => {
  const { gas, create } = setup();
  create({ title: '=1+1', description: '-bullet' });
  const [task] = ok(gas.run('apiListTasks')).tasks;
  assert.equal(task.title, '=1+1');
  assert.equal(task.description, '-bullet');
});

test('create with the same request id is idempotent', () => {
  const { gas, create } = setup();
  const a = create({ title: 'once' }, 'req-12345678');
  const b = create({ title: 'once' }, 'req-12345678');
  assert.equal(a.task_id, b.task_id);
  assert.equal(ok(gas.run('apiListTasks')).tasks.length, 1);
});

test('update detects concurrent edits through updated_at', () => {
  const { gas, create } = setup();
  const task = create({ title: 'a' });
  const input = { title: 'b', description: '', status: 'in_progress', priority: 'low' };
  const updated = ok(gas.run('apiUpdateTask', task.task_id, input, task.updated_at, [])).task;
  assert.equal(updated.title, 'b');
  assert.ok(updated.updated_at > task.updated_at);

  err(gas.run('apiUpdateTask', task.task_id, input, task.updated_at, []), 'CONFLICT');
  err(gas.run('apiUpdateTask', 't_00000000-0000-0000-0000-000000000000', input, null, []), 'NOT_FOUND');
});

test('move places tasks between neighbours and at column ends', () => {
  const { gas, create } = setup();
  const a = create({ title: 'a' });
  const b = create({ title: 'b' });
  const c = create({ title: 'c', status: 'done' });

  ok(gas.run('apiMoveTask', c.task_id, 'todo', b.task_id));
  let order = ok(gas.run('apiListTasks')).tasks.filter((t) => t.status === 'todo').map((t) => t.title);
  assert.deepEqual(order, ['a', 'c', 'b']);

  ok(gas.run('apiMoveTask', a.task_id, 'in_progress', null));
  const moved = ok(gas.run('apiListTasks')).tasks.find((t) => t.task_id === a.task_id);
  assert.equal(moved.status, 'in_progress');

  ok(gas.run('apiMoveTask', b.task_id, 'todo', c.task_id));
  order = ok(gas.run('apiListTasks')).tasks.filter((t) => t.status === 'todo').map((t) => t.title);
  assert.deepEqual(order, ['b', 'c']);

  err(gas.run('apiMoveTask', a.task_id, 'todo', a.task_id), 'VALIDATION');
  err(gas.run('apiMoveTask', a.task_id, 'archived', null), 'VALIDATION');
});

test('move renumbers a column when the gap is exhausted and returns every changed task', () => {
  const { gas, create, tasksSheet } = setup();
  const a = create({ title: 'a' });
  const b = create({ title: 'b' });
  const c = create({ title: 'c', status: 'done' });
  const sheet = tasksSheet();
  sheet.data[1][7] = 1;
  sheet.data[2][7] = 1 + 1e-7;

  const changed = ok(gas.run('apiMoveTask', c.task_id, 'todo', b.task_id)).tasks;
  assert.equal(changed.length, 3);
  const order = ok(gas.run('apiListTasks')).tasks.filter((t) => t.status === 'todo').map((t) => t.title);
  assert.deepEqual(order, ['a', 'c', 'b']);
  assert.ok(changed.every((t) => typeof t.updated_at === 'number'));
  assert.ok([a, b].every((t) => changed.some((x) => x.task_id === t.task_id)));
});

const b64 = (...parts) => Buffer.concat(parts.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x)))).toString('base64');
const PDF = b64('%PDF-1.7\n%', Buffer.alloc(32, 0x61));
const ZIP = b64(Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32, 1));
const OLE = b64(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(32, 2));
const GIF = b64('GIF89a', Buffer.alloc(16));

test('upload validates content, size and per-task limit', () => {
  const { gas, create } = setup();
  const task = create({ title: 'img' });
  const upload = (file) => gas.run('apiUploadImage', task.task_id, file);

  const image = ok(upload({ name: 'C:\\fakepath\\a.png', data: PNG })).image;
  assert.equal(image.file_name, 'a.png');
  assert.equal(image.mime_type, 'image/png');
  assert.match(image.image_id, /^i_/);
  assert.deepEqual(gas.state.files.get(image.drive_file_id).sharing, ['ANYONE_WITH_LINK', 'VIEW']);

  ok(upload({ name: 'b.jpg', data: JPEG_HEADER }));
  ok(upload({ name: 'c.webp', data: WEBP_HEADER }));
  err(upload({ name: 'x.gif', data: GIF }), 'VALIDATION');
  err(upload({ name: 'x.png', data: 'not base64!' }), 'VALIDATION');
  err(upload({ name: 'x.png', data: '' }), 'VALIDATION');
  err(upload({ name: 'x.png' }), 'VALIDATION');
  err(upload('nope'), 'VALIDATION');

  const big = Buffer.alloc(8 * 1024 * 1024 + 1);
  Buffer.from(PNG, 'base64').copy(big);
  err(upload({ name: 'big.png', data: big.toString('base64') }), 'VALIDATION');

  for (let i = 0; i < 7; i++) ok(upload({ name: 'n' + i + '.png', data: PNG }));
  const limit = err(upload({ name: 'eleven.png', data: PNG }), 'LIMIT');
  assert.match(limit.message, /eleven\.png/);

  const listed = ok(gas.run('apiListTasks')).tasks[0];
  assert.equal(listed.images.length, 10);
  assert.equal(listed.images[0].file_name, 'a.png');
});

test('documents are accepted by content plus extension and stored with the right type', () => {
  const { gas, create } = setup();
  const task = create({ title: 'docs' });
  const upload = (name, data) => gas.run('apiUploadImage', task.task_id, { name, data });
  const mime = (name, data) => ok(upload(name, data)).image.mime_type;

  assert.equal(mime('spec.pdf', PDF), 'application/pdf');
  assert.equal(mime('letter.docx', ZIP), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(mime('sheet.xlsx', ZIP), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(mime('deck.pptx', ZIP), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(mime('old.doc', OLE), 'application/msword');
  assert.equal(mime('old.xls', OLE), 'application/vnd.ms-excel');
  assert.equal(mime('bundle.zip', ZIP), 'application/zip');
  assert.equal(mime('notes.txt', b64('hello สวัสดี\n')), 'text/plain');
  assert.equal(mime('data.csv', b64('a,b\n1,2\n')), 'text/csv');
  assert.equal(mime('readme.md', b64('# hi')), 'text/markdown');

  const stored = ok(gas.run('apiListTasks')).tasks[0].images;
  assert.equal(stored.length, 10);
  const file = gas.state.files.get(stored[0].drive_file_id);
  assert.equal(file.getBlob().getContentType(), 'application/pdf');
});

test('file content must agree with the extension and the type must be on the list', () => {
  const { gas, create } = setup();
  const task = create({ title: 'bad files' });
  const upload = (name, data) => gas.run('apiUploadImage', task.task_id, { name, data });
  const reject = (name, data) => err(upload(name, data), 'VALIDATION');

  reject('run.exe', b64('MZ', Buffer.alloc(16)));
  reject('page.html', b64('<script>alert(1)</script>'));
  reject('icon.svg', b64('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  reject('script.js', b64('alert(1)'));
  reject('noext', b64('plain text'));
  reject('constructor', b64('x'));
  reject('x.constructor', b64('x'));
  reject('fake.pdf', b64('not a pdf'));
  reject('fake.docx', b64('plain text pretending to be docx'));
  reject('fake.docx', OLE);
  reject('fake.doc', ZIP);
  reject('fake.png', b64('plain text'));
  reject('binary.txt', b64('abc', Buffer.from([0]), 'def'));
  reject('binary.csv', OLE);
  reject('x.zip', b64('not a zip'));
  assert.deepEqual(ok(gas.run('apiListTasks')).tasks[0].images, []);
  assert.equal(gas.state.files.size, 0);
});

test('a real image or PDF is accepted even when the name or extension is wrong', () => {
  const { gas, create } = setup();
  const task = create({ title: 'content wins' });
  const mime = (name, data) => ok(gas.run('apiUploadImage', task.task_id, { name, data })).image.mime_type;
  assert.equal(mime('photo.txt', PNG), 'image/png');
  assert.equal(mime('picture', JPEG_HEADER), 'image/jpeg');
  assert.equal(mime('report.bin', PDF), 'application/pdf');
});

test('long file names keep their extension and the stored name is capped', () => {
  const { gas, create } = setup();
  const task = create({ title: 'long' });
  const name = 'ก'.repeat(300) + '.csv';
  const image = ok(gas.run('apiUploadImage', task.task_id, { name, data: b64('a,b') })).image;
  assert.equal(image.file_name.length, 120);
  assert.ok(image.file_name.endsWith('.csv'));
});

test('upload to a missing task fails without creating a Drive file', () => {
  const { gas } = setup();
  ok(gas.run('apiListTasks'));
  err(gas.run('apiUploadImage', 't_00000000-0000-0000-0000-000000000000',
    { name: 'a.png', mimeType: 'image/png', data: PNG }), 'NOT_FOUND');
  assert.equal(gas.state.files.size, 0);
});

test('update removes only the listed images of that task', () => {
  const { gas, create } = setup();
  const t1 = create({ title: 'one' });
  const t2 = create({ title: 'two' });
  const i1 = ok(gas.run('apiUploadImage', t1.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG })).image;
  const i2 = ok(gas.run('apiUploadImage', t1.task_id, { name: 'b.png', mimeType: 'image/png', data: PNG })).image;
  const other = ok(gas.run('apiUploadImage', t2.task_id, { name: 'c.png', mimeType: 'image/png', data: PNG })).image;

  const input = { title: 'one', status: 'todo', priority: '' };
  const updated = ok(gas.run('apiUpdateTask', t1.task_id, input, t1.updated_at, [i1.image_id, other.image_id])).task;
  assert.deepEqual(updated.images.map((i) => i.image_id), [i2.image_id]);
  assert.equal(gas.state.files.has(i1.drive_file_id), false);
  assert.equal(gas.state.files.get(other.drive_file_id).trashed, false);
  assert.equal(gas.state.files.has(i2.drive_file_id), true);
});

test('delete cascades to image rows and permanently deletes Drive files', () => {
  const { gas, create } = setup();
  const task = create({ title: 'bye' });
  const keep = create({ title: 'keep' });
  const image = ok(gas.run('apiUploadImage', task.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG })).image;

  const result = ok(gas.run('apiDeleteTask', task.task_id));
  assert.equal(result.removed_images, 1);
  assert.equal(gas.state.files.has(image.drive_file_id), false);
  assert.deepEqual(ok(gas.run('apiListTasks')).tasks.map((t) => t.task_id), [keep.task_id]);
  err(gas.run('apiDeleteTask', task.task_id), 'NOT_FOUND');
});

const linksSheet = (gas) => gas.state.spreadsheets.get(gas.resourceId('SPREADSHEET_ID')).getSheetByName('Links');

test('create stores links and returns them in order', () => {
  const { gas, create } = setup();
  const task = create({
    title: 'with links',
    links: [{ url: ' https://example.com/a?x=1#top ' }, { url: 'http://localhost:3000' }],
  });
  assert.deepEqual(task.links.map((link) => link.url), ['https://example.com/a?x=1#top', 'http://localhost:3000']);
  task.links.forEach((link) => assert.match(link.link_id, /^l_[0-9a-f-]{36}$/));
  const listed = ok(gas.run('apiListTasks')).tasks[0];
  assert.deepEqual(listed.links, task.links);
  assert.deepEqual(create({ title: 'none' }).links, []);
});

test('links reject unsafe schemes, junk and over-limit input', () => {
  const { gas } = setup();
  const bad = [
    [{ url: 'javascript:alert(1)' }],
    [{ url: 'JaVaScRiPt:alert(1)' }],
    [{ url: 'data:text/html,<b>x</b>' }],
    [{ url: 'ftp://example.com/file' }],
    [{ url: 'example.com' }],
    [{ url: 'https://' }],
    [{ url: 'https://exa mple.com' }],
    [{ url: 'https://example.com/\u0000' }],
    [{ url: '' }],
    [{ url: 42 }],
    [{ url: 'https://example.com/' + 'a'.repeat(2000) }],
    ['https://example.com'],
    'https://example.com',
    Array.from({ length: 11 }, (_, i) => ({ url: 'https://example.com/' + i })),
  ];
  bad.forEach((links) => err(gas.run('apiCreateTask', { title: 'x', status: 'todo', links }), 'VALIDATION'));
  assert.deepEqual(ok(gas.run('apiListTasks')).tasks, []);
  const ten = Array.from({ length: 10 }, (_, i) => ({ url: 'https://example.com/' + i }));
  ok(gas.run('apiCreateTask', { title: 'ok', status: 'todo', links: ten }));
});

test('update replaces links, leaves them alone when omitted, clears with an empty list', () => {
  const { gas, create } = setup();
  const task = create({ title: 'edit', links: [{ url: 'https://a.example' }, { url: 'https://b.example' }] });
  const edit = (fields) =>
    ok(gas.run('apiUpdateTask', task.task_id, Object.assign({ title: 'edit', status: 'todo' }, fields), null)).task;

  assert.deepEqual(edit({}).links.map((l) => l.url), ['https://a.example', 'https://b.example']);

  const swapped = edit({ links: [{ url: 'https://c.example' }, { url: 'https://a.example' }] });
  assert.deepEqual(swapped.links.map((l) => l.url), ['https://c.example', 'https://a.example']);
  assert.deepEqual(ok(gas.run('apiListTasks')).tasks[0].links, swapped.links);

  const sheetRows = () => linksSheet(gas).getLastRow();
  assert.equal(sheetRows(), 3);
  const unchanged = edit({ links: [{ url: 'https://c.example' }, { url: 'https://a.example' }] });
  assert.deepEqual(unchanged.links, swapped.links);

  assert.deepEqual(edit({ links: [] }).links, []);
  assert.equal(sheetRows(), 1);
  err(gas.run('apiUpdateTask', task.task_id, { title: 'edit', status: 'todo', links: [{ url: 'javascript:1' }] }, null), 'VALIDATION');
});

test('links stay with their own task, survive moves and go away with delete', () => {
  const { gas, create } = setup();
  const a = create({ title: 'a', links: [{ url: 'https://a.example' }] });
  const b = create({ title: 'b', links: [{ url: 'https://b.example' }] });
  const moved = ok(gas.run('apiMoveTask', a.task_id, 'done', null)).tasks;
  assert.deepEqual(moved.find((t) => t.task_id === a.task_id).links.map((l) => l.url), ['https://a.example']);

  ok(gas.run('apiDeleteTask', a.task_id));
  const rest = ok(gas.run('apiListTasks')).tasks;
  assert.deepEqual(rest.map((t) => t.task_id), [b.task_id]);
  assert.deepEqual(rest[0].links.map((l) => l.url), ['https://b.example']);
  assert.equal(linksSheet(gas).getLastRow(), 2);
});

test('the Links sheet is created on first use with its headers', () => {
  const { gas } = setup();
  const ss = gas.state.spreadsheets.get(gas.resourceId('SPREADSHEET_ID'));
  assert.equal(ss.getSheetByName('Links'), null);
  ok(gas.run('apiListTasks'));
  assert.deepEqual(ss.getSheetByName('Links').getRange(1, 1, 1, 4).getValues()[0],
    ['link_id', 'task_id', 'url', 'created_at']);
});

test('a sheet created by a concurrent execution is reused instead of failing', () => {
  const { gas } = setup();
  const ss = gas.state.spreadsheets.get(gas.resourceId('SPREADSHEET_ID'));
  const realLookup = ss.getSheetByName.bind(ss);
  let lookups = 0;
  ss.getSheetByName = (name) => (name === 'Links' && lookups++ === 0 ? null : realLookup(name));
  const rival = ss.insertSheet('Links');
  rival.getRange(1, 1, 1, 4).setValues([['link_id', 'task_id', 'url', 'created_at']]);
  const realInsert = ss.insertSheet.bind(ss);
  ss.insertSheet = (name) => {
    if (name === 'Links') throw new Error('A sheet with the name "Links" already exists');
    return realInsert(name);
  };
  assert.deepEqual(ok(gas.run('apiListTasks')), { tasks: [] });
});

test('link text that looks like a formula is stored as text', () => {
  const { gas, create } = setup();
  const task = create({ title: 'f', links: [{ url: 'https://example.com/?q==SUM(1)' }] });
  assert.equal(task.links[0].url, 'https://example.com/?q==SUM(1)');
  assert.equal(linksSheet(gas).getRange(2, 3).getValues()[0][0], 'https://example.com/?q==SUM(1)');
});

test('removing files falls back to the trash when permanent delete is unavailable', () => {
  const { gas, create } = setup();
  const task = create({ title: 'fallback' });
  const image = ok(gas.run('apiUploadImage', task.task_id, { name: 'a.png', data: PNG })).image;
  gas.ctx.Drive = undefined;
  ok(gas.run('apiDeleteTask', task.task_id));
  assert.equal(gas.state.files.get(image.drive_file_id).trashed, true);
  assert.deepEqual(ok(gas.run('apiListTasks')).tasks, []);
});

test('removing a file that is already gone from Drive still succeeds', () => {
  const { gas, create } = setup();
  const task = create({ title: 'ghost' });
  const image = ok(gas.run('apiUploadImage', task.task_id, { name: 'a.png', data: PNG })).image;
  gas.state.files.delete(image.drive_file_id);
  ok(gas.run('apiDeleteTask', task.task_id));
  assert.deepEqual(ok(gas.run('apiListTasks')).tasks, []);
});

test('image data is served only for registered images and reports missing files', () => {
  const { gas, create } = setup();
  const task = create({ title: 'img' });
  const image = ok(gas.run('apiUploadImage', task.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG })).image;

  const data = ok(gas.run('apiGetImageData', image.image_id, 'full'));
  assert.equal(data.missing, false);
  assert.equal(data.dataUrl, 'data:image/png;base64,' + PNG);

  err(gas.run('apiGetImageData', image.drive_file_id, 'full'), 'VALIDATION');
  err(gas.run('apiGetImageData', image.image_id, 'original'), 'VALIDATION');
  assert.deepEqual(ok(gas.run('apiGetImageData', 'i_00000000-0000-0000-0000-000000000000', 'thumb')), { missing: true });

  gas.state.files.get(image.drive_file_id).setTrashed(true);
  assert.deepEqual(ok(gas.run('apiGetImageData', image.image_id, 'thumb')), { missing: true });
});

test('unexpected errors return a generic message without internals', () => {
  const { gas } = setup();
  const ssId = gas.resourceId('SPREADSHEET_ID');
  gas.state.spreadsheets.clear();
  const error = err(gas.run('apiListTasks'), 'INTERNAL');
  assert.doesNotMatch(error.message, new RegExp(ssId + '|Spreadsheet|Error'));
});

test('helpers are not exposed as public functions', () => {
  const { gas } = setup();
  const builtins = new Set(require('node:vm').runInNewContext('Object.getOwnPropertyNames(globalThis)'));
  const publicFns = gas.eval(
    'Object.getOwnPropertyNames(globalThis).filter((k) => typeof globalThis[k] === "function" && !k.endsWith("_"))'
  ).filter((k) => !builtins.has(k) && /^[a-z]/.test(k));
  const expected = ['apiCreateTask', 'apiDeleteTask', 'apiGetImageData', 'apiListTasks', 'apiMoveTask',
    'apiUpdateTask', 'apiUploadImage', 'doGet', 'doPost', 'setup'];
  assert.deepEqual([...publicFns].sort(), expected);
});

function post(gas, body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const output = gas.eval('doPost')({ postData: { contents: raw, type: 'text/plain' } });
  assert.equal(output.getMimeType(), 'application/json');
  return JSON.parse(output.getContent());
}

test('doPost runs api functions and returns the same envelope as google.script.run', () => {
  const { gas } = setup();
  const created = ok(post(gas, { fn: 'apiCreateTask', args: [{ title: 'via http', status: 'todo', priority: 'high' }, 'http-req-0001'] })).task;
  assert.equal(created.title, 'via http');
  const image = ok(post(gas, { fn: 'apiUploadImage', args: [created.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG }] })).image;
  assert.equal(image.mime_type, 'image/png');
  const listed = ok(post(gas, { fn: 'apiListTasks', args: [] })).tasks;
  assert.deepEqual(listed.map((t) => [t.title, t.images.length]), [['via http', 1]]);
  err(post(gas, { fn: 'apiCreateTask', args: [{ title: '', status: 'todo' }, 'http-req-0002'] }), 'VALIDATION');
});

test('doPost rejects malformed bodies and functions outside the allowlist', () => {
  const { gas } = setup();
  for (const body of ['', 'not json', 'null', '[]', '{"args":[]}', { fn: 42 }]) {
    err(post(gas, body), 'VALIDATION');
  }
  for (const fn of ['setup', 'doGet', 'doPost', 'ensureResources_', 'respond_', 'constructor', 'toString', '__proto__']) {
    err(post(gas, { fn, args: [] }), 'VALIDATION');
  }
  assert.equal(gas.state.spreadsheets.size, 1);
});

test('the write lock is never re-entered', () => {
  const { gas, create } = setup();
  const task = create({ title: 'lock' });
  const image = ok(gas.run('apiUploadImage', task.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG })).image;
  ok(gas.run('apiUpdateTask', task.task_id, { title: 'x', status: 'todo' }, task.updated_at, [image.image_id]));
  ok(gas.run('apiDeleteTask', task.task_id));
  assert.equal(gas.state.lockState.held, false);
});

test('doGet renders the page with escaped initial data', () => {
  const { gas, create } = setup();
  create({ title: '</script><script>alert(1)</script>' });
  const html = gas.eval('doGet().getContent()');
  assert.match(html, /<html lang="th">/);
  assert.match(html, /window\.__INITIAL_DATA__ = \{"tasks":\[/);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.doesNotMatch(html, /<\?/);
});
