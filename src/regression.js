// 视觉回归测试基线（Resemble.js）
// 对齐第二版 §测试计划 - 视觉回归测试基线
// 功能：保存 SVG 渲染结果为基线，后续渲染与基线对比，输出差异百分比
// 基线按工作区隔离：每个工作区独立的基线集合
// Resemble.js 通过 demo/index.html 本地 vendor 引入（避免 CDN ORB 拦截）

function ensureResemble() {
  if (window.resemble) return Promise.resolve(window.resemble);
  return Promise.reject(new Error('Resemble.js 未加载，请确保已引入 vendor/resemble.min.js'));
}

// SVG 字符串 → dataURL
function svgToDataURL(svgStr) {
  const encoded = encodeURIComponent(svgStr)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

// 将 SVG 渲染为 PNG dataURL（通过 canvas）
async function svgToPngDataURL(svgStr, scale = 1) {
  return new Promise((resolve, reject) => {
    const svg = svgToDataURL(svgStr);
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (!w || !h) {
        const m = /viewBox="([^"]+)"/.exec(svgStr);
        if (m) {
          const [, , vw, vh] = m[1].split(/\s+/).map(Number);
          w = vw; h = vh;
        }
      }
      w = Math.max((w || 400) * scale, 10);
      h = Math.max((h || 300) * scale, 10);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(new Error('Canvas 导出失败（可能跨域）：' + e.message));
      }
    };
    img.onerror = () => reject(new Error('SVG 加载失败'));
    img.src = svg;
  });
}

// ===== 工作区管理 =====
const WORKSPACES_KEY = 'cg_workspaces';
const CURRENT_WS_KEY = 'cg_current_workspace';
const DEFAULT_WS = 'default';
const BASELINE_KEY_PREFIX = 'cg_baselines_';

// 列出所有工作区
export function listWorkspaces() {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(WORKSPACES_KEY);
    if (!raw) {
      // 首次：初始化默认工作区
      const def = [{ id: DEFAULT_WS, name: '默认工作区', createdAt: Date.now() }];
      window.localStorage.setItem(WORKSPACES_KEY, JSON.stringify(def));
      return def;
    }
    return JSON.parse(raw);
  } catch (e) {
    return [{ id: DEFAULT_WS, name: '默认工作区', createdAt: Date.now() }];
  }
}

function saveWorkspaces(list) {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(WORKSPACES_KEY, JSON.stringify(list));
    return true;
  } catch (e) { return false; }
}

// 创建工作区（返回新工作区对象，或 null 表示重名）
export function createWorkspace(name) {
  const list = listWorkspaces();
  if (list.find(w => w.name === name)) return null;
  const ws = { id: 'ws_' + Date.now().toString(36), name, createdAt: Date.now() };
  list.push(ws);
  saveWorkspaces(list);
  return ws;
}

// 重命名工作区（id 不变，仅改 name）
export function renameWorkspace(id, newName) {
  const list = listWorkspaces();
  if (list.find(w => w.name === newName && w.id !== id)) return false; // 重名
  const ws = list.find(w => w.id === id);
  if (!ws) return false;
  ws.name = newName;
  saveWorkspaces(list);
  return true;
}

// 删除工作区（同时删除其所有基线）
export function deleteWorkspace(id) {
  if (id === DEFAULT_WS) return false; // 默认工作区不可删除
  const list = listWorkspaces().filter(w => w.id !== id);
  saveWorkspaces(list);
  // 删除该工作区的所有基线
  try {
    window.localStorage.removeItem(BASELINE_KEY_PREFIX + id);
  } catch (e) {}
  // 如果当前工作区是被删除的，切回默认
  if (getCurrentWorkspace() === id) setCurrentWorkspace(DEFAULT_WS);
  return true;
}

// 获取 / 设置当前工作区
export function getCurrentWorkspace() {
  try {
    if (typeof window === 'undefined') return DEFAULT_WS;
    return window.localStorage.getItem(CURRENT_WS_KEY) || DEFAULT_WS;
  } catch (e) { return DEFAULT_WS; }
}

export function setCurrentWorkspace(id) {
  try {
    if (typeof window === 'undefined') return false;
    const list = listWorkspaces();
    if (!list.find(w => w.id === id)) return false;
    window.localStorage.setItem(CURRENT_WS_KEY, id);
    return true;
  } catch (e) { return false; }
}

// 获取当前工作区名称
export function getCurrentWorkspaceName() {
  const id = getCurrentWorkspace();
  const ws = listWorkspaces().find(w => w.id === id);
  return ws ? ws.name : '默认工作区';
}

// ===== 基线存储（按工作区隔离）=====
function baselineKey() {
  return BASELINE_KEY_PREFIX + getCurrentWorkspace();
}

export function listBaselines() {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(baselineKey());
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveBaselines(list) {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(baselineKey(), JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

// 保存当前 SVG 为基线
export async function saveBaseline(name, svgStr, meta = {}) {
  const png = await svgToPngDataURL(svgStr, 1);
  const list = listBaselines();
  const idx = list.findIndex(b => b.name === name);
  const entry = {
    name,
    png,
    meta,
    workspace: getCurrentWorkspace(),
    updatedAt: Date.now()
  };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  return saveBaselines(list);
}

// 对比当前 SVG 与基线
export async function compareWithBaseline(name, svgStr, threshold = 1) {
  await ensureResemble();
  const list = listBaselines();
  const baseline = list.find(b => b.name === name);
  if (!baseline) {
    return { mismatchPercentage: null, diffImage: null, passed: false, error: `基线 ${name} 不存在` };
  }

  const currentPng = await svgToPngDataURL(svgStr, 1);

  return new Promise(resolve => {
    window.resemble(baseline.png)
      .compareTo(currentPng)
      .ignoreAntialiasing()
      .onComplete(data => {
        const pct = parseFloat(data.misMatchPercentage);
        resolve({
          mismatchPercentage: pct,
          diffImage: data.getImageDataUrl(),
          passed: pct <= threshold,
          threshold
        });
      });
  });
}

// 删除基线
export function deleteBaseline(name) {
  const list = listBaselines().filter(b => b.name !== name);
  return saveBaselines(list);
}

// 批量回归测试：对多个 {name, svgStr} 逐一对比
export async function runRegressionSuite(cases, threshold = 1, onProgress = () => {}) {
  const results = [];
  for (const c of cases) {
    try {
      const r = await compareWithBaseline(c.name, c.svgStr, threshold);
      results.push({ name: c.name, ...r });
    } catch (e) {
      results.push({ name: c.name, error: e.message, passed: false });
    }
    onProgress(results[results.length - 1]);
  }
  const passed = results.filter(r => r.passed).length;
  return { results, passed, total: results.length, passRate: passed / results.length };
}
