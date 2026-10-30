import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261030164740";

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

const back = () => ({ url: location.origin + location.pathname });

export const signIn = (email, pw) => signInWithEmailAndPassword(auth, email, pw);
export async function signUp(email, pw) {
  const cred = await createUserWithEmailAndPassword(auth, email, pw);
  await sendEmailVerification(cred.user, back());
  return cred;
}
export const resendVerification = () => auth.currentUser ? sendEmailVerification(auth.currentUser, back()) : Promise.resolve();
export const resetPassword = email => sendPasswordResetEmail(auth, email, back());
// After the customer clicks the verification link, refresh so the new "verified" status reaches the database rules.
export async function refreshUser() {
  const u = auth.currentUser; if (!u) return null;
  await u.reload();
  if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
export function logout() { return signOut(auth); }
