# Modèles — fichiers `.sans`

Un fichier `.sans` décrit une table : ses champs, leurs types, leurs contraintes, ses relations avec d'autres tables, ses règles d'accès et ses scripts. Le cadriciel crée et met à jour la table correspondante en base de données.

---

## Syntaxe

Un modèle est une suite d'**annotations** commençant par `@`, suivies d'une valeur :

```
@name [ comptes, compte ]

@primary [ id ]

@fields [
    {
        name    : id
        type    : char
        size    : 12
        default : auto
    }
]
```

- Une **liste** s'écrit entre crochets `[ … ]`, un **dictionnaire** (paires `clef : valeur`) entre accolades `{ … }`. Un dictionnaire peut aussi s'écrire entre crochets : `@rules [ can_search : ':)' ]`.
- Les éléments sont séparés par des retours à la ligne, des espaces ou des virgules.
- Une valeur contenant des espaces ou des caractères spéciaux (`:`, `#`, `[`, `{`, `,`…) s'écrit entre guillemets `"…"`, `'…'` ou `` `…` ``.
- Les **commentaires** commencent par `#` et s'étendent jusqu'à la fin de la ligne.
- Le contenu de `@script [ … ]` est du JavaScript, recopié tel quel.

### Annotations

| Annotation | Description |
|---|---|
| [`@name`](#name) | Nom de la table et nom d'entrée |
| [`@primary`](#primary) | Clef primaire |
| [`@unique`](#unique) | Contraintes d'unicité |
| [`@fields`](#fields) | Champs et relations |
| [`@rules`](routes.md#règles-du-modèle--rules) | Règles d'accès et hooks des routes automatiques |
| [`@routes`](routes.md#routes-déclarées--routes) | Routes sur mesure |
| [`@script`](scripts.md) | Fonctions JavaScript du modèle |
| [`@actions`](scripts.md#indexsans-et-actions) | Actions globales (uniquement dans `index.sans`) |

---

## `@name`

Définit le nom de la table et, optionnellement, son **nom d'entrée** (le nom au singulier d'une ligne de la table).

```
@name [ comptes, compte ]
```

- Le premier élément est le nom de la table. Si `@name` est absent, le nom du fichier `.sans` (sans extension) est utilisé.
- Le second élément est le nom d'entrée. S'il est absent, le nom de la table est utilisé.

Le nom d'entrée sert à nommer :

- les clefs étrangères qui pointent vers cette table : `id_<entrée>` (ex. `id_compte`) ;
- les routes portant sur une seule entrée : `POST /compte`, `GET /compte/:id` ;
- le premier paramètre des fonctions `$search_one`, `$create_one`, `$update_one` et `$delete_one` (voir [Magasin](magasin.md#nom-dentrée-et-nom-de-table)).

## `@primary`

Déclare la clef primaire de la table. Prend une liste de noms de champs.

```
@primary [ id ]
```

> **Note :** les relations, les routes `/<entrée>/:clef` et les clefs étrangères utilisent le premier champ de la clef primaire. Un modèle référencé par une relation doit avoir une clef primaire simple.

## `@unique`

Déclare une ou plusieurs contraintes d'unicité. Chaque contrainte est une liste de champs (une contrainte composite porte sur plusieurs champs à la fois).

```
@unique [
    [ email ]
    [ nom prenom ]
]
```

## `@fields`

Déclare la liste des champs de la table. Chaque champ est un dictionnaire `{ }` contenant ses propriétés. Un champ sans `type` mais avec un `count` est une [relation](#relations).

---

## Propriétés d'un champ

| Propriété | Description |
|---|---|
| `name` | Nom du champ (et de la colonne). **Obligatoire** |
| `type` | [Type](#type) du champ. **Obligatoire**, sauf pour une relation |
| `size` | [Taille](#size) ou longueur autorisée |
| `count` | [Cardinalité](#count) : `1-1` par défaut |
| `default` | [Valeur par défaut](#default) |
| `chars` | Caractères utilisés par `default : auto` |
| `length` | Longueur générée par `default : auto` |
| `rule` | [Règle de validation](#rule) de la valeur |
| `alt` | [Nom alternatif](#alt) du champ dans les corps de requête et les résultats de création |
| `ref`, `entry` | Table cible et nom d'entrée d'une [relation](#relations) |
| `key`, `fields` | Colonne visée et colonnes supplémentaires de la table de jonction d'une relation `N-N` (voir [Tables de jonction](#tables-de-jonction-relation-n-n)) |
| `can_create`, `prior_create`, `post_create` | Route automatique `POST` (voir [Routes](routes.md#post-entrée--création)) |
| `can_update`, `prior_update`, `post_update` | Route automatique `PATCH` (voir [Routes](routes.md#patch-entréeclef--modification)) |
| `can_search`, `restrict_search`, `prior_search`, `post_search` | Routes automatiques `GET` (voir [Routes](routes.md#get-table-et-get-entréeclef--recherche)) |
| `rev_can_search`, `rev_restrict_search` | Accès à une relation dans le sens inverse (voir [Routes](routes.md#accès-aux-relations)) |

### `type`

| Type | Description | Type SQL |
|---|---|---|
| `char` | Texte, de longueur fixe ou variable selon `size` | `CHAR(n)` si la taille est fixe, sinon `VARCHAR(max)` (`VARCHAR(255)` sans `size`) |
| `text` | Texte long | `TEXT` |
| `int` | Nombre entier | `INT` |
| `tinyint` | Petit nombre entier (-128 à 127) | `TINYINT` |
| `date` | Date seule | `DATE` |
| `datetime` | Date et heure | `DATETIME` |
| `boolean` | Valeur vraie ou fausse | `TINYINT(1)` |
| `hash` | Valeur hachée (non réversible) | voir ci-dessous |
| `crypt` | Valeur chiffrée en AES-256-GCM (réversible) | `BINARY(n)` si la taille est fixe, sinon `VARBINARY(max)` (`VARBINARY(255)` sans `size`) |
| `a/b/c` | Type énuméré : la valeur doit être l'une des valeurs listées | `VARCHAR` (longueur de la plus longue valeur par défaut) |

Une valeur hors énumération est refusée (code `ENUM_VIOLATION`, réponse `422`).

Toutes les tables sont créées en `utf8mb4` avec l'interclassement binaire `utf8mb4_bin` : les comparaisons de texte (conditions, unicité, jointures) **respectent la casse et les accents** (`Conditions` ≠ `conditions`), et un tri sur du texte suit l'ordre des codes de caractères (`É` après `z`). Une table existante créée avec un autre interclassement est signalée au démarrage ; la réinitialiser la recrée correctement.

#### Champs `hash`

Le hachage dépend de la présence du champ dans `@primary` ou `@unique` :

| Champ | Algorithme | Type SQL sans `size` | Comparaison |
|---|---|---|---|
| Dans `@primary` ou `@unique` | HMAC-SHA256 (déterministe : une même valeur donne toujours le même hash, ce qui permet l'unicité) | `CHAR(64)` | `=`, `!=`, `-{`, `!-{` traduits en SQL |
| Ailleurs | argon2 (non déterministe, adapté aux mots de passe) | `VARCHAR(255)` | `=`, `!=`, `-{`, `!-{` vérifiés ligne par ligne (un argon2 est calculé même quand la valeur stockée est nulle, pour ne pas révéler son absence par la durée de réponse) |

Avec `size`, le type SQL suit la même règle que `char` (la taille porte alors sur la valeur hachée stockée). Une valeur hachée n'est jamais renvoyée en clair.

Chaque calcul argon2 occupe 64 Mio de mémoire : sans.js n'en effectue que 4 à la fois et en met 64 au plus en attente. Au-delà, la requête reçoit `503 Serveur surchargé`, ce qui protège la mémoire du serveur lors d'une rafale de connexions.

#### Champs `crypt`

La valeur est chiffrée avant l'écriture et déchiffrée automatiquement à la lecture. Toutes les comparaisons sont possibles dans une condition, mais elles sont vérifiées ligne par ligne après lecture (elles ne peuvent pas être traduites en SQL).

### `size`

Indique la taille du champ :

| Valeur | Type SQL | Valeur acceptée |
|---|---|---|
| `size : 12` | longueur fixe (`CHAR(12)`) | exactement 12 caractères au minimum et au maximum |
| `size : 1-64` | longueur variable (`VARCHAR(64)`) | de 1 à 64 caractères |
| `size : 0-256` | longueur variable (`VARCHAR(256)`) | de 0 à 256 caractères (texte vide autorisé) |

La longueur des valeurs est vérifiée à chaque écriture (création et mise à jour) ; une valeur hors limites est refusée (code `SIZE_VIOLATION`, réponse `422`) :

- la **longueur minimale** est vérifiée sur la valeur brute, pour tous les champs (y compris `hash` et `crypt`) ;
- la **longueur maximale** n'est vérifiée que pour les champs non traités, car pour `hash` et `crypt` elle porte sur la valeur stockée.

La longueur est comptée en caractères (points de code Unicode).

### `count`

Indique la cardinalité du champ ou de la relation :

| `count` | Champ | Relation |
|---|---|---|
| `1-1` *(défaut)* | Valeur obligatoire (`NOT NULL`) | Une entrée liée obligatoire |
| `0-1` | Valeur optionnelle (`NULL` autorisé) | Zéro ou une entrée liée |
| `0-N` | — | Zéro ou plusieurs entrées liées |
| `1-N` | — | Une ou plusieurs entrées liées (le minimum n'est pas vérifié) |
| `N-N` | — | Relation plusieurs-à-plusieurs, avec table de jonction |

### `default`

| Valeur | Effet |
|---|---|
| `auto` | Identifiant aléatoire généré par le cadriciel (voir `chars` et `length`). Si le champ est dans `@primary` ou `@unique`, l'unicité est vérifiée en base |
| `now` | Date ou date-heure courante (valeur par défaut SQL) |
| `now+30d`, `now + 15m` | Date-heure courante décalée (unités `s`, `m`, `h`, `d`) |
| `$autre_champ` | Copie de la valeur brute d'un autre champ, avant hachage ou chiffrement |
| autre valeur | Valeur par défaut SQL littérale (ex. `default : 6`) |

`auto` et `$autre_champ` sont calculés par le cadriciel lors de l'insertion : ils ne sont pas inscrits dans la base.

### `chars` et `length`

Pour `default : auto`, `chars` liste les caractères utilisés (avec des plages `A-Z`) et `length` la longueur générée :

```
{
    name    : clef
    type    : hash
    size    : 1-256
    chars   : [0-9]
    length  : 9
    default : auto
}
```

Par défaut, les caractères sont `A-Z0-9` et la longueur est la taille maximale du champ (`size`), ou 12.

### `rule`

Une expression [augure](magasin.md#expressions-augure) que la valeur doit vérifier à chaque écriture. Les valeurs des champs sont accessibles par `$<nom_du_champ>` (valeurs brutes, avant hachage ou chiffrement ; un champ absent vaut `:x`).

```
{
    name : identifiant
    type : char
    size : 1-65
    rule : "$identifiant ~= /^[a-z0-9-]+$/"
}
```

- En création, toutes les règles du modèle sont vérifiées.
- En mise à jour, seules les règles des champs modifiés sont vérifiées ; les autres champs ont leur valeur actuelle (les champs hachés non modifiés valent `:x`).
- La règle d'un champ facultatif (`count : 0-1`) sans valeur n'est pas vérifiée.

Une valeur qui ne respecte pas sa règle est refusée (code `RULE_VIOLATION`, réponse `422`).

### `alt`

Nom sous lequel le champ est lu dans le corps des requêtes `POST` et `PATCH` automatiques et dans les données passées à `$create_one`. Il est aussi utilisé pour renvoyer, dans le résultat de la création, la valeur brute d'un champ haché :

```
{
    alt     : jeton
    name    : hachage_jeton
    type    : hash
    size    : 1-256
    default : auto
}
```

`$create_one('session', { … })` renvoie alors `jeton` (la valeur générée, en clair) en plus de `hachage_jeton` (la valeur stockée).

---

## Relations

Un champ sans `type` et avec un `count` déclare une relation vers un autre modèle :

```
@fields [
    {
        name  : contacts      # nom de la relation
        ref   : coordonnees   # table cible (par défaut : le name)
        entry : contact       # nom de l'entrée liée (optionnel)
        count : 0-N
    }
]
```

| Propriété | Description |
|---|---|
| `name` | Nom de la relation, utilisé dans les projections (`select`) et les conditions (`#contacts.type`) |
| `ref` | Nom de la table cible. Sans `ref`, le `name` est utilisé |
| `entry` | Nom de l'entrée liée : nomme la clef étrangère d'une relation `0-1`/`1-1`, l'entrée de la table de jonction d'une relation `N-N`, et la relation inverse |
| `count` | Cardinalité, qui détermine la structure générée (voir ci-dessous) |

### Structure générée

| `count` | Structure | Clef étrangère |
|---|---|---|
| `0-N`, `1-N` | Colonne `id_<entrée source>` ajoutée dans la **table cible** | `ON DELETE RESTRICT` |
| `0-1`, `1-1` | Colonne `id_<entry ou entrée cible>` ajoutée dans la **table source** (`NULL` autorisé si `0-1`) | `ON DELETE RESTRICT` |
| `N-N` | Table de jonction | `ON DELETE CASCADE` |

Les clefs étrangères sont de vraies contraintes en base (`ON UPDATE CASCADE`) :

- `RESTRICT` : une entrée encore référencée ne peut pas être supprimée (réponse `409` sur les routes automatiques) ;
- `CASCADE` : la suppression d'une entrée supprime ses lignes dans les tables de jonction ;
- une référence vers une entrée inexistante est refusée (réponse `422` sur les routes automatiques).

La colonne d'une relation peut être déclarée explicitement dans `@fields` sous le même nom (par exemple pour lui donner `can_create`) : elle est alors réutilisée comme clef étrangère.

### Tables de jonction (relation `N-N`)

Une relation `N-N` génère une table de jonction :

| Élément | Nom |
|---|---|
| Table | `<name de la relation>_<table source>` |
| Entrée | `<entry ou entrée cible>_<entrée source>` |
| Colonnes | `id_<entrée source>` et `id_<entrée cible>`, de même type que les clefs primaires correspondantes |
| Clef primaire | composite, sur les deux colonnes |

```
# modèle profils (entrée : profil)
{
    name  : gerants
    entry : gerant
    ref   : comptes      # entrée : compte
    count : N-N
}
```

génère la table `gerants_profils` (entrée `gerant_profil`) avec les colonnes `id_profil` et `id_compte`. Elle s'utilise avec les fonctions du magasin comme n'importe quel modèle :

```javascript
await $create_one('gerant_profil', { id_profil: profil.id, id_compte: compte.id })
```

> **Note :** une relation `N-N` d'une table vers elle-même n'est pas prise en charge (les deux colonnes auraient le même nom).

#### `key` — Relation vers un groupe de lignes

Par défaut, la jonction vise la clef primaire de la table cible. Quand celle-ci est composée, `key` désigne sa **première colonne** : la relation vise alors toutes les lignes partageant cette valeur (un *groupe*), par exemple toutes les langues et versions d'un même texte.

```
# modèle textes
@primary [ id, langue, region, version ]
```

```
# modèle anicroches
{
    name  : textes
    key   : id
    count : N-N
}
```

La colonne `id_texte` de la jonction prend le type de `textes.id`. Une telle relation n'a pas de clef étrangère en base (une clef étrangère vers une colonne non unique n'est pas standard) : le magasin vérifie lui-même les références, avec les mêmes réponses que pour une clef étrangère :

- une ligne de jonction doit viser un groupe existant (`422`) ;
- la dernière ligne d'un groupe encore visé par une jonction ne peut ni être supprimée, ni changer de valeur de `key` (`409`).

Une projection de la relation renvoie toutes les lignes de chaque groupe lié. `key` n'est accepté que sur une relation `N-N`.

#### `fields` — Colonnes supplémentaires

`fields` ajoute des colonnes à la table de jonction, déclarées comme des [champs](#propriétés-dun-champ) ordinaires :

```
{
    name   : textes
    key    : id
    count  : N-N
    fields : [
        { name : role , type : char , size : 1-32 }
    ]
}
```

La clef primaire de la jonction reste composée des deux identifiants. Les colonnes supplémentaires :

- se renseignent à la création de la ligne de jonction : `$create_one('texte_anicroche', { id_anicroche, id_texte, role : 'contenu' })` ;
- s'utilisent dans les conditions à travers la relation, comme un champ de la cible : `#textes.role = contenu` ;
- sont ajoutées à chaque entrée liée dans les projections (`select: 'textes'` donne des textes portant aussi `role`). Les citer dans `select` (`'textes.role,contenu'`) est permis.

`fields` n'est accepté que sur une relation `N-N`.

### Nommage des relations

Une relation est accessible des deux côtés, dans les projections (`select`) et les conditions :

| Sens | Nom | Exemple (depuis `profils.gerants` vers `comptes`) |
|---|---|---|
| Direct (depuis la table source) | `name` de la relation | `gerants` depuis `profils` |
| Inverse (depuis la table cible) | `is_<entry ou entrée cible>_of_<table source ou entrée source>` | `is_gerant_of_profils` ou `is_gerant_of_profil` depuis `comptes` |

Le résultat d'une projection est une liste, sauf pour le sens direct d'une relation `0-1`/`1-1` et le sens inverse d'une relation `0-N`/`1-N`, qui donnent une entrée unique (ou `null`).

---

## Exemple complet

```
@name [ profils, profil ]

@primary [ id ]

@unique [
    [ identifiant ]
]

@fields [
    {
        name       : id
        type       : char
        size       : 15
        chars      : [A-Z0-9]
        default    : auto
        can_search : ':)'
    }

    {
        name         : identifiant
        type         : char
        size         : 1-32
        rule         : "$identifiant ~= /^[a-z0-9-]+$/"
        can_create   : ':)'
        can_search   : ':)'
        prior_create : $verifier_identifiant($values)
    }

    {
        name       : pseudonyme
        type       : char
        size       : 1-64
        can_create : ':)'
        can_update : ':)'
        can_search : ':)'
    }

    {
        name       : date_creation
        type       : date
        default    : now
        can_search : ':)'
    }

    {
        name           : gerants
        entry          : gerant
        ref            : comptes
        count          : N-N
        rev_can_search : "$context.compte"
    }
]

@rules [
    can_search      : "$context.compte"
    restrict_search : "#gerants.id = $context.compte.id"
    restrict_update : "#gerants.id = $context.compte.id"
    can_delete      : "$context.compte"
    restrict_delete : "#gerants.id = $context.compte.id"
    post_search     : $journaliser_recherche($results)
]

@script [
    $verifier_identifiant = async ($values) =>
    {
        const existant = await $search_one('profil', `#identifiant = $values.identifiant`, { $values })
        if (existant)
            return $indicate(409, 'Identifiant déjà utilisé')
    }

    $journaliser_recherche = ($results) =>
    {
        console.log(`${$results.length} profil(s) renvoyé(s)`)
    }
]
```

Avec ce modèle :

- `GET /profils` et `GET /profil/:id` ne répondent qu'à un utilisateur connecté (`$context.compte` est rempli par une action `prior_respond`, voir [Scripts](scripts.md#indexsans-et-actions)) et ne renvoient que les profils qu'il gère ;
- `POST /profil` crée un profil à partir de `identifiant` et `pseudonyme` ;
- `PATCH /profil/:id` modifie le `pseudonyme` d'un profil géré par l'utilisateur ;
- `DELETE /profil/:id` supprime un profil géré par l'utilisateur (ses lignes de `gerants_profils` sont supprimées en cascade) ;
- depuis `comptes`, la relation inverse `is_gerant_of_profils` est accessible à un utilisateur connecté.
