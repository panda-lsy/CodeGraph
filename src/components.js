// 图形组件库（注册制，支持无限扩展）
// 对齐第二版 §图形组件库 - 内置可重用矢量部件 + PR 贡献机制
//
// 设计原则：
// 1. 每个组件是一个纯函数 (w, h, text, theme) => SVG 内部字符串
// 2. 通过 registerComponent() 注册，支持运行时扩展
// 3. 第三方组件包通过 import 后 registerComponent 批量注册
// 4. 贡献新组件请参考 src/components-contrib/ 下的模板
//
// 内置组件分类：
//   基础形状：rect / rounded / circle / diamond / hexagon / parallelogram / trapezoid / triangle
//   IT 类：cylinder(数据库) / cloud / server / document
//   化学类：beaker(烧杯) / flask(锥形瓶) / testtube(试管) / condenser(冷凝管) / funnel(漏斗) / molecule(分子)
//   标注：note(便签)

function esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  }[c]));
}

// 组件注册表
const REGISTRY = new Map();
const META = new Map(); // name → { label, category, description }

function textEl(w, h, text, t, dy = 0, fs = null) {
  return `<text x="${w / 2}" y="${h / 2 + dy}" text-anchor="middle" dominant-baseline="central"
          font-family="${t.fontFamily}" font-size="${fs || t.fontSize}" fill="${t.textColor}">${esc(text)}</text>`;
}

// 注册一个组件
export function registerComponent(name, renderer, meta = {}) {
  if (typeof renderer !== 'function') throw new Error(`组件 ${name} 渲染器必须是函数`);
  REGISTRY.set(name, renderer);
  META.set(name, {
    label: meta.label || name,
    category: meta.category || 'other',
    description: meta.description || ''
  });
}

// 批量注册（PR 贡献的组件包用）
export function registerComponents(pack) {
  Object.keys(pack).forEach(name => {
    const v = pack[name];
    if (typeof v === 'function') {
      registerComponent(name, v, { label: name });
    } else if (v && typeof v.render === 'function') {
      registerComponent(name, v.render, v.meta || {});
    }
  });
}

// ===== 内置组件 =====
const BUILTIN = {
  // 基础形状
  rect: (w, h, text, t) => `
    <rect x="0" y="0" width="${w}" height="${h}" rx="${t.rx}" ry="${t.rx}"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`,

  rounded: (w, h, text, t) => `
    <rect x="0" y="0" width="${w}" height="${h}" rx="${Math.max(t.rx, 16)}" ry="${Math.max(t.rx, 16)}"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`,

  circle: (w, h, text, t) => {
    const r = Math.min(w, h) / 2;
    return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${r}" ry="${r}"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`;
  },

  diamond: (w, h, text, t) => {
    const cx = w / 2, cy = h / 2;
    return `<polygon points="${cx},0 ${w},${cy} ${cx},${h} 0,${cy}"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`;
  },

  hexagon: (w, h, text, t) => {
    const cx = w / 2, cy = h / 2;
    const p = `${w * 0.25},0 ${w * 0.75},0 ${w},${cy} ${w * 0.75},${h} ${w * 0.25},${h} 0,${cy}`;
    return `<polygon points="${p}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`;
  },

  parallelogram: (w, h, text, t) => {
    const skew = w * 0.2;
    return `<polygon points="${skew},0 ${w},0 ${w - skew},${h} 0,${h}"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`;
  },

  trapezoid: (w, h, text, t) => {
    const inset = w * 0.15;
    return `<polygon points="${inset},0 ${w - inset},0 ${w},${h} 0,${h}"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`;
  },

  triangle: (w, h, text, t) => {
    return `<polygon points="${w / 2},0 ${w},${h} 0,${h}"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t, h * 0.1)}`;
  },

  // IT 类
  cylinder: (w, h, text, t) => {
    const ry = 8;
    return `<path d="M 0 ${ry} Q 0 0 ${w / 2} 0 Q ${w} 0 ${w} ${ry} L ${w} ${h - ry} Q ${w} ${h} ${w / 2} ${h} Q 0 ${h} 0 ${h - ry} Z"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    <ellipse cx="${w / 2}" cy="${ry}" rx="${w / 2}" ry="${ry}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`;
  },

  cloud: (w, h, text, t) => {
    const cx = w / 2, cy = h / 2;
    return `<path d="M ${cx - w * 0.3} ${cy + h * 0.2}
      Q ${cx - w * 0.45} ${cy + h * 0.2} ${cx - w * 0.45} ${cy}
      Q ${cx - w * 0.5} ${cy - h * 0.3} ${cx - w * 0.2} ${cy - h * 0.3}
      Q ${cx} ${cy - h * 0.45} ${cx + w * 0.2} ${cy - h * 0.3}
      Q ${cx + w * 0.5} ${cy - h * 0.3} ${cx + w * 0.45} ${cy}
      Q ${cx + w * 0.45} ${cy + h * 0.2} ${cx + w * 0.3} ${cy + h * 0.2} Z"
      fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t)}`;
  },

  server: (w, h, text, t) => {
    const slotH = h / 3;
    let slots = '';
    for (let i = 0; i < 3; i++) {
      slots += `<rect x="4" y="${i * slotH + 3}" width="${w - 8}" height="${slotH - 6}" rx="2"
        fill="none" stroke="${t.stroke}" stroke-width="0.8"/>`;
      slots += `<circle cx="${w - 10}" cy="${i * slotH + slotH / 2}" r="1.5" fill="${t.stroke}"/>`;
    }
    return `<rect x="0" y="0" width="${w}" height="${h}" rx="4"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${slots}
    ${textEl(w * 0.6, h, text, t, 0, t.fontSize - 2)}`;
  },

  document: (w, h, text, t) => {
    const wave = h * 0.15;
    return `<path d="M 0 0 L ${w} 0 L ${w} ${h - wave}
      Q ${w * 0.75} ${h} ${w / 2} ${h - wave}
      Q ${w * 0.25} ${h - wave * 2} 0 ${h - wave} Z"
      fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h * 0.85, text, t)}`;
  },

  // 化学类
  beaker: (w, h, text, t) => {
    const top = 8, wall = 4;
    return `<path d="M ${wall} ${top} L ${wall} ${h - 6} Q ${wall} ${h} ${wall + 6} ${h} L ${w - 6} ${h} Q ${w} ${h} ${w} ${h - 6} L ${w} ${top}"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}" stroke-linejoin="round"/>
    <path d="M 0 ${top} L ${w} ${top}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}" stroke-linecap="round"/>
    ${textEl(w, h, text, t, 4, t.fontSize - 1)}`;
  },

  flask: (w, h, text, t) => {
    const neckW = w * 0.3;
    const neckX = (w - neckW) / 2;
    return `<path d="M ${neckX} 0 L ${neckX + neckW} 0 L ${neckX + neckW} ${h * 0.3} L ${w - 4} ${h - 4} Q ${w} ${h} ${w - 8} ${h} L 8 ${h} Q 0 ${h} 4 ${h - 4} L ${neckX} ${h * 0.3} Z"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}" stroke-linejoin="round"/>
    ${textEl(w, h, text, t, h * 0.2, t.fontSize - 1)}`;
  },

  testtube: (w, h, text, t) => {
    const tubeW = w * 0.4;
    const tubeX = (w - tubeW) / 2;
    return `<path d="M ${tubeX} 0 L ${tubeX + tubeW} 0 L ${tubeX + tubeW} ${h - tubeW / 2} Q ${tubeX + tubeW} ${h} ${tubeX + tubeW / 2} ${h} Q ${tubeX} ${h} ${tubeX} ${h - tubeW / 2} Z"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}" stroke-linejoin="round"/>
    <line x1="${tubeX - 4}" y1="0" x2="${tubeX + tubeW + 4}" y2="0" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${textEl(w, h, text, t, h * 0.15, t.fontSize - 2)}`;
  },

  condenser: (w, h, text, t) => {
    // 冷凝管：双层管 + 水进出口
    const innerW = w * 0.4;
    const innerX = (w - innerW) / 2;
    return `<rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    <rect x="${innerX}" y="4" width="${innerW}" height="${h - 8}" fill="none" stroke="${t.stroke}" stroke-width="0.8"/>
    <line x1="0" y1="${h * 0.2}" x2="${innerX}" y2="${h * 0.2}" stroke="${t.stroke}" stroke-width="1"/>
    <line x1="${w}" y1="${h * 0.8}" x2="${innerX + innerW}" y2="${h * 0.8}" stroke="${t.stroke}" stroke-width="1"/>
    ${textEl(w, h, text, t, 0, t.fontSize - 2)}`;
  },

  funnel: (w, h, text, t) => {
    const neckH = h * 0.3;
    const coneH = h - neckH;
    return `<path d="M 0 0 L ${w} 0 L ${w * 0.5} ${coneH} L ${w * 0.45} ${h} L ${w * 0.55} ${h} L ${w * 0.5} ${coneH} Z"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}" stroke-linejoin="round"/>
    ${textEl(w, coneH * 0.6, text, t, 0, t.fontSize - 2)}`;
  },

  molecule: (w, h, text, t) => {
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 6;
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      verts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
    }
    return `<polygon points="${verts.join(' ')}" fill="none" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    ${verts.map(v => `<circle cx="${v.split(',')[0]}" cy="${v.split(',')[1]}" r="3" fill="${t.stroke}"/>`).join('')}
    ${textEl(w, h, text, t, 0, t.fontSize - 2)}`;
  },

  note: (w, h, text, t) => {
    const fold = 10;
    return `<path d="M 0 0 L ${w - fold} 0 L ${w} ${fold} L ${w} ${h} L 0 ${h} Z"
          fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>
    <path d="M ${w - fold} 0 L ${w - fold} ${fold} L ${w} ${fold}" fill="none" stroke="${t.stroke}" stroke-width="0.8"/>
    ${textEl(w - fold, h, text, t)}`;
  }
};

// 内置组件元数据（label / category / description）
const BUILTIN_META = {
  rect: { label: '矩形', category: 'basic' },
  rounded: { label: '圆角矩形', category: 'basic' },
  circle: { label: '椭圆', category: 'basic' },
  diamond: { label: '菱形', category: 'basic' },
  hexagon: { label: '六边形', category: 'basic' },
  parallelogram: { label: '平行四边形', category: 'basic' },
  trapezoid: { label: '梯形', category: 'basic' },
  triangle: { label: '三角形', category: 'basic' },
  cylinder: { label: '圆柱（数据库）', category: 'it' },
  cloud: { label: '云', category: 'it' },
  server: { label: '服务器', category: 'it' },
  document: { label: '文档', category: 'it' },
  beaker: { label: '烧杯', category: 'chemistry' },
  flask: { label: '锥形瓶', category: 'chemistry' },
  testtube: { label: '试管', category: 'chemistry' },
  condenser: { label: '冷凝管', category: 'chemistry' },
  funnel: { label: '漏斗', category: 'chemistry' },
  molecule: { label: '分子结构', category: 'chemistry' },
  note: { label: '便签', category: 'annotation' }
};

// 注册所有内置组件
Object.keys(BUILTIN).forEach(name => {
  registerComponent(name, BUILTIN[name], BUILTIN_META[name] || { label: name });
});

// 渲染节点组件
export function renderComponent(node, theme) {
  const shape = REGISTRY.get(node.component) || REGISTRY.get('rect');
  const inner = shape(node.width, node.height, node.text, theme);
  return `
  <g class="cg-node" transform="translate(${node.x},${node.y})">
    ${inner}
  </g>`;
}

// 列出所有组件
export function listComponents() {
  return Array.from(REGISTRY.keys());
}

// 按分类列出
export function listComponentsByCategory() {
  const result = {};
  META.forEach((meta, name) => {
    if (!result[meta.category]) result[meta.category] = [];
    result[meta.category].push({ name, ...meta });
  });
  return result;
}

// 组件中文名
export function getComponentLabel(name) {
  return META.get(name)?.label || name;
}

// 兼容旧接口
export const COMPONENT_LABELS = new Proxy({}, {
  get(_, key) { return getComponentLabel(key); }
});

// 获取组件默认尺寸（不同组件建议不同宽高比）
export function getDefaultSize(component) {
  const sizes = {
    circle: { width: 80, height: 80 },
    diamond: { width: 100, height: 70 },
    hexagon: { width: 100, height: 70 },
    molecule: { width: 90, height: 90 },
    beaker: { width: 60, height: 90 },
    flask: { width: 70, height: 100 },
    testtube: { width: 50, height: 120 },
    condenser: { width: 120, height: 50 },
    funnel: { width: 80, height: 100 },
    cloud: { width: 120, height: 70 },
    server: { width: 80, height: 100 },
    document: { width: 100, height: 80 },
    triangle: { width: 90, height: 80 },
    note: { width: 100, height: 70 }
  };
  return sizes[component] || { width: 100, height: 50 };
}
