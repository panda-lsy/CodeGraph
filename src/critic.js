// Critic Agent - 设计评审
// 对齐第二版 §Critic Agent（设计评审）+ §性能与质量指标
// 四维评分：内容完整度 / 对齐合理度 / 视觉平衡 / 可读性
// 总分 0-100，低于阈值（默认 90）生成反馈供 Designer Agent 迭代

import { scoreConstraints } from './constraint.js';
import { validateDSL } from './dsl.js';

// 计算节点边界框中心
function center(n) {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

// 维度 1：内容完整度（0-25 分）
// 检查 DSL 节点是否有文本、边是否引用有效节点、是否有孤立节点
function scoreCompleteness(dsl) {
  let score = 25;
  const issues = [];
  const ids = new Set((dsl.nodes || []).map(n => n.id));

  // 无文本节点
  const noText = (dsl.nodes || []).filter(n => !n.text && !n.label);
  if (noText.length) {
    score -= 5 * noText.length;
    issues.push(`${noText.length} 个节点缺少文本`);
  }

  // 孤立节点（无入边也无出边）- 即使单节点也算孤立问题
  const connected = new Set();
  (dsl.edges || []).forEach(e => { connected.add(e.from); connected.add(e.to); });
  const isolated = (dsl.nodes || []).filter(n => !connected.has(n.id));
  if (isolated.length > 0) {
    // 单节点场景扣分较轻，多节点有孤立扣分重
    const penalty = (dsl.nodes || []).length === 1 ? 8 : 5 * isolated.length;
    score -= penalty;
    issues.push(`${isolated.length} 个孤立节点`);
  }

  // 边数过少（节点≥2 但无边）
  if ((dsl.nodes || []).length >= 2 && (dsl.edges || []).length === 0) {
    score -= 8;
    issues.push('多节点但无连接边');
  }

  // 校验错误
  const v = validateDSL(dsl);
  if (!v.ok) {
    score -= 10;
    issues.push(`DSL 校验错误：${v.errors.join('；')}`);
  }

  return { score: Math.max(0, score), issues };
}

// 维度 2：对齐合理度（0-25 分）
// 综合约束满足度 + 同层节点对齐度
function scoreAlignment(layout, dsl) {
  let score = 25;
  const issues = [];

  // 约束满足度（占 15 分）
  const cs = scoreConstraints(layout, dsl);
  score = Math.round(score * 0.4 + cs * 15);

  if (cs < 1) {
    issues.push(`约束满足度 ${(cs * 100).toFixed(0)}% 未达标`);
  }

  // 同 rank 节点 y 坐标一致性（dagre 分层后同层 y 接近）
  // 简化：统计 y 坐标聚类
  const ys = layout.nodes.map(n => Math.round(center(n).y / 10) * 10);
  const yGroups = {};
  ys.forEach(y => { yGroups[y] = (yGroups[y] || 0) + 1; });
  const maxGroup = Math.max(...Object.values(yGroups), 0);
  const total = layout.nodes.length;
  if (total > 1 && maxGroup / total < 0.3) {
    score -= 3;
    issues.push('节点分层不够整齐');
  }

  return { score: Math.max(0, Math.min(25, score)), issues };
}

// 维度 3：视觉平衡（0-25 分）
// 重心偏移 + 留白率 + 连线交叉
function scoreVisualBalance(layout, dsl) {
  let score = 25;
  const issues = [];

  if (!layout.nodes.length) return { score: 0, issues: ['无节点'] };

  // 重心偏移（重心到画布中心的距离）
  const cx = layout.nodes.reduce((s, n) => s + center(n).x, 0) / layout.nodes.length;
  const cy = layout.nodes.reduce((s, n) => s + center(n).y, 0) / layout.nodes.length;
  const canvasCx = (layout.width || 0) / 2;
  const canvasCy = (layout.height || 0) / 2;
  const offset = Math.sqrt((cx - canvasCx) ** 2 + (cy - canvasCy) ** 2);
  const maxOffset = Math.max(layout.width || 1, layout.height || 1) * 0.15;
  if (offset > maxOffset) {
    score -= 5;
    issues.push(`重心偏移过大（${offset.toFixed(0)}px）`);
  }

  // 留白率（目标 20%-40%）
  const nodeArea = layout.nodes.reduce((s, n) => s + n.width * n.height, 0);
  const totalArea = (layout.width || 1) * (layout.height || 1);
  const whitespace = 1 - nodeArea / totalArea;
  if (whitespace < 0.2) {
    score -= 4;
    issues.push(`留白不足（${(whitespace * 100).toFixed(0)}%）`);
  } else if (whitespace > 0.5) {
    score -= 3;
    issues.push(`留白过多（${(whitespace * 100).toFixed(0)}%）`);
  }

  // 连线交叉数
  const crossings = countEdgeCrossings(layout.edges);
  if (crossings > 0) {
    score -= Math.min(8, crossings * 2);
    issues.push(`${crossings} 处连线交叉`);
  }

  return { score: Math.max(0, score), issues };
}

// 计算边交叉数（线段相交判定）
function countEdgeCrossings(edges) {
  let count = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i].points || [];
      const b = edges[j].points || [];
      if (a.length < 2 || b.length < 2) continue;
      // 简化：检查每条边的首尾线段是否相交
      if (segmentsIntersect(a[0], a[a.length - 1], b[0], b[b.length - 1])) {
        count++;
      }
    }
  }
  return count;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// 维度 4：可读性（0-25 分）
// 标签字号 + 文本对比度 + 节点间距 + 结构完整性
function scoreReadability(layout, dsl) {
  let score = 25;
  const issues = [];

  // 节点间距过近
  const minDist = 30;
  let closePairs = 0;
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i], b = layout.nodes[j];
      const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
      const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) closePairs++;
    }
  }
  if (closePairs > 0) {
    score -= Math.min(8, closePairs * 2);
    issues.push(`${closePairs} 对节点间距过近`);
  }

  // 节点文本长度 vs 节点宽度（文字可能溢出）
  const overflow = (dsl.nodes || []).filter((n, i) => {
    const layoutNode = layout.nodes[i];
    if (!layoutNode) return false;
    const textLen = (n.text || n.label || '').length;
    return textLen * 16 > layoutNode.width - 8;
  });
  if (overflow.length) {
    score -= Math.min(6, overflow.length * 2);
    issues.push(`${overflow.length} 个节点文本可能溢出`);
  }

  // 结构不完整影响可读性：单节点无连接无法表达流程
  if ((dsl.nodes || []).length === 1 && (dsl.edges || []).length === 0) {
    score -= 10;
    issues.push('单节点无连接，无法表达流程关系');
  }

  return { score: Math.max(0, score), issues };
}

// 主入口：评估图形
// 输入 layout + dsl，返回 { total, dimensions, issues, suggestions, pass }
export function evaluate(layout, dsl, threshold = 90) {
  const dims = {
    completeness: scoreCompleteness(dsl),
    alignment: scoreAlignment(layout, dsl),
    visualBalance: scoreVisualBalance(layout, dsl),
    readability: scoreReadability(layout, dsl)
  };

  const total = dims.completeness.score + dims.alignment.score +
                dims.visualBalance.score + dims.readability.score;

  const issues = [
    ...dims.completeness.issues,
    ...dims.alignment.issues,
    ...dims.visualBalance.issues,
    ...dims.readability.issues
  ];

  // 生成改进建议
  const suggestions = generateSuggestions(dims, dsl);

  return {
    total,
    dimensions: {
      completeness: dims.completeness.score,
      alignment: dims.alignment.score,
      visualBalance: dims.visualBalance.score,
      readability: dims.readability.score
    },
    issues,
    suggestions,
    pass: total >= threshold,
    threshold
  };
}

// 根据问题生成具体改进建议（供 Designer Agent 使用）
function generateSuggestions(dims, dsl) {
  const s = [];
  if (dims.completeness.score < 25) {
    s.push('检查节点文本是否完整，移除孤立节点');
  }
  if (dims.alignment.score < 25) {
    s.push('增加 align/equalSpace 约束，确保同层节点对齐');
  }
  if (dims.visualBalance.score < 25) {
    if (dims.visualBalance.issues.some(i => i.includes('留白'))) {
      s.push('调整节点间距或画布尺寸，使留白率在 20%-40%');
    }
    if (dims.visualBalance.issues.some(i => i.includes('交叉'))) {
      s.push('调整边的走向或节点顺序，减少连线交叉');
    }
    if (dims.visualBalance.issues.some(i => i.includes('重心'))) {
      s.push('重新平衡节点分布，使重心靠近画布中心');
    }
  }
  if (dims.readability.score < 25) {
    s.push('增大节点间距，缩短节点文本或加宽节点');
  }
  return s;
}
