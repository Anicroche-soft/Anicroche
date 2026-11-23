// Déploiement hors Docker avec PM2 : pm2 startOrReload ecosystem.config.cjs
// Sur un Serveur Cloud Infomaniak, seuls les ports 4000 à 4009 peuvent recevoir le trafic du site
const path             = require("path")
const { execFileSync } = require("child_process")

// Version du site (voir version.sh), calculée à chaque (re)lancement et transmise à avec.js
const lire_version = () =>
{
    try
    {
        return execFileSync("sh", [path.join(__dirname, "version.sh")], { encoding: "utf8" }).trim()
    }
    catch (erreur)
    {
        return ""
    }
}

module.exports = {
    apps: [
        {
            name   : "anicroche",
            cwd    : path.join(__dirname, "anicroche"),
            script : "npm",
            args   : "start",
            env    : { PORT: 4004, app_version: lire_version() }
        },
        {
            name   : "apicroche",
            cwd    : path.join(__dirname, "apicroche"),
            script : "npm",
            args   : "start",
            env    : { PORT: 4005 }
        }
    ]
}
