# ILYTEQ Frais — Analyse business et technique

## 1. Le besoin

Ilyas gère ILYTEQ SRL (consultance IT, mission Smals à 485 € HTVA/jour, salaire dirigeant 2 500 €/mois brut).
Il veut, depuis son iPhone :

1. **Noter** chaque revenu (facture émise) et chaque dépense (facture reçue, ticket, km).
2. **Savoir s'il est dans les clous** face au fisc : un indicateur clair vert / orange / rouge, avec la raison de chaque alerte.
3. **Recevoir des optimisations** concrètes : ce qu'il n'utilise pas encore et combien ça lui rapporterait.
4. **Voir ce qui reste** : bénéfice, impôt des sociétés, TVA, et ce qu'il touchera en net.

Ce n'est pas un logiciel comptable : Sanger (Safisco) tient la vraie compta. L'app est un **tableau de bord personnel** et un **garde-fou**.

## 2. Règles métier intégrées (novembre 2026, à valider par le comptable)

| Catégorie | Déductible | TVA récupérable | Contrôle |
|---|---|---|---|
| Matériel informatique | 100 % (≥ 1 000 € HTVA : 1/3 par an, amorti sur 3 ans) | 100 % | – |
| Mobilier de bureau | 100 % | 100 % | doit être dans l'espace de travail |
| Logiciels, abonnements pro | 100 % | 100 % | – |
| GSM / internet (facture ILYTEQ) | 100 % | prorata | ATN si usage privé |
| Formation | 100 % | 100 % | lié au métier |
| Transport, parking, partage auto | 100 % | 100 % (50 % parking voiture) | facture ILYTEQ |
| Kilomètres (voiture privée) | 100 % | – | 0,43 €/km, relevé obligatoire, pas domicile–bureau fixe |
| Restaurant d'affaires | 69 % | 0 % | nom du client obligatoire |
| Cadeaux d'affaires | 50 % | si < 50 € HTVA | nom du bénéficiaire |
| Assurances, comptable, secrétariat social, banque | 100 % | selon facture | – |
| Voiture électrique (leasing) | 100 % si commandée ≤ 31/12/2026 | 50 % | ATN ≥ 1 690 €/an |
| Frais de bureau à domicile réels | prorata surface | prorata | **incompatible** avec le forfait bureau |
| Dépense privée | 0 % | 0 % | **ne passe jamais** |

Forfaits mensuels sans facture (versés au dirigeant) : bureau 160,99 €, internet 20 €, PC 20 €, écran / imprimante 5 € chacun.
Chèques-repas : 8 €/jour travaillé max à charge de la société.

### Indicateur de risque fisc (score sur 100)

| Signal | Points |
|---|---|
| Frais / CA > 15 % | +30 (10–15 % : +15) |
| Dépense sans facture au nom d'ILYTEQ | +5 chacune (max 25) |
| Catégorie privée enregistrée | +15 chacune (max 30) |
| Restaurant sans nom de client | +5 chacun (max 15) |
| Kilomètres sans motif / destination | +5 chacun (max 15) |
| Forfait bureau + frais réels du logement le même mois | +20 |
| Achat ≥ 150 € le week-end | +3 chacun (max 12) |
| Électroménager / mots-clés privés dans le libellé | +5 chacun (max 15) |
| Objet ≥ 1 000 € HTVA (à amortir) | info, 0 point |

0–19 : **vert**, 20–44 : **orange**, ≥ 45 : **rouge** (« tu joues avec le feu »).

### Projection

- Bénéfice = CA HTVA − coût salarial (brut × 1,2 approx. cotisations) − frais déductibles.
- ISOC 20 % (taux PME, 4 premières années).
- Sortie via réserve de liquidation / VVPRbis : ~18 % d'impôt total → net privé.
- TVA due ≈ TVA facturée − TVA récupérable.

## 3. Architecture technique

- **PWA** (Progressive Web App) en HTML/CSS/JavaScript, **sans framework ni build** : un dossier statique qu'on pousse sur GitHub Pages.
- **Hors ligne** : service worker qui met l'app en cache.
- **Données** : stockées **uniquement sur le téléphone** (IndexedDB), rien sur un serveur. Le dépôt public ne contient que le code.
- **Photos de justificatifs** : compressées (JPEG ~1 200 px) et stockées en local.
- **Sauvegarde** : export / import JSON complet (avec photos) + export CSV pour le comptable.
- **Installation iPhone** : Safari → Partager → « Sur l'écran d'accueil ».

```
ilyteq-frais/
├── index.html        écrans et navigation
├── styles.css        thème clair / sombre, mobile d'abord
├── rules.js          catégories, plafonds, règles fiscales (facile à mettre à jour)
├── app.js            stockage, calculs, alertes, optimisations, exports
├── sw.js             cache hors ligne
├── manifest.webmanifest
└── icons/            icônes de l'app
```

Mettre à jour un taux = modifier `rules.js` uniquement.

## 4. Limites

- Estimations, pas un conseil fiscal : les montants (forfaits, km, ISOC, VVPRbis) changent et sont indexés.
- Les données restent sur un seul téléphone : faire un export de sauvegarde régulièrement.
