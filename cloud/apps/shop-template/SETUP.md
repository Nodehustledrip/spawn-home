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

With Stripe connected, the whole cart is paid in **one Stripe Checkout** (shipping included, US addresses collected), and the order is marked **Paid** with its line items as soon as Stripe confirms it. Refunds mark it **Refunded** or **Part refunded**. Without a connection the store falls back to Payment Links below, and with neither it's a safe demo.

### Recommended: connect Stripe (payments confirm themselves)

1. Publish the site, then open **spawnapp.org/cloud/payments** while signed in (from the desktop app: your app → Payments).
2. In Stripe, go to **Developers → API keys → Create restricted key**. Start in **Test mode**. Give it these permissions and leave the rest as None:
   - **Checkout Sessions: Write**
   - **Webhook Endpoints: Write**
   - **Products and Prices: Write** (prices are sent with each checkout)
   - Optional: **Read** on Events, Customers, Subscriptions and Charges
3. Paste the key (`rk_test_…`) next to this app and click **Connect Stripe**. Spawn checks the key and adds one webhook to your Stripe account. The key is stored encrypted and never shown again, only its last 4 characters.
4. Try it with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). When it works, connect a live key (`rk_live_…`) the same way.

Prices come from **`pricing.json`** (amounts in cents). The server only charges what's in that file, so nobody can change a price in their browser. When you change a price, change it in `pricing.json` too, or ask Build chat to do both.

Disconnect any time on the same page; that also removes the webhook from Stripe.

Shipping lives in `pricing.json` too: `"shipping": { "flat": 800, "freeOver": 7500, "countries": ["US"] }`.

### Or: Payment Links (no connection)

The store can also use **Stripe Payment Links**. Each one is a ready-made checkout page for a single product, hosted by Stripe. Card details never touch this site.

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
2. Open `https://YOUR-SITE/owner.html` and enter it. You'll see each order: reference, name, email, items, totals. With Stripe connected, the **Payments** tab shows which orders are paid, refunded or still waiting. Delete orders once they're handled.

## Good to know

- Stock levels, tax and shipping rates aren't calculated automatically. Set tax and shipping on each Payment Link in Stripe if you need them.
- Payment Links don't report back to this site; connect Stripe if you want orders marked paid automatically. Tax isn't calculated either way.
- If you outgrow this setup (hundreds of products, inventory, discount codes), a dedicated e-commerce platform is the better fit.
- The footer says the business is fictional. Remove that line when the store sells real products.
