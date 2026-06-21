# 古登堡计划图书集成 — 设计文档

**日期：** 2026-06-21
**作者：** Yee + Claude
**状态：** 已确认，等待实现

---

## 1. 背景与目标

### 1.1 背景

「云端图书馆」目前依赖用户自行上传（EPUB/PDF/TXT/MOBI）来扩充书源。这一模式对新用户门槛较高：新用户打开应用看到的是空书架，需要先自己找书、上传，才能开始阅读。

社区中常见的另一种模式是接入**开放的公有领域书库**，让新用户**搜索即得**，降低首次使用门槛。本项目选择接入 [古登堡计划 (Project Gutenberg)](https://www.gutenberg.org/)——这是全球最大的公有领域电子书库，**合法、可商用、无需授权**：

- 古登堡由 Michael Hart 于 1971 年创立，所有收录书籍均为版权已过期或作者主动放弃版权
- 收录约 **7 万+** 本图书，覆盖文学、哲学、历史、科学等
- 提供开放 API：[Gutendex](https://gutendex.com/)（无认证、无配额、无费用）
- 古登堡官方允许并鼓励第三方应用集成

### 1.2 目标

让用户能在「搜索」环节直接发现并导入古登堡图书，进入自己的书架即可阅读、听书、做笔记。

### 1.3 非目标（YAGNI）

- ❌ **不在首页做「经典书架」专区**（浏览 + 筛选体验需要专门设计，超出 MVP）
- ❌ **不做在线阅读之外的复杂功能**（如推荐算法、相似书、社交分享）
- ❌ **不下载文件到 Supabase Storage**（用户已明确选择「只保存元数据 + 远程链接」）
- ❌ **不支持古登堡以外的其他数据源**（Open Library、Google Books 留待后续）

---

## 2. 用户故事

### 主要场景

**故事 1：搜索导入**
> 作为新用户，我想在搜索框输入书名时看到古登堡的结果，以便快速找到想读的书并加入书架。

**故事 2：在线阅读**
> 作为导入古登堡书的用户，我想点击书架里的书后能直接阅读，并能翻页、添加书签、做笔记。

**故事 3：听书**
> 作为导入古登堡书的用户，我希望这本「在线图书」也能用现有的 AI 听书功能朗读。

**故事 4：离线感知**
> 作为用户，我希望清楚知道哪些书是本地的、哪些需要联网阅读，避免离线时点开一脸懵。

### 边界场景

- 搜索词无古登堡结果 → 隐藏「古登堡计划」分组，不显示空标题
- 古登堡服务器临时不可用 → 后端超时（5s），前端 toast「古登堡服务暂不可用，请稍后重试」
- 联网中断时点开在线书 → Reader 检测到拉取失败，toast「请检查网络连接」并提供重试按钮
- Edge Function 重启（缓存清空）→ 重新代理拉取，用户无感知（首次翻页稍慢）

---

## 3. 架构概览

```
┌──────────────────────────────────────────────────────────┐
│                      前端 (Vue 3)                        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Library.vue (书架页)                              │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ Tabs: [我的书架] [在线图书]                  │  │  │
│  │  │  - 我的书架: SELECT * FROM books              │  │  │
│  │  │    WHERE user_id=xxx AND id NOT IN            │  │  │
│  │  │    (SELECT book_id FROM gutenberg_books)      │  │  │
│  │  │  - 在线图书: SELECT b.* FROM books b          │  │  │
│  │  │    JOIN gutenberg_books gb ON b.id=gb.book_id │  │  │
│  │  │    WHERE b.user_id=xxx                        │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Store.vue (公开书库页 / 搜索入口)                │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ 🔍 [战争与和平]                              │  │  │
│  │  │                                               │  │  │
│  │  │ ── 古登堡计划 ──────────                     │  │  │
│  │  │ 📖 战争与和平  [俄]托尔斯泰                  │  │  │
│  │  │    EPUB · TXT · 1.4MB  [➕ 加入书架]         │  │  │
│  │  │                                               │  │  │
│  │  │ ── 公开书库 ────────────                     │  │  │
│  │  │ 暂无用户分享                                  │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Reader.vue (复用现有阅读器)                      │  │
│  │  - 新增「在线图书」分支：从 proxy 拉取整本书      │  │
│  │  - 进度/书签/笔记复用 books 表 + reading_progress │  │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼─────────────────────────────────┐
│            Supabase Edge Functions (Deno)                │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  POST /functions/v1/gutenberg-search              │  │
│  │  - 入参：{ q: string, page?: number }              │  │
│  │  - 调用 Gutendex API，languages=zh|en 过滤        │  │
│  │  - 返回：标准化后的书籍列表                       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  POST /functions/v1/gutenberg-import              │  │
│  │  - 入参：{ gutenberg_id: number }                 │  │
│  │  - 调用 Gutendex 拉元数据                          │  │
│  │  - 事务:INSERT books → INSERT gutenberg_books        │  │
│  │  - 返回：book_id                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  GET /functions/v1/gutenberg-fetch?book_id=xxx    │  │
│  │  - book_id → 查 gutenberg_books 取 gutenberg_id+format   │  │
│  │  - 查内存缓存：命中 → 直接返回                    │  │
│  │  - 未命中：代理下载整本 → 写入缓存 → 返回 base64  │  │
│  │  - 缓存：Map<gutenberg_id+format, {bytes, ts}>    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  TTS Edge Function (复用现有 tts/)                │  │
│  │  - 新增分支：source=online → 从缓存拉当前页文本   │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                     HTTP│     ↑│
                         ▼     │
┌──────────────────────────────────────────────────────────┐
│                 外部服务 (无需授权)                       │
│                                                          │
│  - https://gutendex.com/books/?search=...&languages=zh  │
│  - https://www.gutenberg.org/cache/epub/{id}/pg{id}.epub │
│  - https://www.gutenberg.org/files/{id}/old/{id}-0.txt   │
└──────────────────────────────────────────────────────────┘
```

---

## 4. 数据模型变更

### 4.1 books 表（**无变更**）

保持现有结构完全不动。所有用户上传的书继续走 books 表，不受古登堡功能影响。

### 4.2 新表：gutenberg_books

```sql
CREATE TABLE gutenberg_books (
  book_id INT PRIMARY KEY
    REFERENCES books(id) ON DELETE CASCADE,
  gutenberg_id INT NOT NULL,
  language CHAR(2) NOT NULL
    CHECK (language IN ('zh', 'en')),
  format TEXT
    CHECK (format IN ('epub', 'txt')),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 一致性：每本书只能对应一个 (gutenberg_id, language, format) 组合
  CONSTRAINT uniq_gutenberg_per_user_format
    UNIQUE (book_id, gutenberg_id, language, format)
);

-- 加速「查重」查询
CREATE INDEX idx_gutenberg_id ON gutenberg_books(gutenberg_id);

-- 加速「查用户所有古登堡书」
CREATE INDEX idx_gutenberg_user_lang
  ON gutenberg_books(book_id, language);

-- RLS：用户只能看到自己导入的古登堡书
ALTER TABLE gutenberg_books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能访问自己的古登堡书"
  ON gutenberg_books FOR ALL
  USING (
    book_id IN (SELECT id FROM books WHERE user_id = auth.uid())
  );

-- 通过 books.id 关联,自动继承 books 的 RLS
```

**字段说明：**
- `book_id`：**同时是主键和外键**，对应 books 表里的那条记录（FK ON DELETE CASCADE）
- `gutenberg_id`：古登堡内部 ID（跨用户可重复）
- `language`：zh / en
- `format`：用户首次阅读时**自动选择**（古登堡一本书通常提供 epub + txt，优先 epub），存到这里供后续复用
- `imported_at`：导入时间

### 4.3 为什么用双表 1:1 而不是 books 加字段

| 维度 | books 加字段 | **双表 1:1（采用）** |
|------|------------|---------------------|
| books 表改动 | 4 个字段 + 索引 | **零改动** |
| reading_progress / bookmarks / notes 改动 | 无 | **无** |
| 未来扩展（如下载次数、缓存命中） | 全部塞 books 表 | **独立 gutenberg_books 表** |
| 字段语义污染 | local 书多了 4 个无意义字段 | **彻底隔离** |
| 导入复杂度 | INSERT 1 行 | INSERT 2 行（事务） |
| 回滚成本 | DROP 4 列 | DROP 1 张表 |

### 4.4 唯一约束与查重

**设计：**
- `gutenberg_books` 唯一约束：`(book_id, gutenberg_id, language, format)` —— 同一用户、同一种语言版本只能存在一次
- 业务含义：用户可以同时持有中英两版，或同一本书的 epub + txt 两个格式
- 重复点击「加入书架」时：**通过 gutenberg_books JOIN books 查这个组合** → 命中则 toast「已在你的书架」并跳转；未命中则事务插入两表

### 4.5 reading_progress / bookmarks / notes

**完全复用现有表**，无变更。`book_id` 外键指向 `books.id`，无论对应的是 local 书还是 gutenberg 书。

---

## 5. 组件设计

### 5.1 前端新增

| 文件 | 职责 |
|------|------|
| `src/views/Search.vue`（改） | 搜索入口：合并「用户分享」+「古登堡」两个分组 |
| `src/components/GutenbergBookCard.vue` | 古登堡结果卡片：封面、标题、作者、语言徽章、格式、大小、加入按钮 |
| `src/composables/useGutenbergSearch.ts` | 搜索 hook：调用 Edge Function、防抖、loading、错误处理 |
| `src/composables/useGutenbergImport.ts` | 导入 hook：调 gutenberg-import、loading、错误处理、登录态校验 |
| `src/views/Library.vue`（改） | 书架页加 tab：「我的书架」/「在线图书」 |
| `src/views/Reader.vue`（改） | 新增「在线图书」分支：从 gutenberg-fetch 拉文件后走现有 EPUB/TXT 解析路径 |

### 5.2 后端新增

| 文件 | 职责 |
|------|------|
| `supabase/functions/gutenberg-search/index.ts` | 搜索代理：调 Gutendex，过滤 zh/en |
| `supabase/functions/gutenberg-import/index.ts` | 导入：拉元数据，事务写 books + gutenberg_books |
| `supabase/functions/gutenberg-fetch/index.ts` | 阅读代理：内存缓存 + 整本代理下载 |
| `supabase/functions/gutenberg-fetch/cache.ts` | 缓存 Map：`Map<gutenberg_id+format, {bytes, ts}>` |
| `supabase/functions/tts/index.ts`（改） | TTS 新增 online 分支 |

### 5.3 复用现有

- `src/lib/supabase.ts`：Supabase 客户端
- `src/stores/auth.ts`：登录态（古登堡功能要求登录才能导入）
- `src/router.ts`：路由配置（Search.vue 已存在，可能改入口）
- `src/components/BookCard.vue`：本地书的卡片（古登堡用新组件）
- `supabase/migrations/`：现有 books / book_files / reading_progress / bookmarks / notes

---

## 6. 关键流程

### 6.1 搜索流程

```
[用户输入"战争与和平"]
     ↓ (debounce 300ms)
[useGutenbergSearch 调 gutenberg-search?q=战争与和平]
     ↓
[Edge Function 调 Gutendex API]
     ↓
[过滤 languages=zh,en + 排除无文件的结果]
     ↓
[返回最多 10 本]
     ↓
[前端渲染 GutenbergBookCard 列表]
```

**搜索源策略：**
- 搜索时**同时发起**两个请求：本地公开书库 + 古登堡
- 都在 5s 内超时，否则显示「该来源暂不可用」

### 6.2 导入流程

```
[用户点击"加入书架"]
     ↓
[useGutenbergImport 检查登录态]
     ↓ 未登录 → toast "请先登录"
[检查是否已导入：books JOIN gutenberg_books WHERE user_id=xxx AND gutenberg_id=xxx AND language=xxx]
     ↓ 已存在 → toast "已在你的书架" + 跳转 /library?tab=online
[调 gutenberg-import { gutenberg_id, language }]
     ↓
[Edge Function 从 Gutendex 拉元数据（标题、作者、封面 URL）]
     ↓
[开始数据库事务]
  ├─ INSERT INTO books (user_id, title, author, cover_url, file_url=NULL, file_type='gutenberg')
  └─ INSERT INTO gutenberg_books (book_id, gutenberg_id, language, format=NULL)
[COMMIT]
     ↓
[返回新 book_id]
     ↓
[前端跳转 /library?tab=online&highlight={book_id}]
```

### 6.3 阅读流程（在线图书）

```
[用户点击在线图书]
     ↓
[Reader.vue 加载 book_id → 查 books JOIN gutenberg_books]
     ↓ 检测到 gutenberg_books 记录存在 → 这是古登堡书
     ↓
[调用 gutenberg-fetch?book_id={id}]
     ↓
[Edge Function 用 book_id 查 gutenberg_books 取 gutenberg_id+format]
  ├─ format 已选（如 epub）→ 直接用
  └─ format NULL（首次阅读）→ 默认选 epub，更新 gutenberg_books.format
     ↓
[Edge Function 查缓存 Map<gutenberg_id+format, ...>]
   ├─ 命中 → 直接返回 base64
   └─ 未命中 → 从 gutenberg.org 下载整本 → 写入缓存 → 返回 base64
     ↓
[前端拿到 base64 → 转 Blob → URL.createObjectURL → 走现有 epub.js / txt 解析]
     ↓
[后续翻页/进度/书签与本地书完全一致]
```

### 6.4 TTS 流程（在线图书）

```
[用户点击听书]
     ↓
[Reader.vue 检测到 gutenberg_books 记录存在 → 传 source='online' 给 TTS API]
     ↓
[TTS Edge Function 检测 source='online']
     ↓
[从缓存查 book_id 对应的 bytes + 当前页范围]
     ↓
[提取文本（EPUB 章节 / TXT 切片）]
     ↓
[走现有 MiniMax TTS 流程]
```

---

## 7. 错误处理

| 错误场景 | 处理 |
|---------|------|
| 古登堡 API 5xx / 超时 | toast「古登堡服务暂不可用，请稍后重试」，搜索结果不显示 |
| Gutendex 返回 404 | 单本书导入失败：toast「该书暂不可用」 |
| Edge Function 内存缓存命中失败（重启） | 重新代理下载，对用户透明（首次翻页稍慢） |
| 用户未登录点击「加入书架」 | toast「请先登录」+ 跳转到 /login |
| 已导入重复点击 | toast「已在你的书架」+ 跳转 /library?tab=online |
| 在线阅读时断网 | Reader 检测 fetch 失败，toast「请检查网络连接」+ 重试按钮 |
| Edge Function 单实例内存占用过大 | 单本书 > 50MB 直接拒绝缓存，提示用户选择其他版本 |
| Gutendex rate limit | 暂未触发（古登堡官方允许），加客户端节流 60 req/min/IP |

---

## 8. 性能与限额

### 8.1 缓存大小估算

Edge Function 单实例默认 256MB 内存。
- 古登堡书籍平均 1-3MB，最大 50MB
- 单实例缓存约 **50-100 本**
- 跨实例不共享（冷启动会重新拉）

**LRU 策略：** 单实例内存达到 100MB 时，清除最久未访问的 50% 条目。
（实现：Map 按插入顺序，最老的在前，超过阈值时 splice(0, n/2)）

### 8.2 网络延迟

- 国内 → 古登堡服务器（美国）：首次拉取 2-10s
- 缓存命中后：本地代理，< 500ms

### 8.3 Vercel / Supabase 限额

- Edge Function 调用次数：免费额度 50 万次/月，本功能预计 < 1 万/月
- 网络出口：免费额度 100GB/月，古登堡书平均 2MB × 5000 本 = 10GB
- 不会触碰限额

---

## 9. 测试策略

### 9.1 单元测试（建议但 MVP 不强制）

- `gutenberg-search` Edge Function：给定 query，验证返回字段格式
- `gutenberg-import`：模拟 Gutendex 响应，验证 books 表写入
- `cache.ts` LRU 逻辑

### 9.2 集成测试（手测 + 截图）

1. **搜索中文**：「战争与和平」→ 看到中文版结果
2. **搜索英文**：「War and Peace」→ 看到英文版结果
3. **搜索其他语言**：「Don Quixote」（西班牙）→ 不显示
4. **导入**：点击加入 → 跳转到 /library?tab=online → 看到新书
5. **重复导入**：再次搜索同一本 → 加入时 toast「已在你的书架」
6. **未登录导入**：登出后再点 → toast「请先登录」
7. **在线阅读**：打开导入的书 → 正常翻页、添加书签
8. **TTS**：听书 → 正常播放
9. **断网**：断网后打开在线书 → 友好错误提示
10. **缓存命中**：同一本书在 5 分钟内第二次打开 → 明显更快
11. **缓存失效**：Edge Function 重启后打开 → 第一次稍慢，第二次恢复

### 9.3 边界测试

- 搜索空字符串 → 后端拒绝（400）
- 搜索特殊字符 → URL 编码处理
- 导入 gutenberg_id 不存在 → 404 + 友好提示
- 并发导入同一本 → 第二个请求检测到已存在，走「已在你的书架」分支

---

## 10. 安全与合规

### 10.1 古登堡合规

- 古登堡所有书籍均为公有领域（美国版权法下）或作者主动放弃版权
- 古登堡官方明确允许并鼓励第三方应用集成：[https://www.gutenberg.org/policy/robot_access.html](https://www.gutenberg.org/policy/robot_access.html)
- Gutendex API 无需授权、无配额限制、无费用
- 我们需要在应用的「关于」页面添加「图书来源：Project Gutenberg」致谢（合规要求）

### 10.2 数据安全

- Edge Function 内部 fetch 古登堡：HTTPS，无需额外鉴权
- 用户数据（书架、进度、笔记）仍存 Supabase，受 RLS 保护
- 古登堡书不下载到 Storage，避免任何潜在的版权争议（公有领域本身允许，但保守起见不持久化）

### 10.3 Robots 协议

古登堡官方 robots.txt 允许全站爬取。我们通过 API 访问，更友好。

---

## 11. 迁移与回滚

### 11.1 数据库迁移

- **新增一张表** `gutenberg_books`（无破坏性变更）
- books 表完全不动，所有现有数据保持原状
- 迁移可逆：`DROP TABLE gutenberg_books CASCADE` 即可

### 11.2 代码回滚

- 5 个新文件 + 3 个改文件
- 回滚：删除新文件 + git revert 改文件
- 功能开关：通过 `VITE_ENABLE_GUTENBERG` 环境变量控制（默认开启）

### 11.3 前端兼容

- 老用户（只有本地书）：书架 tab 默认「我的书架」，体验零变化
- 新用户（只有古登堡书）：可正常导入、阅读
- 混合用户：tab 自由切换

---

## 12. 后续路线（不在本次范围）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P2 | 首页「经典书架」专区 | 7 万本浏览 + 分类筛选 |
| P2 | 古登堡书「加入本地书架」选项 | 一键存到 Storage，离线可读 |
| P3 | Open Library 集成 | 补充古登堡覆盖不足的现代书 |
| P3 | 多语言支持 | 西班牙、法语、德语等 |
| P3 | 古登堡书「收藏排行榜」 | 站内热门导入书推荐 |

---

## 13. 实现清单（给 writing-plans 用）

1. 数据库迁移：创建 `gutenberg_books` 表 + 索引 + RLS
2. Edge Function：`gutenberg-search`
3. Edge Function：`gutenberg-import`（事务写 books + gutenberg_books）
4. Edge Function：`gutenberg-fetch` + `cache.ts`
5. Edge Function：`tts` 加 online 分支
6. 前端：`GutenbergBookCard.vue`
7. 前端：`useGutenbergSearch.ts` + `useGutenbergImport.ts`
8. 前端：`Search.vue` 加古登堡分组
9. 前端：`Library.vue` 加 tab（查询带 JOIN/NOT IN）
10. 前端：`Reader.vue` 加在线图书分支（检测 gutenberg_books 存在）
11. 环境变量 + Vercel 配置
12. 关于页加古登堡致谢
13. 手测清单执行 + 截图归档
14. 部署上线

---

## 14. 决策日志

| 决策 | 选择 | 替代方案 | 选择理由 |
|------|------|---------|---------|
| 数据源 | 古登堡 | Open Library / Google Books | 古登堡完全免费无 API Key，书籍可直接下载 |
| 集成深度 | 仅搜索导入 | 首页专区 / 在线阅读 | YAGNI，先做高频需求 |
| 存储策略 | 只存元数据 + 远程链接 | 下载到 Storage | 用户决策，节省 Supabase 空间 |
| 缓存位置 | Edge Function 内存 | Storage 临时 / KV | 用户决策，重启丢失可接受 |
| 缓存 TTL | 不设置 | 1h / 24h | 用户决策，简单优先 |
| 书架区分 | tab 分类 | badge / 点击后提示 | 可发现性最强，实现简单 |
| TTS 支持 | 复用现有 | 古登堡不支持听书 | 体验一致性 |
| 进度存储 | 双表 1:1（gutenberg_books 独立） | books 加字段 | books 零改动，扩展性最强 |

---

## 15. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 古登堡服务器不可达（国内网络） | 中 | 加 5s 超时，友好错误提示；后续可加 Cloudflare 镜像代理 |
| Edge Function 内存溢出 | 低 | 单本书 > 50MB 拒绝；LRU 清理 |
| 用户重复导入 | 低 | books JOIN gutenberg_books 按 (book_id, gutenberg_id, language, format) 查重 |
| 古登堡版权争议 | 极低 | 公有领域已明确，添加致谢；不下载到 Storage 进一步降低风险 |
| Gutendex API 变更 | 低 | 单文件封装 `gutendex-api.ts`，变更只影响一处 |
| 用户期望「能离线读古登堡书」 | 中 | UI 上明确「在线图书」tab 区分；后续可加「导入到本地」功能 |

---

**文档版本：** v1.0
**下次更新：** 实施后根据实际反馈修订
