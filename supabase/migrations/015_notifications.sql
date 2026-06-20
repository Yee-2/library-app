-- 015: 通知表 + 新评论自动创建通知触发器
-- 当有人在帖子下评论时，自动为帖子作者创建通知

-- 通知表
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  actor_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text NOT NULL DEFAULT 'comment_reply',
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 索引：按用户查询 + 按时间排序
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- 索引：快速查未读数
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id) WHERE NOT read;

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的通知
DROP POLICY IF EXISTS "users_select_own_notifications" ON notifications;
CREATE POLICY "users_select_own_notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- 用户只能更新自己的通知（标记已读）
DROP POLICY IF EXISTS "users_update_own_notifications" ON notifications;
CREATE POLICY "users_update_own_notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- 系统通过函数可以插入通知（由触发器调用）
DROP POLICY IF EXISTS "system_insert_notifications" ON notifications;
CREATE POLICY "system_insert_notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- 用户只能删除自己的通知
DROP POLICY IF EXISTS "users_delete_own_notifications" ON notifications;
CREATE POLICY "users_delete_own_notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- 触发器函数：新评论自动通知帖子作者
CREATE OR REPLACE FUNCTION handle_comment_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- 只有评论者不是帖子作者时才创建通知（不通知自己）
  IF NEW.user_id != (SELECT user_id FROM community_posts WHERE id = NEW.post_id) THEN
    INSERT INTO notifications (user_id, post_id, comment_id, actor_id, type)
    SELECT
      cp.user_id,
      NEW.post_id,
      NEW.id,
      NEW.user_id,
      'comment_reply'
    FROM community_posts cp
    WHERE cp.id = NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 绑定触发器到 comments 表
DROP TRIGGER IF EXISTS on_comment_insert ON comments;
CREATE TRIGGER on_comment_insert
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION handle_comment_notification();
