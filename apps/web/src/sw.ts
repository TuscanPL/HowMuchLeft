/// <reference lib="webworker" />
// The service worker, built by vite-plugin-pwa (strategies: 'injectManifest'):
// precaches the app shell and serves index.html for navigations.
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

// registerType: 'prompt': a new worker waits until the app's "Update" button
// asks it to take over (lib/appUpdate.ts), so nobody is reloaded mid-task.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// bank-callback.html is its own page (the bank's redirect target); don't swap it for the app shell.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/bank-callback\.html/],
  }),
)
