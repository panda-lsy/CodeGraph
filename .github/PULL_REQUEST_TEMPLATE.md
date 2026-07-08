<!--
感谢你为 CodeGraph 贡献代码！请按以下模板填写 PR 信息。
贡献指南：CONTRIBUTING.md
-->

## 贡献类型

请勾选本次 PR 的类型（单选）：

- [ ] 🧩 图形组件（新增/优化 `src/components.js` 或 `src/components-contrib/` 下的组件）
- [ ] 🎨 主题样式（新增/优化 `src/render.js` 中的 THEMES 配色方案）
- [ ] 📐 DSL/Mermaid 示例（新增 `examples/` 下的教学/架构图模板）

## 变更说明

<!-- 简述本次贡献的内容和目的 -->

## 自检清单

### 通用
- [ ] 代码通过本地运行验证（`python -m http.server 8000` 或 `npx serve .`）
- [ ] 未引入外部 CDN 依赖（所有第三方库已本地化到 `vendor/`）
- [ ] 未破坏现有功能（生成、拖拽、编辑、导出等流程正常）
- [ ] commit message 遵循 `类型: 简述` 格式（feat / fix / docs / style / refactor / chore）

### 🧩 组件贡献额外检查
- [ ] 组件函数签名：`(w, h, text, theme) => SVG 内部字符串`
- [ ] 返回值不含外层 `<g>`（由系统自动包裹 translate）
- [ ] 已在 `META` 中注册元数据（label / category / description）
- [ ] 支持日间/夜间主题（使用 `theme.fill` / `theme.stroke` 等 token，不硬编码颜色）
- [ ] 文本渲染使用 `textEl()` 辅助函数（支持 Markdown/TeX）
- [ ] 组件名唯一，建议 `前缀_名称` 避免冲突

### 🎨 主题贡献额外检查
- [ ] 主题含 `light` + `dark` 双套
- [ ] 包含完整 token：`fill / stroke / textColor / fontSize / fontFamily / rx / strokeWidth / edgeColor / bg / groupStroke`
- [ ] 主题名唯一，命名有辨识度（如 `Cyberpunk`、 `Forest`）
- [ ] 已在 `demo/index.html` 主题下拉框中添加选项

### 📐 DSL示例贡献额外检查
- [ ] 示例可被 `mermaidToDSL()` 正确解析
- [ ] 文件命名：`examples/分类-名称.json` 或 `examples/分类-名称.mmd`
- [ ] 含简要中文说明（用途、适用场景）

## 截图/预览

<!-- 如有视觉变更，请附截图或 DSL 示例 -->

## 相关 Issue

<!-- 关联的 issue 编号，如 Closes #12 -->
