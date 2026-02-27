export const charger_modele = async (nom, connus = []) =>
{
    try
    {
        const reponse = await fetch(`/systeme/modeles/${nom}.avec`, {
            headers: {
                'X-AC-Composant': `true`,
                'X-AC-Connus': connus.join(',')
            }
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
