#!/bin/bash
# Mise à jour du site sur un hébergement sans Docker : ./deployer.sh [--force]
set -eu

cd "$(dirname "$0")"

# En SSH non interactif, le Node installé par nvm n'est pas dans le PATH
if ! command -v npm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]
then
    set +u
    . "$HOME/.nvm/nvm.sh"
    set -u
fi

lire_env()
{
    [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1
}

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
    if [ ! -d "$dossier/node_modules" ] || [ "${1:-}" = "--force" ] \
    || [ -n "$(git diff --name-only "$avant" "$apres" -- "$dossier/package.json" "$dossier/package-lock.json")" ]
    then
        echo "Installation des dépendances de $dossier"
        if [ -f "$dossier/package-lock.json" ]
        then
            (cd "$dossier" && npm ci --omit=dev)
        else
            (cd "$dossier" && npm install --omit=dev)
        fi
    fi
done

# Le service worker sert les modèles depuis son cache tant que sa VERSION ne change pas
if [ -n "$(git diff --name-only "$avant" "$apres" -- anicroche/)" ] \
&& [ -z "$(git diff --name-only "$avant" "$apres" -- anicroche/avec.js/scripts/service-worker.js)" ]
then
    echo "/!\\ anicroche a changé mais pas la VERSION du service worker : les visiteurs garderont l'ancien cache"
fi

redemarrage=$(lire_env commande_redemarrage || true)
if [ -n "$redemarrage" ]
then
    echo "Redémarrage : $redemarrage"
    sh -c "$redemarrage"
else
    echo "Pensez à redémarrer anicroche et apicroche (commande_redemarrage absente de .env)"
fi

echo "Déployé : $(git log -1 --format='%h %s')"
