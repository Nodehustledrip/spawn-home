# The Crumb Club membership site: setup guide

This guide is for the club owner. You don't need to code. You can ask Build chat to make any change below.

## What's included

- **Landing page** with what's inside, membership tiers (monthly and yearly) and an FAQ.
- **Sign-up and sign-in** (`account.html`) using real accounts stored by Spawn. Passwords are hashed and are never stored in plain text.
- **Payment** through your own Stripe Payment Link for each tier.
- **Members area** (`members/`): a lesson library, a page for each lesson with progress ticks, and an account page that shows each member's status.
- **Owner view** (`owner.html`): see everyone who signed up and switch their access on or off.

## How the members-only gating works

Read this before you launch:

- **Gating happens on Spawn's servers.** Every file in the `members/` folder is sent only to a signed-in account that has members access. Everyone else is redirected to sign in, so they can't get the pages by guessing the link. That includes the lesson text in `members/lessons.js`.
- **An account gets members access in one of three ways:**
  1. It paid through Stripe Checkout (when Stripe is connected).
  2. You approve it in the owner view.
  3. Its email is listed in the `MEMBER_EMAILS` secret.
- **With Stripe connected, access follows payment.** A new account stays **Pending** until Stripe confirms the first payment, then becomes **Active** automatically. It turns off again if the subscription is cancelled, goes past due or unpaid, or the payment is refunded.
- **With Payment Links only** (no connection), Stripe doesn't notify the site. You approve each email yourself after the payment arrives.
- **The live demo has `MEMBER_EMAILS` set to `*`**, so every new account gets instant access for trying it out. **Remove that before you launch.**
- **In a Build preview, gating is simulated in your browser.** It is only for trying the flow. Real gating starts once you publish.
- **Not protected:** files outside `members/`, such as the landing page and the images in `img/`, are public. Put anything that's for members only inside `members/`.

## 1. Make it yours

Ask Build chat, for example:

- "Rename the club to Pottery Circle, and rewrite the lessons for beginners' hand-building."
- "Add a fifth lesson about glazing."

The lessons are in `members/lessons.js`. The tiers and prices are in `config.js`.

## 2. Take payments (your Stripe account)

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

Members always pay with the email of the account they're signed in with, so the payment matches the right account.

### Or: Payment Links (no connection)

1. In your Stripe dashboard, create a **Product** (for example "Crumb Club membership") with a **recurring price** for each tier, for example $9/month and $90/year.
2. Go to **Payment Links**, then **New**, and make one link per price. Under **After payment**, redirect to `https://YOUR-SITE/?paid=1`.
3. Paste each link into `config.js` in the matching tier's `link` field. Then publish again.

When a member is signed in and pending, the account page shows **Pay with Stripe** and prefills their email. To cancel or refund, use your Stripe dashboard. Then turn the member's access off in the owner view.

## 3. Approve members (owner view)

1. In Spawn, go to your app, then **Secrets**. Add the following:
   - `OWNER_KEY`: a long password, 12 characters or more.
   - `MEMBER_EMAILS` (optional): emails that always have access, separated by commas.
2. Delete `MEMBER_EMAILS="*"` if it's set.
3. Open `https://YOUR-SITE/owner.html` and enter the key.
4. On the **Members** tab, you'll see every account, marked Active or Pending. With Stripe connected, paid accounts turn Active by themselves and show their payment status. With Payment Links only, click **Approve** after the payment shows up in Stripe. Click **Remove access** if they cancel.

## Good to know

- Spawn doesn't send email for you. Let new members know they've been approved, or approve them within a day as the FAQ promises.
- The site doesn't handle password resets yet. If a member forgets their password, you can remove them in the owner view and they can sign up again.
- The footer says the business is fictional. Remove that line once the site describes your real club.
