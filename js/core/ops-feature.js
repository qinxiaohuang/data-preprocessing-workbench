/* =========================================================
 * core/ops-feature.js — 特征工程：派生新列
 * 五种类型：四则运算 / 条件生成 / 日期拆解 / 文本提取 / 分箱
 * 原则：只生成新列，绝不修改原列
 * 依赖：table.js / ops-type.js（formatDate）
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const KINDS = ['arithmetic', 'condition', 'date-part', 'text', 'bin'];
  const ARITH_OPS = ['+', '-', '*', '/'];
  const COND_OPS = ['>', '>=', '<', '<=', '==', '!=', 'contains', 'notContains', 'isNull', 'notNull'];
  const DATE_PARTS = ['year', 'month', 'day', 'weekday', 'quarter', 'isWeekend'];
  const TEXT_OPS = ['substring', 'split', 'contains'];
  const BIN_METHODS = ['equal-width', 'equal-freq', 'custom'];

  /* ---------- 工具 ---------- */

  function fmtNum(n) {
    if (n === null || n === undefined) return '';
    const r = Math.round(n * 100) / 100;
    return String(r);
  }

  // 统一的新列名校验
  function checkNewColumn(table, spec) {
    if (!spec.newColumn || String(spec.newColumn).trim() === '') throw new Error('新列名不能为空');
    if (C.colIndex(table, spec.newColumn) >= 0) throw new Error('列名「' + spec.newColumn + '」已存在，请换一个');
  }

  function checkSource(table, name) {
    const idx = C.colIndex(table, name);
    if (idx < 0) throw new Error('列不存在：' + name);
    return idx;
  }

  /* ---------- 各类型逐行计算 ---------- */

  function makeArithmetic(table, spec) {
    if (!ARITH_OPS.includes(spec.op)) throw new Error('未知运算符：' + spec.op);
    const ia = checkSource(table, spec.colA);
    const useColB = spec.colB !== undefined && spec.colB !== null && spec.colB !== '';
    let ib = -1;
    if (useColB) { ib = checkSource(table, spec.colB); }
    else if (typeof spec.constB !== 'number') { throw new Error('四则运算需要选择第二列或填写常数'); }
    return table.rows.map(function (r) {
      const a = C.toNumber(r[ia]);
      const b = useColB ? C.toNumber(r[ib]) : spec.constB;
      if (a === null || b === null) return null;
      switch (spec.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
      }
      return null;
    });
  }

  function evalCondition(v, op, cmp) {
    switch (op) {
      case 'isNull': return C.isNull(v);
      case 'notNull': return !C.isNull(v);
      case 'contains': return !C.isNull(v) && String(v).indexOf(String(cmp)) >= 0;
      case 'notContains': return !C.isNull(v) && String(v).indexOf(String(cmp)) < 0;
    }
    const a = C.toNumber(v), b = C.toNumber(cmp);
    if (a !== null && b !== null) {
      switch (op) {
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '==': return a === b;
        case '!=': return a !== b;
      }
    }
    // 非数值按字符串比较（仅等与不等有意义）
    const sa = C.isNull(v) ? '' : String(v), sb = String(cmp);
    if (op === '==') return sa === sb;
    if (op === '!=') return sa !== sb;
    return false; // 文本不支持大小比较
  }

  function makeCondition(table, spec) {
    if (!COND_OPS.includes(spec.op)) throw new Error('未知条件运算符：' + spec.op);
    const needsValue = !['isNull', 'notNull'].includes(spec.op);
    if (needsValue && (spec.value === undefined || spec.value === null || spec.value === '')) {
      throw new Error('条件生成需要填写比较值');
    }
    const idx = checkSource(table, spec.column);
    const thenV = spec.then !== undefined ? spec.then : null;
    const elseV = spec.else !== undefined ? spec.else : null;
    return table.rows.map(function (r) {
      return evalCondition(r[idx], spec.op, spec.value) ? thenV : elseV;
    });
  }

  function makeDatePart(table, spec) {
    if (!DATE_PARTS.includes(spec.part)) throw new Error('未知日期部分：' + spec.part);
    const idx = checkSource(table, spec.column);
    return table.rows.map(function (r) {
      const d = C.parseDate(r[idx]);
      if (!d) return null;
      switch (spec.part) {
        case 'year': return d.getFullYear();
        case 'month': return d.getMonth() + 1;
        case 'day': return d.getDate();
        case 'weekday': return ((d.getDay() + 6) % 7) + 1; // ISO：周一=1 … 周日=7
        case 'quarter': return Math.floor(d.getMonth() / 3) + 1;
        case 'isWeekend': return (d.getDay() === 0 || d.getDay() === 6) ? 1 : 0;
      }
      return null;
    });
  }

  function makeText(table, spec) {
    if (!TEXT_OPS.includes(spec.op)) throw new Error('未知文本操作：' + spec.op);
    const idx = checkSource(table, spec.column);
    return table.rows.map(function (r) {
      const v = r[idx];
      if (C.isNull(v)) return null;
      const s = v instanceof Date ? C.formatDate(v) : String(v);
      if (spec.op === 'substring') {
        const start = typeof spec.start === 'number' ? spec.start : 0; // 0 基
        if (start < 0) return null;
        return typeof spec.length === 'number' ? s.substr(start, spec.length) : s.slice(start);
      }
      if (spec.op === 'split') {
        if (spec.delimiter === undefined || spec.delimiter === '') throw new Error('拆分需要分隔符');
        const parts = s.split(spec.delimiter);
        const i = typeof spec.index === 'number' ? spec.index : 0; // 0 基
        return (i >= 0 && i < parts.length) ? parts[i] : null;
      }
      // contains
      if (spec.keyword === undefined || spec.keyword === '') throw new Error('包含判断需要关键字');
      return s.indexOf(String(spec.keyword)) >= 0 ? 1 : 0;
    });
  }

  /* ---------- 分箱 ---------- */

  function collectNumbers(table, idx) {
    const nums = [];
    table.rows.forEach(function (r) {
      if (C.isNull(r[idx])) return;
      const n = C.toNumber(r[idx]);
      if (n !== null) nums.push(n);
    });
    nums.sort(function (a, b) { return a - b; });
    return nums;
  }

  function defaultLabels(edges) {
    const labels = [];
    for (let j = 0; j < edges.length - 1; j++) {
      const right = j === edges.length - 2 ? ']' : ')';
      labels.push('[' + fmtNum(edges[j]) + ', ' + fmtNum(edges[j + 1]) + right);
    }
    return labels;
  }

  function buildBins(table, spec, idx) {
    const nums = collectNumbers(table, idx);
    if (!nums.length) throw new Error('列「' + spec.column + '」没有可分箱的数值');
    let edges = null, labels = null;

    if (spec.method === 'custom') {
      if (!Array.isArray(spec.edges) || spec.edges.length < 2) throw new Error('自定义分箱需要至少 2 个边界值');
      edges = spec.edges.slice();
      for (let i = 1; i < edges.length; i++) {
        if (typeof edges[i] !== 'number' || edges[i] <= edges[i - 1]) throw new Error('边界值必须严格递增的数字');
      }
      if (!Array.isArray(spec.labels) || spec.labels.length !== edges.length - 1) {
        throw new Error('标签数量必须等于区间数（边界数 - 1）');
      }
      labels = spec.labels.map(String);
    } else {
      const bins = typeof spec.bins === 'number' ? Math.floor(spec.bins) : 0;
      if (bins < 2) throw new Error('分箱数至少为 2');
      if (spec.method === 'equal-width') {
        const min = nums[0], max = nums[nums.length - 1];
        if (max === min) throw new Error('该列所有取值相同，无法等宽分箱');
        const w = (max - min) / bins;
        edges = [];
        for (let i = 0; i <= bins; i++) edges.push(i === bins ? max : min + w * i);
      } else {
        // equal-freq：用分位数做边界
        edges = [];
        for (let i = 0; i <= bins; i++) edges.push(C.quantileSorted(nums, i / bins));
        // 去重相邻重复边界
        const dedup = [edges[0]];
        for (let i = 1; i < edges.length; i++) {
          if (edges[i] > dedup[dedup.length - 1]) dedup.push(edges[i]);
        }
        if (dedup.length < 2) throw new Error('取值过于集中，无法等频分箱');
        edges = dedup;
      }
      labels = spec.labels && spec.labels.length === edges.length - 1 ? spec.labels.map(String) : defaultLabels(edges);
    }
    return { edges: edges, labels: labels };
  }

  function assignBin(v, edges) {
    // [e0,e1) ... [e(n-1), en]；最后一段含右端点
    if (v < edges[0] || v > edges[edges.length - 1]) return -1;
    for (let j = 0; j < edges.length - 1; j++) {
      if (v >= edges[j] && (v < edges[j + 1] || j === edges.length - 2)) return j;
    }
    return -1;
  }

  function makeBin(table, spec) {
    if (!BIN_METHODS.includes(spec.method)) throw new Error('未知分箱方式：' + spec.method);
    const idx = checkSource(table, spec.column);
    const b = buildBins(table, spec, idx);
    const values = table.rows.map(function (r) {
      if (C.isNull(r[idx])) return null;
      const n = C.toNumber(r[idx]);
      if (n === null) return null;
      const j = assignBin(n, b.edges);
      return j < 0 ? null : b.labels[j];
    });
    return { values: values, binEdges: b.edges, binLabels: b.labels };
  }

  /* ---------- 对外：预演 + 执行 ---------- */

  function computeValues(table, spec) {
    switch (spec.kind) {
      case 'arithmetic': return { values: makeArithmetic(table, spec) };
      case 'condition': return { values: makeCondition(table, spec) };
      case 'date-part': return { values: makeDatePart(table, spec) };
      case 'text': return { values: makeText(table, spec) };
      case 'bin': return makeBin(table, spec);
      default: throw new Error('未知特征类型：' + spec.kind);
    }
  }

  function validateSpec(table, spec) {
    if (!spec || !KINDS.includes(spec.kind)) throw new Error('未知特征类型：' + (spec && spec.kind));
    checkNewColumn(table, spec);
  }

  /**
   * 预演：返回新列前 10 行效果，不修改数据
   * @returns {column, values:[前10行], nullCount, total, binEdges?, binLabels?}
   */
  function featurePreview(table, spec) {
    validateSpec(table, spec);
    const r = computeValues(table, spec);
    let nullCount = 0;
    r.values.forEach(function (v) { if (v === null || v === undefined) nullCount++; });
    return {
      column: spec.newColumn,
      values: r.values.slice(0, 10),
      nullCount: nullCount,
      total: table.rows.length,
      binEdges: r.binEdges || null,
      binLabels: r.binLabels || null
    };
  }

  /**
   * 执行：追加新列，原列不动
   * @returns {table, info:{kind, column, added:1, nullCount, rows, binEdges?, binLabels?}}
   */
  function applyFeature(table, spec) {
    validateSpec(table, spec);
    const r = computeValues(table, spec);
    const columns = table.columns.map(function (c) { return { name: c.name, type: c.type }; });
    columns.push(spec.newColumn); // 字符串 → createTable 自动推断类型
    const rows = table.rows.map(function (row, i) {
      const nr = row.slice();
      nr.push(r.values[i] === undefined ? null : r.values[i]);
      return nr;
    });
    let nullCount = 0;
    r.values.forEach(function (v) { if (v === null || v === undefined) nullCount++; });
    return {
      table: C.createTable(table.name, columns, rows),
      info: {
        kind: spec.kind,
        column: spec.newColumn,
        added: 1,
        nullCount: nullCount,
        rows: table.rows.length,
        binEdges: r.binEdges || null,
        binLabels: r.binLabels || null
      }
    };
  }

  const api = { featurePreview: featurePreview, applyFeature: applyFeature, evalCondition: evalCondition };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
