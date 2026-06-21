-- =============================================================
-- 018: 古登堡计划图书元数据表
-- =============================================================
-- 与 books 表 1:1 关系，存储古登堡特有的元数据
-- 不下载文件到 Storage，文件通过 gutenberg-fetch Edge Function 代理
-- =============================================================

create table if not exists public.gutenberg_books (
  book_id        uuid primary key references public.books(id) on delete cascade,
  gutenberg_id   integer not null,
  language       char(2) not null check (language in ('zh', 'en')),
  format         text check (format in ('epub', 'txt')),
  imported_at    timestamptz default now(),

  -- 同一本书的同语言同格式只能导入一次
  unique (book_id, gutenberg_id, language, format)
);

create index if not exists gutenberg_books_gutenberg_id_idx
  on public.gutenberg_books(gutenberg_id);

create index if not exists gutenberg_books_user_lang_idx
  on public.gutenberg_books(book_id, language);

-- =============================================================
-- 行级安全策略 (RLS)
-- =============================================================
alter table public.gutenberg_books enable row level security;

-- 用户只能访问自己导入的古登堡书（通过 JOIN books 验证 user_id）
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