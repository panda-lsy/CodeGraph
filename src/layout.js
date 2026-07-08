// 布局引擎：dagre 几何布局 + 约束求解器微调 + DSL→Mermaid 转换
// dagre 通过 CDN UMD 全局加载（window.dagre）
// 对齐第二版 §自动布局引擎 + §约束求解

import { CONFIG } from './config.js';
import { applyConstraints } from './constraint.js';
import { autoFitNodeSize } from './components.js';

// 估算节点尺寸（使用 autoFitNodeSize 精确估算文本宽度）
function estimateNodeSize(text, component, node) {
  // 图片组件：使用节点自带尺寸或默认 120×90
  if (component === 'image') {
    if (node && node.width && node.height) return { width: node.width, height: node.height };
    return { width: 120, height: 90 };
  }
  // 优先使用 autoFitNodeSize（支持多行、Markdown/TeX、字符宽度精确估算）
  if (component !== 'image' && text) {
    try {
      const size = autoFitNodeSize(text, component || 'rect', node?.textStyle, { width: 80, height: 40 });
      // 圆形/菱形等方形组件：宽高取较大值保证方形
      const isSquare = ['circle', 'diamond', 'molecule', 'hexagon'].includes(component);
      if (isSquare) {
        const m = Math.max(size.width, size.height);
        return { width: m, height: m };
      }
      return size;
    } catch (e) {}
  }
  // 后备：简单估算
  const len = (text || '').length;
  const isSquare = ['circle', 'diamond', 'molecule', 'hexagon'].includes(component);
  const baseW = Math.max(80, len * 12 + 24);
  const width = isSquare ? Math.max(baseW, 80) : baseW;
  const height = isSquare ? Math.max(width, 60) : 40;
  return { width, height };
}

// 使用 dagre 计算节点坐标与连线路径，再应用约束求解器微调
// 输入 DSL，返回 { nodes:[{id,x,y,width,height,text,component}], edges:[{from,to,points}], width, height }
export function layoutWithDagre(dsl) {
  const dagre = window.dagre;
  if (!dagre) throw new Error('dagre 未加载，请引入 dagre CDN');
  const cfg = CONFIG.layout;

  const g = new dagre.graphlib.Graph();
  // 根据 dsl.layout 类型选择 rankdir（若未在 UI 指定）
  let rankdir = cfg.rankdir;
  if (dsl.layout === 'tree') rankdir = cfg.rankdir === 'LR' ? 'LR' : 'TB';
  // layered 沿用默认

  g.setGraph({
    rankdir,
    nodesep: cfg.nodesep,
    ranksep: cfg.ranksep,
    marginx: cfg.marginx,
    marginy: cfg.marginy,
    ranker: 'tight-tree' // 紧凑分层
  });
  g.setDefaultEdgeLabel(() => ({}));

  (dsl.nodes || []).forEach(n => {
    const { width, height } = estimateNodeSize(n.text || n.label, n.component, n);
    g.setNode(n.id, { width, height, label: n.text || n.label });
  });
  (dsl.edges || []).forEach(e => {
    g.setEdge(e.from, e.to);
  });

  dagre.layout(g);

  const nodes = g.nodes().map(id => {
    const node = g.node(id);
    const dslNode = dsl.nodes.find(n => n.id === id);
    return {
      id,
      x: node.x - node.width / 2,
      y: node.y - node.height / 2,
      width: node.width,
      height: node.height,
      cx: node.x,
      cy: node.y,
      text: node.label,
      component: dslNode?.component || 'rect',
      textStyle: dslNode?.textStyle,
      rotation: dslNode?.rotation || 0,
      hidden: dslNode?.hidden || false,
      imageSrc: dslNode?.imageSrc || null,
      imageFit: dslNode?.imageFit || 'xMidYMid meet'
    };
  });

  const edges = g.edges().map(({ v, w }) => {
    const edgeObj = g.edge(v, w);
    const points = (edgeObj.points || []).map(p => ({ x: p.x, y: p.y }));
    // 保留 DSL 中边的 style（curve/line），默认 curve
    const dslEdge = (dsl.edges || []).find(e => e.from === v && e.to === w);
    const style = dslEdge?.style || 'curve';
    return { from: v, to: w, points, style };
  });

  const graph = g.graph();
  let layout = {
    nodes,
    edges,
    width: graph.width || 0,
    height: graph.height || 0
  };

  // 应用约束求解器微调
  if (cfg.applyConstraints && dsl.constraints && dsl.constraints.length) {
    layout = applyConstraints(layout, dsl);
  }

  return layout;
}

// DSL → Mermaid 文本（备选渲染通道）
// 支持 component → Mermaid 形状映射
export function dslToMermaid(dsl) {
  const dir = CONFIG.layout.rankdir === 'LR' ? 'LR' : 'TB';
  const lines = [`flowchart ${dir}`];

  // component → Mermaid 形状语法
  const shapeMap = {
    rect: (id, t) => `${id}["${t}"]`,
    rounded: (id, t) => `${id}("${t}")`,
    circle: (id, t) => `${id}(("${t}"))`,
    diamond: (id, t) => `${id}{"${t}"}`,
    hexagon: (id, t) => `${id}{{"${t}"}}`,
    cylinder: (id, t) => `${id}[("${t}")]`,
    beaker: (id, t) => `${id}["${t}"]`,
    flask: (id, t) => `${id}["${t}"]`,
    molecule: (id, t) => `${id}["${t}"]`
  };

  (dsl.nodes || []).forEach(n => {
    const text = (n.text || n.label || '').replace(/"/g, "'");
    const shape = shapeMap[n.component] || shapeMap.rect;
    lines.push(`  ${shape(n.id, text)}`);
  });

  (dsl.edges || []).forEach(e => {
    const arrow = e.style === 'curve' ? '-.->' : '-->';
    lines.push(`  ${e.from} ${arrow} ${e.to}`);
  });

  (dsl.groups || []).forEach((g, i) => {
    if (g.members && g.members.length) {
      lines.push(`  subgraph S${i}["${g.label || ''}"]`);
      g.members.forEach(m => lines.push(`    ${m}`));
      lines.push('  end');
    }
  });

  return lines.join('\n');
}

// Mermaid flowchart 代码 → DSL
// 支持：节点形状语法、边语法（--> -.-> ==> 等）、subgraph、注释 %%、方向 TB/LR
// 形状语法映射（Mermaid → component）：
//   ["text"] → rect, ("text") → rounded, (("text")) → circle,
//   {"text"} → diamond, {{"text"}} → hexagon, [("text")] → cylinder,
//   [/text\] → parallelogram, [\text/] → trapezoid, ((text)) → circle
export function mermaidToDSL(code) {
  if (!code || typeof code !== 'string') return { nodes: [], edges: [], groups: [] };
  const lines = code.split(/\n/);
  const dsl = { nodes: [], edges: [], groups: [] };
  const nodeMap = new Map(); // id → node（去重）
  let currentSubgraph = null;

  // 确保 node 存在（按 id），可选设置 text/component
  function ensureNode(id, text, component) {
    if (!nodeMap.has(id)) {
      const node = { id, text: text || id, component: component || 'rect' };
      nodeMap.set(id, node);
      dsl.nodes.push(node);
    } else if (text || component) {
      const n = nodeMap.get(id);
      if (text) n.text = text;
      if (component) n.component = component;
    }
  }

  // 解析节点定义语法：id[shape "text"] 或 id(shape "text") 等
  // 返回 {id, text, component} 或 null
  function parseNodeDef(token) {
    if (!token) return null;
    // 圆柱 [( "text" )]
    let m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\[\(\s*"((?:[^"\\]|\\.)*)"\s*\)\]$/);
    if (m) return { id: m[1], text: m[2], component: 'cylinder' };
    // 圆柱变体 (["text"]) —— 括号顺序与标准相反，Mermaid 亦兼容
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\(\[\s*"((?:[^"\\]|\\.)*)"\s*\]\)$/);
    if (m) return { id: m[1], text: m[2], component: 'cylinder' };
    // 双圆 (( "text" ))
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\(\(\s*"((?:[^"\\]|\\.)*)"\s*\)\)$/);
    if (m) return { id: m[1], text: m[2], component: 'circle' };
    // 六边形 {{ "text" }}
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\{\{\s*"((?:[^"\\]|\\.)*)"\s*\}\}$/);
    if (m) return { id: m[1], text: m[2], component: 'hexagon' };
    // 菱形 { "text" }
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\{\s*"((?:[^"\\]|\\.)*)"\s*\}$/);
    if (m) return { id: m[1], text: m[2], component: 'diamond' };
    // 圆角 ( "text" )
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\(\s*"((?:[^"\\]|\\.)*)"\s*\)$/);
    if (m) return { id: m[1], text: m[2], component: 'rounded' };
    // 矩形 [ "text" ]
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\[\s*"((?:[^"\\]|\\.)*)"\s*\]$/);
    if (m) return { id: m[1], text: m[2], component: 'rect' };
    // 平行四边形 [/ "text" \]
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\[\/\s*"((?:[^"\\]|\\.)*)"\s*\\\]$/);
    if (m) return { id: m[1], text: m[2], component: 'parallelogram' };
    // 梯形 [\ "text" /]
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\[\\\s*"((?:[^"\\]|\\.)*)"\s*\/\]$/);
    if (m) return { id: m[1], text: m[2], component: 'trapezoid' };
    // 无引号版本
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\[\(\s*([^\)]+)\s*\)\]$/);
    if (m) return { id: m[1], text: m[2], component: 'cylinder' };
    // 圆柱变体无引号 (["text"])
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\(\[\s*([^\]]+)\s*\]\)$/);
    if (m) return { id: m[1], text: m[2], component: 'cylinder' };
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\(\(\s*([^\)]+)\s*\)\)$/);
    if (m) return { id: m[1], text: m[2], component: 'circle' };
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\{\{\s*([^\}]+)\s*\}\}$/);
    if (m) return { id: m[1], text: m[2], component: 'hexagon' };
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\{\s*([^\}]+)\s*\}$/);
    if (m) return { id: m[1], text: m[2], component: 'diamond' };
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\(\s*([^\)]+)\s*\)$/);
    if (m) return { id: m[1], text: m[2], component: 'rounded' };
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\[\s*([^\]]+)\s*\]$/);
    if (m) return { id: m[1], text: m[2], component: 'rect' };
    // 纯 id（无形状）—— 不返回 text/component，避免覆盖已有节点定义
    m = token.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)$/);
    if (m) return { id: m[1], text: null, component: null };
    return null;
  }

  // 解析单行
  function parseLine(line) {
    // 去注释
    const commentIdx = line.indexOf('%%');
    if (commentIdx >= 0) line = line.slice(0, commentIdx);
    line = line.trim();
    if (!line) return;

    // 首行声明：graph/flowchart TB/LR
    const declMatch = line.match(/^(?:graph|flowchart)\s+(TB|LR|BT|RL|td)$/i);
    if (declMatch) {
      const dir = declMatch[1].toUpperCase();
      if (dir === 'LR' || dir === 'RL') CONFIG.layout.rankdir = 'LR';
      else CONFIG.layout.rankdir = 'TB';
      return;
    }

    // subgraph 开始
    // id 只匹配字母/数字/下划线/中文，避免误吞形状字符 [(" 等
    // label 支持引号包裹或裸文本：subgraph L1["输入层 / Input Layer"] 或 subgraph L1[输入层] 或 subgraph L1
    const sgMatch = line.match(/^subgraph\s+([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]|\s*\[([^\]]*)\]|\s+"([^"]*)")?\s*$/);
    if (sgMatch) {
      const label = sgMatch[2] != null ? sgMatch[2] : (sgMatch[3] != null ? sgMatch[3] : (sgMatch[4] != null ? sgMatch[4] : sgMatch[1]));
      currentSubgraph = { id: sgMatch[1], label, members: [] };
      dsl.groups.push(currentSubgraph);
      return;
    }

    // subgraph 结束
    if (/^end$/i.test(line)) { currentSubgraph = null; return; }

    // 检测是否含边箭头（支持 Mermaid 多种箭头语法 + 边标签）
    // 边标签预处理：A -->|text| B → A --> B (label)
    //               A -. text .-> B → A -.-> B (label)
    //               A -- text --> B → A --> B (label)
    let pendingLabels = [];
    let work = line
      .replace(/-->\|([^|]*)\|/g, (m, l) => { pendingLabels.push(l); return '-->'; })
      .replace(/==>\|([^|]*)\|/g, (m, l) => { pendingLabels.push(l); return '==>'; })
      .replace(/-\.\s+([^-.]+?)\s+\.->/g, (m, l) => { pendingLabels.push(l); return '-.->'; })
      .replace(/--\s+([^-]+?)\s+-->/g, (m, l) => { pendingLabels.push(l); return '-->'; })
      .replace(/<-->\|([^|]*)\|/g, (m, l) => { pendingLabels.push(l); return '<-->'; });

    // 箭头种类：双向 <-->、粗实线 ==>、虚线 -.->、实线 -->、无箭头 ---、圆点 o--o、叉 x--x、双线 ===
    const arrowRe = /<-->|==>|-->|<-\.->|-\.->|---|o--o|x--x|===|==/;
    if (arrowRe.test(work)) {
      // 用箭头分割，处理链式：A --> B --> C
      const parts = work.split(/\s*(<-->|==>|-->|<-\.->|-\.->|---|o--o|x--x|===|==)\s*/);
      if (parts.length >= 3) {
        let prevNode = null;
        let labelIdx = 0;
        for (let i = 0; i < parts.length; i += 2) {
          const token = parts[i]?.trim();
          // 箭头位于当前节点之前（连接 prevNode 与当前 node）
          const arrow = i > 0 ? parts[i - 1]?.trim() : null;
          if (!token) continue;
          const node = parseNodeDef(token);
          if (node) {
            ensureNode(node.id, node.text, node.component);
            if (prevNode && arrow) {
              // 虚线/圆点/叉/双线 → curve；其余 → line
              const style = /-\.->|o--o|x--x|===|==/.test(arrow) ? 'curve' : 'line';
              const label = pendingLabels[labelIdx++] || '';
              dsl.edges.push({ from: prevNode.id, to: node.id, label, style });
              if (currentSubgraph) {
                if (!currentSubgraph.members.includes(prevNode.id)) currentSubgraph.members.push(prevNode.id);
                if (!currentSubgraph.members.includes(node.id)) currentSubgraph.members.push(node.id);
              }
            }
            prevNode = node;
          }
        }
        return;
      }
    }

    // 节点定义
    const node = parseNodeDef(line);
    if (node) {
      ensureNode(node.id, node.text, node.component);
      if (currentSubgraph && !currentSubgraph.members.includes(node.id)) {
        currentSubgraph.members.push(node.id);
      }
    }
  }

  lines.forEach(parseLine);
  return dsl;
}

