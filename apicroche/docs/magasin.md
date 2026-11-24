# Magasin et conditions

Le magasin regroupe les fonctions d'accès aux données. Elles sont disponibles dans tous les [scripts](scripts.md).

## Fonctions

| Fonction | Renvoie |
|---|---|
| `$search_one(entrée, condition, contexte, options)` | La première entrée respectant la condition, ou `null` |
| `$search_all(table, condition, contexte, options)` | La liste des entrées respectant la condition |
| `$create_one(entrée, valeurs)` | L'entrée créée (avec les valeurs générées) |
| `$create_all(table, [valeurs, …])` | La liste des entrées créées |
| `$update_one(entrée, condition, valeurs, contexte)` | Le nombre d'entrées modifiées (`0` ou `1`) |
| `$update_all(table, condition, valeurs, contexte)` | Le nombre d'entrées modifiées |
| `$delete_one(entrée, condition, contexte)` | Le nombre d'entrées supprimées (`0` ou `1`) |
| `$delete_all(table, condition, contexte, options)` | Le nombre d'entrées supprimées |

```javascript
const session = await $search_one('session',
    `#id = $id_session & #date_validite > now & #date_revocation = null`,
    { $id_session: id_session }
)

const profils = await $search_all('profils',
    `#gerants.id = $id_compte`,
    { $id_compte: $context.compte.id },
    { select: 'id ; identifiant ; pseudonyme', order: [['date_creation', 'decreasing']] }
)
```

### Nom d'entrée et nom de table

Les fonctions `_one` attendent de préférence le **nom d'entrée** (`'profil'`), les fonctions `_all` le **nom de table** (`'profils'`). Le nom de table est aussi accepté par les fonctions `_one`. Les tables de jonction suivent la même règle : leur nom (`'gerants_profils'`) partout, leur entrée (`'gerant_profil'`) avec les fonctions `_one` seulement.

### Valeurs lues

Les entrées renvoyées contiennent les valeurs déchiffrées des champs `crypt`. Les champs `hash` contiennent la valeur hachée.

Les dates sont toutes en **UTC** : les champs `datetime` sont lus et écrits en UTC (objets `Date` de JavaScript), et `now` désigne l'heure UTC, dans les conditions, les mises à jour et les valeurs par défaut. Les fuseaux du serveur MySQL et de la machine n'ont donc aucun effet. Pour afficher une date en heure française, la formater avec `timeZone: 'Europe/Paris'`. MySQL ne garde pas les millisecondes : une date écrite puis relue est arrondie à la seconde.

Dans une route, le contexte de chaque condition contient automatiquement `$body` et `$params` en plus des variables passées en paramètre.

### Création

Les valeurs passées à `$create_one` sont vérifiées (énumération, [taille](modeles.md#size), [règles](modeles.md#rule)), puis hachées ou chiffrées selon le type du champ. Les valeurs `default : auto` et `default : $autre_champ` sont générées si elles sont absentes. Une valeur peut être fournie sous le nom [`alt`](modeles.md#alt) du champ.

### Mise à jour

Les valeurs passées à `$update_one` et `$update_all` sont vérifiées puis traitées de la même façon. Certaines valeurs textuelles sont calculées par la base :

| Valeur | Effet |
|---|---|
| `'now'`, `'now + 1d'`, `'now-30s'` | Date-heure courante, éventuellement décalée |
| `'champ + 1'`, `'champ - 1'` | Valeur d'un champ du modèle augmentée ou diminuée (champs non traités uniquement) |

```javascript
await $update_all('clefs', `#id -{ $ids`, { nombre_tentatives: 'nombre_tentatives - 1' }, { $ids: ids })
await $update_one('session', `#id = $id`, { date_revocation: 'now' }, { $id: session.id })
```

### Erreurs

Les fonctions lèvent une erreur avec un `code` :

| Code | Cause |
|---|---|
| `ENUM_VIOLATION` | Valeur hors énumération |
| `SIZE_VIOLATION` | Valeur trop courte ou trop longue |
| `RULE_VIOLATION` | Règle `rule` non respectée |
| `ER_NO_REFERENCED_ROW_2` | Clef étrangère vers une entrée inexistante (erreur MySQL) |
| `ER_ROW_IS_REFERENCED_2` | Suppression d'une entrée encore référencée (erreur MySQL) |
| `RELATION_FORBIDDEN` | Relation non autorisée avec `enforce_rules` |

Dans une route, une erreur non interceptée de validation donne une réponse `422`, une référence inexistante `422`, une entrée encore référencée `409`, et toute autre erreur `500`.

---

## Conditions

Une condition sélectionne des lignes. Elle est traduite en SQL ; les comparaisons impossibles à traduire (champs `crypt`, champs `hash` argon2, expressions rationnelles) sont vérifiées ligne par ligne après lecture.

### Termes

| Syntaxe | Signification |
|---|---|
| `#champ` | Champ du modèle |
| `#relation.champ`, `#relation.sous_relation.champ` | Champ d'un modèle lié (voir [nommage des relations](modeles.md#nommage-des-relations)) |
| `$variable`, `$variable.attribut`, `$variable['clef']` | Valeur du contexte |
| `"texte"`, `'texte'`, `` `texte` `` | Texte littéral |
| `texte` | Mot sans guillemets : texte littéral (ex. `#type = authentification`) |
| `42`, `-3.5` | Nombre |
| `true`, `false`, `null` | Booléens et valeur nulle (aussi `:)`, `:(`, `:o`) |
| `now`, `now+30d`, `now - 15m` | Date-heure courante, éventuellement décalée (unités `s`, `m`, `h`, `d`) |
| `/motif/drapeaux` | Expression rationnelle (après `~=` uniquement) |

### Opérateurs

| Opérateur | Signification |
|---|---|
| `=`, `!=` (ou `<>`) | Égalité, différence (`#champ = null` : valeur absente) |
| `<`, `>`, `<=`, `>=` | Comparaisons (nombres, textes, dates) |
| `-{` | Appartenance à une liste : `#id -{ $ids` |
| `!-{` | Non-appartenance à une liste |
| `~=` | Correspondance avec une expression rationnelle : `#identifiant ~= /^al/` |
| `&` | Et |
| `\|` | Ou |
| `!` | Non : `!(#type = autre)` |
| `( … )` | Regroupement |

Un champ seul vaut `#champ = true` (`#est_principale`). Une comparaison sans champ (`$a = $b`, `:)`) est évaluée immédiatement.

```javascript
await $delete_all('sessions', `#date_revocation != null | #date_validite < now`)

await $search_all('profils',
    `(#identifiant = $identifiant | #pseudonyme = $pseudonyme) & !(#gerants.id -{ $exclus)`,
    { $identifiant, $pseudonyme, $exclus }
)
```

### Règles particulières

- Une variable absente du contexte provoque une erreur (`Condition invalide : variable inconnue $nom`). Un attribut absent (`$objet.inexistant`) rend la comparaison fausse.
- Une comparaison avec `null` autre que `=` / `!=` est fausse.
- Un champ `hash` n'accepte que `=`, `!=`, `-{` et `!-{` ; la valeur comparée est la valeur en clair.
- Une condition sur une relation (`#relation.champ = …`) est vraie si **au moins une** entrée liée la respecte.
- Les champs `crypt` et `hash` argon2 ne peuvent pas être comparés à travers une relation.

---

## Options de recherche

`$search_one`, `$search_all` et `$delete_all` acceptent un objet `options` :

| Option | Défaut | Description |
|---|---|---|
| `select` | tous les champs | [Projection](#select--projection) des champs et relations |
| `order` | celui du modèle | [Ordre](#order--tri) des résultats |
| `limit` | — | Nombre maximum de résultats |
| `offset` | `0` | Nombre de résultats ignorés (pagination) |
| `enforce_rules` | `false` | Vérifier les règles d'accès des relations projetées |
| `fallback` | — | Valeurs demandées aux [replis](#fallback--replis) |

Pour `$search_one`, `order` choisit l'entrée renvoyée. Pour `$delete_all`, les options choisissent les entrées supprimées (ex. tout supprimer sauf la plus récente) :

```javascript
await $delete_all('clefs', `#hachage_coordonnee = $coordonnee`, { $coordonnee },
    { order: [['date_emission', 'decreasing']], offset: 1 }
)
```

### `order` — Tri

`order` est une liste de clefs de tri `[champ, sens]`, la première l'emportant ; le sens, `increasing` (croissant) ou `decreasing` (décroissant), est obligatoire :

```javascript
{ order: [['date_parution', 'decreasing'], ['numero', 'increasing']] }
```

Sans `order`, les résultats suivent l'[ordre du modèle](routes.md#règles-du-modèle--rules) (`order` de `@rules`), ou à défaut sa clef primaire, dans l'ordre croissant : l'ordre ne dépend jamais de la base. Les relations projetées dans `select` sont rangées selon l'ordre de leur propre modèle.

Le tri, `limit` et `offset` sont faits par la base (`ORDER BY`, `LIMIT`, `OFFSET`), sauf dans ces cas :

- un tri sur un champ `crypt` est fait après déchiffrement, en JS, comme `limit` et `offset` ;
- `limit` et `offset` sont appliqués en JS quand des lignes sont écartées après la lecture : condition vérifiée ligne par ligne (champs `crypt`, `hash` argon2, expressions rationnelles), conditions de champ (`restrict_search` d'un champ) ou [replis](#fallback--replis).

Un champ `hash` ne peut pas servir au tri (sa valeur ne dit rien de la valeur d'origine). Une valeur nulle vient en premier dans l'ordre croissant.


### `select` — Projection

`select` est une chaîne de termes séparés par `;` :

- un **champ** du modèle : `id`, `pseudonyme` ;
- une **relation** (toutes ses valeurs) : `coordonnees` ;
- une **relation avec ses champs** : `relation.champ`, avec `,` pour rester au même niveau et `.` pour descendre d'un niveau ;
- `*` : tous les champs du modèle.

```javascript
// Champs simples
{ select: 'id ; pseudonyme ; date_inscription' }

// Relation simple
{ select: 'id ; coordonnees' }

// Relation avec une partie de ses champs
{ select: 'id ; coordonnees.type,coordonnee ; is_gerant_of_profils.id,identifiant' }

// Plusieurs niveaux : le compte de la coordonnée, et les profils gérés par ce compte
{ select: 'type ; is_coordonnee_of_compte.id,is_gerant_of_profils.pseudonyme,identifiant' }
```

Dans le dernier exemple, `is_coordonnee_of_compte.id,is_gerant_of_profils.pseudonyme,identifiant` se lit : relation `is_coordonnee_of_compte`, dont on prend `id` et la relation `is_gerant_of_profils`, dont on prend `pseudonyme` et `identifiant`.

### `enforce_rules` — Règles d'accès des relations

Quand cette option est activée, chaque relation demandée dans `select` est vérifiée, à chaque niveau d'imbrication :

1. le `can_search` de la relation (ou `rev_can_search` dans le sens inverse) : erreur `RELATION_FORBIDDEN` s'il est absent ou faux ;
2. le `can_search` de `@rules` du modèle lié : erreur `RELATION_FORBIDDEN` s'il est faux ;
3. le `restrict_search` de la relation et celui de `@rules` du modèle lié filtrent les entrées liées.

Le contexte doit contenir `$context` et `$request`. L'option est activée automatiquement par les routes `GET` automatiques.

```javascript
const profils = await $search_all('profils', ':)', { $context, $request },
    { select: 'id ; pseudonyme ; gerants', enforce_rules: true }
)
```

### `fallback` — Replis

L'option `fallback` applique les [replis](modeles.md#fallback--replis) déclarés dans les modèles : un objet `{ champ: valeur }`, avec une liste (ou `'*'`) pour un champ `list`. Elle vaut aussi pour les relations projetées dans `select`. La résolution a lieu après la condition et avant `order`, `limit` et `offset`.

```javascript
// Sources de la version 4 (ou des précédentes), en anglais de préférence
await $search_all('sources', `#id_anicroche = $id`, { $id },
    { fallback: { version: 4, langue: ['en'] } })

// Dans chaque langue, la source la plus récente jusqu'à la version 4
await $search_all('sources', `#id_anicroche = $id`, { $id },
    { fallback: { version: 4, langue: '*', region: '*' } })
```

Sans l'option, aucun repli n'est appliqué (même pour un champ `list`). Les valeurs demandées sont disponibles dans la condition sous le nom `$fallback` (`{}` sans l'option).

### Journal SQL

En mode `dev` uniquement, les requêtes construites sont affichées dans les journaux avec leurs valeurs (en `prod`, elles ne le sont pas, car elles contiennent des données personnelles) :

```text
[search_all] SQL: SELECT DISTINCT `profils`.* FROM `profils` LEFT JOIN `gerants_profils` AS `gerants_profils_1` ON … WHERE `comptes_1`.`id` = 'K3Q…'
```

---

## Expressions augure

Les propriétés `rule`, `can_*` et `when` sont des expressions augure, évaluées en JavaScript (sans accès à la base). Elles n'utilisent que des variables `$` :

| Élément | Syntaxe |
|---|---|
| Variables | `$nom`, `$objet.attribut`, `$liste[0]` ; `$app` donne la configuration d'`app.adn` |
| Littéraux | `"texte"`, `'texte'`, mot sans guillemets, `42`, `:)` (vrai), `:(` (faux), `:o` (nul), `:x` (erreur, valeur des champs absents) |
| Comparaisons | `=`, `!=`, `<`, `>`, `<=`, `>=` (`now` et `now+30d` sont des dates) |
| Logique | `&`, `\|`, `!`, `( … )` |
| Listes | `a -{ liste` (appartenance), `liste }- a` (contient), `!-{`, `!}-` |
| Textes | `~= /motif/` (expression rationnelle), `_ $texte` (longueur), `:+ "abc"` / `:- "abc"` (garder / retirer des caractères) |
| Arithmétique | `+`, `-`, `*`, `/`, `%`, `^` |

**Valeur de vérité** (résultat de l'expression, et opérandes de `&`, `|` et `!`) : `:(`, `:o`, `:x` et le texte vide `''` sont faux ; toute autre valeur (nombre, `0` compris, texte non vide, liste, dictionnaire) est vraie. Les règles sont les mêmes que dans avec.js.

Pour tester qu'une variable est renseignée, utiliser la variable seule (`$context.compte`), éventuellement combinée (`$context.compte & $type = page`) : un attribut absent vaut `:x`, si bien que `$context.compte != :o` est vrai même sans compte.
