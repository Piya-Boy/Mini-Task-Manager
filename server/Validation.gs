const Validation = (() => {
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const TASK_ID = new RegExp('^t_' + UUID + '$');
  const IMAGE_ID = new RegExp('^i_' + UUID + '$');
  const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
  const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const VARIANTS = ['thumb', 'full'];
  const ANY_CONTROL_CHAR = /[\u0000-\u001F\u007F]/;
  const LINK_URL = /^https?:\/\/[^\s\/?#]+\S*$/i;

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
    if (!Array.isArray(value) || value.length > CONFIG.LIMITS.FILES_PER_TASK) fail_('รายการไฟล์ไม่ถูกต้อง');
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

  function linkUrl_(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) fail_('กรุณาใส่ที่อยู่ลิงก์');
    if (text.length > CONFIG.LIMITS.LINK_URL_MAX) fail_('ลิงก์ยาวเกิน ' + CONFIG.LIMITS.LINK_URL_MAX + ' ตัวอักษร');
    if (!LINK_URL.test(text) || ANY_CONTROL_CHAR.test(text)) fail_('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
    return text;
  }

  /** Returns null when the caller did not send links, meaning "leave them unchanged". */
  function linkList(value) {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) fail_('รายการลิงก์ไม่ถูกต้อง');
    if (value.length > CONFIG.LIMITS.LINKS_PER_TASK) {
      fail_('แนบลิงก์ได้สูงสุด ' + CONFIG.LIMITS.LINKS_PER_TASK + ' ลิงก์ต่องาน');
    }
    return value.map((item) => {
      if (!isPlainObject_(item)) fail_('ข้อมูลลิงก์ไม่ถูกต้อง');
      return { url: linkUrl_(item.url) };
    });
  }

  function taskInput(input) {
    if (!isPlainObject_(input)) fail_('ข้อมูลงานไม่ถูกต้อง');
    return {
      title: title_(input.title),
      description: description_(input.description),
      status: status(input.status),
      priority: priority(input.priority),
      links: linkList(input.links),
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
    return base.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim() || 'file';
  }

  function extensionOf_(name) {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  }

  // Keeps the extension when a long name has to be cut.
  function shortName_(name) {
    const max = CONFIG.LIMITS.FILE_NAME_MAX;
    if (name.length <= max) return name;
    const ext = extensionOf_(name);
    if (!ext || ext.length > 10) return name.slice(0, max);
    return name.slice(0, max - ext.length - 1) + '.' + ext;
  }

  function sniff_(bytes) {
    const b = (i) => (i < bytes.length ? bytes[i] & 0xff : -1);
    const at = (offset, signature) => signature.every((v, i) => b(offset + i) === v);
    if (at(0, [0xff, 0xd8, 0xff])) return 'jpeg';
    if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
    if (at(0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
    if (at(0, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
    if (at(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
    return null;
  }

  const SNIFFED_MIME = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
  };

  /**
   * Content decides: a file that really is an image or PDF is accepted whatever it is called.
   * ZIP, Office and text files carry no distinguishing content, so their extension must be on the
   * list and agree with the content. The browser-supplied MIME type is never trusted.
   */
  function fileMimeType_(name, bytes) {
    const sniffed = sniff_(bytes);
    if (sniffed && SNIFFED_MIME[sniffed]) return SNIFFED_MIME[sniffed];

    const ext = extensionOf_(name);
    const spec = Object.prototype.hasOwnProperty.call(CONFIG.FILE_TYPES, ext) ? CONFIG.FILE_TYPES[ext] : null;
    if (!spec) {
      fail_(name + ' — ไม่รองรับไฟล์ชนิดนี้ (รับภาพ, PDF, Word, Excel, PowerPoint, txt, csv, md, zip)');
    }
    const matches = spec.kind === 'text' ? sniffed === null && bytes.indexOf(0) === -1 : spec.kind === sniffed;
    if (!matches) fail_(name + ' — เนื้อไฟล์ไม่ตรงกับนามสกุล');
    return spec.mime;
  }

  function fileUpload(file) {
    if (!isPlainObject_(file)) fail_('ข้อมูลไฟล์ไม่ถูกต้อง');
    const fullName = fileName_(file.name);
    const name = shortName_(fullName);

    const data = file.data;
    const maxEncoded = Math.ceil(CONFIG.LIMITS.FILE_MAX_BYTES / 3) * 4;
    if (typeof data !== 'string' || !data.length) fail_(name + ' — ไฟล์ว่างหรือเสียหาย');
    if (data.length > maxEncoded) fail_(name + ' — ขนาดเกิน 8 MB');
    if (!BASE64.test(data)) fail_(name + ' — ไฟล์เสียหาย');

    const bytes = Utilities.base64Decode(data);
    if (!bytes.length) fail_(name + ' — ไฟล์ว่างหรือเสียหาย');
    if (bytes.length > CONFIG.LIMITS.FILE_MAX_BYTES) fail_(name + ' — ขนาดเกิน 8 MB');

    return { name, mimeType: fileMimeType_(fullName, bytes), bytes };
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
    fileUpload,
  };
})();
