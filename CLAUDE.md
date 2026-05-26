# ATT Profit Shield - System Architecture

## Tech Stack
- Framework: Next.js (App Router, TypeScript)
- Database/Auth: Supabase (PostgreSQL)
- Analytics UI: Tailwind CSS + Shadcn/ui + Recharts (for financial data streams)
- Data Feeds: FRED API (Inflation) + Teller.io (Banking API)

## Database Schema Goals
- `users`: Track business profiles, current target profit margins.
- `expenses`: General banking transaction buckets (Rent, Software, etc.).
- `material_costs`: Line-item tracking for raw components (e.g., "Stainless Steel") with user-updated baseline costs and associated FRED PPI commodity mapping codes.
- `predictive_snapshots`: 30, 60, and 90-day forward forecasts calculating expected cost increases using historical vendor patterns combined with macro price trajectories.

## Build & Test Rules
- Run Dev: `npm run dev`
- Build Check: `npm run build`