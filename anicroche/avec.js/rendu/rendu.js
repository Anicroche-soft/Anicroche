// Rendu côté serveur d'une page : lance un worker qui exécute le moteur client sur un
// mini-DOM, puis insère le résultat dans index.html.

import {Worker} from "worker_threads"

// Temps laissé à la page pour se construire (requêtes à l'API comprises)
const DELAI_RENDU = 3000
// Au-delà, le worker est arrêté de force (script bloqué)
const DELAI_ARRET = DELAI_RENDU + 2000

const echapper_attribut = (texte) => texte
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`"`, `&quot;`)

// Le contenu d'une balise <style> ne peut pas contenir sa propre balise de fermeture
const proteger_css = (css) => css.replace(/<\/style/gi, `<\\/style`)

// Rendus simultanés au plus ; les suivants attendent leur tour dans une file limitée.
// Au-delà, ou après une trop longue attente, la page vide habituelle est envoyée
const RENDUS_SIMULTANES = 4
const TAILLE_FILE       = 32
const ATTENTE_MAX_FILE  = 5000

const FICHIER_OUVRIER = new URL(`./ouvrier.js`, import.meta.url)

// Un worker est toujours prêt (moteur chargé) pour le prochain rendu
let reserve = null

const lancer_ouvrier = () =>
{
    const ouvrier = new Worker(FICHIER_OUVRIER)
    // Un worker de réserve qui échoue est simplement remplacé au prochain rendu
    ouvrier.on(`error`, (erreur) =>
    {
        if (reserve === ouvrier)
        {
            console.error(`Échec du worker de rendu :`, erreur)
            reserve = null
        }
    })
    ouvrier.on(`exit`, () =>
    {
        if (reserve === ouvrier)
            reserve = null
    })
    ouvrier.unref()
    return ouvrier
}

const prendre_ouvrier = () =>
{
    const ouvrier = reserve ?? lancer_ouvrier()
    reserve = lancer_ouvrier()
    return ouvrier
}

const executer_rendu = (adresse, ip) => new Promise((resoudre) =>
{
    const ouvrier = prendre_ouvrier()

    let termine = false
    const terminer = (resultat) =>
    {
        if (termine)
            return
        termine = true
        clearTimeout(arret)
        ouvrier.terminate()
        resoudre(resultat)
    }

    const arret = setTimeout(() =>
    {
        console.error(`Rendu de ${adresse} interrompu après ${DELAI_ARRET} ms`)
        terminer(null)
    }, DELAI_ARRET)

    // Seuls les messages marqués viennent du rendu (node --watch envoie aussi les siens)
    ouvrier.on(`message`, (message) =>
    {
        if (message?.origine !== `rendu-avec`)
            return
        if (message.erreur)
        {
            console.error(`Échec du rendu de ${adresse} :\n${message.erreur}`)
            terminer(null)
            return
        }
        if (!message.stable)
            console.error(`Rendu de ${adresse} incomplet : la page ne s'est pas stabilisée en ${DELAI_RENDU} ms`
                + (message.taches.length ? `, tâches en cours :\n- ${message.taches.join(`\n- `)}` : ``))
        terminer(message)
    })

    ouvrier.on(`error`, (erreur) =>
    {
        console.error(`Échec du rendu de ${adresse} :`, erreur)
        terminer(null)
    })

    ouvrier.on(`exit`, () => terminer(null))

    ouvrier.postMessage({
        origine: `serveur-avec`,
        adresse,
        ip,
        delai_max: DELAI_RENDU,
        journal: process.env.render_logs === `true`
    })
})

let rendus_en_cours = 0
const file = []

const liberer_place = () =>
{
    rendus_en_cours--
    while (file.length > 0)
    {
        const suivant = file.shift()
        if (Date.now() - suivant.arrivee <= ATTENTE_MAX_FILE)
        {
            suivant.lancer()
            return
        }
        console.error(`Rendu de ${suivant.adresse} abandonné après ${ATTENTE_MAX_FILE} ms d'attente`)
        suivant.resoudre(null)
    }
}

// Renvoie le résultat du worker ({stable, adresse, classes, styles, corps}), ou null en cas d'échec.
// `ip` est l'adresse du visiteur, transmise à l'API pour que ses limites de requêtes s'appliquent
export const rendre_page = (adresse, ip = null) => new Promise((resoudre) =>
{
    const lancer = () =>
    {
        rendus_en_cours++
        executer_rendu(adresse, ip).then((resultat) =>
        {
            liberer_place()
            resoudre(resultat)
        })
    }

    if (rendus_en_cours < RENDUS_SIMULTANES)
        return lancer()

    if (file.length >= TAILLE_FILE)
    {
        console.error(`Rendu de ${adresse} refusé : ${TAILLE_FILE} rendus déjà en attente`)
        return resoudre(null)
    }

    file.push({adresse, arrivee: Date.now(), lancer, resoudre})
})

// Insère le rendu dans la page de base de l'application (avec.js/index.html complété par app.adn).
// Les styles et le contenu sont marqués `data-pre-rendu` : le client les retire au démarrage.
export const assembler_page = (rendu, html) =>
{
    if (rendu.classes)
        html = html.replace(/<html\b/, `<html class="${echapper_attribut(rendu.classes)}"`)

    const styles = rendu.styles
        .map(({modele, css}) =>
        {
            const attribut = modele ? ` data-avec="${echapper_attribut(modele)}"` : ``
            return `<style data-pre-rendu${attribut}>${proteger_css(css)}</style>`
        })
        .join(`\n`)
    html = html.replace(`</head>`, `${styles}\n</head>`)

    html = html.replace(
        /<body id="avec"><\/body>/,
        `<body id="avec" data-pre-rendu>${rendu.corps}</body>`
    )

    return html
}
