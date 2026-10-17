/* =========================================================
 * ui/views/view-type.js — 模块5：类型转换
 * 转换前预演：成功 N 行 / 失败 M 行 + 失败示例；失败行策略可选
 * ======================================================= */
(function (global) {
  'use strict';

  const TARGETS = [
    { value: 'number', label: '数字' },
    { value: 'date', label: '日期' },
    { value: 'text', label: '文本' }
  ];

  function suggest(type) {
    if (type === 'number-string') return { to: 'number', text: '建议转数字' };
    if (type === 'date-string') return { to: 'date', text: '建议转日期' };
    if (type === 'mixed') return { to: '', text: '含混合格式，建议先检查' };
    return { to: '', text: '' };
  }

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '类型转换' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '修正「看起来是数字其实是文本」之类的类型问题。转换前先预演成功 / 失败行数，失败行不会静默丢失。'
    }));

    const table = ctx.pl().current;
    const state = { column: null, targetType: null, failStrategy: 'null' };
    let preview = null;

    /* ---------- 列清单 ---------- */
    const listCard = dom.el('div', { class: 'card' });
    listCard.appendChild(dom.el('div', { class: 'card-title' },
      '列清单',
      dom.el('span', { class: 'sub', text: '点击选择要转换的列' })));
    const lw = dom.el('div', { class: 'table-wrap', style: { maxHeight: '260px' } });
    const lt = dom.el('table', { class: 'data-table' });
    lt.appendChild(dom.el('thead', {}, dom.el('tr', {},
      ['列名', '当前推断类型', '建议'].map(function (h) { return dom.el('th', { text: h }); }))));
    const lb = dom.el('tbody');
    const rowByCol = {};
    table.columns.forEach(function (col) {
      const tr = dom.el('tr', { style: { cursor: 'pointer' } });
      const sg = suggest(col.type);
      tr.appendChild(dom.el('td', { text: col.name }));
      tr.appendChild(dom.el('td', { text: dom.typeLabel(col.type) }));
      const sugTd = dom.el('td', {});
      if (sg.text) sugTd.appendChild(dom.el('span', { class: 'tag ' + (sg.to ? 'brand' : 'warn'), text: sg.text }));
      tr.appendChild(sugTd);
      tr.addEventListener('click', function () { pickColumn(col.name, sg.to); });
      rowByCol[col.name] = tr;
      lb.appendChild(tr);
    });
    lt.appendChild(lb);
    lw.appendChild(lt);
    listCard.appendChild(lw);
    body.appendChild(listCard);

    /* ---------- 转换配置 ---------- */
    const cfgCard = dom.el('div', { class: 'card' });
    cfgCard.appendChild(dom.el('div', { class: 'card-title', text: '转换配置' }));

    const rowCol = dom.el('div', { class: 'form-row' });
    rowCol.appendChild(dom.el('label', { text: '转换列' }));
    const colSel = dom.el('select', {
      on: { change: function () { state.column = colSel.value || null; markRow(); sync(); } }
    });
    colSel.appendChild(dom.el('option', { value: '', text: '（请选择）' }));
    table.columns.forEach(function (c) {
      colSel.appendChild(dom.el('option', { value: c.name, text: c.name }));
    });
    rowCol.appendChild(colSel);
    cfgCard.appendChild(rowCol);

    const rowT = dom.el('div', { class: 'form-row' });
    rowT.appendChild(dom.el('label', { text: '目标类型' }));
    const targetRadios = {};
    TARGETS.forEach(function (tp) {
      const lab = dom.el('label', { class: 'radio-line' });
      const input = dom.el('input', {
        type: 'radio', name: 'cvt-target',
        on: { change: function () { state.targetType = tp.value; sync(); } }
      });
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(tp.label));
      rowT.appendChild(lab);
      targetRadios[tp.value] = input;
    });
    cfgCard.appendChild(rowT);

    const rowF = dom.el('div', { class: 'form-row' });
    rowF.appendChild(dom.el('label', { text: '失败行策略' }));
    [
      { v: 'null', t: '置空（推荐）' },
      { v: 'keep', t: '保留原文' },
      { v: 'abort', t: '中止转换（有失败就不执行）' }
    ].forEach(function (f, i) {
      const lab = dom.el('label', { class: 'radio-line' });
      lab.appendChild(dom.el('input', {
        type: 'radio', name: 'cvt-fail', checked: i === 0,
        on: { change: function () { state.failStrategy = f.v; sync(); } }
      }));
      lab.appendChild(document.createTextNode(f.t));
      rowF.appendChild(lab);
    });
    cfgCard.appendChild(rowF);
    body.appendChild(cfgCard);

    /* ---------- 预演结果 ---------- */
    const prevCard = dom.el('div', { class: 'card' });
    prevCard.appendChild(dom.el('div', { class: 'card-title', text: '转换预演' }));
    const prevBox = dom.el('div', { class: 'muted', text: '请先选择转换列与目标类型。' });
    prevCard.appendChild(prevBox);
    body.appendChild(prevCard);
    container.appendChild(body);

    /* ---------- 影响预览条 ---------- */
    const impactText = dom.el('div', { class: 'impact-text', text: '请选择转换列与目标类型' });
    const runBtn = dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '执行转换', disabled: true,
      on: { click: doRun }
    });
    container.appendChild(dom.el('div', { class: 'impact-bar' }, impactText, runBtn));

    function pickColumn(name, suggestTo) {
      state.column = name;
      colSel.value = name;
      if (suggestTo && targetRadios[suggestTo]) {
        targetRadios[suggestTo].checked = true;
        state.targetType = suggestTo;
      }
      markRow();
      sync();
    }

    function markRow() {
      Object.keys(rowByCol).forEach(function (n) {
        rowByCol[n].style.background = n === state.column ? 'var(--brand-soft)' : '';
      });
    }

    function curTypeName() {
      if (!state.column) return '';
      return dom.typeLabel(table.columns[C.colIndex(table, state.column)].type);
    }

    function sync() {
      preview = null;
      dom.clear(prevBox);
      if (!state.column || !state.targetType) {
        impactText.textContent = '请选择转换列与目标类型';
        runBtn.disabled = true;
        prevBox.appendChild(dom.el('div', { class: 'muted', text: '请先选择转换列与目标类型。' }));
        return;
      }
      try {
        preview = C.convertPreview(table, { column: state.column, targetType: state.targetType });
      } catch (e) {
        impactText.textContent = e.message;
        runBtn.disabled = true;
        prevBox.appendChild(dom.el('div', { class: 'notice warn', text: e.message }));
        return;
      }
      // 成功/失败/空 计数
      const stat = dom.el('div', { style: { marginBottom: '8px' } });
      stat.appendChild(dom.el('span', { class: 'tag brand', text: '成功 ' + preview.okCount + ' 行' }));
      stat.appendChild(dom.el('span', {
        class: preview.failCount ? 'tag danger' : 'tag',
        text: '失败 ' + preview.failCount + ' 行'
      }));
      stat.appendChild(dom.el('span', { class: 'tag', text: '原本为空 ' + preview.emptyCount + ' 行' }));
      prevBox.appendChild(stat);

      if (preview.failCount) {
        prevBox.appendChild(dom.el('div', {
          class: 'notice warn',
          text: '以下值无法转成' + TARGETS.filter(function (x) { return x.value === state.targetType; })[0].label +
            '（仅列前 ' + preview.failExamples.length + ' 个示例）：'
        }));
        const tw = dom.el('div', { class: 'table-wrap', style: { maxHeight: '180px' } });
        const tt = dom.el('table', { class: 'data-table' });
        tt.appendChild(dom.el('thead', {}, dom.el('tr', {},
          [dom.el('th', { text: '行号' }), dom.el('th', { text: '原始值' })])));
        const tb = dom.el('tbody');
        preview.failExamples.forEach(function (ex) {
          tb.appendChild(dom.el('tr', {},
            dom.el('td', { text: String(ex.row + 1) }),
            dom.el('td', { text: String(ex.value), title: String(ex.value) })));
        });
        tt.appendChild(tb);
        tw.appendChild(tt);
        prevBox.appendChild(tw);
      } else {
        prevBox.appendChild(dom.el('div', { class: 'notice info', text: '全部非空值都能成功转换。' }));
      }

      // 影响预览
      dom.clear(impactText);
      const tName = TARGETS.filter(function (x) { return x.value === state.targetType; })[0].label;
      impactText.appendChild(document.createTextNode('「' + state.column + '」：' + curTypeName() + ' → ' + tName + '，'));
      if (preview.failCount && state.failStrategy === 'abort') {
        impactText.appendChild(dom.el('b', { text: '有 ' + preview.failCount + ' 行失败，策略为中止，执行将报错' }));
        runBtn.disabled = true;
        return;
      }
      impactText.appendChild(dom.el('b', {
        text: '成功 ' + preview.okCount + ' 行' +
          (preview.failCount ? '，失败 ' + preview.failCount + ' 行将' + (state.failStrategy === 'null' ? '置空' : '保留原文') : '')
      }));
      runBtn.disabled = false;
    }

    function doRun() {
      if (!state.column || !state.targetType || !preview) return;
      const tName = TARGETS.filter(function (x) { return x.value === state.targetType; })[0].label;
      const failName = { 'null': '置空', 'keep': '保留原文', 'abort': '中止' }[state.failStrategy];
      ctx.runStep({
        module: '类型转换',
        rule: '「' + state.column + '」' + curTypeName() + ' → ' + tName +
          '，成功 ' + preview.okCount + ' 行、失败 ' + preview.failCount + ' 行（' + failName + '）',
        exec: function (t) {
          return C.applyConvert(t, {
            column: state.column, targetType: state.targetType, failStrategy: state.failStrategy
          });
        }
      });
    }
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.type = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
