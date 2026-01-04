console.log(`\
╔══════╗
║ AVEC ║
╚══════╝`)

const initialiser = async () =>
{
    const corps = document.querySelector(`#avec`)

    index = await charger_modele(`index`)
    if (index)
    {
        const enfants = construire_bloc(index.modele)
        for (const enfant of enfants)
        {
            corps.appendChild(enfant)
        }
    }
}

const construire_bloc = (bloc) =>
{
    switch (bloc.type)
    {
    case `fichier`:
        return construire_fichier(bloc)
    case `instruction`:
        return null
    case `balise`:
        return construire_balise(bloc)
    case `texte`:
        return construire_texte(bloc)
    case `modele`:
        return construire_modele(bloc)
    }
}

const construire_fichier = (bloc) =>
{
    let noeuds = []

    for (const enfant of bloc.enfants)
    {
        const resultat = construire_bloc(enfant)

        if (Array.isArray(resultat))
        {
            for (const partie of resultat)
            {
                noeuds.push(partie)
            }
        }
        else if (resultat instanceof Node)
        {
            noeuds.push(resultat)
        }
    }
    return noeuds
}

const construire_balise = (bloc) =>
{
    const etiquette = bloc.args[0]
                          .replace(`<`, ``)
                          .replace(`>`, ``)
                          .split(` `)[0]
    
    const noeud = document.createElement(etiquette)

    // Ajouter les arguments HTML

    construire_enfants(noeud, bloc.enfants)

    return noeud
}

const construire_texte = (bloc) =>
{
    const noeud = document.createTextNode(bloc.args[0].slice(1, -1))

    // Modifier ceci pour retirer les ["'`] de manière correcte

    return noeud
}

const construire_modele = (bloc) =>
{
    const noeud = document.createElement(`p`)
    noeud.textContent = `Modele "${bloc.args[0]} ici."`

    construire_enfants(noeud, bloc.enfants)

    return noeud
}

const construire_enfants = (parent, enfants) =>
{
    for (const enfant of enfants)
    {
        const resultat = construire_bloc(enfant)

        if (Array.isArray(resultat))
        {
            for (const partie of resultat)
            {
                parent.appendChild(partie)
            }
        }
        else if (resultat instanceof Node)
        {
            parent.appendChild(resultat)
        }
    }
}

const charger_modele = async (nom) =>
{
    try
    {
        const reponse = await fetch(`/composants/modeles/${nom}.avec`, {
            headers: {'X-AC-Composant': `true`}
        })
        if (!reponse.ok)
        {
            throw new Error(`Echec du chargement du modèle « ${nom} » (statut : ${reponse.status})`)
        }
        const modele = await reponse.json()
        console.log(`Modèle « ${nom} » chargé avec succès`)
        return modele
    }
    catch (erreur)
    {
        console.error(erreur)
        return null
    }
}

document.addEventListener("DOMContentLoaded", initialiser)
