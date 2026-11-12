class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

const MESSAGES = Object.freeze({
  INTERNAL: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง',
  BUSY: 'ระบบกำลังบันทึกข้อมูลของอีกคนอยู่ กรุณาลองใหม่อีกครั้ง',
});

/**
 * Runs an API handler and wraps the result in a JSON-safe envelope.
 * Unknown errors are logged server-side and replaced by a generic message.
 */
function respond_(handler) {
  try {
    ensureResources_();
    return { ok: true, data: handler() };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    console.error(error && error.stack ? error.stack : String(error));
    return { ok: false, error: { code: 'INTERNAL', message: MESSAGES.INTERNAL } };
  }
}

/**
 * Serialises writes from both users. Must never be nested within one execution.
 */
function withWriteLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    throw new AppError('BUSY', MESSAGES.BUSY);
  }
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Resolves a resource ID: CONFIG.RESOURCE_IDS first, then Script Properties.
 * @param {'SPREADSHEET_ID'|'IMAGE_FOLDER_ID'} name
 */
function findResourceId_(name) {
  return CONFIG.RESOURCE_IDS[name] || PropertiesService.getScriptProperties().getProperty(CONFIG.PROPERTY_KEYS[name]);
}

function getResourceId_(name) {
  const id = findResourceId_(name);
  if (!id) throw new Error('Missing resource ID: ' + name);
  return id;
}

/**
 * Creates the spreadsheet or image folder on first use when no ID is configured,
 * storing the new ID in Script Properties. Called before any write lock is taken.
 */
function ensureResources_() {
  if (findResourceId_('SPREADSHEET_ID') && findResourceId_('IMAGE_FOLDER_ID')) return;

  const props = PropertiesService.getScriptProperties();
  const keys = CONFIG.PROPERTY_KEYS;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    throw new AppError('BUSY', MESSAGES.BUSY);
  }
  try {
    if (!findResourceId_('SPREADSHEET_ID')) {
      const spreadsheet = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
      Db.initialize(spreadsheet);
      props.setProperty(keys.SPREADSHEET_ID, spreadsheet.getId());
    }
    if (!findResourceId_('IMAGE_FOLDER_ID')) {
      const folder = DriveApp.createFolder(CONFIG.IMAGE_FOLDER_NAME);
      props.setProperty(keys.IMAGE_FOLDER_ID, folder.getId());
    }
  } finally {
    lock.releaseLock();
  }
}

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().toLowerCase();
}

function byPosition_(a, b) {
  return a.position - b.position || a.created_at - b.created_at;
}
