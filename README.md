# CodeGraph - 自然语言驱动的智能矢量绘图助手

> TRAE AI 创造力大赛 · 学习工作 / 造个新解法赛道 参赛作品

## 项目简介

CodeGraph 是一款基于自然语言交互的AI矢量绘图工具。用户只需描述想要的图表内容，系统即可自动生成对应的SVG/矢量代码，实时渲染并支持二次编辑。

**核心优势：**
- 自然语言 → AI代码生成 → 可编辑矢量图形
- 告别像素噪点，告别手动对齐
- 无限缩放、100%可编辑、零像素噪点

## 在线预览

- **展示页**：访问 [GitHub Pages](https://codegraph.shengxia.me) 查看创意展示页面
- **实际 Demo**：访问 [/demo](https://codegraph.shengxia.medemo/) 路由体验交互演示

## 技术栈

本项目基于以下开源技术构建：

| 技术 | 用途 |
|------|------|
| [Tailwind CSS](https://tailwindcss.com/) | 现代化CSS框架 |
| [tsParticles](https://particles.js.org/) | 粒子背景效果 |
| [Anime.js](https://animejs.com/) | 交互动画引擎 |
| [Font Awesome](https://fontawesome.com/) | 图标库 |
| [Mermaid.js](https://mermaid.js.org/) | 流程图渲染 |
| [GitHub Actions](https://github.com/features/actions) | 自动化部署 |

## 项目结构

```
.
├── index.html                 # 创意展示页（GitHub Pages 首页）
├── demo/
│   └── index.html             # 实际 Demo 路由
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Actions 部署配置
├── README.md
└── .gitignore
```

## 本地预览

由于项目为纯静态HTML，无需构建工具，直接在浏览器中打开 `index.html` 即可预览展示页。

或者使用任意静态服务器：

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve .
```

## 部署说明

本项目使用 GitHub Actions 自动部署到 GitHub Pages：

1. 将代码推送到 GitHub 仓库
2. 在仓库 Settings > Pages 中设置 Source 为 "GitHub Actions"
3. 每次推送到 `main` 或 `master` 分支将自动触发部署

## 大赛信息

- **赛事**：TRAE AI 创造力大赛
- **赛道**：学习工作 / 造个新解法
- **报名阶段**：2026年6月16日 - 7月15日

## 开源协议

MIT License
