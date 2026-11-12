const TaskService = (() => {
  const sheet_ = () => CONFIG.SHEETS.TASKS;

  function toDto_(row, images) {
    return {
      task_id: row.task_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      created_at: row.created_at,
      updated_at: row.updated_at,
      position: row.position,
      images: images || [],
    };
  }

  function findRow_(rows, taskId) {
    const row = rows.filter((r) => r.task_id === taskId)[0];
    if (!row) throw new AppError('NOT_FOUND', 'ไม่พบงานนี้ อาจถูกลบไปแล้ว');
    return row;
  }

  function nextTimestamp_(row) {
    return Math.max(Date.now(), (row.updated_at || 0) + 1);
  }

  function endPosition_(rows) {
    const max = rows.reduce((acc, r) => Math.max(acc, r.position), 0);
    return max + CONFIG.POSITION_STEP;
  }

  function list() {
    const images = ImageService.groupByTask(Db.readAll(CONFIG.SHEETS.IMAGES));
    return Db.readAll(sheet_())
      .sort(byPosition_)
      .map((row) => toDto_(row, images[row.task_id]));
  }

  function create(input, requestId) {
    const fields = Validation.taskInput(input);
    const reqId = Validation.requestId(requestId);

    return withWriteLock_(() => {
      const cache = CacheService.getScriptCache();
      const cacheKey = reqId ? 'create:' + reqId : null;
      if (cacheKey) {
        const cached = cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
      }

      const rows = Db.readAll(sheet_());
      const now = Date.now();
      const record = {
        task_id: newId_('t'),
        title: fields.title,
        description: fields.description,
        status: fields.status,
        priority: fields.priority,
        created_at: now,
        updated_at: now,
        position: endPosition_(rows),
      };
      Db.append(sheet_(), [record]);

      const dto = toDto_(record, []);
      if (cacheKey) cache.put(cacheKey, JSON.stringify(dto), CONFIG.IDEMPOTENCY_TTL_SECONDS);
      return dto;
    });
  }

  function update(taskId, input, expectedUpdatedAt, removeImageIds) {
    const id = Validation.taskId(taskId);
    const fields = Validation.taskInput(input);
    const expected = Validation.version(expectedUpdatedAt);
    const removeIds = Validation.imageIdList(removeImageIds);

    return withWriteLock_(() => {
      const row = findRow_(Db.readAll(sheet_()), id);
      if (expected !== null && row.updated_at !== expected) {
        throw new AppError(
          'CONFLICT',
          'งานนี้ถูกแก้ไขโดยอีกคนระหว่างที่คุณแก้ กรุณาปิดหน้าต่างแล้วเปิดงานใหม่เพื่อดูข้อมูลล่าสุด'
        );
      }

      row.title = fields.title;
      row.description = fields.description;
      row.status = fields.status;
      row.priority = fields.priority;
      row.updated_at = nextTimestamp_(row);
      Db.update(sheet_(), [row]);

      if (removeIds.length) ImageService.removeImages_(id, removeIds);
      return toDto_(row, ImageService.listForTask(id));
    });
  }

  /**
   * Moves a task into `status`, placed before `beforeTaskId` or at the end of
   * that column. Returns every task whose position changed.
   */
  function move(taskId, status, beforeTaskId) {
    const id = Validation.taskId(taskId);
    const target = Validation.status(status);
    const beforeId = Validation.optionalTaskId(beforeTaskId);
    if (beforeId === id) throw new AppError('VALIDATION', 'ตำแหน่งที่ย้ายไปไม่ถูกต้อง');

    return withWriteLock_(() => {
      const rows = Db.readAll(sheet_());
      const row = findRow_(rows, id);
      const column = rows.filter((r) => r.status === target && r.task_id !== id).sort(byPosition_);
      const found = beforeId ? column.findIndex((r) => r.task_id === beforeId) : -1;
      const index = found === -1 ? column.length : found;
      const changed = placeInColumn_(row, column, index);

      row.status = target;
      changed.forEach((r) => {
        r.updated_at = nextTimestamp_(r);
      });
      Db.update(sheet_(), changed);

      const images = ImageService.groupByTask(Db.readAll(CONFIG.SHEETS.IMAGES));
      return changed.map((r) => toDto_(r, images[r.task_id]));
    });
  }

  function placeInColumn_(row, column, index) {
    const prev = column[index - 1];
    const next = column[index];
    const step = CONFIG.POSITION_STEP;

    if (!prev && !next) return [row];
    if (!prev) {
      row.position = next.position - step;
      return [row];
    }
    if (!next) {
      row.position = prev.position + step;
      return [row];
    }
    if (next.position - prev.position > CONFIG.MIN_POSITION_GAP * 2) {
      row.position = (prev.position + next.position) / 2;
      return [row];
    }

    const ordered = column.slice(0, index).concat([row], column.slice(index));
    const base = ordered[0].position;
    ordered.forEach((r, i) => {
      r.position = base + i * step;
    });
    return ordered;
  }

  function remove(taskId) {
    const id = Validation.taskId(taskId);
    return withWriteLock_(() => {
      const row = findRow_(Db.readAll(sheet_()), id);
      const removedImages = ImageService.removeImages_(id, null);
      Db.remove(sheet_(), [row]);
      return { task_id: id, removed_images: removedImages };
    });
  }

  return { list, create, update, move, remove };
})();
