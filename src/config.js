// CodeGraph 全局配置
// LLM 接入：api.codegraph.shengxia.me（OpenAI 兼容协议，无需 key）
// mock 仅作离线降级备用

export const CONFIG = {
  llm: {
    baseURL: 'http://api.codegraph.shengxia.me/v1',
    model: 'Doubao-Seed-2.0-mini', // 非 reasoning 模型，响应快；qwen3.5-plus 为 reasoning 模型，DSL 生成易超时
    apiKey: '', // 备用 API 无需 key；如需切换需鉴权的端点，localStorage 注入 cg_api_key
    useMock: false,
    temperature: 0.2,
    timeoutMs: 45000
  },
  layout: {
    engine: 'dagre', // 'dagre' | 'mermaid'
    rankdir: 'TB', // TB | LR | BT | RL
    nodesep: 60,
    ranksep: 80,
    marginx: 30,
    marginy: 30,
    applyConstraints: true // 是否在 dagre 布局后应用约束求解器微调
  },
  style: {
    theme: 'Nature', // Nature | Science | Modern
    darkMode: false, // 夜间模式
    transparent: false, // 透明背景
    canvasWidth: null, // null=自动；指定则用该值
    canvasHeight: null
  }
};

// 允许运行时覆盖配置（Demo 页面可读取 localStorage）
export function loadRuntimeConfig() {
  try {
    if (typeof window === 'undefined') return CONFIG;
    const key = window.localStorage.getItem('cg_api_key');
    if (key) CONFIG.llm.apiKey = key;
    const mock = window.localStorage.getItem('cg_use_mock');
    if (mock === '1') CONFIG.llm.useMock = true;
    if (mock === '0') CONFIG.llm.useMock = false;
    const dark = window.localStorage.getItem('cg_dark');
    if (dark === '1') CONFIG.style.darkMode = true;
    if (dark === '0') CONFIG.style.darkMode = false;
  } catch (e) {
    // localStorage 不可用时忽略
  }
  return CONFIG;
}

// 持久化夜间模式
export function setDarkMode(on) {
  CONFIG.style.darkMode = !!on;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('cg_dark', on ? '1' : '0');
    }
  } catch (e) {}
  return CONFIG.style.darkMode;
}

// 透明背景开关
export function setTransparent(on) {
  CONFIG.style.transparent = !!on;
  return CONFIG.style.transparent;
}

// 设置画布尺寸
export function setCanvasSize(width, height) {
  CONFIG.style.canvasWidth = width;
  CONFIG.style.canvasHeight = height;
  return CONFIG.style;
}
