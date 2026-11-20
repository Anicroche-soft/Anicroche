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

`app.adn` contient la configuration de l'application au format ADN : paires `clef : valeur`, dictionnaires entre `{ }`, listes entre `[ ]`, nombres, et booléens `:)` (vrai) et `:(` (faux). Une valeur entre guillemets reste un texte (`":)"`).

```
port   : 4030
config : {
    name        : MonApplication
    lang        : fr
    description : "Application de démonstration"
    theme_color : {
        light : "#FFFFFF"
        dark  : "#000000"
    }
}
```

| Clef | Type | Défaut | Description |
|---|---|---|---|
| `port` | nombre | `PORT` ou `4030` | Port d'écoute du serveur. S'il est absent, la variable d'environnement `PORT` est utilisée, puis `4030` |
| `config` | dictionnaire | — | Éléments de l'en-tête de chaque page servie (voir ci-dessous) |

Clefs de `config`, toutes facultatives : une clef absente ne produit aucune balise.

| Clef | Type | Effet dans la page |
|---|---|---|
| `name` | texte | `<title>` et `<meta name="apple-mobile-web-app-title">` |
| `lang` | texte | Attribut `lang` de `<html>` |
| `description` | texte | `<meta name="description">` |
| `theme_color` | texte ou dictionnaire | `<meta name="theme-color">` : une couleur pour tous les thèmes, ou une par thème (`light`, `dark`), avec la requête média `prefers-color-scheme` correspondante |

L'adresse canonique (`<link rel="canonical">`) n'est pas configurée : elle est calculée pour chaque page, sur le domaine `app_url`. Le serveur lit `app.adn` au démarrage : une modification de `port` ou de `config` demande de le relancer.

Toutes les clefs de `app.adn` sont aussi envoyées au navigateur et deviennent des [variables de scope racine](expressions.md#variables-de-scope) :

- `$app` contient l'ensemble de la configuration ;
- chaque clef est aussi accessible directement : `config` donne `$config`.

```
<h1>
    "$config.name"
```

> **Note :** `app.adn` est public. Il ne doit contenir aucune donnée sensible.

## Variables d'environnement

Les variables sont fournies par l'environnement (typiquement un fichier `.env` transmis par Docker). Au démarrage, avec.js lit aussi le fichier `.env` du dossier courant ou, à défaut, du dossier parent, sans écraser les variables déjà définies (comme `PORT` fourni par l'hébergeur). Le format est `clef=valeur`, une variable par ligne ; les lignes commençant par `#` sont ignorées et les guillemets entourant une valeur sont retirés.

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `4030` | Port d'écoute HTTP (si `port` est absent de `app.adn`) |
| `api_url` | `http://localhost:5030` | Adresse de l'API utilisée par les [fonctions de requête](api.md). Elle est ajoutée à la configuration envoyée au navigateur (`$api_url`) |
| `app_url` | adresse de la requête | Adresse publique du site, utilisée pour l'adresse canonique des pages (`<link rel="canonical">`) |
| `internal_api_url` | — | Adresse à laquelle le serveur joint l'API pendant le [rendu côté serveur](#rendu-côté-serveur), si `api_url` n'est pas joignable depuis le serveur (par exemple `http://apicroche:5030` dans un réseau Docker) |
| `trusted_proxies` | `127.0.0.1,::1` | Adresses des mandataires inverses dont l'en-tête `X-Forwarded-For` est cru pour connaître l'adresse du visiteur pendant le [rendu côté serveur](#rendu-côté-serveur), séparées par des virgules (même règle que l'API sans.js) |
| `render_logs` | `false` | `true` affiche les journaux (`console.log`) des scripts pendant le rendu côté serveur ; les erreurs sont toujours affichées |

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
| toute autre adresse | la page de l'application, construite par le serveur ou vide (voir [Rendu côté serveur](#rendu-côté-serveur)) |

Les routes `/systeme/app.adn` et `/systeme/modeles/` ne répondent qu'aux requêtes du cadriciel (en-tête `X-AC-Composant: true`) ; une visite directe renvoie la page de l'application. Les chemins qui sortent de leur dossier (`..`) sont refusés.

## Rendu côté serveur

Les pages sont construites par le serveur : elles sont lisibles et leurs liens utilisables sans JavaScript, notamment par les robots d'indexation.

| Requête | Réponse |
|---|---|
| sans le cookie `avec-js` (première visite, robot, navigateur sans JavaScript) | page construite par le serveur |
| avec le cookie `avec-js=1` | page vide habituelle, construite par le navigateur |
| avec le paramètre `?sans-js` | page construite par le serveur, et cookie `avec-js` effacé |

Le cookie `avec-js` est posé par un script en ligne d'`avec.js/index.html`, exécuté avant l'affichage : quand JavaScript est actif, les pages suivantes ne sont donc plus construites par le serveur. Si JavaScript est désactivé ensuite, la page vide contient une balise `<noscript>` qui renvoie vers la même adresse avec `?sans-js`. Ce paramètre est retiré de l'adresse vue par les modèles (`$path`, `$query`).

Le cookie ne contient aucune donnée personnelle et sert uniquement au fonctionnement du site (il dure un an). L'adresse canonique de chaque page (`<link rel="canonical">`) est fixée par le serveur, sur le domaine `app_url` ; la réponse porte l'en-tête `Vary: Cookie`.

Le serveur exécute le moteur du cadriciel dans un environnement de navigateur simulé (`avec.js/rendu/`), propre à chaque rendu :

- les modèles et `app.adn` sont lus directement sur le disque ;
- les requêtes vers l'API sont réelles, faites sans session (visiteur non connecté) et abandonnées sans réponse au bout de 2,5 s. L'adresse IP du visiteur est transmise dans `X-Forwarded-For`, pour que l'API lui applique ses propres limites de requêtes ; elle n'en tient compte que si le serveur d'avec.js fait partie de ses mandataires de confiance (`trusted_proxies` de sans.js, qui accepte par défaut une connexion locale) ;
- `localStorage` est vide, `matchMedia` ne correspond jamais à rien, la fenêtre mesure 1280 × 800 et toutes les mesures des éléments (`clientWidth`, `getBoundingClientRect()`…) valent 0 ;
- les événements ne sont jamais émis : seuls comptent les scripts des modèles et les actions `@mount` ;
- `requestAnimationFrame` et les minuteries de 1 s au plus sont exécutées et attendues ; les plus longues (horloges, comptes à rebours) ne le sont pas.

La page est envoyée dès que plus aucune requête ni minuterie attendue n'est en cours, ou au bout de 3 s ; dans ce dernier cas, le journal du serveur indique les tâches encore en cours. Elle contient les styles des modèles affichés et les classes de `<html>`. En cas d'échec, la page vide habituelle est envoyée.

Au plus 4 pages sont construites en même temps ; les suivantes attendent leur tour, dans la limite de 32 et de 5 s d'attente. Au-delà, la page vide habituelle est envoyée et le journal du serveur l'indique. Chaque rendu a son propre worker, préparé à l'avance (moteur déjà chargé) et arrêté ensuite.

Si l'adresse change pendant la construction (`$navigate_to`, barre oblique finale retirée…), le serveur répond par une redirection (302) vers la nouvelle adresse (avec `?sans-js` si la requête le portait).

Dans le navigateur, si JavaScript est actif, le contenu construit par le serveur (marqué `data-pre-rendu`) est masqué avant tout affichage, puis retiré par le cadriciel, qui construit la page comme d'habitude.

> **Note :** dans un script de modèle, un objet du navigateur absent de cet environnement provoque une erreur pendant le rendu côté serveur. L'erreur est affichée dans le journal du serveur et le reste de la page est tout de même construit.

## Service worker

Un service worker est enregistré au chargement. Il permet l'installation de l'application et un fonctionnement partiel hors ligne :

- les scripts du moteur, les icônes, le manifeste et la page de l'application (`/`) sont mis en cache à l'installation ;
- les pages (navigations) sont toujours demandées au réseau et jamais mises en cache, puisque le serveur peut les [construire](#rendu-côté-serveur) ; hors ligne, la page `/` du cache est affichée et l'interface est construite d'après l'adresse demandée ;
- les autres requêtes `GET` vers le site (modèles, images, fontes…) sont servies depuis le cache s'il les contient, sinon depuis le réseau puis mises en cache ;
- les requêtes vers une autre origine, comme l'API, ne sont pas interceptées.

> **Note :** le cache est identifié par la constante `VERSION` de `avec.js/scripts/service-worker.js`. Après une mise à jour des modèles ou du moteur, il faut changer cette version pour que les navigateurs abandonnent l'ancien cache.
