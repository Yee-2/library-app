-- =============================================================
-- 013: 社区评论/回复
--   - 一级评论 + 二级回复（自引用 parent_id）
--   - RLS: SELECT 公开；INSERT/UPDATE/DELETE 仅 owner
-- =============================================================

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null,
  user_id    uuid not null,
  parent_id  uuid references public.comments(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists comments_post_id_idx   on public.comments(post_id, created_at);
create index if not exists comments_parent_id_idx on public.comments(parent_id);

-- 显式命名 FK，符合 profiles 关联约定
alter table public.comments
  drop constraint if exists comments_post_id_community_posts_fkey;
alter table public.comments
  add constraint comments_post_id_community_posts_fkey
  foreign key (post_id) references public.community_posts(id) on delete cascade;

alter table public.comments
  drop constraint if exists comments_user_id_profiles_fkey;
alter table public.comments
  add constraint comments_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.comments enable row level security;

drop policy if exists "comments_read_all"     on public.comments;
drop policy if exists "comments_insert_self"  on public.comments;
drop policy if exists "comments_update_self"  on public.comments;
drop policy if exists "comments_delete_self"  on public.comments;

create policy "comments_read_all"
  on public.comments for select
  using (true);

create policy "comments_insert_self"
  on public.comments for insert
  with check (auth.uid() = user_id);

create policy "comments_update_self"
  on public.comments for update
  using (auth.uid() = user_id);

create policy "comments_delete_self"
  on public.comments for delete
  using (auth.uid() = user_id);

-- updated_at 自动维护
drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';