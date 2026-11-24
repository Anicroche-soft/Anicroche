# RGPD — Registre et procédures d'Anicroche

Ce document rassemble ce que le RGPD demande en dehors du code : le registre des traitements, les sous-traitants, les durées de conservation, les mesures de sécurité et les procédures à suivre (demandes des utilisateurs, violation de données, sauvegardes, secrets).

Il doit être tenu à jour à chaque évolution des modèles `.sans` ou de l'hébergement. Les éléments marqués **À compléter** restent à définir.

Les textes publiés sur le site ont leur brouillon dans le même dossier : [`conditions-generales-d-utilisation.md`](conditions-generales-d-utilisation.md), [`politique-de-confidentialite.md`](politique-de-confidentialite.md) et [`mentions-legales.md`](mentions-legales.md). Une modification de ce registre qui concerne les utilisateurs doit y être reportée, puis publiée (§ 11).

Dernière mise à jour : 20 novembre 2026.

---

## 1. Responsable du traitement

| | |
|---|---|
| Responsable | Alexis Bonnet (éditeur d'Anicroche) |
| Statut | Particulier (éditeur non professionnel) |
| Adresse de contact RGPD | `royaume@anicroche.com`, boîte principale du Service Mail d'Infomaniak, aussi adresse de contact des mentions légales ; les courriels du service partent de son alias `heraut@anicroche.com` (`email_from`), dont les réponses arrivent dans la même boîte |
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
| Données | Adresses électroniques, cinq au plus, dont une principale (chiffrées AES-256-GCM + empreinte HMAC, avec leur date d'ajout) ; mot de passe (haché Argon2id) ; date d'inscription ; date d'acceptation des conditions d'utilisation (preuve de l'acceptation, voir § 11) ; annonces des nouvelles versions des pages soumises au préavis (page, version, moyen et date : preuve de l'information, voir § 11) ; date de dernière activité, avertissements d'inactivité envoyés, date de demande d'effacement (voir § 4) ; date du dernier changement d'adresse principale (voir § 4.1) ; codes de connexion et de confirmation (hachés, valables 15 min, voir § 9) |
| Destinataires | L'éditeur ; l'hébergeur ; le prestataire d'envoi de courriels (adresse et code) |
| Durée de conservation | Compte : jusqu'à son effacement (30 jours après la demande), ou 3 ans après la dernière activité (voir § 4). Codes : 15 min de validité, supprimés au plus tard le lendemain (`$nettoyer_clefs`) |

### 2.2. Sécurité des sessions et prévention des abus

| | |
|---|---|
| Finalité | Sécuriser les sessions, permettre à l'utilisateur de voir ses sessions ouvertes (`GET /moi`) et d'en fermer (`DELETE /session/<id>`, effet immédiat), limiter les abus (limitation des requêtes) |
| Base légale | Intérêt légitime (sécurité du service) — art. 6.1.f |
| Données | Adresse IP ; agent utilisateur (navigateur) ; nom de l'appareil (déduit de l'agent utilisateur à la connexion, par exemple « Firefox sur Linux ») ; dates d'émission, de validité et de révocation de la session ; jeton de session (haché) |
| Durée de conservation | Session : 30 jours au plus ; supprimée le lendemain de son expiration ou de sa révocation (`$nettoyer_sessions`). Compteurs de limitation : en mémoire uniquement, quelques minutes |

### 2.3. Profils

| | |
|---|---|
| Finalité | Permettre à l'utilisateur de créer et gérer des profils publics |
| Base légale | Exécution du contrat — art. 6.1.b |
| Données | Identifiant ; pseudonyme ; date de création ; comptes gérants ; anicroches dont le profil est l'auteur ; choix fait pour le profil lors d'une demande d'effacement ; anciens identifiants réservés (table `identifiants_reserves` : identifiant, date de fin, profil) |
| Visibilité | Identifiant et pseudonyme : publics. Le lien entre un profil et le compte qui le gère n'est pas public. Les identifiants réservés ne sont pas publiés : un identifiant réservé est seulement refusé comme déjà utilisé |
| Durée de conservation | Jusqu'à la suppression du profil. À l'effacement de son dernier gérant, le profil est supprimé, ou anonymisé si l'utilisateur ne l'a pas demandé ou si le compte est supprimé pour inactivité (voir § 4.1). Un ancien identifiant reste réservé 30 jours (voir § 4) |

**Réservation des identifiants** (intérêt légitime — art. 6.1.f : empêcher l'usurpation d'un profil, et permettre de défaire un renommage non voulu). Quand un profil change d'identifiant, l'ancien (et ceux de ses dérivés renommés avec lui) lui reste réservé 30 jours : lui seul peut le reprendre, ce qui supprime la réservation. Un profil a au plus 3 réservations actives : au-delà, il doit attendre la fin de la plus ancienne pour changer d'identifiant, pour qu'on ne puisse ni accaparer des noms ni faire expirer le vrai nom d'un profil à force de le renommer. Le courriel envoyé aux gérants indique la date de fin.

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
- en dessous de 15 ans, le site affiche une étape de refus, et l'API refuse aussi l'inscription (`403`), même si le site est contourné (`$calculer_age` et `$age_minimum` dans `comptes/age.sans`) ;
- l'âge est déclaratif : rien n'empêche une personne de saisir une autre date. C'est le niveau de vérification habituel aujourd'hui pour ce type de service ;
- la case des fonctionnalités liées à l'âge (b) n'existe pas encore : personne n'y a donc consenti, et aucune de ces fonctionnalités ne doit utiliser la date de naissance tant qu'elle n'est pas en place.

### 2.5. Stockage sur l'appareil de l'utilisateur

| Élément | Contenu | Finalité | Consentement |
|---|---|---|---|
| Cookie `jeton` (HttpOnly, Secure) | Identifiant et jeton de session | Rester connecté | Non requis (strictement nécessaire) |
| Cookie `avec-js` (1 an, `SameSite=Lax`) | La valeur `1`, sans donnée personnelle | Indiquer que JavaScript est actif : le serveur n'a alors pas à construire la page (rendu côté serveur réservé aux navigateurs sans JavaScript) | Non requis (strictement nécessaire) |
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
| Microsoft (Outlook) | Consultation de la boîte `royaume@anicroche.com` par l'éditeur : Outlook la synchronise en IMAP en passant par les serveurs de Microsoft | Messages écrits à l'éditeur (ou en réponse aux courriels du service) et ses réponses : adresse et nom de l'expéditeur, contenu, pièces jointes. Ni la base de données ni les courriels envoyés par l'API | Union européenne ou États-Unis selon le compte (transfert encadré par le *Data Privacy Framework*, auquel Microsoft adhère) | **À vérifier** (voir ci-dessous) |

L'article 28 du RGPD impose un contrat écrit avec chaque prestataire qui traite des données pour le compte d'Anicroche. Ce contrat engage le prestataire à n'utiliser les données que sur instruction, à les protéger, à aider en cas de violation, puis à les supprimer à la fin du contrat. Il n'y a pas à le négocier : les hébergeurs fournissent un modèle standard, souvent appelé « DPA » (*Data Processing Agreement*) ou « contrat de sous-traitance ».

Chez Infomaniak, ce contrat est intégré à leurs conditions générales ou proposé dans le Manager, selon l'offre. À faire une fois : retrouver ce document, vérifier qu'il couvre bien le Serveur Cloud, la base de données et le service de courriel, puis noter ici sa référence et la date. **À compléter.**

Chez Microsoft, le contrat de sous-traitance (*Data Protection Addendum*) n'accompagne que les offres professionnelles (Microsoft 365) : avec un compte Outlook personnel, Microsoft applique son contrat de services et sa déclaration de confidentialité grand public. À faire une fois : vérifier le type de compte utilisé et la localisation de ses données, puis noter ici le document qui s'applique. **À compléter.** Pour éviter ce sous-traitant, la boîte peut être consultée dans le webmail d'Infomaniak ou avec un client qui se connecte directement au serveur (Thunderbird, Outlook de bureau classique) : il faut alors retirer Microsoft de ce tableau et de la politique de confidentialité.

Avant d'ajouter un nouveau prestataire qui reçoit des données personnelles : vérifier sa localisation (UE ou pays adéquat), accepter son contrat de sous-traitance, puis l'ajouter à ce tableau et à la politique de confidentialité.

---

## 4. Durées de conservation

| Donnée | Durée | Mise en œuvre |
|---|---|---|
| Code de connexion | 15 min de validité, suppression quotidienne | `$nettoyer_clefs` (`comptes/authentification.sans`) |
| Session | 30 jours au plus, suppression quotidienne après expiration ou révocation | `$nettoyer_sessions` (`comptes/authentification.sans`) |
| Compte inactif | 3 ans après la dernière activité (requête authentifiée, notée au plus une fois par jour), avec au moins 30 jours de préavis : courriels 1 an, 6 mois, 3 mois, 1 mois, 2 semaines, 1 semaine et 1 jour avant | `$traiter_fins_de_comptes` (`effacement.sans`), voir § 4.1 |
| Compte dont l'effacement est demandé | Suspendu dès la demande, effacé 30 jours après (rappels 14, 7, 3 et 1 jours avant) ; disparition des sauvegardes au bout de leur durée de rotation | `$traiter_fins_de_comptes` (`effacement.sans`), voir § 4.1 |
| Versions publiées des pages légales | Sans limite : elles prouvent ce que chaque utilisateur a accepté | Voir § 11 |
| Annonces des nouvelles versions | Jusqu'à l'effacement du compte | Table `annonces`, effacée avec le compte (`effacement.sans`), voir § 11 |
| Identifiant réservé (ancien identifiant d'un profil renommé, ou d'un profil anonymisé ou supprimé) | 30 jours, suppression quotidienne après expiration | `$nettoyer_identifiants_reserves` (`profils/reservations.sans`), voir § 2.3 et § 4.1 |
| Sauvegardes | Celle d'Infomaniak (**À noter** : durée indiquée dans le Manager) | Voir § 7 |
| Journaux du serveur | **À compléter** | Voir § 2.6 |

### 4.1. Fin des comptes

**Effacement demandé** (page `/compte/suppression`, route `POST /desinscription`) :

- la demande exige à la fois le mot de passe et un code de type `effacement`, envoyé à l'adresse principale seulement après vérification du mot de passe : une session volée ou un mot de passe volé ne suffit pas ;
- dès la demande, toutes les sessions sont fermées et le compte est gelé (l'API ne lui ouvre plus que la consultation, la déconnexion et l'annulation) ; toutes les adresses du compte reçoivent un courriel avec un lien « Restauration du compte » ;
- pendant 30 jours, l'utilisateur peut annuler en se connectant ou avec ce lien, sans se connecter (`POST /restauration`, page `/compte/restauration#…`) ; des rappels sont envoyés 14, 7, 3 et 1 jours avant l'échéance ;
- ce délai reste dans le mois de l'art. 12.3. Il doit être annoncé dans la politique de confidentialité ;
- pendant les 7 jours qui suivent un changement d'adresse principale, la demande est refusée : quelqu'un qui aurait pris le mot de passe et l'accès à l'adresse principale ne peut pas faire effacer le compte aussitôt, et toutes les adresses du compte ont été prévenues du changement.

**Compte inactif** : avertissements par courriel (§ 4), chacun avec le lien « Restauration du compte », qui remet la date d'activité à zéro sans connexion. Le premier avertissement précède toujours la suppression d'au moins 30 jours. Ne sont jamais supprimés pour inactivité :

- les comptes gérants d'un profil `maitre` (liste `ROLES_PROTEGES` d'`effacement.sans`) : comptes d'administration du service ;
- les comptes dont `date_conservation` est dans le futur : champ renseigné à la main en cas de litige, de réquisition judiciaire, de somme due ou de solde restant (relation contractuelle en cours, art. 17.3.b et e). Le motif est noté dans le registre des demandes (§ 9).

**Ce qui est effacé** : le compte, ses coordonnées, ses sessions, ses codes et ses annonces. Pour un profil que le compte gérait avec d'autres, seul le lien de gérance disparaît. Pour un profil dont il était le seul gérant :

| Choix | Effet |
|---|---|
| Anonymisation (par défaut, et toujours après inactivité) | Le profil perd ses gérants, son identifiant et son pseudonyme ; il reste l'auteur de ses anicroches, qui restent visibles sans nom |
| Suppression (cochée à la demande d'effacement) | Le profil est supprimé et n'est plus l'auteur de ses anicroches ; une anicroche qui n'a plus d'auteur est vidée de ses sources et n'est plus visible (une page, qui n'a pas d'auteur, n'est jamais concernée) |

Un profil anonymisé n'est plus une donnée personnelle **à condition que ses publications ne permettent pas d'identifier leur auteur** : une personne qui le demande peut toujours obtenir le retrait d'une publication qui l'identifie (art. 17). Garder des publications après le départ de leur auteur suppose aussi une licence dans les conditions d'utilisation (non exclusive, gratuite, maintenue après la suppression du compte, publication sans nom), avec les règles ci-dessus annoncées clairement.

Les profils dérivés d'un profil racine anonymisé ou supprimé, gérés par d'autres comptes, en sont détachés : ils deviennent des profils racines sous un nom proche et libre (`base.x` devient `base-x`, ou `base-x-1`, `base-x-2`…), et leurs gérants en sont prévenus par courriel. Le nom du partant ne reste donc pas attaché à leurs profils.

L'identifiant d'un profil anonymisé ou supprimé reste réservé 30 jours, à aucun profil, comme ses propres réservations en cours (§ 2.3) : personne ne peut le prendre aussitôt pour se faire passer pour lui. Seule la chaîne de caractères est gardée, sans lien avec le profil ni avec le compte ; elle est supprimée à la fin de la réservation.

**Confirmation** : un dernier courriel confirme l'effacement. Le journal n'enregistre que le motif (`COMPTE effacé (demande)` ou `(inactivité)`), sans identifiant.

---

## 5. Mesures de sécurité (art. 32)

Ce qui est en place dans le code :

- mots de passe hachés en Argon2id (12 à 128 caractères), nombre de calculs simultanés plafonné ;
- adresses électroniques et date de naissance chiffrées en AES-256-GCM ; recherche par empreinte HMAC-SHA256 ;
- codes de connexion hachés, valables 15 min, 6 essais au plus, un nouveau code toutes les 30 s au plus ;
- jetons de session hachés en base, renouvelés à mi-vie ; cookie `HttpOnly`, `Secure`, `SameSite=None` en production ; jeton d'accès JWT de 15 min, lié à sa session : une session fermée ne permet plus aucune requête, même avec un jeton d'accès encore valable ;
- changements sensibles (adresses, mot de passe, effacement) confirmés par un code envoyé à l'adresse principale, et annoncés à toutes les adresses du compte ; un changement de mot de passe ferme les autres sessions ;
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
   | Accès / portabilité (art. 15 et 20) | L'utilisateur télécharge lui-même ses données en JSON depuis son compte (bouton « Exporter les données » de la page du compte, page `/compte/export`, route `POST /export` d'`export.sans`), y compris pendant l'effacement demandé : compte (dates, dont naissance, inscription, acceptation des conditions, dernière activité, avertissements, demande d'effacement, et coordonnées), sessions (révoquées comprises, tant qu'elles ne sont pas nettoyées), profils gérés, leurs identifiants réservés et leurs anicroches (versions, brouillons et sources). Pour un profil partagé, l'export contient toutes ses anicroches, y compris celles qu'un autre gérant a rédigées : l'auteur est le profil, pas le compte. Le mot de passe est demandé, chaque export est annoncé à toutes les adresses du compte, et la route est limitée à 5 requêtes par 10 min. Sont exclus les empreintes, les clefs, les identifiants internes et les autres gérants des profils partagés (seul le partage est indiqué). Une demande reçue par courriel : l'inviter à le faire en ligne ; si ce n'est pas possible, même extraction à la main |
   | Rectification (art. 16) | L'utilisateur corrige lui-même ses données depuis son compte (page « Modifier le compte », `/compte/edition`, et sessions ouvertes sur `/profil`), voir le tableau ci-dessous. Profils : identifiant et pseudonyme. Une demande reçue par courriel : l'inviter à le faire en ligne ; si ce n'est pas possible, modification manuelle par l'API (les champs `crypt` et `hash` doivent passer par sans.js, pas par du SQL direct) |
   | Effacement (art. 17) | L'utilisateur le demande lui-même depuis son compte (§ 4.1). Une demande reçue par courriel depuis l'adresse du compte : l'inviter à le faire en ligne, ou, si ce n'est pas possible, renseigner `date_demande_effacement` du compte (effacement au bout du délai). Retrait d'une publication anonymisée qui identifie son auteur : vider ses sources |
   | Opposition (art. 21) et retrait du consentement | Arrêter le traitement concerné (ex. décocher les fonctionnalités liées à l'âge) |
   | Limitation (art. 18) | Marquer le compte et suspendre le traitement contesté le temps de la vérification |

   Rectification du compte par l'utilisateur (routes automatiques ; chaque code est envoyé par `POST /clef` et ne sert qu'à l'usage de son type) :

   | Donnée | Route | Preuve demandée | Règles |
   |---|---|---|---|
   | Date de naissance | `PATCH /compte/<id>` | session | Un majeur reste majeur ; un mineur ne peut que rajeunir sa date, sans passer sous 15 ans |
   | Ajout d'une adresse | `POST /coordonnee` | session, mot de passe, code `ajout-courriel` envoyé à la nouvelle adresse | Cinq adresses au plus ; l'adresse ajoutée est secondaire |
   | Retrait d'une adresse | `DELETE /coordonnee/<id>` | session, mot de passe, code `suppression-courriel` envoyé à l'adresse principale | L'adresse principale ne peut pas être retirée |
   | Adresse principale | `PATCH /coordonnee/<id>` | session, mot de passe, code `modification-courriel-principal` envoyé à l'adresse principale actuelle | Effacement du compte refusé pendant 7 jours (§ 4.1) |
   | Mot de passe | `PATCH /compte/<id>` | session, code `modification-mot-de-passe` envoyé à l'adresse principale (sans l'ancien mot de passe, pour couvrir l'oubli) | Les autres sessions sont fermées |

   | Identifiant d'un profil | `PATCH /profil/<id>` | session d'un gérant, mot de passe | Un profil racine renommé renomme ses profils dérivés ; le nom d'affichage seul ne demande que la session |

   Chaque changement d'adresse ou de mot de passe est annoncé par courriel à toutes les adresses du compte, y compris celle qui vient d'être retirée. Chaque changement d'identifiant est annoncé à toutes les adresses de chaque gérant d'un profil renommé (dérivés compris), avec l'ancien et le nouvel identifiant. Une personne qui a perdu l'accès à son adresse principale ne peut pas encore la remplacer seule.

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

Les conditions d'utilisation, la politique de confidentialité et les mentions légales (brouillons dans ce dossier) sont des anicroches de type `page` (`conditions-generales-d-utilisation`, `politique-de-confidentialite`, `mentions-legales`), déclarées dans la liste `exceptions` du type `page` (`types_anicroches` dans `apicroche/adn/app.adn`), avec la spécificité `legalite`, et créées automatiquement au démarrage de l'API avec leur titre. Leur texte est versionné : chaque publication crée une version datée, et le site affiche à l'adresse `/<identifiant>` la version en vigueur (la plus récente dont la date de parution est passée) ; `/<identifiant>/<numero>` affiche une version précise, parue ou à venir ; sous le texte, l'historique liste la version à venir et toutes les versions parues qui ne sont pas privées, chacune avec son lien.

**Preuve de l'acceptation.** À l'inscription, l'utilisateur coche la case des conditions d'utilisation ; l'API enregistre alors la date (`comptes.date_acceptation_conditions`). La version acceptée est celle qui était en vigueur à cette date. Pour que cette preuve tienne :

- **une version parue n'est jamais modifiée ni supprimée** : une correction passe par une nouvelle version ; seul son accès peut changer ; une version parue ou programmée d'une page légale est toujours publique (l'API refuse un autre accès) ;
- **une version n'est jamais programmée à une date passée** (l'API le refuse), car elle changerait après coup ce que les utilisateurs ont accepté ;
- **une page légale n'est jamais supprimée** : la base l'empêche de toute façon tant qu'elle a des versions.

**Publier une page.** Le plus simple est la page d'édition du site, `/<identifiant>/edition` (par exemple `/conditions-generales-d-utilisation/edition`), réservée aux profils de rôle `maitre` : elle crée, enregistre, publie immédiatement, programme ou supprime un brouillon, annule une parution programmée et règle l'accès de la version. Elle s'appuie sur les routes automatiques de l'API :

1. `POST /version { id_anicroche }` ouvre un brouillon et renvoie son `numero` (une anicroche naît avec le brouillon de sa version 1 : cette étape ne sert qu'aux versions suivantes) ;
2. `POST /source { id_anicroche, role : contenu, position : 1, version, langue, region, contenu }` y dépose le texte (`PATCH /source/<id_anicroche>/contenu/1/<version>/<langue>/<region> { contenu }` le corrige tant que la version n'a pas de date de parution ; une langue ou une région vide s'écrit `-`) ;
3. `PATCH /version/<id_anicroche>/<numero> { date_parution }` publie le brouillon, immédiatement (`"now"`) ou à une date future ; `{ date_parution : null }` annule une parution programmée, qui redevient modifiable, sauf pour les pages soumises au préavis (spécificité `preavis` des exceptions de `types_anicroches` dans `apicroche/adn/app.adn` : les conditions d'utilisation et la politique de confidentialité), qui ne paraissent qu'immédiatement (correction mineure) ou au moins 30 jours plus tard (modification de fond), et dont la parution programmée ne peut être ni annulée ni déplacée (une erreur se corrige directement en base).

L'accès d'une version (`PATCH /version/<id_anicroche>/<numero> { acces }`) décide qui la voit : `prive` (seulement les gérants de la page : profils maîtres, et auteurs pour un type qui en a ; valeur d'un nouveau brouillon), `partage` (toute personne qui a le lien, sans que la page apparaisse dans les listes) ou `public`. Pendant un préavis, la version programmée est rendue publique : le site l'annonce alors sur la page (« Une nouvelle version entrera en vigueur le … ») et sur la version elle-même (« Cette nouvelle version entrera en vigueur le … »), avec un lien de l'une vers l'autre. Dans une nouvelle version, seules les sources qui changent sont à déposer : les autres restent celles des versions précédentes.

**Avant le lancement.** Tant qu'aucune version des conditions d'utilisation n'est publiée, seul le premier compte peut être créé (celui de l'éditeur, qui publiera les pages, case des conditions cochée) ; toute autre inscription est refusée (`503`) : publier les trois pages avant d'ouvrir le service. La date d'acceptation des conditions de ce premier compte précède la première version, qui n'est donc pas notée comme acceptée par lui : c'est sans conséquence, puisque l'éditeur l'a lui-même rédigée et publiée.

**Quand les conditions d'utilisation changent**, aucune nouvelle acceptation n'est demandée : une modification de fond est acceptée tacitement, après un préavis pendant lequel l'utilisateur peut supprimer son compte s'il la refuse.

- **Correction mineure** (faute, reformulation sans effet sur les droits et obligations) : nouvelle version publiée sans annonce.
- **Modification de fond** :
  1. programmer la nouvelle version à une date future, avec l'accès `public` : l'API exige au moins 30 jours de préavis après le dernier courriel d'annonce, soit 30 jours plus le temps d'envoi estimé (nombre de comptes à prévenir divisé par le quota journalier des annonces), et indique la date minimale ;
  2. pendant ce préavis, l'annonce part par courriel à tous les comptes, sauf ceux dont l'effacement est en cours (voir ci-dessous) : la tâche `$envoyer_annonces` (`preavis.sans`) envoie chaque heure un lot de courriels à l'adresse principale, un seul par compte si plusieurs pages changent, avec le lien vers chaque nouvelle version, sa date d'entrée en vigueur, et l'explication qu'en continuant à utiliser le service on l'accepte, le compte pouvant être supprimé d'ici là. Le quota journalier des annonces est la moitié de la limite de la messagerie, la variable `email_limit` du `.env` (Service Mail d'Infomaniak : 200 ou 500 courriels par 24 heures glissantes selon l'offre, 200 par défaut), l'autre moitié restant aux autres courriels du service ; il est réparti en lots horaires égaux, arrondis vers le bas, pour ne jamais être dépassé sur 24 heures glissantes. La page elle-même affiche aussi la version à venir ;
  3. à cette date, la nouvelle version s'applique à tous les comptes qui continuent d'utiliser le service.

**Preuve de l'annonce.** La preuve de l'acceptation d'une version postérieure à l'inscription tient à l'annonce : la table `annonces` enregistre, pour chaque compte, la page, la version, le moyen et la date. Une annonce n'est enregistrée qu'après l'envoi réussi du courriel, ce qui permet aussi de reprendre un envoi interrompu sans doublon. Les autres moyens sont :

- `inscription` : un compte créé pendant un préavis voit la version à venir à l'étape des conditions, et ne reçoit donc pas le courriel ;
- `restauration` : un compte dont l'effacement était en cours n'a pas reçu les annonces. S'il ne connaît pas la version en vigueur d'une page soumise au préavis (parue après sa dernière acceptation des conditions, et jamais annoncée) ou sa version programmée, ces versions lui sont présentées à sa restauration (`POST /restauration`, sur la page du compte ou par le lien du courriel). Seule la version en vigueur des pages qui ont la spécificité `acceptation` (les conditions générales d'utilisation) demande une case à cocher ; les versions à venir et celles de la politique de confidentialité, qui informe sans être acceptée, sont seulement présentées, avec leur lien. L'API reçoit la liste des versions présentées et cochées (`conditions_acceptees`) et refuse la restauration s'il en manque une : une version parue ou programmée après l'affichage n'est donc jamais acceptée ni notée comme annoncée sans avoir été présentée ; sa date d'acceptation des conditions passe alors à la date de restauration, et chaque version est notée comme annoncée.

Une version est donc connue d'un compte si elle a paru au plus tard à sa date d'acceptation des conditions, ou si elle lui a été annoncée. Les titres utilisés dans les courriels et à la restauration sont ceux des versions annoncées (source de titre de chaque page, sinon le titre donné par `app.adn` à sa création).

Une modification de la politique de confidentialité qui change l'usage des données s'annonce de la même façon. Un nouvel usage fondé sur le consentement demande un consentement distinct, jamais déduit de l'usage du service.

La politique de confidentialité n'a pas à être « acceptée » : elle informe. L'étape d'inscription y renvoie par un lien, ce qui répond à l'obligation d'information au moment de la collecte (art. 13).
