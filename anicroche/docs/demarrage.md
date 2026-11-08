# Démarrage

## Structure du projet

Un projet avec.js suit la structure suivante :

```
adn/
├── app.adn            ← configuration de l'application
├── app.webmanifest    ← manifeste de l'application web (installation, icônes)
├── robots.txt         ← consignes pour les robots d'indexation
├── fontes/            ← polices de caractères
├── images/            ← images statiques
└── modeles/           ← fichiers .avec (organisables librement en sous-dossiers)
    └── index.avec     ← point d'entrée obligatoire
avec.js/               ← moteur du cadriciel
```

Les modèles peuvent être rangés dans des sous-dossiers à la convenance de l'auteur. Le cadriciel les retrouve automatiquement par leur nom, sans qu'il soit nécessaire d'indiquer le chemin complet lors de leur appel.

> **Important :** deux modèles ne doivent pas porter le même nom, même s'ils se trouvent dans des dossiers différents.

## Le fichier `app.adn`

`app.adn` contient la configuration de l'application au format ADN (paires `clef : valeur`) :

```
nom    : MonApplication
port   : 4030
```

| Clef | Type | Défaut | Description |
|---|---|---|---|
| `port` | nombre | `PORT` ou `4030` | Port d'écoute du serveur. S'il est absent, la variable d'environnement `PORT` est utilisée, puis `4030` |

Toutes les clefs de `app.adn` sont envoyées au navigateur et deviennent des [variables de scope racine](expressions.md#variables-de-scope) :

- `$app` contient l'ensemble de la configuration ;
- chaque clef est aussi accessible directement : `nom : Anicroche` donne `$nom`.

```
<h1>
    "$nom"
```

> **Note :** `app.adn` est public. Il ne doit contenir aucune donnée sensible.

## Variables d'environnement

Les variables sont fournies par l'environnement (typiquement un fichier `.env` transmis par Docker). Au démarrage, avec.js lit aussi le fichier `.env` du dossier courant ou, à défaut, du dossier parent, sans écraser les variables déjà définies (comme `PORT` fourni par l'hébergeur). Le format est `clef=valeur`, une variable par ligne ; les lignes commençant par `#` sont ignorées et les guillemets entourant une valeur sont retirés.

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `4030` | Port d'écoute HTTP (si `port` est absent de `app.adn`) |
| `api_url` | `http://localhost:5030` | Adresse de l'API utilisée par les [fonctions de requête](api.md). Elle est ajoutée à la configuration envoyée au navigateur (`$api_url`) |

## Le point d'entrée `index.avec`

`index.avec` est le seul modèle chargé automatiquement au démarrage. C'est à partir de lui que l'ensemble de l'interface est construite, directement ou via des appels à d'autres modèles.

## Fonctionnement du serveur

Le serveur sert une page unique : toute adresse qui ne correspond pas à un fichier système renvoie `avec.js/index.html`, puis l'interface est construite dans le navigateur selon `$path`.

| Route | Contenu |
|---|---|
| `/robots.txt` | `adn/robots.txt` |
| `/systeme/app.adn` | Configuration (`app.adn` converti en JSON, avec `api_url`) |
| `/systeme/app.webmanifest` | `adn/app.webmanifest` |
| `/systeme/modeles/<nom>.avec` | Modèle compilé en JSON (cherché par son nom dans tous les sous-dossiers) |
| `/systeme/images/<chemin>` | `adn/images/` (recherche récursive) |
| `/systeme/fontes/<chemin>` | `adn/fontes/` (recherche récursive) |
| `/systeme/scripts/<fichier>` | Moteur du cadriciel (`avec.js/scripts/`) |
| toute autre adresse | `avec.js/index.html` |

Les routes `/systeme/app.adn` et `/systeme/modeles/` ne répondent qu'aux requêtes du cadriciel (en-tête `X-AC-Composant: true`) ; une visite directe renvoie la page de l'application. Les chemins qui sortent de leur dossier (`..`) sont refusés.

## Service worker

Un service worker est enregistré au chargement. Il permet l'installation de l'application et un fonctionnement partiel hors ligne :

- les scripts du moteur, les icônes et le manifeste sont mis en cache à l'installation ;
- les autres requêtes `GET` vers le site (modèles, images, fontes…) sont servies depuis le cache s'il les contient, sinon depuis le réseau puis mises en cache ;
- les requêtes vers une autre origine, comme l'API, ne sont pas interceptées.

> **Note :** le cache est identifié par la constante `VERSION` de `avec.js/scripts/service-worker.js`. Après une mise à jour des modèles ou du moteur, il faut changer cette version pour que les navigateurs abandonnent l'ancien cache.
