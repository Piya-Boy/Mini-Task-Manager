const CONFIG = Object.freeze({
  APP_TITLE: 'Mini Tasks',
  SPREADSHEET_NAME: 'Mini Tasks Data',
  IMAGE_FOLDER_NAME: 'Mini Tasks Images',

  // Existing spreadsheet and Drive folder to use. Leave empty to fall back to
  // Script Properties, then to creating new ones on first run.
  RESOURCE_IDS: Object.freeze({
    SPREADSHEET_ID: '1rjxhkKGdB4YUC5Iaxct75t5fsK-sYmIZg3TKEkrCMJs',
    IMAGE_FOLDER_ID: '1pe7XKonT1PI7BBzqnkISF8K8P5E78oBR',
  }),

  // Script Property names, not values.
  PROPERTY_KEYS: Object.freeze({
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    IMAGE_FOLDER_ID: 'IMAGE_FOLDER_ID',
  }),

  SHEETS: Object.freeze({
    TASKS: Object.freeze({
      name: 'Tasks',
      headers: ['task_id', 'title', 'description', 'status', 'priority', 'created_at', 'updated_at', 'position'],
      userText: ['title', 'description'],
      numeric: ['created_at', 'updated_at', 'position'],
    }),
    IMAGES: Object.freeze({
      name: 'Images',
      headers: ['image_id', 'task_id', 'drive_file_id', 'file_name', 'mime_type', 'size_bytes', 'created_at'],
      userText: ['file_name'],
      numeric: ['size_bytes', 'created_at'],
    }),
    LINKS: Object.freeze({
      name: 'Links',
      headers: ['link_id', 'task_id', 'url', 'created_at'],
      userText: ['url'],
      numeric: ['created_at'],
    }),
  }),

  STATUSES: Object.freeze(['todo', 'in_progress', 'done']),
  PRIORITIES: Object.freeze(['low', 'medium', 'high']),

  LIMITS: Object.freeze({
    TITLE_MAX: 200,
    DESCRIPTION_MAX: 5000,
    FILE_NAME_MAX: 120,
    FILES_PER_TASK: 10,
    LINKS_PER_TASK: 10,
    LINK_URL_MAX: 2000,
    FILE_MAX_BYTES: 8 * 1024 * 1024,
  }),

  // Attachments by file extension. `kind` is what the file content must look like.
  // Images, PDF, ZIP/OLE containers are checked by magic bytes; text kinds must contain no NUL byte.
  FILE_TYPES: Object.freeze({
    jpg: { mime: 'image/jpeg', kind: 'jpeg' },
    jpeg: { mime: 'image/jpeg', kind: 'jpeg' },
    png: { mime: 'image/png', kind: 'png' },
    webp: { mime: 'image/webp', kind: 'webp' },
    pdf: { mime: 'application/pdf', kind: 'pdf' },
    doc: { mime: 'application/msword', kind: 'ole' },
    docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'zip' },
    xls: { mime: 'application/vnd.ms-excel', kind: 'ole' },
    xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'zip' },
    ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'ole' },
    pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'zip' },
    zip: { mime: 'application/zip', kind: 'zip' },
    txt: { mime: 'text/plain', kind: 'text' },
    csv: { mime: 'text/csv', kind: 'text' },
    md: { mime: 'text/markdown', kind: 'text' },
  }),

  LOCK_TIMEOUT_MS: 20000,
  POSITION_STEP: 1024,
  MIN_POSITION_GAP: 1e-6,
  IDEMPOTENCY_TTL_SECONDS: 600,
});
