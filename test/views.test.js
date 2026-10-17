/* =========================================================
 * test/views.test.js — 阶段8：9 个视图模块渲染冒烟测试
 * 用极简 DOM 垫片在 Node 中执行 view.render()，验证：
 *   1) 每个模块都已注册并暴露 render
 *   2) 用真实样例数据渲染不抛错，且输出关键节点/标题
 * 真实交互（点击/弹窗/上传）由阶段9 浏览器验收覆盖
 * ======================================================= */
'use strict';
const shim = require('./ui-shim.js');

require('../js/ui/ui-utils.js');
require('../js/ui/dom.js');
require('../js/ui/views/view-audit.js');
require('../js/ui/views/view-dedup.js');
require('../js/ui/views/view-missing.js');
require('../js/ui/views/view-outlier.js');
require('../js/ui/views/view-type.js');
require('../js/ui/views/view-feature.js');
require('../js/ui/views/view-encode.js');
require('../js/ui/views/view-select.js');
require('../js/ui/views/view-merge.js');

const dom = globalThis.DPDom;
const C = globalThis.DPCore;
const Ui = globalThis.DPUi;

const MOD_IDS = ['audit', 'dedup', 'missing', 'outlier', 'type', 'feature', 'encode', 'select', 'merge'];
const TITLES = {
  audit: '读取与查看', dedup: '重复值', missing: '缺失值', outlier: '异常值',
  type: '类型转换', feature: '特征工程', encode: '类别编码', select: '字段筛选', merge: '多文件合并'
};

function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '相等断言失败') + '：期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

function walk(node, fn) {
  fn(node);
  (node.childNodes || []).forEach(function (c) { walk(c, fn); });
}
function allText(node) {
  const parts = [];
  walk(node, function (n) { if (n._text) parts.push(n._text); });
  return parts.join(' ');
}
function find(node, pred) {
  let hit = null;
  walk(node, function (n) { if (!hit && pred(n)) hit = n; });
  return hit;
}
function tagCount(node, tag) {
  let n = 0;
  walk(node, function (x) { if (x.tagName === String(tag).toUpperCase()) n++; });
  return n;
}
// 收集策略表里每行的下拉（顺序与列一致）
function columnSelects(box) {
  const table = find(box, function (n) { return /data-table/.test(n.className); });
  const sels = [];
  walk(table, function (n) { if (n.tagName === 'SELECT') sels.push(n); });
  return sels;
}
// 垫片不派发事件，直接调用已注册的 change 监听
function fireChange(el) {
  (el.listeners.change || []).forEach(function (fn) { fn({ target: el }); });
}
function impactText(box) {
  return allText(find(box, function (n) { return /impact-text/.test(n.className); }));
}

function sampleTable() {
  return C.createTable('订单', ['id', 'name', 'amount', 'date', 'city', 'note'], [
    [1, '甲', 10, new Date(2024, 0, 1), '北京', 'x'],
    [2, '乙', null, new Date(2024, 1, 2), '上海', null],
    [2, '乙', null, new Date(2024, 1, 2), '上海', null],
    [3, '丙', 999999, new Date(2024, 2, 3), '广州', 'y'],
    [4, '丁', 20, '2024-03-04', '深圳', 'z'],
    [5, '戊', 30, null, '北京', null]
  ]);
}

function makePipeline(t) {
  return C.createPipeline(t);
}

function makeCtx(state) {
  const sh = state.file ? state.sheets[state.file.activeSheet] : null;
  return {
    C: C, Ui: Ui, dom: dom, state: state,
    sheet: function () { return sh; },
    pl: function () { return sh ? sh.pipeline : null; },
    setModule: function () {}, refresh: function () {}, save: function () {},
    runStep: function () {}, auditCurrent: function () {}, switchSheet: function () {},
    parseFile: function () { return Promise.resolve(sampleTable()); }
  };
}

function ctxWithTable(t, modId) {
  const state = {
    file: { name: t.name + '.xlsx', sheetNames: ['S1'], activeSheet: 'S1' },
    sheets: { S1: { pipeline: makePipeline(t), audit: C.auditTable(t), auditDone: true } },
    ui: { module: modId || 'audit', logCollapsed: false }
  };
  return makeCtx(state);
}

function ctxWithData() {
  return ctxWithTable(sampleTable(), 'audit');
}

function ctxEmpty() {
  return makeCtx({ file: null, sheets: {}, ui: { module: 'audit', logCollapsed: false } });
}

/* ---------- 结构注册 ---------- */

test('9 个模块视图全部注册且暴露 render', () => {
  MOD_IDS.forEach(function (id) {
    const v = globalThis.DPViews[id];
    assert(v && typeof v.render === 'function', '模块 ' + id + ' 未注册 render');
  });
});

/* ---------- 逐模块渲染（有数据） ---------- */

MOD_IDS.forEach(function (id) {
  test('渲染「' + TITLES[id] + '」有数据时不抛错且含标题', () => {
    const box = new shim.ShimNode('div');
    globalThis.DPViews[id].render(box, ctxWithData());
    assert(box.childNodes.length > 0, '未输出任何节点');
    assert(allText(box).indexOf(TITLES[id]) >= 0, '缺少标题：' + TITLES[id]);
    assert(find(box, function (n) { return /view-body/.test(n.className); }), '缺少 .view-body');
    // 「读取与查看」是只读视图，不含执行影响条；其余模块均应有
    if (id !== 'audit') {
      assert(find(box, function (n) { return /impact-bar/.test(n.className); }), '缺少 .impact-bar');
    }
  });
});

test('「读取与查看」无数据时给出引导提示', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.audit.render(box, ctxEmpty());
  assert(allText(box).indexOf('尚未加载数据') >= 0, '缺少未加载提示');
});

test('「读取与查看」未体检时显示生成按钮', () => {
  const t = sampleTable();
  const state = {
    file: { name: 'a.xlsx', sheetNames: ['S1'], activeSheet: 'S1' },
    sheets: { S1: { pipeline: makePipeline(t), audit: null, auditDone: false } },
    ui: { module: 'audit' }
  };
  const box = new shim.ShimNode('div');
  globalThis.DPViews.audit.render(box, makeCtx(state));
  assert(allText(box).indexOf('尚未生成体检报告') >= 0, '缺少未体检提示');
  assert(allText(box).indexOf('生成本表体检报告') >= 0, '缺少生成按钮文案');
});

test('「读取与查看」体检完成后展示指标卡与列清单', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.audit.render(box, ctxWithData());
  const text = allText(box);
  assert(text.indexOf('行数') >= 0 && text.indexOf('列数') >= 0, '缺少指标卡');
  assert(text.indexOf('列清单') >= 0, '缺少列清单');
  assert(text.indexOf('id') >= 0 && text.indexOf('amount') >= 0, '缺少列名');
});

test('「重复值」检测到重复行并在预览中给出影响量', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.dedup.render(box, ctxWithData());
  const text = allText(box);
  assert(text.indexOf('将删除') >= 0, '缺少影响预览文案');
  assert(text.indexOf('1 行') >= 0, '样例数据应识别出 1 行重复');
});

test('「缺失值」列出缺失列并提供策略', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.missing.render(box, ctxWithData());
  const text = allText(box);
  assert(text.indexOf('缺失') >= 0, '缺少缺失相关文案');
  assert(tagCount(box, 'select') > 0, '缺少策略选择控件');
});

// 回归：applyMissing 返回的 colsDropped 是「列名数组」而非数量，
// 视图曾把它当数字用，导致影响预览出现「删除 列」与「列 8→NaN」
test('「缺失值」中位数填充的影响预览显示单元格数与行列数', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.missing.render(box, ctxWithData());
  const sels = columnSelects(box);
  eq(sels.length, 6, '应每列一个策略下拉');
  sels[2].value = 'median'; // amount 列（缺失 2 个）
  fireChange(sels[2]);
  const impact = impactText(box);
  assert(impact.indexOf('填充 2 个单元格') >= 0, '应显示填充 2 个单元格，实际：' + impact);
  assert(impact.indexOf('6→6 行') >= 0, '行数不应变化，实际：' + impact);
  assert(impact.indexOf('6→6 列') >= 0, '列数不应变化，实际：' + impact);
  assert(impact.indexOf('NaN') < 0, '不应出现 NaN，实际：' + impact);
});

test('「缺失值」删列的影响预览按数量统计，不出现空白数字', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.missing.render(box, ctxWithData());
  const sels = columnSelects(box);
  sels[5].value = 'drop-col'; // note 列
  fireChange(sels[5]);
  const impact = impactText(box);
  assert(impact.indexOf('删除 1 列') >= 0, '应显示删除 1 列，实际：' + impact);
  assert(impact.indexOf('6→5 列') >= 0, '列数应为 6→5，实际：' + impact);
  assert(impact.indexOf('NaN') < 0, '不应出现 NaN，实际：' + impact);
  assert(!/删除\s{2,}列/.test(impact), '不应出现空数字「删除  列」，实际：' + impact);
});

test('「异常值」对数值列给出检测结果与默认标记策略', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.outlier.render(box, ctxWithData());
  const text = allText(box);
  assert(text.indexOf('outlier_flag') >= 0 || text.indexOf('标记') >= 0, '缺少标记列说明');
  assert(find(box, function (n) { return n.tagName === 'SVG'; }), '缺少箱线图 SVG');
});

test('「类型转换」识别文本型数字列并给出转数字建议', () => {
  const t = C.createTable('客服', ['工号', '工单号', '金额'], [['1', 'A-1', '12'], ['2', 'A-2', '34']]);
  const box = new shim.ShimNode('div');
  globalThis.DPViews.type.render(box, ctxWithTable(t, 'type'));
  const text = allText(box);
  assert(text.indexOf('列清单') >= 0, '缺少列清单');
  assert(text.indexOf('数字(文本)') >= 0, '未识别文本型数字列');
  assert(text.indexOf('建议转数字') >= 0, '缺少转数字建议');
});

test('「类型转换」识别文本型日期列并给出转日期建议', () => {
  const t = C.createTable('登记', ['登记日期', '备注'], [['2024-01-05', 'ok'], ['2024-02-06', 'ok']]);
  const box = new shim.ShimNode('div');
  globalThis.DPViews.type.render(box, ctxWithTable(t, 'type'));
  const text = allText(box);
  assert(text.indexOf('日期(文本)') >= 0, '未识别文本型日期列');
  assert(text.indexOf('建议转日期') >= 0, '缺少转日期建议');
});

test('「特征工程」默认四则运算并给出新列名建议', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.feature.render(box, ctxWithData());
  const text = allText(box);
  assert(text.indexOf('派生方式') >= 0, '缺少派生方式选择');
  assert(text.indexOf('新列名') >= 0, '缺少新列名输入');
  const inputs = [];
  walk(box, function (n) { if (n.tagName === 'INPUT') inputs.push(n); });
  assert(inputs.some(function (n) { return /_加_|_减_|_乘_|_除_/.test(n.value); }), '缺少默认新列名建议');
});

// 回归：切换派生方式时，state.column 仍指向首列（非日期/数值列），
// 曾导致日期拆解 / 数值分箱默认拿到错误列、预览全为空
test('「特征工程」切换到日期拆解时自动选中可用日期列', () => {
  const t = C.createTable('t', ['num', 'd'], [
    [1, new Date(2024, 0, 15)],
    [2, new Date(2024, 3, 20)],
    [3, null]
  ]);
  const box = new shim.ShimNode('div');
  globalThis.DPViews.feature.render(box, ctxWithTable(t, 'feature'));
  const kindSel = find(box, function (n) {
    return n.tagName === 'SELECT' && (n.childNodes || []).some(function (o) {
      return o.tagName === 'OPTION' && o.value === 'date-part';
    });
  });
  assert(kindSel, '未找到派生方式下拉');
  kindSel.value = 'date-part';
  fireChange(kindSel);
  const nameInput = find(box, function (n) { return n.getAttribute('type') === 'text'; });
  assert(nameInput, '未找到新列名输入框');
  assert(/^d_/.test(nameInput.value), '新列名应基于日期列 d，实际：' + nameInput.value);
  const impact = impactText(box);
  assert(impact.indexOf('2 行有值') >= 0, '应有 2 行有值，实际：' + impact);
});

test('「特征工程」切换到数值分箱时自动选中可用数值列', () => {
  const t = C.createTable('t', ['label', 'num'], [
    ['a', 10], ['b', 20], ['c', 30], ['d', 40], ['e', 50]
  ]);
  const box = new shim.ShimNode('div');
  globalThis.DPViews.feature.render(box, ctxWithTable(t, 'feature'));
  const kindSel = find(box, function (n) {
    return n.tagName === 'SELECT' && (n.childNodes || []).some(function (o) {
      return o.tagName === 'OPTION' && o.value === 'bin';
    });
  });
  assert(kindSel, '未找到派生方式下拉');
  kindSel.value = 'bin';
  fireChange(kindSel);
  const nameInput = find(box, function (n) { return n.getAttribute('type') === 'text'; });
  assert(nameInput, '未找到新列名输入框');
  assert(/^num_/.test(nameInput.value), '新列名应基于数值列 num，实际：' + nameInput.value);
  const impact = impactText(box);
  assert(impact.indexOf('5 行有值') >= 0, '应有 5 行有值，实际：' + impact);
});

test('「类别编码」概览按基数给出 One-Hot 建议', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.encode.render(box, ctxWithData());
  const text = allText(box);
  assert(text.indexOf('文本列概览') >= 0, '缺少文本列概览');
  assert(text.indexOf('适合 One-Hot') >= 0, '低基数列未给出建议');
});

test('「字段筛选」默认保留全部列并显示保留行列数', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.select.render(box, ctxWithData());
  const text = allText(box);
  assert(text.indexOf('当前将保留') >= 0, '缺少保留预览');
  assert(text.indexOf('6 行') >= 0 && text.indexOf('6 列') >= 0, '默认应保留全部 6 行 6 列');
});

test('「多文件合并」未上传右表时给出引导', () => {
  const box = new shim.ShimNode('div');
  globalThis.DPViews.merge.render(box, ctxWithData());
  const text = allText(box);
  assert(text.indexOf('当前表（左表）') >= 0, '缺少左表信息');
  assert(text.indexOf('尚未上传第二张表') >= 0, '缺少右表引导');
});
