// Customer portal: sign in by email link, then see only your own cards and batches.
import { db, logout } from "./firebase.js?v=20261030122919";
import { collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { $, esc, mountDashboard, createLightbox } from "./ui.js?v=20261030122919";
import { setupGate, gateMarkup } from "./gate.js?v=20261030122919";
import { contact } from "./firebase-config.js?v=20261030122919";

const views = ["gate", "loading", "none", "dash"];
const show = v => views.forEach(id => { $("#" + id).hidden = id !== v; });

$("#gate").innerHTML = gateMarkup("See your consigned cards",
  "Sign in with the email you gave Wheelhouse when you dropped off your cards. First time here? Choose “Create account” and use that same email.");

let unsubs = [], state = { customer: null, listings: [], batches: [] }, me = "";
const dash = mountDashboard($("#dash"));
createLightbox(
  id => state.batches.find(b => b.id === id),
  async b => {
    const snap = await getDocs(query(collection(db, "photos"), where("custEmail", "==", me), where("batch", "==", b.id)));
    const byId = new Map(snap.docs.map(d => [d.id, d.data().data]));
    return b.photos.map(p => byId.get(p.id) || p.thumb);
  }
);

function stop() { unsubs.forEach(u => u()); unsubs = []; }

async function start(user) {
  me = (user.email || "").toLowerCase();
  $("#acct").hidden = false; $("#acct-email").textContent = me;
  show("loading");
  try {
    const cs = await getDocs(query(collection(db, "customers"), where("email", "==", me)));
    if (cs.empty) {
      $("#none-msg").textContent = `We couldn’t find a consignment account for ${me}. If you’ve consigned cards with Wheelhouse, ask us to add this email to your account.`;
      $("#none-contact").innerHTML = contact.email
        ? `Email us at <a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a> with your name and the email you signed up with, and we’ll connect it to your cards.` + (contact.phone ? ` You can also call ${esc(contact.phone)}.` : "")
        : `Stop by any Wheelhouse location or reach us through <a href="${esc(contact.site)}" target="_blank" rel="noopener">wheelhousecards.com</a>.`;
      show("none"); return;
    }
    state.customer = { id: cs.docs[0].id, ...cs.docs[0].data() };
    const onErr = () => { $("#dash").innerHTML = '<div class="empty">Couldn’t load your cards. Refresh the page to try again.</div>'; };
    unsubs.push(onSnapshot(query(collection(db, "listings"), where("custEmail", "==", me)), s => {
      state.listings = s.docs.map(d => ({ id: d.id, ...d.data() })); dash.render(state);
    }, onErr));
    unsubs.push(onSnapshot(query(collection(db, "batches"), where("custEmail", "==", me)), s => {
      state.batches = s.docs.map(d => ({ id: d.id, ...d.data() })); dash.render(state);
    }, onErr));
    dash.render(state); show("dash");
  } catch (err) {
    console.error(err);
    $("#none-msg").textContent = "Couldn’t load your account. Refresh the page to try again.";
    $("#none-contact").textContent = ""; show("none");
  }
}

setupGate($("#gate"), user => {
  stop();
  if (user) start(user);
  else { $("#acct").hidden = true; state = { customer: null, listings: [], batches: [] }; show("gate"); }
});

$("#logout").addEventListener("click", () => logout());
$("#none-out").addEventListener("click", () => logout());
setInterval(() => { if (!$("#dash").hidden) dash.render(); }, 60000);
