// 节点文本渲染：Markdown + TeX（KaTeX）+ 转义保留
// 支持：**粗体** *斜体* `代码` $行内公式$ $$块公式$$ \转义
// 返回 HTML 字符串，用于 SVG foreignObject 内嵌

// 转义 HTML 特殊字符（防止 XSS + 保留 \ 转义）
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 全局错误收集（每次 renderNodeText 调用前清空）
let _lastErrors = [];

// 渲染 TeX：将 $...$ 和 $$...$$ 替换为 KaTeX 渲染结果
// errors: 收集错误信息的数组
function renderTeX(texStr, errors) {
  if (typeof window === 'undefined' || !window.katex) return texStr;
  // 块级 $$...$$
  if (/^\$\$[\s\S]+\$\$$/.test(texStr)) {
    const inner = texStr.slice(2, -2).trim();
    try {
      return `<div class="katex-block">${window.katex.renderToString(inner, { displayMode: true, throwOnError: true, strict: false })}</div>`;
    } catch (e) {
      errors.push({ tex: inner, error: e.message });
      return `<span class="cg-tex-error" title="${escapeHTML(e.message)}">${escapeHTML(texStr)}</span>`;
    }
  }
  // 行内 $...$
  if (/^\$[^\$\n]+\$$/.test(texStr)) {
    const inner = texStr.slice(1, -1).trim();
    try {
      return window.katex.renderToString(inner, { displayMode: false, throwOnError: true, strict: false });
    } catch (e) {
      errors.push({ tex: inner, error: e.message });
      return `<span class="cg-tex-error" title="${escapeHTML(e.message)}">${escapeHTML(texStr)}</span>`;
    }
  }
  return escapeHTML(texStr);
}

// 渲染 Markdown + TeX
// text: 原始文本
// options: { fontFamily, fontSize, color, bold, italic }
// 返回 { html, errors }
export function renderNodeText(text, options = {}) {
  if (!text) return { html: '', errors: [] };
  const {
    fontFamily = 'inherit',
    fontSize = '14px',
    color = 'inherit',
    bold = false,
    italic = false
  } = options;

  const errors = [];

  // 1. 先提取 TeX 公式（保护 $...$ 和 $$...$$ 不被 markdown 解析）
  // 注意：此时不处理 \ 转义，因为 TeX 内部的 \Delta 等需要原样传递
  const texMap = [];
  let processed = text.replace(/\$\$([\s\S]+?)\$\$/g, (m) => {
    const placeholder = `\x00TEX${texMap.length}\x00`;
    texMap.push(m);
    return placeholder;
  });
  processed = processed.replace(/(?<!\\)\$([^\$\n]+?)\$/g, (m) => {
    const placeholder = `\x00TEX${texMap.length}\x00`;
    texMap.push(m);
    return placeholder;
  });

  // 2. 保护非 TeX 区域的转义序列：\X → 占位符
  // 只保护不在 TeX 公式内的 \X（TeX 内的 \Delta 等已通过占位符隔离）
  const escapeMap = [];
  processed = processed.replace(/\\(.)/g, (m, ch) => {
    const placeholder = `\x00ESC${escapeMap.length}\x00`;
    escapeMap.push(ch);
    return placeholder;
  });

  // 3. 用 marked 解析 Markdown（内联模式，不生成 <p> 包裹）
  let html;
  if (typeof window !== 'undefined' && window.marked) {
    try {
      window.marked.setOptions({ breaks: true, gfm: true });
      html = window.marked.parseInline(processed);
    } catch (e) {
      html = escapeHTML(processed);
    }
  } else {
    html = escapeHTML(processed);
  }

  // 4. 恢复 TeX 公式并渲染（传入 errors 数组收集错误）
  html = html.replace(/\x00TEX(\d+)\x00/g, (m, idx) => {
    return renderTeX(texMap[parseInt(idx)], errors);
  });

  // 5. 恢复转义字符（保留 \ 转义的效果）
  html = html.replace(/\x00ESC(\d+)\x00/g, (m, idx) => {
    return escapeHTML(escapeMap[parseInt(idx)]);
  });

  // 6. 应用文字样式
  const styleParts = [];
  if (fontFamily !== 'inherit') styleParts.push(`font-family:${fontFamily}`);
  if (fontSize !== 'inherit') styleParts.push(`font-size:${fontSize}`);
  if (color !== 'inherit') styleParts.push(`color:${color}`);
  if (bold) styleParts.push('font-weight:bold');
  if (italic) styleParts.push('font-style:italic');
  const style = styleParts.length > 0 ? ` style="${styleParts.join(';')}"` : '';

  return { html: `<div class="cg-node-text"${style}>${html}</div>`, errors };
}

// 兼容旧接口：返回 HTML 字符串（不收集错误）
export function renderNodeTextSimple(text, options = {}) {
  return renderNodeText(text, options).html;
}

// 获取最近一次渲染的错误
export function getLastErrors() {
  return _lastErrors;
}

// 检测文本是否包含 Markdown/TeX 语法
export function hasRichText(text) {
  if (!text) return false;
  return /(\*\*|__|`|\$|\\\[|\\\(|\[.*\]\()/.test(text);
}

// 默认字体选项
export const FONT_FAMILIES = [
  { value: 'inherit', label: '默认' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: '"Fira Code", monospace', label: 'Fira Code' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"SimSun", serif', label: '宋体' },
  { value: '"Microsoft YaHei", sans-serif', label: '微软雅黑' },
  { value: '"SimHei", sans-serif', label: '黑体' },
  { value: '"KaiTi", serif', label: '楷体' }
];

export const FONT_SIZES = [
  { value: '10px', label: '10' },
  { value: '12px', label: '12' },
  { value: '14px', label: '14' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '20px', label: '20' },
  { value: '24px', label: '24' },
  { value: '28px', label: '28' },
  { value: '32px', label: '32' }
];

export const COLOR_PALETTE = [
  '#1e293b', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#06b6d4', '#3b82f6', '#6366f1',
  '#8b5cf6', '#ec4899', '#64748b', '#ffffff'
];
