// src/router.ts
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',         name: 'home',      component: () => import('./views/Home.vue') },
    { path: '/login',    name: 'login',     component: () => import('./views/Login.vue') },
    { path: '/library',  name: 'library',   component: () => import('./views/Library.vue'), meta: { auth: true } },
    { path: '/store',    name: 'store',     component: () => import('./views/Store.vue') },
    { path: '/read/:id', name: 'reader',    component: () => import('./views/Reader.vue'), meta: { auth: true } },
    { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFound.vue') },
  ],
  scrollBehavior() { return { top: 0 } },
})

router.beforeEach((to) => {
  if (to.meta.auth) {
    const auth = useAuthStore()
    if (!auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }
  }
})
