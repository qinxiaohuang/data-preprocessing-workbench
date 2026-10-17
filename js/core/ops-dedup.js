/* =========================================================
 * core/ops-dedup.js — 重复值处理
 * 依赖：table.js / audit.js
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  /**
   * 去重
   * @param {Table} table
   * @param {Object} opts { keyColumns: string[] 列名，空=整行判重；keep: 'first'|'last' }
   * @returns {table, removedIndexes, removedCount, groups}
   */
  function dedupRows(table, opts) {
    opts = opts || {};
    const keep = opts.keep === 'last' ? 'last' : 'first';
    const keyIdxs = (opts.keyColumns || []).map(function (n) { return C.colIndex(table, n); });
    keyIdxs.forEach(function (i, k) {
      if (i < 0) throw new Error('判重列不存在：' + opts.keyColumns[k]);
    });

    const dup = C.duplicateGroups(table.rows, keyIdxs);
    const removeSet = new Set();
    dup.groups.forEach(function (idxs) {
      idxs.forEach(function (i, rank) {
        const isKeeper = keep === 'first' ? rank === 0 : rank === idxs.length - 1;
        if (!isKeeper) removeSet.add(i);
      });
    });

    const removedIndexes = [...removeSet].sort(function (a, b) { return a - b; });
    const keptRows = table.rows.filter(function (_, i) { return !removeSet.has(i); });
    const newTable = C.createTable(table.name, table.columns, keptRows);
    return { table: newTable, removedIndexes: removedIndexes, removedCount: removedIndexes.length, groups: dup.groups };
  }

  const api = { dedupRows: dedupRows };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
