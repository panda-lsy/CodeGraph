// Mermaid SVG 编辑器：让 Mermaid 渲染出的 SVG 也可拖拽 / 双击编辑文本
// Mermaid 生成的 SVG 节点结构：.node > [rect/polygon/circle...] + text
// 通过给每个 .node 标记 data-node-id，复用 svg-editor 的拖拽逻辑

import { initSVGEditor } from './svg-editor.js';

// 从 Mermaid SVG 中提取节点信息（id + bbox + text），用于回写 mermaid 源码
export function extractMermaidNodes(svg) {
  const nodes = [];
  const nodeEls = svg.querySelectorAll('.node');
  nodeEls.forEach((el, i) => {
    const id = el.getAttribute('id') || `node_${i}`;
    // Mermaid 节点 id 通常为 "flowchart-xxx-<n>"，提取实际逻辑 id 从 text
    const textEl = el.querySelector('text');
    const text = textEl ? textEl.textContent : '';
    const bbox = el.getBBox ? el.getBBox() : { x: 0, y: 0, width: 100, height: 40 };
    nodes.push({ id, text, x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height, el });
  });
  return nodes;
}

// 给 Mermaid SVG 节点标记 data-node-id（基于文本内容）
export function tagMermaidNodes(svg) {
  const nodes = svg.querySelectorAll('.node');
  nodes.forEach((el, i) => {
    // 兼容 text 和 foreignObject/span
    const textEl = el.querySelector('text');
    const spanEl = el.querySelector('foreignObject span') || el.querySelector('foreignObject div') || el.querySelector('.nodeLabel');
    const text = textEl ? textEl.textContent : (spanEl ? spanEl.textContent : `n${i}`);
    el.dataset.nodeId = `m_${i}`;
    el.dataset.nodeText = text;
  });
  // 给边标记 data-edge-id（Mermaid 边通常是 path.flowchart-link 或 g.edgePaths > path）
  const edges = svg.querySelectorAll('.edge path, .edgePaths path, path.flowchart-link, .flowchart-link');
  edges.forEach((el, i) => {
    const g = el.closest('g') || el;
    if (!g.classList.contains('cg-edge')) g.classList.add('cg-edge');
    g.dataset.edgeId = String(i);
  });
}

// 处理 Mermaid SVG：让 SVG 填满容器，确保 viewBox 正确
// Mermaid 默认输出 style="max-width: ...px"，导致 SVG 在容器内只占一部分，外部无法交互
export function normalizeMermaidSVG(svg) {
  // 移除 max-width 限制，设置 width/height 为 100%
  svg.removeAttribute('style');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  // 确保 preserveAspectRatio 居中
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // 如果没有 viewBox，根据内容计算
  if (!svg.getAttribute('viewBox')) {
    try {
      const bbox = svg.getBBox();
      if (bbox && bbox.width > 0 && bbox.height > 0) {
        const pad = 20;
        svg.setAttribute('viewBox',
          `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
      }
    } catch (e) {
      // getBBox 在某些情况下失败，忽略
    }
  }
  return svg;
}

// 初始化 Mermaid 编辑器（复用 svg-editor 的 pan/zoom + 节点拖拽 + 边编辑）
// options: { onNodeTextEdit, onEdgeCreate, onEdgeSelect, onEdgeAddWaypoint, onEdgeUpdateWaypoint, enableSnap }
export function initMermaidEditor(svg, options = {}) {
  normalizeMermaidSVG(svg);
  tagMermaidNodes(svg);
  const onNodeTextEdit = options.onNodeTextEdit || (() => {});

  const editor = initSVGEditor(svg, {
    enableSnap: options.enableSnap !== false,
    onNodeDrag: (nodeId, x, y) => {
      // Mermaid 拖拽仅更新视觉位置（不回写源码，避免破坏语法）
    },
    onNodeTextEdit: (nodeId, newText) => {
      const nodeEl = svg.querySelector(`[data-node-id="${nodeId}"]`);
      const oldText = nodeEl?.dataset?.nodeText || '';
      if (oldText && newText !== oldText) {
        onNodeTextEdit(nodeId, oldText, newText);
      }
    },
    onEdgeCreate: options.onEdgeCreate || null,
    onEdgeSelect: options.onEdgeSelect || null,
    onEdgeAddWaypoint: options.onEdgeAddWaypoint || null,
    onEdgeUpdateWaypoint: options.onEdgeUpdateWaypoint || null
  });

  return editor;
}

// 行级 diff（Git 风格）：对比两段文本，返回每行 { type: 'same'|'add'|'del'|'mod', oldLine?, newLine? }
export function lineDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const result = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  // 简化 LCS：逐行比对，相同则标记 same，不同则先 del 后 add
  // 适用于小段代码的近似 diff
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length) {
      if (oldLines[i] === newLines[j]) {
        result.push({ type: 'same', text: oldLines[i], oldNo: i + 1, newNo: j + 1 });
        i++; j++;
      } else {
        // 查找后续是否有匹配（向前看 3 行）
        let foundOld = -1, foundNew = -1;
        for (let k = 1; k <= 3 && i + k < oldLines.length; k++) {
          if (oldLines[i + k] === newLines[j]) { foundOld = k; break; }
        }
        for (let k = 1; k <= 3 && j + k < newLines.length; k++) {
          if (newLines[j + k] === oldLines[i]) { foundNew = k; break; }
        }
        if (foundOld >= 0 && (foundNew < 0 || foundOld <= foundNew)) {
          // old 有额外行 → 删除
          for (let k = 0; k < foundOld; k++) {
            result.push({ type: 'del', text: oldLines[i + k], oldNo: i + k + 1 });
          }
          i += foundOld;
        } else if (foundNew >= 0) {
          // new 有额外行 → 新增
          for (let k = 0; k < foundNew; k++) {
            result.push({ type: 'add', text: newLines[j + k], newNo: j + k + 1 });
          }
          j += foundNew;
        } else {
          // 直接修改
          result.push({ type: 'del', text: oldLines[i], oldNo: i + 1 });
          result.push({ type: 'add', text: newLines[j], newNo: j + 1 });
          i++; j++;
        }
      }
    } else if (i < oldLines.length) {
      result.push({ type: 'del', text: oldLines[i], oldNo: i + 1 });
      i++;
    } else {
      result.push({ type: 'add', text: newLines[j], newNo: j + 1 });
      j++;
    }
  }
  return result;
}

// 渲染 diff 为 HTML（Git 风格）
export function renderDiffHTML(diff) {
  return diff.map(line => {
    const esc = s => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    if (line.type === 'same') {
      return `<div class="diff-line same"><span class="diff-no">${line.oldNo || ''}</span><span class="diff-sign"> </span><span class="diff-text">${esc(line.text)}</span></div>`;
    } else if (line.type === 'add') {
      return `<div class="diff-line add"><span class="diff-no">${line.newNo || ''}</span><span class="diff-sign">+</span><span class="diff-text">${esc(line.text)}</span></div>`;
    } else if (line.type === 'del') {
      return `<div class="diff-line del"><span class="diff-no">${line.oldNo || ''}</span><span class="diff-sign">-</span><span class="diff-text">${esc(line.text)}</span></div>`;
    }
    return '';
  }).join('');
}
