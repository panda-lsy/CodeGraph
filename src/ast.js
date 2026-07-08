// SVG AST - 可编辑的图形抽象语法树
// 对齐第二版 §SVG AST与渲染器 - 每个节点/组/连线为可编辑对象
// 支持序列化/反序列化，未来可转 PPT/Figma 等格式

// AST 节点类型
export const AST_TYPES = {
  NODE: 'node',
  EDGE: 'edge',
  GROUP: 'group',
  CANVAS: 'canvas'
};

// 创建空 AST
export function createEmptyAST() {
  return {
    type: AST_TYPES.CANVAS,
    version: '1.0',
    style: 'Nature',
    darkMode: false,
    layout: 'flow',
    rankdir: 'TB',
    width: 0,
    height: 0,
    children: []  // node / edge / group 对象
  };
}

// 从 DSL + Layout 构建 AST
export function buildAST(dsl, layout, options = {}) {
  const ast = createEmptyAST();
  ast.style = dsl.style || 'Nature';
  ast.darkMode = !!options.darkMode;
  ast.layout = dsl.layout || 'flow';
  ast.rankdir = options.rankdir || 'TB';
  ast.width = layout.width || 0;
  ast.height = layout.height || 0;

  // 节点
  const nodeMap = new Map();
  (layout.nodes || []).forEach(n => {
    const nodeObj = {
      type: AST_TYPES.NODE,
      id: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      text: n.text,
      component: n.component || 'rect',
      textStyle: n.textStyle || null
    };
    if (n.rotation) nodeObj.rotation = n.rotation;
    if (n.hidden) nodeObj.hidden = true;
    if (n.imageSrc) { nodeObj.imageSrc = n.imageSrc; nodeObj.imageFit = n.imageFit || 'xMidYMid meet'; }
    ast.children.push(nodeObj);
    nodeMap.set(n.id, nodeObj);
  });

  // 边
  (layout.edges || []).forEach(e => {
    ast.children.push({
      type: AST_TYPES.EDGE,
      from: e.from,
      to: e.to,
      points: e.points || []
    });
  });

  // 组
  (dsl.groups || []).forEach(g => {
    ast.children.push({
      type: AST_TYPES.GROUP,
      members: g.members || [],
      label: g.label || ''
    });
  });

  // 保存约束（用于后续重新求解）
  ast.constraints = dsl.constraints || [];

  return ast;
}

// AST → DSL（反向转换，便于重新布局或导出）
export function astToDSL(ast) {
  const nodes = [];
  const edges = [];
  const groups = [];

  (ast.children || []).forEach(child => {
    if (child.type === AST_TYPES.NODE) {
      const node = {
        id: child.id,
        text: child.text,
        component: child.component || 'rect'
      };
      if (child.textStyle) node.textStyle = child.textStyle;
      if (child.rotation) node.rotation = child.rotation;
      if (child.hidden) node.hidden = true;
      if (child.imageSrc) { node.imageSrc = child.imageSrc; node.imageFit = child.imageFit || 'xMidYMid meet'; }
      nodes.push(node);
    } else if (child.type === AST_TYPES.EDGE) {
      edges.push({
        from: child.from,
        to: child.to,
        type: 'arrow',
        style: 'line'
      });
    } else if (child.type === AST_TYPES.GROUP) {
      groups.push({
        members: child.members || [],
        label: child.label
      });
    }
  });

  return {
    version: '1.0',
    layout: ast.layout || 'flow',
    style: ast.style || 'Nature',
    nodes,
    edges,
    groups,
    constraints: ast.constraints || []
  };
}

// 序列化：AST → JSON 字符串
export function serializeAST(ast) {
  return JSON.stringify(ast, null, 2);
}

// 反序列化：JSON 字符串 → AST
export function deserializeAST(json) {
  if (typeof json === 'string') {
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }
  return json;
}

// AST 节点操作（用于编辑器）
export function findNode(ast, id) {
  return (ast.children || []).find(c => c.type === AST_TYPES.NODE && c.id === id);
}

export function updateNode(ast, id, updates) {
  const node = findNode(ast, id);
  if (!node) return false;
  Object.assign(node, updates);
  return true;
}

export function moveNode(ast, id, x, y) {
  return updateNode(ast, id, { x, y });
}

export function resizeNode(ast, id, width, height) {
  return updateNode(ast, id, { width, height });
}

export function editText(ast, id, text) {
  return updateNode(ast, id, { text });
}

// 导出为简化格式（供外部系统消费）
export function exportToSimple(ast) {
  return {
    version: ast.version,
    canvas: { width: ast.width, height: ast.height, style: ast.style, darkMode: ast.darkMode },
    nodes: (ast.children || []).filter(c => c.type === AST_TYPES.NODE),
    edges: (ast.children || []).filter(c => c.type === AST_TYPES.EDGE),
    groups: (ast.children || []).filter(c => c.type === AST_TYPES.GROUP)
  };
}
