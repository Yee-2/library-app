-- 016: profiles 表添加 masked_email 列
-- 用于在社区中显示脱敏的邮箱地址（当 username 未设置时）

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS masked_email text;

-- 触发器函数：自动填充 masked_email
CREATE OR REPLACE FUNCTION handle_profile_masked_email()
RETURNS TRIGGER AS $$
DECLARE
  raw_email text;
  at_pos int;
  name_part text;
  domain_part text;
  visible text;
  stars text;
BEGIN
  -- 从 auth.users 获取邮箱
  SELECT email INTO raw_email FROM auth.users WHERE id = NEW.id;
  IF raw_email IS NULL OR raw_email = '' THEN
    RETURN NEW;
  END IF;

  at_pos := position('@' in raw_email);
  IF at_pos <= 1 THEN
    NEW.masked_email := raw_email;
    RETURN NEW;
  END IF;

  name_part  := substring(raw_email from 1 for at_pos - 1);
  domain_part := substring(raw_email from at_pos + 1);
  visible    := substring(name_part from 1 for 2);
  stars      := repeat('*', greatest(2, least(length(name_part) - 2, 6)));

  NEW.masked_email := visible || stars || '@' || domain_part;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 在 insert 和 update 时触发
DROP TRIGGER IF EXISTS on_profile_masked_email ON profiles;
CREATE TRIGGER on_profile_masked_email
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_profile_masked_email();

-- 为已有用户回填 masked_email
UPDATE profiles p
SET masked_email = (
  SELECT
    CASE
      WHEN position('@' in au.email) > 1 THEN
        substring(au.email from 1 for 2) ||
        repeat('*', greatest(2, least(length(substring(au.email from 1 for position('@' in au.email) - 1)) - 2, 6))) ||
        '@' || substring(au.email from position('@' in au.email) + 1)
      ELSE au.email
    END
  FROM auth.users au
  WHERE au.id = p.id
)
WHERE p.masked_email IS NULL;

-- RLS: masked_email 对所有人可读（公开信息）
-- 已有的 profiles SELECT 策略已覆盖，无需额外添加
