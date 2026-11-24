// Branded HTML emails (the Wheelhouse layout: logo, dashed rules, big centered greeting, "Please note" payout terms).
// Every email also keeps a plain-text version: it's what "Open in email app" uses, and what EmailJS sends
// until the template body is switched to {{{html}}}.
import { esc, money, splitOf, PLAT } from "./ui.js?v=20261124122525";

export const SITE = "https://wheelhousecards.github.io/consignment";
export const STAFF_SITE = "https://wheelhousecards.github.io/consignment/staff";
const LOGO = "https://wheelhousecards.github.io/assets/wheelhouse-logo.png";
const CONTACT = "consignment@wheelhousecards.com";

const pctSet = v => v != null && v !== "" && !isNaN(+v);
const pct = n => `${+(+n).toFixed(2)}%`;

// Payout terms in the customer's own rates. plats: which platforms to cover. calc: payout statement wording (no timing line).
export function rateNotes(c, plats, { calc = false, basis = null, only = null } = {}) {
  const out = [];
  if (plats.includes("fan")) {
    if (pctSet(c?.fanPct)) out.push(`Cards sold on Fanatics Collect are paid out to owner at ${pct(c.fanPct)} of the final sale price.`);
    else {
      if (only !== "bin") out.push(calc ? "Fanatics Collect auctions: 100% of the hammer price over $200; 10% consignment fee at $200 or below."
        : "Cards sold at auction with a final bid/hammer price over $200 will be paid out to owner at 100% of that hammer price. Cards with a bid/auction hammer price of $200 or below will be subject to a 10% consignment fee paid to Wheelhouse.");
      out.push(calc ? "Fanatics Collect Buy It Now: 10% consignment fee." : "Cards sold as “Buy It Now” will be subject to a 10% consignment fee paid to the resale platform/Wheelhouse.");
    }
    out.push(calc ? "Ungraded cards: $5.00 authentication fee." : "Ungraded cards will be subject to a $5.00 fee for authentication services passed on by the auctioneer/platform.");
  }
  if (plats.includes("pcs")) {
    const b = basis || c?.pcsBasis || "net";
    out.push(`${calc ? "PC Sportscards: " : "Cards sold through PC Sportscards are paid out to owner at "}${pct(splitOf(c, "pcsRate"))} of ${b === "net" ? "the amount PC Sportscards pays Wheelhouse after their selling fees" : "the final sale price"}.`);
    if (!calc) out.push("Cards that don’t sell are not charged anything.");
  }
  if (plats.includes("store")) out.push(`${calc ? "In-store sales: " : "Cards sold in a Wheelhouse store are paid out to owner at "}${pct(splitOf(c, "rate"))} of the sale price.`);
  if (!calc) out.push("Proceeds are paid out once a month, around the 5th, for every card that sold the month before, subject to bidder payment.");
  return out;
}

const F = "font-family:Arial,Helvetica,sans-serif;";
const rule = `<tr><td style="padding:0 18px"><div style="border-top:1px dashed #c9ced4;height:0;line-height:0;font-size:0">&nbsp;</div></td></tr>`;
const P = (h, extra = "") => `<p style="margin:0 0 12px;${extra}">${h}</p>`;
export const btn = (label, url) => `<p style="margin:6px 0 12px"><a href="${esc(url)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 26px;border-radius:6px;${F}font-size:15px">${esc(label)}</a></p>`;
export const small = h => P(h, "font-size:13px;color:#5b616b");
export const box = (title, text) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr><td style="background:#f4f5f7;border-radius:8px;padding:14px 18px;text-align:center;${F}font-size:15px;color:#2b2f36"><b>${title}</b><br>${text}</td></tr></table>`;

// Table of sold cards for a payout statement. rows: { group } or { title, sku, sold, sale, amt } or { title, amt } (adjustments).
export function stmtTable(rows, total) {
  const td = (h, r = false, x = "") => `<td style="border-bottom:1px solid #eceef0;padding:7px 4px;vertical-align:top;${r ? "text-align:right;white-space:nowrap;" : ""}${x}">${h}</td>`;
  const th = (h, r) => `<th style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#5b616b;border-bottom:1px solid #d9dde1;padding:6px 4px;${r ? "text-align:right" : "text-align:left"}">${h}</th>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto 14px;border-collapse:collapse;${F}font-size:13.5px;color:#2b2f36;text-align:left">
<tr>${th("Card")}${th("Sold", 1)}${th("Sale", 1)}${th("You get", 1)}</tr>
${rows.map(r => r.group ? `<tr><td colspan="4" style="font-weight:bold;background:#f4f5f7;padding:7px 4px;border-bottom:1px solid #eceef0">${esc(r.group)}</td></tr>`
    : r.sku ? `<tr>${td(`${esc(r.title)}<br><span style="font-size:12px;color:#5b616b">SKU ${esc(r.sku)}</span>`)}${td(esc(r.sold || ""), 1)}${td(r.sale, 1)}${td(r.amt, 1)}</tr>`
    : `<tr>${td(esc(r.title), 0, "font-style:italic")}${td("", 1)}${td("", 1)}${td(r.amt, 1)}</tr>`).join("")}
<tr><td colspan="3" style="font-weight:bold;border-top:2px solid #111111;padding:8px 4px;font-size:15px">Total</td><td style="font-weight:bold;border-top:2px solid #111111;padding:8px 4px;font-size:15px;text-align:right;white-space:nowrap">${total}</td></tr></table>`;
}
export const cardList = items => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:470px;margin:0 auto 14px;text-align:left;${F}font-size:14px;color:#2b2f36">${items.map(x => `<tr><td style="border-bottom:1px solid #eceef0;padding:6px 0">${esc(x.title)}<br><span style="font-family:Menlo,Consolas,monospace;font-size:12px;color:#5b616b">SKU ${esc(x.sku)}</span></td></tr>`).join("")}</table>`;

// The whole email. greet/head are plain text; body is HTML built with the helpers above.
export function layout({ greet = "", head = "", big = "", sub = "", note = "", body = "", notesTitle = "Please note:", notes = [], foot = [] }) {
  const noteHtml = note.trim() ? P(esc(note.trim()).replace(/\n/g, "<br>"), "text-align:left;background:#fffbea;border-left:3px solid #111111;padding:10px 14px") : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#e9ebee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9ebee"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;${F}font-size:15px;line-height:1.55;color:#2b2f36;text-align:center">
<tr><td align="center" style="padding:26px 20px 22px"><img src="${LOGO}" width="250" alt="WHEELHOUSE" style="display:block;width:250px;max-width:80%;height:auto;border:0"></td></tr>
${rule}
<tr><td style="padding:26px 30px 22px">${greet ? `<p style="margin:0 0 8px;font-size:28px;line-height:1.25">${esc(greet)}</p>` : ""}${head ? `<p style="margin:0;font-size:24px;line-height:1.3">${esc(head)}</p>` : ""}${big ? `<p style="margin:10px 0 0;font-size:40px;font-weight:bold;color:#111111">${esc(big)}</p>` : ""}${sub ? `<p style="margin:6px 0 0;font-size:13px;color:#5b616b">${esc(sub)}</p>` : ""}</td></tr>
${rule}
<tr><td style="padding:22px 34px 4px">${noteHtml}${body}</td></tr>
${notes.length ? `<tr><td style="padding:4px 34px 18px">${P(esc(notesTitle))}${notes.map(n => P("• " + esc(n))).join("")}</td></tr>` : ""}
${rule}
<tr><td style="padding:16px 30px 26px;font-size:12.5px;color:#6b717b">${foot.map(f => `<div>${f}</div>`).join("")}</td></tr>
</table></td></tr></table></body></html>`;
}
export const questions = (what = "Questions?") => `${what} Reply to this email or write to <a href="mailto:${CONTACT}" style="color:#111111">${CONTACT}</a>`;
// Plain-text notes block for the text version.
export const textNotes = (title, notes) => notes.length ? ["", title, ...notes.map(n => `• ${n}`)] : [];
export { money, PLAT };
