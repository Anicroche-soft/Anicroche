export const etat_sculpteur = {
    instance: null
}

const scripts_actifs = new Map()
const observateurs   = new Set()

// Le nœud en cours de construction (pour tracker ses dépendances)
let noeud_courant = null

export const definir_noeud_courant = (noeud) => { noeud_courant = noeud }
export const effacer_noeud_courant = ()       => { noeud_courant = null  }

export const observer_sculpteur = (fn) =>
{
    observateurs.add(fn)
    return () => observateurs.delete(fn) // Retourne une fonction pour se désabonner
}

const notifier = (propriete, valeur, ancienne_valeur) =>
{
    for (const fn of observateurs)
        fn(propriete, valeur, ancienne_valeur)
}

export const initialiser_sculpteur = () =>
{
    if (etat_sculpteur.instance) return

    etat_sculpteur.instance = new Proxy({}, {
        get(cible, propriete)
        {
            // Enregistrer la dépendance sur le nœud en cours de construction
            if (noeud_courant && typeof propriete === 'string')
            {
                if (!noeud_courant._avec_deps)
                    noeud_courant._avec_deps = new Set()
                noeud_courant._avec_deps.add(propriete)
            }
            return cible[propriete]
        },

        set(cible, propriete, valeur)
        {
            const ancienne_valeur = cible[propriete]
            cible[propriete] = valeur

            if (ancienne_valeur !== valeur)
                notifier(propriete, valeur, ancienne_valeur)

            return true
        }
    })
}

export const executer_script = (script, evenement, noeud) =>
{
    if (etat_sculpteur.instance)
    {
        try
        {
            new Function(
                `runtime`,
                `$event`,
                `$node`,
                `
                with (runtime) {
                    ${script}
                }
                `
            )(etat_sculpteur.instance, evenement, noeud)
        }
        catch (erreur)
        {
            console.error(`Erreur handler AVEC :`, erreur)
        }
    }
}

export const activer_script = (modele, js) =>
{
    initialiser_sculpteur()

    if (scripts_actifs.has(modele))
    {
        scripts_actifs.get(modele).compte++
    }
    else
    {
        const fonction = new Function(
            `runtime`,
            `
            with (runtime)
            {
                ${js}
            }
            `
        )

        fonction(etat_sculpteur.instance)

        scripts_actifs.set(modele, {
            code: js,
            compte: 1
        })
    }
}

export const desactiver_script = (modele) =>
{
    const entree = scripts_actifs.get(modele)
    if (entree)
    {
        entree.compte--
        if (entree.compte <= 0)
        {
            scripts_actifs.delete(modele)
        }
    }
}
