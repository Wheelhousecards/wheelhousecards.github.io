import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signOut,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const config = local && firebaseConfig.projectId.startsWith("PASTE")
  ? { apiKey: "demo-key", authDomain: "localhost", projectId: "demo-wheelhouse" }
  : firebaseConfig;

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Local testing: talk to the Firebase emulators instead of the live project.
if (local) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const EMAIL_KEY = "wh-signin-email";

export function sendLoginLink(email) {
  const url = location.origin + location.pathname;
  try { localStorage.setItem(EMAIL_KEY, email); } catch (e) {}
  return sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
}

export function hasLoginLink() {
  return isSignInWithEmailLink(auth, location.href);
}

export function savedLoginEmail() {
  try { return localStorage.getItem(EMAIL_KEY) || ""; } catch (e) { return ""; }
}

export async function finishLoginLink(email) {
  const cred = await signInWithEmailLink(auth, email, location.href);
  try { localStorage.removeItem(EMAIL_KEY); } catch (e) {}
  history.replaceState(null, "", location.pathname);
  return cred;
}

export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
export function logout() { return signOut(auth); }
