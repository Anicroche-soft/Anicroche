# sans.js — Documentation

**sans.js** est un cadriciel permettant de créer une API REST. Il génère automatiquement la base de données et des routes à partir de fichiers de modèles `.sans`, et permet d'écrire des routes et des traitements sur mesure en JavaScript.

## Concepts fondamentaux

| Concept | Description |
|---|---|
| **Modèle** | Un fichier `.sans` décrivant une table : ses champs, ses relations, ses règles d'accès et ses scripts |
| **Champ** | Une colonne de la table, avec son type, sa taille et sa cardinalité |
| **Relation** | Un lien entre deux modèles, traduit en clef étrangère ou en table de jonction |
| **Entrée** | Le nom au singulier d'un modèle (`compte` pour la table `comptes`), utilisé pour les routes et les clefs étrangères |
| **Condition** | Une expression (`#champ = $variable & …`) qui sélectionne des lignes, traduite en SQL |
| **Magasin** | Les fonctions d'accès aux données (`$search_one`, `$create_one`, `$update_all`…) |
| **Script** | Le code JavaScript d'un modèle (`@script`), appelé par les routes et les hooks |

## Table des matières

- [Démarrage](demarrage.md) : structure du projet, configuration, variables d'environnement, fichiers statiques
- [Modèles](modeles.md) : écrire des fichiers `.sans` (champs, types, relations)
- [Routes](routes.md) : routes automatiques, règles d'accès, hooks, routes déclarées
- [Scripts](scripts.md) : `@script`, fonctions et variables disponibles, `index.sans` et `@actions`
- [Magasin et conditions](magasin.md) : fonctions d'accès aux données, syntaxe des conditions, options
