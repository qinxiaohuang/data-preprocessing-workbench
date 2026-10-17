/* 阶段7测试：pipeline.js（结合真实算子做集成验证） */
'use strict';
const C = globalThis.DPCore;
const assert = require('assert');

function buildTable() {
  return C.createTable('测试', ['a', 'b'], [
    [1, 'x'], [2, null], [1, 'x'], [3, 'y']
  ]);
}

test('pipeline：applyStep 记录时间/模块/规则/备注/影响量', () => {
  const pl = C.createPipeline(buildTable());
  const r = C.applyStep(pl, {
    module: '重复值',
    rule: '整行判重，保留第一条',
    note: '交付前清洗',
    exec: function (t) { return C.dedupRows(t, { keep: 'first' }); }
  });
  assert.ok(r.step.time, '有时间戳');
  assert.strictEqual(r.step.module, '重复值');
  assert.strictEqual(r.step.rule, '整行判重，保留第一条');
  assert.strictEqual(r.step.note, '交付前清洗');
  assert.deepStrictEqual(r.step.impact, { rowsBefore: 4, rowsAfter: 3, colsBefore: 2, colsAfter: 2, deltaRows: -1, deltaCols: 0 });
  assert.strictEqual(pl.current.rows.length, 3, 'current 指向新表');
  assert.strictEqual(pl.logs.length, 1);
  assert.strictEqual(pl.logs[0].type, 'step');
  assert.strictEqual(pl.logs[0].highRisk, false);
});

test('pipeline：highRisk 标记入日志', () => {
  const pl = C.createPipeline(buildTable());
  C.applyStep(pl, {
    module: '缺失值',
    rule: '删除列 b',
    highRisk: true,
    exec: function (t) { return C.applyMissing(t, [{ column: 'b', strategy: 'drop-col' }]); }
  });
  assert.strictEqual(pl.logs[0].highRisk, true);
});

test('pipeline：exec 抛错时状态不变、不写日志', () => {
  const pl = C.createPipeline(buildTable());
  const before = pl.current;
  assert.throws(() => C.applyStep(pl, {
    module: '重复值',
    rule: '坏步骤',
    exec: function () { throw new Error('算子失败'); }
  }), /算子失败/);
  assert.strictEqual(pl.current, before, 'current 不变');
  assert.strictEqual(pl.steps.length, 0);
  assert.strictEqual(pl.logs.length, 0);
});

test('pipeline：参数校验（缺 module/rule/exec）', () => {
  const pl = C.createPipeline(buildTable());
  assert.throws(() => C.applyStep(pl, { rule: 'x', exec: function () {} }), /模块名/);
  assert.throws(() => C.applyStep(pl, { module: 'x', exec: function () {} }), /规则描述/);
  assert.throws(() => C.applyStep(pl, { module: 'x', rule: 'y' }), /执行函数/);
});

test('pipeline：undo 恢复上一状态并留痕', () => {
  const pl = C.createPipeline(buildTable());
  C.applyStep(pl, { module: '重复值', rule: '整行去重', exec: function (t) { return C.dedupRows(t, { keep: 'first' }); } });
  assert.strictEqual(pl.current.rows.length, 3);
  const u = C.undo(pl);
  assert.strictEqual(u.ok, true);
  assert.strictEqual(u.step.undone, true);
  assert.strictEqual(pl.current.rows.length, 4, '回到去重前');
  assert.strictEqual(pl.steps.length, 0);
  assert.strictEqual(pl.logs.length, 2, '执行 + 撤销两条日志');
  assert.strictEqual(pl.logs[1].type, 'undo');
  assert.ok(/撤销/.test(pl.logs[1].rule));
});

test('pipeline：连续两步可连续撤销到最初', () => {
  const pl = C.createPipeline(buildTable());
  C.applyStep(pl, { module: '重复值', rule: '去重', exec: function (t) { return C.dedupRows(t, { keep: 'first' }); } });
  C.applyStep(pl, { module: '缺失值', rule: 'b 列填固定值', exec: function (t) { return C.applyMissing(t, [{ column: 'b', strategy: 'fixed', value: '补' }]); } });
  assert.strictEqual(pl.current.rows.length, 3);
  assert.strictEqual(pl.current.rows[1][1], '补', '第2行 b 被固定值填充');
  const mid = pl.current;
  C.undo(pl);
  assert.strictEqual(pl.current.rows.length, 3, '撤销填充：行数同（填充不改行数）');
  assert.strictEqual(pl.current.rows[1][1], null, '填充被撤销');
  C.undo(pl);
  assert.strictEqual(pl.current.rows.length, 4, '撤销去重：行数恢复');
  assert.ok(pl.current !== mid);
  assert.strictEqual(C.undoableCount(pl), 0);
});

test('pipeline：无步可撤时返回 ok:false', () => {
  const pl = C.createPipeline(buildTable());
  const u = C.undo(pl);
  assert.strictEqual(u.ok, false);
  assert.strictEqual(pl.logs.length, 0, '不留痕');
});

test('pipeline：original 始终保留原始数据（原则3）', () => {
  const t = buildTable();
  const pl = C.createPipeline(t);
  C.applyStep(pl, { module: '缺失值', rule: '删含空行', exec: function (x) { return C.applyMissing(x, [{ column: 'b', strategy: 'drop-rows' }]); } });
  assert.strictEqual(pl.current.rows.length, 3);
  assert.strictEqual(pl.original.rows.length, 4, '原始副本不动');
  assert.strictEqual(t.rows.length, 4);
  assert.deepStrictEqual(pl.original.rows[1], [2, null]);
});

test('pipeline：多步日志完整且含影响行列数（原则5）', () => {
  const pl = C.createPipeline(buildTable());
  C.applyStep(pl, { module: '重复值', rule: '去重', exec: function (t) { return C.dedupRows(t, { keep: 'first' }); } });
  C.applyStep(pl, { module: '缺失值', rule: 'b 列删行', exec: function (t) { return C.applyMissing(t, [{ column: 'b', strategy: 'drop-rows' }]); } });
  const logs = C.getLogs(pl);
  assert.strictEqual(logs.length, 2);
  assert.strictEqual(logs[1].impact.rowsBefore, 3);
  assert.strictEqual(logs[1].impact.rowsAfter, 2, '去重后 3 行中 1 行 b 为空被删');
  assert.strictEqual(logs[1].id, 2);
  // 日志副本不影响内部
  logs.push({});
  assert.strictEqual(C.getLogs(pl).length, 2);
});
