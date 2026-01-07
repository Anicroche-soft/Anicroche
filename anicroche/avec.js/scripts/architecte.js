console.log(`\
╔══════╗
║ AVEC ║
╚══════╝`)

const styles_actifs = new Map()

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

const evaluer = (str) =>
{
    return true
}

const valoriser = (str) =>
{
    let valeur = str
    return valeur
}

const decapsuler = (str) =>
{
    const ouvrants = { '(':')', '[':']', '{':'}', '<':'>', '"':'"', "'":"'", '`':'`' }
    let texte = ``
    let blocs = ``
    let pos = 0

    while (pos < str.length)
    {
        const c = str[pos]
        if (c == blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
            if (blocs.length > 0)
                texte += c
        }
        else if (c == '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
            if (blocs.length > 1)
                texte+= c
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
            if (blocs.length > 1)
                texte += c
        }
        else
        {
            texte += c
        }
        pos++
    }
    return texte
}

const construire_bloc = (bloc, donnees) =>
{
    switch (bloc.type)
    {
    case `fichier`:
        return construire_fichier(bloc, donnees)
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

const construire_fichier = (bloc, donnees) =>
{
    // Faire en sorte que le style fonctionne pour l'index
    return construire_enfants(bloc, donnees)
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
            default:
                elsable = false
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
    const [
        etiquette,
        ...attributs
    ] = decapsuler(bloc.args[0]).trim().split(/\s+/)
    
    const noeud = document.createElement(etiquette)

    for (const attribut of attributs)
    {
        if (!attribut.includes(`=`))
        {
            noeud.setAttribute(attribut, ``)
        }
        else
        {
            const [clef, ...reste] = attribut.split(`=`)
            let valeur = reste.join(`=`)

            valeur = decapsuler(valeur)

            switch (clef)
            {
            case `class`:
                valeur.split(/\s+/).forEach(c => c && noeud.classList.add(c))
                break
            case `id`:
                noeud.id = valeur
                break
            default:
                noeud.setAttribute(clef, valeur)
            }
        }
    }

    const enfants = construire_enfants(bloc, donnees)
    noeud.append(...enfants)

    return [noeud]
}

const construire_texte = (bloc, donnees) =>
{
    const noeud = document.createTextNode(decapsuler(bloc.args[0]))

    return [noeud]
}

const construire_modele = (bloc, donnees) =>
{
    const modele = donnees.dependances[bloc.args[0]]

    for (const enfant of modele.enfants)
    {
        if (enfant.type === `instruction` && enfant.args[0] === `@style`)
        {
            const css = decapsuler(enfant.args[1])
            console.log(css)
            activer_style(bloc.args[0], css)
        }
    }

    const donnees_modele = {
        ...donnees,
        tenons: [...donnees.tenons, bloc.enfants]
    }

    const noeuds = construire_bloc(modele, donnees_modele)
    noeuds.forEach(noeud => noeud._avec_modele = bloc.args[0])

    return noeuds
}

const activer_style = (modele, css) =>
{
    if (styles_actifs.has(modele))
    {
        styles_actifs.get(modele).compte++
    }
    else
    {
        const style = document.createElement(`style`)
        style.dataset.avec = modele
        style.textContent = css

        document.head.appendChild(style)

        styles_actifs.set(modele, {
            element: style,
            compte: 1
        })
    }
}

const desactiver_style = (modele) =>
{
    const entree = styles_actifs.get(modele)
    if (!entree)
    {
        return
    }
    entree.compte--
    if (entree.count <= 0)
    {
        entree.element.remove()
        styles_actifs.delete(id)
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
