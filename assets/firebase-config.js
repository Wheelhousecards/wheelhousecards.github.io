// Paste the config from Firebase console → Project settings → Your apps → Web app.
// These values are safe to publish: access is controlled by firestore.rules, not by hiding this file.
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// Shown to customers who sign in but don't have an account yet.
export const contact = {
  email: "",
  phone: "",
  site: "https://wheelhousecards.com"
};
