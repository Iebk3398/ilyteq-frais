# ILYTEQ Frais

App pour téléphone (PWA) qui suit les revenus et dépenses d'ILYTEQ SRL, signale ce qui attire le fisc et propose des optimisations.

- Gratuit, sans compte, fonctionne hors ligne.
- Les données restent **uniquement sur le téléphone** : ce dépôt ne contient que le code.
- Analyse détaillée : [ANALYSE.md](ANALYSE.md).

## Installer sur iPhone

1. Ouvre `https://<ton-utilisateur>.github.io/<nom-du-depot>/` dans **Safari**.
2. Bouton Partager → **Sur l'écran d'accueil**.

## Mettre en ligne (GitHub Pages)

1. Crée un dépôt **public** sur github.com/new (ex. `ilyteq-frais`), sans README.
2. Envoie ces fichiers dans le dépôt (glisser-déposer sur la page du dépôt, ou `git push`).
3. Settings → Pages → Source : **Deploy from a branch**, branche `main`, dossier `/ (root)` → Save.
4. Le lien apparaît après 1 à 2 minutes.

## Mettre à jour une règle fiscale

Tout est dans `rules.js` (taux ISOC, forfaits, €/km, catégories). Après une modification du code, change `VERSION` dans `sw.js` pour que les téléphones reçoivent la nouvelle version.

## Sauvegarde

Réglages → **Sauvegarde complète (.json)** régulièrement (dans Fichiers ou iCloud). **Export pour le comptable (.csv)** s'ouvre dans Excel.

Estimations, pas un conseil fiscal : à valider avec le comptable.
