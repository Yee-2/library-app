-- =============================================================
-- 019: 维基文库（Wikisource）中文公版书集成
-- =============================================================
-- 维基文库是维基媒体的公版文本库，所有内容均为公有领域。
-- API: https://zh.wikisource.org/w/api.php
-- 无认证、无频率限制、中文公版书丰富（古典文学、史书、诗词等）
-- =============================================================

create table if not exists public.wikisource_books (
  book_id      uuid primary key references public.books(id) on delete cascade,
  page_title   text not null,               -- 维基文库页面标题，如"紅樓夢"
  page_id      integer not null,            -- 维基文库页面 ID
  language     text not null default 'zh',
  chapter_count integer default 1,          -- 子页面数（多章节作品）
  imported_at  timestamptz default now()
);

create index if not exists idx_wikisource_page_id
  on public.wikisource_books(page_id);

create index if not exists idx_wikisource_book_lang
  on public.wikisource_books(book_id, language);

-- RLS: 用户只能访问自己的维基文库书
alter table public.wikisource_books enable row level security;

drop policy if exists "wikisource_books_select_own" on public.wikisource_books;
create policy "wikisource_books_select_own" on public.wikisource_books
  for select using (
    book_id in (select id from public.books where user_id = auth.uid())
  );

drop policy if exists "wikisource_books_insert_own" on public.wikisource_books;
create policy "wikisource_books_insert_own" on public.wikisource_books
  for insert with check (
    book_id in (select id from public.books where user_id = auth.uid())
  );

drop policy if exists "wikisource_books_update_own" on public.wikisource_books;
create policy "wikisource_books_update_own" on public.wikisource_books
  for update using (
    book_id in (select id from public.books where user_id = auth.uid())
  );

drop policy if exists "wikisource_books_delete_own" on public.wikisource_books;
create policy "wikisource_books_delete_own" on public.wikisource_books
  for delete using (
    book_id in (select id from public.books where user_id = auth.uid())
  );
