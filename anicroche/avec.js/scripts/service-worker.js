/**
 * Service Worker pour Anicroche
 * Gère le caching et le mode hors-ligne
 */

const VERSION = 'v19'
const CACHE_ASSETS = `${VERSION}-assets`

const ASSETS_A_CACHER = [
    '/',
    '/systeme/scripts/architecte.js',
    '/systeme/scripts/navigateur.js',
    '/systeme/scripts/heraut.js',
    '/systeme/scripts/batisseur.js',
    '/systeme/scripts/augure.js',
    '/systeme/scripts/decorateur.js',
    '/systeme/scripts/sculpteur.js',
    '/systeme/scripts/scribe.js',
    '/systeme/images/favicon.svg',
    '/systeme/images/favicon.ico',
    '/systeme/app.webmanifest'
]

/**
 * Installation du Service Worker
 * Pré-cache les assets essentiels
 */
self.addEventListener('install', event => {
    console.log(`[SW] Installation (${VERSION})`)
    
    event.waitUntil(
        caches.open(CACHE_ASSETS)
            .then(cache => {
                console.log(`[SW] Caching ${ASSETS_A_CACHER.length} assets`)
                return cache.addAll(ASSETS_A_CACHER)
            })
            .then(() => self.skipWaiting())
            .catch(err => console.error('[SW] Installation échouée:', err))
    )
})

/**
 * Activation du Service Worker
 * Nettoie les anciens caches
 */
self.addEventListener('activate', event => {
    console.log('[SW] Activation')
    
    event.waitUntil(
        caches.keys().then(names => {
            return Promise.all(
                names
                    .filter(name => {
                        const isOld = name !== CACHE_ASSETS
                        if (isOld) console.log(`[SW] Suppression du cache: ${name}`)
                        return isOld
                    })
                    .map(name => caches.delete(name))
            )
        }).then(() => {
            console.log('[SW] Prise de contrôle des clients')
            return self.clients.claim()
        })
    )
})

/**
 * Stratégie de fetch
 * - Autres origines (dont l'API) : jamais interceptées ni mises en cache
 * - Assets: cache-first (cache d'abord, réseau en fallback)
 */
self.addEventListener('fetch', event => {
    const { request } = event
    const url = new URL(request.url)

    // Ignorer les requêtes non-GET
    if (request.method !== 'GET') {
        return
    }

    // Ignorer les requêtes vers une autre origine (l'API notamment) :
    // leurs réponses dépendent de la session et ne doivent pas être mises en cache
    if (url.origin !== self.location.origin) {
        return
    }

    // Static assets: cache-first strategy
    event.respondWith(
        caches.match(request)
            .then(response => {
                if (response) {
                    return response
                }
                return fetch(request)
                    .then(response => {
                        // Cacher les réponses réussies
                        if (response.ok && request.method === 'GET') {
                            const clonedResponse = response.clone()
                            caches.open(CACHE_ASSETS).then(cache => {
                                cache.put(request, clonedResponse)
                            })
                        }
                        return response
                    })
            })
            .catch(() => {
                // Page de fallback si offline et pas en cache
                return caches.match('/')
            })
    )
})
