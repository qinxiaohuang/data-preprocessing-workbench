/* =========================================================
 * ui/views/view-outlier.js — 模块4：异常值
 * 箱线图 + 可疑值列表；默认只打 *_outlier_flag 标记列（原则4）
 * 删除 / 截尾 = 高风险：填理由 + 弹窗确认（原则6）
 * ======================================================= */
(function (global) {
  'use strict';

  function round2(v) {
    if (v === null || v === undefined) return '—';
    return String(Math.round(v * 100) / 100);
  }

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '异常值' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '用统计方法找出可疑值。默认只新增标记列、不删数据；删除 / 截尾需填写理由并二次确认。'
    }));

    const table = ctx.pl().current;
    const numCols = dom.colNames(table, ['number', 'number-string']);
    if (!numCols.length) {
      body.appendChild(dom.el('div', { class: 'notice info', text: '当前数据没有数值列，无法做异常值检测。' }));
      container.appendChild(body);
      return;
    }

    const state = { column: numCols[0], method: 'iqr', min: '', max: '', action: 'flag' };
    let det = null; // 检测结果

    /* ---------- 配置卡片 ---------- */
    const card = dom.el('div', { class: 'card' });
    card.appendChild(dom.el('div', { class: 'card-title', text: '检测配置' }));

    const rowCol = dom.el('div', { class: 'form-row' });
    rowCol.appendChild(dom.el('label', { text: '检测列' }));
    const colSel = dom.el('select', {
      on: { change: function () { state.column = colSel.value; sync(); } }
    });
    dom.fillSelect(colSel, numCols.map(function (n) { return { value: n, label: n }; }), state.column);
    rowCol.appendChild(colSel);
    card.appendChild(rowCol);

    const rowM = dom.el('div', { class: 'form-row' });
    rowM.appendChild(dom.el('label', { text: '检测方法' }));
    [
      { v: 'iqr', t: 'IQR（四分位距，推荐）' },
      { v: 'zscore', t: 'Z-score（3σ）' },
      { v: 'range', t: '自定义业务区间' }
    ].forEach(function (m, i) {
      const lab = dom.el('label', { class: 'radio-line' });
      lab.appendChild(dom.el('input', {
        type: 'radio', name: 'out-method', checked: i === 0,
        on: { change: function () { state.method = m.v; sync(); } }
      }));
      lab.appendChild(document.createTextNode(m.t));
      rowM.appendChild(lab);
    });
    card.appendChild(rowM);

    const rowRange = dom.el('div', { class: 'form-row', style: { display: 'none' } });
    rowRange.appendChild(dom.el('label', { text: '正常区间' }));
    const minInput = dom.el('input', {
      type: 'number', placeholder: '下限（含）', style: { width: '130px' },
      on: { input: function () { state.min = minInput.value; sync(); } }
    });
    const maxInput = dom.el('input', {
      type: 'number', placeholder: '上限（含）', style: { width: '130px' },
      on: { input: function () { state.max = maxInput.value; sync(); } }
    });
    rowRange.appendChild(minInput);
    rowRange.appendChild(maxInput);
    card.appendChild(rowRange);

    const rowA = dom.el('div', { class: 'form-row' });
    rowA.appendChild(dom.el('label', { text: '处理方式' }));
    [
      { v: 'flag', t: '打标记列（默认，不删数据）' },
      { v: 'delete', t: '删除异常行（高风险）' },
      { v: 'winsorize', t: '截尾（压回边界，高风险）' }
    ].forEach(function (a, i) {
      const lab = dom.el('label', { class: 'radio-line' });
      lab.appendChild(dom.el('input', {
        type: 'radio', name: 'out-action', checked: i === 0,
        on: { change: function () { state.action = a.v; sync(); } }
      }));
      lab.appendChild(document.createTextNode(a.t));
      rowA.appendChild(lab);
    });
    card.appendChild(rowA);
    body.appendChild(card);

    /* ---------- 结果卡片：箱线图 + 可疑值列表 ---------- */
    const resCard = dom.el('div', { class: 'card' });
    resCard.appendChild(dom.el('div', { class: 'card-title', text: '分布与可疑值' }));
    const plotBox = dom.el('div');
    resCard.appendChild(plotBox);
    const listBox = dom.el('div');
    resCard.appendChild(listBox);
    body.appendChild(resCard);
    container.appendChild(body);

    /* ---------- 影响预览条 ---------- */
    const impactText = dom.el('div', { class: 'impact-text' });
    const runBtn = dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '执行',
      on: { click: doRun }
    });
    container.appendChild(dom.el('div', { class: 'impact-bar' }, impactText, runBtn));

    function detectParams() {
      const p = { column: state.column, method: state.method };
      if (state.method === 'range') {
        p.min = state.min === '' ? null : Number(state.min);
        p.max = state.max === '' ? null : Number(state.max);
      }
      return p;
    }

    function sync() {
      rowRange.style.display = state.method === 'range' ? 'flex' : 'none';
      dom.clear(plotBox);
      dom.clear(listBox);
      try {
        det = C.detectOutliers(table, detectParams());
      } catch (e) {
        det = null;
        impactText.textContent = e.message;
        runBtn.disabled = true;
        plotBox.appendChild(dom.el('div', { class: 'notice warn', text: e.message }));
        return;
      }
      // 箱线图
      plotBox.appendChild(drawBoxplot());
      // 可疑值列表
      const ci = C.colIndex(table, state.column);
      listBox.appendChild(dom.el('div', {
        class: 'muted small',
        text: '正常区间 [' + round2(det.lower) + '，' + round2(det.upper) + ']，共发现 ' + det.count + ' 个可疑值' +
          (det.count > 50 ? '（下表仅列前 50 个）' : ''),
        style: { margin: '10px 0 6px' }
      }));
      if (det.count) {
        const tw = dom.el('div', { class: 'table-wrap', style: { maxHeight: '220px' } });
        const tt = dom.el('table', { class: 'data-table' });
        tt.appendChild(dom.el('thead', {}, dom.el('tr', {},
          [dom.el('th', { text: '行号' }), dom.el('th', { text: '值' })])));
        const tb = dom.el('tbody');
        det.indexes.slice(0, 50).forEach(function (ri) {
          const v = table.rows[ri][ci];
          const s = v instanceof Date ? C.formatDate(v) : String(v);
          tb.appendChild(dom.el('tr', {},
            dom.el('td', { text: String(ri + 1) }),
            dom.el('td', { text: s, title: s })
          ));
        });
        tt.appendChild(tb);
        tw.appendChild(tt);
        listBox.appendChild(tw);
      }

      // 影响预览
      dom.clear(impactText);
      const flagName = state.column + '_outlier_flag';
      if (!det.count) {
        impactText.appendChild(document.createTextNode('未发现可疑值，'));
        impactText.appendChild(dom.el('b', { text: state.action === 'flag' ? '仍将新增全 0 标记列' : '无需处理' }));
        runBtn.disabled = false;
      } else if (state.action === 'flag') {
        impactText.appendChild(document.createTextNode('将新增标记列 '));
        impactText.appendChild(dom.el('b', { text: flagName }));
        impactText.appendChild(document.createTextNode('（' + det.count + ' 行标记为 1，行数列数据不变）'));
        runBtn.disabled = false;
      } else if (state.action === 'delete') {
        impactText.appendChild(document.createTextNode('将删除 '));
        impactText.appendChild(dom.el('b', { text: det.count + ' 行' }));
        impactText.appendChild(document.createTextNode('（' + table.rows.length + '→' + (table.rows.length - det.count) + ' 行，高风险）'));
        runBtn.disabled = false;
      } else {
        impactText.appendChild(document.createTextNode('将截尾 '));
        impactText.appendChild(dom.el('b', { text: det.count + ' 个值' }));
        impactText.appendChild(document.createTextNode('（压回边界 [' + round2(det.lower) + '，' + round2(det.upper) + ']，行数不变，高风险）'));
        runBtn.disabled = false;
      }
    }

    /* ---------- SVG 箱线图 ---------- */
    function drawBoxplot() {
      const ci = C.colIndex(table, state.column);
      const nums = [];
      table.rows.forEach(function (r) {
        const n = C.toNumber(r[ci]);
        if (n !== null) nums.push(n);
      });
      if (!nums.length) return dom.el('div', { class: 'muted', text: '该列没有可绘制的数值。' });
      nums.sort(function (a, b) { return a - b; });
      const dmin = nums[0], dmax = nums[nums.length - 1];
      const q1 = C.quantileSorted(nums, 0.25);
      const med = C.quantileSorted(nums, 0.5);
      const q3 = C.quantileSorted(nums, 0.75);
      // 须端 = 检测边界内的最值
      const inFence = nums.filter(function (v) { return v >= det.lower && v <= det.upper; });
      const wmin = inFence.length ? inFence[0] : dmin;
      const wmax = inFence.length ? inFence[inFence.length - 1] : dmax;

      const W = 560, L = 24, R = 24, Y = 58;
      const span = dmax - dmin;
      function x(v) { return span === 0 ? (W / 2) : L + (v - dmin) / span * (W - L - R); }

      const svg = dom.svgEl('svg', {
        viewBox: '0 0 ' + W + ' 132', width: '100%', height: '132',
        style: 'max-width:640px;display:block'
      });
      // 轴线
      svg.appendChild(dom.svgEl('line', { x1: L, y1: Y, x2: W - R, y2: Y, stroke: '#8f959e', 'stroke-width': 1 }));
      // 须线
      svg.appendChild(dom.svgEl('line', { x1: x(wmin), y1: Y, x2: x(q1), y2: Y, stroke: '#16794c', 'stroke-width': 1.5 }));
      svg.appendChild(dom.svgEl('line', { x1: x(q3), y1: Y, x2: x(wmax), y2: Y, stroke: '#16794c', 'stroke-width': 1.5 }));
      // 须端
      [wmin, wmax].forEach(function (v) {
        svg.appendChild(dom.svgEl('line', { x1: x(v), y1: Y - 16, x2: x(v), y2: Y + 16, stroke: '#16794c', 'stroke-width': 1.5 }));
      });
      // 箱体
      svg.appendChild(dom.svgEl('rect', {
        x: x(q1), y: Y - 22, width: Math.max(x(q3) - x(q1), 1), height: 44,
        fill: '#e8f5ee', stroke: '#16794c', 'stroke-width': 1.5, rx: 3
      }));
      // 中位数
      svg.appendChild(dom.svgEl('line', { x1: x(med), y1: Y - 22, x2: x(med), y2: Y + 22, stroke: '#0f6a40', 'stroke-width': 2.5 }));
      // 异常点（红点，抽样最多 300 个）
      const oi = det ? det.indexes : [];
      const step = Math.max(1, Math.ceil(oi.length / 300));
      for (let i = 0; i < oi.length; i += step) {
        const n = C.toNumber(table.rows[oi[i]][ci]);
        if (n === null) continue;
        svg.appendChild(dom.svgEl('circle', { cx: x(n), cy: Y, r: 3.2, fill: '#d83931', 'fill-opacity': 0.75 }));
      }
      // 底部标注
      const labels = [
        { v: dmin, t: '最小 ' + round2(dmin) },
        { v: q1, t: 'Q1 ' + round2(q1) },
        { v: med, t: '中位 ' + round2(med) },
        { v: q3, t: 'Q3 ' + round2(q3) },
        { v: dmax, t: '最大 ' + round2(dmax) }
      ];
      labels.forEach(function (lb) {
        const tx = dom.svgEl('text', {
          x: Math.min(Math.max(x(lb.v), 30), W - 30), y: Y + 46,
          'text-anchor': 'middle', 'font-size': 10, fill: '#646a73'
        });
        tx.textContent = lb.t;
        svg.appendChild(tx);
      });
      // 异常区间标注
      if (det && det.count) {
        const cap = dom.svgEl('text', { x: L, y: 14, 'font-size': 11, fill: '#d83931' });
        cap.textContent = '红点 = 可疑值（正常区间 [' + round2(det.lower) + '，' + round2(det.upper) + '] 之外）';
        svg.appendChild(cap);
      }
      return svg;
    }

    function methodName() {
      return state.method === 'iqr' ? 'IQR' : state.method === 'zscore' ? 'Z-score(3σ)' : '自定义区间';
    }

    function doRun() {
      if (!det) return;
      const p = detectParams();
      p.action = state.action;
      const range = '[' + round2(det.lower) + '，' + round2(det.upper) + ']';
      let rule;
      if (state.action === 'flag') {
        rule = methodName() + ' 检测「' + state.column + '」异常值（区间 ' + range + '），新增标记列 ' +
          state.column + '_outlier_flag，' + det.count + ' 行标记为 1';
        ctx.runStep({ module: '异常值', rule: rule, exec: function (t) { return C.applyOutlier(t, p); } });
        return;
      }
      // delete / winsorize → 高风险确认（原则4、6）
      const actionText = state.action === 'delete' ? '删除异常行' : '截尾（压回边界）';
      const impactDesc = state.action === 'delete'
        ? '将删除 ' + det.count + ' 行（' + table.rows.length + '→' + (table.rows.length - det.count) + ' 行）'
        : '将把 ' + det.count + ' 个异常值压回边界 ' + range;
      ctx.dom.modal({
        title: '高风险操作确认',
        danger: true,
        okLabel: '确认' + actionText,
        body: dom.el('div', {},
          dom.el('div', { class: 'notice danger', text: '原则四：异常值默认只标记，不盲删。你选择了「' + actionText + '」。' }),
          dom.el('div', { text: '规则：' + methodName() + ' 检测「' + state.column + '」，正常区间 ' + range }),
          dom.el('div', { class: 'muted', text: impactDesc + '。' })
        ),
        requireText: { label: '处理理由（将写入日志）', placeholder: '例如：录入错误，超过业务上不可能的范围' },
        onOk: function (values) {
          ctx.runStep({
            module: '异常值',
            rule: methodName() + ' 检测「' + state.column + '」异常值（区间 ' + range + '），' +
              actionText + '，影响 ' + det.count + (state.action === 'delete' ? ' 行' : ' 个值'),
            note: values.text,
            highRisk: true,
            exec: function (t) { return C.applyOutlier(t, p); }
          });
        }
      });
    }

    sync();
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.outlier = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
