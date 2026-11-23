// Servi aux adresses d'anciens service workers du domaine (/sw.js, /service-worker.js) :
// le navigateur, qui vérifie régulièrement le fichier d'un service worker installé, le
// remplace par celui-ci, qui supprime les anciens caches, se désinscrit et recharge les pages
// qu'il contrôlait. Le service worker d'avec.js (/systeme/scripts/service-worker.js) n'est
// pas concerné, ni son cache (nommé <version>-assets)

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (evenement) =>
{
    evenement.waitUntil((async () =>
    {
        const noms = await caches.keys()
        await Promise.all(noms
            .filter(nom => !nom.endsWith('-assets'))
            .map(nom => caches.delete(nom)))

        await self.registration.unregister()

        const fenetres = await self.clients.matchAll({ type: 'window' })
        for (const fenetre of fenetres)
            fenetre.navigate(fenetre.url)
    })())
})
