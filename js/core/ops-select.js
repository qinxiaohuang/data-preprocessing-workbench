/* =========================================================
 * core/ops-select.js — 字段筛选：选列 + 条件筛行
 * 供「字段筛选」模块实时预览（保留 X 行 Y 列）与执行
 * 依赖：table.js / ops-feature.js（evalCondition）
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const COMBINATORS = ['and', 'or'];

  function validateColumns(table, columns) {
    if (!Array.isArray(columns) || !columns.length) throw new Error('至少保留一列');
    const indexes = columns.map(function (name) {
      const i = C.colIndex(table, name);
      if (i < 0) throw new Error('列不存在：' + name);
      return i;
    });
    return indexes;
  }

  function validateConditions(table, conditions) {
    return (conditions || []).map(function (c) {
      const idx = C.colIndex(table, c.column);
      if (idx < 0) throw new Error('筛选条件引用了不存在的列：' + c.column);
      return { idx: idx, op: c.op, value: c.value };
    });
  }

  function rowPass(row, conds, combinator) {
    if (!conds.length) return true;
    const results = conds.map(function (c) { return C.evalCondition(row[c.idx], c.op, c.value); });
    return combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
  }

  /**
   * 实时预览：只算数量，不产出新表
   * @param p {columns?, conditions?:[{column,op,value}], combinator?:'and'|'or'}
   * @returns {rows, cols} 执行后将保留的行列数
   */
  function selectPreview(table, p) {
    p = p || {};
    const comb = p.combinator || 'and';
    if (!COMBINATORS.includes(comb)) throw new Error('未知条件组合方式：' + comb);
    const colIdxs = p.columns ? validateColumns(table, p.columns) : table.columns.map(function (_, i) { return i; });
    const conds = validateConditions(table, p.conditions);
    let rows = 0;
    table.rows.forEach(function (r) { if (rowPass(r, conds, comb)) rows++; });
    return { rows: rows, cols: colIdxs.length };
  }

  /**
   * 执行筛选：先筛行，再选列
   * @returns {table, info:{rowsBefore, rowsAfter, colsBefore, colsAfter, removedRows, removedCols, conditionCount}}
   */
  function applySelect(table, p) {
    p = p || {};
    const comb = p.combinator || 'and';
    if (!COMBINATORS.includes(comb)) throw new Error('未知条件组合方式：' + comb);
    const keepNames = p.columns ? p.columns.slice() : table.columns.map(function (c) { return c.name; });
    const colIdxs = validateColumns(table, keepNames);
    const conds = validateConditions(table, p.conditions);

    const keptRows = table.rows.filter(function (r) { return rowPass(r, conds, comb); });
    const columns = colIdxs.map(function (i) { return { name: table.columns[i].name, type: table.columns[i].type }; });
    const rows = keptRows.map(function (r) { return colIdxs.map(function (i) { return r[i]; }); });

    return {
      table: C.createTable(table.name, columns, rows),
      info: {
        rowsBefore: table.rows.length,
        rowsAfter: rows.length,
        colsBefore: table.columns.length,
        colsAfter: columns.length,
        removedRows: table.rows.length - rows.length,
        removedCols: table.columns.length - columns.length,
        conditionCount: conds.length,
        combinator: conds.length ? comb : null
      }
    };
  }

  const api = { selectPreview: selectPreview, applySelect: applySelect };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
