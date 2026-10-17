/* =========================================================
 * test/app-smoke.test.js — 阶段8：app.js 集成冒烟测试
 * 在 DOM 垫片中加载完整 UI 栈并运行 init()，验证五区骨架、
 * 导航锁、首页、日志与底栏的初始状态。
 * 真实上传/导出/IndexedDB 行为由阶段9 浏览器验收覆盖。
 * ======================================================= */
'use strict';
const shim = require('./ui-shim.js');
const doc = shim.document;

require('../js/ui/ui-utils.js');
require('../js/ui/dom.js');
require('../js/ui/store.js');
require('../js/ui/views/view-audit.js');
require('../js/ui/views/view-dedup.js');
require('../js/ui/views/view-missing.js');
require('../js/ui/views/view-outlier.js');
require('../js/ui/views/view-type.js');
require('../js/ui/views/view-feature.js');
require('../js/ui/views/view-encode.js');
require('../js/ui/views/view-select.js');
require('../js/ui/views/view-merge.js');
require('../js/ui/app.js'); // 加载即执行 init()

function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '相等断言失败') + '：期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

function walk(node, fn) {
  fn(node);
  (node.childNodes || []).forEach(function (c) { walk(c, fn); });
}
function find(node, pred) {
  let hit = null;
  walk(node, function (n) { if (!hit && pred(n)) hit = n; });
  return hit;
}
function allText(node) {
  const parts = [];
  walk(node, function (n) { if (n._text) parts.push(n._text); });
  return parts.join(' ');
}
function tagList(node, tag) {
  const out = [];
  walk(node, function (n) { if (n.tagName === String(tag).toUpperCase()) out.push(n); });
  return out;
}

const nav = doc.getElementById('nav');
const workspace = doc.getElementById('workspace');
const logpanel = doc.getElementById('logpanel');
const footer = doc.getElementById('footer');
const topbarInfo = doc.getElementById('fileInfo');

test('五个区域元素均已挂载并可渲染内容', () => {
  assert(nav.childNodes.length > 0, 'nav 未渲染');
  assert(workspace.childNodes.length > 0, 'workspace 未渲染');
  assert(logpanel.childNodes.length > 0, 'logpanel 未渲染');
  assert(footer.childNodes.length > 0, 'footer 未渲染');
  assert(topbarInfo.childNodes.length > 0, 'fileInfo 未渲染');
});

test('左侧导航含全部 9 个模块，按顺序编号', () => {
  const btns = tagList(nav, 'button');
  eq(btns.length, 9, '导航模块数量');
  assert(allText(nav).indexOf('读取与查看') >= 0, '缺少「读取与查看」');
  assert(allText(nav).indexOf('多文件合并') >= 0, '缺少「多文件合并」');
  const first = find(btns[0], function (n) { return /nav-item/.test(n.className); });
  assert(first, '第一个导航项缺少 .nav-item');
});

test('无数据时导航锁：仅「读取与查看」可进入', () => {
  const btns = tagList(nav, 'button');
  eq(/active/.test(btns[0].className), true, '第一个模块应为当前激活项');
  eq(/locked/.test(btns[0].className), false, '首个模块不应被锁');
  for (let i = 1; i < btns.length; i++) {
    eq(/locked/.test(btns[i].className), true, '模块 ' + i + ' 在无数据时应被锁');
  }
});

test('无数据时首页展示 dropzone 与本地运行说明', () => {
  const dz = find(workspace, function (n) { return /dropzone/.test(n.className); });
  assert(dz, '缺少 dropzone');
  const text = allText(workspace);
  assert(text.indexOf('数据预处理工作台') >= 0, '缺少标题');
  assert(text.indexOf('完全本地运行') >= 0, '缺少本地运行说明');
  assert(text.indexOf('无痕模式') >= 0, '缺少无痕模式警告');
});

test('顶栏文件信息区在无数据时显示未加载', () => {
  assert(allText(topbarInfo).indexOf('未加载数据') >= 0, '缺少未加载提示');
});

test('底栏初始：撤销与导出禁用，提示尚无步骤', () => {
  const btns = tagList(footer, 'button');
  eq(btns.length, 2, '底栏按钮数量（撤销 / 导出）');
  eq(btns[0].disabled, true, '撤销按钮应禁用');
  eq(btns[1].disabled, true, '导出按钮应禁用');
  assert(allText(footer).indexOf('未加载数据') >= 0, '缺少未加载提示');
});

test('日志面板初始为空态并含折叠与导出按钮', () => {
  const text = allText(logpanel);
  assert(text.indexOf('处理日志') >= 0, '缺少日志标题');
  assert(text.indexOf('暂无处理记录') >= 0, '缺少空态文案');
  const btns = tagList(logpanel, 'button');
  assert(btns.length >= 2, '缺少日志面板操作按钮');
  assert(btns.some(function (b) { return /log-toggle/.test(b.className); }), '缺少折叠按钮');
  assert(btns.some(function (b) { return allText(b).indexOf('导出日志') >= 0; }), '缺少导出日志按钮');
});
