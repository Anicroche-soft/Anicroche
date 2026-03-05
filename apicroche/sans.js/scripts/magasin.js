import mysql  from 'mysql2/promise'
import crypto from 'node:crypto'

import { hacher_hmac, hacher_argon2, verifier_argon2, chiffrer_aes, dechiffrer_aes } from './crypto.js'


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

    _pool = mysql.createPool({ host, port, user, password: pass, database: name })
    return _pool
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

const trouver_modele_entree = (schemas, nom) =>
    schemas.tables.find(t => (t.entry_name ?? t.name) === nom) ?? null

const trouver_modele_table = (schemas, nom) =>
    schemas.tables.find(t => t.name === nom) ?? null

const trouver_champ = (modele, nom) =>
    modele.fields.find(f => f.name === nom) ?? null

// Générer un identifiant aléatoire alphanumérique
const CHARS_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const generer_id = (taille = 12, alphabet = CHARS_ID) =>
{
    const octets = crypto.randomBytes(taille)
    return Array.from(octets).map(b => alphabet[b % alphabet.length]).join('')
}

// Valider la valeur brute contre la rule (regex) du champ, avant tout traitement
const valider_regle = (champ, valeur) =>
{
    if (!champ?.rule || valeur === null || valeur === undefined)
        return true
    const regex = new RegExp(champ.rule.source, champ.rule.flags)
    return regex.test(String(valeur))
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
        if (champ.treatment === 'encryption' && res[champ.name] != null)
        {
            try   { res[champ.name] = dechiffrer_aes(res[champ.name]) }
            catch { res[champ.name] = null }
        }
    }
    return res
}

// Séparer les critères en déterministes (SQL) et non-déterministes (vérification JS)
const separer_criteres = (modele, criteres) =>
{
    const sql  = {}
    const post = {}
    for (const [nom, valeur] of Object.entries(criteres))
    {
        const champ = trouver_champ(modele, nom)
        if (!champ) continue
        switch (champ.treatment)
        {
            case 'deterministic_hashing': sql[nom]  = hacher_hmac(valeur); break
            case 'hashing':               post[nom] = valeur;               break
            case 'encryption':            post[nom] = valeur;               break
            default:                      sql[nom]  = valeur
        }
    }
    return { sql, post }
}

// Vérifier les critères non-SQL sur une ligne déjà lue
const verifier_post = async (modele, ligne, post) =>
{
    for (const [nom, valeur] of Object.entries(post))
    {
        const champ = trouver_champ(modele, nom)
        if (!champ) return false

        if (champ.treatment === 'hashing')
        {
            if (!ligne[nom] || !await verifier_argon2(ligne[nom], valeur))
                return false
        }
        else if (champ.treatment === 'encryption')
        {
            try   { if (dechiffrer_aes(ligne[nom]) !== String(valeur)) return false }
            catch { return false }
        }
    }
    return true
}

// Construire la clause WHERE
const construire_where = (criteres_sql) =>
{
    const noms = Object.keys(criteres_sql)
    if (!noms.length) return { clause: '', valeurs: [] }
    return {
        clause : 'WHERE ' + noms.map(n => `\`${n}\` = ?`).join(' AND '),
        valeurs: Object.values(criteres_sql)
    }
}

// Supprimer une ligne par sa clef primaire
const supprimer_par_pk = async (modele, ligne) =>
{
    const clause  = modele.primary.map(c => `\`${c}\` = ?`).join(' AND ')
    const valeurs = modele.primary.map(c => ligne[c])
    await pool().query(`DELETE FROM \`${modele.name}\` WHERE ${clause}`, valeurs)
}

// ─── $search_one ─────────────────────────────────────────────────────────────

const creer_search_one = (schemas) => async (nom_modele, criteres = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql)
    const besoin_post         = Object.keys(post).length > 0

    // Sans post-vérification : LIMIT 1 possible
    const requete  = `SELECT * FROM \`${modele.name}\` ${clause} ${besoin_post ? '' : 'LIMIT 1'}`.trim()
    const [lignes] = await pool().query(requete, valeurs)

    for (const ligne of lignes)
    {
        if (!besoin_post || await verifier_post(modele, ligne, post))
            return decrypter_ligne(modele, ligne)
    }
    return null
}

// ─── $search_all ─────────────────────────────────────────────────────────────

const creer_search_all = (schemas) => async (nom_modele, criteres = {}) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql)
    const besoin_post         = Object.keys(post).length > 0

    const [lignes] = await pool().query(
        `SELECT * FROM \`${modele.name}\` ${clause}`.trim(),
        valeurs
    )

    const resultats = []
    for (const ligne of lignes)
    {
        if (!besoin_post || await verifier_post(modele, ligne, post))
            resultats.push(decrypter_ligne(modele, ligne))
    }
    return resultats
}

// ─── $delete_one ─────────────────────────────────────────────────────────────

const creer_delete_one = (schemas) => async (nom_modele, criteres = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql)
    const besoin_post         = Object.keys(post).length > 0

    if (!besoin_post)
    {
        await pool().query(
            `DELETE FROM \`${modele.name}\` ${clause} LIMIT 1`.trim(),
            valeurs
        )
        return
    }

    const [lignes] = await pool().query(
        `SELECT * FROM \`${modele.name}\` ${clause}`.trim(),
        valeurs
    )
    for (const ligne of lignes)
    {
        if (await verifier_post(modele, ligne, post))
        {
            await supprimer_par_pk(modele, ligne)
            return
        }
    }
}

// ─── $delete_all ─────────────────────────────────────────────────────────────

const creer_delete_all = (schemas) => async (nom_modele, criteres = {}) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)

    const { sql, post }       = separer_criteres(modele, criteres)
    const { clause, valeurs } = construire_where(sql)
    const besoin_post         = Object.keys(post).length > 0

    if (!besoin_post)
    {
        await pool().query(
            `DELETE FROM \`${modele.name}\` ${clause}`.trim(),
            valeurs
        )
        return
    }

    const [lignes] = await pool().query(
        `SELECT * FROM \`${modele.name}\` ${clause}`.trim(),
        valeurs
    )
    for (const ligne of lignes)
    {
        if (await verifier_post(modele, ligne, post))
            await supprimer_par_pk(modele, ligne)
    }
}

// ─── Logique d'insertion (partagée par $create_one et $create_all) ────────────

const inserer_batch = async (modele, tableau) =>
{
    if (!tableau.length) return []

    const dans_contrainte = (nom) =>
        modele.primary.includes(nom) ||
        modele.unique.some(groupe => groupe.includes(nom))

    // 1. Copier les données et générer les valeurs auto
    const insertions = tableau.map(d => ({ ...d }))

    for (const champ of modele.fields)
    {
        if (champ.default !== 'auto') continue

        const alphabet = champ.chars ?? CHARS_ID
        const taille   = champ.max ?? 12
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

    // 2. Valider les règles
    for (let i = 0; i < insertions.length; i++)
    {
        for (const champ of modele.fields)
        {
            if (insertions[i][champ.name] === undefined) continue
            if (!valider_regle(champ, insertions[i][champ.name]))
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

    // 5. Retourner les données originales + ids auto-générés
    return tableau.map((donnees, i) =>
    {
        const resultat = { ...donnees }
        for (const nom_pk of modele.primary)
        {
            if (donnees[nom_pk] === undefined && insertions[i][nom_pk] !== undefined)
                resultat[nom_pk] = insertions[i][nom_pk]
        }
        return resultat
    })
}

// ─── $create_one ─────────────────────────────────────────────────────────────

const creer_create_one = (schemas) => async (nom_modele, donnees = {}) =>
{
    const modele = trouver_modele_entree(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    const [resultat] = await inserer_batch(modele, [donnees])
    return resultat
}

// ─── $create_all ─────────────────────────────────────────────────────────────

const creer_create_all = (schemas) => async (nom_modele, tableau = []) =>
{
    const modele = trouver_modele_table(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)
    return inserer_batch(modele, tableau)
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

export const creer_fonctions_magasin = (schemas) => ({
    $search_one: creer_search_one(schemas),
    $search_all: creer_search_all(schemas),
    $delete_one: creer_delete_one(schemas),
    $delete_all: creer_delete_all(schemas),
    $create_one: creer_create_one(schemas),
    $create_all: creer_create_all(schemas),
})
