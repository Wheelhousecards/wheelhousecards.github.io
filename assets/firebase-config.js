// Paste the config from Firebase console → Project settings → Your apps → Web app.
// These values are safe to publish: access is controlled by firestore.rules, not by hiding this file.
export const firebaseConfig = {
  apiKey: "AIzaSyBTG0RGGEjFtUx8OdDyv2DN4Aasm-Rc-v0",
  authDomain: "wheelhouse-consignment.firebaseapp.com",
  projectId: "wheelhouse-consignment",
  storageBucket: "wheelhouse-consignment.firebasestorage.app",
  messagingSenderId: "796989146402",
  appId: "1:796989146402:web:3c2283bb3041a7a8d6d17b"
};

// Shown to customers who sign in but don't have an account yet.
export const contact = {
  email: "consignment@wheelhousecards.com",
  phone: "",
  site: "https://wheelhousecards.com"
};

// Sending payout emails straight from the staff app (EmailJS, free up to 200 emails a month).
// Leave these blank and the app falls back to opening your email app.
// Connected to consignment@wheelhousecards.com (Gmail) on Nov 12, 2026.
export const emailSend = {
  serviceId: "service_9bpg5b6",
  templateId: "template_xtk5795",
  publicKey: "9KPUOZJi6N-vQ5Nk0",
  attachments: false // photo attachments need a paid EmailJS plan; set true after upgrading and adding a "photo" variable attachment to the template
};
