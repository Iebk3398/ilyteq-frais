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

const DEFAULT_SETTINGS = { tjm: 485, days: 220, salary: 2500, start: "2026-10-15" };

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

const state = { entries: [], settings: { ...DEFAULT_SETTINGS }, months: {}, type: "expense", editId: null, photo: null, listFilter: "all" };

async function load() {
  await DB.open();
  state.entries = await DB.all("entries");
  const meta = Object.fromEntries((await DB.all("meta")).map((m) => [m.key, m.value]));
  state.settings = { ...DEFAULT_SETTINGS, ...(meta.settings || {}) };
  state.months = meta.months || {};
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
  const t = { ca: 0, vatDue: 0, vatRec: 0, frais: 0, fraisHT: 0, perks: 0, mealCost: 0, byCat: {} };
  for (const e of entries) {
    const v = compute(e);
    if (e.type === "income") { t.ca += v.ht; t.vatDue += v.vatDue; continue; }
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
  if (e.type === "income") return [];
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
  const exp = state.entries.filter((e) => e.type === "expense").map(compute);
  // frais courants extrapolés + annuités d'amortissement (sans les extrapoler)
  const frais12 = exp.filter((v) => !v.amort).reduce((x, v) => x + v.deductible, 0) / months * 12 + exp.filter((v) => v.amort).reduce((x, v) => x + v.deductible, 0);
  const cur = monthPerks(today().slice(0, 7)), mo = state.months[today().slice(0, 7)] || {};
  const perks12 = cur.forf * 12 + (mo.meal ? RULES.mealVoucherMax * s.days : 0);
  const perksCost12 = cur.forf * 12 + (mo.meal ? 2 * s.days : 0);
  const b12 = ca12 - sal12 - frais12 - perksCost12, isoc12 = Math.max(0, b12) * RULES.isocRate, rest12 = b12 - isoc12;
  $("#projHint").textContent = `${s.days} jours × ${eur(s.tjm)}, salaire ${eur(s.salary)} brut/mois, frais au rythme moyen depuis la création.`;
  $("#pCA").textContent = eur(ca12); $("#pSal").textContent = "− " + eur(sal12); $("#pFrais").textContent = "− " + eur(frais12 + perksCost12);
  $("#pIsoc").textContent = "− " + eur(isoc12); $("#pRest").textContent = eur(rest12);
  $("#pExit").textContent = eur(Math.max(0, rest12) * (1 - RULES.exitTaxRate)); $("#pPerks").textContent = eur(perks12);

  const rows = Object.entries(t.byCat).sort((a, b) => b[1] - a[1]);
  $("#byCat").innerHTML = rows.length ? rows.map(([k, v]) => `<div class="r"><span>${k === "__perks" ? "🏡 Forfaits & chèques-repas" : esc(CAT[k].icon + " " + CAT[k].label)}</span><strong>${eur(v)}</strong></div>`).join("") : `<p class="muted small">Aucune dépense sur la période. Appuie sur ＋ pour commencer.</p>`;
}
function monthsIn(ents) {
  const p = $("#period").value;
  if (p === "month") return 1;
  if (p === "12m") return Math.min(12, Math.max(1, monthsSince(state.settings.start)));
  if (p === "year") { const y = new Date().getFullYear(), st = new Date(state.settings.start); const from = st.getFullYear() === y ? st.getMonth() : 0; return new Date().getMonth() - from + 1; }
  return Math.max(1, monthsSince(state.settings.start));
}
function monthsSince(d) { const a = new Date(d), b = new Date(); return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1; }

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
  $("#fWorkDays").value = mo.workDays ?? "";
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
  $("#invBox").hidden = c.km || c.type === "income" || c.private;
  $("#paidBox").hidden = c.type === "income";
  $("#purposeBox").hidden = c.type === "income";
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
    : `HTVA ${eur(v.ht)} · déductible ${eur(v.deductible)} · TVA récupérable ${eur(v.vatRec)}`;
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
    state.entries = d.entries; state.settings = { ...DEFAULT_SETTINGS, ...d.settings }; state.months = d.months || {};
    await saveMeta(); fillSettings(); renderAll(true); toast("Sauvegarde restaurée ✓");
  } catch (e) { toast("Fichier non reconnu."); }
}

/* ---------- Réglages ---------- */
function fillSettings() {
  const s = state.settings;
  $("#sTjm").value = s.tjm; $("#sDays").value = s.days; $("#sSalary").value = s.salary; $("#sStart").value = s.start;
  $("#rulesVersion").textContent = RULES.version;
}

/* ---------- Navigation ---------- */
let current = "home";
function go(tab, keep) {
  current = tab;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + tab));
  $$(".bottom button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab === "add" && !keep && !state.editId) resetForm();
  renderAll(); window.scrollTo(0, 0);
}
function renderAll(all) {
  if (all || current === "home") renderHome();
  if (all || current === "list") renderList();
  if (all || current === "advice") renderAdvice();
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
    state.settings = { tjm: +$("#sTjm").value || DEFAULT_SETTINGS.tjm, days: +$("#sDays").value || DEFAULT_SETTINGS.days, salary: +$("#sSalary").value || 0, start: $("#sStart").value || DEFAULT_SETTINGS.start };
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
  renderAll(true);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
init().catch((e) => { document.body.insertAdjacentHTML("afterbegin", `<p style="padding:16px;color:#c0392b">Erreur au démarrage : ${esc(e.message)}</p>`); });
