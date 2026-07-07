// 约束生成器 + 求解器
// 对齐第二版 §关键算法 - 约束求解（Constraint Solver）
// 将 DSL 中的高层约束（align/equalSpace/symmetric/order）应用到 dagre 布局结果上，做坐标微调
//
// 设计思路（参考 Figma Auto Layout / Compose ConstraintLayout）：
// - 不重写 dagre 的拓扑分层，只在同一"层"内做坐标修正
// - align: 同 direction 的节点中心对齐
// - equalSpace: 沿 axis 等间距分布
// - symmetric: 关于轴节点/虚轴对称
// - order: 沿 axis 顺序排列（保持 dagre 顺序，仅微调）

// 工具：取节点中心
function center(n) {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

// 应用单个约束到节点坐标（就地修改 nodesMap）
function applyConstraint(c, nodesMap) {
  const nodes = (c.nodes || []).map(id => nodesMap.get(id)).filter(Boolean);
  if (nodes.length < 2 && c.type !== 'symmetric') return;

  switch (c.type) {
    case 'align': {
      // direction: vertical → 同 x 中心；horizontal → 同 y 中心
      if (c.direction === 'vertical') {
        const avgX = nodes.reduce((s, n) => s + center(n).x, 0) / nodes.length;
        nodes.forEach(n => { n.x = avgX - n.width / 2; });
      } else if (c.direction === 'horizontal') {
        const avgY = nodes.reduce((s, n) => s + center(n).y, 0) / nodes.length;
        nodes.forEach(n => { n.y = avgY - n.height / 2; });
      }
      break;
    }
    case 'equalSpace': {
      // 沿 axis 等间距分布（保持顺序，重排到平均位置带）
      const axis = c.axis || 'x';
      const sorted = [...nodes].sort((a, b) => center(a)[axis] - center(b)[axis]);
      if (sorted.length < 2) break;
      const first = center(sorted[0])[axis];
      const last = center(sorted[sorted.length - 1])[axis];
      const step = (last - first) / (sorted.length - 1);
      sorted.forEach((n, i) => {
        const target = first + step * i;
        if (axis === 'x') n.x = target - n.width / 2;
        else n.y = target - n.height / 2;
      });
      break;
    }
    case 'symmetric': {
      // axis 形如 "node:D" → 关于节点 D 的中心对称；或 "x:300" / "y:200" 虚轴
      if (nodes.length < 1) break;
      const m = /^node:(.+)$/.exec(c.axis || '');
      if (m) {
        const pivot = nodesMap.get(m[1]);
        if (!pivot) break;
        const px = center(pivot).x;
        // 让 nodes 关于 px 左右对称：第 i 与倒数第 i 个关于 px 对称
        const sorted = [...nodes].sort((a, b) => center(a).x - center(b).x);
        const half = Math.floor(sorted.length / 2);
        for (let i = 0; i < half; i++) {
          const left = sorted[i];
          const right = sorted[sorted.length - 1 - i];
          const lx = px - (px - center(left).x);
          const rx = px + (px - center(left).x);
          left.x = lx - left.width / 2;
          right.x = rx - right.width / 2;
        }
        // 奇数个：中间节点居中到 px
        if (sorted.length % 2 === 1) {
          const mid = sorted[half];
          mid.x = px - mid.width / 2;
        }
      } else {
        const axM = /^([xy]):([\d.]+)$/.exec(c.axis || '');
        if (!axM) break;
        const axis = axM[1];
        const val = parseFloat(axM[2]);
        const sorted = [...nodes].sort((a, b) => center(a)[axis] - center(b)[axis]);
        const half = Math.floor(sorted.length / 2);
        for (let i = 0; i < half; i++) {
          const left = sorted[i];
          const right = sorted[sorted.length - 1 - i];
          const lCenter = center(left)[axis];
          const target = val - (val - lCenter);
          if (axis === 'x') {
            left.x = target - left.width / 2;
            right.x = (2 * val - target) - right.width / 2;
          } else {
            left.y = target - left.height / 2;
            right.y = (2 * val - target) - right.height / 2;
          }
        }
      }
      break;
    }
    case 'order': {
      // 沿 axis 保持顺序，但强制相邻节点间距 ≥ minGap
      const axis = c.axis || 'y';
      const sorted = [...nodes].sort((a, b) => center(a)[axis] - center(b)[axis]);
      const minGap = 40;
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const prevEnd = axis === 'x' ? prev.x + prev.width : prev.y + prev.height;
        const curStart = axis === 'x' ? cur.x : cur.y;
        if (curStart < prevEnd + minGap) {
          const shift = prevEnd + minGap - curStart;
          if (axis === 'x') cur.x += shift;
          else cur.y += shift;
        }
      }
      break;
    }
  }
}

// 主入口：对 dagre 布局结果应用 DSL 中的所有约束
// 输入 layout { nodes, edges, width, height } + dsl
// 返回新的 layout（节点坐标已微调，边 points 同步平移）
export function applyConstraints(layout, dsl) {
  if (!dsl.constraints || !dsl.constraints.length) return layout;

  // 构造可变节点 map
  const nodesMap = new Map(layout.nodes.map(n => [n.id, { ...n }]));

  // 逐个应用约束
  dsl.constraints.forEach(c => applyConstraint(c, nodesMap));

  // 重算边界
  const nodes = Array.from(nodesMap.values());
  const xs = nodes.flatMap(n => [n.x, n.x + n.width]);
  const ys = nodes.flatMap(n => [n.y, n.y + n.height]);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxX = Math.max(...xs, layout.width || 0);
  const maxY = Math.max(...ys, layout.height || 0);

  // 节点坐标整体平移到非负象限（若约束导致负值）
  const dx = minX < 0 ? -minX : 0;
  const dy = minY < 0 ? -minY : 0;
  if (dx || dy) {
    nodes.forEach(n => { n.x += dx; n.y += dy; });
  }

  // 边的 points 同步平移
  const edges = layout.edges.map(e => ({
    ...e,
    points: (e.points || []).map(p => ({ x: p.x + dx, y: p.y + dy }))
  }));

  return {
    nodes,
    edges,
    width: maxX + dx,
    height: maxY + dy
  };
}

// 评估约束满足度（供 Critic Agent 使用）
// 返回 0-1 分数，1 表示完全满足
export function scoreConstraints(layout, dsl) {
  if (!dsl.constraints || !dsl.constraints.length) return 1;
  const nodesMap = new Map(layout.nodes.map(n => [n.id, n]));
  let total = 0, ok = 0;
  dsl.constraints.forEach(c => {
    const nodes = (c.nodes || []).map(id => nodesMap.get(id)).filter(Boolean);
    if (nodes.length < 2) return;
    total++;
    if (c.type === 'align') {
      if (c.direction === 'vertical') {
        const xs = nodes.map(n => center(n).x);
        const range = Math.max(...xs) - Math.min(...xs);
        if (range < 2) ok++;
      } else {
        const ys = nodes.map(n => center(n).y);
        const range = Math.max(...ys) - Math.min(...ys);
        if (range < 2) ok++;
      }
    } else if (c.type === 'equalSpace') {
      const axis = c.axis || 'x';
      const sorted = [...nodes].sort((a, b) => center(a)[axis] - center(b)[axis]);
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        gaps.push(center(sorted[i])[axis] - center(sorted[i - 1])[axis]);
      }
      const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const dev = gaps.reduce((s, g) => s + Math.abs(g - avg), 0) / gaps.length;
      if (avg > 0 && dev / avg < 0.05) ok++;
    }
  });
  return total === 0 ? 1 : ok / total;
}
