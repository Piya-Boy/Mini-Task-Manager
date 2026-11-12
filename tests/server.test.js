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
  assert.deepEqual(ss.getSheets().map((s) => s.getName()), ['Tasks', 'Images']);
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
    ['created_at', 'description', 'images', 'position', 'priority', 'status', 'task_id', 'title', 'updated_at']);
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

test('image upload validates type, signature, size and per-task limit', () => {
  const { gas, create } = setup();
  const task = create({ title: 'img' });
  const upload = (file) => gas.run('apiUploadImage', task.task_id, file);

  const image = ok(upload({ name: 'C:\\fakepath\\a.png', mimeType: 'image/png', data: PNG })).image;
  assert.equal(image.file_name, 'a.png');
  assert.match(image.image_id, /^i_/);
  assert.deepEqual(gas.state.files.get(image.drive_file_id).sharing, ['ANYONE_WITH_LINK', 'VIEW']);

  ok(upload({ name: 'b.jpg', mimeType: 'image/jpeg', data: JPEG_HEADER }));
  ok(upload({ name: 'c.webp', mimeType: 'image/webp', data: WEBP_HEADER }));
  err(upload({ name: 'x.gif', mimeType: 'image/gif', data: PNG }), 'VALIDATION');
  err(upload({ name: 'x.png', mimeType: 'image/png', data: JPEG_HEADER }), 'VALIDATION');
  err(upload({ name: 'x.png', mimeType: 'image/png', data: 'not base64!' }), 'VALIDATION');

  const big = Buffer.alloc(8 * 1024 * 1024 + 1);
  Buffer.from(PNG, 'base64').copy(big);
  err(upload({ name: 'big.png', mimeType: 'image/png', data: big.toString('base64') }), 'VALIDATION');

  for (let i = 0; i < 7; i++) ok(upload({ name: 'n' + i + '.png', mimeType: 'image/png', data: PNG }));
  const limit = err(upload({ name: 'eleven.png', mimeType: 'image/png', data: PNG }), 'LIMIT');
  assert.match(limit.message, /eleven\.png/);

  const listed = ok(gas.run('apiListTasks')).tasks[0];
  assert.equal(listed.images.length, 10);
  assert.equal(listed.images[0].file_name, 'a.png');
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
  assert.equal(gas.state.files.get(i1.drive_file_id).trashed, true);
  assert.equal(gas.state.files.get(other.drive_file_id).trashed, false);
});

test('delete cascades to image rows and trashes Drive files', () => {
  const { gas, create } = setup();
  const task = create({ title: 'bye' });
  const keep = create({ title: 'keep' });
  const image = ok(gas.run('apiUploadImage', task.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG })).image;

  const result = ok(gas.run('apiDeleteTask', task.task_id));
  assert.equal(result.removed_images, 1);
  assert.equal(gas.state.files.get(image.drive_file_id).trashed, true);
  assert.deepEqual(ok(gas.run('apiListTasks')).tasks.map((t) => t.task_id), [keep.task_id]);
  err(gas.run('apiDeleteTask', task.task_id), 'NOT_FOUND');
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
