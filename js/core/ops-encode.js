/* =========================================================
 * core/ops-encode.js — 类别编码：One-Hot / 顺序编码
 * 原则：保留原列，只新增编码列；高基数列给出提示
 * 依赖：table.js / ops-type.js（formatDate）
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const METHODS = ['onehot', 'ordinal'];
  const HIGH_CARDINALITY = 20; // 唯一值超过此数提示慎用 One-Hot

  function valueLabel(v) {
    if (v instanceof Date) return C.formatDate(v);
    return String(v);
  }

  // 收集唯一值（按首次出现顺序，稳定可预期）与频次；空值跳过
  function collectCategories(table, idx) {
    const order = [];
    const seen = new Map(); // key -> {label, count}
    table.rows.forEach(function (r) {
      const v = r[idx];
      if (C.isNull(v)) return;
      const key = typeof v + ':' + (v instanceof Date ? v.getTime() : v);
      if (!seen.has(key)) {
        const item = { value: valueLabel(v), count: 0 };
        seen.set(key, item);
        order.push(item);
      }
      seen.get(key).count++;
    });
    return order; // [{value, count}]
  }

  function resolve(table, p) {
    const idx = C.colIndex(table, p.column);
    if (idx < 0) throw new Error('列不存在：' + p.column);
    if (!METHODS.includes(p.method)) throw new Error('未知编码方法：' + p.method);
    return idx;
  }

  /**
   * 编码预演：不修改数据
   * @param p {column, method:'onehot'|'ordinal', order?:[自定义次序（顺序编码必填）]}
   * @returns {column, method, uniqueCount, values:[{value,count}], newColumns?, mapping?, highCardinality, warning?}
   */
  function encodePreview(table, p) {
    const idx = resolve(table, p);
    const cats = collectCategories(table, idx);
    const base = {
      column: p.column,
      method: p.method,
      uniqueCount: cats.length,
      values: cats,
      highCardinality: p.method === 'onehot' && cats.length > HIGH_CARDINALITY
    };
    if (base.highCardinality) {
      base.warning = '唯一值有 ' + cats.length + ' 个，One-Hot 会生成大量新列，建议改用顺序编码或先分箱';
    }
    if (p.method === 'onehot') {
      base.newColumns = cats.map(function (c) { return p.column + '_' + c.value; });
      // 新列名冲突检查
      base.newColumns.forEach(function (n) {
        if (C.colIndex(table, n) >= 0) throw new Error('将生成的新列「' + n + '」与现有列重名，请先重命名');
      });
    } else {
      if (!Array.isArray(p.order) || !p.order.length) throw new Error('顺序编码需要自定义次序（order）');
      const mapping = {};
      p.order.forEach(function (v, i) { mapping[String(v)] = i + 1; }); // 1 基：低=1 中=2 高=3
      base.mapping = mapping;
      base.unmapped = cats.filter(function (c) { return !(c.value in mapping); }).map(function (c) { return c.value; });
      const encName = p.column + '_编码';
      if (C.colIndex(table, encName) >= 0) throw new Error('将生成的新列「' + encName + '」与现有列重名，请先重命名');
      base.newColumns = [encName];
    }
    return base;
  }

  /**
   * 执行编码
   * @returns {table, info:{method, column, added, newColumns, mapping?, highCardinality}}
   */
  function applyEncode(table, p) {
    const idx = resolve(table, p);
    const prev = encodePreview(table, p); // 复用校验与映射
    const columns = table.columns.map(function (c) { return { name: c.name, type: c.type }; });
    prev.newColumns.forEach(function (n) { columns.push({ name: n, type: 'number' }); });
    const start = table.columns.length;

    const rows = table.rows.map(function (r) {
      const nr = r.slice();
      const v = r[idx];
      if (p.method === 'onehot') {
        const label = C.isNull(v) ? null : valueLabel(v);
        for (let j = 0; j < prev.values.length; j++) {
          nr.push(label !== null && prev.values[j].value === label ? 1 : 0);
        }
      } else {
        const code = C.isNull(v) ? null : (prev.mapping[valueLabel(v)] !== undefined ? prev.mapping[valueLabel(v)] : null);
        nr.push(code);
      }
      return nr;
    });

    return {
      table: C.createTable(table.name, columns, rows),
      info: {
        method: p.method,
        column: p.column,
        added: prev.newColumns.length,
        newColumns: prev.newColumns,
        mapping: p.method === 'ordinal' ? prev.mapping : null,
        highCardinality: prev.highCardinality
      }
    };
  }

  const api = { encodePreview: encodePreview, applyEncode: applyEncode };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
