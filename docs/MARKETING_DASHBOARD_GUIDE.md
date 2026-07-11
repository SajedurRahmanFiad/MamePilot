# Marketing Dashboard — Plain English Guide

This document explains every metric, KPI card, and chart on the Marketing Dashboard (`/social-media-ads`) in non-technical language.

---

## Header bar

**Date range picker** — Choose what time period you're looking at. Default is "Last 7 days" because ROAS (return on ad spend) needs a few days to make sense. "Today" alone is misleading since orders from today's ads usually deliver tomorrow or later.

**Sync status** — Shows when your Meta ad data was last pulled in. If it says "Data may be stale," the numbers might be a few hours old. Hit Refresh to pull fresh data.

**Active ads / campaigns** — How many ads are currently running on Meta and how many campaigns they belong to.

**Explainer text** — Tells you that all money is shown in ৳ BDT. If your Meta ad account uses a different currency (like USD), hover over any money amount to see the original ad-currency value.

---

## Alert banners (top of page)

These appear only when something needs your attention:

- **"Data may be stale"** — Your Meta data hasn't synced in over 20 minutes. Numbers might be outdated.
- **"No attributed orders"** — You're spending on ads but no orders have been linked to an ad yet. You may not be setting `sourceAd` on orders.
- **"Booked ROAS below 1x"** — You're spending more on ads than you're making back in orders. Losing money.
- **"Exchange rate not set"** — Your Meta ad account uses a foreign currency but you haven't told the system the exchange rate. Spend numbers can't be converted to BDT.
- **"Meta not connected"** — Your Meta account link is broken or expired. No ad data is syncing.

---

## KPI Row 1 — Money & Efficiency (the 8 big cards)

### 1. Ad Spend

**What it is:** Total money you paid to Meta for ads during the selected date range.

**Why it matters:** This is your cost. Everything else on the dashboard is measured against this number.

**The % vs previous period:** Shows whether you're spending more or less than the equivalent previous period. If you picked "Last 7 days," it compares to the 7 days before that.

---

### 2. Booked Revenue

**What it is:** Total value of orders that came from your ads (orders where a `sourceAd` was set), regardless of whether those orders have been delivered yet.

**"Orders placed" badge:** These are orders that were *created* during this period — they may still be sitting in your warehouse, on the way to the customer, or already delivered.

**Why it matters:** This is the earliest signal that your ads are working. If someone sees your ad and places an order today, it shows up here today even though you won't collect the money until delivery.

---

### 3. Booked ROAS

**What it is:** For every ৳1 you spent on ads, how many ৳ worth of orders came in.

- **2.00x** means you got ৳2 in orders for every ৳1 spent. Good.
- **1.00x** means you broke even on order value (but haven't accounted for delivery failures yet).
- **Below 1.00x** means you're spending more than you're making back in orders.

**"Orders / spend" badge:** Reminds you this counts all placed orders, not just delivered ones.

**Why it matters:** This is your fastest feedback loop on ad performance. It's optimistic because it includes orders that might get cancelled or returned, but it tells you directionally whether ads are generating demand.

---

### 4. Realized Revenue

**What it is:** Total value of orders from ads that have actually been *delivered* (status = Completed) during this period.

**Why it matters:** This is real money you've collected. Unlike Booked Revenue, this only counts orders the customer actually received and paid for.

---

### 5. Realized ROAS

**What it is:** For every ৳1 spent on ads, how many ৳ of *delivered* sales you got.

**"Matures over time" note:** This number will be lower than Booked ROAS at first because orders take days to deliver. A "Last 7 days" window will undercount realized revenue because some orders placed 5 days ago haven't been delivered yet. Over 14–30 day windows, this becomes more accurate.

**Why it matters:** This is the most honest measure of whether your ads are making you money. It accounts for cancellations and returns.

---

### 6. Cost per Order (CPA)

**What it is:** How much ad spend it took to generate each order. Ad spend ÷ number of orders.

- **৳50** means you spent ৳50 on ads for each order that came in.

**Why it matters:** Tells you the efficiency of your ads at generating orders. Compare this to your average order value — if CPA is higher than your profit margin, you're losing money on each order.

---

### 7. Cost per Delivered

**What it is:** How much ad spend it took to generate each *delivered* order. Ad spend ÷ delivered count.

**Why it matters:** This is more realistic than Cost per Order because it accounts for the orders that failed to deliver (cancelled, returned). If this is much higher than Cost per Order, you have a delivery problem eating into your ad efficiency.

---

### 8. Pipeline

**What it is:** How many ad-attributed orders are currently "in progress" — placed but not yet delivered or failed. This includes orders that are: On Hold, Processing, Assigned to courier, Picked up, or Exchange pending.

**"Worth ৳X open" subtitle:** The total value of those pipeline orders.

**Why it matters:** This is money at risk. These orders haven't been collected yet. If pipeline is high relative to your delivered count, your fulfillment is slow. If pipeline value is high, that's future revenue that could still become delivered revenue — or get cancelled/returned.

---

## KPI Row 2 — Volume & Meta Engagement (the 4 smaller cards)

### 1. Purchases

**What it is:** Number of orders attributed to ads during this period.

**"X returned · Y cancelled" subtitle:** Breaks down how many of those orders failed. High return or cancellation rates relative to purchases suggest a problem with ad targeting, product quality, or fulfillment speed.

---

### 2. Link Clicks

**What it is:** How many times people clicked on your ads during this period.

**CTR subtitle:** Click-Through Rate — what percentage of people who saw your ad actually clicked it. Higher is better; industry benchmarks vary but 1–3% is typical for e-commerce.

---

### 3. Impressions

**What it is:** How many times your ads were shown to people during this period. One person seeing the same ad 3 times = 3 impressions.

**CPM subtitle:** Cost Per Mille (cost per 1,000 impressions). Shows how expensive your audience is to reach. Higher CPM means more competitive/expensive audience targeting.

---

### 4. CPC

**What it is:** Cost Per Click — how much you paid Meta on average for each click on your ads.

**"Meta results (pixel/leads)" subtitle:** This shows Meta's own reported conversion/lead count. This is from Meta's pixel tracking and may not match your app's purchase count — they measure different things. Meta's "results" could be any action Meta tracked (add to cart, form submission, purchase); your "purchases" are confirmed orders in your system.

---

## Charts

### 1. Performance Trend (Spend, Booked Revenue & Purchases)

**What it shows:** A daily line chart with three lines and one bar:

- **Blue line (Spend):** How much you spent on ads each day, in ৳.
- **Green line (Booked Revenue):** How much in orders came in each day from ads, in ৳.
- **Teal dashed line (Realized Revenue):** How much in *delivered* order value each day, in ৳.
- **Yellow bars (Purchases):** How many orders came in each day (count, read from the right axis).

**How to read it:**

- If the green line is consistently above the blue line, your ads are generating more in orders than they cost — good.
- If the blue line is above the green line, you're spending more than you're getting back — investigate.
- The gap between green and teal dashed shows how much revenue is still "in the pipeline" waiting to be delivered.
- The yellow bars show volume — a day with lots of purchases but low revenue means small orders; high revenue with few purchases means big orders.

**Why it matters:** Shows trends over time. A single bad day is noise; a week of declining revenue relative to spend is a problem.

---

### 2. ROAS Trend (Booked ROAS & Realized ROAS)

**What it shows:** Two lines tracking your return on ad spend each day:

- **Green line (Booked ROAS):** Orders placed value ÷ spend, per day.
- **Blue line (Realized ROAS):** Delivered value ÷ spend, per day.

**How to read it:**

- Booked ROAS will always be higher than or equal to Realized ROAS (because not all orders deliver).
- If the gap between them is large, many of your ad-generated orders are failing to deliver.
- If both lines are trending downward, your ads are becoming less efficient over time.
- If Booked ROAS is high but Realized ROAS is low, your ads are generating interest but something is going wrong in fulfillment.

**"Lag-aware" note:** Realized ROAS will look low on recent days because orders haven't had time to deliver yet. Don't panic if the last few days show low Realized ROAS — those numbers will improve as orders complete.

---

### 3. Ad Order Pipeline (horizontal bar chart)

**What it shows:** A snapshot of where all your ad-attributed orders are right now:

- **Placed:** Total orders from ads (all statuses).
- **In pipeline:** Orders currently being processed or shipped (On Hold, Processing, Courier assigned, Picked, Exchange pending).
- **Delivered:** Orders successfully completed.
- **Returned:** Orders that were returned by customers.
- **Cancelled:** Orders that were cancelled.

Each stage shows both a **count** (number of orders) and a **value** (total ৳ amount).

**How to read it:**

- A large "In pipeline" bar means many orders are in transit — good for future revenue, but watch for bottlenecks.
- A large "Returned" bar relative to "Delivered" is a red flag — your ad traffic might be low quality, or there's a product/fulfillment issue.
- "Placed" minus "Delivered" minus "Returned" minus "Cancelled" should roughly equal "In pipeline."

**Why it matters:** Shows the health of your order fulfillment funnel for ad-attributed orders specifically.

---

### 4. Recent Ad Orders (table)

**What it shows:** The last 10 orders that came from ads, with:

- **Order number** — clickable, takes you to the order detail page.
- **Status** — where the order is right now (On Hold, Processing, Delivered, etc.).
- **Campaign / Ad** — which Meta campaign and ad generated this order.
- **Total** — order value in ৳.

**Why it matters:** Builds trust that attribution is working. You can verify that real orders are being linked to ads. If this table is empty while you're running ads, your orders don't have `sourceAd` set.

---

## Campaign Tables

### Full Campaign Performance Table

**What it shows:** Every campaign with spend, purchases, revenue, and efficiency metrics:

| Column | Meaning |
|--------|---------|
| **Campaign** | Meta campaign name |
| **Spend** | How much this campaign cost in the date range |
| **Purchases** | Orders attributed to ads in this campaign |
| **Booked rev** | Total value of those orders (placed, any status) |
| **Realized** | Total value of *delivered* orders from this campaign |
| **Booked ROAS** | Booked revenue ÷ spend for this campaign |
| **Realized ROAS** | Realized revenue ÷ spend for this campaign |
| **CTR** | Click-through rate for this campaign's ads |
| **Delivery %** | What percentage of this campaign's orders actually delivered |

**Why it matters:** Shows which campaigns are making money and which are losing money. The full list lets you compare all campaigns, not just the extremes.

---

### Best 5 Campaigns (by booked revenue)

**What it shows:** Your top 5 campaigns ranked by how much order value they generated.

**Why it matters:** These are your winners. Consider increasing budget on these campaigns.

---

### Worst 5 Campaigns (high spend, low ROAS)

**What it shows:** Campaigns that spent the most but got the lowest return. Only shows campaigns with meaningful spend (filters out near-zero noise).

**Why it matters:** These are bleeding money. Consider pausing, reducing budget, or reworking the creative/targeting for these campaigns.

---

## Quick reference: what to look at for common questions

| Question | Look at |
|----------|---------|
| "Are my ads making money?" | Booked ROAS (short-term) and Realized ROAS (long-term) |
| "How much did I spend?" | Ad Spend card |
| "Which campaign is best?" | Best 5 campaigns table, or sort the full table |
| "Which campaign is wasting money?" | Worst 5 campaigns, or sort full table by ROAS ascending |
| "Why is Realized ROAS so low?" | Check the Pipeline card — orders might not have delivered yet |
| "Are orders actually coming from ads?" | Recent Ad Orders table + Purchases count |
| "Is my fulfillment healthy?" | Pipeline chart + Delivery % column in campaign table |
| "Should I increase ad spend?" | If Booked ROAS > 2x and Delivery % is high, probably yes |
| "Should I pause ads?" | If Booked ROAS < 1x over 7+ days, you're losing money |

---

## Exchange Rate (Settings → Meta Ads)

All money on the dashboard is shown in **৳ BDT**. If your Meta ad account uses a different currency (e.g. USD), the system converts spend to BDT using an exchange rate you configure in **Settings → Meta Ads → Ad account currency**.

Two modes are available:

### Fixed rate

You manually enter the exchange rate: "1 USD = 120 ৳". The system uses this number until you change it. Use this if you want full control or if the rate is stable.

### VAT-based rate

You enter a VAT/tax percentage (e.g. 7.5%). The system fetches the real-time market rate from a currency API and adds your VAT on top:

> Final rate = market rate × (1 + VAT ÷ 100)

Example: Market rate for USD → BDT is 118.95. VAT is 7.5%. Final rate = 118.95 × 1.075 = **127.87 ৳**.

The market rate auto-refreshes every 6 hours. Use this if you want the rate to stay current without manual updates.

---

## Metric Dictionary

| Metric | Formula | Window |
|--------|---------|--------|
| Spend | Sum of daily insights spend, converted to BDT | Selected range |
| Purchases | Count orders with sourceAd, order date in range | Selected range |
| Booked revenue | Sum of order totals for those purchases (BDT) | Selected range |
| Delivered count/value | Status Completed, order date in range (BDT) | Selected range |
| Booked ROAS | Booked revenue ÷ Spend (BDT) | Same range |
| Realized ROAS | Delivered value ÷ Spend (BDT) | Same range |
| CPA | Spend ÷ Purchases | Same range |
| Cost per delivered | Spend ÷ Delivered count | Same range |
| CTR | Clicks ÷ Impressions | Same range |
| CPC / CPM | From Meta insights, converted to BDT | Same range |
| Delivery rate | Delivered ÷ (Purchases − Cancelled) | Same range |
| Return rate | Returned ÷ Purchases | Same range |
| Pipeline value | Sum of totals for open attributed statuses | Snapshot (now) |
