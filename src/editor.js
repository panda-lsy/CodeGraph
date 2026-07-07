// Fabric.js 在线编辑器（增强版）
// 对齐第二版 §Fabric.js 实现在线SVG微调编辑功能
// 增强：添加/删除节点、连线、属性面板、撤销/重做
// Fabric.js 通过 demo/index.html 本地 vendor 引入（避免 CDN ORB 拦截）

function ensureFabric() {
  if (window.fabric) return Promise.resolve(window.fabric);
  return Promise.reject(new Error('Fabric.js 未加载，请确保已引入 vendor/fabric.min.js'));
}

// 主题色（根据 darkMode）
function getThemeColors(darkMode) {
  return darkMode
    ? { fill: '#1e3a5f', stroke: '#60a5fa', textColor: '#e2e8f0', edgeColor: '#94a3b8', groupStroke: '#60a5fa', bg: '#0f172a' }
    : { fill: '#afe0ff', stroke: '#3b82f6', textColor: '#0f172a', edgeColor: '#475569', groupStroke: '#3b82f6', bg: '#f8fafc' };
}

// 创建节点的 Fabric 对象
function createNodeFabric(fabric, node, colors, onDblClick) {
  const rect = new fabric.Rect({
    left: 0, top: 0,
    width: node.width, height: node.height,
    rx: 12, ry: 12,
    fill: colors.fill, stroke: colors.stroke, strokeWidth: 1.5
  });

  const text = new fabric.Text(node.text || '', {
    left: node.width / 2,
    top: node.height / 2,
    originX: 'center',
    originY: 'center',
    fontSize: 14,
    fill: colors.textColor,
    fontFamily: 'serif'
  });

  const group = new fabric.Group([rect, text], {
    left: node.x,
    top: node.y,
    hasControls: true,
    hasBorders: true,
    cornerColor: '#6366f1',
    cornerSize: 8,
    transparentCorners: false
  });

  // 自定义属性
  group.set('cgType', 'node');
  group.set('cgId', node.id);
  group.set('cgText', node.text);
  group.set('cgComponent', node.component || 'rect');

  // 双击编辑文本
  group.on('mousedblclick', () => {
    if (onDblClick) onDblClick(group);
  });

  return group;
}

// 创建边的 Fabric 对象（连线，支持曲线）
function createEdgeFabric(fabric, fromObj, toObj, colors, curve = true) {
  const fromCx = fromObj.left + fromObj.width / 2;
  const fromCy = fromObj.top + fromObj.height / 2;
  const toCx = toObj.left + toObj.width / 2;
  const toCy = toObj.top + toObj.height / 2;

  let line;
  if (curve) {
    // 三次贝塞尔曲线
    const dx = toCx - fromCx;
    const dy = toCy - fromCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const offset = Math.max(20, dist * 0.3);
    // 控制点：垂直于连线方向偏移
    const isHorizontal = Math.abs(dx) > Math.abs(dy);
    const c1x = fromCx + dx * 0.3 + (isHorizontal ? 0 : offset * 0.3);
    const c1y = fromCy + dy * 0.3 + (isHorizontal ? offset * 0.3 : 0);
    const c2x = fromCx + dx * 0.7 + (isHorizontal ? 0 : offset * 0.3);
    const c2y = fromCy + dy * 0.7 + (isHorizontal ? offset * 0.3 : 0);
    const path = `M ${fromCx} ${fromCy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toCx} ${toCy}`;
    line = new fabric.Path(path, {
      fill: '',
      stroke: colors.edgeColor,
      strokeWidth: 1.5,
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: false
    });
  } else {
    const points = [
      { x: fromCx, y: fromCy },
      { x: toCx, y: toCy }
    ];
    line = new fabric.Polyline(points, {
      fill: '',
      stroke: colors.edgeColor,
      strokeWidth: 1.5,
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: false
    });
  }
  line.set('cgType', 'edge');
  line.set('cgFrom', fromObj.cgId);
  line.set('cgTo', toObj.cgId);
  return line;
}

// 撤销/重做栈
class History {
  constructor(maxSize = 50) {
    this.stack = [];
    this.index = -1;
    this.maxSize = maxSize;
  }
  push(state) {
    // 截断 redo 部分
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(JSON.parse(JSON.stringify(state)));
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    } else {
      this.index++;
    }
  }
  undo() {
    if (this.index <= 0) return null;
    this.index--;
    return JSON.parse(JSON.stringify(this.stack[this.index]));
  }
  redo() {
    if (this.index >= this.stack.length - 1) return null;
    this.index++;
    return JSON.parse(JSON.stringify(this.stack[this.index]));
  }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }
}

// 从 AST 初始化 Fabric 画布（增强版）
export async function initEditor(canvasEl, ast, options = {}) {
  const fabric = await ensureFabric();
  const colors = getThemeColors(ast.darkMode);
  const onNodeDblClick = options.onNodeDblClick || null;

  const canvas = new fabric.Canvas(canvasEl, {
    width: Math.max((ast.width || 0) + 40, 400),
    height: Math.max((ast.height || 0) + 40, 300),
    backgroundColor: colors.bg,
    selection: true,
    preserveObjectStacking: true
  });

  const nodeMap = new Map(); // id → fabric 对象
  const edgeList = []; // { from, to, fabricObj }

  // 渲染边（先画，置底）
  (ast.children || []).filter(c => c.type === 'edge').forEach(e => {
    const from = (ast.children || []).find(n => n.type === 'node' && n.id === e.from);
    const to = (ast.children || []).find(n => n.type === 'node' && n.id === e.to);
    if (!from || !to) return;
    const fromObj = createNodeFabric(fabric, from, colors, onNodeDblClick);
    const toObj = createNodeFabric(fabric, to, colors, onNodeDblClick);
    nodeMap.set(from.id, fromObj);
    nodeMap.set(to.id, toObj);
  });

  // 先把所有节点加入
  (ast.children || []).filter(c => c.type === 'node').forEach(n => {
    if (!nodeMap.has(n.id)) {
      nodeMap.set(n.id, createNodeFabric(fabric, n, colors, onNodeDblClick));
    }
  });
  nodeMap.forEach(obj => canvas.add(obj));

  // 再画边
  (ast.children || []).filter(c => c.type === 'edge').forEach(e => {
    const fromObj = nodeMap.get(e.from);
    const toObj = nodeMap.get(e.to);
    if (!fromObj || !toObj) return;
    const line = createEdgeFabric(fabric, fromObj, toObj, colors);
    canvas.insertAt(line, 0);
    edgeList.push({ from: e.from, to: e.to, fabricObj: line });
  });

  // 渲染组
  (ast.children || []).filter(c => c.type === 'group').forEach(g => {
    const members = (g.members || []).map(id => nodeMap.get(id)).filter(Boolean);
    if (!members.length) return;
    const bounds = members.reduce((b, o) => ({
      minX: Math.min(b.minX, o.left),
      minY: Math.min(b.minY, o.top),
      maxX: Math.max(b.maxX, o.left + o.width),
      maxY: Math.max(b.maxY, o.top + o.height)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const rect = new fabric.Rect({
      left: bounds.minX - 15, top: bounds.minY - 25,
      width: bounds.maxX - bounds.minX + 30, height: bounds.maxY - bounds.minY + 40,
      rx: 8, ry: 8, fill: 'transparent', stroke: colors.groupStroke,
      strokeDashArray: [4, 3], strokeWidth: 1, opacity: 0.5,
      selectable: false, evented: false
    });
    canvas.insertAt(rect, 0);
    const label = new fabric.Text(g.label || '', {
      left: bounds.minX - 7, top: bounds.minY - 22,
      fontSize: 11, fill: colors.groupStroke, selectable: false, evented: false
    });
    canvas.insertAt(label, 1);
  });

  canvas.renderAll();

  // 历史栈
  const history = new History();
  const initialState = collectState();
  history.push(initialState);

  function collectState() {
    const nodes = [];
    nodeMap.forEach((obj, id) => {
      nodes.push({
        id, x: obj.left, y: obj.top, width: obj.width, height: obj.height,
        text: obj.cgText, component: obj.cgComponent
      });
    });
    const edges = edgeList.map(e => ({ from: e.from, to: e.to }));
    return { nodes, edges };
  }

  // 节点移动后更新相连的边（曲线重建）
  function updateEdges() {
    edgeList.forEach(e => {
      const fromObj = nodeMap.get(e.from);
      const toObj = nodeMap.get(e.to);
      if (!fromObj || !toObj || !e.fabricObj) return;
      const fromCx = fromObj.left + fromObj.width / 2;
      const fromCy = fromObj.top + fromObj.height / 2;
      const toCx = toObj.left + toObj.width / 2;
      const toCy = toObj.top + toObj.height / 2;
      // 重建曲线 path
      const dx = toCx - fromCx;
      const dy = toCy - fromCy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const offset = Math.max(20, dist * 0.3);
      const isHorizontal = Math.abs(dx) > Math.abs(dy);
      const c1x = fromCx + dx * 0.3 + (isHorizontal ? 0 : offset * 0.3);
      const c1y = fromCy + dy * 0.3 + (isHorizontal ? offset * 0.3 : 0);
      const c2x = fromCx + dx * 0.7 + (isHorizontal ? 0 : offset * 0.3);
      const c2y = fromCy + dy * 0.7 + (isHorizontal ? offset * 0.3 : 0);
      const newPath = `M ${fromCx} ${fromCy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toCx} ${toCy}`;
      e.fabricObj.set({ path: newPath });
      e.fabricObj.setCoords();
    });
    canvas.renderAll();
  }

  // 对象移动时实时更新边（拖拽过程中曲线跟随）
  canvas.on('object:moving', () => {
    updateEdges();
  });
  // 移动结束记录历史
  canvas.on('object:modified', () => {
    updateEdges();
    history.push(collectState());
  });

  // 同步 Fabric → AST
  function syncAST() {
    const state = collectState();
    (ast.children || []).forEach(child => {
      if (child.type === 'node') {
        const n = state.nodes.find(s => s.id === child.id);
        if (n) {
          child.x = n.x; child.y = n.y;
          child.width = n.width; child.height = n.height;
          child.text = n.text;
        }
      }
    });
    return ast;
  }

  // 添加节点
  function addNode(id, text, x, y, component = 'rect') {
    const newNode = { id, text, x: x || 100, y: y || 100, width: 100, height: 40, component };
    const obj = createNodeFabric(fabric, newNode, colors, onNodeDblClick);
    canvas.add(obj);
    nodeMap.set(id, obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    history.push(collectState());
    return obj;
  }

  // 删除选中对象
  function deleteSelected() {
    const active = canvas.getActiveObjects();
    active.forEach(obj => {
      if (obj.cgType === 'node') {
        // 删除节点 + 关联的边
        const id = obj.cgId;
        // 删除关联边
        for (let i = edgeList.length - 1; i >= 0; i--) {
          if (edgeList[i].from === id || edgeList[i].to === id) {
            canvas.remove(edgeList[i].fabricObj);
            edgeList.splice(i, 1);
          }
        }
        canvas.remove(obj);
        nodeMap.delete(id);
      } else if (obj.cgType === 'edge') {
        canvas.remove(obj);
        const idx = edgeList.findIndex(e => e.fabricObj === obj);
        if (idx >= 0) edgeList.splice(idx, 1);
      }
    });
    canvas.discardActiveObject();
    canvas.renderAll();
    history.push(collectState());
  }

  // 连线模式：点击两个节点创建边
  let linkMode = false;
  let linkSource = null;
  function enterLinkMode() {
    linkMode = true;
    linkSource = null;
    canvas.defaultCursor = 'crosshair';
    canvas.selection = false;
  }
  function exitLinkMode() {
    linkMode = false;
    linkSource = null;
    canvas.defaultCursor = 'default';
    canvas.selection = true;
  }
  canvas.on('mouse:down', e => {
    if (!linkMode) return;
    const obj = canvas.findTarget(e);
    if (obj && obj.cgType === 'node') {
      if (!linkSource) {
        linkSource = obj;
        obj.set('opacity', 0.6);
        canvas.renderAll();
      } else if (linkSource !== obj) {
        // 创建边
        const line = createEdgeFabric(fabric, linkSource, obj, colors);
        canvas.insertAt(line, 0);
        edgeList.push({ from: linkSource.cgId, to: obj.cgId, fabricObj: line });
        linkSource.set('opacity', 1);
        canvas.renderAll();
        history.push(collectState());
        exitLinkMode();
      }
    } else {
      if (linkSource) {
        linkSource.set('opacity', 1);
        canvas.renderAll();
      }
      exitLinkMode();
    }
  });

  // 更新节点文本
  function updateNodeText(id, text) {
    const obj = nodeMap.get(id);
    if (!obj) return;
    // Group 内第二个对象是 text
    const textObj = obj.getObjects()[1];
    if (textObj) {
      textObj.set('text', text);
      obj.set('cgText', text);
      canvas.renderAll();
      history.push(collectState());
    }
  }

  // 撤销/重做
  function applyState(state) {
    if (!state) return;
    // 简化实现：清空重建（复杂场景可做 diff，此处优先正确性）
    canvas.clear();
    canvas.backgroundColor = colors.bg;
    nodeMap.clear();
    edgeList.length = 0;

    state.nodes.forEach(n => {
      const obj = createNodeFabric(fabric, n, colors, onNodeDblClick);
      canvas.add(obj);
      nodeMap.set(n.id, obj);
    });
    state.edges.forEach(e => {
      const fromObj = nodeMap.get(e.from);
      const toObj = nodeMap.get(e.to);
      if (fromObj && toObj) {
        const line = createEdgeFabric(fabric, fromObj, toObj, colors);
        canvas.insertAt(line, 0);
        edgeList.push({ from: e.from, to: e.to, fabricObj: line });
      }
    });
    canvas.renderAll();
  }

  function undo() {
    const state = history.undo();
    if (state) applyState(state);
  }
  function redo() {
    const state = history.redo();
    if (state) applyState(state);
  }

  return {
    canvas, ast, nodeMap, edgeList,
    syncAST,
    addNode, deleteSelected, updateNodeText,
    enterLinkMode, exitLinkMode,
    undo, redo,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    isLinkMode: () => linkMode
  };
}

// 销毁编辑器
export function destroyEditor(editor) {
  if (editor && editor.canvas) {
    editor.canvas.dispose();
  }
}
