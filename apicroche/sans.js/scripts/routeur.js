import { creer_fonctions_magasin } from './magasin.js'

// ─── $indicate ────────────────────────────────────────────────────────────────

const creer_indicate = (rep) => (statut, message) =>
{
    const succes = statut >= 200 && statut < 300
    rep.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' })
    rep.end(JSON.stringify(succes ? { message } : { erreur: message }))
}

// ─── Lecture du corps JSON ────────────────────────────────────────────────────

const lire_corps = (req) => new Promise((resolve) =>
{
    let data = ''
    req.on('data', chunk => data += chunk)
    req.on('end', () =>
    {
        try   { resolve(JSON.parse(data)) }
        catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
})

// ─── Compilation du bloc @script ─────────────────────────────────────────────
// Transforme les déclarations  async $nom(args) { ... }
// en                           const $nom = async (args) => { ... }
// puis évalue dans un contexte injecté

const compiler_script = (code_brut, contexte) =>
{
    // La syntaxe $nom = async ($args) => { ... } est déjà du JS valide, pas de transformation nécessaire
    // Il suffit d'extraire les noms pour les exporter
    const noms = [...code_brut.matchAll(/(\$\w+)\s*=\s*async\s*\(/g)].map(m => m[1])
    const export_obj = `return { ${noms.join(', ')} }`

    const noms_contexte = Object.keys(contexte)
    const vals_contexte = Object.values(contexte)

    try
    {
        // eslint-disable-next-line no-new-func
        const fabrique = new Function(...noms_contexte, `${code_brut}\n${export_obj}`)
        return fabrique(...vals_contexte)
    }
    catch (err)
    {
        console.log(`/!\\ erreur de compilation du script : ${err.message}`)
        return {}
    }
}

// ─── Parsing de l'action ──────────────────────────────────────────────────────
// Format : $nom_fonction($arg1, $arg2, ...)
// Retourne { nom, args } ou null

const analyser_action = (action) =>
{
    if (!action) return null
    const match = /^(\$\w+)\(([^)]*)\)$/.exec(action.trim())
    if (!match) return null
    const nom  = match[1]
    const args = match[2].split(',').map(a => a.trim()).filter(Boolean)
    return { nom, args }
}

// ─── Variables injectées dans les handlers ────────────────────────────────────
// $body → corps JSON de la requête (sera fourni au moment de l'appel)

const VARIABLES_HANDLER = ['$body']

// ─── Construction des routes ──────────────────────────────────────────────────

export const construire_routes = (schemas) =>
{
    const fonctions_magasin = creer_fonctions_magasin(schemas)
    const routes            = []
    let premiere_route      = true

    for (const table of schemas.tables)
    {
        if (!table.routes?.length || !table.script)
            continue

        for (const route of table.routes)
        {
            const action = analyser_action(route.action)
            if (!action)
            {
                console.log(`/!\\ route sans action valide ignorée : ${route.path}`)
                continue
            }

            const chemin  = route.path
            const methode = (route.methode ?? 'POST').toUpperCase()

            const handler = async (req, rep) =>
            {
                const $body     = await lire_corps(req)
                const $indicate = creer_indicate(rep)

                // Compiler le script à chaque requête pour lier $indicate à cette réponse
                const fonctions = compiler_script(table.script, {
                    ...fonctions_magasin,
                    $indicate
                })

                const fn = fonctions[action.nom]
                if (typeof fn !== 'function')
                {
                    $indicate(500, 'Erreur interne')
                    return
                }

                const valeurs_args = action.args.map(arg =>
                {
                    if (arg === '$body') return $body
                    return undefined
                })

                try
                {
                    await fn(...valeurs_args)
                }
                catch (err)
                {
                    console.log(`/!\\ erreur dans ${action.nom} : ${err.message}`)
                    if (!rep.headersSent)
                        $indicate(500, 'Erreur interne')
                }
            }

            routes.push({ methode, chemin, handler })
            if (premiere_route)
            {
                console.log('\nRoutes :')
                premiere_route = false
            }
            console.log(`  ${methode.padEnd(6)} ${chemin}  →  ${action.nom}`)
        }
    }

    return routes
}
