// ─── Ordres de tri ────────────────────────────────────────────────────────────
// Un ordre s'écrit [[champ, sens], …], le sens (increasing ou decreasing) étant obligatoire.
// Il est lu en { champ, sens }, le champ étant celui du modèle.

const SENS_SQL = { increasing: 'ASC', decreasing: 'DESC' }

export const est_hache = (champ) =>
    champ.treatment === 'hashing' || champ.treatment === 'deterministic_hashing'

export const est_chiffre = (champ) => champ.treatment === 'encryption'

export const lire_tri = (champs, order, origine) =>
{
    if (!Array.isArray(order) || !order.length)
        throw new Error(`${origine} : ordre attendu sous la forme [[champ, increasing | decreasing], …]`)

    return order.map(element =>
    {
        if (!Array.isArray(element) || element.length !== 2)
            throw new Error(`${origine} : chaque clef de tri s'écrit [champ, increasing | decreasing], ${JSON.stringify(element)} trouvé`)

        const [nom, sens] = element
        const champ = champs.find(champ => champ.name === nom)
        if (!champ)
            throw new Error(`${origine} : champ inconnu « ${nom} »`)
        if (!Object.hasOwn(SENS_SQL, sens))
            throw new Error(`${origine} : sens de « ${nom} » : « ${sens} » (increasing ou decreasing attendu)`)
        // Une valeur hachée ne dit rien de la valeur d'origine : trier dessus n'a pas de sens
        if (est_hache(champ))
            throw new Error(`${origine} : le champ haché « ${nom} » ne peut pas servir au tri`)

        return { champ, sens }
    })
}

// ?order=champ,sens;champ,sens
export const analyser_tri_url = (brut) =>
    String(brut)
        .split(';')
        .map(clef => clef.trim())
        .filter(Boolean)
        .map(clef => clef.split(',').map(morceau => morceau.trim()))

// Ordre de @rules, sinon la clef primaire (sans ses champs hachés) : l'ordre des résultats ne
// dépend jamais de la base
export const tri_par_defaut = (modele) =>
    modele.rules?.order
        ? lire_tri(modele.fields, modele.rules.order, `@rules order de ${modele.name}`)
        : (modele.primary ?? [])
            .map(nom => ({ champ: modele.fields.find(champ => champ.name === nom), sens: 'increasing' }))
            .filter(({ champ }) => champ && !est_hache(champ))

// Un champ chiffré n'est comparable qu'une fois déchiffré, en JS
export const tri_en_sql = (tri) => !tri.some(({ champ }) => est_chiffre(champ))

export const clause_tri = (table, tri) =>
    tri.length
        ? ` ORDER BY ${tri.map(({ champ, sens }) => `\`${table}\`.\`${champ.name}\` ${SENS_SQL[sens]}`).join(', ')}`
        : ''

const EST_NOMBRE = /^(tiny|small|medium|big)?int|^decimal|^float|^double/
const EST_DATE   = /^date|^timestamp/

// Valeur comparable selon le type du champ (comme la base les compare)
export const comparable = (champ, valeur) =>
{
    if (valeur === null || valeur === undefined)
        return null
    if (EST_NOMBRE.test(champ.type) || champ.type === 'boolean')
        return Number(valeur)
    if (EST_DATE.test(champ.type))
        return new Date(valeur).getTime()
    return String(valeur)
}

// Comparaison de deux lignes déchiffrées ; une valeur nulle vient en premier dans l'ordre
// croissant, comme en SQL
export const comparer_lignes = (tri) => (a, b) =>
{
    for (const { champ, sens } of tri)
    {
        const va = comparable(champ, a[champ.name])
        const vb = comparable(champ, b[champ.name])
        if (va === vb)
            continue

        const resultat = va === null ? -1 : vb === null ? 1 : va < vb ? -1 : 1
        return sens === 'increasing' ? resultat : -resultat
    }
    return 0
}
