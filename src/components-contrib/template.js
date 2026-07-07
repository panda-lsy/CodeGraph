// 组件贡献模板
// 复制本文件为 my-components.js，实现你的组件，然后在入口 import 注册即可
//
// 一个组件 = 一个纯函数 (w, h, text, theme) => SVG 内部字符串
// 参数说明：
//   w, h    : 节点宽高（像素）
//   text    : 节点文本
//   theme   : 当前主题 token，含 fill/stroke/textColor/fontSize/fontFamily/rx/strokeWidth/edgeColor 等
//
// 返回值：SVG 内部元素字符串（不含外层 <g>，由系统自动包裹 translate）
// 可用辅助函数 esc(s) 转义 XML 特殊字符
//
// 示例：自定义"星形"组件

function esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

// ===== 在此添加你的组件 =====
const myComponents = {
  // 组件名需唯一，建议用 前缀_名称 避免冲突，如 myorg_star
  star: (w, h, text, t) => {
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2;
    const innerR = r * 0.4;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : innerR;
      pts.push(`${cx + radius * Math.cos(a)},${cy + radius * Math.sin(a)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
          font-family="${t.fontFamily}" font-size="${t.fontSize}" fill="${t.textColor}">${esc(text)}</text>`;
  },

  // 添加更多组件...
  // hexagon2: (w, h, text, t) => { ... }
};

// 组件元数据（用于 UI 分类展示）
const myComponentMeta = {
  star: { label: '星形', category: 'basic', description: '五角星' }
};

// ===== 注册入口 =====
// 通过 registerComponents 批量注册（需在 demo/index.html 引入本文件并调用）
export { myComponents, myComponentMeta };

// 注册方式（在 demo/index.html 中）：
// import { registerComponents } from '../src/components.js';
// import { myComponents, myComponentMeta } from '../src/components-contrib/my-components.js';
// Object.keys(myComponents).forEach(name => {
//   registerComponent(name, myComponents[name], myComponentMeta[name]);
// });
// 或直接：registerComponents(myComponents);
