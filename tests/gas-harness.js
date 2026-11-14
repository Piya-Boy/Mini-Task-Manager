'use strict';

/**
 * In-memory stand-ins for the Apps Script services the server code uses.
 * They model behaviour the code depends on (quote prefix, non-reentrant lock,
 * JSON-only transport) but cannot prove how the real services behave.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PUSH_ORDER = ['Config', 'Utils', 'Validation', 'Database', 'ImageService', 'LinkService', 'TaskService', 'Code', 'HttpApi'];

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }

  setValues(values) {
    if (values.length !== this.numRows || values.some((r) => r.length !== this.numCols)) {
      throw new Error('Range dimensions do not match values');
    }
    values.forEach((line, r) => {
      const target = (this.sheet.data[this.row - 1 + r] = this.sheet.data[this.row - 1 + r] || []);
      line.forEach((value, c) => {
        if (typeof value === 'string' && value.startsWith("'")) target[this.col - 1 + c] = value.slice(1);
        else if (typeof value === 'string' && value.startsWith('=')) target[this.col - 1 + c] = '#FORMULA';
        else target[this.col - 1 + c] = value;
      });
    });
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
  }
  getName() { return this.name; }
  setName(name) { this.name = name; return this; }
  setFrozenRows() { return this; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      if ((this.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error('Invalid range');
    return new FakeRange(this, row, col, numRows, numCols);
  }
  deleteRows(start, count) {
    this.data.splice(start - 1, count);
  }
}

class FakeSpreadsheet {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.sheets = [new FakeSheet('Sheet1')];
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
}

class FakeBlob {
  constructor(bytes, contentType, name) {
    this.bytes = bytes;
    this.contentType = contentType;
    this.name = name;
  }
  getBytes() { return this.bytes.slice(); }
  getContentType() { return this.contentType; }
  getName() { return this.name; }
}

function createServices() {
  const spreadsheets = new Map();
  const folders = new Map();
  const files = new Map();
  const properties = new Map();
  const cache = new Map();
  const lockState = { held: false, acquisitions: 0 };
  const uuid = () => crypto.randomUUID();

  const SpreadsheetApp = {
    create(name) {
      const ss = new FakeSpreadsheet('ss_' + uuid(), name);
      spreadsheets.set(ss.id, ss);
      return ss;
    },
    openById(id) {
      const ss = spreadsheets.get(id);
      if (!ss) throw new Error('Spreadsheet not found: ' + id);
      return ss;
    },
    flush() {},
  };

  function makeFile(blob) {
    const id = 'f_' + uuid();
    const file = {
      trashed: false,
      sharing: null,
      blob,
      getId: () => id,
      setSharing(access, permission) { file.sharing = [access, permission]; return file; },
      setTrashed(value) { file.trashed = value; return file; },
      isTrashed: () => file.trashed,
      getBlob: () => new FakeBlob(blob.getBytes(), blob.getContentType(), blob.getName()),
      getThumbnail: () => null,
    };
    files.set(id, file);
    return file;
  }

  const Drive = {
    Files: {
      remove(id) {
        if (!files.has(id)) throw new Error('API call to drive.files.delete failed with error: File not found: ' + id);
        files.delete(id);
      },
    },
  };

  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
    createFolder(name, presetId) {
      const id = presetId || 'd_' + uuid();
      const folder = { name, getId: () => id, getName: () => name, createFile: (blob) => makeFile(blob) };
      folders.set(id, folder);
      return folder;
    },
    getFolderById(id) {
      const folder = folders.get(id);
      if (!folder) throw new Error('Folder not found');
      return folder;
    },
    getFileById(id) {
      const file = files.get(id);
      if (!file) throw new Error('File not found');
      return file;
    },
  };

  const Utilities = {
    getUuid: uuid,
    base64Decode: (text) => Array.from(Buffer.from(text, 'base64'), (b) => (b > 127 ? b - 256 : b)),
    base64Encode: (bytes) => Buffer.from(bytes.map((b) => b & 0xff)).toString('base64'),
    newBlob: (bytes, type, name) => new FakeBlob(bytes, type, name),
  };

  const LockService = {
    getScriptLock: () => ({
      tryLock() {
        if (lockState.held) return false;
        lockState.held = true;
        lockState.acquisitions++;
        return true;
      },
      releaseLock() { lockState.held = false; },
    }),
  };

  const CacheService = {
    getScriptCache: () => ({
      get: (key) => (cache.has(key) ? cache.get(key) : null),
      put: (key, value) => { cache.set(key, String(value)); },
    }),
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
      setProperty: (key, value) => { properties.set(key, String(value)); },
    }),
  };

  const ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput(content) {
      const output = {
        mimeType: 'text/plain',
        getContent: () => content,
        getMimeType: () => output.mimeType,
        setMimeType(type) { output.mimeType = type; return output; },
      };
      return output;
    },
  };

  return {
    globals: { SpreadsheetApp, DriveApp, Drive, Utilities, LockService, CacheService, PropertiesService, ContentService },
    state: { spreadsheets, folders, files, properties, cache, lockState },
  };
}

function createHtmlService(ctx) {
  const read = (p) => fs.readFileSync(path.join(ROOT, p + '.html'), 'utf8');
  const evaluateTemplate = (source, vars) =>
    source.replace(/<\?!=\s*([\s\S]*?)\s*\?>/g, (_, expr) => {
      ctx.__tplVars = vars;
      return String(vm.runInContext('with (__tplVars) { (' + expr + '); }', ctx));
    });
  const output = (content) => ({
    getContent: () => content,
    setTitle() { return this; },
    addMetaTag() { return this; },
  });
  return {
    createHtmlOutputFromFile: (p) => output(read(p)),
    createTemplateFromFile(p) {
      const template = {
        evaluate: () => output(evaluateTemplate(read(p), template)),
      };
      return template;
    },
  };
}

const RESOURCE_IDS_BLOCK = /RESOURCE_IDS:\s*Object\.freeze\(\{[\s\S]*?\}\)/;

/**
 * @param {{ order?: string[], resourceIds?: { SPREADSHEET_ID: string, IMAGE_FOLDER_ID: string } }} [options]
 *   order: load order of .gs files. resourceIds: replaces CONFIG.RESOURCE_IDS
 *   (empty strings exercise first-run creation). Configured IDs get matching
 *   pre-existing fake resources, like a real spreadsheet and folder would be.
 */
function createGas(options = {}) {
  const services = createServices();
  const ctx = vm.createContext({ console, ...services.globals });
  ctx.HtmlService = createHtmlService(ctx);

  const order = options.order || PUSH_ORDER;
  order.forEach((name) => {
    const file = path.join(ROOT, 'server', name + '.gs');
    let source = fs.readFileSync(file, 'utf8');
    if (name === 'Config' && options.resourceIds) {
      if (!RESOURCE_IDS_BLOCK.test(source)) throw new Error('RESOURCE_IDS block not found in Config.gs');
      source = source.replace(RESOURCE_IDS_BLOCK, 'RESOURCE_IDS: Object.freeze(' + JSON.stringify(options.resourceIds) + ')');
    }
    vm.runInContext(source, ctx, { filename: file });
  });

  const configured = vm.runInContext('CONFIG.RESOURCE_IDS', ctx);
  if (configured.SPREADSHEET_ID) {
    services.state.spreadsheets.set(configured.SPREADSHEET_ID, new FakeSpreadsheet(configured.SPREADSHEET_ID, 'Existing sheet'));
  }
  if (configured.IMAGE_FOLDER_ID) {
    services.globals.DriveApp.createFolder('Existing folder', configured.IMAGE_FOLDER_ID);
  }

  /** Calls a public function the way google.script.run does: JSON in, JSON out. */
  function run(name, ...args) {
    const fn = vm.runInContext('typeof ' + name + ' === "function" ? ' + name + ' : null', ctx);
    if (!fn) throw new Error('No such function: ' + name);
    const result = fn(...JSON.parse(JSON.stringify(args)));
    return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
  }

  const resourceId = (name) => vm.runInContext('findResourceId_(' + JSON.stringify(name) + ')', ctx);
  return { ctx, run, resourceId, state: services.state, eval: (code) => vm.runInContext(code, ctx) };
}

module.exports = { createGas, PUSH_ORDER, ROOT };
