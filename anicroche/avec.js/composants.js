import path from "path"
import fs   from "fs"

import {analyser_adn}  from "./analyseur_adn.js"
import {analyser_avec} from "./analyseur_avec.js"

// Version du site, lue à chaque demande du service worker : la variable d'environnement
// `app_version`, sinon la clef `version` de `config` dans app.adn, sinon l'heure de démarrage
// du serveur (le cache est alors renouvelé à chaque démarrage). En mode dev, un suffixe tiré
// des dates de modification de adn/ et avec.js/ la change à chaque modification d'un fichier
const DEMARRAGE = `demarrage-${Date.now()}`

const lire_version_configuree = () =>
{
    if (process.env.app_version)
        return process.env.app_version
    try
    {
        const version = analyser_adn(fs.readFileSync("adn/app.adn", "utf8"))?.config?.version
        if (version !== undefined && version !== null && String(version).length > 0)
            return String(version)
    }
    catch (erreur)
    {
    }
    return DEMARRAGE
}

// Date de modification la plus récente et nombre de fichiers d'un dossier (récursivement)
const parcourir_modifications = (dossier, etat = {date: 0, nombre: 0}) =>
{
    for (const entree of fs.readdirSync(dossier, {withFileTypes: true}))
    {
        const chemin = path.join(dossier, entree.name)
        if (entree.isDirectory())
            parcourir_modifications(chemin, etat)
        else if (entree.isFile())
        {
            etat.date = Math.max(etat.date, fs.statSync(chemin).mtimeMs)
            etat.nombre++
        }
    }
    return etat
}

const suffixe_dev = () =>
{
    if ((process.env.mode || `prod`) !== `dev`)
        return ``
    try
    {
        const adn    = parcourir_modifications("adn")
        const moteur = parcourir_modifications("avec.js")
        const empreinte = Math.round(Math.max(adn.date, moteur.date)).toString(36)
            + (adn.nombre + moteur.nombre).toString(36)
        return `-dev.${empreinte}`
    }
    catch (erreur)
    {
        return `-dev`
    }
}

const lire_version = () => lire_version_configuree() + suffixe_dev()

// Le navigateur installe un nouveau service worker dès que son fichier change :
// la version du site y est insérée à la place de la marque __VERSION__
const inserer_version = (contenu, fichier) =>
    fichier === "service-worker.js"
        ? contenu.replaceAll("__VERSION__", lire_version())
        : contenu

// Préfixes servis tels quels ; ceux marqués « composant » ne le sont qu'aux requêtes
// portant l'en-tête X-AC-Composant (les autres reçoivent la page)
const composants = {
    "/robots.txt": {
        chemin: "adn/robots.txt",
    },
    "/systeme/app.adn": {
        chemin: "adn/app.adn",
        composant: true,
        script: analyser_adn,
        ext: ".json",
        env_supp: ['api_url', 'app_url']
    },
    "/systeme/scripts": {
        chemin: "avec.js/scripts",
        script: inserer_version
    },
    "/systeme/modeles": {
        chemin: "adn/modeles",
        recursif: true,
        composant: true,
        script: analyser_avec,
        ext: ".json"
    },
    "/systeme/images": {
        chemin: "adn/images",
        recursif: true
    },
    "/systeme/fontes": {
        chemin: "adn/fontes",
        recursif: true
    },
    "/systeme/app.webmanifest": {
        chemin: "adn/app.webmanifest"
    }
}

const types_mime = {
    ".html":  "text/html",
    ".css":   "text/css",
    ".js":    "application/javascript",
    ".json":  "application/json",
    ".txt":   "text/plain",

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
    ".html",
    ".css",
    ".js",
    ".json",
    ".txt"
]

export const rechercher_fichier = (dossier, nom, recursif) =>
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

// Ajoute à un composant JSON les variables d'environnement demandées par `env_supp`
const completer_environnement = (contenu, clefs) =>
{
    let json = contenu
    if (typeof contenu === "string")
    {
        try
        {
            json = JSON.parse(contenu)
        }
        catch (erreur)
        {
            return contenu
        }
    }
    if (!json || typeof json !== "object" || Array.isArray(json) || Buffer.isBuffer(json))
        return contenu

    for (const clef of clefs)
    {
        if (typeof clef === "string" && clef.length > 0 && process.env[clef] !== undefined)
            json[clef] = process.env[clef]
    }
    return json
}

// Résout une requête vers un fichier du projet.
// Renvoie { page: true } si l'adresse correspond à une page de l'application,
// { statut: 500 } si le fichier n'existe pas, sinon { statut: 200, type, contenu }
export const resoudre_composant = (url, entetes = {}) =>
{
    let chemin = null
    let infos  = null
    for (const prefixe in composants)
    {
        if ((url.startsWith(`${prefixe}/`) || url === prefixe)
         && (!composants[prefixe].composant
          || entetes['x-ac-composant'] === `true`))
        {
            chemin = url === prefixe
                ? composants[prefixe].chemin
                : `${composants[prefixe].chemin}${url.slice(prefixe.length)}`
            infos = composants[prefixe]
            break
        }
    }
    if (!infos)
        return {page: true}

    const chemin_complet = path.join("./", decodeURIComponent(chemin.split('?')[0]))
    const dossier = path.dirname(chemin_complet)
    const fichier = path.basename(chemin_complet)
    const racine  = path.resolve(infos.chemin)
    const autorise = path.resolve(chemin_complet) === racine
        || path.resolve(chemin_complet).startsWith(racine + path.sep)
    const chemin_reel = autorise && fs.existsSync(dossier) && rechercher_fichier(dossier, fichier, infos.recursif)

    if (!chemin_reel)
        return {statut: 500}

    const ext = infos.ext || path.extname(chemin).toLowerCase()
    let contenu = types_utf8.includes(ext)
        ? fs.readFileSync(chemin_reel, "utf-8")
        : fs.readFileSync(chemin_reel)

    if (typeof infos.script === "function")
        contenu = infos.script(contenu, fichier, {headers: entetes})

    if (ext === ".json" && Array.isArray(infos.env_supp) && infos.env_supp.length > 0)
        contenu = completer_environnement(contenu, infos.env_supp)

    if (ext === ".json"
     && typeof contenu === "object"
     && !Buffer.isBuffer(contenu)
     && !(contenu instanceof Uint8Array))
        contenu = JSON.stringify(contenu)

    let type = types_mime[ext] || "application/octet-stream"
    if (types_utf8.includes(ext))
        type += "; charset=utf-8"

    return {statut: 200, type, contenu}
}
