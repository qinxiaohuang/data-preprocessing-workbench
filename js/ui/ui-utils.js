/* =========================================================
 * ui/ui-utils.js — UI 层纯函数工具（无 DOM 依赖，Node 可测）
 * 命名空间：DPUi
 * 内容：导航锁 / 导出名 / 日志导出 / 工作区序列化与备份
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const APP_TAG = 'dp-workbench';
  const BACKUP_VERSION = 1;

  /* ---------- 时间 ---------- */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // '20261015-183045'（文件名安全）
  function timestampStr(d) {
    d = d || new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
      + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  // ISO → 'YYYY-MM-DD HH:MM:SS'（日志展示用）；非法输入原样返回
  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
      + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  /* ---------- 导出文件名：原名_cleaned_时间戳.xlsx（原则3：永不覆盖原始文件） ---------- */

  function makeExportName(originalName, d) {
    let base = String(originalName || '').replace(/\.[^.]+$/, '');
    if (!base) base = '数据集';
    return base + '_cleaned_' + timestampStr(d) + '.xlsx';
  }

  /* ---------- 导航解锁规则（原则1：先审计后清洗） ---------- */

  // st = { hasData, auditDone }；modId: 'audit'|'dedup'|...
  function canEnterModule(modId, st) {
    if (modId === 'audit') return { ok: true };
    if (!st || !st.hasData) return { ok: false, reason: '请先上传数据文件' };
    if (!st.auditDone) return { ok: false, reason: '请先在「读取与查看」生成本表体检报告' };
    return { ok: true };
  }

  /* ---------- 单元格显示 ---------- */

  function formatCell(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return C.formatDate(v);
    return String(v);
  }

  /* ---------- 影响量文本 ---------- */

  function signed(n) { return (n > 0 ? '+' : '') + n; }

  function impactText(impact) {
    return '行 ' + impact.rowsBefore + '→' + impact.rowsAfter + '（' + signed(impact.deltaRows) + '）'
      + ' ｜ 列 ' + impact.colsBefore + '→' + impact.colsAfter + '（' + signed(impact.deltaCols) + '）';
  }

  /* ---------- 日志 → 行列（导出 CSV / 日志 sheet 共用） ---------- */

  function logsToRows(logs) {
    const header = ['时间', '类型', '步骤', '模块', '规则', '备注', '高风险',
      '执行前行数', '执行后行数', '执行前列数', '执行后列数'];
    const rows = (logs || []).map(function (lg) {
      const im = lg.impact || {};
      return [
        formatTime(lg.time),
        lg.type === 'undo' ? '撤销' : '执行',
        lg.id === undefined || lg.id === null ? '' : lg.id,
        lg.module || '',
        lg.rule || '',
        lg.note || '',
        lg.highRisk ? '是' : '',
        im.rowsBefore === undefined ? '' : im.rowsBefore,
        im.rowsAfter === undefined ? '' : im.rowsAfter,
        im.colsBefore === undefined ? '' : im.colsBefore,
        im.colsAfter === undefined ? '' : im.colsAfter
      ];
    });
    return [header].concat(rows);
  }

  /* ---------- CSV（Excel 兼容：BOM + 引号转义） ---------- */

  function rowsToCSV(rows) {
    const lines = rows.map(function (r) {
      return r.map(function (v) {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    });
    return '﻿' + lines.join('\r\n');
  }

  /* ---------- 步骤链序列化（IndexedDB 与 .json 备份共用） ---------- */

  function pipelineToJSON(pl) {
    return {
      original: C.tableToJSON(pl.original),
      current: C.tableToJSON(pl.current),
      steps: (pl.steps || []).map(function (s) {
        return {
          id: s.id, time: s.time, module: s.module, rule: s.rule,
          note: s.note || '', highRisk: !!s.highRisk,
          impact: s.impact, info: s.info || {}, undone: !!s.undone,
          prevSnapshot: C.tableToJSON(s.prevSnapshot)
        };
      }),
      logs: pl.logs || []
    };
  }

  function pipelineFromJSON(o) {
    if (!o || typeof o !== 'object' || !o.original || !o.current) {
      throw new Error('步骤链数据不完整');
    }
    return {
      original: C.tableFromJSON(o.original),
      current: C.tableFromJSON(o.current),
      steps: (o.steps || []).map(function (s) {
        return {
          id: s.id, time: s.time, module: s.module, rule: s.rule,
          note: s.note || '', highRisk: !!s.highRisk,
          impact: s.impact, info: s.info || {}, undone: !!s.undone,
          prevSnapshot: C.tableFromJSON(s.prevSnapshot)
        };
      }),
      logs: o.logs || []
    };
  }

  /* ---------- 工作区备份（手动导出 .json / IndexedDB 持久化共用同一格式） ----------
   * state = { file:{name,sheetNames,activeSheet},
   *           sheets:{ 名: {pipeline, audit, auditDone} },
   *           ui:{module, logCollapsed} }
   */
  function buildBackupPayload(state) {
    const sheets = {};
    Object.keys(state.sheets || {}).forEach(function (name) {
      const sh = state.sheets[name];
      sheets[name] = {
        pipeline: pipelineToJSON(sh.pipeline),
        audit: sh.audit || null,
        auditDone: !!sh.auditDone
      };
    });
    return {
      app: APP_TAG,
      version: BACKUP_VERSION,
      savedAt: new Date().toISOString(),
      file: state.file || null,
      ui: state.ui || { module: 'audit' },
      sheets: sheets
    };
  }

  // 接受 JSON 字符串或已解析对象；非法内容抛出中文错误
  function parseBackupPayload(input) {
    let o = input;
    if (typeof input === 'string') {
      try { o = JSON.parse(input); }
      catch (e) { throw new Error('备份文件不是有效的 JSON'); }
    }
    if (!o || typeof o !== 'object') throw new Error('备份文件内容为空');
    if (o.app !== APP_TAG) throw new Error('这不是本工具导出的工作区备份文件');
    if (o.version !== BACKUP_VERSION) throw new Error('备份文件版本不支持（v' + o.version + '）');
    if (!o.file || !o.sheets) throw new Error('备份文件缺少必要内容');

    const sheets = {};
    Object.keys(o.sheets).forEach(function (name) {
      const sh = o.sheets[name];
      sheets[name] = {
        pipeline: pipelineFromJSON(sh.pipeline),
        audit: sh.audit || null,
        auditDone: !!sh.auditDone
      };
    });
    return {
      file: o.file,
      ui: o.ui || { module: 'audit' },
      sheets: sheets,
      savedAt: o.savedAt || null
    };
  }

  /* ---------- 导出 ---------- */
  const api = {
    APP_TAG: APP_TAG,
    BACKUP_VERSION: BACKUP_VERSION,
    timestampStr: timestampStr,
    formatTime: formatTime,
    makeExportName: makeExportName,
    canEnterModule: canEnterModule,
    formatCell: formatCell,
    impactText: impactText,
    logsToRows: logsToRows,
    rowsToCSV: rowsToCSV,
    pipelineToJSON: pipelineToJSON,
    pipelineFromJSON: pipelineFromJSON,
    buildBackupPayload: buildBackupPayload,
    parseBackupPayload: parseBackupPayload
  };
  global.DPUi = Object.assign(global.DPUi || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
