/* =========================================================
 * test/ui-shim.js — 极简 DOM 垫片（仅用于 Node 环境 UI 冒烟测试）
 * 只实现 UI 代码实际用到的最小接口，不做真实渲染与事件派发
 * ======================================================= */
'use strict';

function makeClassList(node) {
  const list = function () { return String(node.className || '').split(/\s+/).filter(Boolean); };
  const set = function (a) { node.className = a.join(' '); };
  const api = {
    add: function (n) { const a = list(); if (a.indexOf(n) < 0) { a.push(n); set(a); } },
    remove: function (n) { set(list().filter(function (x) { return x !== n; })); },
    contains: function (n) { return list().indexOf(n) >= 0; },
    toggle: function (n, force) {
      const has = list().indexOf(n) >= 0;
      const want = (force === undefined) ? !has : !!force;
      if (want) api.add(n); else api.remove(n);
      return want;
    }
  };
  return api;
}

class ShimNode {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.className = '';
    this._text = '';
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.classList = makeClassList(this);
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.selected = false;
    this.files = null;
    this.title = '';
  }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.childNodes.indexOf(this);
    return i >= 0 ? (p.childNodes[i + 1] || null) : null;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.childNodes.length = 0; }
  appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) {
    n.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; }
    return n;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener(ev, fn) {
    const a = this.listeners[ev];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  click() {
    const a = this.listeners.click || [];
    a.forEach(function (fn) { fn({ target: this, preventDefault: function () {} }); });
  }
}

const registry = new Map();
const body = new ShimNode('body');

const documentShim = {
  readyState: 'complete',
  body: body,
  createElement: function (t) { return new ShimNode(t); },
  createElementNS: function (ns, t) { return new ShimNode(t); },
  createTextNode: function (s) { const n = new ShimNode('#text'); n.textContent = String(s); return n; },
  getElementById: function (id) {
    if (!registry.has(id)) registry.set(id, new ShimNode('div'));
    return registry.get(id);
  },
  addEventListener: function () {},
  removeEventListener: function () {}
};

globalThis.document = documentShim;
globalThis.window = globalThis;

module.exports = { document: documentShim, body: body, ShimNode: ShimNode, registry: registry };
