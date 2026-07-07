// SVG 直接编辑器
// 功能：节点拖拽 / 双击内联编辑文本 / 滚轮缩放 / 拖拽平移画布 / 动态扩展画布边缘
// 增强：智能边界吸附 / 节点连接模式 / 边编辑（选中/拐点/直线曲线切换）

function findNodeId(target, svgEl) {
  let el = target;
  while (el && el !== svgEl) {
    if (el.dataset && el.dataset.nodeId) return el.dataset.nodeId;
    el = el.parentNode;
  }
  return null;
}

function findEdgeId(target, svgEl) {
  let el = target;
  while (el && el !== svgEl) {
    if (el.classList && el.classList.contains('cg-edge') && el.dataset.edgeId) return el.dataset.edgeId;
    el = el.parentNode;
  }
  return null;
}

function getViewBox(svgEl) {
  const vb = svgEl.getAttribute('viewBox') || '';
  const p = vb.split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some(isNaN)) return null;
  return { x: p[0], y: p[1], w: p[2], h: p[3] };
}

function setViewBox(svgEl, vb) {
  svgEl.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`);
}

// 屏幕坐标 → SVG 逻辑坐标
function clientToSVG(svgEl, vb, clientX, clientY) {
  const rect = svgEl.getBoundingClientRect();
  const px = (clientX - rect.left) / rect.width;
  const py = (clientY - rect.top) / rect.height;
  return { x: vb.x + px * vb.w, y: vb.y + py * vb.h };
}

// 获取节点的尺寸（兼容 dagre 节点和 Mermaid 节点）
function getNodeSize(nodeEl) {
  const rectEl = nodeEl.querySelector('rect');
  if (rectEl) {
    return {
      width: parseFloat(rectEl.getAttribute('width')) || 100,
      height: parseFloat(rectEl.getAttribute('height')) || 50
    };
  }
  const circle = nodeEl.querySelector('circle');
  if (circle) {
    const r = parseFloat(circle.getAttribute('r')) || 30;
    return { width: r * 2, height: r * 2 };
  }
  const polygon = nodeEl.querySelector('polygon');
  if (polygon) {
    try {
      const bbox = polygon.getBBox();
      if (bbox.width > 0 && bbox.height > 0) return { width: bbox.width, height: bbox.height };
    } catch (e) {}
  }
  const ellipse = nodeEl.querySelector('ellipse');
  if (ellipse) {
    const rx = parseFloat(ellipse.getAttribute('rx')) || 50;
    const ry = parseFloat(ellipse.getAttribute('ry')) || 25;
    return { width: rx * 2, height: ry * 2 };
  }
  // 后备：用整个节点的 bbox
  try {
    const bbox = nodeEl.getBBox();
    if (bbox.width > 0 && bbox.height > 0) return { width: bbox.width, height: bbox.height };
  } catch (e) {}
  return { width: 100, height: 50 };
}

// 获取节点中的文本元素和文本内容（兼容 text 和 foreignObject/span）
function getNodeText(nodeEl) {
  // 优先查找 text 元素（dagre 节点）
  const textEl = nodeEl.querySelector('text');
  if (textEl) return { el: textEl, text: textEl.textContent, type: 'text' };
  // 查找 foreignObject 中的 span（Mermaid 10.x 节点）
  const span = nodeEl.querySelector('foreignObject span') || nodeEl.querySelector('foreignObject div');
  if (span) return { el: span, text: span.textContent, type: 'foreignObject' };
  // 查找直接的 span
  const directSpan = nodeEl.querySelector('span.nodeLabel') || nodeEl.querySelector('.nodeLabel');
  if (directSpan) return { el: directSpan, text: directSpan.textContent, type: 'span' };
  return null;
}

// 获取节点位置和尺寸
function getNodeRect(nodeEl) {
  const t = nodeEl.getAttribute('transform') || '';
  const m = t.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
  const x = m ? parseFloat(m[1]) : 0;
  const y = m ? parseFloat(m[2]) : 0;
  const size = getNodeSize(nodeEl);
  return { x, y, width: size.width, height: size.height };
}

export function initSVGEditor(svg, options = {}) {
  const svgEl = svg;
  const onNodeDragCb = options.onNodeDrag || null;
  const onNodeTextEditCb = options.onNodeTextEdit || null;
  const onEdgeCreateCb = options.onEdgeCreate || null;
  const onEdgeSelectCb = options.onEdgeSelect || null;
  const onEdgeAddWaypointCb = options.onEdgeAddWaypoint || null;
  const onEdgeUpdateWaypointCb = options.onEdgeUpdateWaypoint || null;
  let enableSnap = options.enableSnap !== false;

  let scale = 1, panX = 0, panY = 0;
  let vb = getViewBox(svgEl) || { x: 0, y: 0, w: 600, h: 400 };
  const initialVB = { ...vb };

  // 状态
  let connectMode = false;
  let connectFromId = null;
  let selectedEdgeId = null;
  let editingInput = null;
  let snapGuideEl = null;

  function applyTransform() {
    setViewBox(svgEl, vb);
  }

  // ===== 滚轮缩放（以鼠标位置为中心）=====
  const onWheel = e => {
    e.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const lx = vb.x + px * vb.w;
    const ly = vb.y + py * vb.h;
    const delta = e.deltaY > 0 ? 1.15 : 0.87;
    const newW = Math.max(50, vb.w * delta);
    const newH = Math.max(40, vb.h * delta);
    vb.x = lx - px * newW;
    vb.y = ly - py * newH;
    vb.w = newW;
    vb.h = newH;
    scale = initialVB.w / vb.w;
    applyTransform();
  };
  svgEl.addEventListener('wheel', onWheel, { passive: false });

  // 统一 mousedown 处理器
  const onMouseDown = e => {
    // 正在编辑文本时，点击非 input 区域 → 先结束编辑
    if (editingInput && e.target.tagName !== 'INPUT') {
      editingInput.blur();
    }

    const target = e.target;
    const nodeId = findNodeId(target, svgEl);
    const edgeId = findEdgeId(target, svgEl);
    const isWaypoint = target.classList && target.classList.contains('cg-waypoint');

    // 连接模式：点击节点选起点/终点
    if (connectMode) {
      if (nodeId) {
        if (!connectFromId) {
          connectFromId = nodeId;
          highlightNode(nodeId, true);
        } else if (connectFromId !== nodeId) {
          if (onEdgeCreateCb) onEdgeCreateCb(connectFromId, nodeId);
          highlightNode(connectFromId, false);
          connectFromId = null;
          setConnectMode(false);
        }
      } else {
        if (connectFromId) { highlightNode(connectFromId, false); connectFromId = null; }
        setConnectMode(false);
      }
      e.preventDefault();
      return;
    }

    // 拐点拖拽
    if (isWaypoint) {
      draggingWaypoint = {
        edgeId: target.dataset.edgeId,
        wpIdx: parseInt(target.dataset.wpIdx)
      };
      svgEl.style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // 节点拖拽
    if (nodeId) {
      const nodeEl = svgEl.querySelector(`[data-node-id="${nodeId}"]`);
      if (!nodeEl) return;
      const rect = getNodeRect(nodeEl);
      draggingNode = { id: nodeId, el: nodeEl };
      dragNodeSize = { width: rect.width, height: rect.height };
      dragStartClientX = e.clientX; dragStartClientY = e.clientY;
      dragNodeOrigX = rect.x; dragNodeOrigY = rect.y;
      svgEl.style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // 边选中
    if (edgeId) {
      selectEdge(edgeId);
      if (onEdgeSelectCb) onEdgeSelectCb(edgeId);
      e.preventDefault();
      return;
    }

    // 空白处：取消选中 + 开始平移
    if (selectedEdgeId) { selectEdge(null); if (onEdgeSelectCb) onEdgeSelectCb(null); }
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    isPanning = true;
    panStartClientX = e.clientX; panStartClientY = e.clientY;
    panOrigVB = { ...vb };
    svgEl.style.cursor = 'grabbing';
    e.preventDefault();
  };
  svgEl.addEventListener('mousedown', onMouseDown);

  // ===== 状态变量（在 onMouseDown 中使用）=====
  let isPanning = false;
  let panStartClientX = 0, panStartClientY = 0;
  let panOrigVB = null;
  let draggingNode = null;
  let dragStartClientX = 0, dragStartClientY = 0;
  let dragNodeOrigX = 0, dragNodeOrigY = 0;
  let dragNodeSize = { width: 100, height: 50 };
  let draggingWaypoint = null;

  const onMouseMove = e => {
    if (isPanning) {
      const rect = svgEl.getBoundingClientRect();
      const dx = (e.clientX - panStartClientX) * (panOrigVB.w / rect.width);
      const dy = (e.clientY - panStartClientY) * (panOrigVB.h / rect.height);
      vb.x = panOrigVB.x - dx;
      vb.y = panOrigVB.y - dy;
      applyTransform();
      return;
    }
    if (draggingNode) {
      const rect = svgEl.getBoundingClientRect();
      const dx = (e.clientX - dragStartClientX) * (vb.w / rect.width);
      const dy = (e.clientY - dragStartClientY) * (vb.h / rect.height);
      let newX = dragNodeOrigX + dx;
      let newY = dragNodeOrigY + dy;
      if (enableSnap) {
        const snap = findSnapPosition(draggingNode.id, newX, newY, dragNodeSize);
        newX = snap.x;
        newY = snap.y;
        showSnapGuides(snap.guides);
      }
      draggingNode.el.setAttribute('transform', `translate(${newX},${newY})`);
      // 动态扩展 viewBox
      const margin = 40;
      let needExpand = false;
      if (newX < vb.x + margin) { vb.x = newX - margin; needExpand = true; }
      if (newY < vb.y + margin) { vb.y = newY - margin; needExpand = true; }
      if (newX + dragNodeSize.width > vb.x + vb.w - margin) { vb.w = (newX + dragNodeSize.width + margin) - vb.x; needExpand = true; }
      if (newY + dragNodeSize.height > vb.y + vb.h - margin) { vb.h = (newY + dragNodeSize.height + margin) - vb.y; needExpand = true; }
      if (needExpand) applyTransform();
      svgEl.dispatchEvent(new CustomEvent('node-moved', { detail: { id: draggingNode.id, x: newX, y: newY } }));
      return;
    }
    if (draggingWaypoint) {
      const pos = clientToSVG(svgEl, vb, e.clientX, e.clientY);
      if (onEdgeUpdateWaypointCb) {
        onEdgeUpdateWaypointCb(draggingWaypoint.edgeId, draggingWaypoint.wpIdx, pos.x, pos.y);
      }
      return;
    }
  };
  window.addEventListener('mousemove', onMouseMove);

  const onMouseUp = () => {
    if (isPanning) {
      isPanning = false;
      svgEl.style.cursor = connectMode ? 'crosshair' : '';
    }
    if (draggingNode) {
      if (onNodeDragCb) {
        const rect = getNodeRect(draggingNode.el);
        onNodeDragCb(draggingNode.id, rect.x, rect.y);
      }
      draggingNode = null;
      svgEl.style.cursor = connectMode ? 'crosshair' : '';
      hideSnapGuides();
    }
    if (draggingWaypoint) {
      draggingWaypoint = null;
      svgEl.style.cursor = '';
    }
  };
  window.addEventListener('mouseup', onMouseUp);

  // ===== 智能边界吸附 =====
  function findSnapPosition(nodeId, newX, newY, size) {
    const rect = svgEl.getBoundingClientRect();
    const threshold = 8 * (vb.w / rect.width);
    const guides = [];
    let snapX = null, snapY = null;
    const newCenterX = newX + size.width / 2;
    const newCenterY = newY + size.height / 2;
    const newRight = newX + size.width;
    const newBottom = newY + size.height;

    const otherNodes = svgEl.querySelectorAll('[data-node-id]');
    otherNodes.forEach(otherEl => {
      if (draggingNode && otherEl === draggingNode.el) return;
      const otherRect = getNodeRect(otherEl);
      const otherCenterX = otherRect.x + otherRect.width / 2;
      const otherCenterY = otherRect.y + otherRect.height / 2;
      const otherRight = otherRect.x + otherRect.width;
      const otherBottom = otherRect.y + otherRect.height;

      if (snapX === null) {
        if (Math.abs(newX - otherRect.x) < threshold) { snapX = otherRect.x; guides.push({ type: 'v', x: otherRect.x }); }
        else if (Math.abs(newCenterX - otherCenterX) < threshold) { snapX = otherCenterX - size.width / 2; guides.push({ type: 'v', x: otherCenterX }); }
        else if (Math.abs(newRight - otherRight) < threshold) { snapX = otherRight - size.width; guides.push({ type: 'v', x: otherRight }); }
      }
      if (snapY === null) {
        if (Math.abs(newY - otherRect.y) < threshold) { snapY = otherRect.y; guides.push({ type: 'h', y: otherRect.y }); }
        else if (Math.abs(newCenterY - otherCenterY) < threshold) { snapY = otherCenterY - size.height / 2; guides.push({ type: 'h', y: otherCenterY }); }
        else if (Math.abs(newBottom - otherBottom) < threshold) { snapY = otherBottom - size.height; guides.push({ type: 'h', y: otherBottom }); }
      }
    });
    return {
      x: snapX !== null ? snapX : newX,
      y: snapY !== null ? snapY : newY,
      guides
    };
  }

  function showSnapGuides(guides) {
    hideSnapGuides();
    if (!guides.length) return;
    snapGuideEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    snapGuideEl.setAttribute('class', 'cg-snap-guides');
    snapGuideEl.style.pointerEvents = 'none';
    guides.forEach(g => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      if (g.type === 'v') {
        line.setAttribute('x1', g.x); line.setAttribute('y1', vb.y);
        line.setAttribute('x2', g.x); line.setAttribute('y2', vb.y + vb.h);
      } else {
        line.setAttribute('x1', vb.x); line.setAttribute('y1', g.y);
        line.setAttribute('x2', vb.x + vb.w); line.setAttribute('y2', g.y);
      }
      line.setAttribute('stroke', '#ec4899');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '4 2');
      snapGuideEl.appendChild(line);
    });
    svgEl.appendChild(snapGuideEl);
  }
  function hideSnapGuides() {
    if (snapGuideEl) { snapGuideEl.remove(); snapGuideEl = null; }
  }

  // ===== 连接模式 =====
  function setConnectMode(on) {
    connectMode = on;
    if (!on && connectFromId) {
      highlightNode(connectFromId, false);
      connectFromId = null;
    }
    svgEl.style.cursor = on ? 'crosshair' : '';
  }
  function highlightNode(nodeId, on) {
    const el = svgEl.querySelector(`[data-node-id="${nodeId}"]`);
    if (!el) return;
    const shape = el.querySelector('rect, ellipse, polygon, path, circle');
    if (!shape) return;
    if (on) {
      if (!shape.dataset.origStroke) {
        shape.dataset.origStroke = shape.getAttribute('stroke') || '';
        shape.dataset.origStrokeWidth = shape.getAttribute('stroke-width') || '';
      }
      shape.setAttribute('stroke', '#ec4899');
      shape.setAttribute('stroke-width', '3');
    } else {
      shape.setAttribute('stroke', shape.dataset.origStroke || '');
      shape.setAttribute('stroke-width', shape.dataset.origStrokeWidth || '');
    }
  }

  // ===== 边选中 =====
  function selectEdge(edgeId) {
    svgEl.querySelectorAll('.cg-edge').forEach(el => {
      el.classList.remove('cg-edge-selected');
      const path = el.querySelector('path');
      if (path && path.dataset.origStrokeWidth) {
        path.setAttribute('stroke-width', path.dataset.origStrokeWidth);
        delete path.dataset.origStrokeWidth;
      }
    });
    svgEl.querySelectorAll('.cg-waypoint').forEach(el => el.remove());
    selectedEdgeId = edgeId;
    if (!edgeId) return;
    const edgeEl = svgEl.querySelector(`[data-edge-id="${edgeId}"]`);
    if (!edgeEl) return;
    edgeEl.classList.add('cg-edge-selected');
    const path = edgeEl.querySelector('path');
    if (path) {
      const sw = path.getAttribute('stroke-width') || '1.5';
      path.dataset.origStrokeWidth = sw;
      path.setAttribute('stroke-width', String(parseFloat(sw) + 1.5));
    }
  }

  // 双击边添加拐点
  const onDblClickEdge = e => {
    const edgeId = findEdgeId(e.target, svgEl);
    if (!edgeId) return;
    const pos = clientToSVG(svgEl, vb, e.clientX, e.clientY);
    if (onEdgeAddWaypointCb) onEdgeAddWaypointCb(edgeId, pos.x, pos.y);
    e.preventDefault();
    e.stopPropagation();
  };
  svgEl.addEventListener('dblclick', onDblClickEdge);

  // ===== 双击节点内联编辑文本（兼容 dagre text 和 Mermaid foreignObject/span）=====
  const onDblClickNode = e => {
    if (connectMode) return;
    const nodeId = findNodeId(e.target, svgEl);
    if (!nodeId) return;
    const nodeEl = svgEl.querySelector(`[data-node-id="${nodeId}"]`);
    if (!nodeEl) return;
    const textInfo = getNodeText(nodeEl);
    if (!textInfo) return;
    const size = getNodeSize(nodeEl);
    const oldText = textInfo.text;
    const textEl = textInfo.el;
    const textType = textInfo.type;

    // 隐藏原文本
    if (textEl.style) textEl.style.display = 'none';
    else if (textEl.setAttribute) textEl.setAttribute('style', 'display:none');

    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', '0');
    fo.setAttribute('y', '0');
    fo.setAttribute('width', Math.max(size.width, 60));
    fo.setAttribute('height', Math.max(size.height, 30));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldText;
    input.style.cssText = `width:100%;height:100%;border:2px solid #6366f1;border-radius:4px;text-align:center;font-size:14px;background:#fff;color:#000;outline:none;`;
    fo.appendChild(input);
    nodeEl.appendChild(fo);
    input.focus();
    input.select();
    editingInput = input;

    let finished = false;
    const finishEdit = () => {
      if (finished) return;
      finished = true;
      const newText = input.value;
      // 恢复文本显示
      if (textType === 'text') {
        textEl.textContent = newText;
        textEl.style.display = '';
      } else {
        // foreignObject/span：更新文本内容
        textEl.textContent = newText;
        if (textEl.style) textEl.style.display = '';
        else if (textEl.setAttribute) textEl.removeAttribute('style');
      }
      fo.remove();
      editingInput = null;
      if (onNodeTextEditCb && newText !== oldText) {
        onNodeTextEditCb(nodeId, newText);
      }
    };
    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = oldText; input.blur(); }
    });
    e.preventDefault();
    e.stopPropagation();
  };
  svgEl.addEventListener('dblclick', onDblClickNode);

  return {
    destroy() {
      svgEl.removeEventListener('wheel', onWheel);
      svgEl.removeEventListener('mousedown', onMouseDown);
      svgEl.removeEventListener('dblclick', onDblClickNode);
      svgEl.removeEventListener('dblclick', onDblClickEdge);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      hideSnapGuides();
    },
    resetView() {
      vb = { ...initialVB };
      scale = 1; panX = 0; panY = 0;
      applyTransform();
    },
    getTransform() { return { scale, panX, panY, viewBox: { ...vb } }; },
    fitTo(vbNew) { vb = { ...vbNew }; applyTransform(); },
    setConnectMode(on) { setConnectMode(on); },
    isConnectMode() { return connectMode; },
    setSnap(on) { enableSnap = on; },
    clearSelection() {
      if (selectedEdgeId) selectEdge(null);
      if (connectFromId) { highlightNode(connectFromId, false); connectFromId = null; }
    },
    showWaypoints(edgeId, points) {
      svgEl.querySelectorAll('.cg-waypoint').forEach(el => el.remove());
      if (!points || points.length < 2) return;
      const mid = points.slice(1, -1);
      mid.forEach((p, i) => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', p.x);
        circle.setAttribute('cy', p.y);
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', '#fff');
        circle.setAttribute('stroke', '#6366f1');
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('class', 'cg-waypoint');
        circle.dataset.edgeId = edgeId;
        circle.dataset.wpIdx = String(i + 1);
        circle.style.cursor = 'move';
        svgEl.appendChild(circle);
      });
    },
    clearWaypoints() {
      svgEl.querySelectorAll('.cg-waypoint').forEach(el => el.remove());
    },
    tagEdges() {
      const edges = svgEl.querySelectorAll('.cg-edge');
      edges.forEach((el, i) => { el.dataset.edgeId = String(i); });
    }
  };
}

// 给 SVG 中的节点和边标记 data 属性
export function tagNodes(svg, layout) {
  const nodes = svg.querySelectorAll('.cg-node');
  nodes.forEach((el, i) => {
    const node = (layout.nodes || [])[i];
    if (node) el.dataset.nodeId = node.id;
  });
  const edges = svg.querySelectorAll('.cg-edge');
  edges.forEach((el, i) => { el.dataset.edgeId = String(i); });
}
