-- =============================================================
-- 008: 删除指向 auth.users 的冗余 user_id FK，只保留 -> profiles
--
-- 症状：PostgREST 报 PGRST201
--   "Could not embed because more than one relationship was found
--    for 'books' and 'profiles'"
--
-- 根因：books / reviews / activity / favorites / reading_sessions /
--      reading_stats / user_achievements / follows 几张表的 user_id
--      列同时有两条 FK：
--        a) 001_init.sql 显式建的  -> auth.users(id)
--           （PG 自动命名为 <table>_user_id_fkey）
--        b) 007_add_profiles_fk.sql 新建的  -> public.profiles(id)
--           （命名为 <table>_user_id_profiles_fkey）
--      PostgREST 看到两条关系，不知道嵌入查询该走哪条。
--
-- 修复：删除指向 auth.users 的旧 FK，只保留指向 profiles 的那条。
--      profiles.id 本身就 references auth.users(id) on delete cascade，
--      所以删除 auth.users 行时：auth.users -> profiles -> 其他表 仍能级联。
-- =============================================================

-- books
alter table public.books
  drop constraint if exists books_user_id_fkey;

-- reviews
alter table public.reviews
  drop constraint if exists reviews_user_id_fkey;

-- activity
alter table public.activity
  drop constraint if exists activity_user_id_fkey;

-- favorites
alter table public.favorites
  drop constraint if exists favorites_user_id_fkey;

-- reading_sessions
alter table public.reading_sessions
  drop constraint if exists reading_sessions_user_id_fkey;

-- reading_stats
alter table public.reading_stats
  drop constraint if exists reading_stats_user_id_fkey;

-- user_achievements
alter table public.user_achievements
  drop constraint if exists user_achievements_user_id_fkey;

-- follows 的两列 PG 默认约束名不一定是 follower_id/followee_id 形式，
-- 保险起见按 pg_constraint 自动生成规范列一下
do $$
declare r record;
begin
  for r in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where contype = 'f'
      and connamespace = 'public'::regnamespace
      and conrelid = 'public.follows'::regclass
      and confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.follows drop constraint %I', r.conname);
  end loop;
end $$;

notify pgrst, 'reload schema';
