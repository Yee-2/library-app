# 古登堡计划图书集成 — 实现计划

## 目标
让用户能在搜索环节发现并导入古登堡图书，进入自己的书架后即可阅读、听书、做笔记（在线阅读模式）。

## 设计文档
[docs/superpowers/specs/2026-06-21-gutenberg-integration-design.md](docs/superpowers/specs/2026-06-21-gutenberg-integration-design.md)

## 数据模型总览
- **books 表**：零改动，所有现有用户上传书继续使用
- **gutenberg_books 新表**：1:1 关系，PK = FK → books.id（用户导入记录）
- **gutenberg_catalog 新表**：全站共享的古登堡元数据池（约 7 万本 zh+en）
- **reading_progress / bookmarks / notes**：零改动，复用现有 book_id

## 数据源策略调整（重要）

⚠️ 原计划使用 [Gutendex](https://gutendex.com) API，**实测发现不可用**：
- Cloudflare 反爬虫（HTTP 403）
- robots.txt 禁止 `/books/` 路径
- robots.txt 明确禁止 ClaudeBot/GPTBot 等 AI 爬虫

✅ **调整为古登堡官方方案：**
- 一次性下载 `pg_catalog.csv` 到 Supabase `gutenberg_catalog` 表
- 搜索完全本地（PostgreSQL `pg_trgm` 模糊匹配）
- 文件下载走 `gutenberg.org/cache/epub/{id}/pg{id}-images-3.epub`
- 古登堡 [robot policy](https://www.gutenberg.org/policy/robot_access.html) 明确允许

## 实现策略
按 4 个阶段顺序实施，每个阶段独立可交付、单独合并 PR：
- 阶段 1：基础设施（DB + CSV 导入脚本 + 后端 Edge Functions）
- 阶段 2：搜索 + 导入（前端主要功能）
- 阶段 3：在线阅读（最复杂）
- 阶段 4：TTS + 收尾

---

## 阶段 1：基础设施 [done]

**目标：** DB 新表 + CSV 导入 + 3 个后端 Edge Function 上线（导入 / 拉取 / 同步）

### 1.0 下载 pg_catalog.csv + 字段映射 [done]

- [x] 用 curl 下载 `https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv` 到 `scripts/pg_catalog.csv`（21MB）
- [x] CSV 列结构（9 列）：`Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves`
- [x] **字段映射**（CSV 列 → DB 列）：
  - `Text#` → `gutenberg_id` (INT)
  - `Title` → `title` (TEXT)
  - `Authors` → `author` (TEXT，多作者用 `, ` 分隔)
  - `Language` → `language` (CHAR(2)，CSV 里是 ISO 639-1: `en` / `zh` 等)
  - ⚠️ CSV **没有** `epub_url` / `txt_url` / `cover_url` / `download_count` 列 —— 需要从古登堡网页解析或 URL 模板化
- [x] **URL 模板**（实测确认，HTTP 302 → 200 跟随后是真实文件）：
  - EPUB（推荐）：`https://www.gutenberg.org/ebooks/{id}.epub3.images` (含封面图)
  - EPUB（无图）：`https://www.gutenberg.org/ebooks/{id}.epub3.noimages`
  - EPUB（v2）：`https://www.gutenberg.org/ebooks/{id}.epub.images`
  - TXT：`https://www.gutenberg.org/ebooks/{id}.txt.utf-8`
  - **采用：`{id}.epub3.images`（有图版，184KB 验证成功）**
- [x] **下载 count 来源**：CSV 里没有这列。方案：
  - 方案 A：用 gutenberg_id 本身排序热度（ID 越小越老 = 越经典）
  - 方案 B：导流时从 catalog.csv 的 Issued 日期推断（旧书 = 受众广）
  - 方案 C：跑一个简单的 popularity 字段，每次 sync 时从古登堡「本周热门」页抓
  - **采用方案 A + B 复合**：`ORDER BY download_count DESC, gutenberg_id ASC` —— 后续可优化
- [x] **download_count 字段在 catalog 表保留为 0**，导入时不需要，等后续增量同步时填充

### 1.1 数据库迁移

- [ ] 创建 migration 文件 `supabase/migrations/018_gutenberg.sql`（合并 gutenberg_books + gutenberg_catalog 两张表）
- [ ] `CREATE EXTENSION IF NOT EXISTS pg_trgm`（用于全文模糊搜索）
- [ ] `CREATE TABLE gutenberg_books` （含 book_id PK+FK、4 字段、CHECK 约束）
- [ ] `CREATE INDEX idx_gutenberg_id ON gutenberg_books(gutenberg_id)`
- [ ] `CREATE INDEX idx_gutenberg_user_lang ON gutenberg_books(book_id, language)`
- [ ] `ALTER TABLE gutenberg_books ENABLE ROW LEVEL SECURITY`
- [ ] 创建 RLS policy：「用户只能访问自己的古登堡书」通过 JOIN books 验证 user_id
- [ ] `CREATE TABLE gutenberg_catalog`（含 gutenberg_id PK、8 字段、CHECK 约束 language IN ('zh','en')）
- [ ] `CREATE INDEX idx_gutenberg_catalog_lang ON gutenberg_catalog(language)`
- [ ] `CREATE INDEX idx_gutenberg_catalog_title_trgm USING gin(title gin_trgm_ops)`
- [ ] `CREATE INDEX idx_gutenberg_catalog_author_trgm USING gin(author gin_trgm_ops)`
- [ ] `CREATE INDEX idx_gutenberg_catalog_popular ON gutenberg_catalog(language, download_count DESC)`
- [ ] **gutenberg_catalog 表不启用 RLS**（公开数据，全员可读，参考 books 的 is_public 模式）
- [ ] 迁移应用到本地 Supabase 实例
- [ ] 验证：现有 books 数据完全不受影响

### 1.2 CSV 导入脚本（一次性任务）

- [ ] 创建 `scripts/import_gutenberg_catalog.mjs`（Node.js 脚本）
- [ ] 读 `scripts/pg_catalog.csv`（流式处理，21MB / 7万行）
- [ ] 过滤 `Language IN ('zh', 'en')`（约 60000 英文 + 1000 中文）
- [ ] 字段映射：
  ```
  Text#    → gutenberg_id
  Title    → title
  Authors  → author
  Language → language
  ```
- [ ] **URL 模板填充**（不解析 CSV 字段，直接拼）：
  - `epub_url = 'https://www.gutenberg.org/ebooks/' + id + '.epub3.images'`
  - `txt_url  = 'https://www.gutenberg.org/ebooks/' + id + '.txt.utf-8'`
  - `cover_url = NULL`（暂时留空，后续可从古登堡页面解析）
- [ ] 用 `pg` npm 包或 Supabase 批量 INSERT 到 `gutenberg_catalog`
- [ ] 进度日志：每 1000 条打印一次
- [ ] 去重：`ON CONFLICT (gutenberg_id) DO UPDATE` 保证幂等
- [ ] 本地运行：确认导入约 1000 本中文 + 60000+ 本英文
- [ ] 验证：`SELECT count(*), language FROM gutenberg_catalog GROUP BY language`

### 1.3 Edge Function: gutenberg-import

- [ ] `supabase/functions/gutenberg-import/index.ts` 新建
- [ ] 鉴权：必须登录（Supabase JWT）
- [ ] 入参校验：`{ gutenberg_id: int, language: 'zh'|'en' }`
- [ ] **从 gutenberg_catalog 表查元数据**（不再调 Gutendex）：
  ```
  SELECT title, author, cover_url FROM gutenberg_catalog
  WHERE gutenberg_id=? AND language=?
  ```
- [ ] **查重**：`SELECT b.id FROM books b JOIN gutenberg_books gb ON b.id=gb.book_id WHERE b.user_id=auth.uid() AND gb.gutenberg_id=? AND gb.language=? AND gb.format IS NULL`
  - 命中 → 返回 `{ exists: true, book_id }`，HTTP 200
- [ ] **事务写两表**：
  ```
  BEGIN
    INSERT INTO books (user_id, title, author, cover_url, file_url=NULL, file_type='gutenberg', ...)
      VALUES (auth.uid(), ?, ?, ?, NULL, 'gutenberg', ...)
    INSERT INTO gutenberg_books (book_id, gutenberg_id, language, format=NULL)
      VALUES (?, ?, ?)
  COMMIT
  ```
- [ ] 错误处理：catalog 找不到 → HTTP 404 + `{ error: 'not_found' }`
- [ ] 错误处理：事务失败 → ROLLBACK + HTTP 500
- [ ] 本地测试：用本地 JWT + 真实 gutenberg_id 验证

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
  3. 若 `format` 为 NULL → 默认选 epub，UPDATE gutenberg_books.format='epub'
  4. SQL: `SELECT epub_url, txt_url FROM gutenberg_catalog WHERE gutenberg_id=? AND language=?`
  5. 选下载 URL（epub 优先：`https://www.gutenberg.org/cache/epub/{id}/pg{id}-images-3.epub`）
  6. 构造 cache key = `${gutenberg_id}:${format}`
  7. 查缓存：命中 → 返回 base64
  8. 未命中 → 从 gutenberg.org 下载（10s 超时）
  9. 写入缓存
  10. 返回 base64 + content-type
- [ ] 错误处理：book_id 不属于当前用户 → 403
- [ ] 错误处理：catalog 找不到文件 URL → 404
- [ ] 错误处理：下载失败 → 502 + `{ error: 'fetch_failed' }`
- [ ] 本地测试：导入一本后调 fetch 验证

### 1.5 Edge Function: gutenberg-sync（手动同步）

- [ ] `supabase/functions/gutenberg-sync/index.ts` 新建
- [ ] 鉴权：必须登录 + 是管理员（白名单 user_id 或专用 service role key）
- [ ] 流程：
  1. fetch `https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv`（30s 超时）
  2. 解析 CSV（流式处理，7 万行不能一次加载）
  3. 过滤 `language IN ('zh', 'en')`
  4. 批量 UPSERT 到 gutenberg_catalog（每 500 行一批）
  5. 返回 `{ synced: number, languages: { zh: N, en: N } }`
- [ ] 本地测试：手动调一次 sync 验证

### 1.6 阶段 1 验证

- [ ] 迁移脚本在本地 Supabase 跑通
- [ ] CSV 导入脚本跑通，gutenberg_catalog 有约 60000+ 英文 + 1000+ 中文
- [ ] 3 个 Edge Function 都本地部署并能 curl 测试
- [ ] 没有现有功能被破坏

---

## 阶段 2：搜索 + 导入（前端）[done]

**目标：** 用户能在搜索页看到古登堡结果并加入书架

### 2.1 composable: useGutenbergSearch

- [ ] `src/composables/useGutenbergSearch.ts` 新建
- [ ] 导出 `useGutenbergSearch()`
- [ ] 返回 `{ results, loading, error, search }`
- [ ] `search(q)` 直接调 Supabase client（不走 Edge Function）：
  ```ts
  const { data } = await supabase
    .from('gutenberg_catalog')
    .select('gutenberg_id, title, author, language, cover_url, download_count')
    .eq('language', lang)  // 'zh' 或 'en' 根据查询自动判断
    .or(`title.ilike.%${q}%,author.ilike.%${q}%`)
    .order('download_count', { ascending: false })
    .limit(10)
  ```
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

## 阶段 3：在线阅读 [done]

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

## 阶段 4：TTS + 收尾 [done]

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
| Gutendex API 403 + robots.txt 禁止 | 1 | 切换到古登堡官方 pg_catalog.csv + /cache/ 路径 |
| Supabase CLI 在 Windows 不可用 | 1 | 用 Node.js 写本地测试脚本验证逻辑 |
| Deno runtime 本地缺失 | 1 | 用 Node.js 验证 base64 编码和 CSV 解析（核心算法） |
