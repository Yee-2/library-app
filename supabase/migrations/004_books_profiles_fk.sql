-- =============================================================
-- 补充迁移：修复 books <-> profiles 缺失的外键
-- PostgREST 嵌入查询 (select=*,profiles(...)) 需要 FK 关系
-- =============================================================

-- 1. 给所有"孤儿"auth user 补建 profile
insert into public.profiles (id, username)
select
  au.id,
  split_part(au.email, '@', 1)
from auth.users au
left join public.profiles p on p.id = au.id
where p.id is null
on conflict (id) do nothing;

-- 2. 添加 books -> profiles 外键（幂等：先清掉旧的同名约束）
alter table public.books
drop constraint if exists books_user_id_profiles_fkey;

alter table public.books
add constraint books_user_id_profiles_fkey
foreign key (user_id) references public.profiles(id) on delete cascade;
