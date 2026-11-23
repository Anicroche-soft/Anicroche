# Démarrage

## Structure du projet

Un projet avec.js suit la structure suivante :

```
adn/
├── app.adn            ← configuration de l'application
├── app.webmanifest    ← manifeste de l'application web (installation, icônes)
├── robots.txt         ← consignes pour les robots d'indexation (facultatif, voir les pages spéciales)
├── fontes/            ← polices de caractères
├── images/            ← images statiques
└── modeles/           ← fichiers .avec (organisables librement en sous-dossiers)
    └── index.avec     ← point d'entrée obligatoire
avec.js/               ← moteur du cadriciel
```

Les modèles peuvent être rangés dans des sous-dossiers à la convenance de l'auteur. Le cadriciel les retrouve automatiquement par leur nom, sans qu'il soit nécessaire d'indiquer le chemin complet lors de leur appel.

> **Important :** deux modèles ne doivent pas porter le même nom, même s'ils se trouvent dans des dossiers différents.

## Le fichier `app.adn`

`app.adn` contient la configuration de l'application au format ADN : paires `clef : valeur` (une clef contient des lettres, des chiffres et `_ - . /`, ou tout caractère entre guillemets), dictionnaires entre `{ }` et listes entre `[ ]`, dont les éléments sont séparés par une virgule ou un retour à la ligne (`[ a, b ]`, `{ a : 1, b : 2 }`) ; une valeur qui contient une virgule s'écrit entre guillemets, nombres, et booléens `:)` (vrai) et `:(` (faux). Une valeur entre guillemets reste un texte (`":)"`).

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
| `pages` | dictionnaire | — | [Pages spéciales](#pages-spéciales) : fichiers XML ou texte construits par un modèle (`/sitemap.xml`, `/robots.txt`…) |

Clefs de `config`, toutes facultatives : une clef absente ne produit aucune balise.

| Clef | Type | Effet dans la page |
|---|---|---|
| `name` | texte | `<title>` et `<meta name="apple-mobile-web-app-title">` |
| `lang` | texte | Attribut `lang` de `<html>` |
| `description` | texte | `<meta name="description">` |
| `theme_color` | texte ou dictionnaire | `<meta name="theme-color">` : une couleur pour tous les thèmes, ou une par thème (`light`, `dark`), avec la requête média `prefers-color-scheme` correspondante |
| `version` | texte | Aucun : version du site, insérée dans le [service worker](#service-worker), dont elle renouvelle le cache quand elle change (format libre). La variable d'environnement `app_version` la remplace ; sans l'une ni l'autre, c'est l'heure de démarrage du serveur |

L'adresse canonique (`<link rel="canonical">`) n'est pas configurée : elle est calculée pour chaque page, sur le domaine `app_url`. Le serveur lit `app.adn` au démarrage : une modification de `port`, de `config` ou de `pages` demande de le relancer, sauf pour `config.version`, relue à chaque demande du service worker.

Toutes les clefs de `app.adn` sont aussi envoyées au navigateur et deviennent des [variables de scope racine](expressions.md#variables-de-scope) :

- `$app` contient l'ensemble de la configuration ;
- chaque clef est aussi accessible directement : `config` donne `$config`.

Le serveur y ajoute `api_url`, `app_url` et `app_version`, la version complète du site, celle du [service worker](#service-worker) (`$app_version`, par exemple `3.26.176`). La console du navigateur l'affiche au démarrage, avec `config.name`, à côté de la bannière d'avec.js.

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
| `app_url` | adresse de la requête | Adresse publique du site, utilisée pour l'adresse canonique des pages (`<link rel="canonical">`). Elle est ajoutée à la configuration envoyée au navigateur (`$app_url`), pour écrire des adresses absolues (sitemap…) |
| `internal_api_url` | — | Adresse à laquelle le serveur joint l'API pendant le [rendu côté serveur](#rendu-côté-serveur), si `api_url` n'est pas joignable depuis le serveur (par exemple `http://apicroche:5030` dans un réseau Docker) |
| `trusted_proxies` | `127.0.0.1,::1` | Adresses des mandataires inverses dont l'en-tête `X-Forwarded-For` est cru pour connaître l'adresse du visiteur pendant le [rendu côté serveur](#rendu-côté-serveur), séparées par des virgules (même règle que l'API sans.js) |
| `app_version` | `config.version` | Version du site insérée dans le [service worker](#service-worker), à la place de `version` de `config` dans `app.adn` (utile pour une version calculée au lancement, par exemple d'après git) |
| `mode` | `prod` | `dev` ajoute à la version du service worker un suffixe (`-dev.<empreinte>`) tiré des dates de modification de `adn/` et `avec.js/`, qui la change à chaque modification d'un fichier |
| `render_logs` | `false` | `true` affiche les journaux (`console.log`) des scripts pendant le rendu côté serveur ; les erreurs sont toujours affichées |

## Le point d'entrée `index.avec`

`index.avec` est le seul modèle chargé automatiquement au démarrage. C'est à partir de lui que l'ensemble de l'interface est construite, directement ou via des appels à d'autres modèles.

## Fonctionnement du serveur

Le serveur sert une page unique : toute adresse qui ne correspond pas à un fichier système renvoie `avec.js/index.html`, puis l'interface est construite dans le navigateur selon `$path`.

| Route | Contenu |
|---|---|
| adresse d'une [page spéciale](#pages-spéciales) | le modèle de la page, construit par le serveur |
| `/robots.txt` | `adn/robots.txt`, sauf si une page spéciale occupe cette adresse |
| `/sw.js`, `/service-worker.js` | Service worker de retrait (`avec.js/scripts/retrait-service-worker.js`, voir [Service worker](#service-worker)) |
| `/systeme/app.adn` | Configuration (`app.adn` converti en JSON, avec `api_url`, `app_url` et `app_version`) |
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

Le cookie ne contient aucune donnée personnelle et sert uniquement au fonctionnement du site (il dure un an). L'adresse canonique de chaque page (`<link rel="canonical">`) est fixée par le serveur, sur le domaine `app_url` ; la réponse porte les en-têtes `Vary: Cookie` et `Cache-Control: no-cache` (le navigateur redemande toujours la page).

Le serveur exécute le moteur du cadriciel dans un environnement de navigateur simulé (`avec.js/rendu/`), propre à chaque rendu :

- les modèles et `app.adn` sont lus directement sur le disque ;
- les requêtes vers l'API sont réelles, faites sans session (visiteur non connecté) et abandonnées sans réponse au bout de 2,5 s. L'adresse IP du visiteur est transmise dans `X-Forwarded-For`, pour que l'API lui applique ses propres limites de requêtes ; elle n'en tient compte que si le serveur d'avec.js fait partie de ses mandataires de confiance (`trusted_proxies` de sans.js, qui accepte par défaut une connexion locale) ;
- `localStorage` est vide, `matchMedia` ne correspond jamais à rien, la fenêtre mesure 390 × 844 (un téléphone tenu verticalement, comme pour l'indexation mobile des moteurs de recherche) et toutes les mesures des éléments (`clientWidth`, `getBoundingClientRect()`…) valent 0 ;
- les événements ne sont jamais émis : seuls comptent les scripts des modèles et les actions `@mount` ;
- `requestAnimationFrame` et les minuteries de 1 s au plus sont exécutées et attendues ; les plus longues (horloges, comptes à rebours) ne le sont pas.

La page est envoyée dès que plus aucune requête ni minuterie attendue n'est en cours, ou au bout de 3 s ; dans ce dernier cas, le journal du serveur indique les tâches encore en cours. Elle contient les styles des modèles affichés et les classes de `<html>`. Son `<title>` et sa `<meta name="description">` sont ceux de [`$title` et `$description`](expressions.md#variables-de-scope) quand ils ne sont pas nuls, et le code HTTP de la réponse celui de `$status` (200 par défaut) ; à partir de 400, la page porte aussi `<meta name="robots" content="noindex">`. En cas d'échec, la page vide habituelle est envoyée.

Au plus 4 pages sont construites en même temps ; les suivantes attendent leur tour, dans la limite de 32 et de 5 s d'attente. Au-delà, la page vide habituelle est envoyée et le journal du serveur l'indique. Chaque rendu a son propre worker, préparé à l'avance (moteur déjà chargé) et arrêté ensuite.

Si l'adresse change pendant la construction (`$navigate_to`, barre oblique finale retirée…), le serveur répond par une redirection (302) vers la nouvelle adresse (avec `?sans-js` si la requête le portait).

Dans le navigateur, si JavaScript est actif, le contenu construit par le serveur (marqué `data-pre-rendu`) est masqué avant tout affichage, puis retiré par le cadriciel, qui construit la page comme d'habitude.

Le même script pose la classe `avec-js` sur `<html>` : `html:not(.avec-js)` désigne donc, en CSS, une page affichée sans JavaScript (par exemple pour limiter sa largeur à celle d'un téléphone, la page ayant été construite pour une fenêtre de 390 pixels).

> **Note :** dans un script de modèle, un objet du navigateur absent de cet environnement provoque une erreur pendant le rendu côté serveur. L'erreur est affichée dans le journal du serveur et le reste de la page est tout de même construit.

## Pages spéciales

La clef `pages` d'`app.adn` associe une adresse à un modèle construit par le serveur, dans l'environnement du [rendu côté serveur](#rendu-côté-serveur), à la place d'`index.avec`. Le résultat est un fichier XML ou texte, pas une page de l'application.

```
pages : {
    /sitemap.xml : { model : sitemap, type : xml,  cache : 10m }
    /robots.txt  : { model : robots,  type : text, cache : 1h }
}
```

| Clef | Description |
|---|---|
| `model` | Nom du modèle construit (cherché comme tout modèle, par son nom) |
| `type` | `xml` : le contenu construit, précédé de `<?xml version="1.0" encoding="UTF-8"?>`, envoyé en `application/xml` ; `text` : chaque texte du modèle forme une ligne (`""` donne une ligne vide), envoyé en `text/plain` |
| `cache` | Facultatif : durée pendant laquelle le résultat est gardé (`30s`, `10m`, `1h`, `1d`) ; sans cette clef, le modèle est construit à chaque requête |

- Le modèle s'écrit comme les autres : son `@script` peut attendre des données (`await $search(…)`), et ses balises deviennent les éléments XML (`<urlset>`, `<url>`, `<loc>`…). Les balises interdites des modèles (`title`, `link`, `meta`…) le restent : un flux RSS ou Atom n'est pas encore possible.
- Le code HTTP est celui de `$status` (200 par défaut). Seule une réponse 200 complète est mise en cache ; le cache ne tient compte que du chemin, pas des paramètres de l'adresse. Si la construction échoue, la version en cache est servie, même périmée, sinon une erreur 503.
- Une page mal décrite (adresse sans `/` initiale, `model` manquant, `type` ou `cache` invalide) est ignorée et signalée au démarrage.

Exemple de sitemap :

```
@script [
    $entrees = []
    const reponse = await $search('articles')
    $entrees = (reponse.data ?? []).map(article => ({ loc: `${$app_url}/article/${article.id}` }))
]

<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    @for-each [$entree] of [$entrees]
        <url>
            <loc>
                "$entree.loc"
```

## Service worker

Un service worker est enregistré au chargement. Il permet l'installation de l'application et un fonctionnement partiel hors ligne :

- les scripts du moteur, les icônes, le manifeste et la page de l'application (`/`) sont mis en cache à l'installation ;
- les pages (navigations) sont toujours demandées au réseau et jamais mises en cache, puisque le serveur peut les [construire](#rendu-côté-serveur) ; hors ligne, la page `/` du cache est affichée et l'interface est construite d'après l'adresse demandée ;
- les autres requêtes `GET` vers le site (modèles, images, fontes…) sont servies depuis le cache s'il les contient, sinon depuis le réseau puis mises en cache ;
- les requêtes vers une autre origine, comme l'API, ne sont pas interceptées.

Avant l'enregistrement, tout autre service worker du domaine (resté d'un ancien contenu, avec un autre script ou une autre portée) est désinscrit, pour qu'il ne serve pas d'anciennes pages ; s'il contrôlait la page, celle-ci est rechargée une fois.

Un ancien service worker peut aussi empêcher la page de se charger, et donc ce nettoyage de s'exécuter. Le navigateur vérifie pourtant régulièrement le fichier d'un service worker installé (à chaque navigation dans sa portée) : aux adresses habituelles de ces fichiers, `/sw.js` (Workbox, Vite PWA…) et `/service-worker.js`, le serveur sert donc un service worker de retrait, qui le remplace, supprime ses caches (sauf ceux d'avec.js, nommés `<version>-assets`), se désinscrit et recharge les pages qu'il contrôlait. Un ancien service worker servi depuis une autre adresse demande d'ajouter celle-ci dans `avec.js/composants.js`.

> **Note :** le cache est identifié par la version du site, que le serveur insère dans `avec.js/scripts/service-worker.js` à la place de la marque `__VERSION__`, à chaque demande du fichier : la variable d'environnement `app_version`, sinon la clef `version` de `config` dans `app.adn` (relue sans redémarrage), sinon l'heure de démarrage du serveur (le cache est alors renouvelé à chaque démarrage). En mode `dev`, un suffixe tiré des dates de modification des fichiers s'y ajoute. Le navigateur installe un nouveau service worker dès que ce fichier change : après une mise à jour des modèles ou du moteur, la version doit donc changer pour que les navigateurs abandonnent l'ancien cache.
