/* =========================================================
 * core/table.js — 数据表模型、类型推断、统计工具
 * 纯函数实现，无 DOM 依赖；浏览器与 Node 双端可用
 * 命名空间：DPCore
 * ======================================================= */
(function (global) {
  'use strict';

  /* ---------- 空值与基础判断 ---------- */

  function isNull(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  }

  function kindOf(v) {
    if (isNull(v)) return 'null';
    if (v instanceof Date) return 'date';
    return typeof v === 'number' ? 'number'
      : typeof v === 'boolean' ? 'boolean'
      : 'string';
  }

  /* ---------- 数值 ---------- */

  // 宽松转数字：支持千分位、百分号；失败返回 null
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      let s = v.trim();
      if (s === '') return null;
      let pct = false;
      if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
      s = s.replace(/,/g, '');
      if (!/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
      const n = Number(s);
      if (!isFinite(n)) return null;
      return pct ? n / 100 : n;
    }
    return null;
  }

  /* ---------- 日期 ---------- */

  // 字符串/Date → Date；不支持的格式返回 null
  // 支持：2024-01-05、2024/1/5、2024年1月5日、2024-01-05 13:30、2024/1/5 13:30:25
  function parseDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getTime());
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (s === '') return null;

    let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      return buildDate(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
    }
    return null;
  }

  function buildDate(y, mo, d, h, mi, sec) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
    const dt = new Date(y, mo - 1, d, h, mi, sec);
    // 回读校验，拒绝 2024-02-31 这类假日期
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  /* ---------- 列类型推断 ----------
   * 返回：number | date | boolean | string | number-string | date-string | mixed | empty
   * number-string = 全是数字却存成文本（体检重点提示）
   * date-string  = 全是日期却存成文本
   */
  function inferColumnType(values) {
    const vals = values.filter(function (v) { return !isNull(v); });
    if (vals.length === 0) return 'empty';
    const kinds = new Set(vals.map(kindOf));
    if (kinds.size > 1) return 'mixed';
    const k = kinds.values().next().value;
    if (k !== 'string') return k;
    if (vals.every(function (v) { return toNumber(v) !== null; })) return 'number-string';
    if (vals.every(function (v) { return parseDate(v) !== null; })) return 'date-string';
    // 多数像日期但混入脏值 → mixed（体检时提示用户处理）
    const dateN = vals.filter(function (v) { return parseDate(v) !== null; }).length;
    if (dateN / vals.length >= 0.5) return 'mixed';
    return 'string';
  }

  /* ---------- 数据表 ---------- */

  // columns: ['a','b'] 或 [{name,type}]；type 缺省时自动推断
  function createTable(name, columns, rows) {
    const cols = columns.map(function (c, i) {
      const cname = typeof c === 'string' ? c : String(c.name);
      let ctype = typeof c === 'string' ? null : c.type;
      if (!ctype) {
        ctype = inferColumnType(rows.map(function (r) { return r[i]; }));
      }
      return { name: cname, type: ctype };
    });
    return { name: name, columns: cols, rows: rows };
  }

  function cloneTable(t) {
    return {
      name: t.name,
      columns: t.columns.map(function (c) { return { name: c.name, type: c.type }; }),
      rows: t.rows.map(function (r) { return r.slice(); })
    };
  }

  function colIndex(table, name) {
    return table.columns.findIndex(function (c) { return c.name === name; });
  }

  function columnValues(table, name) {
    const i = colIndex(table, name);
    if (i < 0) throw new Error('列不存在：' + name);
    return table.rows.map(function (r) { return r[i]; });
  }

  /* ---------- 统计 ---------- */

  // 线性插值分位数（与 numpy/pandas 默认一致），输入必须已升序排序
  function quantileSorted(sorted, p) {
    if (!sorted.length) return null;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function numericStats(values) {
    const nums = [];
    let missing = 0;
    for (const v of values) {
      if (isNull(v)) { missing++; continue; }
      const n = toNumber(v);
      if (n === null) { missing++; continue; }
      nums.push(n);
    }
    nums.sort(function (a, b) { return a - b; });
    if (!nums.length) {
      return { count: 0, missing: missing, min: null, max: null, mean: null, median: null, q1: null, q3: null, stdev: null, sum: 0 };
    }
    const sum = nums.reduce(function (a, b) { return a + b; }, 0);
    const mean = sum / nums.length;
    let stdev = null;
    if (nums.length >= 2) {
      const ss = nums.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0);
      stdev = Math.sqrt(ss / (nums.length - 1));
    }
    return {
      count: nums.length,
      missing: missing,
      min: nums[0],
      max: nums[nums.length - 1],
      mean: mean,
      median: quantileSorted(nums, 0.5),
      q1: quantileSorted(nums, 0.25),
      q3: quantileSorted(nums, 0.75),
      stdev: stdev,
      sum: sum
    };
  }

  function uniqCount(values) {
    const seen = new Set();
    for (const v of values) {
      if (isNull(v)) continue;
      seen.add(v instanceof Date ? 'D:' + v.getTime() : typeof v + ':' + v);
    }
    return seen.size;
  }

  function modeOf(values) {
    const freq = new Map();
    for (const v of values) {
      if (isNull(v)) continue;
      const key = v instanceof Date ? 'D:' + v.getTime() : typeof v + ':' + v;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    let best = null, bestN = 0;
    freq.forEach(function (n, key) {
      if (n > bestN) { bestN = n; best = key; }
    });
    if (best === null) return null;
    const raw = best.startsWith('D:') ? new Date(+best.slice(2)) : best.slice(best.indexOf(':') + 1);
    return { value: raw, count: bestN };
  }

  /* ---------- 序列化（持久化 / .json 备份用；Date 需显式标记） ---------- */

  function cellToJSON(v) {
    if (v instanceof Date) return { $d: v.getTime() };
    return v;
  }

  function cellFromJSON(v) {
    if (v && typeof v === 'object' && typeof v.$d === 'number') return new Date(v.$d);
    return v;
  }

  function tableToJSON(t) {
    return {
      name: t.name,
      columns: t.columns.map(function (c) { return { name: c.name, type: c.type }; }),
      rows: t.rows.map(function (r) { return r.map(cellToJSON); })
    };
  }

  function tableFromJSON(o) {
    const rows = (o.rows || []).map(function (r) { return r.map(cellFromJSON); });
    return createTable(o.name, o.columns || [], rows);
  }

  /* ---------- 导出 ---------- */
  const api = {
    isNull: isNull,
    kindOf: kindOf,
    toNumber: toNumber,
    parseDate: parseDate,
    inferColumnType: inferColumnType,
    createTable: createTable,
    cloneTable: cloneTable,
    colIndex: colIndex,
    columnValues: columnValues,
    quantileSorted: quantileSorted,
    numericStats: numericStats,
    uniqCount: uniqCount,
    modeOf: modeOf,
    tableToJSON: tableToJSON,
    tableFromJSON: tableFromJSON
  };

  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
