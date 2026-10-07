"use strict";

/**
 * Gallery content for generated sites — business-appropriate captioned tiles with CSS pattern
 * art + a small inline SVG motif. No external images (nothing to break), no fake "photos".
 * Self-contained: also copied verbatim into the desktop builder (app-forge lib/gallery.js).
 */

const ICONS = {
  cup: '<path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 9h2a2 2 0 0 1 0 4h-2"/><path d="M8 3v2M12 3v2"/>',
  fork: '<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 3c-2.2 2-2.2 6 0 8v10"/>',
  cake: '<path d="M4 21h16M5 21v-7h14v7"/><path d="M5 15.5c2.3 1.4 4.7 1.4 7 0s4.7-1.4 7 0"/><path d="M12 10.5V14"/><path d="M12 4.5c1 1.2 1 2.3 0 3.2c-1-.9-1-2 0-3.2z"/>',
  dumbbell: '<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>',
  leaf: '<path d="M5 19C5 10 11 5 20 4c-1 9-6 15-15 15z"/><path d="M5 19l8-8"/>',
  chart: '<path d="M3 20h18"/><path d="M6 20v-7M11 20V5M16 20v-10"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/>',
  spark: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
  house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/>',
  scales: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7l-2.5 5.5a2.5 2.5 0 0 0 5 0z"/><path d="M19 7l-2.5 5.5a2.5 2.5 0 0 0 5 0z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  paw: '<circle cx="6.5" cy="10" r="1.6"/><circle cx="10" cy="6" r="1.6"/><circle cx="14" cy="6" r="1.6"/><circle cx="17.5" cy="10" r="1.6"/><path d="M12 11.5c-2.8 0-5 3.4-5 5.4 0 1.8 1.6 2.6 3 2.2 1.3-.4 2.7-.4 4 0 1.4.4 3-.4 3-2.2 0-2-2.2-5.4-5-5.4z"/>',
  wrench: '<path d="M14.5 4.5a4 4 0 0 0-5 5L4 15l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
};

/* id, match (first hit wins — specific before broad), icon, tone, title, sub, tiles [kicker, title, line] */
const SETS = [
  ["coffee", /\b(coffee|cafe|café|espresso|roaster|roastery|tea house|tea shop)\b/, "cup", "#b45309", "Around the café", "A little of what makes a morning here worth it.", [
    ["Espresso bar", "Pulled to order", "Balanced, syrupy shots on our house blend."],
    ["Single origin", "This week's pour-over", "A rotating bean, brewed slowly by hand."],
    ["Bakery case", "Pastries from scratch", "Croissants and muffins out of the oven daily."],
    ["Cold bar", "Slow-steeped cold brew", "Eighteen hours for a smooth, low-acid cup."],
    ["The room", "A corner to stay a while", "Good light, fast Wi-Fi, plenty of outlets."],
    ["To go", "Order ahead, skip the line", "Your drink is ready when you walk in."]]],
  ["restaurant", /\b(restaurant|bistro|diner|pizzeria|pizza|taco|tacos|sushi|bbq|barbecue|grill|kitchen|eatery|food truck|catering)\b/, "fork", "#dc2626", "From our kitchen", "Seasonal plates, made from scratch every day.", [
    ["Starters", "Market small plates", "Built around whatever is best this week."],
    ["Mains", "House favorites", "The dishes our regulars order again and again."],
    ["From the grill", "Fire-kissed and simple", "Quality cuts and vegetables, cooked over flame."],
    ["Sweet finish", "Desserts made in-house", "Baked here, served warm when it counts."],
    ["The dining room", "Made for long dinners", "Warm lighting, good music, room for groups."],
    ["Events", "Private dining & catering", "Birthdays, team dinners, and celebrations."]]],
  ["bakery", /\b(bakery|bakes?|cakes?|cupcakes?|pastry|pastries|patisserie|donuts?|bread)\b/, "cake", "#f59e0b", "Fresh from the oven", "Small batches, real butter, baked before sunrise.", [
    ["Bread", "Morning sourdough", "Slow 48-hour ferment with a crackling crust."],
    ["Pastry", "Butter croissants", "Laminated by hand, flaky to the last layer."],
    ["Celebration", "Custom cakes", "Birthdays, weddings, and everything between."],
    ["Sweet treats", "Cupcakes & cookies", "Rotating flavors, baked fresh each morning."],
    ["Seasonal", "Fruit tarts & pies", "Built around what's ripe right now."],
    ["Gifting", "Boxes for sharing", "Assorted dozens for offices and parties."]]],
  ["fitness", /\b(gym|fitness|personal train(?:er|ing)|crossfit|workout|strength|bootcamp|boxing|martial arts|athletic)\b/, "dumbbell", "#ef4444", "Inside the gym", "Coached classes and open floor, for every level.", [
    ["Strength", "Barbell & lifting", "Coached technique, progressive programming."],
    ["Conditioning", "High-energy classes", "Short, sweaty sessions that build engine."],
    ["Coaching", "One-on-one training", "A plan built around your goals and schedule."],
    ["Recovery", "Mobility & stretch", "Move better and bounce back faster."],
    ["Community", "Train together", "Friendly faces who'll cheer you on."],
    ["Open gym", "Space to train your way", "Racks, rowers, and room to move."]]],
  ["yoga", /\b(yoga|pilates|meditation|wellness|mindfulness|breathwork)\b/, "leaf", "#10b981", "Inside the studio", "A calm space to move, breathe, and reset.", [
    ["Flow", "Vinyasa classes", "Breath-led movement to build heat and focus."],
    ["Foundations", "Beginner sessions", "Learn the basics at a gentle, steady pace."],
    ["Restore", "Yin & restorative", "Slow, supported poses to release tension."],
    ["Core", "Mat Pilates", "Strength and control from the center out."],
    ["Stillness", "Guided meditation", "Short sits to quiet a busy mind."],
    ["The space", "Light-filled studio", "Mats, props, and tea waiting for you."]]],
  ["saas", /\b(saas|software|platform|startup|api|developer tool|dev ?tool|productivity|crm|analytics|automation|b2b)\b/, "chart", "#6366f1", "A look inside", "The parts of the product teams use every day.", [
    ["Overview", "Dashboard at a glance", "Everything important on one clean screen."],
    ["Workflows", "Repeatable processes", "Set it up once, run it every week."],
    ["Insights", "Reports that make sense", "Clear charts you can share in one click."],
    ["Collaboration", "Built for teams", "Comments, mentions, and shared views."],
    ["Integrations", "Fits your stack", "Connect the tools you already use."],
    ["Security", "Secure by default", "Roles, audit logs, and encrypted data."]]],
  ["mobileapp", /\b(mobile app|ios app|android app|iphone app|habit tracker|budget app|app for)\b/, "phone", "#8b5cf6", "Inside the app", "Simple screens that fit into your day.", [
    ["Home", "Your day at a glance", "What matters now, front and center."],
    ["Progress", "See how far you've come", "Streaks, trends, and gentle nudges."],
    ["Reminders", "Right on time", "Smart notifications you control."],
    ["Insights", "Weekly recap", "A short summary of your week, every Sunday."],
    ["Sync", "Across your devices", "Pick up on any phone or tablet."],
    ["Privacy", "Your data stays yours", "No selling, no surprises."]]],
  ["agency", /\b(agency|studio|design studio|branding|marketing|seo|web design|creative|freelanc\w*|portfolio)\b/, "spark", "#ec4899", "Selected work", "A few kinds of projects we love taking on.", [
    ["Brand", "Identity systems", "Logos, type, and color that hold together."],
    ["Web", "Marketing websites", "Fast, clear sites built to convert."],
    ["Campaign", "Launch campaigns", "Concepts and assets for a big moment."],
    ["Product", "App & product design", "Interfaces people actually enjoy using."],
    ["Content", "Social & editorial", "A steady stream of on-brand content."],
    ["Strategy", "Positioning workshops", "Sharpen the story before you design it."]]],
  ["realestate", /\b(real estate|realtor|realty|homes? for sale|property|properties|broker|mortgage|rentals?)\b/, "house", "#0ea5e9", "Homes we help with", "From first apartments to forever homes.", [
    ["Buying", "First-time buyers", "A patient guide from search to keys."],
    ["Selling", "Listing & staging", "Pricing, photos, and a plan to sell well."],
    ["Family homes", "Room to grow", "Yards, good schools, quiet streets."],
    ["City living", "Condos & lofts", "Walkable neighborhoods close to it all."],
    ["Investing", "Rental properties", "Numbers-first advice for investors."],
    ["Relocating", "Moving to the area", "Local know-how before you arrive."]]],
  ["health", /\b(dental|dentist|clinic|doctor|medical|health ?care|therapy|therapist|chiropract\w*|physio\w*|orthodont\w*|counsel\w*)\b/, "heart", "#14b8a6", "Inside our practice", "Calm rooms, modern care, and time to listen.", [
    ["Check-ups", "Preventive care", "Routine visits that catch things early."],
    ["Treatment", "Personal care plans", "Clear options, explained without rush."],
    ["Families", "Care for all ages", "From little ones to grandparents."],
    ["Comfort", "A calm environment", "Quiet rooms and a team that puts you at ease."],
    ["Technology", "Modern equipment", "Accurate, gentle, and efficient visits."],
    ["Follow-up", "Support between visits", "Questions answered by our team."]]],
  ["trades", /\b(plumb\w*|electric\w*|hvac|roof\w*|landscap\w*|lawn|cleaning|cleaners?|maid|handyman|contractor|remodel\w*|painting|painters?|pest|moving|movers|pressure washing|garage door|locksmith|auto repair|mechanic)\b/, "wrench", "#f97316", "Recent work", "The kinds of jobs we handle every week.", [
    ["Repairs", "Fixed right the first time", "Diagnosed clearly, priced up front."],
    ["Installs", "New installations", "Clean, code-compliant, and tidy."],
    ["Upgrades", "Remodels & improvements", "Small projects to full makeovers."],
    ["Maintenance", "Seasonal tune-ups", "Prevent problems before they start."],
    ["Commercial", "Shops & offices", "Scheduled around your business hours."],
    ["Emergency", "Same-day help", "Priority slots when it can't wait."]]],
  ["beauty", /\b(salon|barber\w*|beauty|spa|nails?|lash\w*|brows?|hair|makeup|skincare|esthetic\w*|massage|tattoo)\b/, "spark", "#f472b6", "Looks we love", "A few favorites from the chair.", [
    ["Cut", "Precision cuts", "Shaped for your hair and your routine."],
    ["Color", "Color & balayage", "Soft, dimensional, low-maintenance color."],
    ["Style", "Blowouts & styling", "Event-ready hair in under an hour."],
    ["Treatment", "Hair & scalp care", "Repair, gloss, and shine treatments."],
    ["Bridal", "Wedding parties", "Trials, timelines, and on-the-day calm."],
    ["Self-care", "Brows, lashes & skin", "Finishing touches that make the look."]]],
  ["photo", /\b(photograph\w*|videograph\w*|photo studio|wedding photo\w*|headshots?)\b/, "camera", "#a78bfa", "Portfolio", "The kinds of sessions we shoot most.", [
    ["Weddings", "Wedding days", "Candid moments and timeless portraits."],
    ["Portraits", "Couples & families", "Relaxed sessions, natural light."],
    ["Business", "Headshots & teams", "Polished, approachable, on-brand."],
    ["Brand", "Product & brand", "Images that make people want to buy."],
    ["Events", "Parties & launches", "The energy of the night, captured."],
    ["Film", "Short films", "Highlight reels set to music."]]],
  ["store", /\b(e-?commerce|online store|shop|store|boutique|clothing|apparel|jewelry|candles?|handmade|merch|products?)\b/, "bag", "#f43f5e", "The collection", "A few favorites from the shop.", [
    ["New in", "Fresh arrivals", "The latest additions, in limited runs."],
    ["Best sellers", "Customer favorites", "The pieces people come back for."],
    ["Essentials", "Everyday staples", "Made to be used and loved daily."],
    ["Gifts", "Ready to give", "Wrapped and ready, with a handwritten note."],
    ["Limited", "Small-batch drops", "Once they're gone, they're gone."],
    ["Behind the scenes", "How it's made", "Materials and makers we trust."]]],
  ["education", /\b(course|courses|tutor\w*|school|academy|class(?:es)?|lessons?|teach\w*|learn\w*|coding school|music lessons?)\b/, "book", "#3b82f6", "What you'll learn", "Clear lessons, real practice, steady progress.", [
    ["Foundations", "Start with the basics", "Core ideas explained simply."],
    ["Practice", "Hands-on exercises", "Learn by doing, with feedback."],
    ["Projects", "Real-world work", "Build something you can show off."],
    ["Mentoring", "One-on-one help", "Get unstuck with a real instructor."],
    ["Community", "Learn together", "Study groups and friendly peers."],
    ["Milestones", "Track your progress", "Clear goals for every step."]]],
  ["nonprofit", /\b(non-?profit|charity|foundation|volunteer\w*|donat\w*|community group|church|ministry|cause)\b/, "heart", "#22c55e", "Our work in action", "Where your time and support go.", [
    ["Programs", "Programs that help", "Practical support for people who need it."],
    ["Volunteers", "Neighbors helping neighbors", "Hands-on ways to give your time."],
    ["Events", "Community gatherings", "Bringing people together all year."],
    ["Partners", "Working together", "Local groups that multiply the impact."],
    ["Impact", "Where donations go", "Transparent, measurable results."],
    ["Stories", "People we serve", "The reason we do this work."]]],
  ["legal", /\b(law firm|lawyer|attorney|legal|paralegal|notary)\b/, "scales", "#64748b", "How we help", "Practical legal guidance, explained plainly.", [
    ["Business", "Business law", "Formation, contracts, and compliance."],
    ["Family", "Family matters", "Handled with care and discretion."],
    ["Estate", "Wills & estates", "Plan ahead and protect what matters."],
    ["Property", "Real estate law", "Closings, leases, and disputes."],
    ["Disputes", "Resolution & litigation", "Strong representation when it counts."],
    ["Consults", "Straight answers", "A clear plan after the first meeting."]]],
  ["finance", /\b(accounting|accountant|bookkeep\w*|tax(?:es)?|cpa|financial|finance|wealth|insurance|payroll|invest\w*)\b/, "chart", "#0891b2", "Where we help", "Numbers handled, so you can focus on the rest.", [
    ["Tax", "Tax preparation", "Accurate, on time, and fully explained."],
    ["Books", "Monthly bookkeeping", "Clean books and reports you can read."],
    ["Payroll", "Payroll & filings", "Paid on time, filed correctly."],
    ["Planning", "Financial planning", "A clear path toward your goals."],
    ["Business", "Small-business advice", "Cash flow, pricing, and growth."],
    ["Peace of mind", "Year-round support", "Questions answered whenever they come up."]]],
  ["coaching", /\b(coach\w*|consult\w*|mentor\w*|advisor|life coach|business coach|speaker)\b/, "compass", "#eab308", "What we work on", "Focused sessions with clear next steps.", [
    ["Clarity", "Set the direction", "Get specific about what you want."],
    ["Strategy", "Make a plan", "Break big goals into weekly steps."],
    ["Accountability", "Stay on track", "Regular check-ins that keep momentum."],
    ["Leadership", "Lead with confidence", "Grow into the role you're in."],
    ["Workshops", "Team sessions", "Hands-on workshops for groups."],
    ["Results", "Measure progress", "See what's working and adjust."]]],
  ["pets", /\b(dog|dogs|cat|cats|pet|pets|grooming|groomer|vet|veterinar\w*|kennel|dog walk\w*|pet sitting|puppy|puppies)\b/, "paw", "#fb923c", "Happy tails", "Care that pets (and their people) love.", [
    ["Walks", "Daily dog walks", "Solo or small-group, with photo updates."],
    ["Sitting", "In-home pet sitting", "Your pets stay comfy in their own space."],
    ["Grooming", "Bath & tidy", "Gentle grooming for a fresh, happy pet."],
    ["Puppies", "Puppy visits", "Potty breaks, play, and early training."],
    ["Cats", "Cat care", "Feeding, litter, and lots of chin scratches."],
    ["Updates", "Peace of mind", "Notes and photos after every visit."]]],
  ["events", /\b(wedding|weddings|event|events|party|parties|venue|planner|dj|florist|flowers)\b/, "spark", "#d946ef", "Moments we've made", "Celebrations planned down to the last detail.", [
    ["Weddings", "Wedding days", "Calm, beautiful, and on schedule."],
    ["Parties", "Milestone birthdays", "Big or small, always memorable."],
    ["Corporate", "Company events", "Launches, retreats, and holiday parties."],
    ["Florals", "Flowers & styling", "Tablescapes and arrangements that wow."],
    ["Venues", "The perfect space", "Spaces matched to your guest list."],
    ["Planning", "Every detail handled", "Timelines, vendors, and day-of support."]]],
  ["media", /\b(blog|newsletter|podcast|magazine|journal|news|media|recipes?|writer|author|vlog|youtube channel|substack)\b/, "mic", "#6366f1", "Featured stories", "Some of the topics readers come back for.", [
    ["Essays", "Long reads", "Thoughtful pieces worth your coffee break."],
    ["Guides", "How-to guides", "Step-by-step and genuinely useful."],
    ["Interviews", "Conversations", "People with something worth saying."],
    ["Notes", "Quick takes", "Short, sharp thoughts on what's new."],
    ["Series", "Ongoing series", "Follow along, one episode at a time."],
    ["Archive", "Reader favorites", "The most-shared pieces of all time."]]],
  ["travel", /\b(travel|tours?|trips?|vacation\w*|hotel|hostel|bnb|airbnb|resort|adventure|cabin)\b/, "compass", "#06b6d4", "Where we go", "Trips planned with care, from start to finish.", [
    ["Coast", "Beach escapes", "Slow mornings and sunset dinners."],
    ["Mountains", "Mountain getaways", "Fresh air, trails, and cozy evenings."],
    ["City", "City breaks", "The best neighborhoods, food, and sights."],
    ["Adventure", "Guided adventures", "Small groups, local guides."],
    ["Stays", "Hand-picked stays", "Places with character and comfort."],
    ["Custom", "Trips built for you", "Your dates, your pace, your style."]]],
];

const DEFAULT_SET = ["default", null, "spark", "#818cf8", "A closer look", "A few highlights of what we do.", [
  ["Signature", "What we're known for", "The thing people recommend us for."],
  ["Craft", "Attention to detail", "Small touches that add up."],
  ["Process", "How we work", "Simple, transparent, and on time."],
  ["People", "The team behind it", "Friendly faces who care about the result."],
  ["Results", "Work we're proud of", "Outcomes our customers talk about."],
  ["Next", "What's coming", "New things we're excited to share."]]];

const ICON_FOR = { default: "spark" };

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function titleCase(s) {
  return String(s || "").replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
}

function findSet(pack, text) {
  if (pack) {
    const byId = SETS.find(function (s) { return s[0] === pack; });
    if (byId) return byId;
  }
  const t = String(text || "").toLowerCase();
  for (const s of SETS) if (s[1].test(t)) return s;
  return DEFAULT_SET;
}

/* Six pattern compositions — accent + a business tone, all pure CSS. */
function art(i, tone) {
  const A = "var(--accent,#5eead4)";
  const D = "#0b1220";
  const veil = "linear-gradient(to top,rgba(0,0,0,.42),rgba(0,0,0,0) 55%)";
  const mix = function (a, p, b) { return "color-mix(in srgb," + a + " " + p + "%," + b + ")"; };
  const layers = [
    veil + ",radial-gradient(120% 90% at 18% 12%," + mix(A, 70, "#fff") + " 0%,rgba(0,0,0,0) 55%),linear-gradient(140deg," + mix(A, 65, D) + "," + D + ")",
    veil + ",repeating-radial-gradient(circle at 85% 15%,rgba(255,255,255,.16) 0 1.5px,rgba(0,0,0,0) 1.5px 16px),linear-gradient(160deg," + tone + "," + mix(tone, 35, D) + ")",
    veil + ",radial-gradient(rgba(255,255,255,.24) 1.2px,rgba(0,0,0,0) 1.7px) 0 0/16px 16px,linear-gradient(200deg," + mix(A, 55, tone) + "," + mix(tone, 40, D) + ")",
    veil + ",repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 12px,rgba(0,0,0,0) 12px 26px),linear-gradient(120deg," + mix(A, 45, D) + "," + mix(A, 85, "#fff") + ")",
    veil + ",conic-gradient(from 200deg at 75% 115%," + A + "," + tone + "," + mix(A, 40, D) + "," + A + ")",
    veil + ",linear-gradient(rgba(255,255,255,.08) 1px,rgba(0,0,0,0) 1px) 0 0/22px 22px,linear-gradient(90deg,rgba(255,255,255,.08) 1px,rgba(0,0,0,0) 1px) 0 0/22px 22px,radial-gradient(80% 80% at 80% 90%," + mix(tone, 75, "transparent") + ",rgba(0,0,0,0) 70%),linear-gradient(135deg," + D + "," + mix(A, 55, D) + ")",
  ];
  return layers[i % layers.length];
}

function svg(name) {
  return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.spark) + "</svg>";
}

/**
 * Content for a gallery.
 * opts: { pack, text, items: [{name}] } — items (what the user typed) become the captions.
 * Returns { id, title, sub, icon, tone, tiles: [[kicker, title, line]] }.
 */
function galleryFor(opts) {
  opts = opts || {};
  const set = findSet(opts.pack, opts.text);
  let tiles = set[6];
  const items = (opts.items || []).filter(function (x) { return x && x.name; }).slice(0, 8);
  if (items.length >= 2) {
    tiles = items.map(function (it, i) {
      const base = set[6][i % set[6].length];
      return [base[0], titleCase(it.name), ""];
    });
  }
  return { id: set[0], title: set[4], sub: set[5], icon: set[2] || ICON_FOR.default, tone: set[3], tiles: tiles };
}

/** Grid of tiles (HTML string). `indent` is prepended to each line. */
function tilesHtml(g, indent) {
  const pad = indent || "";
  const n = g.tiles.length;
  const cols = n === 4 || n <= 2 ? 2 : n === 8 ? 4 : 3;
  const style =
    pad + "<style>" +
    '[data-forge="gallery"] .g-grid{display:grid;grid-template-columns:repeat(' + cols + ',minmax(0,1fr));gap:18px}' +
    '@media(max-width:860px){[data-forge="gallery"] .g-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    '@media(max-width:540px){[data-forge="gallery"] .g-grid{grid-template-columns:1fr}}' +
    '[data-forge="gallery"] .g-tile{transition:transform .2s ease,box-shadow .2s ease}' +
    '[data-forge="gallery"] .g-tile:hover{transform:translateY(-3px);box-shadow:0 18px 44px rgba(0,0,0,.22)}' +
    "</style>";
  const grid =
    pad + '<div class="g-grid" style="display:grid;gap:18px">\n' +
    g.tiles
      .map(function (t, i) {
        const label = esc(t[1]);
        return (
          pad + '  <figure class="g-tile" style="margin:0;border-radius:var(--radius,14px);overflow:hidden;border:1px solid var(--border,#1e2936);background:var(--panel,#121821);box-shadow:var(--shadow,none)">' +
          '<div role="img" aria-label="' + label + '" style="position:relative;aspect-ratio:4/3;background:' + art(i, g.tone) + '">' +
          '<span style="position:absolute;left:14px;top:14px;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.24);backdrop-filter:blur(6px)">' + svg(g.icon) + "</span>" +
          '<span style="position:absolute;left:16px;bottom:12px;color:rgba(255,255,255,.94);font-size:.72rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase">' + esc(t[0]) + "</span>" +
          '<span style="position:absolute;right:16px;bottom:12px;color:rgba(255,255,255,.62);font-size:.72rem;font-weight:600;letter-spacing:.06em">' + (i < 9 ? "0" : "") + (i + 1) + "</span>" +
          "</div>" +
          '<figcaption style="padding:14px 16px 16px"><strong style="display:block;font-size:1rem;letter-spacing:-.01em">' + label + "</strong>" +
          (t[2] ? '<span class="muted" style="display:block;margin-top:4px;font-size:.9rem;color:var(--muted,#93a4b8)">' + esc(t[2]) + "</span>" : "") +
          "</figcaption></figure>"
        );
      })
      .join("\n") +
    "\n" + pad + "</div>";
  return pad + "<!-- Gallery art is pure CSS (nothing external to break). To use your own photo, swap a tile's role=img div for an img tag with aspect-ratio:4/3 and object-fit:cover. -->\n" + style + "\n" + grid;
}

module.exports = { galleryFor, tilesHtml, findSet, SETS };
