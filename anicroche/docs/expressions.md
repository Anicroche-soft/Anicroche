# Expressions

Les expressions permettent de calculer des valeurs dans les conditions, les boucles, les attributs et les arguments. Elles s'écrivent entre crochets `[…]`.

```
@if [$compteur > 0]
<div class="theme-$theme" style="opacity: $opacite">
```

---

## Variables

### Variables de scope

Les variables de scope sont des variables réactives préfixées par `$`. Elles sont accessibles dans les expressions, les textes et les scripts.

Chaque instance de modèle possède son propre scope. La résolution d'une variable se fait en remontant la chaîne des scopes : modèle courant → parent → ... → racine.

```
@if [$connecte]

<div class="theme-$theme">

"Bonjour $nom !"
```

Lorsqu'une variable de scope change de valeur, le cadriciel met à jour automatiquement toutes les parties du DOM qui en dépendent.

Si une variable existe déjà dans un scope parent, une affectation depuis un enfant met à jour la variable du parent.

Si une variable n'existe dans aucun parent, l'affectation crée la variable dans le scope courant.

**Variables de scope prédéfinies à la racine** (gérées automatiquement par le cadriciel) :

| Variable | Type | Description |
|---|---|---|
| `$path` | texte | Chemin de l'URL courante (ex : `/page/42`) |
| `$query` | dictionnaire | Paramètres de la chaîne de requête de l'URL (ex : `{q: "recherche"}` pour `?q=recherche`) |
| `$hash` | texte | Fragment de l'URL (ex : `#section`) |
| `$navigate_to` | fonction | Navigue vers une URL (`$navigate_to('/connexion')`, `$navigate_to('/article/42?q=test')`, `$navigate_to('/compte', :))` pour remplacer l'entrée actuelle de l'historique) |
| `$navigate_prev` | fonction | Reproduit la flèche "retour" du navigateur (`$navigate_prev()`) |
| `$navigate_post` | fonction | Reproduit la flèche "suivant" du navigateur (`$navigate_post()`) |
| `$history` | fonction | Retourne une entrée de l'historique interne (`$history()`, `$history(1)`, `$history(2)`) |
| `$match` | fonction | Correspondance de motif de [`~=`](#correspondance-de-motif-) pour les scripts : `$match('/article/42', '/article/<$id>')` renvoie les captures (`{ id : "42" }`, `{}` sans capture), ou `null` si le texte ne correspond pas. Rien n'est écrit dans les variables |
| `$title` | texte ou `:o` | Titre de la page (`<title>`) ; `:o` : `name` de la clef `config` d'`app.adn` |
| `$description` | texte ou `:o` | Description de la page (`<meta name="description">`) ; `:o` : `description` de la clef `config` d'`app.adn` |
| `$status` | nombre ou `:o` | Code HTTP de la page construite par le serveur (`:o` : 200) ; sans effet dans le navigateur |
| `$app` | dictionnaire | Configuration de `app.adn` (voir [Démarrage](demarrage.md#le-fichier-appadn)) |
| `$<clef>` | selon la clef | Chaque clef de `app.adn` (ex. `$config`), ainsi que `$api_url` et `$app_url` |
| `$create`, `$search`, `$update`, `$delete` | fonctions | Requêtes vers l'API (voir [Requêtes vers l'API](api.md)) |
| `$add_action` | fonction | Actions exécutées autour des requêtes vers l'API (voir [Requêtes vers l'API](api.md#actions-autour-des-requêtes--add_action)) |

`$title`, `$description` et `$status` valent `:o` au démarrage. Le cadriciel ne les remet pas à zéro à la navigation : une page les fixe par une [affectation dans le modèle](modeles.md#affectations-dans-le-modèle), qui les remet à `:o` quand la page est retirée.

`$path`, `$query` et `$hash` sont mis à jour à chaque navigation sans rechargement de page. Une barre oblique finale est retirée de l'adresse (`/profil/` devient `/profil`), qui est réécrite dans l'historique sans nouvelle entrée.

Précisions :

- `$navigate_to(url, replace = :()` accepte une URL relative ou absolue. Par défaut, une entrée est ajoutée à l'historique ; avec `:)` en second argument, l'entrée actuelle est remplacée : le bouton « retour » du navigateur ne ramène pas à l'adresse quittée (utile pour les onglets d'une même page, par exemple). Si le remplacement rend l'entrée identique à la précédente (adresse `/profil` saisie depuis `/compte`, puis remplacée par `/compte`, par exemple), le cadriciel revient à cette entrée précédente, pour ne pas laisser deux entrées de suite vers la même adresse ; l'entrée remplacée reste seulement accessible par le bouton « suivant », jusqu'à la navigation suivante. Ce retour nécessite l'API Navigation du navigateur : sans elle, les deux entrées restent.
- Si l'URL cible est externe (origine différente), la navigation est déléguée au navigateur (rechargement normal, avec `location.replace` en cas de remplacement).
- Un clic sur un lien `<a>` interne est pris en charge par le cadriciel (navigation sans rechargement), sauf si un gestionnaire `@click` du modèle a déjà appelé `$event.preventDefault()` : le modèle traite alors le clic lui-même.
- `$history(age = 0)` renvoie l'URL relative (chemin + query + hash) enregistrée lors des navigations internes :
    - `0` = entrée la plus récente,
    - `1` = entrée précédente,
    - etc.
    - si l'entrée demandée n'existe pas, la fonction renvoie `null`.
    - un remplacement (`$navigate_to(url, :))`, `history.replaceState`, barre oblique finale retirée) remplace l'entrée la plus récente au lieu d'en ajouter une.

### Arguments de modèle

Les arguments déclarés via `@args` sont des variables locales à l'instance du modèle. Ils s'utilisent dans les expressions, les textes et les scripts.

Les arguments sont **en lecture seule** : toute tentative d'affectation d'un argument provoque une erreur.

En cas de conflit de nom, `@args` est prioritaire sur les variables de scope.

```
@args [$titre, $couleur : "bleu"]

<h1 style="color: $couleur">
    "$titre"
```

### Variables de nœud

Les variables de nœud (`$vars`) permettent de stocker des données associées à un élément DOM précis. Elles persistent entre le montage et le démontage de l'élément, mais ne sont **accessibles que dans les scripts** (`@script`, `@mount`, `@unmount` et gestionnaires d'événements) — pas dans les expressions ni les textes du gabarit. Dans ces scripts, `$event`, `$node` et `$vars` sont injectés automatiquement, y compris dans les fonctions déclarées à l'intérieur du script.

```
@script [
    $monter = () =>
    {
        $vars.intervalle = setInterval(() => { ... }, 1000)
    }

    $demonter = () =>
    {
        clearInterval($vars.intervalle)
        $vars.intervalle = null
    }
]

<div
    @mount="$monter()"
    @unmount="$demonter()"
>
```

> **Attention :** `$event`, `$node` et `$vars` ne sont pas capturés par les fonctions : ils sont relus à chaque accès et désignent le gestionnaire **en cours d'exécution**. Dans un rappel différé (`requestAnimationFrame`, `setTimeout`, `setInterval`, écouteur ajouté par `addEventListener`, observateur, suite d'un `await`), ils peuvent donc désigner un autre nœud, celui du dernier gestionnaire exécuté. Copiez-les dans des constantes avant :
>
> ```
> $monter = () =>
> {
>     const noeud = $node
>     const vars  = $vars
>     noeud.classList.add('entree')
>     requestAnimationFrame(() => noeud.classList.remove('entree'))
>     vars.intervalle = setInterval(() => { ... }, 1000)
> }
> ```

### Accès profond

Les variables de type liste ou dictionnaire supportent l'accès à leurs éléments par notation pointée ou par index :

```
@if [$utilisateur.actif]

"$utilisateur.nom"

@if [$liste[0] = "premier"]
```

### Appels de fonctions

Une variable qui contient une fonction (déclarée dans un `@script`, ou fournie par le cadriciel) peut être appelée dans une expression, comme dans un texte, avec ses arguments entre parenthèses, collées à son nom :

```
@script [
    $formater_prix = (prix) => `${prix.toFixed(2)} €`
    $outils = { majuscules: (texte) => texte.toUpperCase() }
]

$route = $trouver_route($path)

@if [$est_legale($anicroche) & ! $soumise_au_preavis($anicroche)]

"Total : $formater_prix($total)"

"$outils.majuscules($nom)"
```

- Les arguments sont des expressions, séparés par des virgules.
- Comme toute expression, l'appel est réévalué quand une variable dont il dépend change : celles de ses arguments, et celles que la fonction lit elle-même (`$profil` dans `(nom) => $profil.role === nom`).
- La fonction est exécutée à chaque évaluation : elle doit rendre un résultat sans rien modifier, et sans attendre (une promesse n'est pas attendue).
- Une fonction qui ne renvoie rien donne `:o` ; une erreur dans la fonction (affichée dans la console), ou une variable qui n'est pas une fonction, donne `:x`.
- Dans un texte, des parenthèses qui suivent une variable qui n'est pas une fonction restent du texte : `"$quantite(s)"` affiche `3(s)`.
- Les arguments d'un [appel de modèle](modeles.md#passer-une-fonction-en-argument) gardent leur règle : `[$fn($a)]` y passe une fonction à appeler plus tard, et non son résultat.

---

## Littéraux

| Type | Syntaxe | Exemples |
|---|---|---|
| Nombre | Chiffres, `.` pour les décimaux, `_` comme séparateur visuel | `42`, `3.14`, `-7`, `1_000_000` |
| Texte | Entre guillemets simples, doubles ou obliques | `"bonjour"`, `'monde'`, `` `texte` `` |
| Booléen vrai | `:)` | `@if [:)]` |
| Booléen faux | `:(` | `@unless [:(]` |
| Erreur | `:x` | (résultat interne, rarement utilisé directement) |
| Null | `:o` | `@if [:o]` |
| Liste | `[elem1, elem2, …]` | `[1, 2, 3]`, `["a", "b"]` |
| Dictionnaire | `{clef: valeur, …}` | `{nom: "Alice", age: 30}` |

Un élément de liste ou une valeur de dictionnaire peut être une expression (`[$id, $page]`, `{nom: $profil.nom}`) : elle est évaluée à chaque lecture du littéral, et ses variables sont suivies comme ailleurs. Un élément qui est une simple valeur reste tel quel, sans interpolation : un motif `'/article/<$id>'` d'une liste passée à [`~{`](#correspondance-avec-une-liste-de-motifs--) n'est pas modifié par la variable `$id`.

Dans le moteur, ces littéraux sont évalués comme des valeurs natives JavaScript: `:)` / `:(` deviennent `true` / `false`, `:o` devient `null`, et la syntaxe reste propre au langage d'expressions.

---

## Opérateurs

### Arithmétiques

| Opérateur | Description | Exemple |
|---|---|---|
| `+` | Addition | `$a + 1` |
| `-` | Soustraction | `$total - $remise` |
| `*` | Multiplication | `$prix * 2` |
| `/` | Division | `$valeur / 100` |
| `%` | Modulo | `$n % 2` |
| `^` | Puissance | `2 ^ 8` |

### Comparaison

| Opérateur | Description |
|---|---|
| `=` | Égalité (numérique ou textuelle) |
| `!=` | Différence |
| `>` | Supérieur |
| `>=` | Supérieur ou égal |
| `<` | Inférieur |
| `<=` | Inférieur ou égal |

Les comparaisons peuvent être **chaînées** : `1 < $n < 10` est équivalent à `1 < $n & $n < 10`.

### Logiques

| Opérateur | Description |
|---|---|
| `&` | Et logique (court-circuit : le membre droit n'est pas évalué si le gauche est faux) |
| `\|` | Ou logique (court-circuit : le membre droit n'est pas évalué si le gauche est vrai) |
| `!` | Non logique |

**Valeur de vérité** (résultat d'une condition `@if`, `@unless`, `@while`, `[condition] ?`, et opérandes de `&`, `|` et `!`) : `:(`, `:o`, `:x` (variable absente, par exemple) et le texte vide `''` sont faux ; toute autre valeur (nombre, `0` compris, texte non vide, liste, dictionnaire, fonction) est vraie. Ainsi `$message & ! $erreur` est vrai si `$message` n'est pas vide et `$erreur` vaut `:(`, `:o` ou `''`. Les règles sont les mêmes dans sans.js.

### Longueur

| Opérateur | Description | Exemple |
|---|---|---|
| `_` | Retourne la longueur d'une valeur (chaîne, liste ou dictionnaire). Il doit y avoir un espace entre l'opérateur `_` et l'expression qui suit (ex : `_ $var`). | `_ $nom`, `_ $liste`, `_ $objet` |

L'opérateur `_` renvoie un nombre entier: le nombre de caractères d'une chaîne (comptés en points de code Unicode), la longueur d'une liste, ou le nombre de clés propres d'un dictionnaire. Si le type n'est pas pris en charge, l'opérateur échoue.

### Appartenance

Ces opérateurs vérifient si une valeur est présente dans une liste, ou si une clé est présente dans un dictionnaire.

| Opérateur | Description | Exemple |
|---|---|---|
| `a -{ b` | `a` est contenu dans `b` | `$role -{ ["admin", "modo"]` |
| `a !-{ b` | `a` n'est pas contenu dans `b` | `$role !-{ $roles_interdits` |
| `b }- a` | `b` contient `a` | `$liste }- $element` |
| `b !}- a` | `b` ne contient pas `a` | `$dict !}- "clef"` |

```
@if [$role -{ ["admin", "moderateur"]]
    "Menu d'administration"
```

### Filtrage de texte

| Opérateur | Description | Exemple |
|---|---|---|
| `texte :+ "chars"` | Garde uniquement les caractères listés dans `chars` | `$saisie :+ "0123456789"` |
| `texte :- "chars"` | Supprime les caractères listés dans `chars` | `$saisie :- " \t"` |

```
# Ne conserver que les chiffres d'une saisie :
@if [($saisie :+ "0123456789") = $saisie]
    "La saisie est un nombre valide"
```

### Correspondance de motif (`~=`)

L'opérateur `~=` vérifie si un texte correspond à un motif. Il peut capturer des segments du texte dans des variables réactives.

**Expression rationnelle :**

Le membre droit peut être une expression rationnelle JavaScript, écrite entre barres obliques et suivie de drapeaux éventuels (`g`, `i`, `m`, `s`, `u`, `y`) :

```
@if [$courriel ~= /^[^@\s]+@[^@\s]+\.[^@\s]+$/]
    "Adresse valide"

@if [$nom ~= /^dupont$/i]
    "Bonjour M. Dupont"
```

Le résultat est vrai si l'expression trouve une correspondance dans le texte (converti en texte au besoin). Une expression rationnelle ne capture pas de variables.

**Correspondance simple :**

```
@if [$path ~= '/accueil']
```

**Capture d'un segment dans une variable réactive :**

```
@if [$path ~= '/<$id>']
# $id contient la partie capturée, jusqu'au prochain / exclu
```

Sans filtrage, une capture s'arrête au premier `/` : elle vaut un segment de chemin, comme dans les routes de sans.js. Elle s'arrête aussi au texte fixe qui la suit dans le motif.

**Capture avec caractères autorisés (`:+`) — s'arrête dès qu'un caractère non listé est rencontré :**

```
@if [$path ~= '/<$id :+ abcdefghijklmnopqrstuvwxyz0123456789->']
```

**Capture avec caractères d'arrêt (`:-`) — s'arrête dès qu'un caractère listé est rencontré ; la liste remplace le `/`, et `:- ''` capture tout, `/` compris :**

```
@if [$path ~= '/<$id :- />']
```

**Plusieurs segments :**

```
@if [$path ~= '/<$section>/<$id>']
# $section et $id capturent chacun un segment : /a/b correspond, /a/b/c non
```

Les variables capturées sont écrites dans le scope courant (ou dans un parent si la variable existe déjà) et immédiatement disponibles dans les expressions, les textes et les scripts.

### Correspondance avec une liste de motifs (`~{`, `}~`)

Ces opérateurs combinent l'appartenance et la correspondance de motif : ils vérifient si un texte correspond à **au moins un** des motifs d'une liste (ou des clés d'un dictionnaire). Les motifs s'écrivent comme pour `~=` (sans expression rationnelle) et de préférence entre guillemets.

| Opérateur | Description | Exemple |
|---|---|---|
| `a ~{ b` | `a` correspond à l'un des motifs de `b` | `$path ~{ ['/profil', '/compte']` |
| `a !~{ b` | `a` ne correspond à aucun des motifs de `b` | `$path !~{ $chemins_publics` |
| `b }~ a` | l'un des motifs de `b` correspond à `a` | `['/<$id>', '/<$id>/edition'] }~ $path` |
| `b !}~ a` | aucun des motifs de `b` ne correspond à `a` | `$chemins_publics !}~ $path` |

Les motifs sont essayés dans l'ordre : seul le premier qui correspond écrit ses captures. Les formes inversées (`!~{`, `!}~`) n'écrivent aucune capture.

```
# Une même page pour plusieurs adresses : le modèle reste en place de l'une à l'autre
# (voir @key pour le reconstruire à chaque adresse)
@if [$path ~{ ['/profil', '/compte']]
    page-profil

@else-if [$path ~{ ['/article/<$id :+ 0123456789>', '/a/<$id :+ 0123456789>']]
    page-article $id
```

**Exemple complet — routeur :**

```
@if [$path ~= '/']
    page-accueil

@else-if [$path ~= '/article/<$id :+ 0123456789>']
    page-article $id

@else
    page-404
```
