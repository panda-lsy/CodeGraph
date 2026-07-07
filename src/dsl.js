// Graphic DSL v1 Schema 与校验器
// 对齐第二版计划书 §技术架构 - Graphic DSL
// v1 升级：约束类型扩展（align/equalSpace/symmetric/order）、节点支持 component 字段、style 细化
// 示例：
// {
//   "version":"1.0",
//   "layout":"flow", "style":"Nature",
//   "nodes":[{"id":"A","text":"原料","component":"rect"}],
//   "edges":[{"from":"A","to":"B","type":"arrow","style":"curve"}],
//   "groups":[{"members":["A","B"],"label":"反应体系"}],
//   "constraints":[
//     {"type":"align","nodes":["A","B"],"direction":"vertical"},
//     {"type":"equalSpace","nodes":["A","B","C"],"axis":"x"},
//     {"type":"symmetric","axis":"node:D","nodes":["B","C"]},
//     {"type":"order","nodes":["A","B","C"],"axis":"y"}
//   ]
// }

export const DSL_VERSION = '1.0';

// 支持的约束类型
export const CONSTRAINT_TYPES = ['align', 'equalSpace', 'symmetric', 'order'];
// 支持的节点组件类型
export const NODE_COMPONENTS = ['rect', 'rounded', 'circle', 'diamond', 'hexagon', 'cylinder', 'beaker', 'flask', 'molecule', 'arrow'];

// 创建空 DSL 文档
export function createEmptyDSL() {
  return {
    version: DSL_VERSION,
    layout: 'flow',
    style: 'Nature',
    nodes: [],
    edges: [],
    groups: [],
    constraints: []
  };
}

// 规范化 DSL：补默认字段、统一节点 text/label
export function normalizeDSL(dsl) {
  if (!dsl || typeof dsl !== 'object') return createEmptyDSL();
  const out = { ...createEmptyDSL(), ...dsl };
  out.version = DSL_VERSION;
  out.nodes = (dsl.nodes || []).map(n => ({
    ...n,
    text: n.text || n.label || '',
    component: n.component || 'rect'
  }));
  out.edges = (dsl.edges || []).map(e => ({
    type: 'arrow',
    style: 'line',
    ...e
  }));
  out.groups = dsl.groups || [];
  out.constraints = dsl.constraints || [];
  return out;
}

// 校验 DSL，返回 { ok, errors[], warnings[] }
export function validateDSL(dsl) {
  const errors = [];
  const warnings = [];
  if (!dsl || typeof dsl !== 'object') {
    return { ok: false, errors: ['DSL 必须是对象'], warnings };
  }
  if (!Array.isArray(dsl.nodes)) errors.push('nodes 必须是数组');
  if (!Array.isArray(dsl.edges)) errors.push('edges 必须是数组');
  if (dsl.groups && !Array.isArray(dsl.groups)) errors.push('groups 必须是数组');
  if (dsl.constraints && !Array.isArray(dsl.constraints)) errors.push('constraints 必须是数组');

  const ids = new Set();
  (dsl.nodes || []).forEach((n, i) => {
    if (!n.id) errors.push(`nodes[${i}] 缺少 id`);
    else if (ids.has(n.id)) errors.push(`nodes[${i}] id 重复: ${n.id}`);
    else ids.add(n.id);
    if (!n.text && !n.label) errors.push(`nodes[${i}] 缺少 text/label`);
    if (n.component && !NODE_COMPONENTS.includes(n.component)) {
      warnings.push(`nodes[${i}] 未知组件类型: ${n.component}（将回退为 rect）`);
    }
  });

  (dsl.edges || []).forEach((e, i) => {
    if (!e.from) errors.push(`edges[${i}] 缺少 from`);
    if (!e.to) errors.push(`edges[${i}] 缺少 to`);
    if (e.from && !ids.has(e.from)) errors.push(`edges[${i}] from 引用不存在的节点: ${e.from}`);
    if (e.to && !ids.has(e.to)) errors.push(`edges[${i}] to 引用不存在的节点: ${e.to}`);
  });

  (dsl.groups || []).forEach((g, i) => {
    if (!Array.isArray(g.members)) errors.push(`groups[${i}] members 必须是数组`);
  });

  (dsl.constraints || []).forEach((c, i) => {
    if (!c.type) errors.push(`constraints[${i}] 缺少 type`);
    else if (!CONSTRAINT_TYPES.includes(c.type)) {
      warnings.push(`constraints[${i}] 未知约束类型: ${c.type}（将忽略）`);
    }
    if (!Array.isArray(c.nodes) || c.nodes.length < 2) {
      if (c.type !== 'symmetric') errors.push(`constraints[${i}] nodes 需 ≥2 个节点`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

// 从 LLM 输出中抽取 JSON（兼容 ```json 代码块与裸 JSON）
export function extractJSON(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}
