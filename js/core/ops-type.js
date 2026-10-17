/* =========================================================
 * core/ops-type.js — 数据类型转换（含转换预演）
 * 依赖：table.js
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const TARGETS = ['number', 'date', 'text'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatDate(d) {
    let s = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    if (d.getHours() || d.getMinutes() || d.getSeconds()) {
      s += ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      if (d.getSeconds()) s += ':' + pad2(d.getSeconds());
    }
    return s;
  }

  // 单值转换：返回 {ok:true, value} 或 {ok:false, value: 原值}
  function convertValue(v, target) {
    if (C.isNull(v)) return { ok: true, value: null, empty: true }; // 空值不算失败
    if (target === 'number') {
      const n = C.toNumber(v);
      return n === null ? { ok: false, value: v } : { ok: true, value: n };
    }
    if (target === 'date') {
      const d = C.parseDate(v);
      return d === null ? { ok: false, value: v } : { ok: true, value: d };
    }
    if (target === 'text') {
      if (v instanceof Date) return { ok: true, value: formatDate(v) };
      return { ok: true, value: typeof v === 'string' ? v : String(v) };
    }
    throw new Error('未知目标类型：' + target);
  }

  /**
   * 转换预演：不修改数据
   * @returns {okCount, failCount, emptyCount, failExamples:[{row,value}], sample:[前10行转换结果], targetType}
   */
  function convertPreview(table, p) {
    const colIdx = resolveColumn(table, p);
    const values = table.rows.map(function (r) { return r[colIdx]; });
    let okCount = 0, failCount = 0, emptyCount = 0;
    const failExamples = [];
    const sample = [];
    values.forEach(function (v, i) {
      const r = convertValue(v, p.targetType);
      if (r.empty) { emptyCount++; sample.push(null); return; }
      if (r.ok) {
        okCount++;
        if (sample.length < 10) sample.push(r.value);
      } else {
        failCount++;
        if (failExamples.length < 20) failExamples.push({ row: i, value: v });
        sample.push('(失败)');
      }
    });
    return { okCount: okCount, failCount: failCount, emptyCount: emptyCount, failExamples: failExamples, sample: sample, targetType: p.targetType };
  }

  /**
   * 执行转换
   * @param p {column, targetType, failStrategy:'null'|'keep'|'abort'}
   * @returns {table, info:{ok, fail, failed, targetType}}
   */
  function applyConvert(table, p) {
    const colIdx = resolveColumn(table, p);
    const strategy = p.failStrategy || 'null';
    if (!['null', 'keep', 'abort'].includes(strategy)) throw new Error('未知失败策略：' + strategy);

    let fail = 0, empty = 0;
    const rows = table.rows.map(function (r) { return r.slice(); });
    rows.forEach(function (r) {
      const res = convertValue(r[colIdx], p.targetType);
      if (res.empty) { r[colIdx] = null; empty++; return; }
      if (res.ok) { r[colIdx] = res.value; return; }
      fail++;
      if (strategy === 'null') r[colIdx] = null;
      // keep：保留原值
    });
    if (strategy === 'abort' && fail > 0) {
      throw new Error('有 ' + fail + ' 个值无法转换为目标类型，已按「中止」策略取消本次转换');
    }

    const columns = table.columns.map(function (c, i) {
      const nc = { name: c.name, type: c.type };
      if (i === colIdx) nc.type = p.targetType;
      return nc;
    });
    return {
      table: C.createTable(table.name, columns, rows),
      info: { ok: table.rows.length - empty - fail, fail: fail, failed: fail, empty: empty, targetType: p.targetType }
    };
  }

  function resolveColumn(table, p) {
    const colIdx = C.colIndex(table, p.column);
    if (colIdx < 0) throw new Error('列不存在：' + p.column);
    if (!TARGETS.includes(p.targetType)) throw new Error('未知目标类型：' + p.targetType);
    return colIdx;
  }

  const api = { convertPreview: convertPreview, applyConvert: applyConvert, convertValue: convertValue, formatDate: formatDate };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
