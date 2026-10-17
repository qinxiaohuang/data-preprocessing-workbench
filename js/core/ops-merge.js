/* =========================================================
 * core/ops-merge.js — 多文件合并（两表 join）
 * 原则2：先诊断连接关系（1:1 / 1:N / N:1 / N:N + 匹配率），再合并
 * 依赖：table.js
 * ======================================================= */
(function (global) {
  'use strict';
  const C = new Proxy({}, { get: function (t, k) { return global.DPCore[k]; } });

  const HOWS = ['left', 'inner', 'right'];

  // 键归一化：可转数字的按数字对齐（'1' 与 1 匹配），日期按时间戳，其余按字符串
  function keyOf(v) {
    if (C.isNull(v)) return null;
    if (v instanceof Date) return 'D:' + v.getTime();
    const n = C.toNumber(v);
    if (n !== null) return 'N:' + n;
    return 'S:' + String(v);
  }

  // key -> {count, rows:[下标]}；空键不参与
  function buildIndex(table, keyIdx) {
    const map = new Map();
    let nullKeys = 0;
    table.rows.forEach(function (r, i) {
      const k = keyOf(r[keyIdx]);
      if (k === null) { nullKeys++; return; }
      if (!map.has(k)) map.set(k, { count: 0, rows: [] });
      const e = map.get(k);
      e.count++;
      e.rows.push(i);
    });
    return { map: map, nullKeys: nullKeys };
  }

  /**
   * 连接诊断（合并前必须执行）
   * @returns {type:'1:1'|'1:N'|'N:1'|'N:N', leftDup, rightDup, leftUniqKeys, rightUniqKeys,
   *           matchedLeftRows, matchRate, commonKeys, leftNullKeys, rightNullKeys,
   *           leftRows, rightRows, cartesianRisk}
   */
  function diagnoseJoin(left, right, leftKey, rightKey) {
    const li = C.colIndex(left, leftKey);
    if (li < 0) throw new Error('左表不存在列：' + leftKey);
    const ri = C.colIndex(right, rightKey);
    if (ri < 0) throw new Error('右表不存在列：' + rightKey);

    const L = buildIndex(left, li), R = buildIndex(right, ri);
    let leftDup = 0, rightDup = 0;
    L.map.forEach(function (e) { if (e.count > 1) leftDup++; });
    R.map.forEach(function (e) { if (e.count > 1) rightDup++; });

    const type = (!leftDup && !rightDup) ? '1:1' : (!leftDup && rightDup) ? '1:N' : (leftDup && !rightDup) ? 'N:1' : 'N:N';

    let matchedLeftRows = 0, commonKeys = 0;
    L.map.forEach(function (e, k) {
      if (R.map.has(k)) { commonKeys++; matchedLeftRows += e.count; }
    });

    return {
      type: type,
      leftDup: leftDup,
      rightDup: rightDup,
      leftUniqKeys: L.map.size,
      rightUniqKeys: R.map.size,
      matchedLeftRows: matchedLeftRows,
      matchRate: left.rows.length ? matchedLeftRows / left.rows.length : 0,
      commonKeys: commonKeys,
      leftNullKeys: L.nullKeys,
      rightNullKeys: R.nullKeys,
      leftRows: left.rows.length,
      rightRows: right.rows.length,
      cartesianRisk: type === 'N:N' // 原则6：N:N 属高风险，需用户确认
    };
  }

  /**
   * 执行合并
   * @param p {leftKey, rightKey, how:'left'|'inner'|'right', suffix?:同名冲突后缀，默认 '_右'}
   * @returns {table, info:{how, relation, leftRows, rightRows, outRows, matchedLeftRows,
   *                        unmatchedLeftRows, unmatchedRightRows, matchRate, renamedColumns}}
   */
  function mergeTables(left, right, p) {
    if (!HOWS.includes(p.how)) throw new Error('未知连接方式：' + p.how);
    const diag = diagnoseJoin(left, right, p.leftKey, p.rightKey);
    const suffix = p.suffix || '_右';
    const li = C.colIndex(left, p.leftKey);
    const ri = C.colIndex(right, p.rightKey);

    // 输出列：左全部 + 右（去掉右 key）；重名加后缀
    const outCols = left.columns.map(function (c) { return { name: c.name, type: c.type }; });
    const leftNames = new Set(outCols.map(function (c) { return c.name; }));
    const renamed = [];
    right.columns.forEach(function (c, i) {
      if (i === ri) return;
      let name = c.name;
      if (leftNames.has(name)) {
        name = name + suffix;
        renamed.push({ from: c.name, to: name });
        let n = 2;
        while (leftNames.has(name)) { name = c.name + suffix + n++; }
      }
      leftNames.add(name);
      outCols.push({ name: name, type: c.type });
    });
    const rightOutCount = outCols.length - left.columns.length;

    const R = buildIndex(right, ri);
    const L = buildIndex(left, li);

    function joinedCells(rightRowIdx) {
      // 右表除 key 外的单元格；null 表示未匹配
      if (rightRowIdx === null) {
        const cells = [];
        for (let j = 0; j < rightOutCount; j++) cells.push(null);
        return cells;
      }
      const cells = [];
      right.rows[rightRowIdx].forEach(function (v, j) { if (j !== ri) cells.push(v); });
      return cells;
    }

    const outRows = [];
    let unmatchedLeft = 0;
    if (p.how === 'left' || p.how === 'inner') {
      left.rows.forEach(function (lr) {
        const k = keyOf(lr[li]);
        const match = k !== null ? R.map.get(k) : null;
        if (match) {
          match.rows.forEach(function (rIdx) {
            outRows.push(lr.slice().concat(joinedCells(rIdx)));
          });
        } else {
          unmatchedLeft++;
          if (p.how === 'left') outRows.push(lr.slice().concat(joinedCells(null)));
        }
      });
    } else {
      // right：以右表为主，左未匹配补 null；key 位用右 key 值补齐
      let unmatchedRight = 0;
      right.rows.forEach(function (rr, rIdx) {
        const k = keyOf(rr[ri]);
        const match = k !== null ? L.map.get(k) : null;
        if (match) {
          match.rows.forEach(function (lIdx) {
            outRows.push(left.rows[lIdx].slice().concat(joinedCells(rIdx)));
          });
        } else {
          unmatchedRight++;
          const leftCells = left.columns.map(function (_, j) { return j === li ? rr[ri] : null; });
          outRows.push(leftCells.concat(joinedCells(rIdx)));
        }
      });
      // 统计用
      var unmatchedRightCount = unmatchedRight;
      const matched = right.rows.length - unmatchedRight;
      return {
        table: C.createTable(left.name, outCols, outRows),
        info: {
          how: p.how,
          relation: diag.type,
          leftRows: left.rows.length,
          rightRows: right.rows.length,
          outRows: outRows.length,
          matchedLeftRows: matched,
          unmatchedLeftRows: left.rows.length - matched,
          unmatchedRightRows: unmatchedRightCount,
          matchRate: diag.matchRate,
          cartesianRisk: diag.cartesianRisk,
          renamedColumns: renamed
        }
      };
    }

    return {
      table: C.createTable(left.name, outCols, outRows),
      info: {
        how: p.how,
        relation: diag.type,
        leftRows: left.rows.length,
        rightRows: right.rows.length,
        outRows: outRows.length,
        matchedLeftRows: diag.matchedLeftRows,
        unmatchedLeftRows: unmatchedLeft,
        unmatchedRightRows: null, // left/inner 不涉及
        matchRate: diag.matchRate,
        cartesianRisk: diag.cartesianRisk,
        renamedColumns: renamed
      }
    };
  }

  const api = { diagnoseJoin: diagnoseJoin, mergeTables: mergeTables };
  global.DPCore = Object.assign(global.DPCore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
