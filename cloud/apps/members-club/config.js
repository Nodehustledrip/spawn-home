// The Crumb Club: membership settings. You can edit this file yourself, or ask in Build chat.
// Paste your own Stripe Payment Links (https://buy.stripe.com/...). For a monthly or yearly
// membership, create the link from a recurring price in Stripe.
// While the links are empty, the site stays in demo mode and nothing is charged.
window.SITE_CONFIG = {
  business: "The Crumb Club",
  tiers: [
    { id: "monthly", name: "Monthly", price: "$9", per: "/ month", note: "Cancel any time", link: "" },
    { id: "yearly", name: "Yearly", price: "$90", per: "/ year", note: "Two months free", link: "", featured: true }
  ]
};
