/* =========================================================
 * ui/views/view-missing.js — 模块3：缺失值
 * 每列缺失率 + 按列策略（删行/删列/填充）+ 批量套用
 * 高风险（原则6）：高缺失率列删列 / 删行≥50% → 弹窗确认
 * ======================================================= */
(function (global) {
  'use strict';

  const STRATEGIES = [
    { value: 'keep', label: '不动' },
    { value: 'drop-rows', label: '删除该列为空的行' },
    { value: 'drop-col', label: '删除整列' },
    { value: 'mean', label: '均值填充', numericOnly: true },
    { value: 'median', label: '中位数填充', numericOnly: true },
    { value: 'mode', label: '众数填充' },
    { value: 'ffill', label: '前向填充（用上一行）' },
    { value: 'bfill', label: '后向填充（用下一行）' },
    { value: 'fixed', label: '固定值填充', needValue: true }
  ];

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '缺失值' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '查看每列缺失率，按列选择删行 / 删列 / 填充策略。执行前显示影响量，高风险操作会弹窗确认。'
    }));

    const table = ctx.pl().current;
    const overview = C.missingOverview(table); // [{column, missing, rate}]
    const totalMissing = overview.reduce(function (a, o) { return a + o.missing; }, 0);

    if (totalMissing === 0) {
      body.appendChild(dom.el('div', { class: 'notice info', text: '当前数据没有缺失值，无需处理。' }));
      container.appendChild(body);
      return;
    }

    // 每列状态：strategy / value
    const st = {};
    overview.forEach(function (o) { st[o.column] = { strategy: 'keep', value: '' }; });

    /* ---------- 批量套用 ---------- */
    const batchCard = dom.el('div', { class: 'card' });
    batchCard.appendChild(dom.el('div', { class: 'card-title', text: '批量套用' }));
    const bRow = dom.el('div', { class: 'form-row' });
    bRow.appendChild(dom.el('label', { text: '把' }));
    const condSel = dom.el('select', {});
    dom.fillSelect(condSel, [
      { value: 'any', label: '所有含缺失的列' },
      { value: 'lt5', label: '缺失率 < 5% 的列' },
      { value: 'mid', label: '缺失率 5% ~ 30% 的列' },
      { value: 'ge30', label: '缺失率 ≥ 30% 的列' }
    ], 'any');
    bRow.appendChild(condSel);
    bRow.appendChild(dom.el('label', { text: '设为', style: { minWidth: '0' } }));
    const stratSel = dom.el('select', {});
    dom.fillSelect(stratSel, STRATEGIES.filter(function (s) { return s.value !== 'keep'; })
      .map(function (s) { return { value: s.value, label: s.label }; }), 'median');
    bRow.appendChild(stratSel);
    const batchValue = dom.el('input', { type: 'text', placeholder: '固定值', style: { width: '110px', display: 'none' } });
    bRow.appendChild(batchValue);
    stratSel.addEventListener('change', function () {
      batchValue.style.display = stratSel.value === 'fixed' ? '' : 'none';
    });
    bRow.appendChild(dom.el('button', {
      class: 'btn', type: 'button', text: '套用',
      on: {
        click: function () {
          const cond = condSel.value, strategy = stratSel.value, val = batchValue.value;
          overview.forEach(function (o) {
            if (o.missing === 0) return;
            const pct = o.rate * 100;
            const hit = cond === 'any' || (cond === 'lt5' && pct < 5) ||
              (cond === 'mid' && pct >= 5 && pct < 30) || (cond === 'ge30' && pct >= 30);
            if (!hit) return;
            const col = columnOf(o.column);
            if ((strategy === 'mean' || strategy === 'median') && !isNumeric(col)) return; // 跳过非数值列
            st[o.column].strategy = strategy;
            st[o.column].value = val;
          });
          ctx.refresh();
        }
      }
    }));
    batchCard.appendChild(bRow);
    batchCard.appendChild(dom.el('div', {
      class: 'small muted',
      text: '均值 / 中位数只适用于数值列，套用时会自动跳过文本列。'
    }));
    body.appendChild(batchCard);

    /* ---------- 按列策略表 ---------- */
    const card = dom.el('div', { class: 'card' });
    card.appendChild(dom.el('div', { class: 'card-title', text: '按列设置策略' }));
    const wrap = dom.el('div', { class: 'table-wrap', style: { maxHeight: '460px' } });
    const t = dom.el('table', { class: 'data-table' });
    t.appendChild(dom.el('thead', {}, dom.el('tr', {},
      ['列名', '类型', '缺失数', '缺失率', '处理策略', '固定值'].map(function (h) {
        return dom.el('th', { text: h });
      }))));

    const tbody = dom.el('tbody');
    const selects = {};
    const valueInputs = {};
    overview.forEach(function (o) {
      const tr = dom.el('tr');
      tr.appendChild(dom.el('td', { text: o.column }));
      const col = columnOf(o.column);
      tr.appendChild(dom.el('td', { text: dom.typeLabel(col.type) }));
      tr.appendChild(dom.el('td', { text: String(o.missing) }));

      const pct = Math.round(o.rate * 100);
      const barTd = dom.el('td', {});
      const bw = dom.el('div', { class: 'bar-wrap', style: { display: 'inline-block', verticalAlign: 'middle' } });
      bw.appendChild(dom.el('div', {
        class: 'bar-fill' + (pct >= 30 ? ' danger' : ' warn'),
        style: { width: Math.max(pct, 2) + '%' }
      }));
      barTd.appendChild(bw);
      barTd.appendChild(dom.el('span', {
        class: 'small' + (pct >= 30 ? '' : ' muted'),
        text: ' ' + pct + '%' + (pct >= 30 ? '（偏高）' : '')
      }));
      tr.appendChild(barTd);

      // 策略下拉
      const sel = dom.el('select', {
        on: {
          change: function () {
            st[o.column].strategy = sel.value;
            valueInputs[o.column].style.display = sel.value === 'fixed' ? '' : 'none';
            sync();
          }
        }
      });
      STRATEGIES.forEach(function (s) {
        const opt = dom.el('option', { value: s.value, text: s.label });
        if (s.numericOnly && !isNumeric(col)) {
          opt.disabled = true;
          opt.textContent = s.label + '（仅数值列）';
        }
        sel.appendChild(opt);
      });
      sel.value = st[o.column].strategy;
      selects[o.column] = sel;
      tr.appendChild(dom.el('td', {}, sel));

      const vi = dom.el('input', {
        type: 'text', placeholder: '填入值', style: { width: '100px', display: 'none' },
        on: { input: function () { st[o.column].value = vi.value; sync(); } }
      });
      valueInputs[o.column] = vi;
      tr.appendChild(dom.el('td', {}, vi));
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    card.appendChild(wrap);
    body.appendChild(card);
    container.appendChild(body);

    /* ---------- 影响预览条 ---------- */
    const impactText = dom.el('div', { class: 'impact-text' });
    const runBtn = dom.el('button', {
      class: 'btn btn-primary', type: 'button', text: '执行缺失值处理',
      on: { click: doRun }
    });
    container.appendChild(dom.el('div', { class: 'impact-bar' }, impactText, runBtn));

    let trialInfo = null;

    function columnOf(name) {
      return table.columns[C.colIndex(table, name)];
    }
    function isNumeric(col) {
      return col.type === 'number' || col.type === 'number-string';
    }

    function buildPlans() {
      const plans = [];
      overview.forEach(function (o) {
        const s = st[o.column];
        if (!s || s.strategy === 'keep') return;
        const plan = { column: o.column, strategy: s.strategy };
        if (s.strategy === 'fixed') plan.value = s.value;
        plans.push(plan);
      });
      return plans;
    }

    function sync() {
      const plans = buildPlans();
      if (!plans.length) {
        trialInfo = null;
        impactText.textContent = '所有列策略均为「不动」，不会修改数据';
        runBtn.disabled = true;
        return;
      }
      try {
        const r = C.applyMissing(table, plans);
        trialInfo = r.info;
        const parts = [];
        if (trialInfo.filledCells) parts.push('填充 ' + trialInfo.filledCells + ' 个单元格');
        if (trialInfo.rowsDeleted) parts.push('删除 ' + trialInfo.rowsDeleted + ' 行');
        if (trialInfo.colsDropped.length) parts.push('删除 ' + trialInfo.colsDropped.length + ' 列');
        dom.clear(impactText);
        impactText.appendChild(document.createTextNode('执行后：'));
        impactText.appendChild(dom.el('b', { text: parts.join('，') || '无变化' }));
        impactText.appendChild(document.createTextNode(
          '（' + table.rows.length + '→' + (table.rows.length - trialInfo.rowsDeleted) + ' 行，' +
          table.columns.length + '→' + (table.columns.length - trialInfo.colsDropped.length) + ' 列）'));
        runBtn.disabled = false;
      } catch (e) {
        trialInfo = null;
        impactText.textContent = e.message;
        runBtn.disabled = true;
      }
    }

    function ruleText(plans) {
      const names = { 'drop-rows': '删行', 'drop-col': '删列', 'mean': '均值填充', 'median': '中位数填充',
        'mode': '众数填充', 'ffill': '前向填充', 'bfill': '后向填充', 'fixed': '固定值填充' };
      return plans.map(function (p) {
        return '「' + p.column + '」' + names[p.strategy] + (p.strategy === 'fixed' ? '(' + p.value + ')' : '');
      }).join('；');
    }

    // 高风险判定：高缺失率列删列 或 删行占比 ≥50%（原则6）
    function findHighRisk(plans, info) {
      const risks = [];
      plans.forEach(function (p) {
        if (p.strategy === 'drop-col') {
          const o = overview.filter(function (x) { return x.column === p.column; })[0];
          if (o && o.rate >= 0.3) {
            risks.push('列「' + p.column + '」缺失率 ' + Math.round(o.rate * 100) + '%，删列属于高缺失率列删除');
          }
        }
      });
      if (info.rowsDeleted > 0 && info.rowsDeleted / table.rows.length >= 0.5) {
        risks.push('将删除 ' + info.rowsDeleted + ' 行，占全部数据 ' +
          Math.round(info.rowsDeleted / table.rows.length * 100) + '%（≥50%）');
      }
      return risks;
    }

    function doRun() {
      const plans = buildPlans();
      if (!plans.length || !trialInfo) return;
      const risks = findHighRisk(plans, trialInfo);
      const rule = ruleText(plans);

      function exec(t) { return C.applyMissing(t, plans); }

      if (!risks.length) {
        ctx.runStep({ module: '缺失值', rule: rule, exec: exec });
        return;
      }
      // 高风险 → 弹窗确认（原则6）
      const bodyEl = dom.el('div', {},
        dom.el('div', { class: 'notice danger', text: '本次操作包含高风险项：' }),
        dom.el('ul', {}, risks.map(function (r) { return dom.el('li', { text: r }); })),
        dom.el('div', { class: 'muted', text: '执行后将 ' +
          (trialInfo.rowsDeleted ? '删除 ' + trialInfo.rowsDeleted + ' 行；' : '') +
          (trialInfo.colsDropped.length ? '删除 ' + trialInfo.colsDropped.join('、') + ' 列；' : '') +
          '此操作不可恢复（可撤销上一步）。' })
      );
      ctx.dom.modal({
        title: '高风险操作确认',
        body: bodyEl,
        danger: true,
        okLabel: '确认执行',
        requireText: { label: '请填写处理理由（将写入日志）', placeholder: '例如：该列缺失过半，无分析价值' },
        onOk: function (values) {
          ctx.runStep({ module: '缺失值', rule: rule, note: values.text, highRisk: true, exec: exec });
        }
      });
    }

    sync();
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.missing = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
