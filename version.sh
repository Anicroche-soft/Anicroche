#!/bin/sh
# Version du site : <grande version>.<année>.<mise à jour>, par exemple 3.26.14
# - grande version : version de config dans anicroche/adn/app.adn (son premier nombre)
# - année          : année du dernier commit qui touche anicroche/, moins 2000 (26, sans zéro initial)
# - mise à jour    : nombre de commits de cette année qui touchent anicroche/
# N'affiche rien hors d'un dépôt git : avec.js prend alors config.version telle quelle
cd "$(dirname "$0")" || exit 0

grande=$(grep -m1 -E '^[[:space:]]*version[[:space:]]*:' anicroche/adn/app.adn 2>/dev/null \
    | sed -E 's/^[[:space:]]*version[[:space:]]*:[[:space:]]*//; s/[[:space:]]*$//; s/^["'\'']//; s/["'\'']$//')
grande=${grande%%.*}

annee=$(git log -1 --format=%cd --date=format:%Y -- anicroche/ 2>/dev/null)
[ -n "$grande" ] && [ -n "$annee" ] || exit 0

mises_a_jour=$(git rev-list --count \
    --since="$annee-01-01 00:00:00" --until="$((annee + 1))-01-01 00:00:00" \
    HEAD -- anicroche/ 2>/dev/null)
[ -n "$mises_a_jour" ] || exit 0

echo "$grande.$((annee - 2000)).$mises_a_jour"
