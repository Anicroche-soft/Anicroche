# RGPD — Registre et procédures d'Anicroche

Ce document rassemble ce que le RGPD demande en dehors du code : le registre des traitements, les sous-traitants, les durées de conservation, les mesures de sécurité et les procédures à suivre (demandes des utilisateurs, violation de données, sauvegardes, secrets).

Il doit être tenu à jour à chaque évolution des modèles `.sans` ou de l'hébergement. Les éléments marqués **À compléter** restent à définir.

Dernière mise à jour : 13 novembre 2026.

---

## 1. Responsable du traitement

| | |
|---|---|
| Responsable | Alexis Bonnet (éditeur d'Anicroche) |
| Statut | Particulier (éditeur non professionnel) |
| Adresse de contact RGPD | **À compléter** (adresse dédiée conseillée, ex. `confidentialite@anicroche.com`) |
| Délégué à la protection des données | Non désigné (pas obligatoire pour ce type de service) |

En tant qu'éditeur non professionnel, la loi pour la confiance dans l'économie numérique (LCEN, art. 6) permet de ne pas publier son nom dans les mentions légales : il suffit de donner son identité à l'hébergeur et d'indiquer dans les mentions légales le nom, l'adresse et le téléphone d'Infomaniak. Les obligations du RGPD restent les mêmes.

---

## 2. Registre des traitements

### 2.1. Gestion des comptes et authentification

| | |
|---|---|
| Finalité | Créer un compte, se connecter (mot de passe ou code envoyé par courriel), maintenir la session |
| Base légale | Exécution du contrat (CGU) — art. 6.1.b |
| Personnes concernées | Utilisateurs inscrits, et personnes qui demandent un code sans terminer l'inscription |
| Données | Adresse électronique (chiffrée AES-256-GCM + empreinte HMAC) ; mot de passe (haché Argon2id) ; date d'inscription ; date d'acceptation des conditions d'utilisation (preuve de l'acceptation, voir § 11) ; code de connexion (haché, valable 15 min) |
| Destinataires | L'éditeur ; l'hébergeur ; le prestataire d'envoi de courriels (adresse et code) |
| Durée de conservation | Compte : jusqu'à sa suppression, ou après inactivité (**À compléter**, voir § 4). Codes : 15 min de validité, supprimés au plus tard le lendemain (`$nettoyer_clefs`) |

### 2.2. Sécurité des sessions et prévention des abus

| | |
|---|---|
| Finalité | Sécuriser les sessions, permettre à l'utilisateur de voir ses appareils connectés, limiter les abus (limitation des requêtes) |
| Base légale | Intérêt légitime (sécurité du service) — art. 6.1.f |
| Données | Adresse IP ; agent utilisateur (navigateur) ; nom de l'appareil ; dates d'émission, de validité et de révocation de la session ; jeton de session (haché) |
| Durée de conservation | Session : 30 jours au plus ; supprimée le lendemain de son expiration ou de sa révocation (`$nettoyer_sessions`). Compteurs de limitation : en mémoire uniquement, quelques minutes |

### 2.3. Profils

| | |
|---|---|
| Finalité | Permettre à l'utilisateur de créer et gérer des profils publics |
| Base légale | Exécution du contrat — art. 6.1.b |
| Données | Identifiant ; pseudonyme ; date de création ; comptes gérants |
| Visibilité | Identifiant et pseudonyme : publics. Le lien entre un profil et le compte qui le gère n'est pas public |
| Durée de conservation | Jusqu'à la suppression du profil ou du dernier compte gérant (**À compléter** quand la suppression de compte sera faite) |

### 2.4. Âge

La date de naissance sert à deux traitements distincts.

**a) Âge minimum et limites d'accès** (toujours actif)

| | |
|---|---|
| Finalité | Refuser l'inscription en dessous de l'âge minimum ; restreindre l'accès à certains contenus selon l'âge |
| Base légale | Obligation légale et intérêt légitime (protection des mineurs) — art. 6.1.c et 6.1.f |
| Données | Date de naissance (chiffrée AES-256-GCM) |
| Durée de conservation | Celle du compte |

**b) Fonctionnalités liées à l'âge** (facultatives)

| | |
|---|---|
| Finalité | Fonctionnalités qui utilisent l'âge ou la date de naissance au-delà des limites d'accès (ex. attentions le jour de l'anniversaire) |
| Base légale | Consentement — art. 6.1.a |
| Recueil | Une case à cocher unique dans les réglages du compte, décochée par défaut et décochable à tout moment. Décocher arrête ces fonctionnalités, sans supprimer la date de naissance, qui reste nécessaire au traitement a) |
| Données | Date de naissance ; choix de l'utilisateur (case cochée ou non, avec sa date) |
| Durée de conservation | Celle du compte |

**Âge minimum d'inscription : 15 ans.** Anicroche s'apparente à un réseau social :

- en France, un mineur ne peut consentir seul au traitement de ses données qu'à partir de 15 ans (RGPD art. 8, loi Informatique et Libertés art. 45) ;
- la loi du 7 juillet 2023 sur la « majorité numérique » impose aux réseaux sociaux une autorisation parentale en dessous de 15 ans. Son entrée en vigueur dépend de textes d'application : **vérifier où elle en est avant le lancement**.

L'inscription est donc refusée en dessous de 15 ans, en attendant les comptes sous contrôle parental (voir `taches.txt`).

**Mise en œuvre :**

- la date de naissance est demandée à l'inscription, juste après la clef de validation, avec une phrase qui explique pourquoi ;
- en dessous de 15 ans, le site affiche une étape de refus, et l'API refuse aussi l'inscription (`403`), même si le site est contourné (`$calculer_age` et `$age_minimum` dans `index.sans`) ;
- l'âge est déclaratif : rien n'empêche une personne de saisir une autre date. C'est le niveau de vérification habituel aujourd'hui pour ce type de service ;
- la case des fonctionnalités liées à l'âge (b) n'existe pas encore : personne n'y a donc consenti, et aucune de ces fonctionnalités ne doit utiliser la date de naissance tant qu'elle n'est pas en place.

### 2.5. Stockage sur l'appareil de l'utilisateur

| Élément | Contenu | Finalité | Consentement |
|---|---|---|---|
| Cookie `jeton` (HttpOnly, Secure) | Identifiant et jeton de session | Rester connecté | Non requis (strictement nécessaire) |
| `localStorage` `id_profil` | Profil sélectionné | Mémoriser le profil actif | Non requis (strictement nécessaire) |
| Cache du service worker | Fichiers du site uniquement (aucune réponse de l'API) | Chargement rapide, mode hors ligne | Non requis |

Il n'y a ni outil de mesure d'audience, ni publicité, ni ressource tierce en production. Toute ressource externe (police, image, script) ajoutée plus tard doit être inscrite ici et évaluée.

### 2.6. Journaux du serveur

| | |
|---|---|
| Contenu | Journaux PM2 : démarrage, erreurs. En `mode=prod`, les requêtes SQL ne sont pas journalisées. Les messages d'erreur MySQL peuvent toutefois contenir une valeur (ex. identifiant en double) |
| Durée de conservation | **À compléter** (conseillé : rotation avec `pm2-logrotate`, 30 jours au plus) |

---

## 3. Sous-traitants

| Sous-traitant | Rôle | Données concernées | Localisation | Contrat (art. 28) |
|---|---|---|---|---|
| Infomaniak | Hébergement (Serveur Cloud, HAProxy), base de données, envoi des courriels (SMTP), sauvegardes | Toutes | Suisse (décision d'adéquation de la Commission européenne) | **À vérifier** (voir ci-dessous) |

L'article 28 du RGPD impose un contrat écrit avec chaque prestataire qui traite des données pour le compte d'Anicroche. Ce contrat engage le prestataire à n'utiliser les données que sur instruction, à les protéger, à aider en cas de violation, puis à les supprimer à la fin du contrat. Il n'y a pas à le négocier : les hébergeurs fournissent un modèle standard, souvent appelé « DPA » (*Data Processing Agreement*) ou « contrat de sous-traitance ».

Chez Infomaniak, ce contrat est intégré à leurs conditions générales ou proposé dans le Manager, selon l'offre. À faire une fois : retrouver ce document, vérifier qu'il couvre bien le Serveur Cloud, la base de données et le service de courriel, puis noter ici sa référence et la date. **À compléter.**

Avant d'ajouter un nouveau prestataire qui reçoit des données personnelles : vérifier sa localisation (UE ou pays adéquat), accepter son contrat de sous-traitance, puis l'ajouter à ce tableau et à la politique de confidentialité.

---

## 4. Durées de conservation

| Donnée | Durée | Mise en œuvre |
|---|---|---|
| Code de connexion | 15 min de validité, suppression quotidienne | `$nettoyer_clefs` (`index.sans`) |
| Session | 30 jours au plus, suppression quotidienne après expiration ou révocation | `$nettoyer_sessions` (`index.sans`) |
| Compte inactif | À définir avec la gestion des comptes inactifs (voir `taches.txt`) | À développer |
| Compte supprimé | Suppression immédiate de la base ; disparition des sauvegardes au bout de leur durée de rotation | À développer |
| Versions publiées des pages légales | Sans limite : elles prouvent ce que chaque utilisateur a accepté | Voir § 11 |
| Sauvegardes | Celle d'Infomaniak (**À noter** : durée indiquée dans le Manager) | Voir § 7 |
| Journaux du serveur | **À compléter** | Voir § 2.6 |

---

## 5. Mesures de sécurité (art. 32)

Ce qui est en place dans le code :

- mots de passe hachés en Argon2id (12 à 128 caractères), nombre de calculs simultanés plafonné ;
- adresses électroniques et date de naissance chiffrées en AES-256-GCM ; recherche par empreinte HMAC-SHA256 ;
- codes de connexion hachés, valables 15 min, 6 essais au plus, un nouveau code toutes les 30 s au plus ;
- jetons de session hachés en base, renouvelés à mi-vie ; cookie `HttpOnly`, `Secure`, `SameSite=None` en production ; jeton d'accès JWT de 15 min ;
- protection CSRF, CORS limité aux origines configurées ;
- limitation des requêtes par IP (`@limits`), adresse réelle lue uniquement depuis le mandataire local ;
- taille maximale du corps des requêtes ;
- HTTPS via HAProxy en production ;
- secrets dans le `.env`, absent du dépôt git.

Ce qui relève de l'organisation, à respecter :

- accès SSH au serveur par clef uniquement, avec double authentification sur le compte Infomaniak ;
- mises à jour régulières de Node, des dépendances (`npm audit`) et du système ;
- personne d'autre que l'éditeur n'a accès au serveur, à la base ou au `.env` ; toute ouverture d'accès est notée ici.

---

## 6. Gestion des secrets

| Secret | Rôle | Si le secret est perdu | S'il fuit |
|---|---|---|---|
| `secret_aes` | Chiffrement des adresses et dates de naissance | **Données irrécupérables** : le garder aussi hors du serveur (gestionnaire de mots de passe) | Données chiffrées lisibles par qui a aussi la base : rechiffrer toute la base avec une nouvelle clef, procédure de violation (§ 8) |
| `secret_hmac` | Empreinte des adresses (recherche, unicité) | Plus aucune connexion possible : recalcul à partir des adresses déchiffrées | Permet de tester si une adresse est inscrite : changer la clef et recalculer les empreintes |
| `secret_jwt` | Signature des jetons d'accès | Aucune conséquence durable (jetons de 15 min) | En changer : tous les jetons d'accès deviennent invalides |
| `database_pass`, `email_pass` | Accès à la base et au SMTP | Les réinitialiser chez l'hébergeur | Les changer immédiatement, puis procédure de violation (§ 8) |

Une copie de `secret_aes` et de `secret_hmac` doit exister en dehors du serveur, dans un endroit sûr : **À compléter** (où ?).

Script de rechiffrement en cas de changement de clef : **à écrire**.

---

## 7. Sauvegardes et restauration

Les sauvegardes du serveur et de la base sont assurées par Infomaniak. Il reste seulement :

- à noter ici la fréquence et la durée de conservation affichées dans le Manager (**À compléter**), car la politique de confidentialité doit indiquer combien de temps une donnée supprimée peut survivre dans les sauvegardes ;
- à ne pas faire de copie de la base en dehors d'Infomaniak (sur un ordinateur personnel, par exemple) sans la chiffrer ;
- après une restauration, à refaire les suppressions demandées depuis la date de la sauvegarde. Pour cela, garder la liste des comptes supprimés, par leur `id` uniquement.

---

## 8. Procédure en cas de violation de données

Une violation est toute perte, fuite, modification ou accès non autorisé à des données personnelles : base copiée, `.env` publié, serveur compromis, courriel envoyé au mauvais destinataire, sauvegarde perdue…

1. **Contenir** dès la découverte : couper l'accès en cause (`pm2 stop`, changer les mots de passe, révoquer les clefs SSH), changer les secrets exposés (§ 6), révoquer toutes les sessions si nécessaire (`date_revocation` sur toutes les lignes de `sessions`).
2. **Évaluer** : quelles données, combien de personnes, depuis quand, données chiffrées ou non, et si la clef de chiffrement a fuité elle aussi.
3. **Notifier la CNIL sous 72 heures** après la découverte, sauf si la violation ne présente pas de risque pour les personnes : [notifications.cnil.fr](https://notifications.cnil.fr/notifications/index). Si tout n'est pas encore connu, notifier quand même et compléter ensuite.
4. **Informer les utilisateurs concernés** sans délai si le risque est élevé (ex. adresses en clair et mots de passe exposés) : ce qui s'est passé, les conséquences possibles, les mesures prises, ce qu'ils doivent faire (changer leur mot de passe ailleurs s'ils le réutilisent…).
5. **Consigner** la violation dans le registre ci-dessous, **même si elle n'a pas été notifiée**.
6. **Corriger** la cause et noter la correction.

### Registre des violations

| Date de découverte | Nature | Données et personnes concernées | Conséquences | Mesures prises | Notification CNIL / personnes |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## 9. Demandes des utilisateurs (exercice des droits)

Les demandes arrivent à l'adresse de contact RGPD (§ 1). **Délai de réponse : un mois** à compter de la réception (prolongeable de deux mois pour une demande complexe, en prévenant la personne dans le premier mois).

1. **Vérifier l'identité** : répondre uniquement à l'adresse électronique enregistrée sur le compte, ou demander à la personne de se connecter. Ne jamais demander de pièce d'identité si ce n'est pas indispensable.
2. **Traiter la demande** :

   | Droit | Traitement |
   |---|---|
   | Accès / portabilité (art. 15 et 20) | Export des données du compte (route à développer) ; en attendant, extraction manuelle en JSON : compte (dont date de naissance et date d'acceptation des conditions d'utilisation), coordonnées, sessions, profils gérés |
   | Rectification (art. 16) | Fonctions à développer ; en attendant, modification manuelle en base par l'API (les champs `crypt` et `hash` doivent passer par sans.js, pas par du SQL direct) |
   | Effacement (art. 17) | Fonction à développer ; en attendant, suppression manuelle du compte, de ses coordonnées et sessions, et des profils dont il est le seul gérant |
   | Opposition (art. 21) et retrait du consentement | Arrêter le traitement concerné (ex. décocher les fonctionnalités liées à l'âge) |
   | Limitation (art. 18) | Marquer le compte et suspendre le traitement contesté le temps de la vérification |

3. **Répondre** à la personne, en indiquant ce qui a été fait, ou pourquoi la demande est refusée et qu'elle peut saisir la CNIL.
4. **Consigner** la demande ci-dessous (sans y recopier de données personnelles au-delà du nécessaire).

### Registre des demandes

| Date de réception | Droit exercé | Date de réponse | Suite donnée |
|---|---|---|---|
| — | — | — | — |

---

## 10. Avant de mettre en ligne une nouveauté

À chaque nouveau champ, modèle, ressource externe ou prestataire :

- la donnée est-elle vraiment nécessaire ? Si oui, quelle finalité et quelle base légale ?
- quelle durée de conservation, et quel mécanisme de suppression ?
- doit-elle être `crypt` ou `hash` ?
- est-elle exposée par une route (`can_search`) ? À qui ?
- est-elle prise en compte par l'export et la suppression de compte ?
- ce document et la politique de confidentialité ont-ils été mis à jour ?

Une analyse d'impact (AIPD) n'est pas nécessaire aujourd'hui. Elle le deviendrait en cas de traitement à grande échelle de données sensibles, de suivi des personnes ou de profilage.

---

## 11. Pages légales et preuve d'acceptation des conditions

Les conditions d'utilisation, la politique de confidentialité et les mentions légales sont des anicroches de type `page` (`conditions-d-utilisation`, `politique-de-confidentialite`, `mentions-legales`), créées automatiquement au démarrage de l'API. Leur texte est versionné : chaque publication crée une version datée, et le site affiche toujours la version en vigueur (la plus récente dont la date de publication est passée).

**Preuve de l'acceptation.** À l'inscription, l'utilisateur coche la case des conditions d'utilisation ; l'API enregistre alors la date (`comptes.date_acceptation_conditions`). La version acceptée est celle qui était en vigueur à cette date. Pour que cette preuve tienne :

- **une version publiée n'est jamais modifiée ni supprimée** : une correction passe par une nouvelle version ;
- **une version n'est jamais publiée avec une date passée** (l'API le refuse), car elle changerait après coup ce que les utilisateurs ont accepté ;
- **une page légale n'est jamais supprimée** : la base l'empêche de toute façon tant qu'elle a des versions.

**Publier une page.** Un gérant du profil `@anicroche` dépose le texte dans un brouillon (`POST /anicroche/source`), puis le publie (`POST /anicroche/publication`), immédiatement ou à une date future. Le brouillon reste invisible jusqu'à sa publication.

**Avant le lancement.** En production, l'inscription est refusée (`503`) tant qu'aucune version des conditions d'utilisation n'est publiée : publier les trois pages avant d'ouvrir le service.

**Quand les conditions d'utilisation changent :**

1. publier la nouvelle version à une date future, pour laisser aux utilisateurs le temps d'en prendre connaissance (un mois est un délai courant) ;
2. les prévenir avant cette date, par exemple par courriel ;
3. pour un changement important, leur demander d'accepter à nouveau à leur prochaine connexion : un compte dont `date_acceptation_conditions` est antérieure à la publication en vigueur n'a pas accepté la nouvelle version. **À développer.**

La politique de confidentialité n'a pas à être « acceptée » : elle informe. L'étape d'inscription y renvoie par un lien, ce qui répond à l'obligation d'information au moment de la collecte (art. 13).
