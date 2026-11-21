import {charger_modele} from './heraut.js'
import {valoriser} from './scribe.js'
import {evaluer, evaluer_valeur, evaluer_valeur_ou_erreur} from './augure.js'
import {activer_style, desactiver_style} from './decorateur.js'
import {
    initialiser_sculpteur, executer_script, executer_script_async,
    activer_script, desactiver_script,
    observer_sculpteur,
    creer_scope, obtenir_scope_racine, lire_variable,
    definir_noeud_courant, effacer_noeud_courant,
    lire_dependance_par_clef
} from './sculpteur.js'

const chargements_en_cours = new Map()

const BALISES_SVG = new Set([
    'g',    'path',   'ellipse',
    'svg',  'rect',   'polygon',
    'use',  'stop',   'clipPath',
    'defs', 'text',   'polyline',
    'line', 'circle', 'linearGradient',
    'mask', 'symbol', 'radialGradient'
])

export const initialiser_batisseur = async () =>
{
    const corps = document.querySelector(`#avec`)

    // Page rendue côté serveur : le client repart de zéro
    if (corps.hasAttribute(`data-pre-rendu`))
    {
        corps.replaceChildren()
        corps.removeAttribute(`data-pre-rendu`)
        document.querySelectorAll(`style[data-pre-rendu]`).forEach((style) => style.remove())
    }

    initialiser_sculpteur()

    const index = await charger_modele(`index`)
    if (index)
    {
        const donnees = {
            dependances: index.dependances,
            scope: obtenir_scope_racine(),
            args: {},
            tenons: [],
            attente: null,
            repli: null
        }
        const enfants = construire_bloc(index.modele, donnees)
        corps.append(...enfants)
    }
}

const decapsuler = (str) =>
{
    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let texte = ``
    let blocs = ``
    let pos = 0

    while (pos < str.length)
    {
        const c = str[pos]
        if (c === ':' && /^[)(x]$/.test(str[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            texte += str.slice(pos, pos + 2)
            pos += 2
            continue
        }
        if (c == blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
            if (blocs.length > 0)
                texte += c
        }// À supprimer :
        else if (c == '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
            if (blocs.length > 1)
                texte+= c
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
            if (blocs.length > 1)
                texte += c
        }
        else
        {
            texte += c
        }
        pos++
    }
    return texte
}

// Le contenu de @script et @style, déjà délimité par l'analyseur du serveur (qui ignore les
// commentaires), n'est pas réanalysé : une apostrophe d'un commentaire y ouvrirait une chaîne
const retirer_crochets = (str) =>
{
    const texte = str.trim()
    return texte.startsWith('[') && texte.endsWith(']') ? texte.slice(1, -1) : texte
}

const extraire_modele_et_classes = (str) =>
{
    const brut = str.trim()
    const parties = brut.split('.')
    const nom = parties.shift()
    const classes = parties

    if (nom.length === 0)
        throw new Error(`Nom de modèle invalide : nom manquant`)
    if (classes.some(classe => classe.length === 0))
        throw new Error(`Nom de modèle invalide : classe manquante après '.'`)

    return {
        nom,
        classes
    }
}

const appliquer_classes_racine = (noeuds, classes) =>
{
    if (!classes || classes.length === 0)
        return

    for (const noeud of noeuds)
    {
        if (noeud.nodeType === 1)
            classes.forEach(classe => noeud.classList.add(classe))
    }
}

const est_entoure_par_bloc = (str) =>
{
    const texte = str.trim()
    if (texte.length < 2)
        return false

    const paires = { '(':')', '[':']', '{':'}', '<':'>', '"':'"', "'":"'", '`':'`' }
    const premier = texte[0]
    const dernier = texte[texte.length - 1]
    if (!(premier in paires) || paires[premier] !== dernier)
        return false

    let blocs = ``
    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }

    for (let pos = 0; pos < texte.length; pos++)
    {
        const c = texte[pos]
        if (c === ':' && /^[)(x]$/.test(texte[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }
        if (c === blocs.slice(-1))
            blocs = blocs.slice(0, -1)
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
            blocs += '>'
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
            blocs += ouvrants[c]

        if (blocs === `` && pos < texte.length - 1)
            return false
    }

    return blocs === ``
}

const decapsuler_si_entoure = (str) =>
{
    if (!est_entoure_par_bloc(str))
        return str.trim()
    return decapsuler(str.trim())
}

const decapsuler_si_crochets_expression_unique = (str) =>
{
    const texte = str.trim()
    if (texte.length < 2 || texte[0] !== '[' || texte[texte.length - 1] !== ']')
        return texte

    const contenu = texte.slice(1, -1)
    const parties = decouper_haut_niveau(contenu, new Set([',', '\n']))
    if (parties.length !== 1)
        return texte

    return parties[0]
}

const decapsuler_si_parentheses = (str) =>
{
    const texte = str.trim()
    if (texte.length < 2 || texte[0] !== '(' || texte[texte.length - 1] !== ')')
        return texte

    if (!est_entoure_par_bloc(texte))
        return texte

    return decapsuler(texte)
}

const decouper_haut_niveau = (str, separateurs) =>
{
    const brut = str.trim()
    if (brut.length === 0)
        return []

    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    const parties = []
    let blocs = ``
    let debut = 0

    for (let pos = 0; pos < brut.length; pos++)
    {
        const c = brut[pos]

        if (c === ':' && /^[)(x]$/.test(brut[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }

        if (c === blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
        }
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
        }
        else if (separateurs.has(c) && blocs === ``)
        {
            const partie = brut.slice(debut, pos).trim()
            if (partie.length > 0)
                parties.push(partie)
            debut = pos + 1
        }
    }

    const derniere_partie = brut.slice(debut).trim()
    if (derniere_partie.length > 0)
        parties.push(derniere_partie)

    return parties
}

const extraire_declaration_arg = (str) =>
{
    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let blocs = ``

    for (let pos = 0; pos < str.length; pos++)
    {
        const c = str[pos]
        if (c === ':' && /^[)(x]$/.test(str[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }
        if (c === blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
        }
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
        }
        else if (c === ':' && blocs === ``)
        {
            const nom = str.slice(0, pos).trim()
            const valeur_defaut = str.slice(pos + 1).trim()

            if (nom.length === 0)
                throw new Error("@args invalide : nom d'argument manquant")
            if (/\s/.test(nom))
                throw new Error("@args invalide : séparer les arguments par ',' ou par '\\n'")
            if (valeur_defaut.length === 0)
                throw new Error("@args invalide : valeur par défaut manquante après ':'")

            return { nom, valeur_defaut }
        }
    }

    const nom = str.trim()
    if (nom.length === 0)
        throw new Error("@args invalide : nom d'argument manquant")
    if (/\s/.test(nom))
        throw new Error("@args invalide : séparer les arguments par ',' ou par '\\n'")

    return { nom, valeur_defaut: null }
}

const extraire_declarations_args = (str) =>
{
    return decouper_haut_niveau(str, new Set([',', '\n']))
        .map(extraire_declaration_arg)
}

const extraire_ternaire = (str) =>
{
    const brut = str.trim()

    // Doit commencer par un bloc crochet [condition]
    if (!brut.startsWith('[')) return null

    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let blocs = ``
    let pos_fin_condition = -1

    for (let pos = 0; pos < brut.length; pos++)
    {
        const c = brut[pos]
        if (c === ':' && /^[)(x]$/.test(brut[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        { pos++; continue }

        if (c === blocs.slice(-1))        blocs = blocs.slice(0, -1)
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1))) blocs += '>'
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))  blocs += ouvrants[c]

        if (blocs === `` && pos > 0) { pos_fin_condition = pos; break }
    }

    if (pos_fin_condition < 0) return null

    const apres = brut.slice(pos_fin_condition + 1).trim()
    if (!apres.startsWith('?')) return null

    const condition = brut.slice(0, pos_fin_condition + 1) // "[...]" gardé tel quel pour decapsuler

    // Découper vrai : faux au niveau haut dans ce qui suit le '?'
    const apres_point = apres.slice(1).trim()
    const parties = decouper_haut_niveau(apres_point, new Set([':']))

    // Attention : ':(' ':x' ')' sont des smileys/tokens, pas des séparateurs —
    // decouper_haut_niveau les ignore déjà grâce à la gestion ':' + /^[)(x]/
    if (parties.length < 1) return null

    const branche_vrai = parties[0].trim()
    const branche_faux = parties[1]?.trim() ?? null

    return { condition, vrai: branche_vrai, faux: branche_faux }
}

const extraire_argument_modele = (str) =>
{
    const valeur = str.trim()
    if (/^:[)(x]$/.test(valeur))
        return { nom: null, valeur }

    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let blocs = ``

    for (let pos = 0; pos < str.length; pos++)
    {
        const c = str[pos]
        if (c === ':' && /^[)(x]$/.test(str[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }
        if (c === blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
        }
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
        }
        else if (c === ':' && blocs === ``)
        {
            const nom = str.slice(0, pos).trim()
            const valeur = str.slice(pos + 1).trim()

            if (nom.length === 0)
                throw new Error("argument nommé invalide : nom d'argument manquant")
            if (!/^\$[a-zA-Z_][\w]*$/.test(nom))
                throw new Error(`argument nommé invalide : ${nom} n'est pas un nom d'argument valide`)
            if (valeur.length === 0)
                throw new Error(`argument nommé invalide : valeur manquante pour ${nom}`)

            const ternaire = extraire_ternaire(valeur)
            if (ternaire) return { nom, valeur, ternaire }

            return { nom, valeur }
        }
    }

    if (valeur.length === 0)
        throw new Error("argument de modèle invalide : valeur manquante")

    const ternaire = extraire_ternaire(valeur)
    if (ternaire) return { nom: null, valeur, ternaire }

    return { nom: null, valeur }
}

const extraire_arguments_modele = (str) =>
{
    return decouper_haut_niveau(str, new Set([',', '\n']))
        .map(extraire_argument_modele)
}

const est_bloc_crochets = (str) =>
{
    const texte = str.trim()
    return texte.startsWith('[') && texte.endsWith(']') && est_entoure_par_bloc(texte)
}

const assembler_attributs_conditionnels = (attributs) =>
{
    const resultat = []

    for (let i = 0; i < attributs.length; i++)
    {
        const courant = attributs[i]

        if (est_bloc_crochets(courant) && attributs[i + 1] == '?')
        {
            const attr_vrai = attributs[i + 2]
            if (!attr_vrai)
                throw new Error(`Attribut conditionnel invalide : attribut manquant apres '?'`)

            if (attributs[i + 3] == ':')
            {
                const attr_faux = attributs[i + 4]
                if (!attr_faux)
                    throw new Error(`Attribut conditionnel invalide : attribut manquant apres ':'`)

                resultat.push(`${courant}?${attr_vrai}:${attr_faux}`)
                i += 4
            }
            else
            {
                resultat.push(`${courant}?${attr_vrai}`)
                i += 2
            }
        }
        else
        {
            resultat.push(courant)
        }
    }

    return resultat
}

const extraire_attribut_conditionnel = (str) =>
{
    const brut = str.trim()
    if (brut.length === 0)
        return null

    const ouvrants = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' }
    let blocs = ``
    let pos_point_interrogation = -1
    let pos_deux_points = -1

    for (let pos = 0; pos < brut.length; pos++)
    {
        const c = brut[pos]
        if (c === ':' && /^[)(x]$/.test(brut[pos + 1]) && !/^["'`]$/.test(blocs.slice(-1)))
        {
            pos++
            continue
        }

        if (c === blocs.slice(-1))
        {
            blocs = blocs.slice(0, -1)
        }
        else if (c === '<' && !/^[)\]}>"'`]$/.test(blocs.slice(-1)))
        {
            blocs += '>'
        }
        else if (c in ouvrants && !/^["'`]$/.test(blocs.slice(-1)))
        {
            blocs += ouvrants[c]
        }
        else if (c === '?' && blocs === `` && pos_point_interrogation < 0)
        {
            pos_point_interrogation = pos
        }
        else if (c === ':' && blocs === `` && pos_point_interrogation >= 0 && pos_deux_points < 0)
        {
            pos_deux_points = pos
        }
    }

    if (pos_point_interrogation < 0)
        return null

    const condition = brut.slice(0, pos_point_interrogation).trim()
    if (!est_bloc_crochets(condition))
        throw new Error(`Attribut conditionnel invalide : la condition doit etre entre crochets []`)

    const attr_vrai = pos_deux_points < 0
        ? brut.slice(pos_point_interrogation + 1).trim()
        : brut.slice(pos_point_interrogation + 1, pos_deux_points).trim()

    if (attr_vrai.length === 0)
        throw new Error(`Attribut conditionnel invalide : attribut manquant apres '?'`)

    const attr_faux = pos_deux_points < 0
        ? null
        : brut.slice(pos_deux_points + 1).trim()

    if (pos_deux_points >= 0 && (!attr_faux || attr_faux.length === 0))
        throw new Error(`Attribut conditionnel invalide : attribut manquant apres ':'`)

    return {
        condition,
        attr_vrai,
        attr_faux
    }
}

const appliquer_attribut_brut = (noeud, attribut, donnees) =>
{
    if (attribut[0] == `#`)
    {
        const id = valoriser(attribut.slice(1), donnees)
        noeud.id = id
        return () => {
            if (noeud.id === id)
                noeud.id = ``
        }
    }

    if (attribut[0] == `.`)
    {
        const classe = valoriser(attribut.slice(1), donnees)
        const classes = classe.split(/\s+/).filter(Boolean)
        classes.forEach(c => noeud.classList.add(c))
        return () => classes.forEach(c => noeud.classList.remove(c))
    }

    if (!attribut.includes(`=`))
    {
        noeud.setAttribute(attribut, ``)
        return () => noeud.removeAttribute(attribut)
    }

    if (attribut.startsWith('on') || attribut[0] == '@')
    {
        initialiser_sculpteur()

        let [evenement, ...reste] = attribut.split('=')
        evenement = evenement[0] == `@` ? evenement.slice(1) : evenement.slice(2)
        const script = decapsuler(reste.join('='))

        if (evenement === 'mount' || evenement === 'unmount')
        {
            if (!noeud._avec_actions)
                noeud._avec_actions = {}

            noeud._avec_actions[evenement] = script
            return () => {
                if (noeud._avec_actions?.[evenement] === script)
                    delete noeud._avec_actions[evenement]
            }
        }

        const gestionnaire = (e) => {
            executer_script(script, e, noeud, noeud._avec_scope, noeud._avec_args)
        }
        noeud.addEventListener(evenement, gestionnaire)
        return () => noeud.removeEventListener(evenement, gestionnaire)
    }

    const [clef, ...reste] = attribut.split(`=`)
    const valeur_brute = reste.join(`=`)
    const valeur = valoriser(decapsuler(valeur_brute), donnees)
    appliquer_attribut(noeud, clef, valeur)
    return () => {
        if (clef === 'id')
            noeud.id = ``
        else if (clef === 'class')
            noeud.className = ``
        else
            noeud.removeAttribute(clef)
    }
}

const construire_bloc = (bloc, donnees) =>
{
    switch (bloc.type)
    {
    case `fichier`:
        return construire_fichier(bloc, donnees)
    case `instruction`:
        return construire_enfants(bloc, donnees)
    case `balise`:
        return construire_balise(bloc, donnees)
    case `texte`:
        return construire_texte(bloc, donnees)
    case `modele`:
        return construire_modele(bloc, donnees)
    default:
        return []
    }
}

const construire_fichier = (bloc, donnees) =>
{
    // Faire en sorte que le style fonctionne pour l'index
    return construire_enfants(bloc, donnees)
}

const construire_enfants = (bloc, donnees) =>
{
    // @static ne fige que les conditions de ses enfants directs : sans cela, les branches,
    // modèles et boucles qu'elles construisent hériteraient du drapeau
    const static_direct = donnees.static_direct === true
    if (static_direct)
        donnees = { ...donnees, static_direct: false }

    // Pré-scan : les modèles d'attente (?) et de repli (!) déclarés à ce niveau priment sur ceux hérités
    for (const enfant of bloc.enfants)
    {
        if (enfant.type === 'modele')
        {
            if (enfant.args[0][0] === '?' && /^[a-zA-Z]$/.test(enfant.args[0][1]))
                donnees = { ...donnees, attente: enfant }
            else if (enfant.args[0][0] === '!' && /^[a-zA-Z]$/.test(enfant.args[0][1]))
                donnees = { ...donnees, repli: enfant }
        }
    }

    let enfants = []
    let elsable = false
    for (let i = 0; i < bloc.enfants.length; i++)
    {
        const enfant = bloc.enfants[i]
        if (enfant.type === `instruction`)
        {
            switch (enfant.args[0])
            {
            case `@if`:
            case `@else-if`:
            case `@else`:
            case `@unless`:
            {
                // Collecter tous les blocs de la chaîne conditionnelle
                const chaine = []

                // Reculer si on est sur un @else-if ou @else
                let debut = i
                while (debut > 0)
                {
                    const precedent = bloc.enfants[debut - 1]
                    if (
                        precedent.type === `instruction` &&
                        [`@if`, `@else-if`, `@unless`].includes(precedent.args[0])
                    )
                        debut--
                    else
                        break
                }

                // Avancer pour collecter toute la chaîne depuis i
                let fin = i
                if (enfant.args[0] === `@if` || enfant.args[0] === `@unless`)
                {
                    chaine.push(enfant)
                    fin = i + 1
                    while (fin < bloc.enfants.length)
                    {
                        const suivant = bloc.enfants[fin]
                        if (
                            suivant.type === `instruction` &&
                            [`@else-if`, `@else`].includes(suivant.args[0])
                        )
                        {
                            chaine.push(suivant)
                            fin++
                        }
                        else break
                    }
                    i = fin - 1
                    elsable = false

                    enfants.push(...construire_conditionnel(chaine, static_direct ? { ...donnees, static_direct: true } : donnees))
                }
                else if (enfant.args[0] === `@else-if` || enfant.args[0] === `@else`)
                {
                    // Ces cas sont désormais gérés dans la collecte du @if
                    // On les ignore ici car ils ont déjà été consommés
                    elsable = false
                }
                break
            }

            // ...existing code... (les autres cas @repeat, @while, etc.)
            case `@repeat`:
                if (enfant.args.length > 1)
                {
                    const limite = +evaluer_valeur(decapsuler(enfant.args[1]), donnees)
                    for (let j = 0; j < limite; j++)
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                else if (bloc.enfants.length > i + 1 && bloc.enfants[i + 1].args[0] === `@while`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                    while (evaluer(decapsuler(bloc.enfants[i + 1].args[1]), donnees))
                }
                else if (bloc.enfants.length > i + 1 && bloc.enfants[i + 1].args[0] === `@until`)
                {
                    do
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                    while (!evaluer(decapsuler(bloc.enfants[i + 1].args[1]), donnees))
                }
                elsable = false
                break
            case `@while`:
                if (i == 0 || bloc.enfants[i - 1].args[0] !== `@repeat`)
                {
                    while (evaluer(decapsuler(enfant.args[1]), donnees))
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                elsable = false
                break
            case `@until`:
                if (i == 0 || bloc.enfants[i - 1].args[0] !== `@repeat`)
                {
                    while (!evaluer(decapsuler(enfant.args[1]), donnees))
                    {
                        enfants.push(...construire_bloc(enfant, donnees))
                    }
                }
                elsable = false
                break
            case `@for-each`:
                enfants.push(...construire_for_each(enfant, donnees))
                elsable = false
                break
            case `@key`:
                enfants.push(...construire_cle(enfant, static_direct ? { ...donnees, static_direct: true } : donnees))
                elsable = false
                break
            case `@static`:
                const donnees_static = { ...donnees, static_direct: true }
                enfants.push(...construire_enfants({ enfants: enfant.enfants }, donnees_static))
                elsable = false
                break
            case `@stud`:
                if (donnees.tenons.length > 0)
                {
                    const tenon = donnees.tenons.at(-1)
                    const bloc_tenon = {
                        type: `instruction`,
                        args: [`@stud`],
                        enfants: tenon.enfants
                    }
                    const donnees_tenon = {
                        ...tenon.donnees,
                        scope: donnees.scope,
                        tenons: donnees.tenons.slice(0, -1)
                    }
                    enfants.push(...construire_enfants(bloc_tenon, donnees_tenon))
                }
                elsable = false
                break
            default:
                elsable = false
            }
        }
        else
        {
            enfants.push(...construire_bloc(enfant, donnees))
            elsable = false
        }
    }
    return enfants
}

// Évalue quelle branche de la chaîne conditionnelle doit s'afficher
const evaluer_chaine = (chaine, donnees) =>
{
    for (const branche of chaine)
    {
        switch (branche.args[0])
        {
        case `@if`:
        case `@else-if`:
            if (evaluer(decapsuler(branche.args[1]), donnees))
                return branche
            break
        case `@unless`:
            if (!evaluer(decapsuler(branche.args[1]), donnees))
                return branche
            break
        case `@else`:
            return branche
        }
    }
    return null
}

// Construit un bloc conditionnel réactif avec des ancres
const construire_conditionnel = (chaine, donnees) =>
{
    const ancre_debut = document.createComment(`@if`)
    const ancre_fin   = document.createComment(`/@if`)

    for (const branche of chaine)
    {
        if (branche.args[1])
        {
            definir_noeud_courant(ancre_debut)
            evaluer(decapsuler(branche.args[1]), donnees)
            effacer_noeud_courant()
        }
    }

    const deps_condition = ancre_debut._avec_deps ?? new Set()

    let branche_active = evaluer_chaine(chaine, donnees)
    const noeuds_actifs = branche_active
        ? construire_enfants(branche_active, donnees)
        : []

    if (deps_condition.size > 0)
    {
        let transition_en_cours = false
        let branche_en_attente  = undefined

        const executer_transition = async (cible) =>
        {
            transition_en_cours = true

            await vider_entre_ancres(ancre_debut, ancre_fin)

            if (cible)
            {
                const nouveaux_noeuds = construire_enfants(cible, donnees)
                ancre_fin.before(...nouveaux_noeuds)

                queueMicrotask(() => {
                    nouveaux_noeuds.forEach(n => {
                        if (n.nodeType === 1 && document.contains(n))
                            monter_noeud(n)
                    })
                })
            }

            transition_en_cours = false

            // La branche demandée pendant la transition (null : aucune branche à afficher)
            if (branche_en_attente !== undefined)
            {
                const prochaine    = branche_en_attente
                branche_en_attente = undefined
                executer_transition(prochaine)
            }
        }

        if (donnees.static_direct)
        {
            const deps_null = new Set()
            for (const clef of deps_condition)
            {
                const val = lire_dependance_par_clef(clef, donnees.args)
                if (val === null || val === undefined)
                    deps_null.add(clef)
            }

            if (deps_null.size > 0)
            {
                const desabonner = observer_sculpteur((propriete) =>
                {
                    if (!deps_null.has(propriete)) return
                    if (!ancre_debut.parentNode) { desabonner(); return }
                    if (en_retrait(ancre_debut)) return

                    const val = lire_dependance_par_clef(propriete, donnees.args)
                    if (val === null || val === undefined) return

                    deps_null.delete(propriete)

                    const nouvelle_branche = evaluer_chaine(chaine, donnees)
                    if (nouvelle_branche !== branche_active)
                    {
                        branche_active = nouvelle_branche
                        executer_transition(nouvelle_branche)
                    }

                    if (deps_null.size === 0)
                        desabonner()
                })
            }
        }
        else
        {
            const desabonner = observer_sculpteur((propriete) =>
            {
                if (!deps_condition.has(propriete)) return

                if (!ancre_debut.parentNode)
                {
                    desabonner()
                    return
                }
                if (en_retrait(ancre_debut))
                    return

                // Les dépendances sont relevées à chaque évaluation : avec & et |, une variable
                // non lue la première fois (court-circuit) doit pouvoir être suivie ensuite
                definir_noeud_courant(ancre_debut)
                const nouvelle_branche = evaluer_chaine(chaine, donnees)
                effacer_noeud_courant()

                if (nouvelle_branche === branche_active) return

                branche_active = nouvelle_branche

                if (transition_en_cours)
                    branche_en_attente = nouvelle_branche
                else
                    executer_transition(nouvelle_branche)
            })
        }
    }

    return [ancre_debut, ...noeuds_actifs, ancre_fin]
}

// Valeur comparable d une clef @key : deux listes ou dictionnaires de même contenu sont égaux
const empreinte_cle = (valeur) =>
{
    try
    {
        return JSON.stringify(valeur) ?? String(valeur)
    }
    catch
    {
        return String(valeur)
    }
}

// Construit un bloc @key : son contenu est démonté puis reconstruit chaque fois que la valeur
// de la clef change, même si le reste ne change pas (une même page pour une autre adresse)
const construire_cle = (bloc, donnees) =>
{
    const ancre_debut = document.createComment(`@key`)
    const ancre_fin   = document.createComment(`/@key`)
    const expression  = decapsuler(bloc.args[1])

    // Les dépendances sont relevées à chaque lecture, comme pour une condition
    const lire_cle = () =>
    {
        definir_noeud_courant(ancre_debut)
        const valeur = empreinte_cle(evaluer_valeur(expression, donnees))
        effacer_noeud_courant()
        return valeur
    }

    let cle_active = lire_cle()
    const noeuds_actifs = construire_enfants(bloc, donnees)

    if (donnees.static_direct || !(ancre_debut._avec_deps?.size > 0))
        return [ancre_debut, ...noeuds_actifs, ancre_fin]

    let transition_en_cours = false
    let reconstruction_en_attente = false

    const reconstruire = async () =>
    {
        transition_en_cours = true

        await vider_entre_ancres(ancre_debut, ancre_fin)

        const nouveaux_noeuds = construire_enfants(bloc, donnees)
        ancre_fin.before(...nouveaux_noeuds)

        queueMicrotask(() => {
            nouveaux_noeuds.forEach(n => {
                if (n.nodeType === 1 && document.contains(n))
                    monter_noeud(n)
            })
        })

        transition_en_cours = false

        // La clef a changé pendant la transition : une seule reconstruction de plus suffit
        if (reconstruction_en_attente)
        {
            reconstruction_en_attente = false
            reconstruire()
        }
    }

    const desabonner = observer_sculpteur((propriete) =>
    {
        if (!ancre_debut._avec_deps?.has(propriete)) return

        if (!ancre_debut.parentNode)
        {
            desabonner()
            return
        }
        if (en_retrait(ancre_debut))
            return

        const nouvelle_cle = lire_cle()
        if (nouvelle_cle === cle_active) return

        cle_active = nouvelle_cle

        if (transition_en_cours)
            reconstruction_en_attente = true
        else
            reconstruire()
    })

    return [ancre_debut, ...noeuds_actifs, ancre_fin]
}

const normaliser_iteration = (valeur, operateur) =>
{
    if (valeur == null)
        return []
    // Arrays
    if (Array.isArray(valeur))
    {
        if (operateur === `in`)
            return Array.from({ length: valeur.length }, (_, i) => i)
        return Array.from(valeur)
    }

    // Strings
    if (typeof valeur === 'string')
    {
        if (operateur === `in`)
            return Array.from({ length: valeur.length }, (_, i) => i)
        return Array.from(valeur)
    }

    // Plain objects
    if (valeur !== null && typeof valeur === 'object')
    {
        if (operateur === `in`)
            return Object.keys(valeur)
        return Object.values(valeur)
    }

    // Fallback for generic iterables
    if (typeof valeur === 'object' && typeof valeur[Symbol.iterator] === 'function')
    {
        const arr = Array.from(valeur)
        if (operateur === `in`)
            return Array.from({ length: arr.length }, (_, i) => i)
        return arr
    }

    return []
}

const construire_for_each = (bloc, donnees) =>
{
    const ancre_debut = document.createComment(`@for-each`)
    const ancre_fin = document.createComment(`/@for-each`)
    const variable_brut = bloc.args[1]
    const operateur = bloc.args[2]
    const source_brute = bloc.args[3]

    // Supporte une ou deux variables dans les crochets : [$val] ou [$cle, $val] (',' ou '\n')
    const vars_decapsule = decapsuler_si_entoure(variable_brut).trim()
    const parts = decouper_haut_niveau(vars_decapsule, new Set([',', '\n'])).map(s => s.trim()).filter(Boolean)

    let cle_nom = null
    let valeur_nom = null

    if (parts.length === 0)
        throw new Error(`@for-each invalide : nom de variable manquant, obtenu '${variable_brut}'`)
    else if (parts.length === 1)
    {
        valeur_nom = parts[0]
        if (!/^[\$][a-zA-Z_][\w]*$/.test(valeur_nom))
            throw new Error(`@for-each invalide : nom de variable attendu, obtenu '${valeur_nom}'`)
    }
    else if (parts.length === 2)
    {
        cle_nom = parts[0]
        valeur_nom = parts[1]
        if (!/^[\$][a-zA-Z_][\w]*$/.test(cle_nom) || !/^[\$][a-zA-Z_][\w]*$/.test(valeur_nom))
            throw new Error(`@for-each invalide : noms de variables attendus, obtenu '${variable_brut}'`)
    }
    else
    {
        throw new Error(`@for-each invalide : trop de variables dans ${variable_brut}`)
    }

    let noeuds_rendus = []
    let deps_source = new Set()

    const construire_noeuds = () =>
    {
        definir_noeud_courant(ancre_debut)
        const expr = decapsuler_si_crochets_expression_unique(source_brute)
        const source = evaluer_valeur(expr, donnees)
        effacer_noeud_courant()

        deps_source = ancre_debut._avec_deps ?? new Set()

        // Construire une liste d'entrées { key, value } selon le type et l'opérateur
        const entries = []

        if (source == null)
        {
            // rien
        }
        else if (Array.isArray(source) || typeof source === 'string')
        {
            for (let i = 0; i < source.length; i++)
                entries.push({ key: i, value: source[i] })
        }
        else if (source !== null && typeof source === 'object')
        {
            if (operateur === 'in')
            {
                for (const k of Object.keys(source))
                    entries.push({ key: k, value: source[k] })
            }
            else
            {
                for (const [k, v] of Object.entries(source))
                    entries.push({ key: k, value: v })
            }
        }
        else if (typeof source === 'object' && typeof source[Symbol.iterator] === 'function')
        {
            const arr = Array.from(source)
            for (let i = 0; i < arr.length; i++)
                entries.push({ key: i, value: arr[i] })
        }

        const noeuds = []

        for (const entry of entries)
        {
            const scope_enfant = creer_scope(donnees.scope)

            if (cle_nom)
            {
                scope_enfant.variables[cle_nom] = entry.key
                scope_enfant.variables[valeur_nom] = entry.value
            }
            else if (operateur === 'in')
            {
                // Avec 'in', la seule variable reçoit la clé
                scope_enfant.variables[valeur_nom] = entry.key
            }
            else
            {
                // Avec 'of', la seule variable reçoit la valeur
                scope_enfant.variables[valeur_nom] = entry.value
            }

            const donnees_enfant = {
                ...donnees,
                scope: scope_enfant
            }

            const nouveaux = construire_enfants({ enfants: bloc.enfants }, donnees_enfant)

            // Exposer la variable de clé comme variable CSS
            // Avec deux variables [$cle, $val], expose --var-$cle
            // Avec une variable [$i] et opérateur 'in', expose --var-$i
            const var_clef = cle_nom || (operateur === 'in' ? valeur_nom : null)
            if (var_clef)
            {
                const nom_css = `--var-${var_clef.slice(1)}`
                const valeur_css = String(entry.key)
                for (const n of nouveaux)
                {
                    if (n.nodeType === 1)
                        n.style.setProperty(nom_css, valeur_css)
                }
            }

            noeuds.push(...nouveaux)
        }

        return noeuds
    }

    const rendre = async () =>
    {
        await vider_entre_ancres(ancre_debut, ancre_fin)

        noeuds_rendus = construire_noeuds()
        ancre_fin.before(...noeuds_rendus)

        queueMicrotask(() => {
            noeuds_rendus.forEach(n => {
                if (n.nodeType === 1 && document.contains(n))
                    monter_noeud(n)
            })
        })
    }

    noeuds_rendus = construire_noeuds()

    let rendu_en_cours = false
    let rerendu_en_attente = false

    const executer_rendu = async () =>
    {
        if (rendu_en_cours)
        {
            rerendu_en_attente = true
            return
        }

        rendu_en_cours = true
        await rendre()
        rendu_en_cours = false

        if (rerendu_en_attente)
        {
            rerendu_en_attente = false
            executer_rendu()
        }
    }

    if (deps_source.size > 0)
    {
        const desabonner = observer_sculpteur((propriete) =>
        {
            if (!deps_source.has(propriete)) return

            if (!ancre_debut.parentNode)
            {
                desabonner()
                return
            }
            if (en_retrait(ancre_debut))
                return

            executer_rendu()
        })
    }

    return [ancre_debut, ...noeuds_rendus, ancre_fin]
}

const construire_texte = (bloc, donnees) =>
{
    const noeud = document.createTextNode(``)

    // Tracker les dépendances lors de la première valorisation
    definir_noeud_courant(noeud)
    noeud.textContent = valoriser(decapsuler(bloc.args[0]), donnees)
    effacer_noeud_courant()

    // Si des variables ont été lues, s'abonner aux changements
    if (noeud._avec_deps?.size > 0)
    {
        const desabonner = observer_sculpteur((propriete) =>
        {
            if (!noeud._avec_deps.has(propriete)) return

            // Le nœud est-il encore dans le DOM ?
            if (!document.contains(noeud))
            {
                desabonner()
                return
            }
            if (en_retrait(noeud))
                return

            definir_noeud_courant(noeud)
            noeud.textContent = valoriser(decapsuler(bloc.args[0]), donnees)
            effacer_noeud_courant()
        })
    }

    return [noeud]
}

const construire_balise = (bloc, donnees) =>
{
    const str = decapsuler(bloc.args[0]).trim()
    let attributs = decouper_haut_niveau(str, new Set([' ', '\n', '\r', '\t']))
    const etiquette = attributs.shift()
    attributs = assembler_attributs_conditionnels(attributs)
    
    const ESPACE_SVG = 'http://www.w3.org/2000/svg'
    const noeud = BALISES_SVG.has(etiquette)
        ? document.createElementNS(ESPACE_SVG, etiquette)
        : document.createElement(etiquette)
    
    noeud._avec_vars = Object.create(null)
    noeud._avec_scope = donnees.scope
    noeud._avec_args = donnees.args || {}

    for (const attribut of attributs)
    {
        const conditionnel = extraire_attribut_conditionnel(attribut)
        if (conditionnel)
        {
            let nettoyer = null
            const appliquer_conditionnel = () =>
            {
                if (nettoyer)
                {
                    nettoyer()
                    nettoyer = null
                }

                const condition_valide = !!evaluer(decapsuler(conditionnel.condition), donnees)
                const cible = condition_valide ? conditionnel.attr_vrai : conditionnel.attr_faux
                if (!cible)
                    return

                nettoyer = appliquer_attribut_brut(noeud, cible, donnees)
            }

            definir_noeud_courant(noeud)
            appliquer_conditionnel()
            effacer_noeud_courant()

            if (noeud._avec_deps?.size > 0)
            {
                const desabonner = observer_sculpteur((propriete) =>
                {
                    if (!noeud._avec_deps.has(propriete)) return
                    if (!document.contains(noeud)) { desabonner(); return }
                    if (en_retrait(noeud)) return

                    definir_noeud_courant(noeud)
                    appliquer_conditionnel()
                    effacer_noeud_courant()
                })
            }
        }
        else if (attribut[0] == `#`)
        {
            appliquer_attribut_brut(noeud, attribut, donnees)
        }
        else if (attribut[0] == `.`)
        {
            appliquer_attribut_brut(noeud, attribut, donnees)
        }
        else if (!attribut.includes(`=`))
        {
            noeud.setAttribute(attribut, ``)
        }
        else if (attribut.startsWith('on') || attribut[0] == '@')
        {
            appliquer_attribut_brut(noeud, attribut, donnees)
        }
        else if (attribut.includes(`=`) && !attribut.startsWith('on') && attribut[0] !== '@')
        {
            const [clef, ...reste] = attribut.split(`=`)
            let valeur_brute = reste.join(`=`)

            // Tracker les dépendances de cet attribut
            definir_noeud_courant(noeud)
            let valeur = valoriser(decapsuler(valeur_brute), donnees)
            effacer_noeud_courant()

            appliquer_attribut(noeud, clef, valeur)

            // S'abonner si des variables ont été lues
            if (noeud._avec_deps?.size > 0)
            {
                const desabonner = observer_sculpteur((propriete) =>
                {
                    if (!noeud._avec_deps.has(propriete)) return
                    if (!document.contains(noeud)) { desabonner(); return }
                    if (en_retrait(noeud)) return

                    definir_noeud_courant(noeud)
                    const nouvelle_valeur = valoriser(decapsuler(valeur_brute), donnees)
                    effacer_noeud_courant()

                    appliquer_attribut(noeud, clef, nouvelle_valeur)
                })
            }
        }
    }

    const enfants = construire_enfants(bloc, donnees)
    noeud.append(...enfants)

    queueMicrotask(() => {
        if (document.contains(noeud))
        {
            monter_noeud(noeud)
        }
    })

    return [noeud]
}

// Fonction utilitaire extraite pour éviter la duplication
const appliquer_attribut = (noeud, clef, valeur) =>
{
    switch (clef)
    {
    case `id`:
        noeud.id = valeur
        break
    case `class`:
        noeud.className = ``
        valeur.split(/\s+/).forEach(c => c && noeud.classList.add(c))
        break
    default:
        noeud.setAttribute(clef, valeur)
    }
}

const extraire_appel_fonction = (str) =>
{
    const brut = str.trim()

    // Doit commencer par $nom_de_variable
    const match = brut.match(/^(\$[a-zA-Z_][\w]*)(\(.*\))$/s)
    if (!match) return null

    const nom_fn = match[1]
    const args_bruts = match[2] // "(arg1, arg2, ...)" ou "()"

    return { nom_fn, args_bruts }
}

// Le nœud qui porte la liste des modèles d'un groupe de nœuds racines : le premier élément,
// à défaut le premier nœud (ancre d'un @if ou d'un modèle différé)
const porteur_modeles = (noeuds) => noeuds.find(noeud => noeud.nodeType === 1) ?? noeuds[0] ?? null

const ajouter_modeles = (noeuds, entrees) =>
{
    const porteur = porteur_modeles(noeuds)
    if (!porteur || entrees.length === 0)
        return
    porteur._avec_modeles ??= []
    porteur._avec_modeles.push(...entrees)
}

// Modèle d attente affiché qu un contenu en cours de construction peut reprendre (voir
// construire_apres_script) : { cle, noeuds, prise }. Seul le premier modèle construit le reçoit
let reprise_attente = null

// Un modèle d attente ou de repli se reconnaît à son nom et à ses arguments
const cle_substitut = (bloc_substitut) => bloc_substitut ? bloc_substitut.args.join(' ').slice(1) : null

// Modèle d attente (?nom) ou de repli (!nom) déclaré dans le bloc, construit à la place d un
// modèle qui n est pas encore prêt ou qui a échoué. Un modèle d attente identique déjà affiché
// (reprise) est repris tel quel : il ne disparaît pas pour réapparaître aussitôt
const construire_substitut = (bloc_substitut, donnees, classes, reprise = null) =>
{
    const cle = cle_substitut(bloc_substitut)
    if (cle && reprise && !reprise.prise && reprise.cle === cle)
    {
        reprise.prise = true
        return reprise.noeuds
    }

    const nom_substitut = bloc_substitut?.args[0].slice(1)
    const noeuds = nom_substitut && donnees.dependances[nom_substitut]
        ? construire_modele(
            { type: 'modele', args: [nom_substitut, ...bloc_substitut.args.slice(1)], enfants: [] },
            donnees
          )
        : []
    appliquer_classes_racine(noeuds, classes)
    return noeuds
}

// Monte un nœud et ses descendants, les plus profonds d abord : des nœuds construits avant
// d être insérés n ont pas pu se monter eux-mêmes
const monter_arbre = (noeud) =>
{
    if (noeud.nodeType !== 1)
        return
    for (const enfant of noeud.children)
        monter_arbre(enfant)
    monter_noeud(noeud)
}

// Place des nœuds à la place d une ancre, puis les monte
const remplacer_ancre = (ancre, noeuds) =>
{
    ancre.after(...noeuds)
    ancre.remove()
    queueMicrotask(() => noeuds.forEach(n => {
        if (document.contains(n)) monter_arbre(n)
    }))
}

const desactiver_modeles = (modeles) =>
{
    for (const { nom, scope } of modeles)
    {
        desactiver_style(nom)
        desactiver_script(nom, scope)
    }
}

// Un modèle dont le script attend (await) n est construit qu à la fin de celui-ci : le modèle
// d attente du bloc est affiché d ici là, et le modèle de repli si le script échoue. Ses style
// et script, déjà activés, sont inscrits sur le groupe d attente : un retrait entre-temps les
// désactive, et ils passent sinon aux nœuds construits.
// Un modèle différé garde affiché son propre modèle d attente pendant le script : il le confie
// à l ancre (_avec_attente_externe : { cle, noeuds, reprendre_modeles, retirer_ancre }).
// Le contenu est construit avant le retrait du modèle d attente : s il commence par le même
// modèle d attente, il le reprend, et c est lui qui le retirera
const construire_apres_script = (attente_script, construire, modele_actif, classes, donnees, sans_attente = false, reprise = null) =>
{
    const ancre          = document.createComment(`await ${modele_actif.nom}`)
    const noeuds_attente = sans_attente ? [] : construire_substitut(donnees.attente, donnees, classes, reprise)
    ancre._avec_attente_script = true

    const porteur            = porteur_modeles([ancre, ...noeuds_attente])
    const nb_modeles_attente = porteur?._avec_modeles?.length ?? 0
    ajouter_modeles([ancre, ...noeuds_attente], [modele_actif])

    const present = () => ancre.parentNode && !en_retrait(ancre)

    ;(async () =>
    {
        let reussi = true
        try
        {
            await attente_script
        }
        catch
        {
            reussi = false
        }

        // Bloc retiré, ou en cours de retrait : celui qui le retire désactive le modèle
        if (!present()) return

        const attente = ancre._avec_attente_externe ?? {
            cle               : noeuds_attente.length ? cle_substitut(donnees.attente) : null,
            noeuds            : noeuds_attente,
            reprendre_modeles : () => [],
            retirer_ancre     : () => {}
        }

        // Le modèle et ses englobants, à reporter sur ce qui remplace l attente
        const modeles = [
            ...(porteur?._avec_modeles?.splice(nb_modeles_attente) ?? []),
            ...attente.reprendre_modeles()
        ]

        const retirer_attente = async () =>
        {
            await Promise.all(attente.noeuds.map(n => demonter_noeud(n)))
            if (!present()) return false
            for (const n of attente.noeuds)
            {
                nettoyer_noeud(n)
                n.parentNode?.removeChild(n)
            }
            attente.retirer_ancre()
            return true
        }

        if (!reussi)
        {
            const [ echoue, ...englobants ] = modeles
            desactiver_modeles([ echoue ])
            if (!await retirer_attente())
                return desactiver_modeles(englobants)

            const noeuds_repli = construire_substitut(donnees.repli, donnees, classes)
            ajouter_modeles(noeuds_repli, englobants)
            return remplacer_ancre(ancre, noeuds_repli)
        }

        const reprise_contenu = attente.cle ? { cle: attente.cle, noeuds: attente.noeuds, prise: false } : null
        const precedente      = reprise_attente
        reprise_attente       = reprise_contenu
        let noeuds
        try
        {
            noeuds = construire()
        }
        finally
        {
            reprise_attente = precedente
        }

        // Le contenu a repris le modèle d attente : il est inséré tout de suite, et un
        // commentaire porte les modèles, le premier élément étant le modèle d attente repris
        if (reprise_contenu?.prise)
        {
            attente.retirer_ancre()
            const porteur_contenu = document.createComment(modele_actif.nom)
            porteur_contenu._avec_modeles = modeles
            return remplacer_ancre(ancre, [ porteur_contenu, ...noeuds ])
        }

        if (!await retirer_attente())
        {
            noeuds.forEach(n => nettoyer_noeud(n))
            return desactiver_modeles(modeles)
        }
        ajouter_modeles(noeuds, modeles)
        remplacer_ancre(ancre, noeuds)
    })()

    return [ancre, ...noeuds_attente]
}

const construire_modele = (bloc, donnees, options = {}) =>
{
    const nom_complet = bloc.args[0]
    const est_attente  = nom_complet[0] === '?'
    const est_repli    = nom_complet[0] === '!'
    const differe      = nom_complet[0] === '-'
    const info_modele  = extraire_modele_et_classes((differe || est_attente || est_repli) ? nom_complet.slice(1) : nom_complet)
    const nom          = info_modele.nom
    const classes      = bloc.classes ?? info_modele.classes

    // Modèle d'attente ou de repli : déjà pris en compte par le pré-scan, on ne construit rien
    if (est_attente || est_repli)
        return []

    // La reprise d'un modèle d'attente n'est offerte qu'au premier modèle construit
    const reprise   = reprise_attente
    reprise_attente = null

    if (differe && !donnees.dependances[nom])
    {
        const noeuds_attente = construire_substitut(donnees.attente, donnees, classes, reprise)

        const ancre = document.createComment(`-${nom}`)

        // Les modèles englobants inscriront les leurs sur ce porteur, après ceux du modèle
        // d'attente : ils seront reportés sur les nœuds qui le remplacent
        const porteur_attente = porteur_modeles([ancre, ...noeuds_attente])
        const nb_modeles_attente = porteur_attente?._avec_modeles?.length ?? 0
        const reprendre_modeles_englobants = () =>
            porteur_attente?._avec_modeles?.splice(nb_modeles_attente) ?? []

        if (!chargements_en_cours.has(nom))
        {
            const promesse = charger_modele(nom, Object.keys(donnees.dependances)).then(json =>
            {
                chargements_en_cours.delete(nom)
                if (!json) return
                for (const [clef, val] of Object.entries(json.dependances))
                {
                    if (!donnees.dependances[clef])
                        donnees.dependances[clef] = val
                }
            })
            chargements_en_cours.set(nom, promesse)
        }

        // Démonte et retire le modèle d'attente, puis renvoie les modèles englobants à reporter
        // sur les nœuds qui le remplacent, ou null si le bloc a été retiré entre-temps (celui qui
        // l'a retiré a nettoyé le modèle d'attente)
        const retirer_attente = async () =>
        {
            await Promise.all(noeuds_attente.map(n => demonter_noeud(n)))
            if (!ancre.parentNode || en_retrait(ancre)) return null

            const modeles_englobants = reprendre_modeles_englobants()
            for (const n of noeuds_attente)
            {
                nettoyer_noeud(n)
                n.parentNode?.removeChild(n)
            }
            return modeles_englobants
        }

        (async () =>
        {
            await chargements_en_cours.get(nom)

            // Bloc retiré, ou en cours de retrait : celui qui le retire nettoie le modèle d'attente
            if (!ancre.parentNode || en_retrait(ancre)) return

            if (!donnees.dependances[nom])
            {
                // Échec de chargement : afficher le modèle de repli
                const modeles_englobants = await retirer_attente()
                if (!modeles_englobants) return
                const noeuds_repli = construire_substitut(donnees.repli, donnees, classes)
                ajouter_modeles(noeuds_repli, modeles_englobants)
                return remplacer_ancre(ancre, noeuds_repli)
            }

            // Le modèle d'attente reste affiché jusqu'à la fin du script du modèle (await), au lieu
            // de laisser place à un second modèle d'attente : il est confié à l'attente du script
            const [ ancre_script ] = construire_modele(
                { ...bloc, args: [nom, ...bloc.args.slice(1)], classes }, donnees, { sans_attente: true, differer: true }
            )
            ancre.after(ancre_script)
            ancre_script._avec_attente_externe = {
                cle               : noeuds_attente.length ? cle_substitut(donnees.attente) : null,
                noeuds            : noeuds_attente,
                reprendre_modeles : reprendre_modeles_englobants,
                retirer_ancre     : () => ancre.remove()
            }
        })()

        return [ancre, ...noeuds_attente]
    }

    const modele = donnees.dependances[nom]
    const scope_modele = creer_scope(donnees.scope)
    const args = {}

    for (const enfant of modele.enfants)
    {
        if (enfant.type === `instruction` && enfant.args[0] === `@args`)
        {
            const declarations = extraire_declarations_args(decapsuler(enfant.args[1]))
            const declarations_par_nom = new Map()
            for (const declaration of declarations)
            {
                declarations_par_nom.set(declaration.nom, declaration)
            }

            const affectations = new Map()
            const arguments_appel = bloc.args[1]
                ? extraire_arguments_modele(decapsuler(bloc.args[1]))
                : []

            const obtenir_premier_argument_libre = () =>
            {
                for (const declaration of declarations)
                {
                    if (!affectations.has(declaration.nom))
                        return declaration.nom
                }
                return null
            }

            for (const argument_appel of arguments_appel)
            {
                if (argument_appel.nom)
                {
                    if (!declarations_par_nom.has(argument_appel.nom))
                        throw new Error(`argument nommé inconnu : ${argument_appel.nom}`)
                    if (affectations.has(argument_appel.nom))
                        throw new Error(`conflit d'affectation : ${argument_appel.nom} est défini plusieurs fois`)

                    affectations.set(argument_appel.nom, {
                        valeur_brute: argument_appel.valeur,
                        ternaire: argument_appel.ternaire ?? null
                    })
                    continue
                }

                const argument_libre = obtenir_premier_argument_libre()
                if (!argument_libre)
                    throw new Error(`trop d'arguments positionnels passés au modèle ${nom}`)

                affectations.set(argument_libre, {
                    valeur_brute: argument_appel.valeur,
                    ternaire: argument_appel.ternaire ?? null
                })
            }

            for (const declaration of declarations)
            {
                const { nom, valeur_defaut } = declaration
                const entree_affectation = affectations.has(nom)
                    ? affectations.get(nom)
                    : { valeur_brute: valeur_defaut ?? ``, ternaire: null }

                const valeur_brute   = entree_affectation.valeur_brute
                const ternaire_appel = entree_affectation.ternaire
                const valeur_decapsule = decapsuler_si_parentheses(valeur_brute)
                const valeur_texte = decapsuler_si_entoure(valeur_brute)

                if (ternaire_appel)
                {
                    const noeud_traceur = {}
                    definir_noeud_courant(noeud_traceur)
                    const condition_ok = evaluer(decapsuler(ternaire_appel.condition), donnees)
                    const branche_initiale = condition_ok ? ternaire_appel.vrai : ternaire_appel.faux
                    if (branche_initiale)
                    {
                        const branche_decapsule = decapsuler_si_parentheses(branche_initiale)
                        if (!extraire_appel_fonction(branche_decapsule))
                            evaluer_valeur(branche_decapsule, donnees)
                    }
                    effacer_noeud_courant()

                    if (noeud_traceur._avec_deps?.size > 0)
                    {
                        args[nom] = {
                            __avec_expression: true,
                            __evaluateur: (donnees) =>
                            {
                                const condition_ok = evaluer(
                                    decapsuler(ternaire_appel.condition),
                                    donnees
                                )
                                const branche = condition_ok
                                    ? ternaire_appel.vrai
                                    : ternaire_appel.faux

                                if (!branche) return null

                                const branche_decapsule = decapsuler_si_parentheses(branche)

                                const appel = extraire_appel_fonction(branche_decapsule)
                                if (appel)
                                {
                                    const { nom_fn, args_bruts } = appel
                                    const lecture = lire_variable(donnees.scope, donnees.args || {}, nom_fn, false)
                                    if (lecture.trouve && typeof lecture.valeur === 'function')
                                    {
                                        const args_evalues_bruts = decouper_haut_niveau(
                                            decapsuler(args_bruts),
                                            new Set([','])
                                        )
                                        const args_evalues = args_evalues_bruts.map(a => evaluer_valeur(a.trim(), donnees))
                                        return () => lecture.valeur(...args_evalues)
                                    }
                                }

                                return evaluer_valeur(branche_decapsule, donnees)
                            },
                            expression: valeur_brute,
                            donnees
                        }
                    }
                    else
                    {
                        if (branche_initiale)
                        {
                            const branche_decapsule = decapsuler_si_parentheses(branche_initiale)
                            const appel = extraire_appel_fonction(branche_decapsule)
                            if (appel)
                            {
                                const { nom_fn, args_bruts } = appel
                                const lecture = lire_variable(donnees.scope, donnees.args || {}, nom_fn, false)
                                if (lecture.trouve && typeof lecture.valeur === 'function')
                                {
                                    const args_evalues_bruts = decouper_haut_niveau(
                                        decapsuler(args_bruts),
                                        new Set([','])
                                    )
                                    const args_evalues = args_evalues_bruts.map(a => evaluer_valeur(a.trim(), donnees))
                                    args[nom] = () => lecture.valeur(...args_evalues)
                                    continue
                                }
                            }
                            args[nom] = evaluer_valeur(branche_decapsule, donnees)
                        }
                        else
                        {
                            args[nom] = null
                        }
                    }
                    continue
                }

                if (/^\$[a-zA-Z_][\w]*$/.test(valeur_decapsule))
                {
                    args[nom] = {
                        __avec_liaison_arg: true,
                        variable: valeur_decapsule,
                        scope: donnees.scope,
                        args: donnees.args || {}
                    }
                    continue
                }

                const appel = extraire_appel_fonction(valeur_decapsule)
                if (appel)
                {
                    const { nom_fn, args_bruts } = appel
                    const lecture = lire_variable(donnees.scope, donnees.args || {}, nom_fn, false)
                    if (lecture.trouve && typeof lecture.valeur === 'function')
                    {
                        // Évaluer les arguments au moment de la construction (dans le scope courant)
                        const args_evalues_bruts = decouper_haut_niveau(
                            decapsuler(args_bruts),
                            new Set([','])
                        )
                        const args_evalues = args_evalues_bruts.map(a => evaluer_valeur(a.trim(), donnees))

                        args[nom] = () => lecture.valeur(...args_evalues)
                        continue
                    }
                }
                
                // Si c'est une string literal, valoriser directement sans passer par evaluer_valeur
                if ((valeur_brute.startsWith('"') && valeur_brute.endsWith('"'))
                 || (valeur_brute.startsWith("'") && valeur_brute.endsWith("'"))
                 || (valeur_brute.startsWith('`') && valeur_brute.endsWith('`')))
                {
                    args[nom] = valoriser(valeur_texte, donnees)
                    continue
                }

                const noeud_traceur = {}
                definir_noeud_courant(noeud_traceur)
                const valeur_evaluee = evaluer_valeur_ou_erreur(valeur_decapsule, donnees)
                effacer_noeud_courant()

                if (valeur_evaluee !== ':x')
                {
                    if (noeud_traceur._avec_deps?.size > 0)
                    {
                        args[nom] = {
                            __avec_expression: true,
                            expression: valeur_decapsule,
                            donnees
                        }
                    }
                    else
                    {
                        args[nom] = valeur_evaluee
                    }
                    continue
                }

                const lecture = lire_variable(donnees.scope, donnees.args || {}, valeur_decapsule, false)
                if (lecture.trouve)
                {
                    args[nom] = lecture.valeur
                }
                else
                {
                    args[nom] = valoriser(valeur_decapsule, donnees)
                }
            }
        }
    }

    let attente_script = null
    for (const enfant of modele.enfants)
    {
        if (enfant.type === `instruction` && enfant.args[0] === `@style`)
        {
            const css = retirer_crochets(enfant.args[1])
            activer_style(nom, css)
        }
        if (enfant.type === `instruction` && enfant.args[0] === `@script`)
        {
            const js = retirer_crochets(enfant.args[1])
            attente_script = activer_script(nom, js, scope_modele, args) ?? attente_script
        }
    }

    const donnees_modele = {
        ...donnees,
        scope: scope_modele,
        args: args,
        tenons: [...donnees.tenons, { enfants: bloc.enfants, donnees }]
    }

    const construire = () =>
    {
        const noeuds = construire_bloc(modele, donnees_modele)
        appliquer_classes_racine(noeuds, classes)
        return noeuds
    }

    // Le porteur garde la liste des modèles qu'il représente (un modèle dont la racine est un
    // autre modèle en ajoute un), pour désactiver leurs styles et scripts au retrait
    const modele_actif = { nom, scope: scope_modele }

    if (attente_script || options.differer)
        return construire_apres_script(attente_script ?? Promise.resolve(), construire, modele_actif, classes, donnees, options.sans_attente, reprise)

    const noeuds = construire()
    ajouter_modeles(noeuds, [modele_actif])

    return noeuds
}

const monter_noeud = (noeud) =>
{
    if (noeud.nodeType === 1)
    {
        // Un nœud en cours de retrait a déjà été démonté : il ne doit pas être remonté
        if (noeud._avec_monte || en_retrait(noeud))
            return

        noeud._avec_monte = true

        if (noeud._avec_actions?.mount)
        {
            executer_script(noeud._avec_actions.mount, null, noeud, noeud._avec_scope, noeud._avec_args)
        }
    }
}

const noeuds_entre = (ancre_debut, ancre_fin) =>
{
    const noeuds = []
    for (let noeud = ancre_debut.nextSibling; noeud && noeud !== ancre_fin; noeud = noeud.nextSibling)
        noeuds.push(noeud)
    return noeuds
}

// Un nœud en cours de retrait (ou placé dans un tel nœud) ne réagit plus aux changements de
// variables : pendant son démontage (animation de sortie…), il garde l'état qu'il avait
const en_retrait = (noeud) =>
{
    for (let courant = noeud; courant; courant = courant.parentNode)
        if (courant._avec_retrait)
            return true
    return false
}

// Démonte puis retire les nœuds placés entre deux ancres (@if, @for). Pendant le démontage,
// un modèle différé qui finit de se charger peut remplacer les siens : les nœuds sont relevés
// à nouveau jusqu'à ce qu'aucun nouveau n'apparaisse, pour ne rien laisser derrière
const vider_entre_ancres = async (ancre_debut, ancre_fin) =>
{
    const demontes = new Set()
    for (;;)
    {
        const nouveaux = noeuds_entre(ancre_debut, ancre_fin).filter(n => !demontes.has(n))
        if (nouveaux.length === 0)
            break
        nouveaux.forEach(n =>
        {
            n._avec_retrait = true
            demontes.add(n)
        })
        await Promise.all(nouveaux.map(n => demonter_noeud(n)))
    }

    const noeuds = noeuds_entre(ancre_debut, ancre_fin)
    for (const n of noeuds)
        n.parentNode.removeChild(n)
    for (const n of noeuds)
        nettoyer_noeud(n)
}

const demonter_noeud = async (noeud) =>
{
    if (noeud.nodeType === 1)
    {
        if (noeud._avec_monte && noeud._avec_actions?.unmount)
        {
            await executer_script_async(noeud._avec_actions.unmount, null, noeud, noeud._avec_scope, noeud._avec_args)
        }

        noeud._avec_monte = false

        await Promise.all([...noeud.children].map(enfant => demonter_noeud(enfant)))
    }
}

const nettoyer_noeud = (noeud) =>
{
    for (const { nom, scope } of noeud._avec_modeles ?? [])
    {
        desactiver_style(nom)
        desactiver_script(nom, scope)
    }
    noeud._avec_modeles = null

    if (noeud.nodeType === 1)
    {
        for (const enfant of noeud.childNodes)
        {
            nettoyer_noeud(enfant)
        }
    }
}
