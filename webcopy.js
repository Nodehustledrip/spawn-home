"use strict";

/**
 * Offline copy packs for free /build edits — no model, no API credits.
 * Industry packs + generic topic copy + tone variants.
 */

const PACKS = [
  {
    id: "coffee",
    match: /\b(coffee|cafe|café|espresso|roaster|roastery|tea house|tea shop)\b/,
    badge: "Freshly roasted",
    headlines: ["Coffee worth slowing down for.", "Small-batch coffee, poured with care.", "Your new favorite neighborhood café."],
    sub: "Single-origin beans, house-made pastries, and a corner table waiting for you. Order ahead or stay a while.",
    cta: "Order ahead",
    sectionTitle: "Why regulars keep coming back",
    sectionSub: "Simple things, done properly every single morning.",
    features: [
      ["Roasted weekly", "Small batches so every cup tastes the way it should."],
      ["Baked in-house", "Croissants, muffins, and cookies out of the oven daily."],
      ["Order ahead", "Skip the line — your drink is ready when you walk in."],
      ["Cozy space", "Fast Wi-Fi, plenty of outlets, and good music."],
    ],
  },
  {
    id: "restaurant",
    match: /\b(restaurant|bistro|diner|pizzeria|pizza|taco|tacos|sushi|bbq|barbecue|grill|kitchen|eatery|food truck|catering)\b/,
    badge: "Now taking reservations",
    headlines: ["Food that brings people back.", "Seasonal plates, made from scratch.", "Your table is ready."],
    sub: "Fresh ingredients, a menu that changes with the seasons, and a room that feels like home. Book a table or order for pickup.",
    cta: "Reserve a table",
    sectionTitle: "What makes us different",
    sectionSub: "Real cooking, generous portions, and service you'll remember.",
    features: [
      ["Made from scratch", "Sauces, breads, and desserts prepared in our kitchen daily."],
      ["Local ingredients", "We partner with nearby farms for peak-season flavor."],
      ["Pickup & delivery", "Order online and enjoy it at home in minutes."],
      ["Private events", "Host birthdays, team dinners, and celebrations with us."],
    ],
  },
  {
    id: "bakery",
    match: /\b(bakery|bakes?|cakes?|cupcakes?|pastry|pastries|patisserie|donuts?|bread)\b/,
    badge: "Baked fresh daily",
    headlines: ["Baked fresh every morning.", "Treats made by hand, with real butter.", "Celebrate with something sweet."],
    sub: "Breads, pastries, and custom cakes made from scratch with simple ingredients. Order online for pickup or delivery.",
    cta: "Order a cake",
    sectionTitle: "From our ovens",
    sectionSub: "Everything is made in small batches, the old-fashioned way.",
    features: [
      ["Custom cakes", "Birthdays, weddings, and everything in between."],
      ["Daily bread", "Sourdough and loaves baked before sunrise."],
      ["Real ingredients", "Butter, flour, sugar — nothing artificial."],
      ["Easy pickup", "Order ahead and grab it on your way."],
    ],
  },
  {
    id: "fitness",
    match: /\b(gym|fitness|personal train(?:er|ing)|crossfit|workout|strength|bootcamp|boxing|martial arts|athletic)\b/,
    badge: "First class free",
    headlines: ["Get stronger. Feel unstoppable.", "Training that actually fits your life.", "Your strongest year starts here."],
    sub: "Coached classes, personal training, and a community that keeps you showing up. Every fitness level welcome.",
    cta: "Claim your free class",
    sectionTitle: "Built around your goals",
    sectionSub: "Expert coaching, real progress, zero intimidation.",
    features: [
      ["Expert coaches", "Certified trainers who program around your goals."],
      ["Small classes", "Personal attention in every session."],
      ["Track progress", "See your gains with regular check-ins."],
      ["Flexible schedule", "Early, lunch, and evening sessions all week."],
    ],
  },
  {
    id: "yoga",
    match: /\b(yoga|pilates|meditation|wellness|mindfulness|breathwork)\b/,
    badge: "New student special",
    headlines: ["Breathe. Move. Feel better.", "A calmer you starts on the mat.", "Find your balance."],
    sub: "Welcoming classes for every body and every level, led by experienced teachers in a calm, beautiful space.",
    cta: "Book your first class",
    sectionTitle: "Practice your way",
    sectionSub: "Classes designed to meet you where you are.",
    features: [
      ["All levels", "Beginner-friendly flows to advanced practice."],
      ["Small groups", "Personal guidance and adjustments."],
      ["Online & in-studio", "Join live or stream on demand."],
      ["Calm space", "A quiet studio designed for focus."],
    ],
  },
  {
    id: "saas",
    match: /\b(saas|software|platform|startup|api|developer tool|dev ?tool|ai tool|productivity|crm|analytics|automation|b2b)\b/,
    badge: "Now in public beta",
    headlines: ["Ship faster with less busywork.", "The simplest way to run your workflow.", "Do more with the tools you already have."],
    sub: "Automate the repetitive parts, keep your team in sync, and see what's working at a glance. Set up in minutes — no credit card needed.",
    cta: "Start free",
    sectionTitle: "Everything your team needs",
    sectionSub: "Powerful where it matters, simple everywhere else.",
    features: [
      ["Set up in minutes", "Connect your tools and import data in a few clicks."],
      ["Automations", "Let routine work run itself in the background."],
      ["Real-time insights", "Dashboards that update as your team works."],
      ["Secure by default", "Encryption, roles, and audit logs built in."],
    ],
  },
  {
    id: "mobileapp",
    match: /\b(mobile app|ios app|android app|iphone app|habit tracker|budget app|app for)\b/,
    badge: "Available on iOS & Android",
    headlines: ["The app that keeps you on track.", "Your day, beautifully organized.", "Small habits. Big results."],
    sub: "A fast, delightful app that helps you stay consistent — with reminders, streaks, and insights that actually motivate.",
    cta: "Download the app",
    sectionTitle: "Designed for everyday use",
    sectionSub: "Simple enough to open daily, powerful enough to stick with.",
    features: [
      ["Smart reminders", "Nudges at the right moment, never spammy."],
      ["Streaks & insights", "See progress and keep momentum."],
      ["Works offline", "Your data is always available."],
      ["Private by design", "Your information stays yours."],
    ],
  },
  {
    id: "agency",
    match: /\b(agency|studio|design studio|branding|marketing|seo|web design|creative|freelanc\w*|portfolio)\b/,
    badge: "Booking new projects",
    headlines: ["Brands people remember.", "Design and growth for ambitious teams.", "We build work that performs."],
    sub: "Strategy, design, and development under one roof. We help growing companies look sharp and convert better.",
    cta: "Start a project",
    sectionTitle: "What we do",
    sectionSub: "A small senior team with a big portfolio.",
    features: [
      ["Brand identity", "Logos, systems, and guidelines that scale."],
      ["Websites", "Fast, beautiful sites built to convert."],
      ["Growth marketing", "SEO, ads, and content that bring in leads."],
      ["Ongoing support", "A partner you can call when it matters."],
    ],
  },
  {
    id: "realestate",
    match: /\b(real estate|realtor|realty|homes? for sale|property|properties|broker|mortgage|rentals?)\b/,
    badge: "Local market experts",
    headlines: ["Find the home that fits your life.", "Buy and sell with confidence.", "Your next move, made easy."],
    sub: "Local expertise, honest advice, and a team that negotiates hard for you — from first showing to closing day.",
    cta: "Book a consultation",
    sectionTitle: "Why work with us",
    sectionSub: "Results-driven service with a personal touch.",
    features: [
      ["Local knowledge", "Neighborhood insight you won't find online."],
      ["Strong negotiation", "We fight for the best price and terms."],
      ["Full support", "Inspections, paperwork, and closing handled."],
      ["Market reports", "Know exactly what your home is worth."],
    ],
  },
  {
    id: "health",
    match: /\b(dental|dentist|clinic|doctor|medical|health ?care|therapy|therapist|chiropract\w*|physio\w*|orthodont\w*|counsel\w*)\b/,
    badge: "Accepting new patients",
    headlines: ["Care that puts you first.", "Modern care, close to home.", "Feel better, sooner."],
    sub: "Experienced professionals, same-week appointments, and a calm, welcoming office. Most insurance accepted.",
    cta: "Book an appointment",
    sectionTitle: "Our services",
    sectionSub: "Comprehensive care for you and your family.",
    features: [
      ["Same-week visits", "Get seen quickly when you need it."],
      ["Experienced team", "Licensed professionals who listen."],
      ["Insurance friendly", "We work with most major plans."],
      ["Modern equipment", "Comfortable, up-to-date treatment."],
    ],
  },
  {
    id: "trades",
    match: /\b(plumb\w*|electric\w*|hvac|roof\w*|landscap\w*|lawn|cleaning|cleaners?|maid|handyman|contractor|remodel\w*|painting|painters?|pest|moving|movers|pressure washing|garage door|locksmith|auto repair|mechanic)\b/,
    badge: "Licensed & insured",
    headlines: ["Fast, reliable service you can trust.", "Done right the first time.", "Local pros, upfront prices."],
    sub: "Same-week appointments, upfront pricing, and workmanship we guarantee. Call today or request a free estimate online.",
    cta: "Get a free estimate",
    sectionTitle: "Services we offer",
    sectionSub: "Residential and commercial — no job too small.",
    features: [
      ["Upfront pricing", "Know the cost before we start. No surprises."],
      ["Same-week service", "Fast scheduling, including emergencies."],
      ["Guaranteed work", "We stand behind every job."],
      ["Local & trusted", "Hundreds of 5-star reviews from neighbors."],
    ],
  },
  {
    id: "beauty",
    match: /\b(salon|barber\w*|beauty|spa|nails?|lash\w*|brows?|hair|makeup|skincare|esthetic\w*|massage|tattoo)\b/,
    badge: "Book online 24/7",
    headlines: ["Look good. Feel even better.", "Your best look starts here.", "Relax, refresh, repeat."],
    sub: "Talented stylists, premium products, and a space designed for you to unwind. Book your appointment in seconds.",
    cta: "Book now",
    sectionTitle: "Our services",
    sectionSub: "Treatments tailored to you.",
    features: [
      ["Expert stylists", "Experienced, friendly, and always learning."],
      ["Premium products", "Professional brands that care for you."],
      ["Easy booking", "Pick a time that works — online, anytime."],
      ["Gift cards", "The perfect present for someone special."],
    ],
  },
  {
    id: "photo",
    match: /\b(photograph\w*|videograph\w*|photo studio|wedding photo\w*|headshots?)\b/,
    badge: "Now booking",
    headlines: ["Moments worth keeping forever.", "Photos that feel like you.", "Tell your story beautifully."],
    sub: "Natural, timeless photography for weddings, families, and brands — with a relaxed experience from start to finish.",
    cta: "Check availability",
    sectionTitle: "Sessions",
    sectionSub: "Every package includes edited, high-resolution images.",
    features: [
      ["Weddings", "Full-day coverage, candid and natural."],
      ["Portraits", "Families, couples, and headshots."],
      ["Brand shoots", "Imagery that makes your business shine."],
      ["Fast delivery", "Online gallery within two weeks."],
    ],
  },
  {
    id: "store",
    match: /\b(e-?commerce|online store|shop|store|boutique|clothing|apparel|jewelry|candles?|handmade|merch|products?)\b/,
    badge: "Free shipping over $50",
    headlines: ["Thoughtfully made. Delivered to you.", "Things you'll love using every day.", "Shop the new collection."],
    sub: "Quality products, fair prices, and fast shipping. Easy returns within 30 days — no questions asked.",
    cta: "Shop now",
    sectionTitle: "Why shop with us",
    sectionSub: "A better shopping experience from cart to doorstep.",
    features: [
      ["Fast shipping", "Most orders ship within 24 hours."],
      ["Easy returns", "30-day hassle-free returns."],
      ["Quality first", "Carefully sourced and made to last."],
      ["Secure checkout", "Pay safely with your favorite method."],
    ],
  },
  {
    id: "education",
    match: /\b(course|courses|tutor\w*|school|academy|class(?:es)?|lessons?|teach\w*|learn\w*|bootcamp|coding school|music lessons?)\b/,
    badge: "Enrollment open",
    headlines: ["Learn faster with expert guidance.", "Skills that move your life forward.", "Start learning today."],
    sub: "Practical lessons, supportive instructors, and a clear path from beginner to confident. Learn at your own pace.",
    cta: "Enroll now",
    sectionTitle: "How you'll learn",
    sectionSub: "Structured, hands-on, and built for real results.",
    features: [
      ["Expert instructors", "Learn from people who do this every day."],
      ["Hands-on projects", "Practice with real-world exercises."],
      ["Learn anywhere", "Online lessons that fit your schedule."],
      ["Certificate", "Show off what you've accomplished."],
    ],
  },
  {
    id: "nonprofit",
    match: /\b(non-?profit|charity|foundation|volunteer\w*|donat\w*|community group|church|ministry|cause)\b/,
    badge: "Join the movement",
    headlines: ["Together, we make a difference.", "Small acts, real impact.", "Help us change lives."],
    sub: "Every donation and every volunteer hour goes directly to the people and communities we serve. See your impact.",
    cta: "Donate today",
    sectionTitle: "Our impact",
    sectionSub: "Transparent, local, and community-driven.",
    features: [
      ["Direct impact", "Funds go straight to programs that help."],
      ["Volunteer", "Give your time and skills locally."],
      ["Transparent", "Annual reports on every dollar spent."],
      ["Community", "Events that bring neighbors together."],
    ],
  },
  {
    id: "legal",
    match: /\b(law firm|lawyer|attorney|legal|paralegal|notary)\b/,
    badge: "Free consultation",
    headlines: ["Experienced counsel when it matters most.", "Clear legal advice. Strong representation.", "We're on your side."],
    sub: "Straightforward guidance, responsive communication, and a team that fights for the best outcome for you.",
    cta: "Schedule a consultation",
    sectionTitle: "Practice areas",
    sectionSub: "Trusted representation for individuals and businesses.",
    features: [
      ["Personal attention", "You work directly with your attorney."],
      ["Proven results", "A track record clients can count on."],
      ["Clear fees", "Transparent pricing — no surprises."],
      ["Fast response", "Calls and emails returned same day."],
    ],
  },
  {
    id: "finance",
    match: /\b(accounting|accountant|bookkeep\w*|tax(?:es)?|cpa|financial|finance|wealth|insurance|payroll|invest\w*)\b/,
    badge: "Trusted advisors",
    headlines: ["Your finances, finally under control.", "Clear numbers. Confident decisions.", "Less stress at tax time."],
    sub: "Accurate books, proactive tax planning, and advice in plain English — so you can focus on growing.",
    cta: "Book a free call",
    sectionTitle: "How we help",
    sectionSub: "Year-round support, not just at tax time.",
    features: [
      ["Bookkeeping", "Monthly books, reconciled and on time."],
      ["Tax planning", "Strategies that keep more money in your pocket."],
      ["Payroll", "Pay your team accurately, every time."],
      ["Advisory", "Clear reports and real recommendations."],
    ],
  },
  {
    id: "coaching",
    match: /\b(coach\w*|consult\w*|mentor\w*|advisor|life coach|business coach|speaker)\b/,
    badge: "Limited spots available",
    headlines: ["Clarity, momentum, and real results.", "Get unstuck and move forward.", "Your next level starts here."],
    sub: "One-on-one guidance that turns big goals into a clear plan — with accountability to see it through.",
    cta: "Book a discovery call",
    sectionTitle: "How it works",
    sectionSub: "A proven process tailored to you.",
    features: [
      ["Discovery call", "Free session to understand your goals."],
      ["Custom plan", "A roadmap built around your situation."],
      ["Weekly sessions", "Focused coaching and accountability."],
      ["Real results", "Measurable progress you can feel."],
    ],
  },
  {
    id: "pets",
    match: /\b(dog|dogs|cat|cats|pet|pets|grooming|groomer|vet|veterinar\w*|kennel|dog walk\w*|pet sitting|puppy|puppies)\b/,
    badge: "Trusted by local pet parents",
    headlines: ["Happy pets, happy people.", "Care your pet will love.", "Treat them like family."],
    sub: "Loving, reliable care from people who adore animals — with photo updates so you always know they're happy.",
    cta: "Book a visit",
    sectionTitle: "Our services",
    sectionSub: "Gentle, reliable, and always tail-wagging.",
    features: [
      ["Walks & visits", "Daily walks and drop-ins, rain or shine."],
      ["Grooming", "Baths, trims, and nail care with a gentle touch."],
      ["Photo updates", "See what your pet is up to."],
      ["Insured & vetted", "Background-checked, pet-first-aid trained."],
    ],
  },
  {
    id: "events",
    match: /\b(wedding|weddings|event|events|party|parties|venue|planner|dj|florist|flowers)\b/,
    badge: "Booking for this season",
    headlines: ["Celebrations, beautifully planned.", "Unforgettable days, stress-free.", "Let's make it memorable."],
    sub: "From intimate gatherings to big celebrations, we handle every detail so you can enjoy the moment.",
    cta: "Check your date",
    sectionTitle: "What we offer",
    sectionSub: "Full planning, partial planning, or day-of coordination.",
    features: [
      ["Full planning", "Vendors, budget, and timeline handled."],
      ["Design & decor", "A look that feels completely you."],
      ["Day-of coordination", "Relax — we run the show."],
      ["Trusted vendors", "Our network of local favorites."],
    ],
  },
  {
    id: "media",
    match: /\b(blog|newsletter|podcast|magazine|journal|news|media|recipes?|writer|author|vlog|youtube channel|substack)\b/,
    badge: "New posts every week",
    headlines: ["Stories worth your time.", "Fresh ideas, delivered weekly.", "Read something good today."],
    sub: "Thoughtful posts, practical tips, and honest takes — straight to your inbox. Join thousands of readers who look forward to every issue.",
    cta: "Subscribe free",
    sectionTitle: "Popular this week",
    sectionSub: "Start with the posts readers love most.",
    features: [
      ["Weekly issues", "One great read in your inbox every week."],
      ["Practical tips", "Ideas you can use the same day."],
      ["Honest takes", "No fluff, no sponsored nonsense."],
      ["Free archive", "Every past post, searchable anytime."],
    ],
  },
  {
    id: "travel",
    match: /\b(travel|tours?|trips?|vacation\w*|hotel|hostel|bnb|airbnb|resort|adventure|cabin)\b/,
    badge: "Book direct & save",
    headlines: ["Your next adventure starts here.", "Stay somewhere unforgettable.", "Explore more, worry less."],
    sub: "Handpicked experiences, local guides, and flexible booking — everything you need for a trip you'll talk about for years.",
    cta: "Check availability",
    sectionTitle: "Why travel with us",
    sectionSub: "Thoughtful details from booking to goodbye.",
    features: [
      ["Local experts", "Guides who know the hidden gems."],
      ["Flexible booking", "Free changes up to 48 hours before."],
      ["Best price", "Book direct for the lowest rates."],
      ["24/7 support", "Help whenever you need it."],
    ],
  },
];

const TONES = {
  professional: {
    re: /professional|formal|corporate|serious|business-?like|credible|trustworthy/,
    h: ["{T}, delivered with precision.", "Trusted {t} for growing teams.", "Reliable {t}. Measurable results."],
    s: "We deliver dependable {t} with clear communication, proven processes, and results you can measure.",
  },
  friendly: {
    re: /friendly|casual|warm|welcoming|approachable|conversational|human/,
    h: ["Hey there — let's make {t} easy.", "{T}, minus the hassle.", "Say hello to easier {t}."],
    s: "We keep {t} simple, friendly, and stress-free. Questions? We're real people and we're happy to help.",
  },
  playful: {
    re: /playful|fun|funny|quirky|witty|cheeky|whimsical/,
    h: ["{T}, but make it fun.", "Seriously good {t} (we're not kidding).", "Warning: {t} may cause happiness."],
    s: "Who says {t} has to be boring? We bring the good vibes, you bring the big ideas.",
  },
  bold: {
    re: /bold|punchy|confident|exciting|energetic|powerful|strong|catchy|urgent|persuasive|salesy/,
    h: ["The {t} you've been waiting for.", "Stop settling. Start winning with {t}.", "{T}. Faster. Better. Yours."],
    s: "No fluff, no waiting. Get {t} that actually delivers — and see the difference from day one.",
  },
  luxury: {
    re: /luxury|luxurious|premium|elegant|high-?end|sophisticated|upscale|classy|refined/,
    h: ["{T}, elevated.", "Exceptional {t}, by design.", "The art of {t}."],
    s: "A refined approach to {t} — meticulous detail, exceptional service, and an experience worth savoring.",
  },
  minimal: {
    re: /minimal|minimalist|concise|shorter|short|brief|simple|simpler|clean|tighter|less wordy/,
    h: ["{T}. Simplified.", "Better {t}.", "{T}, done well."],
    s: "Simple, fast, and reliable {t}.",
  },
};

function cap(s) {
  s = String(s || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function cleanTopic(t) {
  return String(t || "")
    .replace(/["“”]/g, "")
    .replace(/\s+(?:with|using|in a|and make|and add|and change|and use|that is|that's|so it)\b.*$/i, "")
    .replace(/\b(?:business|company|website|site|page|landing page|brand)\s*$/i, "")
    .replace(/^(?:an?|the|my|our)\s+/i, "")
    .replace(/[.!?,;:]+$/, "")
    .trim()
    .slice(0, 60);
}

function findPack(text) {
  const t = String(text || "").toLowerCase();
  for (const p of PACKS) if (p.match.test(t)) return p;
  return null;
}

function findTone(text) {
  const t = String(text || "").toLowerCase();
  for (const k of Object.keys(TONES)) if (TONES[k].re.test(t)) return k;
  return null;
}

function pick(arr, seed) {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

/** Choose a variant different from `current` when possible. */
function pickFresh(arr, current, seed) {
  const cur = String(current || "").trim().toLowerCase();
  const options = arr.filter(function (x) {
    return x.trim().toLowerCase() !== cur;
  });
  return pick(options.length ? options : arr, seed);
}

function fill(tpl, topic) {
  return tpl.replace(/\{T\}/g, cap(topic)).replace(/\{t\}/g, topic);
}

/**
 * Build a full copy set for a topic and optional tone.
 * Returns { badge, headline, sub, cta, sectionTitle, sectionSub, features[[t,d]] }.
 */
function copyFor(topic, tone, current) {
  current = current || {};
  topic = cleanTopic(topic) || "your business";
  const pack = findPack(topic);
  const seed = topic + (tone || "") + (current.headline || "");
  let out;
  if (pack) {
    out = {
      badge: pack.badge,
      headline: pickFresh(pack.headlines, current.headline, seed),
      sub: pack.sub,
      cta: pack.cta,
      sectionTitle: pack.sectionTitle,
      sectionSub: pack.sectionSub,
      features: pack.features,
      pack: pack.id,
    };
  } else {
    out = {
      badge: "Now open",
      headline: pickFresh(
        [cap(topic) + ", done right.", cap(topic) + " made simple.", cap(topic) + " you'll actually love.", "Great " + topic + " starts here."],
        current.headline,
        seed
      ),
      sub:
        "We make " +
        topic +
        " simple, reliable, and worth recommending — so you can focus on what matters most. Get started in minutes.",
      cta: "Get started",
      sectionTitle: "Why choose us",
      sectionSub: "Everything you need from " + topic + ", nothing you don't.",
      features: [
        ["Reliable", "Consistent quality you can count on, every time."],
        ["Fast", "Quick turnaround without cutting corners."],
        ["Friendly support", "Real people ready to help when you need it."],
        ["Fair pricing", "Clear, upfront costs — no surprises."],
      ],
      pack: null,
    };
  }
  if (tone && TONES[tone]) {
    const T = TONES[tone];
    const subject = pack ? topic : topic;
    out.headline = pickFresh(
      T.h.map(function (h) {
        return fill(h, subject);
      }),
      current.headline,
      seed
    );
    out.sub = fill(T.s, subject);
    out.tone = tone;
  }
  return out;
}

module.exports = { PACKS, TONES, copyFor, findPack, findTone, cleanTopic, cap };
