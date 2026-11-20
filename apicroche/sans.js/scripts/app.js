// Configuration lue dans app.adn au démarrage : $app dans les scripts et les expressions
let app = {}

export const definir_app = (adn) =>
{
    app = adn ?? {}
}

export const lire_app = () => app
