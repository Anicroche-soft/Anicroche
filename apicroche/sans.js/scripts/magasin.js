import mysql  from 'mysql2/promise'
import crypto from 'node:crypto'

import { hacher_hmac, hacher_argon2, chiffrer_aes, dechiffrer_aes } from './crypto.js'
import { evaluer, ERREUR as ERREUR_AUGURE } from './augure.js'
import { trouver_table, resoudre_relation as resoudre_projection_relation, preparer_lecture, traduire_now_sql } from './traducteur.js'
import { lire_tri, tri_par_defaut, tri_en_sql, clause_tri, comparable, comparer_lignes } from './tri.js'

// Les requêtes contiennent des données personnelles : elles ne sont journalisées qu'en dev
const mode_dev = (process.env.mode || 'prod') === 'dev'

// ─── Pool de connexions ───────────────────────────────────────────────────────

let _pool = null

const pool = () =>
{
    if (_pool) return _pool

    const host = process.env.database_host || 'localhost'
    const port = parseInt(process.env.database_port || '3306')
    const name = process.env.database_name
    const user = process.env.database_user
    const pass = process.env.database_pass || ''

    if (!name || !user)
        throw new Error("Variables d'environnement manquantes : database_name, database_user")

    // Tout en UTC, quels que soient les fuseaux du serveur MySQL et de la machine : la
    // session pour NOW() et les valeurs par défaut, le pilote pour lire et écrire les dates
    _pool = mysql.createPool({ host, port, user, password: pass, database: name, timezone: 'Z' })
    _pool.on('connection', (connexion) => connexion.query(`SET time_zone = '+00:00'`))
    return _pool
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

const trouver_pk = (table) =>
{
    if (!table || !Array.isArray(table.primary) || table.primary.length === 0)
        return null

    const nom_pk = table.primary[0]
    return table.fields.find(f => f.name === nom_pk) ?? null
}

// Modèle de la table de jonction d'une relation N-N, décrit par l'analyseur
const construire_modele_jonction_auto = (schemas, relation) =>
    relation?.modele_jonction ?? null

const trouver_modele_table = (schemas, nom) =>
{
    const modele_explicit = schemas.tables.find(t => t.name === nom)
    if (modele_explicit)
        return modele_explicit

    const relation = (schemas.relations ?? []).find(r => r.table_jonction === nom)
    if (!relation)
        return null

    return construire_modele_jonction_auto(schemas, relation)
}

const trouver_modele_entree = (schemas, nom) =>
{
    const modele_explicit = schemas.tables.find(t => (t.entry_name ?? t.name) === nom)
    if (modele_explicit)
        return modele_explicit

    const relation = (schemas.relations ?? []).find(r => r.table_jonction_entry === nom)
    if (relation)
        return construire_modele_jonction_auto(schemas, relation)

    // Pour les jonctions auto N-N, on accepte le nom de table comme nom d'entrée.
    return trouver_modele_table(schemas, nom)
}

const trouver_champ = (modele, nom) =>
    modele.fields.find(f => f.name === nom) ?? null

// Générer un identifiant aléatoire alphanumérique
const CHARS_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const generer_id = (taille = 12, alphabet = CHARS_ID) =>
{
    const octets = crypto.randomBytes(taille)
    return Array.from(octets).map(b => alphabet[b % alphabet.length]).join('')
}

// Valeur qu'un champ absent d'une création recevra de la base (default littéral), pour que sa
// règle porte sur la valeur réellement enregistrée ; undefined pour un default calculé (auto,
// $autre_champ, déjà résolus avant la validation, ou now) ou sans default
export const default_litteral = (champ) =>
{
    const valeur = champ?.default
    if (valeur === undefined || valeur === null || valeur === '')
        return undefined
    if (typeof valeur === 'string'
     && (valeur === 'auto' || valeur.startsWith('$') || /^now(\s*\+\s*\d+[smhd])?$/.test(valeur)))
        return undefined
    return valeur
}

// Valider la valeur brute contre la rule (expression augure) du champ
// contexte : { '$nom_champ': valeur | ERREUR_AUGURE }
const valider_regle = (champ, contexte) =>
{
    if (!champ?.rule) return true

    // Un champ facultatif sans valeur n'a pas de règle à respecter
    const valeur = contexte[`$${champ.name}`]
    if (champ.nullable && (valeur === null || valeur === undefined || valeur === ERREUR_AUGURE))
        return true

    return evaluer(champ.rule, contexte)
}

// Appliquer le traitement crypto avant écriture en base
const traiter_ecriture = async (champ, valeur) =>
{
    if (valeur === null || valeur === undefined) return null
    switch (champ?.treatment)
    {
        case 'deterministic_hashing': return hacher_hmac(valeur)
        case 'hashing':               return await hacher_argon2(valeur)
        case 'encryption':            return chiffrer_aes(valeur)
        default:                      return valeur
    }
}

// Décrypter les champs AES d'une ligne (les hash sont irréversibles)
const decrypter_ligne = (modele, ligne) =>
{
    const res = { ...ligne }
    for (const champ of modele.fields)
    {
        if (champ.treatment === 'encryption' && Buffer.isBuffer(res[champ.name]))
        {
            try   { res[champ.name] = dechiffrer_aes(res[champ.name]) }
            catch { res[champ.name] = null }
        }
    }
    return res
}

// Lignes liées, rangées selon l'ordre par défaut de leur modèle
const lire_lignes_par_in = async (modele, champ, valeurs) =>
{
    if (!Array.isArray(valeurs) || !valeurs.length)
        return []

    const tri     = tri_par_defaut(modele)
    const en_sql  = tri_en_sql(tri)
    const clauses = valeurs.map(() => '?').join(', ')
    const [lignes] = await pool().query(
        `SELECT * FROM \`${modele.name}\` WHERE \`${champ}\` IN (${clauses})${en_sql ? clause_tri(modele.name, tri) : ''}`,
        valeurs
    )
    if (en_sql)
        return lignes

    const comparer = comparer_lignes(tri)
    return lignes
        .map(brute => ({ brute, ligne: decrypter_ligne(modele, brute) }))
        .sort((a, b) => comparer(a.ligne, b.ligne))
        .map(({ brute }) => brute)
}

const normaliser_projection_select = (select) =>
{
    if (typeof select === 'string')
    {
        return select
            .split(';')
            .map(v => v.trim())
            .filter(Boolean)
    }

    if (!Array.isArray(select) || select.length === 0)
        return []

    return select
        .filter(v => typeof v === 'string')
        .map(v => v.trim())
        .filter(Boolean)
}

const normaliser_token_projection = (token) =>
{
    if (typeof token !== 'string')
        return []

    return token
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
}

const indexer_lignes_par_clef = (lignes, clef) =>
{
    const index = new Map()
    for (const ligne of lignes)
    {
        const valeur = ligne[clef]
        if (valeur === undefined || valeur === null)
            continue

        if (!index.has(valeur))
            index.set(valeur, [])
        index.get(valeur).push(ligne)
    }
    return index
}

const construire_noeud_projection = (schemas, modele, select) =>
{
    const champs_physiques = new Set(modele.fields.map(f => f.name))
    const noeud = {
        allPhysical: false,
        fields: new Set(),
        relations: new Map()
    }

    if (!Array.isArray(select))
    {
        noeud.allPhysical = true
        return noeud
    }

    if (select.length === 0)
        return noeud

    const ajouter_relation = (token, relation, sens, select_enfant = null) =>
    {
        if (!noeud.relations.has(token))
        {
            noeud.relations.set(token, {
                relation,
                sens,
                select: select_enfant
            })
            return
        }

        const courant = noeud.relations.get(token)
        if (courant.select === null)
            courant.select = select_enfant
        else if (select_enfant)
            courant.select = [...new Set([...courant.select, ...select_enfant])]
    }

    const analyser_token = (token, select_enfant = null) =>
    {
        if (!token)
            return

        if (token === '*')
        {
            noeud.allPhysical = true
            return
        }

        if (champs_physiques.has(token))
        {
            noeud.fields.add(token)
            return
        }

        const projection_relation = resoudre_projection_relation(schemas, modele, token)
        if (!projection_relation)
            throw new Error(`Option select invalide : champ ou relation inconnue "${token}"`)

        ajouter_relation(token, projection_relation.relation, projection_relation.sens, select_enfant)
    }

    for (const brut of normaliser_projection_select(select))
    {
        const token = String(brut)
        
        if (token.includes('.') && !token.startsWith('*'))
        {
            const index_point = token.indexOf('.')
            const avant_point = token.slice(0, index_point)
            const suite = token.slice(index_point + 1).trim()
            
            const index_derniere_virgule = avant_point.lastIndexOf(',')
            
            let avant_virgule = ''
            let racine = avant_point.trim()
            
            if (index_derniere_virgule >= 0)
            {
                avant_virgule = avant_point.slice(0, index_derniere_virgule).trim()
                racine = avant_point.slice(index_derniere_virgule + 1).trim()
            }
            
            if (avant_virgule)
            {
                for (const sous_token of normaliser_token_projection(avant_virgule))
                    analyser_token(sous_token)
            }
            
            const projection_relation = resoudre_projection_relation(schemas, modele, racine)
            if (!projection_relation)
                throw new Error(`Option select invalide : champ ou relation inconnue "${racine}"`)

            const modele_enfant = projection_relation.sens === 'direct'
                ? trouver_table(schemas, projection_relation.relation.table_cible)
                : trouver_table(schemas, projection_relation.relation.table_source)

            if (!modele_enfant)
                throw new Error(`Option select invalide : relation introuvable "${racine}"`)

            const select_enfant = suite ? [suite] : []
            ajouter_relation(racine, projection_relation.relation, projection_relation.sens, select_enfant)
            continue
        }

        for (const sous_token of normaliser_token_projection(token))
            analyser_token(sous_token)
    }

    return noeud
}

const projeter_lignes_select = async (schemas, modele, lignes, select, contexte_enforce = null, fallback = null) =>
{
    const noeud = construire_noeud_projection(schemas, modele, select)
    const resultats = lignes.map(() => ({}))
    const champs_physiques = modele.fields.map(f => f.name)

    for (let i = 0; i < lignes.length; i++)
    {
        const ligne = lignes[i]
        if (noeud.allPhysical)
        {
            for (const champ of champs_physiques)
                resultats[i][champ] = ligne[champ]
        }
        else
        {
            for (const champ of noeud.fields)
                resultats[i][champ] = ligne[champ]
        }

        for (const [clef, valeur] of Object.entries(ligne))
        {
            if (typeof clef === 'string' && clef.startsWith('_can_'))
                resultats[i][clef] = valeur
        }
    }

    for (const [token, spec] of noeud.relations.entries())
    {
        const relation = spec.relation
        const sens = spec.sens
        const table_source = trouver_table(schemas, relation.table_source)
        const table_cible  = trouver_table(schemas, relation.table_cible)

        if (!table_source || !table_cible)
        {
            for (let i = 0; i < lignes.length; i++)
                resultats[i][token] = relation.table_jonction || relation.max === 'N' ? [] : null
            continue
        }

        const modele_enfant = sens === 'direct' ? table_cible : table_source

        if (contexte_enforce !== null)
        {
            const relation_meta = relation
            const est_direct = spec.sens === 'direct'

            let can
            let restrict

            if (est_direct)
            {
                can      = relation_meta?.can_search ?? null
                restrict = relation_meta?.restrict_search ?? null
            }
            else
            {
                can      = relation_meta?.rev_can_search ?? relation_meta?.can_search ?? null
                restrict = relation_meta?.rev_restrict_search ?? relation_meta?.restrict_search ?? null
            }

            if (can === null)
                throw Object.assign(
                    new Error(`Relation "${token}" non autorisée`),
                    { code: 'RELATION_FORBIDDEN' }
                )

            if (!evaluer(can, { $request: contexte_enforce.request, $context: contexte_enforce.context }))
                throw Object.assign(
                    new Error(`Relation "${token}" non autorisée`),
                    { code: 'RELATION_FORBIDDEN' }
                )

            if (modele_enfant.rules?.can_search != null)
            {
                if (!evaluer(modele_enfant.rules.can_search, { $request: contexte_enforce.request, $context: contexte_enforce.context }))
                    throw Object.assign(
                        new Error(`Accès refusé au modèle "${modele_enfant.name}"`),
                        { code: 'RELATION_FORBIDDEN' }
                    )
            }

            const restrictions = [
                restrict,
                modele_enfant.rules?.restrict_search ?? null
            ].filter(Boolean)

            if (restrictions.length)
                spec.restrict_conditions = restrictions
        }

        const projection_enfant = (rows) => rows.length ? projeter_lignes_select(schemas, modele_enfant, rows, spec.select, contexte_enforce, fallback) : []

        // Lignes liées : la condition passe par $search_all pour les restrictions et les replis
        const lire_liees = async (modele_lu, colonne, valeurs) =>
        {
            if (!valeurs.length)
                return []
            const avec_replis = fallback !== null && modele_lu.fields.some(champ => champ.fallback)
            if (!spec.restrict_conditions?.length && !avec_replis)
                return lire_lignes_par_in(modele_lu, colonne, valeurs)
            return creer_search_all(schemas)(
                modele_lu.name,
                [`#${colonne} -{ $__ids__`, ...(spec.restrict_conditions ?? [])].map(condition => `(${condition})`).join(' & '),
                { $__ids__: valeurs, $context: contexte_enforce?.context ?? {}, $request: contexte_enforce?.request ?? {} },
                { enforce_rules: contexte_enforce !== null, fallback }
            )
        }

        const pk_source = trouver_pk(table_source)
        const pk_cible = trouver_pk(table_cible)

        if (relation.table_jonction)
        {
            const jonction   = relation.modele_jonction
            const est_direct = sens === 'direct'
            const [cle_source, cle_cible] = jonction.primary
            // Colonne de la ligne courante et colonne visée chez l'enfant
            // (colonne_cible peut désigner un groupe de lignes : relation avec key)
            const cle_ligne   = est_direct ? relation.colonne_source : relation.colonne_cible
            const cle_enfant  = est_direct ? relation.colonne_cible  : relation.colonne_source
            const cle_lire    = est_direct ? cle_source : cle_cible
            const cle_assoc   = est_direct ? cle_cible  : cle_source
            const champs_sup  = jonction.champs_jonction ?? []

            // Les champs de la jonction cités dans select ne sont pas des champs de l'enfant
            const select_enfant = (spec.select ?? [])
                .map(morceau => normaliser_token_projection(morceau).filter(nom => !champs_sup.includes(nom)).join(', '))
                .filter(Boolean)
            const projeter_enfant_sans_jonction = (rows) =>
                rows.length ? projeter_lignes_select(schemas, modele_enfant, rows, select_enfant, contexte_enforce, fallback) : []
            const ids_lignes  = [...new Set(lignes.map(ligne => ligne[cle_ligne]).filter(v => v !== undefined && v !== null))]

            if (!ids_lignes.length)
            {
                for (let i = 0; i < lignes.length; i++)
                    resultats[i][token] = []
                continue
            }

            const colonnes_lues = [cle_lire, cle_assoc, ...champs_sup].map(c => `\`${c}\``).join(', ')
            const placeholders  = ids_lignes.map(() => '?').join(', ')
            const [jonctions] = await pool().query(
                `SELECT ${colonnes_lues} FROM \`${relation.table_jonction}\` WHERE \`${cle_lire}\` IN (${placeholders})`,
                ids_lignes
            )

            const liens_par_ligne = indexer_lignes_par_clef(jonctions, cle_lire)
            const ids_relatifs    = [...new Set(jonctions.map(ligne => ligne[cle_assoc]).filter(v => v !== undefined && v !== null))]

            const lignes_relatives = await lire_liees(modele_enfant, cle_enfant, ids_relatifs)
            // Plusieurs lignes par clef quand la relation vise un groupe
            const relatives = lignes_relatives.map(ligne_rel => decrypter_ligne(modele_enfant, ligne_rel))

            // Les entrées liées gardent l'ordre de leur modèle, pas celui de la jonction
            for (let i = 0; i < lignes.length; i++)
            {
                const liens = new Map()
                for (const lien of liens_par_ligne.get(lignes[i][cle_ligne]) ?? [])
                    if (lien[cle_assoc] !== undefined && lien[cle_assoc] !== null && !liens.has(lien[cle_assoc]))
                        liens.set(lien[cle_assoc], lien)

                const entrees = relatives
                    .filter(ligne_rel => liens.has(ligne_rel[cle_enfant]))
                    .map(ligne_rel => ({ ligne: ligne_rel, lien: liens.get(ligne_rel[cle_enfant]) }))

                const valeurs = spec.select
                    ? await projeter_enfant_sans_jonction(entrees.map(e => e.ligne))
                    : entrees.map(e => ({ ...e.ligne }))

                // Les champs de la jonction (fields) sont ajoutés à chaque entrée liée
                if (champs_sup.length)
                    valeurs.forEach((valeur, k) =>
                    {
                        for (const champ of champs_sup)
                            valeur[champ] = entrees[k].lien[champ]
                    })

                resultats[i][token] = valeurs
            }

            continue
        }

        if (relation.cle_etrangere)
        {
            if (sens === 'direct')
            {
                const cle_source = pk_source?.name
                const ids_lignes = [...new Set(lignes.map(ligne => ligne[cle_source]).filter(v => v !== undefined && v !== null))]
                if (!ids_lignes.length)
                {
                    for (let i = 0; i < lignes.length; i++)
                        resultats[i][token] = []
                    continue
                }

                const rows_directe = await lire_liees(table_cible, relation.cle_etrangere, ids_lignes)
                const index_rows = indexer_lignes_par_clef(rows_directe, relation.cle_etrangere)

                for (let i = 0; i < lignes.length; i++)
                {
                    const id_ligne = lignes[i][cle_source]
                    const lignes_rel = (index_rows.get(id_ligne) ?? []).map(ligne_rel => decrypter_ligne(table_cible, ligne_rel))
                    resultats[i][token] = spec.select ? await projection_enfant(lignes_rel) : lignes_rel
                }

                continue
            }

            const cle_fk = relation.cle_etrangere
            const valeurs_fk = [...new Set(lignes.map(ligne => ligne[cle_fk]).filter(v => v !== undefined && v !== null))]

            if (!valeurs_fk.length)
            {
                for (let i = 0; i < lignes.length; i++)
                    resultats[i][token] = null
                continue
            }

            const rows_inverse = await lire_liees(table_source, pk_source.name, valeurs_fk)
            const map_rows = new Map(rows_inverse.map(ligne_rel => [ligne_rel[pk_source.name], decrypter_ligne(table_source, ligne_rel)]))

            for (let i = 0; i < lignes.length; i++)
            {
                const valeur_fk = lignes[i][cle_fk]
                const ligne_rel = map_rows.get(valeur_fk) ?? null
                if (!ligne_rel)
                {
                    resultats[i][token] = null
                    continue
                }

                resultats[i][token] = spec.select ? (await projection_enfant([ligne_rel]))[0] ?? null : ligne_rel
            }

            continue
        }

        if (relation.cle_locale)
        {
            // Relation 0-1 / 1-1 : la clef étrangère est portée par la table source
            const cle_locale = relation.cle_locale
            const pk_cible_nom = pk_cible?.name

            if (sens === 'direct')
            {
                const valeurs_fk = [...new Set(lignes.map(ligne => ligne[cle_locale]).filter(v => v !== undefined && v !== null))]
                const rows = await lire_liees(table_cible, pk_cible_nom, valeurs_fk)
                const map_rows = new Map(rows.map(ligne_rel => [ligne_rel[pk_cible_nom], decrypter_ligne(table_cible, ligne_rel)]))

                for (let i = 0; i < lignes.length; i++)
                {
                    const ligne_rel = map_rows.get(lignes[i][cle_locale]) ?? null
                    resultats[i][token] = ligne_rel && spec.select ? (await projection_enfant([ligne_rel]))[0] ?? null : ligne_rel
                }
                continue
            }

            // Sens inverse : toutes les entrées source qui pointent vers chaque ligne
            const ids_lignes = [...new Set(lignes.map(ligne => ligne[pk_cible_nom]).filter(v => v !== undefined && v !== null))]
            const rows = await lire_liees(table_source, cle_locale, ids_lignes)
            const index_rows = indexer_lignes_par_clef(rows, cle_locale)

            for (let i = 0; i < lignes.length; i++)
            {
                const lignes_rel = (index_rows.get(lignes[i][pk_cible_nom]) ?? []).map(ligne_rel => decrypter_ligne(table_source, ligne_rel))
                resultats[i][token] = spec.select ? await projection_enfant(lignes_rel) : lignes_rel
            }
            continue
        }

        for (let i = 0; i < lignes.length; i++)
            resultats[i][token] = relation.max === 'N' ? [] : null
    }

    return resultats
}

const normaliser_condition = (condition) =>
{
    if (condition === null || condition === undefined)
        throw new Error('Condition requise : utilisez une expression Augure sous forme de chaîne')

    if (typeof condition !== 'string' || !condition.trim())
        throw new Error('Condition invalide : utilisez une expression Augure sous forme de chaîne')

    return condition.trim()
}

const normaliser_contexte_condition = (contexte) =>
{
    if (contexte === null || contexte === undefined)
        return {}

    if (typeof contexte !== 'object' || Array.isArray(contexte))
        throw new Error('Contexte invalide : utilisez un objet de variables Augure')

    return contexte
}

const normaliser_donnees_update = (donnees) =>
{
    if (donnees === null || donnees === undefined)
        throw new Error('Données de mise à jour requises : utilisez un objet { champ: valeur }')

    if (typeof donnees !== 'object' || Array.isArray(donnees))
        throw new Error('Données de mise à jour invalides : utilisez un objet { champ: valeur }')

    if (!Object.keys(donnees).length)
        throw new Error('Données de mise à jour vides : fournissez au moins un champ')

    return donnees
}

const normaliser_options_liste = (modele, options) =>
{
    if (options === null || options === undefined)
        options = {}

    if (typeof options !== 'object' || Array.isArray(options))
        throw new Error('Options invalides : utilisez un objet { order, limit, offset, select, aux_conditions, enforce_rules, fallback }')

    const champs_modele = new Set(modele.fields.map(f => f.name))

    if (options.dir !== undefined)
        throw new Error('Option dir supprimée : le sens se donne dans order, [[champ, increasing | decreasing], …]')

    const order = options.order === undefined || options.order === null
        ? tri_par_defaut(modele)
        : lire_tri(modele.fields, options.order, 'Option order')

    const limit = options.limit
    if (limit !== undefined && limit !== null && (!Number.isInteger(limit) || limit < 0))
        throw new Error('Option limit invalide : utilisez un entier >= 0')

    const offset = options.offset ?? 0
    if (!Number.isInteger(offset) || offset < 0)
        throw new Error('Option offset invalide : utilisez un entier >= 0')

    let select = options.select
    if (select === undefined || select === null)
    {
        select = [...champs_modele]
    }
    else
    {
        if (typeof select !== 'string')
            throw new Error('Option select invalide : utilisez une chaîne de noms de champs séparés par des ";"')

        select = select
            .split(';')
            .map(s => s.trim())
            .filter(Boolean)

        if (select.length === 0)
            select = []
    }

    let aux_conditions = options.aux_conditions ?? {}
    if (aux_conditions === null)
        aux_conditions = {}
    if (typeof aux_conditions !== 'object' || Array.isArray(aux_conditions))
        throw new Error('Option aux_conditions invalide : utilisez un objet { cle: condition }')

    const aux_conditions_norm = {}
    for (const [cle, valeur] of Object.entries(aux_conditions))
    {
        if (typeof cle !== 'string' || !cle.trim())
            continue
        if (typeof valeur !== 'string' || !valeur.trim())
            continue
        aux_conditions_norm[cle.trim()] = valeur.trim()
    }

    const enforce_rules = options.enforce_rules === true

    const fallback = options.fallback ?? null
    if (fallback !== null && (typeof fallback !== 'object' || Array.isArray(fallback)))
        throw new Error('Option fallback invalide : utilisez un objet { champ: valeur }')

    return {
        order,
        limit : limit ?? null,
        offset,
        select,
        aux_conditions: aux_conditions_norm,
        enforce_rules,
        fallback
    }
}

// ─── Journal SQL ──────────────────────────────────────────────────────────────

const formater_valeur_sql_debug = (valeur) =>
{
    if (valeur === null || valeur === undefined)
        return 'NULL'

    if (valeur instanceof Date)
        return `'${valeur.toISOString().replace('T', ' ').replace('Z', '')}'`

    if (Array.isArray(valeur))
        return `(${valeur.map(formater_valeur_sql_debug).join(', ')})`

    if (typeof valeur === 'number' || typeof valeur === 'bigint')
        return String(valeur)

    if (typeof valeur === 'boolean')
        return valeur ? '1' : '0'

    return `'${String(valeur).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

const rendre_requete_sql_debug = (requete, valeurs = []) =>
{
    let index = 0
    return requete.replace(/\?/g, () => {
        if (index >= valeurs.length)
            return '?'

        return formater_valeur_sql_debug(valeurs[index++])
    })
}

// ─── Lecture des lignes respectant une condition ──────────────────────────────
// Retourne les lignes brutes (non déchiffrées), une seule fois par entrée.

const lire_lignes = async (schemas, modele, condition, contexte_condition, etiquette, colonnes_aux = {}, colonnes_valeurs = {}, rangement = {}) =>
{
    const lecture = preparer_lecture(
        schemas,
        modele,
        normaliser_condition(condition),
        normaliser_contexte_condition(contexte_condition),
        colonnes_aux,
        colonnes_valeurs,
        rangement
    )

    if (mode_dev)
        console.log(`[${etiquette}] SQL:`, rendre_requete_sql_debug(lecture.sql, lecture.valeurs))
    const [lignes] = await pool().query(lecture.sql, lecture.valeurs)
    const retenues = await lecture.filtrer(lignes)
    retenues.limite_appliquee = lecture.limite_appliquee
    return retenues
}

// Entrées d'une recherche ({ brute, ligne } : ligne brute et ligne déchiffrée), résolues par
// les replis, rangées et découpées. Le tri, la limite et le décalage sont faits en SQL, sauf
// pour un tri sur un champ chiffré (comparable seulement une fois déchiffré) ; la limite et le
// décalage le sont aussi en JS quand des lignes sont écartées après la lecture (condition
// vérifiée ligne par ligne, replis)
const lire_entrees = async (schemas, modele, condition, contexte_condition, etiquette, options_norm, colonnes_aux = {}) =>
{
    const replis = preparer_replis(modele, options_norm.fallback)
    const en_sql = tri_en_sql(options_norm.order)

    const lignes = await lire_lignes(schemas, modele, condition, contexte_condition, etiquette, colonnes_aux, replis?.colonnes_valeurs, {
        tri    : en_sql ? options_norm.order : [],
        limite : en_sql && !replis ? { limit: options_norm.limit, offset: options_norm.offset } : null
    })

    let entrees = lignes.map(brute => ({ brute, ligne: decrypter_ligne(modele, brute) }))

    if (replis)
    {
        const par_ligne = new Map(entrees.map(entree => [entree.ligne, entree]))
        entrees = appliquer_replis(modele, replis, entrees.map(entree => entree.ligne)).map(ligne => par_ligne.get(ligne))
    }

    // Les replis gardent la place de la première entrée de chaque groupe : l'ordre est refait
    if (!en_sql || replis)
    {
        const comparer = comparer_lignes(options_norm.order)
        entrees.sort((a, b) => comparer(a.ligne, b.ligne))
    }

    if (!lignes.limite_appliquee)
    {
        if (options_norm.offset > 0)
            entrees = entrees.slice(options_norm.offset)
        if (options_norm.limit !== null)
            entrees = entrees.slice(0, options_norm.limit)
    }

    return entrees
}

// ─── Validation des valeurs ───────────────────────────────────────────────────

const longueur_texte = (valeur) => [...String(valeur)].length

// Vérifier une valeur brute (avant hachage ou chiffrement) contre l'énumération
// et la taille déclarées du champ.
const verifier_valeur_champ = (champ, valeur, index = 0) =>
{
    if (valeur === undefined || valeur === null)
        return

    if (champ.values && !champ.values.includes(String(valeur)))
        throw Object.assign(
            new Error(`Valeur "${valeur}" non autorisée pour le champ "${champ.name}" (valeurs : ${champ.values.join(', ')})`),
            { code: 'ENUM_VIOLATION', champ: champ.name, index }
        )

    const taille = champ.size
    if (!taille || (typeof valeur !== 'string' && typeof valeur !== 'number'))
        return

    const longueur = longueur_texte(valeur)
    if (taille.min !== null && longueur < taille.min)
        throw Object.assign(
            new Error(`Valeur trop courte pour le champ "${champ.name}" (${taille.min} caractère${taille.min > 1 ? 's' : ''} au minimum)`),
            { code: 'SIZE_VIOLATION', champ: champ.name, index }
        )

    // La taille maximale d'un champ haché ou chiffré porte sur la valeur stockée,
    // pas sur la valeur brute : elle n'est vérifiée que pour les champs non traités.
    if (!champ.treatment && taille.max !== null && longueur > taille.max)
        throw Object.assign(
            new Error(`Valeur trop longue pour le champ "${champ.name}" (${taille.max} caractère${taille.max > 1 ? 's' : ''} au maximum)`),
            { code: 'SIZE_VIOLATION', champ: champ.name, index }
        )
}

// ─── Construction du SET d'une mise à jour ────────────────────────────────────

// Valeur de mise à jour calculée par la base : `now`, `now + 1d`, `champ + 1`
const est_expression_update = (modele, valeur) =>
    typeof valeur === 'string'
    && (traduire_now_sql(valeur) !== null || /^\s*(\w+)\s*([+-])\s*(\d+(?:\.\d+)?)\s*$/.test(valeur) && trouver_champ(modele, valeur.trim().split(/\s*[+-]/)[0]))

const construire_set_update = async (modele, donnees) =>
{
    const morceaux = []
    const valeurs  = []

    for (const [nom_champ, valeur_brute] of Object.entries(donnees))
    {
        const champ = trouver_champ(modele, nom_champ)
        if (!champ)
            throw new Error(`Champ de mise à jour inconnu : ${nom_champ}`)

        if (typeof valeur_brute === 'string')
        {
            const valeur_now_sql = traduire_now_sql(valeur_brute)
            if (valeur_now_sql)
            {
                morceaux.push(`\`${nom_champ}\` = ${valeur_now_sql}`)
                continue
            }

            const expression = valeur_brute.match(/^\s*(\w+)\s*([+-])\s*(\d+(?:\.\d+)?)\s*$/)
            if (expression && trouver_champ(modele, expression[1]))
            {
                const champ_source_nom = expression[1]
                const operateur        = expression[2]
                const delta            = Number(expression[3])
                const champ_source     = trouver_champ(modele, champ_source_nom)

                if (champ.treatment || champ_source.treatment)
                    throw new Error(`Expression arithmétique non autorisée pour un champ traité : ${nom_champ}`)

                morceaux.push(`\`${nom_champ}\` = \`${champ_source_nom}\` ${operateur} ?`)
                valeurs.push(delta)
                continue
            }
        }

        morceaux.push(`\`${nom_champ}\` = ?`)
        valeurs.push(await traiter_ecriture(champ, valeur_brute))
    }

    return {
        clause : 'SET ' + morceaux.join(', '),
        valeurs
    }
}

// Valider les données d'une mise à jour pour une ligne existante :
// énumération et taille des valeurs fournies, puis règles des champs modifiés.
// Le contexte des règles contient les nouvelles valeurs et les valeurs actuelles
// déchiffrées ; les champs hachés non modifiés valent :x.
const valider_update = (modele, ligne_brute, donnees) =>
{
    for (const [nom, valeur] of Object.entries(donnees))
    {
        const champ = trouver_champ(modele, nom)
        if (champ && !est_expression_update(modele, valeur))
            verifier_valeur_champ(champ, valeur)
    }

    const ligne = decrypter_ligne(modele, ligne_brute)
    const contexte = {}
    for (const champ of modele.fields)
    {
        if (Object.prototype.hasOwnProperty.call(donnees, champ.name) && !est_expression_update(modele, donnees[champ.name]))
            contexte[`$${champ.name}`] = donnees[champ.name] ?? ERREUR_AUGURE
        else if (champ.treatment === 'hashing' || champ.treatment === 'deterministic_hashing')
            contexte[`$${champ.name}`] = ERREUR_AUGURE
        else
            contexte[`$${champ.name}`] = ligne[champ.name] ?? ERREUR_AUGURE
    }

    for (const nom of Object.keys(donnees))
    {
        const champ = trouver_champ(modele, nom)
        if (!champ || est_expression_update(modele, donnees[nom]))
            continue
        if (!valider_regle(champ, contexte))
            throw Object.assign(
                new Error(`Valeur invalide pour le champ "${champ.name}"`),
                { code: 'RULE_VIOLATION', champ: champ.name }
            )
    }
}

const mettre_a_jour_lignes = async (modele, lignes, donnees) =>
{
    for (const ligne of lignes)
        valider_update(modele, ligne, donnees)

    const champ = champ_ordre(modele)
    if (champ && Object.prototype.hasOwnProperty.call(donnees, champ.name))
    {
        if (est_expression_update(modele, donnees[champ.name]))
            throw erreur_ordre(champ, `Position invalide pour le champ "${champ.name}"`)
        if (champ.group.some(nom => Object.prototype.hasOwnProperty.call(donnees, nom)))
            throw erreur_ordre(champ, `Le groupe d'une entrée ordonnée ne peut pas changer en même temps que sa position`)
        if (lignes.length > 1)
            throw erreur_ordre(champ, `Une position ne se modifie que pour une entrée à la fois`)

        const { [champ.name]: valeur, ...autres } = donnees
        const cible = lire_position(champ, valeur)

        await deplacer_position(modele, champ, lignes[0], cible)
        lignes  = [{ ...lignes[0], [champ.name]: cible }]
        donnees = autres

        if (!Object.keys(donnees).length)
            return 1
    }

    const { clause: set_clause, valeurs: set_valeurs } = await construire_set_update(modele, donnees)
    const clause_pk = modele.primary.map(c => `\`${c}\` = ?`).join(' AND ')
    let mises_a_jour = 0

    for (const ligne of lignes)
    {
        const [resultat] = await pool().query(
            `UPDATE \`${modele.name}\` ${set_clause} WHERE ${clause_pk}`,
            [...set_valeurs, ...modele.primary.map(c => ligne[c])]
        )
        mises_a_jour += Number(resultat?.affectedRows || 0)
    }

    return mises_a_jour
}

// Supprimer une ligne par sa clef primaire
const supprimer_par_pk = async (modele, ligne) =>
{
    const clause  = modele.primary.map(c => `\`${c}\` = ?`).join(' AND ')
    const valeurs = modele.primary.map(c => ligne[c])
    await pool().query(`DELETE FROM \`${modele.name}\` WHERE ${clause}`, valeurs)
}

// ─── Champs de type order ────────────────────────────────────────────────────
// Les positions d'un groupe (champ.group : le reste de la clef primaire, sans les variantes)
// vont de 1 au nombre d'entrées, sans trou ; toutes les variantes d'une entrée partagent
// sa position.

const champ_ordre = (modele) => modele.fields.find(champ => champ.order) ?? null

const erreur_ordre = (champ, message) => Object.assign(new Error(message), { code: 'ORDER_VIOLATION', champ: champ.name })

const clef_groupe = (champ, ligne) => JSON.stringify(champ.group.map(nom => ligne[nom] ?? null))

const condition_groupe = (champ, ligne) => ({
    clause : champ.group.length ? champ.group.map(nom => `\`${nom}\` = ?`).join(' AND ') : '1 = 1',
    valeurs: champ.group.map(nom => ligne[nom])
})

const compter_positions = async (executeur, modele, champ, ligne) =>
{
    const { clause, valeurs } = condition_groupe(champ, ligne)
    const [rows] = await executeur.query(
        `SELECT MAX(\`${champ.name}\`) AS nombre FROM \`${modele.name}\` WHERE ${clause}`,
        valeurs
    )
    return Number(rows[0]?.nombre ?? 0)
}

const lire_position = (champ, valeur) =>
{
    const position = typeof valeur === 'string' && /^\d+$/.test(valeur) ? Number(valeur) : valeur
    if (!Number.isInteger(position))
        throw erreur_ordre(champ, `Position invalide pour le champ "${champ.name}"`)
    return position
}

// Sans position, une nouvelle entrée prend la suivante ; une position existante ajoute une
// variante de l'entrée qui l'occupe
const attribuer_positions = async (modele, insertions) =>
{
    const champ = champ_ordre(modele)
    if (!champ)
        return

    const suivantes = new Map()
    for (const insertion of insertions)
    {
        const clef = clef_groupe(champ, insertion)
        if (!suivantes.has(clef))
            suivantes.set(clef, await compter_positions(pool(), modele, champ, insertion) + 1)
        const suivante = suivantes.get(clef)

        const valeur = insertion[champ.name]
        if (valeur === undefined || valeur === null || valeur === '')
        {
            insertion[champ.name] = suivante
            suivantes.set(clef, suivante + 1)
            continue
        }

        const position = lire_position(champ, valeur)
        if (position < 1 || position > suivante)
            throw erreur_ordre(champ, `Position hors limites pour le champ "${champ.name}" (de 1 à ${suivante})`)

        insertion[champ.name] = position
        if (position === suivante)
            suivantes.set(clef, suivante + 1)
    }
}

// Déplace une entrée et toutes ses variantes ; les entrées entre les deux positions se décalent.
// La position 0, jamais attribuée, sert de place temporaire pour ne pas heurter la clef primaire
const deplacer_position = async (modele, champ, ligne, cible) =>
{
    const connexion = await pool().getConnection()
    try
    {
        await connexion.beginTransaction()

        const nombre = await compter_positions(connexion, modele, champ, ligne)
        if (cible < 1 || cible > nombre)
        {
            await connexion.rollback()
            throw erreur_ordre(champ, `Position hors limites pour le champ "${champ.name}" (de 1 à ${nombre})`)
        }

        const actuelle = Number(ligne[champ.name])
        if (actuelle !== cible)
        {
            const { clause, valeurs } = condition_groupe(champ, ligne)
            const table   = `\`${modele.name}\``
            const colonne = `\`${champ.name}\``

            await connexion.query(`UPDATE ${table} SET ${colonne} = 0 WHERE ${clause} AND ${colonne} = ?`, [...valeurs, actuelle])
            if (actuelle < cible)
                await connexion.query(
                    `UPDATE ${table} SET ${colonne} = ${colonne} - 1 WHERE ${clause} AND ${colonne} > ? AND ${colonne} <= ? ORDER BY ${colonne} ASC`,
                    [...valeurs, actuelle, cible]
                )
            else
                await connexion.query(
                    `UPDATE ${table} SET ${colonne} = ${colonne} + 1 WHERE ${clause} AND ${colonne} >= ? AND ${colonne} < ? ORDER BY ${colonne} DESC`,
                    [...valeurs, cible, actuelle]
                )
            await connexion.query(`UPDATE ${table} SET ${colonne} = ? WHERE ${clause} AND ${colonne} = 0`, [cible, ...valeurs])
        }

        await connexion.commit()
    }
    catch (erreur)
    {
        await connexion.rollback().catch(() => {})
        throw erreur
    }
    finally
    {
        connexion.release()
    }
}

// Après une suppression, les positions restantes de chaque groupe touché sont renumérotées
// dans l'ordre : une position libérée par sa dernière variante ne laisse pas de trou
const compacter_positions = async (modele, lignes) =>
{
    const champ = champ_ordre(modele)
    if (!champ)
        return

    const groupes = new Map(lignes.map(ligne => [clef_groupe(champ, ligne), ligne]))
    const table   = `\`${modele.name}\``
    const colonne = `\`${champ.name}\``

    for (const ligne of groupes.values())
    {
        const { clause, valeurs } = condition_groupe(champ, ligne)
        const [rows] = await pool().query(
            `SELECT DISTINCT ${colonne} AS position FROM ${table} WHERE ${clause} ORDER BY position ASC`,
            valeurs
        )

        for (let i = 0; i < rows.length; i++)
        {
            const ancienne = Number(rows[i].position)
            if (ancienne !== i + 1)
                await pool().query(
                    `UPDATE ${table} SET ${colonne} = ? WHERE ${clause} AND ${colonne} = ?`,
                    [i + 1, ...valeurs, ancienne]
                )
        }
    }
}

// ─── Intégrité des relations vers un groupe de lignes (key) ──────────────────
// Ces relations n'ont pas de clef étrangère en base : le magasin vérifie lui-même
// les références, avec les mêmes codes d'erreur que MySQL.

const erreur_reference = (code, message) => Object.assign(new Error(message), { code })

const relations_vers_groupe = (schemas, modele) =>
    (schemas.relations ?? []).filter(r => r.cle_groupe && r.table_cible === modele.name)

// Chaque ligne de jonction doit viser un groupe existant
const verifier_groupes_vises = async (modele, lignes) =>
{
    for (const ref of modele.references_groupes ?? [])
    {
        const valeurs = [...new Set(lignes.map(l => l?.[ref.colonne]).filter(v => v !== undefined && v !== null))]
        if (!valeurs.length)
            continue

        const [rows] = await pool().query(
            `SELECT DISTINCT \`${ref.cle}\` AS valeur FROM \`${ref.table}\` WHERE \`${ref.cle}\` IN (${valeurs.map(() => '?').join(', ')})`,
            valeurs
        )
        const existantes = new Set(rows.map(r => String(r.valeur)))
        const manquante  = valeurs.find(v => !existantes.has(String(v)))
        if (manquante !== undefined)
            throw erreur_reference('ER_NO_REFERENCED_ROW_2', `Référence introuvable : ${ref.table}.${ref.cle} = ${manquante}`)
    }
}

// Le dernier membre d'un groupe encore visé par une jonction ne peut pas en sortir
// (suppression, ou modification de la colonne visée)
const verifier_groupes_restants = async (schemas, modele, lignes) =>
{
    for (const relation of relations_vers_groupe(schemas, modele))
    {
        const cle              = relation.colonne_cible
        const colonne_jonction = relation.modele_jonction.primary[1]

        for (const [valeur, membres] of indexer_lignes_par_clef(lignes, cle))
        {
            const [[{ total }]] = await pool().query(
                `SELECT COUNT(*) AS total FROM \`${modele.name}\` WHERE \`${cle}\` = ?`,
                [valeur]
            )
            if (Number(total) > membres.length)
                continue

            const [liens] = await pool().query(
                `SELECT 1 FROM \`${relation.table_jonction}\` WHERE \`${colonne_jonction}\` = ? LIMIT 1`,
                [valeur]
            )
            if (liens.length)
                throw erreur_reference('ER_ROW_IS_REFERENCED_2', `${modele.name}.${cle} = ${valeur} est encore référencé par ${relation.table_jonction}`)
        }
    }
}

const verifier_mise_a_jour_groupes = async (schemas, modele, lignes, donnees) =>
{
    await verifier_groupes_vises(modele, [donnees])

    for (const relation of relations_vers_groupe(schemas, modele))
    {
        const cle = relation.colonne_cible
        if (!(cle in donnees))
            continue
        const sortantes = lignes.filter(ligne => String(ligne[cle]) !== String(donnees[cle]))
        await verifier_groupes_restants(schemas, modele, sortantes)
    }
}

// ─── Replis (fallback) ───────────────────────────────────────────────────────
// Parmi les entrées qui partagent le reste de la clef primaire, une seule est gardée : celle
// qui répond le mieux aux valeurs demandées, les champs étant départagés dans l'ordre de
// @primary. Une liste demandée '*' laisse toutes les valeurs de son champ.

const preparer_replis = (modele, fallback) =>
{
    if (!fallback)
        return null

    const actifs           = []
    const colonnes_valeurs = {}

    for (const nom of modele.primary ?? [])
    {
        const champ   = trouver_champ(modele, nom)
        const demande = fallback[nom]
        if (!champ?.fallback || demande === '*')
            continue

        if (champ.fallback !== 'list')
        {
            if (demande !== undefined && demande !== null && demande !== '')
                actifs.push({ champ, valeur: comparable(champ, demande) })
            continue
        }

        const liste   = demande === undefined || demande === null ? [] : (Array.isArray(demande) ? demande : [demande])
        const defauts = champ.fallback_default.map((defaut, j) =>
        {
            if (typeof defaut !== 'string' || !defaut.startsWith('#'))
                return { valeur: comparable(champ, defaut ?? '') }
            const colonne = `__repli_${actifs.length}_${j}`
            colonnes_valeurs[colonne] = defaut.slice(1)
            return { colonne }
        })
        actifs.push({ champ, liste: liste.map(valeur => comparable(champ, valeur)), defauts })
    }

    return actifs.length ? { actifs, colonnes_valeurs } : null
}

// Rang d'une ligne pour un champ : plus il est petit, meilleure est la ligne
const rang_repli = (actif, ligne) =>
{
    const valeur = comparable(actif.champ, ligne[actif.champ.name])
    if (actif.champ.fallback === 'decreasing')
        return [ -valeur ]
    if (actif.champ.fallback === 'increasing')
        return [ valeur ]

    const candidats = [ ...actif.liste, ...actif.defauts.map(defaut => 'colonne' in defaut
        ? comparable(actif.champ, ligne[defaut.colonne])
        : defaut.valeur) ]
    const index = candidats.findIndex(candidat => candidat === valeur)
    return index >= 0 ? [ index, '' ] : [ candidats.length, valeur ?? '' ]
}

const comparer_rangs = (a, b) =>
{
    for (let i = 0; i < a.length; i++)
    {
        if (a[i] < b[i]) return -1
        if (a[i] > b[i]) return 1
    }
    return 0
}

const appliquer_replis = (modele, replis, lignes) =>
{
    if (!replis)
        return lignes

    const resolus = new Set(replis.actifs.map(actif => actif.champ.name))
    const groupe  = modele.primary.filter(nom => !resolus.has(nom))
    const accepte = (actif, ligne) =>
    {
        if (!('valeur' in actif))
            return true
        const valeur = comparable(actif.champ, ligne[actif.champ.name])
        return actif.champ.fallback === 'decreasing' ? valeur <= actif.valeur : valeur >= actif.valeur
    }

    const retenues = new Map()
    for (const ligne of lignes)
    {
        if (!replis.actifs.every(actif => accepte(actif, ligne)))
            continue

        const clef  = JSON.stringify(groupe.map(nom => ligne[nom] ?? null))
        const rangs = replis.actifs.flatMap(actif => rang_repli(actif, ligne))
        const deja  = retenues.get(clef)
        if (!deja || comparer_rangs(rangs, deja.rangs) < 0)
            retenues.set(clef, { ligne, rangs })
    }

    return [...retenues.values()].map(({ ligne }) => ligne)
}

// $fallback est toujours défini dans les conditions : les valeurs demandées, ou {}
const contexte_recherche_de = (options_norm, contexte_condition) =>
    ({ $fallback: options_norm.fallback ?? {}, ...normaliser_contexte_condition(contexte_condition) })

const contexte_enforce_de = (options_norm, contexte_norm) =>
    options_norm.enforce_rules
        ? { context: contexte_norm?.$context ?? {}, request: contexte_norm?.$request ?? {} }
        : null

// ─── $search_one ─────────────────────────────────────────────────────────────

const creer_search_one = (schemas) => async (nom_modele, condition, contexte_condition = {}, options = undefined) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const options_norm = normaliser_options_liste(modele, options)

    const entrees = await lire_entrees(schemas, modele, condition, contexte_recherche_de(options_norm, contexte_condition), 'search_one', { ...options_norm, limit: 1 }, options_norm.aux_conditions)
    if (!entrees.length)
        return null

    const resultats = await projeter_lignes_select(schemas, modele, [entrees[0].ligne], options_norm.select, contexte_enforce_de(options_norm, contexte_condition), options_norm.fallback)
    return resultats[0] ?? null
}

// ─── $search_all ─────────────────────────────────────────────────────────────

const creer_search_all = (schemas) => async (nom_modele, condition, contexte_condition = {}, options = undefined) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const options_norm = normaliser_options_liste(modele, options)

    const entrees = await lire_entrees(schemas, modele, condition, contexte_recherche_de(options_norm, contexte_condition), 'search_all', options_norm, options_norm.aux_conditions)

    return await projeter_lignes_select(schemas, modele, entrees.map(entree => entree.ligne), options_norm.select, contexte_enforce_de(options_norm, contexte_condition), options_norm.fallback)
}

// ─── $delete_one ─────────────────────────────────────────────────────────────

const creer_delete_one = (schemas) => async (nom_modele, condition, contexte_condition = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)

    const lignes = await lire_lignes(schemas, modele, condition, contexte_condition, 'delete_one')
    if (!lignes.length)
        return 0

    await verifier_groupes_restants(schemas, modele, [lignes[0]])
    await supprimer_par_pk(modele, lignes[0])
    await compacter_positions(modele, [lignes[0]])
    return 1
}

// ─── $delete_all ─────────────────────────────────────────────────────────────

const creer_delete_all = (schemas) => async (nom_modele, condition, contexte_condition = {}, options = undefined) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const options_norm = normaliser_options_liste(modele, options)

    const cibles = await lire_entrees(schemas, modele, condition, contexte_condition, 'delete_all', options_norm)

    await verifier_groupes_restants(schemas, modele, cibles.map(element => element.brute))
    for (const element of cibles)
        await supprimer_par_pk(modele, element.brute)
    await compacter_positions(modele, cibles.map(element => element.brute))

    return cibles.length
}

// ─── $update_one ─────────────────────────────────────────────────────────────

const creer_update_one = (schemas) => async (nom_modele, condition, donnees, contexte_condition = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const donnees_norm = normaliser_donnees_update(donnees)

    const lignes = await lire_lignes(schemas, modele, condition, contexte_condition, 'update_one')
    if (!lignes.length)
        return 0

    await verifier_mise_a_jour_groupes(schemas, modele, [lignes[0]], donnees_norm)
    return mettre_a_jour_lignes(modele, [lignes[0]], donnees_norm)
}

// ─── $update_all ─────────────────────────────────────────────────────────────

const creer_update_all = (schemas) => async (nom_modele, condition, donnees, contexte_condition = {}) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const donnees_norm = normaliser_donnees_update(donnees)

    const lignes = await lire_lignes(schemas, modele, condition, contexte_condition, 'update_all')
    if (!lignes.length)
        return 0

    await verifier_mise_a_jour_groupes(schemas, modele, lignes, donnees_norm)
    return mettre_a_jour_lignes(modele, lignes, donnees_norm)
}

// ─── Logique d'insertion (partagée par $create_one et $create_all) ────────────

const inserer_batch = async (modele, tableau) =>
{
    if (!tableau.length) return []

    const normaliser_donnees_insertion = (donnees) =>
    {
        const normalisees = { ...donnees }

        for (const champ of modele.fields)
        {
            if (!champ.alt)
                continue

            if (normalisees[champ.name] !== undefined)
                continue

            if (Object.prototype.hasOwnProperty.call(normalisees, champ.alt))
                normalisees[champ.name] = normalisees[champ.alt]
        }

        return normalisees
    }

    const dans_contrainte = (nom) =>
        modele.primary.includes(nom) ||
        modele.unique.some(groupe => groupe.includes(nom))

    // 1. Copier les données et générer les valeurs auto
    const insertions = tableau.map(normaliser_donnees_insertion)

    for (const champ of modele.fields)
    {
        if (champ.default !== 'auto') continue

        const alphabet = champ.chars ?? CHARS_ID
        const taille   = champ.length?.max ?? champ.length?.min ?? champ.max ?? 12
        const besoin   = insertions.filter(ins => ins[champ.name] === undefined)
        if (!besoin.length) continue

        if (dans_contrainte(champ.name))
        {
            // Générer des candidats uniques dans le batch
            const utilises = new Set(
                insertions
                    .filter(ins => ins[champ.name] !== undefined)
                    .map(ins => ins[champ.name])
            )
            let tentatives = 0
            const candidats = []
            for (const ins of besoin)
            {
                let valeur
                do {
                    if (++tentatives > 1000)
                        throw new Error(`Impossible de générer des valeurs uniques pour "${champ.name}"`)
                    valeur = generer_id(taille, alphabet)
                } while (utilises.has(valeur))
                utilises.add(valeur)
                candidats.push({ ins, valeur })
            }

            // Vérifier en une seule requête lesquelles existent déjà en base
            const vals_candidates = candidats.map(c => c.valeur)
            const placeholders    = vals_candidates.map(() => '?').join(', ')
            const [rows] = await pool().query(
                `SELECT \`${champ.name}\` FROM \`${modele.name}\` WHERE \`${champ.name}\` IN (${placeholders})`,
                vals_candidates
            )
            const existantes = new Set(rows.map(r => r[champ.name]))

            // Regénérer seulement les conflits
            for (const candidat of candidats)
            {
                if (existantes.has(candidat.valeur))
                {
                    let valeur
                    let t = 0
                    do {
                        if (++t > 100)
                            throw new Error(`Impossible de générer une valeur unique pour "${champ.name}"`)
                        valeur = generer_id(taille, alphabet)
                    } while (utilises.has(valeur) || existantes.has(valeur))
                    utilises.add(valeur)
                    candidat.valeur = valeur
                }
                candidat.ins[champ.name] = candidat.valeur
            }
        }
        else
        {
            for (const ins of besoin)
                ins[champ.name] = generer_id(taille, alphabet)
        }
    }

    // 1b. Résoudre les defaults par référence ($autre_champ)
    for (const champ of modele.fields)
    {
        if (typeof champ.default !== 'string' || !champ.default.startsWith('$')) continue
        const nom_source = champ.default.slice(1)
        for (const ins of insertions)
        {
            if (ins[champ.name] === undefined && ins[nom_source] !== undefined)
                ins[champ.name] = ins[nom_source]
        }
    }

    // 1c. Positions des champs order
    await attribuer_positions(modele, insertions)

    // 2. Valider les règles
    for (let i = 0; i < insertions.length; i++)
    {
        // Construire le contexte : tous les champs connus, absents → leur default littéral
        // (appliqué par la base), sinon ERREUR_AUGURE (':x')
        const contexte = {}
        for (const champ of modele.fields)
        {
            const valeur = insertions[i][champ.name] === undefined ? default_litteral(champ) : insertions[i][champ.name]
            contexte[`$${champ.name}`] = valeur ?? ERREUR_AUGURE
        }

        for (const champ of modele.fields)
        {
            const valeur = insertions[i][champ.name]

            verifier_valeur_champ(champ, valeur, i)

            if (!valider_regle(champ, contexte))
                throw Object.assign(
                    new Error(`Valeur invalide pour le champ "${champ.name}" (ligne ${i})`),
                    { code: 'RULE_VIOLATION', champ: champ.name, index: i }
                )
        }
    }

    // 3. Traitements crypto en parallèle
    const insertions_traitees = await Promise.all(
        insertions.map(async (insertion) =>
        {
            const traitee = {}
            for (const champ of modele.fields)
            {
                if (insertion[champ.name] === undefined) continue
                traitee[champ.name] = await traiter_ecriture(champ, insertion[champ.name])
            }
            return traitee
        })
    )

    // 4. INSERT batch
    const ensemble_cols = new Set()
    for (const ins of insertions_traitees)
        for (const nom of Object.keys(ins))
            ensemble_cols.add(nom)

    const cols      = [...ensemble_cols]
    const cols_q    = cols.map(n => `\`${n}\``).join(', ')
    const lignes    = insertions_traitees.map(ins => cols.map(c => ins[c] ?? null))
    const marks     = `(${cols.map(() => '?').join(', ')})`
    const all_marks = lignes.map(() => marks).join(', ')

    await pool().query(
        `INSERT INTO \`${modele.name}\` (${cols_q}) VALUES ${all_marks}`,
        lignes.flat()
    )

    // 5. Relire les lignes insérées pour retourner les valeurs stockées en base.
    const lire_lignes_inserees = async () =>
    {
        if (!modele.primary.length)
            return []

        const clauses = []
        const valeurs = []

        for (const insertion of insertions)
        {
            const tous_les_pk_sont_definis = modele.primary.every(nom_pk => insertion[nom_pk] !== undefined)
            if (!tous_les_pk_sont_definis)
                continue

            const clause = modele.primary.map(nom_pk =>
            {
                valeurs.push(insertion[nom_pk])
                return `\`${nom_pk}\` = ?`
            }).join(' AND ')

            clauses.push(`(${clause})`)
        }

        if (!clauses.length)
            return []

        const [rows] = await pool().query(
            `SELECT * FROM \`${modele.name}\` WHERE ${clauses.join(' OR ')}`,
            valeurs
        )

        return rows
    }

    const lignes_inserees = await lire_lignes_inserees()
    const cle_ligne = (ligne) => modele.primary.map(nom_pk => String(ligne[nom_pk])).join('::')
    const lignes_par_clef = new Map(lignes_inserees.map(ligne => [cle_ligne(ligne), ligne]))

    return insertions.map((insertion) =>
    {
        const cle = cle_ligne(insertion)
        const ligne_base = lignes_par_clef.get(cle) ?? {}
        const resultat = {}

        for (const champ of modele.fields)
        {
            if (Object.prototype.hasOwnProperty.call(ligne_base, champ.name))
                resultat[champ.name] = ligne_base[champ.name]

            if (champ.alt && insertion[champ.name] !== undefined)
                resultat[champ.alt] = insertion[champ.name]
        }

        return resultat
    })
}

// ─── Pré-génération des valeurs (hors vérif DB) pour prior_create ─────────────
// Génère les valeurs auto des champs hors contrainte et résout les defaults par
// référence, sans toucher la base. Permet d'exposer les valeurs générées
// (ex. clef à 9 chiffres) dans les scripts prior_create via $enregistrement.

export const preparer_donnees = (modele, donnees) =>
{
    const resultat = { ...donnees }

    const dans_contrainte = (nom) =>
        modele.primary.includes(nom) ||
        modele.unique.some(groupe => groupe.includes(nom))

    // Valeurs auto hors contrainte (pas de vérification d'unicité en base)
    for (const champ of modele.fields)
    {
        if (champ.default !== 'auto')               continue
        if (dans_contrainte(champ.name))            continue
        if (resultat[champ.name] !== undefined)     continue
        const alphabet = champ.chars ?? CHARS_ID
        const taille   = champ.length?.max ?? champ.length?.min ?? champ.max ?? 12
        resultat[champ.name] = generer_id(taille, alphabet)
    }

    // Defaults par référence ($autre_champ)
    for (const champ of modele.fields)
    {
        if (typeof champ.default !== 'string' || !champ.default.startsWith('$')) continue
        const nom_source = champ.default.slice(1)
        if (resultat[champ.name] === undefined && resultat[nom_source] !== undefined)
            resultat[champ.name] = resultat[nom_source]
    }

    return resultat
}

// ─── $create_one ─────────────────────────────────────────────────────────────

const creer_create_one = (schemas) => async (nom_modele, donnees = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    await verifier_groupes_vises(modele, [donnees])
    const [resultat] = await inserer_batch(modele, [donnees])
    return resultat
}

// ─── $create_all ─────────────────────────────────────────────────────────────

const creer_create_all = (schemas) => async (nom_modele, tableau = []) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    await verifier_groupes_vises(modele, tableau)
    return inserer_batch(modele, tableau)
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

export const creer_fonctions_magasin = (schemas) => ({
    $search_one: creer_search_one(schemas),
    $search_all: creer_search_all(schemas),
    $delete_one: creer_delete_one(schemas),
    $delete_all: creer_delete_all(schemas),
    $update_one: creer_update_one(schemas),
    $update_all: creer_update_all(schemas),
    $create_one: creer_create_one(schemas),
    $create_all: creer_create_all(schemas),
})