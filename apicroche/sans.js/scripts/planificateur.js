import cron from 'node-cron'

import { creer_fonctions_magasin } from './magasin.js'
import { creer_fonctions_mailer } from './mailer.js'
import { evaluer } from './augure.js'

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
    const noms = [...code_brut.matchAll(/(\$\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)].map(m => m[1])
    const export_obj = `return { ${noms.join(', ')} }`

    const noms_contexte = Object.keys(contexte)
    const vals_contexte = Object.values(contexte)

    try
    {
        const fabrique = new Function(...noms_contexte, `${code_brut}\n${export_obj}`)
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

const convertir_periode = (periode) =>
{
    if (typeof periode !== 'string')
        return null

    const match = /^\s*(\d+)\s*([mhd])\s*$/.exec(periode)
    if (!match)
        return null

    const valeur = Number(match[1])
    const unite  = match[2].toLowerCase()

    if (!Number.isInteger(valeur) || valeur <= 0)
        return null

    if (unite === 'm')
    {
        return {
            expression_cron: '* * * * *',
            interval_ms: valeur * 60 * 1000
        }
    }

    if (unite === 'h')
    {
        return {
            expression_cron: '0 * * * *',
            interval_ms: valeur * 60 * 60 * 1000
        }
    }

    if (unite === 'd')
    {
        return {
            expression_cron: '0 0 * * *',
            interval_ms: valeur * 24 * 60 * 60 * 1000
        }
    }

    return null
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

        const { expression_cron, interval_ms } = periode
        let derniere_execution = 0
        let execution_en_cours = false

        const task = cron.schedule(expression_cron, async () =>
        {
            const maintenant = Date.now()
            if (execution_en_cours)
                return

            // La dernière exécution est datée de son début, avec une marge pour
            // absorber le léger décalage des déclenchements cron.
            if (derniere_execution > 0 && (maintenant - derniere_execution) < interval_ms - 5000)
                return

            execution_en_cours = true
            derniere_execution = maintenant
            try
            {
                await executer_action_hors_requete(schemas, index.script ?? '', bloc, 'periodically')
            }
            finally
            {
                execution_en_cours = false
            }
        })

        taches.push(task)
        console.log(`  CRON   ${expression_cron.padEnd(13)} → ${bloc.periodically} (période ${bloc.period})`)
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
