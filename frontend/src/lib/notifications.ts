/**
 * 通知服务 - 基于 notifications 表的评论回复通知
 * 需要先执行 015_notifications.sql 迁移
 */
import { supabase } from './supabase'

export interface Notification {
  id: string
  comment_id: string
  post_id: string
  actor_name: string
  actor_avatar: string | null
  comment_content: string
  post_content: string | null
  created_at: string
  read: boolean
}

const STORAGE_KEY = 'cl_read_notifications'

function getReadIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function markRead(id: string) {
  const ids = getReadIds()
  ids.add(id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
}

function markAllRead(ids: string[]) {
  const read = getReadIds()
  ids.forEach(id => read.add(id))
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...read]))
}

/**
 * 获取当前用户的通知列表
 * 优先使用 notifications 表（015 迁移后生效）
 * 回退到基于 comments 的查询方式
 */
export async function listNotifications(): Promise<Notification[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  // 尝试从 notifications 表查询
  const { data: notifRows, error: notifErr } = await supabase
    .from('notifications')
    .select('id, post_id, comment_id, actor_id, read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // 如果 notifications 表不存在，回退到基于 comments 的查询
  if (notifErr) {
    return listNotificationsFallback(user.id)
  }

  if (!notifRows?.length) return []

  // 获取评论内容
  const commentIds = notifRows.map(n => n.comment_id)
  const { data: comments } = await supabase
    .from('comments')
    .select('id, content')
    .in('id', commentIds)

  const commentMap = new Map((comments || []).map(c => [c.id, c.content]))

  // 获取帖子内容
  const postIds = [...new Set(notifRows.map(n => n.post_id))]
  const { data: posts } = await supabase
    .from('community_posts')
    .select('id, content')
    .in('id', postIds)

  const postMap = new Map((posts || []).map(p => [p.id, p.content]))

  // 获取评论者信息
  const actorIds = [...new Set(notifRows.map(n => n.actor_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', actorIds)

  const profileMap = new Map((profiles || []).map(p => [p.id, p]))

  const readIds = getReadIds()

  return notifRows.map(n => {
    const profile = profileMap.get(n.actor_id)
    return {
      id: n.id,
      comment_id: n.comment_id,
      post_id: n.post_id,
      actor_name: profile?.username || '匿名',
      actor_avatar: profile?.avatar_url || null,
      comment_content: commentMap.get(n.comment_id) || '',
      post_content: postMap.get(n.post_id) || null,
      created_at: n.created_at,
      read: n.read || readIds.has(n.id),
    }
  })
}

/**
 * 回退方案：基于 comments 查询（不需要 notifications 表）
 * 适用于未执行 015 迁移的环境
 */
async function listNotificationsFallback(userId: string): Promise<Notification[]> {
  const { data: userPosts } = await supabase
    .from('community_posts')
    .select('id, content')
    .eq('user_id', userId)

  if (!userPosts?.length) return []

  const postIds = userPosts.map(p => p.id)
  const postContentMap = new Map(userPosts.map(p => [p.id, p.content]))

  const { data: comments } = await supabase
    .from('comments')
    .select('id, post_id, user_id, content, created_at')
    .in('post_id', postIds)
    .neq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!comments?.length) return []

  const actorIds = [...new Set(comments.map(c => c.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', actorIds)

  const profileMap = new Map((profiles || []).map(p => [p.id, p]))
  const readIds = getReadIds()

  return comments.map(c => {
    const profile = profileMap.get(c.user_id)
    const notifId = `${c.post_id}_${c.id}`
    return {
      id: notifId,
      comment_id: c.id,
      post_id: c.post_id,
      actor_name: profile?.username || '匿名',
      actor_avatar: profile?.avatar_url || null,
      comment_content: c.content,
      post_content: postContentMap.get(c.post_id) || null,
      created_at: c.created_at,
      read: readIds.has(notifId),
    }
  })
}

export async function getUnreadCount(): Promise<number> {
  const notifs = await listNotifications()
  return notifs.filter(n => !n.read).length
}

export { markRead, markAllRead }
