export const etat_sculpteur = {
    instance: null
}

const scripts_actifs = new Map()

export const initialiser_sculpteur = () =>
{
    if (etat_sculpteur.instance) return

    etat_sculpteur.instance = {}
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