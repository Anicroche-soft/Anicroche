import fs   from "fs"
import path from "path"

// Hors Docker (hébergement sans conteneur), le .env n'est pas injecté : on le lit nous-mêmes,
// sans écraser les variables déjà fournies (PORT du Manager, env_file de Docker…)
const charger_environnement = () =>
{
    const chemin = [".env", "../.env"]
        .map((fichier) => path.resolve(fichier))
        .find((fichier) => fs.existsSync(fichier))
    if (!chemin)
        return

    for (const ligne of fs.readFileSync(chemin, "utf8").split(/\r?\n/))
    {
        const correspondance = ligne.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/)
        if (!correspondance || correspondance[1] in process.env)
            continue
        let valeur = correspondance[2]
        if (/^(["']).*\1$/.test(valeur))
            valeur = valeur.slice(1, -1)
        process.env[correspondance[1]] = valeur
    }
    console.log(`Variables d'environnement lues dans ${chemin}`)
}

charger_environnement()
