import fs   from "fs"
import path from "path"

// ─── Analyseur syntaxique ─────────────────────────────────────────────────────

const echouer = (pos, message) =>
{
    throw Object.assign(new Error(message), { pos })
}

const decrire_caractere = (str, pos) =>
{
    if (pos >= str.length)
        return 'la fin du fichier'
    if (str[pos] === '\n')
        return 'une fin de ligne'
    return `« ${str[pos]} »`
}

const passer_blancs = (str, pos) =>
{
    while (pos < str.length && /^[ \t]$/.test(str[pos]))
        pos++
    return pos
}

const passer_separateurs = (str, pos) =>
{
    while (pos < str.length)
    {
        if (str[pos] == '#')
        {
            while (pos < str.length && str[pos] != '\n')
                pos++
        }
        else if (/^[ \t\n,]$/.test(str[pos]))
            pos++
        else
            break
    }
    return pos
}

const lire_scalaire = (str, pos) =>
{
    const debut          = pos
    let valeur           = ''
    let entre_guillemets = false
    while (pos < str.length)
    {
        const c = str[pos]
        if (/^["'`]$/.test(c))
        {
            const guillemet = c
            const ouverture = pos
            entre_guillemets = true
            pos++
            while (pos < str.length && str[pos] != guillemet)
            {
                valeur += str[pos]
                pos++
            }
            if (pos >= str.length)
                echouer(ouverture, `guillemet ${guillemet} jamais refermé`)
            pos++
            continue
        }
        if (/^[ \t\n,:\[\]{}#]$/.test(c))
            break
        valeur += c
        pos++
    }
    if (pos == debut)
        echouer(pos, `valeur attendue, ${decrire_caractere(str, pos)} trouvé`)
    return { valeur, pos, entre_guillemets }
}

// ─── Analyse d'un jeu de caractères style [A-Z0-9] ───────────────────────────

const analyser_chars = (str) =>
{
    if (!str) return null
    let resultat = ''
    let i = 0
    while (i < str.length)
    {
        if (i + 2 < str.length && str[i + 1] === '-')
        {
            const debut = str.charCodeAt(i)
            const fin   = str.charCodeAt(i + 2)
            for (let c = debut; c <= fin; c++)
                resultat += String.fromCharCode(c)
            i += 3
        }
        else
        {
            resultat += str[i]
            i++
        }
    }
    return resultat || null
}

const lire_valeur = (str, pos) =>
{
    pos = passer_blancs(str, pos)
    if (pos >= str.length)
        echouer(pos, 'valeur attendue, la fin du fichier trouvée')
    if (str[pos] == '[')
        return est_dict_entre_crochets(str, pos) ? lire_dict(str, pos, ']') : lire_liste(str, pos)
    if (str[pos] == '{')
        return lire_dict(str, pos)
    return lire_scalaire(str, pos)
}

// `[ clef : valeur ]` est accepté comme dictionnaire (ex. `@rules [ can_search : ... ]`)
const est_dict_entre_crochets = (str, pos) =>
{
    pos = passer_separateurs(str, pos + 1)
    if (pos >= str.length || /^[\[\]{}]$/.test(str[pos]))
        return false
    try
    {
        pos = lire_scalaire(str, pos).pos
    }
    catch
    {
        return false
    }
    pos = passer_blancs(str, pos)
    return str[pos] === ':'
}

// Une valeur non mise entre guillemets s'arrête au premier espace ou à la première virgule :
// `$f($a, $b)` est alors lu `$f($a`, et la suite rend le modèle invalide
const verifier_parentheses = ({ valeur, entre_guillemets }, cle, pos) =>
{
    if (typeof valeur !== 'string' || entre_guillemets)
        return
    const ouvrantes = (valeur.match(/\(/g) ?? []).length
    const fermantes = (valeur.match(/\)/g) ?? []).length
    if (ouvrantes > fermantes)
        echouer(pos, `la valeur${cle ? ` de \`${cle}\`` : ''} est coupée après « ${valeur} » : une valeur contenant des espaces ou des virgules s'écrit entre guillemets, ex. "$fonction($a, $b)"`)
}

const lire_liste = (str, pos) =>
{
    const ouverture = pos
    pos++
    const liste = []
    while (true)
    {
        pos = passer_separateurs(str, pos)
        if (pos >= str.length)
            echouer(ouverture, 'crochet [ jamais refermé')
        if (str[pos] == ']')
            return { valeur: liste, pos: pos + 1 }
        const debut = pos
        const res   = lire_valeur(str, pos)
        verifier_parentheses(res, null, debut)
        liste.push(res.valeur)
        pos = res.pos
    }
}

const lire_dict = (str, pos, fermant = '}') =>
{
    const ouverture = pos
    pos++
    const dict      = {}
    let precedente  = null
    while (true)
    {
        pos = passer_separateurs(str, pos)
        if (pos >= str.length)
            echouer(ouverture, `${str[ouverture]} jamais refermé`)
        if (str[pos] == fermant)
            return { valeur: dict, pos: pos + 1 }
        const debut_cle = pos
        const res_cle   = lire_scalaire(str, pos)
        pos = passer_blancs(str, res_cle.pos)
        if (pos >= str.length || str[pos] != ':')
        {
            const suite = precedente && typeof dict[precedente] === 'string'
                ? ` ; si « ${res_cle.valeur} » fait partie de la valeur de \`${precedente}\`, mettez cette valeur entre guillemets`
                : ''
            echouer(debut_cle, `« : » attendu après la clef \`${res_cle.valeur}\`, ${decrire_caractere(str, pos)} trouvé${suite}`)
        }
        pos++
        const debut_val = passer_blancs(str, pos)
        const res_val   = lire_valeur(str, pos)
        verifier_parentheses(res_val, res_cle.valeur, debut_val)
        dict[res_cle.valeur] = res_val.valeur
        precedente           = res_cle.valeur
        pos                  = res_val.pos
    }
}

const lire_bloc_brut = (str, pos) =>
{
    if (pos >= str.length || str[pos] !== '[')
        echouer(pos, `« [ » attendu après @script, ${decrire_caractere(str, pos)} trouvé`)
    const ouverture = pos
    pos++
    let profondeur = 1
    let contenu    = ''
    while (pos < str.length)
    {
        if (str[pos] === '[')
            profondeur++
        else if (str[pos] === ']')
        {
            profondeur--
            if (profondeur === 0)
                return { valeur: contenu.trim(), pos: pos + 1 }
        }
        contenu += str[pos]
        pos++
    }
    echouer(ouverture, 'crochet [ de @script jamais refermé')
}

// Lève une erreur portant la position (`pos`) du problème si le contenu est invalide
const analyser_sans = (str) =>
{
    const annotations = {}
    let pos = 0
    while (pos < str.length)
    {
        pos = passer_separateurs(str, pos)
        if (pos >= str.length)
            break
        if (str[pos] != '@')
            echouer(pos, `annotation (@nom) attendue, ${decrire_caractere(str, pos)} trouvé`)
        pos++
        const res_nom = lire_scalaire(str, pos)
        pos = passer_blancs(str, res_nom.pos)
        const res_val = res_nom.valeur === 'script'
            ? lire_bloc_brut(str, pos)
            : lire_valeur(str, pos)
        annotations[res_nom.valeur] = res_val.valeur
        pos = res_val.pos
    }
    return annotations
}

// ─── Transformation ───────────────────────────────────────────────────────────

const analyser_taille = (taille) =>
{
    if (taille === null || taille === undefined)
        return { min: null, max: null }
    const str    = String(taille)
    const bornes = str.match(/^(\d+)-(\d+)$/)
    if (bornes)
        return { min: parseInt(bornes[1]), max: parseInt(bornes[2]) }
    if (/^\d+$/.test(str))
    {
        const n = parseInt(str)
        return { min: n, max: n }
    }
    return { min: null, max: null }
}

const analyser_count = (count) =>
{
    if (!count)
        return { min: 1, max: 1 }
    const str   = String(count)
    const match = str.match(/^([0-9]+|N)-([0-9]+|N)$/)
    if (!match)
        return null
    return {
        min: match[1] == 'N' ? 'N' : parseInt(match[1]),
        max: match[2] == 'N' ? 'N' : parseInt(match[2])
    }
}

const lire_chaine_optionnelle = (objet, cle) =>
    objet && typeof objet[cle] === 'string' ? objet[cle].trim() : null

const resoudre_type_sql = (type_sans, taille, est_deterministe) =>
{
    const { min, max } = analyser_taille(taille)
    const fixe         = min !== null && min === max

    if (type_sans.includes('/'))
    {
        // Une barre oblique finale permet un énuméré à une seule valeur (page/)
        const valeurs = type_sans.replace(/\/$/, '').split('/')
        if (valeurs.some(v => !v))
            return null
        return {
            type     : 'varchar',
            min      : min ?? 0,
            max      : max ?? Math.max(...valeurs.map(v => v.length)),
            treatment: null,
            values   : valeurs
        }
    }

    switch (type_sans)
    {
        case 'char':
            return { type: fixe ? 'char' : 'varchar', min, max, treatment: null }

        case 'text':
            return { type: 'text', min: null, max: null, treatment: null }

        case 'int':
            return { type: 'int', min: null, max: null, treatment: null }

        case 'tinyint':
            return { type: 'tinyint', min: null, max: null, treatment: null }

        case 'date':
            return { type: 'date', min: null, max: null, treatment: null }

        case 'datetime':
            return { type: 'datetime', min: null, max: null, treatment: null }

        case 'boolean':
            return { type: 'boolean', min: null, max: null, treatment: null }

        case 'hash':
            if (taille !== null && taille !== undefined)
                return {
                    type     : fixe ? 'char' : 'varchar',
                    min,
                    max,
                    treatment: est_deterministe ? 'deterministic_hashing' : 'hashing'
                }
            // HMAC-SHA256 : 64 caractères hexadécimaux ; argon2 : longueur variable (~97 caractères)
            return est_deterministe
                ? { type: 'char', min: 64, max: 64, treatment: 'deterministic_hashing' }
                : { type: 'varchar', min: null, max: 255, treatment: 'hashing' }

        case 'crypt':
            return {
                type     : fixe ? 'binary' : 'varbinary',
                min,
                max,
                treatment: 'encryption'
            }

        default:
            return null
    }
}

const transformer_champ = (champ_brut, champs_dans_unique) =>
{
    const type_res = resoudre_type_sql(
        champ_brut.type,
        champ_brut.size ?? null,
        champs_dans_unique.includes(champ_brut.name)
    )
    if (!type_res)
        return "invalide"

    const count    = analyser_count(champ_brut.count ?? null)
    const nullable = count ? count.min === 0 : false

    const regle_brute = champ_brut.rule ?? null
    const rule = typeof regle_brute === 'string' ? regle_brute : null

    const can_create    = lire_chaine_optionnelle(champ_brut, 'can_create')
    const can_search          = lire_chaine_optionnelle(champ_brut, 'can_search')
    const restrict_search     = lire_chaine_optionnelle(champ_brut, 'restrict_search')
    const rev_can_search      = lire_chaine_optionnelle(champ_brut, 'rev_can_search')
    const rev_restrict_search = lire_chaine_optionnelle(champ_brut, 'rev_restrict_search')
    const prior_create  = lire_chaine_optionnelle(champ_brut, 'prior_create')
    const post_create   = lire_chaine_optionnelle(champ_brut, 'post_create')
    const can_update    = lire_chaine_optionnelle(champ_brut, 'can_update')
    const prior_update  = lire_chaine_optionnelle(champ_brut, 'prior_update')
    const post_update   = lire_chaine_optionnelle(champ_brut, 'post_update')
    const prior_search  = lire_chaine_optionnelle(champ_brut, 'prior_search')
    const post_search   = lire_chaine_optionnelle(champ_brut, 'post_search')
    const alt           = lire_chaine_optionnelle(champ_brut, 'alt')

    const chars_bruts = champ_brut.chars ?? null
    const chars_str   = Array.isArray(chars_bruts) ? chars_bruts[0] : (chars_bruts ?? null)
    const chars       = analyser_chars(chars_str)

    const length_brut = champ_brut.length ?? null
    const length      = length_brut !== null ? analyser_taille(String(length_brut)) : null

    const champ = {
        name     : champ_brut.name,
        type     : type_res.type,
        min      : type_res.min,
        max      : type_res.max,
        nullable,
        size     : champ_brut.size !== undefined && champ_brut.size !== null ? analyser_taille(champ_brut.size) : null,
        default  : champ_brut.default ?? null,
        chars,
        length,
        treatment: type_res.treatment,
        rule,
        can_create,
        can_search,
        restrict_search,
        rev_can_search,
        rev_restrict_search,
        prior_create,
        post_create,
        can_update,
        prior_update,
        post_update,
        prior_search,
        post_search,
        alt
    }
    if (type_res.values)
        champ.values = type_res.values
    return champ
}

const transformer_modele = (annotations) =>
{
    const name_brut  = Array.isArray(annotations.name) ? annotations.name : [annotations.name]
    const nom_table  = name_brut[0]
    const nom_entree = name_brut[1] ?? null
    if (typeof nom_table !== 'string' || !/^\w+$/.test(nom_table))
        throw new Error(`@name : nom de table attendu, ex. @name [ profils, profil ], ${JSON.stringify(annotations.name)} trouvé`)
    if (nom_entree !== null && (typeof nom_entree !== 'string' || !/^\w+$/.test(nom_entree)))
        throw new Error(`@name : nom d'entrée invalide ${JSON.stringify(nom_entree)}`)

    const primary            = Array.isArray(annotations.primary) ? annotations.primary : []
    const unique             = (Array.isArray(annotations.unique) ? annotations.unique : []).filter(Array.isArray)
    const champs_dans_unique = [...primary, ...unique.flat()]
    const champs_bruts       = Array.isArray(annotations.fields) ? annotations.fields : []
    const rules_brutes       = annotations.rules ?? null
    const routes             = Array.isArray(annotations.routes) ? annotations.routes : []
    const script             = typeof annotations.script === 'string' ? annotations.script : null

    const champs    = []
    const relations = []
    const rules     = rules_brutes && typeof rules_brutes === 'object' && !Array.isArray(rules_brutes)
        ? {
            can_search      : lire_chaine_optionnelle(rules_brutes, 'can_search'),
            restrict_search : lire_chaine_optionnelle(rules_brutes, 'restrict_search'),
            prior_search    : lire_chaine_optionnelle(rules_brutes, 'prior_search'),
            post_search     : lire_chaine_optionnelle(rules_brutes, 'post_search'),
            restrict_update : lire_chaine_optionnelle(rules_brutes, 'restrict_update'),
            can_delete      : lire_chaine_optionnelle(rules_brutes, 'can_delete'),
            restrict_delete : lire_chaine_optionnelle(rules_brutes, 'restrict_delete'),
            prior_delete    : lire_chaine_optionnelle(rules_brutes, 'prior_delete'),
            post_delete     : lire_chaine_optionnelle(rules_brutes, 'post_delete')
        }
        : null

    for (const champ_brut of champs_bruts)
    {
        if (typeof champ_brut !== "object" || champ_brut === null || Array.isArray(champ_brut))
            throw new Error(`@fields : chaque champ s'écrit entre accolades { name : …, type : … }, ${JSON.stringify(champ_brut)} trouvé`)
        if (!champ_brut.name)
            throw new Error(`@fields : champ sans name (${JSON.stringify(champ_brut)})`)

        if (!champ_brut.type)
        {
            if (!champ_brut.count)
                throw new Error(`@fields : le champ \`${champ_brut.name}\` n'a ni type ni count (relation)`)
            const count = analyser_count(String(champ_brut.count))
            if (!count)
                throw new Error(`@fields : count invalide pour \`${champ_brut.name}\` : « ${champ_brut.count} » (format attendu : 0-1, 1-N, N-N…)`)
            relations.push({
                champ_source        : champ_brut.name,
                table_cible         : champ_brut.ref ?? champ_brut.name,
                entry               : typeof champ_brut.entry === 'string' ? champ_brut.entry : null,
                key                 : typeof champ_brut.key === 'string' ? champ_brut.key : null,
                champs_jonction     : Array.isArray(champ_brut.fields) ? champ_brut.fields : [],
                count               : String(champ_brut.count),
                min                 : count.min,
                max                 : count.max,
                can_search          : lire_chaine_optionnelle(champ_brut, 'can_search'),
                restrict_search     : lire_chaine_optionnelle(champ_brut, 'restrict_search'),
                rev_can_search      : lire_chaine_optionnelle(champ_brut, 'rev_can_search'),
                rev_restrict_search : lire_chaine_optionnelle(champ_brut, 'rev_restrict_search')
            })
            continue
        }

        const champ = transformer_champ(champ_brut, champs_dans_unique)
        if (champ === "invalide")
            throw new Error(`@fields : type inconnu pour \`${champ_brut.name}\` : « ${champ_brut.type} »`)
        champs.push(champ)
    }

    const modele = {
        name      : nom_table,
        entry_name: nom_entree,
        primary,
        unique,
        rules,
        fields    : champs,
        routes,
        script,
        _relations: relations
    }

    return modele
}

// ─── Résolution des relations ─────────────────────────────────────────────────

const trouver_champ_pk = (table) =>
{
    if (table.primary.length == 0)
        return null
    return table.fields.find(f => f.name == table.primary[0]) ?? null
}

// Décrit la table de jonction d'une relation N-N :
// - key désigne la colonne visée dans la table cible (par défaut, sa clef primaire). Si la clef
//   primaire de la cible est composée, key doit en être la première colonne : la relation vise
//   alors un groupe de lignes, et son intégrité est vérifiée par le magasin (pas de clef étrangère)
// - fields ajoute des colonnes à la table de jonction
const decrire_jonction = (table_source, table_cible, rel, relation) =>
{
    const nom_relation  = `${table_source.name}.${rel.champ_source}`
    const pk_source     = trouver_champ_pk(table_source)
    const colonne_cible = rel.key ?? table_cible.primary[0]

    if (rel.key && table_cible.primary[0] !== rel.key)
    {
        console.log(`/!\\ relation \`${nom_relation}\` ignorée : key doit être la première colonne de la clef primaire de \`${table_cible.name}\``)
        return null
    }

    const champ_cible = table_cible.fields.find(f => f.name == colonne_cible) ?? null
    const id_source   = `id_${table_source.entry_name ?? table_source.name}`
    const id_cible    = `id_${table_cible.entry_name  ?? table_cible.name}`

    const colonne_id = (nom, champ) => ({
        name     : nom,
        type     : champ?.type ?? 'int',
        min      : champ?.min  ?? null,
        max      : champ?.max  ?? null,
        nullable : false,
        treatment: null
    })

    const champs_supplementaires = []
    for (const brut of rel.champs_jonction)
    {
        const champ = typeof brut === 'object' && brut !== null && !Array.isArray(brut) && brut.type
            ? transformer_champ(brut, [])
            : "invalide"
        if (champ === "invalide" || champ.name === id_source || champ.name === id_cible)
        {
            console.log(`/!\\ relation \`${nom_relation}\` ignorée : champ de jonction invalide`)
            return null
        }
        champs_supplementaires.push(champ)
    }

    const groupe = Boolean(rel.key) && table_cible.primary.length > 1

    return {
        colonne_source : table_source.primary[0] ?? null,
        colonne_cible,
        cle_groupe     : groupe,
        modele_jonction: {
            name      : relation.table_jonction,
            entry_name: relation.table_jonction_entry,
            primary   : [id_source, id_cible],
            unique    : [],
            fields    : [colonne_id(id_source, pk_source), colonne_id(id_cible, champ_cible), ...champs_supplementaires],
            champs_jonction   : champs_supplementaires.map(c => c.name),
            references_groupes: groupe
                ? [{ colonne: id_cible, table: table_cible.name, cle: colonne_cible }]
                : []
        }
    }
}

const resoudre_relations = (tables) =>
{
    const index = {}
    for (const table of tables)
        index[table.name] = table

    const relations = []

    for (const table of tables)
    {
        for (const rel of table._relations)
        {
            const table_cible = index[rel.table_cible]
            if (!table_cible)
            {
                console.log(`/!\\ relation introuvable : \`${table.name}.${rel.champ_source}\` → \`${rel.table_cible}\``)
                continue
            }

            const relation = {
                table_source        : table.name,
                champ_source        : rel.champ_source,
                table_cible         : rel.table_cible,
                entry               : rel.entry,
                count               : rel.count,
                min                 : rel.min,
                max                 : rel.max,
                can_search          : rel.can_search ?? null,
                restrict_search     : rel.restrict_search ?? null,
                rev_can_search      : rel.rev_can_search ?? null,
                rev_restrict_search : rel.rev_restrict_search ?? null
            }

            if (rel.min === 'N' && rel.max === 'N')
            {
                const nom_source = table.entry_name ?? table.name
                relation.table_jonction       = `${rel.champ_source}_${table.name}`
                relation.table_jonction_entry = `${rel.entry ?? table_cible.entry_name ?? table_cible.name}_${nom_source}`

                const jonction = decrire_jonction(table, table_cible, rel, relation)
                if (!jonction)
                    continue
                Object.assign(relation, jonction)
            }
            else if (rel.key || rel.champs_jonction.length)
            {
                console.log(`/!\\ \`${table.name}.${rel.champ_source}\` : key et fields ne sont acceptés que sur une relation N-N`)
                continue
            }
            else if (rel.max === 'N')
            {
                const pk = trouver_champ_pk(table)
                if (pk)
                {
                    const nom_fk  = `id_${table.entry_name ?? table.name}`
                    const deja_la = table_cible.fields.some(f => f.name == nom_fk)
                    if (!deja_la)
                        table_cible.fields.push({
                            name     : nom_fk,
                            type     : pk.type,
                            min      : pk.min,
                            max      : pk.max,
                            nullable : false,
                            treatment: null
                        })
                    relation.cle_etrangere = nom_fk
                }
            }
            else
            {
                // Relation 0-1 / 1-1 : clef étrangère dans la table source
                const pk_cible = trouver_champ_pk(table_cible)
                if (pk_cible)
                {
                    const nom_fk = `id_${rel.entry ?? table_cible.entry_name ?? table_cible.name}`
                    // Un champ déclaré sous ce nom (par exemple pour lui donner can_create)
                    // est réutilisé comme clef étrangère
                    const existant = table.fields.find(f => f.name == nom_fk)
                    if (!existant)
                        table.fields.push({
                            name     : nom_fk,
                            type     : pk_cible.type,
                            min      : pk_cible.min,
                            max      : pk_cible.max,
                            nullable : rel.min === 0,
                            treatment: null
                        })
                    relation.cle_locale = nom_fk
                }
            }

            relations.push(relation)
        }
        delete table._relations
    }

    return relations
}

// ─── Chargement ───────────────────────────────────────────────────────────────

// Un fichier avec @name décrit une table ; les autres sont génériques
const ANNOTATIONS_TABLE     = ['primary', 'unique', 'fields', 'rules']
const ANNOTATIONS_GENERIQUE = ['actions', 'limits']

const fichiers = new WeakMap()

const situer = (contenu, pos) =>
{
    if (typeof pos !== 'number')
        return ''
    const lignes = contenu.slice(0, pos).split('\n')
    return ` (ligne ${lignes.length}, colonne ${lignes.at(-1).length + 1})`
}

export const lister_fonctions_script = (script) =>
    [...new Set([...(script ?? '').matchAll(/(\$\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)].map(m => m[1]))]

const lire_generique = (annotations, fichier) =>
{
    for (const clef of ANNOTATIONS_TABLE)
        if (annotations[clef] !== undefined)
            console.log(`/!\\ \`${fichier}\` : @${clef} ignoré, ce fichier n'a pas de @name (fichier générique)`)

    const liste = (clef) =>
    {
        const valeur = annotations[clef]
        if (valeur === undefined)
            return []
        if (Array.isArray(valeur))
            return valeur
        console.log(`/!\\ \`${fichier}\` : @${clef} ignoré, une liste [ … ] est attendue`)
        return []
    }

    return {
        fichier,
        script : typeof annotations.script === 'string' ? annotations.script : null,
        actions: liste('actions'),
        routes : liste('routes'),
        limits : liste('limits')
    }
}

const lire_dossier = (dossier, racine, tables, generiques) =>
{
    let entrees
    try
    {
        entrees = fs.readdirSync(dossier, { withFileTypes: true })
    }
    catch
    {
        console.log(`/!\\ dossier introuvable : ${dossier}`)
        return
    }

    entrees.sort((a, b) => a.name.localeCompare(b.name))

    for (const entree of entrees)
    {
        const chemin = path.join(dossier, entree.name)
        if (entree.isDirectory())
        {
            lire_dossier(chemin, racine, tables, generiques)
            continue
        }
        if (!entree.isFile() || !entree.name.endsWith('.sans'))
            continue

        const fichier = path.relative(racine, chemin).split(path.sep).join('/')
        let contenu
        try
        {
            contenu = fs.readFileSync(chemin, 'utf-8')
        }
        catch (err)
        {
            console.log(`/!\\ erreur lecture \`${fichier}\` : ${err.message}`)
            continue
        }

        try
        {
            const annotations = analyser_sans(contenu)
            if (annotations.name === undefined)
            {
                generiques.push(lire_generique(annotations, fichier))
                continue
            }

            for (const clef of ANNOTATIONS_GENERIQUE)
                if (annotations[clef] !== undefined)
                    console.log(`/!\\ \`${fichier}\` : @${clef} ignoré, réservé aux fichiers génériques (sans @name)`)

            const table = transformer_modele(annotations)
            const autre = tables.find(t => t.name === table.name || (t.entry_name ?? t.name) === (table.entry_name ?? table.name))
            if (autre)
            {
                console.log(`/!\\ modèle ignoré : \`${fichier}\` déclare la table \`${table.name}\`, dont le nom ou l'entrée est déjà pris par \`${fichiers.get(autre)}\``)
                continue
            }
            fichiers.set(table, fichier)
            tables.push(table)
        }
        catch (err)
        {
            console.log(`/!\\ modèle invalide : \`${fichier}\`${situer(contenu, err.pos)} : ${err.message}`)
        }
    }
}

// Les fichiers génériques forment un seul ensemble : chaque @script est placé dans son propre
// bloc, pour que ses déclarations internes (const…) ne se heurtent pas à celles des autres
const fusionner_generiques = (generiques) =>
{
    const scripts = generiques.filter(g => g.script)
    return {
        name   : 'index',
        script : scripts.length ? scripts.map(g => `{\n${g.script}\n}`).join('\n') : null,
        actions: generiques.flatMap(g => g.actions),
        routes : generiques.flatMap(g => g.routes),
        limits : generiques.flatMap(g => g.limits)
    }
}

const lister_hooks_modele = (table) =>
{
    const hooks = []
    for (const champ of table.fields)
        for (const clef of ['prior_create', 'post_create', 'prior_update', 'post_update', 'prior_search', 'post_search'])
            if (champ[clef])
                hooks.push({ action: champ[clef], etiquette: `${clef} du champ \`${champ.name}\`` })
    for (const clef of ['prior_search', 'post_search', 'prior_delete', 'post_delete'])
        if (table.rules?.[clef])
            hooks.push({ action: table.rules[clef], etiquette: `${clef} de @rules` })
    for (const route of table.routes)
        hooks.push({ action: route.action, etiquette: `action de la route ${route.path}` })
    return hooks
}

const lister_hooks_generique = (generique) =>
{
    const hooks = []
    for (const action of generique.actions)
        for (const clef of ['prior_run', 'periodically', 'prior_respond', 'post_respond'])
            if (action?.[clef])
                hooks.push({ action: action[clef], etiquette: `${clef} de @actions` })
    for (const route of generique.routes)
        hooks.push({ action: route?.action, etiquette: `action de la route ${route?.path}` })
    return hooks
}

// Un hook de table n'appelle que les fonctions du @script de son fichier, un hook générique
// celles de tous les fichiers génériques : le signaler au démarrage plutôt qu'à la première requête
const verifier_hooks = (tables, generiques) =>
{
    const origines_generiques = new Map()
    for (const generique of generiques)
        for (const nom of lister_fonctions_script(generique.script))
        {
            if (origines_generiques.has(nom))
                console.log(`/!\\ \`${generique.fichier}\` : ${nom} est déjà définie dans \`${origines_generiques.get(nom)}\``)
            else
                origines_generiques.set(nom, generique.fichier)
        }

    const origines_tables = new Map()
    for (const table of tables)
        for (const nom of lister_fonctions_script(table.script))
            origines_tables.set(nom, fichiers.get(table))

    const verifier = (fichier, hooks, fonctions, ailleurs, portee) =>
    {
        for (const { action, etiquette } of hooks)
        {
            const prefixe = `/!\\ \`${fichier}\`, ${etiquette}`
            const match   = typeof action === 'string' ? /^(\$\w+)\(([^)]*)\)$/.exec(action.trim()) : null
            if (!match)
            {
                console.log(`${prefixe} : action invalide « ${action ?? ''} » (format attendu : $fonction($arg, …), entre guillemets s'il y a plusieurs arguments)`)
                continue
            }
            if (fonctions.has(match[1]))
                continue
            const autre = ailleurs(match[1])
            console.log(autre
                ? `${prefixe} : ${match[1]} est définie dans \`${autre.fichier}\`, or ${portee}${autre.generique ? ' (l\'appeler depuis une fonction de ce @script)' : ''}`
                : `${prefixe} : fonction ${match[1]} introuvable (${portee})`)
        }
    }

    const dans_generiques = (nom) => origines_generiques.has(nom) ? { fichier: origines_generiques.get(nom), generique: true } : null
    const dans_tables     = (nom) => origines_tables.has(nom) ? { fichier: origines_tables.get(nom), generique: false } : null

    for (const table of tables)
        verifier(fichiers.get(table), lister_hooks_modele(table), new Set(lister_fonctions_script(table.script)),
            nom => dans_generiques(nom) ?? dans_tables(nom),
            'un hook de table n\'appelle que les fonctions du @script de son propre fichier')

    const fonctions_generiques = new Set(origines_generiques.keys())
    for (const generique of generiques)
        verifier(generique.fichier, lister_hooks_generique(generique), fonctions_generiques, dans_tables,
            'un hook générique n\'appelle que les fonctions des fichiers génériques (sans @name)')
}

export const charger_modeles = (dossier) =>
{
    const tables     = []
    const generiques = []
    lire_dossier(dossier, dossier, tables, generiques)
    const relations = resoudre_relations(tables)

    verifier_hooks(tables, generiques)

    const index = generiques.length ? fusionner_generiques(generiques) : null

    return { tables, relations, noms_connus: new Set(), index }
}
