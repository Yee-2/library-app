-- =============================================================
-- 007: 给所有 "user_id 引用 auth.users" 的表额外建立到 profiles 的 FK
--
-- 症状：前端用
--   select=*,profiles(username,avatar_url)
--   select=*,profiles!follows_follower_id_fkey(...)
-- PostgREST 返回 400 Bad Request
--
-- 根因：这些表的 user_id 列只 references auth.users(id)，
--      缺一条到 public.profiles(id) 的外键，
--      PostgREST 的嵌入查询靠 FK relationships 解析，关系不存在就 400。
--
-- 修复：对每张表加一条 to public.profiles(id) 的 FK (cascade)，
--       命名规范：<table>_<col>_profiles_fkey
-- =============================================================

-- 1) reviews.user_id  -> profiles
alter table public.reviews
  drop constraint if exists reviews_user_id_profiles_fkey;
alter table public.reviews
  add constraint reviews_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 2) activity.user_id -> profiles
alter table public.activity
  drop constraint if exists activity_user_id_profiles_fkey;
alter table public.activity
  add constraint activity_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 3) favorites.user_id -> profiles
alter table public.favorites
  drop constraint if exists favorites_user_id_profiles_fkey;
alter table public.favorites
  add constraint favorites_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 4) reading_sessions.user_id -> profiles
alter table public.reading_sessions
  drop constraint if exists reading_sessions_user_id_profiles_fkey;
alter table public.reading_sessions
  add constraint reading_sessions_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 5) reading_stats.user_id -> profiles
alter table public.reading_stats
  drop constraint if exists reading_stats_user_id_profiles_fkey;
alter table public.reading_stats
  add constraint reading_stats_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 6) user_achievements.user_id -> profiles
alter table public.user_achievements
  drop constraint if exists user_achievements_user_id_profiles_fkey;
alter table public.user_achievements
  add constraint user_achievements_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- 7) follows.follower_id -> profiles
alter table public.follows
  drop constraint if exists follows_follower_id_profiles_fkey;
alter table public.follows
  add constraint follows_follower_id_profiles_fkey
  foreign key (follower_id) references public.profiles(id) on delete cascade;

-- 8) follows.followee_id -> profiles
alter table public.follows
  drop constraint if exists follows_followee_id_profiles_fkey;
alter table public.follows
  add constraint follows_followee_id_profiles_fkey
  foreign key (followee_id) references public.profiles(id) on delete cascade;

-- 9) 已有 004 里 books -> profiles 的 FK，重命名以与命名规范一致
alter table public.books
  drop constraint if exists books_user_id_profiles_fkey;
alter table public.books
  add constraint books_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- =============================================================
-- 10) 同步刷新 PostgREST 的 schema cache（保险起见）
-- =============================================================
notify pgrst, 'reload schema';
