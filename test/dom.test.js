/* =========================================================
 * test/dom.test.js — ui/dom.js 纯函数部分（Node 环境）
 * DOM 交互部分（el/toast/modal/renderDataTable）由阶段9 浏览器验收
 * ======================================================= */
'use strict';
require('../js/ui/dom.js');

const D = globalThis.DPDom;

function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '相等断言失败') + '：期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}
function deepEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((msg || '深比较失败') + '：期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
  }
}

test('typeLabel 八种类型中文映射', () => {
  eq(D.typeLabel('number'), '数字');
  eq(D.typeLabel('date'), '日期');
  eq(D.typeLabel('boolean'), '布尔');
  eq(D.typeLabel('string'), '文本');
  eq(D.typeLabel('number-string'), '数字(文本)');
  eq(D.typeLabel('date-string'), '日期(文本)');
  eq(D.typeLabel('mixed'), '混合');
  eq(D.typeLabel('empty'), '空列');
});

test('typeLabel 未知类型原样返回，空值返回空串', () => {
  eq(D.typeLabel('whatever'), 'whatever');
  eq(D.typeLabel(''), '');
  eq(D.typeLabel(undefined), '');
});

test('colNames 不传类型返回全部列名', () => {
  const t = DPCore.createTable('t', ['a', 'b', 'c'], [[1, 'x', '2']]);
  deepEq(D.colNames(t), ['a', 'b', 'c']);
});

test('colNames 按类型数组筛选', () => {
  const t = DPCore.createTable('t', ['a', 'b', 'c', 'd'], [[1, 'x', '2', new Date(2024, 0, 1)]]);
  // 推断类型：a=number b=string c=number-string d=date
  deepEq(D.colNames(t, ['number']), ['a']);
  deepEq(D.colNames(t, ['number', 'number-string']), ['a', 'c']);
  deepEq(D.colNames(t, ['string', 'date']), ['b', 'd']);
  deepEq(D.colNames(t, ['boolean']), []);
});

test('TYPE_LABELS 覆盖八种推断类型', () => {
  ['number', 'date', 'boolean', 'string', 'number-string', 'date-string', 'mixed', 'empty']
    .forEach(function (tp) {
      assert(D.TYPE_LABELS[tp], '缺少类型标签: ' + tp);
    });
});
