import http from "http"
import path from "path"
import fs   from "fs"

import {generer_adn} from "./analyseur_adn.js"
import {analyser_avec} from "./analyseur_avec.js"

console.log(`\
╔══════╗
║ AVEC ║
╚══════╝`)

const adn = generer_adn()

const composants = {
    "/systeme": {
        chemin: "avec.js/scripts",
    },
    "/composants/modeles": {
        chemin: "adn/modeles",
        recursif: true,
        composant: true,
        script: analyser_avec,
        ext: ".json"
    }
}

const types_mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4"
}

const types_utf8 = [
    ".html",
    ".css",
    ".js",
    ".json"
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

const serveur = http.createServer((req, rep) =>
    {
        let chemin = "avec.js/index.html"
        let infos = null
        for (const prefixe in composants)
        {
            if (req.url.startsWith(`${prefixe}/`)
             && (!composants[prefixe].composant
              || req.headers['x-ac-composant'] === `true`))
            {
                chemin = `${composants[prefixe].chemin}${req.url.slice(prefixe.length)}`
                infos = composants[prefixe]
                break
            }
        }
        const chemin_complet = path.join("./", chemin)
        const dossier = path.dirname(chemin_complet)
        const fichier = path.basename(chemin_complet)
        const chemin_reel = rechercher_fichier(dossier, fichier, infos?.recursif)

        if (chemin_reel)
        {
            let contenu = fs.readFileSync(chemin_reel, "utf-8")
            if (typeof infos?.script === "function")
            {
                try {
                    contenu = infos.script(contenu)
                } catch (erreur) {
                    console.error(erreur)
                    rep.writeHead(500)
                    rep.end("Erreur serveur")
                    return
                }
            }
            const ext = infos?.ext || path.extname(chemin).toLowerCase()
            let type = types_mime[ext] || "application/octet-stream"
            if (types_utf8.includes(ext))
            {
                type += "; charset=utf-8"
            }
            rep.writeHead(200, {"Content-Type": type})
            rep.end(contenu)
        }
        else
        {
            rep.writeHead(500)
            rep.end("Erreur serveur")
            return
        }
    }
)

serveur.listen(adn.port, () =>
    {
        console.log(`Serveur en route sur le port ${adn.port}`)
    }
)
