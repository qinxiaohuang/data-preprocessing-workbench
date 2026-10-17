/* 阶段6测试：ops-select.js + ops-merge.js */
'use strict';
const C = globalThis.DPCore;
const assert = require('assert');

/* ---------- 字段筛选 ---------- */

function buildSelTable() {
  return C.createTable('员工', ['姓名', '部门', '年龄', '工资'], [
    ['张三', '技术', 28, 12000],
    ['李四', '销售', 35, 9000],
    ['王五', '技术', 42, 15000],
    ['赵六', '销售', null, 8000],
    ['钱七', '技术', 31, null]
  ]);
}

test('selectPreview：只选列时行数不变', () => {
  const p = C.selectPreview(buildSelTable(), { columns: ['姓名', '工资'] });
  assert.strictEqual(p.rows, 5);
  assert.strictEqual(p.cols, 2);
});

test('selectPreview：数值条件 + and/or 组合', () => {
  const t = buildSelTable();
  const and = C.selectPreview(t, { conditions: [{ column: '部门', op: '==', value: '技术' }, { column: '年龄', op: '>', value: 30 }], combinator: 'and' });
  assert.strictEqual(and.rows, 2, '技术且年龄>30：王五、钱七');
  const or = C.selectPreview(t, { conditions: [{ column: '年龄', op: '>', value: 40 }, { column: '工资', op: '<', value: 9000 }], combinator: 'or' });
  assert.strictEqual(or.rows, 2, '年龄>40 或 工资<9000：王五、赵六');
});

test('selectPreview：contains / isNull 条件', () => {
  const t = buildSelTable();
  const p1 = C.selectPreview(t, { conditions: [{ column: '姓名', op: 'contains', value: '三' }] });
  assert.strictEqual(p1.rows, 1);
  const p2 = C.selectPreview(t, { conditions: [{ column: '年龄', op: 'isNull' }] });
  assert.strictEqual(p2.rows, 1, '赵六年龄空');
  const p3 = C.selectPreview(t, { conditions: [{ column: '工资', op: 'notNull' }, { column: '部门', op: '==', value: '技术' }] });
  assert.strictEqual(p3.rows, 2);
});

test('applySelect：先筛行再选列，info 计数正确', () => {
  const t = buildSelTable();
  const r = C.applySelect(t, {
    columns: ['姓名', '部门'],
    conditions: [{ column: '工资', op: '>=', value: 9000 }],
    combinator: 'and'
  });
  assert.deepStrictEqual(r.table.columns.map(c => c.name), ['姓名', '部门']);
  assert.strictEqual(r.table.rows.length, 3, '张三李四王五');
  assert.strictEqual(r.info.rowsBefore, 5);
  assert.strictEqual(r.info.rowsAfter, 3);
  assert.strictEqual(r.info.removedRows, 2);
  assert.strictEqual(r.info.colsBefore, 4);
  assert.strictEqual(r.info.colsAfter, 2);
  assert.strictEqual(t.rows.length, 5, '原表不动');
  assert.strictEqual(t.columns.length, 4, '原表列不动');
});

test('applySelect：列顺序按勾选顺序；无条件时 combinator 为 null', () => {
  const r = C.applySelect(buildSelTable(), { columns: ['工资', '姓名'] });
  assert.deepStrictEqual(r.table.columns.map(c => c.name), ['工资', '姓名']);
  assert.strictEqual(r.table.rows[0][0], 12000);
  assert.strictEqual(r.info.conditionCount, 0);
  assert.strictEqual(r.info.combinator, null);
});

test('select/apply：参数校验', () => {
  const t = buildSelTable();
  assert.throws(() => C.selectPreview(t, { columns: [] }), /至少保留一列/);
  assert.throws(() => C.selectPreview(t, { columns: ['无'] }), /不存在/);
  assert.throws(() => C.selectPreview(t, { conditions: [{ column: '无', op: '==', value: 1 }] }), /不存在/);
  assert.throws(() => C.applySelect(t, { combinator: 'xor' }), /组合方式/);
});

/* ---------- 多文件合并 ---------- */

function buildOrders() {
  return C.createTable('订单', ['订单号', '产品ID', '数量'], [
    ['o1', 'p1', 2],
    ['o2', 'p2', 1],
    ['o3', 'p1', 3],
    ['o4', 'p9', 5],
    ['o5', null, 1]
  ]);
}

function buildProducts() {
  return C.createTable('产品', ['产品ID', '名称', '单价'], [
    ['p1', '苹果', 5],
    ['p2', '香蕉', 3],
    ['p3', '橙子', 4]
  ]);
}

test('diagnoseJoin：N:1 判定 + 匹配率 + 空键统计', () => {
  const d = C.diagnoseJoin(buildOrders(), buildProducts(), '产品ID', '产品ID');
  assert.strictEqual(d.type, 'N:1', '左表 p1 重复、右表唯一');
  assert.strictEqual(d.leftDup, 1);
  assert.strictEqual(d.rightDup, 0);
  assert.strictEqual(d.matchedLeftRows, 3, 'o1 o2 o3');
  assert.ok(Math.abs(d.matchRate - 0.6) < 1e-9, '3/5');
  assert.strictEqual(d.commonKeys, 2);
  assert.strictEqual(d.leftNullKeys, 1);
  assert.strictEqual(d.cartesianRisk, false);
});

test('diagnoseJoin：1:1 / 1:N / N:N 判定', () => {
  const u1 = C.createTable('u', ['id', 'n'], [[1, 'a'], [2, 'b']]);
  const u2 = C.createTable('p', ['id', 'age'], [[1, 20], [2, 30]]);
  assert.strictEqual(C.diagnoseJoin(u1, u2, 'id', 'id').type, '1:1');

  const dept = C.createTable('d', ['部门', '经理'], [['技术', '王'], ['销售', '李']]);
  const emp = C.createTable('e', ['部门', '姓名'], [['技术', 'a'], ['技术', 'b'], ['销售', 'c']]);
  assert.strictEqual(C.diagnoseJoin(dept, emp, '部门', '部门').type, '1:N');

  const d1 = C.createTable('x', ['k', 'v'], [['a', 1], ['a', 2]]);
  const d2 = C.createTable('y', ['k', 'w'], [['a', 'x'], ['a', 'y']]);
  const nn = C.diagnoseJoin(d1, d2, 'k', 'k');
  assert.strictEqual(nn.type, 'N:N');
  assert.strictEqual(nn.cartesianRisk, true, 'N:N 必须标记高风险');
});

test('diagnoseJoin：key 类型归一化（文本数字匹配数字）', () => {
  const l = C.createTable('l', ['k'], [['1'], ['2']]);
  const r = C.createTable('r', ['k'], [[1], [2]]);
  const d = C.diagnoseJoin(l, r, 'k', 'k');
  assert.strictEqual(d.matchRate, 1, "'1' 与 1 应匹配");
});

test('mergeTables：左连接保留全部左行，未匹配补 null', () => {
  const r = C.mergeTables(buildOrders(), buildProducts(), { leftKey: '产品ID', rightKey: '产品ID', how: 'left' });
  assert.deepStrictEqual(r.table.columns.map(c => c.name), ['订单号', '产品ID', '数量', '名称', '单价']);
  assert.strictEqual(r.table.rows.length, 5);
  assert.deepStrictEqual(r.table.rows[0], ['o1', 'p1', 2, '苹果', 5]);
  assert.deepStrictEqual(r.table.rows[3], ['o4', 'p9', 5, null, null], 'p9 无匹配');
  assert.deepStrictEqual(r.table.rows[4], ['o5', null, 1, null, null], '空键不匹配');
  assert.strictEqual(r.info.relation, 'N:1');
  assert.strictEqual(r.info.unmatchedLeftRows, 2);
  assert.strictEqual(r.info.outRows, 5);
});

test('mergeTables：内连接只保留匹配行', () => {
  const r = C.mergeTables(buildOrders(), buildProducts(), { leftKey: '产品ID', rightKey: '产品ID', how: 'inner' });
  assert.strictEqual(r.table.rows.length, 3);
  assert.ok(r.table.rows.every(row => row[3] !== null));
});

test('mergeTables：右连接保留全部右行，key 位补齐', () => {
  const r = C.mergeTables(buildOrders(), buildProducts(), { leftKey: '产品ID', rightKey: '产品ID', how: 'right' });
  assert.strictEqual(r.table.rows.length, 4, 'o1 o3 配 p1（2行）+ o2 配 p2 + p3 未匹配');
  const p3row = r.table.rows.find(row => row[1] === 'p3');
  assert.deepStrictEqual(p3row, [null, 'p3', null, '橙子', 4], '左表列补 null，key 用右表值');
  assert.strictEqual(r.info.unmatchedRightRows, 1);
});

test('mergeTables：同名冲突列加后缀', () => {
  const l = C.createTable('l', ['id', '名称'], [[1, '左']]);
  const r = C.createTable('r', ['id', '名称'], [[1, '右']]);
  const m = C.mergeTables(l, r, { leftKey: 'id', rightKey: 'id', how: 'left' });
  assert.deepStrictEqual(m.table.columns.map(c => c.name), ['id', '名称', '名称_右']);
  assert.deepStrictEqual(m.info.renamedColumns, [{ from: '名称', to: '名称_右' }]);
  assert.deepStrictEqual(m.table.rows[0], [1, '左', '右']);
});

test('mergeTables：N:N 产生笛卡尔积（2×2=4 行）', () => {
  const d1 = C.createTable('x', ['k', 'v'], [['a', 1], ['a', 2]]);
  const d2 = C.createTable('y', ['k', 'w'], [['a', 'x'], ['a', 'y']]);
  const m = C.mergeTables(d1, d2, { leftKey: 'k', rightKey: 'k', how: 'left' });
  assert.strictEqual(m.table.rows.length, 4);
  assert.strictEqual(m.info.cartesianRisk, true, 'info 携带高风险标记供 UI 拦截确认');
});

test('mergeTables：1:N 展开行数正确', () => {
  const dept = C.createTable('d', ['部门', '经理'], [['技术', '王'], ['销售', '李']]);
  const emp = C.createTable('e', ['部门', '姓名'], [['技术', 'a'], ['技术', 'b'], ['销售', 'c'], ['财务', 'd']]);
  const m = C.mergeTables(dept, emp, { leftKey: '部门', rightKey: '部门', how: 'left' });
  assert.strictEqual(m.table.rows.length, 3, '技术 2 行 + 销售 1 行');
  assert.strictEqual(m.info.relation, '1:N');
});

test('mergeTables：参数校验', () => {
  assert.throws(() => C.mergeTables(buildOrders(), buildProducts(), { leftKey: '无', rightKey: '产品ID', how: 'left' }), /左表不存在/);
  assert.throws(() => C.mergeTables(buildOrders(), buildProducts(), { leftKey: '产品ID', rightKey: '无', how: 'left' }), /右表不存在/);
  assert.throws(() => C.mergeTables(buildOrders(), buildProducts(), { leftKey: '产品ID', rightKey: '产品ID', how: 'full' }), /连接方式/);
});
