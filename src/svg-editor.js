// SVG 直接编辑器
// 功能：节点拖拽 / 双击内联编辑文本 / 滚轮缩放 / 拖拽平移画布 / 动态扩展画布边缘
// 增强：智能边界吸附 / 节点连接模式 / 边编辑（选中/拐点/直线曲线切换）/ 节点伸缩与旋转

// 模块级回调（initSVGEditor 内的嵌套函数需要访问）
let onNodeResizeCb = null;

// 构造节点 transform：保留原有 rotation，仅更新 translate
// rotate 中心用节点本地坐标系（translate 之后），即 width/2, height/2
function buildNodeTransform(nodeEl, x, y, w, h) {
  const rotation = nodeEl.dataset.rotation;
  if (rotation && parseFloat(rotation) !== 0) {
    return `translate(${x},${y}) rotate(${rotation},${w / 2},${h / 2})`;
  }
  return `translate(${x},${y})`;
}

// 将点绕中心旋转指定角度（度），返回新坐标
function rotatePoint(px, py, cx, cy, deg) {
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

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

// 从事件 target 向上查找所属的 group id（cg-group 元素）
function findGroupId(target, svgEl) {
  let el = target;
  while (el && el !== svgEl) {
    if (el.classList && el.classList.contains('cg-group') && el.dataset.groupId) return el.dataset.groupId;
    el = el.parentNode;
  }
  return null;
}

// 通过 id 安全查找 group 元素（避免 id 含特殊字符导致 querySelector 失败）
function findGroupElById(svgEl, groupId) {
  if (!groupId) return null;
  const groups = svgEl.querySelectorAll('.cg-group');
  for (const g of groups) {
    if (g.dataset.groupId === groupId) return g;
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
  // 优先查找 text 元素（dagre 纯文本节点）
  const textEl = nodeEl.querySelector('text');
  if (textEl) return { el: textEl, text: textEl.textContent, type: 'text' };
  // 查找 foreignObject（富文本节点或 Mermaid 节点）
  const fo = nodeEl.querySelector('foreignObject');
  if (fo) {
    // 优先使用 data-raw-text 属性（保留原始 Markdown/TeX 源码）
    const raw = fo.getAttribute('data-raw-text');
    if (raw) return { el: fo, text: decodeURIComponent(raw), type: 'foreignObject' };
    // 回退到文本内容
    const span = fo.querySelector('span') || fo.querySelector('div');
    if (span) return { el: span, text: span.textContent, type: 'foreignObject' };
  }
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
 const onNodeResizeCb = options.onNodeResize || null;
  const onGroupTextEditCb = options.onGroupTextEdit || null;
  const onGroupResizeCb = options.onGroupResize || null;
  const onGroupSelectCb = options.onGroupSelect || null;
  let enableSnap = options.enableSnap !== false;
  let panMode = false; // 手型平移模式：点击节点也平移而非拖拽

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
    if (editingInput && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      editingInput.blur();
    }

    const target = e.target;
    const nodeId = findNodeId(target, svgEl);
    const edgeId = findEdgeId(target, svgEl);
    const isWaypoint = target.classList && target.classList.contains('cg-waypoint');

    // 快捷手势：右键拖拽临时切换模式
    // - 选择模式 + 右键 → 平移画布
    // - 平移模式 + 右键 → 框选（派发事件给外部）
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      if (panMode) {
        // 平移模式下右键 → 派发 right-mouse-select 事件，由外部启动框选
        svgEl.dispatchEvent(new CustomEvent('right-mouse-select', { detail: { clientX: e.clientX, clientY: e.clientY } }));
      } else {
        // 选择模式下右键 → 临时平移画布
        isPanning = true;
        panStartClientX = e.clientX; panStartClientY = e.clientY;
        panOrigVB = { ...vb };
        svgEl.style.cursor = 'grabbing';
      }
      return;
    }

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

    // 节点拖拽（平移模式下跳过，走空白平移逻辑）
    if (nodeId && !panMode) {
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

    // group 选中 + 拖拽（点击 group 背景矩形但非节点）
    if (!nodeId && !panMode) {
      const groupId = findGroupId(target, svgEl);
      if (groupId) {
        showGroupSelection(groupId);
        // 启动 group 拖拽
        const gRect = getGroupRect(groupId);
        if (gRect) {
          draggingGroup = {
            id: groupId,
            startClientX: e.clientX, startClientY: e.clientY,
            origX: gRect.x, origY: gRect.y, origW: gRect.width, origH: gRect.height
          };
          // 记录 group 内所有成员节点的初始位置
          const memberNodes = [];
          const gEl = findGroupElById(svgEl, groupId);
          if (gEl) {
            // group 的成员通过 DOM 内的节点查找
            const allNodes = svgEl.querySelectorAll('[data-node-id]');
            allNodes.forEach(nEl => {
              const nr = getNodeRect(nEl);
              if (nr.x >= gRect.x - 5 && nr.y >= gRect.y - 5 &&
                  nr.x + nr.width <= gRect.x + gRect.width + 5 &&
                  nr.y + nr.height <= gRect.y + gRect.height + 5) {
                memberNodes.push({ id: nEl.dataset.nodeId, el: nEl, origX: nr.x, origY: nr.y });
              }
            });
          }
          draggingGroup.members = memberNodes;
          svgEl.style.cursor = 'grabbing';
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    // 边选中
    if (edgeId) {
      selectEdge(edgeId);
      if (onEdgeSelectCb) onEdgeSelectCb(edgeId);
      e.preventDefault();
      return;
    }

    // 空白处：取消选中 + 开始平移（仅 pan 模式；select 模式交由外部框选逻辑处理）
    if (selectedEdgeId) { selectEdge(null); if (onEdgeSelectCb) onEdgeSelectCb(null); }
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (!panMode) return; // 选择/框选模式：画布静止
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
  let draggingGroup = null; // {id, startClientX/Y, origX/Y/W/H, members:[{id,el,origX,origY}]}

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
    if (resizing) {
      updateResize(e);
      return;
    }
    if (groupResizing) {
      updateGroupResize(e);
      return;
    }
    if (rotating) {
      updateRotation(e);
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
      draggingNode.el.setAttribute('transform', buildNodeTransform(draggingNode.el, newX, newY, dragNodeSize.width, dragNodeSize.height));
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
    if (draggingGroup) {
      const rect = svgEl.getBoundingClientRect();
      const dx = (e.clientX - draggingGroup.startClientX) * (vb.w / rect.width);
      const dy = (e.clientY - draggingGroup.startClientY) * (vb.h / rect.height);
      const newX = draggingGroup.origX + dx;
      const newY = draggingGroup.origY + dy;
      // 更新 group 矩形
      const gEl = findGroupElById(svgEl, draggingGroup.id);
      if (gEl) {
        const rEl = gEl.querySelector('rect');
        if (rEl) { rEl.setAttribute('x', newX); rEl.setAttribute('y', newY); }
        const lEl = gEl.querySelector('text');
        if (lEl) { lEl.setAttribute('x', newX + 8); lEl.setAttribute('y', newY + 14); }
      }
      // 更新选择框
      if (groupSelectionOverlay) {
        const box = groupSelectionOverlay.querySelector('rect:not([data-ghandle])');
        if (box) { box.setAttribute('x', newX - 2); box.setAttribute('y', newY - 2); }
        const handleEls = groupSelectionOverlay.querySelectorAll('[data-ghandle]');
        const positions = [
          { x: newX - 2, y: newY - 2 },
          { x: newX + draggingGroup.origW / 2, y: newY - 2 },
          { x: newX + draggingGroup.origW + 2, y: newY - 2 },
          { x: newX + draggingGroup.origW + 2, y: newY + draggingGroup.origH / 2 },
          { x: newX + draggingGroup.origW + 2, y: newY + draggingGroup.origH + 2 },
          { x: newX + draggingGroup.origW / 2, y: newY + draggingGroup.origH + 2 },
          { x: newX - 2, y: newY + draggingGroup.origH + 2 },
          { x: newX - 2, y: newY + draggingGroup.origH / 2 }
        ];
        handleEls.forEach((el, i) => { if (positions[i]) { el.setAttribute('x', positions[i].x - 4); el.setAttribute('y', positions[i].y - 4); } });
      }
      // 更新成员节点位置
      draggingGroup.members.forEach(m => {
        const nx = m.origX + dx, ny = m.origY + dy;
        m.el.setAttribute('transform', buildNodeTransform(m.el, nx, ny, getNodeSize(m.el).width, getNodeSize(m.el).height));
      });
      // 派发 group-moved 事件
      svgEl.dispatchEvent(new CustomEvent('group-moved', { detail: { id: draggingGroup.id, x: newX, y: newY, dx, dy, members: draggingGroup.members.map(m => ({ id: m.id, origX: m.origX, origY: m.origY })) } }));
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
    if (resizing) {
      resizing = null;
      svgEl.style.cursor = '';
      hideSnapGuides();
      // 显示对/错确认按钮（节点中心上方），等待用户确认或回滚
      if (pendingResize) {
        const cx = pendingResize.curX + pendingResize.curW / 2;
        const cy = pendingResize.curY;
        showConfirmButtons(cx, cy);
      }
    }
    if (groupResizing) {
      groupResizing = null;
      svgEl.style.cursor = '';
      // 显示对/错确认按钮（group 上方中心）
      if (pendingGroupResize) {
        const cx = pendingGroupResize.curX + pendingGroupResize.curW / 2;
        const cy = pendingGroupResize.curY;
        showGroupConfirmButtons(cx, cy);
      }
    }
    if (rotating) {
      rotating = null;
      svgEl.style.cursor = '';
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
    if (draggingGroup) {
      // group 拖拽结束：group-moved 事件已实时派发，这里只需清理
      draggingGroup = null;
      svgEl.style.cursor = '';
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

  // 拉伸吸附：被拖动的边缘对齐其他节点的边缘/中心
  function findResizeSnap(nodeId, handle, newX, newY, newW, newH) {
    const rect = svgEl.getBoundingClientRect();
    const threshold = 8 * (vb.w / rect.width);
    const guides = [];
    const result = { newX: null, newRight: null, newY: null, newBottom: null, guides };
    const newRight = newX + newW;
    const newBottom = newY + newH;
    const otherNodes = svgEl.querySelectorAll('[data-node-id]');
    otherNodes.forEach(otherEl => {
      if (otherEl.dataset.nodeId === nodeId) return;
      const o = getNodeRect(otherEl);
      const oCx = o.x + o.width / 2, oCy = o.y + o.height / 2;
      const oRight = o.x + o.width, oBottom = o.y + o.height;
      const xTargets = [o.x, oCx, oRight];
      const yTargets = [o.y, oCy, oBottom];
      // w 手柄：吸附左边
      if (handle.includes('w') && result.newX == null) {
        for (const t of xTargets) {
          if (Math.abs(newX - t) < threshold) { result.newX = t; guides.push({ type: 'v', x: t }); break; }
        }
      }
      // e 手柄：吸附右边
      if (handle.includes('e') && result.newRight == null) {
        for (const t of xTargets) {
          if (Math.abs(newRight - t) < threshold) { result.newRight = t; guides.push({ type: 'v', x: t }); break; }
        }
      }
      // n 手柄：吸附上边
      if (handle.includes('n') && result.newY == null) {
        for (const t of yTargets) {
          if (Math.abs(newY - t) < threshold) { result.newY = t; guides.push({ type: 'h', y: t }); break; }
        }
      }
      // s 手柄：吸附下边
      if (handle.includes('s') && result.newBottom == null) {
        for (const t of yTargets) {
          if (Math.abs(newBottom - t) < threshold) { result.newBottom = t; guides.push({ type: 'h', y: t }); break; }
        }
      }
    });
    return result;
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

  // ===== 节点选择框 + 调整大小手柄 + 旋转控件 =====
  let selectionOverlay = null;
  let selectedNodeIdForResize = null;
  let resizing = null; // {handle, startClientX, startClientY, origX, origY, origW, origH, nodeId}
  let rotating = null; // {nodeId, cx, cy, startAngle, origRotation}

  function showNodeSelection(nodeId) {
    hideNodeSelection();
    if (!nodeId) return;
    const nodeEl = svgEl.querySelector(`[data-node-id="${nodeId}"]`);
    if (!nodeEl) return;
    const rect = getNodeRect(nodeEl);
    selectedNodeIdForResize = nodeId;

    // 读取节点当前旋转角度（从 transform 解析）
    const tr = nodeEl.getAttribute('transform') || '';
    let rotation = 0;
    const rotMatch = tr.match(/rotate\(([-\d.]+)/);
    if (rotMatch) rotation = parseFloat(rotMatch[1]);

    selectionOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    selectionOverlay.setAttribute('class', 'cg-selection');
    selectionOverlay.style.pointerEvents = 'auto';

    // 如果有旋转，选择框需要跟着旋转
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    if (rotation !== 0) {
      selectionOverlay.setAttribute('transform', `rotate(${rotation},${cx},${cy})`);
    }

    // 选择框（虚线矩形）
    const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    box.setAttribute('x', rect.x - 2);
    box.setAttribute('y', rect.y - 2);
    box.setAttribute('width', rect.width + 4);
    box.setAttribute('height', rect.height + 4);
    box.setAttribute('fill', 'none');
    box.setAttribute('stroke', '#6366f1');
    box.setAttribute('stroke-width', '1.5');
    box.setAttribute('stroke-dasharray', '4 3');
    box.style.pointerEvents = 'none';
    selectionOverlay.appendChild(box);

    // 旋转控件：节点上方 20px 处的圆点 + 连线
    const rotLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rotLine.setAttribute('x1', rect.x + rect.width / 2);
    rotLine.setAttribute('y1', rect.y - 2);
    rotLine.setAttribute('x2', rect.x + rect.width / 2);
    rotLine.setAttribute('y2', rect.y - 20);
    rotLine.setAttribute('stroke', '#6366f1');
    rotLine.setAttribute('stroke-width', '1.5');
    rotLine.style.pointerEvents = 'none';
    selectionOverlay.appendChild(rotLine);

    const rotHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rotHandle.setAttribute('cx', rect.x + rect.width / 2);
    rotHandle.setAttribute('cy', rect.y - 20);
    rotHandle.setAttribute('r', 6);
    rotHandle.setAttribute('fill', '#fff');
    rotHandle.setAttribute('stroke', '#6366f1');
    rotHandle.setAttribute('stroke-width', '1.5');
    rotHandle.style.cursor = 'grab';
    rotHandle.dataset.handle = 'rotate';
    rotHandle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      startRotation(rect, e);
    });
    selectionOverlay.appendChild(rotHandle);

    // 8 个调整大小手柄（四角 + 四边中点）
    const handles = [
      { name: 'nw', x: rect.x - 2, y: rect.y - 2, cursor: 'nwse-resize' },
      { name: 'n', x: rect.x + rect.width / 2, y: rect.y - 2, cursor: 'ns-resize' },
      { name: 'ne', x: rect.x + rect.width + 2, y: rect.y - 2, cursor: 'nesw-resize' },
      { name: 'e', x: rect.x + rect.width + 2, y: rect.y + rect.height / 2, cursor: 'ew-resize' },
      { name: 'se', x: rect.x + rect.width + 2, y: rect.y + rect.height + 2, cursor: 'nwse-resize' },
      { name: 's', x: rect.x + rect.width / 2, y: rect.y + rect.height + 2, cursor: 'ns-resize' },
      { name: 'sw', x: rect.x - 2, y: rect.y + rect.height + 2, cursor: 'nesw-resize' },
      { name: 'w', x: rect.x - 2, y: rect.y + rect.height / 2, cursor: 'ew-resize' }
    ];
    handles.forEach(h => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      dot.setAttribute('x', h.x - 4);
      dot.setAttribute('y', h.y - 4);
      dot.setAttribute('width', 8);
      dot.setAttribute('height', 8);
      dot.setAttribute('fill', '#fff');
      dot.setAttribute('stroke', '#6366f1');
      dot.setAttribute('stroke-width', '1.5');
      dot.setAttribute('rx', '1.5');
      dot.style.cursor = h.cursor;
      dot.dataset.handle = h.name;
      dot.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        startResize(h.name, rect, e);
      });
      selectionOverlay.appendChild(dot);
    });

    svgEl.appendChild(selectionOverlay);
  }

  function hideNodeSelection() {
    // 隐藏前先提交未确认的 resize
    commitPendingResize();
    if (selectionOverlay) { selectionOverlay.remove(); selectionOverlay = null; }
    selectedNodeIdForResize = null;
    hideGroupSelection();
  }

  // ===== group 选择框 + resize（双击编辑由 dblclick 处理）=====
  let groupSelectionOverlay = null;
  let selectedGroupId = null;
  let groupResizing = null; // {handle, startClientX, startClientY, origX, origY, origW, origH, groupId}

  // 获取 group 的矩形信息（从 SVG 元素读取）
  function getGroupRect(groupId) {
    const gEl = findGroupElById(svgEl, groupId);
    if (!gEl) return null;
    const rectEl = gEl.querySelector('rect');
    if (!rectEl) return null;
    return {
      x: parseFloat(rectEl.getAttribute('x')),
      y: parseFloat(rectEl.getAttribute('y')),
      width: parseFloat(rectEl.getAttribute('width')),
      height: parseFloat(rectEl.getAttribute('height'))
    };
  }

  function showGroupSelection(groupId) {
    hideGroupSelection();
    if (selectedEdgeId) selectEdge(null);
    const rect = getGroupRect(groupId);
    if (!rect) return;
    selectedGroupId = groupId;
    if (onGroupSelectCb) onGroupSelectCb(groupId);
    groupSelectionOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    groupSelectionOverlay.setAttribute('class', 'cg-group-selection');
    groupSelectionOverlay.style.pointerEvents = 'auto';

    // 选择框
    const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    box.setAttribute('x', rect.x - 2);
    box.setAttribute('y', rect.y - 2);
    box.setAttribute('width', rect.width + 4);
    box.setAttribute('height', rect.height + 4);
    box.setAttribute('fill', 'none');
    box.setAttribute('stroke', '#06b6d4');
    box.setAttribute('stroke-width', '1.5');
    box.setAttribute('stroke-dasharray', '5 3');
    box.style.pointerEvents = 'none';
    groupSelectionOverlay.appendChild(box);

    // 8 个 resize 手柄（青色，区别于节点的紫色）
    const handles = [
      { name: 'nw', x: rect.x - 2, y: rect.y - 2, cursor: 'nwse-resize' },
      { name: 'n', x: rect.x + rect.width / 2, y: rect.y - 2, cursor: 'ns-resize' },
      { name: 'ne', x: rect.x + rect.width + 2, y: rect.y - 2, cursor: 'nese-resize' },
      { name: 'e', x: rect.x + rect.width + 2, y: rect.y + rect.height / 2, cursor: 'ew-resize' },
      { name: 'se', x: rect.x + rect.width + 2, y: rect.y + rect.height + 2, cursor: 'nwse-resize' },
      { name: 's', x: rect.x + rect.width / 2, y: rect.y + rect.height + 2, cursor: 'ns-resize' },
      { name: 'sw', x: rect.x - 2, y: rect.y + rect.height + 2, cursor: 'nese-resize' },
      { name: 'w', x: rect.x - 2, y: rect.y + rect.height / 2, cursor: 'ew-resize' }
    ];
    handles.forEach(h => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      dot.setAttribute('x', h.x - 4);
      dot.setAttribute('y', h.y - 4);
      dot.setAttribute('width', 8);
      dot.setAttribute('height', 8);
      dot.setAttribute('fill', '#fff');
      dot.setAttribute('stroke', '#06b6d4');
      dot.setAttribute('stroke-width', '1.5');
      dot.setAttribute('rx', '1.5');
      dot.style.cursor = h.cursor;
      dot.dataset.ghandle = h.name;
      dot.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        startGroupResize(h.name, rect, e);
      });
      groupSelectionOverlay.appendChild(dot);
    });
    svgEl.appendChild(groupSelectionOverlay);
  }

  function hideGroupSelection() {
    if (groupSelectionOverlay) { groupSelectionOverlay.remove(); groupSelectionOverlay = null; }
    selectedGroupId = null;
    groupResizing = null;
  }

  function startGroupResize(handle, rect, e) {
    // 先提交前一次未确认的 group resize（如果有）
    commitPendingGroupResize();
    // 从 DOM 重新读取 group 当前尺寸
    const curRect = getGroupRect(selectedGroupId) || rect;
    rect = curRect;
    svgEl.dispatchEvent(new CustomEvent('node-interaction-start', { detail: { id: selectedGroupId } }));
    groupResizing = {
      handle,
      startClientX: e.clientX, startClientY: e.clientY,
      origX: rect.x, origY: rect.y,
      origW: rect.width, origH: rect.height,
      groupId: selectedGroupId,
      initX: rect.x, initY: rect.y, initW: rect.width, initH: rect.height
    };
    svgEl.style.cursor = 'grabbing';
  }

  function updateGroupResize(e) {
    if (!groupResizing) return;
    const rect = svgEl.getBoundingClientRect();
    const dx = (e.clientX - groupResizing.startClientX) * (vb.w / rect.width);
    const dy = (e.clientY - groupResizing.startClientY) * (vb.h / rect.height);
    let { origX, origY, origW, origH } = groupResizing;
    let newX = origX, newY = origY, newW = origW, newH = origH;
    const h = groupResizing.handle;
    const minSize = 40;
    if (h.includes('w')) { newW = Math.max(minSize, origW - dx); newX = origX + (origW - newW); }
    if (h.includes('e')) { newW = Math.max(minSize, origW + dx); }
    if (h.includes('n')) { newH = Math.max(minSize, origH - dy); newY = origY + (origH - newH); }
    if (h.includes('s')) { newH = Math.max(minSize, origH + dy); }
    // 更新 SVG 中的 group 矩形（不立即派发事件，等用户确认）
    const gEl = findGroupElById(svgEl, groupResizing.groupId);
    if (gEl) {
      const rectEl = gEl.querySelector('rect');
      if (rectEl) {
        rectEl.setAttribute('x', newX);
        rectEl.setAttribute('y', newY);
        rectEl.setAttribute('width', newW);
        rectEl.setAttribute('height', newH);
      }
      // label 位置随左上角移动
      const labelEl = gEl.querySelector('text');
      if (labelEl) {
        labelEl.setAttribute('x', newX + 8);
        labelEl.setAttribute('y', newY + 14);
      }
    }
    // 更新选择框 + 手柄
    if (groupSelectionOverlay) {
      const box = groupSelectionOverlay.querySelector('rect:not([data-ghandle])');
      if (box) {
        box.setAttribute('x', newX - 2);
        box.setAttribute('y', newY - 2);
        box.setAttribute('width', newW + 4);
        box.setAttribute('height', newH + 4);
      }
      const handleEls = groupSelectionOverlay.querySelectorAll('[data-ghandle]');
      const positions = [
        { x: newX - 2, y: newY - 2 },
        { x: newX + newW / 2, y: newY - 2 },
        { x: newX + newW + 2, y: newY - 2 },
        { x: newX + newW + 2, y: newY + newH / 2 },
        { x: newX + newW + 2, y: newY + newH + 2 },
        { x: newX + newW / 2, y: newY + newH + 2 },
        { x: newX - 2, y: newY + newH + 2 },
        { x: newX - 2, y: newY + newH / 2 }
      ];
      handleEls.forEach((el, i) => {
        if (positions[i]) {
          el.setAttribute('x', positions[i].x - 4);
          el.setAttribute('y', positions[i].y - 4);
        }
      });
    }
    // 记录 pending 状态（不立即派发事件）
    pendingGroupResize = {
      groupId: groupResizing.groupId,
      curX: newX, curY: newY, curW: newW, curH: newH,
      initX: groupResizing.initX, initY: groupResizing.initY, initW: groupResizing.initW, initH: groupResizing.initH
    };
  }

  // pending group resize 状态
  let pendingGroupResize = null;
  let groupConfirmButtons = null;

  function commitPendingGroupResize() {
    if (!pendingGroupResize) return;
    const { groupId, curX, curY, curW, curH } = pendingGroupResize;
    svgEl.dispatchEvent(new CustomEvent('group-resized', { detail: { id: groupId, x: curX, y: curY, width: curW, height: curH } }));
    if (onGroupResizeCb) onGroupResizeCb(groupId, curX, curY, curW, curH);
    pendingGroupResize = null;
    removeGroupConfirmButtons();
  }

  function rollbackPendingGroupResize() {
    if (!pendingGroupResize) return;
    const { groupId, initX, initY, initW, initH } = pendingGroupResize;
    const gEl = findGroupElById(svgEl, groupId);
    if (gEl) {
      const rectEl = gEl.querySelector('rect');
      if (rectEl) {
        rectEl.setAttribute('x', initX);
        rectEl.setAttribute('y', initY);
        rectEl.setAttribute('width', initW);
        rectEl.setAttribute('height', initH);
      }
      const labelEl = gEl.querySelector('text');
      if (labelEl) {
        labelEl.setAttribute('x', initX + 8);
        labelEl.setAttribute('y', initY + 14);
      }
    }
    pendingGroupResize = null;
    removeGroupConfirmButtons();
    if (groupSelectionOverlay) hideGroupSelection();
  }

  function removeGroupConfirmButtons() {
    if (groupConfirmButtons) { groupConfirmButtons.remove(); groupConfirmButtons = null; }
  }

  function showGroupConfirmButtons(cx, cy) {
    removeGroupConfirmButtons();
    if (!groupSelectionOverlay) return;
    groupConfirmButtons = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    groupConfirmButtons.setAttribute('class', 'cg-group-confirm-btns');
    groupConfirmButtons.style.pointerEvents = 'auto';
    const okBtn = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    okBtn.setAttribute('cx', cx + 14); okBtn.setAttribute('cy', cy - 14); okBtn.setAttribute('r', 9);
    okBtn.setAttribute('fill', '#22c55e'); okBtn.setAttribute('stroke', '#fff'); okBtn.setAttribute('stroke-width', '1.5');
    okBtn.style.cursor = 'pointer';
    const okText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    okText.setAttribute('x', cx + 14); okText.setAttribute('y', cy - 10);
    okText.setAttribute('text-anchor', 'middle'); okText.setAttribute('font-size', '12'); okText.setAttribute('fill', '#fff');
    okText.textContent = '✓';
    okBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); commitPendingGroupResize(); });
    const cancelBtn = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    cancelBtn.setAttribute('cx', cx - 14); cancelBtn.setAttribute('cy', cy - 14); cancelBtn.setAttribute('r', 9);
    cancelBtn.setAttribute('fill', '#ef4444'); cancelBtn.setAttribute('stroke', '#fff'); cancelBtn.setAttribute('stroke-width', '1.5');
    cancelBtn.style.cursor = 'pointer';
    const cancelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    cancelText.setAttribute('x', cx - 14); cancelText.setAttribute('y', cy - 10);
    cancelText.setAttribute('text-anchor', 'middle'); cancelText.setAttribute('font-size', '12'); cancelText.setAttribute('fill', '#fff');
    cancelText.textContent = '✕';
    cancelBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); rollbackPendingGroupResize(); });
    groupConfirmButtons.appendChild(okBtn); groupConfirmButtons.appendChild(okText);
    groupConfirmButtons.appendChild(cancelBtn); groupConfirmButtons.appendChild(cancelText);
    groupSelectionOverlay.appendChild(groupConfirmButtons);
  }

  function startResize(handle, rect, e) {
    // 先提交前一次未确认的 resize（如果有），并从 DOM 重新读取节点当前尺寸
    commitPendingResize();
    const nodeEl = svgEl.querySelector(`[data-node-id="${selectedNodeIdForResize}"]`);
    const curRect = nodeEl ? getNodeRect(nodeEl) : rect;
    rect = curRect;
    svgEl.dispatchEvent(new CustomEvent('node-interaction-start', { detail: { id: selectedNodeIdForResize } }));
    resizing = {
      handle,
      startClientX: e.clientX, startClientY: e.clientY,
      origX: rect.x, origY: rect.y,
      origW: rect.width, origH: rect.height,
      nodeId: selectedNodeIdForResize,
      // 记录初始状态用于"叉号"回滚
      initX: rect.x, initY: rect.y, initW: rect.width, initH: rect.height
    };
    svgEl.style.cursor = 'grabbing';
  }

  function startRotation(rect, e) {
    svgEl.dispatchEvent(new CustomEvent('node-interaction-start', { detail: { id: selectedNodeIdForResize } }));
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    // 将节点中心转换为屏幕坐标
    const svgRect = svgEl.getBoundingClientRect();
    const pt = svgEl.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const ctm = svgEl.getScreenCTM();
    const screenCenter = pt.matrixTransform(ctm);
    // 计算起始角度
    const startAngle = Math.atan2(e.clientY - screenCenter.y, e.clientX - screenCenter.x);
    // 读取当前旋转角度
    const nodeEl = svgEl.querySelector(`[data-node-id="${selectedNodeIdForResize}"]`);
    const tr = nodeEl?.getAttribute('transform') || '';
    let origRotation = 0;
    const rotMatch = tr.match(/rotate\(([-\d.]+)/);
    if (rotMatch) origRotation = parseFloat(rotMatch[1]);
    rotating = { nodeId: selectedNodeIdForResize, cx, cy, startAngle, origRotation, screenCenter, nodeW: rect.width, nodeH: rect.height };
    svgEl.style.cursor = 'grabbing';
  }

  function updateRotation(e) {
    if (!rotating) return;
    const currentAngle = Math.atan2(e.clientY - rotating.screenCenter.y, e.clientX - rotating.screenCenter.x);
    let deltaDeg = (currentAngle - rotating.startAngle) * 180 / Math.PI;
    let newRotation = rotating.origRotation + deltaDeg;
    // 吸附到 15° 倍数（按住 Shift 时禁用吸附）
    if (!e.shiftKey) {
      newRotation = Math.round(newRotation / 15) * 15;
    }
    // 应用旋转到节点：translate(x,y) rotate(angle, w/2, h/2)
    // rotate 中心用节点本地坐标（translate 之后），即 width/2, height/2
    const nodeEl = svgEl.querySelector(`[data-node-id="${rotating.nodeId}"]`);
    if (nodeEl) {
      const tr = nodeEl.getAttribute('transform') || '';
      const translateMatch = tr.match(/translate\(([^)]+)\)/);
      const translateStr = translateMatch ? `translate(${translateMatch[1]})` : '';
      const w = rotating.nodeW, h = rotating.nodeH;
      nodeEl.setAttribute('transform', `${translateStr} rotate(${newRotation},${w / 2},${h / 2})`);
      nodeEl.dataset.rotation = newRotation;
    }
    // 更新选择框旋转（在世界坐标系中）
    if (selectionOverlay) {
      selectionOverlay.setAttribute('transform', `rotate(${newRotation},${rotating.cx},${rotating.cy})`);
    }
    // 派发 node-rotated 事件
    svgEl.dispatchEvent(new CustomEvent('node-rotated', { detail: { id: rotating.nodeId, rotation: newRotation } }));
  }

  function updateResize(e) {
    if (!resizing) return;
    const rect = svgEl.getBoundingClientRect();
    const dx = (e.clientX - resizing.startClientX) * (vb.w / rect.width);
    const dy = (e.clientY - resizing.startClientY) * (vb.h / rect.height);
    let { origX, origY, origW, origH } = resizing;
    let newX = origX, newY = origY, newW = origW, newH = origH;
    const h = resizing.handle;
    const minSize = 30;
    // 根据手柄方向计算新尺寸
    if (h.includes('w')) { newW = Math.max(minSize, origW - dx); newX = origX + (origW - newW); }
    if (h.includes('e')) { newW = Math.max(minSize, origW + dx); }
    if (h.includes('n')) { newH = Math.max(minSize, origH - dy); newY = origY + (origH - newH); }
    if (h.includes('s')) { newH = Math.max(minSize, origH + dy); }
    // 智能吸附：拉伸中的边缘对齐其他节点的边缘/中心
    if (enableSnap) {
      const snap = findResizeSnap(resizing.nodeId, h, newX, newY, newW, newH);
      if (snap.newX != null) { const fixedRight = newX + newW; newX = snap.newX; newW = Math.max(minSize, fixedRight - newX); }
      if (snap.newRight != null) { newW = Math.max(minSize, snap.newRight - newX); }
      if (snap.newY != null) { const fixedBottom = newY + newH; newY = snap.newY; newH = Math.max(minSize, fixedBottom - newY); }
      if (snap.newBottom != null) { newH = Math.max(minSize, snap.newBottom - newY); }
      showSnapGuides(snap.guides || []);
    }
    // 通过回调重新渲染节点内容（支持所有形状）
    if (onNodeResizeCb) {
      onNodeResizeCb(resizing.nodeId, newX, newY, newW, newH);
    } else {
      // 回退：仅更新位置（保留旋转）
      const nodeEl = svgEl.querySelector(`[data-node-id="${resizing.nodeId}"]`);
      if (nodeEl) nodeEl.setAttribute('transform', buildNodeTransform(nodeEl, newX, newY, newW, newH));
    }
    // 更新选择框和手柄位置
    updateSelectionBox(newX, newY, newW, newH);
    // 记录 pending 状态（不立即派发事件，等用户点对号确认）
    pendingResize = {
      nodeId: resizing.nodeId,
      curX: newX, curY: newY, curW: newW, curH: newH,
      initX: resizing.initX, initY: resizing.initY, initW: resizing.initW, initH: resizing.initH
    };
  }

  // pending resize 状态：拖拽中记录当前值，松开后显示对错按钮
  let pendingResize = null;
  let confirmButtons = null;

  function commitPendingResize() {
    if (!pendingResize) return;
    const { nodeId, curX, curY, curW, curH } = pendingResize;
    svgEl.dispatchEvent(new CustomEvent('node-resized', { detail: { id: nodeId, x: curX, y: curY, width: curW, height: curH } }));
    pendingResize = null;
    removeConfirmButtons();
  }

  function rollbackPendingResize() {
    if (!pendingResize) return;
    const { nodeId, initX, initY, initW, initH } = pendingResize;
    // 回滚节点到初始尺寸
    if (onNodeResizeCb) {
      onNodeResizeCb(nodeId, initX, initY, initW, initH);
    } else {
      const nodeEl = svgEl.querySelector(`[data-node-id="${nodeId}"]`);
      if (nodeEl) nodeEl.setAttribute('transform', buildNodeTransform(nodeEl, initX, initY, initW, initH));
    }
    updateSelectionBox(initX, initY, initW, initH);
    pendingResize = null;
    removeConfirmButtons();
  }

  function removeConfirmButtons() {
    if (confirmButtons) { confirmButtons.remove(); confirmButtons = null; }
  }

  function showConfirmButtons(cx, cy) {
    removeConfirmButtons();
    if (!selectionOverlay) return;
    confirmButtons = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    confirmButtons.setAttribute('class', 'cg-confirm-btns');
    confirmButtons.style.pointerEvents = 'auto';
    // 对号（绿）- 右上
    const okBtn = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    okBtn.setAttribute('cx', cx + 14);
    okBtn.setAttribute('cy', cy - 14);
    okBtn.setAttribute('r', 9);
    okBtn.setAttribute('fill', '#22c55e');
    okBtn.setAttribute('stroke', '#fff');
    okBtn.setAttribute('stroke-width', '1.5');
    okBtn.style.cursor = 'pointer';
    const okText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    okText.setAttribute('x', cx + 14); okText.setAttribute('y', cy - 10);
    okText.setAttribute('text-anchor', 'middle'); okText.setAttribute('font-size', '12');
    okText.setAttribute('fill', '#fff'); okText.textContent = '✓';
    okBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); commitPendingResize(); });
    // 叉号（红）- 左上
    const cancelBtn = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    cancelBtn.setAttribute('cx', cx - 14);
    cancelBtn.setAttribute('cy', cy - 14);
    cancelBtn.setAttribute('r', 9);
    cancelBtn.setAttribute('fill', '#ef4444');
    cancelBtn.setAttribute('stroke', '#fff');
    cancelBtn.setAttribute('stroke-width', '1.5');
    cancelBtn.style.cursor = 'pointer';
    const cancelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    cancelText.setAttribute('x', cx - 14); cancelText.setAttribute('y', cy - 10);
    cancelText.setAttribute('text-anchor', 'middle'); cancelText.setAttribute('font-size', '12');
    cancelText.setAttribute('fill', '#fff'); cancelText.textContent = '✕';
    cancelBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); rollbackPendingResize(); });
    confirmButtons.appendChild(okBtn); confirmButtons.appendChild(okText);
    confirmButtons.appendChild(cancelBtn); confirmButtons.appendChild(cancelText);
    selectionOverlay.appendChild(confirmButtons);
  }

  function updateSelectionBox(x, y, w, h) {
    if (!selectionOverlay) return;
    // 缩放后中心改变，需要更新 overlay 的 rotate 中心以保持对齐
    const cx = x + w / 2, cy = y + h / 2;
    const rotMatch = selectionOverlay.getAttribute('transform')?.match(/rotate\(([-\d.]+)/);
    if (rotMatch && parseFloat(rotMatch[1]) !== 0) {
      selectionOverlay.setAttribute('transform', `rotate(${rotMatch[1]},${cx},${cy})`);
    }
    const box = selectionOverlay.querySelector('rect');
    if (box) {
      box.setAttribute('x', x - 2);
      box.setAttribute('y', y - 2);
      box.setAttribute('width', w + 4);
      box.setAttribute('height', h + 4);
    }
    // 更新旋转控件位置
    const rotLine = selectionOverlay.querySelector('line');
    if (rotLine) {
      rotLine.setAttribute('x1', x + w / 2);
      rotLine.setAttribute('y1', y - 2);
      rotLine.setAttribute('x2', x + w / 2);
      rotLine.setAttribute('y2', y - 20);
    }
    const rotCircle = selectionOverlay.querySelector('circle[data-handle="rotate"]');
    if (rotCircle) {
      rotCircle.setAttribute('cx', x + w / 2);
      rotCircle.setAttribute('cy', y - 20);
    }
    // 更新 8 个手柄位置
    const handleEls = selectionOverlay.querySelectorAll('[data-handle]:not([data-handle="rotate"])');
    const positions = [
      { x: x - 2, y: y - 2 },
      { x: x + w / 2, y: y - 2 },
      { x: x + w + 2, y: y - 2 },
      { x: x + w + 2, y: y + h / 2 },
      { x: x + w + 2, y: y + h + 2 },
      { x: x + w / 2, y: y + h + 2 },
      { x: x - 2, y: y + h + 2 },
      { x: x - 2, y: y + h / 2 }
    ];
    handleEls.forEach((el, i) => {
      if (positions[i]) {
        el.setAttribute('x', positions[i].x - 4);
        el.setAttribute('y', positions[i].y - 4);
      }
    });
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

  // ===== 双击 group 编辑 label =====
  const onDblClickGroup = e => {
    if (connectMode) return;
    // 如果点的是节点，优先让节点编辑
    const nodeId = findNodeId(e.target, svgEl);
    if (nodeId) return;
    const groupId = findGroupId(e.target, svgEl);
    if (!groupId) return;
    // 显示边缘触点便于拉伸
    showGroupSelection(groupId);
    const gEl = findGroupElById(svgEl, groupId);
    if (!gEl) return;
    const labelEl = gEl.querySelector('text.cg-group-label');
    const rectEl = gEl.querySelector('rect');
    if (!labelEl || !rectEl) return;
    const oldText = labelEl.textContent || '';
    const x = parseFloat(rectEl.getAttribute('x'));
    const y = parseFloat(rectEl.getAttribute('y'));
    const w = parseFloat(rectEl.getAttribute('width'));
    // 隐藏原 label
    labelEl.style.display = 'none';
    // 用 foreignObject 内嵌 input 编辑
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', x);
    fo.setAttribute('y', y - 2);
    fo.setAttribute('width', Math.max(w, 120));
    fo.setAttribute('height', 22);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldText;
    input.style.cssText = `width:100%;height:100%;border:2px solid #06b6d4;border-radius:4px;font-size:11px;background:#fff;color:#000;outline:none;padding:0 4px;box-sizing:border-box;`;
    input.addEventListener('mousedown', ev => ev.stopPropagation());
    fo.appendChild(input);
    gEl.appendChild(fo);
    input.focus();
    input.select();
    let finished = false;
    const finishEdit = () => {
      if (finished) return;
      finished = true;
      const newText = input.value;
      fo.remove();
      labelEl.textContent = newText;
      labelEl.style.display = '';
      if (onGroupTextEditCb && newText !== oldText) {
        onGroupTextEditCb(groupId, newText);
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
  svgEl.addEventListener('dblclick', onDblClickGroup);

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
    const input = document.createElement('textarea');
    input.value = oldText;
    input.style.cssText = `width:100%;height:100%;border:2px solid #6366f1;border-radius:4px;text-align:center;font-size:14px;background:#fff;color:#000;outline:none;resize:none;padding:4px;box-sizing:border-box;line-height:1.3;`;
    // 阻止 mousedown 冒泡到 svgEl/demo，避免干扰光标定位
    input.addEventListener('mousedown', ev => ev.stopPropagation());
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
      fo.remove();
      editingInput = null;
      // 恢复文本显示
      if (textType === 'text') {
        textEl.textContent = newText;
        textEl.style.display = '';
      } else if (textEl.tagName && textEl.tagName.toLowerCase() === 'foreignobject') {
        // 富文本 foreignObject：恢复显示，内容由回调触发重新渲染
        if (textEl.style) textEl.style.display = '';
      } else {
        // span/div（Mermaid 节点）：更新文本内容
        textEl.textContent = newText;
        if (textEl.style) textEl.style.display = '';
        else if (textEl.setAttribute) textEl.removeAttribute('style');
      }
      if (onNodeTextEditCb && newText !== oldText) {
        onNodeTextEditCb(nodeId, newText);
      }
    };
    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); input.blur(); }
      // Shift+Space → 插入换行
      if (ev.key === ' ' && ev.shiftKey) {
        ev.preventDefault();
        const s = input.selectionStart, e = input.selectionEnd;
        input.value = input.value.slice(0, s) + '\n' + input.value.slice(e);
        input.selectionStart = input.selectionEnd = s + 1;
      }
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
      svgEl.removeEventListener('dblclick', onDblClickGroup);
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
    setPanMode(on) { panMode = !!on; svgEl.style.cursor = panMode ? 'grab' : ''; },
    clearSelection() {
      if (selectedEdgeId) selectEdge(null);
      if (connectFromId) { highlightNode(connectFromId, false); connectFromId = null; }
      hideNodeSelection();
      hideGroupSelection();
    },
    showNodeSelection(nodeId) { showNodeSelection(nodeId); },
    hideNodeSelection() { hideNodeSelection(); },
    showGroupSelection(groupId) { showGroupSelection(groupId); },
    hideGroupSelection() { hideGroupSelection(); },
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
