-- =============================================================
-- 018: 古登堡计划图书集成
-- =============================================================
-- 包含两张表：
--   1. gutenberg_catalog - 全站共享的古登堡元数据池（7万本 zh+en）
--   2. gutenberg_books   - 用户导入记录（1:1 FK 到 books）
-- 搜索走本地 Supabase 查询（gutenberg_catalog），文件按需从 gutenberg.org 代理下载
-- =============================================================

-- 启用 trgm 扩展（全文模糊搜索）
create extension if not exists pg_trgm;

-- =============================================================
-- 1. gutenberg_catalog：古登堡全量元数据（公开可读）
-- =============================================================
create table if not exists public.gutenberg_catalog (
  gutenberg_id   integer primary key,         -- 古登堡内部 ID
  title          text not null,
  author         text,                        -- 多个作者用 ; 分隔
  language       char(2) not null check (language in ('zh', 'en')),
  epub_url       text,                        -- epub 文件下载 URL
  txt_url        text,                        -- txt 文件下载 URL
  cover_url      text,                        -- 封面 URL（部分书有）
  download_count integer default 0,           -- 古登堡下载热度
  updated_at     timestamptz default now()
);

-- 语言过滤
create index if not exists idx_gutenberg_catalog_lang
  on public.gutenberg_catalog(language);

-- 标题模糊搜索
create index if not exists idx_gutenberg_catalog_title_trgm
  on public.gutenberg_catalog using gin(title gin_trgm_ops);

-- 作者模糊搜索
create index if not exists idx_gutenberg_catalog_author_trgm
  on public.gutenberg_catalog using gin(author gin_trgm_ops);

-- 热门排序
create index if not exists idx_gutenberg_catalog_popular
  on public.gutenberg_catalog(language, download_count desc);

-- gutenberg_catalog 是公开数据，启用 RLS 但允许全员读
alter table public.gutenberg_catalog enable row level security;

drop policy if exists "gutenberg_catalog_read_all" on public.gutenberg_catalog;
create policy "gutenberg_catalog_read_all" on public.gutenberg_catalog
  for select using (true);

-- 仅 service role 可写（通过 Edge Function gutenberg-sync）

-- =============================================================
-- 2. gutenberg_books：用户导入记录（1:1 FK → books）
-- =============================================================
create table if not exists public.gutenberg_books (
  book_id      uuid primary key references public.books(id) on delete cascade,
  gutenberg_id integer not null,
  language     char(2) not null check (language in ('zh', 'en')),
  format       text check (format in ('epub', 'txt')),
  imported_at  timestamptz default now(),

  -- 同一本书的同语言同格式只能导入一次
  unique (book_id, gutenberg_id, language, format)
);

create index if not exists idx_gutenberg_books_gutenberg_id
  on public.gutenberg_books(gutenberg_id);

create index if not exists idx_gutenberg_books_user_lang
  on public.gutenberg_books(book_id, language);

-- 行级安全策略 (RLS)
alter table public.gutenberg_books enable row level security;

drop policy if exists "gutenberg_books_select_own" on public.gutenberg_books;
create policy "gutenberg_books_select_own" on public.gutenberg_books
  for select using (
    book_id in (select id from public.books where user_id = auth.uid())
  );

drop policy if exists "gutenberg_books_insert_own" on public.gutenberg_books;
create policy "gutenberg_books_insert_own" on public.gutenberg_books
  for insert with check (
    book_id in (select id from public.books where user_id = auth.uid())
  );

drop policy if exists "gutenberg_books_update_own" on public.gutenberg_books;
create policy "gutenberg_books_update_own" on public.gutenberg_books
  for update using (
    book_id in (select id from public.books where user_id = auth.uid())
  );

drop policy if exists "gutenberg_books_delete_own" on public.gutenberg_books;
create policy "gutenberg_books_delete_own" on public.gutenberg_books
  for delete using (
    book_id in (select id from public.books where user_id = auth.uid())
  );