-- =============================================================
-- 补充迁移
-- =============================================================

-- 下载计数自增函数
create or replace function public.increment_download(book_uuid uuid)
returns void
language sql
security definer
as $$
  update public.books
  set download_count = download_count + 1
  where id = book_uuid and is_public = true;
$$;
