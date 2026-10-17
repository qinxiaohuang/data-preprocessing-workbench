/* test/ui-utils.test.js — UI 层纯函数工具测试 */
'use strict';
require('../js/ui/ui-utils.js'); // 挂 globalThis.DPUi

const C = globalThis.DPCore;
const Ui = globalThis.DPUi;

function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '相等断言失败') + '：期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

function sampleTable() {
  return C.createTable('t', ['id', '金额', '日期'], [
    [1, 100, new Date(2024, 0, 5)],
    [2, 200, new Date(2024, 0, 6)],
    [2, 200, new Date(2024, 0, 6)],
    [3, null, new Date(2024, 0, 7)]
  ]);
}

/* ---------- 文件名 ---------- */

test('makeExportName：原名_cleaned_时间戳.xlsx，剥离原扩展名', function () {
  const d = new Date(2026, 9, 15, 18, 30, 45);
  eq(Ui.makeExportName('销售数据.xlsx', d), '销售数据_cleaned_20261015-183045.xlsx');
  eq(Ui.makeExportName('a.b.csv', d), 'a.b_cleaned_20261015-183045.xlsx');
  eq(Ui.makeExportName('无后缀', d), '无后缀_cleaned_20261015-183045.xlsx');
  eq(Ui.makeExportName('', d), '数据集_cleaned_20261015-183045.xlsx');
});

test('timestampStr / formatTime 格式', function () {
  eq(Ui.timestampStr(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405');
  eq(Ui.formatTime('2026-10-15T10:26:25.000Z').length, 19);
  eq(Ui.formatTime('垃圾'), '垃圾');
});

/* ---------- 导航锁 ---------- */

test('canEnterModule：未加载数据时仅读取与查看可用', function () {
  eq(Ui.canEnterModule('audit', { hasData: false, auditDone: false }).ok, true);
  const r = Ui.canEnterModule('dedup', { hasData: false, auditDone: false });
  eq(r.ok, false);
  assert(r.reason.indexOf('上传') >= 0, '应提示先上传');
});

test('canEnterModule：已加载但未体检时清洗模块被拦截', function () {
  const r = Ui.canEnterModule('missing', { hasData: true, auditDone: false });
  eq(r.ok, false);
  assert(r.reason.indexOf('体检报告') >= 0, '应提示先体检');
  eq(Ui.canEnterModule('missing', { hasData: true, auditDone: true }).ok, true);
});

/* ---------- 单元格显示 ---------- */

test('formatCell：空值/日期/常规值', function () {
  eq(Ui.formatCell(null), '');
  eq(Ui.formatCell(undefined), '');
  eq(Ui.formatCell(new Date(2024, 0, 5)), '2024-01-05');
  eq(Ui.formatCell(3.14), '3.14');
  eq(Ui.formatCell('文本'), '文本');
});

/* ---------- 日志导出 ---------- */

test('logsToRows：含表头与执行/撤销两类条目', function () {
  const pl = C.createPipeline(sampleTable());
  C.applyStep(pl, {
    module: '重复值', rule: '整行判重，保留第一条',
    exec: function (t) { const r = C.dedupRows(t, { keyColumns: [], keep: 'first' }); return { table: r.table, info: {} }; }
  });
  C.undo(pl);
  const rows = Ui.logsToRows(C.getLogs(pl));
  eq(rows.length, 3); // 表头 + 执行 + 撤销
  eq(rows[1][1], '执行');
  eq(rows[2][1], '撤销');
  eq(rows[1][3], '重复值');
  eq(rows[1][7], 4); // 执行前行数
  eq(rows[1][8], 3); // 执行后行数
});

test('rowsToCSV：BOM 头与特殊字符转义', function () {
  const csv = Ui.rowsToCSV([['a', 'b'], ['含,逗号', '含"引号"'], ['换\n行', null]]);
  eq(csv.charCodeAt(0), 0xFEFF);
  assert(csv.indexOf('"含,逗号"') > 0, '逗号应加引号');
  assert(csv.indexOf('"含""引号"""') > 0, '引号应双写');
  assert(csv.indexOf('"换\n行"') > 0, '换行应加引号');
});

test('impactText：行列变化可读', function () {
  const t = Ui.impactText({ rowsBefore: 10, rowsAfter: 8, colsBefore: 5, colsAfter: 6, deltaRows: -2, deltaCols: 1 });
  assert(t.indexOf('10→8') >= 0 && t.indexOf('-2') >= 0 && t.indexOf('5→6') >= 0 && t.indexOf('+1') >= 0, t);
});

/* ---------- 步骤链序列化往返（持久化后可继续撤销） ---------- */

test('pipelineToJSON/FromJSON：含 Date 与快照，恢复后仍可撤销', function () {
  const pl = C.createPipeline(sampleTable());
  C.applyStep(pl, {
    module: '重复值', rule: '整行判重，保留第一条',
    exec: function (t) { const r = C.dedupRows(t, { keyColumns: [], keep: 'first' }); return { table: r.table, info: {} }; }
  });
  C.applyStep(pl, {
    module: '特征工程', rule: '日期拆解：年',
    exec: function (t) {
      const r = C.applyFeature(t, { kind: 'date-part', column: '日期', part: 'year', newColumn: '年' });
      return { table: r.table, info: r.info };
    }
  });

  const restored = C.pipelineFromJSON ? null : Ui.pipelineFromJSON(JSON.parse(JSON.stringify(Ui.pipelineToJSON(pl))));
  eq(restored.current.rows.length, 3);
  eq(restored.current.columns.length, 4);
  assert(restored.current.rows[0][2] instanceof Date, 'Date 应还原');
  eq(restored.steps.length, 2);
  eq(restored.logs.length, 2);

  // 恢复后撤销一步 → 回到去重后的表
  const u = C.undo(restored);
  eq(u.ok, true);
  eq(restored.current.rows.length, 3);
  eq(restored.current.columns.length, 3);
  // 再撤销 → 回到原始表
  C.undo(restored);
  eq(restored.current.rows.length, 4);
  eq(restored.logs.length, 4); // 2 执行 + 2 撤销
});

/* ---------- 工作区备份往返 ---------- */

function sampleState() {
  const pl = C.createPipeline(sampleTable());
  C.applyStep(pl, {
    module: '重复值', rule: '整行判重，保留第一条',
    exec: function (t) { const r = C.dedupRows(t, { keyColumns: [], keep: 'first' }); return { table: r.table, info: {} }; }
  });
  return {
    file: { name: '测试.xlsx', sheetNames: ['Sheet1'], activeSheet: 'Sheet1' },
    ui: { module: 'dedup', logCollapsed: false },
    sheets: { 'Sheet1': { pipeline: pl, audit: { rowCount: 4 }, auditDone: true } }
  };
}

test('buildBackupPayload/parseBackupPayload：完整往返', function () {
  const payload = Ui.buildBackupPayload(sampleState());
  eq(payload.app, 'dp-workbench');
  eq(payload.version, 1);
  const text = JSON.stringify(payload);
  const st = Ui.parseBackupPayload(text);
  eq(st.file.name, '测试.xlsx');
  eq(st.ui.module, 'dedup');
  eq(st.sheets['Sheet1'].auditDone, true);
  eq(st.sheets['Sheet1'].pipeline.current.rows.length, 3);
  assert(st.sheets['Sheet1'].pipeline.current.rows[0][2] instanceof Date, 'Date 应还原');
  eq(Ui.parseBackupPayload(payload).sheets['Sheet1'].pipeline.current.rows.length, 3, '也应接受对象输入');
});

test('parseBackupPayload：非法输入给出中文报错', function () {
  let msg = '';
  try { Ui.parseBackupPayload('{不是json'); } catch (e) { msg = e.message; }
  assert(msg.indexOf('JSON') >= 0, msg);
  try { Ui.parseBackupPayload('{"app":"别的"}'); } catch (e) { msg = e.message; }
  assert(msg.indexOf('备份') >= 0, msg);
  try { Ui.parseBackupPayload({ app: 'dp-workbench', version: 99 }); } catch (e) { msg = e.message; }
  assert(msg.indexOf('版本') >= 0, msg);
});
