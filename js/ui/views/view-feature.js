/* =========================================================
 * ui/views/view-feature.js — 模块6：特征工程
 * 五种派生列：四则运算 / 条件生成 / 日期拆解 / 文本提取 / 数值分箱
 * 原则：只新增列，绝不修改原列；配置变更实时预演前 10 行
 * ======================================================= */
(function (global) {
  'use strict';

  const KINDS = [
    { value: 'arithmetic', label: '四则运算' },
    { value: 'condition', label: '条件生成' },
    { value: 'date-part', label: '日期拆解' },
    { value: 'text', label: '文本提取' },
    { value: 'bin', label: '数值分箱' }
  ];
  const NUM_TYPES = ['number', 'number-string'];
  const DATE_TYPES = ['date', 'date-string'];
  const COND_OPS = [
    { v: '>', t: '大于' }, { v: '>=', t: '大于等于' },
    { v: '<', t: '小于' }, { v: '<=', t: '小于等于' },
    { v: '==', t: '等于' }, { v: '!=', t: '不等于' },
    { v: 'contains', t: '包含' }, { v: 'notContains', t: '不包含' },
    { v: 'isNull', t: '为空' }, { v: 'notNull', t: '不为空' }
  ];
  const DATE_PARTS = [
    { v: 'year', t: '年' }, { v: 'month', t: '月' }, { v: 'day', t: '日' },
    { v: 'weekday', t: '星期（周一=1）' }, { v: 'quarter', t: '季度' },
    { v: 'isWeekend', t: '是否周末（1/0）' }
  ];
  const TEXT_OPS = [
    { v: 'substring', t: '截取子串' }, { v: 'split', t: '按分隔符拆分' },
    { v: 'contains', t: '包含关键字（1/0）' }
  ];
  const BIN_METHODS = [
    { v: 'equal-width', t: '等宽分箱' }, { v: 'equal-freq', t: '等频分箱' },
    { v: 'custom', t: '自定义边界' }
  ];

  // 数值列的输入一律为字符串；'' 与纯数字分别处理
  function parseScalar(s) {
    if (s === undefined || s === '' || s === null) return null;
    const n = Number(s);
    return isNaN(n) ? s : n;
  }

  function parseNumList(s) {
    if (!s) return [];
    return s.split(',').map(function (x) { return Number(x.trim()); })
      .filter(function (n) { return !isNaN(n); });
  }

  function parseLabelList(s) {
    if (!s) return [];
    return s.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
  }

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '特征工程' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '基于现有列派生新列（计算、条件标记、日期拆解、文本提取、分箱）。原列保持不变，可在预览无误后执行。'
    }));

    const table = ctx.pl().current;
    const numCols = dom.colNames(table, NUM_TYPES);
    const dateCols = dom.colNames(table, DATE_TYPES);
    const allCols = table.columns.map(function (c) { return c.name; });

    const state = {
      kind: 'arithmetic',
      newColumn: '', nameTouched: false,
      colA: numCols[0] || allCols[0] || '', op: '+', bSource: 'col',
      colB: numCols[1] || numCols[0] || '', constB: '',
      column: allCols[0] || '', condOp: '>', value: '', then: '1', else: '0',
      part: 'year', textOp: 'substring', start: '0', length: '', delimiter: '-', index: '0',
      keyword: '', binMethod: 'equal-width', bins: '5', edges: '', labels: ''
    };

    /* ---------- 类型选择 ---------- */
    const kindCard = dom.el('div', { class: 'card' });
    kindCard.appendChild(dom.el('div', { class: 'card-title', text: '选择派生方式' }));
    const rowKind = dom.el('div', { class: 'form-row' });
    rowKind.appendChild(dom.el('label', { text: '派生方式' }));
    const kindSel = dom.el('select', {
      on: { change: function () { state.kind = kindSel.value; rebuildFields(); sync(); } }
    });
    KINDS.forEach(function (k) { kindSel.appendChild(dom.el('option', { value: k.value, text: k.label })); });
    rowKind.appendChild(kindSel);
    kindCard.appendChild(rowKind);
    body.appendChild(kindCard);

    /* ---------- 参数区（随 kind 重建） ---------- */
    const paramCard = dom.el('div', { class: 'card' });
    paramCard.appendChild(dom.el('div', { class: 'card-title', text: '参数配置' }));
    const fieldsBox = dom.el('div');
    paramCard.appendChild(fieldsBox);

    const rowName = dom.el('div', { class: 'form-row' });
    rowName.appendChild(dom.el('label', { text: '新列名' }));
    const nameInput = dom.el('input', {
      type: 'text', placeholder: '例如 单价_加_数量',
      on: {
        input: function () { state.newColumn = nameInput.value; state.nameTouched = true; sync(); }
      }
    });
    rowName.appendChild(nameInput);
    rowName.appendChild(dom.el('span', { class: 'muted small', text: '新列将追加在最后，原列不变' }));
    paramCard.appendChild(rowName);
    body.appendChild(paramCard);

    /* ---------- 预览 ---------- */
    const prevCard = dom.el('div', { class: 'card' });
    prevCard.appendChild(dom.el('div', { class: 'card-title', text: '派生结果预览（前 10 行）' }));
    const prevBox = dom.el('div');
    prevCard.appendChild(prevBox);
    body.appendChild(prevCard);
    container.appendChild(body);

    /* ---------- 影响条 ---------- */
    const impactText = dom.el('div', { class: 'impact-text', text: '配置派生参数' });
    const runBtn = dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '执行派生', disabled: true,
      on: { click: doRun }
    });
    container.appendChild(dom.el('div', { class: 'impact-bar' }, impactText, runBtn));

    let preview = null;

    /* ================= 字段构建 ================= */

    function pick(sel, options, current, onChange) {
      dom.fillSelect(sel, options.map(function (o) { return { value: o, label: o }; }), current);
      if (onChange) sel.addEventListener('change', onChange);
    }

    function numSelect(current, onChange) {
      if (!numCols.length) return dom.el('span', { class: 'muted small', text: '（无可用数值列）' });
      const sel = dom.el('select', { on: { change: function () { onChange(sel.value); } } });
      pick(sel, numCols, current);
      return sel;
    }

    function allSelect(current, onChange) {
      const sel = dom.el('select', { on: { change: function () { onChange(sel.value); } } });
      pick(sel, allCols, current);
      return sel;
    }

    function dateSelect(current, onChange) {
      if (!dateCols.length) return dom.el('span', { class: 'muted small', text: '（无可用日期列）' });
      const sel = dom.el('select', { on: { change: function () { onChange(sel.value); } } });
      pick(sel, dateCols, current);
      return sel;
    }

    function radioGroup(name, options, current, onPick) {
      const wrap = dom.el('span', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: '0 4px' } });
      options.forEach(function (o) {
        const lab = dom.el('label', { class: 'radio-line' });
        const input = dom.el('input', {
          type: 'radio', name: 'feat-' + name, checked: o.value === current,
          on: { change: function () { onPick(o.value); } }
        });
        lab.appendChild(input);
        lab.appendChild(document.createTextNode(o.label));
        wrap.appendChild(lab);
      });
      return wrap;
    }

    function textInput(value, placeholder, onInput, width) {
      return dom.el('input', {
        type: 'text', value: value, placeholder: placeholder || '',
        style: { width: width || '110px' },
        on: { input: function (e) { onInput(e.target.value); } }
      });
    }

    function rebuildFields() {
      dom.clear(fieldsBox);
      if (state.kind === 'arithmetic') buildArithmetic();
      else if (state.kind === 'condition') buildCondition();
      else if (state.kind === 'date-part') buildDatePart();
      else if (state.kind === 'text') buildText();
      else buildBin();
    }

    function buildArithmetic() {
      const r1 = dom.el('div', { class: 'form-row' });
      r1.appendChild(dom.el('label', { text: '第一列' }));
      r1.appendChild(numSelect(state.colA, function (v) { state.colA = v; suggestName(); sync(); }));
      fieldsBox.appendChild(r1);

      const r2 = dom.el('div', { class: 'form-row' });
      r2.appendChild(dom.el('label', { text: '运算符' }));
      r2.appendChild(radioGroup('arith-op',
        [{ value: '+', label: '+' }, { value: '-', label: '−' }, { value: '*', label: '×' }, { value: '/', label: '÷' }],
        state.op, function (v) { state.op = v; suggestName(); sync(); }));
      fieldsBox.appendChild(r2);

      const r3 = dom.el('div', { class: 'form-row' });
      r3.appendChild(dom.el('label', { text: '第二项' }));
      r3.appendChild(radioGroup('arith-b',
        [{ value: 'col', label: '另一列' }, { value: 'const', label: '常数' }],
        state.bSource, function (v) { state.bSource = v; rebuildFields(); sync(); }));
      fieldsBox.appendChild(r3);

      const r4 = dom.el('div', { class: 'form-row' });
      r4.appendChild(dom.el('label', { text: '第二列 / 常数' }));
      if (state.bSource === 'col') {
        r4.appendChild(numSelect(state.colB, function (v) { state.colB = v; suggestName(); sync(); }));
      } else {
        r4.appendChild(dom.el('input', {
          type: 'number', value: state.constB, placeholder: '例如 100', style: { width: '140px' },
          on: { input: function (e) { state.constB = e.target.value; sync(); } }
        }));
      }
      fieldsBox.appendChild(r4);
    }

    function buildCondition() {
      const r1 = dom.el('div', { class: 'form-row' });
      r1.appendChild(dom.el('label', { text: '判断列' }));
      r1.appendChild(allSelect(state.column, function (v) { state.column = v; sync(); }));
      fieldsBox.appendChild(r1);

      const r2 = dom.el('div', { class: 'form-row' });
      r2.appendChild(dom.el('label', { text: '条件' }));
      const opSel = dom.el('select', {
        on: { change: function () { state.condOp = opSel.value; rebuildFields(); sync(); } }
      });
      dom.fillSelect(opSel, COND_OPS.map(function (o) { return { value: o.v, label: o.t }; }), state.condOp);
      r2.appendChild(opSel);
      const needValue = state.condOp !== 'isNull' && state.condOp !== 'notNull';
      if (needValue) {
        r2.appendChild(textInput(state.value, '比较值', function (v) { state.value = v; sync(); }, '150px'));
      }
      fieldsBox.appendChild(r2);

      const r3 = dom.el('div', { class: 'form-row' });
      r3.appendChild(dom.el('label', { text: '满足时 →' }));
      r3.appendChild(textInput(state.then, '例如 1', function (v) { state.then = v; sync(); }, '90px'));
      r3.appendChild(dom.el('span', { class: 'muted small', text: '不满足时 →' }));
      r3.appendChild(textInput(state.else, '例如 0', function (v) { state.else = v; sync(); }, '90px'));
      fieldsBox.appendChild(r3);
    }

    function buildDatePart() {
      // 切到日期拆解时，若当前列不是日期列，自动落到第一个可用日期列
      if (dateCols.length && dateCols.indexOf(state.column) < 0) state.column = dateCols[0];
      const r1 = dom.el('div', { class: 'form-row' });
      r1.appendChild(dom.el('label', { text: '日期列' }));
      r1.appendChild(dateSelect(state.column, function (v) { state.column = v; suggestName(); sync(); }));
      fieldsBox.appendChild(r1);

      const r2 = dom.el('div', { class: 'form-row' });
      r2.appendChild(dom.el('label', { text: '拆解为' }));
      const sel = dom.el('select', {
        on: { change: function () { state.part = sel.value; suggestName(); sync(); } }
      });
      dom.fillSelect(sel, DATE_PARTS.map(function (o) { return { value: o.v, label: o.t }; }), state.part);
      r2.appendChild(sel);
      fieldsBox.appendChild(r2);
    }

    function buildText() {
      const r1 = dom.el('div', { class: 'form-row' });
      r1.appendChild(dom.el('label', { text: '文本列' }));
      r1.appendChild(allSelect(state.column, function (v) { state.column = v; sync(); }));
      fieldsBox.appendChild(r1);

      const r2 = dom.el('div', { class: 'form-row' });
      r2.appendChild(dom.el('label', { text: '操作' }));
      r2.appendChild(radioGroup('text-op',
        TEXT_OPS.map(function (o) { return { value: o.v, label: o.t }; }),
        state.textOp, function (v) { state.textOp = v; rebuildFields(); sync(); }));
      fieldsBox.appendChild(r2);

      const r3 = dom.el('div', { class: 'form-row' });
      if (state.textOp === 'substring') {
        r3.appendChild(dom.el('label', { text: '起始位置' }));
        r3.appendChild(dom.el('input', {
          type: 'number', value: state.start, placeholder: '0 起', style: { width: '90px' },
          on: { input: function (e) { state.start = e.target.value; sync(); } }
        }));
        r3.appendChild(dom.el('span', { class: 'muted small', text: '长度（留空=到末尾）' }));
        r3.appendChild(dom.el('input', {
          type: 'number', value: state.length, placeholder: '可留空', style: { width: '110px' },
          on: { input: function (e) { state.length = e.target.value; sync(); } }
        }));
      } else if (state.textOp === 'split') {
        r3.appendChild(dom.el('label', { text: '分隔符' }));
        r3.appendChild(textInput(state.delimiter, '例如 -', function (v) { state.delimiter = v; sync(); }, '90px'));
        r3.appendChild(dom.el('span', { class: 'muted small', text: '取第几段（0 起）' }));
        r3.appendChild(dom.el('input', {
          type: 'number', value: state.index, style: { width: '90px' },
          on: { input: function (e) { state.index = e.target.value; sync(); } }
        }));
      } else {
        r3.appendChild(dom.el('label', { text: '关键字' }));
        r3.appendChild(textInput(state.keyword, '例如 华东', function (v) { state.keyword = v; sync(); }, '150px'));
        r3.appendChild(dom.el('span', { class: 'muted small', text: '包含=1，否则=0' }));
      }
      fieldsBox.appendChild(r3);
    }

    function buildBin() {
      // 切到数值分箱时，若当前列不是数值列，自动落到第一个可用数值列
      if (numCols.length && numCols.indexOf(state.column) < 0) state.column = numCols[0];
      const r1 = dom.el('div', { class: 'form-row' });
      r1.appendChild(dom.el('label', { text: '数值列' }));
      r1.appendChild(numSelect(state.column, function (v) { state.column = v; suggestName(); sync(); }));
      fieldsBox.appendChild(r1);

      const r2 = dom.el('div', { class: 'form-row' });
      r2.appendChild(dom.el('label', { text: '分箱方式' }));
      r2.appendChild(radioGroup('bin-method',
        BIN_METHODS.map(function (o) { return { value: o.v, label: o.t }; }),
        state.binMethod, function (v) { state.binMethod = v; rebuildFields(); sync(); }));
      fieldsBox.appendChild(r2);

      const r3 = dom.el('div', { class: 'form-row' });
      if (state.binMethod === 'custom') {
        r3.appendChild(dom.el('label', { text: '边界值' }));
        r3.appendChild(textInput(state.edges, '例如 0,60,70,80,90,100',
          function (v) { state.edges = v; sync(); }, '280px'));
        r3.appendChild(dom.el('span', { class: 'muted small', text: '标签（个数=区间数，可留空）' }));
        r3.appendChild(textInput(state.labels, '例如 不及格,及格,中,良,优',
          function (v) { state.labels = v; sync(); }, '240px'));
      } else {
        r3.appendChild(dom.el('label', { text: '分箱数' }));
        r3.appendChild(dom.el('input', {
          type: 'number', value: state.bins, min: 2, style: { width: '90px' },
          on: { input: function (e) { state.bins = e.target.value; sync(); } }
        }));
        r3.appendChild(dom.el('span', { class: 'muted small', text: '至少 2 组' }));
      }
      fieldsBox.appendChild(r3);
    }

    /* ================= 新列名建议 ================= */

    function opSymbol() { return { '+': '加', '-': '减', '*': '乘', '/': '除' }[state.op] || '运算'; }

    function suggestName() {
      if (state.nameTouched) return;
      let s = '';
      if (state.kind === 'arithmetic') {
        s = (state.colA || '列A') + '_' + opSymbol() + '_' +
          (state.bSource === 'const' ? (state.constB || '常数') : (state.colB || '列B'));
      } else if (state.kind === 'date-part') {
        s = (state.column || '日期') + '_' + ({ year: '年', month: '月', day: '日', weekday: '星期', quarter: '季度', isWeekend: '是否周末' }[state.part] || '日期部分');
      } else if (state.kind === 'bin') {
        s = (state.column || '数值') + '_' + ({ 'equal-width': '等宽箱', 'equal-freq': '等频箱', custom: '分箱' }[state.binMethod] || '分箱');
      } else if (state.kind === 'condition') {
        s = (state.column || '列') + '_是否' + (state.condOp || '满足');
      } else {
        s = (state.column || '文本') + '_' + ({ substring: '截取', split: '拆分', contains: '含关键字' }[state.textOp] || '提取');
      }
      state.newColumn = s;
      nameInput.value = s;
    }

    /* ================= 规格与同步 ================= */

    function buildSpec() {
      const s = { kind: state.kind, newColumn: state.newColumn.trim() };
      if (state.kind === 'arithmetic') {
        s.op = state.op; s.colA = state.colA;
        if (state.bSource === 'const') s.constB = parseScalar(state.constB);
        else s.colB = state.colB;
      } else if (state.kind === 'condition') {
        s.column = state.column; s.op = state.condOp;
        s.value = parseScalar(state.value);
        s.then = parseScalar(state.then);
        s.else = parseScalar(state.else);
      } else if (state.kind === 'date-part') {
        s.column = state.column; s.part = state.part;
      } else if (state.kind === 'text') {
        s.column = state.column; s.op = state.textOp;
        if (state.textOp === 'substring') {
          s.start = parseInt(state.start, 10) || 0;
          if (state.length !== '' && !isNaN(Number(state.length))) s.length = parseInt(state.length, 10);
        } else if (state.textOp === 'split') {
          s.delimiter = state.delimiter;
          s.index = parseInt(state.index, 10) || 0;
        } else {
          s.keyword = state.keyword;
        }
      } else if (state.kind === 'bin') {
        s.column = state.column; s.method = state.binMethod;
        if (state.binMethod === 'custom') {
          s.edges = parseNumList(state.edges);
          const labs = parseLabelList(state.labels);
          if (labs.length) s.labels = labs;
        } else {
          s.bins = parseInt(state.bins, 10) || 0;
        }
      }
      return s;
    }

    function sync() {
      suggestName();
      preview = null;
      dom.clear(prevBox);
      let spec;
      try { spec = buildSpec(); }
      catch (e) { impactText.textContent = e.message; runBtn.disabled = true; return; }

      if (!spec.newColumn) {
        impactText.textContent = '请填写新列名';
        runBtn.disabled = true;
        prevBox.appendChild(dom.el('div', { class: 'muted', text: '请填写新列名后查看预览。' }));
        return;
      }
      try {
        preview = C.featurePreview(table, spec);
      } catch (e) {
        impactText.textContent = e.message;
        runBtn.disabled = true;
        prevBox.appendChild(dom.el('div', { class: 'notice warn', text: e.message }));
        return;
      }

      // 预览表：行号 + 新列值
      const tw = dom.el('div', { class: 'table-wrap', style: { maxHeight: '260px' } });
      const tt = dom.el('table', { class: 'data-table' });
      tt.appendChild(dom.el('thead', {}, dom.el('tr', {},
        dom.el('th', { text: '行号' }),
        dom.el('th', {}, preview.column, dom.el('span', { class: 'col-type', text: '新列' }))))); 
      const tb = dom.el('tbody');
      preview.values.forEach(function (v, i) {
        tb.appendChild(dom.el('tr', {},
          dom.el('td', { class: 'muted', text: String(i + 1) }),
          v === null || v === undefined
            ? dom.el('td', { class: 'cell-null', text: '(空)' })
            : dom.el('td', { text: String(v) })
        ));
      });
      tt.appendChild(tb);
      tw.appendChild(tt);
      prevBox.appendChild(tw);

      if (preview.binEdges) {
        const nb = dom.el('div', { class: 'notice info' });
        nb.appendChild(document.createTextNode('分箱边界：' + preview.binEdges.map(function (x) {
          return Math.round(x * 100) / 100;
        }).join(' , ')));
        nb.appendChild(dom.el('div', { class: 'small', text: '区间标签：' + preview.binLabels.join(' ｜ ') }));
        prevBox.appendChild(nb);
      }
      if (preview.nullCount) {
        prevBox.appendChild(dom.el('div', {
          class: 'muted small',
          text: '注意：' + preview.nullCount + ' 行结果为 (空)（源值缺失或无法计算）。'
        }));
      }

      dom.clear(impactText);
      impactText.appendChild(document.createTextNode('将新增列 '));
      impactText.appendChild(dom.el('b', { text: preview.column }));
      impactText.appendChild(document.createTextNode('（' + preview.total + ' 行，' +
        (preview.total - preview.nullCount) + ' 行有值' + (preview.nullCount ? '、' + preview.nullCount + ' 行为空' : '') +
        '，列数 +1，高风险：否）'));
      runBtn.disabled = false;
    }

    function kindLabel() {
      return KINDS.filter(function (k) { return k.value === state.kind; })[0].label;
    }

    function doRun() {
      if (!preview) return;
      const spec = buildSpec();
      ctx.runStep({
        module: '特征工程',
        rule: kindLabel() + '，新增列「' + spec.newColumn + '」，有值 ' +
          (preview.total - preview.nullCount) + ' 行、空 ' + preview.nullCount + ' 行',
        exec: function (t) { return C.applyFeature(t, spec); }
      });
    }

    rebuildFields();
    sync();
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.feature = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
