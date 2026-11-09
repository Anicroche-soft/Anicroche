// Déploiement hors Docker avec PM2 : pm2 startOrReload ecosystem.config.cjs
// Sur un Serveur Cloud Infomaniak, seuls les ports 4000 à 4009 peuvent recevoir le trafic du site
const path = require("path")

module.exports = {
    apps: [
        {
            name   : "anicroche",
            cwd    : path.join(__dirname, "anicroche"),
            script : "npm",
            args   : "start",
            env    : { PORT: 4004 }
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
