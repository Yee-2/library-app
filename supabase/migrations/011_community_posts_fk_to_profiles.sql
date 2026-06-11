-- =============================================================
-- 011: 修复 community_posts / post_likes 的外键指向 profiles
--
-- 症状：前端用 profiles!community_posts_user_id_profiles_fkey 关联查询
--       但 010 创建的 FK 指向 auth.users(id)，PGRST200
--
-- 修复：仿照 005/007/008 的模式，把 FK 指向 profiles(id)
--       （profiles 本身已 references auth.users(id) on delete cascade，
--        所以删除 auth.users 时仍会级联）
-- =============================================================

-- community_posts
alter table public.community_posts
  drop constraint if exists community_posts_user_id_fkey;
alter table public.community_posts
  drop constraint if exists community_posts_user_id_profiles_fkey;

alter table public.community_posts
  add constraint community_posts_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- post_likes
alter table public.post_likes
  drop constraint if exists post_likes_user_id_fkey;
alter table public.post_likes
  drop constraint if exists post_likes_user_id_profiles_fkey;

alter table public.post_likes
  add constraint post_likes_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

notify pgrst, 'reload schema';
