// traducteur.js — Traduction des conditions du magasin en SQL
//
// Une condition (`#champ = $variable & (#autre > now | #relation.champ -{ $liste)`)
// est découpée en jetons, analysée en arbre, puis traduite :
//   - en clause WHERE exacte quand toutes les comparaisons sont traduisibles en SQL ;
//   - sinon en clause WHERE élargie (préfiltre sûr), complétée par une évaluation
//     exacte de l'arbre en JS sur chaque ligne lue (hash argon2, champs chiffrés,
//     expressions rationnelles).

import { hacher_hmac, verifier_argon2, dechiffrer_aes } from './crypto.js'

// ─── Relations ────────────────────────────────────────────────────────────────

export const trouver_table = (schemas, nom_table) =>
    schemas.tables.find(t => t.name === nom_table) ?? null

const construire_aliases_relation_inverse = (schemas, relation) =>
{
    const table_source = trouver_table(schemas, relation.table_source)
    const table_cible  = trouver_table(schemas, relation.table_cible)

    const nom_source_table  = table_source?.name ?? relation.table_source
    const nom_source_entree = table_source?.entry_name ?? table_source?.name ?? relation.table_source
    const nom_cible_entree  = table_cible?.entry_name ?? table_cible?.name ?? relation.table_cible
    const nom_relation      = relation.entry ?? nom_cible_entree

    return new Set([
        `is_${nom_relation}_of_${nom_source_table}`,
        `is_${nom_relation}_of_${nom_source_entree}`,
        `is_${nom_cible_entree}_of_${nom_source_table}`,
        `is_${nom_cible_entree}_of_${nom_source_entree}`,
    ])
}

// Retrouver la relation désignée par `token` depuis `modele` :
// - sens direct : nom du champ de relation déclaré dans le modèle
// - sens inverse : alias `is_<entrée>_of_<table|entrée source>` depuis le modèle cible
export const resoudre_relation = (schemas, modele, token) =>
{
    for (const relation of schemas.relations ?? [])
    {
        if (relation.table_source === modele.name && relation.champ_source === token)
            return { relation, sens: 'direct' }

        if (relation.table_cible === modele.name)
        {
            const aliases = construire_aliases_relation_inverse(schemas, relation)
            if (aliases.has(token))
                return { relation, sens: 'inverse' }
        }
    }

    return null
}

// ─── Utilitaires de valeurs ───────────────────────────────────────────────────

const UNITES_MS  = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }
const UNITES_SQL = { s: 'SECOND', m: 'MINUTE', h: 'HOUR', d: 'DAY' }

const REGEX_NOW = /^now(?:\s*([+-])\s*(\d+)\s*([smhd]))?(?![\w])/i

// `now`, `now + 7d`, `now-30s` → expression SQL équivalente (ou null)
export const traduire_now_sql = (expression) =>
{
    const match = REGEX_NOW.exec(String(expression).trim())
    if (!match || match[0].length !== String(expression).trim().length)
        return null
    if (!match[1])
        return 'NOW()'

    const fonction = match[1] === '+' ? 'DATE_ADD' : 'DATE_SUB'
    return `${fonction}(NOW(), INTERVAL ${Number(match[2])} ${UNITES_SQL[match[3].toLowerCase()]})`
}

// `now`, `now + 7d`, `now-30s` → Date (ou null)
export const calculer_now = (expression) =>
{
    const match = REGEX_NOW.exec(String(expression).trim())
    if (!match || match[0].length !== String(expression).trim().length)
        return null
    if (!match[1])
        return new Date()

    const signe = match[1] === '+' ? 1 : -1
    return new Date(Date.now() + signe * Number(match[2]) * UNITES_MS[match[3].toLowerCase()])
}

const lire_clef_crochets = (brut) =>
{
    if (/^\d+$/.test(brut))
        return Number(brut)

    const premier = brut[0]
    const dernier = brut[brut.length - 1]
    if (premier === '"' && dernier === '"')
    {
        try   { return JSON.parse(brut) }
        catch { return brut.slice(1, -1) }
    }
    if ((premier === "'" && dernier === "'") || (premier === '`' && dernier === '`'))
        return brut.slice(1, -1)

    return brut
}

// Lire `$racine.attribut[clef]…` dans le contexte.
// La racine doit exister ; un attribut absent donne `undefined`.
const lire_variable = (brut, contexte) =>
{
    const racine = brut.match(/^\$\w+/)[0]

    let valeur
    if (Object.prototype.hasOwnProperty.call(contexte, racine))
        valeur = contexte[racine]
    else if (racine === '$now')
        valeur = new Date()
    else
        throw new Error(`Condition invalide : variable inconnue ${racine}`)

    let pos = racine.length
    while (pos < brut.length)
    {
        let clef
        if (brut[pos] === '.')
        {
            clef = brut.slice(pos + 1).match(/^\w+/)[0]
            pos += 1 + clef.length
        }
        else
        {
            const fin = brut.indexOf(']', pos)
            clef = lire_clef_crochets(brut.slice(pos + 1, fin).trim())
            pos = fin + 1
        }

        if (valeur === null || valeur === undefined)
            return undefined
        valeur = valeur[clef]
    }

    return valeur
}

// ─── Découpage en jetons ──────────────────────────────────────────────────────

const OPERATEURS = ['!-{', '-{', '>=', '<=', '!=', '<>', '~=', '=', '>', '<', '&', '|', '!', '(', ')']
const OPERATEURS_COMPARAISON = new Set(['=', '!=', '<>', '>', '<', '>=', '<=', '-{', '!-{', '~='])
const SMILEYS = { ':)': true, ':(': false, ':o': null }

const decouper = (condition) =>
{
    const jetons = []
    let pos = 0

    const precedent_est_operateur = () =>
        !jetons.length || jetons.at(-1).type === 'operateur'

    while (pos < condition.length)
    {
        const c = condition[pos]

        if (/\s/.test(c))
        {
            pos++
            continue
        }

        // Champ : #champ ou #relation.sous_relation.champ
        if (c === '#')
        {
            const match = condition.slice(pos + 1).match(/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/)
            if (!match)
                throw new Error(`Condition invalide : nom de champ attendu après # (position ${pos})`)
            jetons.push({ type: 'champ', chemin: match[0] })
            pos += 1 + match[0].length
            continue
        }

        // Variable : $nom, $nom.attribut, $nom[clef]
        if (c === '$')
        {
            const match = condition.slice(pos).match(/^\$\w+(?:\.\w+|\[[^\]]*\])*/)
            if (!match || match[0] === '$')
                throw new Error(`Condition invalide : nom de variable attendu après $ (position ${pos})`)
            jetons.push({ type: 'variable', brut: match[0] })
            pos += match[0].length
            continue
        }

        // Texte entre guillemets
        if (c === '"' || c === "'" || c === '`')
        {
            let fin = pos + 1
            while (fin < condition.length && condition[fin] !== c)
                fin += condition[fin] === '\\' ? 2 : 1
            if (fin >= condition.length)
                throw new Error(`Condition invalide : texte non fermé (position ${pos})`)

            const brut = condition.slice(pos, fin + 1)
            let valeur
            if (c === '"')
            {
                try   { valeur = JSON.parse(brut) }
                catch { valeur = brut.slice(1, -1) }
            }
            else
                valeur = brut.slice(1, -1).replace(/\\(.)/g, '$1')

            jetons.push({ type: 'valeur', valeur })
            pos = fin + 1
            continue
        }

        // Expression rationnelle, uniquement après ~=
        if (c === '/' && jetons.at(-1)?.type === 'operateur' && jetons.at(-1).valeur === '~=')
        {
            let fin = pos + 1
            while (fin < condition.length && condition[fin] !== '/')
                fin += condition[fin] === '\\' ? 2 : 1
            if (fin >= condition.length)
                throw new Error(`Condition invalide : expression rationnelle non fermée (position ${pos})`)

            const source = condition.slice(pos + 1, fin)
            let drapeaux = ''
            fin++
            while (fin < condition.length && /[gimsuy]/.test(condition[fin]))
                drapeaux += condition[fin++]

            jetons.push({ type: 'regex', regex: new RegExp(source, drapeaux) })
            pos = fin
            continue
        }

        // Littéraux :) :( :o
        const smiley = Object.keys(SMILEYS).find(s => condition.startsWith(s, pos))
        if (smiley)
        {
            jetons.push({ type: 'valeur', valeur: SMILEYS[smiley] })
            pos += smiley.length
            continue
        }

        // now, now + 7d, now-30s
        const now = condition.slice(pos).match(REGEX_NOW)
        if (now)
        {
            jetons.push({ type: 'now', expression: now[0] })
            pos += now[0].length
            continue
        }

        // Nombre (le signe n'est accepté qu'en début d'opérande)
        const nombre = condition.slice(pos).match(/^[+-]?\d+(?:\.\d+)?(?![\w])/)
        if (nombre && (/\d/.test(c) || precedent_est_operateur()))
        {
            jetons.push({ type: 'valeur', valeur: Number(nombre[0]) })
            pos += nombre[0].length
            continue
        }

        const operateur = OPERATEURS.find(o => condition.startsWith(o, pos))
        if (operateur)
        {
            jetons.push({ type: 'operateur', valeur: operateur })
            pos += operateur.length
            continue
        }

        // Mot nu : true, false, null ou texte brut (ex. `authentification`)
        const mot = condition.slice(pos).match(/^[^\s&|()=<>!~]+/)
        if (mot)
        {
            const brut = mot[0]
            const valeur = brut === 'true' ? true : brut === 'false' ? false : brut === 'null' ? null : brut
            jetons.push({ type: 'valeur', valeur })
            pos += brut.length
            continue
        }

        throw new Error(`Condition invalide : caractère inattendu "${c}" (position ${pos})`)
    }

    return jetons
}

// ─── Analyse en arbre ─────────────────────────────────────────────────────────
// ou         := et ('|' et)*
// et         := non ('&' non)*
// non        := '!' non | primaire
// primaire   := '(' ou ')' | operande (comparateur operande)?

const analyser = (jetons) =>
{
    let pos = 0

    const voir = () => jetons[pos]
    const est_operateur = (valeur) => voir()?.type === 'operateur' && voir().valeur === valeur

    const lire_ou = () =>
    {
        const enfants = [lire_et()]
        while (est_operateur('|'))
        {
            pos++
            enfants.push(lire_et())
        }
        return enfants.length === 1 ? enfants[0] : { type: 'ou', enfants }
    }

    const lire_et = () =>
    {
        const enfants = [lire_non()]
        while (est_operateur('&'))
        {
            pos++
            enfants.push(lire_non())
        }
        return enfants.length === 1 ? enfants[0] : { type: 'et', enfants }
    }

    const lire_non = () =>
    {
        if (est_operateur('!'))
        {
            pos++
            return { type: 'non', enfant: lire_non() }
        }
        return lire_primaire()
    }

    const lire_operande = () =>
    {
        const jeton = voir()
        if (!jeton || jeton.type === 'operateur')
            throw new Error(`Condition invalide : opérande attendue${jeton ? ` avant "${jeton.valeur}"` : ' en fin de condition'}`)
        pos++
        return jeton
    }

    const lire_primaire = () =>
    {
        if (est_operateur('('))
        {
            pos++
            const noeud = lire_ou()
            if (!est_operateur(')'))
                throw new Error('Condition invalide : parenthèse fermante manquante')
            pos++
            return noeud
        }

        const gauche = lire_operande()
        const suivant = voir()
        if (suivant?.type === 'operateur' && OPERATEURS_COMPARAISON.has(suivant.valeur))
        {
            pos++
            const droite = lire_operande()
            return { type: 'comparaison', operateur: suivant.valeur, gauche, droite }
        }

        return { type: 'seul', operande: gauche }
    }

    const arbre = lire_ou()
    if (pos < jetons.length)
        throw new Error(`Condition invalide : "${jetons[pos].valeur ?? jetons[pos].type}" inattendu`)
    return arbre
}

// ─── Comparaisons en JS ───────────────────────────────────────────────────────

const vers_comparable = (valeur) =>
{
    if (valeur instanceof Date)
        return valeur.getTime()
    if (typeof valeur === 'boolean')
        return valeur ? 1 : 0
    if (Buffer.isBuffer(valeur))
        return valeur.toString()
    return valeur
}

const egal = (a, b) =>
{
    if (a === null || a === undefined || b === null || b === undefined)
        return (a ?? null) === (b ?? null)

    if (a instanceof Date || b instanceof Date)
        return new Date(a).getTime() === new Date(b).getTime()

    const va = vers_comparable(a)
    const vb = vers_comparable(b)
    if (typeof va === 'number' || typeof vb === 'number')
        return Number(va) === Number(vb)
    return String(va) === String(vb)
}

const ordonner = (a, b) =>
{
    if (a instanceof Date || b instanceof Date)
        return new Date(a).getTime() - new Date(b).getTime()

    const va = vers_comparable(a)
    const vb = vers_comparable(b)
    if (!Number.isNaN(Number(va)) && !Number.isNaN(Number(vb)))
        return Number(va) - Number(vb)
    return String(va).localeCompare(String(vb))
}

const vers_liste = (valeur) =>
    Array.isArray(valeur) ? valeur : valeur instanceof Set ? [...valeur] : [valeur]

const comparer = (operateur, a, b) =>
{
    switch (operateur)
    {
        case '=':   return egal(a, b)
        case '!=':
        case '<>':  return !egal(a, b)
        case '-{':  return vers_liste(b).some(v => egal(a, v))
        case '!-{': return !vers_liste(b).some(v => egal(a, v))
        case '~=':  return b instanceof RegExp && a !== null && a !== undefined && b.test(String(a))
    }

    if (a === null || a === undefined || b === null || b === undefined)
        return false

    const ecart = ordonner(a, b)
    switch (operateur)
    {
        case '>':  return ecart > 0
        case '<':  return ecart < 0
        case '>=': return ecart >= 0
        case '<=': return ecart <= 0
    }
    return false
}

const INVERSES = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' }

// ─── Compilation ──────────────────────────────────────────────────────────────

// Une requête regroupe les jointures partagées par toutes les conditions qui la composent.
export const creer_requete = (modele) => ({
    modele,
    jointures : new Map(),
    sql_jointures: [],
    compteur  : 0
})

const ajouter_jointures = (schemas, requete, chemin_relations) =>
{
    let modele_courant = requete.modele
    let alias_courant  = requete.modele.name
    let chemin         = ''

    for (const nom_relation of chemin_relations)
    {
        chemin = chemin ? `${chemin}.${nom_relation}` : nom_relation
        const deja = requete.jointures.get(chemin)
        if (deja)
        {
            modele_courant = deja.modele
            alias_courant  = deja.alias
            continue
        }

        const trouvee = resoudre_relation(schemas, modele_courant, nom_relation)
        if (!trouvee)
            throw new Error(`Condition invalide : relation inconnue "${nom_relation}" dans le modèle "${modele_courant.name}"`)

        const { relation, sens } = trouvee
        const table_source = trouver_table(schemas, relation.table_source)
        const table_cible  = trouver_table(schemas, relation.table_cible)
        const direct       = sens === 'direct'
        const modele_enfant = direct ? table_cible : table_source
        const numero       = ++requete.compteur
        const alias_enfant = `${modele_enfant.name}_${numero}`
        const pk_source    = table_source.primary[0]
        const pk_cible     = table_cible.primary[0]

        if (relation.table_jonction)
        {
            const [cle_source, cle_cible] = relation.modele_jonction.primary
            const alias_jonction = `${relation.table_jonction}_${numero}`
            const cle_lue        = direct ? cle_source : cle_cible
            const cle_associee   = direct ? cle_cible : cle_source
            // colonne_cible peut désigner un groupe de lignes (relation avec key)
            const colonne_courante = direct ? relation.colonne_source : relation.colonne_cible
            const colonne_enfant   = direct ? relation.colonne_cible  : relation.colonne_source

            requete.sql_jointures.push(
                `LEFT JOIN \`${relation.table_jonction}\` AS \`${alias_jonction}\` ON \`${alias_courant}\`.\`${colonne_courante}\` = \`${alias_jonction}\`.\`${cle_lue}\``,
                `LEFT JOIN \`${modele_enfant.name}\` AS \`${alias_enfant}\` ON \`${alias_jonction}\`.\`${cle_associee}\` = \`${alias_enfant}\`.\`${colonne_enfant}\``
            )

            // Les champs de la jonction (fields) se lisent à travers la relation
            const jonction = { modele: relation.modele_jonction, alias: alias_jonction }
            requete.jointures.set(chemin, { modele: modele_enfant, alias: alias_enfant, jonction })
            modele_courant = modele_enfant
            alias_courant  = alias_enfant
            continue
        }
        else if (relation.cle_etrangere)
        {
            // Clef étrangère portée par la table cible (relation x-N)
            requete.sql_jointures.push(direct
                ? `LEFT JOIN \`${modele_enfant.name}\` AS \`${alias_enfant}\` ON \`${alias_courant}\`.\`${pk_source}\` = \`${alias_enfant}\`.\`${relation.cle_etrangere}\``
                : `LEFT JOIN \`${modele_enfant.name}\` AS \`${alias_enfant}\` ON \`${alias_courant}\`.\`${relation.cle_etrangere}\` = \`${alias_enfant}\`.\`${pk_source}\``
            )
        }
        else if (relation.cle_locale)
        {
            // Clef étrangère portée par la table source (relation 0-1 / 1-1)
            requete.sql_jointures.push(direct
                ? `LEFT JOIN \`${modele_enfant.name}\` AS \`${alias_enfant}\` ON \`${alias_courant}\`.\`${relation.cle_locale}\` = \`${alias_enfant}\`.\`${pk_cible}\``
                : `LEFT JOIN \`${modele_enfant.name}\` AS \`${alias_enfant}\` ON \`${alias_courant}\`.\`${pk_cible}\` = \`${alias_enfant}\`.\`${relation.cle_locale}\``
            )
        }
        else
            throw new Error(`Condition invalide : relation "${nom_relation}" non navigable`)

        requete.jointures.set(chemin, { modele: modele_enfant, alias: alias_enfant })
        modele_courant = modele_enfant
        alias_courant  = alias_enfant
    }

    return { modele: modele_courant, alias: alias_courant }
}

const resoudre_champ = (schemas, requete, chemin) =>
{
    const parties = chemin.split('.')
    const nom_champ = parties.pop()
    const { modele, alias } = parties.length
        ? ajouter_jointures(schemas, requete, parties)
        : { modele: requete.modele, alias: requete.modele.name }

    const champ = modele.fields.find(f => f.name === nom_champ)
    if (champ)
        return {
            champ,
            colonne : `\`${alias}\`.\`${champ.name}\``,
            local   : parties.length === 0
        }

    // Champ de la table de jonction de la dernière relation traversée
    const jonction = parties.length ? requete.jointures.get(parties.join('.'))?.jonction : null
    const champ_jonction = jonction?.modele.champs_jonction?.includes(nom_champ)
        ? jonction.modele.fields.find(f => f.name === nom_champ)
        : null
    if (champ_jonction)
        return {
            champ   : champ_jonction,
            colonne : `\`${jonction.alias}\`.\`${champ_jonction.name}\``,
            local   : false
        }

    throw new Error(`Condition invalide : champ inconnu "${nom_champ}" dans le modèle "${modele.name}"`)
}

const lire_operande = (jeton, contexte) =>
{
    switch (jeton.type)
    {
        case 'valeur':   return jeton.valeur
        case 'variable': return lire_variable(jeton.brut, contexte)
        case 'now':      return calculer_now(jeton.expression)
        case 'regex':    return jeton.regex
    }
    return undefined
}

const constante = (valeur) => ({ type: 'constante', valeur: Boolean(valeur) })

const feuille_sql = (sql, valeurs = [], nullable = false) => ({ type: 'sql', sql, valeurs, nullable })

// Comparaison entre une colonne et une valeur déjà résolue
const compiler_comparaison_champ = (schemas, requete, jeton_champ, operateur, jeton_valeur, contexte) =>
{
    const { champ, colonne, local } = resoudre_champ(schemas, requete, jeton_champ.chemin)
    const traitement = champ.treatment ?? null
    const valeur     = lire_operande(jeton_valeur, contexte)
    const est_liste  = operateur === '-{' || operateur === '!-{'

    if (valeur === undefined)
        return constante(false)

    if (valeur !== null && typeof valeur === 'object' && !(valeur instanceof Date) && !(valeur instanceof RegExp) && !est_liste)
        throw new Error(`Condition invalide : valeur non scalaire comparée au champ "${champ.name}"`)

    // Les égalités à null restent en SQL quel que soit le traitement du champ
    if (valeur === null && (operateur === '=' || operateur === '!=' || operateur === '<>'))
        return feuille_sql(`${colonne} ${operateur === '=' ? 'IS NULL' : 'IS NOT NULL'}`)

    if (operateur === '~=')
    {
        if (!(valeur instanceof RegExp))
            throw new Error(`Condition invalide : expression rationnelle attendue après ~= pour le champ "${champ.name}"`)
        if (traitement === 'hashing' || traitement === 'deterministic_hashing')
            throw new Error(`Condition invalide : ~= impossible sur le champ haché "${champ.name}"`)
        if (!local)
            throw new Error(`Condition invalide : ~= impossible sur un champ de relation ("${jeton_champ.chemin}")`)
        return { type: 'js', champ, operateur, valeur }
    }

    if (traitement === 'hashing' || traitement === 'encryption')
    {
        if (!local)
            throw new Error(`Condition invalide : le champ "${jeton_champ.chemin}" est ${traitement === 'hashing' ? 'haché' : 'chiffré'} et ne peut pas être comparé à travers une relation`)
        if (traitement === 'hashing' && !['=', '!=', '<>', '-{', '!-{'].includes(operateur))
            throw new Error(`Condition invalide : seules les comparaisons d'égalité sont possibles sur le champ haché "${champ.name}"`)
        return { type: 'js', champ, operateur, valeur }
    }

    const preparer = (v) => traitement === 'deterministic_hashing' && v !== null ? hacher_hmac(v) : v

    if (est_liste)
    {
        const liste = vers_liste(valeur)
        const non_nulles = liste.filter(v => v !== null && v !== undefined).map(preparer)
        const avec_null = non_nulles.length !== liste.length
        const marques = non_nulles.map(() => '?').join(', ')

        if (operateur === '-{')
        {
            const morceaux = []
            if (non_nulles.length) morceaux.push(`${colonne} IN (${marques})`)
            if (avec_null)         morceaux.push(`${colonne} IS NULL`)
            if (!morceaux.length)  return constante(false)
            return feuille_sql(morceaux.length > 1 ? `(${morceaux.join(' OR ')})` : morceaux[0], non_nulles, !avec_null)
        }

        const morceaux = []
        if (non_nulles.length) morceaux.push(`${colonne} NOT IN (${marques})`)
        if (!avec_null)        morceaux.push(`${colonne} IS NULL`)
        if (!non_nulles.length) return avec_null ? feuille_sql(`${colonne} IS NOT NULL`) : constante(true)
        return feuille_sql(avec_null ? morceaux[0] : `(${morceaux.join(' OR ')})`, non_nulles, avec_null)
    }

    if (traitement === 'deterministic_hashing' && !['=', '!=', '<>'].includes(operateur))
        throw new Error(`Condition invalide : seules les comparaisons d'égalité sont possibles sur le champ haché "${champ.name}"`)

    if (operateur === '=')
        return feuille_sql(`${colonne} = ?`, [preparer(valeur)], true)

    if (operateur === '!=' || operateur === '<>')
        return feuille_sql(`NOT (${colonne} <=> ?)`, [preparer(valeur)])

    if (valeur === null)
        return constante(false)

    if (jeton_valeur.type === 'now')
        return feuille_sql(`${colonne} ${operateur} ${traduire_now_sql(jeton_valeur.expression)}`, [], true)

    return feuille_sql(`${colonne} ${operateur} ?`, [valeur], true)
}

const compiler_noeud = (schemas, requete, noeud, contexte) =>
{
    switch (noeud.type)
    {
        case 'ou':
        case 'et':
            return { type: noeud.type, enfants: noeud.enfants.map(e => compiler_noeud(schemas, requete, e, contexte)) }

        case 'non':
            return { type: 'non', enfant: compiler_noeud(schemas, requete, noeud.enfant, contexte) }

        case 'seul':
        {
            // `#champ` seul équivaut à `#champ = true`
            if (noeud.operande.type === 'champ')
                return compiler_comparaison_champ(schemas, requete, noeud.operande, '=', { type: 'valeur', valeur: true }, contexte)
            const valeur = lire_operande(noeud.operande, contexte)
            return constante(valeur !== null && valeur !== undefined && valeur !== false && valeur !== 0 && valeur !== '')
        }

        case 'comparaison':
        {
            let { gauche, droite, operateur } = noeud

            if (gauche.type === 'champ' && droite.type === 'champ')
            {
                const a = resoudre_champ(schemas, requete, gauche.chemin)
                const b = resoudre_champ(schemas, requete, droite.chemin)
                if (a.champ.treatment || b.champ.treatment || operateur === '~=' || operateur === '-{' || operateur === '!-{')
                    throw new Error(`Condition invalide : comparaison "${operateur}" impossible entre "${gauche.chemin}" et "${droite.chemin}"`)
                if (operateur === '!=' || operateur === '<>')
                    return feuille_sql(`NOT (${a.colonne} <=> ${b.colonne})`)
                return feuille_sql(`${a.colonne} ${operateur} ${b.colonne}`, [], true)
            }

            if (droite.type === 'champ')
            {
                if (operateur === '-{' || operateur === '!-{' || operateur === '~=')
                    throw new Error(`Condition invalide : le champ "${droite.chemin}" doit se trouver à gauche de "${operateur}"`)
                ;[gauche, droite] = [droite, gauche]
                operateur = INVERSES[operateur] ?? operateur
            }

            if (gauche.type === 'champ')
                return compiler_comparaison_champ(schemas, requete, gauche, operateur, droite, contexte)

            return constante(comparer(operateur, lire_operande(gauche, contexte), lire_operande(droite, contexte)))
        }
    }

    throw new Error(`Condition invalide : nœud inconnu ${noeud.type}`)
}

// ─── Génération du WHERE ──────────────────────────────────────────────────────
// Retourne { sql, valeurs, exacte } ou une constante { constante: true|false, exacte }.
// Quand `exacte` est faux, le SQL produit est un sur-ensemble du résultat attendu.

const generer_sql = (noeud, nie = false) =>
{
    switch (noeud.type)
    {
        case 'constante':
            return { constante: noeud.valeur, exacte: true }

        case 'js':
            return { constante: true, exacte: false }

        case 'sql':
        {
            // Sous une négation, une comparaison qui vaut NULL doit compter comme fausse
            const sql = nie && noeud.nullable ? `(${noeud.sql}) IS TRUE` : noeud.sql
            return { sql, valeurs: noeud.valeurs, exacte: true }
        }

        case 'non':
        {
            const enfant = generer_sql(noeud.enfant, !nie)
            if (!enfant.exacte)
                return { constante: true, exacte: false }
            if ('constante' in enfant)
                return { constante: !enfant.constante, exacte: true }
            return { sql: `NOT (${enfant.sql})`, valeurs: enfant.valeurs, exacte: true }
        }

        case 'et':
        case 'ou':
        {
            const est_et  = noeud.type === 'et'
            const neutre  = est_et
            const parties = []
            let exacte    = true

            for (const enfant of noeud.enfants.map(e => generer_sql(e, nie)))
            {
                exacte = exacte && enfant.exacte
                if ('constante' in enfant)
                {
                    if (!enfant.exacte)
                    {
                        // Inconnu : neutre pour un ET (on élargit), absorbant pour un OU
                        if (!est_et)
                            return { constante: true, exacte: false }
                        continue
                    }
                    if (enfant.constante !== neutre)
                        return { constante: !neutre, exacte: true }
                    continue
                }
                parties.push(enfant)
            }

            if (!parties.length)
                return { constante: neutre, exacte }

            const sql = parties.length === 1
                ? parties[0].sql
                : parties.map(p => `(${p.sql})`).join(est_et ? ' AND ' : ' OR ')
            return { sql, valeurs: parties.flatMap(p => p.valeurs), exacte }
        }
    }
}

// ─── Évaluation exacte en JS ──────────────────────────────────────────────────

const lire_valeur_champ = (champ, ligne) =>
{
    const brute = ligne[champ.name]
    if (champ.treatment !== 'encryption' || !Buffer.isBuffer(brute))
        return brute
    try   { return dechiffrer_aes(brute) }
    catch { return null }
}

const evaluer_feuille_js = async (feuille, ligne) =>
{
    const { champ, operateur, valeur } = feuille

    if (champ.treatment === 'hashing')
    {
        const stockee = ligne[champ.name]
        const correspond = async (v) =>
            v !== null && v !== undefined
            && await verifier_argon2(stockee, String(v))

        if (operateur === '=')  return correspond(valeur)
        if (operateur === '!=' || operateur === '<>') return !(await correspond(valeur))

        let trouve = false
        for (const v of vers_liste(valeur))
        {
            if (v === null ? (stockee === null || stockee === undefined) : await correspond(v))
            {
                trouve = true
                break
            }
        }
        return operateur === '-{' ? trouve : !trouve
    }

    return comparer(operateur, lire_valeur_champ(champ, ligne), valeur)
}

const evaluer_arbre = async (noeud, ligne) =>
{
    switch (noeud.type)
    {
        case 'constante': return noeud.valeur
        case 'sql':       return Number(ligne[noeud.colonne_test]) === 1
        case 'js':        return evaluer_feuille_js(noeud, ligne)
        case 'non':       return !(await evaluer_arbre(noeud.enfant, ligne))
        case 'et':
            for (const enfant of noeud.enfants)
                if (!await evaluer_arbre(enfant, ligne)) return false
            return true
        case 'ou':
            for (const enfant of noeud.enfants)
                if (await evaluer_arbre(enfant, ligne)) return true
            return false
    }
    return false
}

const lister_feuilles_sql = (noeud, liste = []) =>
{
    if (noeud.type === 'sql') liste.push(noeud)
    if (noeud.type === 'non') lister_feuilles_sql(noeud.enfant, liste)
    if (noeud.type === 'et' || noeud.type === 'ou') noeud.enfants.forEach(e => lister_feuilles_sql(e, liste))
    return liste
}

// ─── Points d'entrée ──────────────────────────────────────────────────────────

export const compiler_condition = (schemas, requete, condition, contexte = {}) =>
{
    if (typeof condition !== 'string' || !condition.trim())
        throw new Error('Condition invalide : utilisez une expression sous forme de chaîne')

    const arbre = compiler_noeud(schemas, requete, analyser(decouper(condition)), contexte)
    return { arbre, ...generer_sql(arbre) }
}

const clef_ligne = (modele, ligne) =>
    modele.primary?.length
        ? JSON.stringify(modele.primary.map(c => vers_comparable(ligne[c])))
        : JSON.stringify(Object.values(ligne).map(vers_comparable))

// Préparer la lecture des lignes d'un modèle respectant une condition.
// `colonnes_aux` : { nom_colonne: condition } — colonnes booléennes ajoutées au résultat
// (utilisées par restrict_search pour autoriser un champ ligne par ligne).
export const preparer_lecture = (schemas, modele, condition, contexte = {}, colonnes_aux = {}) =>
{
    const requete    = creer_requete(modele)
    const principale = compiler_condition(schemas, requete, condition, contexte)

    const colonnes = []
    const valeurs_colonnes = []
    const noms_aux = []

    for (const [nom, condition_aux] of Object.entries(colonnes_aux))
    {
        const aux = compiler_condition(schemas, requete, condition_aux, contexte)
        if (!aux.exacte)
            throw new Error(`Condition "${nom}" invalide : elle doit pouvoir être entièrement traduite en SQL`)
        const sql = 'constante' in aux ? (aux.constante ? '1' : '0') : aux.sql
        colonnes.push(`CASE WHEN ${sql} THEN 1 ELSE 0 END AS \`${nom}\``)
        valeurs_colonnes.push(...(aux.valeurs ?? []))
        noms_aux.push(nom)
    }

    // Condition non entièrement traduisible : chaque comparaison SQL devient une
    // colonne de test, et l'arbre complet est réévalué en JS sur chaque ligne.
    const colonnes_test = []
    if (!principale.exacte)
    {
        lister_feuilles_sql(principale.arbre).forEach((feuille, i) =>
        {
            feuille.colonne_test = `__test_${i}`
            colonnes.push(`CASE WHEN ${feuille.sql} THEN 1 ELSE 0 END AS \`${feuille.colonne_test}\``)
            valeurs_colonnes.push(...feuille.valeurs)
            colonnes_test.push(feuille.colonne_test)
        })
    }

    let where = ''
    let valeurs_where = []
    if ('constante' in principale)
        where = principale.constante ? '' : ' WHERE 0'
    else
    {
        where = ` WHERE ${principale.sql}`
        valeurs_where = principale.valeurs
    }

    const select = [`\`${modele.name}\`.*`, ...colonnes].join(', ')
    const jointures = requete.sql_jointures.length ? ` ${requete.sql_jointures.join(' ')}` : ''
    const distinct = requete.sql_jointures.length ? 'DISTINCT ' : ''

    const filtrer = async (lignes) =>
    {
        const retenues = new Map()
        for (const ligne of lignes)
        {
            if (!principale.exacte && !await evaluer_arbre(principale.arbre, ligne))
                continue

            const clef = clef_ligne(modele, ligne)
            const deja = retenues.get(clef)
            if (deja)
            {
                // Plusieurs lignes jointes pour la même entrée : une autorisation suffit
                for (const nom of noms_aux)
                    deja[nom] = Number(deja[nom]) === 1 || Number(ligne[nom]) === 1 ? 1 : 0
                continue
            }

            for (const nom of colonnes_test)
                delete ligne[nom]
            retenues.set(clef, ligne)
        }
        return [...retenues.values()]
    }

    return {
        sql     : `SELECT ${distinct}${select} FROM \`${modele.name}\`${jointures}${where}`,
        valeurs : [...valeurs_colonnes, ...valeurs_where],
        exacte  : principale.exacte,
        filtrer
    }
}
