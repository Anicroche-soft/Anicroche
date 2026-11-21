import fs   from "fs"

const analyser_clef_adn = (str) =>
{
    let clef = ""
    let bloc = ''
    let pos = 0
    while (pos < str.length)
    {
        if (str[pos] == bloc)
            bloc = ''
        else if (/^["'`]$/.test(str[pos]) && bloc == '')
            bloc = str[pos]
        else if (/^[a-zA-Z0-9_-]$/.test(str[pos]))
            clef += str[pos]
        else
            return ("invalide")
        pos++
    }
    return (clef)
}

// Les booléens s'écrivent :) et :( : leur parenthèse n'ouvre ni ne ferme aucun bloc
const est_booleen = (str, pos, dans_chaine) =>
    !dans_chaine && str[pos] == ':' && (str[pos + 1] == ')' || str[pos + 1] == '(')

const analyser_valeur_adn = (str) =>
{
    if (str[0] == '{' && str.slice(-1) == '}')
        return (analyser_bloc_adn(str.slice(1, -1), "dict"))
    if (str[0] == '[' && str.slice(-1) == ']')
        return (analyser_bloc_adn(str.slice(1, -1), "list"))
    if (str == ':)')
        return (true)
    if (str == ':(')
        return (false)

    let valeur = ""
    let bloc = ''
    let pos = 0
    while (pos <str.length)
    {
        if (str[pos] == bloc)
            bloc = ''
        else if (/^["'`]$/.test(str[pos]) && bloc == '')
            bloc = str[pos]
        else if (/^\s$/.test(str[pos]) && bloc == '')
        {
            if (valeur.length > 0 && !/^\s$/.test(valeur.slice(-1)))
                valeur += ' '
        }
        else
            valeur += str[pos]
        pos++
    }

    if (/^[+-]?[0-9](?:_?[0-9]+)*$/.test(valeur))
    {
        valeur = Number(valeur.replace(/_/g, ""))
    }
    return (valeur)
}

const analyser_brin_adn = (str, adn) =>
{
    if (/^[\s]*$/.test(str))
        return (adn)
    if (str.slice(-1) == '\n')
        str = str. slice(0, -1)
    let valeurs = []

    let fini = str.length == 0 ? true : false
    let blocs = ''
    let debut = 0
    while (!fini)
    {
        let dans_chaine = false
        let fin = debut
        while (str[fin] != ':' || est_booleen(str, fin, dans_chaine) || blocs != '' || valeurs.length > 0)
        {
            if (est_booleen(str, fin, dans_chaine))
                fin++
            else if (str[fin] == blocs.slice(-1))
            {
                blocs = blocs.slice(0, -1)
                dans_chaine = false
            }
            else if (str[fin] == '(' && !dans_chaine)
                blocs += ')'
            else if (str[fin] == '[' && !dans_chaine)
                blocs += ']'
            else if (str[fin] == '{' && !dans_chaine)
                blocs += '}'
            else if (str[fin] == '<' && !dans_chaine)
                blocs += '>'
            else if (str[fin] == '\"' && !dans_chaine)
            {
                blocs += '\"'
                dans_chaine = true
            }
            else if (str[fin] == '\'' && !dans_chaine)
            {
                blocs += '\''
                dans_chaine = true
            }
            else if (str[fin] == '\`' && !dans_chaine)
            {
                blocs += '\`'
                dans_chaine = true
            }
            else if (str[fin] == ')' || str[fin] == ']' || str[fin] == '}' || str[fin] == '>')
            {
                if (!dans_chaine)
                    return ("invalide")
            }
            if (fin >= str.length - 1)
            {
                if (blocs != '')
                    return ("invalide")
                fini = true
                break
            }
            fin++
        }
        let valeur = str.substring(debut, fin + 1)
        if (valeur.slice(-1) == ':' && !fini)
            valeur = valeur.slice(0, -1)
        valeurs.push(valeur.trim())
        debut = fin + 1;
    }

    if (valeurs.length == 2 && typeof adn === "object" && adn != null && !Array.isArray(adn))
    {
        let clef = analyser_clef_adn(valeurs[0])
        let valeur = analyser_valeur_adn(valeurs[1])
        if (clef == "invalide" || valeur == "invalide")
            return ("invalide")
        adn[clef] = valeur;
    }
    else if (valeurs.length == 1 && Array.isArray(adn))
    {
        let valeur = analyser_valeur_adn(valeurs[0])
        if (valeur == "invalide")
            return ("invalide")
        adn.push(valeur);
    }
    else
        adn = "invalide"
    return (adn)
}

// Les éléments d'une liste ou d'un dictionnaire sont séparés par un retour à la ligne ou une
// virgule ([ a, b ], { a : 1, b : 2 })
const est_separateur = (str, pos) =>
    str[pos] == '\n' || str[pos] == ','

const analyser_bloc_adn = (str, type) =>
{
    let adn
    if (type == "dict")
        adn = {}
    if (type == "list")
        adn = []

    let fini = str.length == 0 ? true : false
    let blocs = ''
    let debut = 0
    while (!fini)
    {
        let dans_chaine = false
        let fin = debut
        while (!est_separateur(str, fin) || blocs != '')
        {
            if (est_booleen(str, fin, dans_chaine))
                fin++
            else if (str[fin] == blocs.slice(-1))
            {
                blocs = blocs.slice(0, -1)
                dans_chaine = false
            }
            else if (str[fin] == '(' && !dans_chaine)
                blocs += ')'
            else if (str[fin] == '[' && !dans_chaine)
                blocs += ']'
            else if (str[fin] == '{' && !dans_chaine)
                blocs += '}'
            else if (str[fin] == '<' && !dans_chaine)
                blocs += '>'
            else if (str[fin] == '\"' && !dans_chaine)
            {
                blocs += '\"'
                dans_chaine = true
            }
            else if (str[fin] == '\'' && !dans_chaine)
            {
                blocs += '\''
                dans_chaine = true
            }
            else if (str[fin] == '\`' && !dans_chaine)
            {
                blocs += '\`'
                dans_chaine = true
            }
            else if (str[fin] == ')' || str[fin] == ']' || str[fin] == '}' || str[fin] == '>')
            {
                if (!dans_chaine)
                    return ("invalide")
            }
            if (fin >= str.length - 1)
            {
                if (blocs != '')
                    return ("invalide")
                fini = true
                break
            }
            fin++
        }
        let brin = str.substring(debut, fin + 1)
        if (brin.slice(-1) == ',')
            brin = brin.slice(0, -1)
        adn = analyser_brin_adn(brin, adn)
        if (adn == "invalide")
            return ("invalide")
        debut = fin + 1;
    }
    return (adn);
}

export const analyser_adn = (str) =>
{
    return (analyser_bloc_adn(str, "dict"))
}

export const generer_adn = () =>
{
    let adn = {}
    try
    {
        const app_adn = fs.readFileSync("adn/app.adn", "utf8")
        adn = analyser_adn(app_adn)
        if (adn == "invalide")
        {
            adn = {}
            console.log("/!\\ fichier `app.adn` invalide")
        }
    }
    catch (error)
    {
        console.log("/!\\ fichier `app.adn` manquant")
    }

    console.log(adn)

    if (!("port" in adn))
        adn["port"] = process.env.PORT || 4030;

    return adn
}
