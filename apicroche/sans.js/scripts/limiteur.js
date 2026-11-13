// Limitation du nombre de requêtes par IP : blocs @limits des fichiers génériques, propriété limit des @routes et $limit des scripts

const UNITES_MS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
}

const CLEFS_MAX         = 100_000
const PERIODE_NETTOYAGE = 60 * 1000

// ─── IP ───────────────────────────────────────────────────────────────────────

const sans_prefixe_ipv4 = (adresse) =>
    String(adresse ?? '').trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '')

// Par défaut, seul un mandataire installé sur la même machine est cru
const mandataires_confiance = new Set(
    String(process.env.trusted_proxies ?? '127.0.0.1,::1')
        .split(',')
        .map(sans_prefixe_ipv4)
        .filter(Boolean)
)

// Le mandataire ajoute l'adresse réelle en dernier ; les précédentes viennent du client.
// L'en-tête n'est lu que si la connexion vient d'un mandataire de confiance : sinon,
// n'importe quel client pourrait choisir l'adresse enregistrée et contourner les limites
export const lire_ip = (req) =>
{
    const adresse_socket = req.socket.remoteAddress
    const en_tete        = req.headers['x-forwarded-for']

    if (!en_tete || !mandataires_confiance.has(sans_prefixe_ipv4(adresse_socket)))
        return adresse_socket

    return en_tete.split(',').at(-1).trim() || adresse_socket
}

const developper_ipv6 = (adresse) =>
{
    const [tete, queue] = adresse.split('::')
    const groupes_tete  = tete ? tete.split(':') : []
    if (queue === undefined)
        return groupes_tete
    const groupes_queue = queue ? queue.split(':') : []
    const manquants     = Math.max(0, 8 - groupes_tete.length - groupes_queue.length)
    return [...groupes_tete, ...Array(manquants).fill('0'), ...groupes_queue]
}

// Un accès IPv6 reçoit en général tout un /64 : compter adresse par adresse serait contournable
export const regrouper_ip = (ip) =>
{
    if (!ip)
        return 'inconnue'

    const adresse = String(ip).trim().toLowerCase().replace(/%.*$/, '')
    const ipv4    = adresse.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (ipv4)
        return ipv4[1]
    if (!adresse.includes(':'))
        return adresse

    const prefixe = developper_ipv6(adresse)
        .slice(0, 4)
        .map(groupe => groupe.replace(/^0+(?=.)/, ''))
        .join(':')
    return `${prefixe}::/64`
}

// ─── Quotas ───────────────────────────────────────────────────────────────────

export const analyser_quota = (texte) =>
{
    const morceaux = /^\s*(\d+)\s*\/\s*(\d+)\s*([smhd])\s*$/i.exec(String(texte ?? ''))
    if (!morceaux)
        return null

    const maximum = Number(morceaux[1])
    const periode = Number(morceaux[2]) * UNITES_MS[morceaux[3].toLowerCase()]
    if (maximum < 1 || periode <= 0)
        return null

    return { maximum, periode, texte: `${maximum}/${morceaux[2]}${morceaux[3].toLowerCase()}` }
}

// ─── Compteurs ────────────────────────────────────────────────────────────────
// Fenêtre glissante approximée : le compte de la fenêtre précédente est pondéré par la part
// de cette fenêtre encore couverte, ce qui évite les rafales à la jonction de deux fenêtres fixes.

const compteurs = new Map()

const lire_compteur = (clef, periode, maintenant) =>
{
    const fenetre = Math.floor(maintenant / periode)
    let compteur  = compteurs.get(clef)

    if (!compteur)
    {
        if (compteurs.size >= CLEFS_MAX)
            compteurs.delete(compteurs.keys().next().value)
        compteur = { fenetre, courant: 0, precedent: 0, periode }
        compteurs.set(clef, compteur)
    }
    else if (compteur.fenetre !== fenetre)
    {
        compteur.precedent = compteur.fenetre === fenetre - 1 ? compteur.courant : 0
        compteur.courant   = 0
        compteur.fenetre   = fenetre
    }

    return compteur
}

// Secondes à attendre avant qu'une requête de plus tienne dans le quota (0 si elle y tient déjà)
const calculer_attente = (compteur, { maximum, periode }, maintenant) =>
{
    const position   = maintenant % periode
    const estimation = compteur.precedent * (1 - position / periode) + compteur.courant
    if (estimation + 1 <= maximum)
        return 0

    const attente_ms = compteur.courant + 1 <= maximum
        ? periode * (1 - (maximum - compteur.courant - 1) / compteur.precedent) - position
        : (periode - position) + periode * (1 - (maximum - 1) / compteur.courant)

    return Math.max(1, Math.ceil(attente_ms / 1000))
}

// Vérifie toutes les limites puis, si aucune n'est dépassée, les compte toutes
// limites : [{ clef, quota }] ; retourne le nombre de secondes à attendre, ou 0
export const consommer = (limites, compter = true) =>
{
    const maintenant = Date.now()
    const lus        = limites.map(({ clef, quota }) => ({ quota, compteur: lire_compteur(clef, quota.periode, maintenant) }))

    const attente = Math.max(0, ...lus.map(({ compteur, quota }) => calculer_attente(compteur, quota, maintenant)))
    if (attente || !compter)
        return attente

    for (const { compteur } of lus)
        compteur.courant++
    return 0
}

const nettoyer = () =>
{
    const maintenant = Date.now()
    for (const [clef, compteur] of compteurs)
    {
        if (compteur.fenetre < Math.floor(maintenant / compteur.periode) - 1)
            compteurs.delete(clef)
    }
}

setInterval(nettoyer, PERIODE_NETTOYAGE).unref()

// ─── Limites déclarées ────────────────────────────────────────────────────────

const normaliser_chemin = (chemin) =>
{
    const texte = String(chemin ?? '').trim()
    if (!texte)
        return null
    const avec_barre = texte.startsWith('/') ? texte : `/${texte}`
    return avec_barre.length > 1 ? avec_barre.replace(/\/+$/, '') : avec_barre
}

const lire_methodes = (valeur) =>
{
    if (valeur === undefined || valeur === null || valeur === '')
        return null
    const liste = (Array.isArray(valeur) ? valeur : [valeur]).map(m => String(m).trim().toUpperCase()).filter(Boolean)
    return liste.length ? new Set(liste) : null
}

const cible_correspond = (cible, methode, chemin) =>
{
    if (cible.methodes && !cible.methodes.has(methode))
        return false
    return cible.joker ? chemin.startsWith(cible.prefixe) : chemin === cible.chemin
}

const lire_cibles = (bloc, numero) =>
{
    const methodes_bloc = lire_methodes(bloc.method)
    const elements      = Array.isArray(bloc.path) ? bloc.path : [bloc.path]
    const cibles        = []

    for (const element of elements)
    {
        const objet   = element && typeof element === 'object' && !Array.isArray(element)
        const chemin  = normaliser_chemin(objet ? element.path : element)
        if (!chemin)
        {
            console.log(`/!\\ @limits bloc ${numero} : chemin invalide ignoré`)
            continue
        }

        const ancien = chemin.split('/').find(segment => segment.startsWith(':'))
        if (ancien)
        {
            console.log(`/!\\ @limits bloc ${numero} : ${chemin} ignoré, la syntaxe ${ancien} n'existe plus (écrire <$${ancien.slice(1)}>)`)
            continue
        }

        const joker = chemin.endsWith('/*')
        cibles.push({
            chemin,
            joker,
            prefixe  : joker ? chemin.slice(0, -1) : null,
            methodes : objet && element.method !== undefined ? lire_methodes(element.method) : methodes_bloc
        })
    }

    return cibles
}

// blocs : valeur de @limits ; routes : [{ methode, chemin, limit }] (limit : raccourci d'une route déclarée)
export const construire_limites = (blocs, routes) =>
{
    const globales = []
    const ciblees  = []

    for (const [index, bloc] of (Array.isArray(blocs) ? blocs : []).entries())
    {
        const numero = index + 1
        if (!bloc || typeof bloc !== 'object' || Array.isArray(bloc))
        {
            console.log(`/!\\ @limits bloc ${numero} ignoré : bloc { … } attendu`)
            continue
        }

        const quota = analyser_quota(bloc.limit)
        if (!quota)
        {
            console.log(`/!\\ @limits bloc ${numero} ignoré : limit invalide (format attendu : 10/1m)`)
            continue
        }

        const clef = `@limits:${numero}`
        if (bloc.path === undefined)
        {
            globales.push({ clef, quota })
            continue
        }

        const cibles = lire_cibles(bloc, numero)
        for (const cible of cibles)
        {
            const existe = routes.some(route => cible_correspond(cible, route.methode, route.chemin))
            if (!existe)
                console.log(`/!\\ @limits bloc ${numero} : aucune route ne correspond à ${cible.methodes ? [...cible.methodes].join(',') + ' ' : ''}${cible.chemin}`)
        }
        if (cibles.length)
            ciblees.push({ clef, quota, cibles })
    }

    const par_route = new Map()
    for (const route of routes)
    {
        const limites = ciblees
            .filter(({ cibles }) => cibles.some(cible => cible_correspond(cible, route.methode, route.chemin)))
            .map(({ clef, quota }) => ({ clef, quota }))

        if (route.limit !== undefined)
        {
            const quota = analyser_quota(route.limit)
            if (quota)
                limites.push({ clef: `route:${route.methode} ${route.chemin}`, quota })
            else
                console.log(`/!\\ route ${route.methode} ${route.chemin} : limit invalide ignorée (format attendu : 10/1m)`)
        }

        par_route.set(route, limites)
    }

    const decrire_cible = (cible) => `${cible.methodes ? [...cible.methodes].join(',') + ' ' : ''}${cible.chemin}`
    const raccourcis    = routes.filter(route => analyser_quota(route.limit))
    if (globales.length || ciblees.length || raccourcis.length)
    {
        console.log('\nLimites par IP :')
        for (const { quota } of globales)
            console.log(`  ${quota.texte.padEnd(8)} toute l'API`)
        for (const { quota, cibles } of ciblees)
            console.log(`  ${quota.texte.padEnd(8)} ${cibles.map(decrire_cible).join(' ; ')}`)
        for (const route of raccourcis)
            console.log(`  ${analyser_quota(route.limit).texte.padEnd(8)} ${route.methode} ${route.chemin}`)
    }

    // Retourne le nombre de secondes à attendre si la requête dépasse une limite, 0 sinon
    return (req, route = null) =>
    {
        const groupe  = regrouper_ip(lire_ip(req))
        const limites = [...globales, ...(route ? par_route.get(route) ?? [] : [])]
        if (!limites.length)
            return 0
        return consommer(limites.map(({ clef, quota }) => ({ clef: `${clef}|${groupe}`, quota })))
    }
}
