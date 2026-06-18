/**
 * 社区评论数据访问
 * - 评论/回复
 * - 列表按 created_at asc
 */
import { supabase } from './supabase'

export interface Comment {
  id: string
  post_id: string
  user_id: string
  parent_id: string | null
  content: string
  created_at: string
  updated_at: string
  profiles?: { username: string | null; avatar_url: string | null } | null
}

export async function listComments(postId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select(`
      *,
      profiles!comments_user_id_profiles_fkey(username, avatar_url)
    `)
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []) as Comment[]
}

export async function createComment(
  postId: string,
  content: string,
  parentId?: string | null
): Promise<Comment> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录')
  const row = {
    post_id: postId,
    user_id: user.id,
    parent_id: parentId || null,
    content: content.trim(),
  }
  const { data, error } = await supabase
    .from('comments')
    .insert(row)
    .select(`
      *,
      profiles!comments_user_id_profiles_fkey(username, avatar_url)
    `)
    .single()
  if (error) throw error
  return data as Comment
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) throw error
}

export async function countComments(postId: string): Promise<number> {
  const { count, error } = await supabase
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId)
  if (error) return 0
  return count ?? 0
}