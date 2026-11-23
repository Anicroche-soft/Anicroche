import { definir_variable_racine, initialiser_sculpteur, enregistrer_nettoyage, observer_variable_racine } from './sculpteur.js'

// Chargée en premier par l'architecte, pour que la bannière de la console (nom et version du
// site) soit le premier affichage ; null en cas d'échec
export const charger_adn_app = async () =>
{
    try
    {
        const reponse = await fetch(`/systeme/app.adn`, {
            headers: {
                'X-AC-Composant': `true`
            }
        })

        if (!reponse.ok)
            throw new Error(`Echec du chargement de app.adn (statut : ${reponse.status})`)

        return await reponse.json()
    }
    catch (erreur)
    {
        console.error(erreur)
        return null
    }
}

const definir_variables_adn = (adn) =>
{
    if (!adn || typeof adn !== 'object' || Array.isArray(adn))
    {
        definir_variable_racine(`$app`, {})
        return
    }

    definir_variable_racine(`$app`, adn)
    Object.entries(adn).forEach(([cle, valeur]) => definir_variable_racine(`$${cle}`, valeur))
}

// $title et $description remplacent, tant qu'ils ne sont pas nuls, le name et la description
// d'app.adn ; $status ne sert qu'à la page construite par le serveur
const initialiser_entete = (config) =>
{
    definir_variable_racine(`$title`,       null)
    definir_variable_racine(`$description`, null)
    definir_variable_racine(`$status`,      null)

    const titre_defaut       = config?.name ?? document.title
    const description_defaut = config?.description ?? ``

    observer_variable_racine(`$title`, (titre) =>
    {
        document.title = titre ?? titre_defaut
    })

    observer_variable_racine(`$description`, (description) =>
    {
        let balise = document.head.querySelector(`meta[name="description"]`)
        if (!balise)
        {
            balise = document.createElement(`meta`)
            balise.setAttribute(`name`, `description`)
            document.head.append(balise)
        }
        balise.setAttribute(`content`, description ?? description_defaut)
    })
}

const _actions = {
    prior_requested: [],
    post_requested: []
}

const executer_actions_http = async (cas, option, contexte = undefined) =>
{
    const actions = _actions[cas]
    if (!Array.isArray(actions) || actions.length === 0)
        return option

    for (const action of [...actions])
    {
        const retour = await action(option, contexte)
        if (retour && typeof retour === 'object' && !Array.isArray(retour))
            Object.assign(option, retour)
    }

    return option
}

// adn : la configuration déjà chargée par charger_adn_app, sinon chargée ici
export const initialiser_heraut = async (adn_charge) =>
{
    initialiser_sculpteur()

    definir_variable_racine(`$add_action`, (cas, fn) =>
    {
        if (!Array.isArray(_actions[cas]))
            throw new Error(`Cas d'action invalide : ${cas}`)
        if (typeof fn !== 'function')
            throw new Error(`Action invalide pour ${cas}`)

        _actions[cas].push(fn)

        const nettoyage = () =>
        {
            const actions = _actions[cas]
            const index = actions.indexOf(fn)
            if (index !== -1)
                actions.splice(index, 1)
        }

        enregistrer_nettoyage(nettoyage)
        return nettoyage
    })

    const adn = adn_charge === undefined ? await charger_adn_app() : adn_charge
    definir_variables_adn(adn)
    initialiser_entete(adn?.config)
    const api_url = adn?.api_url || `http://localhost:5030`

    const construire_url_api = (resource, params) =>
    {
        let base = api_url.endsWith(`/`) ? api_url : `${api_url}/`
        
        // Remplacer localhost par le hostname de la page actuelle
        if (base.includes('localhost')) {
            base = base.replace('localhost', window.location.hostname)
        }
        
        const url = new URL(String(resource), base)

        if (params)
            Object.entries(params).forEach(([cle, valeur]) => url.searchParams.set(cle, valeur))

        return url
    }

    definir_variable_racine(`$create`, async (resource, genes) => {
        const url = construire_url_api(resource)
        const options = {
            url,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genes)
        }

        await executer_actions_http('prior_requested', options)

        const reponse = await fetch(options.url, {
            method: options.method,
            credentials: 'include',
            headers: options.headers,
            body: options.body
        })
        const data = await reponse.json()
        await executer_actions_http('post_requested', data, options)
        return data
    })

    definir_variable_racine(`$search`, async (resource, params) => {
        const url = construire_url_api(resource, params)

        const options = {
            url,
            method: 'GET',
            headers: {},
            body: undefined
        }

        await executer_actions_http('prior_requested', options)

        const reponse = await fetch(options.url, {
            method: options.method,
            credentials: 'include',
            headers: options.headers,
            body: options.body
        })
        const data = await reponse.json()
        await executer_actions_http('post_requested', data, options)
        return data
    })

    definir_variable_racine(`$update`, async (resource, genes, params) => {
        const url = construire_url_api(resource, params)

        const options = {
            url,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(genes)
        }

        await executer_actions_http('prior_requested', options)

        const reponse = await fetch(options.url, {
            method: options.method,
            credentials: 'include',
            headers: options.headers,
            body: options.body
        })
        const data = await reponse.json()
        await executer_actions_http('post_requested', data, options)
        return data
    })

    // Un corps n est envoyé que s il est donné (confirmation par clef, par exemple)
    definir_variable_racine(`$delete`, async (resource, params, genes) => {
        const url = construire_url_api(resource, params)

        const options = {
            url,
            method: 'DELETE',
            headers: genes === undefined ? {} : { 'Content-Type': 'application/json' },
            body: genes === undefined ? undefined : JSON.stringify(genes)
        }

        await executer_actions_http('prior_requested', options)

        const reponse = await fetch(options.url, {
            method: options.method,
            credentials: 'include',
            headers: options.headers,
            body: options.body
        })
        const data = await reponse.json()
        await executer_actions_http('post_requested', data, options)
        return data
    })
}

export const charger_modele = async (nom, connus = []) =>
{
    try
    {
        const reponse = await fetch(`/systeme/modeles/${nom}.avec`, {
            headers: {
                'X-AC-Composant': `true`,
                'X-AC-Connus': connus.join(',')
            }
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
