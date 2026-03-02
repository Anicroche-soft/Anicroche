# Démarrage

## Structure du projet

Un projet sans.js suit la structure suivante :

```
adn/
├── app.adn            ← configuration de l'application
└── modeles/           ← fichiers .sans (organisables librement en sous-dossiers)
sans.js/               ← moteur du cadriciel (ne pas modifier)
depot/                 ← fichiers statiques servis publiquement
```

Les modèles peuvent être rangés dans des sous-dossiers à la convenance de l'auteur. Le cadriciel les retrouve automatiquement par leur nom, sans qu'il soit nécessaire d'indiquer le chemin complet.

> **Important :** deux modèles ne doivent pas porter le même nom, même s'ils se trouvent dans des dossiers différents.

## Le fichier `app.adn`

`app.adn` contient la configuration de l'application au format ADN (paires `clef : valeur`) :

```
nom    : MonAPI
port   : 5030
```

| Clef | Type | Défaut | Description |
|---|---|---|---|
| `nom` | texte | `sans.js` | Nom de l'API |
| `port` | nombre | `5030` | Port d'écoute du serveur (peut aussi être défini via la variable d'environnement `PORT`) |
