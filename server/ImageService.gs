const ImageService = (() => {
  const sheet_ = () => CONFIG.SHEETS.IMAGES;

  function toDto_(row) {
    return {
      image_id: row.image_id,
      drive_file_id: row.drive_file_id,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
    };
  }

  function byCreated_(a, b) {
    return a.created_at - b.created_at;
  }

  function groupByTask(rows) {
    const groups = {};
    rows.slice().sort(byCreated_).forEach((row) => {
      (groups[row.task_id] = groups[row.task_id] || []).push(toDto_(row));
    });
    return groups;
  }

  function listForTask(taskId) {
    return Db.readAll(sheet_())
      .filter((row) => row.task_id === taskId)
      .sort(byCreated_)
      .map(toDto_);
  }

  function getFolder_() {
    return DriveApp.getFolderById(getResourceId_('IMAGE_FOLDER_ID'));
  }

  // Link sharing lets browsers load Drive thumbnails directly; some Workspace
  // domains forbid it, in which case the client falls back to apiGetImageData.
  function shareByLink_(file) {
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (error) {
      console.warn('Link sharing unavailable: ' + error);
    }
  }

  /**
   * Deletes the file for good (no trash) through the Advanced Drive service. If that service is
   * unavailable or refuses, the file goes to the trash instead so a delete never fails halfway.
   */
  function removeDriveFile_(fileId) {
    try {
      Drive.Files.remove(fileId);
      return;
    } catch (error) {
      if (/not found/i.test(String(error && error.message))) return;
      console.warn('Permanent delete failed, moving to trash: ' + fileId + ' ' + error);
    }
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (error) {
      console.warn('Drive file already gone: ' + fileId);
    }
  }

  function upload(taskId, file) {
    const id = Validation.taskId(taskId);
    const image = Validation.fileUpload(file);

    return withWriteLock_(() => {
      const taskExists = Db.readAll(CONFIG.SHEETS.TASKS).some((row) => row.task_id === id);
      if (!taskExists) throw new AppError('NOT_FOUND', 'ไม่พบงานนี้ อาจถูกลบไปแล้ว');

      const count = Db.readAll(sheet_()).filter((row) => row.task_id === id).length;
      if (count >= CONFIG.LIMITS.FILES_PER_TASK) {
        throw new AppError('LIMIT', image.name + ' — งานนี้มีไฟล์ครบ ' + CONFIG.LIMITS.FILES_PER_TASK + ' ไฟล์แล้ว');
      }

      const blob = Utilities.newBlob(image.bytes, image.mimeType, image.name);
      const driveFile = getFolder_().createFile(blob);
      try {
        shareByLink_(driveFile);
        const record = {
          image_id: newId_('i'),
          task_id: id,
          drive_file_id: driveFile.getId(),
          file_name: image.name,
          mime_type: image.mimeType,
          size_bytes: image.bytes.length,
          created_at: Date.now(),
        };
        Db.append(sheet_(), [record]);
        return toDto_(record);
      } catch (error) {
        removeDriveFile_(driveFile.getId());
        throw error;
      }
    });
  }

  /** Caller must already hold the write lock. */
  function removeImages_(taskId, imageIds) {
    const targets = Db.readAll(sheet_()).filter(
      (row) => row.task_id === taskId && (!imageIds || imageIds.indexOf(row.image_id) !== -1)
    );
    targets.forEach((row) => removeDriveFile_(row.drive_file_id));
    Db.remove(sheet_(), targets);
    return targets.length;
  }

  function getData(imageId, variant) {
    const id = Validation.imageId(imageId);
    const kind = Validation.imageVariant(variant);
    const row = Db.readAll(sheet_()).filter((r) => r.image_id === id)[0];
    if (!row) return { missing: true };

    let file;
    try {
      file = DriveApp.getFileById(row.drive_file_id);
      if (file.isTrashed()) return { missing: true };
    } catch (error) {
      return { missing: true };
    }

    let blob = null;
    if (kind === 'thumb') {
      try {
        blob = file.getThumbnail();
      } catch (error) {
        blob = null;
      }
    }
    if (!blob) blob = file.getBlob();
    return {
      missing: false,
      dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()),
    };
  }

  return { groupByTask, listForTask, upload, removeImages_, getData };
})();
