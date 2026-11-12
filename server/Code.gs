/**
 * Public entry points. Every function here without a trailing underscore is
 * callable from the browser through google.script.run.
 */

function doGet() {
  const template = HtmlService.createTemplateFromFile('client/Index');
  const initial = respond_(() => ({ tasks: TaskService.list() }));
  template.initialData = serializeForScript_(initial.ok ? initial.data : null);
  return template
    .evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(path) {
  return HtmlService.createHtmlOutputFromFile(path).getContent();
}

// Escapes "<" so embedded JSON cannot close the surrounding <script> tag.
function serializeForScript_(value) {
  const unsafe = new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  return JSON.stringify(value).replace(unsafe, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Run once from the editor to authorise scopes and create the sheet and folder. */
function setup() {
  ensureResources_();
  const spreadsheet = SpreadsheetApp.openById(getResourceId_('SPREADSHEET_ID'));
  const folder = DriveApp.getFolderById(getResourceId_('IMAGE_FOLDER_ID'));
  console.log('Spreadsheet: ' + spreadsheet.getName() + ' (' + spreadsheet.getId() + ')');
  console.log('Image folder: ' + folder.getName() + ' (' + folder.getId() + ')');
}

function apiListTasks() {
  return respond_(() => ({ tasks: TaskService.list() }));
}

function apiCreateTask(input, requestId) {
  return respond_(() => ({ task: TaskService.create(input, requestId) }));
}

function apiUpdateTask(taskId, input, expectedUpdatedAt, removeImageIds) {
  return respond_(() => ({ task: TaskService.update(taskId, input, expectedUpdatedAt, removeImageIds) }));
}

function apiMoveTask(taskId, status, beforeTaskId) {
  return respond_(() => ({ tasks: TaskService.move(taskId, status, beforeTaskId) }));
}

function apiDeleteTask(taskId) {
  return respond_(() => TaskService.remove(taskId));
}

function apiUploadImage(taskId, file) {
  return respond_(() => ({ image: ImageService.upload(taskId, file) }));
}

function apiGetImageData(imageId, variant) {
  return respond_(() => ImageService.getData(imageId, variant));
}
