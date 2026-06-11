-- =============================================================
-- 第二、三阶段：阅读统计 / 关注 / 社区 / 成就 / 全文搜索
-- =============================================================

-- 阅读会话心跳（每 30 秒写一条，最后聚合）
create table if not exists public.reading_sessions (
  id              bigserial primary key,
  user_id         uuid references auth.users(id) on delete cascade not null,
  book_id         uuid references public.books(id) on delete cascade not null,
  started_at      timestamptz default now(),
  duration_sec    integer default 0,         -- 本次心跳的阅读时长（秒）
  words_read      integer default 0,         -- 本次心跳"读过"的字数（按段落滚动估算）
  created_at      timestamptz default now()
);
create index if not exists rs_user_book_idx on public.reading_sessions(user_id, book_id);
create index if not exists rs_created_at_idx on public.reading_sessions(created_at);

-- 按天聚合的阅读统计（视图友好、查询快）
create table if not exists public.reading_stats (
  id              bigserial primary key,
  user_id         uuid references auth.users(id) on delete cascade not null,
  book_id         uuid references public.books(id) on delete cascade not null,
  stat_date       date not null,
  total_seconds   integer default 0,
  total_words     integer default 0,
  sessions_count  integer default 0,
  unique(user_id, book_id, stat_date)
);
create index if not exists rs_user_date_idx on public.reading_stats(user_id, stat_date desc);

-- 关注关系
create table if not exists public.follows (
  follower_id   uuid references auth.users(id) on delete cascade not null,
  followee_id   uuid references auth.users(id) on delete cascade not null,
  created_at    timestamptz default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows(followee_id);

-- 书评（1~5 星 + 文字）
create table if not exists public.reviews (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  book_id      uuid references public.books(id) on delete cascade not null,
  rating       smallint not null check (rating between 1 and 5),
  content      text,
  created_at   timestamptz default now(),
  unique(user_id, book_id)
);
create index if not exists reviews_book_idx on public.reviews(book_id, created_at desc);

-- 收藏夹
create table if not exists public.favorites (
  user_id     uuid references auth.users(id) on delete cascade not null,
  book_id     uuid references public.books(id) on delete cascade not null,
  created_at  timestamptz default now(),
  primary key (user_id, book_id)
);

-- 动态流（关注的人公开了书 / 写了书评 / 加了公开笔记）
create table if not exists public.activity (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  type         text not null,  -- 'book_shared' | 'review_added' | 'achievement'
  ref_id       uuid,           -- 关联的 book_id / review_id / achievement_id
  metadata     jsonb default '{}'::jsonb,
  created_at   timestamptz default now()
);
create index if not exists activity_created_idx on public.activity(created_at desc);
create index if not exists activity_user_idx on public.activity(user_id);

-- 成就定义
create table if not exists public.achievements (
  id            text primary key,           -- 'first_book' / 'pages_100' ...
  name          text not null,
  description   text not null,
  icon          text,                       -- emoji 或者 url
  threshold     integer default 1           -- 触发的阈值
);

-- 用户成就解锁
create table if not exists public.user_achievements (
  user_id        uuid references auth.users(id) on delete cascade not null,
  achievement_id text references public.achievements(id) on delete cascade not null,
  unlocked_at    timestamptz default now(),
  primary key (user_id, achievement_id)
);

-- 预置 8 个成就
insert into public.achievements (id, name, description, icon, threshold) values
  ('first_book',    '开启阅读之旅',   '上传并打开第一本书',          '📖', 1),
  ('pages_100',     '百页入门',       '累计阅读 100 页',             '📄', 100),
  ('pages_1000',    '千页行者',       '累计阅读 1000 页',            '📚', 1000),
  ('streak_7',      '七日连读',       '连续 7 天有阅读记录',         '🔥', 7),
  ('streak_30',     '三十日如一',     '连续 30 天有阅读记录',        '🌟', 30),
  ('note_10',       '笔墨留痕',       '累计添加 10 条笔记',          '✍️', 10),
  ('share_1',       '分享达人',       '第一本公开的书',              '🌐', 1),
  ('follower_5',    '小有名气',       '收获 5 个粉丝',               '👥', 5)
on conflict (id) do nothing;

-- =============================================================
-- RLS
-- =============================================================
alter table public.reading_sessions enable row level security;
alter table public.reading_stats enable row level security;
alter table public.follows enable row level security;
alter table public.reviews enable row level security;
alter table public.favorites enable row level security;
alter table public.activity enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;

-- 阅读会话/统计：只能写自己的，能读自己的
drop policy if exists "rs_all_own" on public.reading_sessions;
create policy "rs_all_own" on public.reading_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "stats_all_own" on public.reading_stats;
create policy "stats_all_own" on public.reading_stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 关注：自己关注的人自己看，别人能看到我关注了谁（用于动态流）
drop policy if exists "follows_read_all" on public.follows;
create policy "follows_read_all" on public.follows for select using (true);

drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self" on public.follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_self" on public.follows;
create policy "follows_delete_self" on public.follows
  for delete using (auth.uid() = follower_id);

-- 书评：所有人能读，自己能写
drop policy if exists "reviews_read_all" on public.reviews;
create policy "reviews_read_all" on public.reviews for select using (true);

drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews
  for insert with check (auth.uid() = user_id);

drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own" on public.reviews
  for update using (auth.uid() = user_id);

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews
  for delete using (auth.uid() = user_id);

-- 收藏：只能操作自己的
drop policy if exists "fav_all_own" on public.favorites;
create policy "fav_all_own" on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 动态：所有人能读
drop policy if exists "activity_read_all" on public.activity;
create policy "activity_read_all" on public.activity for select using (true);

drop policy if exists "activity_insert_self" on public.activity;
create policy "activity_insert_self" on public.activity
  for insert with check (auth.uid() = user_id);

drop policy if exists "activity_delete_self" on public.activity;
create policy "activity_delete_self" on public.activity
  for delete using (auth.uid() = user_id);

-- 成就定义：所有人能读
drop policy if exists "achievements_read_all" on public.achievements;
create policy "achievements_read_all" on public.achievements for select using (true);

drop policy if exists "user_ach_read_all" on public.user_achievements;
create policy "user_ach_read_all" on public.user_achievements for select using (true);

drop policy if exists "user_ach_insert_self" on public.user_achievements;
create policy "user_ach_insert_self" on public.user_achievements
  for insert with check (auth.uid() = user_id);

-- =============================================================
-- 升级 books 的全文索引（支持简介 + 标签）
-- =============================================================
drop index if exists books_title_idx;
create index books_fulltext_idx on public.books
  using gin(to_tsvector('simple',
    coalesce(title,'') || ' ' ||
    coalesce(author,'') || ' ' ||
    coalesce(description,'')
  ));

-- =============================================================
-- RPC：聚合心跳到 stats
-- =============================================================
create or replace function public.aggregate_reading_session(
  p_book_id uuid, p_seconds integer, p_words integer
) returns void
language sql security definer
as $$
  insert into public.reading_stats (user_id, book_id, stat_date, total_seconds, total_words, sessions_count)
  values (auth.uid(), p_book_id, current_date, p_seconds, p_words, 1)
  on conflict (user_id, book_id, stat_date)
  do update set
    total_seconds = public.reading_stats.total_seconds + excluded.total_seconds,
    total_words   = public.reading_stats.total_words   + excluded.total_words,
    sessions_count = public.reading_stats.sessions_count + 1;
$$;

-- RPC：解锁成就（重复调用幂等）
create or replace function public.unlock_achievement(p_id text)
returns boolean
language plpgsql security definer
as $$
begin
  insert into public.user_achievements (user_id, achievement_id)
  values (auth.uid(), p_id)
  on conflict do nothing;
  return found;
end;
$$;

-- RPC：用户主页统计
create or replace function public.get_user_stats(p_user uuid)
returns table (
  books_count      bigint,
  total_seconds    bigint,
  followers_count  bigint,
  following_count  bigint,
  achievements_count bigint
)
language sql security definer
as $$
  select
    (select count(*) from public.books where user_id = p_user),
    coalesce((select sum(total_seconds) from public.reading_stats where user_id = p_user), 0),
    (select count(*) from public.follows where followee_id = p_user),
    (select count(*) from public.follows where follower_id = p_user),
    (select count(*) from public.user_achievements where user_id = p_user);
$$;

-- 触发器：用户上传公开书时自动写一条动态
create or replace function public.on_book_shared()
returns trigger
language plpgsql security definer
as $$
begin
  if new.is_public = true and (old.is_public is null or old.is_public = false) then
    insert into public.activity (user_id, type, ref_id, metadata)
    values (new.user_id, 'book_shared', new.id,
      jsonb_build_object('title', new.title, 'author', new.author, 'format', new.file_format));
  end if;
  return new;
end;
$$;

drop trigger if exists books_shared_trigger on public.books;
create trigger books_shared_trigger
  after insert or update of is_public on public.books
  for each row execute function public.on_book_shared();

-- 触发器：用户写书评时自动写一条动态
create or replace function public.on_review_added()
returns trigger
language plpgsql security definer
as $$
begin
  insert into public.activity (user_id, type, ref_id, metadata)
  values (new.user_id, 'review_added', new.book_id,
    jsonb_build_object('rating', new.rating, 'book_id', new.book_id));
  return new;
end;
$$;

drop trigger if exists reviews_added_trigger on public.reviews;
create trigger reviews_added_trigger
  after insert on public.reviews
  for each row execute function public.on_review_added();