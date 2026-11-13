// Chemins de routes : segments fixes et captures <$nom>, <$nom :+ caractères> ou <$nom :- caractères>,
// même syntaxe que l'opérateur ~= d'avec.js

export const normaliser_url = (url) =>
    '/' + String(url ?? '').split('/').filter(Boolean).join('/')

const lire_caracteres = (texte) =>
{
    const brut = texte.trim()
    const guillemets = /^(["'`])(.*)\1$/s.exec(brut)
    return (guillemets ? guillemets[2] : brut).replace(/\\(.)/g, '$1')
}

// Lève une erreur si le chemin est invalide
export const compiler_chemin = (chemin) =>
{
    const texte = String(chemin ?? '').trim()
    if (!texte.startsWith('/'))
        throw new Error(`le chemin doit commencer par / : « ${texte} »`)

    const ancien = texte.split('/').find(segment => segment.startsWith(':'))
    if (ancien)
        throw new Error(`la syntaxe ${ancien} n'existe plus, écrire <$${ancien.slice(1)}> : « ${texte} »`)

    const segments = []
    let pos = 0
    while (pos < texte.length)
    {
        const debut = texte.indexOf('<$', pos)
        if (debut < 0 || debut > pos)
        {
            const fin = debut < 0 ? texte.length : debut
            segments.push({ type: 'fixe', texte: texte.slice(pos, fin) })
            pos = fin
            continue
        }

        const fin = texte.indexOf('>', debut)
        if (fin < 0)
            throw new Error(`capture non refermée par > : « ${texte} »`)

        const capture = /^<\$(\w+)(?:\s+(:[+-])\s*(.*))?>$/s.exec(texte.slice(debut, fin + 1))
        if (!capture)
            throw new Error(`capture invalide ${texte.slice(debut, fin + 1)} (format : <$nom>, <$nom :+ caractères> ou <$nom :- caractères>) : « ${texte} »`)

        const precedent = segments.at(-1)
        if (precedent?.type === 'capture')
            throw new Error(`deux captures doivent être séparées par un texte fixe : « ${texte} »`)

        segments.push({
            type     : 'capture',
            nom      : capture[1],
            mode     : capture[2] ?? null,
            filtrage : capture[2] ? lire_caracteres(capture[3] ?? '') : null
        })
        pos = fin + 1
    }

    const noms = segments.filter(s => s.type === 'capture').map(s => s.nom)
    const double = noms.find((nom, i) => noms.indexOf(nom) !== i)
    if (double)
        throw new Error(`capture $${double} présente deux fois : « ${texte} »`)

    if (!noms.length)
        segments.splice(0, segments.length, { type: 'fixe', texte: normaliser_url(texte) })

    return { chemin: texte, segments }
}

const caractere_accepte = (segment, c) =>
{
    if (segment.mode === ':+' && segment.filtrage)
        return segment.filtrage.includes(c)
    if (segment.mode === ':-')
        return !segment.filtrage.includes(c)
    return c !== '/'
}

// Retourne les paramètres capturés, ou null si l'adresse ne correspond pas.
// Une capture ne peut pas être vide : un segment vide s'écrit `-` dans l'adresse
export const correspondre_chemin = (compile, url) =>
{
    const adresse = normaliser_url(url)
    const params  = {}
    let pos = 0

    for (let i = 0; i < compile.segments.length; i++)
    {
        const segment = compile.segments[i]
        if (segment.type === 'fixe')
        {
            if (!adresse.startsWith(segment.texte, pos))
                return null
            pos += segment.texte.length
            continue
        }

        const suivant = compile.segments[i + 1]?.texte ?? null
        const debut   = pos
        while (pos < adresse.length && !(suivant && adresse.startsWith(suivant, pos)) && caractere_accepte(segment, adresse[pos]))
            pos++
        if (pos === debut)
            return null

        try
        {
            const valeur = decodeURIComponent(adresse.slice(debut, pos))
            params[segment.nom] = valeur === '-' ? '' : valeur
        }
        catch
        {
            return null
        }
    }

    return pos === adresse.length ? params : null
}
