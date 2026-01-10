import fs   from "fs"

import {rechercher_fichier} from "./avec.js"

const erreur = (message, fichier, str, pos) =>
{
    let ligne = 1
    let colonne = 1
    for (let i = 0; i < pos; i++)
    {
        if (str[i] == '\n')
        {
            ligne++
            colonne = 1
        }
        else
            colonne++
    }
    throw new Error(`Analyseur .avec : ${fichier} ${ligne},${colonne} : ${message}`)
}

const debug = (message, str, deb, fin, json) =>
{
    let ligne_deb = 1
    let colonne_deb = 1
    for (let i = 0; i < deb; i++)
    {
        if (str[i] == '\n')
        {
            ligne_deb++
            colonne_deb = 1
        }
        else
            colonne_deb++
    }
    let ligne_fin = 1
    let colonne_fin = 1
    for (let i = 0; i < fin; i++)
    {
        if (str[i] == '\n')
        {
            ligne_fin++
            colonne_fin = 1
        }
        else
            colonne_fin++
    }
    let ind = ''
    for (let i = 0; i < json; i++) {
        ind += '    '
    }
    // console.log(`DEBUG: Analyseur .avec :${ind} ${message} : ${ligne_deb}:${colonne_deb} - ${ligne_fin}:${colonne_fin}`)
}

const valider_bloc_avec = (bloc, str, pos, fichier) =>
{
    if (bloc.type == 'instruction')
    {
        if (bloc.args[0] == `@style` || bloc.args[0] == `@script` || bloc.args[0] == `@args`)
        {
            if (bloc.args.length != 2)
                erreur(`${bloc.args[0]} doit avoir un argument : ${bloc.args[0]} [${bloc.args[0].slice(1)}]`, fichier, str, pos)
            if (bloc.enfants.length > 0)
                erreur(`${bloc.args[0]} ne doit pas avoir d'enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@if` || bloc.args[0] == `@else-if` || bloc.args[0] == `@unless` || bloc.args[0] == `@while` || bloc.args[0] == `@until`)
        {
            if (bloc.args.length != 2)
                erreur(`${bloc.args[0]} doit avoir un argument : ${bloc.args[0]} [condition]`, fichier, str, pos)
            if (bloc.enfants.length <= 0)
                erreur(`${bloc.args[0]} doit avoir au moins un enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@else`)
        {
            if (bloc.args.length != 1)
                erreur(`${bloc.args[0]} ne doit pas avoir d'argument : ${bloc.args[0]}`, fichier, str, pos)
            if (bloc.enfants.length <= 0)
                erreur(`${bloc.args[0]} doit avoir au moins un enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@repeat`)
        {
            if (bloc.args.length > 2)
                erreur(`${bloc.args[0]} peut avoir un argument : ${bloc.args[0]} ([nombre])`, fichier, str, pos)
            if (bloc.enfants.length <= 0)
                erreur(`${bloc.args[0]} doit avoir au moins un enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@for`)
        {
            if (bloc.args.length != 4 || (bloc.args[2] != 'in' && bloc.args[0] != 'of'))
                erreur(`${bloc.args[0]} doit avoir trois arguments : ${bloc.args[0]} [variable] in|of [variable]`, fichier, str, pos)
            if (bloc.enfants.length <= 0)
                erreur(`${bloc.args[0]} doit avoir au moins un enfant`, fichier, str, pos)
        }
        else if (bloc.args[0] == `@stud`)
        {
            if (bloc.args.length != 1)
                erreur(`${bloc.args[0]} ne doit pas avoir d'argument : ${bloc.args[0]}`, fichier, str, pos)
            if (bloc.enfants.length > 0)
                erreur(`${bloc.args[0]} ne doit pas avoir d'enfant`, fichier, str, pos)
        }
        else
            erreur(`${bloc.args[0]} n'est pas reconnu comme instruction`, fichier, str, pos)
    }
    else if (bloc.type == 'balise')
    {
        let balise = "";
        for (let i = 1; !/^[ >]$/.test(bloc.args[0][i]); i++)
            balise += bloc.args[0][i]

        let balises_interdites = ['!DOCTYPE', 'html', 'head', 'body', 'title', 'base', 'meta', 'link', 'noscript', 'script', 'style']
        let balises_sans_enfant = ['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'param', 'source', 'track', 'wbr']

        if (bloc.args.length != 1)
            erreur(`<${balise}> ne peut pas avoir d'argument`, fichier, str, pos)
        if (balises_interdites.includes(balise))
            erreur(`<${balise}> est une balise interdite`, fichier, str, pos)
        if (balises_sans_enfant.includes(balise) && bloc.enfants.length > 0)
            erreur(`<${balise}> ne peut pas avoir d'enfants`, fichier, str, pos)
    }
    else if (bloc.type == 'texte')
    {
        if (bloc.args.length != 1)
            erreur(`un texte ne peut pas avoir d'argument`, fichier, str, pos)
        if (bloc.enfants.length > 0)
            erreur(`un texte ne peut pas avoir d'enfants`, fichier, str, pos)
    }
    else if (bloc.type == 'modele')
    {
        return
    }
    else
        erreur("Syntaxe incorrecte", fichier, str, pos)
}

const analyser_bloc_avec = (str, deb, fin, fichier, json) =>
{
    debug("Bloc", str, deb, fin, json)
    let bloc = {
        type: undefined,
        args: [],
        enfants: []
    }

    let indentation = 0
    while (str[deb + indentation] == ' ')
        indentation++
    let pos = deb + indentation

    if (str[pos] == '\t')
        return erreur("Indentation par tabulations interdite", fichier, str, pos)
    if (str[pos] == '\n' || str[pos] == '#')
        return null

    let fini = pos > fin ? true : false
    let blocs = ''
    let deb_mot = pos
    while (!fini)
    {
        // console.log('(3)')
        while (!/^[ \n]$/.test(str[pos]) || blocs != '')
        {
            // console.log('(4)')
            if (str[pos] == blocs.slice(-1))
                blocs = blocs.slice(0, -1)
            else if (str[pos] == '(' && !/^["'`]$/.test(blocs.slice(-1)))
                blocs += ')'
            else if (str[pos] == '[' && !/^["'`]$/.test(blocs.slice(-1)))
                blocs += ']'
            else if (str[pos] == '{' && !/^["'`]$/.test(blocs.slice(-1)))
                blocs += '}'
            else if (str[pos] == '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
                blocs += '>'
            else if (str[pos] == '\"' && !/^["'`]$/.test(blocs.slice(-1)))
                blocs += '\"'
            else if (str[pos] == '\'' && !/^["'`]$/.test(blocs.slice(-1)))
                blocs += '\''
            else if (str[pos] == '\`' && !/^["'`]$/.test(blocs.slice(-1)))
                blocs += '\`'
            else if (str[pos] == ')' || str[pos] == ']' || str[pos] == '}')
            {
                if (!/^["'`]$/.test(blocs.slice(-1)))
                    return erreur("Fermeture de bloc inattendue", fichier, str, pos)
            }
            else if (str[pos] == '>')
            {
                if (!/^[)\]}>"'`]$/.test(blocs.slice(-1)))
                    return erreur("Fermeture de bloc inattendue", fichier, str, pos)
            }
            if (pos >= fin)
            {
                if (blocs != '')
                    return erreur("Fermeture de bloc manquante", str, fichier, fin + 1)
                fini = true
                break
            }
            pos++
        }
        let mot = str.substring(deb_mot, pos + 1).trim()
        if (mot.length > 0)
            bloc.args.push(mot)
        if (str[pos] == '\n')
            fini = true
        else
            deb_mot = ++pos;
    }
    if (!bloc.args[0])
        return null
    else if (bloc.args[0][0] == '@')
    {
        bloc.type = 'instruction'
    }
    else if (bloc.args[0][0] == '<')
    {
        bloc.type = 'balise'
    }
    else if (/^["'`]$/.test(bloc.args[0][0]))
    {
        bloc.type = 'texte'
    }
    else if (/^[a-zA-Z]$/.test(bloc.args[0][0]))
    {
        bloc.type = 'modele'
        if (!json.dependances[bloc.args[0]])
        {
            if (analyser_dependance(bloc.args[0], json) != 0)
            {
                return erreur("Chargement du modèle impossible", fichier, str, deb + indentation)
            }
        }
    }
    if (pos < fin)
        bloc.enfants = analyser_enfants_avec(str, pos + 1, fin, fichier, json)
    valider_bloc_avec(bloc, str, deb + indentation, fichier)
    return bloc
}

const analyser_enfants_avec = (str, deb, fin, fichier, json) =>
{
    debug("Enfants", str, deb, fin, json)
    let enfants = []

    let indentation = 0
    while (str[deb + indentation] == ' ')
        indentation++

    let pos = deb
    let fini = deb >= fin ? true : false
    while (!fini)
    {
        // console.log('(0)')
        for (let i = 0; i < indentation && pos + i < fin; i++)
        {
            if (/^[\n#]$/.test(str[pos + i]))
            {
                pos += i
                break
            }
            if (str[pos + i] == '\t')
                return erreur("Indentation par tabulations interdite", str, fichier, pos + i)
            if (str[pos + i] != ' ')
                return erreur("Erreur d'indentation", str, fichier, pos + i)
        }
        if (/^[\n#]$/.test(str[pos]))
        {
            while(str[pos] != '\n' && pos < fin)
                pos++
            if (pos < fin)
                pos++
            else
                fini = true
            continue
        }
        pos += indentation
        if (pos >= fin)
        {
            fini = true
            continue
        }
        if (str[pos] == '\t')
            return erreur("Indentation par tabulations interdite", fichier, str, pos)
        if (str[pos] == ' ')
            return erreur("Erreur d'indentation", fichier, str, pos)

        let enf_pret = false
        let deb_enf = pos;
        let fin_enf = pos;
        let blocs = ''
        while (!fini && !enf_pret)
        {
            // console.log('(1)')
            while (str[pos] != '\n' || blocs != '')
            {
                // console.log('(2)')
                if (str[pos] == blocs.slice(-1))
                    blocs = blocs.slice(0, -1)
                else if (str[pos] == '(' && !/^["'`]$/.test(blocs.slice(-1)))
                    blocs += ')'
                else if (str[pos] == '[' && !/^["'`]$/.test(blocs.slice(-1)))
                    blocs += ']'
                else if (str[pos] == '{' && !/^["'`]$/.test(blocs.slice(-1)))
                    blocs += '}'
                else if (str[pos] == '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
                    blocs += '>'
                else if (str[pos] == '\"' && !/^["'`]$/.test(blocs.slice(-1)))
                    blocs += '\"'
                else if (str[pos] == '\'' && !/^["'`]$/.test(blocs.slice(-1)))
                    blocs += '\''
                else if (str[pos] == '\`' && !/^["'`]$/.test(blocs.slice(-1)))
                    blocs += '\`'
                else if (str[pos] == ')' || str[pos] == ']' || str[pos] == '}')
                {
                    if (!/^["'`]$/.test(blocs.slice(-1)))
                        return erreur("Fermeture de bloc inattendue", fichier, str, pos)
                }
                else if (str[pos] == '>')
                {
                    if (!/^[)\]}>"'`]$/.test(blocs.slice(-1)))
                        return erreur("Fermeture de bloc inattendue", fichier, str, pos)
                }
                if (pos >= fin)
                {
                    if (blocs != '')
                        return erreur("Fermeture de bloc manquante", str, fichier, fin + 1)
                    fini = true
                    break
                }
                pos++
            }
            fin_enf = pos
            if (pos >= fin)
            {
                fini = true
                continue
            }
            for (let i = 0; i < indentation && pos + i < fin; i++)
            {
                if (/^[\n#]$/.test(str[pos + i]))
                {
                    pos += i
                    break
                }
                if (str[pos + i] == '\t')
                    return erreur("Indentation par tabulations interdite", str, fichier, pos + i)
                if (str[pos + i] != ' ')
                {
                    enf_pret = true
                    break
                }
            }
            if (/^[\n#]$/.test(str[pos]))
            {
                while(str[pos] != '\n' && pos < fin)
                    pos++
                if (pos < fin)
                    pos++
                else
                    fini = true
            }
            pos += indentation
            if (str[pos] != ' ')
                enf_pret = true
        }

        let bloc = analyser_bloc_avec(str, deb_enf, fin_enf, fichier, json)
        if (bloc)
            enfants.push(bloc)
        pos = fin_enf + 1
    }
    return enfants
}

const analyser_fichier_avec = (str, deb, fin, fichier, json) =>
{
    let modele = {
        type: 'fichier',
        args: [],
        enfants: []
    }
    modele.enfants = analyser_enfants_avec(str, deb, fin, fichier, json)
    return modele
}

export const analyser_avec = (str, fichier) =>
{
    const nom = fichier.replace(/\.avec$/, '')
    let json = {
        modele: {
            type: 'modele',
            args: [nom],
            enfants: []
        },
        dependances: {}
    }
    let modele = analyser_fichier_avec(str, 0, str.length - 1, fichier, json)
    json.dependances[nom] = modele
    return JSON.stringify(json)
}

const analyser_dependance = (nom, json) =>
{
    const dossier = `./adn/modeles`
    const fichier = `${nom}.avec`
    const chemin = rechercher_fichier(dossier, fichier, true)
    if (chemin)
    {
        let modele = fs.readFileSync(chemin, "utf-8")
        modele = analyser_fichier_avec(modele, 0, modele.length - 1, fichier, json)
        json.dependances[nom] = modele
        return 0
    }
    return 1
}
