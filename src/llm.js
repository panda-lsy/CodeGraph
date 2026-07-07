// LLM 客户端：OpenAI 兼容协议（api.codegraph.shengxia.me）+ Mock fallback
// 备用 API 无需 key；网络失败时自动降级到 mock

import { CONFIG, loadRuntimeConfig } from './config.js';
import { extractJSON } from './dsl.js';

// 内置 mock：API 不可用时的离线响应
// 样例：MOF-74 催化流程图（化学实验场景）
function mockChatResponse(messages) {
  const userMsg = messages.find(m => m.role === 'user')?.content || '';
  const lower = userMsg.toLowerCase();

  // 默认返回化学催化流程样例
  const dsl = {
    version: '0.1',
    layout: 'flow',
    style: CONFIG.style.theme,
    nodes: [
      { id: 'A', text: '金属盐前驱体' },
      { id: 'B', text: '有机配体 H3BTC' },
      { id: 'C', text: '溶剂热反应' },
      { id: 'D', text: 'MOF-74 催化剂' },
      { id: 'E', text: '催化产物' }
    ],
    edges: [
      { from: 'A', to: 'C', type: 'arrow' },
      { from: 'B', to: 'C', type: 'arrow' },
      { from: 'C', to: 'D', type: 'arrow' },
      { from: 'D', to: 'E', type: 'arrow', style: 'curve' }
    ],
    groups: [
      { members: ['A', 'B'], label: '反应物' },
      { members: ['D'], label: '催化剂体系' }
    ],
    constraints: [
      { type: 'align', nodes: ['A', 'B'], direction: 'vertical' }
    ]
  };

  // 简单关键词触发不同样例
  if (lower.includes('架构') || lower.includes('系统') || lower.includes('架构图')) {
    dsl.nodes = [
      { id: 'A', text: '客户端' },
      { id: 'B', text: 'API 网关' },
      { id: 'C', text: '业务服务' },
      { id: 'D', text: '数据库' },
      { id: 'E', text: '缓存' }
    ];
    dsl.edges = [
      { from: 'A', to: 'B', type: 'arrow' },
      { from: 'B', to: 'C', type: 'arrow' },
      { from: 'C', to: 'D', type: 'arrow' },
      { from: 'C', to: 'E', type: 'arrow' }
    ];
    dsl.groups = [{ members: ['D', 'E'], label: '存储层' }];
    dsl.constraints = [{ type: 'align', nodes: ['D', 'E'], direction: 'vertical' }];
  }

  const content = '```json\n' + JSON.stringify(dsl, null, 2) + '\n```';
  return Promise.resolve({
    model: 'mock',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

// 真实 LLM 调用（OpenAI 兼容）
function realChatResponse(messages) {
  const cfg = CONFIG.llm;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  return fetch(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature
    }),
    signal: controller.signal
  }).then(r => {
    clearTimeout(timer);
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${r.statusText}`);
    return r.json();
  }).catch(e => {
    clearTimeout(timer);
    // 网络错误时自动降级到 mock
    console.warn('[CodeGraph] LLM 调用失败，降级到 mock:', e.message);
    return mockChatResponse(messages);
  });
}

// 对外接口：发送 messages，返回 { content, raw }
export async function chat(messages) {
  loadRuntimeConfig();
  const cfg = CONFIG.llm;
  // useMock=true 时走 mock；否则走真实调用（备用 API 无需 key，realChatResponse 失败会自动降级）
  const resp = cfg.useMock
    ? await mockChatResponse(messages)
    : await realChatResponse(messages);
  const content = resp.choices?.[0]?.message?.content || '';
  return { content, raw: resp };
}

// 高层接口：自然语言 → Graphic DSL v1
// 失败或解析错误时返回 { dsl:null, error }
export async function textToDSL(userText) {
  const system = `你是 CodeGraph 的图形规划 Agent。将用户的自然语言描述转换为 Graphic DSL JSON（v1.0）。
DSL 结构：
{
  "version":"1.0",
  "layout":"flow" | "tree" | "layered",
  "style":"Nature" | "Science" | "Modern",
  "nodes":[{"id":"A","text":"节点文本","component":"rect"}],
  "edges":[{"from":"A","to":"B","type":"arrow","style":"curve"|"line"}],
  "groups":[{"members":["A","B"],"label":"组名"}],
  "constraints":[
    {"type":"align","nodes":["A","B"],"direction":"vertical"|"horizontal"},
    {"type":"equalSpace","nodes":["A","B","C"],"axis":"x"|"y"},
    {"type":"symmetric","axis":"node:D","nodes":["B","C"]},
    {"type":"order","nodes":["A","B","C"],"axis":"x"|"y"}
  ]
}
节点组件 component 可选值：rect | rounded | circle | diamond | hexagon | cylinder | beaker | flask | molecule
- 化学反应物/产物用 rect 或 rounded
- 催化剂用 diamond 或 hexagon
- 容器/储罐用 cylinder
- 烧杯/锥形瓶用 beaker/flask
- 分子结构用 molecule
规则：
- 节点 id 用简短字母（A/B/C...），text 用中文
- 边 type 仅 arrow；style 可选 curve/line
- 适当添加 constraints 表达对齐/等距/对称关系
- 仅输出 JSON，放在 \`\`\`json 代码块中`;
  const user = `用户需求：${userText}\n\n请输出 Graphic DSL v1.0 JSON。`;

  const { content } = await chat([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]);
  const dsl = extractJSON(content);
  if (!dsl) return { dsl: null, error: 'LLM 输出无法解析为 JSON', raw: content };
  return { dsl, error: null, raw: content };
}

// 检测文本是否为 Mermaid 代码（关键词触发）
export function looksLikeMermaid(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  // 多行开头匹配
  const firstLine = t.split(/\n/)[0].trim().toLowerCase();
  const keywords = ['graph ', 'flowchart ', 'flowchart\t', 'sequence', 'class ', 'state ', 'er ', 'gantt ', 'pie ', 'journey ', 'mindmap', 'timeline', 'gitgraph'];
  return keywords.some(k => firstLine.startsWith(k) || t.toLowerCase().startsWith(k));
}
