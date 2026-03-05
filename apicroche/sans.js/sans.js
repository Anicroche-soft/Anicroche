import http from "http"
import path from "path"
import fs   from "fs"

import {generer_adn}    from "./analyseur_adn.js"
import {charger_modeles} from "./analyseur_sans.js"
import {construire_base} from "./batisseur.js"

console.log(`\
╔══════╗
║ SANS ║
╚══════╝`)

const adn     = generer_adn()
const schemas = charger_modeles("adn/modeles")

const afficher_schemas = ({ tables, relations }) =>
{
    const pad = (str, n) => str + ' '.repeat(Math.max(0, n - str.length))

    const formater_type = (champ) =>
    {
        const { type, min, max } = champ
        if (min === null && max === null)
            return type
        if (min === max)
            return `${type}(${min})`
        return `${type}(${min}, ${max})`
    }

    console.log(`\nSchéma — ${tables.length} table(s), ${relations.length} relation(s)\n`)

    for (const table of tables)
    {
        const titre = table.entry_name
            ? `TABLE ${table.name}  (entrée : ${table.entry_name})`
            : `TABLE ${table.name}`
        console.log(titre)

        if (table.primary.length > 0)
            console.log(`  Clef primaire : ${table.primary.join(', ')}`)

        if (table.unique.length > 0)
        {
            for (const contrainte of table.unique)
                console.log(`  Contrainte unique : [ ${contrainte.join(', ')} ]`)
        }

        if (table.fields.length > 0)
        {
            console.log('  Champs :')
            const largeur_nom  = Math.max(...table.fields.map(f => f.nullable ? f.name.length + 2 : f.name.length))
            const largeur_type = Math.max(...table.fields.map(f => formater_type(f).length))

            for (const champ of table.fields)
            {
                const nom_affiche = champ.nullable ? `(${champ.name})` : champ.name
                let ligne = `    ${pad(nom_affiche, largeur_nom)}  ${pad(formater_type(champ), largeur_type)}`
                if (champ.treatment)
                    ligne += `  → ${champ.treatment}`
                if (champ.values)
                    ligne += `  [ ${champ.values.join(' | ')} ]`
                console.log(ligne)
            }
        }
        console.log('')
    }

    if (relations.length > 0)
    {
        console.log('Relations :')
        for (const rel of relations)
        {
            let ligne = `  ${rel.table_source}.${rel.champ_source} → ${rel.table_cible}  [${rel.count}]`
            if (rel.cle_etrangere)
                ligne += `  (FK : ${rel.cle_etrangere})`
            if (rel.table_jonction)
                ligne += `  (jonction : ${rel.table_jonction})`
            console.log(ligne)
        }
        console.log('')
    }
}

afficher_schemas(schemas)

await construire_base(schemas)

const types_mime = {
    ".json":  "application/json",
    ".txt":   "text/plain",
    ".pdf":   "application/pdf",

    ".ico":   "image/x-icon",
    ".png":   "image/png",
    ".jpg":   "image/jpeg",
    ".jpeg":  "image/jpeg",
    ".svg":   "image/svg+xml",

    ".mp3":   "audio/mpeg",
    ".mp4":   "video/mp4",

    ".ttf":   "font/ttf",
    ".otf":   "font/otf",
    ".woff":  "font/woff",
    ".woff2": "font/woff2"
}

const types_utf8 = [
    ".json",
    ".txt"
]

const rechercher_fichier = (dossier, nom, recursif) =>
{
    const fichiers = fs.readdirSync(dossier, {withFileTypes: true})

    for (const fichier of fichiers)
    {
        const chemin_complet = path.join(dossier, fichier.name)
        if (fichier.isFile() && fichier.name === nom)
            return (chemin_complet)
        if (fichier.isDirectory() && recursif)
        {
            const trouve = rechercher_fichier(chemin_complet, nom, recursif)
            if (trouve)
                return trouve
        }
    }
    return (false)
}

const repondre_json = (rep, statut, corps) =>
{
    rep.writeHead(statut, {"Content-Type": "application/json; charset=utf-8"})
    rep.end(JSON.stringify(corps))
}

const serveur = http.createServer(async (req, rep) =>
    {
        if (req.url.startsWith("/depot/"))
        {
            const nom = path.basename(req.url)
            const chemin_reel = rechercher_fichier("depot", nom, true)

            if (chemin_reel)
            {
                const ext = path.extname(nom).toLowerCase()
                let contenu
                if (types_utf8.includes(ext))
                    contenu = fs.readFileSync(chemin_reel, "utf-8")
                else
                    contenu = fs.readFileSync(chemin_reel)
                let type = types_mime[ext] || "application/octet-stream"
                if (types_utf8.includes(ext))
                    type += "; charset=utf-8"
                rep.writeHead(200, {"Content-Type": type})
                rep.end(contenu)
            }
            else
            {
                repondre_json(rep, 404, {erreur: "Fichier introuvable"})
            }
            return
        }

        repondre_json(rep, 200, {message: `Bienvenue sur l'API ${adn.nom || "sans.js"}`})
    }
)

serveur.listen(adn.port, () =>
    {
        console.log(`Serveur en route sur le port ${adn.port}`)
    }
)
