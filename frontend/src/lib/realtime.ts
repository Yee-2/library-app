/**
 * 实时订阅封装
 * - 监听 community_posts / post_likes / comments 表变化
 * - 回调签名保持简单（payload 解包后传出）
 */
import { supabase } from './supabase'
import type { CommunityPost } from './books'

export interface FeedCallbacks {
  onNewPost?: (p: CommunityPost) => void
  onLikeChange?: (postId: string, delta: number) => void
  onNewComment?: (postId: string) => void
}

export function subscribeCommunityFeed(cb: FeedCallbacks): () => void {
  const channel = supabase
    .channel('community-feed')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'community_posts' },
      async (payload) => {
        // 拉取完整 post（含 profiles）
        const { data } = await supabase
          .from('community_posts')
          .select(`
            *,
            profiles!community_posts_user_id_profiles_fkey(username, avatar_url)
          `)
          .eq('id', payload.new.id)
          .single()
        if (data && cb.onNewPost) {
          cb.onNewPost({ ...data, like_count: 0, liked_by_me: false } as any)
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'post_likes' },
      (payload) => {
        const postId = (payload.new as any).post_id
        if (postId) cb.onLikeChange?.(postId, +1)
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'post_likes' },
      (payload) => {
        const postId = (payload.old as any).post_id
        if (postId) cb.onLikeChange?.(postId, -1)
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'comments' },
      (payload) => {
        const postId = (payload.new as any).post_id
        if (postId) cb.onNewComment?.(postId)
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}