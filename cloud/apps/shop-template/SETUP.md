# Fern & Fold store: setup guide

This guide is for the shop owner. You don't need to know how to code. For every step you can ask in Build chat, for example "replace the products with my candles".

## What's included

- **Catalog** with category filters (Tableware, Home, Textiles).
- **Product pages** (`product.html?p=<id>`) with photos, variants (glaze, size, scent and so on), a price per variant, and a quantity picker.
- **Cart drawer** that slides out. It is saved in the shopper's browser, so it's still there after they close the tab.
- **Checkout**: the shopper enters their name and email. The order is saved for you, and the shopper then pays on Stripe's own checkout page.
- **Owner view** (`/owner.html`), which lists every order request.

## 1. Add your products

The products are listed at the top of `shop.js`. Ask Build chat, for example: "Replace the products with: Beeswax candle $18, scents Honey and Pine. Tea towel $14, colours Blue and Sand." Add your own photos to `img/` (or ask Build chat to use them).

Shipping text and the free-shipping threshold are in `config.js`.

## 2. Connect payments (your Stripe account)

The store uses **Stripe Payment Links**. Each one is a ready-made checkout page for a single product, hosted by Stripe. Card details never touch this site.

1. In your Stripe dashboard, go to **Payment Links** and click **New**. Create one link per product, at the product's price.
   - Turn on "Let customers adjust quantity" so shoppers can pay for more than one.
   - Under **After payment**, redirect to `https://YOUR-SITE/?paid=1`. This shows a thank-you bar when the shopper comes back.
2. Paste each link into `config.js` under `payments`, using the product's id:
   ```js
   payments: { "mug": "https://buy.stripe.com/…", "bowl": "https://buy.stripe.com/…" }
   ```
   If a variant has a different price (for example the large bowl), add a link for that variant, like `"bowl:Large · 24 cm": "https://buy.stripe.com/…"`.
3. Publish again. The "Demo — payments not connected" bar disappears once any link is set.

**How checkout works with several items.** A Payment Link covers one product. When a cart has several products, the shopper sees one **Pay** button per item. Each payment carries the order reference (for example `FF-7KQ2MD`) as Stripe's `client_reference_id`, so you can match the payments in Stripe to the order request in your owner view.

Until you add links, the store is a safe demo: checkout saves the order request but never charges anyone.

## 3. See orders (owner view)

1. In Spawn, open your app, go to **Secrets**, and add `OWNER_KEY` with a long password of 12 characters or more.
2. Open `https://YOUR-SITE/owner.html` and enter it. You'll see each order: reference, name, email, items, totals. Delete orders once they're handled.

## Good to know

- Stock levels, tax and shipping rates aren't calculated automatically. Set tax and shipping on each Payment Link in Stripe if you need them.
- Payment Links don't report back to this site. Your Stripe dashboard is where you see what's been paid. Match it to the order reference.
- If you outgrow this setup (hundreds of products, inventory, discount codes), a dedicated e-commerce platform is the better fit.
- The footer says the business is fictional. Remove that line when the store sells real products.
