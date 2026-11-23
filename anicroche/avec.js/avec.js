import "./environnement.js"

import http from "http"
import fs   from "fs"

import {generer_adn} from "./analyseur_adn.js"
import {resoudre_composant} from "./composants.js"
import {rendre_page, assembler_page, statut_rendu} from "./rendu/rendu.js"

console.log(`\
╔══════╗
║ AVEC ║
╚══════╝`)

const adn = generer_adn()

// Délai artificiel (en secondes) avant l'envoi des composants, pour tester les chargements
const delai = 0

// Les pages sont construites par le serveur, sauf pour un navigateur qui a déjà exécuté
// JavaScript sur le site : le script en ligne d'index.html pose alors ce cookie.
// Le paramètre `?sans-js` force la construction et efface le cookie (JavaScript désactivé depuis)
const PARAMETRE_SANS_JS = `sans-js`
const COOKIE_JS         = `avec-js`

const sans_prefixe_ipv4 = (adresse) =>
    String(adresse ?? ``).trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, ``)

// Mêmes règles que l'API (sans.js) : l'en-tête X-Forwarded-For n'est cru que s'il vient
// d'un mandataire de confiance, dont l'adresse ajoutée en dernier est celle du visiteur
const mandataires_confiance = new Set(
    String(process.env.trusted_proxies ?? `127.0.0.1,::1`)
        .split(`,`)
        .map(sans_prefixe_ipv4)
        .filter(Boolean)
)

const lire_ip = (req) =>
{
    const adresse_socket = sans_prefixe_ipv4(req.socket.remoteAddress)
    const en_tete        = req.headers[`x-forwarded-for`]

    if (!en_tete || !mandataires_confiance.has(adresse_socket))
        return adresse_socket

    return en_tete.split(`,`).at(-1).trim() || adresse_socket
}

const lire_cookies = (req) =>
{
    const cookies = {}
    for (const morceau of String(req.headers.cookie ?? ``).split(`;`))
    {
        const position = morceau.indexOf(`=`)
        if (position > 0)
            cookies[morceau.slice(0, position).trim()] = morceau.slice(position + 1).trim()
    }
    return cookies
}

const echapper_attribut = (texte) => texte
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`<`, `&lt;`)

// Page de base, complétée par la clef `config` d'app.adn
const lire_index = () =>
{
    const config = adn.config ?? {}
    let html     = fs.readFileSync(`avec.js/index.html`, `utf-8`)

    if (config.lang)
        html = html.replace(/<html\b/, `<html lang="${echapper_attribut(config.lang)}"`)
    if (config.name)
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${echapper_attribut(config.name)}</title>`)

    const balises = []
    if (config.description)
        balises.push(`<meta name="description" content="${echapper_attribut(config.description)}">`)
    if (config.name)
        balises.push(`<meta name="apple-mobile-web-app-title" content="${echapper_attribut(config.name)}">`)

    const couleurs = typeof config.theme_color === `object`
        ? config.theme_color ?? {}
        : {defaut: config.theme_color}
    for (const [theme, couleur] of Object.entries(couleurs))
    {
        if (!couleur)
            continue
        const media = [`light`, `dark`].includes(theme) ? ` media="(prefers-color-scheme: ${theme})"` : ``
        balises.push(`<meta name="theme-color" content="${echapper_attribut(couleur)}"${media}>`)
    }

    if (balises.length)
        html = html.replace(/(<link rel="canonical"[^>]*>)/, `$1\n        ${balises.join(`\n        `)}`)
    return html
}

// Adresse sans le paramètre `?sans-js`, chemin et paramètres compris
const chemin_complet = (adresse) => adresse.pathname + adresse.search

const ajouter_sans_js = (adresse) =>
{
    const copie = new URL(adresse)
    copie.searchParams.set(PARAMETRE_SANS_JS, ``)
    return chemin_complet(copie).replace(`${PARAMETRE_SANS_JS}=`, PARAMETRE_SANS_JS)
}

// L'adresse canonique de la page, sur le domaine public du site (app_url) s'il est connu
const fixer_adresse_canonique = (html, adresse) =>
{
    const base = process.env.app_url || adresse.origin
    const canonique = new URL(chemin_complet(adresse), base).href
    return html.replace(
        /<link rel="canonical"[^>]*>/,
        `<link rel="canonical" href="${echapper_attribut(canonique)}" />`
    )
}

const entetes_page = (entetes = {}) => ({
    "Content-Type": "text/html; charset=utf-8",
    // La réponse dépend du cookie : un cache intermédiaire ne doit pas la servir à un autre,
    // et le navigateur la redemande à chaque fois plutôt que de réutiliser une page périmée
    "Vary": "Cookie",
    "Cache-Control": "no-cache",
    ...entetes
})

// La page vide habituelle, construite par le navigateur. Sans JavaScript, la balise <noscript>
// renvoie vers la même adresse avec `?sans-js`
const envoyer_page_vide = (rep, adresse = null, entetes = {}) =>
{
    let html = lire_index()
    if (adresse)
    {
        html = fixer_adresse_canonique(html, adresse)
        const refresh = `<noscript><meta http-equiv="refresh" content="0; url=${echapper_attribut(ajouter_sans_js(adresse))}"></noscript>`
        html = html.replace(`</head>`, `    ${refresh}\n    </head>`)
    }
    rep.writeHead(200, entetes_page(entetes))
    rep.end(html)
}

const servir_page = async (req, rep) =>
{
    const adresse = new URL(req.url, `http://${req.headers.host ?? `localhost`}`)
    const force   = adresse.searchParams.has(PARAMETRE_SANS_JS)
    adresse.searchParams.delete(PARAMETRE_SANS_JS)

    const js_actif = lire_cookies(req)[COOKIE_JS] === `1`
    if (js_actif && !force)
        return envoyer_page_vide(rep, adresse)

    // Le script en ligne d'index.html reposera le cookie si JavaScript est actif
    const entetes = force && js_actif
        ? {"Set-Cookie": `${COOKIE_JS}=; Path=/; Max-Age=0; SameSite=Lax`}
        : {}

    const rendu = await rendre_page(adresse.href, lire_ip(req))
    if (!rendu)
        return envoyer_page_vide(rep, adresse, entetes)

    // La page a changé d'adresse pendant sa construction ($navigate_to, barre oblique finale…) :
    // le visiteur y est redirigé
    const arrivee = new URL(rendu.adresse)
    if (arrivee.origin === adresse.origin && chemin_complet(arrivee) !== chemin_complet(adresse))
    {
        rep.writeHead(302, {
            ...entetes,
            "Location": force ? ajouter_sans_js(arrivee) : chemin_complet(arrivee)
        })
        rep.end()
        return
    }

    const html = fixer_adresse_canonique(assembler_page(rendu, lire_index()), adresse)
    rep.writeHead(statut_rendu(rendu), entetes_page(entetes))
    rep.end(html)
}

// ─── Pages spéciales ──────────────────────────────────────────────────────────
// La clef `pages` d'app.adn associe une adresse (/sitemap.xml…) à un modèle construit par le
// serveur à la place d'index, envoyé en XML ou en texte, et gardé en cache `cache` (10m…)

const TYPES_PAGES = {
    xml  : `application/xml; charset=utf-8`,
    text : `text/plain; charset=utf-8`
}

const DUREES = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

const lire_duree = (texte) =>
{
    const morceaux = /^([0-9]+)([smhd])$/.exec(String(texte))
    return morceaux ? Number(morceaux[1]) * DUREES[morceaux[2]] : null
}

const lire_pages_speciales = (pages) =>
{
    const lues = new Map()
    if (pages === undefined)
        return lues
    if (!pages || typeof pages !== `object` || Array.isArray(pages))
    {
        console.log(`/!\\ app.adn : pages doit être un dictionnaire { /adresse : { model, type, cache } }`)
        return lues
    }

    for (const [chemin, page] of Object.entries(pages))
    {
        const cache = page?.cache === undefined ? 0 : lire_duree(page.cache)
        if (!chemin.startsWith(`/`))
            console.log(`/!\\ app.adn : page ${chemin} ignorée (l'adresse doit commencer par /)`)
        else if (typeof page?.model !== `string` || !page.model)
            console.log(`/!\\ app.adn : page ${chemin} ignorée (model manquant)`)
        else if (!Object.hasOwn(TYPES_PAGES, page.type))
            console.log(`/!\\ app.adn : page ${chemin} ignorée (type ${page.type} : xml ou text attendu)`)
        else if (cache === null)
            console.log(`/!\\ app.adn : page ${chemin} ignorée (cache ${page.cache} : durée attendue, comme 10m)`)
        else
            lues.set(chemin, { modele: page.model, type: page.type, cache })
    }
    return lues
}

const pages_speciales = lire_pages_speciales(adn.pages)
const cache_pages     = new Map()

const envoyer_page_speciale = (rep, page, { statut, contenu }) =>
{
    rep.writeHead(statut, { "Content-Type": TYPES_PAGES[page.type] })
    rep.end(contenu)
}

// Le cache est indexé par le seul chemin : les paramètres d'adresse ne multiplient pas les rendus
const servir_page_speciale = async (req, rep, adresse, page) =>
{
    const en_cache = cache_pages.get(adresse.pathname)
    if (en_cache && en_cache.expiration > Date.now())
        return envoyer_page_speciale(rep, page, en_cache)

    const rendu = await rendre_page(adresse.href, lire_ip(req), page.modele)
    if (!rendu)
    {
        // Un rendu échoué laisse servir l'ancienne version, s'il y en a une
        if (en_cache)
            return envoyer_page_speciale(rep, page, en_cache)
        return envoyer_page_speciale(rep, page, { statut: 503, contenu: `Service indisponible\n` })
    }

    const reponse = {
        statut  : statut_rendu(rendu),
        contenu : page.type === `xml`
            ? `<?xml version="1.0" encoding="UTF-8"?>\n${rendu.corps}\n`
            : `${rendu.lignes.join(`\n`)}\n`
    }

    if (page.cache > 0 && rendu.stable && reponse.statut === 200)
        cache_pages.set(adresse.pathname, { ...reponse, expiration: Date.now() + page.cache })

    envoyer_page_speciale(rep, page, reponse)
}

const serveur = http.createServer(async (req, rep) =>
    {
        const adresse_page = new URL(req.url, `http://${req.headers.host ?? `localhost`}`)
        const page_speciale = pages_speciales.get(adresse_page.pathname)
        if (page_speciale)
        {
            try
            {
                await servir_page_speciale(req, rep, adresse_page, page_speciale)
            }
            catch (erreur)
            {
                console.error(erreur)
                if (!rep.headersSent)
                    envoyer_page_speciale(rep, page_speciale, { statut: 500, contenu: `Erreur serveur\n` })
            }
            return
        }

        let reponse
        try
        {
            reponse = resoudre_composant(req.url, req.headers)
        }
        catch (erreur)
        {
            console.error(erreur)
            reponse = {statut: 500}
        }

        if (reponse.page)
        {
            try
            {
                await servir_page(req, rep)
            }
            catch (erreur)
            {
                console.error(erreur)
                if (!rep.headersSent)
                    envoyer_page_vide(rep)
            }
            return
        }

        if (reponse.statut !== 200)
        {
            rep.writeHead(500)
            rep.end("Erreur serveur")
            return
        }

        if (delai > 0 && req.headers['x-ac-composant'] === `true`)
            await new Promise(r => setTimeout(r, delai * 1000))

        rep.writeHead(200, {"Content-Type": reponse.type})
        rep.end(reponse.contenu)
    }
)

serveur.listen(adn.port, () =>
    {
        console.log(`Serveur en route sur le port ${adn.port}`)
    }
)
