/**
 * JSON endpoint for the page when it is hosted outside script.google.com.
 *
 * Google redirects signed-in users with several accounts to /macros/u/N/,
 * which fails for some accounts. A cross-origin fetch carries no Google
 * cookies, so calling this endpoint avoids that redirect.
 *
 * Request body (sent as text/plain to avoid a CORS preflight):
 *   { "fn": "apiListTasks", "args": [] }
 * Response: the same { ok, data | error } envelope as google.script.run.
 */

// Built per call: top-level references to functions in other files would
// depend on file load order.
function httpApiRoutes_() {
  return {
    apiListTasks,
    apiCreateTask,
    apiUpdateTask,
    apiMoveTask,
    apiDeleteTask,
    apiUploadImage,
    apiGetImageData,
  };
}

function doPost(e) {
  return jsonOutput_(handleHttpApi_(e));
}

function handleHttpApi_(e) {
  let request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (error) {
    return httpApiError_('คำขอไม่ถูกต้อง');
  }
  if (!request || typeof request !== 'object' || typeof request.fn !== 'string') {
    return httpApiError_('คำขอไม่ถูกต้อง');
  }
  const routes = httpApiRoutes_();
  if (!Object.prototype.hasOwnProperty.call(routes, request.fn)) {
    return httpApiError_('ไม่รู้จักคำสั่งนี้');
  }
  const args = Array.isArray(request.args) ? request.args : [];
  try {
    return routes[request.fn].apply(null, args);
  } catch (error) {
    console.error(error);
    return { ok: false, error: { code: 'INTERNAL', message: MESSAGES.INTERNAL } };
  }
}

function httpApiError_(message) {
  return { ok: false, error: { code: 'VALIDATION', message } };
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
