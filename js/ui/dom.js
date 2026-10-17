/* =========================================================
 * ui/dom.js — DOM 工具（挂 global.DPDom）
 * 内容：元素创建 / 数据表渲染 / Toast / 模态确认框 / 下拉填充
 * 防 XSS：所有用户数据一律走 textContent / createTextNode
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- 列类型中文标签 ---------- */
  const TYPE_LABELS = {
    'number': '数字',
    'date': '日期',
    'boolean': '布尔',
    'string': '文本',
    'number-string': '数字(文本)',
    'date-string': '日期(文本)',
    'mixed': '混合',
    'empty': '空列'
  };

  function typeLabel(t) { return TYPE_LABELS[t] || t || ''; }

  /* ---------- 元素创建 ---------- */

  function appendChild(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { appendChild(node, c); }); return; }
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
      return;
    }
    node.appendChild(child);
  }

  // el('div', {class, text, value, checked, disabled, on:{click:fn}, style:{...}, ...attrs}, ...children)
  function el(tag, attrs) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'on') {
        Object.keys(v).forEach(function (ev) { node.addEventListener(ev, v[ev]); });
      }
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = !!v;
      else if (k === 'disabled') node.disabled = !!v;
      else if (k === 'selected') node.selected = !!v;
      else node.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) appendChild(node, arguments[i]);
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (let i = 2; i < arguments.length; i++) appendChild(node, arguments[i]);
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---------- Toast ---------- */

  let toastWrap = null;

  function toast(msg, type) {
    if (!toastWrap) {
      toastWrap = el('div', { class: 'toast-wrap' });
      document.body.appendChild(toastWrap);
    }
    const t = el('div', { class: 'toast' + (type ? ' ' + type : ''), text: String(msg) });
    toastWrap.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3500);
  }

  /* ---------- 模态框 ----------
   * modal({ title, body, okLabel, cancelLabel, danger,
   *         requireText:{label,placeholder}, requireCheck:{label},
   *         onOk(values:{text,checked}) → 返回 false 阻止关闭 })
   * 返回 close()；ESC / 取消按钮关闭。
   */
  function modal(opts) {
    opts = opts || {};
    const mask = el('div', { class: 'modal-mask' });
    const box = el('div', { class: 'modal' });
    mask.appendChild(box);
    box.appendChild(el('div', {
      class: 'modal-head' + (opts.danger ? ' danger' : ''),
      text: opts.title || '提示'
    }));

    const body = el('div', { class: 'modal-body' });
    if (opts.body !== undefined && opts.body !== null) {
      if (typeof opts.body === 'string') body.appendChild(el('div', { text: opts.body }));
      else body.appendChild(opts.body);
    }

    let textInput = null;
    if (opts.requireText) {
      const field = el('div', { class: 'field' });
      field.appendChild(el('label', { text: opts.requireText.label || '说明' }));
      textInput = el('input', { type: 'text', placeholder: opts.requireText.placeholder || '' });
      field.appendChild(textInput);
      body.appendChild(field);
    }

    let checkInput = null;
    if (opts.requireCheck) {
      const field = el('div', { class: 'field' });
      const lab = el('label', { class: 'check-line' });
      checkInput = el('input', { type: 'checkbox' });
      lab.appendChild(checkInput);
      lab.appendChild(document.createTextNode(opts.requireCheck.label || '我已确认'));
      field.appendChild(lab);
      body.appendChild(field);
    }
    box.appendChild(body);

    function close() {
      document.removeEventListener('keydown', onKey, true);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

    const foot = el('div', { class: 'modal-foot' });
    foot.appendChild(el('button', {
      class: 'btn', type: 'button', text: opts.cancelLabel || '取消',
      on: {
        click: function () {
          if (opts.onCancel && opts.onCancel() === false) return;
          close();
        }
      }
    }));
    foot.appendChild(el('button', {
      class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
      type: 'button',
      text: opts.okLabel || '确定',
      on: {
        click: function () {
          const values = {
            text: textInput ? textInput.value.trim() : '',
            checked: checkInput ? checkInput.checked : false
          };
          if (textInput && !values.text) {
            toast('请填写：' + (opts.requireText.label || '内容'), 'error');
            textInput.focus();
            return;
          }
          if (checkInput && !values.checked) {
            toast('请先勾选确认项', 'error');
            return;
          }
          if (opts.onOk && opts.onOk(values) === false) return;
          close();
        }
      }
    }));
    box.appendChild(foot);
    document.body.appendChild(mask);
    document.addEventListener('keydown', onKey, true);
    if (textInput) setTimeout(function () { textInput.focus(); }, 0);
    return close;
  }

  /* ---------- 数据表渲染 ----------
   * renderDataTable({ table, maxRows=200, highlightRows:Set(行下标), onColClick(name,idx) })
   * → .table-wrap 元素；空值显示 (空)；超出 maxRows 附说明
   */
  function cellText(v) {
    if (v instanceof Date) return C.formatDate(v);
    return String(v);
  }

  function renderDataTable(opts) {
    const table = opts.table;
    const maxRows = opts.maxRows || 200;
    const highlightRows = opts.highlightRows || null;
    const onColClick = opts.onColClick || null;

    const wrap = el('div', { class: 'table-wrap' });
    const t = el('table', { class: 'data-table' });

    const htr = el('tr');
    htr.appendChild(el('th', { text: '#', title: '行号' }));
    table.columns.forEach(function (col, ci) {
      const th = el('th', {},
        col.name,
        el('span', { class: 'col-type', text: typeLabel(col.type) })
      );
      if (onColClick) {
        th.classList.add('clickable');
        th.addEventListener('click', function () { onColClick(col.name, ci); });
      }
      htr.appendChild(th);
    });
    t.appendChild(el('thead', {}, htr));

    const tbody = el('tbody');
    const n = Math.min(table.rows.length, maxRows);
    for (let i = 0; i < n; i++) {
      const tr = el('tr');
      if (highlightRows && highlightRows.has(i)) tr.className = 'hl';
      tr.appendChild(el('td', { class: 'muted', text: String(i + 1) }));
      const row = table.rows[i];
      for (let j = 0; j < table.columns.length; j++) {
        const v = row[j];
        if (C.isNull(v)) {
          tr.appendChild(el('td', { class: 'cell-null', text: '(空)' }));
        } else {
          const s = cellText(v);
          tr.appendChild(el('td', { text: s, title: s }));
        }
      }
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    wrap.appendChild(t);

    if (table.rows.length > maxRows) {
      wrap.appendChild(el('div', {
        class: 'table-note',
        text: '共 ' + table.rows.length + ' 行 × ' + table.columns.length
          + ' 列，仅预览前 ' + maxRows + ' 行'
      }));
    }
    return wrap;
  }

  /* ---------- 列名筛选（按类型） ---------- */

  function colNames(table, types) {
    const list = [];
    table.columns.forEach(function (c) {
      if (!types || types.indexOf(c.type) >= 0) list.push(c.name);
    });
    return list;
  }

  /* ---------- 下拉填充 ---------- */

  function fillSelect(select, options, current) {
    clear(select);
    options.forEach(function (o) {
      select.appendChild(el('option', { value: o.value, text: o.label }));
    });
    if (current !== undefined && current !== null) select.value = current;
  }

  /* ---------- 导出 ---------- */
  const api = {
    TYPE_LABELS: TYPE_LABELS,
    typeLabel: typeLabel,
    el: el,
    svgEl: svgEl,
    clear: clear,
    toast: toast,
    modal: modal,
    renderDataTable: renderDataTable,
    colNames: colNames,
    fillSelect: fillSelect
  };
  global.DPDom = Object.assign(global.DPDom || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
