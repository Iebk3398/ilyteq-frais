// Questionnaire de démarrage freelance (SRL). À valider avec le comptable.
// level : "must" = obligatoire / sécurité, "opt" = optimisation, "plan" = à planifier
// gain : estimation €/an (null = pas chiffrable simplement)
// def : réponse pré-remplie selon ce qui est déjà en place (modifiable)
const CHECKLIST = [
  // --- Les bases ---
  { id: "bce", group: "Les bases", level: "must", q: "Ta SRL est créée et inscrite à la BCE ?", why: "Sans numéro d'entreprise, pas de facture ni de TVA.", def: "yes" },
  { id: "siege", group: "Les bases", level: "must", q: "L'adresse du siège à la BCE est la bonne partout (plan, contrat, factures) ?", why: "Vérifie qu'elle est identique dans le plan financier, les contrats et les factures. Une adresse fausse sur les factures peut bloquer la déduction de TVA.", def: null },
  { id: "tva", group: "Les bases", level: "must", q: "Ton numéro de TVA est actif ?", why: "Obligatoire pour facturer avec TVA et récupérer la TVA sur tes achats.", def: "yes" },
  { id: "banque", group: "Les bases", level: "must", q: "Tu as un compte bancaire pro séparé ?", why: "Ne jamais mélanger perso et société : c'est le premier réflexe du fisc en contrôle.", def: "yes" },
  { id: "caisse", group: "Les bases", level: "must", q: "Tu es affilié à une caisse d'assurances sociales ?", why: "Obligatoire comme dirigeant dans les 90 jours du début d'activité.", def: "yes" },
  { id: "mutuelle", group: "Les bases", level: "must", q: "Ta mutuelle sait que tu es devenu indépendant ?", why: "Sinon, risque de trou dans tes remboursements de soins et ton incapacité de travail.", def: null },
  { id: "comptable", group: "Les bases", level: "must", q: "Tu as un comptable qui tient la compta et les déclarations ?", why: "TVA, ISOC, comptes annuels, fiches 281 : trop de dates pour les gérer seul.", def: "yes" },
  { id: "peppol", group: "Les bases", level: "must", q: "Tu factures via Peppol (Billtobox, Billit…) ?", why: "Obligatoire en B2B en Belgique depuis 2026.", def: "yes" },
  { id: "rcpro", group: "Les bases", level: "must", q: "Ta RC Pro couvre au moins ce que le contrat exige (2,5 M€) ?", why: "Ton contrat n'a pas de plafond de responsabilité : sans assurance, c'est ton patrimoine qui paie.", def: "yes" },
  { id: "contrat", group: "Les bases", level: "must", q: "Le contrat-cadre et le bon de commande sont signés par les deux parties ?", why: "Sans signature, difficile de te faire payer ou de contester une fin de mission.", def: null },
  { id: "reprise", group: "Les bases", level: "must", q: "Les frais payés avant la création (notaire, comptable…) ont été repris par la société ?", why: "Il faut une décision de reprise des engagements pour les déduire. Demande au comptable.", def: null },

  // --- Argent qui sort sans impôt ---
  { id: "forfaitBureau", group: "Argent en poche sans impôt", level: "opt", q: "ILYTEQ te verse l'indemnité de bureau pour le télétravail ?", why: "Jusqu'à 160,99 €/mois, non imposée chez toi, déductible pour la société. Il faut un télétravail régulier.", gain: 160.99 * 12, def: null },
  { id: "forfaitNet", group: "Argent en poche sans impôt", level: "opt", q: "ILYTEQ te verse le forfait internet (20 €/mois) ?", why: "Ton internet privé sert au télétravail : forfait sans impôt.", gain: 240, def: null },
  { id: "forfaitPc", group: "Argent en poche sans impôt", level: "opt", q: "Si tu travailles sur ton PC ou écran privé : forfait PC/écran mis en place ?", why: "20 €/mois pour le PC, 5 € pour l'écran. Inutile si ILYTEQ t'achète le matériel.", gain: 300, def: null },
  { id: "cheques", group: "Argent en poche sans impôt", level: "opt", q: "Tu reçois des chèques-repas ?", why: "Jusqu'à 8 € par jour travaillé quasiment sans impôt. Doit être prévu proprement (décision de la société).", gain: 8 * 220, def: null },
  { id: "notesFrais", group: "Argent en poche sans impôt", level: "opt", q: "Tu te fais rembourser chaque mois ce que tu paies en perso pour ILYTEQ ?", why: "Un remboursement de frais n'est pas un salaire : 0 € d'impôt. Note de frais + virement KBC Pro.", gain: null, def: null },
  { id: "km", group: "Argent en poche sans impôt", level: "opt", q: "Tu notes tes km professionnels pour te les faire rembourser ?", why: "Environ 0,43 €/km sans impôt, avec un relevé (date, destination, motif). Pas le trajet domicile – bureau fixe.", gain: null, def: null },

  // --- Payer via la société plutôt qu'en privé ---
  { id: "materiel", group: "Payer via ILYTEQ", level: "opt", q: "Ton matériel de travail (PC, écrans, chaise…) est acheté par ILYTEQ ?", why: "Payé avec de l'argent avant impôt, TVA récupérée : environ deux fois moins cher qu'en privé.", gain: null, def: null },
  { id: "gsm", group: "Payer via ILYTEQ", level: "opt", q: "Ton GSM et ton abonnement sont au nom d'ILYTEQ ?", why: "Déductible et TVA récupérable. L'usage privé ne coûte qu'un petit avantage en nature (≈ 7 €/mois).", gain: 300, def: null },
  { id: "logiciels", group: "Payer via ILYTEQ", level: "opt", q: "Tes abonnements pro (IntelliJ, cloud, IA, formations) sont facturés à ILYTEQ ?", why: "100 % déductibles et TVA récupérable.", gain: null, def: "yes" },
  { id: "hospi", group: "Payer via ILYTEQ", level: "opt", q: "Ton assurance hospitalisation est payée par la société ?", why: "Déductible pour ILYTEQ, avantage peu taxé pour toi.", gain: null, def: null },
  { id: "voiture", group: "Payer via ILYTEQ", level: "plan", q: "Tu as tranché la question de la voiture électrique avant le 31/12/2026 ?", why: "Commandée avant cette date : 100 % déductible pendant tout le contrat. Seulement si tu en as vraiment besoin.", gain: null, def: null },

  // --- Préparer l'avenir ---
  { id: "pension", group: "Préparer l'avenir", level: "opt", q: "Tu as une pension complémentaire (PLCI ou EIP) ?", why: "Réduit l'impôt de la société et crée un capital taxé faiblement à la sortie. Le comptable calcule le maximum.", gain: null, def: null },
  { id: "liquidation", group: "Préparer l'avenir", level: "plan", q: "Ton comptable prévoit une réserve de liquidation chaque année ?", why: "Pour sortir l'argent après 3 ans à environ 18 % au lieu de 30 % en dividende.", gain: null, def: null },
  { id: "vvpr", group: "Préparer l'avenir", level: "plan", q: "Tu sais si ta SRL peut utiliser le régime VVPRbis ?", why: "Dividendes taxés plus bas après 3 ans, si les conditions d'apport de capital sont remplies. À vérifier avec le comptable.", gain: null, def: null },
  { id: "remun", group: "Préparer l'avenir", level: "plan", q: "Tu as prévu de passer à 50 000 € de rémunération quand ce sera exigé ?", why: "Après les 4 premières années, il faut ce minimum pour garder le taux ISOC réduit de 20 %.", gain: null, def: null },

  // --- Sécurité ---
  { id: "provisionSociale", group: "Ne pas se faire surprendre", level: "must", q: "Tu mets de côté pour la régularisation des cotisations sociales ?", why: "Les premières années, tu paies des cotisations provisoires. La régularisation arrive 2 à 3 ans plus tard et peut être salée.", gain: null, def: null },
  { id: "provisionTva", group: "Ne pas se faire surprendre", level: "must", q: "La TVA encaissée reste sur le compte jusqu'à la déclaration ?", why: "Ce n'est pas ton argent : 21 % de chaque facture sera reversé.", def: null },
  { id: "coussin", group: "Ne pas se faire surprendre", level: "must", q: "ILYTEQ garde un coussin d'au moins 6 mois de salaire ?", why: "Ta mission peut s'arrêter du jour au lendemain. Avec 6 mois d'avance, tu cherches tranquille.", def: null },
  { id: "versements", group: "Ne pas se faire surprendre", level: "plan", q: "Tu as parlé des versements anticipés d'ISOC avec ton comptable ?", why: "Une petite société est en principe dispensée de majoration ses 3 premiers exercices, mais en faire peut éviter un gros montant d'un coup.", def: null },
  { id: "sauvegarde", group: "Ne pas se faire surprendre", level: "opt", q: "Tu gardes tous tes justificatifs (photo + PDF) au même endroit ?", why: "En cas de contrôle, on peut te demander jusqu'à 7 ans de pièces. Utilise la photo dans l'app et sauvegarde régulièrement.", def: null },
];
