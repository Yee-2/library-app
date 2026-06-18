<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { toast } from '@/lib/toast'
import { Mail, Lock, LogIn, ArrowLeft, KeyRound } from 'lucide-vue-next'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const mode = ref<'signin' | 'signup' | 'forgot'>('signin')
const email = ref('')
const password = ref('')
const loading = ref(false)
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')

async function submit() {
  loading.value = true
  message.value = ''
  try {
    if (mode.value === 'signup') {
      const res = await auth.signUp(email.value, password.value)
      if (res.session) {
        toast.success('注册成功！请设置一个昵称让别人认识你')
        goRedirect()
      } else {
        messageType.value = 'ok'
        message.value = '注册成功！请前往邮箱点击验证链接。'
        toast.info('请前往邮箱完成验证')
      }
    } else if (mode.value === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.value, {
        redirectTo: window.location.origin + '/login',
      })
      if (error) throw error
      messageType.value = 'ok'
      message.value = '重置链接已发送到你的邮箱，请查收。'
      toast.success('重置邮件已发送')
      setTimeout(() => { mode.value = 'signin' }, 2000)
    } else {
      await auth.signIn(email.value, password.value)
      toast.success('登录成功，欢迎回来 ✨')
      goRedirect()
    }
  } catch (e: any) {
    messageType.value = 'err'
    message.value = e.message || '操作失败'
    toast.error(message.value)
  } finally {
    loading.value = false
  }
}

function goRedirect() {
  const redirect = (route.query.redirect as string) || '/library'
  router.push(redirect)
}
</script>

<template>
  <div class="min-h-[calc(100vh-100px)] flex items-center justify-center px-4 py-10">
    <div class="w-full max-w-sm">
      <!-- 品牌头 -->
      <div class="text-center mb-6">
        <div class="inline-flex w-16 h-16 rounded-3xl bg-gradient-to-br from-primary-600 to-accent-600 items-center justify-center shadow-lg">
          <img src="/favicon.svg" class="w-9 h-9" alt="logo" />
        </div>
        <h1 class="text-2xl font-bold mt-3 tracking-tight text-ink-900-50">云端图书馆</h1>
        <p class="text-xs text-ink-300 mt-1">书山有路，与君共读</p>
      </div>

      <div class="card p-6">
        <h2 class="text-lg font-semibold text-center mb-1 text-ink-900-50">
          {{ mode === 'signin' ? '欢迎回来' : mode === 'signup' ? '注册账号' : '找回密码' }}
        </h2>
        <p class="text-sm text-ink-300 text-center mb-5">
          {{ mode === 'signin' ? '登录后开始你的阅读之旅'
             : mode === 'signup' ? '几秒钟即可创建账号'
             : '输入注册邮箱，我们会发送重置链接' }}
        </p>

        <form @submit.prevent="submit" class="space-y-3">
          <div class="relative">
            <Mail class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" :stroke-width="1.75" />
            <input v-model="email" type="email" required placeholder="you@example.com" class="input pl-10" />
          </div>
          <div v-if="mode !== 'forgot'" class="relative">
            <Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" :stroke-width="1.75" />
            <input v-model="password" type="password" required minlength="6" placeholder="••••••" class="input pl-10" />
          </div>

          <button type="submit" :disabled="loading" class="btn-primary w-full h-11 mt-1">
            <component :is="mode === 'forgot' ? KeyRound : LogIn" class="w-4 h-4" :stroke-width="1.75" />
            <span>{{ loading ? '处理中…'
               : (mode === 'signin' ? '登录'
               : mode === 'signup' ? '注册' : '发送重置链接') }}</span>
          </button>

          <p v-if="message" :class="['text-sm text-center py-2 rounded-lg px-3', messageType === 'ok' ? 'text-emerald-600-300 bg-emerald-500/15' : 'text-rose-600-400 bg-rose-500/15']">
            {{ message }}
          </p>
        </form>

        <div class="text-center text-sm text-ink-300 mt-5 space-x-2">
          <template v-if="mode === 'signin'">
            <button class="hover:text-primary-600 transition" @click="mode = 'forgot'">忘记密码？</button>
            <span>·</span>
            <button class="text-primary-600 hover:underline font-medium" @click="mode = 'signup'">立即注册</button>
          </template>
          <template v-else>
            <button class="text-primary-600 hover:underline font-medium" @click="mode = 'signin'">返回登录</button>
          </template>
        </div>
      </div>

      <div class="text-center mt-4">
        <RouterLink to="/" class="inline-flex items-center gap-1 text-xs text-ink-300 hover:text-ink-800 transition">
          <ArrowLeft class="w-3 h-3" :stroke-width="1.75" />
          <span>返回首页</span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
