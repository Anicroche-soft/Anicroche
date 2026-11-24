import { initialiser_sculpteur, definir_variable_racine } from './sculpteur.js'
import { correspondre_motif } from './augure.js'

const historique = []

// Fonctions d origine de l historique, avant leur interception par initialiser_navigateur
let remplacer_etat = null

// Vrai pendant le retour vers l entrée précédente qui suit un remplacement par la même adresse
let retour_vers_doublon = false

// Adresse relative (chemin + query + hash) de l entrée précédente de l historique, ou null si
// elle est inconnue (navigateur sans API Navigation, autre origine, première entrée)
const lire_adresse_precedente = () =>
{
    const navigation = globalThis.navigation
    if (!navigation?.entries || !navigation.currentEntry)
        return null

    const entree = navigation.entries()[navigation.currentEntry.index - 1]
    if (!entree?.url)
        return null

    const url = new URL(entree.url)
    if (url.origin !== location.origin)
        return null
    return url.pathname + url.search + url.hash
}

export const initialiser_navigateur = () =>
{
    initialiser_sculpteur()

    // remplacer : vrai pour remplacer l entrée actuelle de l historique au lieu d en ajouter une
    definir_variable_racine(`$navigate_to`, (board, remplacer = false) => {
        if (board === null || board === undefined)
            return

        const url = new URL(String(board), location.origin)

        if (url.origin !== location.origin)
        {
            if (remplacer === true)
                location.replace(url.href)
            else
                location.href = url.href
            return
        }

        const nouvelle_url = url.pathname + url.search + url.hash
        const ancienne_url = location.pathname + location.search + location.hash

        if (nouvelle_url === ancienne_url)
            return

        if (remplacer !== true)
        {
            history.pushState({}, '', nouvelle_url)
            return
        }

        history.replaceState(history.state, '', nouvelle_url)

        // Le remplacement rend l entrée identique à la précédente (adresse /profil saisie depuis
        // /compte, puis remplacée par /compte…) : on revient plutôt à celle-ci, pour ne pas
        // laisser deux entrées de suite vers la même adresse
        if (lire_adresse_precedente() === nouvelle_url)
        {
            retour_vers_doublon = true
            history.back()
        }
    })

    // Correspondance de ~= pour les scripts : captures du motif ({ id : "42" }, {} sans
    // capture), ou null si le texte n y correspond pas
    definir_variable_racine(`$match`, (texte, motif) => correspondre_motif(texte, motif))

    definir_variable_racine(`$navigate_prev`, () => {
        history.back()
    })

    definir_variable_racine(`$navigate_post`, () => {
        history.forward()
    })

    definir_variable_racine(`$history`, (age = 0) => {
        return historique.at(-(age + 1)) ?? null
    })

    document.addEventListener('click', (e) => {
        const cible = e.target
        const lien = cible.closest('a')

        if (!lien)
            return

        e.target.blur()

        // Clic déjà pris en charge par un gestionnaire du modèle (onglet d'une page…)
        if (e.defaultPrevented)
            return
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)
            return
        if (lien.hash && lien.pathname === location.pathname)
            return
        if (lien.target === '_blank')
            return
        if (lien.hasAttribute('download'))
            return
        if (lien.href.startsWith('mailto:'))
            return
        if (lien.href.startsWith('tel:'))
            return
        if (lien.origin !== location.origin)
            return

        e.preventDefault()

        const nouvelle_url = lien.pathname + lien.search + lien.hash
        const ancienne_url = location.pathname + location.search + location.hash

        if (nouvelle_url !== ancienne_url)
        {
            history.pushState({}, '', nouvelle_url)
        }
    })

    window.addEventListener('popstate', () => {
        const remplacer = retour_vers_doublon
        retour_vers_doublon = false
        naviguer(location.href, remplacer)
    })

    const push = history.pushState
    history.pushState = function (...args)
    {
        push.apply(this, args)
        naviguer(location.href)
    }

    const replace = history.replaceState
    remplacer_etat = (...args) => replace.apply(history, args)
    history.replaceState = function (...args)
    {
        replace.apply(this, args)
        naviguer(location.href, true)
    }

    naviguer(location.href)
}

// remplacer : l entrée actuelle de l historique a été remplacée, et non ajoutée
const naviguer = (bord, remplacer = false) =>
{
    const lien = new URL(bord, location.origin)

    // La barre oblique finale est retirée sans nouvelle entrée : la navigation garde
    // sa nature (ajout ou remplacement)
    if (lien.pathname.length > 1 && lien.pathname.endsWith('/'))
    {
        lien.pathname = lien.pathname.replace(/\/+$/, '') || '/'
        remplacer_etat(history.state, '', lien.pathname + lien.search + lien.hash)
        naviguer(location.href, remplacer)
        return
    }

    const adresse = lien.pathname + lien.search + lien.hash

    if (remplacer && historique.length > 0)
        historique[historique.length - 1] = adresse
    else
        historique.push(adresse)

    initialiser_sculpteur()

    definir_variable_racine(`$path`, lien.pathname)
    definir_variable_racine(`$query`, Object.fromEntries(lien.searchParams))
    definir_variable_racine(`$hash`, lien.hash)

    console.log(`Navigation vers ${bord}`)
}
