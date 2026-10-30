// Sign-in screen shared by the customer portal and the staff app: email + password,
// with a one-time email verification so nobody can claim someone else's email.
import { signIn, signUp, resendVerification, resetPassword, refreshUser, watchAuth, logout } from "./firebase.js?v=20261030165757";
import { $ } from "./ui.js?v=20261030165757";

const friendly = err => {
  const c = err?.code || "";
  if (c.includes("invalid-email")) return "That email address doesn’t look right. Check it and try again.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "That email and password don’t match. Try again, or use “Forgot password?” to reset it. First time here? Choose “Create account”.";
  if (c.includes("email-already-in-use")) return "There’s already an account for this email. Sign in instead, or use “Forgot password?”.";
  if (c.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (c.includes("too-many-requests")) return "Too many tries in a row. Wait a few minutes and try again.";
  if (c.includes("network")) return "Couldn’t reach the server. Check your connection and try again.";
  return "Something went wrong. Try again, and contact Wheelhouse if it keeps happening.";
};

export const gateMarkup = (title, lead) => `
  <div class="box" data-g="main">
    <h1 data-g="title">${title}</h1>
    <p data-g="lead">${lead}</p>
    <div class="tabs" role="group" aria-label="Sign in or create an account">
      <button type="button" data-mode="in" aria-pressed="true">Sign in</button>
      <button type="button" data-mode="up" aria-pressed="false">Create account</button>
    </div>
    <form data-g="form" style="display:grid;gap:10px" novalidate>
      <div style="display:grid;gap:4px"><label for="g-email">Email</label><input id="g-email" data-g="email" type="email" autocomplete="email" inputmode="email" placeholder="you@email.com" required></div>
      <div style="display:grid;gap:4px"><label for="g-pw">Password</label><input id="g-pw" data-g="pw" type="password" autocomplete="current-password" required></div>
      <div style="display:grid;gap:4px" data-g="pw2wrap" hidden><label for="g-pw2">Confirm password</label><input id="g-pw2" data-g="pw2" type="password" autocomplete="new-password"></div>
      <button class="btn" data-g="btn" type="submit">Sign in</button>
      <button class="btn ghost sm" data-g="forgot" type="button" style="justify-self:start">Forgot password?</button>
      <div data-g="msg" role="status" aria-live="polite"></div>
    </form>
  </div>
  <div class="box" data-g="verify" hidden>
    <h1>Check your email</h1>
    <p>We sent a verification link to <b data-g="vemail"></b>. Open it, then come back here and click the button below. You only have to do this once. It may land in spam.</p>
    <button class="btn" type="button" data-g="vdone">I’ve verified my email</button>
    <div class="row"><button class="btn ghost sm" type="button" data-g="vresend">Send the link again</button><button class="btn ghost sm" type="button" data-g="vout">Use a different email</button></div>
    <div data-g="vmsg" role="status" aria-live="polite"></div>
  </div>`;

export function setupGate(gateEl, onAuth, { allowSignup = true } = {}) {
  const g = k => $(`[data-g="${k}"]`, gateEl);
  let mode = "in";
  const say = (t, ok) => { g("msg").textContent = t; g("msg").className = ok ? "ok" : "err"; };
  const vsay = (t, ok) => { g("vmsg").textContent = t; g("vmsg").className = ok ? "ok" : "err"; };
  if (!allowSignup) gateEl.querySelector(".tabs").hidden = true;

  function setMode(m) {
    mode = m;
    gateEl.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m));
    g("pw2wrap").hidden = m !== "up";
    g("pw").autocomplete = m === "up" ? "new-password" : "current-password";
    g("btn").textContent = m === "up" ? "Create account" : "Sign in";
    g("forgot").hidden = m === "up";
    say("");
  }
  gateEl.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));

  g("form").addEventListener("submit", async e => {
    e.preventDefault();
    const email = g("email").value.trim().toLowerCase(), pw = g("pw").value;
    if (!email) return say("Enter your email.");
    if (!pw) return say("Enter your password.");
    if (mode === "up") {
      if (pw.length < 6) return say("Use a password with at least 6 characters.");
      if (pw !== g("pw2").value) return say("The two passwords don’t match.");
    }
    g("btn").disabled = true; say(mode === "up" ? "Creating your account…" : "Signing in…", true);
    try { mode === "up" ? await signUp(email, pw) : await signIn(email, pw); g("pw").value = ""; g("pw2").value = ""; say(""); }
    catch (err) { say(friendly(err)); }
    g("btn").disabled = false;
  });

  g("forgot").addEventListener("click", async () => {
    const email = g("email").value.trim().toLowerCase();
    if (!email) return say("Enter your email above, then click “Forgot password?” again.");
    try { await resetPassword(email); say(`If there’s an account for ${email}, we just emailed a link to reset the password.`, true); }
    catch (err) { say(friendly(err)); }
  });

  g("vdone").addEventListener("click", async () => {
    g("vdone").disabled = true; vsay("Checking…", true);
    try {
      const u = await refreshUser();
      if (u && u.emailVerified) { vsay(""); show(u); }
      else vsay("We don’t see the verification yet. Open the link in the email first, then try again.");
    } catch (err) { vsay(friendly(err)); }
    g("vdone").disabled = false;
  });
  g("vresend").addEventListener("click", async () => {
    try { await resendVerification(); vsay("Sent. Check your inbox and spam folder.", true); }
    catch (err) { vsay(friendly(err)); }
  });
  g("vout").addEventListener("click", () => logout());

  function show(user) {
    const pending = !!(user && !user.emailVerified);
    g("main").hidden = pending; g("verify").hidden = !pending;
    if (pending) { g("vemail").textContent = user.email; onAuth(null); }
    else onAuth(user);
  }
  watchAuth(show);
  // If they verify in another tab, pick it up when they come back.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && !g("verify").hidden) {
      try { const u = await refreshUser(); if (u && u.emailVerified) show(u); } catch (e) {}
    }
  });
}
