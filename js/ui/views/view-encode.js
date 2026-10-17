/* =========================================================
 * ui/views/view-encode.js — 模块7：类别编码
 * 文本列概览（唯一值数 / 最多取值）→ One-Hot / 顺序编码
 * 原则：保留原列，只新增编码列；高基数列给出警示
 * ======================================================= */
(function (global) {
  'use strict';

  const HIGH_CARD = 20; // 与 core/ops-encode.js 保持一致

  function labelOf(v) {
    return v instanceof Date ? (v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0')) : String(v);
  }

  // 与 core 一致的类别收集：首次出现顺序 + 频次（跳过空值）
  function localCategories(table, name, C) {
    const idx = C.colIndex(table, name);
    if (idx < 0) return [];
    const order = [], seen = new Map();
    table.rows.forEach(function (r) {
      const v = r[idx];
      if (C.isNull(v)) return;
      const key = typeof v + ':' + (v instanceof Date ? v.getTime() : v);
      if (!seen.has(key)) { seen.set(key, { value: labelOf(v), count: 0 }); order.push(seen.get(key)); }
      seen.get(key).count++;
    });
    return order;
  }

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '类别编码' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '把类别文本转成模型可用的数值列：One-Hot（每类一列 0/1）或顺序编码（按指定次序映射为 1,2,3…）。原列保留不动。'
    }));

    const table = ctx.pl().current;
    const state = { column: null, method: 'onehot', order: [] };
    let preview = null;
    let cats = [];

    /* ---------- 列概览 ---------- */
    const listCard = dom.el('div', { class: 'card' });
    listCard.appendChild(dom.el('div', { class: 'card-title' },
      '文本列概览',
      dom.el('span', { class: 'sub', text: '点击行选择要编码的列' })));
    const lw = dom.el('div', { class: 'table-wrap', style: { maxHeight: '280px' } });
    const lt = dom.el('table', { class: 'data-table' });
    lt.appendChild(dom.el('thead', {}, dom.el('tr', {},
      ['列名', '类型', '唯一值数', '最多取值（次数）', '建议'].map(function (h) {
        return dom.el('th', { text: h });
      }))));
    const lb = dom.el('tbody');
    const rowByCol = {};
    table.columns.forEach(function (col) {
      const vals = C.columnValues(table, col.name);
      const uq = C.uniqCount(vals);
      // 最多取值
      const freq = new Map();
      vals.forEach(function (v) {
        if (C.isNull(v)) return;
        const k = labelOf(v);
        freq.set(k, (freq.get(k) || 0) + 1);
      });
      let topVal = '', topN = 0;
      freq.forEach(function (n, k) { if (n > topN) { topN = n; topVal = k; } });

      const tr = dom.el('tr', { style: { cursor: 'pointer' } });
      tr.appendChild(dom.el('td', { text: col.name }));
      tr.appendChild(dom.el('td', { text: dom.typeLabel(col.type) }));
      tr.appendChild(dom.el('td', { text: String(uq) }));
      tr.appendChild(dom.el('td', { text: topVal === '' ? '(空)' : topVal + '（' + topN + '）' }));
      const sugTd = dom.el('td');
      if (uq === 0) sugTd.appendChild(dom.el('span', { class: 'tag', text: '全空列' }));
      else if (uq <= HIGH_CARD) sugTd.appendChild(dom.el('span', { class: 'tag brand', text: '适合 One-Hot' }));
      else sugTd.appendChild(dom.el('span', { class: 'tag warn', text: '基数偏高 ' + uq }));
      tr.appendChild(sugTd);
      tr.addEventListener('click', function () { pick(col.name); });
      rowByCol[col.name] = tr;
      lb.appendChild(tr);
    });
    lt.appendChild(lb);
    lw.appendChild(lt);
    listCard.appendChild(lw);
    body.appendChild(listCard);

    /* ---------- 编码配置 ---------- */
    const cfgCard = dom.el('div', { class: 'card' });
    cfgCard.appendChild(dom.el('div', { class: 'card-title', text: '编码配置' }));

    const rowCol = dom.el('div', { class: 'form-row' });
    rowCol.appendChild(dom.el('label', { text: '编码列' }));
    const colSel = dom.el('select', {
      on: { change: function () { pick(colSel.value, true); } }
    });
    colSel.appendChild(dom.el('option', { value: '', text: '（请选择）' }));
    table.columns.forEach(function (c) { colSel.appendChild(dom.el('option', { value: c.name, text: c.name })); });
    rowCol.appendChild(colSel);
    cfgCard.appendChild(rowCol);

    const rowMethod = dom.el('div', { class: 'form-row' });
    rowMethod.appendChild(dom.el('label', { text: '编码方法' }));
    [
      { v: 'onehot', t: 'One-Hot（每类一列）' },
      { v: 'ordinal', t: '顺序编码（可自定义次序）' }
    ].forEach(function (m) {
      const lab = dom.el('label', { class: 'radio-line' });
      const input = dom.el('input', {
        type: 'radio', name: 'enc-method', checked: m.v === 'onehot',
        on: { change: function () { state.method = m.v; sync(); } }
      });
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(m.t));
      rowMethod.appendChild(lab);
    });
    cfgCard.appendChild(rowMethod);

    const orderBox = dom.el('div', { style: { display: 'none' } });
    cfgCard.appendChild(orderBox);
    body.appendChild(cfgCard);

    /* ---------- 预览 ---------- */
    const prevCard = dom.el('div', { class: 'card' });
    prevCard.appendChild(dom.el('div', { class: 'card-title', text: '编码预览' }));
    const prevBox = dom.el('div', { class: 'muted', text: '请先选择编码列。' });
    prevCard.appendChild(prevBox);
    body.appendChild(prevCard);
    container.appendChild(body);

    /* ---------- 影响条 ---------- */
    const impactText = dom.el('div', { class: 'impact-text', text: '请选择编码列与方法' });
    const runBtn = dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '执行编码', disabled: true,
      on: { click: doRun }
    });
    container.appendChild(dom.el('div', { class: 'impact-bar' }, impactText, runBtn));

    function pick(name, fromSelect) {
      state.column = name || null;
      if (!fromSelect) colSel.value = name || '';
      cats = name ? localCategories(table, name, C) : [];
      state.order = cats.map(function (c) { return c.value; });
      markRow();
      sync();
    }

    function markRow() {
      Object.keys(rowByCol).forEach(function (n) {
        rowByCol[n].style.background = n === state.column ? 'var(--brand-soft)' : '';
      });
    }

    /* ---------- 顺序编码：次序调整 ---------- */
    function buildOrderBox() {
      dom.clear(orderBox);
      if (state.method !== 'ordinal') { orderBox.style.display = 'none'; return; }
      orderBox.style.display = 'block';
      orderBox.appendChild(dom.el('div', { class: 'form-row' },
        dom.el('label', { text: '自定义次序' }),
        dom.el('span', { class: 'muted small', text: '从上到下依次编码为 1,2,3…（低→高）' })));

      state.order.forEach(function (val, i) {
        const row = dom.el('div', { class: 'col-pick-item', style: { cursor: 'default' } });
        row.appendChild(dom.el('span', { class: 'tag', text: String(i + 1) }));
        row.appendChild(dom.el('span', { text: val }));
        const btns = dom.el('div', { class: 'order-btns' });
        btns.appendChild(dom.el('button', {
          class: 'btn btn-small', type: 'button', text: '↑', disabled: i === 0,
          on: { click: function () { move(i, -1); } }
        }));
        btns.appendChild(dom.el('button', {
          class: 'btn btn-small', type: 'button', text: '↓', disabled: i === state.order.length - 1,
          on: { click: function () { move(i, 1); } }
        }));
        row.appendChild(btns);
        orderBox.appendChild(row);
      });
    }

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= state.order.length) return;
      const tmp = state.order[i]; state.order[i] = state.order[j]; state.order[j] = tmp;
      sync();
    }

    function sync() {
      buildOrderBox();
      preview = null;
      dom.clear(prevBox);

      if (!state.column) {
        impactText.textContent = '请选择编码列与方法';
        runBtn.disabled = true;
        prevBox.appendChild(dom.el('div', { class: 'muted', text: '请先选择编码列。' }));
        return;
      }
      const params = { column: state.column, method: state.method };
      if (state.method === 'ordinal') params.order = state.order;

      try {
        preview = C.encodePreview(table, params);
      } catch (e) {
        impactText.textContent = e.message;
        runBtn.disabled = true;
        prevBox.appendChild(dom.el('div', { class: 'notice warn', text: e.message }));
        return;
      }

      // 类目清单
      const cw = dom.el('div', { class: 'table-wrap', style: { maxHeight: '300px' } });
      const ct = dom.el('table', { class: 'data-table' });
      const head = state.method === 'onehot'
        ? ['类别值', '出现次数', '将新增列']
        : ['类别值', '出现次数', '编码值'];
      ct.appendChild(dom.el('thead', {}, dom.el('tr', {}, head.map(function (h) { return dom.el('th', { text: h }); }))));
      const cb = dom.el('tbody');
      const mapping = preview.mapping || {};
      preview.values.forEach(function (c, i) {
        const tr = dom.el('tr');
        tr.appendChild(dom.el('td', { text: c.value, title: c.value }));
        tr.appendChild(dom.el('td', { text: String(c.count) }));
        if (state.method === 'onehot') tr.appendChild(dom.el('td', { text: preview.newColumns[i], title: preview.newColumns[i] }));
        else tr.appendChild(dom.el('td', { text: mapping[c.value] !== undefined ? String(mapping[c.value]) : '(未映射→空)' }));
        cb.appendChild(tr);
      });
      ct.appendChild(cb);
      cw.appendChild(ct);
      prevBox.appendChild(cw);

      if (preview.highCardinality) {
        prevBox.appendChild(dom.el('div', { class: 'notice warn', text: preview.warning }));
      }
      if (preview.unmapped && preview.unmapped.length) {
        prevBox.appendChild(dom.el('div', {
          class: 'notice warn',
          text: '以下类别未在自定义次序中，编码后将为空：' + preview.unmapped.join('、')
        }));
      }
      if (!preview.values.length) {
        prevBox.appendChild(dom.el('div', { class: 'notice info', text: '该列没有非空类别值，无需编码。' }));
      }

      // 影响
      dom.clear(impactText);
      const added = preview.newColumns ? preview.newColumns.length : 0;
      impactText.appendChild(document.createTextNode(state.method === 'onehot' ? 'One-Hot 「' : '顺序编码 「'));
      impactText.appendChild(dom.el('b', { text: state.column }));
      impactText.appendChild(document.createTextNode('」：' + preview.uniqueCount + ' 个类别，'));
      impactText.appendChild(dom.el('b', { text: '将新增 ' + added + ' 列' }));
      impactText.appendChild(document.createTextNode('（行数不变，原列保留，高风险：否）'));
      runBtn.disabled = !preview.values.length;
    }

    function doRun() {
      if (!state.column || !preview || !preview.values.length) return;
      const methodName = state.method === 'onehot' ? 'One-Hot 编码' : '顺序编码';
      const params = { column: state.column, method: state.method };
      if (state.method === 'ordinal') params.order = state.order;
      const added = preview.newColumns ? preview.newColumns.length : 0;
      const extra = state.method === 'ordinal' ? '，次序：' + state.order.join(' < ') : '';
      ctx.runStep({
        module: '类别编码',
        rule: methodName + '「' + state.column + '」' + preview.uniqueCount + ' 类 → 新增 ' + added + ' 列' + extra,
        exec: function (t) { return C.applyEncode(t, params); }
      });
    }

    sync();
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.encode = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
