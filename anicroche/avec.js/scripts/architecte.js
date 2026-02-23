console.log(`\
╔══════╗
║ AVEC ║
╚══════╝`)

import {initialiser_navigateur} from './navigateur.js'
import {initialiser_batisseur} from './batisseur.js'

const initialiser = async () =>
{
    initialiser_navigateur()
    initialiser_batisseur()
}

document.addEventListener("DOMContentLoaded", initialiser)
