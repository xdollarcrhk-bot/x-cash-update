# X CASH UPDATE Backend + Admin Dashboard (starter)

This is an original starter implementation for X CASH UPDATE. It includes user registration/login, manual ₦3,000 membership payment submission and admin review, task creation, task submissions and approval/reward ledger, and withdrawal requests with admin review.

## Requirements
- Node.js 20+ recommended
- Install: `npm install`
- Copy `.env.example` to `.env`, then set strong values for `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
- Run: `npm start`
- Open `http://localhost:3000` for the API host; admin page: `http://localhost:3000/admin.html`

## Current payment instructions configured in the frontend prototype
Moniepoint — 8105288452 — CHINEDU DAVID MAMAH. This backend intentionally does not verify bank transfers automatically. Admin reviews each payment submission and activates the member only after independently confirming the funds have arrived.

## Admin capabilities
- Review and approve/reject membership payments
- Approved membership payments activate user status
- Publish, pause, and resume earning tasks
- Review submissions; approval credits a wallet ledger
- View members and withdrawal requests
- Mark withdrawal as paid only after actual transfer; rejection returns reserved funds to member ledger

## Important deployment steps before production
1. Use HTTPS and a production session secret. Set `NODE_ENV=production`.
2. Replace the default admin password; create a dedicated secure admin account. Do not use the sample credentials.
3. Use a managed database and persistent storage/backups; SQLite file is starter-only.
4. Add CSRF protection, email verification, password reset, audit logs, admin MFA, and account lockout.
5. Define and publish clear earning-task eligibility, reward funding, fees/refunds, minimum withdrawals, processing times, privacy policy, and terms.
6. Review Nigerian legal, consumer-protection, tax, data-protection, and payment-provider requirements with qualified professionals.
7. Do not promise guaranteed income. Only advertise tasks and rewards funded and realistically payable.
8. Protect bank details; this starter stores them in the local database and requires access control, encryption at rest, retention policies, and secure hosting before production.

## API outline
- `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `POST /api/payment-submission`
- `GET /api/tasks`, `POST /api/tasks/:id/submit`
- `POST /api/withdrawals`
- Admin: `GET /api/admin/summary`, `/payments`, `/tasks`, `/submissions`, `/withdrawals`, `/members`, `/ledger`
- Admin POST routes for approval/rejection, task creation/toggle, and withdrawal processing

This is a starter project, not a production-ready payment or rewards service. It does not automatically read bank transfers or send payouts.

\n## User-facing member portal\nA basic portal is served at `/` with register/login, activation-payment submission, task submissions, wallet view, and withdrawal request form. Admin panel at `/admin.html`.\n\n## Render deploy\nThe included `render.yaml` is configured with a paid Starter web service and persistent disk to avoid losing SQLite data. Push this folder to a GitHub repository, connect it to Render as a Blueprint, then provide `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in Render's environment prompt. Do not deploy using the sample admin password.\n