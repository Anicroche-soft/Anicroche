# sans.js — Documentation

**sans.js** est un cadriciel permettant de créer une API REST. Il génère automatiquement les routes et la base de données à partir de fichiers de modèles `.sans`.

## Concepts fondamentaux

| Concept | Description |
|---|---|
| **Modèle** | Un fichier `.sans` décrivant la structure d'une table et ses contraintes |
| **Champ** | Une colonne de la table, avec son type, sa taille et sa cardinalité |
| **Relation** | Un lien entre deux modèles, traduit en clef étrangère ou en table de jonction |
| **Contrainte** | Une règle d'intégrité déclarée via `@primary` ou `@unique` |

## Table des matières

- [Démarrage](demarrage.md) — structure du projet, configuration
- [Modèles](modeles.md) — écrire des fichiers `.sans`
