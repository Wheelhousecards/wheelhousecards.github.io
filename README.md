# Wheelhouse Consignment

Customer portal and staff app for Wheelhouse consignments sold through Fanatics Collect and PC Sportscards.

- **wheelhousecards.github.io** is the customer portal. Customers sign in with email and password and see only their own cards, batches and photos.
- **wheelhousecards.github.io/staff.html** is the staff app. You add consignors, listings and batches, import spreadsheets, and bulk edit there.

The site is plain HTML and JavaScript hosted on GitHub Pages. Data lives in Firebase (Firestore). Sign-in is email and password. Each account verifies its email once, so nobody can create an account with someone else’s email and see their cards. Everything runs on Firebase’s free (Spark) plan.

## One-time setup

### 1. Firebase project
1. Go to console.firebase.google.com → **Add project** → name it `wheelhouse-consignment`. Analytics is optional.
2. Stay on the free **Spark** plan. No card is needed.
3. **Build → Firestore Database → Create database.** Choose a US location (it can't be changed later) and start in **production mode**.
4. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.
5. **Build → Authentication → Get started → Sign-in method → Email/Password.** Turn on **Email/Password**, leave **Email link** off, and save.
6. **Authentication → Settings → Authorized domains → Add domain:** `wheelhousecards.github.io`.
7. **Project settings (gear) → General → Public-facing name:** `Wheelhouse Consignment`. This is the name customers see on sign-in emails.
8. **Project settings → Your apps → Web (</>)** → register an app called `consignment` (skip Firebase Hosting). Copy the `firebaseConfig` values into `assets/firebase-config.js`.
9. Also in `assets/firebase-config.js`, fill in `contact.email` and `contact.phone`. Customers who sign in without an account see these.

### 2. First staff account
The staff list starts empty, so add yourself by hand once:
**Firestore → Start collection** → Collection ID `staff` → Document ID = your email **in all lowercase** → add any field (for example `addedBy` = `setup`) → Save. Then go to the staff page, choose **Create account** with that email, and verify it.
After that, add other employees from the **Staff access** panel at the bottom of the staff app.

### 3. GitHub Pages
1. Create a free GitHub organization named `wheelhousecards` (github.com/organizations/plan → Free).
2. In that organization, create a public repo named exactly `wheelhousecards.github.io` and push this folder to it.
3. Repo **Settings → Pages** → Source: **Deploy from a branch** → `main` / `(root)` → Save.
4. The site goes live at https://wheelhousecards.github.io within a few minutes. HTTPS is on automatically.

To move to a custom domain later (for example consign.wheelhousecards.com), add it under Settings → Pages → Custom domain, point a CNAME record at `wheelhousecards.github.io`, and add the domain to Firebase's authorized domains.

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
- **Fanatics curation:** enter each card when it comes in (consignor, auction house, grade, cert) and leave the link blank. Customers see it as "Being curated." When Fanatics sends their collection export, add a column named **Link** with each card's listing URL, then import it as "Fanatics export + links." Rows are matched to your cards by cert number, then by exact title, and the matched cards go live. Only Link, CertNumber, Title and Grade are read. "CGC 0" means ungraded. You can also paste a single link into the card list.
- **Card details:** click any SKU (staff card list, or a customer's own page) to see everything about that card. Staff can edit the title, grade, cert, payout month, prices and link there. PC Sportscards monthly payouts are one SKU per consignor per month. Open that SKU and upload PC Sportscards' statement to list the individual cards in it, and the customer sees the same breakdown.
- **Consignment history import:** choose "Consignment history" and drop in the old system's item export. Retail (Wheelhouse-owned) rows are skipped. Each card keeps its original SKU, sale price and the exact amount the consignor received, and new cards continue numbering after the highest old SKU. Past sales come in as Paid out unless you tick "Count sales marked Paid = No as still owed". Returned cards show as "Returned to you", and cards still out at Fanatics come in as Being curated so you can link them from the Fanatics export. Import consignors first so every card finds its owner.
- **Paid-out and returned cards** load only when you ask (the "Show paid-out and returned cards too" button, a Paid out or Returned filter, or a search that finds nothing in play). That keeps the staff app inside Firebase's free daily limit. Customers always see their full history.
- **Consignor list import:** choose "Consignor list" and drop in the export from the old consignment system. Number becomes the consignor code, Default Split becomes their payout %, Payable carries over what they're owed, and payout info is read from Address Line 1 and Payment Method together (Venmo, PayPal, check with mailing address).
- **Payouts:** the Payouts panel lists everyone owed money (sold cards at their split, plus anything carried over). "Email" opens a filled-in message in your email app, "Copy message" is the fallback, and "Mark paid" moves their sold cards to Paid out and logs the payout on their page. Consignors with Notifications turned off don't get an Email button.
- **Photos** are shrunk in the browser before upload. Each batch holds up to 40.
- **Customers create their own login.** Tell them to go to the site, choose “Create account”, and use the email you have on file for them. They verify it once by email. They stay signed in on that device, and “Forgot password?” emails them a reset link.
- **Free-plan email limits:** 1,000 verification emails and 150 password-reset emails a day.

## Publishing changes
Run `./stamp.sh` before each push. It tags every script and stylesheet with a new version so browsers load the update right away instead of an old saved copy.

## Testing locally
Open the site from `localhost` and it connects to the Firebase emulators (`firebase emulators:start --only auth,firestore`) instead of the live project.
