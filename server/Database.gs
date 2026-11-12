/**
 * Thin batch-oriented access layer over the Tasks and Images sheets.
 * Rows are plain objects keyed by header; `_row` holds the 1-based sheet row.
 */
const Db = (() => {
  let spreadsheet = null;
  const sheetCache = {};

  function initialize(target) {
    const tasks = CONFIG.SHEETS.TASKS;
    const images = CONFIG.SHEETS.IMAGES;
    const first = target.getSheets()[0];
    first.setName(tasks.name);
    writeHeaders_(first, tasks);
    writeHeaders_(target.insertSheet(images.name), images);
  }

  function writeHeaders_(sheet, def) {
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    sheet.setFrozenRows(1);
  }

  function getSpreadsheet_() {
    if (!spreadsheet) {
      spreadsheet = SpreadsheetApp.openById(getResourceId_('SPREADSHEET_ID'));
    }
    return spreadsheet;
  }

  function getSheet_(def) {
    if (sheetCache[def.name]) return sheetCache[def.name];
    const ss = getSpreadsheet_();
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
      writeHeaders_(sheet, def);
    } else {
      const actual = sheet.getRange(1, 1, 1, def.headers.length).getValues()[0];
      if (actual.join('|') !== def.headers.join('|')) {
        throw new Error('Unexpected headers in sheet ' + def.name);
      }
    }
    sheetCache[def.name] = sheet;
    return sheet;
  }

  // A leading apostrophe stops Sheets from turning user text into formulas, numbers or dates.
  function toCell_(def, key, value) {
    if (def.numeric.indexOf(key) !== -1) return Number(value) || 0;
    if (value === null || value === undefined || value === '') return '';
    const text = String(value);
    return def.userText.indexOf(key) !== -1 ? "'" + text : text;
  }

  function fromCell_(def, key, value) {
    if (def.numeric.indexOf(key) !== -1) {
      return value instanceof Date ? value.getTime() : Number(value) || 0;
    }
    if (value instanceof Date) return value.toISOString();
    return value === null || value === undefined ? '' : String(value);
  }

  function toRow_(def, record) {
    return def.headers.map((key) => toCell_(def, key, record[key]));
  }

  function readAll(def) {
    const sheet = getSheet_(def);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const values = sheet.getRange(2, 1, lastRow - 1, def.headers.length).getValues();
    const rows = [];
    values.forEach((cells, index) => {
      if (cells[0] === '' || cells[0] === null) return;
      const record = { _row: index + 2 };
      def.headers.forEach((key, col) => {
        record[key] = fromCell_(def, key, cells[col]);
      });
      rows.push(record);
    });
    return rows;
  }

  function append(def, records) {
    if (!records.length) return;
    const sheet = getSheet_(def);
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, records.length, def.headers.length).setValues(records.map((r) => toRow_(def, r)));
  }

  function update(def, records) {
    const sheet = getSheet_(def);
    records.forEach((record) => {
      if (!record._row) throw new Error('Cannot update a record without _row');
      sheet.getRange(record._row, 1, 1, def.headers.length).setValues([toRow_(def, record)]);
    });
  }

  function remove(def, records) {
    if (!records.length) return;
    const sheet = getSheet_(def);
    const rowNumbers = records.map((r) => r._row).sort((a, b) => b - a);
    let i = 0;
    while (i < rowNumbers.length) {
      let end = rowNumbers[i];
      let start = end;
      while (i + 1 < rowNumbers.length && rowNumbers[i + 1] === start - 1) {
        start = rowNumbers[++i];
      }
      sheet.deleteRows(start, end - start + 1);
      i++;
    }
  }

  return { initialize, readAll, append, update, remove };
})();
