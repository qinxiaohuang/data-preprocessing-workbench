/* =========================================================
 * ui/views/view-merge.js — 模块9：多文件合并
 * 原则2：join 前先诊断（1:1 / 1:N / N:1 / N:N + 匹配率）
 * 原则6：N:N（笛卡尔积风险）、任一侧键含空值、键类型口径不一 → 暂停确认
 * 第二张表仅本次会话有效，不写入持久化
 * ======================================================= */
(function (global) {
  'use strict';

  const NUM_TYPES = ['number', 'number-string'];

  function isNumType(t) { return NUM_TYPES.indexOf(t) >= 0; }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }

  function relMeta(type) {
    if (type === '1:1') return { cls: 'brand', label: '1 : 1（一一对应，安全）' };
    if (type === '1:N') return { cls: 'brand', label: '1 : N（左一 → 右多）' };
    if (type === 'N:1') return { cls: 'brand', label: 'N : 1（左多 → 右一）' };
    return { cls: 'danger', label: 'N : N（多对多，会产生笛卡尔积！）' };
  }

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '多文件合并' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '把当前数据（左表）与另一张表（右表）按关联键合并。合并前会先诊断连接关系与匹配率，高风险关系需确认后才执行。'
    }));

    const left = ctx.pl().current;
    const state = { right: null, rightName: '', leftKey: null, rightKey: null, how: 'left', suffix: '_右' };
    let diag = null, mergedPreview = null;

    /* ---------- 左表信息 ---------- */
    const leftCard = dom.el('div', { class: 'card' });
    leftCard.appendChild(dom.el('div', { class: 'card-title', text: '当前表（左表）' }));
    leftCard.appendChild(dom.el('div', { class: 'muted',
      text: '行数 ' + left.rows.length + ' ｜ 列数 ' + left.columns.length + ' ｜ 列：' +
        left.columns.map(function (c) { return c.name; }).join('、') }));
    body.appendChild(leftCard);

    /* ---------- 右表上传 ---------- */
    const rightCard = dom.el('div', { class: 'card' });
    rightCard.appendChild(dom.el('div', { class: 'card-title' },
      '第二张表（右表）',
      dom.el('span', { class: 'sub', text: '仅本次会话有效，不写入本地存储' })));
    const rightInfo = dom.el('div', { class: 'muted', text: '尚未上传第二张表。' });
    rightCard.appendChild(rightInfo);
    const rowFile = dom.el('div', { class: 'form-row', style: { marginTop: '8px' } });
    const fileInput = dom.el('input', {
      type: 'file', accept: '.xlsx,.xls,.csv',
      on: { change: function () { onPickFile(fileInput); } }
    });
    rowFile.appendChild(fileInput);
    rightCard.appendChild(rowFile);
    body.appendChild(rightCard);

    /* ---------- 关联键与方式 ---------- */
    const keyCard = dom.el('div', { class: 'card' });
    keyCard.appendChild(dom.el('div', { class: 'card-title', text: '关联键与连接方式' }));

    const rowL = dom.el('div', { class: 'form-row' });
    rowL.appendChild(dom.el('label', { text: '左表关联键' }));
    const leftSel = dom.el('select', {
      on: { change: function () { state.leftKey = leftSel.value || null; sync(); } }
    });
    leftSel.appendChild(dom.el('option', { value: '', text: '（请选择）' }));
    left.columns.forEach(function (c) { leftSel.appendChild(dom.el('option', { value: c.name, text: c.name })); });
    rowL.appendChild(leftSel);
    keyCard.appendChild(rowL);

    const rowR = dom.el('div', { class: 'form-row' });
    rowR.appendChild(dom.el('label', { text: '右表关联键' }));
    const rightSel = dom.el('select', {
      on: { change: function () { state.rightKey = rightSel.value || null; sync(); } }
    });
    rowR.appendChild(rightSel);
    keyCard.appendChild(rowR);

    const rowHow = dom.el('div', { class: 'form-row' });
    rowHow.appendChild(dom.el('label', { text: '连接方式' }));
    [
      { v: 'left', t: '左连接（保留左表全部行）' },
      { v: 'inner', t: '内连接（只留两边都匹配的行）' },
      { v: 'right', t: '右连接（保留右表全部行）' }
    ].forEach(function (h) {
      const lab = dom.el('label', { class: 'radio-line' });
      const input = dom.el('input', {
        type: 'radio', name: 'merge-how', checked: h.v === 'left',
        on: { change: function () { state.how = h.v; sync(); } }
      });
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(h.t));
      rowHow.appendChild(lab);
    });
    keyCard.appendChild(rowHow);

    const rowSuf = dom.el('div', { class: 'form-row' });
    rowSuf.appendChild(dom.el('label', { text: '重名后缀' }));
    rowSuf.appendChild(dom.el('input', {
      type: 'text', value: state.suffix, style: { width: '120px' },
      on: { input: function (e) { state.suffix = e.target.value; sync(); } }
    }));
    rowSuf.appendChild(dom.el('span', { class: 'muted small', text: '右表与左表同名的列将加此后缀' }));
    keyCard.appendChild(rowSuf);
    body.appendChild(keyCard);

    /* ---------- 诊断卡 ---------- */
    const diagCard = dom.el('div', { class: 'card' });
    diagCard.appendChild(dom.el('div', { class: 'card-title', text: '连接诊断' }));
    const diagBox = dom.el('div', { class: 'muted', text: '请上传右表并选择关联键。' });
    diagCard.appendChild(diagBox);
    body.appendChild(diagCard);

    /* ---------- 合并预览 ---------- */
    const prevCard = dom.el('div', { class: 'card' });
    prevCard.appendChild(dom.el('div', { class: 'card-title', text: '合并结果预览（前 20 行）' }));
    const prevBox = dom.el('div', { class: 'muted', text: '选择完整后显示预览。' });
    prevCard.appendChild(prevBox);
    body.appendChild(prevCard);
    container.appendChild(body);

    /* ---------- 影响条 ---------- */
    const impactText = dom.el('div', { class: 'impact-text', text: '请上传右表并选择关联键' });
    const runBtn = dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '执行合并', disabled: true,
      on: { click: doRun }
    });
    container.appendChild(dom.el('div', { class: 'impact-bar' }, impactText, runBtn));

    /* ================= 交互 ================= */

    function onPickFile(input) {
      const f = input.files && input.files[0];
      if (!f) return;
      ctx.parseFile(f).then(function (t) {
        state.right = t;
        state.rightName = f.name;
        // 自动挑选关联键：优先同名公共列
        const common = left.columns.map(function (c) { return c.name; }).filter(function (n) {
          return C.colIndex(t, n) >= 0;
        });
        state.leftKey = common.length ? common[0] : (left.columns[0] && left.columns[0].name) || null;
        state.rightKey = common.length ? common[0] : (t.columns[0] && t.columns[0].name) || null;
        leftSel.value = state.leftKey || '';
        dom.clear(rightSel);
        rightSel.appendChild(dom.el('option', { value: '', text: '（请选择）' }));
        t.columns.forEach(function (c) { rightSel.appendChild(dom.el('option', { value: c.name, text: c.name })); });
        rightSel.value = state.rightKey || '';
        dom.clear(rightInfo);
        rightInfo.appendChild(dom.el('b', { text: state.rightName }));
        rightInfo.appendChild(document.createTextNode(' ｜ 行数 ' + t.rows.length + ' ｜ 列数 ' + t.columns.length));
        sync();
      }).catch(function (e) {
        dom.toast('解析右表失败：' + e.message, 'error');
      });
      input.value = '';
    }

    function keyType(name) {
      const i = C.colIndex(left, name);
      return i >= 0 ? left.columns[i].type : null;
    }
    function rightKeyType(name) {
      if (!state.right) return null;
      const i = C.colIndex(state.right, name);
      return i >= 0 ? state.right.columns[i].type : null;
    }

    // 汇总风险项（供确认弹窗使用）
    function riskList() {
      const risks = [];
      if (!diag) return risks;
      if (diag.type === 'N:N') {
        risks.push('连接关系为 N:N：左表 ' + diag.leftDup + ' 组、右表 ' + diag.rightDup +
          ' 组重复键，合并会产生笛卡尔积，输出行数可能远超预期。');
      } else if (diag.type === '1:N' || diag.type === 'N:1') {
        risks.push('连接关系为 ' + diag.type + '：重复键会复制行，请确认这是预期行为。');
      }
      if (diag.leftNullKeys > 0 || diag.rightNullKeys > 0) {
        risks.push('关联键存在空值：左表 ' + diag.leftNullKeys + ' 个、右表 ' + diag.rightNullKeys +
          ' 个。空键不参与匹配，含义不明的主键存在风险。');
      }
      const lt = keyType(state.leftKey), rt = rightKeyType(state.rightKey);
      if (lt && rt && (isNumType(lt) !== isNumType(rt))) {
        risks.push('两侧关联键类型口径不一致（左 ' + dom.typeLabel(lt) + '，右 ' + dom.typeLabel(rt) +
          '），可能出现匹配失败或错配，建议先做类型转换。');
      }
      return risks;
    }

    function sync() {
      diag = null;
      mergedPreview = null;
      dom.clear(diagBox);
      dom.clear(prevBox);
      runBtn.disabled = true;

      if (!state.right) {
        impactText.textContent = '请上传第二张表';
        diagBox.appendChild(dom.el('div', { class: 'muted', text: '请上传右表并选择关联键。' }));
        prevBox.appendChild(dom.el('div', { class: 'muted', text: '选择完整后显示预览。' }));
        return;
      }
      if (!state.leftKey || !state.rightKey) {
        impactText.textContent = '请选择左右关联键';
        diagBox.appendChild(dom.el('div', { class: 'muted', text: '请选择左右表的关联键。' }));
        prevBox.appendChild(dom.el('div', { class: 'muted', text: '选择完整后显示预览。' }));
        return;
      }

      try {
        diag = C.diagnoseJoin(left, state.right, state.leftKey, state.rightKey);
      } catch (e) {
        impactText.textContent = e.message;
        diagBox.appendChild(dom.el('div', { class: 'notice warn', text: e.message }));
        return;
      }

      // 诊断展示
      const meta = relMeta(diag.type);
      const head = dom.el('div', { style: { marginBottom: '8px' } });
      head.appendChild(dom.el('span', { class: 'tag ' + meta.cls, style: { fontSize: '13px', padding: '3px 12px' }, text: meta.label }));
      diagBox.appendChild(head);

      const kw = dom.el('div', { class: 'table-wrap', style: { maxHeight: 'none' } });
      const kt = dom.el('table', { class: 'data-table' });
      kt.appendChild(dom.el('thead', {}, dom.el('tr', {},
        ['指标', '左表', '右表'].map(function (h) { return dom.el('th', { text: h }); }))));
      const kb = dom.el('tbody');
      [
        ['行数', diag.leftRows, diag.rightRows],
        ['唯一键数', diag.leftUniqKeys, diag.rightUniqKeys],
        ['重复键组数', diag.leftDup, diag.rightDup],
        ['空键行数', diag.leftNullKeys, diag.rightNullKeys]
      ].forEach(function (r) {
        kb.appendChild(dom.el('tr', {},
          dom.el('td', { text: r[0] }),
          dom.el('td', { text: String(r[1]) }),
          dom.el('td', { text: String(r[2]) })));
      });
      kt.appendChild(kb);
      kw.appendChild(kt);
      diagBox.appendChild(kw);

      diagBox.appendChild(dom.el('div', { class: 'muted small', style: { marginTop: '8px' },
        text: '匹配情况：' + diag.commonKeys + ' 个公共键，左表可匹配 ' + diag.matchedLeftRows +
          ' 行，匹配率 ' + pct(diag.matchRate) + '。' }));

      const risks = riskList();
      if (risks.length) {
        const ul = dom.el('div', { class: 'notice danger' });
        ul.appendChild(dom.el('div', { text: '存在以下风险（执行前需确认）：' }));
        risks.forEach(function (r) { ul.appendChild(dom.el('div', { class: 'small', text: '· ' + r })); });
        diagBox.appendChild(ul);
      }

      // 合并预览
      try {
        const res = C.mergeTables(left, state.right, {
          leftKey: state.leftKey, rightKey: state.rightKey, how: state.how, suffix: state.suffix || '_右'
        });
        mergedPreview = res;
        prevBox.appendChild(dom.renderDataTable({ table: res.table, maxRows: 20 }));
      } catch (e) {
        prevBox.appendChild(dom.el('div', { class: 'notice warn', text: e.message }));
        impactText.textContent = e.message;
        return;
      }

      // 影响
      const info = mergedPreview.info;
      dom.clear(impactText);
      impactText.appendChild(document.createTextNode('将合并为 '));
      impactText.appendChild(dom.el('b', { text: info.outRows + ' 行' }));
      impactText.appendChild(document.createTextNode(' × ' + mergedPreview.table.columns.length + ' 列'));
      impactText.appendChild(document.createTextNode('（左 ' + info.leftRows + ' / 右 ' + info.rightRows +
        '，匹配率 ' + pct(info.matchRate) + '，未匹配左行 ' + info.unmatchedLeftRows +
        (info.unmatchedRightRows !== null ? '，未匹配右行 ' + info.unmatchedRightRows : '') +
        '，关系 ' + info.relation + (risks.length ? '，高风险：是' : '，高风险：否') + '）'));
      runBtn.disabled = false;
    }

    function doRun() {
      if (!mergedPreview) return;
      const risks = riskList();
      const params = {
        leftKey: state.leftKey, rightKey: state.rightKey, how: state.how, suffix: state.suffix || '_右'
      };
      const info = mergedPreview.info;
      const rule = '与「' + state.rightName + '」按 ' + state.leftKey + '=' + state.rightKey +
        ' 做' + ({ left: '左连接', inner: '内连接', right: '右连接' }[state.how]) +
        '，关系 ' + info.relation + '，匹配率 ' + pct(info.matchRate) +
        '，输出 ' + info.outRows + ' 行' + (risks.length ? '；风险：' + risks.join(' ') : '');

      function exec() {
        ctx.runStep({
          module: '多文件合并',
          rule: rule,
          highRisk: risks.length > 0,
          exec: function (t) { return C.mergeTables(t, state.right, params); }
        });
      }

      if (!risks.length) { exec(); return; }

      const box = dom.el('div');
      box.appendChild(dom.el('div', { text: '本次合并存在高风险，请逐条确认后继续：' }));
      const ul = dom.el('div', { style: { margin: '8px 0' } });
      risks.forEach(function (r) { ul.appendChild(dom.el('div', { class: 'small', text: '· ' + r })); });
      box.appendChild(ul);

      dom.modal({
        title: '高风险操作确认',
        danger: true,
        body: box,
        okLabel: '我已了解，继续合并',
        requireCheck: { label: '我已了解上述风险，确认继续合并' },
        onOk: function () { exec(); }
      });
    }

    sync();
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.merge = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
