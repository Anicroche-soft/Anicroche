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
        corps.append(...enfants)
    }
}

const evaluer = (condition) =>
{
    return true
}

const valoriser = (valeur) =>
{
    return valeur
}

const construire_bloc = (bloc) =>
{
    switch (bloc.type)
    {
    case `fichier`:
    case `instruction`:
        return construire_enfants(bloc)
    case `balise`:
        return construire_balise(bloc)
    case `texte`:
        return construire_texte(bloc)
    case `modele`:
        return construire_modele(bloc)
    default:
        return []
    }
}

const construire_enfants = (bloc) =>
{
    let enfants = []
    let elsable = false
    for (const i in bloc.enfants)
    {
        const enfant = bloc.enfants[i]
        if (enfant.type === `instruction`)
        {
            switch (enfant.args[0])
            {
            case `@style`:
                // Gérer `@style`
                break
            case `@script`:
                // Gérer `@script`
                break
            case `@if`:
                if (evaluer(enfant.args[1]))
                {
                    enfants.push(...construire_bloc(enfant))
                    elsable = false
                }
                else
                {
                    elsable = true
                }
                break
            case `@else-if`:
                if (elsable && evaluer(enfant.args[1]))
                {
                    enfants.push(...construire_bloc(enfant))
                    elsable = false
                }
                break
            case `@else`:
                if (elsable)
                {
                    enfants.push(...construire_bloc(enfant))
                }
                elsable = false
                break
            case `@unless`:
                if (!evaluer(enfant.args[1]))
                {
                    enfants.push(...construire_bloc(enfant))
                }
                elsable = false
                break
            case `@repeat`:
                if (enfant.args.length > 1)
                {
                    const limite = +valoriser(enfants.args[1])
                    for (let i = 0; i < limite; i++)
                    {
                        enfants.push(...construire_bloc(enfant))
                    }
                }
                else if (bloc.enfants.length > +i + 1 && bloc.enfants[+i + 1].args[0] === `@while`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant))
                    }
                    while (evaluer(bloc.enfants[+i + 1].args[1]))
                }
                else if (bloc.enfants.length > +i + 1 && bloc.enfants[+i + 1].args[0] === `@until`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant))
                    }
                    while (!evaluer(bloc.enfants[+i + 1].args[1]))
                }
                elsable = false
            case `@while`:
                if (i == 0 || bloc.enfants[+i - 1] !== `@repeat`)
                {
                    while (evaluer(enfant.args[1]))
                    {
                        enfants.push(...construire_bloc(enfant))
                    }
                }
                elsable = false
                break
            case `@until`:
                if (i == 0 || bloc.enfants[+i - 1] !== `@repeat`)
                {
                    while (!evaluer(enfant.args[1]))
                    {
                        enfants.push(...construire_bloc(enfant))
                    }
                }
                elsable = false
                break
            case `@for-each`:
                // Gérer `@for-each`
                break
            case `@stud`:
                // Gérer `@stud`
                break
            }
        }
        else
        {
            enfants.push(...construire_bloc(enfant))
        }
    }
    return enfants
}

const construire_balise = (bloc) =>
{
    const etiquette = bloc.args[0]
                          .replace(`<`, ``)
                          .replace(`>`, ``)
                          .split(` `)[0]
    
    const noeud = document.createElement(etiquette)

    // Ajouter les arguments HTML

    const enfants = construire_enfants(bloc)
    noeud.append(...enfants)

    return [noeud]
}

const construire_texte = (bloc) =>
{
    const noeud = document.createTextNode(bloc.args[0].slice(1, -1))

    // Modifier ceci pour retirer les ["'`] de manière correcte

    return [noeud]
}

const construire_modele = (bloc) =>
{
    const noeud = document.createElement(`p`)
    noeud.textContent = `Modele "${bloc.args[0]} ici."`

    const enfants = construire_enfants(bloc)
    noeud.append(...enfants)

    return [noeud]
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
