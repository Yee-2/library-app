// src/stores/auth.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(true)

  const isLoggedIn = computed(() => !!user.value)

  async function init() {
    // 1) 先读 localStorage 里的 session 拿到 access token（可能已过期）
    const { data: sess } = await supabase.auth.getSession()
    user.value = sess.session?.user ?? null
    loading.value = false

    // 2) 立刻向 Supabase 验证 token 有效性 —— 过期就清空 user，
    //    避免"看着像登录了"但任何操作都 401
    if (sess.session) {
      try {
        const { data: u } = await supabase.auth.getUser()
        if (!u.user) {
          user.value = null
          await supabase.auth.signOut()
        } else {
          user.value = u.user
        }
      } catch {
        // 网络/服务问题：保留 localStorage 状态，不强制退出
      }
    }

    // 3) 订阅 auth 状态变化
    supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null
    })
  }

  async function signUp(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw error
    return data
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    user.value = null
  }

  return { user, loading, isLoggedIn, init, signUp, signIn, signOut }
})
