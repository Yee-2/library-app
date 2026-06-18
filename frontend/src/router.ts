// src/router.ts
import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { useAuthStore } from './stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // ============ Tab 页面（带底部导航，keep-alive） ============
    { path: '/',          name: 'home',      component: () => import('./views/Home.vue'),     meta: { tab: true } },
    { path: '/library',   name: 'library',   component: () => import('./views/Library.vue'),  meta: { tab: true } },
    { path: '/community', name: 'community', component: () => import('./views/Community.vue'),meta: { tab: true } },
    { path: '/me',        name: 'me',        component: () => import('./views/Me.vue'),       meta: { tab: true } },

    // ============ 其它独立页面（无 TabBar） ============
    { path: '/login',    name: 'login',     component: () => import('./views/Login.vue') },
    { path: '/read/:id', name: 'reader',    component: () => import('./views/Reader.vue'), meta: { auth: true, hideTab: true } },
    { path: '/store',    name: 'store',     component: () => import('./views/Store.vue'), meta: { hideTab: true } },
    { path: '/book/:id', name: 'book-detail', component: () => import('./views/BookDetail.vue'), meta: { hideTab: true } },
    { path: '/user/:id', name: 'user-profile', component: () => import('./views/UserProfile.vue'), meta: { hideTab: true } },
    { path: '/search',   name: 'search',    component: () => import('./views/Search.vue'), meta: { hideTab: true } },
    { path: '/stats',    name: 'stats',     component: () => import('./views/Stats.vue'),  meta: { auth: true, hideTab: true } },
    { path: '/achievements', name: 'achievements', component: () => import('./views/Achievements.vue'), meta: { auth: true, hideTab: true } },
    { path: '/favorites',name: 'favorites', component: () => import('./views/Favorites.vue'), meta: { auth: true, hideTab: true } },
    { path: '/notifications', name: 'notifications', component: () => import('./views/NotificationsView.vue'), meta: { auth: true, hideTab: true } },
    { path: '/follows/:type/:id?', name: 'follows', component: () => import('./views/Follows.vue'), meta: { hideTab: true } },
    { path: '/topic/:tag', name: 'topic', component: () => import('./views/Topic.vue'), meta: { hideTab: true } },

    // ============ 404 ============
    { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFound.vue') },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  // 1) 等 auth 初次加载完成（避免刷新瞬间 isLoggedIn 误判为 false 跳登录）
  if (auth.loading) {
    await new Promise<void>((resolve) => {
      const stop = watch(() => auth.loading, (v) => {
        if (!v) { stop(); resolve() }
      }, { immediate: true })
    })
  }
  // 2) 已登录用户访问 /login → 跳到 /library（除非有 redirect 参数）
  if (to.name === 'login' && auth.isLoggedIn && !to.query.redirect) {
    return { name: 'library' }
  }
  // 3) 受保护路由未登录 → 跳登录
  if (to.meta.auth && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
})
