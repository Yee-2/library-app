// src/main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './style.css'
import { useAuthStore } from './stores/auth'

// 提前同步主题到 <html>，避免首屏闪烁
;(function applyThemeEarly() {
  try {
    const saved = localStorage.getItem('app:theme') as 'light' | 'dark' | null
    const t: 'light' | 'dark' = saved === 'light' ? 'light' : 'dark'
    if (t === 'dark') document.documentElement.classList.add('dark')
    document.documentElement.setAttribute('data-theme', t)
  } catch {}
})()

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(router)

  // 初始化 auth 状态
  const auth = useAuthStore()
  await auth.init()

  app.mount('#app')

  // 注册 Service Worker (PWA / 离线)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}

bootstrap()
