# Routes

sans.js génère des routes à partir des propriétés des champs et des règles des modèles, et permet de déclarer des routes sur mesure dans `@routes`.

Toutes les routes répondent au [format JSON commun](demarrage.md#format-des-réponses). Avant chaque route, les actions [`prior_respond`](scripts.md#indexsans-et-actions) d'`index.sans` sont exécutées.

---

## Routes automatiques

| Route | Générée si | Rôle |
|---|---|---|
| `POST /<entrée>` | au moins un champ a `can_create` | Créer une entrée |
| `GET /<table>` | toujours | Rechercher des entrées |
| `GET /<entrée>/:<clef>` | le modèle a une clef primaire | Lire une entrée |
| `PATCH /<entrée>/:<clef>` | au moins un champ a `can_update` | Modifier une entrée |
| `DELETE /<entrée>/:<clef>` | `@rules` contient `can_delete` | Supprimer une entrée |

`:<clef>` reprend les champs de la clef primaire (`/coordonnee/:hachage_coordonnee`, ou plusieurs segments pour une clef composite). Pour un champ haché, l'URL contient la valeur en clair.

### Expressions d'autorisation

Les propriétés `can_*` sont des expressions [augure](magasin.md#expressions-augure) qui doivent être vraies pour autoriser l'opération (sinon : `403 Accès refusé`). Elles ont accès à :

| Variable | Contenu |
|---|---|
| `$request` | La [requête](scripts.md#request) (`$request.params`, `$request.cookies`…) |
| `$context` | Le contexte rempli par les actions `prior_respond` (ex. `$context.compte`) |
| `$params` | Les paramètres de l'URL |
| `$<champ>` | Pour `can_create` et `can_update` uniquement : la valeur du champ dans le corps de la requête (`:x` si absente) |

Les propriétés `restrict_*` sont des [conditions](magasin.md#conditions) qui restreignent les lignes concernées (elles peuvent porter sur les champs `#…` et utiliser `$context`, `$request` et `$params`).

### Hooks

Les propriétés `prior_*` et `post_*` appellent une fonction du [`@script`](scripts.md) du modèle, sous la forme `$fonction($arg1, $arg2)`. Les arguments reconnus sont, selon la route :

| Argument | Contenu |
|---|---|
| `$body` | Corps JSON de la requête |
| `$request` | La requête |
| `$context` | Le contexte de la requête |
| `$values` | Les valeurs créées, modifiées ou supprimées (voir chaque route) |
| `$results` | Les résultats de la recherche (`post_search` uniquement) |

Un hook peut interrompre la route en appelant `$indicate(…)` : la réponse est envoyée et la suite du traitement n'est pas exécutée. Il peut aussi ajouter des données à la réponse avec `$add_to_data(clef, valeur)`.

### Codes de réponse

| Code | Cas |
|---|---|
| `200` / `201` | Succès |
| `400` | Corps de requête inutilisable (ex. aucun champ modifiable dans un `PATCH`) |
| `403` | Expression `can_*` fausse, ou aucun champ consultable |
| `404` | Entrée introuvable (ou exclue par une restriction) |
| `409` | Suppression d'une entrée encore référencée par une clef étrangère |
| `422` | Valeur invalide : énumération, taille, `rule`, ou référence vers une entrée inexistante |
| `429` | Limite de requêtes dépassée (voir [`@limits`](#limites-par-ip--limits)) |
| `500` | Erreur imprévue (le détail est affiché dans les journaux) |

---

## `POST /<entrée>` — Création

Route générée dès qu'au moins un champ déclare `can_create`.

| Propriété (champ) | Description |
|---|---|
| `can_create` | Le champ peut être fourni dans le corps. Toutes les expressions `can_create` doivent être vraies |
| `prior_create` | Hook appelé juste avant l'insertion |
| `post_create` | Hook appelé juste après l'insertion |

Déroulement :

1. vérification de toutes les expressions `can_create` (`403` sinon) ;
2. lecture des champs `can_create` dans le corps (sous leur nom [`alt`](modeles.md#alt) s'il existe) ; les autres champs du corps sont ignorés ;
3. génération des valeurs `default : auto` hors contraintes et des valeurs `default : $autre_champ` ;
4. vérification des règles (`422` sinon) ;
5. hooks `prior_create` de tous les champs, dans l'ordre de déclaration ;
6. insertion (les valeurs `auto` uniques sont générées à ce moment) ;
7. hooks `post_create`, dont `$values` contient alors aussi les valeurs générées (identifiant…) ;
8. réponse `201 Créé`.

Arguments des hooks : `$body`, `$request`, `$context`, `$values` (valeurs à insérer).

```
{
    name         : code
    type         : hash
    can_create   : "$type = authentification"
    prior_create : $preparer_code($values)
    post_create  : $notifier_creation($values)
}
```

## `GET /<table>` et `GET /<entrée>/:<clef>` — Recherche

| Propriété | Où | Description |
|---|---|---|
| `can_search` | `@rules` | Accès à la route. Si elle est absente, la route est accessible |
| `restrict_search` | `@rules` | Condition qui restreint les lignes renvoyées |
| `prior_search`, `post_search` | `@rules` | Hooks du modèle |
| `can_search` | champ | Le champ est renvoyé si l'expression est vraie. **Un champ sans `can_search` n'est jamais renvoyé** |
| `restrict_search` | champ | Condition évaluée ligne par ligne : le champ est retiré des lignes qui ne la respectent pas |
| `prior_search`, `post_search` | champ | Hooks exécutés si le champ est renvoyé |

Si aucun champ n'est consultable, la route répond `403`.

Le paramètre d'URL `projection` choisit les champs et relations renvoyés, avec la syntaxe de l'option [`select`](magasin.md#select--projection) :

```
GET /profils?projection=id;pseudonyme;gerants.id
```

Ordre d'exécution : `prior_search` du modèle, `prior_search` des champs, recherche, `post_search` des champs, `post_search` du modèle.

Arguments des hooks : `$body`, `$request`, `$context`, et `$results` (résultats filtrés) pour `post_search`.

Réponse : `200 OK` avec la liste des entrées (`GET /<table>`) ou l'entrée (`GET /<entrée>/:<clef>`), `404` si l'entrée est introuvable.

### Accès aux relations

Une relation demandée dans la projection doit être explicitement autorisée :

| Propriété (relation) | Description |
|---|---|
| `can_search` | Autorise la relation dans le sens direct. **Sans elle, la relation n'est pas récupérable** |
| `restrict_search` | Condition sur les entrées liées (sens direct), évaluée dans le modèle lié |
| `rev_can_search` | Autorise la relation dans le sens inverse (à défaut : `can_search`) |
| `rev_restrict_search` | Condition sur les entrées liées dans le sens inverse (à défaut : `restrict_search`) |

Pour chaque relation, le `can_search` et le `restrict_search` de `@rules` du modèle lié s'appliquent aussi. Ces vérifications sont faites à chaque niveau d'imbrication. Une relation non autorisée donne une réponse `403`.

```
{
    name           : gerants
    entry          : gerant
    ref            : comptes
    count          : N-N
    can_search     : "$context.compte"
    rev_can_search : "$context.compte"
}
```

## `PATCH /<entrée>/:<clef>` — Modification

Route générée dès qu'au moins un champ déclare `can_update`.

| Propriété | Où | Description |
|---|---|---|
| `can_update` | champ | Le champ peut être modifié. L'expression de chaque champ fourni doit être vraie |
| `prior_update` | champ | Hook appelé juste avant la mise à jour |
| `post_update` | champ | Hook appelé juste après la mise à jour |
| `restrict_update` | `@rules` | Condition que l'entrée doit respecter pour être modifiée |

Déroulement :

1. lecture des champs `can_update` présents dans le corps (sous leur nom `alt` s'il existe) ; s'il n'y en a aucun : `400` ;
2. vérification de l'expression `can_update` de chaque champ fourni (`403` sinon) ;
3. recherche de l'entrée par sa clef et `restrict_update` (`404` sinon) ;
4. hooks `prior_update`, mise à jour (avec vérification de l'énumération, de la taille et des règles : `422` sinon), hooks `post_update` ;
5. réponse `200 Modifié`.

Arguments des hooks : `$body`, `$request`, `$context`, `$values` (valeurs modifiées).

## `DELETE /<entrée>/:<clef>` — Suppression

Route générée si `@rules` déclare `can_delete`.

| Propriété (`@rules`) | Description |
|---|---|
| `can_delete` | Expression d'autorisation de la route |
| `restrict_delete` | Condition que l'entrée doit respecter pour être supprimée |
| `prior_delete`, `post_delete` | Hooks appelés avant et après la suppression |

Déroulement : vérification de `can_delete` (`403`), recherche de l'entrée par sa clef et `restrict_delete` (`404`), `prior_delete`, suppression (`409` si l'entrée est encore référencée), `post_delete`, réponse `200 Supprimé`.

Arguments des hooks : `$body`, `$request`, `$context`, `$values` (entrée supprimée, champs chiffrés déchiffrés).

---

## Règles du modèle — `@rules`

Récapitulatif des propriétés de `@rules` :

| Propriété | Route | Description |
|---|---|---|
| `can_search` | `GET` | Expression d'autorisation |
| `restrict_search` | `GET` | Condition sur les lignes renvoyées |
| `prior_search`, `post_search` | `GET` | Hooks |
| `restrict_update` | `PATCH` | Condition sur l'entrée modifiable |
| `can_delete` | `DELETE` | Expression d'autorisation (génère la route) |
| `restrict_delete` | `DELETE` | Condition sur l'entrée supprimable |
| `prior_delete`, `post_delete` | `DELETE` | Hooks |

```
@rules [
    can_search      : "$context.compte"
    restrict_search : "#gerants.id = $context.compte.id"
    can_delete      : "$context.compte"
    restrict_delete : "#gerants.id = $context.compte.id"
]
```

---

## Routes déclarées — `@routes`

Un modèle (y compris `index.sans`) peut déclarer des routes sur mesure, traitées par une fonction de son `@script` :

```
@routes [
    {
        path   : /connexion
        action : "$connecter_compte($body, $request)"
    }

    {
        path   : /moi
        method : get
        action : $obtenir_compte()
    }

    {
        path   : /test/recherche
        action : $tester_recherche($body)
        mode   : dev
    }
]
```

| Propriété | Défaut | Description |
|---|---|---|
| `path` | — | Chemin de la route. Un segment `:nom` est un paramètre, disponible dans `$request.params.nom` ; un chemin qui en contient doit être entre guillemets (`path : "/anicroche/:id"`), sinon le `:` est lu comme un séparateur |
| `method` | `post` | Méthode HTTP (`get`, `post`, `patch`, `delete`…) |
| `action` | — | Appel de la fonction : `$fonction($arg, …)`. Arguments reconnus : `$body`, `$request`, `$context` |
| `mode` | `all` | `dev`, `prod` ou `all` : la route n'existe que dans ce mode d'exécution |
| `limit` | — | Nombre maximal de requêtes par IP sur cette route, au format `10/1m` (voir [`@limits`](#limites-par-ip--limits)) |

La fonction doit répondre avec [`$indicate`](scripts.md#indicate). Si elle se termine sans l'avoir appelée, la route répond `500 Aucune réponse` et un message est affiché dans les journaux. Une erreur levée par la fonction donne une réponse `500`, ou `422` pour une erreur de validation du magasin.

Les routes déclarées sont prioritaires sur les routes automatiques de même méthode et de même chemin.

---

## Limites par IP — `@limits`

Le bloc `@limits` d'`index.sans` limite le nombre de requêtes qu'une même IP peut envoyer :

```
@limits [
    {
        limit : 300/1m
    }

    {
        path  : [ /connexion, /inscription, /authentification ]
        limit : 10/1m
    }

    {
        path   : /clef
        method : post
        limit  : 3/10m
    }
]
```

| Propriété | Description |
|---|---|
| `limit` | Quota au format `<nombre>/<durée>`, la durée en `s`, `m`, `h` ou `d` (`10/1m`, `3/10m`, `1000/1d`) |
| `path` | Une route ou une liste de routes. Absent : le bloc porte sur toute l'API |
| `method` | Une méthode ou une liste de méthodes (`post`, `[ get, patch ]`). Absent : toutes les méthodes |

- **Un bloc, un compteur** : toutes les routes d'un bloc partagent le même compteur. Dans l'exemple, une IP a droit à 10 requêtes par minute au total sur les trois routes ; pour des compteurs séparés, écrire des blocs séparés.
- Une requête doit respecter **tous** les blocs qui la concernent (le bloc sans `path` et ceux qui citent sa route).
- `path` désigne la route telle qu'elle est déclarée : `/profil/:id` couvre tous les identifiants. Un `*` final couvre toutes les routes sous un préfixe (`/profil/*`).
- Un élément de la liste peut être un bloc `{ path, method }`, dont `method` remplace celle du bloc :

  ```
  {
      path  : [ /connexion, { path : /clef, method : post } ]
      limit : 20/10m
  }
  ```

- La propriété [`limit`](#routes-déclarées--routes) d'une route déclarée est un raccourci : elle a son propre compteur, comme un bloc ne contenant que cette route.
- Le bloc sans `path` compte toutes les requêtes adressées aux routes de l'API et les routes inconnues ; les fichiers statiques et les requêtes `OPTIONS` ne sont pas comptés.

Au-delà du quota, la requête reçoit `429 Trop de requêtes` avec un en-tête `Retry-After` (en secondes), avant toute lecture du corps et tout traitement. Une requête refusée n'est pas comptée.

Fonctionnement :

- l'IP est celle de [`$request.ip`](scripts.md#request) ; les adresses IPv6 sont regroupées par préfixe `/64`, un accès IPv6 disposant en général de tout un `/64` ;
- le décompte se fait sur une fenêtre glissante approximée : la fenêtre précédente est pondérée par la part encore couverte, ce qui évite les rafales à la jonction de deux fenêtres ;
- les compteurs sont gardés en mémoire (100 000 au plus, les plus anciens étant supprimés au-delà) et repartent de zéro au redémarrage ;
- au démarrage, les limites sont affichées dans les journaux, ainsi qu'un avertissement pour chaque route de `@limits` qui n'existe pas.

Pour compter autre chose que des requêtes (des échecs de connexion par exemple), voir [`$limit`](scripts.md#limit).

