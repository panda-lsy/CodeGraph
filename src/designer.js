// Designer Agent - 图形设计决策
// 对齐第二版 §Designer Agent + §Critic Agent 闭环
// 流程：理解内容 → 架构设计 → 细节决策 → 风格确定 → 输出 DSL 草稿
// 接收 Critic 反馈后迭代调整

import { chat } from './llm.js';
import { extractJSON, normalizeDSL } from './dsl.js';

// Designer Agent 的系统 prompt
function designerSystemPrompt(criticFeedback = null) {
  const base = `你是 CodeGraph 的 Designer Agent，负责整体图形设计决策。
工作流程：
1. 理解内容：确定关键元素（节点、连接、重点）
2. 架构设计：选择布局类型（flow/tree/layered）和分组方式
3. 细节决策：选择节点组件（rect/rounded/circle/diamond/hexagon/cylinder/beaker/flask/molecule）、箭头类型
4. 风格确定：指定主题（Nature/Science/Modern）
5. 输出 DSL：生成 Graphic DSL v1.0 JSON

设计原则：
- 反应物/产物用 rect 或 rounded
- 催化剂/关键节点用 diamond 或 hexagon
- 容器/储罐用 cylinder
- 烧杯/锥形瓶用 beaker/flask
- 分子结构用 molecule
- 同类节点应添加 align 约束
- 对称分布的节点应添加 symmetric 约束
- 保持留白率 20%-40%，避免连线交叉

输出 Graphic DSL v1.0 JSON 结构：
{
  "version":"1.0",
  "layout":"flow"|"tree"|"layered",
  "style":"Nature"|"Science"|"Modern",
  "nodes":[{"id":"A","text":"中文文本","component":"rect"}],
  "edges":[{"from":"A","to":"B","type":"arrow","style":"line"|"curve"}],
  "groups":[{"members":["A","B"],"label":"组名"}],
  "constraints":[
    {"type":"align","nodes":["A","B"],"direction":"vertical"|"horizontal"},
    {"type":"equalSpace","nodes":["A","B","C"],"axis":"x"|"y"},
    {"type":"symmetric","axis":"node:D","nodes":["B","C"]},
    {"type":"order","nodes":["A","B","C"],"axis":"x"|"y"}
  ]
}
仅输出 JSON，放在 \`\`\`json 代码块中。`;

  if (criticFeedback) {
    return base + `\n\n【上一轮 Critic 评审反馈】\n总分：${criticFeedback.total}/100\n问题：\n- ${criticFeedback.issues.join('\n- ')}\n改进建议：\n- ${criticFeedback.suggestions.join('\n- ')}\n\n请根据反馈调整 DSL，解决上述问题。`;
  }
  return base;
}

// 单轮设计：生成 DSL 草稿
export async function design(userText, criticFeedback = null) {
  const system = designerSystemPrompt(criticFeedback);
  const user = criticFeedback
    ? `用户原始需求：${userText}\n\n请根据 Critic 反馈调整并输出改进后的 DSL v1.0 JSON。`
    : `用户需求：${userText}\n\n请输出 Graphic DSL v1.0 JSON。`;

  const { content } = await chat([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]);
  const dsl = extractJSON(content);
  if (!dsl) return { dsl: null, error: 'Designer 输出无法解析为 JSON', raw: content };
  return { dsl: normalizeDSL(dsl), error: null, raw: content };
}

// 闭环迭代：design → critique → redesign
// 最多迭代 maxIter 次，直到评分 ≥ threshold 或达到上限
import { evaluate } from './critic.js';
import { layoutWithDagre } from './layout.js';

export async function designWithCritique(userText, options = {}) {
  const maxIter = options.maxIter || 3;
  const threshold = options.threshold || 90;
  const onIteration = options.onIteration || (() => {});

  const iterations = [];
  let currentDSL = null;
  let currentFeedback = null;

  for (let i = 0; i < maxIter; i++) {
    // 1. Designer 生成/调整 DSL
    const designResult = await design(userText, currentFeedback);
    if (!designResult.dsl) {
      // Designer 失败：记录本轮并结束
      iterations.push({ round: i + 1, dsl: null, error: designResult.error, designRaw: designResult.raw });
      return { dsl: currentDSL, error: designResult.error, iterations, passed: false };
    }
    currentDSL = designResult.dsl;

    // 2. 布局（失败时用空 layout，Critic 仍可评分部分维度）
    let layout = { nodes: [], edges: [], width: 0, height: 0 };
    let layoutError = null;
    try {
      layout = layoutWithDagre(currentDSL);
    } catch (e) {
      layoutError = e.message;
    }

    // 3. Critic 评审
    const feedback = evaluate(layout, currentDSL, threshold);
    if (layoutError) {
      feedback.issues.push(`布局失败：${layoutError}`);
      feedback.total = Math.max(0, feedback.total - 20);
      feedback.pass = false;
    }
    currentFeedback = feedback;

    iterations.push({
      round: i + 1,
      dsl: currentDSL,
      layout,
      feedback,
      designRaw: designResult.raw,
      layoutError
    });

    onIteration({
      round: i + 1,
      dsl: currentDSL,
      layout,
      feedback,
      total: feedback.total
    });

    // 4. 通过阈值则结束
    if (feedback.pass) {
      return { dsl: currentDSL, layout, feedback, iterations, passed: true };
    }
  }

  // 达到上限仍未通过
  return { dsl: currentDSL, layout: iterations[iterations.length - 1]?.layout, feedback: currentFeedback, iterations, passed: false };
}
