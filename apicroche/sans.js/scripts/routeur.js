import { creer_fonctions_magasin, preparer_donnees } from './magasin.js'
import { creer_fonctions_mailer }  from './mailer.js'
import { evaluer, ERREUR as ERREUR_AUGURE } from './augure.js'
import { SignJWT, jwtVerify } from 'jose'
import { randomUUID, webcrypto } from 'crypto'
import { verifier_argon2 } from './crypto.js'
import { lire_ip, regrouper_ip, analyser_quota, consommer } from './limiteur.js'
import { lister_fonctions_script } from '../analyseur_sans.js'

if (!globalThis.crypto)
    globalThis.crypto = webcrypto

const mode = process.env.mode || 'prod'
const origines_configurees = [process.env.cors_origin, process.env.app_url]
    .filter(Boolean)
    .flatMap(valeur => String(valeur).split(','))
    .map(valeur => valeur.trim())
    .filter(Boolean)

const est_origine_http = (origine) =>
{
    try
    {
        const { protocol } = new URL(origine)
        return protocol === 'http:' || protocol === 'https:'
    }
    catch
    {
        return false
    }
}

const resoudre_origine_cors = (req) =>
{
    const origine = req.headers.origin
    if (!origine)
        return origines_configurees[0] ?? null

    if (origines_configurees.includes(origine))
        return origine

    if (mode === 'dev' && est_origine_http(origine))
        return origine

    return null
}

// En-têtes de requête acceptés : ceux de base, complétés par cors_headers de app.adn
const ENTETES_CORS_BASE = ['Content-Type', 'Authorization']
let entetes_cors        = ENTETES_CORS_BASE.join(', ')

const definir_entetes_cors = (valeur) =>
{
    const supplementaires = (Array.isArray(valeur) ? valeur : String(valeur ?? '').split(','))
        .map(entete => String(entete).trim())
        .filter(Boolean)
    entetes_cors = [...new Set([...ENTETES_CORS_BASE, ...supplementaires])].join(', ')
}

export const appliquer_cors = (req, rep) =>
{
    const origine = resoudre_origine_cors(req)
    if (origine)
        rep.setHeader('Access-Control-Allow-Origin', origine)

    rep.setHeader('Access-Control-Allow-Credentials', 'true')
    rep.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    rep.setHeader('Access-Control-Allow-Headers', entetes_cors)
    rep.setHeader('Vary', 'Origin')
}

// Un formulaire tiers peut envoyer une requête POST simple (sans requête préalable CORS) avec les cookies
const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS'])

const refuser_requete_croisee = (req) =>
{
    if (METHODES_SURES.has(req.method))
        return null

    const origine_refusee = req.headers.origin
        ? !resoudre_origine_cors(req)
        : req.headers['sec-fetch-site'] === 'cross-site'
    if (origine_refusee)
        return { statut: 403, message: 'Origine refusée' }

    const corps_annonce = Number(req.headers['content-length'] ?? 0) > 0 || !!req.headers['transfer-encoding']
    const type_contenu  = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (corps_annonce && type_contenu !== 'application/json')
        return { statut: 415, message: 'Type de contenu refusé : application/json attendu' }

    return null
}

const route_est_active = (route) =>
{
    if (!route || typeof route !== 'object')
        return false

    const mode_route = typeof route.mode === 'string' ? route.mode.trim().toLowerCase() : ''
    if (!mode_route || mode_route === 'all')
        return true

    return mode_route === mode
}

const valider_regles_modele = (modele, valeurs) =>
{
    const contexte = {}
    for (const champ of modele.fields)
        contexte[`$${champ.name}`] = valeurs[champ.name] ?? ERREUR_AUGURE

    for (const champ of modele.fields)
    {
        if (typeof champ.rule !== 'string' || !champ.rule.trim())
            continue

        // Un champ facultatif sans valeur n'a pas de règle à respecter
        const valeur = contexte[`$${champ.name}`]
        if (champ.nullable && (valeur === null || valeur === ERREUR_AUGURE))
            continue

        try
        {
            if (!evaluer(champ.rule, contexte))
                return { ok: false, champ: champ.name }
        }
        catch (err)
        {
            return { ok: false, champ: champ.name, erreur: err }
        }
    }

    return { ok: true }
}

// ─── $indicate ────────────────────────────────────────────────────────────────

class ReponseDeja extends Error
{
    constructor()
    {
        super('reponse_deja_envoyee')
    }
}

const est_reponse_deja = (erreur) => erreur instanceof ReponseDeja

const est_objet_simple = (valeur) =>
    valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur)

const creer_add_to_data = (data_reponse) => (clef, valeur) =>
{
    if (clef === undefined || clef === null)
        return

    const clef_normale = String(clef)
    if (Object.prototype.hasOwnProperty.call(data_reponse, clef_normale))
        return

    data_reponse[clef_normale] = valeur
}

const CLES_REPONSE_RESERVEES = new Set(['code', 'message', 'error', 'data'])

const creer_add_to_respond = (reponse_extra) => (clef, valeur) =>
{
    if (clef === undefined || clef === null)
        return

    const clef_normale = String(clef)
    if (CLES_REPONSE_RESERVEES.has(clef_normale))
        return

    if (Object.prototype.hasOwnProperty.call(reponse_extra, clef_normale))
        return

    reponse_extra[clef_normale] = valeur
}

const creer_indicate = (rep, data_reponse, reponse_extra, executer_post_respond = null) => (statut, message, data) =>
{
    const envoyer_reponse = () =>
    {
        if (rep.headersSent)
            return

        const succes = statut >= 200 && statut < 300
        const data_base = data !== undefined ? data : {}
        const data_finale = est_objet_simple(data_base)
            ? { ...data_base, ...data_reponse }
            : data_base

        const reponse = {
            code: statut,
            [succes ? 'message' : 'error']: message,
            data: data_finale,
            ...reponse_extra
        }

        rep.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8' })
        rep.end(JSON.stringify(reponse))
    }

    if (typeof executer_post_respond === 'function')
    {
        Promise
            .resolve()
            .then(() => executer_post_respond())
            .then(() => envoyer_reponse())
            .catch((err) =>
            {
                if (est_reponse_deja(err) || rep.headersSent)
                    return

                console.log(`/!\\ erreur post_respond : ${err.message}`)

                const reponse = {
                    code: 500,
                    error: 'Erreur interne',
                    data: data_reponse,
                    ...reponse_extra
                }

                rep.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
                rep.end(JSON.stringify(reponse))
            })
    }
    else
    {
        envoyer_reponse()
    }

    throw new ReponseDeja()
}

// ─── Lecture du corps JSON ────────────────────────────────────────────────────

const CORPS_TROP_GRAND = Symbol('corps_trop_grand')
const TAILLE_CORPS_DEFAUT = 1024 * 1024

const UNITES_TAILLE = { b: 1, kb: 1024, mb: 1024 * 1024 }

const analyser_taille_corps = (valeur) =>
{
    if (valeur === undefined || valeur === null || valeur === '')
        return TAILLE_CORPS_DEFAUT
    const morceaux = /^\s*(\d+)\s*(b|kb|mb)?\s*$/i.exec(String(valeur))
    if (!morceaux)
    {
        console.log(`/!\\ body_limit invalide (${valeur}) : ${TAILLE_CORPS_DEFAUT} octets utilisés`)
        return TAILLE_CORPS_DEFAUT
    }
    return Number(morceaux[1]) * UNITES_TAILLE[(morceaux[2] ?? 'b').toLowerCase()]
}

const lire_corps = (req, taille_max) => new Promise((resolve) =>
{
    if (Number(req.headers['content-length'] ?? 0) > taille_max)
        return resolve(CORPS_TROP_GRAND)

    const morceaux = []
    let taille     = 0
    req.on('data', (morceau) =>
    {
        taille += morceau.length
        if (taille > taille_max)
            return resolve(CORPS_TROP_GRAND)
        morceaux.push(morceau)
    })
    req.on('end', () =>
    {
        if (taille > taille_max)
            return
        try   { resolve(JSON.parse(Buffer.concat(morceaux).toString('utf8'))) }
        catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
})

const parser_cookies = (cookie_header) =>
{
    if (!cookie_header || typeof cookie_header !== 'string')
        return {}

    const cookies = {}
    for (const morceau of cookie_header.split(';'))
    {
        const brut = morceau.trim()
        if (!brut) continue

        const index_egal = brut.indexOf('=')
        if (index_egal <= 0) continue

        const nom = brut.slice(0, index_egal).trim()
        const valeur_brute = brut.slice(index_egal + 1)

        if (!nom) continue

        try
        {
            cookies[nom] = decodeURIComponent(valeur_brute)
        }
        catch
        {
            cookies[nom] = valeur_brute
        }
    }

    return cookies
}

const construire_request = (req) => ({
    ip: lire_ip(req),
    user_agent: req.headers['user-agent'] ?? null,
    path: new URL(req.url, 'http://localhost').pathname,
    headers: req.headers,
    cookies: parser_cookies(req.headers.cookie),
    params: req.params ?? {}
})

// ─── JWT & Cookies ────────────────────────────────────────────────────────────

const UNITES_DUREE_SECONDES = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400
}

const convertir_duree_en_secondes = (duree, valeur_par_defaut) =>
{
    const brute = duree ?? valeur_par_defaut

    if (typeof brute === 'number' && Number.isFinite(brute) && brute >= 0)
        return Math.floor(brute)

    if (typeof brute !== 'string')
        throw new Error('Durée invalide : utilisez un format comme 15m, 30d, 1h')

    const match = /^\s*(\d+)\s*([smhd])\s*$/i.exec(brute)
    if (!match)
        throw new Error('Durée invalide : utilisez un format comme 15m, 30d, 1h')

    const valeur = Number(match[1])
    const unite  = UNITES_DUREE_SECONDES[match[2].toLowerCase()]

    if (!Number.isFinite(valeur) || valeur < 0 || !unite)
        throw new Error('Durée invalide : utilisez un format comme 15m, 30d, 1h')

    return valeur * unite
}

const creer_sign_token = () => async (payload = {}, options = {}) =>
{
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Payload JWT invalide : objet attendu')

    const secret = process.env.secret_jwt ?? process.env.JWT_SECRET
    if (!secret)
        throw new Error('secret_jwt manquant')

    const lifetime_secondes = convertir_duree_en_secondes(options?.lifetime, '15m')
    const maintenant = Math.floor(Date.now() / 1000)

    const claims = {
        ...payload,
        iat: maintenant,
        exp: maintenant + lifetime_secondes,
        jti: randomUUID()
    }

    const cle = new TextEncoder().encode(secret)

    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .sign(cle)
}

const creer_verify_token = () => async (jeton) =>
{
    if (!jeton || typeof jeton !== 'string')
        return null

    const secret = process.env.secret_jwt ?? process.env.JWT_SECRET
    if (!secret)
        return null

    try
    {
        const cle = new TextEncoder().encode(secret)
        const { payload } = await jwtVerify(jeton, cle)
        return payload
    }
    catch
    {
        return null
    }
}

const creer_set_cookie = (rep) => (name, value, options = {}) =>
{
    if (!name)
        throw new Error('Nom de cookie invalide')

    const max_age = convertir_duree_en_secondes(options?.lifetime, '30d')
    const http_only = options?.httpOnly ?? true
    const secure = options?.secure ?? (mode === 'prod')
    const same_site = options?.sameSite ?? (mode === 'prod' ? 'None' : 'Lax')
    const path = options?.path ?? '/'

    const morceaux = [
        `${String(name)}=${encodeURIComponent(String(value ?? ''))}`,
        `Max-Age=${max_age}`,
        `Path=${path}`,
        `SameSite=${same_site}`
    ]

    if (http_only) morceaux.push('HttpOnly')
    if (secure) morceaux.push('Secure')

    const cookie = morceaux.join('; ')
    const entete_existant = rep.getHeader('Set-Cookie')

    if (!entete_existant)
        rep.setHeader('Set-Cookie', cookie)
    else if (Array.isArray(entete_existant))
        rep.setHeader('Set-Cookie', [...entete_existant, cookie])
    else
        rep.setHeader('Set-Cookie', [String(entete_existant), cookie])

    return cookie
}

// ─── Compilation du bloc @script ─────────────────────────────────────────────
// Transforme les déclarations  async $nom(args) { ... }
// en                           const $nom = async (args) => { ... }
// puis évalue dans un contexte injecté

const compiler_script = (code_brut, contexte) =>
{
    // La syntaxe $nom = async ($args) => { ... } est déjà du JS valide, pas de transformation nécessaire
    // Il suffit d'extraire les noms pour les exporter.
    // Supporte les fonctions async ET synchrones :
    // $nom = async ($args) => { ... }
    // $nom = ($args) => { ... }
    const noms = lister_fonctions_script(code_brut)
    const export_obj = `return { ${noms.join(', ')} }`

    const noms_contexte = Object.keys(contexte)
    const vals_contexte = Object.values(contexte)

    // Sans déclaration, `$nom = …` créerait une variable globale, partagée entre les requêtes
    // simultanées : une fonction appellerait alors la copie liée au $context d'une autre requête
    const a_declarer  = noms.filter(nom => !noms_contexte.includes(nom))
    const declaration = a_declarer.length ? `let ${a_declarer.join(', ')}\n` : ''

    try
    {
        // eslint-disable-next-line no-new-func
        const fabrique = new Function(...noms_contexte, `${declaration}${code_brut}\n${export_obj}`)
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

const citer_condition = (valeur) =>
{
    if (valeur === undefined)
        return 'null'

    const json = JSON.stringify(valeur)
    return json === undefined ? 'null' : json
}

const construire_fonctions_magasin_requete = (fonctions_magasin, contexte_condition) => ({
    ...fonctions_magasin,
    $search_one: (nom_modele, condition, contexte = {}, options = undefined) =>
        fonctions_magasin.$search_one(nom_modele, condition, { ...contexte_condition, ...contexte }, options),
    $search_all: (nom_modele, condition, contexte = {}, options = undefined) =>
        fonctions_magasin.$search_all(nom_modele, condition, { ...contexte_condition, ...contexte }, options),
    $delete_one: (nom_modele, condition, contexte = {}) =>
        fonctions_magasin.$delete_one(nom_modele, condition, { ...contexte_condition, ...contexte }),
    $delete_all: (nom_modele, condition, contexte = {}, options = undefined) =>
        fonctions_magasin.$delete_all(nom_modele, condition, { ...contexte_condition, ...contexte }, options),
    $update_one: (nom_modele, condition, donnees = {}, contexte = {}) =>
        fonctions_magasin.$update_one(nom_modele, condition, donnees, { ...contexte_condition, ...contexte }),
    $update_all: (nom_modele, condition, donnees = {}, contexte = {}) =>
        fonctions_magasin.$update_all(nom_modele, condition, donnees, { ...contexte_condition, ...contexte }),
})

const normaliser_projection_recherche = (table, projection) =>
{
    const champs_physiques = table.fields.map(f => f.name)
    const ensemble_physique = new Set(champs_physiques)

    if (typeof projection !== 'string')
        return { physiques: champs_physiques, select: null }

    const brut = projection.trim()
    if (!brut)
        return { physiques: champs_physiques, select: null }

    const physiques = []
    const tokens_select = []
    const vus = new Set()

    for (const morceau of brut.split(';'))
    {
        const token = morceau.trim()
        if (!token)
            continue

        if (token === '*')
            return { physiques: champs_physiques, select: null }

        if (vus.has(token))
            continue

        vus.add(token)
        tokens_select.push(token)

        // Extraire la racine pour savoir si c'est un champ physique
        const racine = token.includes('.') ? token.slice(0, token.indexOf('.')).split(',').pop().trim() : token.split(',')[0].trim()

        if (ensemble_physique.has(racine))
            physiques.push(racine)
    }

    return { physiques, select: tokens_select.join(';') }
}


// Condition désignant une entrée par sa clef primaire (paramètres de l'URL)
const construire_condition_pk = (table) =>
    table.primary.map(clef => `#${clef} = $params.${clef}`).join(' & ')

// Ajouter une restriction déclarée dans @rules à une condition
const restreindre = (condition, restriction) =>
    restriction ? `(${condition}) & (${restriction})` : condition

// Exécuter un hook `$fonction($arg, …)` déclaré dans un modèle.
// `valeurs` associe chaque argument reconnu ($body, $request, $context, $values, $results…) à sa valeur.
// Retourne vrai si une réponse a été envoyée (le traitement doit alors s'arrêter).
const executer_hook_script = async ({ action_brut, etiquette, fonctions, rep, $indicate, valeurs }) =>
{
    if (typeof action_brut !== 'string' || !action_brut.trim())
        return false

    const action = analyser_action(action_brut)
    if (!action)
    {
        console.log(`/!\\ ${etiquette} ignoré : action invalide`)
        return false
    }

    const fn = fonctions?.[action.nom]
    if (typeof fn !== 'function')
    {
        console.log(`/!\\ ${etiquette} ignoré : fonction introuvable ${action.nom}`)
        return false
    }

    try
    {
        await fn(...action.args.map(arg => valeurs[arg]))
    }
    catch (err)
    {
        if (est_reponse_deja(err))
            return true

        console.log(`/!\\ erreur ${etiquette} ${action_brut} : ${err.message}`)
        if (!rep.headersSent)
            $indicate(500, 'Erreur interne')
        return true
    }

    return rep.headersSent
}

// Exécuter une liste de hooks ; retourne vrai si le traitement doit s'arrêter
const executer_hooks = async (hooks, parametres) =>
{
    for (const { action_brut, etiquette } of hooks)
    {
        if (await executer_hook_script({ ...parametres, action_brut, etiquette }))
            return true
    }
    return false
}

const repondre_surcharge = (rep) =>
{
    if (rep.headersSent)
        return
    rep.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '1' })
    rep.end(JSON.stringify({ code: 503, error: 'Serveur surchargé, réessayez dans un instant', data: {} }))
}

const repondre_erreur_interne = (rep) =>
{
    if (rep.headersSent)
        return
    rep.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    rep.end(JSON.stringify({ code: 500, error: 'Erreur interne', data: {} }))
}

const executer_prior_respond = async (index, contexte, rep, $body, $request, $context, $indicate) =>
{
    if (!index)
        return { interrompu: false, fonctions: {} }

    const fonctions = compiler_script(index.script ?? '', contexte)
    if (!index?.actions || !Array.isArray(index.actions) || index.actions.length === 0)
        return { interrompu: false, fonctions }

    for (const bloc of index.actions)
    {
        if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc))
            continue

        if (typeof bloc.prior_respond !== 'string' || !bloc.prior_respond.trim())
            continue

        if (typeof bloc.when === 'string' && bloc.when.trim())
        {
            try
            {
                if (!evaluer(bloc.when, { $request }))
                    continue
            }
            catch (err)
            {
                if (est_reponse_deja(err))
                    return { interrompu: true, fonctions }

                console.log(`/!\ erreur when prior_respond : ${err.message}`)
                if (!rep.headersSent)
                    $indicate(500, 'Erreur interne')
                return { interrompu: rep.headersSent, fonctions }
            }
        }

        const action = analyser_action(bloc.prior_respond)
        if (!action)
        {
            console.log('/!\ prior_respond ignoré : action invalide')
            continue
        }

        const fn = fonctions[action.nom]
        if (typeof fn !== 'function')
        {
            console.log(`/!\ prior_respond ignoré : fonction introuvable ${action.nom}`)
            continue
        }

        const valeurs_args = action.args.map(arg =>
        {
            if (arg === '$body') return $body
            if (arg === '$request') return $request
            if (arg === '$context') return $context
            return undefined
        })

        try
        {
            await fn(...valeurs_args)
        }
        catch (err)
        {
            if (est_reponse_deja(err))
                return { interrompu: true, fonctions }

            if (err.code === 'ARGON2_SATURE')
            {
                repondre_surcharge(rep)
                return { interrompu: true, fonctions }
            }

            console.log(`/!\ erreur prior_respond ${bloc.prior_respond} : ${err.message}`)
            if (!rep.headersSent)
                $indicate(500, 'Erreur interne')
            return { interrompu: rep.headersSent, fonctions }
        }

        if (rep.headersSent)
            return { interrompu: true, fonctions }
    }

    return { interrompu: rep.headersSent, fonctions }
}

const executer_post_respond = async (index, contexte, rep, $body, $request, $context, $indicate) =>
{
    if (!index)
        return { interrompu: false, fonctions: {} }

    const fonctions = compiler_script(index.script ?? '', contexte)
    if (!index?.actions || !Array.isArray(index.actions) || index.actions.length === 0)
        return { interrompu: false, fonctions }

    for (const bloc of index.actions)
    {
        if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc))
            continue

        if (typeof bloc.post_respond !== 'string' || !bloc.post_respond.trim())
            continue

        if (typeof bloc.when === 'string' && bloc.when.trim())
        {
            try
            {
                if (!evaluer(bloc.when, { $request }))
                    continue
            }
            catch (err)
            {
                if (est_reponse_deja(err))
                    return { interrompu: true, fonctions }

                console.log(`/!\\ erreur when post_respond : ${err.message}`)
                if (!rep.headersSent)
                    $indicate(500, 'Erreur interne')
                return { interrompu: rep.headersSent, fonctions }
            }
        }

        const action = analyser_action(bloc.post_respond)
        if (!action)
        {
            console.log('/!\\ post_respond ignoré : action invalide')
            continue
        }

        const fn = fonctions[action.nom]
        if (typeof fn !== 'function')
        {
            console.log(`/!\\ post_respond ignoré : fonction introuvable ${action.nom}`)
            continue
        }

        const valeurs_args = action.args.map(arg =>
        {
            if (arg === '$body') return $body
            if (arg === '$request') return $request
            if (arg === '$context') return $context
            return undefined
        })

        try
        {
            await fn(...valeurs_args)
        }
        catch (err)
        {
            if (est_reponse_deja(err))
                return { interrompu: true, fonctions }

            console.log(`/!\\ erreur post_respond ${bloc.post_respond} : ${err.message}`)
            if (!rep.headersSent)
                $indicate(500, 'Erreur interne')
            return { interrompu: rep.headersSent, fonctions }
        }

        if (rep.headersSent)
            return { interrompu: true, fonctions }
    }

    return { interrompu: rep.headersSent, fonctions }
}


// ─── Construction des routes ──────────────────────────────────────────────────

const CODES_VALIDATION = new Set(['RULE_VIOLATION', 'ENUM_VIOLATION', 'SIZE_VIOLATION'])

export const construire_routes = (schemas, index = null, options = {}) =>
{
    definir_entetes_cors(options.cors_headers)

    const taille_corps_max  = analyser_taille_corps(options.body_limit)
    const fonctions_magasin = creer_fonctions_magasin(schemas)
    const fonctions_mailer  = creer_fonctions_mailer()
    const index_routes      = index ?? schemas.index ?? null
    const routes            = []
    let premiere_route      = true

    const enregistrer_route = (methode, chemin, handler, description, limit = undefined) =>
    {
        routes.push({ methode, chemin, handler, limit })
        if (premiere_route)
        {
            console.log('\nRoutes :')
            premiere_route = false
        }
        console.log(`  ${methode.padEnd(6)} ${chemin}  →  ${description}`)
    }

    // Préparer le contexte commun d'une requête puis exécuter les prior_respond.
    // Retourne null si une réponse a déjà été envoyée.
    const ouvrir_requete = async (req, rep) =>
    {
        appliquer_cors(req, rep)

        const refus = refuser_requete_croisee(req)
        if (refus)
        {
            rep.writeHead(refus.statut, { 'Content-Type': 'application/json; charset=utf-8' })
            rep.end(JSON.stringify({ code: refus.statut, error: refus.message, data: {} }))
            return null
        }

        const $body         = await lire_corps(req, taille_corps_max)
        if ($body === CORPS_TROP_GRAND)
        {
            // Ne pas lire le reste d'un corps trop grand : la connexion est fermée après la réponse
            rep.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Connection': 'close' })
            rep.end(JSON.stringify({ code: 413, error: 'Corps de requête trop grand', data: {} }), () => req.destroy())
            return null
        }

        const $request      = construire_request(req)
        const $context      = {}
        const $params       = req.params ?? {}
        const data_reponse  = {}
        const reponse_extra = {}

        let contexte_script       = null
        let post_respond_execute  = false
        let post_respond_en_cours = false

        const executer_post_respond_safe = async () =>
        {
            if (post_respond_execute || post_respond_en_cours || !contexte_script)
                return

            post_respond_en_cours = true
            let post_respond = null
            try
            {
                post_respond = await executer_post_respond(index_routes, contexte_script, rep, $body, $request, $context, $indicate_brut)
            }
            finally
            {
                post_respond_en_cours = false
            }

            if (post_respond.interrompu)
                return

            Object.assign(contexte_script, post_respond.fonctions)
            post_respond_execute = true
        }

        const $indicate_brut = creer_indicate(rep, data_reponse, reponse_extra)
        const indiquer       = creer_indicate(rep, data_reponse, reponse_extra, executer_post_respond_safe)
        const etat           = { reponse_demandee: false }
        const $indicate      = (...args) =>
        {
            etat.reponse_demandee = true
            return indiquer(...args)
        }
        const magasin        = construire_fonctions_magasin_requete(fonctions_magasin, { $body, $params })

        contexte_script = {
            ...magasin,
            ...fonctions_mailer,
            $indicate,
            $add_to_data   : creer_add_to_data(data_reponse),
            $add_to_respond: creer_add_to_respond(reponse_extra),
            $body,
            $request,
            $context,
            $mode          : mode,
            $sign_token    : creer_sign_token(),
            $verify_token  : creer_verify_token(),
            $set_cookie    : creer_set_cookie(rep),
            $verify_hash   : (hachage, valeur) => verifier_argon2(hachage, String(valeur ?? '')),
            $limit         : async (clef, quota, options_limite = {}) =>
            {
                const quota_lu = analyser_quota(quota)
                if (!quota_lu)
                    throw new Error(`$limit : quota invalide (${quota}), format attendu : 10/1m`)

                const par_ip  = options_limite?.per_ip ?? true
                const attente = consommer(
                    [{ clef: `$limit:${clef}|${quota_lu.texte}|${par_ip ? regrouper_ip($request.ip) : ''}`, quota: quota_lu }],
                    options_limite?.count ?? true
                )
                if (!attente)
                    return

                rep.setHeader('Retry-After', String(attente))
                return $indicate(429, 'Trop de requêtes')
            },
            $q             : citer_condition
        }

        const prior_respond = await executer_prior_respond(index_routes, contexte_script, rep, $body, $request, $context, $indicate)
        if (prior_respond.interrompu)
            return null

        Object.assign(contexte_script, prior_respond.fonctions)
        return { $body, $request, $context, $params, $indicate, contexte_script, magasin, etat }
    }

    // Envelopper un handler : toute erreur imprévue donne une réponse 500
    const proteger = (etiquette, traitement) => async (req, rep) =>
    {
        let $indicate = null
        try
        {
            const requete = await ouvrir_requete(req, rep)
            if (!requete)
                return
            $indicate = requete.$indicate
            await traitement(requete, req, rep)
        }
        catch (err)
        {
            if (est_reponse_deja(err) || rep.headersSent)
                return

            if (CODES_VALIDATION.has(err.code))
            {
                try { $indicate?.(422, err.message) } catch {}
                return
            }

            if (err.code === 'ARGON2_SATURE')
            {
                repondre_surcharge(rep)
                return
            }

            // Clef étrangère vers une entrée inexistante / entrée encore référencée
            if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW')
            {
                try { $indicate?.(422, 'Référence vers une entrée inexistante') } catch {}
                return
            }
            if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED')
            {
                try { $indicate?.(409, 'Entrée encore référencée par d\'autres données') } catch {}
                return
            }

            console.log(`/!\\ erreur ${etiquette} : ${err.message}`)
            try
            {
                if ($indicate)
                    $indicate(500, 'Erreur interne')
                else
                    repondre_erreur_interne(rep)
            }
            catch {}
        }
    }

    const compiler_script_modele = (table, contexte_script, necessaire) =>
        necessaire && table.script ? compiler_script(table.script, contexte_script) : null

    // ─── Routes déclarées dans @routes ────────────────────────────────────────

    const ajouter_routes_modele = (table) =>
    {
        if (!table.routes?.length || !table.script)
            return

        for (const route of table.routes)
        {
            if (!route_est_active(route))
                continue

            const action = analyser_action(route.action)
            if (!action)
            {
                console.log(`/!\\ route sans action valide ignorée : ${route.path}`)
                continue
            }

            const methode = (route.method ?? 'POST').toUpperCase()

            const handler = proteger(`${methode} ${route.path}`, async ({ $body, $request, $context, $indicate, contexte_script, etat }, req, rep) =>
            {
                // Compiler le script à chaque requête pour lier $indicate à cette réponse
                const fonctions = compiler_script(table.script, contexte_script)
                const fn = fonctions[action.nom]
                if (typeof fn !== 'function')
                {
                    console.log(`/!\\ route ${route.path} : fonction introuvable ${action.nom}`)
                    $indicate(500, 'Erreur interne')
                    return
                }

                const valeurs = { $body, $request, $context }
                await fn(...action.args.map(arg => valeurs[arg]))

                if (!etat.reponse_demandee)
                {
                    console.log(`/!\\ route ${methode} ${route.path} : ${action.nom} s'est terminée sans appeler $indicate`)
                    $indicate(500, 'Aucune réponse')
                }
            })

            enregistrer_route(methode, route.path, handler, action.nom, route.limit)
        }
    }

    for (const table of schemas.tables)
        ajouter_routes_modele(table)
    if (index_routes)
        ajouter_routes_modele(index_routes)

    // ─── Routes automatiques ──────────────────────────────────────────────────

    for (const table of schemas.tables)
    {
        const nom_entree   = table.entry_name ?? table.name
        const a_une_pk     = Array.isArray(table.primary) && table.primary.length > 0
        const chemin_pk    = `/${nom_entree}/${table.primary.map(clef => `:${clef}`).join('/')}`
        const condition_pk = construire_condition_pk(table)

        // Lire les champs du corps (sous leur nom `alt` s'il est défini)
        const lire_champs_corps = (champs, $body) =>
        {
            const donnees = {}
            for (const champ of champs)
            {
                const valeur = $body[champ.alt ?? champ.name]
                if (valeur !== undefined)
                    donnees[champ.name] = valeur
            }
            return donnees
        }

        // Contexte des conditions can_create / can_update : champs du corps + requête
        const contexte_corps = ($body, $request, $context, $params) =>
        {
            const contexte = { $request, $context, $params }
            for (const champ of table.fields)
                contexte[`$${champ.name}`] = $body[champ.alt ?? champ.name] ?? ERREUR_AUGURE
            return contexte
        }

        // ─── POST /<entrée> (champs can_create) ──────────────────────────────

        const champs_can_create = table.fields.filter(f => f.can_create != null)
        if (champs_can_create.length)
        {
            const handler = proteger(`POST /${nom_entree}`, async ({ $body, $request, $context, $params, $indicate, contexte_script }, req, rep) =>
            {
                const contexte = contexte_corps($body, $request, $context, $params)
                for (const champ of champs_can_create)
                {
                    if (!evaluer(champ.can_create, contexte))
                    {
                        $indicate(403, 'Accès refusé')
                        return
                    }
                }

                // Pré-générer les valeurs auto pour les rendre disponibles dans prior_create
                const $values = preparer_donnees(table, lire_champs_corps(champs_can_create, $body))

                const validation_regles = valider_regles_modele(table, $values)
                if (!validation_regles.ok)
                {
                    if (validation_regles.erreur)
                        console.log(`/!\\ erreur validation règle ${validation_regles.champ} : ${validation_regles.erreur.message}`)
                    $indicate(422, `Valeur invalide pour le champ "${validation_regles.champ}"`)
                    return
                }

                const hooks_prior = table.fields.filter(f => f.prior_create).map(f => ({ action_brut: f.prior_create, etiquette: `prior_create ${f.name}` }))
                const hooks_post  = table.fields.filter(f => f.post_create).map(f => ({ action_brut: f.post_create, etiquette: `post_create ${f.name}` }))
                const fonctions   = compiler_script_modele(table, contexte_script, hooks_prior.length || hooks_post.length)
                const parametres  = { fonctions, rep, $indicate, valeurs: { $body, $request, $context, $values } }

                if (await executer_hooks(hooks_prior, parametres))
                    return

                Object.assign($values, await fonctions_magasin.$create_one(nom_entree, $values))

                if (await executer_hooks(hooks_post, parametres))
                    return

                $indicate(201, 'Créé')
            })

            enregistrer_route('POST', `/${nom_entree}`, handler, `can_create [${champs_can_create.map(f => f.name).join(', ')}]`)
        }

        // ─── GET /<table> et GET /<entrée>/:pk (champs can_search) ──────────

        const routes_recherche = [{ is_one: false, chemin: `/${table.name}`, action: 'search_all' }]
        if (a_une_pk)
            routes_recherche.push({ is_one: true, chemin: chemin_pk, action: 'search_one' })

        for (const route_recherche of routes_recherche)
        {
            const handler = proteger(`GET ${route_recherche.chemin}`, async ({ $body, $request, $context, $params, $indicate, contexte_script, magasin }, req, rep) =>
            {
                const contexte_regles = { $request, $context, $params }

                if (table.rules?.can_search != null && !evaluer(table.rules.can_search, contexte_regles))
                {
                    $indicate(403, 'Accès refusé')
                    return
                }

                const projection = new URL(req.url, 'http://localhost').searchParams.get('projection')
                const { physiques: projection_physique, select: projection_select } = normaliser_projection_recherche(table, projection)

                const champs_retenus = []
                const aux_conditions = {}
                for (const nom_champ of projection_physique)
                {
                    const champ = table.fields.find(f => f.name === nom_champ)
                    if (!champ?.can_search?.trim() || !evaluer(champ.can_search, contexte_regles))
                        continue

                    champs_retenus.push(nom_champ)
                    if (champ.restrict_search?.trim())
                        aux_conditions[`_can_${champ.name}`] = champ.restrict_search
                }

                if (!champs_retenus.length)
                {
                    $indicate(403, 'Accès refusé')
                    return
                }

                // Select final : champs physiques retenus + reste de la projection (relations, imbriqués)
                const reste_projection = projection_select
                    ? projection_select.split(';').map(t => t.trim()).filter(t => t && !projection_physique.includes(t.split('.')[0].split(',').pop().trim()))
                    : []
                const options_recherche = {
                    select        : [champs_retenus.join(';'), ...reste_projection].filter(Boolean).join(';'),
                    aux_conditions,
                    enforce_rules : true
                }

                const condition_base = table.rules?.restrict_search ?? ':)'
                const condition = route_recherche.is_one ? restreindre(condition_pk, table.rules?.restrict_search) : condition_base

                const champs_hooks = table.fields.filter(f => champs_retenus.includes(f.name))
                const hooks_prior = [
                    ...(table.rules?.prior_search ? [{ action_brut: table.rules.prior_search, etiquette: 'prior_search modèle' }] : []),
                    ...champs_hooks.filter(f => f.prior_search).map(f => ({ action_brut: f.prior_search, etiquette: `prior_search ${f.name}` }))
                ]
                const hooks_post = [
                    ...champs_hooks.filter(f => f.post_search).map(f => ({ action_brut: f.post_search, etiquette: `post_search ${f.name}` })),
                    ...(table.rules?.post_search ? [{ action_brut: table.rules.post_search, etiquette: 'post_search modèle' }] : [])
                ]
                const fonctions  = compiler_script_modele(table, contexte_script, hooks_prior.length || hooks_post.length)
                const parametres = { fonctions, rep, $indicate, valeurs: { $body, $request, $context } }

                if (await executer_hooks(hooks_prior, parametres))
                    return

                let resultats
                try
                {
                    const contexte_recherche = { $params, $context, $request }
                    resultats = route_recherche.is_one
                        ? await magasin.$search_one(nom_entree, condition, contexte_recherche, options_recherche)
                        : await magasin.$search_all(table.name, condition, contexte_recherche, options_recherche)
                }
                catch (err)
                {
                    if (err.code === 'RELATION_FORBIDDEN')
                    {
                        $indicate(403, err.message)
                        return
                    }
                    throw err
                }

                if (route_recherche.is_one)
                    resultats = resultats ? [resultats] : []

                // Retirer les champs dont la restriction n'est pas respectée sur la ligne
                for (const ligne of resultats)
                {
                    for (const nom of Object.keys(aux_conditions))
                    {
                        const nom_champ = nom.slice('_can_'.length)
                        if (Number(ligne[nom]) !== 1)
                            delete ligne[nom_champ]
                        delete ligne[nom]
                    }
                }
                resultats = resultats.filter(ligne => Object.keys(ligne).length > 0)

                parametres.valeurs.$results = resultats
                if (await executer_hooks(hooks_post, parametres))
                    return

                if (route_recherche.is_one && !resultats.length)
                {
                    $indicate(404, 'Introuvable')
                    return
                }

                $indicate(200, 'OK', route_recherche.is_one ? resultats[0] : resultats)
            })

            enregistrer_route('GET', route_recherche.chemin, handler, route_recherche.action)
        }

        if (!a_une_pk)
            continue

        // ─── PATCH /<entrée>/:pk (champs can_update) ─────────────────────────

        const champs_can_update = table.fields.filter(f => f.can_update != null)
        if (champs_can_update.length)
        {
            const handler = proteger(`PATCH ${chemin_pk}`, async ({ $body, $request, $context, $params, $indicate, contexte_script, magasin }, req, rep) =>
            {
                const $values = lire_champs_corps(champs_can_update, $body)
                if (!Object.keys($values).length)
                {
                    $indicate(400, 'Aucun champ modifiable fourni')
                    return
                }

                const contexte = contexte_corps($body, $request, $context, $params)
                for (const champ of champs_can_update)
                {
                    if ($values[champ.name] !== undefined && !evaluer(champ.can_update, contexte))
                    {
                        $indicate(403, 'Accès refusé')
                        return
                    }
                }

                const condition = restreindre(condition_pk, table.rules?.restrict_update)
                const contexte_recherche = { $params, $context, $request }
                const cible = await magasin.$search_one(nom_entree, condition, contexte_recherche)
                if (!cible)
                {
                    $indicate(404, 'Introuvable')
                    return
                }

                const hooks_prior = table.fields.filter(f => f.prior_update).map(f => ({ action_brut: f.prior_update, etiquette: `prior_update ${f.name}` }))
                const hooks_post  = table.fields.filter(f => f.post_update).map(f => ({ action_brut: f.post_update, etiquette: `post_update ${f.name}` }))
                const fonctions   = compiler_script_modele(table, contexte_script, hooks_prior.length || hooks_post.length)
                const parametres  = { fonctions, rep, $indicate, valeurs: { $body, $request, $context, $values } }

                if (await executer_hooks(hooks_prior, parametres))
                    return

                await magasin.$update_one(nom_entree, condition_pk, $values, contexte_recherche)

                if (await executer_hooks(hooks_post, parametres))
                    return

                $indicate(200, 'Modifié')
            })

            enregistrer_route('PATCH', chemin_pk, handler, `can_update [${champs_can_update.map(f => f.name).join(', ')}]`)
        }

        // ─── DELETE /<entrée>/:pk (@rules can_delete) ────────────────────────

        if (table.rules?.can_delete != null)
        {
            const handler = proteger(`DELETE ${chemin_pk}`, async ({ $body, $request, $context, $params, $indicate, contexte_script, magasin }, req, rep) =>
            {
                if (!evaluer(table.rules.can_delete, { $request, $context, $params }))
                {
                    $indicate(403, 'Accès refusé')
                    return
                }

                const condition = restreindre(condition_pk, table.rules.restrict_delete)
                const contexte_recherche = { $params, $context, $request }
                const $values = await magasin.$search_one(nom_entree, condition, contexte_recherche)
                if (!$values)
                {
                    $indicate(404, 'Introuvable')
                    return
                }

                const hooks_prior = table.rules.prior_delete ? [{ action_brut: table.rules.prior_delete, etiquette: 'prior_delete' }] : []
                const hooks_post  = table.rules.post_delete  ? [{ action_brut: table.rules.post_delete,  etiquette: 'post_delete' }]  : []
                const fonctions   = compiler_script_modele(table, contexte_script, hooks_prior.length || hooks_post.length)
                const parametres  = { fonctions, rep, $indicate, valeurs: { $body, $request, $context, $values } }

                if (await executer_hooks(hooks_prior, parametres))
                    return

                await magasin.$delete_one(nom_entree, condition_pk, contexte_recherche)

                if (await executer_hooks(hooks_post, parametres))
                    return

                $indicate(200, 'Supprimé')
            })

            enregistrer_route('DELETE', chemin_pk, handler, 'can_delete')
        }
    }

    const chemins_options = [...new Set(routes.map(route => route.chemin))]
    for (const chemin of chemins_options)
    {
        routes.push({
            methode: 'OPTIONS',
            chemin,
            handler: (req, rep) =>
            {
                appliquer_cors(req, rep)
                rep.writeHead(204)
                rep.end()
            }
        })
    }

    return routes
}
