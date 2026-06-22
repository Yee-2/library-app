# Reader 性能与可维护性重构 — 设计

**状态**：draft（待用户审阅）
**作者**：Claude
**创建日期**：2026-06-22
**项目**：书屿（library-app）— Vue 3 + Vite + Supabase 阅读应用

---

## 1. 背景

当前 [Reader.vue](frontend/src/views/Reader.vue) 已达 **1269 行**，且同时承担 TXT / EPUB / PDF 三套渲染器、心跳、书签、笔记、TTS 状态机、设置面板等职责。主要痛点：

1. **首屏 bundle 过大** — `epubjs` (~150KB) 与 `pdfjs-dist` (~400KB) 在 Reader.vue 顶层静态 import，但多数用户只读 TXT 格式时根本不会用到。
2. **生产代码被 20+ 处 `console.log` 污染** — Vite 不会自动删除 string literal。
3. **30 秒心跳在后台仍持续运行** — 浪费电量、可能误上报非真实阅读时长。
4. **可维护性差** — 单文件 1269 行，新格式（MOBI 真支持时）或 panel 改动都要碰这个文件。

## 2. 目标

按 ROI 排序，逐项验收：

- **G1**：首屏 reader 入口 chunk 不再含 epubjs/pdfjs-dist，体积下降 ≥ 50%。
- **G2**：进入 EPUB / PDF 书籍时，对应库才会按需下载；不进入则不下载。
- **G3**：生产构建的 Reader.vue 及其依赖中 `console.*` 调用数 = 0；开发期保留 `console.warn` / `console.error`（去掉前缀噪音）。
- **G4**：heartbeat 在 `document.visibilityState === 'hidden'` 时停止，回到前台再启动，不丢失已累积阅读时长。
- **G5**：行为零变化 — 现有功能（TXT / EPUB / PDF 渲染、书签、笔记、TTS、进度、目录、翻页动画）全部跑通。

## 3. 非目标（明确不做）

- 不修改 EPUB / PDF / TXT 渲染逻辑（业务行为不变）。
- 不做 ESLint / Prettier 配置（独立 spec 考虑）。
- 不清理 `any` 类型（独立 spec 考虑）。
- 不修改 `auth.init()` 串行问题（独立 spec 考虑）。
- 不做 network 资源缓存 / SWR（独立 spec 考虑）。
- 不做 Sentry / SEO meta / Cache-Control 头（独立 spec 考虑）。
- 不复核 RLS 安全策略（独立 spec 考虑）。
- 不修改 `useAnimations.ts` 死代码排查（独立 spec 考虑）。
- 不引入 Vitest 等测试框架。
- 不修改 `vite.config.ts` 的 chunk 策略（默认 manualChunks 够用；如阶段 1 后 chunk 划分不理想再开新 spec）。

## 4. 实施策略 — 两阶段

### 阶段 1：按需 import + console 清理 + heartbeat 暂停

**目的**：用最小 diff 解决 3 个独立可验证的痛点（bundle、噪音、电量）。Reader.vue 脚本结构不动。

**改动 1 — 新增 `frontend/src/composables/reader/lazyImport.ts`**

```ts
// 封装"按需 import + 错误兜底"模式
export async function loadEpubJs() {
  try {
    const mod = await import('epubjs')
    return mod.default ?? mod
  } catch (e) {
    throw new Error('阅读器组件加载失败，请刷新页面重试')
  }
}

export async function loadPdfJs() {
  const mod = await import('pdfjs-dist')
  // worker 路径：维持当前实现（本地 /pdf.worker.min.mjs）
  // 设置 GlobalWorkerOptions.workerSrc 的代码从 Reader.vue 搬过来
  return mod
}
```

**改动 2 — Reader.vue 改造 import**

| 现状 | 改造 |
|---|---|
| `import ePub from 'epubjs'`（顶层） | 删；改为在 `renderEpub` 函数内 `const ePub = await loadEpubJs()` |
| `import * as pdfjs from 'pdfjs-dist'`（顶层） | 删；改为在 `renderPdf` 内 `const pdfjs = await loadPdfJs()` |
| `pdfjs.GlobalWorkerOptions.workerSrc = …` | 搬到 `loadPdfJs` 内部 |

**改动 3 — 移除 `console.log`**

直接删除所有 `console.log('[reader] ...')` 调用（涉及文件 `Reader.vue`）。涉及行号（手工 grep 已确认 ≥ 20 处）：86, 98, 101, 110, 125, 135, 139, 145, 212, 219, 222, 225, 228, 231, 246, 263, 400, 426, 489, 497, 519 等。

`console.error` / `console.warn` 改为：

```ts
if (import.meta.env.DEV) console.error(/* message */)
```

Vite 生产构建会 dead-code eliminate；源码保持开发期可读。

**改动 4 — heartbeat 暂停**

`startHeartbeatLoop` / `stopHeartbeatLoop` 改造：

```ts
function startHeartbeatLoop() {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(reportHeartbeat, 30_000)
  document.addEventListener('visibilitychange', onVisibility)
}

function stopHeartbeatLoop() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  document.removeEventListener('visibilitychange', onVisibility)
  reportHeartbeat()  // 退出时立即上报剩余时长
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  } else {
    if (!heartbeatTimer) heartbeatTimer = setInterval(reportHeartbeat, 30_000)
  }
  // ach.lastHeartbeat 基准不动；下次 reportHeartbeat 会按真实时间差计算
  // 当前代码已有 Math.min(600, ...) 限制单次心跳上报最多 600 秒
}
```

### 阶段 2：Reader.vue 拆分为 composables

**目的**：在阶段 1 稳定后，重构 Reader.vue 内部结构。

**目标文件**（行数上限 = 250）：

| 文件 | 职责 | 大致行数 |
|---|---|---|
| `composables/useReaderHeartbeat.ts` | 心跳 + visibilitychange 暂停 | ~60 |
| `composables/useTxtReader.ts` | TXT state + renderTxt / applyTxtPage | ~150 |
| `composables/useEpubReader.ts` | EPUB state + renderEpub | ~250 |
| `composables/usePdfReader.ts` | PDF state + renderPdf | ~150 |
| `composables/useBookSideData.ts` | 书签、笔记、进度（loadSideData） | ~50 |
| `lib/reader/escapeHtml.ts` | 工具函数（现内联在 Reader.vue:286） | ~10 |
| `lib/reader/chapterRegex.ts` | TXT 章节正则（现内联在 Reader.vue:252） | ~10 |
| `lib/reader/pageSize.ts` | calcTxtPageSize（现内联在 Reader.vue:184-193） | ~20 |
| `components/reader/PanelSettings.vue` | 设置面板 | ~80 |
| `components/reader/PanelBookmarks.vue` | 书签面板 | ~60 |
| `components/reader/PanelNotes.vue` | 笔记面板 | ~80 |
| `components/reader/PanelTts.vue` | TTS 面板 | ~120 |
| `components/reader/PanelToc.vue` | 目录面板 | ~60 |
| `views/Reader.vue` | 顶层编排（mount 哪个 renderer、显示哪个 panel、状态机） | ≤ 250 |

**Composables 共享状态**：
- `useTxtReader` / `useEpubReader` / `usePdfReader` 通过 `ref` 暴露响应式 state（`txtPage` / `epubCurrentPage` / `progressPct` 等）。
- Reader.vue 持有所有 refs，通过 prop / emit 与子组件 / composables 通信。
- 关键：`readerRef`（DOM 引用）由 Reader.vue 提供，传入 composable；composable 不持有 ref，避免循环引用。

**按需 import 落地**：阶段 1 时 import 仍写在 Reader.vue 顶层（懒加载从 Reader.vue 出发）；阶段 2 把 import 搬到 `useEpubReader` / `usePdfReader` 内部，Reader.vue 不再直接 import epubjs / pdfjs。

**Vite chunk 划分期望**：
- TXT 用户：reader.js 入口 chunk 不含 epubjs.pdf.js。
- EPUB 用户：第一次进 EPUB 时下载 epubjs.js chunk。
- PDF 用户：第一次进 PDF 时下载 pdf.js + pdf.worker.min.mjs。

## 5. 错误处理

### 阶段 1 错误路径

- **lazy import 失败**（如网络问题导致 epubjs chunk 没下到）：
  - `loadEpubJs` 抛出 `new Error('阅读器组件加载失败，请刷新页面重试')`。
  - renderEpub 的 try/catch 捕获后，`error.value = e.message`。
  - UI 显示当前已有的 `error` 状态分支（不新增组件）。
  - 提供"重试"按钮 → 重新触发 `loadEpubJs()`。在 `loadEpubJs` 内加一个重试计数器（最多 2 次）避免死循环。

- **heartbeat 上报失败**：维持现状（`ach.heartbeat(...).catch(console.warn)`），不重试。

- **visibility 监听泄露**：`onBeforeUnmount` 调 `stopHeartbeatLoop()`，已经能清掉 visibility 监听（在新实现里封装到 stopHeartbeatLoop 内部）。

### 阶段 2 错误路径

- composable 内部错误向上抛，由 Reader.vue 顶层 try/catch 统一处理。
- 提取一个 `<ReaderError>` 组件（~20 行）统一显示错误状态 + 重试按钮，避免在 Reader.vue 模板里散落 `v-if="error"`。

## 6. 验证

### 阶段 1 验证（机械 + 手动）

1. **编译验证**：
   - `cd frontend && npm run build` 成功。
   - `vue-tsc -b` 无类型错误。
2. **Bundle 验证**：
   - 用 `npx vite-bundle-visualizer`（临时安装）生成可视化报告，对比改造前后 `reader` chunk 大小。
   - 预期：reader 入口 chunk 体积下降 ≥ 50%；epubjs / pdfjs 出现在独立 chunk。
3. **手测回归**（必须全过）：
   - 进入 TXT 书籍：DevTools Network 不出现 epubjs / pdfjs 资源。
   - 进入 EPUB 书籍：第一次进入时 Network 出现 epubjs chunk；刷新后命中缓存。
   - 进入 PDF 书籍：同上。
   - 标签页切到后台 30s：DevTools Performance 看 setInterval 不再触发；切回前台后 30s 第一次心跳。
   - 书签、笔记、TTS、目录跳转、翻页、进度保存 — 全部跑通。
4. **代码搜索验证**：
   - `rg "console\.(log|warn|error)" frontend/src/views/Reader.vue` — 应只剩 dev 守卫的 2-3 处 `console.error` / `console.warn`。
   - `rg "from 'epubjs'" frontend/src/views/Reader.vue` — 应为空。
   - `rg "from 'pdfjs-dist'" frontend/src/views/Reader.vue` — 应为空。

### 阶段 2 验证

1. Reader.vue ≤ 250 行（机械硬性要求；`wc -l frontend/src/views/Reader.vue`）。
2. 每个 composable 单独可导入：`node -e "import('./src/composables/useTxtReader.ts')"` 不会因缺上下文报错。
3. 阶段 1 的所有验证项再跑一遍。

### 测试方法

项目无单测框架（[package.json](frontend/package.json) devDependencies 无 vitest / jest）。本次以 **手测 + build verify + bundle size verify** 为主，**不引入新测试框架**（避免范围爆炸）。

## 7. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| 按需 import 导致 EPUB/PDF 首次加载比静态 import 慢（多一个 chunk 请求） | 用户感知：首次进入 EPUB/PDF 多 100-300ms | chunk 加 `prefetch` 提示；或回退到阶段 1 前的静态 import |
| console 清理误删有效诊断 | 线上问题难定位 | 引入 Sentry 后由其捕获（独立 spec） |
| heartbeat 暂停语义有误 | 阅读时长统计偏差 | `ach.lastHeartbeat` 基准不动，下次 report 上限 600s 已能容错 |
| Reader.vue 拆分时跨 composable 共享 ref 出现循环引用 | 编译/运行报错 | 用 `provide/inject` 或集中 store 协调；不要让 composable 之间互相 import |

## 8. 交付物

阶段 1：
- `frontend/src/composables/reader/lazyImport.ts`（新增）
- `frontend/src/views/Reader.vue`（修改：epubjs/pdfjs import 改为 lazy；console 清理；heartbeat visibilitychange）

阶段 2：
- `frontend/src/composables/useReaderHeartbeat.ts`（新增）
- `frontend/src/composables/useTxtReader.ts`（新增）
- `frontend/src/composables/useEpubReader.ts`（新增）
- `frontend/src/composables/usePdfReader.ts`（新增）
- `frontend/src/composables/useBookSideData.ts`（新增）
- `frontend/src/lib/reader/escapeHtml.ts`（新增）
- `frontend/src/lib/reader/chapterRegex.ts`（新增）
- `frontend/src/lib/reader/pageSize.ts`（新增）
- `frontend/src/components/reader/PanelSettings.vue`（新增）
- `frontend/src/components/reader/PanelBookmarks.vue`（新增）
- `frontend/src/components/reader/PanelNotes.vue`（新增）
- `frontend/src/components/reader/PanelTts.vue`（新增）
- `frontend/src/components/reader/PanelToc.vue`（新增）
- `frontend/src/views/Reader.vue`（大幅瘦身至 ≤ 250 行）

## 9. 后续 spec（不属本次范围）

按 ROI 排序的后续 spec 候选：
1. **状态管理**：auth.init() 并行 + onAuthStateChange 订阅清理 + reader store 早期应用。
2. **网络 / 缓存**：uploadBook 大文件分片 + 文件 URL 短时缓存 + SWR。
3. **UX 小修**：`timeAgo` 边界、calcTxtPageSize 响应式跳变、App.vue `pb-20` 条件 class 优化。
4. **代码质量**：清理 `any` + ESLint / Prettier + `useAnimations` 死代码排查。
5. **部署 / 监控**：Vercel `Cache-Control` 头 + Sentry 接入 + SEO meta。
6. **安全**：RLS 策略复核 + `maskEmail` 抓取风险。

每项独立 spec / plan / 实施。
