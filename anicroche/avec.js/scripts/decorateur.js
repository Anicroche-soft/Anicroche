const styles_actifs = new Map()

export const activer_style = (modele, css) =>
{
    if (styles_actifs.has(modele))
    {
        styles_actifs.get(modele).compte++
    }
    else
    {
        const style = document.createElement(`style`)
        style.dataset.avec = modele
        style.textContent = css

        document.head.appendChild(style)

        styles_actifs.set(modele, {
            element: style,
            compte: 1
        })
    }
}

export const desactiver_style = (modele) =>
{
    const entree = styles_actifs.get(modele)
    if (entree)
    {
        entree.compte--
        if (entree.compte <= 0)
        {
            entree.element.remove()
            styles_actifs.delete(modele)
        }
    }
}
