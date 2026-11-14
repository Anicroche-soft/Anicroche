// Worker de rendu côté serveur : construit une page avec le moteur client d'avec.js dans
// un environnement de navigateur simulé, puis renvoie le HTML obtenu au fil principal.
// Chaque rendu a son propre worker, arrêté ensuite : l'état global du moteur et les
// minuteries laissées par les scripts des modèles disparaissent avec lui.

import {parentPort} from "worker_threads"

import {installer_environnement} from "./environnement.js"
import {serialiser_enfants} from "./dom.js"

// Le worker est lancé à l'avance : il charge le moteur, puis attend la page à construire.
// Les modules ne touchent à aucun objet du navigateur au chargement : l'environnement
// peut être installé ensuite
const modules = Promise.all([
    import("../scripts/navigateur.js"),
    import("../scripts/heraut.js"),
    import("../scripts/batisseur.js")
])

const rendre = async ({adresse, ip, delai_max, journal}) =>
{
    const console_erreur = console.error
    if (!journal)
    {
        console.log  = () => {}
        console.info = () => {}
        console.warn = () => {}
    }
    console.error = (...args) => console_erreur(`[rendu ${adresse}]`, ...args)

    // Une promesse rejetée dans un script de modèle ne doit pas interrompre le rendu
    process.on(`unhandledRejection`, (erreur) => console.error(erreur))

    const {document, location, attendre_stabilite, decrire_taches} = installer_environnement(adresse, ip)

    try
    {
        const [{initialiser_navigateur}, {initialiser_heraut}, {initialiser_batisseur}] = await modules

        initialiser_navigateur()
        await initialiser_heraut()
        await initialiser_batisseur()

        const stable = await attendre_stabilite(delai_max)

        const styles = [...document.head.querySelectorAll(`style`)]
            .map((style) => ({modele: style.dataset.avec ?? null, css: style.textContent}))

        parentPort.postMessage({
            origine: `rendu-avec`,
            stable,
            taches: stable ? [] : decrire_taches(),
            adresse: location.href,
            classes: document.documentElement.className,
            styles,
            corps: serialiser_enfants(document.body, {commentaires: false})
        })
    }
    catch (erreur)
    {
        console.error(erreur)
        parentPort.postMessage({origine: `rendu-avec`, erreur: String(erreur?.stack ?? erreur)})
    }
}

// Seuls les messages marqués viennent du serveur
const recevoir = (message) =>
{
    if (message?.origine !== `serveur-avec`)
        return
    parentPort.off(`message`, recevoir)
    rendre(message)
}
parentPort.on(`message`, recevoir)
