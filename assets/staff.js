// Staff app: consignors, listings, batches, imports and bulk edits, all synced live through Firestore.
import { db, logout } from "./firebase.js";
import {
  collection, doc, onSnapshot, getDoc, getDocs, query, where,
  writeBatch, runTransaction, setDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, esc, money, PLAT, STAT, pad6, plural, isSold, detect, normGrade, gradeHtml, timeLeft,
  fmtDay, today, thumbsHtml, shrink, createLightbox, mountDashboard
} from "./ui.js";
import { setupGate, gateMarkup } from "./gate.js";

/* ---------- state ---------- */
const S = { customers: [], listings: [], batches: [], staff: [], notes: {}, counters: {} };
const ui = { mode: "staff", cv: "", sel: new Set(), visible: [] };
let me = "", unsubs = [], ready = new Set();
const custById = id => S.customers.find(c => c.id === id);
const batchById = id => S.batches.find(b => b.id === id);
const emailOf = id => custById(id)?.email || "";
const maxSku = () => S.listings.reduce((m, l) => Math.max(m, parseInt(l.sku, 10) || 0), 0);
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
  unsubs.forEach(u => u()); unsubs = []; ready.clear();
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
  sub("listings", "listings", d => ({ id: d.id, ...d.data() }));
  sub("batches", "batches", d => ({ id: d.id, ...d.data() }));
  sub("staff", "staff", d => ({ id: d.id, ...d.data() }));
  unsubs.push(onSnapshot(col("batchNotes"), s => { S.notes = Object.fromEntries(s.docs.map(d => [d.id, d.data().notes || ""])); done("notes"); render(); }, fail));
  unsubs.push(onSnapshot(doc(db, "meta", "counters"), s => { S.counters = s.exists() ? s.data() : {}; render(); }, () => {}));
}

/* ---------- shell ---------- */
const dash = mountDashboard($("#cust"), `<div class="sel" style="display:grid;gap:4px;width:min(280px,100%)"><label for="cv-pick">Preview as consignor</label><select id="cv-pick"></select></div>`);
$("#cv-pick").addEventListener("change", e => { ui.cv = e.target.value; render(); });
function setMode(m) {
  ui.mode = m;
  $("#m-staff").setAttribute("aria-pressed", m === "staff"); $("#m-cust").setAttribute("aria-pressed", m === "cust");
  show(m); render();
}
$("#m-staff").addEventListener("click", () => setMode("staff"));
$("#m-cust").addEventListener("click", () => setMode("cust"));
function render() {
  if (!["customers", "listings", "batches"].every(k => ready.has(k))) return;
  if (ui.mode === "staff") renderStaff(); else renderCust();
}
function renderCust() {
  if (!custById(ui.cv)) ui.cv = [...S.customers].sort(byName)[0]?.id || "";
  $("#cv-pick").innerHTML = custOptions(ui.cv);
  const c = custById(ui.cv);
  dash.render({ customer: c, listings: S.listings.filter(l => l.cust === ui.cv), batches: S.batches.filter(b => b.cust === ui.cv) });
}
setInterval(() => { const a = document.activeElement; if (!a || !["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName)) render(); }, 60000);

createLightbox(batchById, async b => {
  const snap = await getDocs(query(col("photos"), where("batch", "==", b.id)));
  const byId = new Map(snap.docs.map(d => [d.id, d.data().data]));
  return b.photos.map(p => byId.get(p.id) || p.thumb);
});

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
  renderStaffList();
  renderBatches();
  renderLedger();
  if (imp) renderImport();
}

function renderCustList() {
  const q = $("#c-q").value.trim().toLowerCase();
  const list = [...S.customers].sort(byName).filter(c => !q || (c.name + " " + c.code + " " + c.email + " " + (c.phone || "")).toLowerCase().includes(q));
  $("#custList").innerHTML = list.length ? list.map(c => {
    const mine = S.listings.filter(l => l.cust === c.id), live = mine.filter(l => l.status === "live").length;
    return `<div class="cust"><span class="code">${esc(c.code)}</span><div style="min-width:0"><div style="font-weight:600">${esc(c.name)}</div><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(c.email || "No email")} · ${esc(c.phone || "No phone")}</div><div class="muted" style="font-size:12px">${c.rate ?? 85}% payout · ${live} live / ${mine.length} total</div></div><div class="row" style="gap:6px"><button class="btn ghost sm" type="button" data-edit="${c.id}">Edit</button><button class="btn ghost sm" type="button" data-view="${c.id}">View</button></div></div>`;
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
  const rows = S.listings.filter(l =>
    (!fc || (fc === "__none" ? !custById(l.cust) : l.cust === fc)) &&
    (!fp || l.plat === fp) && (!fs || l.status === fs) &&
    (!fb || (fb === "__nob" ? !batchById(l.batch) : l.batch === fb)) &&
    (!q || [l.sku, l.title, l.item, l.grade, l.cert].join(" ").toLowerCase().includes(q))
  ).sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1) || (b.sku || "").localeCompare(a.sku || ""));
  $("#count").textContent = `${rows.length} of ${S.listings.length} cards`;
  ui.visible = rows.map(l => l.id);
  const custSel = [...S.customers].sort(byName).map(x => `<option value="${x.id}">${esc(x.name)} · ${esc(x.code)}</option>`).join("");
  const shown = rows.slice(0, 500);
  tb.innerHTML = shown.length ? shown.map(l => {
    const c = custById(l.cust), on = ui.sel.has(l.id);
    return `<tr data-id="${l.id}"${on ? ' class="on"' : ""}>
      <td><input type="checkbox" class="sel" aria-label="Select SKU ${esc(l.sku)}"${on ? " checked" : ""}></td>
      <td class="code num">${esc(l.sku)}${l.batch && batchById(l.batch) ? `<div class="cert">${esc(l.batch)}</div>` : ""}</td>
      <td>${c ? `<span class="code">${esc(c.code)}</span> ${esc(c.name)}` : `<select data-f="cust" aria-label="Assign a consignor to SKU ${esc(l.sku)}" style="border-color:var(--paid)"><option value="">Needs consignor…</option>${custSel}</select>`}</td>
      <td><span class="chip ${l.plat}">${l.plat === "fan" ? "Fanatics" : "PCS / eBay"}</span></td>
      <td class="title">${esc(l.title)}${l.item ? `<div class="muted" style="font:12px var(--mono)">#${esc(l.item)}</div>` : ""}</td>
      <td>${gradeHtml(l, true)}</td>
      <td>${l.format === "bin" ? "Buy It Now" : "Auction"}</td>
      <td><input class="price num" type="number" step="0.01" min="0" value="${l.price ?? ""}" data-f="price" aria-label="Price for SKU ${esc(l.sku)}"></td>
      <td class="num">${l.format === "auction" && l.status === "live" ? esc(timeLeft(l.ends)) : ""}</td>
      <td><select data-f="status" aria-label="Status for SKU ${esc(l.sku)}">${Object.keys(STAT).map(k => `<option value="${k}"${k === l.status ? " selected" : ""}>${STAT[k]}</option>`).join("")}</select></td>
      <td><a href="${esc(l.url)}" target="_blank" rel="noopener">Open</a></td>
      <td><button class="x" type="button" data-del aria-label="Remove SKU ${esc(l.sku)}">${delOne === l.id ? "Sure?" : "×"}</button></td></tr>`;
  }).join("") + (rows.length > 500 ? `<tr><td colspan="12" class="muted">Showing the first 500 of ${rows.length}. Search or filter to narrow it down.</td></tr>` : "")
    : `<tr><td colspan="12"><div class="empty">${S.listings.length ? "No cards match these filters." : "No cards yet. Add a listing above or import a spreadsheet."}</div></td></tr>`;
  renderBulk();
}
$("#tbody").addEventListener("focusout", () => setTimeout(() => { if ($("#tbody").dataset.stale && !$("#tbody").contains(document.activeElement)) renderLedger(); }, 0));
["#f-q", "#f-cust", "#f-plat", "#f-st", "#f-batch"].forEach(s => $(s).addEventListener("input", renderLedger));
$("#c-q").addEventListener("input", renderCustList);

/* ---------- add a listing ---------- */
$("#a-url").addEventListener("input", e => {
  const d = detect(e.target.value);
  $("#detect").innerHTML = !e.target.value ? "Paste a link and the platform is detected automatically." : d ? `Detected <span class="chip ${d.plat}">${PLAT[d.plat]}</span>${d.item ? ` · item <span class="code">#${esc(d.item)}</span>` : ""}` : "Not a Fanatics Collect or eBay link.";
  if (d && d.plat === "pcs") $("#a-format").value = "auction";
});
$("#a-sku").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); if (e.target.value) e.target.dataset.manual = "1"; else delete e.target.dataset.manual; });
$("#a-sku").addEventListener("blur", e => { if (e.target.value) e.target.value = pad6(e.target.value); });
$("#a-grade").addEventListener("input", e => { const raw = normGrade(e.target.value) === "Ungraded"; $("#a-cert").disabled = raw; $("#a-cert").placeholder = raw ? "Ungraded" : "Cert number"; if (raw) $("#a-cert").value = ""; });
$("#a-batch").addEventListener("change", e => { const b = batchById(e.target.value); if (b && !$("#a-cust").value) $("#a-cust").value = b.cust; });
$("#addForm").addEventListener("submit", async e => {
  e.preventDefault();
  const say = t => { $("#detect").textContent = t; };
  const url = $("#a-url").value.trim(), d = detect(url);
  if (!d) return say("That link isn’t from Fanatics Collect or eBay. Check the link and try again.");
  const cust = $("#a-cust").value;
  if (!custById(cust)) return say("Choose the consignor this card belongs to.");
  const manual = !!$("#a-sku").dataset.manual, typed = $("#a-sku").value.trim();
  if (manual) {
    if (!/^\d{6}$/.test(typed)) return say("SKU must be six digits, like 000123.");
    const dup = S.listings.find(l => l.sku === typed);
    if (dup) return say(`SKU ${typed} is already used for ${dup.title}. Pick another SKU.`);
  }
  const grade = normGrade($("#a-grade").value), cert = grade === "Ungraded" ? "" : $("#a-cert").value.trim();
  if (grade !== "Ungraded" && !cert) return say(`Enter the cert number for this ${grade} card, or clear the grade if it’s ungraded.`);
  const cdup = cert && S.listings.find(l => l.cert === cert && l.status === "live");
  if (cdup) return say(`Cert ${cert} is already live as SKU ${cdup.sku} (${cdup.title}).`);
  const title = $("#a-title").value.trim();
  if (!title) return say("Enter the card name.");
  $("#a-save").disabled = true; say("Saving…");
  await guarded($("#detect"), async () => {
    const sku = manual ? typed : pad6(await reserve("sku", 1, maxSku()));
    if (manual) await bump("sku", parseInt(sku, 10));
    const ends = $("#a-ends").value, p = parseFloat($("#a-price").value);
    await setDoc(doc(col("listings")), {
      sku, cust, custEmail: emailOf(cust), batch: $("#a-batch").value || "", plat: d.plat, url, item: d.item, title, grade, cert,
      format: $("#a-format").value, price: isNaN(p) ? null : p, ends: ends ? new Date(ends).toISOString() : "",
      status: "live", soldDate: "", added: now(), addedBy: me, updatedAt: serverTimestamp()
    });
    ["#a-url", "#a-title", "#a-grade", "#a-cert", "#a-price", "#a-ends"].forEach(s => { $(s).value = ""; });
    $("#a-cert").disabled = true; delete $("#a-sku").dataset.manual;
    say(`Added as SKU ${sku}. It now shows on ${custById(cust).name}’s page.`);
  });
  $("#a-save").disabled = false;
});

/* ---------- consignors ---------- */
function fmtPhone(v) {
  const d = String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || "").trim();
}
let editingCust = "";
function resetCustForm() {
  editingCust = ""; ["#c-name", "#c-email", "#c-phone"].forEach(s => { $(s).value = ""; }); $("#c-rate").value = 85;
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
  $("#c-save").disabled = true;
  await guarded($("#c-msg"), async () => {
    if (editingCust) {
      const c = custById(editingCust), id = editingCust, ops = [["update", doc(db, "customers", id), { name, email, phone, rate: r, updatedAt: serverTimestamp() }]];
      if (c.email !== email) {
        S.listings.filter(l => l.cust === id).forEach(l => ops.push(upd(l.id, { custEmail: email })));
        S.batches.filter(b => b.cust === id).forEach(b => ops.push(["update", doc(db, "batches", b.id), { custEmail: email }]));
        const ph = await getDocs(query(col("photos"), where("cust", "==", id)));
        ph.docs.forEach(d => ops.push(["update", d.ref, { custEmail: email }]));
      }
      await commit(ops);
      say(`Saved ${name}.`);
    } else {
      const init = name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase().padEnd(2, "X");
      let n = S.customers.length + 1, code;
      do { code = init + String(n++).padStart(2, "0"); } while (S.customers.some(c => c.code === code));
      await setDoc(doc(col("customers")), { code, name, email, phone, rate: r, createdAt: serverTimestamp(), createdBy: me });
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
    $("#c-save").textContent = `Save ${c.code}`; $("#c-cancel").hidden = false; $("#c-msg").textContent = ""; $("#c-name").focus();
  }
});

/* ---------- ledger row edits ---------- */
let delOne = "";
const lmsg = t => { $("#ledger-msg").textContent = t; };
$("#tbody").addEventListener("change", async e => {
  const tr = e.target.closest("tr"), l = S.listings.find(x => x.id === tr?.dataset.id); if (!l) return;
  if (e.target.classList.contains("sel")) { e.target.checked ? ui.sel.add(l.id) : ui.sel.delete(l.id); tr.classList.toggle("on", e.target.checked); delArm = false; renderBulk(); return; }
  const f = e.target.dataset.f;
  await guarded($("#ledger-msg"), async () => {
    if (f === "cust" && e.target.value) { await updateDoc(listingRef(l.id), { cust: e.target.value, custEmail: emailOf(e.target.value), updatedAt: serverTimestamp() }); lmsg(`SKU ${l.sku} assigned to ${custById(e.target.value).name}.`); }
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
  await guarded($("#ledger-msg"), async () => { await deleteDoc(listingRef(id)); lmsg(`Removed SKU ${l.sku}.`); });
});

/* ---------- bulk edit ---------- */
let delArm = false;
function renderBulk() {
  for (const id of ui.sel) if (!S.listings.some(l => l.id === id)) ui.sel.delete(id);
  const n = ui.sel.size; $("#bulkbar").hidden = !n;
  if (n) {
    $("#bb-n").textContent = `${n} selected`;
    $("#bb-cust").innerHTML = S.customers.length ? custOptions($("#bb-cust").value) : '<option value="">Add a consignor first</option>';
    $("#bb-batch").innerHTML = S.batches.length ? batchOptions($("#bb-batch").value, "") + '<option value="__out">Take out of batch</option>' : '<option value="">No batches yet</option>';
    if (!delArm) $("#bb-del").textContent = "Remove";
  }
  const need = S.listings.filter(l => !custById(l.cust)).length;
  $("#needs").hidden = !need;
  $("#needs").innerHTML = need ? `<span><span class="need">${need} card${need === 1 ? " needs" : "s need"} a consignor</span> <span class="muted" style="font-size:12px">Customers can’t see these until they’re assigned.</span></span><button class="btn sm" type="button" id="needs-go">Show and select them</button>` : "";
  const vis = ui.visible, k = vis.filter(id => ui.sel.has(id)).length, all = $("#selAll");
  all.checked = vis.length > 0 && k === vis.length; all.indeterminate = k > 0 && k < vis.length;
}
const selected = () => S.listings.filter(l => ui.sel.has(l.id));
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
    await commit(ls.map(l => ["delete", listingRef(l.id)]));
    ui.sel.clear(); lmsg(`Removed ${plural(ls.length)}.`);
  });
});
$("#bb-clear").addEventListener("click", () => { ui.sel.clear(); delArm = false; renderLedger(); });

/* ---------- batches ---------- */
let editingBatch = "", pending = [], bDelArm = "";
function renderBatches() {
  const pc = $("#b-cust").value;
  $("#b-cust").innerHTML = S.customers.length ? '<option value="">Choose…</option>' + custOptions(pc) : '<option value="">Add a consignor first</option>';
  const bc = $("#bf-cust").value; $("#bf-cust").innerHTML = custOptions(bc, true);
  if (!$("#b-recv").value && !editingBatch) $("#b-recv").value = today();
  const sort = $("#bf-sort").value, nm = b => custById(b.cust)?.name || "~";
  const cardsIn = id => S.listings.filter(l => l.batch === id);
  const list = S.batches.filter(b => !bc || b.cust === bc).sort(
    sort === "cust" ? (a, b) => nm(a).localeCompare(nm(b)) || (b.recv || "").localeCompare(a.recv || "") :
    sort === "ship" ? (a, b) => (b.ship || "9999").localeCompare(a.ship || "9999") : (a, b) => (b.recv || "").localeCompare(a.recv || ""));
  $("#b-count").textContent = `${S.batches.length} batch${S.batches.length === 1 ? "" : "es"}`;
  let last = null, html = "";
  list.forEach(b => {
    const c = custById(b.cust), cards = cardsIn(b.id), sold = cards.filter(isSold).length, notes = S.notes[b.id];
    if (sort === "cust" && b.cust !== last) {
      last = b.cust; const mineB = list.filter(x => x.cust === b.cust);
      html += `<tr class="grp"><td colspan="8">${c ? `<span class="code">${esc(c.code)}</span> ${esc(c.name)}` : "No customer"} <span class="muted" style="font-weight:400">· ${mineB.length} batch${mineB.length === 1 ? "" : "es"} · ${mineB.reduce((s, x) => s + (x.cards || cardsIn(x.id).length), 0)} cards</span></td></tr>`;
    }
    html += `<tr data-b="${esc(b.id)}">
      <td><span class="code">${esc(b.id)}</span>${notes ? `<div class="cert" style="white-space:normal;max-width:180px">${esc(notes)}</div>` : ""}</td>
      <td>${c ? esc(c.name) : "—"}</td>
      <td><span class="chip ${b.plat}">${b.plat === "fan" ? "Fanatics" : "PC Sportscards"}</span></td>
      <td class="num">${fmtDay(b.recv)}</td>
      <td class="num">${b.ship ? fmtDay(b.ship) : '<span class="need">Not shipped</span>'}</td>
      <td class="num">${b.cards || cards.length} sent<div class="cert">${cards.length} listed · ${sold} sold</div></td>
      <td>${thumbsHtml(b, 3)}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn ghost sm" type="button" data-ba="cards">Show cards</button><button class="btn ghost sm" type="button" data-ba="edit">Edit</button><button class="btn ghost sm" type="button" data-ba="del">${bDelArm === b.id ? "Click again to remove" : "Remove"}</button></div></td>
    </tr>`;
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
  const cust = $("#b-cust").value; if (!custById(cust)) return say("Choose the customer this batch belongs to.");
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
    editingBatch = id; bDelArm = ""; $("#b-cust").value = b.cust; $("#b-plat").value = b.plat; $("#b-cards").value = b.cards || "";
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
      S.listings.filter(l => l.batch === id).forEach(l => ops.push(upd(l.id, { batch: "" })));
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
  { k: "plat", label: "Platform", re: /platform|site|market/i, only: "full" },
  { k: "batch", label: "Batch", re: /batch/i, only: "full" },
];
let imp = null;
const itype = () => document.querySelector('input[name="itype"]:checked').value;
function cellStr(v) {
  if (v instanceof Date) return isNaN(v) ? "" : v.toISOString();
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v ?? "").trim();
}
function guessMap(headers, type) {
  const map = {}, used = new Set();
  FIELDS.forEach(f => {
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
      $("#drop-t").innerHTML = `<b>${esc(file.name)}</b> · ${rows.length} rows · choose a different file`;
      $("#i-msg").textContent = "";
    } catch (err) { imp = null; $("#i-msg").textContent = `Couldn’t read ${file.name}. Save it as .csv or .xlsx and try again.`; }
    renderImport();
  };
  fr.readAsArrayBuffer(file);
}
function planImport() {
  const type = itype(), m = imp.map;
  const used = new Set(S.listings.map(l => l.sku));
  let next = Math.max(S.counters.sku || 0, maxSku()) + 1;
  const byItem = new Map(S.listings.filter(l => l.item).map(l => [l.item, l]));
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
    if (!plat) return { act: "skip", why: "No Fanatics or eBay link", label };
    if (!url) return { act: "skip", why: "No link or eBay item #", label };
    if (!title) return { act: "skip", why: "No card title", label };
    if (item) { if (seen.has(item)) return { act: "skip", why: "Same item # is in the file twice", label }; seen.add(item); }
    const grade = normGrade(g("grade")), cert = grade === "Ungraded" ? "" : g("cert");
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
    if (ex) return { act: "update", label: title, target: ex, price, ends, status, cust, batch: bt ? bt.id : "", warn: "" };
    let sku = g("sku").replace(/\D/g, ""), auto = false;
    sku = sku && sku.length <= 6 ? pad6(sku) : "";
    if (!sku || used.has(sku)) { while (used.has(pad6(next))) next++; sku = pad6(next++); auto = true; }
    used.add(sku);
    if (grade !== "Ungraded" && !cert) warn = warn || "Graded, but no cert #";
    return { act: "new", label: title, warn, auto, data: { sku, cust, batch: bt ? bt.id : "", plat, url, item, title, grade, cert, format, price, ends, status: status || "live", soldDate: (status === "sold" || status === "paid") ? now() : "" } };
  }).filter(Boolean);
}
function renderImport() {
  const box = $("#i-map");
  if (!imp) { box.hidden = true; return; }
  box.hidden = false; const type = itype();
  if (!$("#i-fields").contains(document.activeElement)) {
    $("#i-fields").innerHTML = FIELDS.filter(f => !f.only || f.only === type).map(f => `<div class="f"><label for="map-${f.k}">${f.label}</label><select id="map-${f.k}" data-k="${f.k}"><option value="-1">Not in file</option>${imp.headers.map((h, i) => `<option value="${i}"${imp.map[f.k] === i ? " selected" : ""}>${esc(h)}</option>`).join("")}</select></div>`).join("");
  }
  if (document.activeElement !== $("#i-batch")) $("#i-batch").innerHTML = batchOptions($("#i-batch").value, '<option value="">No batch</option>');
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
document.querySelectorAll('input[name="itype"]').forEach(r => r.addEventListener("change", () => { if (imp) { imp.map = guessMap(imp.headers, itype()); renderImport(); } }));
$("#i-fields").addEventListener("change", e => { const k = e.target.dataset.k; if (k) { imp.map[k] = parseInt(e.target.value, 10); e.target.blur(); renderImport(); } });
$("#i-batch").addEventListener("change", e => { e.target.blur(); renderImport(); });
$("#i-cancel").addEventListener("click", () => { closeImport(); $("#i-msg").textContent = ""; });
$("#i-go").addEventListener("click", async () => {
  const plan = planImport();
  const fresh = plan.filter(p => p.act === "new"), ups = plan.filter(p => p.act === "update");
  $("#i-go").disabled = true; $("#i-msg").textContent = "Importing…";
  const res = await guarded($("#i-msg"), async () => {
    const autos = fresh.filter(p => p.auto), explicit = fresh.filter(p => !p.auto).map(p => parseInt(p.data.sku, 10));
    const floor = Math.max(maxSku(), ...explicit, 0);
    if (autos.length) {
      const taken = new Set([...S.listings.map(l => l.sku), ...fresh.filter(p => !p.auto).map(p => p.data.sku)]);
      let n = await reserve("sku", autos.length, floor);
      autos.forEach(p => { while (taken.has(pad6(n))) n++; p.data.sku = pad6(n++); taken.add(p.data.sku); });
      await bump("sku", n - 1);
    } else if (explicit.length) await bump("sku", Math.max(...explicit));
    const ops = [];
    fresh.forEach(p => ops.push(["set", doc(col("listings")), { ...p.data, custEmail: emailOf(p.data.cust), added: now(), addedBy: me, updatedAt: serverTimestamp() }]));
    ups.forEach(p => {
      const t = p.target, data = {};
      if (p.price != null) data.price = p.price;
      if (p.ends) data.ends = p.ends;
      if (p.status) { data.status = p.status; if ((p.status === "sold" || p.status === "paid") && !t.soldDate) data.soldDate = now(); }
      if (p.cust) { data.cust = p.cust; data.custEmail = emailOf(p.cust); }
      if (p.batch) data.batch = p.batch;
      ops.push(upd(t.id, data));
    });
    await commit(ops);
    return { refs: ops.slice(0, fresh.length).map(o => o[1].id), unassigned: fresh.map((p, i) => !p.data.cust ? ops[i][1].id : null).filter(Boolean) };
  });
  if (!res) { $("#i-go").disabled = false; return; }
  closeImport();
  let msg = `Imported ${plural(fresh.length)}` + (ups.length ? ` and updated ${ups.length}` : "") + ".";
  if (res.unassigned.length) {
    ["#f-q", "#f-plat", "#f-st", "#f-batch"].forEach(s => { $(s).value = ""; }); $("#f-cust").value = "__none";
    ui.sel = new Set(res.unassigned);
    msg += ` ${plural(res.unassigned.length)} need a consignor. They’re selected in the list below: pick a consignor in the bar and click Assign, or use the dropdown on each row.`;
  }
  $("#i-msg").textContent = msg; renderLedger();
  if (res.unassigned.length) $("#ledger").scrollIntoView({ block: "start" });
});
