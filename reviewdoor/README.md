# ReviewDoor — Smart Review QR Subscription Platform

**ReviewDoor** is a subscription-controlled *dynamic review QR* platform for restaurants and local
businesses (Pakistan-market pricing, PKR). A business prints a QR **once**; the destination it points
to (Google Maps reviews, Foodpanda, TripAdvisor, Instagram, …) can be changed anytime from the
dashboard — no reprinting. When a subscription lapses, visitors land on a friendly branded page
instead of a dead link, and payments made by bank transfer / wallet / cash are verified through an
OCR-assisted receipt pipeline with provisional access while under review.

Built from the two source documents in this repo:
- `SmartReview_QR_Subscription_Platform_Requirements.docx` (FR/NFR inventory)
- `SmartReview_QR_Platform_Design_Document.docx` (IA, flows, states, data model, screens)

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS with a bespoke brand theme (Clash Display / Manrope / IBM Plex Mono, paper-grain texture, dot-grid panels) |
| Animation | Framer Motion (page transitions, scan-line hero, drawers, micro-interactions) |
| Charts | Recharts (scan analytics) |
| State | Zustand + persist (localStorage) — simulates the backend end-to-end |
| Routing | React Router v6 (public / client / admin route trees, RBAC guards) |
| QR | qrcode.react (live scannable codes everywhere) |
| Icons | lucide-react |

The whole product runs as a **self-contained demo**: the zustand store stands in for the modular
backend (auth/RBAC, tenant scoping, receipts pipeline, subscriptions, card orders, audit log), so
every flow is clickable without external services.

## Run it

```bash
cd reviewdoor
npm install
npm run dev        # http://localhost:5173

# Production build (code-split: vendor-charts / vendor-motion / vendor-router chunks)
npm run build      # type-checks with tsc, then bundles to dist/
npm run preview    # serves dist/ at http://localhost:4173
```

## Demo accounts & data

| Where | How |
|---|---|
| Client workspace `/app` | Sign in with any email, e.g. `owner@spiceroute.pk` (seeded: Grace state), `hello@bloomcafe.pk` (Provisional), `tags@urbantailor.pk` (Suspended QR), `studio@clayandcream.pk` (Expired) |
| Admin console `/admin` | Any email starting with `admin` (e.g. `admin@reviewdoor.app`) |
| Visitor resolver | Scan/open `/q/DEMO42` — live redirect demo; other seeded codes show expired/suspended pages |
| New signup | `/signup` → 7-step onboarding wizard creates a trial QR instantly |

## Pages

- **Landing `/`** — hero with animated phone-scan mockup, how-it-works, live scannable demo QR,
  printed-card showcase, plan teaser, FAQ accordion.
- **Pricing `/pricing`**, **Legal `/legal/terms` `/legal/privacy`**, **404** designed fallback.
- **Onboarding `/setup`** — Account → Business → Destination → QR → Plan → Payment → Activation.
- **Client `/app/*`** — Overview (status-first), My QRs (+detail: destination switch, downloads),
  Analytics, Subscription (renew via receipt upload → provisional access), Payments/Receipts history,
  Print Orders (card designer + order pipeline), Business Profile, Support.
- **Admin `/admin/*`** — Operations dashboard, Receipt queue (OCR drawer with field confidences,
  rule checks, risk flags, approve/reject with reasons — idempotent single credit), QR moderation
  (suspend/enable), Card fulfilment pipeline, full Audit log.
- **Resolver `/q/:code`** — visitor-facing: resolving animation → redirect interstitial, or branded
  Expired / Suspended / Not-found pages. Core routing rule implemented in `effectiveRouting()`:
  operational override → subscription entitlement → redirect.

## Design system highlights

- Brand palette from the design doc: deep teal `#004643`, cream `#FAF4D3`, gold `#D1AC00`, peach `#F6BE9A`, ink `#0C1618`.
- Custom SVG logo: an arched “door” holding a QR finder square — the scan walks through the door to
  the review destination (`src/components/Brand.tsx`, favicon `public/logo-mark.svg`).
- Status is always icon + text + tone (never colour alone); grace/provisional/expired each have a
  distinct treatment per the accessibility requirements.
- Subtle motion everywhere (pulse rings, scanlines, spring drawers) tuned to feel editorial, not gimmicky.

## Repo layout

```
reviewdoor/
├── index.html · vite.config.ts · tailwind.config.js · tsconfig.json
├── public/logo-mark.svg
└── src/
    ├── main.tsx · App.tsx          # entry + full route map
    ├── index.css                   # brand tokens, component classes, print styles
    ├── lib/domain.ts               # types, effective routing, renewal math, status model, URL validation
    ├── lib/store.ts                # simulated backend: auth, tenants, receipts, cards, audit + seed data
    ├── components/                 # Brand (logo/wordmark/live-dot), Ui (QR view, status chips, phone mock), layouts
    └── pages/                      # Landing, Onboarding/Login, client, clientMore, admin, resolver
```

`npm run build` passes clean (`tsc -b` + `vite build`), all routes return 200 under `vite preview`.
