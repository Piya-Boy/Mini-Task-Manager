const Validation = (() => {
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const TASK_ID = new RegExp('^t_' + UUID + '$');
  const IMAGE_ID = new RegExp('^i_' + UUID + '$');
  const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
  const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const VARIANTS = ['thumb', 'full'];

  function fail_(message) {
    throw new AppError('VALIDATION', message);
  }

  function isPlainObject_(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function taskId(value) {
    if (typeof value !== 'string' || !TASK_ID.test(value)) fail_('รหัสงานไม่ถูกต้อง');
    return value;
  }

  function imageId(value) {
    if (typeof value !== 'string' || !IMAGE_ID.test(value)) fail_('รหัสรูปไม่ถูกต้อง');
    return value;
  }

  function optionalTaskId(value) {
    return value === null || value === undefined || value === '' ? null : taskId(value);
  }

  function imageIdList(value) {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value) || value.length > CONFIG.LIMITS.IMAGES_PER_TASK) fail_('รายการรูปไม่ถูกต้อง');
    return value.map(imageId).filter((id, i, all) => all.indexOf(id) === i);
  }

  function status(value) {
    if (CONFIG.STATUSES.indexOf(value) === -1) fail_('สถานะไม่ถูกต้อง');
    return value;
  }

  function priority(value) {
    if (value === null || value === undefined || value === '') return '';
    if (CONFIG.PRIORITIES.indexOf(value) === -1) fail_('ระดับความสำคัญไม่ถูกต้อง');
    return value;
  }

  function title_(value) {
    const text = typeof value === 'string' ? value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim() : '';
    if (!text) fail_('กรุณาใส่ชื่องาน');
    if (text.length > CONFIG.LIMITS.TITLE_MAX) fail_('ชื่องานยาวเกิน ' + CONFIG.LIMITS.TITLE_MAX + ' ตัวอักษร');
    return text;
  }

  function description_(value) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string') fail_('รายละเอียดไม่ถูกต้อง');
    const text = value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
    if (text.length > CONFIG.LIMITS.DESCRIPTION_MAX) {
      fail_('รายละเอียดยาวเกิน ' + CONFIG.LIMITS.DESCRIPTION_MAX + ' ตัวอักษร');
    }
    return text;
  }

  function taskInput(input) {
    if (!isPlainObject_(input)) fail_('ข้อมูลงานไม่ถูกต้อง');
    return {
      title: title_(input.title),
      description: description_(input.description),
      status: status(input.status),
      priority: priority(input.priority),
    };
  }

  function requestId(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || !REQUEST_ID.test(value)) fail_('รหัสคำขอไม่ถูกต้อง');
    return value;
  }

  function version(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'number' || !isFinite(value) || value < 0) fail_('ข้อมูลเวอร์ชันของงานไม่ถูกต้อง');
    return value;
  }

  function imageVariant(value) {
    if (VARIANTS.indexOf(value) === -1) fail_('ชนิดรูปไม่ถูกต้อง');
    return value;
  }

  function fileName_(value) {
    const base = typeof value === 'string' ? value.split(/[\\/]/).pop() : '';
    const clean = base.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
    return (clean || 'image').slice(0, CONFIG.LIMITS.FILE_NAME_MAX);
  }

  function matchesSignature_(bytes, mimeType) {
    const b = (i) => (i < bytes.length ? bytes[i] & 0xff : -1);
    if (mimeType === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
    if (mimeType === 'image/png') {
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b(i) === v);
    }
    if (mimeType === 'image/webp') {
      const riff = [0x52, 0x49, 0x46, 0x46].every((v, i) => b(i) === v);
      const webp = [0x57, 0x45, 0x42, 0x50].every((v, i) => b(i + 8) === v);
      return riff && webp;
    }
    return false;
  }

  function imageUpload(file) {
    if (!isPlainObject_(file)) fail_('ข้อมูลไฟล์ไม่ถูกต้อง');
    const name = fileName_(file.name);
    const mimeType = file.mimeType;
    if (CONFIG.IMAGE_MIME_TYPES.indexOf(mimeType) === -1) fail_(name + ' — ไม่ใช่ไฟล์ JPG, PNG หรือ WebP');

    const data = file.data;
    const maxEncoded = Math.ceil(CONFIG.LIMITS.IMAGE_MAX_BYTES / 3) * 4;
    if (typeof data !== 'string' || !data.length) fail_(name + ' — ไฟล์ว่างหรือเสียหาย');
    if (data.length > maxEncoded) fail_(name + ' — ขนาดเกิน 8 MB');
    if (!BASE64.test(data)) fail_(name + ' — ไฟล์เสียหาย');

    const bytes = Utilities.base64Decode(data);
    if (!bytes.length) fail_(name + ' — ไฟล์ว่างหรือเสียหาย');
    if (bytes.length > CONFIG.LIMITS.IMAGE_MAX_BYTES) fail_(name + ' — ขนาดเกิน 8 MB');
    if (!matchesSignature_(bytes, mimeType)) fail_(name + ' — เนื้อไฟล์ไม่ตรงกับชนิด JPG, PNG หรือ WebP');

    return { name, mimeType, bytes };
  }

  return {
    taskId,
    imageId,
    optionalTaskId,
    imageIdList,
    status,
    priority,
    taskInput,
    requestId,
    version,
    imageVariant,
    imageUpload,
  };
})();
