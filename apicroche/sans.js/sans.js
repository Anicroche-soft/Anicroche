import http from "http"
import path from "path"
import fs   from "fs"

import {generer_adn} from "./analyseur_adn.js"

console.log(`\
╔══════╗
║ SANS ║
╚══════╝`)

const adn = generer_adn()

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
