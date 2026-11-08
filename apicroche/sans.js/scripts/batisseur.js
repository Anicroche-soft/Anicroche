import mysql from "mysql2/promise"
import { createHash } from "crypto"

// ─── Types SQL ────────────────────────────────────────────────────────────────

const type_sql = (champ) =>
{
    const { type, max } = champ
    switch (type)
    {
        case 'char':      return max !== null ? `char(${max})`      : 'char'
        case 'varchar':   return max !== null ? `varchar(${max})`   : 'varchar(255)'
        case 'text':      return 'text'
        case 'int':       return 'int'
        case 'tinyint':   return 'tinyint'
        case 'date':      return 'date'
        case 'datetime':  return 'datetime'
        case 'boolean':   return 'tinyint(1)'
        case 'binary':    return max !== null ? `binary(${max})`    : 'binary(32)'
        case 'varbinary': return max !== null ? `varbinary(${max})` : 'varbinary(255)'
        default:          return 'text'
    }
}

const normaliser_type = (str) =>
    str.toLowerCase().replace(/^(tiny|small|medium|big)?int\(\d+\)$/, (_, prefix) => `${prefix ?? ''}int`)

const UNITES_INTERVAL = { s: 'SECOND', m: 'MINUTE', h: 'HOUR', d: 'DAY' }

const parser_default_now = (valeur) =>
{
    if (valeur === 'now') return { now: true, interval: null }
    const match = /^now\s*\+\s*(\d+)([smhd])$/.exec(valeur)
    if (match) return { now: true, interval: { valeur: parseInt(match[1]), unite: UNITES_INTERVAL[match[2]] } }
    return null
}

// Valeurs par défaut calculées par le cadriciel (et non par la base)
const est_default_cadriciel = (valeur) =>
    valeur === 'auto' || (typeof valeur === 'string' && valeur.startsWith('$'))

const default_sql = (champ) =>
{
    if (!champ.default || est_default_cadriciel(champ.default)) return ''
    const now = parser_default_now(champ.default)
    if (now)
    {
        if (champ.type === 'date') return 'DEFAULT (CURRENT_DATE)'
        if (!now.interval)        return 'DEFAULT CURRENT_TIMESTAMP'
        return `DEFAULT (NOW() + INTERVAL ${now.interval.valeur} ${now.interval.unite})`
    }
    return `DEFAULT '${champ.default}'`
}

// Valeur telle que MySQL la stocke dans INFORMATION_SCHEMA.COLUMN_DEFAULT
const normaliser_default = (champ) =>
{
    if (!champ.default || est_default_cadriciel(champ.default)) return null
    const now = parser_default_now(champ.default)
    if (now)
    {
        if (champ.type === 'date') return 'curdate()'
        if (!now.interval)        return 'CURRENT_TIMESTAMP'
        return `(now() + interval ${now.interval.valeur} ${now.interval.unite.toLowerCase()})`
    }
    return String(champ.default)
}

// ─── Connexion ────────────────────────────────────────────────────────────────

const creer_connexion = async () =>
{
    const host = process.env.database_host || 'localhost'
    const port = parseInt(process.env.database_port || '3306')
    const name = process.env.database_name
    const user = process.env.database_user
    const pass = process.env.database_pass || ''

    if (!name || !user)
    {
        console.log("/!\\ variables d'environnement manquantes (database_name, database_user)")
        return null
    }

    try
    {
        const connexion = await mysql.createConnection({ host, port, user, password: pass, database: name })
        return connexion
    }
    catch (err)
    {
        console.log(`/!\\ impossible de se connecter à la base \`${name}\` : ${err.message}`)
        return null
    }
}

// ─── Création de table ────────────────────────────────────────────────────────

const creer_table = async (connexion, table) =>
{
    const colonnes = table.fields.map(champ =>
        `\`${champ.name}\` ${type_sql(champ)} ${champ.nullable ? 'NULL' : 'NOT NULL'} ${default_sql(champ)}`.trimEnd()
    )

    const contraintes = []
    if (table.primary.length > 0)
        contraintes.push(`PRIMARY KEY (${table.primary.map(c => `\`${c}\``).join(', ')})`)
    for (const contrainte of table.unique)
        contraintes.push(`UNIQUE (${contrainte.map(c => `\`${c}\``).join(', ')})`)

    const lignes = [...colonnes, ...contraintes].join(',\n    ')
    const sql    = `CREATE TABLE \`${table.name}\` (\n    ${lignes}\n)`

    try
    {
        await connexion.query(sql)
        console.log(`  CREATE TABLE \`${table.name}\``)
    }
    catch (err)
    {
        console.log(`/!\\ erreur création \`${table.name}\` : ${err.message}`)
    }
}

// ─── Lecture des contraintes ────────────────────────────────────────────────────

const lire_contraintes = async (connexion, nom_table) =>
{
    const [rows] = await connexion.query(
        `SELECT kcu.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, kcu.COLUMN_NAME
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           ON  tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
           AND tc.TABLE_NAME      = kcu.TABLE_NAME
           AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.TABLE_NAME = ?
         ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
        [nom_table]
    )

    const primary = []
    const unique  = new Map()

    for (const row of rows)
    {
        if (row.CONSTRAINT_TYPE === 'PRIMARY KEY')
            primary.push(row.COLUMN_NAME)
        else if (row.CONSTRAINT_TYPE === 'UNIQUE')
        {
            if (!unique.has(row.CONSTRAINT_NAME))
                unique.set(row.CONSTRAINT_NAME, [])
            unique.get(row.CONSTRAINT_NAME).push(row.COLUMN_NAME)
        }
    }

    return { primary, unique }
}

// ─── Synchronisation des contraintes ─────────────────────────────────────────

const synchro_contraintes = async (connexion, table) =>
{
    const { primary: pk_actuelle, unique: uniques_actuelles } = await lire_contraintes(connexion, table.name)
    const pk_cible    = table.primary
    const pk_egale    = pk_actuelle.length === pk_cible.length &&
        pk_actuelle.every((col, i) => col === pk_cible[i])

    if (!pk_egale)
    {
        try
        {
            const parties = []
            if (pk_actuelle.length > 0)
                parties.push('DROP PRIMARY KEY')
            if (pk_cible.length > 0)
                parties.push(`ADD PRIMARY KEY (${pk_cible.map(c => `\`${c}\``).join(', ')})`)
            if (parties.length > 0)
            {
                await connexion.query(`ALTER TABLE \`${table.name}\` ${parties.join(', ')}`)
                console.log(`  ALTER TABLE \`${table.name}\` — clef primaire mise à jour`)
            }
        }
        catch (err)
        {
            console.log(`/!\\ erreur mise à jour clef primaire \`${table.name}\` : ${err.message}`)
        }
    }

    for (const [nom, cols] of uniques_actuelles)
    {
        const existe = table.unique.some(
            uc => uc.length === cols.length && uc.every((c, i) => c === cols[i])
        )
        if (!existe)
        {
            try
            {
                await connexion.query(`ALTER TABLE \`${table.name}\` DROP INDEX \`${nom}\``)
                console.log(`  ALTER TABLE \`${table.name}\` DROP INDEX \`${nom}\``)
            }
            catch (err)
            {
                console.log(`/!\\ erreur suppression contrainte unique \`${table.name}.${nom}\` : ${err.message}`)
            }
        }
    }

    for (const cols_cible of table.unique)
    {
        const existe = [...uniques_actuelles.values()].some(
            cols => cols.length === cols_cible.length && cols.every((c, i) => c === cols_cible[i])
        )
        if (!existe)
        {
            try
            {
                await connexion.query(
                    `ALTER TABLE \`${table.name}\` ADD UNIQUE (${cols_cible.map(c => `\`${c}\``).join(', ')})`
                )
                console.log(`  ALTER TABLE \`${table.name}\` ADD UNIQUE (${cols_cible.join(', ')})`)
            }
            catch (err)
            {
                console.log(`/!\\ erreur ajout contrainte unique \`${table.name}\` : ${err.message}`)
            }
        }
    }
}

// ─── Mise à jour de table ─────────────────────────────────────────────────────

const mettre_a_jour_table = async (connexion, table, mode_dev, suppression_schema_activee) =>
{
    const [rows] = await connexion.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table.name]
    )

    const colonnes_existantes = new Map(rows.map(r => [r.COLUMN_NAME, r]))

    for (const champ of table.fields)
    {
        const existante    = colonnes_existantes.get(champ.name)
        const type_cible   = type_sql(champ)
        const nullable_sql = champ.nullable ? 'NULL' : 'NOT NULL'

        if (!existante)
        {
            try
            {
                await connexion.query(
                    `ALTER TABLE \`${table.name}\` ADD COLUMN \`${champ.name}\` ${type_cible} ${nullable_sql} ${default_sql(champ)}`.trimEnd()
                )
                console.log(`  ALTER TABLE \`${table.name}\` ADD COLUMN \`${champ.name}\``)
            }
            catch (err)
            {
                console.log(`/!\\ erreur ajout colonne \`${table.name}.${champ.name}\` : ${err.message}`)
            }
        }
        else
        {
            const type_actuel     = normaliser_type(existante.COLUMN_TYPE)
            const nullable_actuel = existante.IS_NULLABLE === 'YES'
            const default_actuel  = existante.COLUMN_DEFAULT ?? null
            const default_cible   = normaliser_default(champ)
            if (type_actuel !== normaliser_type(type_cible) || nullable_actuel !== champ.nullable || default_actuel !== default_cible)
            {
                try
                {
                    await connexion.query(
                        `ALTER TABLE \`${table.name}\` MODIFY COLUMN \`${champ.name}\` ${type_cible} ${nullable_sql} ${default_sql(champ)}`.trimEnd()
                    )
                    console.log(`  ALTER TABLE \`${table.name}\` MODIFY COLUMN \`${champ.name}\``)
                }
                catch (err)
                {
                    console.log(`/!\\ erreur modification colonne \`${table.name}.${champ.name}\` : ${err.message}`)
                }
            }
        }
    }

    if (mode_dev && suppression_schema_activee)
    {
        const noms_schema = new Set(table.fields.map(f => f.name))
        for (const [nom] of colonnes_existantes)
        {
            if (!noms_schema.has(nom))
            {
                try
                {
                    await connexion.query(`ALTER TABLE \`${table.name}\` DROP COLUMN \`${nom}\``)
                    console.log(`  ALTER TABLE \`${table.name}\` DROP COLUMN \`${nom}\``)
                }
                catch (err)
                {
                    console.log(`/!\\ erreur suppression colonne \`${table.name}.${nom}\` : ${err.message}`)
                }
            }
        }
    }

    await synchro_contraintes(connexion, table)
}

// ─── Table de jonction N-N ────────────────────────────────────────────────────

const pk_de_table = (table) =>
{
    if (!table || table.primary.length === 0)
        return null
    return table.fields.find(f => f.name === table.primary[0]) ?? null
}

const descripteur_jonction = (nom, table_source, table_cible) =>
{
    const pk_source     = pk_de_table(table_source)
    const pk_cible      = pk_de_table(table_cible)
    const nom_id_source = `id_${table_source.entry_name ?? table_source.name}`
    const nom_id_cible  = `id_${table_cible.entry_name  ?? table_cible.name}`

    return {
        name   : nom,
        primary: [nom_id_source, nom_id_cible],
        unique : [],
        fields : [
            {
                name    : nom_id_source,
                type    : pk_source?.type ?? 'int',
                min     : pk_source?.min  ?? null,
                max     : pk_source?.max  ?? null,
                nullable: false
            },
            {
                name    : nom_id_cible,
                type    : pk_cible?.type ?? 'int',
                min     : pk_cible?.min  ?? null,
                max     : pk_cible?.max  ?? null,
                nullable: false
            }
        ]
    }
}

// ─── Clefs étrangères ─────────────────────────────────────────────────────────

const nommer_clef_etrangere = (table, colonne) =>
{
    const nom = `fk_${table}_${colonne}`
    if (nom.length <= 64)
        return nom
    return `fk_${createHash('sha1').update(`${table}.${colonne}`).digest('hex').slice(0, 40)}`
}

// Liste des clefs étrangères attendues d'après les relations du schéma :
// - relation x-N : colonne id_<entrée source> de la table cible → table source
// - relation 0-1 / 1-1 : colonne id_<entrée cible> de la table source → table cible
// - relation N-N : les deux colonnes de la table de jonction (suppression en cascade)
const lister_clefs_etrangeres = (tables, relations) =>
{
    const index = Object.fromEntries(tables.map(t => [t.name, t]))
    const attendues = []

    const ajouter = (table, colonne, table_ref, on_delete) =>
    {
        const cible = index[table_ref]
        if (!cible || cible.primary.length !== 1)
        {
            console.log(`/!\\ clef étrangère \`${table}.${colonne}\` ignorée : \`${table_ref}\` doit avoir une clef primaire simple`)
            return
        }
        attendues.push({
            nom        : nommer_clef_etrangere(table, colonne),
            table,
            colonne,
            table_ref,
            colonne_ref: cible.primary[0],
            on_delete
        })
    }

    for (const rel of relations)
    {
        if (rel.table_jonction)
        {
            const source = index[rel.table_source]
            const cible  = index[rel.table_cible]
            const col_source = `id_${source.entry_name ?? source.name}`
            const col_cible  = `id_${cible.entry_name ?? cible.name}`
            if (col_source === col_cible)
            {
                console.log(`/!\\ jonction \`${rel.table_jonction}\` : relation d'une table vers elle-même non prise en charge`)
                continue
            }
            ajouter(rel.table_jonction, col_source, rel.table_source, 'CASCADE')
            ajouter(rel.table_jonction, col_cible, rel.table_cible, 'CASCADE')
        }
        else if (rel.cle_etrangere)
            ajouter(rel.table_cible, rel.cle_etrangere, rel.table_source, 'RESTRICT')
        else if (rel.cle_locale)
            ajouter(rel.table_source, rel.cle_locale, rel.table_cible, 'RESTRICT')
    }

    return attendues
}

const synchro_clefs_etrangeres = async (connexion, attendues) =>
{
    const [rows] = await connexion.query(
        `SELECT rc.CONSTRAINT_NAME, rc.TABLE_NAME, rc.DELETE_RULE,
                kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
         FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
           ON  kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
           AND kcu.CONSTRAINT_NAME   = rc.CONSTRAINT_NAME
           AND kcu.TABLE_NAME        = rc.TABLE_NAME
         WHERE rc.CONSTRAINT_SCHEMA = DATABASE()`
    )

    const existantes = new Map(rows.map(r => [r.CONSTRAINT_NAME, r]))
    const par_nom    = new Map(attendues.map(fk => [fk.nom, fk]))

    const identique = (r, fk) =>
        r.TABLE_NAME === fk.table
     && r.COLUMN_NAME === fk.colonne
     && r.REFERENCED_TABLE_NAME === fk.table_ref
     && r.REFERENCED_COLUMN_NAME === fk.colonne_ref
     && r.DELETE_RULE === fk.on_delete

    // Supprimer les clefs gérées par sans.js (préfixe fk_) devenues inutiles ou différentes
    for (const [nom, r] of existantes)
    {
        if (!nom.startsWith('fk_'))
            continue
        const fk = par_nom.get(nom)
        if (fk && identique(r, fk))
            continue

        try
        {
            await connexion.query(`ALTER TABLE \`${r.TABLE_NAME}\` DROP FOREIGN KEY \`${nom}\``)
            console.log(`  ALTER TABLE \`${r.TABLE_NAME}\` DROP FOREIGN KEY \`${nom}\``)
            existantes.delete(nom)
        }
        catch (err)
        {
            console.log(`/!\\ erreur suppression clef étrangère \`${nom}\` : ${err.message}`)
        }
    }

    for (const fk of attendues)
    {
        if (existantes.has(fk.nom))
            continue

        try
        {
            await connexion.query(
                `ALTER TABLE \`${fk.table}\` ADD CONSTRAINT \`${fk.nom}\` FOREIGN KEY (\`${fk.colonne}\`)
                 REFERENCES \`${fk.table_ref}\` (\`${fk.colonne_ref}\`) ON DELETE ${fk.on_delete} ON UPDATE CASCADE`
            )
            console.log(`  ALTER TABLE \`${fk.table}\` ADD FOREIGN KEY (${fk.colonne}) → ${fk.table_ref}.${fk.colonne_ref}`)
        }
        catch (err)
        {
            console.log(`/!\\ erreur ajout clef étrangère \`${fk.table}.${fk.colonne}\` : ${err.message}`)
        }
    }
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

export const construire_base = async (schemas) =>
{
    const mode_dev  = (process.env.mode || 'prod') === 'dev'
    const suppression_schema_activee = (process.env.schema_destructive || 'false') === 'true'
    const connexion = await creer_connexion()
    if (!connexion)
        return

    console.log('\nConstruction de la base de données...')

    const { tables, relations } = schemas
    const index_tables = Object.fromEntries(tables.map(t => [t.name, t]))

    const [rows_tables]      = await connexion.query("SHOW TABLES")
    const tables_existantes  = new Set(rows_tables.map(r => Object.values(r)[0]))

    for (const table of tables)
    {
        if (!tables_existantes.has(table.name))
            await creer_table(connexion, table)
        else
            await mettre_a_jour_table(connexion, table, mode_dev, suppression_schema_activee)
    }

    const jonctions = relations.filter(r => r.table_jonction)
    for (const rel of jonctions)
    {
        const desc = descripteur_jonction(
            rel.table_jonction,
            index_tables[rel.table_source],
            index_tables[rel.table_cible]
        )
        desc.entry_name = rel.table_jonction_entry ?? null
        if (!tables_existantes.has(rel.table_jonction))
            await creer_table(connexion, desc)
        else
            await mettre_a_jour_table(connexion, desc, mode_dev, suppression_schema_activee)
    }

    await synchro_clefs_etrangeres(connexion, lister_clefs_etrangeres(tables, relations))

    if (mode_dev && suppression_schema_activee)
    {
        await connexion.query('SET FOREIGN_KEY_CHECKS = 0')
        const noms_schema = new Set([
            ...tables.map(t => t.name),
            ...jonctions.map(r => r.table_jonction),
            ...(schemas.noms_connus ?? [])
        ])
        for (const nom of tables_existantes)
        {
            if (!noms_schema.has(nom))
            {
                try
                {
                    await connexion.query(`DROP TABLE \`${nom}\``)
                    console.log(`  DROP TABLE \`${nom}\``)
                }
                catch (err)
                {
                    console.log(`/!\\ erreur suppression table \`${nom}\` : ${err.message}`)
                }
            }
        }
        await connexion.query('SET FOREIGN_KEY_CHECKS = 1')
    }

    await connexion.end()
    console.log('Base de données à jour.\n')
}
