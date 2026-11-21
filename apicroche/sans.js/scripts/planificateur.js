import { creer_fonctions_magasin } from './magasin.js'
import { creer_fonctions_mailer } from './mailer.js'
import { evaluer } from './augure.js'
import { lister_fonctions_script } from '../analyseur_sans.js'
import { lire_app } from './app.js'

const analyser_action = (action) =>
{
    if (!action) return null
    const match = /^(\$\w+)\(([^)]*)\)$/.exec(action.trim())
    if (!match) return null
    const nom  = match[1]
    const args = match[2].split(',').map(a => a.trim()).filter(Boolean)
    return { nom, args }
}

const compiler_script = (code_brut, contexte) =>
{
    const noms = lister_fonctions_script(code_brut)
    const export_obj = `return { ${noms.join(', ')} }`

    const noms_contexte = Object.keys(contexte)
    const vals_contexte = Object.values(contexte)

    const a_declarer  = noms.filter(nom => !noms_contexte.includes(nom))
    const declaration = a_declarer.length ? `let ${a_declarer.join(', ')}\n` : ''

    try
    {
        const fabrique = new Function(...noms_contexte, `${declaration}${code_brut}\n${export_obj}`)
        return fabrique(...vals_contexte)
    }
    catch (err)
    {
        console.log(`/!\\ erreur de compilation du script périodique : ${err.message}`)
        return {}
    }
}

const citer_condition = (valeur) =>
{
    if (valeur === undefined)
        return 'null'

    const json = JSON.stringify(valeur)
    return json === undefined ? 'null' : json
}

const UNITES = {
    m : (date, n) => date.setMinutes(date.getMinutes() + n, 0, 0),
    h : (date, n) => date.setHours(date.getHours() + n, 0, 0, 0),
    d : (date, n) => date.setDate(date.getDate() + n)
}

const convertir_periode = (periode) =>
{
    if (typeof periode !== 'string')
        return null

    const match = /^\s*(\d+)\s*([mhd])\s*$/.exec(periode)
    if (!match)
        return null

    const valeur = Number(match[1])
    if (!Number.isInteger(valeur) || valeur <= 0)
        return null

    return { valeur, unite: match[2] }
}

// Début de la minute, de l heure ou du jour (heure locale) qui suit la date
const borne_suivante = (date, unite) =>
{
    const borne = new Date(date)
    if (unite === 'd')
        borne.setHours(0, 0, 0, 0)
    UNITES[unite](borne, 1)
    return borne
}

const avancer = (date, { valeur, unite }) =>
{
    const suivante = new Date(date)
    UNITES[unite](suivante, valeur)
    return suivante
}

const creer_contexte_base = (schemas) => ({
    ...creer_fonctions_magasin(schemas),
    ...creer_fonctions_mailer(),
    $body: {},
    $request: {
        headers: {},
        cookies: {},
        ip: null,
        user_agent: null
    },
    $context: {},
    $mode: process.env.mode || 'prod',
    $app: lire_app(),
    $q: citer_condition
})

// Exécute la fonction désignée par bloc[cle] (periodically, prior_run…) hors de toute requête
const executer_action_hors_requete = async (schemas, script, bloc, cle) =>
{
    const base = creer_contexte_base(schemas)
    const fonctions = compiler_script(script ?? '', base)
    const action = analyser_action(bloc[cle])

    if (!action)
        return

    const fn = fonctions[action.nom]
    if (typeof fn !== 'function')
    {
        console.log(`/!\\ ${cle} ignoré : fonction introuvable ${action.nom}`)
        return
    }

    const contexte = {
        ...base,
        $now: new Date()
    }

    if (typeof bloc.when === 'string' && bloc.when.trim())
    {
        try
        {
            if (!evaluer(bloc.when, contexte))
                return
        }
        catch (err)
        {
            console.log(`/!\\ erreur when ${cle} ${bloc[cle]} : ${err.message}`)
            return
        }
    }

    const valeurs_args = action.args.map(arg =>
    {
        if (arg === '$body') return contexte.$body
        if (arg === '$request') return contexte.$request
        if (arg === '$context') return contexte.$context
        if (arg === '$now') return contexte.$now
        return undefined
    })

    try
    {
        await fn(...valeurs_args)
    }
    catch (err)
    {
        console.log(`/!\\ erreur ${cle} ${bloc[cle]} : ${err.message}`)
    }
}

export const demarrer_taches_periodiques = (schemas) =>
{
    const index = schemas?.index ?? null
    if (!index?.actions || !Array.isArray(index.actions) || index.actions.length === 0)
        return []

    const taches = []

    for (const bloc of index.actions)
    {
        if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc))
            continue

        if (typeof bloc.periodically !== 'string' || !bloc.periodically.trim())
            continue

        const periode = convertir_periode(bloc.period)
        if (!periode)
        {
            console.log(`/!\\ tâche périodique ignorée : période invalide ${bloc.period ?? '(absente)'}`)
            continue
        }

        // Les échéances sont comparées à l horloge à chaque réveil : un réveil en retard (processus
        // bloqué, machine en veille) exécute la tâche dès qu il a lieu, une seule fois même si
        // plusieurs échéances sont passées
        let echeance           = borne_suivante(new Date(), periode.unite)
        let execution_en_cours = false
        let minuteur           = null

        const executer = async () =>
        {
            execution_en_cours = true
            const maintenant   = new Date()
            while (echeance <= maintenant)
                echeance = avancer(echeance, periode)
            try
            {
                await executer_action_hors_requete(schemas, index.script ?? '', bloc, 'periodically')
            }
            finally
            {
                execution_en_cours = false
            }
        }

        // Réveil au plus tard toutes les minutes : la durée d un minuteur ne compte pas le temps
        // passé en veille. Une échéance passée pendant une exécution attend la fin de celle-ci
        const planifier = () =>
        {
            const attente = echeance - new Date()
            minuteur = setTimeout(reveiller, attente > 0 ? Math.min(attente + 50, 60 * 1000) : 1000)
        }

        const reveiller = () =>
        {
            if (!execution_en_cours && echeance <= new Date())
                executer()
            planifier()
        }

        planifier()

        taches.push({ arreter: () => clearTimeout(minuteur) })
        console.log(`  TÂCHE  ${bloc.period.trim().padEnd(5)} → ${bloc.periodically} (prochaine : ${echeance.toLocaleString('fr-FR')})`)
    }

    return taches
}

// Actions prior_run : exécutées une fois, dans l'ordre, après la construction de la base
// et avant l'écoute du serveur. Une erreur est journalisée sans empêcher le démarrage.
export const executer_actions_prior_run = async (schemas) =>
{
    const index = schemas?.index ?? null
    if (!index?.actions || !Array.isArray(index.actions))
        return

    for (const bloc of index.actions)
    {
        if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc))
            continue

        if (typeof bloc.prior_run !== 'string' || !bloc.prior_run.trim())
            continue

        console.log(`  PRIOR_RUN → ${bloc.prior_run}`)
        await executer_action_hors_requete(schemas, index.script ?? '', bloc, 'prior_run')
    }
}
