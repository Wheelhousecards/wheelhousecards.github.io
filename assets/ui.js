// Shared helpers and the customer dashboard, used by both the customer portal and the staff app.

export const $ = (s, r = document) => r.querySelector(s);
export const CONTACT_EMAIL = "consignment@wheelhousecards.com";
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = n => n == null || isNaN(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
export const PLAT = { fan: "Fanatics Collect", pcs: "PC Sportscards", store: "In store at Wheelhouse", goldin: "Goldin", shibe: "Shibe Sports", other: "Other" };
// pending = sold, waiting on the buyer's payment (not owed to the consignor yet).
export const STAT = { curating: "Being curated", awaitprice: "Awaiting price", live: "Live", pending: "Pending sale", sold: "Sold", unsold: "Unsold", paid: "Paid out", returned: "Returned to you", removed: "Removed" };
export const pad6 = n => String(n).padStart(6, "0");
export const plural = n => `${n} card${n === 1 ? "" : "s"}`;
export const isSold = l => l.status === "sold" || l.status === "paid";
export const PAYM = { venmo: "Venmo", paypal: "PayPal", check: "Check", other: "Other" };
// "Venmo @handle", "PayPal you@x.com", "Check to 123 Main St…"
export function payLine(c) {
  if (!c || !c.payMethod) return "";
  if (c.payMethod === "check") return "Check" + (c.mailing ? ` mailed to ${c.mailing}` : "");
  if (c.payMethod === "other") return c.payTo || "Other";
  return PAYM[c.payMethod] + (c.payTo ? ` ${c.payTo}` : "");
}
// The consignor's share of one sale. Cards imported from the old system carry their exact portion.
// PC Sportscards cards carry their payout after PC Sportscards' fees (net), but the consignor's split applies to the sale price.
/* Payout splits, per card:
   - Fanatics Collect: 100% when the card sells for $200 or more, 90% under $200.
   - PC Sportscards: a flat 95% of what PC Sportscards pays after its fees.
   - Anything else: the consignor's default split.
   A card's own split (set in its details) overrides the rule, and an exact consignor portion
   (from the old system) overrides both. */
// Fixed splits for everyone (staff-only; customers never see a %). Fanatics Collect: 100% at $200 and up, 90% under $200.
// A single card can still be given its own split from its detail view.
// PC Sportscards: 80% of the sale price, unless the consignor has a preferred rate (pcsPct), or a drop-off / card is set by hand.
export const SPLIT_DEFAULTS = { fanHi: 100, fanLo: 90, pcsRate: 80, rate: 100 };
export const splitOf = (c, k) => k === "pcsRate" && c?.pcsPct != null && c.pcsPct !== "" && !isNaN(+c.pcsPct) ? +c.pcsPct : SPLIT_DEFAULTS[k];
export const splitLine = () => "Fanatics Collect 100% at $200+, 90% under $200";
export function cardSplit(l, c) {
  if (l.split != null && l.split !== "") return +l.split;
  if (l.plat === "fan") return (l.price || 0) >= 200 ? splitOf(c, "fanHi") : splitOf(c, "fanLo");
  if (l.plat === "pcs") return splitOf(c, "pcsRate");
  return splitOf(c, "rate");
}
// Fanatics Collect charges a $5 service fee on every ungraded card (entered as Ungraded, or "CGC AUTH" in the title).
// It comes off the sale price before the split.
export const FAN_RAW_FEE = 5;
export const isUngraded = l => isRawGrade(l.grade) || /cgc\s*auth/i.test(l.title || "");
export const cardFee = l => l.plat === "fan" && isUngraded(l) && l.net == null ? FAN_RAW_FEE : 0;
export const cardPayout = (l, c) => { if (l.payout != null) return l.payout; const p = cardSplit(l, c); return p == null ? null : Math.max(0, (l.net != null && l.plat !== "pcs" ? l.net : (l.price || 0)) - cardFee(l)) * p / 100; };
const has = v => v != null && v !== "" && !isNaN(+v);
// money for a share that may not be known yet
export const shareText = (v, staff) => v == null ? (staff ? '<span class="need">Set PC %</span>' : '<span class="muted">Pending</span>') : money(v);
/* ---------- PC Sportscards drop-offs ----------
   A drop-off is one SKU for one customer's drop-off. Its cards live in items[], each with its own
   PC Sportscards status: live, sold (PC Sportscards sold it, Wheelhouse hasn't paid the consignor yet),
   paid (paid out to the consignor) or unsold. */
export const isDropoff = l => !!(l && l.kind === "dropoff");
// awaiting: sold on eBay, PC Sportscards hasn't received the buyer's payment yet (not owed to the consignor yet).
// sold: PC Sportscards received payment, so Wheelhouse owes the consignor. cancelled: the sale fell through (unpaid or returned)
// and PC Sportscards relists it under a new card #; relistedAs points to the new listing.
export const ITEM_STAT = { live: "Listed", awaiting: "Awaiting payment", sold: "Sold", paid: "Paid out", unsold: "Unsold", cancelled: "Sale cancelled" };
export const CUST_ITEM_STAT = { live: "Listed", awaiting: "Sold", sold: "Sold", paid: "Paid out", unsold: "Unsold", cancelled: "Being relisted" };
// What the customer sees: a cancelled sale that's been relisted shows only as the new listing.
// Monthly payouts: a sale belongs to the month it sold in, and is paid around the 5th of the next month.
export const monthKey = d => (d || "").slice(0, 7);
export const monthLabel = (k, withYear) => { if (!k) return ""; const d = new Date(k + "-15T12:00:00"); return d.toLocaleDateString("en-US", { month: "long", ...(withYear || d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }); };
export const monthEnd = k => { const [y, m] = k.split("-").map(Number); return `${k}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
export const lastMonthKey = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth() - 1, 15); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`; };
export const payMonthOf = x => x.payoutMonth || monthKey(x.soldDate);
// Customer-facing note under a sale: which monthly payout it is (or was) in.
export const payNote = x => x.status === "paid" || (x.reversal && !x.reversal.deduct) ? (payMonthOf(x) ? `Paid in ${monthLabel(payMonthOf(x))} payout` : "Paid out") : ["sold", "awaiting", "pending"].includes(x.status) && x.soldDate ? `In your ${monthLabel(monthKey(x.soldDate))} payout` : "";
// A relist of a sale reversed after payout belongs to Wheelhouse (the customer was already paid), unless staff chose to deduct the reversal.
export const isHouseRelist = (x, items) => { if (!x.relistOf) return false; const o = (items || []).find(y => y.pcsId === x.relistOf); return !!(o && o.reversal && !o.reversal.deduct); };
// What the customer sees in a drop-off: sales reversed after payout stay as Paid, and their relists (Wheelhouse's) are hidden; a sale cancelled before payout just disappears behind its relist.
export const custItems = items => (items || []).filter(x => !isHouseRelist(x, items) && !(x.status === "cancelled" && x.relistedAs && !(x.reversal && !x.reversal.deduct)))
  .map(x => x.reversal && !x.reversal.deduct ? { ...x, status: "paid" } : x);
// A card's earlier sales that fell through, oldest first, as one line: Sold $55 · Oct 28 → Buyer didn't pay — relisted Nov 3 → …
const shortDay = d => d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
export function itemHistory(x, items, staff = true) {
  const by = new Map((items || []).map(y => [y.pcsId, y]));
  const chain = []; let cur = x;
  if (x.status === "cancelled" && !x.relistedAs) chain.unshift({ o: x, next: null });
  for (let k = 0; cur.relistOf && by.get(cur.relistOf) && k < 10; k++) { const o = by.get(cur.relistOf); chain.unshift({ o, next: cur }); cur = o; }
  if (!chain.length || (!staff && !chain.some(({ o }) => o.reversal?.deduct))) return "";
  const steps = [];
  chain.forEach(({ o, next }) => {
    steps.push(`<b>Sold ${money(o.price)}${o.soldDate ? ` · ${shortDay(o.soldDate)}` : ""}</b>`);
    const why = o.reversal ? "Buyer returned it" : "Buyer didn’t pay";
    steps.push(next ? `${why} — relisted${next.listed ? ` ${shortDay(next.listed)}` : ""}` : `${why} — being relisted`);
  });
  if (x.status !== "cancelled" || x.relistedAs) steps.push(x.status === "live" ? "Live on eBay" : `<b>${CUST_ITEM_STAT[x.status] || ""}${x.status === "sold" || x.status === "paid" || x.status === "awaiting" ? ` ${money(x.price)}${x.soldDate ? ` · ${shortDay(x.soldDate)}` : ""}` : ""}</b>`);
  return `<div class="hist">${steps.join(" <span aria-hidden=\"true\">→</span> ")}</div>`;
}
export const RELIST_NOTE = "Sometimes an eBay buyer returns a card. When that happens it’s relisted, and the new sale replaces the old one.";
// PC Sportscards' eBay seller name. Once set, "Find on eBay" only searches their listings.
export const PCS_SELLER = "pc_sportscards";
// Searches eBay for the card's exact PC Sportscards title (limited to their store once PCS_SELLER is set).
// Sold cards search eBay's sold listings instead of live ones.
export function ebayFind(x) {
  const q = encodeURIComponent(x.title || x.pcsId || "");
  const done = x.status === "sold" || x.status === "paid" || x.status === "awaiting";
  // PC sells the same card for many consignors over time, so a sold search also pins the exact sale price.
  const p = done && x.price > 0 ? `&_udlo=${(x.price - 0.01).toFixed(2)}&_udhi=${(x.price + 0.01).toFixed(2)}` : "";
  return `https://www.ebay.com/sch/i.html?_nkw=${q}${PCS_SELLER ? `&_ssn=${encodeURIComponent(PCS_SELLER)}` : ""}${done ? "&LH_Sold=1&LH_Complete=1" : ""}${p}`;
}
export const itemPct = (x, lot, c) => has(x.split) ? +x.split : has(lot?.split) ? +lot.split : splitOf(c, "pcsRate");
export const itemShare = (x, c, lot) => { const p = itemPct(x, lot, c); return p == null ? null : (x.price || 0) * p / 100; }; // PC Sportscards: % of the sale price
export function dropoffSummary(items = []) {
  const n = k => items.filter(x => x.status === k).length;
  const soldItems = items.filter(x => x.status === "sold" || x.status === "paid");
  const open = n("cancelled") - items.filter(x => x.status === "cancelled" && x.relistedAs).length;
  const status = !items.length ? "curating" : n("live") || open ? "live" : n("awaiting") || n("sold") ? "sold" : n("paid") ? "paid" : "unsold";
  return { status, live: n("live"), awaiting: n("awaiting"), sold: n("sold"), paid: n("paid"), unsold: n("unsold"), cancelled: n("cancelled"), relisting: open,
    cards: items.length - (n("cancelled") - open), gross: soldItems.reduce((s, x) => s + (x.price || 0), 0), net: soldItems.reduce((s, x) => s + (x.net || 0), 0) };
}
// What Wheelhouse owes this consignor: every sale not yet paid out (first sale price, even if the buyer hasn't paid yet),
// optionally only sales through a month-end cutoff, minus any lines staff are holding for next month.
// Returns statement lines too: one per card, one per PC drop-off.
// A payout statement: Fanatics and PC Sportscards sections, one line per card or drop-off.
export function statementHtml(lines, { staff = false, deducted = 0, carried = 0, holdable = false } = {}) {
  const groups = [...new Set(lines.map(x => x.plat))];
  const row = x => `<tr class="${x.held ? "held" : ""}">${holdable ? `<td><input type="checkbox" class="pay-incl" data-key="${esc(x.key)}" ${x.held ? "" : "checked"} aria-label="Include SKU ${esc(x.sku)} in this payout"></td>` : ""}
    <td><span class="code">${esc(x.sku || "")}</span></td>
    <td class="title">${esc(x.title || "")}${x.kind === "drop" ? `<div class="cert">${x.n} card${x.n === 1 ? "" : "s"} sold</div>` : ""}${staff && x.awaiting ? `<div class="flag">${x.kind === "drop" ? `${x.awaiting} awaiting buyer payment` : "Awaiting buyer payment"}</div>` : ""}${staff && x.held ? '<div class="flag">Held for next month</div>' : ""}</td>
    <td class="num">${x.from && x.from !== x.sold ? `${fmtDay(x.from.slice(0, 10))}–${fmtDay(x.sold.slice(0, 10))}` : x.sold ? fmtDay(x.sold.slice(0, 10)) : ""}</td>
    <td class="num">${money(x.price || 0)}${x.fee ? `<div class="cert">−${money(x.fee)} fee</div>` : ""}</td>
    <td class="num" style="font-weight:600">${money(x.amt || 0)}</td></tr>`;
  const cols = holdable ? 6 : 5;
  const total = lines.filter(x => !x.held).reduce((t, x) => t + (x.amt || 0), 0) + (carried || 0) - (deducted || 0);
  return `<div class="tbl-wrap"><table class="prev statement"><thead><tr>${holdable ? '<th title="Include in this payout">Pay</th>' : ""}<th>SKU</th><th>Card</th><th>Sold</th><th>Sale</th><th>${staff ? "They get" : "You get"}</th></tr></thead><tbody>
    ${groups.map(g => `<tr class="grp"><td colspan="${cols}">${PLAT[g] || g}</td></tr>${lines.filter(x => x.plat === g).map(row).join("")}`).join("")}
    ${carried ? `<tr><td colspan="${cols - 1}">Carried over from before</td><td class="num">${money(carried)}</td></tr>` : ""}
    ${deducted ? `<tr><td colspan="${cols - 1}">Reversed sale deducted</td><td class="num">−${money(deducted)}</td></tr>` : ""}
    <tr class="grp"><td colspan="${cols - 1}">Total</td><td class="num">${money(total)}</td></tr></tbody></table></div>`;
}
export function owedFor(c, listings, { through = "", hold = null } = {}) {
  const mine = listings.filter(l => l.cust === c.id);
  const inPeriod = x => !through || !x.soldDate || x.soldDate.slice(0, 10) <= through;
  const held = k => !!(hold && hold.has(k));
  const soldAll = mine.filter(l => !isDropoff(l) && (l.status === "sold" || (l.status === "pending" && l.price)) && inPeriod(l));
  const itemsAll = mine.filter(isDropoff).flatMap(l => (l.items || []).filter(x => (x.status === "sold" || x.status === "awaiting") && inPeriod(x) && !isHouseRelist(x, l.items)).map(x => ({ ...x, lot: l })));
  // Sales with no PC % yet aren't counted until staff set one.
  const soldPct = soldAll.filter(l => cardPayout(l, c) != null), itemsPct = itemsAll.filter(x => itemPct(x, x.lot, c) != null);
  const needPct = soldAll.length - soldPct.length + itemsAll.length - itemsPct.length;
  const lines = soldPct.map(l => ({ key: l.id, kind: "card", plat: l.plat, sku: l.sku, title: l.title, sold: l.soldDate || "", price: l.price || 0, fee: cardFee(l), amt: cardPayout(l, c), n: 1, awaiting: l.status === "pending" ? 1 : 0, held: held(l.id) }));
  const byLot = new Map();
  itemsPct.forEach(x => { const a = byLot.get(x.lot.id) || byLot.set(x.lot.id, []).get(x.lot.id); a.push(x); });
  byLot.forEach((xs, id) => { const l = xs[0].lot, ds = xs.map(x => x.soldDate || "").filter(Boolean).sort();
    lines.push({ key: id, kind: "drop", plat: l.plat || "pcs", sku: l.sku, title: `PC Sportscards drop-off${l.dropDate ? ` · ${fmtDay(l.dropDate)}` : ""}`, sold: ds[ds.length - 1] || "", from: ds[0] || "", price: xs.reduce((t, x) => t + (x.price || 0), 0), amt: xs.reduce((t, x) => t + itemShare(x, c, l), 0), n: xs.length, awaiting: xs.filter(x => x.status === "awaiting").length, held: held(id) }); });
  lines.sort((a, b) => (a.plat === b.plat ? 0 : a.plat === "fan" ? -1 : b.plat === "fan" ? 1 : a.plat.localeCompare(b.plat)) || (a.sold || "").localeCompare(b.sold || ""));
  const sold = soldPct.filter(l => !held(l.id)), dropItems = itemsPct.filter(x => !held(x.lot.id));
  // Sales reversed after the customer was paid: Wheelhouse absorbs them unless staff chose to deduct one.
  const deductions = mine.filter(isDropoff).flatMap(l => (l.items || []).filter(x => x.reversal?.deduct && !x.reversal.applied).map(x => ({ ...x, lot: l })));
  const deducted = deductions.reduce((s, x) => s + (x.reversal.amount || 0), 0);
  return { cards: sold, dropItems, deductions, deducted, lines, needPct, count: sold.length + dropItems.length,
    awaiting: lines.filter(x => !x.held).reduce((t, x) => t + x.awaiting, 0),
    amount: lines.filter(x => !x.held).reduce((t, x) => t + x.amt, 0) + (c?.payable || 0) - deducted };
}

export function detect(url) {
  const u = (url || "").toLowerCase();
  if (u.includes("fanaticscollect")) return { plat: "fan", item: (url.match(/(\d{5,})/) || [])[1] || "" };
  if (u.includes("ebay.")) return { plat: "pcs", item: (url.match(/\/itm\/(?:[^/]*\/)?(\d{9,})/) || url.match(/(\d{11,13})/) || [])[1] || "" };
  return null;
}

// Authentic-only cards (no numeric grade) count as Ungraded: "CGC 0", "PSA/DNA 0", "Authenticated", "CGC AUTH", "PSA A".
// PSA and SGC authentic-only slabs ("PSA 0", "SGC 0", "PSA/DNA Authenticated", "SGC AUTH") are called "A" grades: "PSA A", "SGC A".
const authGrade = g => { const m = String(g || "").trim().match(/^(psa|sgc)(?:\s*\/\s*dna)?\s*(?:0|a|auth(?:entic(?:ated)?)?)$/i); return m ? m[1].toUpperCase() + " A" : ""; };
// Everything else without a numeric grade counts as Ungraded: "CGC 0", "CGC AUTH", "Authenticated", blank.
export const isRawGrade = g => { g = String(g || "").trim(); if (authGrade(g)) return false; return !g || /^(raw|ungraded|none|n\/?a)$/i.test(g) || /^[a-z/]+\s*0$/i.test(g) || /auth/i.test(g); };
export function normGrade(g) {
  g = String(g || "").trim();
  return authGrade(g) || (isRawGrade(g) ? "Ungraded" : g);
}

export function gradeHtml(l, stack) {
  if (isRawGrade(l.grade)) {
    const raw = `<span class="slab raw">Ungraded</span>`, c = l.cert ? `<span class="cert">Cert ${esc(l.cert)}</span>` : "";
    return stack && c ? `<div class="gcell">${raw}${c}</div>` : raw + c;
  }
  const cert = l.cert ? `<span class="cert">Cert ${esc(l.cert)}</span>` : `<span class="cert">No cert on file</span>`;
  return stack ? `<div class="gcell"><span class="slab">${esc(l.grade)}</span>${cert}</div>` : `<span class="slab">${esc(l.grade)}</span>${cert}`;
}

// A Fanatics weekly auction # looks like WA180 or just 180. Other labels (VAULT, BIN) aren't timed auctions.
export const isAuctionNo = p => /^(wa)?\s*\d+$/i.test(String(p || "").trim());
// Auction end dates are plain days (YYYY-MM-DD) set per Fanatics Auction #.
export const fmtEnd = d => { const x = new Date(String(d).slice(0, 10) + "T12:00:00"); return isNaN(x) ? "" : x.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
export const auctionOver = d => !!d && String(d).slice(0, 10) < new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
// PC Sportscards cards only get a bid link when a real listing link was entered (a title search isn't specific enough).
export const bidLink = l => l.url || "";
export function timeLeft(iso) {
  if (!iso) return "";
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "Ended";
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
export const fmtDay = d => d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
export const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const endsSoon = l => l.ends && new Date(l.ends) - Date.now() < 864e5 && new Date(l.ends) > Date.now();

export function thumbsHtml(b, max) {
  const p = b.photos || [];
  if (!p.length) return '<span class="muted" style="font-size:12px">No photos</span>';
  return `<div class="thumbs">${p.slice(0, max).map((ph, i) => `<button class="thumb" type="button" data-ph="${esc(b.id)}" data-i="${i}" aria-label="Open photo ${i + 1} of batch ${esc(b.id)}"><img src="${ph.thumb}" alt=""></button>`).join("")}${p.length > max ? `<button class="thumb" type="button" data-ph="${esc(b.id)}" data-i="${max}" aria-label="See all ${p.length} photos">+${p.length - max}</button>` : ""}</div>`;
}

// Shrinks an image file to a JPEG data URL no larger than maxPx on its long side.
export function shrink(file, maxPx, quality) {
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, maxPx / Math.max(img.width, img.height)), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => res(null);
      img.src = fr.result;
    };
    fr.onerror = () => res(null);
    fr.readAsDataURL(file);
  });
}

/* ---------- card details ---------- */
// A "lot" is one SKU standing for many cards, like a monthly PC Sportscards payout.
export const isLot = l => !!(l && (l.kind === "dropoff" || l.lotCount > 1 || (l.items && l.items.length > 1) || /multi.?lot/i.test(l.title || "")));
export function lotLine(l, staff = true) {
  const n = l.items?.length || l.lotCount || 0;
  if (isDropoff(l)) {
    const sm = dropoffSummary(staff ? l.items : custItems(l.items));
    const k = sm.cards, nSold = sm.sold + sm.paid + (staff ? 0 : sm.awaiting);
    return [l.dropDate ? `Dropped off ${fmtDay(l.dropDate)}` : "", k ? `${k} card${k === 1 ? "" : "s"}` : (l.expected ? `${l.expected} cards, not itemized yet` : ""), nSold ? `${nSold} sold` : "", staff && sm.awaiting ? `${sm.awaiting} payment pending` : "", sm.live ? `${sm.live} listed` : ""].filter(Boolean).join(" · ");
  }
  return [n ? `${n} card${n === 1 ? "" : "s"}` : "", l.period ? (l.plat === "pcs" ? `${l.period} payout` : l.period) : ""].filter(Boolean).join(" · ");
}
const fmtLong = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
// Read-only details shared by the customer page and the staff app.
// eBay sold listings for a card, newest first, to help a consignor pick an asking price.
export function soldCompsUrl(l) {
  const g = l.grade && !isRawGrade(l.grade) && !(l.title || "").toLowerCase().includes(String(l.grade).toLowerCase()) ? ` ${l.grade}` : "";
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(((l.title || "") + g).replace(/\s+/g, " ").trim())}&LH_Sold=1&LH_Complete=1&_sop=13`;
}
export const askMinText = l => l.askMin != null ? ` · minimum offer ${money(l.askMin)}` : l.askPrice != null && "askMin" in l ? " · no offers" : "";
export function askFormHtml(l, staff = false) {
  return `<form class="askbox" data-askform="${esc(l.id)}">
    <h3 style="margin:0">${staff ? (l.askPrice != null ? "Change the customer’s asking price" : "Enter the customer’s asking price") : l.askPrice != null ? "Change your asking price" : "Set your asking price"}</h3>
    <p class="muted" style="margin:0">${staff ? "Customers see this box and fill it in themselves. If they gave you a price by phone, text or in the store, enter it here." : `This card will go up as a Buy It Now on ${PLAT[l.plat] || "the site"}. Tell us what you’d like to ask for it and we’ll list it.`}</p>
    <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div class="f" style="flex:0 0 160px"><label for="ask-price">Asking price ($)</label><input id="ask-price" type="text" inputmode="decimal" autocomplete="off" required value="${l.askPrice ?? ""}" placeholder="e.g. 250"></div>
      <div class="f" style="flex:0 0 200px"><label for="ask-min">Minimum Offer (Optional)</label><input id="ask-min" type="text" inputmode="decimal" autocomplete="off" value="${l.askMin ?? ""}" placeholder="Leave blank for no offers"></div>
      <button class="btn" type="submit">${staff ? "Save price" : l.askPrice != null ? "Update my price" : "Send my price"}</button>
    </div>
    <a href="${soldCompsUrl(l)}" target="_blank" rel="noopener">See what this card has sold for on eBay ↗</a>
    <div class="muted" data-askmsg role="status"></div>
  </form>`;
}
export function cardDetailHtml(l, c, { staff = false, canAsk = false } = {}) {
  const sold = isSold(l);
  const rows = [
    ["SKU", `<span class="code">${esc(l.sku)}</span>`],
    ["Status", `<span class="st ${l.status}">${STAT[l.status] || esc(l.status)}</span>`],
    ["Auction house", `<span class="chip ${l.plat}">${PLAT[l.plat] || "Other"}</span>`],
    ...(l.period ? [[l.plat === "pcs" ? "Payout month" : "Auction", esc(l.period)]] : []),
    ["Grade", gradeHtml(l, false)],
    ...(staff && c ? [["Consignor", `<span class="code">${esc(c.code)}</span> <button class="linkbtn" type="button" data-cust="${esc(c.id)}">${esc(c.name)}</button>`]] : []),
    ...(l.batch ? [["Batch", `<span class="code">${esc(l.batch)}</span>`]] : []),
    ...(l.added ? [["Added", fmtLong(l.added)]] : []),
    ...(l.status === "awaitprice" && l.askPrice != null ? [[staff ? "Customer asked" : "Your asking price", money(l.askPrice) + `<span class="muted">${askMinText(l)}</span>`]] : []),
    ...(l.status === "awaitprice" && !canAsk ? [["eBay sold listings", `<a href="${soldCompsUrl(l)}" target="_blank" rel="noopener">See what it has sold for ↗</a>`]] : []),
    ...(l.status === "live" ? (l.format === "bin" || (l.period && !isAuctionNo(l.period)) ? [["Asking price", money(l.price)]] : [["Auction", l.ends ? (auctionOver(l.ends) ? `Ended ${fmtEnd(l.ends)} · results coming soon` : `Live · ends ${fmtEnd(l.ends)}`) : "Live now"], ...(bidLink(l) ? [["Current bid", `<a href="${esc(bidLink(l))}" target="_blank" rel="noopener">See it on ${PLAT[l.plat]} ↗</a>`]] : [])]) : []),
    ...(sold ? [["Sold", fmtLong(l.soldDate)], ["Sale price", money(l.price)], ...(l.net != null ? [["After PC Sportscards fees", money(l.net)]] : []), ...(cardFee(l) && l.payout == null ? [["Fanatics CGC Authentication service fee", "−" + money(cardFee(l))]] : []), [staff ? "Consignor portion" : "Your share", shareText(cardPayout(l, c), staff) + (staff && l.payout == null && cardSplit(l, c) != null ? ` (${cardSplit(l, c)}%${l.split != null && l.split !== "" ? ", set for this card" : ""})` : "")]] : []),
    ...(l.pcsId ? [["PC Sportscards card #", `<span class="code">${esc(l.pcsId)}</span>`]] : []),
    ...(l.item ? [["eBay / listing #", `<span class="code">${esc(l.item)}</span>`]] : []),
    ...(l.url ? [["Listing", `<a href="${esc(l.url)}" target="_blank" rel="noopener">Open on ${PLAT[l.plat] || "the site"}</a>`]] : []),
  ];
  let lot = "";
  if (isDropoff(l)) {
    const items = staff ? l.items || [] : custItems(l.items), sm = dropoffSummary(l.items || []);
    const ST = staff ? ITEM_STAT : CUST_ITEM_STAT;
    const head = `Cards in this drop-off (${sm.cards}${l.expected && l.expected !== sm.cards ? ` of ${l.expected} dropped off` : ""})`;
    lot = `<div style="display:grid;gap:8px"><h3>${head}</h3>` + (items.length
      ? `<div class="tbl-wrap"><table class="prev" style="min-width:560px"><thead><tr>${staff ? '<th><input type="checkbox" id="dx-all" aria-label="Select all cards in this drop-off"></th>' : ""}<th>Card</th><th>Status</th><th>Sold</th><th>Price</th><th>After fees</th><th>${staff ? "Consignor share" : "Your share"}</th></tr></thead><tbody>${items.map((x, i) => `<tr>${staff ? `<td><input type="checkbox" class="dx" data-i="${i}" aria-label="Select ${esc(x.title)}"></td>` : ""}<td class="title">${esc(x.title)}${itemHistory(x, l.items, staff)}${x.pcsId && staff ? `<div class="cert">PC #${esc(x.pcsId)}</div>` : ""}${staff && x.reversal ? `<div class="flag rev">Sale reversed after payout · ${money(x.reversal.amount)} ${x.reversal.applied ? `deducted ${fmtDay(x.reversal.applied)}` : x.reversal.deduct ? "will come off their next payout" : "absorbed by Wheelhouse"}</div>${x.reversal.applied ? "" : `<button class="btn ghost sm" type="button" data-rev="${i}">${x.reversal.deduct ? "Don’t deduct (Wheelhouse absorbs)" : "Deduct from next payout"}</button>`}` : ""}<a class="ebay-find" href="${ebayFind(x)}" target="_blank" rel="noopener">Find on eBay ↗</a></td><td><span class="st ${x.status === "live" ? "live" : x.status === "awaiting" ? "sold" : x.status === "cancelled" ? "unsold" : x.status}">${ST[x.status] || esc(x.status)}</span>${staff && x.status === "awaiting" ? '<div class="flag">Waiting on buyer payment</div>' : ""}${payNote(x) ? `<div class="cert">${esc(payNote(x))}</div>` : ""}${staff && x.status === "cancelled" ? `<div class="flag">${x.relistedAs ? `Relisted as PC #${esc(x.relistedAs)}` : "Watch for the relist"}</div>` : ""}${staff && x.relistOf ? `<div class="cert">Relist of PC #${esc(x.relistOf)}</div>` : ""}</td><td class="num">${x.soldDate ? fmtLong(x.soldDate) : ""}</td><td class="num">${x.price && (staff || x.status !== "cancelled") ? money(x.price) : ""}</td><td class="num">${x.net != null && (x.status === "sold" || x.status === "paid") ? money(x.net) : ""}</td><td class="num">${x.status === "sold" || x.status === "paid" || x.status === "awaiting" ? (staff && isHouseRelist(x, l.items) ? '<span class="muted">Wheelhouse (customer already paid)</span>' : shareText(itemShare(x, c, l), staff)) : ""}</td></tr>`).join("")}<tr class="grp">${staff ? "<td></td>" : ""}<td>Total</td><td>${sm.sold + sm.paid} sold${sm.awaiting ? ` · ${sm.awaiting} pending` : ""}</td><td></td><td class="num">${money(sm.gross)}</td><td class="num">${money(sm.net)}</td><td class="num">${money(items.filter(x => ["sold", "paid", "awaiting"].includes(x.status) && !isHouseRelist(x, l.items)).reduce((s, x) => s + itemShare(x, c, l), 0))}</td></tr></tbody></table></div>`
      + (items.some(x => itemHistory(x, l.items, staff)) ? `<div class="muted" style="font-size:13px">${RELIST_NOTE}</div>` : "")
      : `<div class="empty" style="padding:16px">${staff ? "No cards in this drop-off yet. Select them in the PC Sportscards sorting list and add them here." : "We’re itemizing the cards from this drop-off. They’ll show up here once PC Sportscards lists them."}</div>`) + `</div>`;
  } else if (isLot(l)) {
    const items = l.items || [];
    const gross = items.reduce((s, x) => s + (x.price || 0), 0), net = items.reduce((s, x) => s + (x.net || 0), 0);
    lot = `<div style="display:grid;gap:8px"><h3>Cards in this ${l.plat === "pcs" ? "payout" : "lot"}${l.lotCount || items.length ? ` (${items.length || l.lotCount})` : ""}</h3>` + (items.length
      ? `<div class="tbl-wrap"><table class="prev" style="min-width:520px"><thead><tr><th>Card</th><th>Sold</th><th>Price</th>${items.some(x => x.net != null) ? "<th>After fees</th>" : ""}<th>Item #</th></tr></thead><tbody>${items.map(x => `<tr><td class="title">${esc(x.title)}</td><td class="num">${x.date ? fmtLong(x.date) : ""}</td><td class="num">${x.price != null ? money(x.price) : ""}</td>${items.some(y => y.net != null) ? `<td class="num">${x.net != null ? money(x.net) : ""}</td>` : ""}<td class="code">${esc(x.item || "")}</td></tr>`).join("")}<tr class="grp"><td>Total</td><td></td><td class="num">${money(gross)}</td>${items.some(x => x.net != null) ? `<td class="num">${money(net)}</td>` : ""}<td></td></tr></tbody></table></div>`
      : `<div class="empty" style="padding:16px">${staff ? `The individual cards for this ${l.plat === "pcs" ? "payout" : "lot"} haven’t been added yet. Upload the PC Sportscards statement below.` : "The card-by-card breakdown for this payout hasn’t been added yet. Ask us if you’d like it."}</div>`) + `</div>`;
  }
  const photo = l.photos?.length
    ? `<div style="display:grid;gap:6px"><h3>${isDropoff(l) ? "Photos from drop-off" : "Photos"}</h3><div class="thumbs">${l.photos.map((p, i) => `<button class="thumb big" type="button" data-ph="L:${esc(l.id)}" data-i="${i}" aria-label="Open photo ${i + 1}"><img src="${p.thumb}" alt=""></button>`).join("")}</div></div>`
    : l.photo ? `<img class="card-photo" data-photo="${esc(l.photo.id)}" src="${l.photo.thumb}" alt="Photo of ${esc(l.title)}">` : "";
  return `<div style="display:grid;gap:14px">
    ${photo}
    <div><div class="muted" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">${isLot(l) ? esc(lotLine(l, staff) || "Lot") : "Card details"}</div><h2 style="text-transform:none;letter-spacing:0;font-size:24px">${esc(l.title)}</h2></div>
    ${l.status === "awaitprice" && canAsk ? askFormHtml(l, staff || canAsk === "staff") : ""}
    <dl class="dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    ${lot}
  </div>`;
}
// Simple modal used for card details.
export function createModal() {
  const box = document.createElement("div");
  box.className = "modal"; box.hidden = true;
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Card details");
  box.innerHTML = `<div class="modal-card"><button class="lb-x modal-x" type="button" aria-label="Close">×</button><div class="modal-body"></div></div>`;
  document.body.appendChild(box);
  let back = null;
  const body = $(".modal-body", box);
  const close = () => { box.hidden = true; body.innerHTML = ""; back?.focus?.(); };
  $(".modal-x", box).addEventListener("click", close);
  box.addEventListener("click", e => { if (e.target === box) close(); });
  document.addEventListener("keydown", e => { if (!box.hidden && e.key === "Escape") close(); });
  return { body, open(html) { back = document.activeElement; body.innerHTML = html; box.hidden = false; $(".modal-x", box).focus(); }, close, get isOpen() { return !box.hidden; } };
}

/* ---------- photo viewer ---------- */
// loadFull(batch) → Promise<string[]> of full-size images in the same order as batch.photos
export function createLightbox(getBatch, loadFull) {
  const box = document.createElement("div");
  box.className = "lb"; box.hidden = true;
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Batch photos");
  box.innerHTML = `<button class="lb-x" type="button" aria-label="Close photos">×</button><button class="lb-p" type="button" aria-label="Previous photo">‹</button><img alt=""><button class="lb-n" type="button" aria-label="Next photo">›</button><div class="lb-load" hidden>Loading full size…</div><div class="lb-c"></div>`;
  document.body.appendChild(box);
  const img = $("img", box), cap = $(".lb-c", box), load = $(".lb-load", box);
  const cache = new Map();
  let batch = null, i = 0, full = null, back = null;
  function show() {
    const n = batch.photos.length;
    img.src = (full && full[i]) || batch.photos[i].thumb;
    img.alt = `Photo ${i + 1} of ${n}`;
    load.hidden = !!(full && full[i]);
    cap.textContent = `${batch.label || `Batch ${batch.id}`} · photo ${i + 1} of ${n}`;
    $(".lb-p", box).hidden = $(".lb-n", box).hidden = n < 2;
  }
  function open(b, idx) {
    batch = b; i = Math.min(idx, b.photos.length - 1); full = cache.get(b.id) || null; back = document.activeElement;
    box.hidden = false; show(); $(".lb-x", box).focus();
    if (!full) loadFull(b).then(f => { cache.set(b.id, f); if (batch === b) { full = f; show(); } }).catch(() => { load.textContent = "Couldn’t load the full-size photo."; });
  }
  function close() { box.hidden = true; img.src = ""; back?.focus?.(); }
  $(".lb-x", box).addEventListener("click", close);
  box.addEventListener("click", e => { if (e.target === box) close(); });
  $(".lb-p", box).addEventListener("click", () => { i = (i - 1 + batch.photos.length) % batch.photos.length; show(); });
  $(".lb-n", box).addEventListener("click", () => { i = (i + 1) % batch.photos.length; show(); });
  document.addEventListener("keydown", e => {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") $(".lb-p", box).click();
    if (e.key === "ArrowRight") $(".lb-n", box).click();
  });
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-ph]"); if (!t) return;
    const b = getBatch(t.dataset.ph);
    if (b && b.photos?.length) open(b, +t.dataset.i);
  });
  return { forget: id => cache.delete(id) };
}

/* ---------- batch progress, as the customer sees it ---------- */
// Fanatics and PC Sportscards can take a long time to curate and list a shipment,
// so a shipped batch with cards still unlisted gets a reassuring status instead of looking empty.
// Customers never see whether or when a batch shipped.
export function batchStage(b, cards) {
  const sent = b.cards || 0, where = PLAT[b.plat];
  const listed = cards.reduce((t, l) => t + (isDropoff(l) ? dropoffSummary(l.items).cards : l.status !== "curating" ? 1 : 0), 0);
  if (!listed) return { k: "curating", title: `Being curated for ${where}`, text: `We received your cards and they’re on their way to being listed on ${where}. Curating and photographing every card can take a while. Your cards will show up here as soon as they’re listed.` };
  if (sent && listed < sent) return { k: "partial", title: `${sent - listed} still being curated`, text: `${listed} of ${sent} cards are listed. ${where} is still working through the rest, and they’ll show up here as they’re listed.` };
  return null;
}
const stageHtml = s => s ? `<div class="notice ${s.k}"><b>${esc(s.title)}</b><span>${esc(s.text)}</span></div>` : "";

/* ---------- customer dashboard ---------- */
export function dashboardMarkup(pickerHtml = "") {
  return `
  <div class="who">
    <div><div class="muted" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">My consigned cards</div><h1 data-d="name"></h1><div data-d="contact" class="muted" style="margin-top:4px;overflow-wrap:anywhere"></div></div>
    ${pickerHtml}
  </div>
  <div class="stats" data-d="stats"></div>
  <div class="row" style="justify-content:space-between">
    <div class="tabs" data-d="tabs">
      <button type="button" data-t="all" aria-pressed="true">Everything</button>
      <button type="button" data-t="live" aria-pressed="false">Live now</button>
      <button type="button" data-t="sold" aria-pressed="false">Sold</button>
      <button type="button" data-t="batches" aria-pressed="false">Batches</button>
      <button type="button" data-t="payouts" aria-pressed="false">Payouts</button>
    </div>
    <select data-d="plat" style="width:auto" aria-label="Platform"><option value="">All auction houses</option>${Object.entries(PLAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
  </div>
  <div class="cards" data-d="cards"></div>
  <div class="muted" style="font-size:12px">Prices and bids are updated by Wheelhouse staff. Tap “View listing” to see the live page on Fanatics Collect or eBay.</div>`;
}

// Swap a details window's small photo for the full-size one once it loads.
export function loadFullPhoto(container, loadPhoto) {
  const img = container.querySelector("img[data-photo]");
  if (!img || !loadPhoto) return;
  loadPhoto(img.dataset.photo).then(src => { if (src && img.isConnected) img.src = src; }).catch(() => {});
}
export function mountDashboard(root, pickerHtml, { loadPhoto, staff = false, askPrice = null } = {}) {
  const gets = staff ? "Customer receives" : "You receive";
  root.innerHTML = dashboardMarkup(pickerHtml);
  const q = k => root.querySelector(`[data-d="${k}"]`);
  let tab = "all", data = null;
  q("tabs").addEventListener("click", e => {
    const t = e.target.dataset.t; if (!t) return;
    tab = t; [...q("tabs").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.t === t)); render();
  });
  q("plat").addEventListener("change", () => render());
  const modal = createModal();
  const openCard = id => {
    const l = data?.listings.find(x => x.id === id); if (!l) return;
    modal.open(cardDetailHtml(l, data.customer, { canAsk: askPrice ? (staff ? "staff" : true) : false })); loadFullPhoto(modal.body, loadPhoto);
    return l;
  };
  const openAsk = id => { const l = openCard(id); if (l) modal.body.querySelector("#ask-price")?.focus(); };
  modal.body.addEventListener("submit", async e => {
    const f = e.target.closest("[data-askform]"); if (!f) return; e.preventDefault();
    const num = v => Math.round(parseFloat(String(v).replace(/[$,\s]/g, "")) * 100) / 100; // accepts 250, $250, 1,250.50
    const price = num(f.querySelector("#ask-price").value), mv = f.querySelector("#ask-min").value.trim(), min = mv ? num(mv) : null, msg = f.querySelector("[data-askmsg]");
    if (!(price > 0)) { msg.textContent = "Enter a price above $0."; return; }
    if (min != null && isNaN(min)) { msg.textContent = "Enter the minimum offer as a number, like 200."; return; }
    if (min != null && !(min > 0 && min <= price)) { msg.textContent = "The minimum offer should be more than $0 and no higher than the asking price."; return; }
    f.querySelector("button").disabled = true; msg.textContent = "Sending…";
    try {
      await askPrice(f.dataset.askform, price, min);
      const l = data.listings.find(x => x.id === f.dataset.askform); if (l) Object.assign(l, { askPrice: price, askMin: min, askAt: new Date().toISOString() });
      render(); openCard(f.dataset.askform);
      const m2 = modal.body.querySelector("[data-askmsg]"); if (m2) m2.textContent = "Saved.";
    } catch (err) { f.querySelector("button").disabled = false; msg.innerHTML = `We couldn’t send that just now. Email your price to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and we’ll take care of it.`; }
  });
  root.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("article.card[data-card]")) { e.preventDefault(); e.target.click(); }
  });
  root.addEventListener("click", e => {
    const ask = e.target.closest("[data-ask]"); if (ask) { openAsk(ask.dataset.ask); return; }
    if (e.target.closest("a")) return;
    const t = e.target.closest("[data-card]"); if (!t || !data) return;
    const l = data.listings.find(x => x.id === t.dataset.card);
    if (l) openCard(l.id);
  });

  function render(next) {
    if (next) data = next;
    if (!data) return;
    const { customer: c, listings, batches } = data;
    if (!c) { q("name").textContent = "No account"; q("stats").innerHTML = ""; q("cards").innerHTML = '<div class="empty">No consignor selected.</div>'; return; }
    q("name").textContent = c.name;
    const pl = payLine(c);
    q("contact").innerHTML = `<span class="code">${esc(c.code)}</span> · ${esc(c.email || "No email on file")} · ${esc(c.phone || "No phone on file")}<br>${pl ? `Payouts go by ${esc(pl)}` : `Payout method not set yet. Tell us how you’d like to be paid <a href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("My payout method")}">here</a>.`}`;
    const mine = listings.filter(l => l.status !== "removed");
    const live = mine.filter(l => l.status === "live"), liveVal = live.reduce((s, l) => s + (l.price || 0), 0);
    const thirty = Date.now() - 30 * 864e5, sold30 = mine.filter(l => isSold(l) && new Date(l.soldDate || 0) > thirty);
    const owed = owedFor(c, mine).amount;
    const lastPaid = (c.payouts || []).slice(-1)[0];
    const ending = live.filter(l => l.format === "auction" && endsSoon(l)).length;
    q("stats").innerHTML = [
      ["Live now", live.length, `${live.filter(l => l.plat === "fan").length} Fanatics · ${live.filter(l => l.plat === "pcs").length} PC Sportscards`],
      ["Sold, last 30 days", sold30.length, money(sold30.reduce((s, l) => s + (l.price || 0), 0)) + " gross"],
      ["Payout pending", money(owed), ""],
    ].map(([k, v, s]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span>${s ? `<span class="s">${s}</span>` : ""}</div>`).join("");

    const fp = q("plat").value;
    if (tab === "payouts") {
      const ps = (c.payouts || []).slice().reverse();
      const next = owedFor(c, mine);
      const nextMonths = [...new Set(next.lines.map(x => monthKey(x.sold)).filter(Boolean))].sort();
      q("cards").innerHTML = `<div class="notice"><b>How payouts work</b><span>We pay out once a month, around the 5th, for everything that sold the month before.${next.amount > 0.004 ? ` Your next payout${nextMonths.length ? ` (${nextMonths.map(k => monthLabel(k)).join(" and ")} sales)` : ""} is ${money(next.amount)} so far.` : ""}</span></div>`
        + (ps.length ? ps.map(p => `<article class="card payout">
          <div style="display:grid;gap:6px;min-width:0;flex:1">
            <div class="t">${p.month ? `${esc(monthLabel(p.month, true))} payout` : "Payout"}</div>
            <div class="meta"><span>Paid ${fmtDay(p.date)}</span>${p.cards ? `<span>${p.cards} card${p.cards === 1 ? "" : "s"}</span>` : ""}${p.method ? `<span>${esc(PAYM[p.method] || p.method)}</span>` : ""}</div>
            ${p.lines?.length ? `<details><summary>See the cards</summary>${statementHtml(p.lines, { staff, deducted: p.deducted, carried: p.carried })}</details>` : ""}
          </div>
          <div class="right"><span class="sub">Paid</span><span class="amt recv">${money(p.amount)}</span></div>
        </article>`).join("") : '<div class="empty">No payouts yet. Your first one comes around the 5th of the month after a card sells.</div>');
      return;
    }
    if (tab === "batches") {
      const bl = batches.filter(b => !fp || b.plat === fp).sort((a, b) => (b.recv || "").localeCompare(a.recv || ""));
      q("cards").innerHTML = bl.length ? bl.map(b => {
        const cards = mine.filter(l => l.batch === b.id), lv = cards.filter(l => l.status === "live"), sold = cards.filter(isSold);
        const nListed = cards.reduce((t, l) => t + (isDropoff(l) ? dropoffSummary(l.items).cards : l.status !== "curating" ? 1 : 0), 0);
        const nSold = cards.reduce((t, l) => t + (isDropoff(l) ? (l.items || []).filter(x => ["awaiting", "sold", "paid"].includes(x.status)).length : isSold(l) ? 1 : 0), 0);
        const nLive = cards.reduce((t, l) => t + (isDropoff(l) ? (l.items || []).filter(x => x.status === "live").length : l.status === "live" ? 1 : 0), 0);
        return `<article class="card">
          <div style="display:grid;gap:8px;min-width:0">
            <div class="t">Batch <span class="code">${esc(b.id)}</span> <span class="chip ${b.plat}">${PLAT[b.plat]}</span></div>
            <div class="meta"><span>Received ${fmtDay(b.recv)}</span><span>${b.cards || cards.length} cards · ${nListed} listed · ${nSold} sold</span></div>
            ${stageHtml(batchStage(b, cards))}
            ${thumbsHtml(b, 8)}
          </div>
          <div class="right"><span class="sub">Listed now</span><span class="amt">${nLive}</span><span class="sub">${nSold} sold</span></div>
        </article>`;
      }).join("") : '<div class="empty">No batches logged yet.</div>';
      return;
    }
    // Shipped batches that aren't fully listed yet, summarized above the card list.
    const waiting = batches.filter(b => !fp || b.plat === fp).map(b => {
      const inB = mine.filter(l => l.batch === b.id), n = inB.reduce((t, l) => t + (isDropoff(l) ? dropoffSummary(l.items).cards : l.status !== "curating" ? 1 : 0), 0), s = batchStage(b, inB);
      return s ? { b, s, left: b.cards ? Math.max(0, b.cards - n) : null } : null;
    }).filter(Boolean);
    const prep = [];
    // Cards entered but not listed yet that aren't covered by a batch line above.
    const loose = mine.filter(l => l.status === "curating" && (!fp || l.plat === fp) && !waiting.some(x => x.b.id === l.batch) && !prep.some(b => b.id === l.batch));
    const looseBy = Object.keys(PLAT).map(k => [k, loose.filter(l => l.plat === k).length]).filter(([, n]) => n);
    let banner = "";
    const needPrice = mine.filter(l => l.status === "awaitprice" && l.askPrice == null);
    const priceBanner = needPrice.length && tab !== "sold" ? `<div class="notice ask"><b>${needPrice.length === 1 ? "1 card needs" : `${needPrice.length} cards need`} your asking price</b><span>${staff ? "The customer sets these from their portal." : "These will go up as Buy It Now listings. Tap <b>Set your price</b> on each one and we’ll list it."}</span></div>` : "";
    if (tab !== "sold" && (waiting.length || prep.length || loose.length)) {
      const lines = [
        ...looseBy.map(([k, n]) => `${n} card${n === 1 ? " is" : "s are"} being curated by ${PLAT[k]}.`),
        ...waiting.map(({ b, left }) => `${left != null ? `${left} card${left === 1 ? "" : "s"}` : "Cards"} from batch <span class="code">${esc(b.id)}</span> (received ${fmtDay(b.recv)}) ${left === 1 ? "is" : "are"} being curated for ${PLAT[b.plat]}.`),
        ...prep.map(b => `Batch <span class="code">${esc(b.id)}</span> is at Wheelhouse getting ready to ship to ${PLAT[b.plat]}.`),
      ];
      banner = `<div class="notice curating"><b>Some of your cards aren’t listed yet</b><span>That’s normal. ${waiting.length || loose.length ? "Fanatics Collect and PC Sportscards review every card before listing it, which can take a while. " : ""}They’ll show up here as soon as they go live.${loose.length ? " You can see them under Everything." : ""}</span><ul>${lines.map(t => `<li>${t}</li>`).join("")}</ul></div>`;
    }
    banner = priceBanner + banner;
    const list = mine.filter(l => (tab === "all" || (tab === "live" ? l.status === "live" : isSold(l) || l.status === "pending")) && (!fp || l.plat === fp))
      .sort((a, b) => {
        if (tab === "live") { const ea = a.ends ? new Date(a.ends) : Infinity, eb = b.ends ? new Date(b.ends) : Infinity; return ea - eb; }
        return new Date(b.soldDate || b.added) - new Date(a.soldDate || a.added);
      });
    const cardHtml = l => {
      const tl = l.format === "auction" && l.status === "live" ? timeLeft(l.ends) : "";
      let label, sub, recv = null, sub2 = "", liveAuc = false;
      if (isDropoff(l)) {
        const its = staff ? l.items || [] : custItems(l.items), sm = dropoffSummary(its);
        const soldIt = its.filter(x => ["sold", "paid", "awaiting"].includes(x.status) && !isHouseRelist(x, l.items)), share = soldIt.some(x => itemPct(x, l, c) == null) ? null : soldIt.reduce((t, x) => t + itemShare(x, c, l), 0);
        if (!staff) { sm.sold += sm.awaiting; sm.gross = soldIt.reduce((t, x) => t + (x.price || 0), 0); sm.awaiting = 0; }
        label = sm.sold + sm.paid ? "Sold so far" : "PC Sportscards";
        if (staff && (sm.awaiting || sm.relisting)) sub2 = [sm.awaiting ? `${sm.awaiting} awaiting payment` : "", sm.relisting ? `${sm.relisting} to be relisted` : ""].filter(Boolean).join(" · ");
        sub = !l.items?.length ? "Being itemized" : sm.sold + sm.paid ? `${gets} ${share == null ? "pending" : money(share)}` : sm.awaiting ? `${sm.awaiting} sold` : `${sm.live + sm.relisting} listed on eBay`;
        if (sm.sold + sm.paid) recv = share ?? "pending";
        l = { ...l, price: sm.sold + sm.paid ? sm.gross : null };
      }
      else if (l.status === "live" && l.format !== "bin" && (!l.period || isAuctionNo(l.period))) { label = "Live in auction"; liveAuc = true; }
      else if (l.status === "live") { label = "Asking"; sub = l.plat === "store" ? "For sale in store at Wheelhouse" : "Buy It Now"; }
      else if (l.status === "awaitprice") { label = l.askPrice != null ? (staff ? "Customer asked" : "Your asking price") : staff ? "Awaiting price" : "Waiting on your price"; l = { ...l, price: l.askPrice ?? null }; sub = l.askPrice != null ? (staff ? "List it and set it Live" : "We’ll list it soon") : staff ? "Waiting on the customer" : ""; }
      else if (l.status === "pending" && staff) { label = "Sale pending"; sub = "Waiting on the buyer’s payment"; }
      else if (l.status === "pending") { label = "Sold for"; recv = cardPayout(l, c) ?? "pending"; sub = payNote(l); }
      else if (l.status === "curating") { label = "Being curated"; sub = `${PLAT[l.plat]} is reviewing this card before listing it`; }
      else if (isSold(l)) { label = "Sold for"; recv = cardPayout(l, c) ?? "pending"; sub = staff && l.payout == null && cardSplit(l, c) != null ? `${cardSplit(l, c)}% split` + (l.status === "paid" ? " · paid" : "") : payNote(l); }
      else if (l.status === "returned") { label = "Returned to you"; sub = ""; }
      else { label = "Did not sell"; sub = "Ask us about relisting"; }
      return `<article class="card clickable" data-card="${esc(l.id)}" tabindex="0" aria-label="Details for ${esc(l.title)}">
        <div style="display:flex;gap:12px;align-items:flex-start;min-width:0">${l.photo ? `<button class="thumb" type="button" data-card="${esc(l.id)}" aria-label="Photo of ${esc(l.title)}"><img src="${l.photo.thumb}" alt=""></button>` : ""}<div style="display:grid;gap:6px;min-width:0">
          <div class="t">${esc(l.title)}</div>
          <div class="meta"><button class="linkbtn code" type="button" data-card="${esc(l.id)}" aria-label="Details for SKU ${esc(l.sku)}">SKU ${esc(l.sku)}</button>${isLot(l) ? `<span>${esc(lotLine(l, staff))}</span>` : ""}${l.batch ? `<span>Batch ${esc(l.batch)}</span>` : ""}<span class="chip ${l.plat}">${PLAT[l.plat]}</span>${gradeHtml(l, false)}${!staff && l.status === "pending" ? '<span class="st sold">Sold</span>' : `<span class="st ${l.status}">${STAT[l.status]}</span>`}${l.soldDate && l.status !== "live" ? `<span>${fmtDate(l.soldDate)}</span>` : ""}${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">View listing</a>` : ""}</div>
        </div></div>
        <div class="right">${liveAuc
          ? `<span class="sub">${label}</span><span class="amt" style="font-size:20px">${l.ends ? (auctionOver(l.ends) ? "Ended" : `Ends ${fmtEnd(l.ends)}`) : "Live now"}</span>${l.ends && auctionOver(l.ends) ? '<span class="sub">Results coming soon</span>' : ""}${bidLink(l) ? `<a class="bidlink" href="${esc(bidLink(l))}" target="_blank" rel="noopener">See current bid ↗</a>` : ""}`
          : recv != null
          ? `<span class="sub">${gets}</span><span class="amt recv">${recv === "pending" ? (staff ? '<span class="need" style="font-size:16px">Set PC %</span>' : '<span class="muted" style="font-size:16px">Pending</span>') : money(recv)}</span><span class="soldfor">${isDropoff(l) ? "Sold so far" : "Sold for"} ${money(l.price)}</span>`
          : `<span class="sub">${label}</span><span class="amt">${(isDropoff(l) && l.price == null) || l.status === "unsold" || l.status === "returned" || (l.status === "curating" && l.price == null) ? "—" : money(l.price)}</span>`}${liveAuc ? "" : `<span class="sub">${recv != null && isDropoff(l) ? "" : sub}</span>`}${sub2 ? `<span class="flag">${esc(sub2)}</span>` : ""}${l.status === "awaitprice" ? `<button class="btn sm" type="button" data-ask="${esc(l.id)}">${staff ? (l.askPrice != null ? "Change price" : "Enter price") : l.askPrice != null ? "Change my price" : "Set your price"}</button>` : ""}</div>
      </article>`;
    };
    const platOrder = ["fan", "pcs", "store", "goldin", "shibe", "other"];
    const groups = platOrder.map(p => [p, list.filter(l => (PLAT[l.plat] ? l.plat : "other") === p)]).filter(([, g]) => g.length);
    q("cards").innerHTML = banner + (list.length ? groups.map(([p, g]) => `<section class="platgroup"><h3 class="plathead ${p}">${PLAT[p]}<span class="n">${g.length} card${g.length === 1 ? "" : "s"}</span></h3>${g.map(cardHtml).join("")}</section>`).join("") : banner ? "" : `<div class="empty">${tab === "live" ? "Nothing live right now. New listings show up here as soon as we post them." : "No cards here yet."}</div>`);
  }
  return { render };
}
