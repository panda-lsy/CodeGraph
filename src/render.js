// SVG 渲染器：布局结果 → 标准 SVG 字符串
// 对齐第二版 §样式引擎 - 多主题 Token（含夜间模式）
// 对齐第二版 §图形组件库 - 接入 components.js
// 增强：透明背景 / 可调画布 / 边端点裁剪到节点边界

import { renderComponent, setErrorCollector } from './components.js';

// 模块级错误收集器
let _renderErrors = [];

// 配置错误收集器（components.js 的 textEl 会调用）
setErrorCollector(e => _renderErrors.push(e));

// 获取最近一次渲染的错误
export function getRenderErrors() {
  return _renderErrors.slice();
}

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

// 暴露主题计算（供外部获取当前主题，用于单节点重渲染）
export function getThemeForDSL(dsl, darkMode) {
  return getTheme(dsl, darkMode);
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

// 计算线段与菱形边界的交点（菱形：以矩形内切菱形计算）
// 菱形顶点：(cx, y_top), (x_right, cy), (cx, y_bottom), (x_left, cy)
function diamondBorderPoint(node, fromX, fromY) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = fromX - cx;
  const dy = fromY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = node.width / 2;
  const hh = node.height / 2;
  // 菱形方程：|x/hw| + |y/hh| = 1，求射线 (dx*t, dy*t) 与菱形边交点
  const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  return { x: cx + dx * t, y: cy + dy * t };
}

// 计算线段与圆形/椭圆边界的交点
function ellipseBorderPoint(node, fromX, fromY) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = fromX - cx;
  const dy = fromY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = node.width / 2;
  const hh = node.height / 2;
  // 椭圆方程：(x/hw)^2 + (y/hh)^2 = 1
  const t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  return { x: cx + dx * t, y: cy + dy * t };
}

// 根据节点 component 类型选择合适的边界点计算函数
function borderPoint(node, fromX, fromY) {
  if (!node) return { x: fromX, y: fromY };
  const comp = node.component || 'rect';
  switch (comp) {
    case 'diamond':
      return diamondBorderPoint(node, fromX, fromY);
    case 'circle':
    case 'ellipse':
      return ellipseBorderPoint(node, fromX, fromY);
    case 'hexagon':
      // 六边形近似为椭圆（略小）
      return ellipseBorderPoint(node, fromX, fromY);
    default:
      return rectBorderPoint(node, fromX, fromY);
  }
}

// 边 → SVG path（折线/曲线）+ 端点裁剪到节点边界
// edge.style: 'line' (默认折线) | 'curve' (贝塞尔曲线)
function renderEdge(edge, theme, nodeMap) {
  const pts = edge.points || [];
  if (pts.length < 2) return '';
  const fromNode = nodeMap.get(edge.from);
  const toNode = nodeMap.get(edge.to);

  const mid = pts.slice(1, -1);
  let start, end;

  if (mid.length === 0) {
    // 无拐点：直接用当前节点中心计算起终点，避免 dagre 旧 points 导致边跑位置
    const fromCx = fromNode ? fromNode.x + fromNode.width / 2 : pts[0].x;
    const fromCy = fromNode ? fromNode.y + fromNode.height / 2 : pts[0].y;
    const toCx = toNode ? toNode.x + toNode.width / 2 : pts[pts.length - 1].x;
    const toCy = toNode ? toNode.y + toNode.height / 2 : pts[pts.length - 1].y;
    start = fromNode ? borderPoint(fromNode, toCx, toCy) : { x: fromCx, y: fromCy };
    end = toNode ? borderPoint(toNode, fromCx, fromCy) : { x: toCx, y: toCy };
  } else {
    // 有拐点：用拐点作为参考方向裁剪
    start = pts[0];
    end = pts[pts.length - 1];
    if (fromNode) start = borderPoint(fromNode, pts[1].x, pts[1].y);
    if (toNode) end = borderPoint(toNode, pts[pts.length - 2].x, pts[pts.length - 2].y);
  }

  const all = [start, ...mid, end];
  const style = edge.style || 'line';
  let d;

  if (style === 'curve') {
    // 曲线模式：用三次贝塞尔曲线平滑连接所有点（含拐点）
    if (all.length === 2) {
      // 仅两点：直接贝塞尔
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const offset = Math.max(20, dist * 0.4);
      const isHorizontal = Math.abs(dx) > Math.abs(dy);
      const c1x = start.x + dx * 0.3 + (isHorizontal ? 0 : offset * 0.3);
      const c1y = start.y + dy * 0.3 + (isHorizontal ? offset * 0.3 : 0);
      const c2x = start.x + dx * 0.7 + (isHorizontal ? 0 : offset * 0.3);
      const c2y = start.y + dy * 0.7 + (isHorizontal ? offset * 0.3 : 0);
      d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    } else {
      // 多点（含拐点）：用 S 命令平滑连接，每段贝塞尔
      const dx0 = all[1].x - all[0].x;
      const dy0 = all[1].y - all[0].y;
      const dist0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      const c1x = all[0].x + dx0 * 0.3;
      const c1y = all[0].y + dy0 * 0.3;
      d = `M ${all[0].x.toFixed(1)} ${all[0].y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${all[1].x.toFixed(1)} ${all[1].y.toFixed(1)}, ${all[1].x.toFixed(1)} ${all[1].y.toFixed(1)}`;
      for (let i = 1; i < all.length - 1; i++) {
        d += ` S ${all[i].x.toFixed(1)} ${all[i].y.toFixed(1)}, ${all[i + 1].x.toFixed(1)} ${all[i + 1].y.toFixed(1)}`;
      }
    }
  } else {
    // 折线模式
    d = all.map((p, i) => (i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)).join(' ');
  }

  // 虚线样式
  const strokeDasharray = edge.dashed ? '6 4' : 'none';
  // 边标签（线上文本）
  let labelSVG = '';
  if (edge.label) {
    // 计算标签位置：路径中点（取 all 数组中间点）
    const midIdx = Math.floor(all.length / 2);
    const labelPos = midIdx >= all.length ? all[all.length - 1] : all[midIdx];
    const labelText = escapeXML(edge.label);
    labelSVG = `<rect x="${(labelPos.x - labelText.length * 3.5).toFixed(1)}" y="${(labelPos.y - 9).toFixed(1)}" width="${(labelText.length * 7).toFixed(1)}" height="18" fill="${theme.bg || '#fff'}" opacity="0.9" rx="2"/>
    <text x="${labelPos.x.toFixed(1)}" y="${(labelPos.y + 4).toFixed(1)}" text-anchor="middle" font-family="${theme.fontFamily}" font-size="12" fill="${theme.edgeColor}">${labelText}</text>`;
  }

  return `
  <g class="cg-edge">
    <path d="${d}" fill="none" stroke="${theme.edgeColor}" stroke-width="${theme.strokeWidth}"
          stroke-dasharray="${strokeDasharray}" marker-end="url(#arrowhead)"/>
    ${labelSVG}
  </g>`;
}

// 组 → 半透明矩形（包围盒）
function renderGroups(layout, dsl, theme) {
  if (!dsl.groups) return '';
  const nodeMap = new Map(layout.nodes.map(n => [n.id, n]));
  return dsl.groups.map((g, i) => {
    if (g.hidden) return '';
    const members = (g.members || []).map(id => nodeMap.get(id)).filter(Boolean);
    if (!members.length) return '';
    // 优先使用 group 自身的 x/y/width/height（支持手动拉伸），否则按成员包围盒计算
    let minX, minY, maxX, maxY;
    if (g.x != null && g.y != null && g.width != null && g.height != null) {
      minX = g.x; minY = g.y; maxX = g.x + g.width; maxY = g.y + g.height;
    } else {
      minX = Math.min(...members.map(n => n.x)) - 15;
      minY = Math.min(...members.map(n => n.y)) - 25;
      maxX = Math.max(...members.map(n => n.x + n.width)) + 15;
      maxY = Math.max(...members.map(n => n.y + n.height)) + 15;
    }
    const fill = g.fill || 'none';
    const stroke = g.stroke || theme.groupStroke;
    const labelColor = g.labelColor || stroke;
    // label 对齐：left（默认）/center/right
    const labelAlign = g.labelAlign || 'left';
    let labelX = minX + 8;
    if (labelAlign === 'center') labelX = minX + (maxX - minX) / 2;
    else if (labelAlign === 'right') labelX = maxX - 8;
    const textAnchor = labelAlign === 'center' ? 'middle' : (labelAlign === 'right' ? 'end' : 'start');
    return `
  <g class="cg-group" data-group-id="${escapeXML(g.id || 'group-' + i)}" data-group-label="${escapeXML(g.label || '')}">
    <rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}"
          rx="8" ry="8" fill="${fill}" stroke="${stroke}" stroke-width="1"
          stroke-dasharray="4 3" opacity="${fill !== 'none' ? '0.8' : '0.5'}" class="cg-group-rect"/>
    <text x="${labelX}" y="${minY + 14}" font-family="${theme.fontFamily}"
          font-size="11" fill="${labelColor}" text-anchor="${textAnchor}" class="cg-group-label">${escapeXML(g.label || '')}</text>
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
  // 加 padding，并扩展画布留出充足操作空间 + 内容居中
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const contentCX = minX + contentW / 2;
  const contentCY = minY + contentH / 2;
  // 目标画布尺寸：内容尺寸 × 1.6，但不小于 900×600，确保有充足操作空间
  let vbW = Math.max(contentW * 1.6, 900);
  let vbH = Math.max(contentH * 1.6, 600);
  // 用户指定宽高时覆盖
  if (options.width != null) vbW = options.width;
  if (options.height != null) vbH = options.height;
  // 以内容中心为画布中心，居中放置
  let vbMinX = contentCX - vbW / 2;
  let vbMinY = contentCY - vbH / 2;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const groupsSVG = renderGroups(layout, dsl, theme);
  const edgesSVG = edges.map(e => renderEdge(e, theme, nodeMap)).join('');
  // 渲染节点前清空错误收集器
  _renderErrors = [];
  const nodesSVG = nodes.map(n => renderComponent(n, theme)).join('');

  // 背景：强制透明（不画背景 rect，由画布容器决定背景色）
  const bgRect = '';
  const gridRect = '';
  const gridDef = '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="${vbMinX.toFixed(1)} ${vbMinY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}" preserveAspectRatio="xMidYMid meet" style="background:transparent">
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
// 保留 edge.points 中的拐点，起终点裁剪到节点边界
export function recalcEdgePath(layout, edge) {
  const fromNode = (layout.nodes || []).find(n => n.id === edge.from);
  const toNode = (layout.nodes || []).find(n => n.id === edge.to);
  if (!fromNode || !toNode) return null;
  const fromCx = fromNode.x + fromNode.width / 2;
  const fromCy = fromNode.y + fromNode.height / 2;
  const toCx = toNode.x + toNode.width / 2;
  const toCy = toNode.y + toNode.height / 2;

  // 中间拐点（保留用户手动添加的拐点）
  const midPoints = (edge.points || []).slice(1, -1).map(p => ({ x: p.x, y: p.y }));

  // 节点旋转时，borderPoint 在未旋转本地坐标系下计算，需要做坐标变换
  const fromRot = fromNode.rotation || 0;
  const toRot = toNode.rotation || 0;
  // 起点参考方向：朝向第一个拐点（若有）或终点中心
  const startAim = midPoints.length ? midPoints[0] : { x: toCx, y: toCy };
  const endAim = midPoints.length ? midPoints[midPoints.length - 1] : { x: fromCx, y: fromCy };
  const startTarget = fromRot ? rotatePoint(startAim.x, startAim.y, fromCx, fromCy, -fromRot) : startAim;
  const endTarget = toRot ? rotatePoint(endAim.x, endAim.y, toCx, toCy, -toRot) : endAim;
  let start = borderPoint(fromNode, startTarget.x, startTarget.y);
  let end = borderPoint(toNode, endTarget.x, endTarget.y);
  if (fromRot) start = rotatePoint(start.x, start.y, fromCx, fromCy, fromRot);
  if (toRot) end = rotatePoint(end.x, end.y, toCx, toCy, toRot);

  const style = edge.style || 'curve';
  // 有拐点时：曲线用 S 命令平滑连接，折线用 L 连接
  if (midPoints.length > 0) {
    const all = [start, ...midPoints, end];
    if (style === 'curve') {
      // 曲线模式：用 S 命令平滑连接所有拐点
      const dx0 = all[1].x - all[0].x;
      const dy0 = all[1].y - all[0].y;
      const c1x = all[0].x + dx0 * 0.3;
      const c1y = all[0].y + dy0 * 0.3;
      let path = `M ${all[0].x.toFixed(1)} ${all[0].y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${all[1].x.toFixed(1)} ${all[1].y.toFixed(1)}, ${all[1].x.toFixed(1)} ${all[1].y.toFixed(1)}`;
      for (let i = 1; i < all.length - 1; i++) {
        path += ` S ${all[i].x.toFixed(1)} ${all[i].y.toFixed(1)}, ${all[i + 1].x.toFixed(1)} ${all[i + 1].y.toFixed(1)}`;
      }
      return path;
    }
    // 折线模式
    return all.map((p, i) => (i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)).join(' ');
  }
  // 无拐点：曲线用贝塞尔，直线用两点连接
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

// 将点绕中心旋转指定角度（度）
function rotatePoint(px, py, cx, cy, deg) {
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}
