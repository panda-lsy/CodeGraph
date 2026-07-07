// 项目持久化
// 对齐第二版 §SVG AST与渲染器 - 保存项目时存储 AST
// 支持 localStorage + JSON 文件导入导出

import { serializeAST, deserializeAST, createEmptyAST } from './ast.js';

const STORAGE_KEY = 'cg_projects';
const CURRENT_KEY = 'cg_current_project';

// 获取所有已保存项目
export function listProjects() {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

// 保存项目（命名）
export function saveProject(name, ast, prompt = '') {
  try {
    if (typeof window === 'undefined') return false;
    const projects = listProjects();
    const idx = projects.findIndex(p => p.name === name);
    const entry = {
      name,
      prompt,
      ast: serializeAST(ast),
      updatedAt: Date.now()
    };
    if (idx >= 0) projects[idx] = entry;
    else projects.push(entry);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    window.localStorage.setItem(CURRENT_KEY, name);
    return true;
  } catch (e) {
    return false;
  }
}

// 加载项目
export function loadProject(name) {
  try {
    const projects = listProjects();
    const entry = projects.find(p => p.name === name);
    if (!entry) return null;
    const ast = deserializeAST(entry.ast);
    window.localStorage.setItem(CURRENT_KEY, name);
    return { ast, prompt: entry.prompt, name };
  } catch (e) {
    return null;
  }
}

// 删除项目
export function deleteProject(name) {
  try {
    if (typeof window === 'undefined') return false;
    const projects = listProjects().filter(p => p.name !== name);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    return true;
  } catch (e) {
    return false;
  }
}

// 导出为 JSON 文件（下载）
export function exportToFile(ast, name = 'codegraph-project') {
  const json = serializeAST(ast);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 从 JSON 文件导入
export function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const ast = deserializeAST(e.target.result);
        if (!ast) return reject(new Error('无效的 JSON 文件'));
        resolve(ast);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}
