// Règles fiscales ILYTEQ — novembre 2026. À valider avec le comptable.
// Modifier ce fichier suffit pour mettre à jour un taux ou un plafond.
const RULES = {
  version: "2026-11b",
  // Jours fériés belges (non facturés)
  holidays: ["2026-11-01","2026-11-11","2026-12-25","2027-01-01","2027-03-29","2027-05-01","2027-05-06","2027-05-17","2027-07-21","2027-08-15","2027-11-01","2027-11-11","2027-12-25"],
  isocRate: 0.20,          // ISOC taux PME
  exitTaxRate: 0.18,       // réserve de liquidation / VVPRbis (Arizona)
  dividendRate: 0.30,      // dividende classique
  employerCostFactor: 1.20,// brut dirigeant + cotisations sociales (approx.)
  vatRate: 0.21,
  kmRate: 0.43,            // indemnité kilométrique €/km (indexée au 1er juillet)
  mealVoucherMax: 8,       // chèque-repas à charge société / jour
  amortThreshold: 1000,    // HTVA, au-delà : amortissement probable
  weekendAlert: 150,       // achat le week-end à partir de ce montant TTC
  ratioOrange: 0.10,
  ratioRed: 0.15,
  evDeadline: "2026-12-31",
  forfaits: [
    { id: "bureau", label: "Indemnité de bureau (télétravail)", monthly: 160.99 },
    { id: "internet", label: "Internet privé", monthly: 20 },
    { id: "pc", label: "Ordinateur privé", monthly: 20 },
    { id: "ecran", label: "Écran privé", monthly: 5 },
    { id: "imprimante", label: "Imprimante / scanner privé", monthly: 5 },
  ],
  privateKeywords: ["frigo", "réfrigérateur", "machine à laver", "lave", "télé", "tv ", "playstation", "xbox", "console", "netflix", "spotify", "disney", "vacances", "hôtel plage", "courses", "delhaize", "carrefour", "lidl", "aldi", "vêtement", "zalando", "parfum", "bijou", "salon", "canapé", "cuisine", "amende", "pv ", "jouet"],
};

// deduct = part déductible ISOC ; vat = part de TVA récupérable
// needs = champs à contrôler ; type = "expense" | "income"
const CATEGORIES = [
  { id: "facture", type: "income", label: "Facture client", icon: "💼" },
  { id: "autre_rev", type: "income", label: "Autre revenu", icon: "➕" },

  { id: "it", type: "expense", label: "Matériel informatique", icon: "💻", deduct: 1, vat: 1, hint: "PC, écran, clavier, casque… 100 % déductible." },
  { id: "mobilier", type: "expense", label: "Mobilier de bureau", icon: "🪑", deduct: 1, vat: 1, hint: "Bureau, chaise, lampe — dans ton espace de travail." },
  { id: "logiciel", type: "expense", label: "Logiciels & abonnements pro", icon: "🧩", deduct: 1, vat: 1, hint: "IntelliJ, cloud, IA, domaine…" },
  { id: "telecom", type: "expense", label: "GSM / internet (facture ILYTEQ)", icon: "📱", deduct: 1, vat: 0.75, hint: "Si usage privé aussi : ATN à prévoir." },
  { id: "formation", type: "expense", label: "Formation", icon: "🎓", deduct: 1, vat: 1, hint: "Lié à ton métier de développeur." },
  { id: "transport", type: "expense", label: "Transport / partage auto", icon: "🚆", deduct: 1, vat: 1, hint: "Train, STIB, Dégage…" },
  { id: "parking", type: "expense", label: "Parking (4411…)", icon: "🅿️", deduct: 1, vat: 0.5, hint: "Facture mensuelle au nom d'ILYTEQ." },
  { id: "km", type: "expense", label: "Kilomètres (voiture privée)", icon: "🚗", deduct: 1, vat: 0, km: true, hint: "0,43 €/km. Motif + destination obligatoires. Pas le trajet domicile–Smals." },
  { id: "resto", type: "expense", label: "Restaurant d'affaires", icon: "🍽️", deduct: 0.69, vat: 0, hint: "69 % déductible. Nom du client obligatoire." },
  { id: "cadeau", type: "expense", label: "Cadeau d'affaires", icon: "🎁", deduct: 0.5, vat: 1, giftVat: true, hint: "50 % déductible. TVA seulement si < 50 € HTVA." },
  { id: "gestion", type: "expense", label: "Comptable / Liantis / banque", icon: "🏦", deduct: 1, vat: 1, hint: "Frais de gestion de la société." },
  { id: "assurance", type: "expense", label: "Assurances pro", icon: "🛡️", deduct: 1, vat: 0, hint: "RC Pro, hospitalisation via ILYTEQ…" },
  { id: "voiture", type: "expense", label: "Voiture électrique (leasing)", icon: "⚡", deduct: 1, vat: 0.5, hint: "100 % si commandée au plus tard le 31/12/2026." },
  { id: "logement", type: "expense", label: "Frais réels du logement (prorata)", icon: "🏠", deduct: 1, vat: 0, home: true, hint: "Incompatible avec le forfait bureau le même mois." },
  { id: "pension", type: "expense", label: "Pension complémentaire (EIP/PLCI)", icon: "🌱", deduct: 1, vat: 0, hint: "Plafond calculé par le comptable (règle des 80 %)." },
  { id: "salaire", type: "expense", label: "Salaire dirigeant versé (net)", icon: "👤", deduct: 0, vat: 0, salary: true, hint: "Le net viré sur ton compte privé (fiche Liantis). Sert au suivi de trésorerie, pas compté dans les frais." },
  { id: "divers", type: "expense", label: "Autre frais pro", icon: "📎", deduct: 1, vat: 1, hint: "Fournitures, poste…" },
  { id: "prive", type: "expense", label: "Dépense privée (non déductible)", icon: "⛔", deduct: 0, vat: 0, private: true, hint: "Ne passe jamais en société." },
];
