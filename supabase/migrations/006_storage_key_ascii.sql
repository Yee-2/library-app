-- =============================================================
-- 006: 修复 Supabase Storage object key 含中文导致的 InvalidKey
--
-- 症状：上传 epub/中文文件时 Supabase Storage 返回
--   {"statusCode":"400","error":"InvalidKey","message":"Invalid key: <user>/<ts>-中文...epub"}
--
-- 根因：前端原代码在 object key 里保留了中文字符（CJK）。
--      Supabase Storage 底层 S3 在签名/边缘节点对 UTF-8 key 处理不一致。
--
-- 修复：
--   1) books 表加 original_filename 字段，保留用户上传的原始文件名
--   2) 后续上传统一改为 ASCII key:  <user_id>/<uuid>.<ext>
-- =============================================================

alter table public.books
add column if not exists original_filename text;

comment on column public.books.original_filename is
  '用户上传时的原始文件名（中文/特殊字符保留在这里，不再放进 Storage object key）';
