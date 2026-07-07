// CodeGraph 全局配置
// LLM 接入：api.codegraph.shengxia.me（OpenAI 兼容协议，无需 key）
// mock 仅作离线降级备用

export const CONFIG = {
  llm: {
    baseURL: 'https://api.codegraph.shengxia.me/v1',
    model: 'Doubao-Seed-2.0-mini', // 非 reasoning 模型，响应快；qwen3.5-plus 为 reasoning 模型，DSL 生成易超时
    apiKey: '', // 备用 API 无需 key；如需切换需鉴权的端点，localStorage 注入 cg_api_key
    useMock: false,
    temperature: 0.2,
    timeoutMs: 45000
  },
  // 可选模型列表（运行时通过 /v1/models 动态获取并覆盖）
  models: [
    'Doubao-Seed-2.0-mini',
    'Doubao-Seed-2.0-lite',
    'Doubao-Seed-2.0-pro',
    'qwen3.5-plus',
    'Volc-DeepSeek-V3.2'
  ],
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

// 检测系统夜间模式偏好（prefers-color-scheme: dark）
export function getSystemDarkPref() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// 注册系统夜间模式变化监听器，返回取消监听的函数
// 用户未手动设置过（localStorage 无 cg_dark）时自动跟随系统
export function watchSystemDarkMode(onChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e) => {
    // 仅在用户未手动设置时跟随系统
    let userSet = false;
    try { userSet = window.localStorage.getItem('cg_dark') !== null; } catch (_) {}
    if (userSet) return;
    if (typeof onChange === 'function') onChange(e.matches);
  };
  // addEventListener 在新版浏览器可用，老版本用 addListener
  if (mql.addEventListener) mql.addEventListener('change', handler);
  else if (mql.addListener) mql.addListener(handler);
  return () => {
    if (mql.removeEventListener) mql.removeEventListener('change', handler);
    else if (mql.removeListener) mql.removeListener(handler);
  };
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

// 动态获取可用模型列表（OpenAI 兼容 /v1/models）
// 失败时回退到 CONFIG.models 默认列表
export async function fetchModels() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const headers = {};
    if (CONFIG.llm.apiKey) headers['Authorization'] = `Bearer ${CONFIG.llm.apiKey}`;
    const resp = await fetch(`${CONFIG.llm.baseURL}/models`, {
      method: 'GET',
      headers,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const list = (data?.data || []).map(m => m.id).filter(Boolean);
    if (list.length > 0) {
      CONFIG.models = list;
    }
    return CONFIG.models;
  } catch (e) {
    console.warn('[CodeGraph] 获取模型列表失败，使用默认列表:', e.message);
    return CONFIG.models;
  }
}
