/* =========================================================
 * ui/views/view-select.js — 模块8：字段筛选
 * 选列（决定输出列序，可拖拽/上下调序）+ 条件筛行（与/或）
 * 实时预览保留行列数；执行后行与列都可能减少（非高风险，但需留意）
 * ======================================================= */
(function (global) {
  'use strict';

  const COND_OPS = [
    { v: '>', t: '大于' }, { v: '>=', t: '大于等于' },
    { v: '<', t: '小于' }, { v: '<=', t: '小于等于' },
    { v: '==', t: '等于' }, { v: '!=', t: '不等于' },
    { v: 'contains', t: '包含' }, { v: 'notContains', t: '不包含' },
    { v: 'isNull', t: '为空' }, { v: 'notNull', t: '不为空' }
  ];

  function needsValue(op) { return op !== 'isNull' && op !== 'notNull'; }

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '字段筛选' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '保留需要的列并按条件筛掉不需要的行。列表顺序即输出列顺序（可拖拽或点 ↑↓ 调整）；未勾选的列将被删除。'
    }));

    const table = ctx.pl().current;
    const state = {
      order: table.columns.map(function (c) { return c.name; }), // 列表顺序 = 输出列序
      checked: {},
      conds: [],
      combinator: 'and'
    };
    table.columns.forEach(function (c) { state.checked[c.name] = true; });

    /* ---------- 选列卡片 ---------- */
    const colCard = dom.el('div', { class: 'card' });
    colCard.appendChild(dom.el('div', { class: 'card-title' },
      '选择保留的列',
      dom.el('span', { class: 'sub', text: '拖拽或点上下箭头调整顺序' })));
    const colList = dom.el('div');
    colCard.appendChild(colList);
    const colQuick = dom.el('div', { class: 'form-row', style: { marginTop: '6px' } });
    colQuick.appendChild(dom.el('button', {
      class: 'btn btn-small', type: 'button', text: '全选', on: { click: function () {
        state.order.forEach(function (n) { state.checked[n] = true; }); buildColList(); sync();
      } }
    }));
    colQuick.appendChild(dom.el('button', {
      class: 'btn btn-small', type: 'button', text: '全不选', on: { click: function () {
        state.order.forEach(function (n) { state.checked[n] = false; }); buildColList(); sync();
      } }
    }));
    colCard.appendChild(colQuick);
    body.appendChild(colCard);

    /* ---------- 条件卡片 ---------- */
    const condCard = dom.el('div', { class: 'card' });
    condCard.appendChild(dom.el('div', { class: 'card-title' },
      '筛选条件（可留空 = 不筛行）',
      dom.el('span', { class: 'sub', text: '多个条件之间按下方规则组合' })));
    const condList = dom.el('div');
    condCard.appendChild(condList);
    const condFoot = dom.el('div', { class: 'form-row', style: { marginTop: '4px' } });
    condFoot.appendChild(dom.el('button', {
      class: 'btn btn-small', type: 'button', text: '+ 添加条件', on: { click: function () {
        state.conds.push({ column: table.columns[0].name, op: '>', value: '' }); buildConds(); sync();
      } }
    }));
    const combWrap = dom.el('span');
    ['and', 'or'].forEach(function (v) {
      const lab = dom.el('label', { class: 'radio-line' });
      const input = dom.el('input', {
        type: 'radio', name: 'sel-comb', checked: v === 'and',
        on: { change: function () { state.combinator = v; sync(); } }
      });
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(v === 'and' ? '全部满足（且）' : '任一满足（或）'));
      combWrap.appendChild(lab);
    });
    condFoot.appendChild(dom.el('span', { class: 'muted small', style: { marginLeft: '6px' }, text: '组合：' }));
    condFoot.appendChild(combWrap);
    condCard.appendChild(condFoot);
    body.appendChild(condCard);
    container.appendChild(body);

    /* ---------- 影响条 ---------- */
    const impactText = dom.el('div', { class: 'impact-text' });
    const runBtn = dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '执行筛选', disabled: true,
      on: { click: doRun }
    });
    container.appendChild(dom.el('div', { class: 'impact-bar' }, impactText, runBtn));

    let preview = null;

    /* ---------- 选列渲染 ---------- */
    let dragFrom = -1;

    function buildColList() {
      dom.clear(colList);
      state.order.forEach(function (name, i) {
        const item = dom.el('div', { class: 'col-pick-item', draggable: 'true' });
        const cb = dom.el('input', {
          type: 'checkbox', checked: !!state.checked[name],
          on: { change: function () { state.checked[name] = cb.checked; sync(); } }
        });
        item.appendChild(cb);
        item.appendChild(dom.el('span', { text: name, title: name }));
        item.appendChild(dom.el('span', { class: 'muted small', text: '(' + dom.typeLabel(colType(name)) + ')' }));
        const btns = dom.el('div', { class: 'order-btns' });
        btns.appendChild(dom.el('button', {
          class: 'btn btn-small', type: 'button', text: '↑', disabled: i === 0,
          on: { click: function () { moveCol(i, -1); } }
        }));
        btns.appendChild(dom.el('button', {
          class: 'btn btn-small', type: 'button', text: '↓', disabled: i === state.order.length - 1,
          on: { click: function () { moveCol(i, 1); } }
        }));
        item.appendChild(btns);

        item.addEventListener('dragstart', function () { dragFrom = i; item.classList.add('dragging'); });
        item.addEventListener('dragend', function () { item.classList.remove('dragging'); dragFrom = -1; });
        item.addEventListener('dragover', function (e) { e.preventDefault(); });
        item.addEventListener('drop', function (e) {
          e.preventDefault();
          if (dragFrom < 0 || dragFrom === i) return;
          const moved = state.order.splice(dragFrom, 1)[0];
          state.order.splice(i, 0, moved);
          dragFrom = -1;
          buildColList();
          sync();
        });
        colList.appendChild(item);
      });
    }

    function colType(name) {
      const i = C.colIndex(table, name);
      return i >= 0 ? table.columns[i].type : 'string';
    }

    function moveCol(i, d) {
      const j = i + d;
      if (j < 0 || j >= state.order.length) return;
      const tmp = state.order[i]; state.order[i] = state.order[j]; state.order[j] = tmp;
      buildColList();
      sync();
    }

    function checkedColumns() {
      return state.order.filter(function (n) { return state.checked[n]; });
    }

    /* ---------- 条件渲染 ---------- */
    function buildConds() {
      dom.clear(condList);
      if (!state.conds.length) {
        condList.appendChild(dom.el('div', { class: 'muted small', text: '未设置条件：将保留全部行。' }));
        return;
      }
      state.conds.forEach(function (cond, i) {
        const row = dom.el('div', { class: 'cond-row' });
        const colSel = dom.el('select', {
          on: { change: function () { cond.column = colSel.value; sync(); } }
        });
        dom.fillSelect(colSel, table.columns.map(function (c) { return { value: c.name, label: c.name }; }), cond.column);
        row.appendChild(colSel);

        const opSel = dom.el('select', {
          on: { change: function () { cond.op = opSel.value; buildConds(); sync(); } }
        });
        dom.fillSelect(opSel, COND_OPS.map(function (o) { return { value: o.v, label: o.t }; }), cond.op);
        row.appendChild(opSel);

        if (needsValue(cond.op)) {
          row.appendChild(dom.el('input', {
            type: 'text', value: cond.value, placeholder: '比较值', style: { flex: '1', minWidth: '120px' },
            on: { input: function (e) { cond.value = e.target.value; sync(); } }
          }));
        } else {
          row.appendChild(dom.el('span', { class: 'muted small', style: { flex: '1' }, text: '（无需填值）' }));
        }
        row.appendChild(dom.el('button', {
          class: 'btn btn-small', type: 'button', text: '删除',
          on: { click: function () { state.conds.splice(i, 1); buildConds(); sync(); } }
        }));
        condList.appendChild(row);
      });
    }

    // 只把「完整」的条件交给 core；不完整条件被忽略并提示数量
    function completeConditions() {
      return state.conds.filter(function (c) {
        if (!c.column) return false;
        if (needsValue(c.op) && String(c.value) === '') return false;
        return true;
      }).map(function (c) {
        return { column: c.column, op: c.op, value: c.value };
      });
    }

    function sync() {
      preview = null;
      const cols = checkedColumns();
      const conds = completeConditions();
      const ignored = state.conds.length - conds.length;

      if (!cols.length) {
        impactText.textContent = '请至少勾选一列';
        runBtn.disabled = true;
        return;
      }
      const params = {
        columns: cols,
        conditions: conds,
        combinator: conds.length ? state.combinator : null
      };
      try {
        preview = C.selectPreview(table, params);
      } catch (e) {
        impactText.textContent = e.message;
        runBtn.disabled = true;
        return;
      }

      dom.clear(impactText);
      impactText.appendChild(document.createTextNode('当前将保留 '));
      impactText.appendChild(dom.el('b', { text: preview.rows + ' 行' }));
      impactText.appendChild(document.createTextNode(' × '));
      impactText.appendChild(dom.el('b', { text: preview.cols + ' 列' }));
      impactText.appendChild(document.createTextNode('（原 ' + table.rows.length + ' 行 × ' + table.columns.length + ' 列'));
      if (conds.length > 1) impactText.appendChild(document.createTextNode('，条件按「' + (state.combinator === 'or' ? '任一满足' : '全部满足') + '」组合'));
      if (ignored) impactText.appendChild(document.createTextNode('，有 ' + ignored + ' 条未填完的条件被忽略'));
      impactText.appendChild(document.createTextNode('）'));
      runBtn.disabled = false;
    }

    function doRun() {
      if (!preview) return;
      const cols = checkedColumns();
      const conds = completeConditions();
      const droppedCols = table.columns.length - cols.length;
      const rule = '保留 ' + cols.length + ' 列（删 ' + droppedCols + ' 列）' +
        (conds.length ? '，按 ' + conds.length + ' 个条件（' + (state.combinator === 'or' ? '或' : '且') + '）筛行' : '，不筛行') +
        ' → ' + preview.rows + ' 行';
      ctx.runStep({
        module: '字段筛选',
        rule: rule,
        exec: function (t) {
          return C.applySelect(t, {
            columns: cols,
            conditions: conds,
            combinator: conds.length ? state.combinator : null
          });
        }
      });
    }

    buildColList();
    buildConds();
    sync();
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.select = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
