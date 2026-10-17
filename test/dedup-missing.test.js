/* 阶段3测试：ops-dedup.js + ops-missing.js */
'use strict';
const C = globalThis.DPCore;
const assert = require('assert');

function buildDedupTable() {
  return C.createTable('订单', ['id', '客户', '金额'], [
    [1, '张三', 100],
    [2, '李四', 200],
    [1, '张三', 100],   // 整行重复 row0
    [3, '王五', 300],
    [2, '李四', 200]    // 整行重复 row1
  ]);
}

/* ---------- 去重 ---------- */

test('dedupRows：整行去重保留第一条', () => {
  const r = C.dedupRows(buildDedupTable(), { keyColumns: [], keep: 'first' });
  assert.strictEqual(r.removedCount, 2);
  assert.deepStrictEqual(r.removedIndexes, [2, 4]);
  assert.strictEqual(r.table.rows.length, 3);
  assert.deepStrictEqual(r.table.rows[1], [2, '李四', 200], '保留首条（row1）');
});

test('dedupRows：整行去重保留最后一条', () => {
  const r = C.dedupRows(buildDedupTable(), { keyColumns: [], keep: 'last' });
  assert.strictEqual(r.removedCount, 2);
  assert.deepStrictEqual(r.removedIndexes, [0, 1]);
  assert.strictEqual(r.table.rows.length, 3);
});

test('dedupRows：按列口径去重', () => {
  // 客户列：张三 x2、李四 x2、王五 x1
  const t = C.createTable('t', ['客户', '金额'], [
    ['张三', 100], ['李四', 200], ['张三', 999], ['王五', 300], ['李四', 888]
  ]);
  const r = C.dedupRows(t, { keyColumns: ['客户'], keep: 'first' });
  assert.strictEqual(r.removedCount, 2);
  assert.strictEqual(r.table.rows.length, 3);
  assert.deepStrictEqual(r.table.rows.map(x => x[0]), ['张三', '李四', '王五']);
  assert.strictEqual(r.table.rows[0][1], 100, '张三保留的是第一条 100');
});

test('dedupRows：无重复原样返回', () => {
  const t = C.createTable('t', ['a'], [[1], [2]]);
  const r = C.dedupRows(t, {});
  assert.strictEqual(r.removedCount, 0);
  assert.strictEqual(r.table.rows.length, 2);
});

test('dedupRows：不存在的列报错', () => {
  assert.throws(() => C.dedupRows(buildDedupTable(), { keyColumns: ['不存在'] }));
});

test('dedupRows：原表不被修改', () => {
  const t = buildDedupTable();
  C.dedupRows(t, { keyColumns: [] });
  assert.strictEqual(t.rows.length, 5);
});

/* ---------- 缺失值 ---------- */

function buildMissTable() {
  return C.createTable('人员', ['姓名', '年龄', '城市', '得分'], [
    ['张三', 25, '北京', 80],
    ['李四', null, null, 90],
    ['王五', 31, '上海', null],
    ['赵六', null, '北京', 70],
    ['钱七', 28, null, 85]
  ]);
}

test('missingOverview：每列缺失率', () => {
  const ov = C.missingOverview(buildMissTable());
  const byName = {};
  ov.forEach(x => { byName[x.column] = x; });
  assert.strictEqual(byName['年龄'].missing, 2);
  assert.ok(Math.abs(byName['年龄'].rate - 0.4) < 1e-9);
  assert.strictEqual(byName['姓名'].missing, 0);
});

test('applyMissing：中位数填充', () => {
  const r = C.applyMissing(buildMissTable(), [{ column: '年龄', strategy: 'median' }]);
  // 年龄非空：25,31,28 → 中位数 28
  assert.strictEqual(r.info.filledCells, 2);
  assert.strictEqual(r.table.rows.length, 5);
  assert.strictEqual(r.table.rows[1][1], 28);
  assert.strictEqual(r.table.rows[3][1], 28);
});

test('applyMissing：均值填充', () => {
  const r = C.applyMissing(buildMissTable(), [{ column: '年龄', strategy: 'mean' }]);
  const mean = (25 + 31 + 28) / 3;
  assert.ok(Math.abs(r.table.rows[1][1] - mean) < 1e-9);
});

test('applyMissing：固定值填充', () => {
  const r = C.applyMissing(buildMissTable(), [{ column: '城市', strategy: 'fixed', value: '未知' }]);
  assert.strictEqual(r.info.filledCells, 2);
  assert.strictEqual(r.table.rows[1][2], '未知');
});

test('applyMissing：众数填充文本列', () => {
  const r = C.applyMissing(buildMissTable(), [{ column: '城市', strategy: 'mode' }]);
  assert.strictEqual(r.table.rows[1][2], '北京', '北京出现 2 次为众数');
});

test('applyMissing：前向/后向填充', () => {
  const t = C.createTable('t', ['v'], [[1], [null], [null], [4], [null]]);
  const f = C.applyMissing(t, [{ column: 'v', strategy: 'ffill' }]);
  assert.deepStrictEqual(f.table.rows.map(r => r[0]), [1, 1, 1, 4, 4]);
  const b = C.applyMissing(t, [{ column: 'v', strategy: 'bfill' }]);
  assert.deepStrictEqual(b.table.rows.map(r => r[0]), [1, 4, 4, 4, null]);
});

test('applyMissing：删行（多列并集）', () => {
  const r = C.applyMissing(buildMissTable(), [
    { column: '年龄', strategy: 'drop-rows' },
    { column: '城市', strategy: 'drop-rows' }
  ]);
  // 年龄空：row1,row3；城市空：row1,row4 → 并集 {1,3,4} 删 3 行
  assert.strictEqual(r.info.rowsDeleted, 3);
  assert.strictEqual(r.table.rows.length, 2);
  assert.deepStrictEqual(r.table.rows.map(x => x[0]), ['张三', '王五']);
});

test('applyMissing：删列', () => {
  const r = C.applyMissing(buildMissTable(), [{ column: '得分', strategy: 'drop-col' }]);
  assert.deepStrictEqual(r.info.colsDropped, ['得分']);
  assert.strictEqual(r.table.columns.length, 3);
  assert.ok(!r.table.columns.some(c => c.name === '得分'));
});

test('applyMissing：删列与删行组合', () => {
  const r = C.applyMissing(buildMissTable(), [
    { column: '得分', strategy: 'drop-col' },
    { column: '年龄', strategy: 'drop-rows' }
  ]);
  assert.strictEqual(r.info.rowsDeleted, 2);
  assert.strictEqual(r.info.colsDropped.length, 1);
  assert.strictEqual(r.table.rows.length, 3);
  assert.strictEqual(r.table.columns.length, 3);
});

test('applyMissing：预览与执行结果一致', () => {
  const t = buildMissTable();
  const plans = [{ column: '年龄', strategy: 'median' }, { column: '城市', strategy: 'drop-rows' }];
  const preview = C.applyMissing(C.cloneTable(t), plans);
  const real = C.applyMissing(t, plans);
  assert.strictEqual(preview.table.rows.length, real.table.rows.length);
  assert.strictEqual(preview.info.rowsDeleted, real.info.rowsDeleted);
  assert.strictEqual(preview.info.filledCells, real.info.filledCells);
  assert.deepStrictEqual(preview.table.rows, real.table.rows);
});

test('applyMissing：参数校验', () => {
  const t = buildMissTable();
  assert.throws(() => C.applyMissing(t, [{ column: '不存在', strategy: 'drop-rows' }]));
  assert.throws(() => C.applyMissing(t, [{ column: '姓名', strategy: 'mean' }]), /数值列/);
  assert.throws(() => C.applyMissing(t, [{ column: '城市', strategy: 'fixed' }]), /value/);
  assert.throws(() => C.applyMissing(t, [
    { column: '城市', strategy: 'drop-col' },
    { column: '城市', strategy: 'drop-rows' }
  ]), /多个处理计划/);
});

test('applyMissing：文本型数字列允许均值填充', () => {
  const t = C.createTable('t', ['金额'], [['10'], [null], ['30']]);
  const r = C.applyMissing(t, [{ column: '金额', strategy: 'median' }]);
  assert.strictEqual(r.table.rows[1][0], 20);
});
