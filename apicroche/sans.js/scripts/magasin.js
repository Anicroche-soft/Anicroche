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

const trouver_modele = (schemas, nom) =>
    schemas.tables.find(t => t.entry_name === nom || t.name === nom) ?? null

const trouver_champ = (modele, nom) =>
    modele.fields.find(f => f.name === nom) ?? null

// Générer un identifiant aléatoire alphanumérique
const CHARS_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

const generer_id = (taille = 12) =>
{
    const octets = crypto.randomBytes(taille)
    return Array.from(octets).map(b => CHARS_ID[b % CHARS_ID.length]).join('')
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
    const modele = trouver_modele(schemas, nom_modele)
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
    const modele = trouver_modele(schemas, nom_modele)
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
    const modele = trouver_modele(schemas, nom_modele)
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
    const modele = trouver_modele(schemas, nom_modele)
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

// ─── $create_one ─────────────────────────────────────────────────────────────

const creer_create_one = (schemas) => async (nom_modele, donnees = {}) =>
{
    const modele = trouver_modele(schemas, nom_modele)
    if (!modele) throw new Error(`Modèle introuvable : ${nom_modele}`)

    const insertion = { ...donnees }

    // Auto-générer les champs primaires manquants de type char ou varchar
    for (const nom_pk of modele.primary)
    {
        if (insertion[nom_pk] !== undefined) continue
        const champ = trouver_champ(modele, nom_pk)
        if (champ && (champ.type === 'char' || champ.type === 'varchar'))
            insertion[nom_pk] = generer_id(champ.max ?? 12)
    }

    // Appliquer les traitements crypto sur chaque champ
    const insertion_traitee = {}
    for (const champ of modele.fields)
    {
        if (insertion[champ.name] === undefined) continue
        insertion_traitee[champ.name] = await traiter_ecriture(champ, insertion[champ.name])
    }

    const noms    = Object.keys(insertion_traitee)
    const valeurs = Object.values(insertion_traitee)
    const cols    = noms.map(n => `\`${n}\``).join(', ')
    const marks   = noms.map(() => '?').join(', ')

    await pool().query(
        `INSERT INTO \`${modele.name}\` (${cols}) VALUES (${marks})`,
        valeurs
    )

    // Retourner les données originales + les ids auto-générés
    const resultat = { ...donnees }
    for (const nom_pk of modele.primary)
    {
        if (donnees[nom_pk] === undefined && insertion[nom_pk] !== undefined)
            resultat[nom_pk] = insertion[nom_pk]
    }
    return resultat
}

// ─── $create_all ─────────────────────────────────────────────────────────────

const creer_create_all = (schemas) => async (nom_modele, tableau = []) =>
{
    const creer = creer_create_one(schemas)
    return Promise.all(tableau.map(donnees => creer(nom_modele, donnees)))
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
