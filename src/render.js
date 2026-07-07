// SVG 渲染器：布局结果 → 标准 SVG 字符串
// 对齐第二版 §样式引擎 - 多主题 Token（含夜间模式）
// 对齐第二版 §图形组件库 - 接入 components.js
// 增强：透明背景 / 可调画布 / 边端点裁剪到节点边界

import { renderComponent } from './components.js';

// 主题 Token（CSS-like）
// 每个主题含 light / dark 双套
const THEMES = {
  Nature: {
    light: {
      fill: '#afe0ff', stroke: '#3b82f6', textColor: '#0f172a',
      fontSize: 14, fontFamily: 'serif', rx: 12, strokeWidth: 1.5,
      edgeColor: '#475569', bg: '#ffffff', groupStroke: '#3b82f6'
    },
    dark: {
      fill: '#1e3a5f', stroke: '#60a5fa', textColor: '#e2e8f0',
      fontSize: 14, fontFamily: 'serif', rx: 12, strokeWidth: 1.5,
      edgeColor: '#94a3b8', bg: '#0f172a', groupStroke: '#60a5fa'
    }
  },
  Science: {
    light: {
      fill: '#dbeafe', stroke: '#1e40af', textColor: '#1e3a8a',
      fontSize: 14, fontFamily: 'sans-serif', rx: 4, strokeWidth: 1.8,
      edgeColor: '#1e3a8a', bg: '#f8fafc', groupStroke: '#1e40af'
    },
    dark: {
      fill: '#1e293b', stroke: '#3b82f6', textColor: '#bfdbfe',
      fontSize: 14, fontFamily: 'sans-serif', rx: 4, strokeWidth: 1.8,
      edgeColor: '#60a5fa', bg: '#020617', groupStroke: '#3b82f6'
    }
  },
  Modern: {
    light: {
      fill: '#ede9fe', stroke: '#7c3aed', textColor: '#4c1d95',
      fontSize: 14, fontFamily: 'sans-serif', rx: 8, strokeWidth: 2,
      edgeColor: '#7c3aed', bg: '#faf5ff', groupStroke: '#7c3aed'
    },
    dark: {
      fill: '#2e1065', stroke: '#a78bfa', textColor: '#ede9fe',
      fontSize: 14, fontFamily: 'sans-serif', rx: 8, strokeWidth: 2,
      edgeColor: '#a78bfa', bg: '#0f0a1e', groupStroke: '#a78bfa'
    }
  }
};

function escapeXML(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

// 取主题（根据 dsl.style + darkMode）
function getTheme(dsl, darkMode) {
  const t = THEMES[dsl.style] || THEMES.Nature;
  return darkMode ? t.dark : t.light;
}

// 计算线段与矩形边界的交点（用于裁剪边端点到节点边界）
// 矩形以 (x, y, w, h) 表示，p 为外部点，返回矩形边界上离 p 最近的点
function rectBorderPoint(node, fromX, fromY) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = fromX - cx;
  const dy = fromY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = node.width / 2;
  const hh = node.height / 2;
  // 计算与矩形边的交点（基于斜率）
  const scaleX = dx === 0 ? Infinity : hw / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : hh / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

// 边 → SVG path（折线/曲线）+ 端点裁剪到节点边界
// edge.style: 'line' (默认折线) | 'curve' (贝塞尔曲线)
function renderEdge(edge, theme, nodeMap) {
  const pts = edge.points || [];
  if (pts.length < 2) return '';
  const fromNode = nodeMap.get(edge.from);
  const toNode = nodeMap.get(edge.to);

  let start = pts[0];
  let end = pts[pts.length - 1];

  // 起点：裁剪到 from 节点边界（朝向第二个点）
  if (fromNode) {
    const next = pts[1] || end;
    start = rectBorderPoint(fromNode, next.x, next.y);
  }
  // 终点：裁剪到 to 节点边界（朝向倒数第二个点）
  if (toNode) {
    const prev = pts[pts.length - 2] || start;
    end = rectBorderPoint(toNode, prev.x, prev.y);
  }

  const mid = pts.slice(1, -1);
  const all = [start, ...mid, end];
  const style = edge.style || 'line';
  let d;

  if (style === 'curve' || mid.length === 0) {
    // 曲线模式或无中间点：用三次贝塞尔曲线连接首尾
    // 控制点偏移量基于首尾距离
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const offset = Math.max(20, dist * 0.4);
    // 控制点方向：垂直于连线方向
    const c1x = start.x + dx * 0.3;
    const c1y = start.y + dy * 0.3 + (Math.abs(dx) > Math.abs(dy) ? 0 : offset * 0.3);
    const c2x = start.x + dx * 0.7;
    const c2y = start.y + dy * 0.7 + (Math.abs(dx) > Math.abs(dy) ? 0 : offset * 0.3);
    d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  } else {
    // 折线模式
    d = all.map((p, i) => (i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)).join(' ');
  }

  return `
  <g class="cg-edge">
    <path d="${d}" fill="none" stroke="${theme.edgeColor}" stroke-width="${theme.strokeWidth}"
          marker-end="url(#arrowhead)"/>
  </g>`;
}

// 组 → 半透明矩形（包围盒）
function renderGroups(layout, dsl, theme) {
  if (!dsl.groups) return '';
  const nodeMap = new Map(layout.nodes.map(n => [n.id, n]));
  return dsl.groups.map((g, i) => {
    const members = (g.members || []).map(id => nodeMap.get(id)).filter(Boolean);
    if (!members.length) return '';
    const minX = Math.min(...members.map(n => n.x)) - 15;
    const minY = Math.min(...members.map(n => n.y)) - 25;
    const maxX = Math.max(...members.map(n => n.x + n.width)) + 15;
    const maxY = Math.max(...members.map(n => n.y + n.height)) + 15;
    return `
  <g class="cg-group">
    <rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}"
          rx="8" ry="8" fill="none" stroke="${theme.groupStroke}" stroke-width="1"
          stroke-dasharray="4 3" opacity="0.5"/>
    <text x="${minX + 8}" y="${minY + 14}" font-family="${theme.fontFamily}"
          font-size="11" fill="${theme.groupStroke}">${escapeXML(g.label || '')}</text>
  </g>`;
  }).join('');
}

// 主入口：布局 + DSL → SVG 字符串
// options: { darkMode, transparent, width, height, padding }
// 画布策略：fit 内容 + 留白 padding（默认 80），节点拖到边缘时由 svg-editor 动态扩展 viewBox
export function layoutToSVG(layout, dsl, options = {}) {
  const theme = getTheme(dsl, options.darkMode);
  const pad = options.padding != null ? options.padding : 80;

  // 计算 bbox：所有节点 + 边点 + 组的并集
  const nodes = layout.nodes || [];
  const edges = layout.edges || [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (nodes.length === 0) {
    minX = 0; minY = 0; maxX = 600; maxY = 400;
  } else {
    nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    });
    edges.forEach(e => {
      (e.points || []).forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
    });
  }
  // 加 padding
  let vbMinX = minX - pad;
  let vbMinY = minY - pad;
  let vbW = (maxX - minX) + pad * 2;
  let vbH = (maxY - minY) + pad * 2;
  // 用户指定宽高时覆盖（仍以内容左上角为原点）
  if (options.width != null) vbW = options.width;
  if (options.height != null) vbH = options.height;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const groupsSVG = renderGroups(layout, dsl, theme);
  const edgesSVG = edges.map(e => renderEdge(e, theme, nodeMap)).join('');
  const nodesSVG = nodes.map(n => renderComponent(n, theme)).join('');

  // 背景：默认透明；非透明时画一个覆盖 viewBox 的背景
  const bgRect = options.transparent === false
    ? `<rect x="${vbMinX}" y="${vbMinY}" width="${vbW}" height="${vbH}" fill="${theme.bg}"/>`
    : '';

  // 网格 pattern（showGrid=true 时在背景之上、内容之下画网格）
  const gridColor = options.darkMode ? '#334155' : '#cbd5e1';
  const gridRect = options.showGrid
    ? `<rect x="${vbMinX}" y="${vbMinY}" width="${vbW}" height="${vbH}" fill="url(#cg-grid)"/>`
    : '';
  const gridDef = options.showGrid
    ? `<pattern id="cg-grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="1" fill="${gridColor}" opacity="0.5"/>
      </pattern>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="${vbMinX.toFixed(1)} ${vbMinY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}" preserveAspectRatio="xMidYMid meet" style="background:${options.transparent === false && !options.showGrid ? theme.bg : 'transparent'}">
  <defs>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.edgeColor}"/>
    </marker>
    ${gridDef}
  </defs>
  ${bgRect}
  ${gridRect}
  ${groupsSVG}
  ${edgesSVG}
  ${nodesSVG}
</svg>`;
}

// 拟合内容到 viewBox（节点移动后重算 bbox，调用方更新 svg.viewBox）
// 返回 { x, y, w, h } 或 null（无节点）
export function fitViewBox(layout, padding = 80) {
  const nodes = layout.nodes || [];
  const edges = layout.edges || [];
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  });
  edges.forEach(e => {
    (e.points || []).forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
  });
  return {
    x: minX - padding,
    y: minY - padding,
    w: (maxX - minX) + padding * 2,
    h: (maxY - minY) + padding * 2
  };
}

// 暴露主题列表（UI 切换用）
export function listThemes() {
  return Object.keys(THEMES);
}

// 重新计算单条边的 path（节点移动后更新连线）
// layout: 当前布局（含 nodes/edges），edge: 要更新的边
export function recalcEdgePath(layout, edge) {
  const fromNode = (layout.nodes || []).find(n => n.id === edge.from);
  const toNode = (layout.nodes || []).find(n => n.id === edge.to);
  if (!fromNode || !toNode) return null;
  const start = rectBorderPoint(fromNode, toNode.x + toNode.width / 2, toNode.y + toNode.height / 2);
  const end = rectBorderPoint(toNode, fromNode.x + fromNode.width / 2, fromNode.y + fromNode.height / 2);
  const style = edge.style || 'curve';
  if (style === 'curve') {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const offset = Math.max(20, dist * 0.4);
    const isHorizontal = Math.abs(dx) > Math.abs(dy);
    const c1x = start.x + dx * 0.3 + (isHorizontal ? 0 : offset * 0.3);
    const c1y = start.y + dy * 0.3 + (isHorizontal ? offset * 0.3 : 0);
    const c2x = start.x + dx * 0.7 + (isHorizontal ? 0 : offset * 0.3);
    const c2y = start.y + dy * 0.7 + (isHorizontal ? offset * 0.3 : 0);
    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  }
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}
