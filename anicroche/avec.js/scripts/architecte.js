import {initialiser_navigateur} from './navigateur.js'
import {initialiser_heraut, charger_adn_app} from './heraut.js'
import {initialiser_batisseur} from './batisseur.js'

/**
 * Enregistrement du Service Worker
 * Permet le caching et le mode hors-ligne
 */
const SCRIPT_SERVICE_WORKER = '/systeme/scripts/service-worker.js'

// Un service worker resté d'un ancien contenu du domaine (autre script ou autre portée)
// servirait d'anciennes pages : il est désinscrit, et la page rechargée s'il la contrôlait
const desinscrire_service_workers_etrangers = async () =>
{
    const attendu         = new URL(SCRIPT_SERVICE_WORKER, location.origin).href
    const inscriptions    = await navigator.serviceWorker.getRegistrations()
    let controle_etranger = false

    for (const inscription of inscriptions)
    {
        const travailleur = inscription.active ?? inscription.waiting ?? inscription.installing
        if (travailleur?.scriptURL === attendu)
            continue
        console.log(`✗ Service worker étranger désinscrit : ${travailleur?.scriptURL} (${inscription.scope})`)
        if (navigator.serviceWorker.controller
         && navigator.serviceWorker.controller.scriptURL === travailleur?.scriptURL)
            controle_etranger = true
        await inscription.unregister()
    }

    // Un seul rechargement : la page suivante ne passe plus par le service worker désinscrit
    if (controle_etranger && !sessionStorage.getItem('avec-sw-nettoye'))
    {
        sessionStorage.setItem('avec-sw-nettoye', '1')
        location.reload()
    }
}

const enregistrer_service_worker = async () => {
    if ('serviceWorker' in navigator) {
        try {
            await desinscrire_service_workers_etrangers()
            const registration = await navigator.serviceWorker.register(SCRIPT_SERVICE_WORKER)
            console.log('✓ Service Worker enregistré')
            
            // Écouter les mises à jour disponibles
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'activated') {
                        console.log('✓ Service Worker mis à jour')
                    }
                })
            })
        } catch (err) {
            console.error('✗ Enregistrement Service Worker échoué:', err)
        }
    }
}

// Bannière de la console, avec le nom et la version complète du site s'ils sont connus
const afficher_banniere = (adn) =>
{
    const details = [adn?.config?.name, adn?.app_version].filter(Boolean).join(` `)
    console.log(`\
╔══════╗
║ AVEC ║${details ? ` ${details}` : ``}
╚══════╝`)
}

// La configuration est chargée avant tout le reste : la bannière est le premier affichage
const initialiser = async () => {
    const adn = await charger_adn_app()
    afficher_banniere(adn)
    await enregistrer_service_worker()
    initialiser_navigateur()
    await initialiser_heraut(adn)
    initialiser_batisseur()
}

document.addEventListener("DOMContentLoaded", initialiser)
