// Best option: connect your Stripe account at spawnapp.org/cloud/payments. Checkout then runs on the server,
// prices come from pricing.json, and payments confirm themselves. The links below are only the fallback.
// Fern & Fold: store settings. You can edit this file yourself, or ask in Build chat.
// Payments: paste one Stripe Payment Link per product (https://buy.stripe.com/...).
// Leave a link empty and the store stays in demo mode for that product, so nothing is charged.
// For a different link per variant, use "product-id:Variant", for example "mug:Moss".
window.SITE_CONFIG = {
  business: "Fern & Fold",
  currency: "USD",
  freeShippingOver: 75,
  shippingNote: "Flat $8 shipping in the US, free over $75. Ships in 3–5 working days.",
  payments: {
    "mug": "",
    "bowl": "",
    "plates": "",
    "vase": "",
    "candle": "",
    "linen": ""
  }
};
