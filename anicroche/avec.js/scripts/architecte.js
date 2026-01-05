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
        const donnees = {
            dependances: index.dependances,
            tenons: []
        }
        const enfants = construire_bloc(index.modele, donnees)
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

const construire_bloc = (bloc, donnees) =>
{
    switch (bloc.type)
    {
    case `fichier`:
    case `instruction`:
        return construire_enfants(bloc, donnees)
    case `balise`:
        return construire_balise(bloc, donnees)
    case `texte`:
        return construire_texte(bloc, donnees)
    case `modele`:
        return construire_modele(bloc, donnees)
    default:
        return []
    }
}

const construire_enfants = (bloc, donnees) =>
{
    let enfants = []
    let elsable = false
    for (let i = 0; i < bloc.enfants.length; i++)
    {
        const enfant = bloc.enfants[i]
        if (enfant.type === `instruction`)
        {
            switch (enfant.args[0])
            {
            case `@style`:
                // Gérer `@style`
                elsable = false
                break
            case `@script`:
                // Gérer `@script`
                elsable = false
                break
            case `@if`:
                if (evaluer(enfant.args[1]))
                {
                    enfants.push(...construire_bloc(enfant, donnees))
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
                    enfants.push(...construire_bloc(enfant, donnees))
                    elsable = false
                }
                break
            case `@else`:
                if (elsable)
                {
                    enfants.push(...construire_bloc(enfant, donnees))
                }
                elsable = false
                break
            case `@unless`:
                if (!evaluer(enfant.args[1]))
                {
                    enfants.push(...construire_bloc(enfant, donnees))
                }
                elsable = false
                break
            case `@repeat`:
                if (enfant.args.length > 1)
                {
                    const limite = +valoriser(enfant.args[1])
                    for (let i = 0; i < limite; i++)
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                else if (bloc.enfants.length > i + 1 && bloc.enfants[i + 1].args[0] === `@while`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                    while (evaluer(bloc.enfants[i + 1].args[1]))
                }
                else if (bloc.enfants.length > i + 1 && bloc.enfants[i + 1].args[0] === `@until`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                    while (!evaluer(bloc.enfants[i + 1].args[1]))
                }
                elsable = false
                break
            case `@while`:
                if (i == 0 || bloc.enfants[i - 1].args[0] !== `@repeat`)
                {
                    while (evaluer(enfant.args[1]))
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                elsable = false
                break
            case `@until`:
                if (i == 0 || bloc.enfants[i - 1].args[0] !== `@repeat`)
                {
                    while (!evaluer(enfant.args[1]))
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                elsable = false
                break
            case `@for-each`:
                // Gérer `@for-each`
                elsable = false
                break
            case `@stud`:
                if (donnees.tenons.length > 0)
                {
                    const bloc_tenon = {
                        type: `instruction`,
                        args: [`@stud`],
                        enfants: donnees.tenons.at(-1)
                    }
                    const donnees_tenon = {
                        ...donnees,
                        tenons: donnees.tenons.slice(0, -1)
                    }

                    enfants.push(...construire_enfants(bloc_tenon, donnees_tenon))
                }
                elsable = false
                break
            }
        }
        else
        {
            enfants.push(...construire_bloc(enfant, donnees))
            elsable = false
        }
    }
    return enfants
}

const construire_balise = (bloc, donnees) =>
{
    const etiquette = bloc.args[0]
                          .replace(`<`, ``)
                          .replace(`>`, ``)
                          .split(` `)[0]
    
    const noeud = document.createElement(etiquette)

    // Ajouter les arguments HTML

    const enfants = construire_enfants(bloc, donnees)
    noeud.append(...enfants)

    return [noeud]
}

const construire_texte = (bloc, donnees) =>
{
    const noeud = document.createTextNode(bloc.args[0].slice(1, -1))

    // Modifier ceci pour retirer les ["'`] de manière correcte

    return [noeud]
}

const construire_modele = (bloc, donnees) =>
{
    const donnees_modele = {
        ...donnees,
        tenons: [...donnees.tenons, bloc.enfants]
    }
    return construire_bloc(donnees.dependances[bloc.args[0]], donnees_modele)
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
