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
a schedule that's generated from the home's actual systems, and (at paid
tiers) a human advisor who walks the home, validates the record, and manages
the work.

The one-line pitch: **the maintenance and records service that makes a home
easier to own and worth more when you sell.**

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

| For the owner | Steward delivers |
|---|---|
| "What do I need to do, and when?" | A schedule generated from the home's real systems, not generic advice |
| "Is this normal / urgent?" | Priority and cost ranges on every item; a 5-year capital forecast at higher tiers |
| "Who do I call?" | A vetted contractor network (advisor tiers) or a personal contractor book (self-serve) |
| "Where's the paperwork?" | Every permit, invoice, warranty, and photo in one place, exportable anytime |
| "Will this help when I sell?" | A complete, printable Home Record that documents the care the home received |

The defensible promise at the top tiers is **judgment and labor** — a human
who knows the home walks it, chases the warranty, books the contractor. The
software is the memory; the service is the value.

---

## 4. Personas

### Customers (homeowners)

- **The Self-Serve owner (DIY-inclined).** Wants structure, not a service.
  Will document their own home and follow a schedule if it's made easy.
  Price-sensitive; high volume; the top of the funnel. *Demo: Taylor Brooks.*
- **The Guided owner.** Wants an annual expert walkthrough and a schedule they
  trust, but manages the work themselves. *Demo: Mia.*
- **The Managed owner.** Busy; wants Steward to track the home and manage most
  maintenance, with a semiannual cadence and a capital forecast for budgeting.
  *Demo: James.*
- **The Concierge owner.** High-value home and/or low time; wants Steward to
  own the whole relationship — quarterly visits, full contractor management.
  *Demo: Sarah.*

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

Four tiers span pure software to full concierge. Prices are annual.

| Tier | Price/yr | Advisor hrs/yr | Visits/yr | Who it's for | Key inclusions |
|---|---|---|---|---|---|
| **Self-Serve** | $129 | 0 | 0 | DIY owners | Self-built Home Record, generated schedule, personal contractor book, guided suggestions, document & permit storage, export |
| **Guided** | $500 | 2.5 | 1 | Owners who want one expert pass | Everything above **+** one annual advisor visit and intake, vetted network access |
| **Managed** | $1,200 | 7 | 2 | Busy owners | **+** semiannual visits, **5-year capital forecast**, contractor coordination |
| **Concierge** | $2,500 | 26 | 4 | High-value / low-time | **+** quarterly visits, full contractor management, priority handling |

**Tier-scoped features are enforced in software, not just marketing.** For
example, the capital forecast returns nothing below Managed; visit cadence is
tracked against each tier's promise so the ops team sees when a home is
overdue for its contracted visit.

Signup is open for Self-Serve (payments currently bypassed in the build);
higher tiers are sold through the ops team and begin with an intake visit.

---

## 6. Revenue model

Three streams, in order of scale potential:

1. **Subscriptions** — the core. Recurring annual revenue across four tiers.
   ARR/MRR, renewals, and churn are already tracked in the founder console.
2. **Referral fees** — network contractors pay Steward a fee (~10–12% of
   invoice) on referred work. This is recorded and invoiced in a ledger.
   **Steward never processes the owner's payment to the contractor** — it
   records and bills the fee to the contractor. The referral relationship is
   disclosed to owners; the fee *accounting* stays internal.
3. **Intake fees** — one-time fees for the initial home assessment on advisor
   tiers (modeled in the `intake_fees` table).

The economics lever is **advisor hours vs. price.** Self-Serve carries zero
advisor cost and is nearly pure margin (minus infrastructure and a small
per-suggestion API cost). Advisor tiers trade margin for stickiness and
referral volume. Concierge is a labor business with software leverage.

---

## 7. The strategic bet: free-first, data flywheel

The most important strategic decision on the table:

> **Make Self-Serve free (or near-free) to acquire users and data at scale,
> then convert to paid tiers and monetize the accumulated data.**

Why this fits Steward specifically — and better than for a typical freemium
product:

- **A real data network effect.** Steward's recommendation engine gets
  smarter as more homes are documented: once many owners have, say, a gas
  water heater and keep the same maintenance tasks, the advice for the next
  identical system converges and improves. More users → better product for
  *every* user. This is a compounding moat that competitors can't buy.
- **The asset is the corpus of Home Records**, not the software. Free-first is
  the fastest way to accumulate it.
- **Natural upgrade path.** The free tier delivers memory + a schedule; the
  paid tiers deliver human judgment and labor (visits, forecasts, contractor
  management) — things software can't give away.

Two risks to manage deliberately:

- **Price anchoring.** If the free tier feels complete, willingness to pay
  drops. Keep documentation + schedule free; keep judgment + labor paid. The
  build already gates the capital forecast and advisor visits behind paid
  tiers, which is the right instinct.
- **Data quality & consent.** Self-entered data is noisy — the engine already
  requires a minimum number of homes before it treats a pattern as a norm.
  And using owners' (anonymized) data to improve everyone's recommendations
  requires clear consent (see Data Privacy, below).

The moat is the accumulated records and the fleet-derived norms. Free-first is
the accumulation strategy; the paid tiers are the monetization.

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

- **Wedge:** the self-serve guided home assessment. It's low-friction, it
  produces the Home Record (the retention hook and the data asset) on day one,
  and it's the top of the conversion funnel.
- **Geographic density matters.** Advisor tiers and the contractor network are
  market-scoped (the model already isolates by market — e.g. Boston, LA). Grow
  market-by-market so advisor utilization and network liquidity are real.
- **Conversion triggers:** completeness nudges, seasonal check-ins, and the
  moment an owner hits something they'd rather hand off (a big repair, a
  warranty fight) — that's when Self-Serve converts to an advisor tier.
- **Retention:** the schedule and seasonal cadence give owners a recurring
  reason to return; the accumulating record raises switching cost over time.

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

## 11. Where the business stands today (build reality)

- All four tiers exist and are enforced in software.
- Self-Serve is fully self-service end to end: signup, guided onboarding,
  self-built Home Record, generated schedule, personal contractor book,
  document/permit management, service history with a timeline, custom tasks,
  system/component lifecycle (replace/retire), and guided recommendations.
- Advisor tiers have the full workflow: intake, 60-second system capture, job
  completion, contractor network, ratings.
- The founder console covers **operations** (ARR/MRR, renewals, churn, the
  referral ledger, network health, the rules library). It does **not yet**
  cover **growth analytics** (funnel, cohort retention, LTV/CAC, data-asset
  density) — that's the most valuable next reporting layer.
- Self-Serve is priced at $129/yr in the current model; the free-first pivot
  is a strategic option, not yet the shipped default.

The product is real and the data moat is architected. The next business
milestones are **growth instrumentation** and a **deliberate decision on
free-first**.
