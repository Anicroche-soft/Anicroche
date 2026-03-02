# Modèles — fichiers `.sans`

Un fichier `.sans` décrit la structure d'une table : ses champs, leurs types, leurs contraintes et ses relations avec d'autres tables. Le cadriciel génère automatiquement la table correspondante en base de données.

Les **commentaires** commencent par `#` et s'étendent jusqu'à la fin de la ligne.

---

## Structure d'un modèle

Un modèle est composé d'**annotations** (commençant par `@`) et d'une liste de champs :

```
@primary [ id ]

@unique [
    [ email ]
]

@fields [
    {
        name : id
        type : char
        size : 12
    }

    {
        name  : email
        type  : char
        size  : 0-256
        count : 0-1
    }
]
```

---

## Annotations

### `@primary`

Déclare la clef primaire de la table. Prend une liste de noms de champs.

```
@primary [ id ]
```

### `@unique`

Déclare une ou plusieurs contraintes d'unicité. Chaque contrainte est une liste de champs (une contrainte composite peut porter sur plusieurs champs à la fois).

```
@unique [
    [ email ]
    [ nom prenom ]
]
```

> **Note :** lorsqu'un champ de type `hash` fait partie d'une contrainte `@unique`, un algorithme de hachage déterministe est utilisé afin qu'une même valeur produise toujours le même hash, permettant la comparaison.

### `@fields`

Déclare la liste des champs de la table. Chaque champ est un bloc `{ }` contenant ses propriétés.

---

## Propriétés d'un champ

| Propriété | Obligatoire | Description |
|---|---|---|
| `name` | oui | Nom du champ (et de la colonne en base) |
| `type` | oui (sauf relation) | Type du champ |
| `size` | non | Taille ou longueur maximale |
| `count` | non | Cardinalité — défaut : `1-1` |
| `ref` | non | Nom de la table liée (si différent de `name`) |

### `type`

Détermine le type de la colonne en base de données :

| Type | Description | Équivalent SQL |
|---|---|---|
| `char` | Texte à longueur fixe ou variable (selon `size`) | `CHAR` / `VARCHAR` |
| `text` | Texte long | `TEXT` |
| `int` | Nombre entier | `INTEGER` |
| `date` | Date seule | `DATE` |
| `datetime` | Date et heure | `DATETIME` |
| `boolean` | Valeur vraie ou fausse | `BOOLEAN` |
| `hash` | Valeur hachée (non réversible) | `CHAR` |
| `crypt` | Valeur chiffrée (réversible) | `VARCHAR` |
| `a/b/c` | Type énuméré — valeur stockée directement, validée par le cadriciel | `VARCHAR` |

### `size`

Indique la taille du champ.

- Une valeur fixe (`size : 12`) produit un type à longueur fixe (ex. `CHAR(12)`).
- Une valeur préfixée par `0-` (`size : 0-256`) produit un type à longueur variable (ex. `VARCHAR(256)`), signifiant que le contenu peut être vide.

### `count`

Indique la cardinalité du champ ou de la relation :

| `count` | Signification |
|---|---|
| `1-1` | Valeur obligatoire — une et une seule *(défaut)* |
| `0-1` | Valeur optionnelle — zéro ou une |
| `1-N` | Relation obligatoire — une au minimum |
| `0-N` | Relation optionnelle — zéro ou plusieurs |
| `N-N` | Relation many-to-many — table de jonction générée automatiquement |

### `ref`

Dans le cas d'une relation, permet de nommer le champ différemment de la table qu'il référence.

```
@fields [
    {
        name  : contacts
        ref   : coordonnees
        count : 0-N
    }
]
```

Ici, le champ s'appelle `contacts` mais pointe vers la table `coordonnees`. Sans `ref`, le `name` est utilisé directement pour résoudre la table liée.

---

## Exemple complet

```
@primary [ id ]

@unique [
    [ hachage_coordonnee ]
]

@fields [
    {
        name : id
        type : char
        size : 15
    }

    {
        name : type
        type : courriel/telephone
        size : 0-16
    }

    {
        name : coordonnee
        type : crypt
        size : 0-512
    }

    {
        name : hachage_coordonnee
        type : hash
    }

    {
        name : est_principale
        type : boolean
    }
]
```
