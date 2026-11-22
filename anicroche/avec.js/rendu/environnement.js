// Environnement de navigateur simulé pour le rendu côté serveur : installe sur l'objet
// global (celui d'un worker, propre à chaque rendu) le mini-DOM et les API que le moteur
// et les scripts des modèles utilisent, et suit les tâches en cours (requêtes, minuteries)
// pour savoir quand la page a fini de se construire.

import http  from "http"
import https from "https"

import {creer_document} from "./dom.js"
import {resoudre_composant} from "../composants.js"

// Une minuterie plus longue n'est pas attendue (horloge, comptes à rebours…)
const DELAI_MAX_MINUTERIE_SUIVIE = 1000

// Une requête vers l'extérieur (l'API) sans réponse dans ce délai est abandonnée
const DELAI_REQUETE = 2500

// Taille de fenêtre supposée : un téléphone tenu verticalement, comme pour l'indexation mobile
// des moteurs de recherche
const LARGEUR_FENETRE = 390
const HAUTEUR_FENETRE = 844

class Stockage
{
    #donnees = new Map()

    get length()        { return this.#donnees.size }
    key(index)          { return [...this.#donnees.keys()][index] ?? null }
    getItem(clef)       { return this.#donnees.has(String(clef)) ? this.#donnees.get(String(clef)) : null }
    setItem(clef, val)  { this.#donnees.set(String(clef), String(val)) }
    removeItem(clef)    { this.#donnees.delete(String(clef)) }
    clear()             { this.#donnees.clear() }
}

class ObservateurInerte
{
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
}

// Requête HTTP réelle, renvoyant une Response comme fetch. Le fetch de Node (undici) n'est pas
// utilisé : il crée des minuteries internes avec le setTimeout global, que le rendu attendrait
const requete_http = (url, {method = `GET`, headers = {}, body} = {}) => new Promise((resoudre, rejeter) =>
{
    const module = url.protocol === `https:` ? https : http
    const requete = module.request(url, {method, headers, timeout: DELAI_REQUETE}, (reponse) =>
    {
        const morceaux = []
        reponse.on(`data`, (morceau) => morceaux.push(morceau))
        reponse.on(`end`, () =>
        {
            const entetes = new Headers()
            for (const [clef, valeur] of Object.entries(reponse.headers))
                for (const element of [valeur].flat())
                    entetes.append(clef, element)
            const sans_corps = [204, 205, 304].includes(reponse.statusCode)
            resoudre(new Response(sans_corps ? null : Buffer.concat(morceaux), {
                status: reponse.statusCode,
                statusText: reponse.statusMessage,
                headers: entetes
            }))
        })
        reponse.on(`error`, rejeter)
    })
    requete.on(`timeout`, () => requete.destroy(new Error(`Pas de réponse de ${url.href} en ${DELAI_REQUETE} ms`)))
    requete.on(`error`, rejeter)
    if (body !== undefined && body !== null)
        requete.write(body)
    requete.end()
})

const definir_global = (nom, valeur) =>
{
    Object.defineProperty(globalThis, nom, {
        value: valeur,
        writable: true,
        configurable: true,
        enumerable: true
    })
}

// `ip` : adresse du visiteur, envoyée à l'API dans X-Forwarded-For
export const installer_environnement = (adresse, ip = null) =>
{
    // Tâches attendues avant l'envoi de la page, décrites pour le diagnostic
    const taches_en_cours = new Set()
    const commencer_tache = (description) =>
    {
        const tache = {description}
        taches_en_cours.add(tache)
        return tache
    }
    const finir_tache = (tache) => { taches_en_cours.delete(tache) }

    const minuterie_native   = globalThis.setTimeout
    const annulation_native  = globalThis.clearTimeout

    // ─── Document et fenêtre ─────────────────────────────────────────────────

    const document = creer_document()
    document.body.id = `avec`

    const location = new URL(adresse)
    location.assign  = (url) => { location.href = new URL(url, location.href).href }
    location.replace = location.assign
    location.reload  = () => {}

    const pile_historique = [location.href]
    const history = {
        state: null,
        get length() { return pile_historique.length },
        pushState(etat, _, url)
        {
            this.state = etat
            if (url !== undefined && url !== null)
                location.href = new URL(url, location.href).href
            pile_historique.push(location.href)
        },
        replaceState(etat, _, url)
        {
            this.state = etat
            if (url !== undefined && url !== null)
                location.href = new URL(url, location.href).href
            pile_historique[pile_historique.length - 1] = location.href
        },
        back() {},
        forward() {},
        go() {}
    }

    definir_global(`window`,           globalThis)
    definir_global(`self`,             globalThis)
    definir_global(`document`,         document)
    definir_global(`location`,         location)
    definir_global(`history`,          history)
    definir_global(`localStorage`,     new Stockage())
    definir_global(`sessionStorage`,   new Stockage())
    definir_global(`innerWidth`,       LARGEUR_FENETRE)
    definir_global(`innerHeight`,      HAUTEUR_FENETRE)
    definir_global(`outerWidth`,       LARGEUR_FENETRE)
    definir_global(`outerHeight`,      HAUTEUR_FENETRE)
    definir_global(`devicePixelRatio`, 1)
    definir_global(`scrollX`,          0)
    definir_global(`scrollY`,          0)

    definir_global(`addEventListener`,    () => {})
    definir_global(`removeEventListener`, () => {})
    definir_global(`dispatchEvent`,       () => true)
    definir_global(`scrollTo`,            () => {})
    definir_global(`scrollBy`,            () => {})
    definir_global(`alert`,               () => {})
    definir_global(`confirm`,             () => false)
    definir_global(`prompt`,              () => null)

    definir_global(`matchMedia`, (requete) => ({
        matches: false,
        media: String(requete),
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {}
    }))

    // Aucune feuille de style n'est appliquée : durées nulles pour les transitions
    definir_global(`getComputedStyle`, () => new Proxy({}, {
        get: (_, clef) =>
        {
            if (clef === `getPropertyValue`)
                return () => ``
            if (typeof clef !== `string`)
                return undefined
            if (/^(transition|animation)(Duration|Delay)$/.test(clef))
                return `0s`
            // Dimensions nulles, pour que les calculs des scripts (parseFloat…) restent des nombres
            if (/^(padding|margin|border\w*Width|(min|max)?(Width|Height)$|width$|height$|top$|right$|bottom$|left$|gap$|rowGap$|columnGap$|inset)/.test(clef))
                return `0px`
            return ``
        }
    }))

    definir_global(`ResizeObserver`,       ObservateurInerte)
    definir_global(`MutationObserver`,     ObservateurInerte)
    definir_global(`IntersectionObserver`, ObservateurInerte)

    // ─── Minuteries suivies ──────────────────────────────────────────────────

    const minuteries_suivies = new Map()

    definir_global(`setTimeout`, (fonction, delai = 0, ...args) =>
    {
        const suivie = !(Number(delai) > DELAI_MAX_MINUTERIE_SUIVIE)
        let minuterie
        minuterie = minuterie_native(() =>
        {
            finir_tache(minuteries_suivies.get(minuterie))
            minuteries_suivies.delete(minuterie)
            if (typeof fonction === `function`)
                fonction(...args)
        }, delai)
        if (suivie)
            minuteries_suivies.set(minuterie, commencer_tache(`minuterie de ${Number(delai) || 0} ms`))
        return minuterie
    })

    // Comme dans un navigateur, clearTimeout et clearInterval annulent indifféremment l'un ou l'autre
    const annuler = (minuterie) =>
    {
        finir_tache(minuteries_suivies.get(minuterie))
        minuteries_suivies.delete(minuterie)
        annulation_native(minuterie)
    }
    definir_global(`clearTimeout`,  annuler)
    definir_global(`clearInterval`, annuler)

    definir_global(`requestAnimationFrame`, (fonction) =>
        globalThis.setTimeout(() => fonction(performance.now()), 0))
    definir_global(`cancelAnimationFrame`, (minuterie) => globalThis.clearTimeout(minuterie))

    // ─── Requêtes ────────────────────────────────────────────────────────────

    // Les composants du site (/systeme/…) sont lus directement sur le disque ;
    // l'API peut être jointe à une adresse interne (internal_api_url), par exemple
    // le nom du service dans le réseau Docker
    const origine_api = process.env.api_url
        ? new URL(process.env.api_url.replace(`localhost`, location.hostname)).origin
        : null

    const rediriger_api = (url) =>
    {
        const interne = process.env.internal_api_url
        if (!interne || url.origin !== origine_api)
            return url
        return new URL(url.pathname + url.search, interne)
    }

    definir_global(`fetch`, async (ressource, options = {}) =>
    {
        const url  = new URL(ressource instanceof Request ? ressource.url : String(ressource), location.href)
        const tache = commencer_tache(`requête ${options.method ?? `GET`} ${url.href}`)
        try
        {
            const entetes = Object.fromEntries(
                Object.entries(options.headers ?? {}).map(([clef, valeur]) => [clef.toLowerCase(), String(valeur)])
            )

            if (url.origin === location.origin)
            {
                const reponse = resoudre_composant(url.pathname + url.search, entetes)
                if (reponse.page)
                    return new Response(``, {status: 404})
                return new Response(reponse.contenu ?? ``, {
                    status: reponse.statut,
                    headers: reponse.type ? {"Content-Type": reponse.type} : {}
                })
            }

            const headers = {...options.headers}
            if (ip && url.origin === origine_api)
                headers["X-Forwarded-For"] = ip
            return await requete_http(rediriger_api(url), {method: options.method, headers, body: options.body})
        }
        finally
        {
            finir_tache(tache)
        }
    })

    // ─── Attente de fin de construction ──────────────────────────────────────

    // Résout à `true` quand plus aucune tâche suivie n'est en cours pendant quelques tours
    // de boucle d'événements, ou à `false` si le délai maximal est dépassé
    const attendre_stabilite = (delai_max) => new Promise((resoudre) =>
    {
        const limite = Date.now() + delai_max
        let tours_calmes = 0
        const verifier = () =>
        {
            if (taches_en_cours.size === 0)
                tours_calmes++
            else
                tours_calmes = 0

            if (tours_calmes >= 3)
                return resoudre(true)
            if (Date.now() >= limite)
                return resoudre(false)
            minuterie_native(verifier, tours_calmes > 0 ? 0 : 5)
        }
        minuterie_native(verifier, 0)
    })

    const decrire_taches = () => [...taches_en_cours].map((tache) => tache.description)

    return {document, location, attendre_stabilite, decrire_taches}
}
