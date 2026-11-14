const LinkService = (() => {
  const sheet_ = () => CONFIG.SHEETS.LINKS;

  function toDto_(row) {
    return { link_id: row.link_id, url: row.url };
  }

  function byCreated_(a, b) {
    return a.created_at - b.created_at || a._row - b._row;
  }

  function groupByTask(rows) {
    const groups = {};
    rows.slice().sort(byCreated_).forEach((row) => {
      (groups[row.task_id] = groups[row.task_id] || []).push(toDto_(row));
    });
    return groups;
  }

  function sameLinks_(existing, links) {
    return existing.length === links.length && existing.every((row, i) => row.url === links[i].url);
  }

  /** Caller must already hold the write lock. Rewrites the task's links only when they changed. */
  function replaceForTask_(taskId, links) {
    const existing = Db.readAll(sheet_())
      .filter((row) => row.task_id === taskId)
      .sort(byCreated_);
    if (sameLinks_(existing, links)) return;

    Db.remove(sheet_(), existing);
    const now = Date.now();
    Db.append(
      sheet_(),
      links.map((link, i) => ({
        link_id: newId_('l'),
        task_id: taskId,
        url: link.url,
        created_at: now + i,
      }))
    );
  }

  /** Caller must already hold the write lock. */
  function removeForTask_(taskId) {
    const targets = Db.readAll(sheet_()).filter((row) => row.task_id === taskId);
    Db.remove(sheet_(), targets);
    return targets.length;
  }

  function listForTask(taskId) {
    return groupByTask(Db.readAll(sheet_()))[taskId] || [];
  }

  return { groupByTask, listForTask, replaceForTask_, removeForTask_ };
})();
