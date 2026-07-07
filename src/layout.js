// 布局引擎：dagre 几何布局 + 约束求解器微调 + DSL→Mermaid 转换
// dagre 通过 CDN UMD 全局加载（window.dagre）
// 对齐第二版 §自动布局引擎 + §约束求解

import { CONFIG } from './config.js';
import { applyConstraints } from './constraint.js';

// 估算节点尺寸（根据文本长度与组件类型）
function estimateNodeSize(text, component) {
  const len = (text || '').length;
  // 圆形/菱形/分子需要更紧凑的方形
  const isSquare = ['circle', 'diamond', 'molecule', 'hexagon'].includes(component);
  const baseW = Math.max(isSquare ? 80 : 80, len * 16 + 32);
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
    const { width, height } = estimateNodeSize(n.text || n.label, n.component);
    g.setNode(n.id, { width, height, label: n.text || n.label });
  });
  (dsl.edges || []).forEach(e => {
    g.setEdge(e.from, e.to);
  });

  dagre.layout(g);

  const nodes = g.nodes().map(id => {
    const node = g.node(id);
    return {
      id,
      x: node.x - node.width / 2,
      y: node.y - node.height / 2,
      width: node.width,
      height: node.height,
      cx: node.x,
      cy: node.y,
      text: node.label,
      component: dsl.nodes.find(n => n.id === id)?.component || 'rect'
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

