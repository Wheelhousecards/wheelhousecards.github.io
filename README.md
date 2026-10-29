# Wheelhouse Consignment

Customer portal and staff app for Wheelhouse consignments sold through Fanatics Collect and PC Sportscards.

- **wheelhouseconsignment.com** is the customer portal. Customers sign in with an emailed link and see only their own cards, batches and photos.
- **wheelhouseconsignment.com/staff.html** is the staff app. You add consignors, listings and batches, import spreadsheets, and bulk edit there.

The site is plain HTML and JavaScript hosted on GitHub Pages. Data lives in Firebase (Firestore). Sign-in uses Firebase email links, so there are no passwords.

## One-time setup

### 1. Firebase project
1. Go to console.firebase.google.com → **Add project** → name it `wheelhouse-consignment`. Analytics is optional.
2. **Upgrade to the Blaze (pay-as-you-go) plan** (bottom left, "Upgrade"). The free plan only sends 5 sign-in emails per day, which isn't enough for customers. At Wheelhouse's volume the bill should be at or near $0, but set a budget alert: Google Cloud console → Billing → Budgets & alerts → create a $5 budget.
3. **Build → Firestore Database → Create database.** Choose a US location (it can't be changed later) and start in **production mode**.
4. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.
5. **Build → Authentication → Get started → Sign-in method → Email/Password.** Turn on **Email link (passwordless sign-in)** and save.
6. **Authentication → Settings → Authorized domains → Add domain:** `wheelhouseconsignment.com`, `www.wheelhouseconsignment.com` and `wheelhousejt.github.io`.
7. **Project settings (gear) → General → Public-facing name:** `Wheelhouse Consignment`. This is the name customers see on sign-in emails.
8. **Project settings → Your apps → Web (</>)** → register an app called `consignment` (skip Firebase Hosting). Copy the `firebaseConfig` values into `assets/firebase-config.js`.
9. Also in `assets/firebase-config.js`, fill in `contact.email` and `contact.phone`. Customers who sign in without an account see these.

### 2. First staff account
The staff list starts empty, so add yourself by hand once:
**Firestore → Start collection** → Collection ID `staff` → Document ID = your email **in all lowercase** → add any field (for example `addedBy` = `setup`) → Save.
After that, add other employees from the **Staff access** panel at the bottom of the staff app.

### 3. GitHub Pages
1. Push this folder to the `wheelhouse-consignment` repo under the `WheelhouseJT` account.
2. Repo **Settings → Pages** → Source: **Deploy from a branch** → `main` / `(root)` → Save.
3. Under **Custom domain**, enter `wheelhouseconsignment.com` (the `CNAME` file in this repo already says this) and save. Once the check passes, tick **Enforce HTTPS**.

### 4. Domain DNS
At the registrar where you bought `wheelhouseconsignment.com`, add:

| Type  | Host | Value |
|-------|------|-------|
| A     | @    | 185.199.108.153 |
| A     | @    | 185.199.109.153 |
| A     | @    | 185.199.110.153 |
| A     | @    | 185.199.111.153 |
| CNAME | www  | wheelhousejt.github.io |

Delete any other A or CNAME records on `@` and `www` that the registrar added by default (parking pages). DNS can take up to a day to spread. HTTPS turns on after that.

## How data is organized (Firestore)

| Collection   | What's in it | Who can read it |
|--------------|--------------|-----------------|
| `customers`  | Consignor name, code, email (their login), phone, payout % | Staff; each customer reads their own |
| `listings`   | One card: SKU, consignor, link, grade, cert, price, status, batch | Staff; the customer whose email is on the card |
| `batches`    | Batch ID, customer, shipped-to platform, dates, card count, photo thumbnails | Staff; that customer |
| `photos`     | Full-size batch photos (one per document, under 1 MB each) | Staff; that customer |
| `batchNotes` | Staff notes for each batch (tracking numbers, etc.) | Staff only |
| `staff`      | Emails allowed into the staff app | Staff |
| `meta/counters` | Last SKU and batch number used, so two people never get the same one | Staff |

Each card, batch and photo carries a copy of the owner's email (`custEmail`). The security rules use it to decide what a customer can see. When you change a consignor's email in the staff app, every one of their cards, batches and photos is updated with it automatically.

## Everyday notes
- **SKUs** are six digits (000001, 000002, …) and come from a shared counter, so two staff members adding cards at the same time never collide.
- **PC Sportscards CSVs:** pick "PC Sportscards CSV", then choose the customer's batch under "Put these cards in a batch" if the whole file belongs to one person. Otherwise import, then assign from the selection bar. Re-uploading a newer CSV updates prices and statuses on cards already in the system (matched by eBay item number) instead of adding them twice.
- **Photos** are shrunk in the browser before upload. Each batch holds up to 40.
- **Customers stay signed in** on their device, so they only need a new email link when they sign out or switch devices.

## Testing locally
Open the site from `localhost` and it connects to the Firebase emulators (`firebase emulators:start --only auth,firestore`) instead of the live project.
