# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** xCloud
**Generated:** 2026-09-02 21:50:00
**Category:** Productivity Tool · 个人云盘/管理面板
**Style Source:** `DESIGN.md`（Cal.com 设计语言重构）—— 白画布 + 墨黑主 CTA + 近单色品牌、扁平卡片、发丝描边、层级圆角 8·12·16·pill、柔和微阴影。无玻璃、无渐变、无重阴影。

---

## Global Rules

### Color Palette（Light）

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary (CTA) | `#111111` | `--primary` |
| Primary Active | `#242424` | `--primary-active` |
| Ink / 标题 | `#111111` | `--ink` |
| Body | `#374151` | `--body` |
| Muted | `#6b7280` | `--muted` |
| Hairline | `#e5e7eb` | `--hairline` |
| Canvas（页面底色） | `#ffffff` | `--canvas` |
| Surface Soft / 悬停 | `#f8f9fa` | `--surface-soft` |
| Surface Card / 灰卡 | `#f5f5f5` | `--surface-card` |
| Surface Dark（footer） | `#101010` | `--surface-dark` |
| Accent（稀有点缀） | `#3b82f6` | `--accent` |
| Success / Warning / Error | `#10b981` / `#f59e0b` / `#ef4444` | `--success/--warning/--error` |

### Dark Theme

以 surface-dark 语言反转：canvas `#101010`、surface `#1a1a1d`、ink `#f4f4f5`、主 CTA 反白为白底黑字（`--on-primary:#101010`）。

### Typography

- **Display（时钟/大标题）**：600 weight、负字距 `-0.02 ~ -0.04em`（Cal Sans 替代规则：Inter/system 600）
- **UI / 正文**：system stack（Segoe UI / PingFang SC / Microsoft YaHei fallback），14-15px，行高 1.5
- 标题从不使用 700+；按钮文字 14px/600

### Radius（层级）

| Token | 值 | 用途 |
|-------|-----|------|
| `--r-md` | 8px | 按钮 / 输入框 |
| `--r-card` | 12px | 内容卡片（应用瓦片、弹层） |
| `--r-panel` | 16px | hero mockup / 大容器 |
| `--r-pill` | 9999px | seg 分段、nav 标签、徽章 |

### Elevation

- 普通卡片：`0 1px 2px rgba(0,0,0,0.05)`（`--sh-1`）
- 悬浮/浮层：叠加 `0 4px 12px rgba(0,0,0,0.08)`（`--sh-2`）；popover/sheet `--sh-overlay`
- **唯一深色块**：footer `.foot`（Cal 签名式深色收尾），浅色主题下为 `#101010`

### 语义要点（保留自 DESIGN.md）

- 蓝色 `#3b82f6` 只在未读圆点等小徽标出现，不用于主按钮/大面积高亮
- 选中态（文件行/侧栏）使用墨黑反白而非蓝色：featured-tier 反色逻辑
- 文件类型图标：平面色块（badge-pastel 语义），无渐变
- 焦点环：墨黑 `--focus-ring`（深色主题自动反白），全站 `:focus-visible`

---

## Implementation Status

- `public/styles.css`：整体重构完成（class 名与 DOM 未动，app.js 逻辑未动）
- `public/app.js`：仅更新默认图标色 `#111111` 与 `PALETTE` 12 色为 Cal 系色值
- `public/index.html`：favicon 墨黑圆角方块 + theme-color `#ffffff`
- IE 兼容（`classic.html/css/js`）与 `edit.html`：**未改动**
