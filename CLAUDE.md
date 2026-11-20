# Anicroche

Application web composée de deux parties, chacune reposant sur un cadriciel maison écrit par l'auteur du projet :

| Dossier | Rôle | Cadriciel | Port |
|---|---|---|---|
| `apicroche/` | API REST + base MySQL | **sans.js** (`apicroche/sans.js/`) | 5030 |
| `anicroche/` | Site Internet (client) | **avec.js** (`anicroche/avec.js/`) | 4030 |

Le code applicatif se trouve dans les dossiers `adn/` de chaque partie ; le moteur des cadriciels dans `sans.js/` et `avec.js/`. Les deux cadriciels peuvent être modifiés lorsque c'est nécessaire.

## Documentation des cadriciels

Il n'existe pas de documentation externe : se référer à la documentation locale et au code source.

- sans.js : `apicroche/docs/` (`demarrage.md`, `modeles.md`, `routes.md`, `scripts.md`, `magasin.md`)
- avec.js : `anicroche/docs/` (`demarrage.md`, `modeles.md`, `expressions.md`, `api.md`)

Toute évolution d'un cadriciel visible par son utilisateur (nouvelle instruction, option, variable…) doit être reportée dans sa documentation.

## Structure

### apicroche (sans.js)

- `adn/app.adn` : configuration (format `clef : valeur`), disponible dans les scripts sous le nom `$app` ; `types_anicroches` y décrit chaque type d'anicroche, dont les propriétés sont mises en œuvre par `adn/modeles/types.sans`
- `adn/modeles/**/*.sans` : un fichier avec `@name` décrit une table (`@primary`, `@unique`, `@fields`, `@rules`, hooks…) ; un fichier sans `@name` est générique (comme `index.sans`) : `@actions` globales (tâches périodiques, hooks `prior_respond` / `post_respond`), `@limits`, `@routes` et `@script` partagés
- `sans.js/scripts/` : `routeur` (routes automatiques et déclarées), `magasin` (fonctions d'accès aux données), `traducteur` (conditions → SQL), `batisseur` (tables, colonnes, clefs étrangères), `augure` (expressions), `limiteur` (limites de requêtes par IP), `planificateur`, `mailer`, `crypto`
- `depot/` : fichiers déposés (ignoré par git)

### anicroche (avec.js)

- `adn/app.adn`, `adn/app.webmanifest`, `adn/robots.txt`
- `adn/modeles/**/*.avec` : modèles rangés par rôle (`pages`, `sections`, `structures`, `organiseurs`, `interactions`, `contenus`, `identites`, `icones`, `logos`, `animations`). Le point d'entrée est `index.avec`.
- Les modèles sont appelés par leur seul nom, quel que soit leur dossier : **deux modèles ne doivent jamais porter le même nom**.
- `avec.js/scripts/` : moteur client (`batisseur`, `augure`, `sculpteur`, `navigateur`, `heraut`, `scribe`, `architecte`, `decorateur`, `service-worker`)
- `avec.js/avec.js` : serveur HTTP ; `avec.js/composants.js` : résolution des fichiers servis (`/systeme/…`) ; `avec.js/rendu/` : rendu côté serveur (sans le cookie `avec-js` posé par le JavaScript, ou avec `?sans-js`) — mini-DOM maison (`dom.js`), environnement de navigateur simulé (`environnement.js`), un worker par rendu (`ouvrier.js`, `rendu.js`)

## Commandes

Depuis la racine (variables lues dans `.env`, voir `.env.example`) :

```sh
make up             # démarrer les conteneurs
make re             # reconstruire et démarrer
make down           # arrêter
make logs           # journaux d'anicroche (SERVICE=apicroche pour l'API)
make up mode=dev    # mode développement (volumes montés, nodemon pour l'API)
make reset mode=dev # vider la base MySQL et redémarrer l'API
```

En mode dev, les dossiers `adn/` et du moteur sont montés dans les conteneurs : les modifications sont prises en compte sans reconstruction.

## Déploiement (hébergement sans Docker)

En production, chaque partie tourne directement avec Node (`npm start` dans `anicroche/` et `apicroche/`). Le `.env` à la racine du dépôt est lu par les cadriciels eux-mêmes. Sur le serveur, `./deployer.sh` fait un `git pull`, réinstalle les dépendances si `package*.json` a changé, puis relance les deux applications avec PM2 (`pm2 startOrReload ecosystem.config.cjs`). `ecosystem.config.cjs` fixe les ports (4004 pour anicroche, 4005 pour apicroche) : HAProxy (Fast Installer d'Infomaniak) envoie chaque domaine vers son port. Penser à changer la `VERSION` de `avec.js/scripts/service-worker.js` quand anicroche change. Pour le rendu côté serveur, le `.env` du serveur doit contenir `internal_api_url=http://localhost:4005` : l'API est alors jointe en local, ce qui lui permet de croire l'IP du visiteur transmise par anicroche (`X-Forwarded-For`) et de lui appliquer ses propres limites.

## Conventions de code

### Langue

- **Français** pour tout ce qui est interne au code : noms de variables, fonctions, méthodes, fichiers, commentaires, messages de journal (ex. `charger_modeles`, `afficher_schemas`, `nom_affiche`).
- **Anglais** pour tout ce que les cadriciels exposent à leur utilisateur : mots-clefs et instructions (`@fields`, `@primary`, `@for-each`, `@stud`…), propriétés de modèles (`name`, `type`, `size`, `count`, `ref`), variables et fonctions mises à disposition (`$path`, `$navigate_to`, `$search_all`, `$indicate`, `$body`…), options (`select`, `order`, `limit`…).
- Le code applicatif (dans `adn/`) suit la règle du français pour ce qu'il définit lui-même (`$nettoyer_sessions`, `section-profil`…).

### Style JavaScript

- **Pas de points-virgules.**
- **Indentation de quatre espaces**, jamais de tabulations (c'est aussi obligatoire dans les fichiers `.avec`, où l'indentation porte la structure).
- Noms en `snake_case` (fonctions et variables), modèles `.avec` en `kebab-case`.
- Accolades sur leur propre ligne (style Allman) :

  ```js
  const formater = (champ) =>
  {
      if (champ.min === null)
          return champ.type
      return `${champ.type}(${champ.min})`
  }
  ```

- Fonctions fléchées de préférence ; `if` / `for` à une seule instruction sans accolades.
- Alignement vertical des `=`, `:` et des imports lorsque plusieurs lignes se suivent.
- Modules ES (`import` / `export`), Node 24 (sans.js utilise `crypto.argon2`, disponible depuis Node 24.7).

## Documents juridiques

`juridique/` : registre et procédures RGPD (`RGPD.md`) et brouillons des pages légales publiées sur le site (`conditions-generales-d-utilisation.md`, `politique-de-confidentialite.md`, `mentions-legales.md`). Une évolution qui touche aux données personnelles se reporte dans `RGPD.md` puis, si elle concerne les utilisateurs, dans les pages légales.

## Git

- Messages de commit en français, sous forme nominale décrivant le changement : « Ajout de … », « Correction de … », « Mise à jour de … », « Finalisation de … ».
- Liste de tâches en cours : `taches.txt`.
