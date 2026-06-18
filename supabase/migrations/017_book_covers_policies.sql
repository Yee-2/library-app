-- =============================================================
-- 修复 book-covers 桶缺少写入策略（封面上传静默失败的根因）
-- =============================================================

drop policy if exists "Users can upload own book covers" on storage.objects;
create policy "Users can upload own book covers" on storage.objects
  for insert with check (
    bucket_id = 'book-covers'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own book covers" on storage.objects;
create policy "Users can update own book covers" on storage.objects
  for update using (
    bucket_id = 'book-covers'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own book covers" on storage.objects;
create policy "Users can delete own book covers" on storage.objects
  for delete using (
    bucket_id = 'book-covers'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
