/* =========================================================
 * ui/views/view-dedup.js — 模块2：重复值
 * 口径（整行/按勾选列）+ 保留策略（第一条/最后一条）+ 标红预览
 * ======================================================= */
(function (global) {
  'use strict';

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '重复值' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '按口径识别并删除重复行，删除前可预览：标红的行将被删除。'
    }));

    const table = ctx.pl().current;
    const state = { mode: 'all', keys: {}, keep: 'first' };

    /* ---------- 配置卡片 ---------- */
    const card = dom.el('div', { class: 'card' });
    card.appendChild(dom.el('div', { class: 'card-title', text: '判重口径与保留策略' }));

    const rowMode = dom.el('div', { class: 'form-row' });
    rowMode.appendChild(dom.el('label', { text: '判重口径' }));
    const rAll = radio('按整行判重（所有列完全相同）', 'mode', true, function () { state.mode = 'all'; sync(); });
    const rCols = radio('按勾选列判重', 'mode', false, function () { state.mode = 'cols'; sync(); });
    rowMode.appendChild(rAll.label);
    rowMode.appendChild(rCols.label);
    card.appendChild(rowMode);

    // 勾选列清单
    const keyBox = dom.el('div', { class: 'form-row', style: { display: 'none', flexWrap: 'wrap', gap: '4px 14px' } });
    keyBox.appendChild(dom.el('label', { text: '勾选列' }));
    table.columns.forEach(function (c) {
      state.keys[c.name] = false;
      const lab = dom.el('label', { class: 'check-line' });
      const cb = dom.el('input', {
        type: 'checkbox',
        on: { change: function () { state.keys[c.name] = cb.checked; sync(); } }
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(c.name));
      keyBox.appendChild(lab);
    });
    card.appendChild(keyBox);

    const rowKeep = dom.el('div', { class: 'form-row' });
    rowKeep.appendChild(dom.el('label', { text: '保留策略' }));
    const rFirst = radio('保留每组第一条', 'keep', true, function () { state.keep = 'first'; sync(); });
    const rLast = radio('保留每组最后一条', 'keep', false, function () { state.keep = 'last'; sync(); });
    rowKeep.appendChild(rFirst.label);
    rowKeep.appendChild(rLast.label);
    card.appendChild(rowKeep);
    body.appendChild(card);

    /* ---------- 预览卡片 ---------- */
    const previewCard = dom.el('div', { class: 'card' });
    const previewTitle = dom.el('div', { class: 'card-title', text: '重复组预览' });
    previewCard.appendChild(previewTitle);
    const previewBox = dom.el('div');
    previewCard.appendChild(previewBox);
    body.appendChild(previewCard);
    container.appendChild(body);

    /* ---------- 影响预览条 ---------- */
    const impactText = dom.el('div', { class: 'impact-text' });
    const runBtn = dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '执行去重',
      on: { click: doRun }
    });
    container.appendChild(dom.el('div', { class: 'impact-bar' }, impactText, runBtn));

    let trial = null; // 试算结果

    function radio(text, name, checked, onChange) {
      const lab = dom.el('label', { class: 'radio-line' });
      const input = dom.el('input', {
        type: 'radio', name: 'dedup-' + name, checked: checked,
        on: { change: onChange }
      });
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(text));
      return { label: lab, input: input };
    }

    function keyColumns() {
      if (state.mode === 'all') return [];
      return table.columns.filter(function (c) { return state.keys[c.name]; }).map(function (c) { return c.name; });
    }

    function sync() {
      keyBox.style.display = state.mode === 'cols' ? 'flex' : 'none';
      const keys = keyColumns();
      if (state.mode === 'cols' && !keys.length) {
        trial = null;
        impactText.textContent = '请先勾选至少一个判重列';
        runBtn.disabled = true;
        dom.clear(previewBox);
        previewBox.appendChild(dom.el('div', { class: 'muted', text: '未勾选判重列。' }));
        return;
      }
      trial = C.dedupRows(table, { keyColumns: keys, keep: state.keep });
      const n = trial.removedCount;
      dom.clear(impactText);
      impactText.appendChild(document.createTextNode('当前口径下：发现重复组 ' + trial.groups.length + ' 个，'));
      impactText.appendChild(dom.el('b', { text: '将删除 ' + n + ' 行' }));
      impactText.appendChild(document.createTextNode('（' + table.rows.length + ' → ' + (table.rows.length - n) + ' 行，列数不变）'));
      runBtn.disabled = n === 0;

      // 预览表：标红将删除的行
      dom.clear(previewBox);
      if (n === 0) {
        previewBox.appendChild(dom.el('div', { class: 'notice info', text: '当前口径下没有重复行，无需处理。' }));
      } else {
        previewBox.appendChild(dom.renderDataTable({
          table: table,
          maxRows: 120,
          highlightRows: new Set(trial.removedIndexes)
        }));
      }
    }

    function doRun() {
      if (!trial || !trial.removedCount) return;
      const keys = keyColumns();
      const keepText = state.keep === 'first' ? '保留每组第一条' : '保留每组最后一条';
      const scopeText = state.mode === 'all' ? '按整行判重' : '按列[' + keys.join('、') + ']判重';
      ctx.runStep({
        module: '重复值',
        rule: scopeText + '，' + keepText + '，删除 ' + trial.removedCount + ' 行',
        exec: function (t) { return C.dedupRows(t, { keyColumns: keys, keep: state.keep }); }
      });
    }

    sync();
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.dedup = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
