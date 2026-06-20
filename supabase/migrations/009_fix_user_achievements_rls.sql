-- =============================================================
-- 009: 修复 user_achievements 和 reading_sessions 的 RLS 漏洞
--
-- 症状：新账号登录后看到 4 个成就和 4 本藏书（属于其他用户）
--
-- 根因：
--   1) user_achievements SELECT 策略是 "using (true)" — 所有人能读所有记录
--   2) reading_sessions 的 RLS 也只允许操作自己的，但 progress 报表查询可能跨用户
--   3) books 策略已经是 auth.uid()=user_id OR is_public=true，但前端 listMyBooks
--      应该有 where user_id=current user 限定，避免泄露给前端逻辑
--
-- 修复：把 user_achievements 的 SELECT 策略改为仅本人可读
--       保留"所有人可读成就定义(achievements)"的策略不变
-- =============================================================

-- 替换为仅自己可见
drop policy if exists "user_ach_read_all" on public.user_achievements;
drop policy if exists "user_ach_read_own" on public.user_achievements;
create policy "user_ach_read_own" on public.user_achievements
  for select using (auth.uid() = user_id);

-- 删除旧 user_ach_read_all 多余策略（已替换为 user_ach_read_own）
-- （上面 drop 已经处理）

-- 同步刷新 PostgREST schema cache
notify pgrst, 'reload schema';
