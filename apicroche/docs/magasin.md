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
    { select: 'id ; identifiant ; pseudonyme', order: 'date_creation', dir: 'desc' }
)
```

### Nom d'entrée et nom de table

Les fonctions `_one` attendent de préférence le **nom d'entrée** (`'profil'`), les fonctions `_all` le **nom de table** (`'profils'`). Le nom de table est aussi accepté par les fonctions `_one`. Les tables de jonction s'utilisent par leur nom (`'gerants_profils'`) ou leur entrée (`'gerant_profil'`).

### Valeurs lues

Les entrées renvoyées contiennent les valeurs déchiffrées des champs `crypt`. Les champs `hash` contiennent la valeur hachée.

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
| `order` | — | Champ de tri |
| `dir` | `asc` | Sens du tri : `asc` ou `desc` |
| `limit` | — | Nombre maximum de résultats |
| `offset` | `0` | Nombre de résultats ignorés (pagination) |
| `enforce_rules` | `false` | Vérifier les règles d'accès des relations projetées |

Pour `$search_one`, `order` choisit l'entrée renvoyée. Pour `$delete_all`, les options choisissent les entrées supprimées (ex. tout supprimer sauf la plus récente) :

```javascript
await $delete_all('clefs', `#hachage_coordonnee = $coordonnee`, { $coordonnee },
    { order: 'date_emission', dir: 'desc', offset: 1 }
)
```

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
| Variables | `$nom`, `$objet.attribut`, `$liste[0]` |
| Littéraux | `"texte"`, `'texte'`, mot sans guillemets, `42`, `:)` (vrai), `:(` (faux), `:o` (nul), `:x` (erreur, valeur des champs absents) |
| Comparaisons | `=`, `!=`, `<`, `>`, `<=`, `>=` (`now` et `now+30d` sont des dates) |
| Logique | `&`, `\|`, `!`, `( … )` |
| Listes | `a -{ liste` (appartenance), `liste }- a` (contient), `!-{`, `!}-` |
| Textes | `~= /motif/` (expression rationnelle), `_ $texte` (longueur), `:+ "abc"` / `:- "abc"` (garder / retirer des caractères) |
| Arithmétique | `+`, `-`, `*`, `/`, `%`, `^` |

Un résultat nul ou en erreur compte comme faux. Pour tester qu'une variable est renseignée, utiliser la variable seule (`$context.compte`) : un attribut absent vaut `:x`, si bien que `$context.compte != :o` est vrai même sans compte.
