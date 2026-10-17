/* =========================================================
 * core/audit.js — 体检报告（先审计，后清洗：原则1）
 * 依赖：table.js
 * ======================================================= */
(function (global) {
  'use strict';
  // 延迟解析 DPCore，保证核心文件任意加载顺序都可用
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const iqrK = 1.5;

  /* ---------- 重复检测（供体检与去重模块共用） ---------- */

  // keyIdxs: 参与判重的列下标；空数组 = 整行判重
  // 返回 { groups: [[i1,i2,...]...] 每组为完全相同(仅 key 列)的行下标, dupCount: 多余行数 }
  function duplicateGroups(rows, keyIdxs) {
    const map = new Map();
    rows.forEach(function (r, i) {
      const key = keyIdxs.length
        ? keyIdxs.map(function (j) { return cellKey(r[j]); }).join('\u0001')
        : r.map(cellKey).join('\u0001');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    });
    const groups = [];
    let dupCount = 0;
    map.forEach(function (idxs) {
      if (idxs.length > 1) { groups.push(idxs); dupCount += idxs.length - 1; }
    });
    return { groups: groups, dupCount: dupCount };
  }

  function cellKey(v) {
    if (C.isNull(v)) return '\u0002';
    if (v instanceof Date) return 'D' + v.getTime();
    if (typeof v === 'number') return 'N' + v;
    if (typeof v === 'boolean') return 'B' + v;
    return 'S' + String(v);
  }

  /* ---------- IQR 异常检测（供体检与异常值模块共用） ---------- */

  // 返回 { lower, upper, indexes: 异常行下标数组 }
  function iqrOutliers(values) {
    const s = C.numericStats(values);
    if (s.count === 0 || s.q1 === null) return { lower: null, upper: null, indexes: [] };
    const iqr = s.q3 - s.q1;
    const lower = s.q1 - iqrK * iqr;
    const upper = s.q3 + iqrK * iqr;
    const indexes = [];
    values.forEach(function (v, i) {
      if (C.isNull(v)) return;
      const n = C.toNumber(v);
      if (n === null) return;
      if (n < lower || n > upper) indexes.push(i);
    });
    return { lower: lower, upper: upper, indexes: indexes };
  }

  /* ---------- 单列详情（点击列名展开） ---------- */

  function columnDetail(table, colName) {
    const values = C.columnValues(table, colName);
    const type = table.columns[C.colIndex(table, colName)].type;
    const uniq = C.uniqCount(values);
    const missing = values.filter(C.isNull).length;
    const detail = { name: colName, type: type, missing: missing, uniq: uniq };

    if (type === 'number' || type === 'number-string') {
      detail.stats = C.numericStats(values);
      detail.outlier = iqrOutliers(values);
    } else if (type === 'date' || type === 'date-string') {
      const ds = values.filter(function (v) { return !C.isNull(v); })
        .map(function (v) { return v instanceof Date ? v : C.parseDate(v); })
        .filter(Boolean)
        .map(function (d) { return d.getTime(); });
      ds.sort(function (a, b) { return a - b; });
      detail.minDate = ds.length ? new Date(ds[0]) : null;
      detail.maxDate = ds.length ? new Date(ds[ds.length - 1]) : null;
      detail.top = topFreq(values, 10);
    } else {
      detail.top = topFreq(values, 10);
    }
    return detail;
  }

  function topFreq(values, n) {
    const freq = new Map();
    for (const v of values) {
      if (C.isNull(v)) continue;
      const k = cellKey(v);
      const prev = freq.get(k);
      freq.set(k, { raw: prev ? prev.raw : v, count: (prev ? prev.count : 0) + 1 });
    }
    return [...freq.values()].sort(function (a, b) { return b.count - a.count; }).slice(0, n);
  }

  /* ---------- 体检报告 ---------- */

  function auditTable(table) {
    const n = table.rows.length;
    const colReports = table.columns.map(function (col) {
      const values = table.rows.map(function (r) { return r[table.columns.indexOf(col)]; });
      const missing = values.filter(C.isNull).length;
      const uniq = C.uniqCount(values);
      const missingRate = n ? missing / n : 0;
      const hints = [];
      let outlierCount = 0;

      if (col.type === 'number-string') hints.push('纯数字文本（建议转数字）');
      if (col.type === 'date-string') hints.push('疑似日期文本（建议转日期）');
      if (col.type === 'mixed') hints.push('混合类型（含多种格式的值）');
      if (n > 1 && missingRate > 0.3) hints.push('缺失率较高（' + Math.round(missingRate * 100) + '%）');
      if (n > 1 && uniq === 1) hints.push('整列只有一个值');
      if (uniq === 2) hints.push('唯一值仅 2 个（适合标记/One-Hot）');
      if ((n > 20 ? uniq / n > 0.9 : uniq / n >= 0.8) && uniq > 3) hints.push('疑似主键/编号列');

      if (col.type === 'number' || col.type === 'number-string') {
        const out = iqrOutliers(values);
        outlierCount = out.indexes.length;
        if (outlierCount > 0) hints.push('含 ' + outlierCount + ' 个疑似异常值（IQR）');
      }
      if (col.type === 'string') {
        const ws = values.filter(function (v) {
          return typeof v === 'string' && v !== '' && v.trim() !== v;
        }).length;
        if (ws > 0) hints.push(ws + ' 个值首尾有空格');
      }
      return {
        name: col.name, type: col.type, missing: missing,
        missingRate: missingRate, uniq: uniq, hints: hints, outlierCount: outlierCount
      };
    });

    const keyIdxs = table.columns.map(function (_, i) { return i; });
    const dup = duplicateGroups(table.rows, keyIdxs);

    return {
      rowCount: n,
      colCount: table.columns.length,
      duplicateRowCount: dup.dupCount,
      missingCells: colReports.reduce(function (a, c) { return a + c.missing; }, 0),
      columns: colReports
    };
  }

  const api = {
    duplicateGroups: duplicateGroups,
    iqrOutliers: iqrOutliers,
    columnDetail: columnDetail,
    auditTable: auditTable,
    cellKey: cellKey
  };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
