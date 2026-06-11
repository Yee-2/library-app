-- =============================================================
-- 010: 头像桶 + 社区帖子表 + 点赞表
-- =============================================================

-- ---------- 头像存储桶 ----------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 头像上传策略：用户能上传到自己的目录
drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Public avatar read" on storage.objects;
create policy "Public avatar read" on storage.objects
  for select using (bucket_id = 'avatars');

-- ---------- 社区帖子 ----------
create table if not exists public.community_posts (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  content      text not null check (char_length(content) between 1 and 2000),
  book_id      uuid references public.books(id) on delete set null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists community_posts_created_idx on public.community_posts(created_at desc);
create index if not exists community_posts_user_idx on public.community_posts(user_id);

-- updated_at 触发器
drop trigger if exists community_posts_set_updated_at on public.community_posts;
create trigger community_posts_set_updated_at
  before update on public.community_posts
  for each row execute function public.set_updated_at();

-- ---------- 帖子点赞 ----------
create table if not exists public.post_likes (
  post_id      uuid references public.community_posts(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete cascade not null,
  created_at   timestamptz default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user_idx on public.post_likes(user_id);
create index if not exists post_likes_post_idx on public.post_likes(post_id);

-- ---------- RLS ----------
alter table public.community_posts enable row level security;
alter table public.post_likes enable row level security;

drop policy if exists "community_posts_read_all" on public.community_posts;
create policy "community_posts_read_all" on public.community_posts
  for select using (true);

drop policy if exists "community_posts_insert_self" on public.community_posts;
create policy "community_posts_insert_self" on public.community_posts
  for insert with check (auth.uid() = user_id);

drop policy if exists "community_posts_update_self" on public.community_posts;
create policy "community_posts_update_self" on public.community_posts
  for update using (auth.uid() = user_id);

drop policy if exists "community_posts_delete_self" on public.community_posts;
create policy "community_posts_delete_self" on public.community_posts
  for delete using (auth.uid() = user_id);

drop policy if exists "post_likes_read_all" on public.post_likes;
create policy "post_likes_read_all" on public.post_likes
  for select using (true);

drop policy if exists "post_likes_insert_self" on public.post_likes;
create policy "post_likes_insert_self" on public.post_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "post_likes_delete_self" on public.post_likes;
create policy "post_likes_delete_self" on public.post_likes
  for delete using (auth.uid() = user_id);

-- 刷新 PostgREST schema cache
notify pgrst, 'reload schema';
