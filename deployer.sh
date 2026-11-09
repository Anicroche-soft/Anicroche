#!/bin/bash
# Mise à jour du site sur un hébergement sans Docker : ./deployer.sh [--force]
set -eu

cd "$(dirname "$0")"

# Le Node du système peut être trop ancien, et nvm n'est pas chargé en SSH non interactif
if [ -s "$HOME/.nvm/nvm.sh" ]
then
    set +u
    . "$HOME/.nvm/nvm.sh"
    set -u
fi

avant=$(git rev-parse HEAD)
git pull --ff-only
apres=$(git rev-parse HEAD)

if [ "$avant" = "$apres" ] && [ "${1:-}" != "--force" ]
then
    echo "Déjà à jour ($(git log -1 --format='%h %s'))"
    exit 0
fi

for dossier in apicroche anicroche
do
    [ -f "$dossier/package-lock.json" ] || continue
    if [ ! -d "$dossier/node_modules" ] || [ "${1:-}" = "--force" ] \
    || [ -n "$(git diff --name-only "$avant" "$apres" -- "$dossier/package.json" "$dossier/package-lock.json")" ]
    then
        echo "Installation des dépendances de $dossier"
        (cd "$dossier" && npm ci --omit=dev)
    fi
done

# Le service worker sert les modèles depuis son cache tant que sa VERSION ne change pas
if [ -n "$(git diff --name-only "$avant" "$apres" -- anicroche/)" ] \
&& [ -z "$(git diff --name-only "$avant" "$apres" -- anicroche/avec.js/scripts/service-worker.js)" ]
then
    echo "/!\\ anicroche a changé mais pas la VERSION du service worker : les visiteurs garderont l'ancien cache"
fi

pm2 startOrReload ecosystem.config.cjs
pm2 save

echo "Déployé : $(git log -1 --format='%h %s')"
