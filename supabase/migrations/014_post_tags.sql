-- =============================================================
-- 014: 帖子话题标签
-- =============================================================

create table if not exists public.post_tags (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null,
  tag        text not null check (char_length(tag) between 1 and 30),
  created_at timestamptz default now(),
  unique (post_id, tag)
);

create index if not exists post_tags_tag_idx on public.post_tags(tag);

alter table public.post_tags
  drop constraint if exists post_tags_post_id_community_posts_fkey;
alter table public.post_tags
  add constraint post_tags_post_id_community_posts_fkey
  foreign key (post_id) references public.community_posts(id) on delete cascade;

alter table public.post_tags enable row level security;

drop policy if exists "tags_read_all"     on public.post_tags;
drop policy if exists "tags_insert_owner" on public.post_tags;
drop policy if exists "tags_delete_owner" on public.post_tags;

create policy "tags_read_all"
  on public.post_tags for select
  using (true);

create policy "tags_insert_owner"
  on public.post_tags for insert
  with check (
    exists (
      select 1 from public.community_posts
      where community_posts.id = post_id
        and community_posts.user_id = auth.uid()
    )
  );

create policy "tags_delete_owner"
  on public.post_tags for delete
  using (
    exists (
      select 1 from public.community_posts
      where community_posts.id = post_id
        and community_posts.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';