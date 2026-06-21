# 书屿 (Shu Yu)

一个**完全免费**的全栈 H5 阅读应用，支持自定义导入图书、多端同步、AI 听书。

## ✨ 功能特性

- 🔐 **邮箱密码登录**（Supabase Auth）
- 📚 **多格式图书导入**：EPUB / PDF / TXT / MOBI
- 🎨 **多种字体与主题**：宋体、楷体、黑体等，护眼/夜间/羊皮多种配色
- 🔖 **阅读进度、书签、笔记跨端同步**
- 🌍 **公开书库**：用户可分享自己的书，其他用户可下载或借阅到自己的书架
- 🤖 **AI 听书**：基于 MiniMax M3 TTS，支持多种音色和语速调节

## 🏗️ 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + TypeScript + Tailwind + Pinia |
| 后端 | Supabase（PostgreSQL + Auth + Storage + Edge Functions） |
| TTS | MiniMax M3 T2A（通过 Edge Function 代理） |
| 部署 | Vercel（前端）+ Supabase（后端）+ Cloudflare（DNS / CDN） |

## 📁 项目结构

```
library-app/
├── frontend/                # Vue 3 前端
│   ├── src/
│   │   ├── views/          # 页面：Home / Login / Library / Store / Reader
│   │   ├── stores/         # Pinia 状态：auth / reader
│   │   ├── lib/            # Supabase 客户端、API 封装
│   │   ├── types/          # TypeScript 类型
│   │   └── style.css
│   ├── vercel.json         # SPA 路由配置
│   └── package.json
├── supabase/
│   ├── functions/
│   │   ├── tts/            # AI 听书 Edge Function
│   │   └── public-book-url/# 公开书下载链接生成
│   └── migrations/         # 数据库 SQL（按顺序执行）
└── docs/
    └── DEPLOY.md           # 完整部署文档
```

## 🚀 快速开始

### 本地开发

```bash
cd frontend
npm install    # 或 pnpm install
cp .env.example .env       # 填入 Supabase URL 和 anon key
npm run dev
```

### 部署上线

详细步骤见 [docs/DEPLOY.md](./docs/DEPLOY.md)。

简要流程：
1. 在 Supabase 创建项目 → 跑迁移 SQL
2. 在 Supabase 部署 Edge Functions（设置 MINIMAX_API_KEY）
3. 把代码推 GitHub
4. 在 Vercel 导入项目，配置环境变量，部署
5. 在 Cloudflare 添加 DNS 记录，绑定 `yeecc.cn`

## 🔧 配置项

### 前端环境变量（`.env`）
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
VITE_APP_NAME=书屿
```

### Supabase Edge Function 环境变量
```bash
supabase secrets set MINIMAX_API_KEY=sk-xxx
supabase secrets set MINIMAX_TTS_URL=https://api.minimaxi.chat/v1/t2a_v2  # 可选
supabase secrets set MINIMAX_GROUP_ID=xxx  # 可选
```

## 📜 License

MIT
