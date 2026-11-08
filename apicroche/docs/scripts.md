# Scripts

## `@script`

Le bloc `@script` d'un modèle contient du JavaScript. Les fonctions déclarées sous la forme `$nom = (…) => { … }` (ou `$nom = async (…) => { … }`) peuvent être appelées par les [routes déclarées](routes.md#routes-déclarées--routes) et les [hooks](routes.md#hooks) du modèle.

```
@script [
    $obtenir_compte = async () =>
    {
        const compte = await $search_one('compte',
            `#id = $id`,
            { $id: $context.compte.id }
        )

        return $indicate(200, 'Compte récupéré', compte)
    }
]
```

- Seules les déclarations de la forme `$nom = (…) =>` sont exportées ; une fonction déclarée autrement reste utilisable à l'intérieur du script mais ne peut pas être appelée par une route ou un hook.
- Le script est évalué à chaque requête : les variables (`$body`, `$request`, `$context`…) et fonctions ci-dessous désignent toujours celles de la requête en cours.
- Les fonctions du `@script` d'`index.sans` sont accessibles depuis les scripts de tous les modèles.

---

## Variables disponibles

| Variable | Contenu |
|---|---|
| `$body` | Corps JSON de la requête (`{}` s'il est absent ou invalide) |
| `$request` | La requête (voir ci-dessous) |
| `$context` | Objet partagé pendant toute la requête, initialement vide ; typiquement rempli par une action `prior_respond` (ex. `$context.compte`) |

### `$request`

| Propriété | Contenu |
|---|---|
| `ip` | Adresse IP du client (première adresse de `X-Forwarded-For` si présent) |
| `user_agent` | En-tête `User-Agent` |
| `path` | Chemin de l'URL |
| `headers` | En-têtes de la requête |
| `cookies` | Cookies de la requête (`{ nom: valeur }`) |
| `params` | Paramètres de l'URL (`:nom` dans le chemin de la route) |

---

## Fonctions disponibles

| Fonction | Description |
|---|---|
| [`$indicate`](#indicate) | Envoyer la réponse |
| [`$add_to_data`](#add_to_data) | Ajouter une donnée dans `data` |
| [`$add_to_respond`](#add_to_respond) | Ajouter une clef au premier niveau de la réponse |
| [`$set_cookie`](#set_cookie) | Poser un cookie |
| [`$sign_token`, `$verify_token`](#sign_token-et-verify_token) | Créer et vérifier un jeton JWT |
| [`$send_email`](#send_email) | Envoyer un courriel |
| [`$q`](#q) | Insérer une valeur littérale dans une condition |
| `$search_one`, `$search_all`, `$create_one`, `$create_all`, `$update_one`, `$update_all`, `$delete_one`, `$delete_all` | [Magasin](magasin.md) |

### `$indicate`

```javascript
return $indicate(code, message, data)
```

Envoie la réponse et **interrompt** le traitement (la fonction lève une exception interne interceptée par le cadriciel ; le code qui suit n'est pas exécuté).

- `code` : code HTTP ;
- `message` : placé dans `message` (succès `2xx`) ou `error` ;
- `data` : données de la réponse (`{}` par défaut). Si `data` est un objet, les données ajoutées par `$add_to_data` y sont fusionnées.

Les actions [`post_respond`](#indexsans-et-actions) sont exécutées juste avant l'envoi.

### `$add_to_data`

```javascript
$add_to_data('id', $values.id)
```

Ajoute `valeur` à la clef `clef` de l'objet `data` de la réponse, que celle-ci soit envoyée par `$indicate` ou automatiquement (ex. `201 Créé`). Une clef déjà ajoutée n'est pas remplacée.

### `$add_to_respond`

```javascript
$add_to_respond('est_connecte', true)
```

Ajoute une clef au premier niveau de la réponse (à côté de `code`, `message` et `data`). Les clefs `code`, `message`, `error` et `data` sont réservées ; une clef déjà ajoutée n'est pas remplacée.

### `$set_cookie`

```javascript
$set_cookie(name, value, options)
```

| Option | Défaut | Description |
|---|---|---|
| `lifetime` | `30d` | Durée de vie (`15m`, `1h`, `30d`, ou un nombre de secondes ; `0` supprime le cookie) |
| `httpOnly` | `true` | Cookie inaccessible au JavaScript du navigateur |
| `secure` | `true` en mode `prod` | Cookie envoyé uniquement en HTTPS |
| `sameSite` | `None` en mode `prod`, sinon `Lax` | Politique `SameSite` |
| `path` | `/` | Chemin du cookie |

### `$sign_token` et `$verify_token`

```javascript
const jeton = await $sign_token({ id_compte: compte.id }, { lifetime: '15m' })
const payload = await $verify_token(jeton)
```

- `$sign_token(payload, options)` crée un jeton JWT (HS256, clef `secret_jwt`) contenant `payload` et les dates d'émission et d'expiration. `lifetime` vaut `15m` par défaut.
- `$verify_token(jeton)` renvoie le contenu du jeton s'il est valide et non expiré, `null` sinon.

### `$send_email`

```javascript
await $send_email({
    to      : 'adresse@exemple.fr',
    subject : 'Votre code',
    content : '<p>Votre code : <strong>123 456 789</strong></p>',
    text    : 'Votre code : 123 456 789'
})
```

Envoie un courriel par le serveur SMTP configuré (voir [variables d'environnement](demarrage.md#courriel)). `content` est le contenu HTML ; `text`, la version texte, est déduite du HTML si elle est absente.

### `$q`

```javascript
await $search_all('profils', `#identifiant = ${$q(identifiant)}`)
```

Renvoie la valeur sous forme de littéral (texte JSON entre guillemets), pour l'insérer directement dans une condition. Il est généralement plus simple de passer la valeur dans le contexte de la condition (`#identifiant = $identifiant`, voir [Magasin](magasin.md#conditions)).

---

## `index.sans` et `@actions`

Le modèle `index.sans` ne crée pas de table. Il peut contenir :

- un `@script` dont les fonctions sont accessibles depuis tous les modèles ;
- des `@routes` ;
- des `@actions`, exécutées autour de chaque requête ou périodiquement.

```
@actions [
    {
        prior_respond : $rafraichir_jeton()
    }

    {
        post_respond : $detecter_connexion()
        when         : "$request.path != '/sante'"
    }

    {
        periodically : $nettoyer_sessions()
        period       : 1d
    }
]
```

| Propriété | Description |
|---|---|
| `prior_respond` | Fonction appelée avant le traitement de chaque route (déclarée ou automatique). Arguments reconnus : `$body`, `$request`, `$context`. Elle peut remplir `$context` ou répondre directement avec `$indicate` (la route n'est alors pas traitée) |
| `post_respond` | Fonction appelée quand une réponse est envoyée avec `$indicate`, juste avant l'envoi. Arguments reconnus : `$body`, `$request`, `$context`. Elle peut ajouter des données avec `$add_to_data` / `$add_to_respond` |
| `when` | Expression augure optionnelle : l'action n'est exécutée que si elle est vraie. Pour `prior_respond` / `post_respond`, elle a accès à `$request` ; pour une tâche périodique, à `$now` |
| `periodically` | Fonction exécutée périodiquement. Arguments reconnus : `$now`, `$body`, `$request`, `$context` (vides) |
| `period` | Période d'une tâche périodique : `<n>m` (minutes), `<n>h` (heures) ou `<n>d` (jours) |

Les tâches périodiques sont vérifiées chaque minute (`m`), au début de chaque heure (`h`) ou chaque jour à minuit (`d`), et exécutées dès que la période est écoulée depuis la dernière exécution. La première exécution a lieu à la première échéance après le démarrage. Leurs fonctions ont accès au magasin, à `$send_email` et à `$q`.
