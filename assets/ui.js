// Shared helpers and the customer dashboard, used by both the customer portal and the staff app.

export const $ = (s, r = document) => r.querySelector(s);
export const CONTACT_EMAIL = "consignment@wheelhousecards.com";
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = n => n == null || isNaN(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
export const PLAT = { fan: "Fanatics Collect", pcs: "PC Sportscards", store: "In store at Wheelhouse", goldin: "Goldin", shibe: "Shibe Sports", other: "Other" };
export const STAT = { curating: "Being curated", live: "Live", sold: "Sold", unsold: "Unsold", paid: "Paid out", returned: "Returned to you", removed: "Removed" };
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
// PC Sportscards cards carry their payout after PC Sportscards' fees (net); the consignor's split applies to that.
/* Payout splits, per card:
   - Fanatics Collect: 100% when the card sells for $200 or more, 90% under $200.
   - PC Sportscards: a flat 95% of what PC Sportscards pays after its fees.
   - Anything else: the consignor's default split.
   A card's own split (set in its details) overrides the rule, and an exact consignor portion
   (from the old system) overrides both. */
// Fixed splits for everyone (staff-only; customers never see a %). Fanatics Collect: 100% at $200 and up, 90% under $200.
// A single card can still be given its own split from its detail view.
// PC Sportscards: 80% of PC's payout, unless the consignor has a preferred rate (pcsPct), or a drop-off / card is set by hand.
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
export const isUngraded = l => !l.grade || /ungraded|cgc\s*auth/i.test(l.grade) || /cgc\s*auth/i.test(l.title || "");
export const cardFee = l => l.plat === "fan" && isUngraded(l) && l.net == null ? FAN_RAW_FEE : 0;
export const cardPayout = (l, c) => { if (l.payout != null) return l.payout; const p = cardSplit(l, c); return p == null ? null : Math.max(0, (l.net != null ? l.net : (l.price || 0)) - cardFee(l)) * p / 100; };
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
export const CUST_ITEM_STAT = { live: "Listed", awaiting: "Sold · payment pending", sold: "Sold", paid: "Paid out", unsold: "Unsold", cancelled: "Being relisted" };
// What the customer sees: a cancelled sale that's been relisted shows only as the new listing.
export const custItems = items => (items || []).filter(x => !(x.status === "cancelled" && x.relistedAs));
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
export const itemShare = (x, c, lot) => { const p = itemPct(x, lot, c); return p == null ? null : (x.net != null ? x.net : (x.price || 0)) * p / 100; };
export function dropoffSummary(items = []) {
  const n = k => items.filter(x => x.status === k).length;
  const soldItems = items.filter(x => x.status === "sold" || x.status === "paid");
  const open = n("cancelled") - items.filter(x => x.status === "cancelled" && x.relistedAs).length;
  const status = !items.length ? "curating" : n("live") || open ? "live" : n("awaiting") || n("sold") ? "sold" : n("paid") ? "paid" : "unsold";
  return { status, live: n("live"), awaiting: n("awaiting"), sold: n("sold"), paid: n("paid"), unsold: n("unsold"), cancelled: n("cancelled"), relisting: open,
    cards: items.length - (n("cancelled") - open), gross: soldItems.reduce((s, x) => s + (x.price || 0), 0), net: soldItems.reduce((s, x) => s + (x.net || 0), 0) };
}
// What Wheelhouse owes this consignor right now: sold-but-unpaid cards at their rate, plus any carried-over balance.
export function owedFor(c, listings) {
  const mine = listings.filter(l => l.cust === c.id);
  const soldAll = mine.filter(l => l.status === "sold" && !isDropoff(l));
  const itemsAll = mine.filter(isDropoff).flatMap(l => (l.items || []).filter(x => x.status === "sold").map(x => ({ ...x, lot: l })));
  // Sales with no PC % yet aren't counted until staff set one.
  const sold = soldAll.filter(l => cardPayout(l, c) != null), dropItems = itemsAll.filter(x => itemPct(x, x.lot, c) != null);
  const needPct = soldAll.length - sold.length + itemsAll.length - dropItems.length;
  return { cards: sold, dropItems, count: sold.length + dropItems.length, needPct,
    amount: sold.reduce((s, l) => s + cardPayout(l, c), 0) + dropItems.reduce((s, x) => s + itemShare(x, c, x.lot), 0) + (c?.payable || 0) };
}

export function detect(url) {
  const u = (url || "").toLowerCase();
  if (u.includes("fanaticscollect")) return { plat: "fan", item: (url.match(/(\d{5,})/) || [])[1] || "" };
  if (u.includes("ebay.")) return { plat: "pcs", item: (url.match(/\/itm\/(?:[^/]*\/)?(\d{9,})/) || url.match(/(\d{11,13})/) || [])[1] || "" };
  return null;
}

export function normGrade(g) {
  g = String(g || "").trim();
  // Fanatics exports list ungraded (authentic-only) cards as "CGC 0".
  return !g || /^(raw|ungraded|none|n\/?a)$/i.test(g) || /^[a-z]+\s*0$/i.test(g) ? "Ungraded" : g;
}

export function gradeHtml(l, stack) {
  if (!l.grade || l.grade === "Ungraded") {
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
export const bidLink = l => l.plat === "fan" ? l.url || "" : l.plat === "pcs" ? ebayFind(l) : l.url || "";
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
export function lotLine(l) {
  const n = l.items?.length || l.lotCount || 0;
  if (isDropoff(l)) {
    const sm = dropoffSummary(l.items);
    const k = sm.cards;
    return [l.dropDate ? `Dropped off ${fmtDay(l.dropDate)}` : "", k ? `${k} card${k === 1 ? "" : "s"}` : (l.expected ? `${l.expected} cards, not itemized yet` : ""), sm.sold + sm.paid ? `${sm.sold + sm.paid} sold` : "", sm.awaiting ? `${sm.awaiting} payment pending` : "", sm.live ? `${sm.live} listed` : ""].filter(Boolean).join(" · ");
  }
  return [n ? `${n} card${n === 1 ? "" : "s"}` : "", l.period ? (l.plat === "pcs" ? `${l.period} payout` : l.period) : ""].filter(Boolean).join(" · ");
}
const fmtLong = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
// Read-only details shared by the customer page and the staff app.
export function cardDetailHtml(l, c, { staff = false } = {}) {
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
      ? `<div class="tbl-wrap"><table class="prev" style="min-width:560px"><thead><tr>${staff ? '<th><input type="checkbox" id="dx-all" aria-label="Select all cards in this drop-off"></th>' : ""}<th>Card</th><th>Status</th><th>Sold</th><th>Price</th><th>After fees</th><th>${staff ? "Consignor share" : "Your share"}</th></tr></thead><tbody>${items.map((x, i) => `<tr>${staff ? `<td><input type="checkbox" class="dx" data-i="${i}" aria-label="Select ${esc(x.title)}"></td>` : ""}<td class="title">${esc(x.title)}${x.pcsId ? `<div class="cert">PC #${esc(x.pcsId)}</div>` : ""}<a class="ebay-find" href="${ebayFind(x)}" target="_blank" rel="noopener">Find on eBay ↗</a></td><td><span class="st ${x.status === "live" ? "live" : x.status === "awaiting" ? "sold" : x.status === "cancelled" ? "unsold" : x.status}">${ST[x.status] || esc(x.status)}</span>${staff && x.status === "awaiting" ? '<div class="flag">Waiting on buyer payment</div>' : ""}${staff && x.status === "cancelled" ? `<div class="flag">${x.relistedAs ? `Relisted as PC #${esc(x.relistedAs)}` : "Watch for the relist"}</div>` : ""}${staff && x.relistOf ? `<div class="cert">Relist of PC #${esc(x.relistOf)}</div>` : ""}</td><td class="num">${x.soldDate ? fmtLong(x.soldDate) : ""}</td><td class="num">${x.price && (staff || x.status !== "cancelled") ? money(x.price) : ""}</td><td class="num">${x.net != null && (x.status === "sold" || x.status === "paid") ? money(x.net) : ""}</td><td class="num">${x.status === "sold" || x.status === "paid" ? shareText(itemShare(x, c, l), staff) : x.status === "awaiting" ? '<span class="muted">Pending</span>' : ""}</td></tr>`).join("")}<tr class="grp">${staff ? "<td></td>" : ""}<td>Total</td><td>${sm.sold + sm.paid} sold${sm.awaiting ? ` · ${sm.awaiting} pending` : ""}</td><td></td><td class="num">${money(sm.gross)}</td><td class="num">${money(sm.net)}</td><td class="num">${money(items.filter(x => x.status === "sold" || x.status === "paid").reduce((s, x) => s + itemShare(x, c), 0))}</td></tr></tbody></table></div>`
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
    <div><div class="muted" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:600">${isLot(l) ? esc(lotLine(l) || "Lot") : "Card details"}</div><h2 style="text-transform:none;letter-spacing:0;font-size:24px">${esc(l.title)}</h2></div>
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
      <button type="button" data-t="live" aria-pressed="true">Live now</button>
      <button type="button" data-t="sold" aria-pressed="false">Sold</button>
      <button type="button" data-t="all" aria-pressed="false">Everything</button>
      <button type="button" data-t="batches" aria-pressed="false">Batches</button>
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
export function mountDashboard(root, pickerHtml, { loadPhoto, staff = false } = {}) {
  const gets = staff ? "Customer receives" : "You receive";
  root.innerHTML = dashboardMarkup(pickerHtml);
  const q = k => root.querySelector(`[data-d="${k}"]`);
  let tab = "live", data = null;
  q("tabs").addEventListener("click", e => {
    const t = e.target.dataset.t; if (!t) return;
    tab = t; [...q("tabs").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.t === t)); render();
  });
  q("plat").addEventListener("change", () => render());
  const modal = createModal();
  root.addEventListener("click", e => {
    const t = e.target.closest("[data-card]"); if (!t || !data) return;
    const l = data.listings.find(x => x.id === t.dataset.card);
    if (l) { modal.open(cardDetailHtml(l, data.customer)); loadFullPhoto(modal.body, loadPhoto); }
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
    if (tab !== "sold" && (waiting.length || prep.length || loose.length)) {
      const lines = [
        ...looseBy.map(([k, n]) => `${n} card${n === 1 ? " is" : "s are"} being curated by ${PLAT[k]}.`),
        ...waiting.map(({ b, left }) => `${left != null ? `${left} card${left === 1 ? "" : "s"}` : "Cards"} from batch <span class="code">${esc(b.id)}</span> (received ${fmtDay(b.recv)}) ${left === 1 ? "is" : "are"} being curated for ${PLAT[b.plat]}.`),
        ...prep.map(b => `Batch <span class="code">${esc(b.id)}</span> is at Wheelhouse getting ready to ship to ${PLAT[b.plat]}.`),
      ];
      banner = `<div class="notice curating"><b>Some of your cards aren’t listed yet</b><span>That’s normal. ${waiting.length || loose.length ? "Fanatics Collect and PC Sportscards review every card before listing it, which can take a while. " : ""}They’ll show up here as soon as they go live.${loose.length ? " You can see them under Everything." : ""}</span><ul>${lines.map(t => `<li>${t}</li>`).join("")}</ul></div>`;
    }
    const list = mine.filter(l => (tab === "all" || (tab === "live" ? l.status === "live" : isSold(l))) && (!fp || l.plat === fp))
      .sort((a, b) => {
        if (tab === "live") { const ea = a.ends ? new Date(a.ends) : Infinity, eb = b.ends ? new Date(b.ends) : Infinity; return ea - eb; }
        return new Date(b.soldDate || b.added) - new Date(a.soldDate || a.added);
      });
    q("cards").innerHTML = banner + (list.length ? list.map(l => {
      const tl = l.format === "auction" && l.status === "live" ? timeLeft(l.ends) : "";
      let label, sub, recv = null, sub2 = "", liveAuc = false;
      if (isDropoff(l)) {
        const sm = dropoffSummary(l.items), soldIt = (l.items || []).filter(x => x.status === "sold" || x.status === "paid"), share = soldIt.some(x => itemPct(x, l, c) == null) ? null : soldIt.reduce((t, x) => t + itemShare(x, c, l), 0);
        label = sm.sold + sm.paid ? "Sold so far" : "PC Sportscards";
        if (staff && (sm.awaiting || sm.relisting)) sub2 = [sm.awaiting ? `${sm.awaiting} awaiting payment` : "", sm.relisting ? `${sm.relisting} to be relisted` : ""].filter(Boolean).join(" · ");
        sub = !l.items?.length ? "Being itemized" : sm.sold + sm.paid ? `${gets} ${share == null ? "pending" : money(share)}` : sm.awaiting ? `${sm.awaiting} sold, payment pending` : `${sm.live + sm.relisting} listed on eBay`;
        if (sm.sold + sm.paid) recv = share ?? "pending";
        l = { ...l, price: sm.sold + sm.paid ? sm.gross : null };
      }
      else if (l.status === "live" && l.format !== "bin" && (!l.period || isAuctionNo(l.period))) { label = "Live in auction"; liveAuc = true; }
      else if (l.status === "live") { label = "Asking"; sub = l.plat === "store" ? "For sale in store at Wheelhouse" : "Buy It Now"; }
      else if (l.status === "curating") { label = "Being curated"; sub = `${PLAT[l.plat]} is reviewing this card before listing it`; }
      else if (isSold(l)) { label = "Sold for"; recv = cardPayout(l, c) ?? "pending"; sub = staff && l.payout == null && cardSplit(l, c) != null ? `${cardSplit(l, c)}% split` + (l.status === "paid" ? " · paid" : "") : l.status === "paid" ? "Paid out" : ""; }
      else if (l.status === "returned") { label = "Returned to you"; sub = ""; }
      else { label = "Did not sell"; sub = "Ask us about relisting"; }
      return `<article class="card">
        <div style="display:flex;gap:12px;align-items:flex-start;min-width:0">${l.photo ? `<button class="thumb" type="button" data-card="${esc(l.id)}" aria-label="Photo of ${esc(l.title)}"><img src="${l.photo.thumb}" alt=""></button>` : ""}<div style="display:grid;gap:6px;min-width:0">
          <div class="t">${esc(l.title)}</div>
          <div class="meta"><button class="linkbtn code" type="button" data-card="${esc(l.id)}" aria-label="Details for SKU ${esc(l.sku)}">SKU ${esc(l.sku)}</button>${isLot(l) ? `<span>${esc(lotLine(l))}</span>` : ""}${l.batch ? `<span>Batch ${esc(l.batch)}</span>` : ""}<span class="chip ${l.plat}">${PLAT[l.plat]}</span>${gradeHtml(l, false)}<span class="st ${l.status}">${STAT[l.status]}</span>${l.soldDate && l.status !== "live" ? `<span>${fmtDate(l.soldDate)}</span>` : ""}${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">View listing</a>` : ""}</div>
        </div></div>
        <div class="right">${liveAuc
          ? `<span class="sub">${label}</span><span class="amt" style="font-size:20px">${l.ends ? (auctionOver(l.ends) ? "Ended" : `Ends ${fmtEnd(l.ends)}`) : "Live now"}</span>${l.ends && auctionOver(l.ends) ? '<span class="sub">Results coming soon</span>' : ""}${bidLink(l) ? `<a class="bidlink" href="${esc(bidLink(l))}" target="_blank" rel="noopener">See current bid ↗</a>` : ""}`
          : recv != null
          ? `<span class="sub">${gets}</span><span class="amt recv">${recv === "pending" ? (staff ? '<span class="need" style="font-size:16px">Set PC %</span>' : '<span class="muted" style="font-size:16px">Pending</span>') : money(recv)}</span><span class="soldfor">${isDropoff(l) ? "Sold so far" : "Sold for"} ${money(l.price)}</span>`
          : `<span class="sub">${label}</span><span class="amt">${(isDropoff(l) && l.price == null) || l.status === "unsold" || l.status === "returned" || (l.status === "curating" && l.price == null) ? "—" : money(l.price)}</span>`}${liveAuc ? "" : `<span class="sub">${recv != null && isDropoff(l) ? "" : sub}</span>`}${sub2 ? `<span class="flag">${esc(sub2)}</span>` : ""}</div>
      </article>`;
    }).join("") : banner ? "" : `<div class="empty">${tab === "live" ? "Nothing live right now. New listings show up here as soon as we post them." : "No cards here yet."}</div>`);
  }
  return { render };
}
