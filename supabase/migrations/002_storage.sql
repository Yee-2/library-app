-- =============================================================
-- Storage 桶配置（在 Supabase SQL Editor 里执行）
-- =============================================================

-- 1. 创建公开的图书文件桶
insert into storage.buckets (id, name, public)
values ('book-files', 'book-files', false)   -- 私有，需要签名 URL
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('book-covers', 'book-covers', true)  -- 公开封面
on conflict (id) do nothing;

-- 2. 存储策略：用户能上传到自己的目录
drop policy if exists "Users can upload own book files" on storage.objects;
create policy "Users can upload own book files" on storage.objects
  for insert with check (
    bucket_id = 'book-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can read own book files" on storage.objects;
create policy "Users can read own book files" on storage.objects
  for select using (
    bucket_id = 'book-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own book files" on storage.objects;
create policy "Users can update own book files" on storage.objects
  for update using (
    bucket_id = 'book-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own book files" on storage.objects;
create policy "Users can delete own book files" on storage.objects
  for delete using (
    bucket_id = 'book-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
