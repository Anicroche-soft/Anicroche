# Démarrage

sans.js nécessite **Node 24.7 ou plus récent** : le hachage argon2 des champs `hash` utilise `crypto.argon2`, intégré à Node. Avec une version plus ancienne, le démarrage s'arrête sur une erreur explicite.

## Structure du projet

Un projet sans.js suit la structure suivante :

```
adn/
├── app.adn            ← configuration de l'application
├── images/            ← images servies sous /systeme/images/
├── fontes/            ← polices servies sous /systeme/fontes/
└── modeles/           ← fichiers .sans (organisables librement en sous-dossiers)
    └── index.sans     ← modèle spécial : actions globales, routes et fonctions partagées
sans.js/               ← moteur du cadriciel
depot/                 ← fichiers servis publiquement sous /depot/
```

Les modèles peuvent être rangés dans des sous-dossiers à la convenance de l'auteur.

> **Important :** deux modèles ne doivent pas porter le même nom, même s'ils se trouvent dans des dossiers différents.

Le fichier `index.sans` n'est pas une table : il sert à déclarer les [actions globales](scripts.md#indexsans-et-actions), des routes et des fonctions accessibles depuis tous les scripts.

## Le fichier `app.adn`

`app.adn` contient la configuration de l'application au format ADN (paires `clef : valeur`) :

```
nom    : MonAPI
port   : 5030
```

| Clef | Type | Défaut | Description |
|---|---|---|---|
| `nom` | texte | `sans.js` | Nom de l'API, affiché par la route `GET /` |
| `port` | nombre | `PORT` ou `5030` | Port d'écoute du serveur. S'il est absent, la variable d'environnement `PORT` est utilisée, puis `5030` |
| `body_limit` | taille | `1mb` | Taille maximale du corps des requêtes, en octets ou avec l'unité `b`, `kb` ou `mb` (`512kb`). Au-delà : `413` |

## Variables d'environnement

Les paramètres sensibles et le mode d'exécution sont fournis par des variables d'environnement (typiquement un fichier `.env` transmis par Docker).

Au démarrage, sans.js lit aussi le fichier `.env` du dossier courant ou, à défaut, du dossier parent, ce qui permet de se passer de Docker. Les variables déjà définies dans l'environnement (comme `PORT` fourni par l'hébergeur) ne sont pas écrasées. Le format est `clef=valeur`, une variable par ligne ; les lignes commençant par `#` sont ignorées et les guillemets entourant une valeur sont retirés.

### Base de données

| Variable | Défaut | Description |
|---|---|---|
| `database_host` | `localhost` | Hôte du serveur MySQL |
| `database_port` | `3306` | Port du serveur MySQL |
| `database_name` | — | Nom de la base de données (**obligatoire**) |
| `database_user` | — | Utilisateur MySQL (**obligatoire**) |
| `database_pass` | *(vide)* | Mot de passe MySQL |

> **Important :** la base de données doit exister avant le démarrage. sans.js ne la crée pas : il affiche une erreur si la connexion échoue.

### Fonctionnement

| Variable | Défaut | Description |
|---|---|---|
| `mode` | `prod` | Mode d'exécution : `dev` ou `prod`. En `prod`, les cookies posés par `$set_cookie` sont `Secure` et `SameSite=None` |
| `schema_destructive` | `false` | En mode `dev`, supprime les colonnes et tables disparues du schéma |
| `PORT` | `5030` | Port d'écoute HTTP (si `port` est absent de `app.adn`) |
| `app_url` | — | Adresse du site client, autorisée pour CORS |
| `cors_origin` | — | Autres origines autorisées pour CORS, séparées par des virgules |

### Secrets

| Variable | Description |
|---|---|
| `secret_aes` | Clef de chiffrement des champs `crypt` : 64 caractères hexadécimaux (256 bits) |
| `secret_hmac` | Clef du hachage déterministe des champs `hash` uniques |
| `secret_jwt` | Clef de signature des jetons de `$sign_token` / `$verify_token` (`JWT_SECRET` est aussi accepté) |

Une clef peut être générée avec :

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Courriel

| Variable | Défaut | Description |
|---|---|---|
| `email_host` | — | Serveur SMTP |
| `email_port` | `465` | Port SMTP (connexion chiffrée si `465`) |
| `email_user` | — | Identifiant SMTP, aussi utilisé comme adresse d'expédition |
| `email_pass` | — | Mot de passe SMTP |
| `email_name` | — | Nom affiché de l'expéditeur |

## Construction de la base de données

Au démarrage, sans.js compare les modèles à la base et l'adapte :

| Action | `dev` | `prod` |
|---|---|---|
| Créer les tables absentes (y compris les tables de jonction) | ✓ | ✓ |
| Ajouter les colonnes absentes, modifier les colonnes dont le type, la nullité ou la valeur par défaut a changé | ✓ | ✓ |
| Mettre à jour la clef primaire et les contraintes `@unique` (les contraintes disparues sont supprimées) | ✓ | ✓ |
| Créer, modifier ou supprimer les clefs étrangères des relations | ✓ | ✓ |
| Supprimer les colonnes disparues du schéma | si `schema_destructive=true` | — |
| Supprimer les tables disparues du schéma | si `schema_destructive=true` | — |

Les clefs étrangères gérées par sans.js sont nommées `fk_<table>_<colonne>`. Les autres contraintes ne sont jamais modifiées. Si une clef étrangère ne peut pas être ajoutée (par exemple parce que des lignes existantes font référence à des entrées absentes), une erreur est affichée et le démarrage continue.

Le schéma, les relations et les routes sont affichés dans les journaux au démarrage.

## Format des réponses

Toutes les réponses de l'API sont au format JSON :

```json
{
    "code"   : 200,
    "message": "OK",
    "data"   : { }
}
```

- `message` est remplacé par `error` quand le code n'est pas un succès (hors `2xx`).
- `data` contient les données de la réponse (`{}` par défaut).
- Des clefs supplémentaires peuvent être ajoutées au premier niveau avec [`$add_to_respond`](scripts.md#add_to_respond).

| Route | Réponse |
|---|---|
| `GET /` | `200` « Bienvenue sur l'API … » (en mode `dev` : une console HTML pour envoyer des requêtes à l'API) |
| Route inconnue | `404` « Route introuvable » |
| Corps plus grand que `body_limit` | `413` « Corps de requête trop grand » (la connexion est fermée) |
| Limite de requêtes dépassée | `429` « Trop de requêtes », avec `Retry-After` (voir [`@limits`](routes.md#limites-par-ip--limits)) |
| Trop de calculs argon2 simultanés | `503` « Serveur surchargé », avec `Retry-After` (voir [Champs `hash`](modeles.md#champs-hash)) |
| Erreur imprévue | `500` « Erreur interne » (le détail est affiché dans les journaux) |

## CORS

Les en-têtes CORS sont ajoutés à toutes les réponses :

- origines autorisées : `app_url` et `cors_origin` ; en mode `dev`, toute origine `http://` ou `https://` est acceptée ;
- méthodes : `GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS` ;
- en-têtes : `Content-Type`, `Authorization` ;
- les cookies sont acceptés (`Access-Control-Allow-Credentials: true`).

Les requêtes `OPTIONS` reçoivent une réponse `204`.

Protection contre les requêtes intersites (CSRF) : les requêtes `POST`, `PATCH` et `DELETE` sont refusées

- en `403` si leur en-tête `Origin` n'est pas une origine autorisée (ou, sans `Origin`, si `Sec-Fetch-Site` vaut `cross-site`) ;
- en `415` si elles ont un corps dont le `Content-Type` n'est pas `application/json`.

## Fichiers statiques

| Route | Dossier |
|---|---|
| `/depot/<chemin>` | `depot/` |
| `/systeme/images/<chemin>` | `adn/images/` |
| `/systeme/fontes/<chemin>` | `adn/fontes/` |

La recherche est récursive : si le fichier n'est pas à l'emplacement indiqué, il est cherché par son nom dans les sous-dossiers.

```
GET /depot/photo.png  →  depot/uploads/photo.png
```

Les chemins qui sortent du dossier (`..`) sont refusés (`404`). Les types MIME courants (images, polices, audio, vidéo, JSON, texte, PDF) sont détectés à partir de l'extension.
