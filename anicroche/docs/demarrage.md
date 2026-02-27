# Démarrage

## Structure du projet

Un projet avec.js suit la structure suivante :

```
adn/
├── app.adn            ← configuration de l'application
├── fontes/            ← polices de caractères
├── images/            ← images statiques
└── modeles/           ← fichiers .avec (organisables librement en sous-dossiers)
    └── index.avec     ← point d'entrée obligatoire
avec.js/               ← moteur du cadriciel (ne pas modifier)
```

Les modèles peuvent être rangés dans des sous-dossiers à la convenance de l'auteur. Le cadriciel les retrouve automatiquement par leur nom, sans qu'il soit nécessaire d'indiquer le chemin complet lors de leur appel.

> **Important :** deux modèles ne doivent pas porter le même nom, même s'ils se trouvent dans des dossiers différents.

## Le fichier `app.adn`

`app.adn` contient la configuration de l'application au format ADN (paires `clef : valeur`) :

```
port : 4030
```

| Clef | Type | Défaut | Description |
|---|---|---|---|
| `port` | nombre | `4030` | Port d'écoute du serveur (peut aussi être défini via la variable d'environnement `PORT`) |

## Le point d'entrée `index.avec`

`index.avec` est le seul modèle chargé automatiquement au démarrage. C'est à partir de lui que l'ensemble de l'interface est construite, directement ou via des appels à d'autres modèles.
