# Reader 性能与可维护性重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 [Reader.vue](frontend/src/views/Reader.vue) 从 1269 行降至 ≤ 250 行，移除所有生产期 `console.log`，让 `epubjs` / `pdfjs-dist` 按需加载（首屏 reader 入口 chunk 下降 ≥ 50%），并让 30s heartbeat 在标签页隐藏时暂停。

**Architecture:** 两阶段实施 — 阶段 1 改 Reader.vue 内部（按需 import + console 清理 + heartbeat visibilitychange），阶段 2 把 Reader.vue 拆为 4 个 composables + 5 个 panel 子组件 + 3 个工具模块。Reader.vue 自身只做顶层编排。

**Tech Stack:** Vue 3 (Composition API) + Vite + TypeScript + Pinia + Tailwind。运行时库：`epubjs`、`pdfjs-dist`、Supabase JS client。

**Spec:** [docs/superpowers/specs/2026-06-22-reader-perf-refactor-design.md](docs/superpowers/specs/2026-06-22-reader-perf-refactor-design.md)

**Working Directory:** `frontend/`

---

## Conventions

- **Commit 粒度**：每个 Task 至少 1 个 commit；commit message 英文，遵循 `feat:` / `fix:` / `refactor:` / `chore:` 前缀。
- **TypeScript 严格度**：保持项目当前 `tsconfig.json` 设置（`strict: true`），不要新增 `any`，除非必要且加注释。
- **运行时验证**：
  - 每个 Task 完成后跑 `cd frontend && npm run build`（应通过）。
  - 阶段 1 结束 + 阶段 2 结束各跑一次完整手测回归（见 Task 11 / Task 21）。
- **范围红线**：不动 `vite.config.ts` 的 chunk 策略；不引入 vitest / jest；不动其他 view（Home / Library / Store 等）只动 Reader.vue 及其新增/被引入文件；不动 `useAnimations.ts` / `any` 清理 / `auth.init` 串行 / SEO / Sentry / RLS（这些都属后续 spec）。
- **路径说明**：所有相对路径以 `frontend/` 为根，例如 `src/views/Reader.vue` 即指 `frontend/src/views/Reader.vue`。

---

# 阶段 1：按需 import + console 清理 + heartbeat 暂停

**目的**：最小 diff 解决 bundle / 噪音 / 电量三个独立可验证的痛点。Reader.vue 脚本结构不动。

---

## Task 1: 新增 lazyImport 模块

**Files:**
- Create: `src/composables/reader/lazyImport.ts`

- [ ] **Step 1: 创建 lazyImport.ts**

写入 `frontend/src/composables/reader/lazyImport.ts`：

```ts
// src/composables/reader/lazyImport.ts
// 封装"按需 import + 错误兜底"模式 —— Reader.vue 阶段 1 重构引入

const RETRY_LIMIT = 2
const retryCount = new Map<string, number>()

async function withRetry<T>(key: string, loader: () => Promise<T>): Promise<T> {
  try {
    const result = await loader()
    retryCount.delete(key)
    return result
  } catch (e) {
    const count = (retryCount.get(key) ?? 0) + 1
    retryCount.set(key, count)
    if (count >= RETRY_LIMIT) {
      retryCount.delete(key)
      throw new Error('阅读器组件加载失败，请刷新页面重试')
    }
    return loader()
  }
}

/** 按需加载 epubjs。返回 epubjs 的 Book 构造器（default export）。 */
export async function loadEpubJs() {
  return withRetry('epubjs', async () => {
    const mod = await import('epubjs')
    return (mod as any).default ?? mod
  })
}

/** 按需加载 pdfjs-dist，并配置 worker。 */
export async function loadPdfJs() {
  return withRetry('pdfjs-dist', async () => {
    const mod: any = await import('pdfjs-dist')
    const workerMod: any = await import('pdfjs-dist/build/pdf.worker.mjs?url')
    mod.GlobalWorkerOptions.workerSrc = workerMod.default
    return mod
  })
}
```

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误（TypeScript 检查通过；模块未被实际使用也无副作用）。

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/composables/reader/lazyImport.ts
git commit -m "feat(reader): add lazyImport helper for epubjs / pdfjs-dist"
```

---

## Task 2: Reader.vue 改 epubjs 为按需 import

**Files:**
- Modify: `src/views/Reader.vue:1-12`（import 段）、`src/views/Reader.vue:379-381`（renderEpub 第一行）

- [ ] **Step 1: 删除顶层 epubjs import**

打开 `frontend/src/views/Reader.vue`，找到 `<script setup lang="ts">` 段，删除 `import ePub from 'epubjs'`（如果存在）这一行。`grep "epubjs" src/views/Reader.vue` 应只命中：

- 顶部 import 区域之外（修改后清空）
- `renderEpub` 函数内部（下一步改造）

如果当前没有顶层 epubjs import（之前用 `await import('epubjs')` 内部动态加载），跳过删除步骤，直接下一步。

- [ ] **Step 2: 改 renderEpub 的 epubjs 加载为 lazyImport**

定位 `renderEpub` 函数体，找到形如：

```ts
const ePub = (await import('epubjs')).default
```

替换为：

```ts
const ePub = await loadEpubJs()
```

并在 `<script setup>` 顶部 import 区域加入：

```ts
import { loadEpubJs } from '@/composables/reader/lazyImport'
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: 手动验证 EPUB 加载**

启动 dev server：

```bash
cd frontend && npm run dev
```

打开浏览器，进 Reader 选择一本 EPUB 书籍，DevTools Network 面板应能看到新增的 `epub` 命名的 chunk 文件被请求。在控制台执行：

```js
import('epubjs').then(() => console.log('epubjs loaded'))
```

应能成功导入（说明 lazyImport 工作正常）。

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/views/Reader.vue
git commit -m "refactor(reader): lazy import epubjs via loadEpubJs"
```

---

## Task 3: Reader.vue 改 pdfjs-dist 为按需 import

**Files:**
- Modify: `src/views/Reader.vue:548-552`（renderPdf 头部）

- [ ] **Step 1: 改 renderPdf 头部**

定位 `renderPdf` 函数前两行（原文为 `const pdfjs = await import('pdfjs-dist')` + worker 配置），替换整段为：

```ts
const pdfjs = await loadPdfJs()
```

确保 `<script setup>` 顶部 import 已包含 `loadPdfJs`（Task 2 已加）。如果未加，加入：

```ts
import { loadEpubJs, loadPdfJs } from '@/composables/reader/lazyImport'
```

- [ ] **Step 2: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: 手动验证 PDF 加载**

`npm run dev` 启动后进 Reader 选择一本 PDF 书籍，DevTools Network 面板应能看到 `pdfjs-dist` 相关 chunk 被请求。TXT 书籍应不触发。

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/views/Reader.vue
git commit -m "refactor(reader): lazy import pdfjs-dist via loadPdfJs"
```

---

## Task 4: 移除 Reader.vue 中所有 console.log

**Files:**
- Modify: `src/views/Reader.vue`（删除 `console.log('[reader] ...')` 共 20+ 处）

- [ ] **Step 1: 列出全部待删除的 console.log**

在 `frontend/` 目录执行：

```bash
grep -n "console\.log" src/views/Reader.vue
```

应输出至少 20 行（已知行号：86, 98, 101, 110, 125, 135, 139, 145, 212, 219, 222, 225, 228, 231, 246, 263, 400, 426, 489, 497, 519）。如有差异，以 grep 实际输出为准。

- [ ] **Step 2: 删除所有 console.log**

对 grep 输出的每一行，整行删除（连同前面的缩进）。逐行确认上下文：

- `console.log('[reader] onMounted, bookId =', bookId.value)` → 直接删除
- `console.log('[reader] txt decoded length =', text.length, 'bytes =', buf.byteLength)` → 直接删除
- `console.log('[reader] epub fetched, bytes =', (bookInput as ArrayBuffer).byteLength)` → 直接删除
- `console.log('[reader] book closed')`（epubjs closed 回调）→ 直接删除
- 等等

注意：删除的是**整行**而不是仅替换；删除后保留上下文语义。

- [ ] **Step 3: 验证没有残留 console.log**

```bash
grep -n "console\.log" src/views/Reader.vue
```

Expected: 无输出。

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/views/Reader.vue
git commit -m "chore(reader): remove 20+ debug console.log calls"
```

---

## Task 5: 给剩余 console.error / console.warn 加 DEV 守卫

**Files:**
- Modify: `src/views/Reader.vue`（所有 `console.error(...)` / `console.warn(...)` 调用）

- [ ] **Step 1: 列出所有 console.error / console.warn**

```bash
grep -n "console\.\(error\|warn\)" src/views/Reader.vue
```

预计命中 ~10 处（含 `console.error('[reader] …')` 和 `console.warn('[reader] …')`）。

- [ ] **Step 2: 改造为 DEV 守卫 + 去前缀**

对每一处，改为：

```ts
if (import.meta.env.DEV) console.error(/* 原 message，删除 [reader] 前缀 */)
```

示例（来自 Reader.vue:402-403）：

原：
```ts
} catch (e) {
  console.error('[reader] epub download failed, falling back to URL', e)
```

改为：
```ts
} catch (e) {
  if (import.meta.env.DEV) console.error('epub download failed, falling back to URL', e)
```

对 `console.warn` 同理。

特例：`onBeforeUnmount` 内的 `stopHeartbeatLoop` 等不涉及 console；只动 grep 命中的行。

- [ ] **Step 3: 验证编译 + 搜索**

```bash
cd frontend && npx vue-tsc --noEmit
grep -n "console\." src/views/Reader.vue
```

Expected: 编译无错；grep 输出全部为 `if (import.meta.env.DEV) console.xxx(...)` 形式。

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/views/Reader.vue
git commit -m "chore(reader): guard console.error/warn with import.meta.env.DEV"
```

---

## Task 6: heartbeat 支持 visibilitychange 暂停

**Files:**
- Modify: `src/views/Reader.vue:71-83`（`startHeartbeatLoop` / `stopHeartbeatLoop` 函数）、`src/views/Reader.vue:663-673`（`onBeforeUnmount`）

- [ ] **Step 1: 改造 start/stopHeartbeatLoop**

定位 `startHeartbeatLoop` 与 `stopHeartbeatLoop`（约 71-83 行附近）。将整个函数块替换为：

```ts
let heartbeatTimer: any = null
let visibilityHandler: (() => void) | null = null

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  } else {
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(reportHeartbeat, 30_000)
    }
  }
  // 基准 ach.lastHeartbeat 保持不变；
  // reportHeartbeat 内部已有 Math.min(600, ...) 上限
}

function startHeartbeatLoop() {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(reportHeartbeat, 30_000)
  visibilityHandler = onVisibilityChange
  document.addEventListener('visibilitychange', visibilityHandler)
}

function stopHeartbeatLoop() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  // 退出时立即上报剩余阅读时长
  reportHeartbeat()
}
```

注：保留原文件里的 `let heartbeatTimer: any` 声明（如果原本在文件顶部声明），与新代码块**合并**到同一处声明（删除文件顶部的 `let heartbeatTimer: any`，在 `onVisibilityChange` 附近声明即可）。

- [ ] **Step 2: 验证 onBeforeUnmount 仍正确清理**

定位 `onBeforeUnmount`（约 663-673 行）。`stopHeartbeatLoop()` 调用保持不变 — 新的实现已经处理 visibility 监听清理。

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: 手动验证**

`npm run dev` 启动后打开 Reader 看任意一本书：
1. DevTools 控制台输入 `console.log` 或 DevTools Performance 录制几秒，验证 `setInterval` 触发。
2. 切到另一个标签页 30s+，再切回。Performance 录制显示后台期间无 setInterval 触发。
3. 切回前台后 30s 内应触发一次新心跳（查看 Network 应有 `heartbeat` 请求）。

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/views/Reader.vue
git commit -m "feat(reader): pause heartbeat on visibility hidden"
```

---

## Task 7: 阶段 1 build + bundle 验证

**Files:**（无改动）

- [ ] **Step 1: 完整 build**

```bash
cd frontend && npm run build
```

Expected: 成功生成 `dist/`，vue-tsc 无错误。

- [ ] **Step 2: bundle 验证（用 rollup-plugin-visualizer）**

在 `frontend/` 临时安装可视化器：

```bash
cd frontend && npm install --save-dev rollup-plugin-visualizer
```

打开 `frontend/vite.config.ts`，在 plugins 数组末尾加入：

```ts
import { visualizer } from 'rollup-plugin-visualizer'
// ...
plugins: [
  vue(),
  // 原有 plugins...
  visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true }),
],
```

重新 build：

```bash
cd frontend && npm run build
```

打开 `frontend/dist/stats.html`，确认：
- `epubjs` / `pdfjs-dist` 出现在独立 chunk，不在 `Reader` 相关 chunk 入口。
- reader 入口 chunk 体积记录（数字记下来用于 Task 11 对比）。

- [ ] **Step 3: 还原 vite.config.ts**

回退 vite.config.ts 的 visualizer 改动（避免污染主配置）。从 devDependencies 移除：

```bash
cd frontend && npm uninstall rollup-plugin-visualizer
```

- [ ] **Step 4: 阶段 1 完整手测回归**

按以下顺序跑：

1. `npm run dev` 启动
2. 登录账号 / 注册（如未登录）
3. Library → 选 TXT 书籍 → Reader 打开 → 翻页正常、书签 / 笔记 / 进度保存
4. Library → 选 EPUB 书籍 → Reader 打开 → 翻页、目录、笔记（iframe 内选中保存）正常
5. Library → 选 PDF 书籍 → Reader 打开 → 翻页正常
6. 任意书籍 → TTS 朗读 → 暂停 / 恢复 / 调速 / 切页 → 行为正常
7. 任意书籍 → 标签页切到后台 30s+ → Network 没有新 heartbeat 请求
8. 切回前台 → 30s 内 Network 有 heartbeat 请求
9. 切到其他 view（Home / Library / Me）→ 切回 Reader → 行为正常

如有失败，**先修复**再进入 Task 8。

- [ ] **Step 5: Commit（可能无）**

如步骤 3 已还原 vite.config.ts 无遗留改动，**跳过此 commit**。如有清理，commit：

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/vite.config.ts frontend/package.json frontend/package-lock.json
git commit -m "chore: temp remove rollup-plugin-visualizer (verified bundle, not shipping)"
```

> 注：通常情况下 vite.config.ts 在步骤 3 已还原到原状，git 应无 diff，commit 会被 git 拒绝。属正常，跳过 commit 即可。

---

# 阶段 2：Reader.vue 拆分为 composables + 子组件

**目的**：把 1269 行 Reader.vue 拆为 4 个 composables + 5 个 panel 子组件 + 3 个工具模块，Reader.vue ≤ 250 行做顶层编排。

**前置**：阶段 1 全部 commit 已落地。

---

## Task 8: 抽取工具函数到 lib/reader/

**Files:**
- Create: `src/lib/reader/escapeHtml.ts`
- Create: `src/lib/reader/chapterRegex.ts`
- Create: `src/lib/reader/pageSize.ts`
- Modify: `src/views/Reader.vue:184-193`、`src/views/Reader.vue:252`、`src/views/Reader.vue:356-358`

- [ ] **Step 1: 创建 escapeHtml.ts**

写入 `frontend/src/lib/reader/escapeHtml.ts`：

```ts
// src/lib/reader/escapeHtml.ts
const MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => MAP[c]!)
}
```

- [ ] **Step 2: 创建 chapterRegex.ts**

写入 `frontend/src/lib/reader/chapterRegex.ts`：

```ts
// src/lib/reader/chapterRegex.ts

/**
 * 识别 TXT 章节标题的正则。匹配：
 * - 第N章 / 第N节 / 第N回 / 第N卷 / 第N篇 / 第N集 / 第N部（N 为中文数字或阿拉伯数字）
 * - 序章 / 序言 / 前言 / 楔子 / 尾声 / 番外 / 后记
 * - Chapter 1 / CHAPTER 1 / CHAPTER IV（不区分大小写）
 */
export const CHAPTER_RE = /^(?:\s*)(第[\d一-龥一二三四五六七八九十百千零两]+[章节回卷篇集部]|序章|序言|前言|楔子|尾声|番外|后记|Chapter\s+\d+|CHAPTER\s+\d+|CHAPTER\s+[IVX]+)/i

export interface TxtChapter {
  id: string
  label: string
  index: number
}

/** 扫描纯文本，识别章节标题。返回章节列表（id 顺序递增）。 */
export function detectTxtChapters(text: string): TxtChapter[] {
  const lines = text.split(/\r?\n/)
  const found: TxtChapter[] = []
  let charPos = 0
  for (let i = 0; i < lines.length; i++) {
    if (CHAPTER_RE.test(lines[i])) {
      found.push({
        id: 'txt-ch-' + found.length,
        label: lines[i].trim().slice(0, 60),
        index: charPos,
      })
    }
    charPos += lines[i].length + 1
  }
  return found
}
```

- [ ] **Step 3: 创建 pageSize.ts**

写入 `frontend/src/lib/reader/pageSize.ts`：

```ts
// src/lib/reader/pageSize.ts

/**
 * 根据视口高度动态计算每页字符数。
 *
 * 注意：当前实现基于硬编码值（lineHeight=32, charsPerLine=18），在窗口尺寸变化时
 * 返回值会跳变，导致 txtTotalPages 跳变。本 spec 阶段 2 不修复该问题（属独立 spec）。
 * 阶段 2 仅做抽取。
 */
export function calcTxtPageSize(containerEl: HTMLElement | null): number {
  const vh = containerEl?.clientHeight || window.innerHeight - 120
  const lineHeight = 32   // 18px * 1.8 行高
  const padding = 48
  const linesPerPage = Math.floor((vh - padding) / lineHeight)
  const charsPerLine = 18
  return Math.max(300, linesPerPage * charsPerLine)
}
```

- [ ] **Step 4: 在 Reader.vue 中替换工具调用**

定位 Reader.vue 中：
- `function escapeHtml(s: string) { ... }`（约 356-358 行）→ **整块删除**
- TXT 章节正则（`const chRe = ...` 那一行，约 252 行）→ **整行删除**
- TXT 章节扫描循环（约 253-262 行）→ **整段删除**
- `function calcTxtPageSize(): number { ... }`（约 184-193 行）→ **整块删除**

在 `<script setup>` 顶部 import 区域加入：

```ts
import { escapeHtml } from '@/lib/reader/escapeHtml'
import { detectTxtChapters } from '@/lib/reader/chapterRegex'
import { calcTxtPageSize } from '@/lib/reader/pageSize'
```

更新 `renderTxt` 中原章节扫描代码（现已删除）替换为：

```ts
chapters.value = detectTxtChapters(text)
```

把所有 `calcTxtPageSize()` 调用（约 4 处：184, 248, 277, 305, 694 等）改为 `calcTxtPageSize(readerRef.value)`。注意调用上下文，确保 `readerRef` 已声明。

- [ ] **Step 5: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 6: 手动验证 TXT 渲染**

`npm run dev` 后打开任意 TXT 书籍，确认：
- 章节列表（TOC）正常显示（说明 `detectTxtChapters` 工作）
- 翻页 / 进度 / 书签正常（说明 `calcTxtPageSize(readerRef.value)` 工作）
- HTML 转义正常（输入含 `<script>` 的内容无执行风险；说明 `escapeHtml` 引用正确）

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/lib/reader/ frontend/src/views/Reader.vue
git commit -m "refactor(reader): extract escapeHtml, chapterRegex, pageSize to lib/reader"
```

---

## Task 9: 抽取心跳到 useReaderHeartbeat composable

**Files:**
- Create: `src/composables/useReaderHeartbeat.ts`
- Modify: `src/views/Reader.vue`（删除原 heartbeat 代码，改用 composable）

- [ ] **Step 1: 创建 useReaderHeartbeat.ts**

写入 `frontend/src/composables/useReaderHeartbeat.ts`：

```ts
// src/composables/useReaderHeartbeat.ts
import { onBeforeUnmount, onMounted } from 'vue'
import { useAchievementsStore } from '@/stores/achievements'

/**
 * 阅读器心跳 composable。
 * 每 30s 上报一次估算阅读时长；标签页隐藏时停止，回到前台后恢复。
 * 退出时立即上报剩余时长。
 */
export function useReaderHeartbeat(opts: {
  getBookId: () => string | undefined
  getProgressPct: () => number
  intervalMs?: number
}) {
  const interval = opts.intervalMs ?? 30_000
  const ach = useAchievementsStore()

  let timer: ReturnType<typeof setInterval> | null = null
  let visibilityHandler: (() => void) | null = null

  function report() {
    const bookId = opts.getBookId()
    if (!bookId) return
    const now = Date.now()
    const last = ach.lastHeartbeat || now
    const seconds = Math.max(0, Math.min(600, Math.round((now - last) / 1000)))
    if (seconds > 0) {
      const wordsRead = Math.max(1, Math.round(opts.getProgressPct() * 5 / Math.max(1, seconds)))
      ach.heartbeat(bookId, wordsRead).catch((e: any) => {
        if (import.meta.env.DEV) console.error('heartbeat failed', e)
      })
    }
    ach.lastHeartbeat = now
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      if (timer) { clearInterval(timer); timer = null }
    } else {
      if (!timer) timer = setInterval(report, interval)
    }
  }

  function start() {
    if (timer) return
    timer = setInterval(report, interval)
    visibilityHandler = onVisibility
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
    report()
  }

  onMounted(start)
  onBeforeUnmount(stop)

  return { start, stop, report }
}
```

- [ ] **Step 2: 在 Reader.vue 替换**

定位 Reader.vue 中：
- `function reportHeartbeat()` 整块（57-69 行附近）
- `function startHeartbeatLoop()` 整块（约 71-74 行）
- `function stopHeartbeatLoop()` 整块（约 76-83 行）
- `onMounted` 内的 `startHeartbeatLoop()` 调用（约 92 行）
- `onBeforeUnmount` 内的 `stopHeartbeatLoop()` 调用（约 671 行）

全部删除。

在 `<script setup>` 顶部 import 区域加入：

```ts
import { useReaderHeartbeat } from '@/composables/useReaderHeartbeat'
```

在 `<script setup>` 主体的开头（import 之后、其它 ref 声明之前）加入：

```ts
useReaderHeartbeat({
  getBookId: () => bookId.value,
  getProgressPct: () => progressPct.value,
})
```

注：`bookId` / `progressPct` 是已有的 ref / computed；引用它们是允许的，因为脚本在 setup 顶层解析。

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: 手动验证心跳**

`npm run dev` 进任意 Reader：
1. DevTools Performance 录制 60s，确认 `setInterval` 周期性触发。
2. 切到后台标签 30s+ 再切回。Performance 录制显示后台无 setInterval 触发；切回后 30s 内重新触发。
3. 退出 Reader 时（跳到其它 view）`onBeforeUnmount` 触发 stop，确认 stop 内部最后调用 `report()` 上报。

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/composables/useReaderHeartbeat.ts frontend/src/views/Reader.vue
git commit -m "refactor(reader): extract heartbeat to useReaderHeartbeat composable"
```

---

## Task 10: 抽取书签 / 笔记到 useBookSideData composable

**Files:**
- Create: `src/composables/useBookSideData.ts`
- Modify: `src/views/Reader.vue`（删除 bookmarks / notes / newNoteText 相关代码）

- [ ] **Step 1: 创建 useBookSideData.ts**

写入 `frontend/src/composables/useBookSideData.ts`：

```ts
// src/composables/useBookSideData.ts
import { ref, computed, onMounted, onActivated } from 'vue'
import { listBookmarks, listNotes, addNote, deleteBookmark, deleteNote } from '@/lib/books'
import type { Bookmark, Note } from '@/types'

/**
 * 阅读器侧边数据 composable：书签、笔记。
 * 暴露列表 / 新增 / 删除方法，组件挂载时自动 load。
 */
export function useBookSideData(opts: { getBookId: () => string | undefined }) {
  const bookmarks = ref<Bookmark[]>([])
  const notes = ref<Note[]>([])
  const newNoteText = ref('')

  async function load() {
    const bookId = opts.getBookId()
    if (!bookId) return
    const [b, n] = await Promise.all([listBookmarks(bookId), listNotes(bookId)])
    bookmarks.value = b
    notes.value = n
  }

  async function addNoteNow(content: string, cfi?: string | null) {
    const bookId = opts.getBookId()
    if (!bookId || !content.trim()) return
    const n = await addNote({
      book_id: bookId,
      cfi: cfi ?? null,
      page: null,
      content,
      comment: null,
      color: '#fbbf24',
    })
    notes.value.unshift(n)
  }

  async function removeBookmark(id: string) {
    await deleteBookmark(id)
    bookmarks.value = bookmarks.value.filter(b => b.id !== id)
  }

  async function removeNote(id: string) {
    await deleteNote(id)
    notes.value = notes.value.filter(n => n.id !== id)
  }

  onMounted(load)

  return {
    bookmarks,
    notes,
    newNoteText,
    load,
    addNote: addNoteNow,
    removeBookmark,
    removeNote,
  }
}
```

- [ ] **Step 2: 在 Reader.vue 替换**

定位 Reader.vue 中（约 38-40 行）：

```ts
const bookmarks = ref<Bookmark[]>([])
const notes = ref<Note[]>([])
const newNoteText = ref('')
```

整块替换为：

```ts
const sideData = useBookSideData({ getBookId: () => bookId.value })
const { bookmarks, notes, newNoteText, load: loadSideData, addNote: addNoteLocal, removeBookmark, removeNote } = sideData
```

**注意**：保留 `loadSideData` 这个名字引用，因为模板和 renderEpub 里（rendition.on('selected', ...).then(...) 模式）已经用过 `addNote(...)`。如果模板里直接引用 `addNote`，现在它指向 composable 暴露的版本（功能已包含 `notes.value.unshift(n)`），可直接用；旧的 `import { addNote } from '@/lib/books'` 仍可保留，模板里如有直接调用 `addNote({...})` 模式（不带 cfi），可以保持旧的 `addNote` 别名，composable 的 `addNote` 通过 `addNoteLocal` 区分。仔细查看 Reader.vue:535-543 的用法：

```ts
addNote({
  book_id: bookId.value,
  cfi: cfiRange,
  page: null,
  content: sel?.toString() || '',
  comment: null,
  color: '#fbbf24',
}).then((n) => notes.value.unshift(n))
```

该用法调用 `addNote` 后 `.then` 把新 note unshift 进 notes。可改为 `addNoteLocal(sel?.toString() || '', cfiRange)`，composable 内部已经 unshift。或者保留 `addNote` 直接 import 形式（不影响）。为最小 diff，**保留原 import 的 `addNote`**，删除局部 `addNoteLocal` 别名。

最终替换为：

```ts
const sideData = useBookSideData({ getBookId: () => bookId.value })
const { bookmarks, notes, newNoteText, load: loadSideData, removeBookmark, removeNote } = sideData
```

并删除 `loadSideData` 旧定义（约 167-171 行），因为 composable 已自动 onMounted load。但 `loadSideData` 在 `onMounted` 内被显式调用（约 141 行 `await loadSideData()`）—— 删除该显式调用，因为 composable 内部已 `onMounted(load)`，**会重复**。

修正：`useBookSideData` 内部已 `onMounted(load)`，因此显式 `await loadSideData()` 应**删除**。如有重复加载导致 notes/bookmarks 状态错误，**改为**用 `await sideData.load()` 替代，或者保留 `loadSideData` 但 disable onMounted 自动 load — 本任务选**第二种**，更安全。

修改 `useBookSideData.ts`：移除 `onMounted(load)` 行，改为在 `onActivated(load)` + 返回 `load` 方法。已写过的代码保留 onMounted — 重新打开文件修改：

把：
```ts
onMounted(load)
```

替换为：
```ts
onActivated(load)
```

并在 Reader.vue 中 `onMounted` 内显式 `await loadSideData()` 调用**保留**（替换旧定义后用新别名即可）。

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: 手动验证侧边数据**

`npm run dev` 进 Reader：
1. 打开书签面板 → 列表正常显示（如有书签）
2. 打开笔记面板 → 列表正常显示
3. 新增笔记 → 笔记出现并 unshift 到列表头
4. 删除笔记 / 书签 → 列表立即更新
5. 切到其他 view → 切回 Reader → 笔记 / 书签重新加载（onActivated）

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/composables/useBookSideData.ts frontend/src/views/Reader.vue
git commit -m "refactor(reader): extract bookmarks/notes to useBookSideData composable"
```

---

## Task 11: 抽取 TXT 渲染到 useTxtReader composable

**Files:**
- Create: `src/composables/useTxtReader.ts`
- Modify: `src/views/Reader.vue`（删除 TXT 渲染相关 state + 函数）

- [ ] **Step 1: 创建 useTxtReader.ts**

写入 `frontend/src/composables/useTxtReader.ts`：

```ts
// src/composables/useTxtReader.ts
import { ref } from 'vue'
import { getProgress, upsertProgress } from '@/lib/books'
import { detectTxtChapters } from '@/lib/reader/chapterRegex'
import { calcTxtPageSize } from '@/lib/reader/pageSize'
import { escapeHtml } from '@/lib/reader/escapeHtml'

/**
 * TXT 渲染 composable。
 * 暴露 txtContent / page state / pageSize / render / apply / prev / next / jumpToChapter。
 */
export function useTxtReader(opts: {
  getBookId: () => string | undefined
  getFileUrl: () => string
  getReaderRef: () => HTMLElement | null
  onProgressChange: (pct: number, page: number) => void
}) {
  const txtContent = ref('')
  const txtPage = ref(0)
  const txtTotalPages = ref(1)
  const txtSlideDir = ref<'next' | 'prev' | ''>('')
  const chapters = ref<Array<{ id: string; label: string; cfi?: string; index: number }>>([])

  let progressTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleSaveProgress() {
    if (progressTimer) clearTimeout(progressTimer)
    const bookId = opts.getBookId()
    if (!bookId) return
    progressTimer = setTimeout(() => {
      upsertProgress({
        book_id: bookId,
        cfi: null,
        page: txtPage.value + 1,
        percentage: ((txtPage.value + 1) / txtTotalPages.value) * 100,
      }).catch(() => {})
    }, 1500)
  }

  function applyPage() {
    const el = opts.getReaderRef()
    if (!el) return
    const pageSize = calcTxtPageSize(el)
    const start = txtPage.value * pageSize
    let slice = txtContent.value.slice(start, start + pageSize)
    const nextBreak = slice.indexOf('\n\n', Math.max(0, slice.length - 300))
    if (nextBreak > 0 && txtPage.value < txtTotalPages.value - 1) {
      slice = slice.slice(0, nextBreak)
    }
    el.innerHTML = slice
      .split(/\n\s*\n/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
      .join('')
    if (txtSlideDir.value) {
      el.classList.remove('page-turn-next', 'page-turn-prev')
      void el.offsetWidth
      el.classList.add(txtSlideDir.value === 'next' ? 'page-turn-next' : 'page-turn-prev')
    }
    txtTotalPages.value = Math.max(1, Math.ceil(txtContent.value.length / pageSize))
    const pct = ((txtPage.value + 1) / txtTotalPages.value) * 100
    opts.onProgressChange(pct, txtPage.value + 1)
    scheduleSaveProgress()
  }

  async function render() {
    const res = await fetch(opts.getFileUrl())
    if (!res.ok) throw new Error('下载失败：HTTP ' + res.status)
    const buf = await res.arrayBuffer()
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    txtContent.value = text
    const pageSize = calcTxtPageSize(opts.getReaderRef())
    txtTotalPages.value = Math.max(1, Math.ceil(text.length / pageSize))
    chapters.value = detectTxtChapters(text)

    const bookId = opts.getBookId()
    const prog = bookId ? await getProgress(bookId) : null
    if (prog?.page) {
      txtPage.value = Math.min(prog.page, txtTotalPages.value - 1)
    } else {
      txtPage.value = 0
    }
    applyPage()
  }

  function prev() {
    if (txtPage.value > 0) {
      txtSlideDir.value = 'prev'
      txtPage.value--
      applyPage()
      txtSlideDir.value = ''
    }
  }
  function next() {
    if (txtPage.value < txtTotalPages.value - 1) {
      txtSlideDir.value = 'next'
      txtPage.value++
      applyPage()
      txtSlideDir.value = ''
    }
  }
  function jumpToChapter(index: number) {
    const ch = chapters.value.find(c => c.index === index)
    if (!ch) return
    const pageSize = calcTxtPageSize(opts.getReaderRef())
    txtPage.value = Math.max(0, Math.floor((ch.index ?? 0) / pageSize))
    applyPage()
  }
  function jumpToPage(page: number) {
    txtPage.value = Math.max(0, Math.min(page - 1, txtTotalPages.value - 1))
    applyPage()
  }

  return {
    txtContent, txtPage, txtTotalPages, txtSlideDir, chapters,
    render, applyPage, prev, next, jumpToChapter, jumpToPage,
  }
}
```

- [ ] **Step 2: 在 Reader.vue 删除重复 state 和函数**

定位 Reader.vue 中以下声明 / 函数，**整块删除**：

- `const txtContent = ref('')`（约 175 行）
- `const txtPage = ref(0)`（约 176 行）
- `const txtTotalPages = ref(1)`（约 177 行）
- `const txtSlideDir = ref<'next' | 'prev' | ''>('')`（约 179 行）
- `function applyTxtPage()` 整块（约 274-298 行）
- `async function renderTxt()` 整块（约 238-272 行）
- `function txtPrev()` 整行（约 325 行）
- `function txtNext()` 整行（约 326 行）
- `let jumpToChapter = ...` 与 `function gotoEpubChapter(...)` 相关的 txt 跳转段（约 302-308 行）
- `chapterRegex` 引用（已 Task 8 删除）

在 `<script setup>` 顶部 import 区域加入：

```ts
import { useTxtReader } from '@/composables/useTxtReader'
```

在主体加入：

```ts
const txt = useTxtReader({
  getBookId: () => bookId.value,
  getFileUrl: () => fileUrl.value,
  getReaderRef: () => readerRef.value,
  onProgressChange: (pct) => { progressPct.value = pct },
})
```

并把模板 / 函数中以下引用替换为 composable 暴露的版本：

| 旧 | 新 |
|---|---|
| `txtContent.value`（在 `renderEpub` / TTS 中读取） | `txt.txtContent.value` |
| `txtPage.value` | `txt.txtPage.value` |
| `txtTotalPages.value` | `txt.txtTotalPages.value` |
| `txtSlideDir.value` | `txt.txtSlideDir.value` |
| `chapters.value`（TXT 部分） | `txt.chapters.value` |
| `applyTxtPage()` | `txt.applyPage()` |
| `txtPrev()` | `txt.prev()` |
| `txtNext()` | `txt.next()` |
| `jumpToChapter`（TXT 调用） | `txt.jumpToChapter` |

`renderTxt` 在 `renderReader` 内的调用（`else if (format === 'txt') { ... }` 段）改为：

```ts
await txt.render()
```

注意：`chapters.value` 在 PDF / EPUB 也有赋值 — composable 内部暴露 `chapters` 是局部的；PDF / EPUB 直接用 Reader.vue 顶层 `chapters` 即可，**与 `txt.chapters` 分离**。如果需要共享，把 chapters 提升到 Reader.vue 顶层 ref，composable 不再持有 chapters。

为避免过度重构，本步骤**保留** Reader.vue 顶层 `chapters` ref（用于 PDF / EPUB），TXT 章节扫描结果通过 `txt.chapters` 暴露但实际**忽略**。EPUB / PDF 的 chapters 赋值继续用顶层 `chapters.value = ...`。

但当前 `renderTxt` 内有 `chapters.value = found` 这一行（删除后这一行没了），TXT 章节就不进顶层 chapters。这是行为变化。

**修正**：在 `useTxtReader.ts` 中，TXT 的 render 完成后回调 `onChapters`：

把 `onProgressChange` 旁边的 `onChapters` 加入：

```ts
opts.onChapters?.(chapters.value)
```

但需在 `useTxtReader` 接口中声明 `onChapters`：

```ts
onChapters?: (ch: typeof chapters.value) => void
```

并在 `render()` 内 `chapters.value = detectTxtChapters(text)` 后调用 `opts.onChapters?.(chapters.value)`。

在 Reader.vue 调用处加：

```ts
const txt = useTxtReader({
  ...,
  onProgressChange: (pct) => { progressPct.value = pct },
  onChapters: (ch) => { chapters.value = ch as any },
})
```

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: 手动验证 TXT**

`npm run dev` 后打开 TXT 书籍：
- 翻页正常（前 / 后）
- 章节列表（TOC）显示（说明 `onChapters` 回调工作）
- 进度保存（翻页后 Network 有 progress 请求）
- 进度恢复（关闭再打开同一本书，进度正确）
- TTS 朗读 → 暂停 / 恢复 / 调速 / 切页（如原 TTS 用 `txtContent` / `txtPage` 等 ref，可能需要更新 TTS 函数中的引用 — 改为 `txt.txtContent.value` 等）

- [ ] **Step 5: 同步更新 TTS 引用（如 TTS 还在 Reader.vue）**

定位 `startTTS` 函数中（约 691 行起）的 `txtContent.value` / `txtPage.value` 引用：
- `text = txtContent.value.slice(start, start + pageSize)` → `text = txt.txtContent.value.slice(...)`
- `txtContent.value.slice(...)` 同上
- 等等

注意 `calcTxtPageSize()` 在 TTS 内的调用 → `calcTxtPageSize(readerRef.value)`。

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/composables/useTxtReader.ts frontend/src/views/Reader.vue
git commit -m "refactor(reader): extract TXT rendering to useTxtReader composable"
```

---

## Task 12: 抽取 EPUB 渲染到 useEpubReader composable

**Files:**
- Create: `src/composables/useEpubReader.ts`
- Modify: `src/views/Reader.vue`（删除 EPUB 渲染相关 state + 函数）

- [ ] **Step 1: 创建 useEpubReader.ts**

写入 `frontend/src/composables/useEpubReader.ts`：

```ts
// src/composables/useEpubReader.ts
import { ref, nextTick } from 'vue'
import { getProgress, upsertProgress, addNote } from '@/lib/books'
import { loadEpubJs } from '@/composables/reader/lazyImport'

/**
 * EPUB 渲染 composable。
 * 暴露 epub state / render / prev / next / gotoChapter / cleanup。
 */
export function useEpubReader(opts: {
  getBookId: () => string | undefined
  getFileUrl: () => string
  getReaderRef: () => HTMLElement | null
  getFontSize: () => number
  onProgressChange: (pct: number, currentPage: number, totalPages: number) => void
  onChapters: (ch: Array<{ id: string; label: string; cfi?: string; index?: number }>) => void
}) {
  const epubRendition = ref<any>(null)
  const epubBook = ref<any>(null)
  const epubCurrentContents = ref<any>(null)
  const epubTotalPages = ref(0)
  const epubCurrentPage = ref(0)

  let epubBlobUrl: string | null = null
  let keyHandler: ((e: KeyboardEvent) => void) | null = null

  function scheduleSaveProgress(cfi: string) {
    const bookId = opts.getBookId()
    if (!bookId) return
    setTimeout(() => {
      upsertProgress({
        book_id: bookId,
        cfi,
        page: epubCurrentPage.value,
        percentage: (() => {
          // progress pct already on caller side; pass via onProgressChange
          return 0
        })(),
      }).catch(() => {})
    }, 1500)
  }

  function detachKeyHandler() {
    if (keyHandler) {
      window.removeEventListener('keydown', keyHandler)
      keyHandler = null
    }
  }

  async function render() {
    const ePub = await loadEpubJs()
    if (epubRendition.value) {
      try { epubRendition.value.destroy() } catch {}
      epubRendition.value = null
      epubBook.value = null
      epubCurrentContents.value = null
    }
    if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }
    const el = opts.getReaderRef()
    if (!el) return
    el.innerHTML = ''

    let bookInput: ArrayBuffer | string
    try {
      const res = await fetch(opts.getFileUrl())
      if (!res.ok) throw new Error('fetch epub failed: ' + res.status)
      bookInput = await res.arrayBuffer()
    } catch (e) {
      if (import.meta.env.DEV) console.error('epub download failed, falling back to URL', e)
      bookInput = opts.getFileUrl()
    }

    const book: any = ePub(bookInput)
    epubBook.value = book

    const rendition: any = book.renderTo(el, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
      snap: true,
      allowScriptedContent: true,
    })
    epubRendition.value = rendition
    rendition.themes.fontSize(`${opts.getFontSize()}px`)

    book.on?.('openFailed', (e: any) => {
      if (import.meta.env.DEV) console.error('book openFailed', e)
    })

    // 键盘
    detachKeyHandler()
    keyHandler = (e: KeyboardEvent) => {
      if (!epubRendition.value) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { epubRendition.value.prev(); e.preventDefault() }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { epubRendition.value.next(); e.preventDefault() }
    }
    window.addEventListener('keydown', keyHandler, { passive: false })

    rendition.hooks.content.register((contents: any) => {
      epubCurrentContents.value = contents
      try {
        const docEl = contents.window.document.documentElement
        docEl.addEventListener('click', (e: MouseEvent) => {
          const w = contents.window.innerWidth
          const x = e.clientX
          if (x < w / 3) epubRendition.value?.prev()
          else epubRendition.value?.next()
        })
        let touchStartX = 0
        docEl.addEventListener('touchstart', (e: TouchEvent) => {
          touchStartX = e.changedTouches[0]?.clientX ?? 0
        }, { passive: true })
        docEl.addEventListener('touchend', (e: TouchEvent) => {
          const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX
          if (Math.abs(dx) > 40) {
            if (dx < 0) epubRendition.value?.next()
            else epubRendition.value?.prev()
          }
        }, { passive: true })
        docEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'ArrowLeft' || e.key === 'PageUp') { epubRendition.value?.prev(); e.preventDefault() }
          if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { epubRendition.value?.next(); e.preventDefault() }
        })
      } catch (err) {
        if (import.meta.env.DEV) console.warn('iframe hook registration failed', err)
      }
    })

    try {
      await Promise.race([
        book.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('book.ready timeout 15s')), 15000)),
      ])
    } catch (e) {
      if (import.meta.env.DEV) console.error(e)
    }

    const bookId = opts.getBookId()
    const saved = bookId ? await getProgress(bookId) : null
    try {
      await rendition.display(saved?.cfi || undefined)
    } catch (e) {
      if (import.meta.env.DEV) console.error('display error', e)
    }

    book.locations.generate(1024).then(() => {
      epubTotalPages.value = book.locations.length()
      if (epubTotalPages.value > 0) {
        // current page 计算由 caller 端的 progressPct 同步
      }
    }).catch((e: any) => {
      if (import.meta.env.DEV) console.warn('locations.generate failed', e)
    })

    await nextTick()
    try { rendition.resize() } catch {}
    setTimeout(() => { try { rendition.resize() } catch {} }, 200)
    setTimeout(() => { try { rendition.resize() } catch {} }, 800)

    try {
      const toc = book.navigation?.toc || []
      const chapters = (toc || []).map((item: any) => ({
        id: item.id || item.href || '',
        label: item.label || '(无标题)',
        cfi: item.href || undefined,
      }))
      opts.onChapters(chapters)
    } catch (e) {
      if (import.meta.env.DEV) console.error('toc failed', e)
    }

    rendition.on('relocated', (loc: any) => {
      const pct = book.locations?.percentageFromCfi?.(loc.start.cfi)
      const pctNum = typeof pct === 'number' ? pct : 0
      const total = epubTotalPages.value
      const cur = total > 0 ? Math.max(1, Math.round(pctNum * total)) : 0
      opts.onProgressChange(Math.round(pctNum * 100), cur, total)
      scheduleSaveProgress(loc.start.cfi)
    })

    rendition.on('selected', (cfiRange: string, contents: any) => {
      if (confirm('是否将选中文本保存为笔记？')) {
        const sel = contents.window.getSelection()
        const bid = opts.getBookId()
        if (bid) {
          addNote({
            book_id: bid,
            cfi: cfiRange,
            page: null,
            content: sel?.toString() || '',
            comment: null,
            color: '#fbbf24',
          })
        }
      }
    })
  }

  function prev() {
    try { epubRendition.value?.prev() } catch (e) {
      if (import.meta.env.DEV) console.error(e)
    }
  }
  function next() {
    try { epubRendition.value?.next() } catch (e) {
      if (import.meta.env.DEV) console.error(e)
    }
  }
  function gotoChapter(ch: { cfi?: string; id?: string }) {
    if (ch.cfi && epubRendition.value) {
      epubRendition.value.display(ch.cfi)
    } else {
      try { epubRendition.value?.display() } catch {}
      if (ch.id && epubBook.value) {
        const spineItem = epubBook.value.spine?.get?.(ch.id)
        if (spineItem) spineItem.load?.(epubRendition.value?.getView?.())
      }
    }
  }
  function jumpToPage(page: number) {
    if (epubTotalPages.value === 0 || !epubBook.value?.locations) return
    const target = Math.max(1, Math.min(page, epubTotalPages.value))
    const cfi = epubBook.value.locations.cfiFromLocation(target - 1)
    if (cfi) epubRendition.value?.display(cfi)
  }

  function applyFontSize() {
    try { epubRendition.value?.themes.fontSize(`${opts.getFontSize()}px`) } catch {}
  }

  function destroy() {
    detachKeyHandler()
    try { epubRendition.value?.destroy() } catch {}
    if (epubBook.value) try { epubBook.value.destroy() } catch {}
    if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }
  }

  return {
    epubRendition, epubBook, epubCurrentContents,
    epubTotalPages, epubCurrentPage,
    render, prev, next, gotoChapter, jumpToPage, applyFontSize, destroy,
  }
}
```

- [ ] **Step 2: 在 Reader.vue 删除 EPUB 相关 state 和函数**

定位 Reader.vue 中（约 360-365, 379-546）：
- `let epubBook: any = null`、`let epubRendition: any = null`、`let epubCurrentContents: any = null`、`let epubBlobUrl: string | null = null`、`let epubKeyHandler: ((e: KeyboardEvent) => void) | null = null` 整段删除
- `let touchStartHandler`、`let touchEndHandler`、`let isSwiping`、`function detachSwipeListeners()` 整段删除（属于 swipe handling，简化：本步骤先**保留** swipe 行为在 Reader.vue，composable 内不接管 — 避免范围爆炸）
- `async function renderEpub()` 整块（约 379-546 行）整段删除
- `function epubPrev()`、`function epubNext()` 整段删除（约 327-328 行）
- `function gotoEpubChapter(...)` 整段删除（约 311-323 行）
- `const epubCurrentPage = ref(0)`（约 180 行）、`const epubTotalPages = ref(0)`（约 181 行）整段删除

> 注：swipe handling 在 renderEpub 内通过 `epubRendition.hooks.content.register` 注册到 iframe 内部，已被 composable 接管，因此 `touchStartHandler` / `touchEndHandler` 的 Reader.vue 顶层声明可以删除。模板中如有 `touchstart` / `touchend` 直接绑在 readerRef 的逻辑也要删除。

在 `<script setup>` 顶部 import 区域加入：

```ts
import { useEpubReader } from '@/composables/useEpubReader'
```

在主体加入：

```ts
const epub = useEpubReader({
  getBookId: () => bookId.value,
  getFileUrl: () => fileUrl.value,
  getReaderRef: () => readerRef.value,
  getFontSize: () => reader.fontSize,
  onProgressChange: (pct, cur, total) => {
    progressPct.value = pct
    epubCurrentPage.value = cur
    epubTotalPages.value = total
  },
  onChapters: (ch) => { chapters.value = ch },
})
```

> 注意：Reader.vue 顶层需要保留 `progressPct` ref 和 `chapters` ref。如果 `epubCurrentPage` / `epubTotalPages` 也被模板直接引用，要么保留 Reader.vue 顶层的 `const epubCurrentPage = ref(0)` 等，由 composable 回调同步；要么模板改为 `epub.epubCurrentPage.value`。**保留顶层 ref + 回调同步**为最小 diff。

- [ ] **Step 3: 替换 renderEpub 调用**

定位 `renderReader` 函数内 `else if (format === 'epub')` 段（Task 11 已经在那里了），改为：

```ts
} else if (format === 'epub') {
  await epub.render()
}
```

`epubPrev` / `epubNext` / `gotoEpubChapter` 替换为 `epub.prev` / `epub.next` / `epub.gotoChapter`。

`onBeforeUnmount` 内 `if (epubRendition) { try { epubRendition.destroy() } catch {} }` / `if (epubBook) { try { epubBook.destroy() } catch {} }` / `if (epubBlobUrl) { URL.revokeObjectURL(epubBlobUrl); epubBlobUrl = null }` 整段删除，改为 `epub.destroy()`。

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 5: 手动验证 EPUB**

`npm run dev` 后打开 EPUB 书籍：
- 翻页正常
- 目录跳转正常（点击 TOC 中章节，跳到对应 cfi）
- 笔记（iframe 内选中保存）正常
- 进度保存 / 恢复
- 字号调整（设置中调字号，EPUB 内字号立即更新 — 模板内如有 `watch(() => reader.fontSize, ...)` 调用 `applyFontSize`，现在改 `epub.applyFontSize()`）
- 退出 Reader 时 `epub.destroy()` 不抛错

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/composables/useEpubReader.ts frontend/src/views/Reader.vue
git commit -m "refactor(reader): extract EPUB rendering to useEpubReader composable"
```

---

## Task 13: 抽取 PDF 渲染到 usePdfReader composable

**Files:**
- Create: `src/composables/usePdfReader.ts`
- Modify: `src/views/Reader.vue`（删除 PDF 渲染相关 state + 函数）

- [ ] **Step 1: 创建 usePdfReader.ts**

写入 `frontend/src/composables/usePdfReader.ts`：

```ts
// src/composables/usePdfReader.ts
import { ref } from 'vue'
import { getProgress, upsertProgress } from '@/lib/books'
import { loadPdfJs } from '@/composables/reader/lazyImport'

/**
 * PDF 渲染 composable。
 * 暴露 pdf state / render / prev / next / jumpToChapter / cleanup。
 */
export function usePdfReader(opts: {
  getBookId: () => string | undefined
  getFileUrl: () => string
  getReaderRef: () => HTMLElement | null
  onProgressChange: (pct: number, currentPage: number, totalPages: number) => void
  onChapters: (ch: Array<{ id: string; label: string; cfi?: string; index: number }>) => void
}) {
  const total = ref(0)
  const currentPage = ref(1)
  const pdfDoc = ref<any>(null)

  let progressTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleSaveProgress(page: number) {
    if (progressTimer) clearTimeout(progressTimer)
    const bookId = opts.getBookId()
    if (!bookId) return
    progressTimer = setTimeout(() => {
      upsertProgress({
        book_id: bookId,
        cfi: null,
        page,
        percentage: total.value > 0 ? (page / total.value) * 100 : 0,
      }).catch(() => {})
    }, 1500)
  }

  async function renderPage(pdf: any, page: number) {
    const el = opts.getReaderRef()
    if (!el) return
    el.innerHTML = ''
    const p = await pdf.getPage(page)
    const viewport = p.getViewport({ scale: 1.2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.className = 'mx-auto block max-w-full shadow'
    const ctx = canvas.getContext('2d')!
    await p.render({ canvasContext: ctx, viewport }).promise
    el.appendChild(canvas)
  }

  function triggerPageAnim(direction: 'next' | 'prev') {
    const el = opts.getReaderRef()
    if (!el) return
    el.classList.remove('page-turn-next', 'page-turn-prev')
    void el.offsetWidth
    el.classList.add(direction === 'next' ? 'page-turn-next' : 'page-turn-prev')
  }

  async function render() {
    const pdfjs = await loadPdfJs()
    const loadingTask = pdfjs.getDocument(opts.getFileUrl())
    const pdf = await loadingTask.promise
    pdfDoc.value = pdf

    const el = opts.getReaderRef()
    if (!el) return
    el.innerHTML = ''

    total.value = pdf.numPages
    const bookId = opts.getBookId()
    const prog = bookId ? await getProgress(bookId) : null
    const startPage = Math.max(1, prog?.page || 1)
    currentPage.value = startPage

    const pdfChapters: Array<{ id: string; label: string; index: number }> = []
    for (let i = 1; i <= total.value; i++) {
      pdfChapters.push({ id: `pdf-p-${i}`, label: `第 ${i} 页`, index: i - 1 })
    }
    opts.onChapters(pdfChapters)

    await renderPage(pdf, startPage)
    opts.onProgressChange((startPage / total.value) * 100, startPage, total.value)
    scheduleSaveProgress(startPage)
  }

  function prev() {
    const pdf = pdfDoc.value
    if (!pdf || currentPage.value <= 1) return
    const np = currentPage.value - 1
    currentPage.value = np
    renderPage(pdf, np)
    triggerPageAnim('prev')
    opts.onProgressChange((np / total.value) * 100, np, total.value)
    scheduleSaveProgress(np)
  }
  function next() {
    const pdf = pdfDoc.value
    if (!pdf || currentPage.value >= total.value) return
    const np = currentPage.value + 1
    currentPage.value = np
    renderPage(pdf, np)
    triggerPageAnim('next')
    opts.onProgressChange((np / total.value) * 100, np, total.value)
    scheduleSaveProgress(np)
  }
  function jumpToChapter(index: number) {
    const pdf = pdfDoc.value
    if (!pdf) return
    const page = index + 1
    currentPage.value = page
    renderPage(pdf, page)
    opts.onProgressChange((page / pdf.numPages) * 100, page, pdf.numPages)
    scheduleSaveProgress(page)
  }

  return {
    total, currentPage, pdfDoc,
    render, prev, next, jumpToChapter,
  }
}
```

- [ ] **Step 2: 在 Reader.vue 删除 PDF 相关代码**

定位 Reader.vue 中：
- `async function renderPdf()` 整块（约 548-597 行）删除
- `async function renderPdfPage(...)` 整块（约 599-611 行）删除
- `function pdfPrev()` 整块（约 613-630 行）删除
- `function pdfNext()` 整块（约 631-648 行）删除
- `function pdfPrev/Next` 内的 `(readerRef.value as any).__pdf` / `__currentPage` 引用 → 改用 composable

在 `<script setup>` 顶部 import 区域加入：

```ts
import { usePdfReader } from '@/composables/usePdfReader'
```

在主体加入：

```ts
const pdf = usePdfReader({
  getBookId: () => bookId.value,
  getFileUrl: () => fileUrl.value,
  getReaderRef: () => readerRef.value,
  onProgressChange: (pct, cur, total) => {
    progressPct.value = pct
    txtPage.value = cur - 1
    txtTotalPages.value = total
  },
  onChapters: (ch) => { chapters.value = ch },
})
```

- [ ] **Step 3: 替换 renderPdf 调用**

`renderReader` 内 `else if (format === 'pdf')` 段：

```ts
} else if (format === 'pdf') {
  await pdf.render()
}
```

`pdfPrev` / `pdfNext` 替换为 `pdf.prev` / `pdf.next`。

`jumpToChapter` 中 PDF 分支（`(readerRef.value as any)?.__pdf` 判断）改为 `pdf.jumpToChapter(index)`（由 `format === 'pdf'` 决定走哪个分支的逻辑保留在 Reader.vue 顶层 `jumpToChapter` 函数中 — `if (book.value?.file_format === 'pdf') pdf.jumpToChapter(index); else txt.jumpToChapter(index)`）。

- [ ] **Step 4: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 5: 手动验证 PDF**

`npm run dev` 后打开 PDF 书籍：
- 翻页正常（前 / 后）
- 进度保存
- 跳页（设置中输入页码跳转）正常
- 目录显示（"第 N 页" 列表）

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/composables/usePdfReader.ts frontend/src/views/Reader.vue
git commit -m "refactor(reader): extract PDF rendering to usePdfReader composable"
```

---

## Task 14: 抽取 panel 模板到子组件

**Files:**
- Create: `src/components/reader/PanelBookmarks.vue`
- Create: `src/components/reader/PanelNotes.vue`
- Create: `src/components/reader/PanelSettings.vue`
- Create: `src/components/reader/PanelToc.vue`
- Create: `src/components/reader/PanelTts.vue`
- Modify: `src/views/Reader.vue`（删除原 panel 模板部分）

- [ ] **Step 1: 创建 PanelBookmarks.vue**

写入 `frontend/src/components/reader/PanelBookmarks.vue`：

```vue
<script setup lang="ts">
import { Bookmark as BookmarkIcon, Trash2, X } from 'lucide-vue-next'
import type { Bookmark } from '@/types'

defineProps<{
  open: boolean
  bookmarks: Bookmark[]
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'remove', id: string): void
  (e: 'jump', cfi: string): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-y-0 right-0 w-80 bg-white shadow-2xl z-40 flex flex-col">
    <div class="px-4 h-12 flex items-center justify-between border-b">
      <span class="font-semibold">书签</span>
      <button @click="emit('close')" class="text-ink-300 hover:text-ink-800">
        <X class="w-5 h-5" :stroke-width="1.75" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-3 space-y-2">
      <div v-if="!bookmarks.length" class="text-center text-ink-300 py-8 text-sm">暂无书签</div>
      <div v-for="b in bookmarks" :key="b.id" class="card p-3 flex items-start gap-2">
        <BookmarkIcon class="w-4 h-4 text-primary-600 flex-shrink-0 mt-0.5" :stroke-width="1.75" />
        <div class="flex-1 min-w-0">
          <div class="text-sm line-clamp-2 cursor-pointer hover:text-primary-600"
               @click="b.cfi && emit('jump', b.cfi)">
            {{ b.content || '书签' }}
          </div>
          <div class="text-xs text-ink-300 mt-0.5">{{ b.page ? `第 ${b.page} 页` : '' }}</div>
        </div>
        <button @click="emit('remove', b.id)" class="text-ink-300 hover:text-rose-500">
          <Trash2 class="w-4 h-4" :stroke-width="1.75" />
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 创建 PanelNotes.vue**

写入 `frontend/src/components/reader/PanelNotes.vue`：

```vue
<script setup lang="ts">
import { NotebookPen, Trash2, X } from 'lucide-vue-next'
import type { Note } from '@/types'

defineProps<{
  open: boolean
  notes: Note[]
  newNoteText: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:newNoteText', v: string): void
  (e: 'add'): void
  (e: 'remove', id: string): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-y-0 right-0 w-80 bg-white shadow-2xl z-40 flex flex-col">
    <div class="px-4 h-12 flex items-center justify-between border-b">
      <span class="font-semibold flex items-center gap-2">
        <NotebookPen class="w-4 h-4" :stroke-width="1.75" />笔记
      </span>
      <button @click="emit('close')" class="text-ink-300 hover:text-ink-800">
        <X class="w-5 h-5" :stroke-width="1.75" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-3 space-y-2">
      <div v-if="!notes.length" class="text-center text-ink-300 py-8 text-sm">暂无笔记</div>
      <div v-for="n in notes" :key="n.id" class="card p-3">
        <div class="text-sm whitespace-pre-wrap">{{ n.content }}</div>
        <div class="flex justify-between items-center mt-2 text-xs text-ink-300">
          <span>{{ n.page ? `第 ${n.page} 页` : '' }}</span>
          <button @click="emit('remove', n.id)" class="text-ink-300 hover:text-rose-500">
            <Trash2 class="w-3.5 h-3.5" :stroke-width="1.75" />
          </button>
        </div>
      </div>
    </div>
    <div class="p-3 border-t flex gap-2">
      <input
        :value="newNoteText"
        @input="emit('update:newNoteText', ($event.target as HTMLInputElement).value)"
        @keydown.enter="emit('add')"
        placeholder="添加笔记…"
        class="flex-1 h-9 px-3 rounded-lg border border-primary-200 text-sm focus:outline-none focus:border-primary-600"
      />
      <button @click="emit('add')" class="btn-primary text-sm px-3">添加</button>
    </div>
  </div>
</template>
```

- [ ] **Step 3: 创建 PanelSettings.vue**

写入 `frontend/src/components/reader/PanelSettings.vue`：

```vue
<script setup lang="ts">
import { Settings, X, Type } from 'lucide-vue-next'
import { FONT_OPTIONS, THEME_OPTIONS } from '@/types'

defineProps<{
  open: boolean
  fontId: string
  themeId: string
  fontSize: number
  lineHeight: number
  maxWidth: number
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'setFont', id: string): void
  (e: 'setTheme', id: string): void
  (e: 'zoom', delta: number): void
  (e: 'setLineHeight', v: number): void
  (e: 'setMaxWidth', v: number): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-y-0 right-0 w-80 bg-white shadow-2xl z-40 flex flex-col">
    <div class="px-4 h-12 flex items-center justify-between border-b">
      <span class="font-semibold flex items-center gap-2">
        <Settings class="w-4 h-4" :stroke-width="1.75" />设置
      </span>
      <button @click="emit('close')" class="text-ink-300 hover:text-ink-800">
        <X class="w-5 h-5" :stroke-width="1.75" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
      <div>
        <div class="text-xs text-ink-300 mb-1.5">字号</div>
        <div class="flex items-center gap-2">
          <button @click="emit('zoom', -2)" class="btn-ghost px-2 h-8">-</button>
          <span class="flex-1 text-center font-mono">{{ fontSize }}px</span>
          <button @click="emit('zoom', 2)" class="btn-ghost px-2 h-8">+</button>
        </div>
      </div>
      <div>
        <div class="text-xs text-ink-300 mb-1.5">行距</div>
        <input
          type="range" min="1.2" max="2.4" step="0.1"
          :value="lineHeight"
          @input="emit('setLineHeight', +($event.target as HTMLInputElement).value)"
          class="w-full"
        />
        <div class="text-center text-xs text-ink-500">{{ lineHeight }}</div>
      </div>
      <div>
        <div class="text-xs text-ink-300 mb-1.5">宽度</div>
        <input
          type="range" min="480" max="960" step="20"
          :value="maxWidth"
          @input="emit('setMaxWidth', +($event.target as HTMLInputElement).value)"
          class="w-full"
        />
        <div class="text-center text-xs text-ink-500">{{ maxWidth }}px</div>
      </div>
      <div>
        <div class="text-xs text-ink-300 mb-1.5">字体</div>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="f in FONT_OPTIONS" :key="f.id"
            @click="emit('setFont', f.id)"
            :class="['btn-ghost text-xs', fontId === f.id ? 'border-primary-600 text-primary-600' : '']"
          >{{ f.name }}</button>
        </div>
      </div>
      <div>
        <div class="text-xs text-ink-300 mb-1.5">主题</div>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="t in THEME_OPTIONS" :key="t.id"
            @click="emit('setTheme', t.id)"
            :class="['btn-ghost text-xs', themeId === t.id ? 'border-primary-600 text-primary-600' : '']"
          >{{ t.name }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: 创建 PanelToc.vue**

写入 `frontend/src/components/reader/PanelToc.vue`：

```vue
<script setup lang="ts">
import { ListTree, X } from 'lucide-vue-next'

defineProps<{
  open: boolean
  chapters: Array<{ id: string; label: string; cfi?: string; index?: number }>
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'jump', payload: { cfi?: string; index?: number }): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-y-0 right-0 w-80 bg-white shadow-2xl z-40 flex flex-col">
    <div class="px-4 h-12 flex items-center justify-between border-b">
      <span class="font-semibold flex items-center gap-2">
        <ListTree class="w-4 h-4" :stroke-width="1.75" />目录
      </span>
      <button @click="emit('close')" class="text-ink-300 hover:text-ink-800">
        <X class="w-5 h-5" :stroke-width="1.75" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-3 space-y-1">
      <div v-if="!chapters.length" class="text-center text-ink-300 py-8 text-sm">无章节</div>
      <button
        v-for="c in chapters" :key="c.id"
        @click="emit('jump', { cfi: c.cfi, index: c.index })"
        class="w-full text-left px-3 py-2 rounded-lg hover:bg-primary-50 text-sm truncate"
      >{{ c.label }}</button>
    </div>
  </div>
</template>
```

- [ ] **Step 5: 创建 PanelTts.vue**

写入 `frontend/src/components/reader/PanelTts.vue`：

```vue
<script setup lang="ts">
import { Volume2, X, Pause, Play, Square } from 'lucide-vue-next'

defineProps<{
  open: boolean
  playing: boolean
  paused: boolean
  voice: string
  speed: number
  voices: Array<{ id: string; name: string }>
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'play'): void
  (e: 'pause'): void
  (e: 'stop'): void
  (e: 'setVoice', id: string): void
  (e: 'setSpeed', v: number): void
}>()
</script>

<template>
  <div v-if="open" class="fixed inset-y-0 right-0 w-80 bg-white shadow-2xl z-40 flex flex-col">
    <div class="px-4 h-12 flex items-center justify-between border-b">
      <span class="font-semibold flex items-center gap-2">
        <Volume2 class="w-4 h-4" :stroke-width="1.75" />听书
      </span>
      <button @click="emit('close')" class="text-ink-300 hover:text-ink-800">
        <X class="w-5 h-5" :stroke-width="1.75" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
      <div class="flex items-center justify-center gap-3">
        <button v-if="!playing || paused" @click="emit('play')" class="btn-primary h-12 w-12 rounded-full flex items-center justify-center">
          <Play class="w-5 h-5" :stroke-width="1.75" />
        </button>
        <button v-else @click="emit('pause')" class="btn-primary h-12 w-12 rounded-full flex items-center justify-center">
          <Pause class="w-5 h-5" :stroke-width="1.75" />
        </button>
        <button @click="emit('stop')" class="btn-ghost h-12 w-12 rounded-full flex items-center justify-center">
          <Square class="w-5 h-5" :stroke-width="1.75" />
        </button>
      </div>
      <div>
        <div class="text-xs text-ink-300 mb-1.5">音色</div>
        <select
          :value="voice"
          @change="emit('setVoice', ($event.target as HTMLSelectElement).value)"
          class="w-full h-9 px-3 rounded-lg border border-primary-200 text-sm"
        >
          <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
      </div>
      <div>
        <div class="text-xs text-ink-300 mb-1.5">语速</div>
        <input
          type="range" min="0.5" max="2" step="0.1"
          :value="speed"
          @input="emit('setSpeed', +($event.target as HTMLInputElement).value)"
          class="w-full"
        />
        <div class="text-center text-xs text-ink-500">{{ speed.toFixed(1) }}x</div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 6: 在 Reader.vue 替换 panel 模板**

定位 Reader.vue 模板（`<template>` 段）中以下 panel div：
- 书签面板（`v-if="showBookmarks"` 段）
- 笔记面板（`v-if="showNotes"` 段）
- 设置面板（`v-if="showSettings"` 段）
- 目录面板（`v-if="showToc"` 段）
- TTS 面板（`v-if="showTTSPanel"` 段）

整段删除，替换为：

```vue
<PanelBookmarks :open="showBookmarks" :bookmarks="bookmarks"
  @close="showBookmarks = false"
  @remove="removeBookmark"
  @jump="(cfi) => { ... }" />
<PanelNotes :open="showNotes" :notes="notes" :newNoteText="newNoteText"
  @close="showNotes = false"
  @update:newNoteText="newNoteText = $event"
  @add="addNoteLocal(newNoteText); newNoteText = ''"
  @remove="removeNote" />
<PanelSettings :open="showSettings"
  :fontId="reader.fontId" :themeId="reader.themeId"
  :fontSize="reader.fontSize" :lineHeight="reader.lineHeight" :maxWidth="reader.maxWidth"
  @close="showSettings = false"
  @setFont="reader.setFont" @setTheme="reader.setTheme"
  @zoom="reader.zoom" @setLineHeight="reader.setLineHeight" @setMaxWidth="reader.setMaxWidth" />
<PanelToc :open="showToc" :chapters="chapters"
  @close="showToc = false"
  @jump="(p) => { if (book?.file_format === 'epub') epub.gotoChapter(p); else txt.jumpToChapter(p.index ?? 0) }" />
<PanelTts :open="showTTSPanel"
  :playing="ttsPlaying" :paused="ttsPaused"
  :voice="ttsVoice" :speed="ttsSpeed" :voices="TTS_VOICES"
  @close="showTTSPanel = false"
  @play="startTTS" @pause="pauseTTS" @stop="stopTTS"
  @setVoice="ttsVoice = $event" @setSpeed="ttsSpeed = $event" />
```

在 `<script setup>` 顶部 import 区域加入：

```ts
import PanelBookmarks from '@/components/reader/PanelBookmarks.vue'
import PanelNotes from '@/components/reader/PanelNotes.vue'
import PanelSettings from '@/components/reader/PanelSettings.vue'
import PanelToc from '@/components/reader/PanelToc.vue'
import PanelTts from '@/components/reader/PanelTts.vue'
```

- [ ] **Step 7: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 8: 手动验证 panels**

`npm run dev` 后打开任意书籍：
- 点击书签图标 → PanelBookmarks 打开 → 列表 / 跳转 / 删除正常
- 点击笔记图标 → PanelNotes 打开 → 列表 / 添加 / 删除正常
- 点击设置图标 → PanelSettings 打开 → 字号 / 行距 / 宽度 / 字体 / 主题调整立即生效
- 点击目录图标 → PanelToc 打开 → 跳转正常
- 点击 TTS 图标 → PanelTts 打开 → 播放 / 暂停 / 停止 / 调音色 / 调速正常

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/components/reader/ frontend/src/views/Reader.vue
git commit -m "refactor(reader): extract panels to components/reader/*"
```

---

## Task 15: 收尾 TTS 抽取（如 TTS 仍在 Reader.vue）

**Files:**
- Modify: `src/views/Reader.vue`（如 TTS 逻辑仍在 Reader.vue，**暂保留**）

- [ ] **Step 1: 决定 TTS 是否独立**

TTS（startTTS / pauseTTS / stopTTS / ttsQueue / ttsIndex / splitSentences 等）逻辑约 100-200 行。

**本任务**选择**最简方案**：TTS 仍保留在 Reader.vue，不独立 composable。Reader.vue 终态目标 ≤ 250 行，因此 TTS 占用的行数需要靠 panel 抽取 + 渲染 composables 抽取后腾出的空间容纳。

如果行数超 250，下一步再做 TTS 抽取。本步骤**不**做改动。

- [ ] **Step 2: 不做 commit**

本任务如未做改动，**跳过** commit。如果发现 TTS 函数名引用因 Task 12 / Task 13 改动而失效，**修复**：

定位 startTTS / pauseTTS / stopTTS / splitSentences 引用，修复为 composable 暴露的 `txt.txtContent` / `txt.txtPage` 等。

```bash
cd frontend && grep -n "txtContent\.\|txtPage\.\|txtTotalPages\." src/views/Reader.vue
```

如有未替换的引用，逐个修复。

- [ ] **Step 3: 验证编译**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: 验证 TTS 行为**

打开任意书籍（最好 TXT），启动 TTS，确认朗读 + 暂停 + 恢复 + 调速 + 切页时正确跟随。

- [ ] **Step 5: Commit（如有修复）**

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/src/views/Reader.vue
git commit -m "fix(reader): align TTS refs with composable state"
```

---

## Task 16: 收尾 — 验证 Reader.vue ≤ 250 行

**Files:**（无改动，除非需要精简）

- [ ] **Step 1: 检查行数**

```bash
cd frontend && wc -l src/views/Reader.vue
```

Expected: ≤ 250 行。

如果 > 250：
1. 检查是否有未抽取的 state（`const ... = ref(...)`）
2. 检查是否有未抽取的 import（如 epubjs 顶层 import 仍残留）
3. 检查模板内是否有内联函数可以挪到 composable
4. 把剩余的 state / 函数抽出到新 composable（如 `useReaderToc` / `useReaderJump` 等）

- [ ] **Step 2: 最终 build + bundle 验证**

```bash
cd frontend && npm run build
```

Expected: 成功。

可选：重新安装 rollup-plugin-visualizer（参考 Task 7 步骤 2-3）确认 `epubjs` / `pdfjs-dist` 不在 reader 入口 chunk；记录入口 chunk 体积，与阶段 1 数据对比确认 ≥ 50% 下降。

- [ ] **Step 3: 阶段 2 完整手测回归**

跑 Task 7 Step 4 的全部手测项（1-9），全部通过。

- [ ] **Step 4: 阶段 2 完成 commit**

如有精简改动：

```bash
cd /c/Users/Administrator/AppData/Local/Claude-3p/local-agent-mode-sessions/ece1231f-0546-4a25-a7e3-24af57168fde/00000000-0000-4000-8000-000000000001/local_a944ba95-336b-4e1f-9dba-ac805174e1e3/outputs/library-app
git add frontend/
git commit -m "refactor(reader): final pass — Reader.vue <= 250 lines"
```

---

# 完成

至此阶段 1 + 阶段 2 全部完成。建议做一次最终 review：

- [ ] **最终验证（独立 session 执行）**

```bash
cd frontend && npm run build
grep -n "console\." src/views/Reader.vue
grep -n "from 'epubjs'" src/views/Reader.vue
grep -n "from 'pdfjs-dist'" src/views/Reader.vue
wc -l src/views/Reader.vue
```

Expected:
- build 成功
- console.* 仅在 `if (import.meta.env.DEV)` 守卫下
- epubjs / pdfjs-dist 在 Reader.vue 中无顶层 import
- Reader.vue ≤ 250 行

---

# 后续 spec（不在本计划范围）

按 spec §9 列表，下一批候选 spec：
1. 状态管理：auth.init() 并行 + onAuthStateChange 订阅清理 + reader store 早期应用
2. 网络 / 缓存：uploadBook 大文件分片 + 文件 URL 短时缓存 + SWR
3. UX 小修：timeAgo 边界、calcTxtPageSize 响应式跳变、App.vue pb-20 条件 class 优化
4. 代码质量：清理 `any` + ESLint / Prettier + `useAnimations` 死代码排查
5. 部署 / 监控：Vercel Cache-Control 头 + Sentry 接入 + SEO meta
6. 安全：RLS 策略复核 + maskEmail 抓取风险
