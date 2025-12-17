console.log(`\
╔══════╗
║ AVEC ║
╚══════╝`)

const initialiser = async () =>
{
    index = await charger_modele(`index`)
    if (index)
    {
        document.querySelector(`#avec`).textContent = JSON.stringify(index, null, 2)
    }
}

const charger_modele = async (nom) =>
{
    try
    {
        const reponse = await fetch(`/actifs/modeles/${nom}.avec`)
        if (!reponse.ok)
        {
            throw new Error(`Echec du chargement du modèle « ${nom} » (statut : ${reponse.status})`)
        }
        const modele = await reponse.json()
        console.log(`Modèle « ${nom} » chargéavec succès`)
        return modele
    }
    catch (erreur)
    {
        console.error(erreur)
        return null
    }
}

document.addEventListener("DOMContentLoaded", initialiser)
