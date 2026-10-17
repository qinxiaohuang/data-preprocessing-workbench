/* 阶段1测试：table.js — 数据表模型 / 类型推断 / 统计 */
'use strict';
const C = globalThis.DPCore;
const assert = require('assert');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------- isNull ---------- */
test('isNull：null/undefined/空串/纯空白 判空', () => {
  assert.ok(C.isNull(null));
  assert.ok(C.isNull(undefined));
  assert.ok(C.isNull(''));
  assert.ok(C.isNull('   '));
  assert.ok(!C.isNull(0));
  assert.ok(!C.isNull(false));
  assert.ok(!C.isNull('a'));
});

/* ---------- toNumber ---------- */
test('toNumber：常规数字与文本数字', () => {
  assert.strictEqual(C.toNumber(3), 3);
  assert.strictEqual(C.toNumber('123'), 123);
  assert.strictEqual(C.toNumber(' 45.5 '), 45.5);
  assert.strictEqual(C.toNumber('1,234.5'), 1234.5);
  assert.strictEqual(C.toNumber('-7'), -7);
  assert.strictEqual(C.toNumber('1e3'), 1000);
});

test('toNumber：百分号与非法输入', () => {
  assert.ok(near(C.toNumber('12%'), 0.12));
  assert.strictEqual(C.toNumber('abc'), null);
  assert.strictEqual(C.toNumber('12px'), null);
  assert.strictEqual(C.toNumber(''), null);
  assert.strictEqual(C.toNumber(NaN), null);
  assert.strictEqual(C.toNumber(Infinity), null);
  assert.strictEqual(C.toNumber(true), 1);
  assert.strictEqual(C.toNumber(false), 0);
});

/* ---------- parseDate ---------- */
test('parseDate：常见中文/斜杠/横杠格式', () => {
  const d1 = C.parseDate('2024-01-05');
  assert.ok(d1 instanceof Date && d1.getFullYear() === 2024 && d1.getMonth() === 0 && d1.getDate() === 5);
  const d2 = C.parseDate('2024/1/5');
  assert.ok(d2 && d2.getDate() === 5);
  const d3 = C.parseDate('2024年1月5日');
  assert.ok(d3 && d3.getMonth() === 0);
  const d4 = C.parseDate('2024-01-05 13:30');
  assert.ok(d4 && d4.getHours() === 13 && d4.getMinutes() === 30);
  const d5 = C.parseDate('2024/1/5 09:05:25');
  assert.ok(d5 && d5.getSeconds() === 25);
});

test('parseDate：非法与边界', () => {
  assert.strictEqual(C.parseDate('2024-02-31'), null, '假日期应被拒绝');
  assert.strictEqual(C.parseDate('2024-13-01'), null);
  assert.strictEqual(C.parseDate('abc'), null);
  assert.strictEqual(C.parseDate('123'), null, '纯数字不是日期');
  assert.strictEqual(C.parseDate(45600), null, '数字不在无选项时转日期');
  assert.strictEqual(C.parseDate(''), null);
  const src = new Date(2024, 0, 5);
  const cp = C.parseDate(src);
  assert.ok(cp instanceof Date && cp.getTime() === src.getTime());
  assert.ok(!(cp === src), '应返回副本');
});

/* ---------- inferColumnType ---------- */
test('inferColumnType：纯类型识别', () => {
  assert.strictEqual(C.inferColumnType([1, 2, 3.5]), 'number');
  assert.strictEqual(C.inferColumnType([new Date(2024, 0, 1), new Date(2024, 1, 1)]), 'date');
  assert.strictEqual(C.inferColumnType([true, false, true]), 'boolean');
  assert.strictEqual(C.inferColumnType(['北京', '上海']), 'string');
  assert.strictEqual(C.inferColumnType([null, '', '  ']), 'empty');
});

test('inferColumnType：文本型数字与文本型日期', () => {
  assert.strictEqual(C.inferColumnType(['123', ' 45.5 ', null]), 'number-string');
  assert.strictEqual(C.inferColumnType(['2024-01-01', '2024/2/1']), 'date-string');
});

test('inferColumnType：混合类型', () => {
  assert.strictEqual(C.inferColumnType([1, 'a']), 'mixed');
  assert.strictEqual(C.inferColumnType([1, new Date()]), 'mixed');
});

/* ---------- createTable / cloneTable ---------- */
test('createTable：显式列名 + 自动类型推断', () => {
  const t = C.createTable('订单', ['id', '金额', '日期', '城市'], [
    [1, '99.5', '2024-01-01', '北京'],
    [2, '100', '2024-01-02', '上海'],
    [3, null, null, null]
  ]);
  assert.deepStrictEqual(t.columns.map(c => c.name), ['id', '金额', '日期', '城市']);
  assert.strictEqual(t.columns[0].type, 'number');
  assert.strictEqual(t.columns[1].type, 'number-string');
  assert.strictEqual(t.columns[2].type, 'date-string');
  assert.strictEqual(t.columns[3].type, 'string');
  assert.strictEqual(t.rows.length, 3);
});

test('cloneTable：深拷贝行，互不影响', () => {
  const t = C.createTable('t', ['a'], [[1], [2]]);
  const t2 = C.cloneTable(t);
  t2.rows[0][0] = 999;
  t2.columns[0].name = 'b';
  assert.strictEqual(t.rows[0][0], 1);
  assert.strictEqual(t.columns[0].name, 'a');
});

test('colIndex / columnValues', () => {
  const t = C.createTable('t', ['x', 'y'], [[1, 4], [2, 5]]);
  assert.strictEqual(C.colIndex(t, 'y'), 1);
  assert.deepStrictEqual(C.columnValues(t, 'x'), [1, 2]);
  assert.throws(() => C.columnValues(t, 'z'));
});

/* ---------- 统计 ---------- */
test('quantileSorted：线性插值（type-7）', () => {
  const s = [1, 2, 3, 4];
  assert.ok(near(C.quantileSorted(s, 0.25), 1.75));
  assert.ok(near(C.quantileSorted(s, 0.5), 2.5));
  assert.ok(near(C.quantileSorted(s, 0.75), 3.25));
  assert.ok(near(C.quantileSorted([1, 2, 3, 4, 5], 0.25), 2));
  assert.strictEqual(C.quantileSorted([], 0.5), null);
});

test('numericStats：奇数个样本', () => {
  const s = C.numericStats([1, 2, 3, 4, 5]);
  assert.strictEqual(s.count, 5);
  assert.strictEqual(s.min, 1);
  assert.strictEqual(s.max, 5);
  assert.ok(near(s.mean, 3));
  assert.strictEqual(s.median, 3);
  assert.strictEqual(s.q1, 2);
  assert.strictEqual(s.q3, 4);
  assert.ok(near(s.sum, 15));
  assert.ok(s.stdev > 0);
});

test('numericStats：跳过空值与非数字', () => {
  const s = C.numericStats([1, null, '', 'abc', 3]);
  assert.strictEqual(s.count, 2);
  assert.strictEqual(s.missing, 3);
  assert.strictEqual(s.median, 2);
});

test('numericStats：全空列', () => {
  const s = C.numericStats([null, '', undefined]);
  assert.strictEqual(s.count, 0);
  assert.strictEqual(s.min, null);
  assert.strictEqual(s.median, null);
});

test('uniqCount / modeOf', () => {
  assert.strictEqual(C.uniqCount(['a', 'b', 'a', null, '']), 2);
  const m = C.modeOf(['a', 'b', 'a', 'a']);
  assert.strictEqual(m.value, 'a');
  assert.strictEqual(m.count, 3);
  const md = C.modeOf([new Date(2024, 0, 1), new Date(2024, 0, 1), new Date(2024, 0, 2)]);
  assert.ok(md.value instanceof Date && md.count === 2);
  assert.strictEqual(C.modeOf([null, '']), null);
});

/* ---------- 序列化（备份/持久化） ---------- */

test('tableToJSON / tableFromJSON：Date 往返一致', () => {
  const t = C.createTable('t', ['d', 'n', 's'], [
    [new Date(2024, 0, 5, 13, 30), 1.5, 'x'],
    [null, null, '']
  ]);
  const json = JSON.stringify(C.tableToJSON(t)); // 必须可 JSON 序列化
  const t2 = C.tableFromJSON(JSON.parse(json));
  assert.ok(t2.rows[0][0] instanceof Date);
  assert.strictEqual(t2.rows[0][0].getTime(), new Date(2024, 0, 5, 13, 30).getTime());
  assert.strictEqual(t2.rows[0][1], 1.5);
  assert.strictEqual(t2.rows[1][0], null);
  assert.deepStrictEqual(t2.columns.map(c => c.name), ['d', 'n', 's']);
});
