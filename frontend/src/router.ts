// src/router.ts
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // ============ Tab 页面（带底部导航，keep-alive） ============
    { path: '/',          name: 'home',      component: () => import('./views/Home.vue'),     meta: { tab: true } },
    { path: '/library',   name: 'library',   component: () => import('./views/Library.vue'),  meta: { tab: true, auth: true } },
    { path: '/community', name: 'community', component: () => import('./views/Community.vue'),meta: { tab: true } },
    { path: '/me',        name: 'me',        component: () => import('./views/Me.vue'),       meta: { tab: true, auth: true } },

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
    { path: '/follows/:type/:id?', name: 'follows', component: () => import('./views/Follows.vue'), meta: { hideTab: true } },

    // ============ 404 ============
    { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFound.vue') },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    return { top: 0 }
  },
})

router.beforeEach((to) => {
  if (to.meta.auth) {
    const auth = useAuthStore()
    if (!auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }
  }
})
