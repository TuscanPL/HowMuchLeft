import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useHouseholdStore } from '@/stores/household'
import { POST_LOGIN_KEY, readLocal, writeLocal } from '@/lib/storage'

// Hash routing: GitHub Pages has no SPA rewrites, so deep links and auth
// redirects live after the "#".
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('@/views/SetupView.vue'),
      meta: { noHousehold: true },
    },
    {
      path: '/join/:token',
      name: 'join',
      component: () => import('@/views/JoinView.vue'),
      meta: { noHousehold: true },
    },
    {
      path: '/bank/callback',
      name: 'bank-callback',
      component: () => import('@/views/BankCallbackView.vue'),
    },
    {
      path: '/',
      component: () => import('@/views/AppLayout.vue'),
      children: [
        { path: '', name: 'pocket', component: () => import('@/views/PocketView.vue') },
        {
          path: 'activity',
          name: 'activity',
          component: () => import('@/views/ActivityView.vue'),
        },
        { path: 'plan', name: 'plan', component: () => import('@/views/PlanView.vue') },
        { path: 'banks', name: 'banks', component: () => import('@/views/BanksView.vue') },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()

  if (!auth.session && !to.meta.public) {
    writeLocal(POST_LOGIN_KEY, to.fullPath)
    return { name: 'login' }
  }
  if (auth.session && to.name === 'login') {
    const next = readLocal(POST_LOGIN_KEY)
    writeLocal(POST_LOGIN_KEY, null)
    return next ?? '/'
  }
  if (auth.session && !to.meta.public && !to.meta.noHousehold) {
    const household = useHouseholdStore()
    await household.ensureLoaded()
    if (!household.household) {
      // Coming back from sign-in with an invite? Resume it.
      const next = readLocal(POST_LOGIN_KEY)
      if (next?.startsWith('/join/')) {
        writeLocal(POST_LOGIN_KEY, null)
        return next
      }
      return { name: 'setup' }
    }
  }
})
