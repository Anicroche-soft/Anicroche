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

# La version du site (version.sh) est recalculée par ecosystem.config.cjs : --update-env
# la transmet aux applications déjà lancées
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "Déployé : $(git log -1 --format='%h %s') (version du site : $(sh ./version.sh))"
