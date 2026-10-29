// Customer portal: sign in by email link, then see only your own cards and batches.
import { db, logout } from "./firebase.js";
import { collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { $, esc, mountDashboard, createLightbox } from "./ui.js";
import { setupGate, gateMarkup } from "./gate.js";
import { contact } from "./firebase-config.js";

const views = ["gate", "loading", "none", "dash"];
const show = v => views.forEach(id => { $("#" + id).hidden = id !== v; });

$("#gate").innerHTML = gateMarkup("See your consigned cards",
  "Enter the email you gave Wheelhouse when you dropped off your cards. We’ll email you a link to sign in. No password needed.");

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
      const bits = [contact.email && `Email ${contact.email}`, contact.phone && `call ${contact.phone}`].filter(Boolean);
      $("#none-contact").innerHTML = bits.length ? esc(bits.join(" or ")) + "." : `Stop by any Wheelhouse location or reach us through <a href="${esc(contact.site)}" target="_blank" rel="noopener">wheelhousecards.com</a>.`;
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
