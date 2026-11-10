"use strict";
/* ILYTEQ Frais — PWA locale. Données uniquement sur l'appareil (IndexedDB). */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const eur = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 });
const pct = (n) => (isFinite(n) ? (n * 100).toLocaleString("fr-BE", { maximumFractionDigits: 1 }) + " %" : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => String(d).slice(0, 7);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Plan financier du comptable (année 1) + démarrage de la facturation le 26/10/2026
const DEFAULT_PLAN = { ca: 128040, salary: 36000, frais: 7140, benefit: 84702, isoc: 16940, rest: 67761, days: 264 };
const DEFAULT_SETTINGS = { tjm: 485, days: 220, salary: 2500, start: "2026-10-26", capital: 2000, plan: DEFAULT_PLAN };
// Catégories déjà couvertes par les frais fixes du plan (comptable, Liantis, assurance, GSM)
const PLAN_FIXED = ["gestion", "assurance", "telecom"];

/* ---------- Stockage ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("ilyteq-frais", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all: (store) => DB.tx(store, "readonly", (s) => s.getAll()),
  put: (store, v) => DB.tx(store, "readwrite", (s) => s.put(v)),
  del: (store, k) => DB.tx(store, "readwrite", (s) => s.delete(k)),
  clear: (store) => DB.tx(store, "readwrite", (s) => s.clear()),
};

const state = { checklist: null, qIndex: 0, entries: [], settings: { ...DEFAULT_SETTINGS }, months: {}, type: "expense", editId: null, photo: null, listFilter: "all" };

async function load() {
  await DB.open();
  state.entries = await DB.all("entries");
  const meta = Object.fromEntries((await DB.all("meta")).map((m) => [m.key, m.value]));
  state.settings = { ...DEFAULT_SETTINGS, ...(meta.settings || {}) };
  state.settings.plan = { ...DEFAULT_PLAN, ...(state.settings.plan || {}) };
  if (state.settings.start === "2026-10-15") state.settings.start = "2026-10-26";
  state.months = meta.months || {};
  state.checklist = meta.checklist || null;
  try { const p = localStorage.getItem("period"); if (p) $("#period").value = p; } catch (e) {}
}
const saveMeta = () => Promise.all([DB.put("meta", { key: "settings", value: state.settings }), DB.put("meta", { key: "months", value: state.months })]);

/* ---------- Calculs ---------- */
function compute(e) {
  const c = CAT[e.cat] || CAT.divers;
  let ht, vat, ttc;
  if (c.km) { ht = (+e.km || 0) * RULES.kmRate; vat = 0; ttc = ht; }
  else { ttc = +e.ttc || 0; const r = +e.vatRate || 0; ht = ttc / (1 + r); vat = ttc - ht; }
  if (e.type === "income") return { ht, vat, ttc, deductible: 0, vatRec: 0, vatDue: vat };
  if (c.salary) return { ht: ttc, vat: 0, ttc, deductible: 0, vatRec: 0, vatDue: 0, salary: true };
  let vatShare = c.vat || 0;
  if (c.giftVat && ht >= 50) vatShare = 0;
  if (!e.invoice && !c.km) vatShare = 0;           // pas de facture ILYTEQ = pas de TVA récupérable
  const amort = isAmort(e, ht);
  // Un gros investissement est amorti sur 3 ans : on compte 1/3 par an (l'annuité).
  return { ht, vat, ttc, amort, deductible: ht * (c.deduct ?? 1) / (amort ? 3 : 1), vatRec: vat * vatShare, vatDue: 0 };
}
const isAmort = (e, ht) => e.type === "expense" && ["it", "mobilier", "divers"].includes(e.cat) && ht >= RULES.amortThreshold;

function inPeriod(d) {
  const p = $("#period").value, now = new Date();
  if (p === "all") return true;
  if (p === "year") return d.slice(0, 4) === String(now.getFullYear());
  if (p === "month") return monthKey(d) === today().slice(0, 7);
  if (p === "12m") { const from = new Date(now); from.setFullYear(now.getFullYear() - 1); return d >= from.toISOString().slice(0, 10); }
  return true;
}
function periodLabel() {
  return { all: "Depuis le début", year: "Année " + new Date().getFullYear(), month: new Date().toLocaleDateString("fr-BE", { month: "long", year: "numeric" }), "12m": "12 derniers mois" }[$("#period").value];
}

function monthPerks(m) {
  const mo = state.months[m] || {};
  const forf = (mo.forfaits || []).reduce((s, id) => s + (RULES.forfaits.find((f) => f.id === id)?.monthly || 0), 0);
  const mealNet = mo.meal ? RULES.mealVoucherMax * (+mo.workDays || 0) : 0;
  return { forf, mealNet, mealDeduct: mo.meal ? 2 * (+mo.workDays || 0) : 0 };
}

function totals(entries) {
  const t = { ca: 0, inTTC: 0, outTTC: 0, salPaid: 0, vatDue: 0, vatRec: 0, frais: 0, fraisHT: 0, perks: 0, mealCost: 0, byCat: {} };
  for (const e of entries) {
    const v = compute(e);
    if (e.type === "income") { t.ca += v.ht; t.vatDue += v.vatDue; t.inTTC += v.ttc; continue; }
    if (v.salary) { t.salPaid += v.ttc; continue; }
    t.outTTC += v.ttc;
    t.fraisHT += v.ht; t.frais += v.deductible; t.vatRec += v.vatRec;
    t.byCat[e.cat] = (t.byCat[e.cat] || 0) + v.ht;
  }
  const months = Object.keys(state.months).filter((m) => inPeriod(m + "-01"));
  for (const m of months) { const p = monthPerks(m); t.perks += p.forf + p.mealNet; t.mealCost += RULES.mealVoucherMax * (+state.months[m].workDays || 0) * (state.months[m].meal ? 1 : 0); t.frais += p.forf + p.mealDeduct; }
  if (t.perks) t.byCat.__perks = t.perks;
  return t;
}

/* ---------- Contrôles fiscaux ---------- */
const PRIV_RE = new RegExp(RULES.privateKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
function entryFlags(e) {
  if (e.type === "income" || CAT[e.cat]?.salary) return [];
  const c = CAT[e.cat] || {}, v = compute(e), f = [];
  const day = new Date(e.date + "T12:00").getDay();
  if (c.private) f.push({ k: "private", lvl: "bad", t: "Dépense privée" });
  if (!c.km && !e.invoice && !c.private) f.push({ k: "noInvoice", lvl: "warn", t: "Pas de facture ILYTEQ" });
  if ((e.cat === "resto" || e.cat === "cadeau") && !(e.client || "").trim()) f.push({ k: "noClient", lvl: "warn", t: "Client manquant" });
  if (c.km && (!(e.dest || "").trim() || !(e.purpose || "").trim())) f.push({ k: "kmInfo", lvl: "warn", t: "Trajet incomplet" });
  if (!c.private && PRIV_RE.test(" " + (e.label || "") + " ")) f.push({ k: "privKw", lvl: "warn", t: "Libellé qui sonne privé" });
  if (!c.km && (day === 0 || day === 6) && v.ttc >= RULES.weekendAlert) f.push({ k: "weekend", lvl: "warn", t: "Gros achat le week-end" });
  if (v.amort) f.push({ k: "amort", lvl: "info", t: "Amorti sur 3 ans" });
  if (!c.km && !e.photo) f.push({ k: "noPhoto", lvl: "info", t: "Sans photo" });
  if (e.personal && !e.reimbursed) f.push({ k: "toRefund", lvl: "info", t: "À te rembourser" });
  return f;
}

function riskAnalysis(entries, t) {
  const alerts = []; let score = 0;
  const count = (k) => entries.filter((e) => entryFlags(e).some((f) => f.k === k));
  const ratio = t.ca > 0 ? t.frais / t.ca : null;
  if (ratio !== null) {
    if (ratio > RULES.ratioRed) { score += 30; alerts.push({ lvl: "bad", t: `Frais à ${pct(ratio)} du chiffre d'affaires`, d: `Au-delà de 15 %, le fisc regarde de près. Avec ton CA, 15 % = ${eur(t.ca * RULES.ratioRed)}. Garde tous tes justificatifs.` }); }
    else if (ratio > RULES.ratioOrange) { score += 15; alerts.push({ lvl: "warn", t: `Frais à ${pct(ratio)} du chiffre d'affaires`, d: "Zone orange : normal si chaque frais est justifié, mais n'en rajoute pas sans raison." }); }
  } else if (t.frais > 0) alerts.push({ lvl: "info", t: "Pas encore de revenu enregistré", d: "Ajoute tes factures clients pour que le ratio frais / CA soit calculé." });

  const priv = count("private");
  if (priv.length) { score += Math.min(30, 15 * priv.length); alerts.push({ lvl: "bad", t: `${priv.length} dépense(s) privée(s)`, d: `Total ${eur(sumHT(priv))}. Ça ne doit jamais être payé par ILYTEQ. Rembourse la société ou passe-le en compte courant dirigeant.` }); }
  const noInv = count("noInvoice");
  if (noInv.length) { score += Math.min(25, 5 * noInv.length); alerts.push({ lvl: "warn", t: `${noInv.length} dépense(s) sans facture au nom d'ILYTEQ`, d: "Demande une facture avec « ILYTEQ SRL – BE1044.101.763 ». Sans ça, TVA perdue et frais contestable." }); }
  const noCli = count("noClient");
  if (noCli.length) { score += Math.min(15, 5 * noCli.length); alerts.push({ lvl: "warn", t: `${noCli.length} restaurant(s) ou cadeau(x) sans nom`, d: "Note avec qui et pourquoi. Sans ça, le fisc le considère comme privé." }); }
  const km = count("kmInfo");
  if (km.length) { score += Math.min(15, 5 * km.length); alerts.push({ lvl: "warn", t: `${km.length} trajet(s) sans destination ou motif`, d: "Un relevé de km sans détail est rejeté en contrôle." }); }
  const kw = count("privKw");
  if (kw.length) { score += Math.min(15, 5 * kw.length); alerts.push({ lvl: "warn", t: `${kw.length} libellé(s) qui sonnent privés`, d: kw.slice(0, 3).map((e) => "« " + esc(e.label) + " »").join(", ") + ". Si c'est vraiment pro, précise le motif." }); }
  const we = count("weekend");
  if (we.length) { score += Math.min(12, 3 * we.length); alerts.push({ lvl: "warn", t: `${we.length} gros achat(s) le week-end`, d: "Pas interdit, mais typique d'un achat privé. Ajoute le motif." }); }
  // forfait bureau + frais réels du logement le même mois
  const homeMonths = new Set(entries.filter((e) => e.cat === "logement").map((e) => monthKey(e.date)));
  const clash = [...homeMonths].filter((m) => (state.months[m]?.forfaits || []).includes("bureau"));
  if (clash.length) { score += 20; alerts.push({ lvl: "bad", t: "Forfait bureau + frais réels du logement", d: `Mois concerné(s) : ${clash.join(", ")}. C'est l'un ou l'autre, pas les deux.` }); }
  const am = count("amort");
  if (am.length) alerts.push({ lvl: "info", t: `${am.length} achat(s) de plus de 1 000 € HTVA`, d: "Compté ici 1/3 par an (amortissement sur 3 ans). Le comptable choisira la durée exacte. Rien d'anormal." });
  const ph = count("noPhoto");
  if (ph.length) alerts.push({ lvl: "info", t: `${ph.length} dépense(s) sans photo du justificatif`, d: "Pas obligatoire ici, mais pratique en cas de contrôle." });

  score = Math.min(100, score);
  const level = score >= 45 ? "bad" : score >= 20 ? "warn" : "ok";
  if (!alerts.some((a) => a.lvl !== "info")) alerts.unshift({ lvl: "ok", t: "Rien d'inquiétant", d: "Tes dépenses sont cohérentes avec une activité de consultance IT." });
  return { score, level, alerts, ratio };
}
const sumHT = (arr) => arr.reduce((s, e) => s + compute(e).ht, 0);

/* ---------- Optimisations ---------- */
function optimisations(entries, t) {
  const s = state.settings, out = [], m = today().slice(0, 7), mo = state.months[m] || {};
  const active = new Set(mo.forfaits || []);
  const hasIT = entries.some((e) => e.cat === "it");
  // si ILYTEQ a payé le matériel, pas de forfait pour un PC/écran privé
  const missing = RULES.forfaits.filter((f) => !active.has(f.id) && !(hasIT && (f.id === "pc" || f.id === "ecran")));
  if (missing.length) {
    const g = missing.reduce((x, f) => x + f.monthly, 0) * 12;
    out.push({ t: "Forfaits télétravail pas encore activés", d: missing.map((f) => `${f.label} (${eur(f.monthly)}/mois)`).join(", ") + ". À mettre en place via Liantis : versé sans impôt, déductible pour ILYTEQ.", gain: g, note: entries.some((e) => e.cat === "logement") ? "Attention : le forfait bureau exclut les frais réels du logement." : "" });
  }
  if (!mo.meal) out.push({ t: "Chèques-repas", d: `Jusqu'à ${eur(RULES.mealVoucherMax)} par jour travaillé, quasiment sans impôt. Demande à Sanger de les mettre en place.`, gain: RULES.mealVoucherMax * s.days });
  const refund = entries.filter((e) => e.personal && !e.reimbursed);
  if (refund.length) out.push({ t: "Dépenses à te faire rembourser", d: `${refund.length} dépense(s) payée(s) avec ton compte perso. Fais-toi rembourser par virement KBC Pro : c'est de l'argent qui sort sans impôt.`, gain: refund.reduce((x, e) => x + compute(e).ttc, 0), once: true });
  const lostVat = entries.filter((e) => e.type === "expense" && !CAT[e.cat]?.private && !CAT[e.cat]?.km && !e.invoice).reduce((x, e) => x + compute(e).vat * (CAT[e.cat]?.vat || 0), 0);
  if (lostVat > 1) out.push({ t: "TVA perdue faute de facture ILYTEQ", d: "Redemande ces factures au nom de la société pour récupérer la TVA.", gain: lostVat, once: true });
  const days = Math.ceil((new Date(RULES.evDeadline) - new Date(today())) / 864e5);
  if (days >= 0 && !entries.some((e) => e.cat === "voiture")) out.push({ t: `Voiture électrique : encore ${days} jour(s) pour 100 % de déduction`, d: "Seulement si tu aurais acheté une voiture de toute façon : via ILYTEQ elle te coûte environ deux fois moins qu'en privé. Sinon, ne rien prendre reste le moins cher." });
  if (!entries.some((e) => e.cat === "pension")) out.push({ t: "Pension complémentaire (EIP / PLCI)", d: "Réduit l'impôt de la société et te constitue un capital peu taxé. Demande au comptable le montant maximum." });
  const ratio = t.ca > 0 ? t.frais / t.ca : null;
  if (ratio !== null && ratio < 0.05 && t.ca > 0) out.push({ t: `Tu as de la marge : frais à ${pct(ratio)} du CA`, d: `Jusqu'à 10 % reste tout à fait normal, soit encore ${eur(t.ca * 0.1 - t.frais)} de vrais besoins pro (matériel, formation…).` });
  out.push({ t: "Sortir l'argent : réserve de liquidation plutôt que dividende", d: `Après 3 ans, ~18 % d'impôt au lieu de 30 %. Sur ce qui reste dans ILYTEQ, ça fait environ ${pct(RULES.dividendRate - RULES.exitTaxRate)} de plus pour toi.` });
  return out;
}

/* ---------- Rendu ---------- */
function filtered() { return state.entries.filter((e) => inPeriod(e.date)); }

function renderHome() {
  const ents = filtered(), t = totals(ents), r = riskAnalysis(ents, t), s = state.settings;
  $("#periodLabel").textContent = periodLabel();
  const card = $("#riskCard"); card.className = "risk card " + r.level;
  $("#riskTitle").textContent = { ok: "Tu es dans les clous", warn: "À surveiller", bad: "Tu joues avec le feu" }[r.level];
  $("#riskScore").textContent = r.score;
  const g = $("#gauge"); g.style.setProperty("--p", Math.max(r.score, 2)); g.style.setProperty("--gc", `var(--${r.level})`);
  const main = r.alerts.filter((a) => a.lvl === "bad" || a.lvl === "warn");
  $("#riskText").textContent = main.length ? main.slice(0, 2).map((a) => a.t).join(" · ") : "Aucun point bloquant sur la période.";

  $("#kCA").textContent = eur(t.ca);
  $("#kFrais").textContent = eur(t.frais);
  $("#kRatio").textContent = r.ratio !== null ? pct(r.ratio) + " du CA" : "";
  const sal = monthsIn(ents) * s.salary * RULES.employerCostFactor;
  const benef = t.ca - sal - t.frais, isoc = Math.max(0, benef) * RULES.isocRate;
  $("#kBenef").textContent = eur(benef - isoc);
  $("#kIsoc").textContent = `ISOC ${eur(isoc)} · salaire ${eur(sal)}`;
  $("#kTva").textContent = eur(t.vatDue - t.vatRec);
  $("#kTvaRec").textContent = `${eur(t.vatRec)} récupérable`;

  const rp = r.ratio || 0, w = Math.min(100, (rp / RULES.ratioRed) * 100);
  $("#ratioPct").textContent = r.ratio !== null ? pct(rp) : "—";
  const bf = $("#ratioBar"); bf.style.width = w + "%"; bf.style.background = `var(--${rp > RULES.ratioRed ? "bad" : rp > RULES.ratioOrange ? "warn" : "ok"})`;

  // projection 12 mois
  const ca12 = s.tjm * s.days, sal12 = s.salary * 12 * RULES.employerCostFactor;
  const months = Math.max(1, monthsSince(s.start));
  const expE = state.entries.filter((e) => e.type === "expense" && !PLAN_FIXED.includes(e.cat) && !CAT[e.cat]?.salary);
  const exp = expE.map(compute);
  // frais fixes du plan + autres frais extrapolés + annuités d'amortissement (sans les extrapoler)
  const frais12 = s.plan.frais + exp.filter((v) => !v.amort).reduce((x, v) => x + v.deductible, 0) / months * 12 + exp.filter((v) => v.amort).reduce((x, v) => x + v.deductible, 0);
  const cur = monthPerks(today().slice(0, 7)), mo = state.months[today().slice(0, 7)] || {};
  const perks12 = cur.forf * 12 + (mo.meal ? RULES.mealVoucherMax * s.days : 0);
  const perksCost12 = cur.forf * 12 + (mo.meal ? 2 * s.days : 0);
  const b12 = ca12 - sal12 - frais12 - perksCost12, isoc12 = Math.max(0, b12) * RULES.isocRate, rest12 = b12 - isoc12;
  $("#projHint").textContent = `${s.days} jours × ${eur(s.tjm)}, salaire ${eur(s.salary)} brut/mois, frais fixes du plan (${eur(s.plan.frais)}) + tes autres frais au rythme actuel.`;
  renderPlan({ ca12, sal12, frais12: frais12 + perksCost12, isoc12, rest12 });
  renderCash();
  $("#pCA").textContent = eur(ca12); $("#pSal").textContent = "− " + eur(sal12); $("#pFrais").textContent = "− " + eur(frais12 + perksCost12);
  $("#pIsoc").textContent = "− " + eur(isoc12); $("#pRest").textContent = eur(rest12);
  $("#pExit").textContent = eur(Math.max(0, rest12) * (1 - RULES.exitTaxRate)); $("#pPerks").textContent = eur(perks12);

  const rows = Object.entries(t.byCat).sort((a, b) => b[1] - a[1]);
  $("#byCat").innerHTML = rows.length ? rows.map(([k, v]) => `<div class="r"><span>${k === "__perks" ? "🏡 Forfaits & chèques-repas" : esc(CAT[k].icon + " " + CAT[k].label)}</span><strong>${eur(v)}</strong></div>`).join("") : `<p class="muted small">Aucune dépense sur la période. Appuie sur ＋ pour commencer.</p>`;
}
function renderPlan(pr) {
  const s = state.settings, P = s.plan;
  const row = (l, a, b, neg) => `<tr><td>${l}</td><td>${(neg ? "− " : "") + eur(a)}</td><td>${(neg ? "− " : "") + eur(b)}</td></tr>`;
  $("#planTable").innerHTML = `<tr class="head"><td></td><td>Comptable</td><td>Ma projection</td></tr>` +
    `<tr><td>Jours facturés</td><td>${P.days}</td><td>${s.days}</td></tr>` +
    row("CA HTVA", P.ca, pr.ca12) + row("Salaire + cotisations", P.salary, pr.sal12, 1) + row("Frais", P.frais, pr.frais12, 1) +
    row("Impôt des sociétés", P.isoc, pr.isoc12, 1) + `<tr class="strong"><td>Reste dans ILYTEQ</td><td>${eur(P.rest)}</td><td>${eur(pr.rest12)}</td></tr>`;
  const diff = pr.rest12 - P.rest;
  $("#planDiff").innerHTML = `Écart avec le plan : <strong class="${diff < 0 ? "neg" : "pos"}">${diff >= 0 ? "+" : "−"} ${eur(Math.abs(diff))}</strong>` + (s.days < P.days ? ` · le plan compte ${P.days} jours, sans congés ni jours fériés.` : "");
  // à date depuis le démarrage
  const wd = workDays(s.start, today()), expected = wd * s.tjm;
  const invoiced = state.entries.filter((e) => e.type === "income").reduce((x, e) => x + compute(e).ht, 0);
  const planToDate = P.ca / 12 * monthsSince(s.start);
  $("#toDate").innerHTML = `<tr><td>Jours ouvrables depuis le ${new Date(s.start + "T12:00").toLocaleDateString("fr-BE")}</td><td>${wd}</td></tr>
    <tr><td>CA prestable (${wd} × ${eur(s.tjm)})</td><td>${eur(expected)}</td></tr>
    <tr><td>CA du plan à date</td><td>${eur(planToDate)}</td></tr>
    <tr class="strong"><td>Déjà facturé (HTVA)</td><td>${eur(invoiced)}</td></tr>
    <tr><td>Reste à facturer</td><td>${eur(Math.max(0, expected - invoiced))}</td></tr>`;
}
function renderCash() {
  const s = state.settings, t = totals(state.entries);
  const perks = Object.keys(state.months).filter((m) => m <= today().slice(0, 7)).reduce((x, m) => { const p = monthPerks(m); return x + p.forf + (state.months[m].meal ? (RULES.mealVoucherMax) * (+state.months[m].workDays || 0) : 0); }, 0);
  const bank = (+s.capital || 0) + t.inTTC - t.outTTC - t.salPaid - perks, vat = t.vatDue - t.vatRec;
  const sals = state.entries.filter((e) => CAT[e.cat]?.salary).length;
  $("#cash").innerHTML = `<tr><td>Capital de départ</td><td>${eur(+s.capital || 0)}</td></tr>
    <tr><td>+ Factures encodées (TTC)</td><td>${eur(t.inTTC)}</td></tr>
    <tr><td>− Dépenses (TTC)</td><td>− ${eur(t.outTTC)}</td></tr>
    <tr><td>− Salaires nets versés (${sals})</td><td>− ${eur(t.salPaid)}</td></tr>
    ${perks ? `<tr><td>− Forfaits & chèques-repas</td><td>− ${eur(perks)}</td></tr>` : ""}
    <tr class="strong"><td>Banque estimée</td><td>${eur(bank)}</td></tr>
    <tr><td>dont TVA à reverser</td><td>− ${eur(Math.max(0, vat))}</td></tr>
    <tr class="strong"><td>Vraiment disponible</td><td>${eur(bank - Math.max(0, vat))}</td></tr>`;
  $("#cashHint").textContent = sals ? "" : "Encode ton premier salaire (catégorie « Salaire dirigeant versé ») pour que la banque soit juste.";
}
function monthIsoDays(m) { const [y, mo] = m.split("-").map(Number); const last = new Date(y, mo, 0).getDate(); return workDays(m + "-01", m + "-" + String(last).padStart(2, "0")); }
function monthsIn(ents) {
  const p = $("#period").value;
  if (p === "month") return 1;
  if (p === "12m") return Math.min(12, monthsSince(state.settings.start));
  if (p === "year") { const y = new Date().getFullYear(), jan = y + "-01-01"; return monthsSince(state.settings.start > jan ? state.settings.start : jan); }
  return monthsSince(state.settings.start);
}
function monthsSince(d) { return Math.max(0.5, (new Date(today()) - new Date(d)) / 864e5 / 30.44); }
// jours ouvrables (hors week-ends et jours fériés) entre deux dates incluses
function workDays(from, to) {
  let n = 0; const d = new Date(from + "T12:00"), end = new Date(to + "T12:00");
  while (d <= end) { const w = d.getDay(), k = d.toISOString().slice(0, 10); if (w && w !== 6 && !RULES.holidays.includes(k)) n++; d.setDate(d.getDate() + 1); }
  return n;
}

function renderList() {
  const q = ($("#search").value || "").toLowerCase().trim(), f = state.listFilter;
  let ents = filtered().sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  if (f === "expense" || f === "income") ents = ents.filter((e) => e.type === f);
  if (f === "flag") ents = ents.filter((e) => entryFlags(e).some((x) => x.lvl !== "info"));
  if (q) ents = ents.filter((e) => [e.label, e.client, e.purpose, e.dest, CAT[e.cat]?.label].join(" ").toLowerCase().includes(q));
  if (!ents.length) { $("#list").innerHTML = `<div class="card muted small">Rien à afficher.</div>`; return; }
  let html = "", last = "";
  for (const e of ents) {
    const m = monthKey(e.date);
    if (m !== last) { last = m; html += `<div class="month">${new Date(m + "-01").toLocaleDateString("fr-BE", { month: "long", year: "numeric" })}</div>`; }
    const c = CAT[e.cat] || CAT.divers, v = compute(e), fl = entryFlags(e);
    const sub = [new Date(e.date + "T12:00").toLocaleDateString("fr-BE", { day: "numeric", month: "short" }), c.label, c.km ? `${e.km} km` : "", e.type === "expense" && c.deduct < 1 ? `déductible ${Math.round(c.deduct * 100)} %` : ""].filter(Boolean).join(" · ");
    html += `<div class="item" data-id="${e.id}">
      <div class="ic">${c.icon}</div>
      <div><div class="t">${esc(e.label)}</div><div class="s">${esc(sub)}</div></div>
      <div class="a ${e.type === "income" ? "inc" : ""}">${e.type === "income" ? "+" : "−"}${eur(v.ttc)}<div class="s">HT ${eur(v.ht)}</div></div>
      ${fl.length ? `<div class="flags">${fl.map((x) => `<span class="chip ${x.lvl === "bad" ? "bad" : x.lvl === "info" ? "info" : ""}">${x.t}</span>`).join("")}</div>` : ""}
      <div class="ops"><button class="link" data-op="edit">Modifier</button>${e.photo ? `<button class="link" data-op="photo">Photo</button>` : ""}${e.personal ? `<button class="link" data-op="refund">${e.reimbursed ? "↺ Non remboursé" : "✓ Remboursé"}</button>` : ""}<button class="link danger" data-op="del">Supprimer</button></div>
    </div>`;
  }
  $("#list").innerHTML = html;
}

function renderAdvice() {
  const ents = filtered(), t = totals(ents), r = riskAnalysis(ents, t);
  $("#alerts").innerHTML = r.alerts.map((a) => `<div class="alert ${a.lvl}"><b>${esc(a.t)}</b>${a.d}</div>`).join("");
  const opts = optimisations(state.entries, totals(state.entries));
  $("#opts").innerHTML = opts.map((o) => `<div class="opt"><b>${esc(o.t)}</b>${esc(o.d)}${o.note ? `<div class="small muted">${esc(o.note)}</div>` : ""}${o.gain ? `<span class="gain">+ ${eur(o.gain)}${o.once ? "" : " / an"}</span>` : ""}</div>`).join("");
  renderForfaits();
}
function renderForfaits() {
  const m = $("#fMonth").value || today().slice(0, 7), mo = state.months[m] || {};
  $("#fMonth").value = m;
  $("#fTeleDays").value = mo.teleDays ?? "";
  $("#fWorkDays").value = mo.workDays ?? ""; $("#fWorkDays").placeholder = "≈ " + monthIsoDays(m) + " jours ouvrables";
  $("#fMeal").checked = !!mo.meal;
  $("#forfaitList").innerHTML = RULES.forfaits.map((f) => `<label class="check"><input type="checkbox" data-forf="${f.id}" ${(mo.forfaits || []).includes(f.id) ? "checked" : ""}> ${f.label} — ${eur(f.monthly)}/mois</label>`).join("");
}
async function saveMonth() {
  const m = $("#fMonth").value; if (!m) return;
  state.months[m] = { forfaits: $$("[data-forf]").filter((x) => x.checked).map((x) => x.dataset.forf), teleDays: $("#fTeleDays").value, workDays: $("#fWorkDays").value, meal: $("#fMeal").checked };
  await saveMeta();
  const w = state.months[m];
  if (w.forfaits.includes("bureau") && w.teleDays !== "" && +w.teleDays < 4) toast("Forfait bureau : il faut un télétravail régulier (≈ 1 jour / semaine).");
  renderAll(true);
}

/* ---------- Formulaire ---------- */
function fillCats() {
  $("#fCat").innerHTML = CATEGORIES.filter((c) => c.type === state.type).map((c) => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join("");
}
function setType(t) {
  state.type = t;
  $$(".seg [data-type]").forEach((b) => b.classList.toggle("on", b.dataset.type === t));
  fillCats(); onCat();
}
function onCat() {
  const c = CAT[$("#fCat").value];
  $("#fHint").textContent = c.hint || (c.type === "income" ? "Montant facturé au client (TVA comprise)." : "");
  $("#kmBox").hidden = !c.km; $("#amountBox").hidden = !!c.km;
  $("#clientBox").hidden = !(c.id === "resto" || c.id === "cadeau" || c.type === "income");
  $("#clientBox").firstChild.textContent = c.type === "income" ? "Client" : "Client / bénéficiaire";
  $("#invBox").hidden = c.km || c.type === "income" || c.private || c.salary;
  $("#paidBox").hidden = c.type === "income" || c.salary;
  $("#purposeBox").hidden = c.type === "income" || c.salary;
  if (c.salary) { $("#fVatRate").value = "0"; if (!$("#fLabel").value) $("#fLabel").value = "Salaire " + new Date(new Date().setMonth(new Date().getMonth() - 1)).toLocaleDateString("fr-BE", { month: "long" }); }
  if (c.vat === 0 && !c.km && c.type === "expense" && c.id !== "assurance") $("#fVatRate").value = "0";
  else if (!$("#fVatRate").dataset.touched) $("#fVatRate").value = c.id === "assurance" || c.id === "pension" ? "0" : "0.21";
  live();
}
function readForm() {
  return {
    type: state.type, cat: $("#fCat").value, date: $("#fDate").value, label: $("#fLabel").value.trim(),
    ttc: +$("#fTtc").value || 0, vatRate: +$("#fVatRate").value, km: +$("#fKm").value || 0, dest: $("#fDest").value.trim(),
    client: $("#fClient").value.trim(), purpose: $("#fPurpose").value.trim(), invoice: $("#fInvoice").checked,
    personal: state.type === "expense" && $("#fPersonal").checked, photo: state.photo,
  };
}
function live() {
  const e = readForm(), c = CAT[e.cat];
  if (c.km) $("#fKmAmount").value = eur(e.km * RULES.kmRate);
  const v = compute(e);
  $("#fCalc").innerHTML = e.type === "income"
    ? `HTVA ${eur(v.ht)} · TVA à reverser ${eur(v.vat)}`
    : v.salary ? `Net versé ${eur(v.ttc)} · coût société suivi via le salaire brut des réglages` : `HTVA ${eur(v.ht)} · déductible ${eur(v.deductible)} · TVA récupérable ${eur(v.vatRec)}`;
  const fl = e.date ? entryFlags({ ...e, photo: e.photo || "x" }).filter((f) => f.lvl !== "info") : [];
  $("#fWarn").innerHTML = fl.map((f) => `<div class="alert ${f.lvl}"><b>${f.t}</b>${flagHelp(f.k)}</div>`).join("");
}
function flagHelp(k) {
  return { private: "Ne la mets pas sur ILYTEQ.", noInvoice: "Demande-la au nom d'ILYTEQ SRL – BE1044.101.763.", noClient: "Indique avec qui et pourquoi.", kmInfo: "Indique la destination et le motif.", privKw: "Précise le motif professionnel.", weekend: "Précise le motif professionnel." }[k] || "";
}
function resetForm() {
  state.editId = null; state.photo = null;
  $("#form").reset(); $("#fVatRate").dataset.touched = "";
  $("#fDate").value = today(); $("#fInvoice").checked = true;
  $("#fPreview").hidden = true; $("#fPhotoDel").hidden = true; $("#fCancel").hidden = true;
  $("#formTitle").textContent = "Nouvelle entrée";
  setType(state.type);
}
function editEntry(id) {
  const e = state.entries.find((x) => x.id === id); if (!e) return;
  setType(e.type); state.editId = id; state.photo = e.photo || null;
  $("#fCat").value = e.cat; onCat();
  $("#fDate").value = e.date; $("#fLabel").value = e.label; $("#fTtc").value = e.ttc || ""; $("#fVatRate").value = String(e.vatRate ?? 0.21); $("#fVatRate").dataset.touched = "1";
  $("#fKm").value = e.km || ""; $("#fDest").value = e.dest || ""; $("#fClient").value = e.client || ""; $("#fPurpose").value = e.purpose || "";
  $("#fInvoice").checked = !!e.invoice; $("#fPersonal").checked = !!e.personal;
  $("#fPreview").src = e.photo || ""; $("#fPreview").hidden = !e.photo; $("#fPhotoDel").hidden = !e.photo;
  $("#formTitle").textContent = "Modifier"; $("#fCancel").hidden = false;
  live(); go("add", true);
}
async function submitForm(ev) {
  ev.preventDefault();
  const e = readForm(), c = CAT[e.cat];
  if (c.km ? !(e.km > 0) : !(e.ttc > 0)) { toast(c.km ? "Indique le nombre de km." : "Indique le montant."); return; }
  const old = state.entries.find((x) => x.id === state.editId);
  const rec = { ...(old || {}), ...e, id: state.editId || uid(), created: old?.created || Date.now(), reimbursed: old?.reimbursed && e.personal ? old.reimbursed : false };
  await DB.put("entries", rec);
  const i = state.entries.findIndex((x) => x.id === rec.id);
  if (i >= 0) state.entries[i] = rec; else state.entries.push(rec);
  const bad = entryFlags(rec).filter((f) => f.lvl !== "info");
  toast(bad.length ? "Enregistré · ⚠️ " + bad[0].t : "Enregistré ✓");
  const keepType = state.type; resetForm(); setType(keepType);
  renderAll(true);
}
async function onPhoto(ev) {
  const file = ev.target.files[0]; if (!file) return;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const k = Math.min(1, 1200 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    state.photo = cv.toDataURL("image/jpeg", 0.7);
    $("#fPreview").src = state.photo; $("#fPreview").hidden = false; $("#fPhotoDel").hidden = false;
  } catch (e) { toast("Photo illisible."); }
  ev.target.value = "";
}

/* ---------- Exports ---------- */
async function shareFile(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const file = new File([blob], name, { type: mime });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  const a = $("#shareFallback"); a.href = URL.createObjectURL(blob); a.download = name; a.classList.remove("hidden");
  a.textContent = "⬇️ Télécharger " + name; a.click();
}
function exportJson() {
  const data = { app: "ilyteq-frais", version: 1, rules: RULES.version, exported: new Date().toISOString(), settings: state.settings, months: state.months, entries: state.entries };
  shareFile(`ilyteq-frais-${today()}.json`, "application/json", JSON.stringify(data));
}
function exportCsv() {
  const head = ["Date", "Type", "Catégorie", "Libellé", "HTVA", "TVA", "TTC", "Déductible %", "Montant déductible", "TVA récupérable", "Facture ILYTEQ", "Client", "Motif", "Km", "Destination", "Payé perso", "Remboursé", "Alertes"];
  const n = (x) => (Math.round(x * 100) / 100).toString().replace(".", ",");
  const rows = state.entries.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
    const c = CAT[e.cat] || {}, v = compute(e);
    return [e.date, e.type === "income" ? "Revenu" : "Dépense", c.label, e.label, n(v.ht), n(v.vat), n(v.ttc), e.type === "income" ? "" : Math.round((c.deduct ?? 1) * 100), n(v.deductible), n(v.vatRec), e.type === "income" ? "" : e.invoice || c.km ? "oui" : "non", e.client || "", e.purpose || "", c.km ? e.km : "", e.dest || "", e.personal ? "oui" : "", e.personal ? (e.reimbursed ? "oui" : "non") : "", entryFlags(e).filter((f) => f.lvl !== "info").map((f) => f.t).join(" / ")];
  });
  const csv = "﻿" + [head, ...rows].map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  shareFile(`ilyteq-frais-${today()}.csv`, "text/csv", csv);
}
async function importJson(ev) {
  const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "ilyteq-frais" || !Array.isArray(d.entries)) throw new Error("format");
    if (!confirm(`Restaurer ${d.entries.length} entrée(s) du ${String(d.exported).slice(0, 10)} ? Les données actuelles seront remplacées.`)) return;
    await DB.clear("entries"); for (const e of d.entries) await DB.put("entries", e);
    state.entries = d.entries; state.settings = { ...DEFAULT_SETTINGS, ...d.settings }; state.settings.plan = { ...DEFAULT_PLAN, ...(state.settings.plan || {}) }; state.months = d.months || {};
    await saveMeta(); fillSettings(); renderAll(true); toast("Sauvegarde restaurée ✓");
  } catch (e) { toast("Fichier non reconnu."); }
}

/* ---------- Réglages ---------- */
function fillSettings() {
  const s = state.settings;
  $("#sTjm").value = s.tjm; $("#sDays").value = s.days; $("#sSalary").value = s.salary; $("#sStart").value = s.start;
  $("#rulesVersion").textContent = RULES.version;
  $("#sCapital").value = s.capital ?? 2000; const P = s.plan; $("#pCaIn").value = P.ca; $("#pSalIn").value = P.salary; $("#pFraisIn").value = P.frais; $("#pIsocIn").value = P.isoc; $("#pRestIn").value = P.rest; $("#pDaysIn").value = P.days;
}

/* ---------- Questionnaire de démarrage ---------- */
const answers = () => state.checklist?.answers || Object.fromEntries(CHECKLIST.filter((c) => c.def).map((c) => [c.id, c.def]));
async function saveChecklist(a, done) { state.checklist = { answers: a, done: done ?? state.checklist?.done ?? false, at: new Date().toISOString() }; await DB.put("meta", { key: "checklist", value: state.checklist }); }
function startQuiz(i = 0) { state.qIndex = i; $("#startResult").hidden = true; $("#startQuiz").hidden = false; showQ(); }
function showQ() {
  const c = CHECKLIST[state.qIndex], a = answers()[c.id];
  $("#qGroup").textContent = c.group; $("#qCount").textContent = `${state.qIndex + 1} / ${CHECKLIST.length}`;
  $("#qBar").style.width = ((state.qIndex) / CHECKLIST.length) * 100 + "%";
  $("#qText").textContent = c.q; $("#qWhy").textContent = c.why;
  $("#qGain").textContent = c.gain ? `Jusqu'à + ${eur(c.gain)} / an` : "";
  $$("#startQuiz [data-ans]").forEach((b) => b.classList.toggle("ghost", b.dataset.ans !== (a || "")));
  if (!a) $$("#startQuiz [data-ans]").forEach((b, i) => b.classList.toggle("ghost", i > 0));
  $("#qBack").style.visibility = state.qIndex ? "visible" : "hidden";
}
async function answerQ(v) {
  const a = { ...answers(), [CHECKLIST[state.qIndex].id]: v };
  const last = state.qIndex >= CHECKLIST.length - 1;
  await saveChecklist(a, last || state.checklist?.done);
  if (last) showResult(); else { state.qIndex++; showQ(); }
}
function checklistStats() {
  const a = answers(), done = CHECKLIST.filter((c) => a[c.id] === "yes");
  const todo = CHECKLIST.filter((c) => a[c.id] !== "yes");
  return { a, done, todo, gain: todo.reduce((x, c) => x + (c.gain || 0), 0) };
}
function showResult() {
  $("#startQuiz").hidden = true; $("#startResult").hidden = false;
  const { a, done, todo, gain } = checklistStats(), p = Math.round(done.length / CHECKLIST.length * 100);
  $("#rDone").textContent = `${done.length} / ${CHECKLIST.length} en place`;
  $("#rPct").textContent = p; const g = $("#rGauge"); g.style.setProperty("--p", Math.max(p, 2)); g.style.setProperty("--gc", `var(--${p >= 80 ? "ok" : p >= 50 ? "warn" : "bad"})`);
  const mustTodo = todo.filter((c) => c.level === "must");
  $("#rGain").innerHTML = (gain ? `Encore <strong class="pos">+ ${eur(gain)} / an</strong> à aller chercher sans impôt ou presque. ` : "") + (mustTodo.length ? `<strong class="neg">${mustTodo.length} point(s) de sécurité</strong> à régler d'abord.` : "Les bases sont en place 👍");
  const btn = (c, v, l) => `<button type="button" class="ckb ${a[c.id] === v || (!a[c.id] && v === "unknown") ? "on " + v : ""}" data-ck="${c.id}" data-v="${v}">${l}</button>`;
  const item = (c) => { const s = a[c.id]; return `<div class="ck"><div>${s === "yes" ? "✅" : s === "no" ? "❌" : "🤷"}</div><div><div class="q">${esc(c.q)}</div><div class="w">${esc(c.why)}</div>${c.gain ? `<div class="g">+ ${eur(c.gain)} / an</div>` : ""}<div class="ckbs">${btn(c, "yes", "✓ Fait")}${btn(c, "no", "✗ Pas encore")}${btn(c, "unknown", "? Sais pas")}</div></div></div>`; };
  const block = (title, list, open = true) => list.length ? `<details class="card" ${open ? "open" : ""}><summary>${title} (${list.length})</summary>${list.map(item).join("")}</details>` : "";
  const byGain = (x, y) => (y.gain || 0) - (x.gain || 0);
  $("#rLists").innerHTML =
    block("🚨 À régler en priorité", mustTodo) +
    block("💰 Optimisations à activer", todo.filter((c) => c.level === "opt").sort(byGain)) +
    block("🗓️ À planifier avec le comptable", todo.filter((c) => c.level === "plan")) +
    block("✅ Déjà en place", done, false);
  renderStartSummary();
}
function renderStartSummary() {
  if (!$("#startSummary")) return;
  const { done, todo, gain } = checklistStats();
  $("#startSummary").textContent = state.checklist?.done
    ? `${done.length} / ${CHECKLIST.length} points en place · ${todo.filter((c) => c.level === "must").length} à régler · potentiel + ${eur(gain)} / an.`
    : "Réponds à quelques questions pour voir tout ce qui est en place et tout ce que tu peux encore optimiser.";
}
function openStart() { go("start"); if (state.checklist?.done) showResult(); else startQuiz(Math.max(0, CHECKLIST.findIndex((c) => !state.checklist?.answers?.[c.id]))); }

/* ---------- Navigation ---------- */
let current = "home";
function go(tab, keep) {
  current = tab;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + tab));
  $$(".bottom button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab || (tab === "start" && b.dataset.tab === "advice")));
  if (tab === "add" && !keep && !state.editId) resetForm();
  renderAll(); window.scrollTo(0, 0);
}
function renderAll(all) {
  if (all || current === "home") renderHome();
  if (all || current === "list") renderList();
  if (all || current === "advice") { renderAdvice(); renderStartSummary(); }
}
let tt; function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2600); }

/* ---------- Démarrage ---------- */
async function init() {
  await load();
  fillSettings(); resetForm();
  $$(".bottom button").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => go(b.dataset.goto)));
  $$(".seg [data-type]").forEach((b) => b.addEventListener("click", () => setType(b.dataset.type)));
  $("#period").addEventListener("change", () => { try { localStorage.setItem("period", $("#period").value); } catch (e) {} renderAll(true); });
  $("#fCat").addEventListener("change", onCat);
  $("#fVatRate").addEventListener("change", () => { $("#fVatRate").dataset.touched = "1"; live(); });
  $("#form").addEventListener("input", live);
  $("#form").addEventListener("submit", submitForm);
  $("#fCancel").addEventListener("click", () => { resetForm(); go("list"); });
  $("#fPhoto").addEventListener("change", onPhoto);
  $("#fPhotoDel").addEventListener("click", () => { state.photo = null; $("#fPreview").hidden = true; $("#fPhotoDel").hidden = true; });
  $("#search").addEventListener("input", renderList);
  $$("#listFilter button").forEach((b) => b.addEventListener("click", () => { state.listFilter = b.dataset.f; $$("#listFilter button").forEach((x) => x.classList.toggle("on", x === b)); renderList(); }));
  $("#list").addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-op]"); if (!btn) return;
    const id = btn.closest(".item").dataset.id, e = state.entries.find((x) => x.id === id);
    if (btn.dataset.op === "edit") editEntry(id);
    if (btn.dataset.op === "photo") { $("#photoBig").src = e.photo; $("#photoDlg").showModal(); }
    if (btn.dataset.op === "refund") { e.reimbursed = !e.reimbursed; await DB.put("entries", e); renderAll(true); }
    if (btn.dataset.op === "del" && confirm(`Supprimer « ${e.label} » ?`)) { await DB.del("entries", id); state.entries = state.entries.filter((x) => x.id !== id); renderAll(true); toast("Supprimé"); }
  });
  $("#photoClose").addEventListener("click", () => $("#photoDlg").close());
  $("#fMonth").addEventListener("change", renderForfaits);
  ["#forfaitList", "#fMeal", "#fTeleDays", "#fWorkDays"].forEach((s) => $(s).addEventListener("change", saveMonth));
  $("#sSave").addEventListener("click", async () => {
    state.settings = { tjm: +$("#sTjm").value || DEFAULT_SETTINGS.tjm, days: +$("#sDays").value || DEFAULT_SETTINGS.days, salary: +$("#sSalary").value || 0, start: $("#sStart").value || DEFAULT_SETTINGS.start, capital: +$("#sCapital").value || 0,
      plan: { ca: +$("#pCaIn").value || 0, salary: +$("#pSalIn").value || 0, frais: +$("#pFraisIn").value || 0, isoc: +$("#pIsocIn").value || 0, rest: +$("#pRestIn").value || 0, days: +$("#pDaysIn").value || 0, benefit: DEFAULT_PLAN.benefit } };
    await saveMeta(); renderAll(true); toast("Réglages enregistrés ✓");
  });
  $("#exJson").addEventListener("click", exportJson);
  $("#exCsv").addEventListener("click", exportCsv);
  $("#imJson").addEventListener("change", importJson);
  $("#wipe").addEventListener("click", async () => {
    if (!confirm("Effacer toutes les données de ce téléphone ? Fais d'abord une sauvegarde.")) return;
    await DB.clear("entries"); await DB.clear("meta"); state.entries = []; state.months = {}; state.settings = { ...DEFAULT_SETTINGS };
    fillSettings(); renderAll(true); toast("Données effacées");
  });
  $("#openStart").addEventListener("click", openStart);
  $$("#startQuiz [data-ans]").forEach((b) => b.addEventListener("click", () => answerQ(b.dataset.ans)));
  $("#qBack").addEventListener("click", () => { if (state.qIndex) { state.qIndex--; showQ(); } });
  $("#qResults").addEventListener("click", async () => { await saveChecklist(answers(), true); showResult(); });
  $("#rRedo").addEventListener("click", () => startQuiz(0));
  $("#rLists").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-ck]"); if (!b) return;
    const id = b.dataset.ck, next = b.dataset.v, cur = answers()[id] || "unknown";
    if (next === cur) return;
    const titles = (el) => el.querySelector("summary").textContent.replace(/\s*\(\d+\)$/, "");
    const keep = Object.fromEntries($$("#rLists details").map((d) => [titles(d), d.open]));
    const y = window.scrollY;
    await saveChecklist({ ...answers(), [id]: next }, true); showResult();
    $$("#rLists details").forEach((d) => { const k = titles(d); if (k in keep) d.open = keep[k]; });
    window.scrollTo(0, y);
    toast(next === "yes" ? "✅ Validé — rangé dans « Déjà en place »" : next === "no" ? "❌ Noté comme pas encore fait" : "🤷 Noté comme à vérifier");
  });
  renderAll(true);
  if (!state.checklist?.done && !state.entries.length) openStart();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
init().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<p style="padding:16px;color:#c0392b">Erreur au démarrage : ${esc(e.message)}</p>`); });
