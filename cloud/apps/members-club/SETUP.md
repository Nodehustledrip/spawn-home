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
- **An account gets members access in one of two ways:**
  1. You approve it in the owner view.
  2. Its email is listed in the `MEMBER_EMAILS` secret.
- **Payment doesn't switch access on automatically.** Stripe Payment Links don't notify the site when someone pays. After a payment arrives, you approve that email yourself. The payment email from Stripe shows the customer's email, and it's prefilled to match their account.
- **The live demo has `MEMBER_EMAILS` set to `*`**, so every new account gets instant access for trying it out. **Remove that before you launch.**
- **In a Build preview, gating is simulated in your browser.** It is only for trying the flow. Real gating starts once you publish.
- **Not protected:** files outside `members/`, such as the landing page and the images in `img/`, are public. Put anything that's for members only inside `members/`.

## 1. Make it yours

Ask Build chat, for example:

- "Rename the club to Pottery Circle, and rewrite the lessons for beginners' hand-building."
- "Add a fifth lesson about glazing."

The lessons are in `members/lessons.js`. The tiers and prices are in `config.js`.

## 2. Take payments (your Stripe account)

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
4. On the **Members** tab, you'll see every account, marked Active or Pending. Click **Approve** after the payment shows up in Stripe. Click **Remove access** if they cancel.

## Good to know

- Spawn doesn't send email for you. Let new members know they've been approved, or approve them within a day as the FAQ promises.
- The site doesn't handle password resets yet. If a member forgets their password, you can remove them in the owner view and they can sign up again.
- The footer says the business is fictional. Remove that line once the site describes your real club.
