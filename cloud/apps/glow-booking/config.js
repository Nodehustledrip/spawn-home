/* Glow Studio — your settings. Edit this file (or ask Build chat to) — no code knowledge needed.
 * Payments: paste your own Stripe Payment Link URLs below (https://buy.stripe.com/...).
 * Leave a link empty ("") and that option runs in demo mode: the booking is saved, nothing is charged. */
window.SITE_CONFIG = {
  business: "Glow Studio",
  city: "Riverside",
  currency: "USD",
  depositAmount: 20,          // shown to clients when they choose "Pay deposit"
  payments: {
    deposit: "",              // one Payment Link for the deposit, e.g. "https://buy.stripe.com/abc123"
    full: {                   // optional: one Payment Link per service for paying in full
      cut: "", color: "", facial: "", gloss: "", brows: "", consult: ""
    }
  },
  allowPayLater: true         // let clients book now and pay at the studio
};
