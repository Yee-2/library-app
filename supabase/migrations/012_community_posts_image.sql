-- =============================================================
-- 012: 社区帖子支持图片
-- =============================================================

-- community_posts 添加 image_url 列
alter table public.community_posts
  add column if not exists image_url text;

notify pgrst, 'reload schema';
