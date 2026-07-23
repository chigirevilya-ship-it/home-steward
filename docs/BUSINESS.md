# Steward — Business Model

*A working description of Steward as a business: what it is, who it serves,
how it makes money, and the strategy behind it. This document describes the
model as currently built and the strategic options under active
consideration. It is a living document — where reality and intent differ,
that is called out.*

---

## 1. What Steward is

**Steward is the system of record for a home, plus a proactive service that
tells owners what to maintain, when, and who to call.**

A house is one of the largest assets most people own, yet its history lives in
a shoebox of receipts, a few permits nobody can find, and the memory of
whoever owned it last. Steward replaces that with a durable **Home Record** —
every system, its age and condition, what's been serviced, what's coming due,
the permits, the documents — and wraps a **maintenance advisory** around it:
a schedule generated from the home's actual systems, and escalating levels of
help building and acting on it.

**Core promise (every tier):** *Know what your home needs before it becomes a
problem.*

**The axis the tiers move on:** *who does the work of knowing and caring for
your home* — **you → AI → a human who validates → a human who manages.** That
single spectrum is the whole model. The core promise never changes; what
changes is how much is done for you.

---

## 2. The problem

- **Deferred maintenance is expensive and invisible.** Small problems (an
  unflushed water heater, a missed roof repair) become large ones. Owners
  don't have a schedule and don't know what "on time" looks like.
- **Home knowledge doesn't transfer.** When a home changes hands, its history
  evaporates. Buyers inherit mystery; sellers can't prove the care they took.
- **Finding trustworthy contractors is a cold-start every time.** No memory of
  who did good work, no accountability, no leverage.
- **Professional help is all-or-nothing.** You either manage everything
  yourself or hire a property manager. There's little in between for an
  owner-occupier who wants guidance, not a landlord service.

Steward addresses all four with one artifact (the Home Record) and one engine
(the maintenance schedule), delivered at a range of service levels.

---

## 3. Value proposition

The wedge is **peace of mind / anti-surprise** — everyone fears the surprise
$9k repair. The core promise (*know what your home needs before it becomes a
problem*) is true at every tier; the paid tiers escalate on **who does the
work.**

| For the owner | Steward delivers |
|---|---|
| "What do I need to do, and when?" | A schedule generated from the home's real systems, not generic advice |
| "Is this normal / urgent?" | Priority and cost ranges on every item; a 5-year capital forecast |
| "Who do I call?" | A vetted contractor network (human tiers) or a personal contractor book (self-serve) |
| "Where's the paperwork?" | Every permit, invoice, warranty, and photo in one place, exportable anytime |
| "Will this help when I sell?" | A complete, printable Home Record that documents the care the home received |

- **Resale value** is a real benefit, but it's a *supporting* proof point, not
  the headline — its payoff is distant (it only cashes in at sale).
- **Done-for-you** is the escalation the paid tiers monetize, not the wedge —
  free/DIY owners are, by definition, doing it themselves.

The defensible promise at the higher tiers is **judgment and labor** — a human
who knows the home walks it, chases the warranty, books the contractor. The
software (and increasingly the AI) is the memory; the human is the service.

---

## 4. Personas

### Customers (homeowners)

- **The DIY owner (Free).** Wants structure, not a service. Will document
  their own home and follow a schedule if it's made easy. Price-sensitive;
  high volume; the top of the funnel and the data-capture engine. *Demo:
  Taylor Brooks.*
- **The Auto owner (~$120).** Wants the payoff without the data entry. Enters
  an address, lets Steward auto-build the record from public data, and manages
  the upkeep themselves — with ongoing permit monitoring watching their home.
- **The Guided owner ($500).** Wants a human to *validate* the record — catch
  what public data and self-entry miss (actual condition, unpermitted work) —
  and to answer questions. Manages the work themselves. *Demo: Mia.*
- **The Managed owner ($1,200).** Busy; wants Steward to actively manage the
  upkeep — coordinate contractors, chase warranties and permits, run seasonal
  work — with a capital forecast for budgeting. *Demo: James.*
- **The white-glove owner (Concierge, by quote).** High-value home and/or low
  time; wants Steward to own the whole relationship end-to-end. A bespoke
  offering, not a shelf price. *Demo: Sarah.*

Common thread: **owner-occupiers who see the home as an asset to be stewarded,
not just shelter.** Not landlords (that's property management) and not flippers.

### Internal / supply side

- **Founder / operator.** Runs the business: markets, pricing, the rules
  library, contractor network health, the referral ledger. Sees everything.
- **SME advisor.** A senior, market-specific expert (e.g. a former GC or
  inspector) who runs intakes and complex assessments.
- **Advisor.** Runs visits, logs jobs, updates records within one market.
- **Contractor (network).** Vetted trade partners who receive referrals; they
  pay Steward a referral fee. Steward is **never** in the payment chain
  between owner and contractor.

---

## 5. Service tiers

Four published tiers, arranged on one axis — **who does the work of knowing
and caring for your home**: you → AI → a human who validates → a human who
manages. A fifth (Concierge) sits above them as bespoke, by quote. Prices are
annual.

| | **Free** — $0 | **Auto** — ~$120 | **Guided** — $500 | **Managed** — $1,200 |
|---|---|---|---|---|
| **Who builds & keeps your record** | You, by hand | AI, from your address | AI draft + human validation | Steward, actively |
| **Record creation** | Manual entry | Auto from address (permits, assessor) → AI-structured | Auto + a human walkthrough that catches what records miss | Auto + human, kept current |
| **Maintenance schedule** (generated) | ✓ | ✓ | ✓ | ✓ |
| **Steward's recommendations** | Rules-based | AI-backed | AI-backed + advisor input | AI + advisor-managed |
| **Permit data** | — (manual) | Auto-import **+ ongoing monitoring** | + human-validated | + acted on for you |
| **5-year capital forecast** | — | ✓ | ✓ | ✓ |
| **Document & permit vault** | Capped | Unlimited | Unlimited | Unlimited |
| **Full export / data ownership** | ✓ | ✓ | ✓ | ✓ |
| **Human involvement** | None | None | Annual validation + targeted support (ask an expert, quote review) | Active management (coordination, warranty/permit chasing, seasonal work) |
| **Contractors** | Personal book | Personal book | Vetted network referrals | Steward coordinates end-to-end |
| **Physical visit** | — | — | 1 annual validation walkthrough | 1 annual + event-driven |

**Concierge (by quote).** White-glove above Managed — a dedicated advisor,
on-demand access, full end-to-end management for high-value / low-time owners.
Deliberately *not* a shelf price: it's a labor business, so it's sold bespoke
and kept off the published ladder to avoid over-investing the roadmap in a
handful of high-touch accounts. It still serves as the price anchor that makes
Managed look reasonable.

### The seams that matter

Two distinctions keep this model from getting fuzzy:

- **What makes Auto a *recurring* charge (not a one-time trick).** Auto-entry
  is a great first moment, but you can't bill yearly for something that happens
  once. The recurring hook is **permit monitoring** ("a new electrical permit
  was pulled on your address") plus the living schedule, unlimited AI
  recommendations, and the forecast. The address is the gift that keeps giving.
- **"Entry" appears at both Auto and Guided — on purpose.** At Auto, AI does
  entry *from public records*. At Guided, a **human validates it** — and that's
  worth the step-up because public data is blind to the two things that matter
  most: **actual condition** and **unpermitted work**. A person walking the
  home catches "the records say nothing, but that furnace is done" and "there's
  a finished basement with no permit." The value of the human here isn't more
  data entry — it's **truth the data can't see** (this is exactly the existing
  permit **gap-flag** concept).

**Visits are annual + event-driven, never calendar-dense.** A stable home
doesn't drift fast enough to justify quarterly or even semiannual
reassessment. Higher tiers differentiate on *management depth and access*, not
inspection frequency; extra visits happen when something actually warrants
eyes.

**Tier-scoped features are enforced in software, not just marketing** — e.g.
the capital forecast and the AI-backed recommendation path gate on tier.

> **Build reality:** the shipped app currently defines the older tier set
> (Self-Serve $129 / Guided / Managed / Concierge) in `server/vocab.js` and
> gates the capital forecast at Managed+. The model above is the **target**;
> rewiring prices, the Free/Auto split, and the forecast gate into the code is
> a deliberate, not-yet-done step (see §11).

---

## 6. Revenue model

Three streams, in order of scale potential:

1. **Subscriptions** — the core. Recurring annual revenue across the paid
   tiers (Auto, Guided, Managed) plus bespoke Concierge. ARR/MRR, renewals,
   and churn are already tracked in the founder console.
2. **Referral fees** — network contractors pay Steward a fee (~10–12% of
   invoice) on referred work. This is recorded and invoiced in a ledger.
   **Steward never processes the owner's payment to the contractor** — it
   records and bills the fee to the contractor. The referral relationship is
   disclosed to owners; the fee *accounting* stays internal.
3. **Intake fees** — one-time fees for the initial home assessment on the
   human tiers (modeled in the `intake_fees` table).

**Cost structure by tier:**

- **Free** — near-zero marginal cost: no advisor, and the recommendation path
  is the deterministic **rules-based engine** (free to run), not the AI path.
  Its job is data capture and funnel volume, not revenue.
- **Auto** — near-zero human cost; small per-lookup enrichment + per-suggestion
  API cost. High margin. The AI does the work.
- **Guided / Managed** — trade margin for stickiness and referral volume; cost
  is advisor *time* (now re-pointed from dense site visits to validation +
  coordination + response).
- **Concierge** — a labor business with software leverage; bespoke pricing.

The economics lever moved from **"advisor hours vs. price"** to **"how much of
the work is automated vs. human."** Free/Auto are the automated, high-margin
funnel; Guided/Managed monetize human judgment and labor.

---

## 7. The strategic bet: free-first, data flywheel

The strategy the tier model is built around:

> **A true free tier acquires users and data at scale; the paid ladder
> monetizes escalating automation and human help.**

Why this fits Steward specifically — better than a typical freemium product:

- **A real data network effect.** Steward's recommendation engine gets smarter
  as more homes are documented: once many owners have, say, a gas water heater
  and keep the same maintenance tasks, the advice for the next identical system
  converges and improves. More users → better product for *every* user. A
  compounding moat competitors can't buy.
- **The asset is the corpus of Home Records**, not the software. Free-first is
  the fastest way to accumulate it, and address-enrichment (§Auto) accelerates
  it — every signup can seed a real record from public data.
- **A natural upgrade path along one axis.** Free gives you the memory + a
  schedule; Auto has AI build and watch it; Guided adds a human who validates;
  Managed has a human run it. Each step is an obvious "do more of it for me."

**The free/paid line is already architected.** The two recommendation code
paths in `server/suggest.js` — the deterministic rule engine and the AI-backed
path — map cleanly onto Free vs. paid. Free runs the rules engine (still
improves with the fleet, costs nothing to run); paid unlocks the AI path.
Export stays free at every tier — data ownership is a trust primitive, never a
paywall.

**The free-tier "aha."** The payoff for documenting a home must be immediate:
the moment an owner finishes (or, at Auto, enters an address), Steward shows a
personalized calendar of what's coming and roughly what it will cost. That
single screen delivers peace of mind in minutes and justifies the effort — and
it's the cleanest upsell in the model: **free shows you the plan; paid does the
plan.**

Two risks to manage deliberately:

- **Price anchoring.** If the free tier feels complete, willingness to pay
  drops. Keep the memory + schedule free; keep automation depth, the itemized
  forecast, and human judgment/labor paid.
- **Data quality & consent.** Self-entered data is noisy — the engine already
  requires a minimum number of homes before it treats a pattern as a norm. And
  using owners' (anonymized) data to improve everyone's recommendations
  requires clear consent (see Data Privacy in the Technical doc).

The moat is the accumulated records and the fleet-derived norms. Free-first is
the accumulation strategy; the paid ladder is the monetization.

---

## 8. Operating principles (enforced, not aspirational)

Steward runs on ten rules that are enforced in the software itself, which
double as business commitments:

1. **Owners own their data** — full export anytime, from the portal or API.
2. **Market isolation** — staff only see their own market's clients.
3. **Contractor gating** — no referral to a contractor without current license
   and insurance; 90-day expiry warnings.
4. **Three-complaint rule** — a third complaint auto-moves a contractor to
   probation and flags it for founder review.
5. **Never in the payment chain** — Steward records and bills referral fees;
   it never processes owner→contractor payments.
6. **Fee transparency** — the referral relationship is disclosed to owners.
7. **Records are permanent** — deleting a maintenance rule deactivates it;
   history is never destroyed.
8. **Tier-scoped features** — enforced at the API, not just the UI.
9. **Internal vs. client-visible** — advisor notes, vetting notes, and fee
   accounting never reach a client session.
10. **Scope honesty** — every assessment is labeled an advisory walkthrough,
    **not a licensed home inspection.**

These are trust primitives. For a business handling intimate data about
people's homes, they are also marketing.

---

## 9. Go-to-market notes

- **Wedge:** the guided home assessment — ideally **address-first**. The lower
  the friction to a populated Home Record, the more homes (and data) enter the
  funnel. "Enter your address → here's a draft of your home" beats "type in all
  your systems," and it produces the retention hook + data asset on day one.
- **Geographic density matters.** The human tiers and the contractor network
  are market-scoped (the model already isolates by market — e.g. Boston, LA).
  Grow market-by-market so advisor utilization and network liquidity are real —
  and civic permit data is richest in exactly those dense metros.
- **Conversion triggers:** completeness nudges, seasonal check-ins, a new
  permit detected on the address, and the moment an owner hits something they'd
  rather hand off (a big repair, a warranty fight) — that's when Free/Auto
  converts up to a human tier.
- **Retention:** the schedule, seasonal cadence, and ongoing permit monitoring
  give owners a recurring reason to return; the accumulating record raises
  switching cost over time.

---

## 10. Key risks

| Risk | Mitigation |
|---|---|
| Free users never convert | Keep judgment/labor paid; instrument the funnel; nudge at high-intent moments |
| Self-entered data is too noisy to power good advice | Confidence floors on fleet norms; guided (not blank) data capture; photo/data-plate capture |
| Advisor tiers don't scale (labor-bound) | Software leverage per advisor; density before expansion; SME model for the hard cases |
| Contractor network quality erodes trust | Enforced gating, ratings, three-complaint rule already in the model |
| Privacy misstep on intimate home data | Strong ownership/export primitives already shipped; formal policy + consent + deletion path needed (see Technical doc) |

---

### What's built

- The **self-serve tier is fully functional end to end**: signup, guided
  onboarding, self-built Home Record, generated schedule, personal contractor
  book, document/permit management, service history with a timeline, custom
  tasks, system/component lifecycle (replace/retire), and recommendations.
- The **human-tier workflow** exists: intake, 60-second system capture, job
  completion, contractor network, ratings.
- The **recommendation engine** already has the two paths (rules-based +
  AI-backed) plus the fleet-learning loop — the exact mechanism the Free/paid
  split relies on.
- The **founder console** covers operations (ARR/MRR, renewals, churn, the
  referral ledger, network health, the rules library).

### The gap between the target model and the code

The canonical tier model in §5 is the **target**. The shipped app still
reflects the older shape, so wiring the two together is pending work:

- `server/vocab.js` defines **Self-Serve $129 / Guided / Managed / Concierge**
  with visit-count fields — not yet **Free / Auto / Guided / Managed** with the
  new value axis.
- The capital forecast gates at **Managed+**; the target puts it at **Auto+**.
- **Address enrichment + permit monitoring** (the whole Auto tier) is **not yet
  built** — see the Technical doc for where it plugs in.
- **Growth analytics** (funnel, cohort retention, LTV/CAC, data-asset density)
  is **not yet built** — the most valuable next reporting layer, and the
  instrumentation needed to make the free-first bet with real numbers.

The product is real and the data moat is architected. The next milestones, in
rough order: **(1) address enrichment + permit monitoring** (unlocks Auto and
kills onboarding friction), **(2) growth instrumentation** (to run the
free-first funnel by the numbers), and **(3) rewiring the tier definitions**
(Free/Auto split, prices, forecast gate) into the code.
