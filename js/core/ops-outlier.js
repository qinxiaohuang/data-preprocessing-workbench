/* =========================================================
 * core/ops-outlier.js — 异常值检测与处理
 * 原则4：默认只打标记（*_outlier_flag），不盲删；删除/截尾需用户明确选择
 * 依赖：table.js / audit.js
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const METHODS = ['iqr', 'zscore', 'range'];

  /**
   * 检测
   * @param {Object} p {column, method:'iqr'|'zscore'|'range', min?, max?, zThreshold?}
   */
  function detectOutliers(table, p) {
    const colIdx = C.colIndex(table, p.column);
    if (colIdx < 0) throw new Error('列不存在：' + p.column);
    const type = table.columns[colIdx].type;
    if (type !== 'number' && type !== 'number-string') {
      throw new Error('列「' + p.column + '」不是数值列，无法做异常检测');
    }
    if (!METHODS.includes(p.method)) throw new Error('未知方法：' + p.method);
    if (p.method === 'range' && (typeof p.min !== 'number' || typeof p.max !== 'number')) {
      throw new Error('自定义区间需要提供数值型 min 和 max');
    }
    if (p.method === 'range' && p.min > p.max) throw new Error('min 不能大于 max');

    const values = table.rows.map(function (r) { return r[colIdx]; });
    let lower = null, upper = null;

    if (p.method === 'iqr') {
      const r = C.iqrOutliers(values);
      lower = r.lower; upper = r.upper;
    } else if (p.method === 'zscore') {
      const s = C.numericStats(values);
      const zt = p.zThreshold || 3;
      if (s.stdev === null || s.stdev === 0) {
        return { lower: null, upper: null, indexes: [], count: 0, method: p.method, column: p.column };
      }
      lower = s.mean - zt * s.stdev;
      upper = s.mean + zt * s.stdev;
    } else {
      lower = p.min; upper = p.max;
    }

    const indexes = [];
    values.forEach(function (v, i) {
      if (C.isNull(v)) return;
      const n = C.toNumber(v);
      if (n === null) return;
      if (n < lower || n > upper) indexes.push(i);
    });
    return { lower: lower, upper: upper, indexes: indexes, count: indexes.length, method: p.method, column: p.column };
  }

  /**
   * 处理
   * @param {Object} p 检测参数 + { action:'flag'|'delete'|'winsorize', flagName? }
   */
  function applyOutlier(table, p) {
    const det = detectOutliers(table, p);
    const colIdx = C.colIndex(table, p.column);
    const action = p.action || 'flag';

    if (action === 'flag') {
      // 默认动作：新增 *_outlier_flag 标记列，不删行
      const flagName = p.flagName || (p.column + '_outlier_flag');
      const flagIdx = C.colIndex(table, flagName);
      const outlierSet = new Set(det.indexes);
      let columns, rows;
      if (flagIdx >= 0) {
        columns = table.columns.map(function (c) { return { name: c.name, type: c.type }; });
        rows = table.rows.map(function (r, i) {
          const nr = r.slice();
          nr[flagIdx] = outlierSet.has(i) ? 1 : 0;
          return nr;
        });
      } else {
        columns = table.columns.map(function (c) { return { name: c.name, type: c.type }; });
        columns.push({ name: flagName, type: 'number' });
        rows = table.rows.map(function (r, i) {
          const nr = r.slice();
          nr.push(outlierSet.has(i) ? 1 : 0);
          return nr;
        });
      }
      return {
        table: C.createTable(table.name, columns, rows),
        info: { action: 'flag', flagged: det.count, flagColumn: flagName, deleted: 0, capped: 0, bounds: { lower: det.lower, upper: det.upper } }
      };
    }

    if (action === 'delete') {
      const removeSet = new Set(det.indexes);
      const rows = table.rows.filter(function (_, i) { return !removeSet.has(i); });
      return {
        table: C.createTable(table.name, table.columns, rows),
        info: { action: 'delete', flagged: det.count, deleted: det.count, capped: 0, flagColumn: null, bounds: { lower: det.lower, upper: det.upper } }
      };
    }

    if (action === 'winsorize') {
      // 截尾：把超出上下界的值缩到边界
      const rows = table.rows.map(function (r) { return r.slice(); });
      let capped = 0;
      det.indexes.forEach(function (i) {
        const n = C.toNumber(rows[i][colIdx]);
        if (n === null) return;
        rows[i][colIdx] = n < det.lower ? det.lower : (n > det.upper ? det.upper : n);
        capped++;
      });
      return {
        table: C.createTable(table.name, table.columns, rows),
        info: { action: 'winsorize', flagged: det.count, deleted: 0, capped: capped, flagColumn: null, bounds: { lower: det.lower, upper: det.upper } }
      };
    }

    throw new Error('未知动作：' + action);
  }

  const api = { detectOutliers: detectOutliers, applyOutlier: applyOutlier };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
