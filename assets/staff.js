// Staff app: consignors, listings, batches, imports and bulk edits, all synced live through Firestore.
import { db, logout } from "./firebase.js?v=20261030172120";
import {
  collection, doc, onSnapshot, getDoc, getDocs, query, where,
  writeBatch, runTransaction, setDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, esc, money, PLAT, STAT, pad6, plural, isSold, detect, normGrade, gradeHtml, timeLeft,
  fmtDay, today, thumbsHtml, shrink, createLightbox, mountDashboard, PAYM, payLine, owedFor,
  isLot, lotLine, cardDetailHtml, createModal, loadFullPhoto, cardPayout,
  isDropoff, ITEM_STAT, dropoffSummary, itemShare
} from "./ui.js?v=20261030172120";
import { setupGate, gateMarkup } from "./gate.js?v=20261030172120";

/* ---------- state ---------- */
// Cards still in play (being curated, live, sold-unpaid, unsold) stay synced live. Paid-out and returned
// cards (thousands from the old system) load only when needed, so the app stays inside Firestore's free daily reads.
// "removed" is a recycle bin: removed cards can be restored until they're deleted for good.
const ACTIVE = ["curating", "live", "sold", "unsold"], PAST = ["paid", "returned", "removed"];
const S = { pool: [], imports: [], customers: [], active: [], hist: null, batches: [], staff: [], notes: {}, counters: {}, _all: null };
// S.all includes removed cards (for the Removed tab, restores and SKU checks); S.listings leaves them out.
Object.defineProperty(S, "all", { get() {
  if (!S._all) {
    if (!S.hist) S._all = S.active;
    else { const m = new Map(S.hist.map(l => [l.id, l])); S.active.forEach(l => m.set(l.id, l)); S._all = [...m.values()]; }
    S._live = S._all.filter(l => l.status !== "removed");
  }
  return S._all;
} });
Object.defineProperty(S, "listings", { get() { S.all; return S._live; } });
let histUnsub = null, histReady = null;
function loadHistory() {
  if (histReady) return histReady;
  histReady = new Promise(res => {
    histUnsub = onSnapshot(query(col("listings"), where("status", "in", PAST)), s => {
      S.hist = s.docs.map(d => ({ id: d.id, ...d.data() })); S._all = null; res(); render();
    }, e => { console.error(e); res(); });
    unsubs.push(histUnsub);
  });
  return histReady;
}
const custHist = new Map();
const ui = { view: "play", mode: "staff", cv: "", sel: new Set(), visible: [] };
let me = "", unsubs = [], ready = new Set();
const custById = id => S.customers.find(c => c.id === id);
const batchById = id => S.batches.find(b => b.id === id);
const emailOf = id => custById(id)?.email || "";
const maxSku = () => S.all.reduce((m, l) => Math.max(m, parseInt(l.sku, 10) || 0), 0);
const maxBatchNo = () => S.batches.reduce((m, b) => Math.max(m, parseInt(String(b.id).replace(/\D/g, ""), 10) || 0), 0);
const nextSku = () => pad6(Math.max(S.counters.sku || 0, maxSku()) + 1);
const now = () => new Date().toISOString();

const views = ["gate", "loading", "denied", "staff", "cust"];
const show = v => views.forEach(id => { $("#" + id).hidden = id !== v; });

/* ---------- Firestore helpers ---------- */
const col = name => collection(db, name);
async function reserve(field, n, floor) {
  const ref = doc(db, "meta", "counters");
  return runTransaction(db, async tx => {
    const s = await tx.get(ref);
    const cur = s.exists() ? (s.data()[field] || 0) : 0;
    const start = Math.max(cur, floor) + 1;
    tx.set(ref, { [field]: start + n - 1 }, { merge: true });
    return start;
  });
}
async function bump(field, value) {
  const ref = doc(db, "meta", "counters");
  await runTransaction(db, async tx => {
    const s = await tx.get(ref);
    const cur = s.exists() ? (s.data()[field] || 0) : 0;
    if (value > cur) tx.set(ref, { [field]: value }, { merge: true });
  });
}
// ops: [["set"|"update"|"delete", ref, data]]
async function commit(ops) {
  // When a card changes owner, its photo has to follow so the new owner can open it.
  const fix = new Map();
  ops.forEach(([t, ref, data]) => {
    if (t !== "update" || !data || !("custEmail" in data)) return;
    const l = S.listings.find(x => x.id === ref.id);
    [l?.photo, ...(l?.photos || [])].filter(p => p?.id && !fix.has(p.id)).forEach(p => fix.set(p.id, ["update", doc(db, "photos", p.id), { cust: data.cust ?? l.cust ?? "", custEmail: data.custEmail }]));
  });
  ops = [...ops, ...fix.values()];
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(([t, ref, data]) => {
      if (t === "set") b.set(ref, data, { merge: true });
      else if (t === "update") b.update(ref, data);
      else b.delete(ref);
    });
    await b.commit();
  }
}
const errText = e => (e?.code || "").includes("permission-denied")
  ? "Your account doesn’t have permission to do that. Ask an owner to check your staff access."
  : "Couldn’t save. Check your connection and try again.";
async function guarded(el, fn) {
  try { return await fn(); }
  catch (e) { console.error(e); if (el) el.textContent = errText(e); return undefined; }
}
const listingRef = id => doc(db, "listings", id);
const upd = (id, data) => ["update", listingRef(id), { ...data, updatedAt: serverTimestamp() }];

/* ---------- auth ---------- */
$("#gate").innerHTML = gateMarkup("Staff sign in", "Use the email that’s on the Wheelhouse staff list. First time here? Choose “Create account” with that email.");
setupGate($("#gate"), async user => {
  unsubs.forEach(u => u()); unsubs = []; ready.clear(); histUnsub = null; histReady = null; S.hist = null; S._all = null; custHist.clear();
  if (!user) { $("#acct").hidden = true; $("#modes").hidden = true; show("gate"); return; }
  me = (user.email || "").toLowerCase();
  $("#acct").hidden = false; $("#acct-email").textContent = me;
  show("loading");
  let ok = false;
  try { ok = (await getDoc(doc(db, "staff", me))).exists(); } catch (e) { ok = false; }
  if (!ok) { $("#denied-msg").textContent = `${me} doesn’t have staff access. Ask an owner to add it under Staff access.`; show("denied"); return; }
  $("#modes").hidden = false;
  listen();
});
$("#logout").addEventListener("click", () => logout());
$("#denied-out").addEventListener("click", () => logout());

function listen() {
  const need = ["customers", "listings", "batches", "staff", "notes"];
  const done = k => { ready.add(k); if (need.every(n => ready.has(n))) { setMode(ui.mode); } };
  const fail = e => { console.error(e); $("#loading").textContent = "Couldn’t load data. Refresh the page to try again."; };
  const sub = (name, key, map) => unsubs.push(onSnapshot(col(name), s => { S[key] = s.docs.map(map); done(key); render(); }, fail));
  sub("customers", "customers", d => ({ id: d.id, ...d.data() }));
  unsubs.push(onSnapshot(query(col("listings"), where("status", "in", ACTIVE)), s => { S.active = s.docs.map(d => ({ id: d.id, ...d.data() })); S._all = null; done("listings"); render(); }, fail));
  sub("batches", "batches", d => ({ id: d.id, ...d.data() }));
  sub("staff", "staff", d => ({ id: d.id, ...d.data() }));
  unsubs.push(onSnapshot(col("batchNotes"), s => { S.notes = Object.fromEntries(s.docs.map(d => [d.id, d.data().notes || ""])); done("notes"); render(); }, fail));
  unsubs.push(onSnapshot(col("meta"), s => {
    const c = s.docs.find(d => d.id === "counters"); S.counters = c ? c.data() : {};
    const pool = s.docs.find(d => d.id === "pcsPool"); S.pool = pool ? (pool.data().rows || []) : [];
    S.imports = s.docs.filter(d => d.id.startsWith("imp-")).map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id));
    render();
  }, () => {}));
}

/* ---------- shell ---------- */
const loadPhoto = async id => { const d = await getDoc(doc(db, "photos", id)); return d.exists() ? d.data().data : null; };
const dash = mountDashboard($("#cust"), `<div class="sel" style="display:grid;gap:4px;width:min(280px,100%)"><label for="cv-pick">Preview as consignor</label><select id="cv-pick"></select></div>`, { loadPhoto });
$("#cv-pick").addEventListener("change", e => { ui.cv = e.target.value; try { history.replaceState({ v: "cust", cv: ui.cv }, "", "#customer"); } catch (err) {} render(); });
// Opening a customer page adds a browser history entry, so the browser's back button
// (and the "Back to staff" button) returns to the staff app where you left off.
let staffScroll = 0;
function setMode(m, fromHistory) {
  const was = ui.mode;
  if (m === "cust" && was !== "cust" && !$("#staff").hidden) staffScroll = window.scrollY;
  ui.mode = m;
  $("#m-staff").setAttribute("aria-pressed", m === "staff"); $("#m-cust").setAttribute("aria-pressed", m === "cust");
  $("#back").hidden = m !== "cust";
  show(m); render();
  if (!fromHistory && m === "cust" && was !== "cust") { try { history.pushState({ v: "cust", cv: ui.cv }, "", "#customer"); } catch (err) {} }
  if (m === "cust" && was !== "cust") window.scrollTo(0, 0);
  if (m === "staff" && was === "cust") requestAnimationFrame(() => window.scrollTo(0, staffScroll));
}
function backToStaff() {
  if (history.state && history.state.v === "cust") history.back();
  else setMode("staff");
}
window.addEventListener("popstate", e => {
  if (!ready.has("customers")) return;
  const st = e.state;
  if (st && st.v === "cust") { if (st.cv) ui.cv = st.cv; setMode("cust", true); }
  else if (ui.mode === "cust") setMode("staff", true);
});
if (location.hash === "#customer") { try { history.replaceState(null, "", location.pathname); } catch (err) {} }
$("#m-staff").addEventListener("click", () => { if (ui.mode === "cust") backToStaff(); });
$("#m-cust").addEventListener("click", () => { if (ui.mode !== "cust") setMode("cust"); });
$("#back").addEventListener("click", backToStaff);
function render() {
  if (!["customers", "listings", "batches"].every(k => ready.has(k))) return;
  if (ui.mode === "staff") renderStaff(); else renderCust();
}
function renderCust() {
  if (!custById(ui.cv)) ui.cv = [...S.customers].sort(byName)[0]?.id || "";
  $("#cv-pick").innerHTML = custOptions(ui.cv);
  const c = custById(ui.cv);
  const id = ui.cv;
  let mine = S.listings.filter(l => l.cust === id);
  if (!S.hist && c) {
    // Pull this one customer's past cards so the preview matches what they see.
    if (!custHist.has(id)) { custHist.set(id, null); getDocs(query(col("listings"), where("cust", "==", id))).then(s => { custHist.set(id, s.docs.map(d => ({ id: d.id, ...d.data() }))); if (ui.mode === "cust" && ui.cv === id) renderCust(); }).catch(() => custHist.delete(id)); }
    const h = custHist.get(id);
    if (h) { const m = new Map(h.filter(l => PAST.includes(l.status)).map(l => [l.id, l])); mine.forEach(l => m.set(l.id, l)); mine = [...m.values()]; }
  }
  dash.render({ customer: c, listings: mine, batches: S.batches.filter(b => b.cust === id) });
}
setInterval(() => { const a = document.activeElement; if (!a || !["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName)) render(); }, 60000);

createLightbox(id => {
  if (id.startsWith("L:")) { const l = S.all.find(x => x.id === id.slice(2)); return l && { id: l.id, label: l.title, photos: l.photos || [] }; }
  return batchById(id);
}, async b => Promise.all(b.photos.map(async p => { try { const d = await getDoc(doc(db, "photos", p.id)); return d.exists() ? d.data().data : p.thumb; } catch (e) { return p.thumb; } })));

/* ---------- staff render ---------- */
const byName = (a, b) => a.name.localeCompare(b.name);
function custOptions(sel, withAll) {
  return (withAll ? '<option value="">All consignors</option>' : "") + [...S.customers].sort(byName).map(c => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${esc(c.name)} · ${esc(c.code)}</option>`).join("");
}
function batchOptions(sel, first) {
  return first + [...S.batches].sort((a, b) => b.id.localeCompare(a.id)).map(b => `<option value="${b.id}"${b.id === sel ? " selected" : ""}>${esc(b.id)} · ${esc(custById(b.cust)?.name || "No customer")} · ${PLAT[b.plat]}</option>`).join("");
}

function renderStaff() {
  if (!$("#a-sku").dataset.manual) $("#a-sku").value = nextSku();
  $("#a-cust").innerHTML = S.customers.length ? custOptions($("#a-cust").value || "") .replace(/^/, '<option value="">Choose…</option>') : '<option value="">Add a consignor first</option>';
  $("#a-batch").innerHTML = batchOptions($("#a-batch").value, '<option value="">No batch</option>');
  renderCustList();
  renderPayouts();
  renderSort();
  renderStaffList();
  renderBatches();
  renderLedger();
  if (imp && !importing) renderImport();
  renderImports();
}

function renderCustList() {
  const q = $("#c-q").value.trim().toLowerCase();
  const list = [...S.customers].sort(byName).filter(c => !q || [c.name, c.code, c.email, c.phone, c.payTo, c.company].join(" ").toLowerCase().includes(q));
  const cnt = new Map();
  for (const l of S.listings) { const k = cnt.get(l.cust) || cnt.set(l.cust, { n: 0, live: 0 }).get(l.cust); k.n++; if (l.status === "live") k.live++; }
  $("#custList").innerHTML = list.length ? list.map(c => {
    const k = cnt.get(c.id) || { n: 0, live: 0 }, live = k.live;
    const tot = S.hist ? `${live} live / ${k.n} total` : `${live} live / ${k.n} in play`;
    return `<div class="cust"><span class="code">${esc(c.code)}</span><div style="min-width:0"><div style="font-weight:600">${esc(c.name)}</div><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(c.email || "No email")} · ${esc(c.phone || "No phone")}</div><div class="muted" style="font-size:12px">${c.rate ?? 85}% payout · ${tot}${c.payable ? ` · <span class="need">${money(c.payable)} carried over</span>` : ""}</div><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${payLine(c) ? esc(payLine(c)) : '<span class="need">No payout method</span>'}${c.notify === false ? " · payout emails off" : ""}${c.payNote ? ` · ${esc(c.payNote)}` : ""}</div></div><div class="row" style="gap:6px"><button class="btn ghost sm" type="button" data-edit="${c.id}">Edit</button><button class="btn ghost sm" type="button" data-view="${c.id}">View</button></div></div>`;
  }).join("") : `<div class="empty">${S.customers.length ? "No consignors match that search." : "No consignors yet. Add one below."}</div>`;
}

function renderLedger() {
  const tb = $("#tbody");
  if (tb.contains(document.activeElement) && document.activeElement.tagName !== "BUTTON" && document.activeElement.type !== "checkbox") { tb.dataset.stale = "1"; return; }
  delete tb.dataset.stale;
  const fc = $("#f-cust").value;
  $("#f-cust").innerHTML = custOptions(fc, true).replace("</option>", `</option><option value="__none"${fc === "__none" ? " selected" : ""}>Needs consignor</option>`);
  const fb = $("#f-batch").value;
  $("#f-batch").innerHTML = batchOptions(fb, `<option value="">All batches</option><option value="__nob"${fb === "__nob" ? " selected" : ""}>Not in a batch</option>`);
  const q = $("#f-q").value.trim().toLowerCase(), fp = $("#f-plat").value, fs = $("#f-st").value;
  const view = ui.view, past = view !== "play";
  const fav = $("#f-added").value, fa = fav === "today" ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString() : fav === "7d" ? new Date(Date.now() - 7 * 864e5).toISOString() : fav === "1h" ? new Date(Date.now() - 36e5).toISOString() : "";
  const loading = past && !S.hist;
  const rows = (loading ? [] : S.all).filter(l =>
    (view === "all" ? l.status !== "removed" : view === "play" ? !PAST.includes(l.status) : l.status === view) &&
    (!fa || (l.added || "") >= fa) &&
    (!fc || (fc === "__none" ? !custById(l.cust) : l.cust === fc)) &&
    (!fp || l.plat === fp) && (!fs || l.status === fs) &&
    (!fb || (fb === "__nob" ? !batchById(l.batch) : l.batch === fb)) &&
    (!q || [l.sku, l.title, l.item, l.grade, l.cert].join(" ").toLowerCase().includes(q))
  ).sort(view === "paid" || view === "returned"
    ? (a, b) => (b.soldDate || b.added || "").localeCompare(a.soldDate || a.added || "") || (b.sku || "").localeCompare(a.sku || "")
    : (a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1) || (b.sku || "").localeCompare(a.sku || ""));
  const viewName = { play: "in play", paid: "paid out", returned: "returned", all: "in total", removed: "removed" }[view];
  $("#bb-del").hidden = view === "removed"; $("#bb-restore").hidden = view !== "removed"; $("#bb-purge").hidden = view !== "removed";
  $("#count").textContent = loading ? "Loading past cards…" : `${rows.length.toLocaleString()} card${rows.length === 1 ? "" : "s"} ${viewName}` + (view === "paid" && rows.length ? ` · ${money(rows.reduce((s, l) => s + (l.price || 0), 0))} in sales` : "");
  $("#th-price").textContent = view === "paid" ? "Sale / to consignor" : "Price / bid";
  $("#th-when").textContent = view === "paid" ? "Sold" : view === "returned" ? "Added" : "Ends";
  ui.visible = rows.map(l => l.id);
  const custSel = [...S.customers].sort(byName).map(x => `<option value="${x.id}">${esc(x.name)} · ${esc(x.code)}</option>`).join("");
  const shown = rows.slice(0, 500);
  tb.innerHTML = shown.length ? shown.map(l => {
    const c = custById(l.cust), on = ui.sel.has(l.id);
    return `<tr data-id="${l.id}"${on ? ' class="on"' : ""}>
      <td><input type="checkbox" class="sel" aria-label="Select SKU ${esc(l.sku)}"${on ? " checked" : ""}></td>
      <td class="code num"><button class="linkbtn code" type="button" data-open="${l.id}" aria-label="Details for SKU ${esc(l.sku)}">${esc(l.sku)}</button>${l.batch && batchById(l.batch) ? `<div class="cert">${esc(l.batch)}</div>` : ""}</td>
      <td>${c ? `<span class="code">${esc(c.code)}</span> ${esc(c.name)}` : `<select data-f="cust" aria-label="Assign a consignor to SKU ${esc(l.sku)}" style="border-color:var(--paid)"><option value="">Needs consignor…</option>${custSel}</select>`}</td>
      <td><span class="chip ${l.plat}">${l.plat === "fan" ? "Fanatics" : "PCS / eBay"}</span></td>
      <td class="title">${l.photo ? `<img src="${l.photo.thumb}" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:6px">` : ""}${esc(l.title)}${isLot(l) ? `<div class="cert">${esc(lotLine(l))}</div>` : ""}${l.item ? `<div class="muted" style="font:12px var(--mono)">#${esc(l.item)}</div>` : ""}</td>
      <td>${gradeHtml(l, true)}</td>
      <td>${l.format === "bin" ? "Buy It Now" : "Auction"}</td>
      <td><input class="price num" type="number" step="0.01" min="0" value="${l.price ?? ""}" data-f="price" aria-label="Price for SKU ${esc(l.sku)}">${l.status === "paid" || l.status === "sold" ? `<div class="cert">${money(cardPayout(l, custById(l.cust)))} to consignor</div>` : ""}</td>
      <td class="num">${l.status === "live" && l.format === "auction" ? esc(timeLeft(l.ends)) : PAST.includes(l.status) || l.status === "sold" ? esc(fmtDay((l.soldDate || l.added || "").slice(0, 10))) : ""}</td>
      <td>${isDropoff(l) ? `<span class="st ${l.status}">${STAT[l.status]}</span>` : `<select data-f="status" aria-label="Status for SKU ${esc(l.sku)}">${Object.keys(STAT).filter(k => k !== "removed").map(k => `<option value="${k}"${k === l.status ? " selected" : ""}>${STAT[k]}</option>`).join("")}</select>`}</td>
      <td>${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">Open</a>` : `<input data-f="url" placeholder="Paste link" aria-label="Listing link for SKU ${esc(l.sku)}" style="width:120px">`}</td>
      <td><button class="x" type="button" data-del aria-label="Remove SKU ${esc(l.sku)}">${delOne === l.id ? "Sure?" : "×"}</button></td></tr>`;
  }).join("") + (rows.length > 500 ? `<tr><td colspan="12" class="muted">Showing the first 500 of ${rows.length}. Search or filter to narrow it down.</td></tr>` : "")
    : `<tr><td colspan="12"><div class="empty">${S.listings.length ? "No cards match these filters." : "No cards yet. Add a listing above or import a spreadsheet."}</div></td></tr>`;
  renderBulk();
}
$("#tbody").addEventListener("focusout", () => setTimeout(() => { if ($("#tbody").dataset.stale && !$("#tbody").contains(document.activeElement)) renderLedger(); }, 0));
["#f-q", "#f-cust", "#f-plat", "#f-st", "#f-batch", "#f-added"].forEach(s => $(s).addEventListener("input", renderLedger));
function setView(v) {
  ui.view = v; ui.sel.clear();
  [...$("#views").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
  if (v !== "play") loadHistory();
  renderLedger();
}
$("#views").addEventListener("click", e => { const v = e.target.dataset.v; if (v) setView(v); });
$("#f-st").addEventListener("change", e => { if (PAST.includes(e.target.value) && ui.view === "play") setView("all"); });
$("#f-q").addEventListener("change", e => { const q = e.target.value.trim().toLowerCase(); if (q && ui.view === "play" && !S.listings.some(l => !PAST.includes(l.status) && [l.sku, l.title, l.cert].join(" ").toLowerCase().includes(q))) { setView("all"); $("#ledger-msg").textContent = "Nothing in play matched, so this shows everything, including paid-out and returned cards."; } });
$("#c-q").addEventListener("input", renderCustList);

/* ---------- add a listing ---------- */
$("#a-url").addEventListener("input", e => {
  const d = detect(e.target.value);
  $("#detect").innerHTML = !e.target.value ? "No link yet? Leave it blank and the card shows as Being curated until you add one." : d ? `Detected <span class="chip ${d.plat}">${PLAT[d.plat]}</span>${d.item ? ` · item <span class="code">#${esc(d.item)}</span>` : ""}` : "Not a Fanatics Collect or eBay link.";
  if (d) $("#a-plat").value = d.plat;
  if (d && d.plat === "pcs") $("#a-format").value = "auction";
});
$("#a-sku").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); if (e.target.value) e.target.dataset.manual = "1"; else delete e.target.dataset.manual; });
$("#a-sku").addEventListener("blur", e => { if (e.target.value) e.target.value = pad6(e.target.value); });
$("#a-grade").addEventListener("input", e => { const raw = normGrade(e.target.value) === "Ungraded"; $("#a-cert").placeholder = raw ? "Optional if ungraded" : "Cert number"; });
$("#a-plat").addEventListener("change", e => { if (e.target.value === "pcs") $("#a-format").value = "auction"; });
$("#a-batch").addEventListener("change", e => { const b = batchById(e.target.value); if (b && !$("#a-cust").value) $("#a-cust").value = b.cust; });
$("#addForm").addEventListener("submit", async e => {
  e.preventDefault();
  const say = t => { $("#detect").textContent = t; };
  const url = $("#a-url").value.trim(), d = url ? detect(url) : null;
  if (url && !d) return say("That link isn’t from Fanatics Collect or eBay. Check the link and try again, or leave it blank until the card is curated.");
  const plat = d ? d.plat : $("#a-plat").value;
  const cust = $("#a-cust").value;
  if (!custById(cust)) return say("Choose the consignor this card belongs to.");
  const manual = !!$("#a-sku").dataset.manual, typed = $("#a-sku").value.trim();
  if (manual) {
    if (!/^\d{6}$/.test(typed)) return say("SKU must be six digits, like 000123.");
    const dup = S.listings.find(l => l.sku === typed);
    if (dup) return say(`SKU ${typed} is already used for ${dup.title}. Pick another SKU.`);
  }
  const grade = normGrade($("#a-grade").value), cert = $("#a-cert").value.trim();
  if (grade !== "Ungraded" && !cert) return say(`Enter the cert number for this ${grade} card, or clear the grade if it’s ungraded.`);
  const cdup = cert && S.listings.find(l => l.cert === cert && (l.status === "live" || l.status === "curating"));
  if (cdup) return say(`Cert ${cert} is already in the system as SKU ${cdup.sku} (${cdup.title}).`);
  const title = $("#a-title").value.trim();
  if (!title) return say("Enter the card name.");
  $("#a-save").disabled = true; say("Saving…");
  await guarded($("#detect"), async () => {
    const sku = manual ? typed : pad6(await reserve("sku", 1, maxSku()));
    if (manual) await bump("sku", parseInt(sku, 10));
    const ends = $("#a-ends").value, p = parseFloat($("#a-price").value);
    await setDoc(doc(col("listings")), {
      sku, cust, custEmail: emailOf(cust), batch: $("#a-batch").value || "", plat, url, item: d ? d.item : "", title, grade, cert,
      format: $("#a-format").value, price: isNaN(p) ? null : p, ends: ends ? new Date(ends).toISOString() : "",
      status: url ? "live" : "curating", soldDate: "", added: now(), addedBy: me, updatedAt: serverTimestamp()
    });
    ["#a-url", "#a-title", "#a-grade", "#a-cert", "#a-price", "#a-ends"].forEach(s => { $(s).value = ""; });
    delete $("#a-sku").dataset.manual;
    say(`Added as SKU ${sku}. It shows on ${custById(cust).name}’s page as ${url ? "Live" : "Being curated"}.`);
  });
  $("#a-save").disabled = false;
});

/* ---------- consignors ---------- */
// Codes follow the existing Wheelhouse pattern: initials, dash, number per initials (SA-01, SA-02…).
function nextCode(name, codes) {
  const words = name.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  const init = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || "XX").slice(0, 2)).toUpperCase().padEnd(2, "X");
  let n = 1, code;
  do { code = `${init}-${String(n++).padStart(2, "0")}`; } while (codes.has(code));
  return code;
}
const PAY_HINT = { venmo: ["Venmo handle", "@their-handle"], paypal: ["PayPal email", "name@email.com"], check: ["Check notes (optional)", "Payable to, if different"], other: ["Payout details", "Cash App, Zelle, store credit…"], "": ["Payout details", "Venmo handle, PayPal email, or other details"] };
function syncPayHint() { const [l, p] = PAY_HINT[$("#c-pay").value]; $("#c-payto-l").textContent = l; $("#c-payto").placeholder = p; }
$("#c-pay").addEventListener("change", syncPayHint);
function fmtPhone(v) {
  const d = String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || "").trim();
}
let editingCust = "";
function resetCustForm() {
  editingCust = ""; ["#c-name", "#c-email", "#c-phone", "#c-pay", "#c-payto", "#c-mail", "#c-payable"].forEach(s => { $(s).value = ""; }); $("#c-rate").value = 85; $("#c-notify").checked = true; syncPayHint();
  $("#c-save").textContent = "Add consignor"; $("#c-cancel").hidden = true;
}
$("#c-phone").addEventListener("blur", e => { e.target.value = fmtPhone(e.target.value); });
$("#custForm").addEventListener("submit", async e => {
  e.preventDefault();
  const say = t => { $("#c-msg").textContent = t; };
  const name = $("#c-name").value.trim(), email = $("#c-email").value.trim().toLowerCase(), phone = fmtPhone($("#c-phone").value);
  if (!name) return say("Enter the consignor’s name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say("Enter a valid email. It’s what they use to sign in.");
  const clash = S.customers.find(c => c.id !== editingCust && (c.email || "").toLowerCase() === email);
  if (clash) return say(`${email} is already the login for ${clash.name}. Each consignor needs their own email.`);
  if (phone && phone.replace(/\D/g, "").length < 10) return say("Enter a 10-digit phone number, or leave it blank.");
  const rate = parseFloat($("#c-rate").value); const r = isNaN(rate) ? 85 : rate;
  const payMethod = $("#c-pay").value, payTo = $("#c-payto").value.trim(), mailing = $("#c-mail").value.trim();
  if (payMethod === "venmo" && !payTo) return say("Enter their Venmo handle, or set Paid by to Not set.");
  if (payMethod === "paypal" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payTo)) return say("Enter the email address on their PayPal account.");
  if (payMethod === "check" && !mailing) return say("Enter a mailing address for their checks.");
  const pv = parseFloat($("#c-payable").value), payable = isNaN(pv) || pv < 0 ? 0 : Math.round(pv * 100) / 100;
  const extra = { payMethod, payTo: payMethod === "venmo" && payTo && !payTo.startsWith("@") ? "@" + payTo : payTo, mailing, payable, notify: $("#c-notify").checked };
  $("#c-save").disabled = true;
  await guarded($("#c-msg"), async () => {
    if (editingCust) {
      const c = custById(editingCust), id = editingCust, ops = [["update", doc(db, "customers", id), { name, email, phone, rate: r, ...extra, updatedAt: serverTimestamp() }]];
      if (c.email !== email) {
        (await getDocs(query(col("listings"), where("cust", "==", id)))).docs.forEach(d => ops.push(upd(d.id, { custEmail: email })));
        S.batches.filter(b => b.cust === id).forEach(b => ops.push(["update", doc(db, "batches", b.id), { custEmail: email }]));
        const ph = await getDocs(query(col("photos"), where("cust", "==", id)));
        ph.docs.forEach(d => ops.push(["update", d.ref, { custEmail: email }]));
      }
      await commit(ops);
      say(`Saved ${name}.`);
    } else {
      const code = nextCode(name, new Set(S.customers.map(c => c.code)));
      await setDoc(doc(col("customers")), { code, name, email, phone, rate: r, ...extra, since: today(), createdAt: serverTimestamp(), createdBy: me });
      say(`Added ${name} as ${code}.`);
    }
    resetCustForm();
  });
  $("#c-save").disabled = false;
});
$("#c-cancel").addEventListener("click", () => { resetCustForm(); $("#c-msg").textContent = ""; });
$("#custList").addEventListener("click", e => {
  const v = e.target.dataset.view, ed = e.target.dataset.edit;
  if (v) { ui.cv = v; setMode("cust"); return; }
  if (ed) {
    const c = custById(ed); editingCust = ed;
    $("#c-name").value = c.name; $("#c-email").value = c.email || ""; $("#c-phone").value = c.phone || ""; $("#c-rate").value = c.rate ?? 85;
    $("#c-pay").value = c.payMethod || ""; $("#c-payto").value = c.payTo || ""; $("#c-mail").value = c.mailing || ""; $("#c-payable").value = c.payable || ""; $("#c-notify").checked = c.notify !== false; syncPayHint();
    $("#c-save").textContent = `Save ${c.code}`; $("#c-cancel").hidden = false; $("#c-msg").textContent = ""; $("#c-name").focus();
  }
});

/* ---------- card details (click a SKU) ---------- */
const detail = createModal();
let openCard = "", stmt = null;
const SFIELDS = [
  { k: "item", label: "Item #", re: /item.?(#|id|no|num)|ebay.?(#|id|item)|listing.?(#|id)/i },
  { k: "net", label: "After fees", re: /net|payout|proceeds|after.?fee|consignor/i },
  { k: "date", label: "Date sold", re: /date|sold on|end/i },
  { k: "price", label: "Sale price", re: /sale|sold|price|gross|amount|total/i },
  { k: "title", label: "Card", re: /title|desc|card|name|item/i },
];
function openDetail(id) {
  const l = S.all.find(x => x.id === id); if (!l) return;
  openCard = id; stmt = null;
  if (isDropoff(l)) return openDropDetail(l);
  const c = custById(l.cust), lot = isLot(l) || l.plat === "pcs";
  const v = x => esc(x ?? "");
  detail.open(cardDetailHtml(l, c, { staff: true }) + `
    <form id="d-form" class="form" autocomplete="off" style="border-top:1px solid var(--line);padding-top:14px">
      <div class="f w6"><h3>Edit</h3></div>
      <div class="f w6"><label for="d-title">Card</label><input id="d-title" value="${v(l.title)}"></div>
      <div class="f"><label for="d-grade">Grade</label><input id="d-grade" value="${v(l.grade === "Ungraded" ? "" : l.grade)}" placeholder="Ungraded"></div>
      <div class="f"><label for="d-cert">Cert #</label><input id="d-cert" value="${v(l.cert)}" style="font-family:var(--mono)"></div>
      <div class="f"><label for="d-period">${l.plat === "pcs" ? "Payout month" : "Auction / period"}</label><input id="d-period" value="${v(l.period)}" placeholder="${l.plat === "pcs" ? "October 2026" : "WA180"}"></div>
      <div class="f"><label for="d-price">Price / sale</label><input id="d-price" type="number" step="0.01" min="0" value="${l.price ?? ""}"></div>
      <div class="f"><label for="d-payout">Consignor portion</label><input id="d-payout" type="number" step="0.01" min="0" value="${l.payout ?? ""}" placeholder="Uses their split"></div>
      <div class="f"><label for="d-count">Cards in lot</label><input id="d-count" type="number" step="1" min="0" value="${l.lotCount ?? ""}" placeholder="1"></div>
      <div class="f w6"><label for="d-url">Listing link</label><input id="d-url" value="${v(l.url)}" placeholder="Paste the Fanatics Collect or eBay link"></div>
      <div class="f w6"><div class="row"><button class="btn" type="submit">Save changes</button><span class="detect" id="d-msg" role="status"></span></div></div>
    </form>
    ${photoSection(l)}
    ${lot ? `<div style="display:grid;gap:10px;border-top:1px solid var(--line);padding-top:14px">
      <h3>${l.items?.length ? "Replace the cards in this lot" : "Add the cards in this lot"}</h3>
      <div class="muted" style="font-size:12px">Upload the PC Sportscards statement (CSV or Excel) for ${l.period ? esc(l.period) : "this payout"}. If the file covers more than this consignor, filter it down to their cards first.</div>
      <label class="drop"><input type="file" id="d-file" accept=".csv,.tsv,.txt,.xlsx,.xls"><span id="d-file-t"><b>Choose the statement</b></span></label>
      <div id="d-map" class="map" hidden></div>
      <div id="d-prev" style="font-size:13px"></div>
      <div class="row"><button class="btn" type="button" id="d-items-go" hidden>Save cards to this lot</button></div>
    </div>` : ""}`);
  loadFullPhoto(detail.body, loadPhoto);
}
function openDropDetail(l) {
  const c = custById(l.cust), v = x => esc(x ?? "");
  detail.open(cardDetailHtml(l, c, { staff: true }) + `
    <div class="row">${(l.items || []).length ? `<button class="btn ghost sm" type="button" id="dx-back">Move selected cards back to the sorting list</button>` : ""}<span class="detect" id="dx-msg" role="status"></span></div>
    <div style="display:grid;gap:10px;border-top:1px solid var(--line);padding-top:14px">
      <h3>Drop-off photos</h3>
      ${(l.photos || []).length ? `<div class="thumbs">${l.photos.map((p, i) => `<span class="thumb big"><img src="${p.thumb}" alt="Photo ${i + 1}"><button class="rm" type="button" data-drm="${i}" aria-label="Remove photo ${i + 1}">×</button></span>`).join("")}</div>` : ""}
      <label class="drop"><input type="file" id="dx-photos" accept="image/*" multiple><span><b>Add photos</b> or drop them here</span></label>
      <span class="detect" id="dx-pmsg" role="status"></span>
    </div>
    <form id="dx-form" class="form" autocomplete="off" style="border-top:1px solid var(--line);padding-top:14px">
      <div class="f w6"><h3>Edit</h3></div>
      <div class="f"><label for="dx-date">Dropped off</label><input id="dx-date" type="date" value="${v(l.dropDate)}"></div>
      <div class="f"><label for="dx-n">Cards dropped off</label><input id="dx-n" type="number" min="0" step="1" value="${l.expected || ""}"></div>
      <div class="f"><label for="dx-batch">PC batch</label><select id="dx-batch"><option value="">No batch</option>${pcsBatches().map(b => `<option value="${b.id}"${b.id === l.batch ? " selected" : ""}>Batch ${esc(b.id)}</option>`).join("")}</select></div>
      <div class="f w6"><label for="dx-cust">Customer</label><select id="dx-cust">${custOptions(l.cust)}</select></div>
      <div class="f w6"><div class="row"><button class="btn" type="submit">Save changes</button><span class="detect" id="dx-fmsg" role="status"></span></div></div>
    </form>`);
}
detail.body.addEventListener("submit", async e => {
  if (e.target.id !== "dx-form") return;
  e.preventDefault();
  const l = S.all.find(x => x.id === openCard); if (!l) return;
  const dropDate = $("#dx-date").value || l.dropDate, cust = $("#dx-cust").value;
  const patch = { dropDate, expected: parseInt($("#dx-n").value, 10) || 0, batch: $("#dx-batch").value, title: `PC Sportscards drop-off · ${fmtDay(dropDate)}`, cust, custEmail: emailOf(cust) };
  const ok = await guarded($("#dx-fmsg"), async () => {
    const ops = [upd(l.id, patch)];
    if (cust !== l.cust) (l.photos || []).forEach(p => ops.push(["update", doc(db, "photos", p.id), { cust, custEmail: emailOf(cust) }]));
    await commit(ops); return true;
  });
  if (ok) { Object.assign(l, patch); openDropDetail(l); $("#dx-fmsg").textContent = "Saved."; }
});
// Other PC Sportscards cards in the same batch can share one photo.
const photoMates = l => l.plat === "pcs" && l.batch ? S.listings.filter(x => x.id !== l.id && x.plat === "pcs" && x.batch === l.batch && x.cust === l.cust) : [];
function photoSection(l) {
  const mates = photoMates(l);
  const note = isLot(l) ? "This photo covers every card in this lot." : l.plat === "fan" ? "Shows on the customer’s page next to this card." : "";
  return `<div style="display:grid;gap:10px;border-top:1px solid var(--line);padding-top:14px">
    <h3>Photo</h3>
    ${note ? `<div class="muted" style="font-size:12px">${note}</div>` : ""}
    <label class="drop"><input type="file" id="d-photo" accept="image/*"><span><b>${l.photo ? "Replace the photo" : "Add a photo"}</b> or drop it here</span></label>
    ${mates.length ? `<label class="itype" style="padding:8px 10px"><input type="checkbox" id="d-photo-all" checked><span>Use this photo for all ${mates.length + 1} PC Sportscards cards in batch <span class="code">${esc(l.batch)}</span></span></label>` : ""}
    <div class="row">${l.photo ? `<button class="btn ghost sm" type="button" id="d-photo-rm">Remove photo${mates.some(x => x.photo?.id === l.photo.id) ? " from this card" : ""}</button>` : ""}<span class="detect" id="d-photo-msg" role="status"></span></div>
  </div>`;
}
async function dropPhotoIfUnused(id, exceptIds) {
  if (!id) return;
  if (S.listings.some(x => !exceptIds.includes(x.id) && x.photo?.id === id)) return;
  try { await deleteDoc(doc(db, "photos", id)); } catch (e) {}
}
function renderStmt() {
  if (!stmt) return;
  $("#d-map").hidden = false;
  if (!$("#d-map").contains(document.activeElement)) $("#d-map").innerHTML = SFIELDS.map(f => `<div class="f"><label for="sm-${f.k}">${f.label}</label><select id="sm-${f.k}" data-k="${f.k}"><option value="-1">Not in file</option>${stmt.headers.map((h, i) => `<option value="${i}"${stmt.map[f.k] === i ? " selected" : ""}>${esc(h)}</option>`).join("")}</select></div>`).join("");
  const m = stmt.map, g = (r, k) => m[k] >= 0 ? String(r[m[k]] ?? "").trim() : "";
  const items = stmt.rows.map(r => {
    const title = g(r, "title"); if (!title) return null;
    const p = g(r, "price"), n = g(r, "net"), d = g(r, "date"), t = Date.parse(d);
    return { title, price: p ? money2(p) : null, ...(n ? { net: money2(n) } : {}), item: g(r, "item").replace(/\.0+$/, ""), date: isNaN(t) ? "" : new Date(t).toISOString() };
  }).filter(Boolean);
  stmt.items = items;
  const gross = items.reduce((s, x) => s + (x.price || 0), 0), net = items.reduce((s, x) => s + (x.net || 0), 0);
  $("#d-prev").innerHTML = items.length ? `<b>${items.length} cards</b> · ${money(gross)} in sales${items.some(x => x.net != null) ? ` · ${money(net)} after fees` : ""}. First few: ${items.slice(0, 3).map(x => esc(x.title)).join("; ")}` : '<span class="act-skip">No cards found. Check which column holds the card name.</span>';
  $("#d-items-go").hidden = !items.length;
  $("#d-items-go").textContent = `Save ${items.length} cards to this lot`;
}
document.addEventListener("click", e => { const t = e.target.closest("[data-open]"); if (t) openDetail(t.dataset.open); });
detail.body.addEventListener("submit", async e => {
  if (e.target.id !== "d-form") return;
  e.preventDefault();
  const l = S.listings.find(x => x.id === openCard); if (!l) return;
  const num = id => { const x = parseFloat($(id).value); return isNaN(x) ? null : Math.round(x * 100) / 100; };
  const url = $("#d-url").value.trim(), d = url ? detect(url) : null;
  if (url && !d) { $("#d-msg").textContent = "That link isn’t from Fanatics Collect or eBay."; return; }
  const title = $("#d-title").value.trim(); if (!title) { $("#d-msg").textContent = "Enter the card name."; return; }
  const cnt = parseInt($("#d-count").value, 10);
  const patch = { title, grade: normGrade($("#d-grade").value), cert: $("#d-cert").value.trim(), period: $("#d-period").value.trim(), price: num("#d-price"), payout: num("#d-payout"), lotCount: isNaN(cnt) ? null : cnt, url, item: d ? d.item : (url ? l.item : "") };
  if (d) patch.plat = d.plat;
  if (url && l.status === "curating") patch.status = "live";
  const ok = await guarded($("#d-msg"), async () => { await updateDoc(listingRef(l.id), { ...patch, updatedAt: serverTimestamp() }); return true; });
  if (ok) { Object.assign(l, patch); openDetail(l.id); $("#d-msg").textContent = "Saved."; }
});
detail.body.addEventListener("change", async e => {
  if (e.target.id === "dx-all") { detail.body.querySelectorAll("input.dx").forEach(x => { x.checked = e.target.checked; }); return; }
  if (e.target.id === "dx-photos") {
    const l = S.all.find(x => x.id === openCard); if (!l) return;
    const files = [...e.target.files], msg = $("#dx-pmsg"); if (!files.length) return;
    if ((l.photos || []).length + files.length > 30) { msg.textContent = "A drop-off can hold up to 30 photos."; return; }
    msg.textContent = `Saving ${files.length} photo${files.length === 1 ? "" : "s"}…`;
    const ok = await guarded(msg, async () => {
      const add = [];
      for (const f of files) {
        const full = await fullPhoto(f), thumb = full && await shrink(f, 220, .7);
        if (!full || !thumb) continue;
        const ref = doc(col("photos"));
        await setDoc(ref, { listing: l.id, cust: l.cust || "", custEmail: emailOf(l.cust), data: full, createdAt: serverTimestamp() });
        add.push({ id: ref.id, thumb });
      }
      const photos = [...(l.photos || []), ...add];
      await updateDoc(listingRef(l.id), { photos, updatedAt: serverTimestamp() });
      l.photos = photos; return add.length;
    });
    if (ok != null) { openDropDetail(l); $("#dx-pmsg").textContent = `Added ${ok} photo${ok === 1 ? "" : "s"}.`; }
    return;
  }
  if (e.target.id === "d-photo") {
    const file = e.target.files[0]; if (!file) return;
    const l = S.listings.find(x => x.id === openCard); if (!l) return;
    const msg = $("#d-photo-msg"); msg.textContent = "Preparing photo…";
    const full = await fullPhoto(file), thumb = full && await shrink(file, 220, .7);
    if (!full || !thumb) { msg.textContent = "That file isn’t an image. Choose a JPG or PNG photo."; return; }
    const targets = [l, ...($("#d-photo-all")?.checked ? photoMates(l) : [])];
    msg.textContent = "Saving…";
    const ok = await guarded(msg, async () => {
      const ref = doc(col("photos"));
      await setDoc(ref, { listing: l.id, cust: l.cust || "", custEmail: emailOf(l.cust), data: full, createdAt: serverTimestamp() });
      const photo = { id: ref.id, thumb }, old = [...new Set(targets.map(x => x.photo?.id).filter(Boolean))];
      await commit(targets.map(x => upd(x.id, { photo })));
      targets.forEach(x => { x.photo = photo; });
      for (const id of old) await dropPhotoIfUnused(id, []);
      return targets.length;
    });
    if (ok) { openDetail(l.id); $("#d-photo-msg").textContent = ok > 1 ? `Photo added to ${ok} cards.` : "Photo added."; }
    return;
  }
  if (e.target.id === "d-file") {
    const file = e.target.files[0]; if (!file || !window.XLSX) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const isText = /\.(csv|tsv|txt)$/i.test(file.name);
        const wb = XLSX.read(new Uint8Array(fr.result), { type: "array", raw: isText, cellDates: true });
        const all = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" }).map(r => r.map(cellStr));
        const hi = all.findIndex(r => r.filter(Boolean).length >= 2); if (hi < 0) throw new Error("empty");
        const headers = all[hi].map((h, i) => h || `Column ${i + 1}`), map = {}, used = new Set();
        SFIELDS.forEach(f => { const i = headers.findIndex((h, ix) => !used.has(ix) && f.re.test(h)); map[f.k] = i; if (i >= 0) used.add(i); });
        stmt = { headers, rows: all.slice(hi + 1).filter(r => r.some(Boolean)), map };
        $("#d-file-t").innerHTML = `<b>${esc(file.name)}</b> · choose a different file`;
        renderStmt();
      } catch (err) { $("#d-prev").textContent = `Couldn’t read ${file.name}. Save it as .csv or .xlsx and try again.`; }
    };
    fr.readAsArrayBuffer(file);
  }
  const k = e.target.dataset?.k;
  if (k && stmt && e.target.id.startsWith("sm-")) { stmt.map[k] = parseInt(e.target.value, 10); e.target.blur(); renderStmt(); }
});
detail.body.addEventListener("click", async e => {
  if (e.target.id === "dx-all") return;
  if (e.target.id === "dx-back") {
    const l = S.all.find(x => x.id === openCard); if (!l) return;
    const idx = new Set([...detail.body.querySelectorAll("input.dx:checked")].map(x => +x.dataset.i));
    if (!idx.size) { $("#dx-msg").textContent = "Tick the cards to move back first."; return; }
    const back = l.items.filter((_, i) => idx.has(i)), keep = l.items.filter((_, i) => !idx.has(i));
    if (back.some(x => x.status === "paid")) { $("#dx-msg").textContent = "Some of those cards were already paid out, so they can’t move back."; return; }
    const ok = await guarded($("#dx-msg"), async () => {
      await commit([upd(l.id, dropPatch(keep))]);
      const ids = new Set((S.pool || []).map(r => r.pcsId));
      await savePool([...(S.pool || []), ...back.filter(x => !ids.has(x.pcsId))]);
      return true;
    });
    if (ok) { Object.assign(l, dropPatch(keep)); openDropDetail(l); $("#dx-msg").textContent = `Moved ${plural(back.length)} back to the sorting list.`; }
    return;
  }
  const drm = e.target.dataset?.drm;
  if (drm != null) {
    const l = S.all.find(x => x.id === openCard); if (!l) return;
    const p = l.photos[+drm], photos = l.photos.filter((_, i) => i !== +drm);
    const ok = await guarded($("#dx-pmsg"), async () => { await updateDoc(listingRef(l.id), { photos, updatedAt: serverTimestamp() }); try { await deleteDoc(doc(db, "photos", p.id)); } catch (err) {} return true; });
    if (ok) { l.photos = photos; openDropDetail(l); }
    return;
  }
  if (e.target.id === "d-photo-rm") {
    const l = S.listings.find(x => x.id === openCard); if (!l?.photo) return;
    const id = l.photo.id;
    const ok = await guarded($("#d-photo-msg"), async () => { await updateDoc(listingRef(l.id), { photo: null, updatedAt: serverTimestamp() }); l.photo = null; await dropPhotoIfUnused(id, [l.id]); return true; });
    if (ok) { openDetail(l.id); $("#d-photo-msg").textContent = "Photo removed."; }
    return;
  }
  if (e.target.id !== "d-items-go" || !stmt?.items?.length) return;
  const l = S.listings.find(x => x.id === openCard); if (!l) return;
  const items = stmt.items.slice(0, 2000);
  const patch = { items, lotCount: items.length };
  const ok = await guarded($("#d-prev"), async () => { await updateDoc(listingRef(l.id), { ...patch, updatedAt: serverTimestamp() }); return true; });
  if (ok) { Object.assign(l, patch); openDetail(l.id); }
});

/* ---------- PC Sportscards sorting and drop-off SKUs ---------- */
const dropPatch = items => { const sm = dropoffSummary(items); return { items, lotCount: items.length, status: sm.status, price: sm.gross || null }; };
async function savePool(rows) {
  // Keep the newest 3,000 so the list stays well under Firestore's 1 MB document limit.
  rows = rows.sort((a, b) => (b.listed || "").localeCompare(a.listed || "")).slice(0, 3000);
  await setDoc(doc(db, "meta", "pcsPool"), { rows, updatedAt: now() });
  S.pool = rows;
}
const psSel = new Set();
const pcsBatches = () => S.batches.filter(b => b.plat === "pcs").sort((a, b) => b.id.localeCompare(a.id));
const dropoffsFor = cust => S.all.filter(l => isDropoff(l) && l.cust === cust && l.status !== "removed").sort((a, b) => (b.dropDate || "").localeCompare(a.dropDate || ""));
async function newDropoff({ cust, dropDate, batch, expected = 0, items = [], photos = [] }) {
  const sku = pad6(await reserve("sku", 1, maxSku()));
  const ref = doc(col("listings"));
  await setDoc(ref, {
    kind: "dropoff", sku, cust, custEmail: emailOf(cust), batch: batch || "", plat: "pcs", url: "", item: "",
    title: `PC Sportscards drop-off · ${fmtDay(dropDate)}`, grade: "Ungraded", cert: "", format: "auction",
    dropDate, expected: expected || 0, photos, ends: "", soldDate: "", added: now(), addedBy: me, updatedAt: serverTimestamp(), ...dropPatch(items),
  });
  return { id: ref.id, sku };
}
function renderSort() {
  const rows = S.pool || [];
  const q = $("#ps-q").value.trim().toLowerCase(), st = $("#ps-st").value, day = $("#ps-day").value, hid = $("#ps-hidden").value === "1";
  const days = [...rows.filter(r => !!r.hidden === hid).reduce((m, r) => m.set((r.listed || "").slice(0, 10), (m.get((r.listed || "").slice(0, 10)) || 0) + 1), new Map())].sort((a, b) => b[0].localeCompare(a[0]));
  $("#ps-day").innerHTML = `<option value="">Any listing date</option>` + days.map(([d, n]) => `<option value="${d}"${d === day ? " selected" : ""}>Listed ${d ? fmtDay(d) : "(no date)"} · ${n}</option>`).join("");
  const shown = rows.filter(r => !!r.hidden === hid && (!st || r.status === st) && (!day || (r.listed || "").startsWith(day)) && (!q || [r.title, r.pcsId].join(" ").toLowerCase().includes(q)));
  for (const id of psSel) if (!rows.some(r => r.pcsId === id)) psSel.delete(id);
  const unsorted = rows.filter(r => !r.hidden).length;
  $("#ps-count").textContent = unsorted ? `${unsorted.toLocaleString()} unsorted` : "";
  $("#pcsort").hidden = !rows.length && !dropoffCount();
  $("#ps-body").innerHTML = shown.length ? shown.slice(0, 600).map(r => `<tr${psSel.has(r.pcsId) ? ' class="on"' : ""}><td><input type="checkbox" class="pss" data-id="${esc(r.pcsId)}"${psSel.has(r.pcsId) ? " checked" : ""} aria-label="Select ${esc(r.title)}"></td><td class="title">${esc(r.title)}<div class="cert">PC #${esc(r.pcsId)}</div></td><td><span class="st ${r.status}">${ITEM_STAT[r.status]}</span></td><td class="num">${r.listed ? fmtDay(r.listed.slice(0, 10)) : ""}</td><td class="num">${r.status === "sold" ? `${money(r.price)}<div class="cert">${money(r.net)} after fees</div>` : ""}</td></tr>`).join("") + (shown.length > 600 ? `<tr><td colspan="5" class="muted">Showing 600 of ${shown.length}. Filter by listing date to narrow it down.</td></tr>` : "")
    : `<tr><td colspan="5"><div class="empty">${rows.length ? "No cards match these filters." : "Nothing to sort. Import the PC Sportscards export to bring in new cards."}</div></td></tr>`;
  const vis = shown.slice(0, 600), k = vis.filter(r => psSel.has(r.pcsId)).length;
  $("#ps-all").checked = vis.length > 0 && k === vis.length; $("#ps-all").indeterminate = k > 0 && k < vis.length;
  $("#ps-bar").hidden = !psSel.size;
  if (psSel.size) {
    $("#ps-n").textContent = `${psSel.size} card${psSel.size === 1 ? "" : "s"} selected`;
    const pc = $("#ps-cust").value;
    if (document.activeElement !== $("#ps-cust")) $("#ps-cust").innerHTML = '<option value="">Choose customer…</option>' + custOptions(pc);
    const cust = $("#ps-cust").value, ps = $("#ps-sku").value;
    if (document.activeElement !== $("#ps-sku")) $("#ps-sku").innerHTML = '<option value="__new">New drop-off SKU</option>' + (cust ? dropoffsFor(cust).map(l => `<option value="${l.id}"${l.id === ps ? " selected" : ""}>Add to SKU ${esc(l.sku)} · ${l.dropDate ? fmtDay(l.dropDate) : ""} · ${(l.items || []).length}${l.expected ? ` of ${l.expected}` : ""} cards</option>`).join("") : "");
    $("#ps-newwrap").hidden = $("#ps-sku").value !== "__new";
    if (!$("#ps-date").value) $("#ps-date").value = today();
    const pb = $("#ps-batch").value;
    if (document.activeElement !== $("#ps-batch")) $("#ps-batch").innerHTML = '<option value="">No batch</option>' + pcsBatches().map(b => `<option value="${b.id}"${b.id === pb ? " selected" : ""}>Batch ${esc(b.id)}${b.ship ? ` · shipped ${fmtDay(b.ship)}` : ""}</option>`).join("");
    $("#ps-batch").disabled = $("#ps-sku").value !== "__new";
    $("#ps-go").textContent = $("#ps-sku").value === "__new" ? `Create SKU with ${psSel.size} card${psSel.size === 1 ? "" : "s"}` : `Add ${psSel.size} to that SKU`;
    $("#ps-hide").textContent = hid ? "Put back in the list" : "Not consigned";
  }
  // drop-off form selects
  if (document.activeElement !== $("#psn-cust")) $("#psn-cust").innerHTML = '<option value="">Choose customer…</option>' + custOptions($("#psn-cust").value);
  if (document.activeElement !== $("#psn-batch")) { const v = $("#psn-batch").value; $("#psn-batch").innerHTML = '<option value="">No batch</option>' + pcsBatches().map(b => `<option value="${b.id}"${b.id === v ? " selected" : ""}>Batch ${esc(b.id)}</option>`).join(""); }
  if (!$("#psn-date").value) $("#psn-date").value = today();
}
const dropoffCount = () => S.all.some(isDropoff);
["#ps-q", "#ps-st", "#ps-day", "#ps-hidden"].forEach(x => $(x).addEventListener("input", () => { if (x === "#ps-hidden") psSel.clear(); renderSort(); }));
$("#ps-body").addEventListener("change", e => { const id = e.target.dataset.id; if (!id) return; e.target.checked ? psSel.add(id) : psSel.delete(id); renderSort(); });
$("#ps-all").addEventListener("change", e => {
  const ids = [...$("#ps-body").querySelectorAll("input.pss")].map(x => x.dataset.id);
  ids.forEach(id => e.target.checked ? psSel.add(id) : psSel.delete(id)); renderSort();
});
["#ps-cust", "#ps-sku"].forEach(x => $(x).addEventListener("change", e => { e.target.blur(); renderSort(); }));
$("#ps-clear").addEventListener("click", () => { psSel.clear(); renderSort(); });
$("#ps-hide").addEventListener("click", async () => {
  const hid = $("#ps-hidden").value === "1", n = psSel.size;
  await guarded($("#ps-msg"), async () => {
    await savePool((S.pool || []).map(r => psSel.has(r.pcsId) ? { ...r, hidden: !hid } : r));
    $("#ps-msg").textContent = hid ? `Put ${plural(n)} back in the list.` : `Marked ${plural(n)} as not consigned. Find them under “Show only cards marked not consigned”.`;
    psSel.clear();
  });
  renderSort();
});
$("#ps-go").addEventListener("click", async e => {
  const cust = $("#ps-cust").value, target = $("#ps-sku").value, msg = $("#ps-msg");
  if (!custById(cust)) { msg.textContent = "Choose the customer these cards belong to."; return; }
  const picked = (S.pool || []).filter(r => psSel.has(r.pcsId)); if (!picked.length) return;
  const items = picked.map(({ hidden, ...r }) => r);
  e.target.disabled = true;
  const res = await guarded(msg, async () => {
    let id, sku;
    if (target === "__new") {
      const dropDate = $("#ps-date").value || today();
      ({ id, sku } = await newDropoff({ cust, dropDate, batch: $("#ps-batch").value, items }));
    } else {
      const l = S.all.find(x => x.id === target); id = l.id; sku = l.sku;
      await commit([upd(l.id, dropPatch([...(l.items || []), ...items]))]);
    }
    const ids = new Set(items.map(x => x.pcsId));
    await savePool((S.pool || []).filter(r => !ids.has(r.pcsId)));
    return { id, sku };
  });
  e.target.disabled = false;
  if (res) {
    msg.innerHTML = `Added ${plural(items.length)} to SKU <button class="linkbtn code" type="button" data-open="${res.id}">${esc(res.sku)}</button> for ${esc(custById(cust).name)}. Open it to add the drop-off photos.`;
    psSel.clear(); $("#ps-sku").value = "__new"; renderSort();
  }
});
// Log a drop-off at intake, before PC Sportscards lists anything.
let psnPending = [];
$("#psn-photos").addEventListener("change", async e => {
  const files = [...e.target.files];
  for (const f of files) { const full = await fullPhoto(f), thumb = full && await shrink(f, 220, .7); if (full && thumb) psnPending.push({ full, thumb }); }
  e.target.value = "";
  $("#psn-pending").innerHTML = psnPending.map((p, i) => `<span class="thumb"><img src="${p.thumb}" alt="Photo ${i + 1}"><button class="rm" type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></span>`).join("");
});
$("#psn-pending").addEventListener("click", e => { const i = e.target.dataset.rm; if (i == null) return; psnPending.splice(+i, 1); $("#psn-photos").dispatchEvent(new Event("change")); });
$("#psn-form").addEventListener("submit", async e => {
  e.preventDefault();
  const cust = $("#psn-cust").value, msg = $("#psn-msg");
  if (!custById(cust)) { msg.textContent = "Choose the customer."; return; }
  const res = await guarded(msg, async () => {
    const photos = [];
    for (const p of psnPending) { const ref = doc(col("photos")); await setDoc(ref, { cust, custEmail: emailOf(cust), data: p.full, createdAt: serverTimestamp() }); photos.push({ id: ref.id, thumb: p.thumb }); }
    return newDropoff({ cust, dropDate: $("#psn-date").value || today(), batch: $("#psn-batch").value, expected: parseInt($("#psn-n").value, 10) || 0, photos });
  });
  if (res) {
    msg.innerHTML = `Created SKU <button class="linkbtn code" type="button" data-open="${res.id}">${esc(res.sku)}</button> for ${esc(custById(cust).name)}. When the cards show up in the list above, tick them and choose “Add to SKU ${esc(res.sku)}”.`;
    psnPending = []; $("#psn-pending").innerHTML = ""; $("#psn-n").value = "";
  }
});

/* ---------- payouts ---------- */
const SITE = "https://wheelhousecards.github.io";
let paidArm = "";
function payoutEmail(c, o) {
  const first = (c.name || "").split(/\s+/)[0] || "there";
  const lines = o.cards.slice(0, 15).map(l => `- SKU ${l.sku} · ${l.title}: sold for ${money(l.price)}`); // not used right now
  if (o.cards.length > 15) lines.push(`- …and ${o.cards.length - 15} more on your page`);
  const body = [
    `Hi ${first},`, "",
    `You have a Wheelhouse consignment payout of ${money(o.amount)} coming your way.`, "",
    // Card-by-card list left out for now; add `...(o.cards.length ? [...lines, ""] : [])` here to bring it back.
    ...(c.payable ? [`Includes ${money(c.payable)} carried over from your previous balance.`, ""] : []),
    payLine(c) ? `We’ll send it by ${payLine(c)}. If that’s changed, just reply and let us know.` : "How would you like to be paid: Venmo, PayPal or check? Reply with your handle, PayPal email or mailing address.",
    "", `You can see all your cards and sales anytime at ${SITE}`, "", "Thanks,", "Wheelhouse",
  ].join("\n");
  return { subject: `Your Wheelhouse consignment payout: ${money(o.amount)}`, body };
}
function renderPayouts() {
  const rows = S.customers.map(c => ({ c, o: owedFor(c, S.active) })).filter(x => x.o.amount > 0.004).sort((a, b) => b.o.amount - a.o.amount);
  $("#p-total").textContent = rows.length ? `${money(rows.reduce((s, x) => s + x.o.amount, 0))} owed to ${rows.length} consignor${rows.length === 1 ? "" : "s"}` : "";
  $("#p-body").innerHTML = rows.length ? rows.map(({ c, o }) => {
    const canMail = c.email && c.notify !== false;
    return `<tr data-c="${c.id}">
      <td><span class="code">${esc(c.code)}</span> ${esc(c.name)}</td>
      <td class="num" style="font-weight:600">${money(o.amount)}${c.payable ? `<div class="cert">${money(c.payable)} carried over</div>` : ""}</td>
      <td class="num">${o.count}</td>
      <td style="max-width:240px;overflow-wrap:anywhere">${payLine(c) ? esc(payLine(c)) : '<span class="need">Not set</span>'}</td>
      <td class="num">${c.notifiedAt ? fmtDay(c.notifiedAt.slice(0, 10)) + (c.notifiedAmount != null && Math.abs(c.notifiedAmount - o.amount) > 0.004 ? `<div class="cert">was ${money(c.notifiedAmount)}</div>` : "") : '<span class="muted">Not yet</span>'}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap">${canMail ? `<a class="btn ghost sm" data-pa="mail" href="#">Email</a><button class="btn ghost sm" type="button" data-pa="copy">Copy message</button>` : `<span class="muted" style="font-size:12px">${c.email ? "Payout emails off" : "No email"}</span>`}<button class="btn sm" type="button" data-pa="paid">${paidArm === c.id ? `Confirm ${money(o.amount)} paid` : "Mark paid"}</button></div></td>
    </tr>`;
  }).join("") : '<tr><td colspan="6"><div class="empty">Nobody is owed a payout right now. Cards marked Sold show up here.</div></td></tr>';
}
$("#p-body").addEventListener("click", async e => {
  const t = e.target.closest("[data-pa]"); if (!t) return;
  const c = custById(t.closest("tr").dataset.c); if (!c) return;
  const o = owedFor(c, S.active), msg = $("#p-msg");
  if (t.dataset.pa === "mail" || t.dataset.pa === "copy") {
    e.preventDefault();
    const m = payoutEmail(c, o);
    if (t.dataset.pa === "mail") {
      location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
      msg.textContent = `Opened an email to ${c.email}. If nothing opened, use “Copy message” and paste it into your email.`;
    } else {
      try { await navigator.clipboard.writeText(`To: ${c.email}\nSubject: ${m.subject}\n\n${m.body}`); msg.textContent = `Copied the message for ${c.name}. Paste it into an email to ${c.email}.`; }
      catch (err) { msg.textContent = "Your browser blocked copying. Use the Email button instead."; return; }
    }
    await guarded(msg, () => updateDoc(doc(db, "customers", c.id), { notifiedAt: now(), notifiedAmount: Math.round(o.amount * 100) / 100 }));
    return;
  }
  if (t.dataset.pa === "paid") {
    if (paidArm !== c.id) { paidArm = c.id; renderPayouts(); return; }
    paidArm = "";
    await guarded(msg, async () => {
      const entry = { date: today(), amount: Math.round(o.amount * 100) / 100, cards: o.count, method: c.payMethod || "", payTo: c.payMethod === "check" ? (c.mailing || "") : (c.payTo || ""), by: me };
      const ops = o.cards.map(l => upd(l.id, { status: "paid" }));
      const lots = new Map();
      o.dropItems.forEach(x => lots.set(x.lot.id, x.lot));
      lots.forEach(l => ops.push(upd(l.id, dropPatch((l.items || []).map(x => x.status === "sold" ? { ...x, status: "paid", paidOut: today() } : x)))));
      ops.push(["update", doc(db, "customers", c.id), { payable: 0, payouts: [...(c.payouts || []), entry], notifiedAt: "", notifiedAmount: null }]);
      await commit(ops);
      msg.textContent = `Logged a ${money(entry.amount)} payout to ${c.name}. Their sold cards are now Paid out.`;
    });
  }
});

/* ---------- ledger row edits ---------- */
let delOne = "";
const lmsg = t => { $("#ledger-msg").textContent = t; };
$("#tbody").addEventListener("change", async e => {
  const tr = e.target.closest("tr"), l = S.all.find(x => x.id === tr?.dataset.id); if (!l) return;
  if (e.target.classList.contains("sel")) { e.target.checked ? ui.sel.add(l.id) : ui.sel.delete(l.id); tr.classList.toggle("on", e.target.checked); delArm = false; renderBulk(); return; }
  const f = e.target.dataset.f;
  await guarded($("#ledger-msg"), async () => {
    if (f === "cust" && e.target.value) { await commit([upd(l.id, { cust: e.target.value, custEmail: emailOf(e.target.value) })]); lmsg(`SKU ${l.sku} assigned to ${custById(e.target.value).name}.`); }
    if (f === "url") {
      const url = e.target.value.trim(); if (!url) return;
      const d = detect(url);
      if (!d) { lmsg("That link isn’t from Fanatics Collect or eBay."); return; }
      await updateDoc(listingRef(l.id), { url, item: d.item, plat: d.plat, ...(l.status === "curating" ? { status: "live" } : {}), updatedAt: serverTimestamp() });
      lmsg(`Linked SKU ${l.sku}. It’s now live on the customer’s page.`);
    }
    if (f === "price") { const p = parseFloat(e.target.value); await updateDoc(listingRef(l.id), { price: isNaN(p) ? null : p, updatedAt: serverTimestamp() }); }
    if (f === "status") {
      const s = e.target.value, data = { status: s, updatedAt: serverTimestamp() };
      if ((s === "sold" || s === "paid") && !l.soldDate) data.soldDate = now();
      await updateDoc(listingRef(l.id), data);
    }
  });
});
$("#tbody").addEventListener("click", async e => {
  if (!e.target.hasAttribute("data-del")) return;
  const id = e.target.closest("tr").dataset.id, l = S.listings.find(x => x.id === id);
  if (delOne !== id) { delOne = id; e.target.textContent = "Sure?"; return; }
  delOne = "";
  await guarded($("#ledger-msg"), async () => { await commit([softRemove(l)]); lmsg(`Removed SKU ${l.sku}. It’s in the Removed tab if you need it back.`); });
});

/* ---------- bulk edit ---------- */
let delArm = false;
function renderBulk() {
  for (const id of ui.sel) if (!S.all.some(l => l.id === id)) ui.sel.delete(id);
  const n = ui.sel.size; $("#bulkbar").hidden = !n;
  if (n) {
    $("#bb-n").textContent = `${n} selected`;
    $("#bb-cust").innerHTML = S.customers.length ? custOptions($("#bb-cust").value) : '<option value="">Add a consignor first</option>';
    $("#bb-batch").innerHTML = S.batches.length ? batchOptions($("#bb-batch").value, "") + '<option value="__out">Take out of batch</option>' : '<option value="">No batches yet</option>';
    if (!delArm) $("#bb-del").textContent = "Remove";
    if (!purgeArm) $("#bb-purge").textContent = "Delete for good";
  }
  const need = S.listings.filter(l => !custById(l.cust)).length;
  $("#needs").hidden = !need;
  $("#needs").innerHTML = need ? `<span><span class="need">${need} card${need === 1 ? " needs" : "s need"} a consignor</span> <span class="muted" style="font-size:12px">Customers can’t see these until they’re assigned.</span></span><button class="btn sm" type="button" id="needs-go">Show and select them</button>` : "";
  const vis = ui.visible, k = vis.filter(id => ui.sel.has(id)).length, all = $("#selAll");
  all.checked = vis.length > 0 && k === vis.length; all.indeterminate = k > 0 && k < vis.length;
}
const selected = () => S.all.filter(l => ui.sel.has(l.id));
async function bulk(btn, fn) {
  btn.disabled = true;
  await guarded($("#ledger-msg"), fn);
  btn.disabled = false; delArm = false; renderLedger();
}
$("#selAll").addEventListener("change", e => { ui.visible.forEach(id => e.target.checked ? ui.sel.add(id) : ui.sel.delete(id)); delArm = false; renderLedger(); });
$("#needs").addEventListener("click", e => {
  if (e.target.id !== "needs-go") return;
  ["#f-q", "#f-plat", "#f-st", "#f-batch"].forEach(s => { $(s).value = ""; }); $("#f-cust").value = "__none";
  ui.sel = new Set(S.listings.filter(l => !custById(l.cust)).map(l => l.id)); renderLedger();
});
$("#bb-cust-go").addEventListener("click", e => bulk(e.target, async () => {
  const c = custById($("#bb-cust").value); if (!c) return;
  const ls = selected();
  await commit(ls.map(l => upd(l.id, { cust: c.id, custEmail: c.email })));
  ui.sel.clear(); lmsg(`Assigned ${plural(ls.length)} to ${c.name}. They now show on ${c.name.split(" ")[0]}’s page.`);
}));
$("#bb-st-go").addEventListener("click", e => bulk(e.target, async () => {
  const s = $("#bb-st").value, ls = selected();
  await commit(ls.map(l => upd(l.id, (s === "sold" || s === "paid") && !l.soldDate ? { status: s, soldDate: now() } : { status: s })));
  lmsg(`Set ${plural(ls.length)} to ${STAT[s]}.`);
}));
$("#bb-fmt-go").addEventListener("click", e => bulk(e.target, async () => {
  const f = $("#bb-fmt").value, ls = selected();
  await commit(ls.map(l => upd(l.id, { format: f })));
  lmsg(`Set ${plural(ls.length)} to ${f === "bin" ? "Buy It Now" : "Auction"}.`);
}));
$("#bb-batch-go").addEventListener("click", e => bulk(e.target, async () => {
  const v = $("#bb-batch").value, ls = selected(); if (!v) return;
  if (v === "__out") { await commit(ls.map(l => upd(l.id, { batch: "" }))); lmsg(`Took ${plural(ls.length)} out of their batch.`); return; }
  const b = batchById(v); let got = 0;
  await commit(ls.map(l => { if (!custById(l.cust)) { got++; return upd(l.id, { batch: b.id, cust: b.cust, custEmail: emailOf(b.cust) }); } return upd(l.id, { batch: b.id }); }));
  lmsg(`Added ${plural(ls.length)} to batch ${b.id}.` + (got ? ` ${got} had no consignor and now belong to ${custById(b.cust)?.name}.` : ""));
}));
$("#bb-del").addEventListener("click", e => {
  const n = ui.sel.size;
  if (!delArm) { delArm = true; e.target.textContent = `Click again to remove ${plural(n)}`; return; }
  bulk(e.target, async () => {
    const ls = selected();
    await commit(ls.map(softRemove));
    ui.sel.clear(); lmsg(`Removed ${plural(ls.length)}. They’re in the Removed tab, where you can restore them.`);
  });
});
const softRemove = l => upd(l.id, { status: "removed", prevStatus: l.status === "removed" ? (l.prevStatus || "live") : l.status, removedAt: now(), removedBy: me });
const restoreOp = l => upd(l.id, { status: l.prevStatus || "live", prevStatus: null, removedAt: null });
$("#bb-restore").addEventListener("click", e => bulk(e.target, async () => {
  const ls = selected().filter(l => l.status === "removed");
  await commit(ls.map(restoreOp));
  ui.sel.clear(); lmsg(`Restored ${plural(ls.length)}.`);
}));
let purgeArm = false;
$("#bb-purge").addEventListener("click", e => {
  const ls = selected().filter(l => l.status === "removed");
  if (!purgeArm) { purgeArm = true; e.target.textContent = `Click again to delete ${plural(ls.length)} for good`; return; }
  purgeArm = false;
  bulk(e.target, async () => {
    await commit(ls.map(l => ["delete", listingRef(l.id)]));
    for (const id of new Set(ls.map(l => l.photo?.id).filter(Boolean))) await dropPhotoIfUnused(id, ls.map(l => l.id));
    ui.sel.clear(); lmsg(`Deleted ${plural(ls.length)} for good.`);
  });
});
$("#bb-clear").addEventListener("click", () => { ui.sel.clear(); delArm = false; renderLedger(); });

/* ---------- batches ---------- */
let editingBatch = "", pending = [], bDelArm = "";
function renderBatches() {
  const pc = $("#b-cust").value;
  $("#b-cust").innerHTML = '<option value="">Choose…</option>' + `<option value="__multi"${pc === "__multi" ? " selected" : ""}>Several customers (PC shipment)</option>` + custOptions(pc);
  const bc = $("#bf-cust").value; $("#bf-cust").innerHTML = custOptions(bc, true);
  if (!$("#b-recv").value && !editingBatch) $("#b-recv").value = today();
  const sort = $("#bf-sort").value, nm = b => custById(b.cust)?.name || "~";
  const byBatch = new Map();
  for (const l of S.listings) if (l.batch) (byBatch.get(l.batch) || byBatch.set(l.batch, []).get(l.batch)).push(l);
  const cardsIn = id => byBatch.get(id) || [];
  const list = S.batches.filter(b => !bc || b.cust === bc).sort(
    sort === "cust" ? (a, b) => nm(a).localeCompare(nm(b)) || (b.recv || "").localeCompare(a.recv || "") :
    sort === "ship" ? (a, b) => (b.ship || "9999").localeCompare(a.ship || "9999") : (a, b) => (b.recv || "").localeCompare(a.recv || ""));
  $("#b-count").textContent = `${S.batches.length} batch${S.batches.length === 1 ? "" : "es"}`;
  let last = null, html = "";
  list.forEach(b => {
    const c = custById(b.cust), cards = cardsIn(b.id), sold = cards.filter(isSold).length, notes = S.notes[b.id];
    if (sort === "cust" && b.cust !== last) {
      last = b.cust; const mineB = list.filter(x => x.cust === b.cust);
      html += `<tr class="grp"><td colspan="8">${c ? `<span class="code">${esc(c.code)}</span> ${esc(c.name)}` : b.cust ? "No customer" : "Several customers (PC shipments)"} <span class="muted" style="font-weight:400">· ${mineB.length} batch${mineB.length === 1 ? "" : "es"} · ${mineB.reduce((s, x) => s + (x.cards || cardsIn(x.id).length), 0)} cards</span></td></tr>`;
    }
    html += `<tr data-b="${esc(b.id)}">
      <td><span class="code">${esc(b.id)}</span>${notes ? `<div class="cert" style="white-space:normal;max-width:180px">${esc(notes)}</div>` : ""}</td>
      <td>${c ? esc(c.name) : b.cust ? "—" : "Several customers"}</td>
      <td><span class="chip ${b.plat}">${b.plat === "fan" ? "Fanatics" : "PC Sportscards"}</span></td>
      <td class="num">${fmtDay(b.recv)}</td>
      <td class="num">${b.ship ? fmtDay(b.ship) : '<span class="need">Not shipped</span>'}</td>
      <td class="num">${cards.some(isDropoff) ? (() => { const its = cards.filter(isDropoff).flatMap(d => d.items || []); return `${b.cards || its.length} sent<div class="cert">${cards.filter(isDropoff).length} drop-offs · ${its.length} itemized · ${its.filter(x => x.status === "sold" || x.status === "paid").length} sold</div>`; })() : `${b.cards || cards.length} sent<div class="cert">${cards.length} listed · ${sold} sold</div>`}</td>
      <td>${thumbsHtml(b, 3)}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn ghost sm" type="button" data-ba="cards">Show cards</button><button class="btn ghost sm" type="button" data-ba="edit">Edit</button><button class="btn ghost sm" type="button" data-ba="del">${bDelArm === b.id ? "Click again to remove" : "Remove"}</button></div></td>
    </tr>`;
    // PC shipments: one line per customer drop-off SKU inside the batch.
    const drops = cards.filter(isDropoff).sort((a, b) => (custById(a.cust)?.name || "").localeCompare(custById(b.cust)?.name || "") || (a.dropDate || "").localeCompare(b.dropDate || ""));
    drops.forEach(d => {
      const dc = custById(d.cust), sm = dropoffSummary(d.items);
      html += `<tr class="sub"><td></td><td colspan="7"><div class="row" style="gap:10px"><button class="linkbtn code" type="button" data-open="${d.id}">SKU ${esc(d.sku)}</button><span>${dc ? esc(dc.name) : "No customer"}</span><span class="muted">dropped off ${d.dropDate ? fmtDay(d.dropDate) : "?"} · ${(d.items || []).length}${d.expected ? ` of ${d.expected}` : ""} cards · ${sm.sold + sm.paid} sold · ${(d.photos || []).length} photo${(d.photos || []).length === 1 ? "" : "s"}</span>${(d.photos || []).length ? `<span class="thumbs">${d.photos.slice(0, 3).map((p, i) => `<button class="thumb" type="button" data-ph="L:${d.id}" data-i="${i}" aria-label="Photo ${i + 1}" style="width:32px;height:32px"><img src="${p.thumb}" alt=""></button>`).join("")}</span>` : ""}</div></td></tr>`;
    });
  });
  $("#b-body").innerHTML = html || '<tr><td colspan="8"><div class="empty">No batches yet. Log one above when a customer drops off cards.</div></td></tr>';
}
function renderPending() {
  $("#b-pending").innerHTML = pending.map((p, i) => `<span class="thumb"><img src="${p.thumb}" alt="Photo ${i + 1}"><button class="rm" type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></span>`).join("");
}
function resetBatchForm() {
  editingBatch = ""; pending = []; ["#b-cards", "#b-ship", "#b-notes"].forEach(s => { $(s).value = ""; }); $("#b-recv").value = today();
  $("#b-save").textContent = "Log batch"; $("#b-cancel").hidden = true; renderPending();
}
async function fullPhoto(file) {
  for (const [px, qy] of [[1600, .8], [1200, .72], [900, .65]]) {
    const d = await shrink(file, px, qy);
    if (!d) return null;
    if (d.length < 900000) return d;
  }
  return null;
}
$("#b-photos").addEventListener("change", async e => {
  const files = [...e.target.files]; if (!files.length) return;
  if (pending.length + files.length > 40) { e.target.value = ""; $("#b-msg").textContent = `A batch can hold up to 40 photos. This batch has ${pending.length}, so add ${Math.max(0, 40 - pending.length)} or fewer.`; return; }
  $("#b-msg").textContent = `Preparing ${files.length} photo${files.length === 1 ? "" : "s"}…`;
  let bad = 0;
  for (const f of files) {
    const full = await fullPhoto(f), thumb = full && await shrink(f, 220, .7);
    if (full && thumb) pending.push({ thumb, full }); else bad++;
  }
  e.target.value = ""; $("#b-msg").textContent = bad ? `${bad} file${bad === 1 ? " wasn’t an image" : "s weren’t images"} and got skipped.` : ""; renderPending();
});
$("#b-pending").addEventListener("click", e => { const i = e.target.dataset.rm; if (i != null) { pending.splice(+i, 1); renderPending(); } });
$("#bForm").addEventListener("submit", async e => {
  e.preventDefault();
  const say = t => { $("#b-msg").textContent = t; };
  const cv = $("#b-cust").value, multi = cv === "__multi", cust = multi ? "" : cv;
  if (!multi && !custById(cust)) return say("Choose the customer this batch belongs to, or Several customers for a PC shipment.");
  const recv = $("#b-recv").value, ship = $("#b-ship").value;
  if (!recv) return say("Enter the date you received the cards.");
  if (ship && ship < recv) return say("The ship date is before the date received. Check the dates.");
  $("#b-save").disabled = true;
  await guarded($("#b-msg"), async () => {
    const old = editingBatch ? batchById(editingBatch) : null;
    const id = old ? old.id : "B-" + String(await reserve("batch", 1, maxBatchNo())).padStart(4, "0");
    const email = emailOf(cust);
    const fresh = pending.filter(p => !p.id);
    let k = 0;
    for (const p of fresh) {
      say(`Uploading photo ${++k} of ${fresh.length}…`);
      const ref = doc(col("photos"));
      await setDoc(ref, { batch: id, cust, custEmail: email, data: p.full, createdAt: serverTimestamp() });
      p.id = ref.id; delete p.full;
    }
    const keep = new Set(pending.map(p => p.id));
    const ops = [];
    (old?.photos || []).filter(p => !keep.has(p.id)).forEach(p => ops.push(["delete", doc(db, "photos", p.id)]));
    if (old && old.cust !== cust) {
      const ph = await getDocs(query(col("photos"), where("batch", "==", id)));
      ph.docs.filter(d => keep.has(d.id)).forEach(d => ops.push(["update", d.ref, { cust, custEmail: email }]));
    }
    ops.push(["set", doc(db, "batches", id), {
      cust, custEmail: email, plat: $("#b-plat").value, cards: parseInt($("#b-cards").value, 10) || 0, recv, ship,
      photos: pending.map(p => ({ id: p.id, thumb: p.thumb })), updatedAt: serverTimestamp(), ...(old ? {} : { createdAt: serverTimestamp(), createdBy: me })
    }]);
    ops.push(["set", doc(db, "batchNotes", id), { notes: $("#b-notes").value.trim() }]);
    await commit(ops);
    say(`${old ? "Saved" : "Logged"} batch ${id}.`);
    resetBatchForm();
  });
  $("#b-save").disabled = false;
});
$("#b-cancel").addEventListener("click", () => { resetBatchForm(); $("#b-msg").textContent = ""; });
$("#bf-cust").addEventListener("change", renderBatches);
$("#bf-sort").addEventListener("change", renderBatches);
$("#b-body").addEventListener("click", async e => {
  const a = e.target.dataset.ba; if (!a) return;
  const id = e.target.closest("tr").dataset.b, b = batchById(id); if (!b) return;
  if (a === "cards") {
    ["#f-q", "#f-plat", "#f-st"].forEach(s => { $(s).value = ""; }); $("#f-cust").value = ""; $("#f-batch").value = id; bDelArm = ""; renderLedger();
    $("#ledger").scrollIntoView({ block: "start" });
  }
  if (a === "edit") {
    editingBatch = id; bDelArm = ""; $("#b-cust").value = b.cust || "__multi"; $("#b-plat").value = b.plat; $("#b-cards").value = b.cards || "";
    $("#b-recv").value = b.recv || ""; $("#b-ship").value = b.ship || ""; $("#b-notes").value = S.notes[id] || ""; pending = (b.photos || []).map(p => ({ ...p }));
    $("#b-save").textContent = `Save ${id}`; $("#b-cancel").hidden = false; $("#b-msg").textContent = ""; renderPending();
    $("#batches").scrollIntoView({ block: "start" });
  }
  if (a === "del") {
    if (bDelArm !== id) { bDelArm = id; renderBatches(); return; }
    bDelArm = "";
    await guarded($("#b-msg"), async () => {
      const ops = [["delete", doc(db, "batches", id)], ["delete", doc(db, "batchNotes", id)]];
      (b.photos || []).forEach(p => ops.push(["delete", doc(db, "photos", p.id)]));
      (await getDocs(query(col("listings"), where("batch", "==", id)))).docs.forEach(d => ops.push(upd(d.id, { batch: "" })));
      await commit(ops);
      $("#b-msg").textContent = `Removed batch ${id}. Its cards are still listed.`;
    });
  }
});

/* ---------- staff access ---------- */
function renderStaffList() {
  $("#staffList").innerHTML = [...S.staff].sort((a, b) => a.id.localeCompare(b.id)).map(s => `<div class="staff-row"><span>${esc(s.id)}${s.id === me ? ' <span class="muted">(you)</span>' : ""}</span>${s.id === me ? "" : `<button class="btn ghost sm" type="button" data-unstaff="${esc(s.id)}">${staffArm === s.id ? "Click again to remove" : "Remove"}</button>`}</div>`).join("");
}
let staffArm = "";
$("#staffForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#s-email").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("#s-msg").textContent = "Enter a valid email."; return; }
  await guarded($("#s-msg"), async () => {
    await setDoc(doc(db, "staff", email), { addedBy: me, addedAt: serverTimestamp() });
    $("#s-email").value = ""; $("#s-msg").textContent = `${email} can now sign in at the staff page.`;
  });
});
$("#staffList").addEventListener("click", async e => {
  const em = e.target.dataset.unstaff; if (!em) return;
  if (staffArm !== em) { staffArm = em; renderStaffList(); return; }
  staffArm = "";
  await guarded($("#s-msg"), async () => { await deleteDoc(doc(db, "staff", em)); $("#s-msg").textContent = `Removed ${em}.`; });
});

/* ---------- spreadsheet import ---------- */
const FIELDS = [
  { k: "cust", label: "Consignor (code, email or name)", re: /consign|customer|owner|client|^code$|e-?mail/i, only: "full" },
  { k: "url", label: "Listing link", re: /url|link/i },
  { k: "item", label: "eBay item #", re: /item.?(id|#|no|num)|ebay.?(id|item|#|no)|listing.?(id|#|no)/i },
  { k: "title", label: "Card", re: /title|card|desc|player|name/i },
  { k: "grade", label: "Grade", re: /grade/i },
  { k: "cert", label: "Cert #", re: /cert|serial/i },
  { k: "price", label: "Price / current bid", re: /price|bid|amount|sold.?for|current|value/i },
  { k: "ends", label: "Auction ends", re: /end|clos/i },
  { k: "format", label: "Format", re: /format|listing.?type|^type$/i, only: "full" },
  { k: "status", label: "Status", re: /status|state/i },
  { k: "sku", label: "SKU", re: /sku/i },
  { k: "plat", label: "Auction house", re: /platform|site|market|auction ?house/i, only: "full" },
  { k: "batch", label: "Batch", re: /batch/i, only: "full" },
];
let imp = null, importing = false;
const itype = () => document.querySelector('input[name="itype"]:checked').value;
function cellStr(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") return isNaN(v) ? "" : v.toISOString();
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v ?? "").trim();
}
// Columns for a consignor list. Order matters: the first rule that matches a header claims it.
const CFIELDS = [
  { k: "code", label: "Consignor code", re: /^number$|^code$|consignor ?(code|#|id|number)|account ?(#|no|number)|cust.?id/i },
  { k: "since", label: "Consignor since", re: /^created$|created on|date added|^since/i },
  { k: "byName", label: "Created by", re: /created by|added by/i },
  { k: "email", label: "Email (their login)", re: /e-?mail/i },
  { k: "phone", label: "Phone", re: /phone|cell|mobile|tel/i },
  { k: "first", label: "First name", re: /first/i },
  { k: "last", label: "Last name", re: /^last ?name$|surname|^last$/i },
  { k: "name", label: "Full name", re: /^(full ?)?name$|^(consignor|customer|client)( name)?$/i },
  { k: "company", label: "Company (used if no name)", re: /company|business/i },
  { k: "balance", label: "Balance", re: /^balance/i },
  { k: "payable", label: "Payable (owed now)", re: /payable|owed/i },
  { k: "rate", label: "Split / payout %", re: /^payout$|payout ?%|split|^rate$|percent/i },
  { k: "invType", label: "Inventory type", re: /inventory type/i },
  { k: "pay1", label: "Payout info (Address line 1)", re: /address line 1|address 1|^address$|street|payout (info|details)/i },
  { k: "pay2", label: "Payment method", re: /payment method|pay(out)? method|venmo|paypal/i },
  { k: "addr2", label: "Address line 2", re: /address line 2|address 2/i },
  { k: "city", label: "City", re: /^city$/i },
  { k: "state", label: "State", re: /^state$/i },
  { k: "zip", label: "Zip", re: /zip|postal/i },
  { k: "notify", label: "Notifications", re: /notif|opt.?in|subscribe/i },
];
// Payout info in old exports is free text spread over Address Line 1 and Payment Method:
// "Venmo: @handle", "PayPal: x@y.com", "Check/Bill Pay", or a street address for checks.
function parsePayout(p1, p2, a2, city, state, zip) {
  const clean = s => String(s || "").trim();
  const isAddr = s => /^\d+\s+[A-Za-z]/.test(s) && !/@/.test(s);
  const street = [p1, a2].map(clean).filter(isAddr);
  const pay = [p2, p1, a2].map(clean).filter(s => s && !isAddr(s));
  const tail = [clean(city), [clean(state), clean(zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const mailing = street.length || clean(city) ? [...street, tail].filter(Boolean).join(", ") : "";
  let payMethod = "", payTo = "";
  const notes = [];
  for (const s of pay) {
    let m, d = "";
    if (/venmo/i.test(s) || /^@/.test(s)) { m = "venmo"; d = s.replace(/venmo/i, "").replace(/^[\s:@]+/, "").replace(/\s+/g, ""); d = d ? "@" + d : ""; }
    else if (/paypal/i.test(s)) { m = "paypal"; d = (s.match(/[^\s@:]+@[^\s@]+\.[A-Za-z]{2,}/) || [""])[0].toLowerCase(); }
    else if (/check|bill ?pay/i.test(s)) m = "check";
    else { m = "other"; d = s; }
    if (!payMethod) { payMethod = m; payTo = d; } else notes.push(s);
  }
  if (!payMethod && mailing) payMethod = "check";
  return { payMethod, payTo, mailing, payNote: notes.join("; ") };
}
const money2 = v => { const n = parseFloat(String(v || "").replace(/[^0-9.-]/g, "")); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
// Fanatics collection export: only these columns are used, everything else in the file is ignored.
const FFIELDS = [
  { k: "url", label: "Listing link (the column you add)", re: /url|link/i },
  { k: "cert", label: "Cert #", re: /cert/i },
  { k: "title", label: "Card", re: /title|card|desc/i },
  { k: "grade", label: "Grade", re: /grade/i },
];
// Item export from the old consignment system (one row per card ever consigned).
const HFIELDS = [
  { k: "sku", label: "SKU", re: /^sku$/i },
  { k: "account", label: "Account (consignor code)", re: /^account$/i },
  { k: "invType", label: "Inventory type", re: /^inventory type$/i },
  { k: "status", label: "Status", re: /^status$/i },
  { k: "brand", label: "Brand (year & set)", re: /^brand$/i },
  { k: "desc", label: "Description (player)", re: /^description$/i },
  { k: "details", label: "Details (parallel)", re: /^details$/i },
  { k: "cardno", label: "Card number", re: /^card number$/i },
  { k: "color", label: "Color (older card numbers)", re: /^colou?r$/i },
  { k: "size", label: "Size (older grades & lots)", re: /^size$/i },
  { k: "grade", label: "Grade (Cert)", re: /^grade/i },
  { k: "title", label: "Title (fallback)", re: /^title$/i },
  { k: "shelf", label: "Shelf (auction house)", re: /^shelf$/i },
  { k: "paid", label: "Paid (Yes?)", re: /^paid/i },
  { k: "created", label: "Created", re: /^created$/i },
  { k: "soldDate", label: "Last sold", re: /^last sold$/i },
  { k: "salePrice", label: "Sale price", re: /^historic sale price$/i },
  { k: "portion", label: "Consignor portion", re: /^historic consignor portion$/i },
  { k: "tagPrice", label: "Tag price", re: /^tag price$/i },
  { k: "auction", label: "Auction No. / payout month", re: /^auction/i },
];
// PC Sportscards "My Consignments" export. Cards are identified by PC Sportscards' own Card #.
const PFIELDS = [
  { k: "pcsId", label: "PC Sportscards card #", re: /^card ?#$|^card ?(id|no|number)$/i },
  { k: "title", label: "Card", re: /^card$|title|description/i },
  { k: "status", label: "Status", re: /^status$/i },
  { k: "listed", label: "Date listed", re: /listed/i },
  { k: "soldDate", label: "Date sold", re: /date sold/i },
  { k: "paidDate", label: "Date paid", re: /date paid/i },
  { k: "price", label: "Sale price / current bid", re: /sales? price|^price$|current|bid/i },
  { k: "net", label: "Your payout (after fees)", re: /your payout|payout|^net/i },
  { k: "grade", label: "Grade (optional)", re: /^grade/i },
  { k: "cert", label: "Cert # (optional)", re: /cert/i },
  { k: "item", label: "eBay item # (optional)", re: /item.?(#|id|no|num)|ebay.?(#|id|item)/i },
  { k: "url", label: "Link (optional)", re: /url|link/i },
  { k: "ends", label: "Auction ends (optional)", re: /^end|ends|closing/i },
];
const FLISTS = { cust: CFIELDS, fan: FFIELDS, hist: HFIELDS, pcs: PFIELDS };
const fieldsFor = type => FLISTS[type] || FIELDS.filter(f => !f.only || f.only === type);
function guessMap(headers, type) {
  const map = {}, used = new Set();
  (FLISTS[type] || FIELDS).forEach(f => {
    if (f.only && f.only !== type) { map[f.k] = -1; return; }
    const i = headers.findIndex((h, ix) => !used.has(ix) && f.re.test(h));
    map[f.k] = i; if (i >= 0) used.add(i);
  });
  return map;
}
function readFile(file) {
  if (!file) return;
  if (!window.XLSX) { $("#i-msg").textContent = "The spreadsheet reader didn’t load. Check your connection and reload the page."; return; }
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const isText = /\.(csv|tsv|txt)$/i.test(file.name);
      const wb = XLSX.read(new Uint8Array(fr.result), { type: "array", raw: isText, cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }).map(r => r.map(cellStr));
      const hi = all.findIndex(r => r.filter(Boolean).length >= 2);
      if (hi < 0) throw new Error("empty");
      const headers = all[hi].map((h, i) => h || `Column ${i + 1}`);
      const rows = all.slice(hi + 1).filter(r => r.some(Boolean));
      imp = { file: file.name, headers, rows, map: guessMap(headers, itype()) };
      if (itype() !== "cust") loadHistory().then(() => renderImport());
      $("#drop-t").innerHTML = `<b>${esc(file.name)}</b> · ${rows.length} rows · choose a different file`;
      $("#i-msg").textContent = "";
    } catch (err) { imp = null; $("#i-msg").textContent = `Couldn’t read ${file.name}. Save it as .csv or .xlsx and try again.`; }
    renderImport();
  };
  fr.readAsArrayBuffer(file);
}
function planImport() {
  const type = itype(), m = imp.map;
  const used = new Set(S.all.map(l => l.sku));
  let next = Math.max(S.counters.sku || 0, maxSku()) + 1;
  const byItem = new Map(S.all.filter(l => l.item).map(l => [l.item, l]));
  const seen = new Set(), pick = batchById($("#i-batch").value);
  return imp.rows.map(r => {
    const g = k => m[k] >= 0 ? String(r[m[k]] ?? "").trim() : "";
    let url = g("url"), item = g("item").replace(/\D/g, ""); const d = detect(url);
    if (!item && d) item = d.item;
    const pv = g("plat");
    const plat = type === "pcs" ? "pcs" : d ? d.plat : /fan/i.test(pv) ? "fan" : /pc|ebay/i.test(pv) ? "pcs" : "";
    if (!url && item && plat === "pcs") url = "https://www.ebay.com/itm/" + item;
    const title = g("title");
    if (!title && !item && !url) return null;
    const label = title || item || url;
    if (!plat) return { act: "skip", why: type === "full" ? "No link or auction house" : "No Fanatics or eBay link", label };
    if (!url && type !== "full") return { act: "skip", why: "No link or eBay item #", label };
    if (!title) return { act: "skip", why: "No card title", label };
    if (item) { if (seen.has(item)) return { act: "skip", why: "Same item # is in the file twice", label }; seen.add(item); }
    const grade = normGrade(g("grade")), cert = g("cert");
    const pr = g("price").replace(/[^0-9.]/g, ""), price = pr ? parseFloat(pr) : null;
    const et = g("ends") ? Date.parse(g("ends")) : NaN, ends = isNaN(et) ? "" : new Date(et).toISOString();
    const sv = g("status").toLowerCase();
    const status = !sv ? "" : /unsold|not sold|no sale|return/.test(sv) ? "unsold" : /paid/.test(sv) ? "paid" : /sold/.test(sv) ? "sold" : "live";
    const fv = g("format").toLowerCase();
    const format = /bin|buy|fixed/.test(fv) ? "bin" : /auc/.test(fv) ? "auction" : plat === "pcs" ? "auction" : "bin";
    const bt = pick || (g("batch") && batchById(g("batch").toUpperCase())) || null;
    let cust = "", warn = "";
    if (type === "full") {
      const cv = g("cust").toLowerCase();
      const c = cv && S.customers.find(x => x.code.toLowerCase() === cv || (x.email || "").toLowerCase() === cv || x.name.toLowerCase() === cv);
      if (c) cust = c.id; else warn = cv ? `Consignor “${g("cust")}” not found` : "No consignor in this row";
    }
    if (!cust && bt) { cust = bt.cust; warn = ""; }
    const ex = item && byItem.get(item);
    if (ex && ex.status === "removed") return { act: "skip", why: `Removed earlier (SKU ${ex.sku}). Restore it from the Removed tab to bring it back.`, label };
    if (ex) return { act: "update", label: title, target: ex, price, ends, status, cust, batch: bt ? bt.id : "", warn: "" };
    let sku = g("sku").replace(/\D/g, ""), auto = false;
    sku = sku && sku.length <= 6 ? pad6(sku) : "";
    if (!sku || used.has(sku)) { while (used.has(pad6(next))) next++; sku = pad6(next++); auto = true; }
    used.add(sku);
    if (grade !== "Ungraded" && !cert) warn = warn || "Graded, but no cert #";
    return { act: "new", label: title, warn, auto, data: { sku, cust, batch: bt ? bt.id : "", plat, url, item, title, grade, cert, format, price, ends, status: status || (url ? "live" : "curating"), soldDate: (status === "sold" || status === "paid") ? now() : "" } };
  }).filter(Boolean);
}
function planCust() {
  const m = imp.map;
  const byEmail = new Map(S.customers.filter(c => c.email).map(c => [c.email.toLowerCase(), c]));
  const byName = new Map(S.customers.map(c => [c.name.toLowerCase(), c]));
  const byCode = new Map(S.customers.map(c => [c.code, c]));
  const codes = new Set(S.customers.map(c => c.code));
  const seen = new Set();
  return imp.rows.map(r => {
    const g = k => m[k] >= 0 ? String(r[m[k]] ?? "").trim() : "";
    let name = g("name") || [g("first"), g("last")].filter(Boolean).join(" ");
    if (g("name") && g("last") && !g("name").includes(g("last"))) name = [g("name"), g("last")].join(" ");
    const company = g("company");
    name = (name || company).replace(/\s+/g, " ").trim();
    const email = g("email").toLowerCase();
    if (!name && !email) return null;
    const label = name || email;
    if (!name) return { act: "skip", why: "No name or company", label, email };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { act: "skip", why: "Email doesn’t look right", label, email };
    if (email && seen.has(email)) return { act: "skip", why: "Same email is in the file twice", label, email };
    if (email) seen.add(email);
    const fileCode = g("code").toUpperCase().replace(/\s+/g, "");
    const ex = (email && byEmail.get(email)) || (fileCode && byCode.get(fileCode) && byCode.get(fileCode).name.toLowerCase() === name.toLowerCase() && byCode.get(fileCode)) || (!email && byName.get(name.toLowerCase()));
    if (ex) return { act: "skip", why: `Already a consignor (${ex.code})`, label, email };
    let rate = parseFloat(g("rate").replace(/[^0-9.]/g, ""));
    if (rate > 0 && rate <= 1) rate = Math.round(rate * 1000) / 10;
    if (isNaN(rate) || rate < 0 || rate > 100) rate = 85;
    const code = fileCode && !codes.has(fileCode) ? fileCode : nextCode(name, codes);
    codes.add(code);
    const pay = parsePayout(g("pay1"), g("pay2"), g("addr2"), g("city"), g("state"), g("zip"));
    const st = g("since"), sinceT = st ? Date.parse(st) : NaN;
    const nv = g("notify");
    const data = {
      code, name, email, phone: fmtPhone(g("phone")), rate, ...pay,
      company: company && company !== name ? company : "",
      since: isNaN(sinceT) ? "" : new Date(sinceT).toISOString().slice(0, 10),
      addedByName: g("byName"), invType: g("invType"),
      balance: money2(g("balance")), payable: money2(g("payable")),
      notify: nv ? !/^(false|no|n|0|off)$/i.test(nv) : true,
    };
    const warns = [];
    if (!email) warns.push("No email, so they can’t sign in until you add one");
    if (!pay.payMethod) warns.push("No payout method");
    else if (pay.payMethod === "paypal" && !pay.payTo) warns.push("PayPal email missing");
    else if (pay.payMethod === "check" && !pay.mailing) warns.push("No mailing address for checks");
    if (fileCode && fileCode !== code) warns.push(`Code ${fileCode} was taken, so this one is ${code}`);
    return { act: "new", label: name, email, warn: warns.join(" · "), data };
  }).filter(Boolean);
}
// Match each row of a Fanatics export to a card already entered: cert number first, then exact title.
function planFan() {
  const m = imp.map, pick = batchById($("#i-batch").value);
  const digits = v => String(v || "").replace(/\D/g, "");
  const norm = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byCert = new Map();
  S.listings.filter(l => digits(l.cert)).sort((a, b) => (a.plat === "fan" ? 1 : 0) - (b.plat === "fan" ? 1 : 0)).forEach(l => byCert.set(digits(l.cert), l));
  const byTitle = new Map();
  S.listings.filter(l => l.plat === "fan" && !l.url).forEach(l => { const k = norm(l.title); byTitle.set(k, byTitle.has(k) ? null : l); });
  const used = new Set(), usedSku = new Set(S.all.map(l => l.sku));
  let next = Math.max(S.counters.sku || 0, maxSku()) + 1;
  return imp.rows.map(r => {
    const g = k => m[k] >= 0 ? String(r[m[k]] ?? "").trim() : "";
    const url = g("url"), title = g("title"), cert = digits(g("cert")), grade = normGrade(g("grade"));
    if (!url && !title && !cert) return null;
    const label = title || `Cert ${cert}`;
    const d = url ? detect(url) : null;
    if (url && !d) return { act: "skip", why: "Link isn’t from Fanatics Collect or eBay", label };
    let t = cert && byCert.get(cert), how = "cert";
    if (!t) { t = byTitle.get(norm(title)); how = "title"; }
    if (t && used.has(t.id)) return { act: "skip", why: `Same card as another row (SKU ${t.sku})`, label };
    if (t) {
      used.add(t.id);
      if (!url) return { act: "skip", why: `No link yet (matches SKU ${t.sku})`, label };
      if (t.url === url) return { act: "skip", why: `Already linked (SKU ${t.sku})`, label };
      const patch = { url, item: d.item, plat: d.plat };
      if (t.status === "curating") patch.status = "live";
      if (!digits(t.cert) && cert) patch.cert = cert;
      if ((!t.grade || t.grade === "Ungraded") && grade !== "Ungraded") patch.grade = grade;
      if (!custById(t.cust) && pick) { patch.cust = pick.cust; patch.custEmail = emailOf(pick.cust); patch.batch = pick.id; }
      return { act: "update", how, target: t, patch, label: t.title, grade, cert };
    }
    if (!url) return { act: "skip", why: "No link, and no matching card entered", label };
    while (usedSku.has(pad6(next))) next++;
    const sku = pad6(next++); usedSku.add(sku);
    return { act: "new", auto: true, label, warn: pick ? "" : "No matching card. Added for you to assign.", data: { sku, cust: pick ? pick.cust : "", batch: pick ? pick.id : "", plat: d.plat, url, item: d.item, title, grade, cert, format: d.plat === "pcs" ? "auction" : "bin", price: null, ends: "", status: "live", soldDate: "" } };
  }).filter(Boolean);
}
function pcsStatus(st) {
  st = st.toLowerCase();
  if (/received payment|paid/.test(st)) return "received";
  if (/sold/.test(st) && !/unsold/.test(st)) return "sold";
  if (/listed|active/.test(st)) return "live";
  if (/unsold|cancel|return|ended|expired/.test(st)) return "unsold";
  return "";
}
const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1, 12).toISOString().slice(0, 10); };
// PC Sportscards export → the unsorted list (meta/pcsPool), plus status updates for cards already sorted into drop-off SKUs.
const PRANK = { live: 1, unsold: 1, sold: 2, paid: 3 };
function planPcs() {
  const m = imp.map;
  const recent = parseInt($("#i-recent").value, 10) || 0;
  if (!$("#i-cutoff").value) $("#i-cutoff").value = firstOfMonth();
  const cutoff = $("#i-cutoff").value;
  const g = (r, k) => m[k] >= 0 ? String(r[m[k]] ?? "").trim() : "";
  const rows = imp.rows.map(r => ({ r, listed: isoDay(g(r, "listed")) })).sort((a, b) => b.listed.localeCompare(a.listed));
  const scan = recent ? rows.slice(0, recent) : rows;
  const inDrop = new Map();
  S.all.filter(isDropoff).forEach(l => (l.items || []).forEach((x, i) => { if (x.pcsId) inDrop.set(x.pcsId, { lot: l, i }); }));
  const inPool = new Map((S.pool || []).map(x => [x.pcsId, x]));
  const asCard = new Map(S.all.filter(l => l.pcsId && !isDropoff(l)).map(l => [l.pcsId, l]));
  const seen = new Set();
  return scan.map(({ r, listed }) => {
    const pcsId = g(r, "pcsId").replace(/\.0+$/, ""), title = g(r, "title");
    if (!pcsId && !title) return null;
    const label = title || `Card #${pcsId}`;
    if (!pcsId) return { act: "skip", why: "No PC Sportscards card #", label };
    if (seen.has(pcsId)) return { act: "skip", why: "Same card # twice in the file", label };
    seen.add(pcsId);
    const kind = m.status >= 0 ? pcsStatus(g(r, "status")) : "live";
    if (!kind) return { act: "skip", why: `Status “${g(r, "status")}”`, label };
    const status = kind === "received" ? "sold" : kind;
    const pcsPaid = isoDay(g(r, "paidDate")), soldDate = isoDay(g(r, "soldDate")) || pcsPaid;
    const price = money2(g(r, "price")), net = money2(g(r, "net"));
    const gm = title.match(/\b(PSA|SGC|BGS|CGC|TAG|HGA)\s*(\d+(?:\.\d)?|Authentic|Auth)\b/i);
    const fresh = { pcsId, title, status, listed, soldDate: status === "sold" ? soldDate : "", pcsPaid, price: price || null, net: status === "sold" ? net : null, grade: gm ? `${gm[1].toUpperCase()} ${gm[2]}` : "" };
    // Already sorted into a drop-off: move its status forward, never backward.
    const d = inDrop.get(pcsId);
    if (d) {
      const x = d.lot.items[d.i], patch = {};
      if ((PRANK[status] || 0) > (PRANK[x.status] || 0) || (x.status === "live" && status === "unsold")) patch.status = status;
      if (price && price !== x.price) patch.price = price;
      if (status === "sold" && net && net !== x.net && x.status !== "paid") patch.net = net;
      if (status === "sold" && soldDate && !x.soldDate) patch.soldDate = soldDate;
      if (pcsPaid && !x.pcsPaid) patch.pcsPaid = pcsPaid;
      if (!Object.keys(patch).length) return { act: "skip", why: "No change", label, same: true };
      return { act: "item", lot: d.lot, i: d.i, patch, label, change: patch.status ? `${ITEM_STAT[x.status]} → ${ITEM_STAT[patch.status]}` : "sale details" };
    }
    const old = asCard.get(pcsId);
    if (old) return { act: "skip", why: old.status === "removed" ? `Removed earlier (SKU ${old.sku})` : `Already a card (SKU ${old.sku})`, label, same: true };
    const p = inPool.get(pcsId);
    if (p) {
      const changed = (PRANK[status] || 0) > (PRANK[p.status] || 0) || (p.status === "live" && status === "unsold") || (price && price !== p.price) || (status === "sold" && net !== p.net);
      return changed ? { act: "poolupd", row: { ...p, ...fresh, hidden: p.hidden || false }, label, change: "updated in the unsorted list" } : { act: "skip", why: "Already in the unsorted list", label, same: true };
    }
    if (kind === "received" && pcsPaid && pcsPaid.slice(0, 10) < cutoff) return { act: "skip", why: "Paid before the cutoff (in an earlier monthly payout)", label, early: true };
    return { act: "pool", row: fresh, label };
  }).filter(Boolean);
}
function renderPcsImport() {
  $("#i-batchwrap").hidden = true; $("#i-pcswrap").hidden = false;
  $("#i-help").textContent = "New cards go into the “Sort PC Sportscards cards” list, where you add each customer’s drop-off to its own SKU. Cards you’ve already sorted get their listed, sold and payout details updated. Matching uses PC Sportscards’ card #.";
  $("#i-head").innerHTML = "<tr><th>Result</th><th>Card</th><th>Status</th><th>Sale</th></tr>";
  if (!S.hist) { $("#i-sum").textContent = "Checking for cards already in the system…"; $("#i-prev").innerHTML = ""; $("#i-go").disabled = true; return; }
  const plan = planPcs(), n = a => plan.filter(p => p.act === a).length;
  const recent = parseInt($("#i-recent").value, 10) || 0;
  $("#i-sum").innerHTML = `Read the newest ${(recent ? Math.min(recent, imp.rows.length) : imp.rows.length).toLocaleString()} of ${imp.rows.length.toLocaleString()} rows · <span class="act-new">${n("pool")} new to sort</span> · <span class="act-upd">${n("item")} updates to sorted cards</span>${n("poolupd") ? ` · ${n("poolupd")} updates to unsorted cards` : ""} · ${plan.filter(p => p.same).length} unchanged · <span class="act-skip">${plan.filter(p => p.early).length} paid before the cutoff</span>`;
  const order = { item: 0, pool: 1, poolupd: 2, skip: 3 };
  $("#i-prev").innerHTML = [...plan].sort((a, b) => order[a.act] - order[b.act]).slice(0, 12).map(p => {
    const r = p.row;
    const act = p.act === "pool" ? `<span class="act-new">New · to sort</span>` : p.act === "item" ? `<span class="act-upd">SKU ${esc(p.lot.sku)}: ${esc(p.change)}</span>` : p.act === "poolupd" ? `<span class="act-upd">Unsorted: updated</span>` : `<span class="act-skip">Skip: ${esc(p.why)}</span>`;
    const st = r ? ITEM_STAT[r.status] : p.patch?.status ? ITEM_STAT[p.patch.status] : "";
    const sale = r && r.status === "sold" ? `${money(r.price)}<div class="cert">${money(r.net)} after fees</div>` : "";
    return `<tr><td>${act}</td><td class="title">${esc(p.label)}</td><td>${st}</td><td class="num">${sale}</td></tr>`;
  }).join("") + (plan.length > 12 ? `<tr><td colspan="4" class="muted">…and ${(plan.length - 12).toLocaleString()} more rows</td></tr>` : "");
  const go = n("pool") + n("item") + n("poolupd");
  $("#i-go").disabled = !go;
  $("#i-go").textContent = go ? (n("pool") ? `Add ${n("pool")} to the sorting list` : "Save updates") + (n("item") ? ` and update ${n("item")} sorted cards` : "") : "Nothing new";
}
async function runPcsImport() {
  const plan = planPcs();
  const pool = new Map((S.pool || []).map(x => [x.pcsId, x]));
  const added = [];
  plan.forEach(p => { if (p.act === "pool") { pool.set(p.row.pcsId, p.row); added.push(p.row.pcsId); } if (p.act === "poolupd") pool.set(p.row.pcsId, p.row); });
  const byLot = new Map();
  plan.filter(p => p.act === "item").forEach(p => { const e = byLot.get(p.lot.id) || byLot.set(p.lot.id, { lot: p.lot, items: p.lot.items.map(x => ({ ...x })) }).get(p.lot.id); Object.assign(e.items[p.i], p.patch); });
  const ops = [...byLot.values()].map(e => upd(e.lot.id, dropPatch(e.items)));
  const updated = [...byLot.values()].map(e => ({ id: e.lot.id, before: { items: e.lot.items, status: e.lot.status, price: e.lot.price ?? null, lotCount: e.lot.lotCount ?? null } }));
  for (let i = 0; i < ops.length; i += 400) await commit(ops.slice(i, i + 400));
  if (added.length || plan.some(p => p.act === "poolupd")) await savePool([...pool.values()]);
  await logImport({ kind: "pcs", file: imp.file, created: [], updated, poolAdded: added });
  return { added: added.length, lots: byLot.size, items: plan.filter(p => p.act === "item").length };
}
function renderFanImport() {
  $("#i-batchwrap").hidden = false;
  $("#i-help").textContent = "Only the link, cert #, card title and grade are read. Everything else in the export is ignored. Each row is matched to a card you already entered, by cert number first, then by exact title. CGC 0 means ungraded.";
  $("#i-head").innerHTML = "<tr><th>Result</th><th>Card</th><th>Grade</th><th>Consignor</th></tr>";
  const plan = planFan(), n = a => plan.filter(p => p.act === a).length;
  const unassigned = plan.filter(p => p.act === "new" && !p.data.cust).length;
  $("#i-sum").innerHTML = `<span class="act-upd">${n("update")} matched and linked</span> · <span class="act-new">${n("new")} not entered yet</span> · <span class="act-skip">${n("skip")} skipped</span>${unassigned ? ` · <span class="need">${unassigned} will need a consignor</span>` : ""}`;
  const order = { update: 0, new: 1, skip: 2 };
  $("#i-prev").innerHTML = [...plan].sort((a, b) => order[a.act] - order[b.act]).slice(0, 12).map(p => {
    const c = p.act === "update" ? custById(p.target.cust) : p.data ? custById(p.data.cust) : null;
    const act = p.act === "update" ? `<span class="act-upd">Links SKU ${esc(p.target.sku)}</span><div class="cert">matched by ${p.how}</div>` : p.act === "new" ? `<span class="act-new">New · SKU ${p.data.sku}</span>` : `<span class="act-skip">Skip: ${esc(p.why)}</span>`;
    const gl = p.act === "update" ? { grade: p.patch.grade || p.target.grade, cert: p.patch.cert || p.target.cert } : p.data;
    return `<tr><td>${act}</td><td class="title">${esc(p.label)}</td><td>${gl ? gradeHtml(gl, true) : ""}</td><td>${p.act === "skip" ? "" : c ? esc(c.name) : '<span class="need">Needs consignor</span>'}${p.warn ? `<div class="cert" style="white-space:normal">${esc(p.warn)}</div>` : ""}</td></tr>`;
  }).join("") + (plan.length > 12 ? `<tr><td colspan="4" class="muted">…and ${plan.length - 12} more rows</td></tr>` : "");
  const go = n("update") + n("new");
  $("#i-go").disabled = !go;
  $("#i-go").textContent = go ? `Link ${n("update")} card${n("update") === 1 ? "" : "s"}` + (n("new") ? ` and add ${n("new")}` : "") : "Nothing to import";
}
const isTrue = v => /^(true|yes|y|1|x)$/i.test(String(v || "").trim());
const gradeish = v => /\b(PSA|SGC|BGS|CGC|HGA|TAG|ISA|GMA|Beckett|Ungraded|Encased|Raw|Auth)/i.test(v || "");
const isoDay = v => { const t = Date.parse(v || ""); return isNaN(t) ? "" : new Date(t).toISOString(); };
function platFromShelf(v) {
  v = String(v || "").toLowerCase();
  if (v.includes("fanatics")) return "fan";
  if (/\bpcs?\b|pc sports/.test(v)) return "pcs";
  if (v.includes("goldin")) return "goldin";
  if (v.includes("shibe")) return "shibe";
  return "other";
}
function planHistory() {
  const m = imp.map, countUnpaid = $("#i-unpaid").checked;
  const byCode = new Map(S.customers.map(c => [String(c.code || "").toUpperCase(), c]));
  const bySku = new Map(S.all.map(l => [l.sku, l]));
  const seen = new Set(), stats = { unpaid: 0, unpaidAmt: 0, unpaidRecent: 0, unpaidRecentAmt: 0, retail: 0, maxSku: 0 };
  const yr = String(new Date().getFullYear());
  const plan = imp.rows.map(r => {
    const g = k => m[k] >= 0 ? String(r[m[k]] ?? "").trim() : "";
    const skuRaw = g("sku").replace(/\D/g, "");
    if (!skuRaw && !g("title") && !g("desc")) return null;
    const sku = skuRaw ? pad6(skuRaw) : "";
    const label = [g("brand"), g("desc")].filter(Boolean).join(" ") || g("title") || `SKU ${sku}`;
    if (/retail/i.test(g("invType"))) { stats.retail++; return { act: "skip", why: "Wheelhouse retail inventory", label, sku }; }
    if (!sku) return { act: "skip", why: "No SKU", label };
    if (seen.has(sku)) return { act: "skip", why: "Same SKU twice in the file", label, sku };
    seen.add(sku);
    const st = g("status").toLowerCase();
    const paidFlag = isTrue(g("paid"));
    const portion = money2(g("portion")), sale = money2(g("salePrice"));
    let status;
    if (/sold/.test(st)) {
      if (!paidFlag) {
        stats.unpaid++; stats.unpaidAmt += portion;
        if (g("soldDate").startsWith(yr)) { stats.unpaidRecent++; stats.unpaidRecentAmt += portion; }
      }
      status = paidFlag || !countUnpaid ? "paid" : "sold";
    } else if (/return/.test(st)) status = "returned";
    else if (/active/.test(st)) status = "curating";
    else return { act: "skip", why: st ? `Status “${g("status")}”` : "No status", label, sku };
    const ex = bySku.get(sku);
    const lotN = (g("size").match(/(\d+)\s*cards?/i) || [])[1];
    const period = g("auction"), lotCount = lotN ? parseInt(lotN, 10) : null;
    if (ex && ex.src === "consigncloud" && ((period && !ex.period) || (lotCount && !ex.lotCount))) {
      const patch = {}; if (period && !ex.period) patch.period = period; if (lotCount && !ex.lotCount) patch.lotCount = lotCount;
      return { act: "update", target: ex, patch, label: ex.title, sku, dup: true, status, added: isoDay(g("created")) };
    }
    if (ex) return { act: "skip", why: ex.src === "consigncloud" ? "Already imported" : `SKU already used by “${ex.title}” in the new app`, label, sku, clash: ex.src !== "consigncloud", dup: ex.src === "consigncloud", status, added: isoDay(g("created")) };
    const c = byCode.get(g("account").toUpperCase());
    // Older rows keep the grade in Size and the card number in Color.
    const graw = g("grade") || (gradeish(g("size")) ? g("size") : "");
    const gm = graw.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const grade = normGrade(gm ? gm[1] : graw), cert = gm ? gm[2].trim() : "";
    const cardno = g("cardno") || (!g("grade") ? g("color") : "");
    const lot = g("size") && !gradeish(g("size")) ? ` (${g("size")})` : "";
    const base = [g("brand"), g("desc"), g("details")].filter(Boolean).join(" ") || g("title");
    const title = base + (cardno ? ` #${cardno.replace(/^#/, "")}` : "") + lot;
    const plat = platFromShelf(g("shelf"));
    const sold = status === "paid" || status === "sold";
    const tag = money2(g("tagPrice"));
    stats.maxSku = Math.max(stats.maxSku, parseInt(sku, 10));
    return {
      act: "new", label: title, sku, status, cust: c, warn: c ? "" : `Consignor ${g("account") || "(blank)"} isn’t in the system`,
      data: {
        sku, cust: c ? c.id : "", custEmail: c ? (c.email || "") : "", batch: "", plat, url: "", item: "", title, grade, cert,
        format: plat === "fan" || plat === "pcs" ? "auction" : "bin",
        price: sold ? sale : tag > 1 ? tag : null, ...(sold ? { payout: portion } : {}),
        ends: "", status, soldDate: sold ? isoDay(g("soldDate")) : "", added: isoDay(g("created")) || now(), src: "consigncloud",
        ...(period ? { period } : {}), ...(lotCount ? { lotCount } : {}),
      },
    };
  }).filter(Boolean);
  // Optional limit: keep the newest cards by date added; cards still in play always come in.
  const limit = parseInt($("#i-limit").value, 10) || 0;
  // Ranked across the whole file (including cards already brought in), so re-uploading never pulls in older cards.
  if (limit) {
    const cands = plan.filter(p => p.act === "new" || p.dup);
    const addedOf = p => (p.data ? p.data.added : p.added) || "";
    const keep = new Set(cands.filter(p => !PAST.includes(p.status)));
    cands.filter(p => PAST.includes(p.status)).sort((a, b) => addedOf(b).localeCompare(addedOf(a))).slice(0, Math.max(0, limit - keep.size)).forEach(p => keep.add(p));
    plan.forEach(p => { if (p.act === "new" && !keep.has(p)) { p.act = "skip"; p.why = "Older than the most recent " + limit.toLocaleString(); p.old = true; } });
  }
  return { plan, stats };
}
function renderHistImport() {
  $("#i-batchwrap").hidden = true; $("#i-optwrap").hidden = false; $("#i-limitwrap").hidden = false;
  $("#i-help").textContent = "Columns are matched to the old system’s item export. Wheelhouse retail inventory is left out. Each card keeps its original SKU, sale price and the exact amount the consignor received. Re-uploading the file skips cards already brought in.";
  $("#i-head").innerHTML = "<tr><th>Result</th><th>Card</th><th>Grade</th><th>Consignor</th><th>Sale</th></tr>";
  if (!S.hist) { $("#i-sum").textContent = "Checking for cards already in the system…"; $("#i-prev").innerHTML = ""; $("#i-go").disabled = true; return; }
  const { plan, stats } = planHistory();
  const fresh = plan.filter(p => p.act === "new"), n = st => fresh.filter(p => p.status === st).length, ups = plan.filter(p => p.act === "update").length;
  const noCust = fresh.filter(p => !p.data.cust).length, clash = plan.filter(p => p.clash).length;
  $("#i-unpaid-note").textContent = stats.unpaid ? ` The file marks ${stats.unpaid.toLocaleString()} sold cards as not paid (${money(stats.unpaidAmt)} to consignors), mostly from past years. Leave this off to treat them as paid out, so customers only see what’s owed on their consignor record. ${stats.unpaidRecent} of them sold this year (${money(stats.unpaidRecentAmt)}).` : "";
  $("#i-sum").innerHTML = `<span class="act-new">${fresh.length.toLocaleString()} cards to bring in</span>: ${n("paid").toLocaleString()} paid out, ${n("sold")} sold awaiting payout, ${n("returned")} returned, ${n("curating")} still out (shown as Being curated until linked) · <span class="act-skip">${(plan.length - fresh.length).toLocaleString()} skipped</span> (${stats.retail.toLocaleString()} retail${plan.some(p => p.old) ? `, ${plan.filter(p => p.old).length.toLocaleString()} older than your limit` : ""})${noCust ? ` · <span class="need">${noCust} without a matching consignor</span>` : ""}${clash ? ` · <span class="need">${clash} SKUs already used by cards you added in the new app. Delete or renumber those cards first.</span>` : ""}`;
  const order = p => p.act === "new" ? (p.warn ? 0 : 1) : p.clash ? 0 : 2;
  $("#i-prev").innerHTML = [...plan].sort((a, b) => order(a) - order(b)).slice(0, 12).map(p => {
    const d = p.data;
    const act = p.act === "new" ? `<span class="act-new">SKU ${esc(p.sku)} · ${STAT[p.status]}</span>` : p.act === "update" ? `<span class="act-upd">Updates SKU ${esc(p.sku)}</span>` : `<span class="act-skip">Skip: ${esc(p.why)}</span>`;
    return `<tr><td>${act}</td><td class="title">${esc(p.label)}${d ? `<div class="cert">${PLAT[d.plat]}${d.period ? ` · ${esc(d.period)}` : ""}${d.lotCount ? ` · ${d.lotCount} cards` : ""}</div>` : ""}</td><td>${d ? gradeHtml(d, true) : ""}</td><td>${d ? (p.cust ? esc(p.cust.name) : '<span class="need">Not found</span>') : ""}${p.warn ? `<div class="cert" style="white-space:normal">${esc(p.warn)}</div>` : ""}</td><td class="num">${d && d.payout != null ? `${money(d.price)}<div class="cert">${money(d.payout)} to consignor</div>` : ""}</td></tr>`;
  }).join("") + (plan.length > 12 ? `<tr><td colspan="5" class="muted">…and ${(plan.length - 12).toLocaleString()} more rows</td></tr>` : "");
  if (ups) $("#i-sum").innerHTML += ` · <span class="act-upd">${ups.toLocaleString()} already-imported cards get their payout month or lot size</span>`;
  $("#i-go").disabled = !fresh.length && !ups;
  $("#i-go").textContent = fresh.length ? `Bring in ${fresh.length.toLocaleString()} cards` : ups ? `Update ${ups.toLocaleString()} cards` : "Nothing to import";
}
function renderCustImport() {
  $("#i-batchwrap").hidden = true;
  $("#i-help").textContent = "These were matched from your file’s headers. Fix any that are wrong. Payout info is read from both Address Line 1 and Payment Method, and a street address with no Venmo or PayPal becomes a check. People already in the system (same email) are skipped, so you can upload the same list again safely.";
  $("#i-head").innerHTML = "<tr><th>Result</th><th>Name</th><th>Email</th><th>Split</th><th>Paid by</th><th>Payable</th></tr>";
  const plan = planCust(), n = a => plan.filter(p => p.act === a).length;
  const fresh = plan.filter(p => p.act === "new");
  const noEmail = fresh.filter(p => !p.data.email).length, noPay = fresh.filter(p => !p.data.payMethod).length, owed = fresh.reduce((s, p) => s + (p.data.payable || 0), 0);
  $("#i-sum").innerHTML = `<span class="act-new">${n("new")} new consignor${n("new") === 1 ? "" : "s"}</span> · <span class="act-skip">${n("skip")} skipped</span>${noEmail ? ` · <span class="need">${noEmail} without an email</span>` : ""}${noPay ? ` · <span class="need">${noPay} without a payout method</span>` : ""}${owed ? ` · ${money(owed)} payable carried over` : ""}`;
  $("#i-prev").innerHTML = plan.slice(0, 10).map(p => {
    const d = p.data;
    const act = p.act === "new" ? `<span class="act-new">New · ${esc(d.code)}</span>` : `<span class="act-skip">Skip: ${esc(p.why)}</span>`;
    return `<tr><td>${act}</td><td class="title">${esc(p.label)}${d && d.phone ? `<div class="cert">${esc(d.phone)}</div>` : ""}</td><td style="overflow-wrap:anywhere">${esc(p.email || "")}${p.warn ? `<div class="cert" style="white-space:normal">${esc(p.warn)}</div>` : ""}</td><td class="num">${d ? d.rate + "%" : ""}</td><td style="max-width:220px;overflow-wrap:anywhere">${d ? esc(payLine(d)) : ""}</td><td class="num">${d && d.payable ? money(d.payable) : ""}</td></tr>`;
  }).join("") + (plan.length > 10 ? `<tr><td colspan="6" class="muted">…and ${plan.length - 10} more rows</td></tr>` : "");
  $("#i-go").disabled = !n("new");
  $("#i-go").textContent = n("new") ? `Add ${n("new")} consignor${n("new") === 1 ? "" : "s"}` : "Nothing to add";
}
function renderImport() {
  const box = $("#i-map");
  if (!imp) { box.hidden = true; return; }
  box.hidden = false; const type = itype();
  if (!$("#i-fields").contains(document.activeElement)) {
    $("#i-fields").innerHTML = fieldsFor(type).map(f => `<div class="f"><label for="map-${f.k}">${f.label}</label><select id="map-${f.k}" data-k="${f.k}"><option value="-1">Not in file</option>${imp.headers.map((h, i) => `<option value="${i}"${imp.map[f.k] === i ? " selected" : ""}>${esc(h)}</option>`).join("")}</select></div>`).join("");
  }
  if (document.activeElement !== $("#i-batch")) $("#i-batch").innerHTML = batchOptions($("#i-batch").value, '<option value="">No batch</option>');
  $("#i-optwrap").hidden = type !== "hist"; $("#i-limitwrap").hidden = type !== "hist"; $("#i-pcswrap").hidden = type !== "pcs";
  if (type === "hist") return renderHistImport();
  if (type === "cust") return renderCustImport();
  if (type === "pcs") return renderPcsImport();
  if (type === "fan") return renderFanImport();
  $("#i-batchwrap").hidden = false;
  $("#i-help").textContent = "These were matched from your file’s headers. Fix any that are wrong. Cards already in the system (same eBay item #) get their price and status updated instead of being added twice.";
  $("#i-head").innerHTML = "<tr><th>Result</th><th>Card</th><th>Grade</th><th>Price</th><th>Consignor</th></tr>";
  const plan = planImport(), n = a => plan.filter(p => p.act === a).length;
  const unassigned = plan.filter(p => p.act === "new" && !p.data.cust).length;
  $("#i-sum").innerHTML = `<span class="act-new">${n("new")} new</span> · <span class="act-upd">${n("update")} update cards already listed</span> · <span class="act-skip">${n("skip")} skipped</span>${unassigned ? ` · <span class="need">${unassigned} will need a consignor</span>` : ""}`;
  $("#i-prev").innerHTML = plan.slice(0, 8).map(p => {
    const d = p.data, c = d && custById(d.cust);
    const act = p.act === "new" ? `<span class="act-new">New · SKU ${d.sku}${p.auto ? "*" : ""}</span>` : p.act === "update" ? `<span class="act-upd">Updates SKU ${esc(p.target.sku)}</span>` : `<span class="act-skip">Skip: ${esc(p.why)}</span>`;
    const who = d ? (c ? esc(c.name) : '<span class="need">Needs consignor</span>') : "";
    return `<tr><td>${act}</td><td class="title">${esc(p.label)}</td><td>${d ? gradeHtml(d, true) : ""}</td><td class="num">${d ? money(d.price) : p.act === "update" ? money(p.price) : ""}</td><td>${who}${p.warn ? `<div class="cert">${esc(p.warn)}</div>` : ""}</td></tr>`;
  }).join("") + (plan.length > 8 ? `<tr><td colspan="5" class="muted">…and ${plan.length - 8} more rows</td></tr>` : "");
  const go = n("new") + n("update");
  $("#i-go").disabled = !go;
  $("#i-go").textContent = go ? `Import ${n("new")} new` + (n("update") ? ` and update ${n("update")}` : "") : "Nothing to import";
}
function closeImport() { imp = null; $("#i-file").value = ""; $("#drop-t").innerHTML = "<b>Choose a file</b> or drop it here"; renderImport(); }
$("#i-file").addEventListener("change", e => readFile(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", e => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });
document.querySelectorAll('input[name="itype"]').forEach(r => r.addEventListener("change", () => { if (imp) { imp.map = guessMap(imp.headers, itype()); if (itype() !== "cust") loadHistory().then(() => renderImport()); renderImport(); } }));
$("#i-fields").addEventListener("change", e => { const k = e.target.dataset.k; if (k) { imp.map[k] = parseInt(e.target.value, 10); e.target.blur(); renderImport(); } });
$("#i-batch").addEventListener("change", e => { e.target.blur(); renderImport(); });
$("#i-cancel").addEventListener("click", () => { closeImport(); $("#i-msg").textContent = ""; });
$("#i-unpaid").addEventListener("change", () => renderImport());
/* import history and undo */
const KIND = { full: "Wheelhouse sheet", pcs: "PC Sportscards export", fan: "Fanatics export", hist: "Consignment history" };
async function logImport(entry) {
  if (!entry.created.length && !entry.updated.length && !entry.poolAdded?.length) return;
  try { await setDoc(doc(db, "meta", "imp-" + Date.now()), { ...entry, at: now(), by: me, undone: false }); } catch (e) { console.error(e); }
}
let undoArm = "";
function renderImports() {
  const list = (S.imports || []).slice(0, 6);
  $("#imp-log").hidden = !list.length;
  $("#imp-rows").innerHTML = list.map(x => `<div class="staff-row"><span><b>${esc(KIND[x.kind] || "Import")}</b> · ${esc(x.file || "")} · ${new Date(x.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}<span class="muted"> · ${x.created.length + (x.poolAdded?.length || 0)} added${x.updated.length ? `, ${x.updated.length} updated` : ""}</span></span>${x.undone ? `<span class="muted" style="font-size:12px">Undone. Added cards are in the Removed tab.</span>` : `<button class="btn ghost sm" type="button" data-undo="${x.id}">${undoArm === x.id ? `Click again to undo` : "Undo"}</button>`}</div>`).join("");
}
$("#imp-rows").addEventListener("click", async e => {
  const id = e.target.dataset.undo; if (!id) return;
  if (undoArm !== id) { undoArm = id; renderImports(); return; }
  undoArm = "";
  const x = S.imports.find(i => i.id === id); if (!x) return;
  e.target.disabled = true; e.target.textContent = "Undoing…";
  const ok = await guarded($("#i-msg"), async () => {
    const ops = [
      ...x.created.map(c => upd(c.id, { status: "removed", prevStatus: c.status || "live", removedAt: now(), removedBy: me })),
      ...x.updated.map(u => upd(u.id, u.before)),
    ];
    for (let i = 0; i < ops.length; i += 400) await commit(ops.slice(i, i + 400));
    if (x.poolAdded?.length) { const drop = new Set(x.poolAdded); await savePool((S.pool || []).filter(r => !drop.has(r.pcsId))); }
    await updateDoc(doc(db, "meta", id), { undone: true, undoneAt: now(), undoneBy: me });
    return true;
  });
  if (ok) $("#i-msg").textContent = x.poolAdded?.length ? `Undid that import: ${x.poolAdded.length} cards taken off the sorting list${x.updated.length ? ` and ${x.updated.length} drop-offs put back` : ""}.` : `Undid that import: ${plural(x.created.length)} moved to the Removed tab${x.updated.length ? ` and ${x.updated.length} changes put back` : ""}. To reverse this, open the Removed tab and restore them.`;
  else renderImports();
});
$("#i-limit").addEventListener("change", e => { e.target.blur(); renderImport(); });
$("#i-recent").addEventListener("change", e => { e.target.blur(); renderImport(); });
$("#i-cutoff").addEventListener("change", () => renderImport());
$("#i-go").addEventListener("click", async () => {
  if (itype() === "hist") {
    await loadHistory();
    const { plan, stats } = planHistory(), fresh = plan.filter(p => p.act === "new"), ups = plan.filter(p => p.act === "update");
    $("#i-go").disabled = true; importing = true;
    const ok = await guarded($("#i-msg"), async () => {
      for (let i = 0; i < fresh.length; i += 400) {
        $("#i-msg").textContent = `Bringing in cards… ${Math.min(i + 400, fresh.length).toLocaleString()} of ${fresh.length.toLocaleString()}`;
        await commit(fresh.slice(i, i + 400).map(p => ["set", doc(db, "listings", "cc-" + p.sku), { ...p.data, addedBy: me, updatedAt: serverTimestamp() }]));
      }
      for (let i = 0; i < ups.length; i += 400) await commit(ups.slice(i, i + 400).map(p => upd(p.target.id, p.patch)));
      await logImport({ kind: "hist", file: imp.file, created: fresh.map(p => ({ id: "cc-" + p.sku, status: p.data.status })), updated: ups.map(p => ({ id: p.target.id, before: Object.fromEntries(Object.keys(p.patch).map(k => [k, p.target[k] ?? null])) })) });
      await bump("sku", Math.max(stats.maxSku, maxSku()));
      return true;
    });
    importing = false;
    if (!ok) { $("#i-go").disabled = false; return; }
    closeImport();
    const noCust = fresh.filter(p => !p.data.cust).length;
    $("#i-msg").textContent = `Brought in ${fresh.length.toLocaleString()} cards${ups.length ? ` and updated ${ups.length.toLocaleString()}` : ""}. New cards will be numbered from SKU ${pad6(Math.max(stats.maxSku, maxSku()) + 1)}.` + (noCust ? ` ${noCust} have no matching consignor. Add that consignor, then assign them from the card list (filter: Needs consignor).` : "");
    return;
  }
  if (itype() === "cust") {
    const fresh = planCust().filter(p => p.act === "new");
    $("#i-go").disabled = true; $("#i-msg").textContent = `Adding ${fresh.length} consignors…`;
    const done = await guarded($("#i-msg"), async () => {
      await commit(fresh.map(p => ["set", doc(col("customers")), { ...p.data, createdAt: serverTimestamp(), createdBy: me }]));
      return true;
    });
    if (!done) { $("#i-go").disabled = false; return; }
    closeImport();
    const noEmail = fresh.filter(p => !p.data.email).length;
    $("#i-msg").textContent = `Added ${fresh.length} consignor${fresh.length === 1 ? "" : "s"}. To see their cards, each one goes to wheelhousecards.github.io, chooses “Create account”, and uses the email you have on file for them.` + (noEmail ? ` ${noEmail} have no email yet. Add one with Edit in the Consignors list before they can sign in.` : "");
    return;
  }
  await loadHistory();
  const plan = itype() === "fan" ? planFan() : itype() === "pcs" ? planPcs() : planImport();
  const fresh = plan.filter(p => p.act === "new"), ups = plan.filter(p => p.act === "update");
  $("#i-go").disabled = true; $("#i-msg").textContent = "Importing…";
  if (itype() === "pcs") {
    const r = await guarded($("#i-msg"), runPcsImport);
    if (!r) { $("#i-go").disabled = false; return; }
    closeImport();
    $("#i-msg").textContent = `Added ${r.added} cards to the sorting list` + (r.items ? ` and updated ${r.items} cards in ${r.lots} drop-off SKU${r.lots === 1 ? "" : "s"}` : "") + ".";
    if (r.added) $("#pcsort").scrollIntoView({ block: "start" });
    return;
  }
  const res = await guarded($("#i-msg"), async () => {
    const autos = fresh.filter(p => p.auto), explicit = fresh.filter(p => !p.auto).map(p => parseInt(p.data.sku, 10));
    const floor = Math.max(maxSku(), ...explicit, 0);
    if (autos.length) {
      const taken = new Set([...S.all.map(l => l.sku), ...fresh.filter(p => !p.auto).map(p => p.data.sku)]);
      let n = await reserve("sku", autos.length, floor);
      autos.forEach(p => { while (taken.has(pad6(n))) n++; p.data.sku = pad6(n++); taken.add(p.data.sku); });
      await bump("sku", n - 1);
    } else if (explicit.length) await bump("sku", Math.max(...explicit));
    const ops = [];
    fresh.forEach(p => ops.push(["set", doc(col("listings")), { ...p.data, custEmail: emailOf(p.data.cust), added: now(), addedBy: me, updatedAt: serverTimestamp() }]));
    const before = [];
    const keep = (t, data) => before.push({ id: t.id, before: Object.fromEntries(Object.keys(data).map(k => [k, t[k] ?? null])) });
    ups.forEach(p => {
      if (p.patch) { keep(p.target, p.patch); ops.push(upd(p.target.id, p.patch)); return; }
      const t = p.target, data = {};
      if (p.price != null) data.price = p.price;
      if (p.ends) data.ends = p.ends;
      if (p.status) { data.status = p.status; if ((p.status === "sold" || p.status === "paid") && !t.soldDate) data.soldDate = now(); }
      if (p.cust) { data.cust = p.cust; data.custEmail = emailOf(p.cust); }
      if (p.batch) data.batch = p.batch;
      keep(t, data);
      ops.push(upd(t.id, data));
    });
    await commit(ops);
    await logImport({ kind: itype(), file: imp.file, created: fresh.map((p, i) => ({ id: ops[i][1].id, status: p.data.status })), updated: before });
    return { refs: ops.slice(0, fresh.length).map(o => o[1].id), unassigned: fresh.map((p, i) => !p.data.cust ? ops[i][1].id : null).filter(Boolean) };
  });
  if (!res) { $("#i-go").disabled = false; return; }
  closeImport();
  let msg = itype() === "fan"
    ? `Linked ${plural(ups.length)}` + (fresh.length ? ` and added ${fresh.length} that weren’t entered yet` : "") + ". Linked cards are now live on each customer’s page."
    : `Imported ${plural(fresh.length)}` + (ups.length ? ` and updated ${ups.length}` : "") + ".";
  if (res.unassigned.length) {
    ["#f-q", "#f-plat", "#f-st", "#f-batch"].forEach(s => { $(s).value = ""; }); $("#f-cust").value = "__none";
    ui.sel = new Set(res.unassigned);
    msg += ` ${plural(res.unassigned.length)} need a consignor. They’re selected in the list below: pick a consignor in the bar and click Assign, or use the dropdown on each row.`;
  }
  $("#i-msg").textContent = msg; renderLedger();
  if (res.unassigned.length) $("#ledger").scrollIntoView({ block: "start" });
});
