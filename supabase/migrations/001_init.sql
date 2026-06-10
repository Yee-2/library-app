-- =============================================================
-- 图书馆 App 数据库 Schema
-- 在 Supabase SQL Editor 里一次性执行
-- =============================================================

-- 启用必要的扩展
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =============================================================
-- 1. 图书表
-- =============================================================
create table if not exists public.books (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  title           text not null,
  author          text,
  description     text,
  cover_url       text,
  file_url        text not null,           -- 在 Supabase Storage 中的路径
  file_format     text not null check (file_format in ('epub','pdf','txt','mobi')),
  file_size       bigint,
  language        text default 'zh',
  is_public       boolean default false,   -- 是否公开到在线书库
  download_count  integer default 0,       -- 公开书被下载次数
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists books_user_id_idx on public.books(user_id);
create index if not exists books_is_public_idx on public.books(is_public);
create index if not exists books_title_idx on public.books using gin(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(author,'')));

-- =============================================================
-- 2. 阅读进度
-- =============================================================
create table if not exists public.reading_progress (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  book_id         uuid references public.books(id) on delete cascade not null,
  cfi             text,                    -- EPUB 的位置标识
  page            integer default 1,       -- 适用于 PDF/TXT 的页码/位置
  percentage      real default 0,          -- 阅读百分比 0~100
  last_read_at    timestamptz default now(),
  unique(user_id, book_id)
);

create index if not exists progress_user_idx on public.reading_progress(user_id);

-- =============================================================
-- 3. 书签
-- =============================================================
create table if not exists public.bookmarks (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  book_id         uuid references public.books(id) on delete cascade not null,
  cfi             text,                    -- EPUB 位置
  page            integer,                 -- PDF/TXT 页码
  note            text,                    -- 书签备注
  color           text default '#facc15',
  created_at      timestamptz default now()
);

create index if not exists bookmarks_user_book_idx on public.bookmarks(user_id, book_id);

-- =============================================================
-- 4. 笔记 / 划线
-- =============================================================
create table if not exists public.notes (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  book_id         uuid references public.books(id) on delete cascade not null,
  cfi             text,                    -- EPUB 锚点
  page            integer,                 -- PDF/TXT 页码
  content         text not null,           -- 划线内容
  comment         text,                    -- 用户批注
  color           text default '#fbbf24',
  created_at      timestamptz default now()
);

create index if not exists notes_user_book_idx on public.notes(user_id, book_id);

-- =============================================================
-- 5. 更新时间触发器
-- =============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists books_set_updated_at on public.books;
create trigger books_set_updated_at
  before update on public.books
  for each row execute function public.set_updated_at();

-- =============================================================
-- 6. 行级安全策略 (RLS)
-- =============================================================
alter table public.books enable row level security;
alter table public.reading_progress enable row level security;
alter table public.bookmarks enable row level security;
alter table public.notes enable row level security;

-- 图书：用户能看自己 + 所有人能看到公开的
drop policy if exists "books_select_own_or_public" on public.books;
create policy "books_select_own_or_public" on public.books
  for select using (auth.uid() = user_id or is_public = true);

drop policy if exists "books_insert_own" on public.books;
create policy "books_insert_own" on public.books
  for insert with check (auth.uid() = user_id);

drop policy if exists "books_update_own" on public.books;
create policy "books_update_own" on public.books
  for update using (auth.uid() = user_id);

drop policy if exists "books_delete_own" on public.books;
create policy "books_delete_own" on public.books
  for delete using (auth.uid() = user_id);

-- 阅读进度/书签/笔记：只能操作自己的
drop policy if exists "progress_all_own" on public.reading_progress;
create policy "progress_all_own" on public.reading_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "bookmarks_all_own" on public.bookmarks;
create policy "bookmarks_all_own" on public.bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notes_all_own" on public.notes;
create policy "notes_all_own" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================
-- 7. 自动创建用户 profile（可选，方便记录昵称/头像）
-- =============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique,
  avatar_url  text,
  bio         text,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all" on public.profiles
  for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- 注册时自动创建 profile
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
