/* 阶段2测试：audit.js — 体检报告 / 重复检测 / IQR / 列详情 */
'use strict';
const C = globalThis.DPCore;
const assert = require('assert');

// 构造已知问题的测试表
function buildTestTable() {
  return C.createTable('测试', ['id', '姓名', '金额', '下单日期', '城市'], [
    [1, '张三', '100', '2024-01-01', '北京'],
    [2, '李四', '200', '2024-01-02', '上海'],
    [3, '张三', '999999', '2024-01-03', '北京'],
    [4, '王五', null, '2024-01-04', ' 广州'],   // 首尾空格
    [2, '李四', '200', '2024-01-02', '上海'],   // 整行重复
    [5, '赵六', '150', 'not-a-date', '深圳']    // 日期列混入脏值
  ]);
}

test('duplicateGroups：整行判重', () => {
  const t = buildTestTable();
  const all = C.duplicateGroups(t.rows, [0, 1, 2, 3, 4]);
  assert.strictEqual(all.dupCount, 1);
  assert.strictEqual(all.groups.length, 1);
  assert.deepStrictEqual(all.groups[0], [1, 4], '第2行与第5行重复');
});

test('duplicateGroups：按列判重（空 key 数组视为整行）', () => {
  const t = buildTestTable();
  const byName = C.duplicateGroups(t.rows, [1]);
  assert.strictEqual(byName.dupCount, 2, '张三、李四各出现两次');
  assert.deepStrictEqual(byName.groups, [[0, 2], [1, 4]]);
  const whole = C.duplicateGroups(t.rows, []);
  assert.strictEqual(whole.dupCount, 1);
});

test('iqrOutliers：IQR 边界与异常下标', () => {
  const vals = [10, 11, 12, 13, 14, 15, 16, 100]; // 100 为异常
  const r = C.iqrOutliers(vals);
  assert.ok(r.lower !== null && r.upper !== null);
  assert.deepStrictEqual(r.indexes, [7]);
  const clean = C.iqrOutliers([1, 2, 3, 4, 5]);
  assert.deepStrictEqual(clean.indexes, []);
  const empty = C.iqrOutliers([null, '']);
  assert.deepStrictEqual(empty.indexes, []);
});

test('auditTable：总量指标', () => {
  const t = buildTestTable();
  const a = C.auditTable(t);
  assert.strictEqual(a.rowCount, 6);
  assert.strictEqual(a.colCount, 5);
  assert.strictEqual(a.duplicateRowCount, 1);
  assert.strictEqual(a.missingCells, 1, '仅金额 1 个缺失');
});

test('auditTable：列类型与提示（文本型数字/日期/混合/空格/异常值）', () => {
  const t = buildTestTable();
  const a = C.auditTable(t);
  const byName = {};
  a.columns.forEach(c => { byName[c.name] = c; });

  assert.strictEqual(byName['id'].type, 'number');
  assert.ok(byName['id'].hints.some(h => h.includes('主键')), 'id 应识别为疑似主键');

  assert.strictEqual(byName['金额'].type, 'number-string');
  assert.ok(byName['金额'].hints.some(h => h.includes('纯数字文本')));
  assert.strictEqual(byName['金额'].outlierCount, 1, '999999 为 IQR 异常');
  assert.ok(byName['金额'].hints.some(h => h.includes('疑似异常值')));

  assert.strictEqual(byName['下单日期'].type, 'mixed', '日期文本混入 not-a-date');
  assert.ok(byName['下单日期'].hints.some(h => h.includes('混合类型')));

  assert.strictEqual(byName['城市'].type, 'string');
  assert.ok(byName['城市'].hints.some(h => h.includes('首尾有空格')));
});

test('auditTable：唯一值仅 2 个的提示单独验证', () => {
  const t = C.createTable('g', ['性别', '分数'], [['男', 1], ['女', 2], ['男', 3]]);
  const a = C.auditTable(t);
  const sex = a.columns.find(c => c.name === '性别');
  assert.strictEqual(sex.uniq, 2);
  assert.ok(sex.hints.some(h => h.includes('唯一值仅 2 个')));
});

test('columnDetail：数值列含统计与箱线数据', () => {
  const t = buildTestTable();
  const d = C.columnDetail(t, '金额');
  assert.strictEqual(d.type, 'number-string');
  assert.strictEqual(d.stats.count, 5);
  assert.strictEqual(d.stats.max, 999999);
  assert.ok(d.outlier.indexes.includes(2));
  assert.strictEqual(d.missing, 1);
});

test('columnDetail：文本列含 Top 频次', () => {
  const t = buildTestTable();
  const d = C.columnDetail(t, '姓名');
  assert.strictEqual(d.uniq, 4, '张三李四王五赵六');
  assert.ok(d.top.length >= 1);
  const zhang = d.top.find(x => x.raw === '张三');
  assert.ok(zhang && zhang.count === 2);
});

test('columnDetail：日期列含最值', () => {
  const t = C.createTable('d', ['日期'], [
    ['2024-03-01'], ['2024-01-15'], ['2024-02-10']
  ]);
  const d = C.columnDetail(t, '日期');
  assert.ok(d.minDate && d.minDate.getMonth() === 0, '最小为 1 月');
  assert.ok(d.maxDate && d.maxDate.getMonth() === 2, '最大为 3 月');
});
