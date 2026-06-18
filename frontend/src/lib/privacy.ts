/**
 * 隐私工具
 * - maskEmail: 把邮箱掩码为 al***@gmail.com 形式
 * - maskUsername: 把邮箱式用户名掩码为 zh****an 形式
 * - isEmailLikeUsername: 判断 username 是否看起来是邮箱前缀
 */

export function maskEmail(email: string | null | undefined): string {
  if (!email) return ''
  const at = email.indexOf('@')
  if (at <= 0) return email
  const name = email.slice(0, at)
  const domain = email.slice(at + 1)
  const visible = name.slice(0, 2)
  const stars = '*'.repeat(Math.max(2, Math.min(name.length - 2, 6)))
  return `${visible}${stars}@${domain}`
}

/**
 * 掩码邮箱式用户名: zhangsan → zh****an
 * 非邮箱式用户名原样返回
 */
export function maskUsername(
  username: string | null | undefined,
  email?: string | null
): string {
  if (!username) return '匿名'
  // 如果有 email 参照，精确匹配
  if (email) {
    const prefix = email.split('@')[0] || ''
    if (prefix && username.toLowerCase() === prefix.toLowerCase()) {
      return maskEmailPrefix(username)
    }
    return username
  }
  // 无 email 参照时，基本检测：含数字+长度≥4+首字母小写
  if (/\d/.test(username) && username.length >= 4 && username[0] === username[0].toLowerCase()) {
    return maskEmailPrefix(username)
  }
  return username
}

function maskEmailPrefix(name: string): string {
  if (name.length <= 3) return name[0] + '**'
  const visible = name.slice(0, 2)
  const end = name.slice(-2)
  const stars = '*'.repeat(Math.max(2, Math.min(name.length - 4, 6)))
  return `${visible}${stars}${end}`
}

/**
 * 判断 username 是否看起来就是 email 前缀。
 * 触发条件：含数字、长度 ≥ 4 且首字母为小写
 */
export function isEmailLikeUsername(
  username: string | null | undefined,
  email: string | null | undefined
): boolean {
  if (!username) return true
  if (!email) return false
  const prefix = email.split('@')[0] || ''
  if (!prefix) return false
  return username.toLowerCase() === prefix.toLowerCase()
}
