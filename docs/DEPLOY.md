# 部署文档：从零上线到 yeecc.cn

本项目采用**全免费 + 零运维**架构：
- **前端** → Vercel（全球 CDN、自动 HTTPS）
- **后端** → Supabase（数据库 + 认证 + 存储 + Edge Functions）
- **域名** → yeecc.cn 解析到 Cloudflare（CDN 加速 + 抗攻击）
- **邮箱** → 浏览器登录

预计全部完成时间：**1~2 小时**（含注册和实名等待）

---

## 0. 准备清单

| 工具 | 用途 | 注册地址 |
|---|---|---|
| GitHub 账号 | 托管代码 | https://github.com |
| Vercel 账号 | 部署前端 | https://vercel.com（用 GitHub 登录） |
| Supabase 账号 | 数据库 + 后端 | https://supabase.com（用 GitHub 登录） |
| Cloudflare 账号 | DNS 解析 + CDN | https://dash.cloudflare.com |
| yeecc.cn 域名 | 你已经有了 | 确保解析权在 Cloudflare |

---

## 一、把代码推送到 GitHub

```bash
# 1. 在项目根目录初始化仓库
cd library-app
git init
git add .
git commit -m "init: 图书馆 app"

# 2. 在 GitHub 上创建一个新仓库（不要勾选 README / .gitignore）
#    例如：library-app

# 3. 关联并推送
git remote add origin git@github.com:你的用户名/library-app.git
git branch -M main
git push -u origin main
```

> 仓库根目录要包含 `frontend/` 和 `supabase/` 两个子目录。

---

## 二、配置 Supabase（数据库 + 认证 + 存储 + Edge Functions）

### 2.1 创建项目

1. 登录 https://supabase.com → New Project
2. 选一个离你近的区域（建议 `Singapore` 或 `Tokyo`，对中国大陆友好）
3. 设置数据库密码（**记下来，后面不会再看**）
4. 等待 1~2 分钟初始化完成

### 2.2 执行 SQL 建表

1. 左侧菜单 → SQL Editor → New query
2. 依次执行 `supabase/migrations/` 目录里的**全部**文件（按编号顺序）：
   - `001_init.sql` — 创建表 + RLS 策略
   - `002_storage.sql` — 创建存储桶 + 存储策略
   - `003_increment_download.sql` — 下载计数函数
   - `004_books_profiles_fk.sql` — 补 books→profiles 外键（让公开书库能关联用户名）
   - `005_phase2_3.sql` — 阅读统计 / 关注 / 社区 / 成就 / 全文搜索
   - `006_storage_key_ascii.sql` — original_filename（中文 key 修复）
   - `007_add_profiles_fk.sql` — 所有 user_id 列到 profiles 的 FK
   - `008_drop_duplicate_auth_fk.sql` — 移除冗余 auth.users FK（解决 PGRST201）
3. 每个文件打开后点 "Run"，显示 "Success" 再执行下一个

### 2.3 关闭邮箱验证（推荐，开发体验更好）

在生产环境**应该开启**，但前期测试时关闭可以省事：

1. Authentication → Providers → Email
2. 把 "Confirm email" 关掉

### 2.4 获取 API 密钥

Settings → API：
- **Project URL** → 记下来 = `https://xxx.supabase.co`
- **anon public key** → 记下来（前端用）
- **service_role key** → 记下来（部署 Edge Function 时用，**绝对不能给前端**）

### 2.5 部署 Edge Functions

```bash
# 1. 安装 Supabase CLI
# macOS
brew install supabase/tap/supabase

# Windows (Scoop)
scoop install supabase

# 或直接下载 https://github.com/supabase/cli/releases

# 2. 登录
supabase login

# 3. 关联项目
supabase link --project-ref 你的项目ref   # ref 就是 Project URL 里的 xxx 部分

# 4. 设置环境变量
supabase secrets set MINIMAX_API_KEY=sk-cp-D6evYSlbZzCCwE04WdjgMe3vJ_anq7YjZhS0k0Xv_AWlWZp_-lFyCnuJKXYMxVIEJDe8DGOFVjsFWW_yAfid-XTu6jdarNDoD1pzjApiydoF76L20sH25Qc
# 可选：自定义 TTS 端点（如果 MiniMax 提供专门的 TTS 端点，可以覆盖）
# supabase secrets set MINIMAX_TTS_URL=https://api.minimaxi.chat/v1/t2a_v2
# supabase secrets set MINIMAX_GROUP_ID=你的group_id

# 5. 部署（基础）
supabase functions deploy tts --no-verify-jwt
supabase functions deploy public-book-url --no-verify-jwt

# 6. 部署古登堡相关（4 个）
supabase functions deploy gutenberg-import --no-verify-jwt
supabase functions deploy gutenberg-fetch --no-verify-jwt
supabase functions deploy gutenberg-sync --no-verify-jwt

# 7. 设置古登堡同步的管理员白名单（逗号分隔的 user_id 列表）
#    这些用户可以触发 gutenberg-sync（从 pg_catalog.csv 同步元数据）
supabase secrets set ADMIN_USER_IDS=你的user_id_uuid1,你的user_id_uuid2
```

部署成功后，函数地址是：
- `https://xxx.supabase.co/functions/v1/tts`
- `https://xxx.supabase.co/functions/v1/public-book-url`
- `https://xxx.supabase.co/functions/v1/gutenberg-import`
- `https://xxx.supabase.co/functions/v1/gutenberg-fetch`
- `https://xxx.supabase.co/functions/v1/gutenberg-sync`

可以在 Dashboard → Edge Functions 里看到。

---

## 二·五、古登堡集成（可选功能）

> 如果不需要古登堡图书功能，**跳过此章节**即可。把 `VITE_ENABLE_GUTENBERG` 设为 `false` 可隐藏所有相关 UI。

### 1. 执行迁移

在 Supabase SQL Editor 执行：

```bash
# 在项目根目录
cat supabase/migrations/018_gutenberg.sql
```

复制内容到 SQL Editor 执行。会自动创建：
- `gutenberg_catalog` 表（全站共享的 7 万本 zh+en 元数据池）
- `gutenberg_books` 表（用户导入记录，1:1 FK → books）
- RLS 策略 + 索引

### 2. 导入古登堡元数据

任选一种方式：

**方式 A：通过 Edge Function（推荐）**

```bash
# 用 admin user 的 JWT 调用同步函数
curl -X POST \
  -H "Authorization: Bearer 你的admin用户的access_token" \
  -H "Content-Type: application/json" \
  https://你的项目.supabase.co/functions/v1/gutenberg-sync
```

首次会下载 `pg_catalog.csv`（21MB），解析后灌入 `gutenberg_catalog` 表。预计 1-3 分钟。

**方式 B：本地脚本**

```bash
# 1. 下载 CSV
curl -o scripts/pg_catalog.csv \
  https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv

# 2. 设置环境变量
export SUPABASE_URL=https://你的项目.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=你的service_role_key

# 3. 跑脚本
node scripts/import_gutenberg_catalog.mjs
```

### 3. 验证

```sql
-- 应该有约 6 万英文 + 1000 中文
SELECT language, count(*) FROM gutenberg_catalog GROUP BY language;
```

### 4. 定期同步（可选）

古登堡目录每周更新，建议每月跑一次 `gutenberg-sync` 拉取最新元数据。可手动跑，也可在 Edge Function 里加 cron 触发（后续优化）。

## 二·六、一键部署脚本

> 嫌手动敲命令烦？用 PowerShell 脚本一次走完：下载 CLI → 登录 → 链接 → 迁移 → 部署 → 同步。

### 用法

```powershell
# 在项目根目录
powershell -ExecutionPolicy Bypass -File scripts/deploy_gutenberg.ps1 `
  -ProjectRef 你的项目ref `
  -AdminUserIds "你的user_uuid1,你的user_uuid2"
```

### 必需参数

| 参数 | 说明 | 示例 |
|---|---|---|
| `-ProjectRef` | Supabase 项目 ref | `abcdefghij` |
| `-AdminUserIds` | 管理员 user_id（逗号分隔） | `a1b2c3d4-...,e5f6g7h8-...` |

### 可选参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `-CliVersion` | `2.107.0` | Supabase CLI 版本 |
| `-SkipMigration` | false | 跳过数据库迁移（需手动在 SQL Editor 执行） |
| `-SkipSync` | false | 跳过首次目录同步 |
| `-Force` | false | 强制重新下载 CLI |

### 脚本会做的事

1. 下载 Supabase CLI 到 `tools/supabase.exe`（如果不存在）
2. 检查登录状态，未登录会打开浏览器
3. 链接到指定项目
4. **可选**：用 psql 执行 `supabase/migrations/018_gutenberg.sql`
5. 部署 3 个 Edge Functions（gutenberg-import / -fetch / -sync）
6. 设置 `ADMIN_USER_IDS` secret
7. **可选**：用你的 admin token 触发 `gutenberg-sync` 首次同步
8. 列出已部署的 gutenberg-* 函数

### 失败处理

- **下载 CLI 失败**：国内网络可能访问 GitHub 慢，可设置 `http_proxy` 环境变量后重试
- **psql 未安装**：脚本会跳过迁移并提示手动在 Supabase SQL Editor 执行
- **admin token 失效**：跳过同步步骤，部署后手动跑：
  ```bash
  curl -X POST -H "Authorization: Bearer 你的新token" \
    https://你的项目.supabase.co/functions/v1/gutenberg-sync
  ```

### 完整示例

```powershell
# 第一次部署：完整流程
powershell -ExecutionPolicy Bypass -File scripts/deploy_gutenberg.ps1 `
  -ProjectRef abcdefghij `
  -AdminUserIds "550e8400-e29b-41d4-a716-446655440000"

# 只重新部署函数（跳过迁移和同步）
powershell -ExecutionPolicy Bypass -File scripts/deploy_gutenberg.ps1 `
  -ProjectRef abcdefghij `
  -AdminUserIds "550e8400-e29b-41d4-a716-446655440000" `
  -SkipMigration -SkipSync
```

---

## 三、配置并部署前端到 Vercel

### 3.1 在 Vercel 创建项目

1. 登录 https://vercel.com → Add New → Project
2. 选 `library-app` 仓库 → Import
3. **关键配置**：
   - **Root Directory**: 点 "Edit" → 选 `frontend`
   - **Framework Preset**: 自动识别为 `Vite`
   - **Build Command**: 留空（默认 `vite build`）
   - **Output Directory**: 留空（默认 `dist`）
   - **Install Command**: 留空（默认 `npm install`，如果你用 pnpm 这里改 `pnpm install`）

### 3.2 配置环境变量

在 Vercel 项目设置 → Environment Variables 添加：

| 变量名 | 值 | 说明 |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGc...` | Supabase anon public key |
| `VITE_APP_NAME` | `云端图书馆` | （可选）应用名 |
| `VITE_ENABLE_GUTENBERG` | `true` | （可选）古登堡功能开关，默认 true；设为 `false` 隐藏相关 UI |

> 注：Vite 的环境变量必须以 `VITE_` 开头才会暴露给前端。

环境选 **Production / Preview / Development** 全部勾上。

### 3.3 部署

1. 点 Deploy
2. 1~2 分钟后得到 `https://library-app-xxx.vercel.app`
3. 打开看看，能正常访问就说明前端 + Supabase 接通了

### 3.4 绑定自定义域名（yeecc.cn）

在 Vercel 项目 → Settings → Domains：

1. 输入 `yeecc.cn` → Add
2. Vercel 会显示需要添加的 DNS 记录（类型 + 名称 + 值）
3. 暂时先**不要在 Cloudflare 添加**，下一步一起做

---

## 四、配置 Cloudflare DNS（推荐路径）

把 `yeecc.cn` 的 DNS 解析放到 Cloudflare，可以**白嫖全球 CDN + 抗 DDoS + 免费 SSL**，比直接在域名注册商解析体验好很多。

### 4.1 把域名接入 Cloudflare

1. 登录 https://dash.cloudflare.com
2. Add a Site → 输入 `yeecc.cn`
3. 选 Free 计划（$0/月）
4. Cloudflare 会自动扫描现有 DNS 记录
5. Cloudflare 给你两个**新的 NS 记录**（形如 `anna.ns.cloudflare.com`）
6. 去你**域名注册商**（阿里云/腾讯云/GoDaddy 等）把 NS 记录改成 Cloudflare 给的
7. 等待 5 分钟 ~ 24 小时 NS 生效

### 4.2 在 Cloudflare 添加解析记录

DNS → Records → Add record：

| 类型 | 名称 | 目标 | 代理 |
|---|---|---|---|
| A | @ | `76.76.21.21` | Proxied（橙色云朵） |
| CNAME | www | `cname.vercel-dns.com` | Proxied（橙色云朵） |

> `76.76.21.21` 是 Vercel 的官方 IP。也可以用 CNAME 模式：
> 类型 CNAME、名称 @、目标 `cname.vercel-dns.com`，但根域名 A 记录更通用。

**或者**你也可以回到 Vercel 的 Domains 页面，让 Vercel 自动校验（推荐用这种，零配置）：

1. Vercel 给你两条记录，照着填到 Cloudflare：
   - `A` @  → `76.76.21.21`
   - `CNAME` www → `cname.vercel-dns.com`
2. 回到 Vercel 点 "Verify"，几分钟后显示 "Valid Configuration"

### 4.3 Cloudflare SSL 设置

SSL/TLS → Overview：
- 模式选 **Full (Strict)**
- Edge Certificates → Always Use HTTPS → **开启**
- Edge Certificates → Minimum TLS Version → **TLS 1.2**

### 4.4 Cloudflare 缓存配置（可选优化）

Caching → Configuration：
- **Caching Level**: Standard
- **Browser Cache TTL**: Respect Existing Headers

这样静态资源会走 Cloudflare 边缘缓存，加速访问。

---

## 五、最终验证清单

打开 `https://yeecc.cn`：

- [ ] 首页正常显示
- [ ] 能注册 / 登录
- [ ] 能上传 EPUB/PDF/TXT 文件
- [ ] 能在书架打开并阅读
- [ ] 切换字体、字号、主题正常生效
- [ ] 进度条会动，再次打开能回到上次位置
- [ ] 能加书签、加笔记
- [ ] 打开"在线书库"，把一本书设公开后能看到
- [ ] AI 听书能播放（注意：第一次 TTS 可能慢 1~2 秒，因为是实时合成）

---

## 六、常见问题

### Q1: 部署后白屏
按 F12 看 Console 错误：
- 如果是 `supabase is not defined` 或 `[Supabase] 缺少 VITE_SUPABASE_URL` → 检查 Vercel 环境变量 VITE_SUPABASE_URL / ANON_KEY 是否设置（Settings → Environment Variables，三种环境都勾上）
- 如果是 `404 index.html` → 检查 Vercel 的 Output Directory 是否为 `dist`

### Q1.5: Vercel 部署失败（构建报错）
最常见原因：
- **Root Directory 设错**：Vercel 项目 → Settings → General → Root Directory 必须设为 `frontend`。否则它在仓库根找 `package.json` 找不到 → build 失败
- **环境变量缺失**：构建时 Vite 读 `import.meta.env.VITE_*`，没设的话构建能过但运行会断。必须设 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`
- **Node 版本不匹配**：Vercel 默认 Node 18/20。如果 package.json 写了 `engines.node >= 20` 之类，Vercel 切到对应版本
- **vite.config.ts ESM 错误**：`__dirname` 不存在于 ESM，必须用 `import.meta.url` 推算。仓库已用后者写法

调试方法：Vercel 项目 → Deployments → 失败的 deployment → 展开日志看具体哪一步红。

### Q1.6: 部署后每次刷新都跳到登录页
原因：本地登录的 session 存于浏览器 localStorage，部署版域名不同时是另一个 origin，session 没带过去。在部署版重新登录一次即可。如果**同域名也跳登录**，检查 Supabase Auth → URL Configuration 是否把生产域名加进 Site URL 和 Redirect URLs。

### Q2: TTS 报错 "TTS upstream error"
- 检查 Supabase Edge Function 日志：Dashboard → Edge Functions → tts → Logs
- 确认 MINIMAX_API_KEY 已正确设置
- 确认 MiniMax API 端点正确（需要查官方文档确认是否 `api.minimaxi.chat` 或其他）
- API 调用余额是否充足

### Q3: 上传文件失败
- 检查 Storage 桶是否创建成功
- 检查 RLS 策略是否生效（看 SQL 是否都跑过）
- 看 supabase 日志：Dashboard → Logs → Storage

### Q4: Vercel 部署时 npm install 失败
如果用 pnpm：在 Vercel 项目设置里：
- Install Command: `npm install -g pnpm && pnpm install`

### Q5: 域名解析后访问还是旧网站
- NS 记录全球生效最久 24 小时
- 浏览器有 DNS 缓存：试无痕模式，或 `ipconfig /flushdns` (Windows) / `sudo dscacheutil -flushcache` (Mac)

### Q6: 想换正式 API key
```bash
supabase secrets unset MINIMAX_API_KEY
supabase secrets set MINIMAX_API_KEY=新的key
supabase functions deploy tts --no-verify-jwt
```

---

## 七、后续维护

**更新前端代码**：
```bash
# 改完代码后
git add . && git commit -m "xxx" && git push
# Vercel 自动部署，1~2 分钟生效
```

**更新 Edge Function**：
```bash
# 改完 supabase/functions/tts/index.ts 后
supabase functions deploy tts --no-verify-jwt
```

**数据库变更**：
在 Supabase SQL Editor 写新 SQL → 跑一遍。建议把变更 SQL 保存到 `supabase/migrations/00N_xxx.sql` 文件里，方便回溯。

完整的迁移清单（截至 2026-06-11）：

| 序号 | 文件 | 作用 |
|------|------|------|
| 001 | init.sql | 核心建表（books/profiles/progress/bookmarks/notes）+ RLS |
| 002 | storage.sql | 存储桶（book-files/book-covers）+ 存储策略 |
| 003 | increment_download.sql | 下载计数函数 |
| 004 | books_profiles_fk.sql | books → profiles FK（幂等） |
| 005 | phase2_3.sql | 阅读统计 / 关注 / 社区 / 成就 / 全文搜索 |
| 006 | storage_key_ascii.sql | books.original_filename（中文 key 修复用） |
| 007 | add_profiles_fk.sql | 所有 user_id 列 → profiles FK |
| 008 | drop_duplicate_auth_fk.sql | 移除冗余的 auth.users FK（解决 PGRST201） |

**迁移顺序**：按 001 → 008 依次跑一次即可；每个文件都是幂等的（drop if exists / on conflict do nothing）。

---

## 八、升级到生产级

如果流量起来了，考虑：
1. **Cloudflare R2** 替代 Supabase Storage（10GB 免费、零出站流量费）
2. **MiniMax TTS 流式输出**（改成 `stream: true` 减少首字延迟）
3. **Cloudflare Workers** 做 API 边缘缓存
4. **自定义 OpenAI 兼容端点**（如果 MiniMax 提供了 base_url 形式的接入）

---

**部署完成！** 你的网站现在跑在 `https://yeecc.cn` 上，前端 Vercel，后端 Supabase，DNS 走 Cloudflare 加速，全程零服务器成本。
