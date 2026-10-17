/* =========================================================
 * ui/app.js — 应用主控
 * 职责：五区骨架填装 / 导航锁 / 上传解析 / 步骤执行 / 撤销 /
 *       日志面板 / 导出 *_cleaned / 工作区备份导入导出 / 本地持久化
 * 约束：用户数据一律 textContent；原始数据不可覆盖；每步记日志
 * ======================================================= */
(function (global) {
  'use strict';

  const dom = global.DPDom;
  const Ui = global.DPUi;
  const Store = global.DPStore;
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const MODULES = [
    { id: 'audit', name: '读取与查看' },
    { id: 'dedup', name: '重复值' },
    { id: 'missing', name: '缺失值' },
    { id: 'outlier', name: '异常值' },
    { id: 'type', name: '类型转换' },
    { id: 'feature', name: '特征工程' },
    { id: 'encode', name: '类别编码' },
    { id: 'select', name: '字段筛选' },
    { id: 'merge', name: '多文件合并' }
  ];

  /* ---------- 全局状态 ---------- */
  const state = {
    file: null,                 // {name, sheetNames, activeSheet}
    sheets: {},                 // 名 -> {pipeline, audit, auditDone}
    ui: { module: 'audit', logCollapsed: false }
  };

  let dirHandle = null;         // 目录句柄仅存内存，每会话首次导出时询问
  let saveTimer = null;

  /* ---------- 引用 ---------- */
  function sheet() {
    if (!state.file) return null;
    return state.sheets[state.file.activeSheet] || null;
  }
  function pl() {
    const sh = sheet();
    return sh ? sh.pipeline : null;
  }

  /* ---------- 持久化（防抖 300ms） ---------- */
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!state.file) {
        Store.clearWorkspace().catch(function () {});
        return;
      }
      let json;
      try { json = JSON.stringify(Ui.buildBackupPayload(state)); }
      catch (e) { dom.toast('工作区序列化失败：' + e.message, 'error'); return; }
      Store.saveWorkspace(json).catch(function (e) {
        dom.toast('本地保存失败：' + e.message, 'error');
      });
    }, 300);
  }

  /* ---------- 文件解析 ---------- */

  // 把一个工作表转成 table（首行表头，去重；过滤全空行）
  function sheetToTable(name, ws) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!aoa.length) return C.createTable(name, [], []);

    const seen = {};
    const header = (aoa[0] || []).map(function (h, i) {
      let n = (h === null || h === undefined) ? '' : String(h).trim();
      if (!n) n = '列' + (i + 1);
      if (seen[n] === undefined) { seen[n] = 1; return n; }
      seen[n]++;
      return n + '_' + seen[n];
    });

    const rows = [];
    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const row = header.map(function (_, j) { return r[j] === undefined ? null : r[j]; });
      const allEmpty = row.every(function (v) {
        return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
      });
      if (allEmpty) continue;
      rows.push(row);
    }
    return C.createTable(name, header, rows);
  }

  // 读文件 → {names:[...], tables:{名:table}}
  function readSheets(file) {
    return new Promise(function (resolve, reject) {
      const isCsv = /\.csv$/i.test(file.name || '');
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.onload = function () {
        let wb;
        try {
          const buf = reader.result;
          if (isCsv) {
            let text;
            try {
              text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
            } catch (e) {
              text = new TextDecoder('gbk').decode(buf); // 中文 CSV 常见编码
            }
            wb = XLSX.read(text, { type: 'string', cellDates: true });
          } else {
            wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
          }
        } catch (e) {
          reject(new Error('无法解析该文件（' + e.message + '）'));
          return;
        }
        const names = wb.SheetNames || [];
        const tables = {};
        names.forEach(function (n) {
          try { tables[n] = sheetToTable(n, wb.Sheets[n]); }
          catch (e) { tables[n] = C.createTable(n, [], []); }
        });
        resolve({ names: names, tables: tables });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // 供合并模块使用：解析右表首 sheet
  function parseFile(file) {
    return readSheets(file).then(function (res) {
      if (!res.names.length) throw new Error('文件中没有工作表');
      return res.tables[res.names[0]];
    });
  }

  /* ---------- 上传 ---------- */
  function onUpload(file) {
    if (!file) return;
    readSheets(file).then(function (res) {
      if (!res.names.length) { dom.toast('文件里没有可读取的工作表', 'error'); return; }
      state.sheets = {};
      res.names.forEach(function (n) {
        state.sheets[n] = { pipeline: C.createPipeline(res.tables[n]), audit: null, auditDone: false };
      });
      state.file = { name: file.name, sheetNames: res.names, activeSheet: res.names[0] };
      state.ui.module = 'audit';

      const rows = res.tables[res.names[0]].rows.length;
      if (rows > 100000) {
        dom.toast('数据超过 10 万行（' + rows + ' 行），处理与渲染可能较慢', 'error');
      }
      // 原则1：上传即自动体检 active sheet
      auditCurrent();
      save();
      refresh();
      dom.toast('已加载 ' + file.name + '（' + res.names.length + ' 个工作表）', 'success');
    }).catch(function (e) {
      dom.toast('解析失败：' + e.message, 'error');
    });
  }

  /* ---------- 步骤执行 ---------- */
  function runStep(opts) {
    if (!state.file) { dom.toast('请先上传数据', 'error'); return; }
    try {
      C.applyStep(pl(), {
        module: opts.module,
        rule: opts.rule,
        note: opts.note || '',
        highRisk: !!opts.highRisk,
        exec: opts.exec
      });
    } catch (e) {
      dom.toast('执行失败：' + e.message, 'error');
      return;
    }
    save();
    refresh();
    dom.toast('已完成：' + opts.module, 'success');
  }

  function undoStep() {
    if (!state.file) return;
    const r = C.undo(pl());
    if (!r.ok) { dom.toast('没有可撤销的步骤', 'error'); return; }
    save();
    refresh();
    dom.toast('已撤销上一步', 'success');
  }

  /* ---------- 体检 ---------- */
  function auditCurrent() {
    const sh = sheet();
    if (!sh) return;
    sh.audit = C.auditTable(sh.pipeline.current);
    sh.auditDone = true;
    save();
    refresh();
  }

  function switchSheet(name) {
    if (!state.file || !state.sheets[name]) return;
    state.file.activeSheet = name;
    save();
    refresh();
  }

  /* ---------- 导航 ---------- */
  function canEnter(modId) {
    const sh = sheet();
    return Ui.canEnterModule(modId, {
      hasData: !!state.file,
      auditDone: !!(sh && sh.auditDone)
    });
  }

  function setModule(id) {
    const r = canEnter(id);
    if (!r.ok) { dom.toast(r.reason, 'error'); return; }
    state.ui.module = id;
    save();
    renderNav();
    renderWorkspace();
  }

  /* ---------- 渲染：顶栏 ---------- */
  function renderTopbar() {
    const info = document.getElementById('fileInfo');
    dom.clear(info);
    if (!state.file) {
      info.appendChild(dom.el('span', { class: 'muted', text: '未加载数据' }));
      return;
    }
    const sh = sheet();
    info.appendChild(dom.el('b', { text: state.file.name }));
    info.appendChild(document.createTextNode(' ｜ 工作表 ' + state.file.activeSheet
      + ' ｜ ' + (sh ? sh.pipeline.current.rows.length : 0) + ' 行 × '
      + (sh ? sh.pipeline.current.columns.length : 0) + ' 列'));
  }

  /* ---------- 渲染：左侧导航 ---------- */
  function renderNav() {
    const nav = document.getElementById('nav');
    dom.clear(nav);
    nav.appendChild(dom.el('div', { class: 'nav-title', text: '处理模块（按顺序）' }));
    MODULES.forEach(function (m, i) {
      const r = canEnter(m.id);
      const btn = dom.el('button', {
        class: 'nav-item'
          + (state.ui.module === m.id ? ' active' : '')
          + (r.ok ? '' : ' locked'),
        type: 'button',
        on: { click: function () { setModule(m.id); } }
      });
      btn.appendChild(dom.el('span', { class: 'no', text: String(i + 1) }));
      btn.appendChild(dom.el('span', { text: m.name }));
      btn.title = r.ok ? m.name : r.reason;
      nav.appendChild(btn);
    });
  }

  /* ---------- 渲染：右侧日志 ---------- */
  function renderLog() {
    const panel = document.getElementById('logpanel');
    dom.clear(panel);

    const head = dom.el('div', { class: 'log-head' });
    head.appendChild(dom.el('span', { text: '处理日志' }));
    head.appendChild(dom.el('span', { class: 'spacer' }));
    const csvBtn = dom.el('button', {
      class: 'btn btn-small', type: 'button', text: '导出日志 CSV',
      on: { click: exportLogCsv }
    });
    const toggleBtn = dom.el('button', {
      class: 'btn btn-small log-toggle', type: 'button',
      text: document.body.classList.contains('log-collapsed') ? '«' : '»',
      title: '折叠 / 展开日志面板',
      on: {
        click: function () {
          document.body.classList.toggle('log-collapsed');
          state.ui.logCollapsed = document.body.classList.contains('log-collapsed');
          renderLog();
        }
      }
    });
    head.appendChild(csvBtn);
    head.appendChild(toggleBtn);
    panel.appendChild(head);

    const list = dom.el('div', { class: 'log-list' });
    const logs = (pl() && pl().logs) || [];
    if (!logs.length) {
      list.appendChild(dom.el('div', { class: 'log-empty', text: '暂无处理记录。\n每次清洗/派生都会在此留痕。' }));
    } else {
      logs.slice().reverse().forEach(function (lg) {
        const item = dom.el('div', { class: 'log-item' + (lg.type === 'undo' ? ' undo' : '') });
        const meta = dom.el('div', { class: 'log-meta' });
        meta.appendChild(dom.el('span', { text: Ui.formatTime(lg.time) }));
        meta.appendChild(dom.el('span', { class: 'tag ' + (lg.type === 'undo' ? '' : 'brand'),
          text: lg.type === 'undo' ? '撤销' : ('步骤 ' + lg.id) }));
        if (lg.highRisk) meta.appendChild(dom.el('span', { class: 'tag danger', text: '高风险' }));
        item.appendChild(meta);
        item.appendChild(dom.el('div', { class: 'log-rule', text: lg.module + '：' + lg.rule }));
        const im = lg.impact || {};
        item.appendChild(dom.el('div', { class: 'log-impact',
          text: '行 ' + im.rowsBefore + '→' + im.rowsAfter + ' ｜ 列 ' + im.colsBefore + '→' + im.colsAfter }));
        let noteDiv = null;
        if (lg.note) {
          noteDiv = dom.el('div', { class: 'log-note', text: lg.note });
          noteDiv.style.display = 'none';
          item.appendChild(noteDiv);
        }
        item.addEventListener('click', function () { if (noteDiv) noteDiv.style.display = noteDiv.style.display === 'none' ? '' : 'none'; });
        list.appendChild(item);
      });
    }
    panel.appendChild(list);
  }

  function exportLogCsv() {
    if (!state.file) { dom.toast('请先上传数据', 'error'); return; }
    const rows = Ui.logsToRows(pl().logs);
    const csv = Ui.rowsToCSV(rows);
    const name = 'processing_log_' + Ui.timestampStr() + '.csv';
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
  }

  /* ---------- 渲染：底栏 ---------- */
  function renderFooter() {
    const foot = document.getElementById('footer');
    dom.clear(foot);

    const undoBtn = dom.el('button', {
      class: 'btn', type: 'button', text: '撤销上一步',
      disabled: !state.file || !pl() || !pl().steps.length,
      on: { click: undoStep }
    });
    foot.appendChild(undoBtn);

    const dots = dom.el('div', { class: 'steps-dots' });
    const steps = (pl() && pl().steps) || [];
    if (!state.file) {
      dots.appendChild(dom.el('span', { class: 'muted', text: '未加载数据' }));
    } else {
      dots.appendChild(dom.el('span', { text: '已执行 ' + steps.length + ' 步：' }));
      const show = steps.slice(-20);
      show.forEach(function (s) {
        dots.appendChild(dom.el('span', { class: 'dot', title: '步骤 ' + s.id + '：' + s.module }));
      });
      if (!steps.length) dots.appendChild(dom.el('span', { class: 'muted', text: '（尚无处理步骤）' }));
      if (steps.length > show.length) dots.appendChild(dom.el('span', { class: 'more', text: '…前 ' + (steps.length - show.length) + ' 步' }));
    }
    foot.appendChild(dots);

    foot.appendChild(dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '导出 _cleaned',
      disabled: !state.file,
      on: { click: exportCleaned }
    }));
  }

  /* ---------- 渲染：工作区 ---------- */
  function renderWorkspace() {
    const ws = document.getElementById('workspace');
    dom.clear(ws);
    if (!state.file) { renderHome(ws); return; }
    const view = global.DPViews[state.ui.module] || global.DPViews.audit;
    view.render(ws, ctx());
  }

  function ctx() {
    return {
      C: C, Ui: Ui, dom: dom,
      state: state,
      sheet: sheet, pl: pl,
      setModule: setModule,
      refresh: refresh,
      save: save,
      runStep: runStep,
      auditCurrent: auditCurrent,
      switchSheet: switchSheet,
      parseFile: parseFile
    };
  }

  /* ---------- 首页 ---------- */
  function renderHome(ws) {
    const home = dom.el('div', { class: 'home' });
    home.appendChild(dom.el('h1', { text: '数据预处理工作台' }));
    home.appendChild(dom.el('div', { class: 'slogan',
      text: '完全本地运行 · 数据不出电脑 · 原始文件不覆盖' }));

    const dz = dom.el('div', { class: 'dropzone' });
    dz.appendChild(dom.el('div', { class: 'dz-title', text: '拖拽 Excel / CSV 到这里，或点击选择文件' }));
    dz.appendChild(dom.el('div', { class: 'dz-sub', text: '支持 .xlsx / .xls / .csv，可含多个工作表' }));
    const fileInput = dom.el('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' } });
    fileInput.addEventListener('change', function () {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      onUpload(f);
    });
    dz.addEventListener('click', function () { fileInput.click(); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      onUpload(f);
    });
    home.appendChild(dz);
    home.appendChild(fileInput);

    const notes = dom.el('div', { class: 'notes' });
    notes.appendChild(dom.el('div', { text: '· 建议单表数据量不超过 10 万行 × 200 列，处理更流畅。' }));
    notes.appendChild(dom.el('div', { class: 'warn', text: '· 请勿使用浏览器无痕模式：无痕模式下本地存储会被清空，刷新即丢数据。' }));
    notes.appendChild(dom.el('div', { text: '· 处理过程会实时保存到浏览器本地存储，关闭再打开可自动恢复。' }));
    notes.appendChild(dom.el('div', { text: '· 建议定期用顶栏「导出备份」保存 .json 工作区文件，防止数据意外丢失。' }));
    notes.appendChild(dom.el('div', { text: '· 处理流程：上传 → 生成体检报告 → 按左侧导航顺序清洗 → 导出 _cleaned 文件。' }));
    home.appendChild(notes);

    ws.appendChild(home);
  }

  /* ---------- 导出 _cleaned ---------- */
  function exportCleaned() {
    if (!state.file) return;
    const sh = sheet();
    const box = dom.el('div');
    box.appendChild(dom.el('div', { text: '当前表：' + sh.pipeline.current.rows.length + ' 行 × '
      + sh.pipeline.current.columns.length + ' 列' }));
    box.appendChild(dom.el('div', { class: 'muted small', style: { marginTop: '4px' },
      text: '文件名为「原名_cleaned_时间戳.xlsx」，绝不会覆盖原始文件。' }));
    const lab = dom.el('label', { class: 'check-line', style: { marginTop: '8px' } });
    const cb = dom.el('input', { type: 'checkbox', checked: true });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode('附带导出「处理日志」工作表（推荐，便于追溯）'));
    box.appendChild(lab);

    dom.modal({
      title: '导出清洗后数据',
      okLabel: '导出 .xlsx',
      body: box,
      onOk: function () { doExportCleaned(cb.checked); }
    });
  }

  function cellOut(v) {
    if (v === null || v === undefined) return null;
    return v;
  }

  function doExportCleaned(includeLog) {
    const sh = sheet();
    const cur = sh.pipeline.current;
    try {
      const aoa = [cur.columns.map(function (c) { return c.name; })];
      cur.rows.forEach(function (r) { aoa.push(r.map(cellOut)); });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '数据');
      if (includeLog) {
        const lrows = Ui.logsToRows(sh.pipeline.logs);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lrows), '处理日志');
      }
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const name = Ui.makeExportName(state.file.name);
      writeOut(blob, name);
    } catch (e) {
      dom.toast('导出失败：' + e.message, 'error');
    }
  }

  // 优先写入用户选择的文件夹（可指向 D 盘/数据集），失败则退回下载
  function writeOut(blob, name) {
    if (dirHandle) { writeToHandle(blob, name); return; }
    if (!global.showDirectoryPicker) { downloadBlob(blob, name); return; }
    dom.modal({
      title: '选择导出文件夹',
      okLabel: '选择文件夹并导出',
      cancelLabel: '直接下载',
      body: '将弹出文件夹选择框，请选择目标文件夹（如 D 盘「数据集」），文件会写入其中。',
      onOk: function () { pickDirThenWrite(blob, name); },
      onCancel: function () { downloadBlob(blob, name); }
    });
  }

  function pickDirThenWrite(blob, name) {
    global.showDirectoryPicker({ id: 'dp-data-export', mode: 'readwrite' }).then(function (h) {
      dirHandle = h;
      writeToHandle(blob, name);
    }).catch(function () {
      downloadBlob(blob, name); // 用户取消或不支持 → 下载
    });
  }

  function writeToHandle(blob, name) {
    dirHandle.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable();
    }).then(function (w) {
      return w.write(blob).then(function () { return w.close(); });
    }).then(function () {
      dom.toast('已写入所选文件夹：' + name, 'success');
    }).catch(function (e) {
      dom.toast('写入文件夹失败，改为下载：' + (e && e.message || e), 'error');
      dirHandle = null;
      downloadBlob(blob, name);
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = dom.el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    dom.toast('已开始下载：' + name, 'success');
  }

  /* ---------- 工作区备份 ---------- */
  function exportBackup() {
    if (!state.file) { dom.toast('暂无工作区可备份', 'error'); return; }
    const json = JSON.stringify(Ui.buildBackupPayload(state), null, 0);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, 'workspace_backup_' + Ui.timestampStr() + '.json');
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onerror = function () { dom.toast('备份文件读取失败', 'error'); };
    reader.onload = function () {
      let parsed;
      try { parsed = Ui.parseBackupPayload(String(reader.result)); }
      catch (e) { dom.toast('导入失败：' + e.message, 'error'); return; }

      dom.modal({
        title: '导入工作区备份',
        danger: true,
        okLabel: '覆盖当前工作区',
        body: '将用备份内容覆盖当前工作区（含未导出数据）。此操作不可撤销，确认继续？',
        requireCheck: { label: '我已了解将覆盖当前工作区' },
        onOk: function () {
          state.file = parsed.file;
          state.sheets = parsed.sheets;
          state.ui = parsed.ui || { module: 'audit', logCollapsed: false };
          try {
            const view = MODULES.some(function (m) { return m.id === state.ui.module; }) ? state.ui.module : 'audit';
            state.ui.module = view;
          } catch (e) { state.ui.module = 'audit'; }
          save();
          refresh();
          dom.toast('已导入工作区备份', 'success');
        }
      });
    };
    reader.readAsText(file);
  }

  /* ---------- 清空工作区 ---------- */
  function clearWorkspace() {
    dom.modal({
      title: '清空工作区',
      danger: true,
      okLabel: '我已确认',
      body: '将删除当前所有已加载数据与处理记录。请先确认已导出需要的结果。',
      onOk: function () {
        dom.modal({
          title: '再次确认',
          danger: true,
          okLabel: '彻底清空',
          body: '这是最后一次确认：清空后无法恢复，页面将刷新。',
          requireText: { label: '请输入「清空」以确认', placeholder: '清空' },
          onOk: function (values) {
            if (values.text !== '清空') { dom.toast('输入不正确，已取消', 'error'); return false; }
            Store.clearWorkspace().then(function () {
              dom.toast('工作区已清空，正在刷新…', 'success');
              setTimeout(function () { location.reload(); }, 600);
            }).catch(function (e) {
              dom.toast('清空失败：' + e.message, 'error');
            });
          }
        });
      }
    });
  }

  /* ---------- 刷新总入口 ---------- */
  function refresh() {
    document.body.classList.toggle('log-collapsed', !!state.ui.logCollapsed);
    renderTopbar();
    renderNav();
    renderLog();
    renderFooter();
    renderWorkspace();
  }

  /* ---------- 初始化 ---------- */
  function bindStatic() {
    const nameBtn = document.getElementById('appName');
    nameBtn.addEventListener('click', function () {
      state.ui.module = 'audit';
      save();
      refresh();
    });
    document.getElementById('btnBackupExport').addEventListener('click', exportBackup);
    const importInput = document.getElementById('backupFile');
    document.getElementById('btnBackupImport').addEventListener('click', function () { importInput.click(); });
    importInput.addEventListener('change', function () {
      const f = importInput.files && importInput.files[0];
      importInput.value = '';
      if (f) importBackup(f);
    });
    document.getElementById('btnClear').addEventListener('click', clearWorkspace);
  }

  function init() {
    bindStatic();
    renderHome(document.getElementById('workspace'));
    refresh();

    Store.loadWorkspace().then(function (json) {
      if (!json) return;
      try {
        const p = Ui.parseBackupPayload(json);
        state.file = p.file;
        state.sheets = p.sheets;
        state.ui = p.ui || { module: 'audit', logCollapsed: false };
        if (!MODULES.some(function (m) { return m.id === state.ui.module; })) state.ui.module = 'audit';
        refresh();
        dom.toast('已恢复上次工作区', 'success');
      } catch (e) {
        // 本地数据损坏：忽略并保持空白状态
      }
    }).catch(function () {
      // IndexedDB 不可用（如无痕模式）：提示但仍可本次使用
      dom.toast('本地存储不可用，本次操作不会自动保存（请勿用无痕模式）', 'error');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
