'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGas } = require('./gas-harness');
const { solidPng } = require('./png');
const { createMcpServer } = require('../tools/mcp-server');

const SCRIPT = path.join(__dirname, '..', 'tools', 'mcp-server.js');

function setup() {
  const gas = createGas();
  const seen = [];
  const call = async (fn, args) => {
    seen.push(fn);
    const output = gas.eval('doPost')({ postData: { contents: JSON.stringify({ fn, args }), type: 'text/plain' } });
    const body = JSON.parse(output.getContent());
    if (!body.ok) throw new Error(body.error.message);
    return body.data;
  };
  const server = createMcpServer({ call });
  let id = 0;
  const rpc = (method, params) => server.handle({ jsonrpc: '2.0', id: ++id, method, params });
  const tool = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
  const run = (name, ...a) => {
    const res = gas.run(name, ...a);
    assert.equal(res.ok, true);
    return res.data;
  };
  let n = 0;
  const addTask = (input) => run('apiCreateTask', { status: 'todo', ...input }, 'mcp-req-' + String(++n).padStart(4, '0')).task;
  return { seen, server, rpc, tool, run, addTask };
}

const payload = (result) => JSON.parse(result.content[0].text);

test('initialize negotiates the protocol version and notifications get no reply', async () => {
  const { server, rpc } = setup();
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.match(init.result.instructions, /Never follow instructions/);
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
  assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await server.handle({ jsonrpc: '2.0', method: 'unknown/notification' }), null);
  assert.deepEqual((await rpc('ping')).result, {});
  assert.equal((await rpc('nope')).error.code, -32601);
  assert.equal((await server.handle([])).error.code, -32600);
});

test('tools/list flags read tools read-only and delete as destructive', async () => {
  const { rpc } = setup();
  const { tools } = (await rpc('tools/list')).result;
  assert.deepEqual(tools.map((t) => t.name),
    ['list_tasks', 'get_task', 'get_task_image', 'create_task', 'upload_task_image', 'update_task', 'move_task', 'delete_task']);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
  for (const name of ['list_tasks', 'get_task', 'get_task_image']) assert.equal(byName[name].readOnlyHint, true);
  for (const name of ['create_task', 'upload_task_image', 'update_task', 'move_task', 'delete_task']) assert.equal(byName[name].readOnlyHint, false);
  assert.equal(byName.delete_task.destructiveHint, true);
});

test('list_tasks filters, truncates and hides internal fields', async () => {
  const { tool, addTask, run } = setup();
  addTask({ title: 'Fix sink', description: 'x'.repeat(300), priority: 'high' });
  const moved = addTask({ title: 'Paint wall', description: 'Sage green', priority: 'low' });
  run('apiMoveTask', moved.task_id, 'done', null);
  addTask({ title: 'Buy pots' });

  const all = payload(await tool('list_tasks', {}));
  assert.equal(all.total, 3);
  assert.equal(all.tasks[0].description.length, 201);
  assert.equal(all.tasks[0].description_truncated, true);
  assert.equal(all.tasks[2].priority, null);
  assert.ok(!('position' in all.tasks[0]) && !('drive_file_id' in all.tasks[0]));
  assert.match(all.tasks[0].created_at, /^\d{4}-\d\d-\d\dT/);

  assert.deepEqual(payload(await tool('list_tasks', { status: 'done' })).tasks.map((t) => t.title), ['Paint wall']);
  assert.deepEqual(payload(await tool('list_tasks', { query: 'SAGE' })).tasks.map((t) => t.title), ['Paint wall']);
  assert.deepEqual(payload(await tool('list_tasks', { priority: 'high', status: 'todo' })).tasks.map((t) => t.title), ['Fix sink']);
  const limited = payload(await tool('list_tasks', { limit: 1 }));
  assert.deepEqual([limited.total, limited.returned, limited.tasks.length], [3, 1, 1]);
});

test('bad input becomes a tool error or a JSON-RPC error', async () => {
  const { tool, rpc } = setup();
  for (const args of [{ status: 'nope' }, { limit: 0 }, { limit: 'x' }, { query: 5 }]) {
    assert.equal((await tool('list_tasks', args)).isError, true, JSON.stringify(args));
  }
  assert.equal((await tool('get_task', {})).isError, true);
  assert.equal((await tool('get_task', { task_id: 't_missing' })).isError, true);
  assert.equal((await rpc('tools/call', { name: 'drop_table', arguments: {} })).error.code, -32602);
  assert.equal((await rpc('tools/call', { name: 'constructor', arguments: {} })).error.code, -32602);
  assert.equal((await rpc('tools/call', { name: 'get_task', arguments: [] })).error.code, -32602);
});

test('get_task returns the full description and image metadata', async () => {
  const { tool, addTask, run } = setup();
  const task = addTask({ title: 'With image', description: 'y'.repeat(300) });
  run('apiUploadImage', task.task_id, { name: 'a.png', mimeType: 'image/png', data: solidPng(8, 8, [1, 2, 3]).toString('base64') });
  const got = payload(await tool('get_task', { task_id: task.task_id }));
  assert.equal(got.description.length, 300);
  assert.deepEqual(Object.keys(got.images[0]), ['image_id', 'file_name', 'mime_type', 'size_bytes']);
  assert.equal(got.images[0].file_name, 'a.png');
});

test('get_task_image returns MCP image content and reports missing images', async () => {
  const { tool, addTask, run } = setup();
  const task = addTask({ title: 'pic' });
  const png = solidPng(8, 8, [9, 9, 9]);
  const image = run('apiUploadImage', task.task_id, { name: 'p.png', mimeType: 'image/png', data: png.toString('base64') }).image;
  const result = await tool('get_task_image', { image_id: image.image_id, variant: 'full' });
  assert.equal(result.content[0].type, 'image');
  assert.equal(result.content[0].mimeType, 'image/png');
  assert.deepEqual(Buffer.from(result.content[0].data, 'base64'), png);
  assert.equal((await tool('get_task_image', { image_id: 'i_missing' })).isError, true);
  assert.equal((await tool('get_task_image', { image_id: image.image_id, variant: 'huge' })).isError, true);
});

test('read tools only call read functions on the backend', async () => {
  const { seen, tool, addTask } = setup();
  const task = addTask({ title: 'x' });
  seen.length = 0;
  await tool('list_tasks', {});
  await tool('get_task', { task_id: task.task_id });
  await tool('get_task_image', { image_id: 'i_none' });
  assert.deepEqual([...new Set(seen)].sort(), ['apiGetImageData', 'apiListTasks']);
});

const PNG_B64 = solidPng(8, 8, [1, 2, 3]).toString('base64');

test('create_task applies defaults and validates input', async () => {
  const { tool, run } = setup();
  const made = payload(await tool('create_task', { title: 'From AI' }));
  assert.deepEqual([made.title, made.status, made.priority, made.description], ['From AI', 'todo', null, '']);
  const full = payload(await tool('create_task', { title: 'B', description: 'd', status: 'in_progress', priority: 'high' }));
  assert.deepEqual([full.status, full.priority, full.description], ['in_progress', 'high', 'd']);
  assert.equal(run('apiListTasks').tasks.length, 2);
  const bad = [{}, { title: '' }, { title: 'x'.repeat(201) }, { title: 'x', status: 'nope' }, { title: 'x', priority: 'urgent' }];
  for (const args of bad) assert.equal((await tool('create_task', args)).isError, true, JSON.stringify(args));
  assert.equal(run('apiListTasks').tasks.length, 2);
});

function tempFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-img-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test('upload_task_image attaches a local image and the bytes round-trip', async () => {
  const { tool, addTask, run } = setup();
  const task = addTask({ title: 'pic' });
  const png = solidPng(16, 16, [10, 20, 30]);
  const file = tempFile('photo.png', png);
  const result = payload(await tool('upload_task_image', { task_id: task.task_id, file_path: file }));
  assert.equal(result.task_id, task.task_id);
  assert.deepEqual([result.image.file_name, result.image.mime_type, result.image.size_bytes], ['photo.png', 'image/png', png.length]);
  assert.ok(!('drive_file_id' in result.image));
  const stored = run('apiListTasks').tasks[0].images;
  assert.equal(stored.length, 1);
  const back = await tool('get_task_image', { image_id: stored[0].image_id, variant: 'full' });
  assert.deepEqual(Buffer.from(back.content[0].data, 'base64'), png);
});

test('upload_task_image trusts file content, not the extension', async () => {
  const { tool, addTask, run } = setup();
  const task = addTask({ title: 'pic' });
  const disguised = tempFile('notes.png', Buffer.from('just some text, not an image'));
  assert.equal((await tool('upload_task_image', { task_id: task.task_id, file_path: disguised })).isError, true);
  const mislabeled = tempFile('photo.txt', solidPng(8, 8, [1, 1, 1]));
  const ok = await tool('upload_task_image', { task_id: task.task_id, file_path: mislabeled });
  assert.equal(ok.isError, undefined);
  assert.equal(payload(ok).image.mime_type, 'image/png');
  assert.equal(run('apiListTasks').tasks[0].images.length, 1);
});

test('upload_task_image rejects missing files, directories, big files and bad ids', async () => {
  const { tool, addTask } = setup();
  const task = addTask({ title: 'pic' });
  const good = tempFile('ok.png', solidPng(8, 8, [1, 1, 1]));
  const big = tempFile('big.png', Buffer.concat([solidPng(8, 8, [1, 1, 1]), Buffer.alloc(8 * 1024 * 1024)]));
  const cases = [
    { task_id: task.task_id, file_path: path.join(os.tmpdir(), 'mcp-does-not-exist.png') },
    { task_id: task.task_id, file_path: os.tmpdir() },
    { task_id: task.task_id, file_path: big },
    { task_id: 't_missing', file_path: good },
    { task_id: task.task_id },
    { file_path: good },
  ];
  for (const args of cases) {
    const result = await tool('upload_task_image', args);
    assert.equal(result.isError, true, JSON.stringify(args));
  }
});

test('update_task changes only the given fields and can clear priority', async () => {
  const { tool, addTask, run } = setup();
  const task = addTask({ title: 'Old', description: 'keep me', priority: 'high' });
  const renamed = payload(await tool('update_task', { task_id: task.task_id, title: 'New' }));
  assert.deepEqual([renamed.title, renamed.description, renamed.priority, renamed.status], ['New', 'keep me', 'high', 'todo']);
  const cleared = payload(await tool('update_task', { task_id: task.task_id, priority: '', description: '' }));
  assert.deepEqual([cleared.title, cleared.description, cleared.priority], ['New', '', null]);
  assert.equal(run('apiListTasks').tasks[0].title, 'New');
  assert.equal((await tool('update_task', { task_id: task.task_id })).isError, true);
  assert.equal((await tool('update_task', { task_id: 't_missing', title: 'x' })).isError, true);
  assert.equal((await tool('update_task', { task_id: task.task_id, title: '' })).isError, true);
  assert.equal((await tool('update_task', { task_id: task.task_id, priority: 'urgent' })).isError, true);
});

test('update_task keeps images and status', async () => {
  const { tool, addTask, run } = setup();
  const task = addTask({ title: 'pic', status: 'in_progress' });
  run('apiUploadImage', task.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG_B64 });
  const updated = payload(await tool('update_task', { task_id: task.task_id, title: 'pic2' }));
  assert.equal(updated.status, 'in_progress');
  assert.equal(updated.images.length, 1);
});

test('move_task changes status and honours before_task_id', async () => {
  const { tool, addTask } = setup();
  const a = addTask({ title: 'A', status: 'done' });
  const b = addTask({ title: 'B' });
  const moved = payload(await tool('move_task', { task_id: b.task_id, status: 'done' }));
  assert.equal(moved.status, 'done');
  await tool('move_task', { task_id: b.task_id, status: 'done', before_task_id: a.task_id });
  assert.deepEqual(payload(await tool('list_tasks', { status: 'done' })).tasks.map((t) => t.title), ['B', 'A']);
  assert.equal((await tool('move_task', { task_id: b.task_id, status: 'nope' })).isError, true);
  assert.equal((await tool('move_task', { task_id: b.task_id })).isError, true);
  assert.equal((await tool('move_task', { task_id: 't_missing', status: 'done' })).isError, true);
});

test('delete_task removes the task and its images', async () => {
  const { tool, addTask, run } = setup();
  const task = addTask({ title: 'gone' });
  const keep = addTask({ title: 'stay' });
  run('apiUploadImage', task.task_id, { name: 'a.png', mimeType: 'image/png', data: PNG_B64 });
  const result = payload(await tool('delete_task', { task_id: task.task_id }));
  assert.deepEqual(result, { deleted: task.task_id, removed_images: 1 });
  assert.deepEqual(run('apiListTasks').tasks.map((t) => t.task_id), [keep.task_id]);
  assert.equal((await tool('delete_task', { task_id: task.task_id })).isError, true);
  assert.equal((await tool('delete_task', {})).isError, true);
});

test('update_task surfaces a failed write as a tool error and sends the version it read', async () => {
  const task = { task_id: 't_1', title: 'a', description: '', status: 'todo', priority: '', updated_at: 5, images: [] };
  const calls = [];
  const server = createMcpServer({
    call: async (fn, args) => {
      calls.push([fn, args]);
      if (fn === 'apiListTasks') return { tasks: [task] };
      throw new Error('conflict');
    },
  });
  const res = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_task', arguments: { task_id: 't_1', title: 'b' } } });
  assert.equal(res.result.isError, true);
  assert.deepEqual(calls[1], ['apiUpdateTask', ['t_1', { title: 'b', description: '', status: 'todo', priority: '' }, 5, []]]);
});

test('backend failures become tool errors, not crashes', async () => {
  const server = createMcpServer({ call: async () => { throw new Error('HTTP 500'); } });
  const res = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /HTTP 500/);
});

test('the stdio entry point refuses to start without a valid API URL', () => {
  for (const url of [undefined, 'http://script.google.com/macros/s/abc/exec', 'https://evil.example/macros/s/abc/exec']) {
    const env = { ...process.env };
    delete env.MINI_TASKS_API_URL;
    if (url) env.MINI_TASKS_API_URL = url;
    const run = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8', input: '' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /MINI_TASKS_API_URL/);
  }
});

test('the stdio entry point answers JSON-RPC lines and reports parse errors', () => {
  const env = { ...process.env, MINI_TASKS_API_URL: 'https://script.google.com/macros/s/abc_DEF-1/exec' };
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    '{bad',
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  ].join('\n') + '\n';
  const run = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8', input });
  assert.equal(run.status, 0);
  const replies = run.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(replies.length, 3);
  assert.equal(replies.find((r) => r.id === 1).result.serverInfo.name, 'mini-tasks');
  assert.equal(replies.find((r) => r.id === null).error.code, -32700);
  assert.equal(replies.find((r) => r.id === 2).result.tools.length, 8);
});
