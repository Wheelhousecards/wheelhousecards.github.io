// Shared helpers and the customer dashboard, used by both the customer portal and the staff app.

export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = n => n == null || isNaN(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
export const PLAT = { fan: "Fanatics Collect", pcs: "PC Sportscards" };
export const STAT = { curating: "Being curated", live: "Live", sold: "Sold", unsold: "Unsold", paid: "Paid out" };
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
// What Wheelhouse owes this consignor right now: sold-but-unpaid cards at their rate, plus any carried-over balance.
export function owedFor(c, listings) {
  const rate = (c?.rate ?? 85) / 100;
  const sold = listings.filter(l => l.cust === c.id && l.status === "sold");
  return { cards: sold, amount: sold.reduce((s, l) => s + (l.price || 0) * rate, 0) + (c?.payable || 0) };
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
    cap.textContent = `Batch ${batch.id} · photo ${i + 1} of ${n}`;
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
export function batchStage(b, cards) {
  const sent = b.cards || 0, listed = cards.filter(l => l.status !== "curating").length, where = PLAT[b.plat];
  if (!b.ship) return { k: "prep", title: "Getting ready to ship", text: `Your cards are safe at Wheelhouse. We’re preparing this batch to send to ${where}.` };
  if (!listed) return { k: "curating", title: `Being curated by ${where}`, text: `We shipped your cards on ${fmtDay(b.ship)}. ${where} is reviewing and photographing them before they go up for sale, which can take a while. Your cards will show up here as soon as they’re listed.` };
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
    <select data-d="plat" style="width:auto" aria-label="Platform"><option value="">Both platforms</option><option value="fan">Fanatics Collect</option><option value="pcs">PC Sportscards (eBay)</option></select>
  </div>
  <div class="cards" data-d="cards"></div>
  <div class="muted" style="font-size:12px">Prices and bids are updated by Wheelhouse staff. Tap “View listing” to see the live page on Fanatics Collect or eBay.</div>`;
}

export function mountDashboard(root, pickerHtml) {
  root.innerHTML = dashboardMarkup(pickerHtml);
  const q = k => root.querySelector(`[data-d="${k}"]`);
  let tab = "live", data = null;
  q("tabs").addEventListener("click", e => {
    const t = e.target.dataset.t; if (!t) return;
    tab = t; [...q("tabs").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.t === t)); render();
  });
  q("plat").addEventListener("change", () => render());

  function render(next) {
    if (next) data = next;
    if (!data) return;
    const { customer: c, listings, batches } = data;
    if (!c) { q("name").textContent = "No account"; q("stats").innerHTML = ""; q("cards").innerHTML = '<div class="empty">No consignor selected.</div>'; return; }
    q("name").textContent = c.name;
    const pl = payLine(c);
    q("contact").innerHTML = `<span class="code">${esc(c.code)}</span> · ${esc(c.email || "No email on file")} · ${esc(c.phone || "No phone on file")}<br>${pl ? `Payouts go by ${esc(pl)}` : "Payout method not set yet. Tell us how you’d like to be paid."}`;
    const rate = (c.rate ?? 85) / 100;
    const mine = listings;
    const live = mine.filter(l => l.status === "live"), liveVal = live.reduce((s, l) => s + (l.price || 0), 0);
    const thirty = Date.now() - 30 * 864e5, sold30 = mine.filter(l => isSold(l) && new Date(l.soldDate || 0) > thirty);
    const owed = mine.filter(l => l.status === "sold").reduce((s, l) => s + (l.price || 0) * rate, 0) + (c.payable || 0);
    const lastPaid = (c.payouts || []).slice(-1)[0];
    const ending = live.filter(l => l.format === "auction" && endsSoon(l)).length;
    q("stats").innerHTML = [
      ["Live now", live.length, `${live.filter(l => l.plat === "fan").length} Fanatics · ${live.filter(l => l.plat === "pcs").length} PC Sportscards`],
      ["Current value", money(liveVal), "Asking prices plus current bids"],
      ["Sold, last 30 days", sold30.length, money(sold30.reduce((s, l) => s + (l.price || 0), 0)) + " gross"],
      ["Payout pending", money(owed), `At your ${c.rate ?? 85}% rate` + (c.payable ? ` · includes ${money(c.payable)} carried over` : "") + (lastPaid ? ` · last paid ${money(lastPaid.amount)} on ${fmtDay(lastPaid.date)}` : "") + (ending ? ` · ${ending} ending today` : "")],
    ].map(([k, v, s]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join("");

    const fp = q("plat").value;
    if (tab === "batches") {
      const bl = batches.filter(b => !fp || b.plat === fp).sort((a, b) => (b.recv || "").localeCompare(a.recv || ""));
      q("cards").innerHTML = bl.length ? bl.map(b => {
        const cards = mine.filter(l => l.batch === b.id), lv = cards.filter(l => l.status === "live"), sold = cards.filter(isSold);
        return `<article class="card">
          <div style="display:grid;gap:8px;min-width:0">
            <div class="t">Batch <span class="code">${esc(b.id)}</span> <span class="chip ${b.plat}">${PLAT[b.plat]}</span></div>
            <div class="meta"><span>Received ${fmtDay(b.recv)}</span><span>${b.ship ? "Shipped " + fmtDay(b.ship) : '<span class="need">Not shipped yet</span>'}</span><span>${b.cards || cards.length} cards sent · ${cards.length} listed · ${sold.length} sold</span></div>
            ${stageHtml(batchStage(b, cards))}
            ${thumbsHtml(b, 8)}
          </div>
          <div class="right"><span class="sub">Live value</span><span class="amt">${money(lv.reduce((s, l) => s + (l.price || 0), 0))}</span><span class="sub">${lv.length} live now</span></div>
        </article>`;
      }).join("") : '<div class="empty">No batches logged yet.</div>';
      return;
    }
    // Shipped batches that aren't fully listed yet, summarized above the card list.
    const waiting = batches.filter(b => b.ship && (!fp || b.plat === fp)).map(b => {
      const inB = mine.filter(l => l.batch === b.id), n = inB.filter(l => l.status !== "curating").length, s = batchStage(b, inB);
      return s ? { b, s, left: b.cards ? Math.max(0, b.cards - n) : null } : null;
    }).filter(Boolean);
    const prep = batches.filter(b => !b.ship && (!fp || b.plat === fp));
    // Cards entered but not listed yet that aren't covered by a batch line above.
    const loose = mine.filter(l => l.status === "curating" && (!fp || l.plat === fp) && !waiting.some(x => x.b.id === l.batch) && !prep.some(b => b.id === l.batch));
    const looseBy = Object.keys(PLAT).map(k => [k, loose.filter(l => l.plat === k).length]).filter(([, n]) => n);
    let banner = "";
    if (tab !== "sold" && (waiting.length || prep.length || loose.length)) {
      const lines = [
        ...looseBy.map(([k, n]) => `${n} card${n === 1 ? " is" : "s are"} being curated by ${PLAT[k]}.`),
        ...waiting.map(({ b, left }) => `${left != null ? `${left} card${left === 1 ? "" : "s"}` : "Cards"} from batch <span class="code">${esc(b.id)}</span> ${left === 1 ? "is" : "are"} being curated by ${PLAT[b.plat]} (shipped ${fmtDay(b.ship)}).`),
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
      let label, sub;
      if (l.status === "live") { label = l.format === "bin" ? "Asking" : "Current bid"; sub = l.format === "bin" ? "Buy It Now" : (tl ? `<span class="${endsSoon(l) ? "soon" : ""}">Ends in ${tl}</span>` : "Auction"); }
      else if (l.status === "curating") { label = "Being curated"; sub = `${PLAT[l.plat]} is reviewing this card before listing it`; }
      else if (isSold(l)) { label = "Sold for"; sub = `You receive ${money((l.price || 0) * rate)}` + (l.status === "paid" ? " · paid" : ""); }
      else { label = "Did not sell"; sub = "Ask us about relisting"; }
      return `<article class="card">
        <div style="display:grid;gap:6px;min-width:0">
          <div class="t">${esc(l.title)}</div>
          <div class="meta"><span class="code">SKU ${esc(l.sku)}</span>${l.batch ? `<span>Batch ${esc(l.batch)}</span>` : ""}<span class="chip ${l.plat}">${PLAT[l.plat]}</span>${gradeHtml(l, false)}<span class="st ${l.status}">${STAT[l.status]}</span>${l.soldDate && l.status !== "live" ? `<span>${fmtDate(l.soldDate)}</span>` : ""}${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">View listing</a>` : ""}</div>
        </div>
        <div class="right"><span class="sub">${label}</span><span class="amt">${l.status === "unsold" || (l.status === "curating" && l.price == null) ? "—" : money(l.price)}</span><span class="sub">${sub}</span></div>
      </article>`;
    }).join("") : banner ? "" : `<div class="empty">${tab === "live" ? "Nothing live right now. New listings show up here as soon as we post them." : "No cards here yet."}</div>`);
  }
  return { render };
}
