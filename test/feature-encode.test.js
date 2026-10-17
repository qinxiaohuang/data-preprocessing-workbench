/* 阶段5测试：ops-feature.js + ops-encode.js */
'use strict';
const C = globalThis.DPCore;
const assert = require('assert');

function buildFeatTable() {
  return C.createTable('销售', ['产品', '单价', '数量', '日期', '备注'], [
    ['A', 10, 2, new Date(2024, 0, 7), 'sku-001-华东'],   // 2024-01-07 周日
    ['B', 20, null, new Date(2024, 5, 15), 'sku-002-华北'], // 2024-06-15 周六
    ['C', 5, 4, new Date(2024, 8, 2), 'other'],             // 2024-09-02 周一
    ['D', null, 3, null, null],
    ['E', 8, 0, '2024-10-20', 'sku-003-华东']               // 2024-10-20 周日（文本日期）
  ]);
}

/* ---------- 四则运算 ---------- */

test('特征-四则运算：列与列、列与常数', () => {
  const r = C.applyFeature(buildFeatTable(), { kind: 'arithmetic', newColumn: '金额', colA: '单价', op: '*', colB: '数量' });
  const idx = r.table.columns.length - 1;
  assert.strictEqual(r.table.columns[idx].name, '金额');
  assert.strictEqual(r.table.rows[0][idx], 20);
  assert.strictEqual(r.table.rows[1][idx], null, '数量为空 → null');
  assert.strictEqual(r.table.rows[2][idx], 20);
  assert.strictEqual(r.table.rows[4][idx], 0, '8*0=0');
  const r2 = C.applyFeature(buildFeatTable(), { kind: 'arithmetic', newColumn: '含税', colA: '单价', op: '*', constB: 1.13 });
  const i2 = r2.table.columns.length - 1;
  assert.ok(Math.abs(r2.table.rows[0][i2] - 11.3) < 1e-9);
});

test('特征-四则运算：除以零 → null；源列不存在报错', () => {
  const r = C.applyFeature(buildFeatTable(), { kind: 'arithmetic', newColumn: '单件', colA: '数量', op: '/', colB: '数量' });
  const idx = r.table.columns.length - 1;
  assert.strictEqual(r.table.rows[0][idx], 1);
  assert.strictEqual(r.table.rows[4][idx], null, '0/0 → null');
  assert.throws(() => C.applyFeature(buildFeatTable(), { kind: 'arithmetic', newColumn: 'x', colA: '无', op: '+', constB: 1 }), /不存在/);
  assert.throws(() => C.applyFeature(buildFeatTable(), { kind: 'arithmetic', newColumn: 'x', colA: '单价', op: '%', constB: 1 }), /运算符/);
});

/* ---------- 条件生成 ---------- */

test('特征-条件生成：数值比较与 then/else', () => {
  const r = C.applyFeature(buildFeatTable(), { kind: 'condition', newColumn: '高价', column: '单价', op: '>', value: 8, then: '高', else: '低' });
  const idx = r.table.columns.length - 1;
  assert.deepStrictEqual(r.table.rows.map(x => x[idx]), ['高', '高', '低', '低', '低']);
});

test('特征-条件生成：字符串相等 / contains / isNull', () => {
  const r1 = C.applyFeature(buildFeatTable(), { kind: 'condition', newColumn: '华东', column: '备注', op: 'contains', value: '华东', then: 1, else: 0 });
  const i1 = r1.table.columns.length - 1;
  assert.deepStrictEqual(r1.table.rows.map(x => x[i1]), [1, 0, 0, 0, 1]);
  const r2 = C.applyFeature(buildFeatTable(), { kind: 'condition', newColumn: '缺备注', column: '备注', op: 'isNull', then: '缺', else: '有' });
  const i2 = r2.table.columns.length - 1;
  assert.deepStrictEqual(r2.table.rows.map(x => x[i2]), ['有', '有', '有', '缺', '有']);
  // 文本不支持大小比较 → false 走 else
  const r3 = C.applyFeature(buildFeatTable(), { kind: 'condition', newColumn: 'cmp', column: '产品', op: '>', value: 'B', then: 1, else: 0 });
  const i3 = r3.table.columns.length - 1;
  assert.deepStrictEqual(r3.table.rows.map(x => x[i3]), [0, 0, 0, 0, 0]);
});

test('特征-条件生成：缺比较值报错', () => {
  assert.throws(() => C.applyFeature(buildFeatTable(), { kind: 'condition', newColumn: 'x', column: '单价', op: '>', then: 1, else: 0 }), /比较值/);
});

/* ---------- 日期拆解 ---------- */

test('特征-日期拆解：年月日星期季度是否周末', () => {
  const t = buildFeatTable();
  const parts = { year: [2024, 2024, 2024, null, 2024], month: [1, 6, 9, null, 10], day: [7, 15, 2, null, 20], weekday: [7, 6, 1, null, 7], quarter: [1, 2, 3, null, 4], isWeekend: [1, 1, 0, null, 1] };
  Object.keys(parts).forEach(part => {
    const r = C.applyFeature(t, { kind: 'date-part', newColumn: 'd_' + part, column: '日期', part: part });
    const idx = r.table.columns.length - 1;
    assert.deepStrictEqual(r.table.rows.map(x => x[idx]), parts[part], part + ' 不符');
  });
});

test('特征-日期拆解：非法 part 报错', () => {
  assert.throws(() => C.applyFeature(buildFeatTable(), { kind: 'date-part', newColumn: 'x', column: '日期', part: 'hour' }), /日期部分/);
});

/* ---------- 文本提取 ---------- */

test('特征-文本提取：截取 / 拆分 / 包含', () => {
  const t = buildFeatTable();
  const r1 = C.applyFeature(t, { kind: 'text', newColumn: '前缀', column: '备注', op: 'substring', start: 0, length: 3 });
  const i1 = r1.table.columns.length - 1;
  assert.deepStrictEqual(r1.table.rows.map(x => x[i1]), ['sku', 'sku', 'oth', null, 'sku']);
  const r2 = C.applyFeature(t, { kind: 'text', newColumn: '区域', column: '备注', op: 'split', delimiter: '-', index: 2 });
  const i2 = r2.table.columns.length - 1;
  assert.deepStrictEqual(r2.table.rows.map(x => x[i2]), ['华东', '华北', null, null, '华东'], 'other 只有一段，index 2 越界 → null');
  const r3 = C.applyFeature(t, { kind: 'text', newColumn: '含sku', column: '备注', op: 'contains', keyword: 'sku' });
  const i3 = r3.table.columns.length - 1;
  assert.deepStrictEqual(r3.table.rows.map(x => x[i3]), [1, 1, 0, null, 1]);
});

/* ---------- 分箱 ---------- */

test('特征-分箱：等宽', () => {
  // 单价：10,20,5,null,8 → min5 max20，3 箱，宽 5：[5,10) [10,15) [15,20]
  const r = C.applyFeature(buildFeatTable(), { kind: 'bin', newColumn: '价位', column: '单价', method: 'equal-width', bins: 3 });
  const idx = r.table.columns.length - 1;
  assert.deepStrictEqual(r.table.rows.map(x => x[idx]), ['[10, 15)', '[15, 20]', '[5, 10)', null, '[5, 10)']);
  assert.deepStrictEqual(r.info.binEdges, [5, 10, 15, 20]);
});

test('特征-分箱：等频', () => {
  const rows = [];
  for (let i = 1; i <= 20; i++) rows.push(['x' + i, i]);
  const t = C.createTable('t', ['id', 'v'], rows);
  const r = C.applyFeature(t, { kind: 'bin', newColumn: '档', column: 'v', method: 'equal-freq', bins: 4 });
  const idx = r.table.columns.length - 1;
  const counts = {};
  r.table.rows.forEach(x => { counts[x[idx]] = (counts[x[idx]] || 0) + 1; });
  const ks = Object.keys(counts);
  assert.strictEqual(ks.length, 4, '应有 4 档');
  ks.forEach(k => assert.strictEqual(counts[k], 5, '每档 5 行'));
});

test('特征-分箱：自定义区间（成绩优良中差）', () => {
  const t = C.createTable('成绩', ['姓名', '分数'], [['甲', 95], ['乙', 82], ['丙', 66], ['丁', 40], ['戊', null], ['己', 'abc']]);
  const r = C.applyFeature(t, { kind: 'bin', newColumn: '等级', column: '分数', method: 'custom', edges: [0, 60, 75, 90, 100], labels: ['差', '中', '良', '优'] });
  const idx = r.table.columns.length - 1;
  assert.deepStrictEqual(r.table.rows.map(x => x[idx]), ['优', '良', '中', '差', null, null], '空值与非数字 → null');
});

test('特征-分箱：范围外 → null；参数校验', () => {
  const t = C.createTable('t', ['v'], [[-5], [50], [200]]);
  const r = C.applyFeature(t, { kind: 'bin', newColumn: 'b', column: 'v', method: 'custom', edges: [0, 100], labels: ['内'] });
  const idx = r.table.columns.length - 1;
  assert.deepStrictEqual(r.table.rows.map(x => x[idx]), [null, '内', null]);
  assert.throws(() => C.applyFeature(t, { kind: 'bin', newColumn: 'b2', column: 'v', method: 'custom', edges: [10, 5], labels: ['x'] }), /递增/);
  assert.throws(() => C.applyFeature(t, { kind: 'bin', newColumn: 'b3', column: 'v', method: 'custom', edges: [0, 100], labels: ['a', 'b'] }), /标签数量/);
  assert.throws(() => C.applyFeature(t, { kind: 'bin', newColumn: 'b4', column: 'v', method: 'equal-width', bins: 1 }), /至少为 2/);
  const same = C.createTable('s', ['v'], [[7], [7], [7]]);
  assert.throws(() => C.applyFeature(same, { kind: 'bin', newColumn: 'b', column: 'v', method: 'equal-width', bins: 3 }), /相同/);
});

/* ---------- 通用规则 ---------- */

test('特征-通用：新列名校验与未知类型', () => {
  const t = buildFeatTable();
  assert.throws(() => C.applyFeature(t, { kind: 'arithmetic', newColumn: '', colA: '单价', op: '+', constB: 1 }), /不能为空/);
  assert.throws(() => C.applyFeature(t, { kind: 'arithmetic', newColumn: '单价', colA: '单价', op: '+', constB: 1 }), /已存在/);
  assert.throws(() => C.applyFeature(t, { kind: 'fly', newColumn: 'x' }), /未知特征类型/);
});

test('特征-执行：原列不被修改', () => {
  const t = buildFeatTable();
  const before = t.rows.map(r => r[1]);
  const r = C.applyFeature(t, { kind: 'arithmetic', newColumn: 'x', colA: '单价', op: '+', constB: 1 });
  assert.deepStrictEqual(t.rows.map(x => x[1]), before, '原表不动');
  assert.strictEqual(r.table.columns.length, 6);
  assert.deepStrictEqual(r.table.rows.map(x => x[1]), before, '新表原列值不变');
  assert.strictEqual(r.info.added, 1);
  assert.strictEqual(r.info.nullCount, 1, '单价 1 个空 → 新列 1 个空');
});

test('特征-预演：前 10 行 + 空值计数', () => {
  const rows = [];
  for (let i = 1; i <= 15; i++) rows.push([i, i * 2]);
  const t = C.createTable('t', ['a', 'b'], rows);
  const p = C.featurePreview(t, { kind: 'arithmetic', newColumn: 'c', colA: 'a', op: '+', colB: 'b' });
  assert.strictEqual(p.values.length, 10, '只预览 10 行');
  assert.strictEqual(p.values[0], 3);
  assert.strictEqual(p.total, 15);
  assert.strictEqual(p.nullCount, 0);
  assert.strictEqual(t.columns.length, 2, '预演不改表');
});

/* ---------- 类别编码 ---------- */

function buildEncTable() {
  return C.createTable('客户', ['等级', '城市'], [
    ['高', '北京'], ['中', '上海'], ['低', '北京'], ['高', null], [null, '北京'], ['中', '广州']
  ]);
}

test('编码-预演：One-Hot 类别分布与新列名', () => {
  const p = C.encodePreview(buildEncTable(), { column: '等级', method: 'onehot' });
  assert.strictEqual(p.uniqueCount, 3);
  assert.deepStrictEqual(p.newColumns, ['等级_高', '等级_中', '等级_低']);
  assert.strictEqual(p.highCardinality, false);
  const freq = {};
  p.values.forEach(v => { freq[v.value] = v.count; });
  assert.deepStrictEqual(freq, { '高': 2, '中': 2, '低': 1 }, '空值不计入类别');
});

test('编码-One-Hot：新列只有 0/1，原列保留', () => {
  const t = buildEncTable();
  const r = C.applyEncode(t, { column: '等级', method: 'onehot' });
  assert.strictEqual(r.table.columns.length, 5, '3 原列? 2 原列 + 3 新列');
  assert.deepStrictEqual(r.table.columns.slice(2).map(c => c.name), ['等级_高', '等级_中', '等级_低']);
  const expected = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, 0], [0, 1, 0]];
  r.table.rows.forEach((row, i) => assert.deepStrictEqual(row.slice(2), expected[i], '行 ' + i));
  r.table.rows.forEach(row => row.slice(2).forEach(v => assert.ok(v === 0 || v === 1, '只能 0/1')));
  assert.strictEqual(r.table.rows[0][0], '高', '原列保留');
  assert.strictEqual(r.info.added, 3);
});

test('编码-One-Hot：高基数提示', () => {
  const rows = [];
  for (let i = 0; i < 25; i++) rows.push(['c' + i]);
  const t = C.createTable('t', ['cat'], rows);
  const p = C.encodePreview(t, { column: 'cat', method: 'onehot' });
  assert.strictEqual(p.highCardinality, true);
  assert.ok(/慎用|建议/.test(p.warning));
});

test('编码-顺序编码：自定义次序 1 基映射', () => {
  const r = C.applyEncode(buildEncTable(), { column: '等级', method: 'ordinal', order: ['低', '中', '高'] });
  const idx = r.table.columns.length - 1;
  assert.strictEqual(r.table.columns[idx].name, '等级_编码');
  assert.deepStrictEqual(r.table.rows.map(x => x[idx]), [3, 2, 1, 3, null, 2], '低=1 中=2 高=3，空值 → null');
  assert.deepStrictEqual(r.info.mapping, { '低': 1, '中': 2, '高': 3 });
});

test('编码-顺序编码：次序外的值 → null 并在预演中列出', () => {
  const p = C.encodePreview(buildEncTable(), { column: '等级', method: 'ordinal', order: ['低', '高'] });
  assert.deepStrictEqual(p.unmapped, ['中']);
  const r = C.applyEncode(buildEncTable(), { column: '等级', method: 'ordinal', order: ['低', '高'] });
  const idx = r.table.columns.length - 1;
  assert.strictEqual(r.table.rows[1][idx], null, '中 不在次序内 → null');
});

test('编码-参数校验：列不存在 / 缺 order / 新列重名', () => {
  const t = buildEncTable();
  assert.throws(() => C.encodePreview(t, { column: '无', method: 'onehot' }), /不存在/);
  assert.throws(() => C.encodePreview(t, { column: '等级', method: 'ordinal' }), /自定义次序/);
  assert.throws(() => C.encodePreview(t, { column: '等级', method: 'abc' }), /编码方法/);
  const t2 = C.applyEncode(t, { column: '等级', method: 'onehot' }).table;
  assert.throws(() => C.encodePreview(t2, { column: '等级', method: 'onehot' }), /重名/);
});
