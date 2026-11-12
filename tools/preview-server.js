'use strict';

/**
 * Local preview: serves doGet() output with google.script.run routed to the
 * in-memory Apps Script fakes. Data lives in memory and resets on restart.
 * /static serves the tools/build-static.js page wired to a local doPost.
 * Usage: node tools/preview-server.js [--port 5173] [--empty]
 */

const http = require('node:http');
const { createGas } = require('../tests/gas-harness');
const { solidPng } = require('../tests/png');
const { buildStatic } = require('./build-static');

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 5173;
const latencyMs = 250;
const gas = createGas();

function seed() {
  const run = (name, ...a) => {
    const res = gas.run(name, ...a);
    if (!res.ok) throw new Error(name + ': ' + res.error.message);
    return res.data;
  };
  const png = (rgb) => solidPng(480, 320, rgb).toString('base64');
  const add = (title, description, status, priority, images) => {
    const { task } = run('apiCreateTask', { title, description, status: 'todo', priority });
    if (status !== 'todo') run('apiMoveTask', task.task_id, status, null);
    return images.map(([name, rgb]) => run('apiUploadImage', task.task_id, { name, mimeType: 'image/png', data: png(rgb) }).image);
  };

  add('เปลี่ยนโคมไฟทางเดิน', 'โคมเก่ากะพริบ ตัวใหม่อยู่ในโรงรถ ต้องใช้ขั้วต่อสายแบบ 2 เส้น', 'in_progress', 'high',
    [['fixture-model.png', [214, 211, 209]], ['ceiling-wiring.png', [168, 162, 158]]]);
  add('นัดช่างประปาซ่อมซิงก์ครัว', 'ท่อใต้ซิงก์รั่วซึม ขอคิววันเสาร์ช่วงเช้า', 'todo', 'high', [['sink-leak.png', [147, 197, 253]]]);
  add('ส่งใบเสนอราคาฉบับแก้ไขให้เจ้าของบ้าน', 'ใส่รายการซ่อมหน้าต่างที่ตกลงกันไว้ด้วย', 'todo', 'medium', []);
  add('วัดระเบียงก่อนซื้อกระถางต้นไม้', '', 'todo', '', []);
  add('เลือกสีทาห้องนอน', 'คัดไว้สองเฉด ลองเทียบตอนกลางวันก่อนซื้อ', 'in_progress', 'low',
    [['swatch-sage.png', [163, 177, 138]], ['swatch-stone.png', [190, 182, 170]], ['bedroom-wall.png', [231, 229, 228]]]);
  add('ต่อประกันบ้าน', 'ต่ออายุ 12 เดือน ความคุ้มครองเท่าเดิม', 'done', 'medium', []);
  const [receipt] = add('คืนกระเบื้องปูพื้นที่เหลือ', 'คืนไป 3 กล่อง ได้เงินคืนแล้ว', 'done', 'low', [['return-receipt.png', [254, 243, 199]]]);
  gas.state.files.get(receipt.drive_file_id).setTrashed(true);
}

const MOCK_RUN = `
(() => {
  function runner(onSuccess, onFailure) {
    return new Proxy({}, {
      get(_, name) {
        if (name === 'withSuccessHandler') return (fn) => runner(fn, onFailure);
        if (name === 'withFailureHandler') return (fn) => runner(onSuccess, fn);
        return (...args) => {
          fetch('/__rpc/' + encodeURIComponent(name), { method: 'POST', body: JSON.stringify(args) })
            .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then((v) => onSuccess && onSuccess(v.result), (e) => onFailure && onFailure(e));
        };
      },
    });
  }
  window.google = { script: { get run() { return runner(null, null); } } };
})();
`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      // Apps Script adds the viewport tag via addMetaTag(); the fake does not, so add it here.
      const html = gas.eval('doGet().getContent()').replace('<head>',
        '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<script src="/__gas.js"></script>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/static') {
      // The tools/build-static.js page, calling doPost through fetch instead of google.script.run.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildStatic('/__http'));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/__http') {
      const contents = await readBody(req);
      const output = gas.eval('doPost')({ postData: { contents, type: req.headers['content-type'] || '' } });
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': output.getMimeType() });
        res.end(output.getContent());
      }, latencyMs);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__gas.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(MOCK_RUN);
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/__rpc/')) {
      const name = decodeURIComponent(url.pathname.slice('/__rpc/'.length));
      if (!/^(api[A-Za-z]+)$/.test(name)) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(await readBody(req));
      const result = gas.run(name, ...body);
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: result === undefined ? null : result }));
      }, latencyMs);
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    console.error(error);
    res.writeHead(500).end();
  }
});

if (!args.includes('--empty')) seed();
server.listen(port, () => console.log('Mini Tasks preview on http://localhost:' + port));
