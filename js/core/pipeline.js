/* =========================================================
 * core/pipeline.js — 处理步骤链：执行 / 撤销上一步 / 日志
 * 原则3：original 始终保留原始数据；原则5：每步记日志
 * 依赖：table.js
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  /**
   * 创建步骤链
   * @param {Object} originalTable 原始数据（永不被修改）
   * @returns {Object} {original, current, steps:[], logs:[]}
   */
  function createPipeline(originalTable) {
    return {
      original: originalTable,
      current: originalTable, // 表不可变，直接引用
      steps: [],
      logs: []
    };
  }

  function impactOf(before, after) {
    return {
      rowsBefore: before.rows.length,
      rowsAfter: after.rows.length,
      colsBefore: before.columns.length,
      colsAfter: after.columns.length,
      deltaRows: after.rows.length - before.rows.length,
      deltaCols: after.columns.length - before.columns.length
    };
  }

  /**
   * 执行一步
   * @param {Object} pl 步骤链
   * @param {Object} step {module, rule, note?, highRisk?, exec}
   *   module: 模块名（如「重复值」） rule: 规则描述（如「整行判重，保留第一条」）
   *   note: 用户备注（原因） highRisk: 高风险标记（UI 已确认过）
   *   exec: function(table) => {table, info}；抛错则本步不生效
   * @returns {step, result} 步骤记录与算子返回结果
   */
  function applyStep(pl, step) {
    if (!step || typeof step.exec !== 'function') throw new Error('步骤缺少执行函数 exec');
    if (!step.module) throw new Error('步骤缺少模块名 module');
    if (!step.rule) throw new Error('步骤缺少规则描述 rule');
    const before = pl.current;
    const result = step.exec(before); // 失败会抛错，状态不变
    if (!result || !result.table) throw new Error('执行函数必须返回 {table, info}');

    const record = {
      id: pl.steps.length + 1,
      time: new Date().toISOString(),
      module: step.module,
      rule: step.rule,
      note: step.note || '',
      highRisk: !!step.highRisk,
      impact: impactOf(before, result.table),
      info: result.info || {},
      prevSnapshot: before
    };
    pl.steps.push(record);
    pl.current = result.table;
    pl.logs.push({
      time: record.time,
      type: 'step',
      id: record.id,
      module: record.module,
      rule: record.rule,
      note: record.note,
      highRisk: record.highRisk,
      impact: record.impact
    });
    return { step: record, result: result };
  }

  /**
   * 撤销上一步：数据回到上一步状态，日志留痕
   * @returns {{ok:true, step}} 撤销的步骤；无可撤销时 {ok:false}
   */
  function undo(pl) {
    if (!pl.steps.length) return { ok: false };
    const beforeUndo = pl.current;
    const last = pl.steps.pop();
    pl.current = last.prevSnapshot;
    last.undone = true;
    pl.logs.push({
      time: new Date().toISOString(),
      type: 'undo',
      id: last.id,
      module: last.module,
      rule: '撤销：' + last.rule,
      note: last.note,
      highRisk: false,
      impact: impactOf(beforeUndo, pl.current)
    });
    return { ok: true, step: last };
  }

  /** 当前可撤销步数 */
  function undoableCount(pl) { return pl.steps.length; }

  /** 日志副本（防外部篡改） */
  function getLogs(pl) { return pl.logs.slice(); }

  const api = { createPipeline: createPipeline, applyStep: applyStep, undo: undo, undoableCount: undoableCount, getLogs: getLogs };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
