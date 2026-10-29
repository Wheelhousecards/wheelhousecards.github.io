// Email-link sign-in screen shared by the customer portal and the staff app.
import { sendLoginLink, hasLoginLink, savedLoginEmail, finishLoginLink, watchAuth } from "./firebase.js";
import { $ } from "./ui.js";

const friendly = err => {
  const c = err?.code || "";
  if (c.includes("invalid-email")) return "That email address doesn’t look right. Check it and try again.";
  if (c.includes("invalid-action-code") || c.includes("expired")) return "That sign-in link has expired or was already used. Enter your email to get a new one.";
  if (c.includes("too-many-requests")) return "Too many tries in a row. Wait a few minutes and try again.";
  if (c.includes("network")) return "Couldn’t reach the server. Check your connection and try again.";
  return "Something went wrong signing in. Try again, and contact Wheelhouse if it keeps happening.";
};

// gateEl contains: form[data-g=form], input[data-g=email], button[data-g=btn], [data-g=msg], [data-g=title], [data-g=lead]
export function setupGate(gateEl, onAuth) {
  const form = $('[data-g="form"]', gateEl), input = $('[data-g="email"]', gateEl), btn = $('[data-g="btn"]', gateEl), msg = $('[data-g="msg"]', gateEl);
  let finishing = false;
  const say = (t, ok) => { msg.textContent = t; msg.className = ok ? "ok" : "err"; };

  async function finish(email) {
    finishing = true; btn.disabled = true; say("Signing you in…", true);
    try { await finishLoginLink(email); }
    catch (err) { finishing = false; btn.disabled = false; btn.textContent = "Email me a sign-in link"; say(friendly(err)); }
  }

  if (hasLoginLink()) {
    const saved = savedLoginEmail();
    if (saved) finish(saved);
    else {
      $('[data-g="title"]', gateEl).textContent = "Confirm your email";
      $('[data-g="lead"]', gateEl).textContent = "You opened the sign-in link on a different device or browser. Enter the email you used so we can finish signing you in.";
      btn.textContent = "Sign in";
      finishing = true;
    }
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const email = input.value.trim().toLowerCase();
    if (!email) return;
    if (finishing && hasLoginLink()) return finish(email);
    btn.disabled = true; say("Sending…", true);
    try {
      await sendLoginLink(email);
      say(`Check ${email} for a sign-in link. Open it on this device to finish signing in. It can take a minute, and may land in spam.`, true);
    } catch (err) { say(friendly(err)); }
    btn.disabled = false;
  });

  watchAuth(user => onAuth(user));
}

export const gateMarkup = (title, lead) => `
  <div class="box">
    <h1 data-g="title">${title}</h1>
    <p data-g="lead">${lead}</p>
    <form data-g="form" style="display:grid;gap:10px" novalidate>
      <div style="display:grid;gap:4px"><label for="g-email">Email</label><input id="g-email" data-g="email" type="email" autocomplete="email" inputmode="email" placeholder="you@email.com" required></div>
      <button class="btn" data-g="btn" type="submit">Email me a sign-in link</button>
      <div data-g="msg" role="status" aria-live="polite"></div>
    </form>
  </div>`;
