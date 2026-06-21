# 古登堡计划图书集成 — 实现计划

## 目标
让用户能在搜索环节发现并导入古登堡图书，进入自己的书架后即可阅读、听书、做笔记（在线阅读模式）。

## 设计文档
[docs/superpowers/specs/2026-06-21-gutenberg-integration-design.md](docs/superpowers/specs/2026-06-21-gutenberg-integration-design.md)

## 数据模型总览
- **books 表**：零改动，所有现有用户上传书继续使用
- **gutenberg_books 新表**：1:1 关系，PK = FK → books.id
- **reading_progress / bookmarks / notes**：零改动，复用现有 book_id

## 实现策略
按 4 个阶段顺序实施，每个阶段独立可交付、单独合并 PR：
- 阶段 1：基础设施（DB + 后端 Edge Functions）
- 阶段 2：搜索 + 导入（前端主要功能）
- 阶段 3：在线阅读（最复杂）
- 阶段 4：TTS + 收尾

---

## 阶段 1：基础设施 [todo]

**目标：** DB 新表 + 3 个后端 Edge Function 上线（搜索 / 导入 / 拉取）

### 1.1 数据库迁移

- [ ] 创建 migration 文件 `supabase/migrations/YYYYMMDD_gutenberg_books.sql`
- [ ] `CREATE TABLE gutenberg_books` （含 book_id PK+FK、4 字段、CHECK 约束）
- [ ] `CREATE INDEX idx_gutenberg_id ON gutenberg_books(gutenberg_id)`
- [ ] `CREATE INDEX idx_gutenberg_user_lang ON gutenberg_books(book_id, language)`
- [ ] `ALTER TABLE gutenberg_books ENABLE ROW LEVEL SECURITY`
- [ ] 创建 RLS policy：「用户只能访问自己的古登堡书」通过 JOIN books 验证 user_id
- [ ] 迁移应用到本地 Supabase 实例
- [ ] 验证：现有 books 数据完全不受影响

### 1.2 Edge Function: gutenberg-search

- [ ] `supabase/functions/gutenberg-search/index.ts` 新建
- [ ] 入参校验：`{ q: string, page?: number }`，q 非空
- [ ] 调 Gutendex: `https://gutendex.com/books/?search={q}&languages=zh,en&page={page}`
- [ ] 5 秒超时控制
- [ ] 标准化返回：每本书返回 `{ gutenberg_id, title, author, language, cover_url, formats: { epub, txt, ... } }`
- [ ] 排除无任何可下载格式的结果
- [ ] 错误处理：Gutendex 失败 → 返回 `{ error: 'gutenberg_unavailable' }`，HTTP 503
- [ ] 本地测试：`supabase functions serve gutenberg-search`

### 1.3 Edge Function: gutenberg-import

- [ ] `supabase/functions/gutenberg-import/index.ts` 新建
- [ ] 鉴权：必须登录（Supabase JWT）
- [ ] 入参校验：`{ gutenberg_id: int, language: 'zh'|'en' }`
- [ ] 调 Gutendex 拉元数据（`https://gutendex.com/books/{id}`）
- [ ] 提取 title, authors[], cover 链接
- [ ] **查重**：`SELECT b.id FROM books b JOIN gutenberg_books gb ON b.id=gb.book_id WHERE b.user_id=auth.uid() AND gb.gutenberg_id=? AND gb.language=? AND gb.format IS NULL`
  - 命中 → 返回 `{ exists: true, book_id }`，HTTP 200
- [ ] **事务写两表**：
  ```
  BEGIN
    INSERT INTO books (user_id, title, author, cover_url, file_url, file_type, ...)
      VALUES (auth.uid(), ?, ?, ?, NULL, 'gutenberg', ...)
    INSERT INTO gutenberg_books (book_id, gutenberg_id, language, format=NULL)
      VALUES (currval('books_id_seq'), ?, ?)
  COMMIT
  ```
- [ ] 错误处理：Gutendex 404 → HTTP 404 + `{ error: 'not_found' }`
- [ ] 错误处理：事务失败 → ROLLBACK + HTTP 500
- [ ] 本地测试：mock 一个 JWT + 调真实 Gutendex

### 1.4 Edge Function: gutenberg-fetch（含 cache.ts）

- [ ] `supabase/functions/gutenberg-fetch/cache.ts` 新建
  - 导出全局 `Map<key: string, value: {bytes: Uint8Array, format: string, ts: number}>`，key 格式 `${gutenberg_id}:${format}`
  - 实现 `get(key)` / `set(key, value)` / `clear()` 函数
  - 注释说明：缓存存活期 = Edge Function 实例生命周期，重启即清空
- [ ] `supabase/functions/gutenberg-fetch/index.ts` 新建
- [ ] 鉴权：必须登录
- [ ] 流程：
  1. 入参 `{ book_id }`
  2. SQL: `SELECT gb.gutenberg_id, gb.language, gb.format FROM gutenberg_books gb JOIN books b ON gb.book_id=b.id WHERE gb.book_id=? AND b.user_id=auth.uid()`
  3. 若 `format` 为 NULL → 调 Gutendex 选 epub，UPDATE gutenberg_books.format='epub'
  4. 构造 cache key = `${gutenberg_id}:${format}`
  5. 查缓存：命中 → 返回 base64
  6. 未命中 → 选下载 URL（epub 优先 `https://www.gutenberg.org/cache/epub/{id}/pg{id}.epub`）
  7. fetch 下载（10s 超时）
  8. 写入缓存
  9. 返回 base64 + content-type
- [ ] 错误处理：book_id 不属于当前用户 → 403
- [ ] 错误处理：下载失败 → 502 + `{ error: 'fetch_failed' }`
- [ ] 本地测试：导入一本后调 fetch 验证

### 1.5 阶段 1 验证

- [ ] 迁移脚本在本地 Supabase 跑通
- [ ] 3 个 Edge Function 都本地部署并能 curl 测试
- [ ] 没有现有功能被破坏

---

## 阶段 2：搜索 + 导入（前端）[todo]

**目标：** 用户能在搜索页看到古登堡结果并加入书架

### 2.1 composable: useGutenbergSearch

- [ ] `src/composables/useGutenbergSearch.ts` 新建
- [ ] 导出 `useGutenbergSearch()`
- [ ] 返回 `{ results, loading, error, search }`
- [ ] `search(q)` 调用 `supabase.functions.invoke('gutenberg-search', { body: { q } })`
- [ ] 防抖 300ms（外部实现，composable 不管）
- [ ] 错误时清空 results

### 2.2 composable: useGutenbergImport

- [ ] `src/composables/useGutenbergImport.ts` 新建
- [ ] 导出 `useGutenbergImport()`
- [ ] 返回 `{ importing, error, importBook }`
- [ ] `importBook(gutenberg_id, language)`：
  1. 检查 auth store 登录态
  2. 未登录 → toast「请先登录」+ 跳 /login
  3. 调用 gutenberg-import
  4. 拿到 book_id 后跳 /library?tab=online&highlight={id}
  5. 错误处理：Gutenberg 失败 → toast 错误信息

### 2.3 组件: GutenbergBookCard

- [ ] `src/components/GutenbergBookCard.vue` 新建
- [ ] Props: `book: GutenbergBook`（类型见 composables/types）
- [ ] 视觉：封面（无则占位图）、标题、作者、语言徽章（🇨🇳/🇺🇸）、格式徽章（EPUB/TXT）、文件大小、「➕ 加入书架」按钮
- [ ] 点击「加入书架」调用 useGutenbergImport
- [ ] importing 状态：按钮变 loading

### 2.4 改造: Search.vue

- [ ] 找到现有的搜索入口（router.ts / nav 菜单）
- [ ] 在搜索结果中分两个分组：
  - 「古登堡计划」分组（用 GutenbergBookCard）
  - 「公开书库」分组（现有用户分享列表）
- [ ] 同时发起两个请求：本地公开书 + 古登堡
- [ ] 任一来源 5s 超时，显示「该来源暂不可用」但不阻塞另一个
- [ ] 无结果时不显示空分组标题

### 2.5 阶段 2 验证

- [ ] 搜索「战争与和平」→ 看到中文 + 英文版古登堡结果
- [ ] 搜索「War and Peace」→ 同样看到
- [ ] 搜索「Don Quixote」（西班牙）→ 不显示（已过滤）
- [ ] 搜索英文小众书「Frankenstein」→ 看到英文结果
- [ ] 未登录点「加入书架」→ toast + 跳登录
- [ ] 已登录点击 → 跳转到 /library?tab=online
- [ ] 重复点击同一本 → toast「已在你的书架」

---

## 阶段 3：在线阅读 [todo]

**目标：** 用户在书架「在线图书」tab 能点开古登堡书并正常阅读

### 3.1 改造: Library.vue

- [ ] 找到现有 Library.vue
- [ ] 在顶部加 Tabs 组件：「我的书架」/「在线图书」
- [ ] 「我的书架」查询：`SELECT * FROM books WHERE user_id=auth.uid() AND id NOT IN (SELECT book_id FROM gutenberg_books)`
- [ ] 「在线图书」查询：`SELECT b.*, gb.language FROM books b JOIN gutenberg_books gb ON b.id=gb.book_id WHERE b.user_id=auth.uid()`
- [ ] URL 同步：`?tab=online` 时默认选中在线 tab
- [ ] 「在线图书」卡片上加「🌐 在线」徽章
- [ ] 「highlight」参数：进入页面后短暂高亮指定 book_id 的卡片

### 3.2 改造: Reader.vue — 在线图书分支

- [ ] 找到现有的 Reader.vue
- [ ] 加载 book 时多查一次：`SELECT gb.*, gb.format FROM gutenberg_books gb WHERE gb.book_id=?`
- [ ] 若 gutenberg_books 存在 → 进入「在线阅读」分支
- [ ] 在线分支流程：
  1. 调用 gutenberg-fetch?book_id={id}
  2. 拿到 base64 → `atob` + `new Uint8Array` → `new Blob([bytes], { type })` → `URL.createObjectURL(blob)`
  3. 走现有 epub.js / TXT 解析路径（用 blob URL 替代文件 URL）
- [ ] 翻页逻辑：与本地书完全一致
- [ ] 进度/书签/笔记：写入 reading_progress / bookmarks / notes，**完全复用现有逻辑**
- [ ] 失败处理：fetch 失败 → toast「请检查网络连接」+ 「重试」按钮
- [ ] 卸载时 `URL.revokeObjectURL` 释放内存

### 3.3 阶段 3 验证

- [ ] 书架「在线图书」tab 能看到已导入的古登堡书
- [ ] 切换 tab 正常
- [ ] 点击在线图书能正常打开、翻页
- [ ] 翻页流畅（缓存命中时）
- [ ] 添加书签 → 刷新后还在
- [ ] 进度同步 → 关闭重开恢复位置
- [ ] 断网时打开在线书 → 友好错误提示
- [ ] 重试按钮工作

---

## 阶段 4：TTS + 收尾 [todo]

**目标：** 古登堡书支持听书 + 上线前收尾

### 4.1 改造: tts Edge Function

- [ ] 找到 `supabase/functions/tts/index.ts`
- [ ] 入参加 `source: 'local' | 'online'`（不传默认 'local'）
- [ ] online 分支：
  1. 同样调 gutenberg-fetch 拿缓存的 bytes（**新增内部函数复用逻辑，避免重复下载**）
  2. EPUB：解析当前章节文本
  3. TXT：按 page 切片
  4. 走现有 MiniMax TTS API
- [ ] 错误处理：源不可用 → 502

### 4.2 改造: Reader.vue TTS 入口

- [ ] 检测 storage（在线 vs 本地）
- [ ] 在线书点听书 → 调用 TTS API 时带 `source: 'online'`
- [ ] TTS 弹窗/迷你条 UI **完全复用**

### 4.3 上线前收尾

- [ ] 环境变量：在 Vercel 添加 `VITE_ENABLE_GUTENBERG=true`（默认开）
- [ ] 关于页（如有）：添加「图书来源：Project Gutenberg」致谢链接
- [ ] 部署到 Vercel
- [ ] 部署到 Supabase
- [ ] 数据库迁移在生产环境跑
- [ ] 三个 Edge Function 部署

### 4.4 阶段 4 验证

- [ ] 在线书能正常听书
- [ ] 听书时切换语速/音色正常
- [ ] 关闭弹窗后迷你条继续工作
- [ ] 自动翻页连续朗读正常
- [ ] 听书完毕 toast 提示
- [ ] 截图归档：搜索、导入、书架 tab、阅读、听书 5 张关键截图

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 阶段 1 失败 | DB 迁移可逆：`DROP TABLE gutenberg_books CASCADE` |
| 阶段 2 失败 | 新增 composable + 组件，未改现有文件，回滚 = git revert |
| 阶段 3 失败 | Reader.vue 改动用 `if (gb)` 分支包裹，不影响本地书阅读 |
| 阶段 4 失败 | tts 加 source 字段，老调用不传 source 走 local 分支，向后兼容 |

---

## 预计工作量

- 阶段 1：1-2 天（DB + 3 个 Edge Function）
- 阶段 2：1 天（前端搜索 + 导入）
- 阶段 3：1-2 天（书架 tab + Reader 分支）
- 阶段 4：0.5-1 天（TTS + 部署）

**总计：3.5 - 6 天**（取决于调试时间）

---

## 不在本次范围（后续可加）

- 首页「经典书架」专区
- 「导入到本地」一键存到 Storage
- Open Library / Google Books 数据源
- 多语言支持（西、法、德等）
- 古登堡书收藏排行榜

---

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| （暂无） | | |
