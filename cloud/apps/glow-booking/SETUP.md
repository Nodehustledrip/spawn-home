# Glow Studio booking site: setup guide

This guide is for the site owner. You don't need to know how to code. You can do every step here by asking in Build chat, for example "change the services to …".

## What's included

- **Treatments**: a menu with photos, durations and prices.
- **Staff picker**: clients can choose a person or "First available". Each person only offers the treatments they actually do.
- **Calendar with time slots**: covers the next 4 weeks and follows your opening hours.
- **Booking summary**: shows what the client picked and what's due today.
- **Payment choice**: a deposit, payment in full, or pay at the studio.
- **Confirmation screen**: shows a booking reference and an "Add to calendar" file.
- **Owner view** (`/owner.html`): your private list of booking requests.

## 1. Make it yours

Open Build chat and ask for the changes. Examples:

- "Rename the business to Bloom Salon and set the city to Austin."
- "Replace the services with: Haircut 45 min $50, Colour 2h $150."
- "Change the team to Ana (cuts) and Lee (colour). Ana works Tue to Fri."
- "Opening hours: Tue to Fri 9 to 6, Sat 9 to 2."

The services, team and opening hours are at the top of `app.js`. The business name and payment settings are in `config.js`.

The photos and the people in this template are illustrative. Replace them with your own before you take real bookings.

## 2. Take payments (optional)

Payments go straight to **your own Stripe account**. The site never sees card details. There are three modes:

- **Stripe connected** (recommended): the deposit or full payment runs through Stripe Checkout, and the booking is marked **Deposit paid** or **Paid**, with the amount, as soon as Stripe confirms it.
- **Payment Links**: if you paste links in `config.js` but don't connect Stripe, clients pay on the link and you match payments yourself.
- **Neither**: demo mode. Booking works, the pages show "Demo — payments not connected", and nothing is ever charged.

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

What happens on each Stripe event: a paid checkout marks the booking paid (deposit or full). A bank payment that clears later marks it paid when it clears, or **Failed** if it doesn't. A refund marks it **Refunded** (or **Part refunded**). The **Payments** tab in the owner view shows all of this.

### Or: Payment Links (no connection)

1. Sign in to your Stripe dashboard. Go to **Payment Links**, then **New**.
2. Create a link for the deposit, for example a product called "Booking deposit" for $20.
3. Under **After payment**, choose "Don't show confirmation page, redirect customers to your website". Enter `https://YOUR-SITE/?paid=1`. When Stripe sends clients back, they see the confirmation screen.
4. Copy the link. It starts with `https://buy.stripe.com/`.
5. Open `config.js`, or ask Build chat: "Set the deposit payment link to https://buy.stripe.com/…".
6. If you want to offer payment in full, make one link per service and paste each one under `full:`.
7. Publish again.

Each payment carries the booking reference (for example `GS-7KQ2MD`) as Stripe's `client_reference_id`. That lets you match payments to bookings in Stripe.

Payment Links don't tell this site that a payment succeeded. Check your Stripe dashboard (or Stripe's payment emails) to see who paid, and match by reference. Connecting Stripe (above) removes this step.

## 3. See your bookings (owner view)

Every booking request is saved privately on Spawn. Visitors can't read them.

1. In Spawn, open your app and go to **Secrets**. Add a secret named `OWNER_KEY` with a long password of 12 characters or more that only you know.
2. Visit `https://YOUR-SITE/owner.html` and enter that password.
3. You'll see each request with the client's name, email, phone, treatment, person, date, time and payment choice. You can delete requests you've handled.

The owner view only works on the published site. In a Build preview, bookings stay in your browser.

## 4. Confirming with clients

The site doesn't send emails by itself. Reply to each request from your own email, or call the client, to confirm the time.

## Good to know

- Time slots are worked out in the visitor's browser from your opening hours. Some slots are shown as taken, so the calendar looks realistic.
- The site doesn't check your real diary. Two clients can request the same time, so you confirm each booking yourself.
- If you need live availability synced to your calendar, a dedicated booking tool is the better fit.
- The footer says the business is fictional. Remove that line once the site describes your real business.
