// ============================================================
// CodeGraph 贡献模板（组件 / 主题 / DSL 示例）
// 完整规范请参考 CONTRIBUTING.md
// ============================================================
//
// 使用方式：
//   1. 复制本文件为 src/components-contrib/<你的贡献>.js
//   2. 取消注释你需要贡献的类型（组件 / 主题 / 示例）
//   3. 实现你的代码
//   4. 在 demo/index.html 中 import 并注册
//   5. 提交 PR（参考 .github/PULL_REQUEST_TEMPLATE.md）
//

function esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

// ============================================================
// 类型一：🧩 图形组件贡献
// 一个组件 = 一个纯函数 (w, h, text, theme) => SVG 内部字符串
// 返回值不含外层 <g>（由系统自动包裹 translate）
// ============================================================

const myComponents = {
  // 组件名需唯一，建议用 前缀_名称 避免冲突，如 myorg_star
  // 示例：五角星组件
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

  // 在此添加更多组件...
  // hexagon2: (w, h, text, t) => { ... }
};

// 组件元数据（用于 UI 分类展示）
const myComponentMeta = {
  star: { label: '星形', category: 'basic', description: '五角星' }
};

// ============================================================
// 类型二：🎨 主题样式贡献
// 每个主题含 light + dark 双套，需包含完整 token
// 在 src/render.js 的 THEMES 对象中添加，或在下方定义后由外部合并
// ============================================================

const myTheme = {
  // 主题名需有辨识度，如 Cyberpunk / Forest / Ocean / Retro
  Cyberpunk: {
    light: {
      fill: '#f0abfc', stroke: '#a855f7', textColor: '#581c87',
      fontSize: 14, fontFamily: 'sans-serif', rx: 4, strokeWidth: 2,
      edgeColor: '#a855f7', bg: '#fdf4ff', groupStroke: '#a855f7'
    },
    dark: {
      fill: '#581c87', stroke: '#e879f9', textColor: '#f5d0fe',
      fontSize: 14, fontFamily: 'sans-serif', rx: 4, strokeWidth: 2,
      edgeColor: '#e879f9', bg: '#1a0a2e', groupStroke: '#e879f9'
    }
  }
  // 在此添加更多主题...
};

// ============================================================
// 类型三：📐 DSL/Mermaid 示例贡献
// 示例可被 mermaidToDSL() 解析，粘贴到 Demo 输入框即可渲染
// 单独保存到 examples/ 目录，此处仅作开发预览
// ============================================================

const myExamples = {
  // 示例名 → Mermaid 代码
  '架构-微服务': `flowchart TB
    subgraph GW["API 网关"]
        direction LR
        Auth["认证服务"]
        Rate["限流"]
    end
    subgraph SVC["微服务集群"]
        User["用户服务<br/>User Service"]
        Order["订单服务<br/>Order Service"]
        Pay["支付服务<br/>Payment Service"]
    end
    GW --> User
    GW --> Order
    GW --> Pay
    Order -.->|调用| User
    Pay -.->|回调| Order`,

  '化学-蒸馏实验': `flowchart TB
    subgraph App["蒸馏装置"]
        direction TB
        Flask["锥形瓶<br/>Flask"]
        Condenser["冷凝管<br/>Condenser"]
        Beaker["烧杯<br/>Beaker"]
    end
    Flask --> Condenser
    Condenser --> Beaker`

  // 在此添加更多示例...
};

// ============================================================
// 注册入口
// 在 demo/index.html 中引入本文件并调用：
// ============================================================

export { myComponents, myComponentMeta, myTheme, myExamples };

// ===== 注册方式（在 demo/index.html 中）=====
//
// import { registerComponents } from '../src/components.js';
// import { myComponents, myComponentMeta, myTheme, myExamples } from '../src/components-contrib/my-components.js';
//
// // 1. 注册组件
// Object.keys(myComponents).forEach(name => {
//   registerComponent(name, myComponents[name], myComponentMeta[name]);
// });
//
// // 2. 注册主题（需修改 src/render.js 的 THEMES，或通过 API 注入）
// // Object.assign(THEMES, myTheme);
//
// // 3. 加载示例（可选：添加到示例下拉框）
// // Object.keys(myExamples).forEach(name => { /* 添加到 UI */ });
