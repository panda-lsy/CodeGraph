// Drawflow 流程图编辑器集成
// 对齐第二版 §Fabric.js 实现在线SVG微调编辑功能（与 Fabric.js 编辑器并存）
// Drawflow 负责：节点拖拽 / 连线 / 端口 / 缩放 / 平移
// 自渲染 SVG 负责：最终导出（保证样式一致）
//
// Drawflow 已通过 demo/index.html 本地 vendor 引入（避免 CDN ORB 拦截）

// 从 AST 初始化 Drawflow 编辑器
export async function initDrawflow(containerEl, ast, options = {}) {
  if (!window.Drawflow) {
    throw new Error('Drawflow 未加载，请确保已引入 vendor/drawflow.min.js');
  }

  // 清空容器
  containerEl.innerHTML = '';
  const editor = new window.Drawflow(containerEl);
  editor.reroute = true; // 启用连线重路由（更美观）
  editor.reroute_fix_curvature = true;
  editor.force_first_input = false;

  // 主题
  const darkMode = ast.darkMode;
  if (darkMode) containerEl.classList.add('parent-drawflow-dark');

  editor.start();

  // 节点 id 映射：ast node id → drawflow node id
  const idMap = new Map();
  let drawflowId = 1;

  // 添加节点
  (ast.children || []).filter(c => c.type === 'node').forEach(n => {
    // 构造节点 HTML（简化展示：形状图标 + 文本）
    const html = `
      <div class="cg-df-node" data-component="${n.component || 'rect'}">
        <div class="cg-df-node-shape cg-shape-${n.component || 'rect'}"></div>
        <div class="cg-df-node-text">${escapeHTML(n.text || '')}</div>
      </div>`;
    editor.addNode(
      n.component || 'rect', // 节点类型（Drawflow 用 class 区分）
      1,  // 输入端口数
      1,  // 输出端口数
      n.x / 20, // x（Drawflow 坐标系约为 1/20）
      n.y / 20, // y
      n.component || 'rect',
      html,
      n.text || ''
    );
    idMap.set(n.id, drawflowId);
    drawflowId++;
  });

  // 添加边
  (ast.children || []).filter(c => c.type === 'edge').forEach(e => {
    const fromId = idMap.get(e.from);
    const toId = idMap.get(e.to);
    if (fromId && toId) {
      editor.addConnection(fromId, toId, 'output_1', 'input_1');
    }
  });

  return { editor, ast, idMap };
}

// 从 Drawflow 导出回 AST
export function exportFromDrawflow(drawflowCtx) {
  const { editor, ast } = drawflowCtx;
  const exported = editor.export();
  const drawflowData = exported.drawflow.Home.data;

  const newChildren = [];
  // 节点
  Object.values(drawflowData).forEach(node => {
    if (typeof node !== 'object' || !node.id) return;
    const astNode = (ast.children || []).find(c => c.type === 'node' && c.text === node.data);
    newChildren.push({
      type: 'node',
      id: astNode ? astNode.id : 'DF' + node.id,
      x: node.pos_x * 20,
      y: node.pos_y * 20,
      width: (astNode && astNode.width) || 100,
      height: (astNode && astNode.height) || 50,
      text: node.data,
      component: node.class || 'rect'
    });
  });

  // 边
  Object.values(drawflowData).forEach(node => {
    if (!node.outputs) return;
    Object.values(node.outputs).forEach(output => {
      if (!output.connections) return;
      output.connections.forEach(conn => {
        const fromNode = (ast.children || []).find(c => c.type === 'node' && c.text === node.data);
        const toNode = (ast.children || []).find(c => c.type === 'node' && c.text === drawflowData[conn.node].data);
        if (fromNode && toNode) {
          newChildren.push({
            type: 'edge',
            from: fromNode.id,
            to: toNode.id,
            points: []
          });
        }
      });
    });
  });

  // 组（保留原有）
  (ast.children || []).filter(c => c.type === 'group').forEach(g => {
    newChildren.push(g);
  });

  return {
    ...ast,
    children: newChildren
  };
}

function escapeHTML(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 销毁
export function destroyDrawflow(ctx) {
  if (ctx && ctx.editor) {
    try { ctx.editor.clearModuleSelected(); } catch (e) {}
    try { ctx.editor.removeRecursion(); } catch (e) {}
  }
}
