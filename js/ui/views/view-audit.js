/* =========================================================
 * ui/views/view-audit.js — 模块1：读取与查看（体检报告）
 * 原则1 入口：先生成体检报告，再开放其余模块
 * ======================================================= */
(function (global) {
  'use strict';

  function num(v, digits) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') {
      const r = Math.round(v * 100) / 100;
      return String(r);
    }
    return String(v);
  }

  function render(container, ctx) {
    const dom = ctx.dom, C = ctx.C;
    dom.clear(container);

    const body = dom.el('div', { class: 'view-body' });
    body.appendChild(dom.el('div', { class: 'view-title', text: '读取与查看' }));
    body.appendChild(dom.el('div', {
      class: 'view-desc',
      text: '数据体检：结构、类型、缺失、重复、分布概览。原则一：先审计，后清洗。'
    }));

    if (!ctx.state.file) {
      body.appendChild(dom.el('div', {
        class: 'notice info',
        text: '尚未加载数据。请回到首页（点顶栏工具名）上传 Excel / CSV 文件。'
      }));
      container.appendChild(body);
      return;
    }

    // 多 sheet 切换
    const names = ctx.state.file.sheetNames;
    if (names.length > 1) {
      const tabs = dom.el('div', { class: 'sheet-tabs' });
      names.forEach(function (n) {
        tabs.appendChild(dom.el('button', {
          class: 'sheet-tab' + (n === ctx.state.file.activeSheet ? ' active' : ''),
          text: n,
          type: 'button',
          on: { click: function () { ctx.switchSheet(n); } }
        }));
      });
      body.appendChild(tabs);
    }

    const sh = ctx.sheet();

    // 未体检 → 生成按钮（原则1 拦截的另一半在导航锁）
    if (!sh.auditDone || !sh.audit) {
      const card = dom.el('div', { class: 'card' });
      card.appendChild(dom.el('div', { class: 'card-title', text: '当前表尚未生成体检报告' }));
      card.appendChild(dom.el('div', {
        class: 'muted',
        text: '体检报告会统计行数、列数、重复行、每列缺失率与疑似问题。生成后才能使用其余 8 个清洗模块。'
      }));
      const row = dom.el('div', { class: 'section-gap' });
      row.appendChild(dom.el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: '生成本表体检报告',
        on: { click: function () { ctx.auditCurrent(); } }
      }));
      card.appendChild(row);
      body.appendChild(card);
      container.appendChild(body);
      return;
    }

    const audit = sh.audit;

    // 顶部指标卡
    const cards = dom.el('div', { class: 'metric-cards' });
    metricCard(cards, dom, '行数', audit.rowCount, '');
    metricCard(cards, dom, '列数', audit.colCount, '');
    metricCard(cards, dom, '重复行数', audit.duplicateRowCount, audit.duplicateRowCount > 0 ? 'warn' : '');
    metricCard(cards, dom, '总缺失单元格', audit.missingCells, audit.missingCells > 0 ? 'warn' : '');
    body.appendChild(cards);

    if (audit.duplicateRowCount > 0 || audit.missingCells > 0) {
      body.appendChild(dom.el('div', {
        class: 'notice warn',
        text: '发现可清洗项：' +
          (audit.duplicateRowCount > 0 ? '重复行 ' + audit.duplicateRowCount + ' 行；' : '') +
          (audit.missingCells > 0 ? '缺失单元格 ' + audit.missingCells + ' 个。' : '') +
          '建议按左侧导航顺序处理。'
      }));
    }

    // 列清单表
    const card = dom.el('div', { class: 'card' });
    card.appendChild(dom.el('div', { class: 'card-title' },
      '列清单',
      dom.el('span', { class: 'sub', text: '点击列名展开该列详情' })
    ));
    const wrap = dom.el('div', { class: 'table-wrap', style: { maxHeight: '520px' } });
    const t = dom.el('table', { class: 'data-table' });
    t.appendChild(dom.el('thead', {}, dom.el('tr', {},
      ['列名', '类型', '缺失数', '缺失率', '唯一值数', '疑似问题'].map(function (h) {
        return dom.el('th', { text: h });
      })
    )));
    const tbody = dom.el('tbody');
    audit.columns.forEach(function (col) { tbody.appendChild(colRow(col)); });
    t.appendChild(tbody);
    wrap.appendChild(t);
    card.appendChild(wrap);
    body.appendChild(card);
    container.appendChild(body);

    function colRow(col) {
      const tr = dom.el('tr');
      const nameTd = dom.el('td', {});
      nameTd.appendChild(dom.el('button', {
        class: 'btn-link', type: 'button', text: col.name,
        title: '点击展开/收起该列详情',
        on: { click: function () { toggleDetail(tr, col.name); } }
      }));
      tr.appendChild(nameTd);
      tr.appendChild(dom.el('td', { text: dom.typeLabel(col.type) }));
      tr.appendChild(dom.el('td', { text: String(col.missing) }));

      const barTd = dom.el('td', {});
      const pct = Math.round(col.missingRate * 100);
      const bw = dom.el('div', { class: 'bar-wrap', style: { display: 'inline-block', verticalAlign: 'middle' } });
      bw.appendChild(dom.el('div', {
        class: 'bar-fill' + (pct >= 30 ? ' danger' : pct > 0 ? ' warn' : ''),
        style: { width: (col.missing > 0 ? Math.max(pct, 2) : 0) + '%' }
      }));
      barTd.appendChild(bw);
      barTd.appendChild(dom.el('span', { class: 'small muted', text: ' ' + pct + '%' }));
      tr.appendChild(barTd);

      tr.appendChild(dom.el('td', { text: String(col.uniq) }));

      const hintTd = dom.el('td', { style: { whiteSpace: 'normal' } });
      (col.hints || []).forEach(function (h) {
        const cls = h.indexOf('异常') >= 0 ? 'tag danger'
          : (h.indexOf('建议') >= 0 || h.indexOf('适合') >= 0) ? 'tag brand' : 'tag warn';
        hintTd.appendChild(dom.el('span', { class: cls, text: h }));
      });
      tr.appendChild(hintTd);
      return tr;
    }

    function toggleDetail(tr, colName) {
      const next = tr.nextSibling;
      if (next && next.classList && next.classList.contains('detail-row')) {
        next.parentNode.removeChild(next);
        return;
      }
      const detail = C.columnDetail(ctx.pl().current, colName);
      const dtr = dom.el('tr', { class: 'detail-row' });
      const td = dom.el('td', { colspan: '6', style: { background: 'var(--bg)', whiteSpace: 'normal' } });
      td.appendChild(renderDetail(detail));
      dtr.appendChild(td);
      tr.parentNode.insertBefore(dtr, tr.nextSibling);
    }

    function renderDetail(d) {
      const box = dom.el('div', { class: 'small' });
      box.appendChild(dom.el('div', { class: 'card-title' },
        '列详情：' + d.name,
        dom.el('span', { class: 'sub', text: dom.typeLabel(d.type) + ' ｜ 缺失 ' + d.missing + ' ｜ 唯一值 ' + d.uniq })
      ));

      if (d.stats) {
        const s = d.stats;
        const grid = dom.el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 22px' } });
        [['最小值', s.min], ['下四分位 Q1', s.q1], ['中位数', s.median], ['均值', s.mean],
         ['上四分位 Q3', s.q3], ['最大值', s.max], ['标准差', s.stdev], ['有效值数', s.count]
        ].forEach(function (kv) {
          grid.appendChild(dom.el('span', { class: 'muted' }, kv[0] + '：',
            dom.el('b', { text: num(kv[1]) })));
        });
        box.appendChild(grid);
        if (d.outlier && d.outlier.indexes.length) {
          box.appendChild(dom.el('div', { class: 'notice warn', style: { marginTop: '8px', marginBottom: '0' } },
            'IQR 异常区间：[' + num(d.outlier.lower) + '，' + num(d.outlier.upper) + ']，共 ' +
            d.outlier.indexes.length + ' 个疑似异常值（可到「异常值」模块处理）'
          ));
        }
      }

      if (d.minDate || d.maxDate) {
        box.appendChild(dom.el('div', { class: 'muted' },
          '日期范围：' + (d.minDate ? C.formatDate(d.minDate) : '—') +
          ' ～ ' + (d.maxDate ? C.formatDate(d.maxDate) : '—')
        ));
      }

      if (d.top && d.top.length) {
        box.appendChild(dom.el('div', { class: 'muted', text: 'Top ' + d.top.length + ' 频次：', style: { marginTop: '6px' } }));
        const tw = dom.el('div', { class: 'table-wrap', style: { maxHeight: '220px', marginTop: '4px' } });
        const tt = dom.el('table', { class: 'data-table' });
        tt.appendChild(dom.el('thead', {}, dom.el('tr', {},
          [dom.el('th', { text: '值' }), dom.el('th', { text: '次数' })])));
        const tb = dom.el('tbody');
        d.top.forEach(function (it) {
          const s = it.raw instanceof Date ? C.formatDate(it.raw) : String(it.raw);
          tb.appendChild(dom.el('tr', {},
            dom.el('td', { text: s, title: s }),
            dom.el('td', { text: String(it.count) })
          ));
        });
        tt.appendChild(tb);
        tw.appendChild(tt);
        box.appendChild(tw);
      }
      return box;
    }
  }

  function metricCard(wrap, dom, label, value, cls) {
    wrap.appendChild(dom.el('div', { class: 'metric-card' },
      dom.el('div', { class: 'num' + (cls ? ' ' + cls : ''), text: String(value) }),
      dom.el('div', { class: 'label', text: label })
    ));
  }

  global.DPViews = global.DPViews || {};
  global.DPViews.audit = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
