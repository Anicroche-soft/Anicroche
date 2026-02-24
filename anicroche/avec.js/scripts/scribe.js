import {etat_sculpteur} from "./sculpteur.js"

export const valoriser = (str, donnees) =>
{
    let valeur = str.replace(/(?<!\\)\$[a-zA-Z_][\w]*/g, (nom) => {
        if (nom in (donnees.args || {}))
            return donnees.args[nom].replace(/\\/g, "\\\\")
        else if (etat_sculpteur.instance && nom in etat_sculpteur.instance)
            return String(etat_sculpteur.instance[nom]).replace(/\\/g, "\\\\")
        else
            return nom
    }).replace(/\\(.)/g, "$1")
    return valeur
}
