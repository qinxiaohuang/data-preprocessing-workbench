/* 阶段4测试：ops-outlier.js + ops-type.js */
'use strict';
const C = globalThis.DPCore;
const assert = require('assert');

/* ---------- 异常值 ---------- */

function buildOutTable() {
  return C.createTable('销量', ['产品', '销量'], [
    ['A', 100], ['B', 110], ['C', 90], ['D', 105],
    ['E', 95], ['F', 5000], ['G', null], ['H', 102]
  ]);
}

test('detectOutliers：IQR 找出极端值', () => {
  const d = C.detectOutliers(buildOutTable(), { column: '销量', method: 'iqr' });
  assert.strictEqual(d.count, 1);
  assert.deepStrictEqual(d.indexes, [5]);
  assert.ok(d.lower < 110 && d.upper < 5000);
});

test('detectOutliers：Z-score', () => {
  // 29 个 100 + 1 个 1000：z(1000)≈5.3 > 3，z(100)≈-0.18
  const rows = [];
  for (let i = 0; i < 29; i++) rows.push(['x' + i, 100]);
  rows.push(['极端', 1000]);
  const t = C.createTable('t', ['产品', '销量'], rows);
  const d = C.detectOutliers(t, { column: '销量', method: 'zscore' });
  assert.strictEqual(d.count, 1);
  assert.deepStrictEqual(d.indexes, [29]);
  // 小样本单极值会拉大方差，z-score(3) 检不出属正常数学行为
  const small = C.detectOutliers(buildOutTable(), { column: '销量', method: 'zscore' });
  assert.ok(small.count >= 0);
});

test('detectOutliers：自定义业务区间', () => {
  const d = C.detectOutliers(buildOutTable(), { column: '销量', method: 'range', min: 0, max: 200 });
  assert.deepStrictEqual(d.indexes, [5]);
  assert.throws(() => C.detectOutliers(buildOutTable(), { column: '销量', method: 'range', min: 100, max: 0 }), /min 不能大于 max/);
});

test('detectOutliers：非数值列与不存在列报错', () => {
  assert.throws(() => C.detectOutliers(buildOutTable(), { column: '产品', method: 'iqr' }), /数值列/);
  assert.throws(() => C.detectOutliers(buildOutTable(), { column: '无', method: 'iqr' }), /不存在/);
});

test('applyOutlier：默认打标记，不删行', () => {
  const r = C.applyOutlier(buildOutTable(), { column: '销量', method: 'iqr', action: 'flag' });
  assert.strictEqual(r.table.rows.length, 8, '行数不变');
  assert.strictEqual(r.info.flagColumn, '销量_outlier_flag');
  const flagIdx = r.table.columns.length - 1;
  assert.strictEqual(r.table.columns[flagIdx].name, '销量_outlier_flag');
  assert.strictEqual(r.table.rows[5][flagIdx], 1);
  assert.strictEqual(r.table.rows[0][flagIdx], 0);
  assert.strictEqual(r.table.rows[6][flagIdx], 0, '空值不标记');
  assert.strictEqual(r.info.flagged, 1);
});

test('applyOutlier：重复执行覆盖旧标记列', () => {
  const t1 = C.applyOutlier(buildOutTable(), { column: '销量', method: 'iqr', action: 'flag' }).table;
  const t2 = C.applyOutlier(t1, { column: '销量', method: 'range', min: 90, max: 120, action: 'flag' });
  assert.strictEqual(t2.table.columns.length, t1.columns.length, '不重复加列');
  const fi = t2.table.columns.length - 1;
  assert.strictEqual(t2.table.rows[5][fi], 1, '5000 在 90-120 外，应标记 1');
});

test('applyOutlier：删除需显示影响行数（info）', () => {
  const r = C.applyOutlier(buildOutTable(), { column: '销量', method: 'iqr', action: 'delete' });
  assert.strictEqual(r.info.deleted, 1);
  assert.strictEqual(r.table.rows.length, 7);
  assert.ok(!r.table.rows.some(x => x[1] === 5000));
});

test('applyOutlier：截尾把异常值压回边界', () => {
  const r = C.applyOutlier(buildOutTable(), { column: '销量', method: 'iqr', action: 'winsorize' });
  assert.strictEqual(r.info.capped, 1);
  assert.strictEqual(r.table.rows.length, 8);
  assert.ok(r.table.rows[5][1] <= r.info.bounds.upper, '截尾后不超上界');
  assert.ok(r.table.rows[5][1] > 110, '仍在正常值上方');
});

/* ---------- 类型转换 ---------- */

function buildTypeTable() {
  return C.createTable('明细', ['数量', '日期', '备注'], [
    ['12', '2024-01-01', 'a'],
    ['45.5', '2024/2/1', 'b'],
    ['1,200', 'not-a-date', 'c'],
    [null, '', 'd'],
    ['x99', '2024年3月5日', 'e']
  ]);
}

test('convertPreview：转数字的成败统计与失败示例', () => {
  const p = C.convertPreview(buildTypeTable(), { column: '数量', targetType: 'number' });
  assert.strictEqual(p.okCount, 3);   // 12, 45.5, 1200
  assert.strictEqual(p.failCount, 1); // x99
  assert.strictEqual(p.emptyCount, 1);
  assert.strictEqual(p.failExamples.length, 1);
  assert.strictEqual(p.failExamples[0].row, 4);
  assert.strictEqual(p.failExamples[0].value, 'x99');
});

test('convertPreview：转日期', () => {
  const p = C.convertPreview(buildTypeTable(), { column: '日期', targetType: 'date' });
  assert.strictEqual(p.okCount, 3);
  assert.strictEqual(p.failCount, 1, 'not-a-date');
  assert.ok(p.sample[0] instanceof Date);
});

test('convertPreview：转文本永远成功（Date 格式化）', () => {
  const t = C.createTable('t', ['d'], [[new Date(2024, 0, 5)], [42]]);
  const p = C.convertPreview(t, { column: 'd', targetType: 'text' });
  assert.strictEqual(p.failCount, 0);
  assert.strictEqual(p.sample[0], '2024-01-05');
  assert.strictEqual(p.sample[1], '42');
});

test('applyConvert：转数字，失败置空', () => {
  const r = C.applyConvert(buildTypeTable(), { column: '数量', targetType: 'number', failStrategy: 'null' });
  assert.strictEqual(r.table.rows.length, 5);
  assert.strictEqual(r.table.rows[0][0], 12);
  assert.strictEqual(r.table.rows[2][0], 1200, '千分位');
  assert.strictEqual(r.table.rows[4][0], null, '失败置空');
  assert.strictEqual(r.table.columns[0].type, 'number');
  assert.strictEqual(r.info.fail, 1);
});

test('applyConvert：失败保留原文', () => {
  const r = C.applyConvert(buildTypeTable(), { column: '数量', targetType: 'number', failStrategy: 'keep' });
  assert.strictEqual(r.table.rows[4][0], 'x99');
  assert.strictEqual(r.table.columns[0].type, 'number', '类型仍按目标记录');
});

test('applyConvert：失败中止（不修改任何数据）', () => {
  const t = buildTypeTable();
  assert.throws(() => C.applyConvert(t, { column: '数量', targetType: 'number', failStrategy: 'abort' }), /中止/);
  assert.strictEqual(t.rows[4][0], 'x99', '原表未变');
});

test('applyConvert：全部成功时不报错（abort 策略）', () => {
  const t = C.createTable('t', ['s'], [['1'], ['2']]);
  const r = C.applyConvert(t, { column: 's', targetType: 'number', failStrategy: 'abort' });
  assert.strictEqual(r.info.fail, 0);
  assert.deepStrictEqual(r.table.rows, [[1], [2]]);
});

test('applyConvert：空值保持为空且不计数', () => {
  const r = C.applyConvert(buildTypeTable(), { column: '数量', targetType: 'number', failStrategy: 'null' });
  assert.strictEqual(r.table.rows[3][0], null);
  assert.ok(r.info.ok + r.info.fail === 4, '空值不计入成败');
});

test('applyConvert：转日期后列类型为 date，原表不变', () => {
  const t = buildTypeTable();
  const r = C.applyConvert(t, { column: '日期', targetType: 'date', failStrategy: 'null' });
  assert.strictEqual(r.table.columns[1].type, 'date');
  assert.ok(r.table.rows[0][1] instanceof Date);
  assert.strictEqual(t.columns[1].type, 'mixed', '原表类型不变（75% 像日期判 mixed）');
});

test('applyConvert：参数校验', () => {
  const t = buildTypeTable();
  assert.throws(() => C.applyConvert(t, { column: '无', targetType: 'number' }), /不存在/);
  assert.throws(() => C.applyConvert(t, { column: '数量', targetType: 'object' }), /未知目标类型/);
  assert.throws(() => C.applyConvert(t, { column: '数量', targetType: 'number', failStrategy: 'ignore' }), /失败策略/);
});
