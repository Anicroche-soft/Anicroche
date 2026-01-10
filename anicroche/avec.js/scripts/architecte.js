console.log(`\
╔══════╗
║ AVEC ║
╚══════╝`)

const styles_actifs = new Map()
const scripts_actifs = new Map()
let runtime_script = null

const initialiser_runtime_script = () =>
{
    if (runtime_script) return

    runtime_script = {}
}

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

const evaluer = (str, donnees) =>
{
    return true
}

const valoriser = (str, donnees) =>
{
    let valeur = str.replace(/(?<!\\)\$[a-zA-Z_][\w]*/g, (nom) => {
        if (nom in (donnees.args || {}))
            return donnees.args[nom].replace(/\\/g, "\\\\");
        else
            return nom
    }).replace(/\\(.)/g, "$1")
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
                if (evaluer(enfant.args[1], donnees))
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
                if (elsable && evaluer(enfant.args[1], donnees))
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
                if (!evaluer(enfant.args[1], donnees))
                {
                    enfants.push(...construire_bloc(enfant, donnees))
                }
                elsable = false
                break
            case `@repeat`:
                if (enfant.args.length > 1)
                {
                    const limite = +evaluer(enfant.args[1], donnees)
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
                    while (evaluer(bloc.enfants[i + 1].args[1], donnees))
                }
                else if (bloc.enfants.length > i + 1 && bloc.enfants[i + 1].args[0] === `@until`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                    while (!evaluer(bloc.enfants[i + 1].args[1], donnees))
                }
                elsable = false
                break
            case `@while`:
                if (i == 0 || bloc.enfants[i - 1].args[0] !== `@repeat`)
                {
                    while (evaluer(enfant.args[1], donnees))
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                elsable = false
                break
            case `@until`:
                if (i == 0 || bloc.enfants[i - 1].args[0] !== `@repeat`)
                {
                    while (!evaluer(enfant.args[1], donnees))
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
    const str = decapsuler(bloc.args[0]).trim()
    let etiquette = ``
    let attributs = []
    let pos = 0
    let blocs = ``
    let mot = ``

    while (pos < str.length)
    {
        const c = str[pos]
        if (/\s/.test(c) && blocs == ``)
        {
            if (mot.length > 0)
            {
                if (etiquette == ``)
                    etiquette = mot
                else
                    attributs.push(mot)
                mot = ``
            }
        }
        else if (c == blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
            mot += c
        }
        else if (/^["'`]$/.test(c) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += c
            mot += c
        }
        else
        {
            mot += c
        }
        pos++
    }
    if (mot.length > 0)
    {
        if (etiquette == ``)
            etiquette = mot
        else
            attributs.push(mot)
    }
    
    const noeud = document.createElement(etiquette)

    for (const attribut of attributs)
    {
        if (attribut[0] == `#`)
        {
            noeud.id = attribut.slice(1)
        }
        else if (attribut[0] == `.`)
        {
            noeud.classList.add(attribut.slice(1))
        }
        else if (!attribut.includes(`=`))
        {
            noeud.setAttribute(attribut, ``)
        }
        else if (attribut.startsWith('on') || attribut[0] == '@')
        {
            initialiser_runtime_script()

            let [evenement, script] = attribut.split('=')
            evenement = evenement[0] == `@` ? evenement.slice(1) : evenement.slice(2)
            script = decapsuler(script)

            noeud.addEventListener(evenement, (e) => {
                executer_script(script, e, noeud)
            })
        }
        else
        {
            const [clef, ...reste] = attribut.split(`=`)
            let valeur = reste.join(`=`)

            valeur = valoriser(decapsuler(valeur), donnees)

            switch (clef)
            {
            case `id`:
                noeud.id = valeur
                break
            case `class`:
                valeur.split(/\s+/).forEach(c => c && noeud.classList.add(c))
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
    const noeud = document.createTextNode(valoriser(decapsuler(bloc.args[0]), donnees))

    return [noeud]
}

const construire_modele = (bloc, donnees) =>
{
    const modele = donnees.dependances[bloc.args[0]]
    const args = {}

    for (const enfant of modele.enfants)
    {
        if (enfant.type === `instruction` && enfant.args[0] === `@style`)
        {
            const css = decapsuler(enfant.args[1])
            activer_style(bloc.args[0], css)
        }
        if (enfant.type === `instruction` && enfant.args[0] === `@script`)
        {
            const js = decapsuler(enfant.args[1])
            activer_script(bloc.args[0], js)
        }
        if (enfant.type === `instruction` && enfant.args[0] === `@args`)
        {
            const noms = decapsuler(enfant.args[1]).split(/\s+/)
            const valeurs = bloc.args.slice(1)
            for (let i = 0; i < noms.length; i++)
            {
                args[noms[i]] = valeurs[i]
            }
        }
    }

    const donnees_modele = {
        ...donnees,
        args: args,
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
    if (entree)
    {
        entree.compte--
        if (entree.compte <= 0)
        {
            entree.element.remove()
            styles_actifs.delete(modele)
        }
    }
}

const activer_script = (modele, js) =>
{
    initialiser_runtime_script()

    if (scripts_actifs.has(modele))
    {
        scripts_actifs.get(modele).compte++
    }
    else
    {
        const fonction = new Function(
            `runtime`,
            `
            with (runtime)
            {
                ${js}
            }
            `
        )

        fonction(runtime_script)

        scripts_actifs.set(modele, {
            code: js,
            compte: 1
        })
    }
}

const desactiver_script = (modele) =>
{
    const entree = scripts_actifs.get(modele)
    if (entree)
    {
        entree.compte--
        if (entree.compte <= 0)
        {
            scripts_actifs.delete(modele)
        }
    }
}

const executer_script = (script, evenement, noeud) =>
{
    if (runtime_script)
    {
        try
        {
            new Function(
                `runtime`,
                `$event`,
                `$node`,
                `
                with (runtime) {
                    ${script}
                }
                `
            )(runtime_script, evenement, noeud)
        }
        catch (erreur)
        {
            console.error(`Erreur handler AVEC :`, erreur)
        }
    }
}

const charger_modele = async (nom) =>
{
    try
    {
        const reponse = await fetch(`/systeme/modeles/${nom}.avec`, {
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
