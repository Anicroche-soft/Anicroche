export const charger_modele = async (nom) =>
{
    try
    {
        const reponse = await fetch(`/systeme/modeles/${nom}.avec`, {
            headers: {'X-AC-Composant': `true`}
        })
        if (!reponse.ok)
        {
            throw new Error(`Echec du chargement du modèle « ${nom} » (statut : ${reponse.status})`)
        }
        const modele = await reponse.json()
        console.log(`Modèle « ${nom} » chargé avec succès`)
        return modele
    }
    catch (erreur)
    {
        console.error(erreur)
        return null
    }
}
