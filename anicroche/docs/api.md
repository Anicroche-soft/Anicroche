# Requêtes vers l'API

avec.js met à disposition, à la racine du scope, des fonctions pour communiquer avec une API (typiquement une API sans.js). Elles s'utilisent dans les scripts (`@script`, événements, `@mount`…).

L'adresse de l'API est donnée par la variable d'environnement `api_url` du serveur (voir [Démarrage](demarrage.md#variables-denvironnement)). Si elle contient `localhost`, ce nom est remplacé par celui de la page courante, ce qui permet d'accéder à l'API depuis un autre appareil du réseau local.

## Fonctions

| Fonction | Requête |
|---|---|
| `$create(ressource, donnees)` | `POST` avec `donnees` en corps JSON |
| `$search(ressource, parametres)` | `GET` avec `parametres` dans l'URL (`?clef=valeur`) |
| `$update(ressource, donnees, parametres)` | `PATCH` avec `donnees` en corps JSON |
| `$delete(ressource, parametres)` | `DELETE` |

- `ressource` est le chemin de la route, relatif à l'adresse de l'API (`'connexion'`, `'profil/ABC123'`, `'/moi'`).
- Les cookies sont envoyés avec chaque requête (`credentials: 'include'`).
- Chaque fonction renvoie la réponse JSON complète de l'API (`{ code, message | error, data, … }`), quel que soit le code de retour.

```
@script [
    $connecter = async () =>
    {
        const reponse = await $create('connexion', {
            coordonnee   : $coordonnee,
            mot_de_passe : $mot_de_passe
        })

        if (reponse.code !== 200)
            $erreur = reponse.error
    }

    $charger_profils = async () =>
    {
        const reponse = await $search('profils', { projection: 'id;pseudonyme' })
        $profils = reponse.data
    }
]
```

Avec une API sans.js, `$create`, `$search`, `$update` et `$delete` correspondent aux [routes automatiques](../../apicroche/docs/routes.md) `POST /<entrée>`, `GET`, `PATCH /<entrée>/<$clef>` et `DELETE /<entrée>/<$clef>`.

## Actions autour des requêtes — `$add_action`

`$add_action(cas, fonction)` enregistre une fonction exécutée autour de chaque requête :

| Cas | Appel | Usage |
|---|---|---|
| `'prior_requested'` | `fonction(options)` avant l'envoi | Modifier la requête : `options.url` (objet `URL`), `options.method`, `options.headers`, `options.body` |
| `'post_requested'` | `fonction(data, options)` après la réception | Réagir à la réponse : `data` est la réponse JSON, `options` la requête envoyée |

La fonction peut modifier l'objet reçu, ou renvoyer un objet dont les propriétés y sont fusionnées. Les fonctions sont exécutées dans l'ordre d'enregistrement et peuvent être asynchrones.

```
@script [
    $add_action('prior_requested', async (options) =>
    {
        if ($jeton_acces)
            options.headers['Authorization'] = `Bearer ${$jeton_acces}`
    })

    $add_action('post_requested', async (data, options) =>
    {
        if (data?.data?.jeton_acces)
            $jeton_acces = data.data.jeton_acces
    })
]
```

`$add_action` renvoie une fonction qui retire l'action. Une action enregistrée dans un `@script` est retirée automatiquement quand l'instance du modèle est démontée.
