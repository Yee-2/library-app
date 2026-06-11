// public/sw.js - 极简 service worker
// 离线时 fallback 到 index.html（让 SPA 仍能打开）
const CACHE = 'library-app-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  // 跨域请求透传
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 导航请求：网络优先，失败 fallback 到 /
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    )
    return
  }

  // 静态资源：缓存优先
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      // 缓存成功的 GET 响应
      if (res && res.status === 200) {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(req, clone))
      }
      return res
    }).catch(() => cached))
  )
})