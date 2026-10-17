/* =========================================================
 * test/run.js — 极简测试运行器
 * 用法：node test/run.js
 * 自动加载 js/core/*.js 与 test/*.test.js
 * ======================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 1. 加载核心模块（挂到 globalThis.DPCore）
const coreDir = path.join(ROOT, 'js', 'core');
fs.readdirSync(coreDir).filter(f => f.endsWith('.js')).sort()
  .forEach(f => require(path.join(coreDir, f)));

// 2. 测试登记器
const tests = [];
let only = null;
global.test = function (name, fn) {
  if (only === null) only = [];
  tests.push({ name, fn });
};
global.test.skip = function (name) { tests.push({ name, fn: null, skipped: true }); };

// 3. 加载所有测试文件
const testDir = __dirname;
fs.readdirSync(testDir).filter(f => f.endsWith('.test.js')).sort()
  .forEach(f => require(path.join(testDir, f)));

// 4. 顺序执行
let pass = 0, fail = 0, skip = 0;
const failures = [];
for (const t of tests) {
  if (t.skipped || !t.fn) { skip++; console.log('  SKIP ' + t.name); continue; }
  try {
    t.fn();
    pass++;
    console.log('  PASS ' + t.name);
  } catch (e) {
    fail++;
    failures.push({ name: t.name, err: e });
    console.log('  FAIL ' + t.name + '  → ' + e.message);
  }
}

console.log('\n========== 测试结果 ==========');
console.log(`通过 ${pass} ｜ 失败 ${fail} ｜ 跳过 ${skip} ｜ 共 ${tests.length}`);
if (failures.length) {
  console.log('\n失败详情：');
  failures.forEach(f => {
    console.log('  ✗ ' + f.name);
    console.log('    ' + String(f.err.stack || f.err).split('\n').slice(0, 4).join('\n    '));
  });
  process.exit(1);
}
process.exit(0);
