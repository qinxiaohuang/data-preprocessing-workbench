/* =========================================================
 * core/ops-missing.js — 缺失值处理
 * 依赖：table.js
 * 策略：keep / drop-rows / drop-col / mean / median / mode / ffill / bfill / fixed
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const FILL_STRATEGIES = ['mean', 'median', 'mode', 'ffill', 'bfill', 'fixed'];

  function missingOverview(table) {
    return table.columns.map(function (col, i) {
      const vals = table.rows.map(function (r) { return r[i]; });
      const missing = vals.filter(C.isNull).length;
      return { column: col.name, missing: missing, rate: table.rows.length ? missing / table.rows.length : 0 };
    });
  }

  /**
   * @param {Array} plans [{column, strategy, value?}]
   * @returns {table, info:{rowsDeleted, filledCells, colsDropped, dropRowsColumns}}
   */
  function applyMissing(table, plans) {
    if (!Array.isArray(plans)) throw new Error('plans 必须是数组');
    const byName = {};
    plans.forEach(function (p) {
      if (!p || !p.column || !p.strategy) throw new Error('计划格式错误');
      if (p.column in byName) throw new Error('同一列出现多个处理计划：' + p.column);
      byName[p.column] = p;
    });
    Object.keys(byName).forEach(function (name) {
      if (C.colIndex(table, name) < 0) throw new Error('列不存在：' + name);
      const st = byName[name].strategy;
      if (FILL_STRATEGIES.includes(st)) {
        const idx = C.colIndex(table, name);
        const type = table.columns[idx].type;
        if ((st === 'mean' || st === 'median') && type !== 'number' && type !== 'number-string') {
          throw new Error('列「' + name + '」不是数值列，无法' + (st === 'mean' ? '均值' : '中位数') + '填充');
        }
        if (st === 'fixed' && 'value' in byName[name] === false) {
          throw new Error('固定值填充需要提供 value');
        }
      }
    });

    // 计划分类
    const dropColNames = Object.keys(byName).filter(function (n) { return byName[n].strategy === 'drop-col'; });
    const dropRowNames = Object.keys(byName).filter(function (n) { return byName[n].strategy === 'drop-rows'; });
    const fillNames = Object.keys(byName).filter(function (n) { return FILL_STRATEGIES.includes(byName[n].strategy); });

    let rows = table.rows.map(function (r) { return r.slice(); });
    let columns = table.columns.map(function (c) { return { name: c.name, type: c.type }; });

    // 1) 删列
    if (dropColNames.length) {
      const dropIdx = dropColNames.map(function (n) { return C.colIndex(table, n); });
      columns = columns.filter(function (_, i) { return !dropIdx.includes(i); });
      rows = rows.map(function (r) { return r.filter(function (_, i) { return !dropIdx.includes(i); }); });
    }

    // 2) 填充（填充统计基于填充前的数据；按行号对齐，ffill/bfill 逐行取值）
    let filledCells = 0;
    fillNames.forEach(function (name) {
      const plan = byName[name];
      const j = columns.findIndex(function (c) { return c.name === name; });
      if (j < 0) return; // 该列同时被删列（UI 不允许，防御）
      const oi = table.columns.findIndex(function (c) { return c.name === name; });
      const colVals = table.rows.map(function (r) { return r[oi]; });
      const fill = computeFill(colVals, plan);
      rows.forEach(function (r, ri) {
        if (C.isNull(r[j])) {
          r[j] = fill.seq ? fill.seq[ri] : fill.const;
          filledCells++;
        }
      });
    });

    // 3) 删行（基于填充前原始值判断；rows 与原始行按行号一一对应）
    let rowsDeleted = 0;
    if (dropRowNames.length) {
      const dropIdxOriginal = dropRowNames.map(function (n) {
        return table.columns.findIndex(function (c) { return c.name === n; });
      });
      const keepIdx = [];
      table.rows.forEach(function (orig, i) {
        if (!dropIdxOriginal.some(function (di) { return C.isNull(orig[di]); })) keepIdx.push(i);
      });
      rowsDeleted = table.rows.length - keepIdx.length;
      rows = keepIdx.map(function (i) { return rows[i]; });
    }

    const newTable = C.createTable(table.name, columns, rows);
    return {
      table: newTable,
      info: {
        rowsDeleted: rowsDeleted,
        filledCells: filledCells,
        colsDropped: dropColNames,
        dropRowsColumns: dropRowNames
      }
    };
  }

  // 返回 {const: v}（固定填充值）或 {seq: array}（按行号对齐的填充序列）
  function computeFill(colVals, plan) {
    const st = plan.strategy;
    if (st === 'fixed') {
      return { const: plan.value };
    }
    if (st === 'mean' || st === 'median') {
      const s = C.numericStats(colVals);
      const v = st === 'mean' ? s.mean : s.median;
      if (v === null) throw new Error('该列没有可用数值，无法计算' + (st === 'mean' ? '均值' : '中位数'));
      return { const: v };
    }
    if (st === 'mode') {
      const m = C.modeOf(colVals);
      if (!m) throw new Error('该列没有可用值，无法计算众数');
      return { const: m.value };
    }
    if (st === 'ffill' || st === 'bfill') {
      return makeSeq(colVals, st);
    }
    throw new Error('未知策略：' + st);
  }

  // ffill/bfill：整列预计算填充结果（含原本非空的行，行号对齐）
  function makeSeq(colVals, st) {
    const result = colVals.slice();
    if (st === 'ffill') {
      let last = null;
      for (let i = 0; i < result.length; i++) {
        if (!C.isNull(result[i])) last = result[i];
        else result[i] = last;
      }
    } else {
      let next = null;
      for (let i = result.length - 1; i >= 0; i--) {
        if (!C.isNull(result[i])) next = result[i];
        else result[i] = next;
      }
    }
    return { seq: result };
  }

  const api = { missingOverview: missingOverview, applyMissing: applyMissing };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
