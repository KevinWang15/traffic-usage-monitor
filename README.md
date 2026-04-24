# Traffic Usage Monitor

A central server + Linux host agent application bootstrapped from `KevinWang15/bootstrap-new-app`.

The project keeps the same scaffold shape:

- `client`: Vite + React + TypeScript + Tailwind dashboard
- `server`: Node.js + Express + TypeScript + Prisma central API
- `shared`: frontend/backend shared constants and DTO types
- `agent`: dumb Linux shell agent installed by command from the dashboard
- `run.sh`: local development launcher
- `k3s/Dockerfile.multistage`: production container build

## What it does

- Users can sign up, log in, and obtain a Linux install command tied to their account join token.
- Hosts run a dumb Linux-only agent that reads `/proc/net/dev` counters, like vnStat-style interface accounting, and reports raw totals to the central server.
- The central server owns traffic allowance, reset cycle, metering mode, manual corrections, and alert policy.
- Per-host allowance, reset period/date, metering type, alert threshold override, and agent poll interval are configurable centrally.
- Users can manually correct remaining traffic for a host.
- Reset checks run every minute. For each host, the server normalizes the current UTC time to the configured cycle start and stores that cycle identifier in the database to avoid duplicate resets.
- Alerts are emailed to the account email address when remaining traffic falls below the threshold. Alerts are throttled per host to at most one email every 3 hours.
- Email delivery uses the provided EngageLab `sendEmail` implementation.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   npm install --prefix server
   npm install --prefix client
   ```

2. Copy and edit env:

   ```bash
   cp .env.sample .env
   ```

   Required values:

   - `DATABASE_URL`: MySQL URL for Prisma
   - `JWT_SECRET`: long random secret
   - `PUBLIC_URL`: public URL for the central server. In local Vite dev this can stay `http://localhost:5173`; in production set it to your HTTPS origin.
   - `ENGAGE_LAB_USERNAME`, `ENGAGE_LAB_API_KEY`, `ENGAGE_LAB_FROM_EMAIL`: required to send alert email.

3. Generate Prisma client and create tables:

   ```bash
   npm run prisma:generate --prefix server
   npm run prisma:migrate --prefix server -- --name init
   ```

4. Run locally:

   ```bash
   ./run.sh
   ```

   Frontend: <http://localhost:5173>

   Backend: <http://localhost:3000/api/health>

## Join a Linux host

After signing in, copy the command from the dashboard. It looks like:

```bash
curl -fsSL 'https://your-central.example.com/api/agent/install.sh' | sudo bash -s -- --server 'https://your-central.example.com' --token '<account-token>'
```

The installer writes `/etc/traffic-usage-agent/config`, downloads `/usr/local/bin/traffic-usage-agent`, joins the central server, and enables `traffic-usage-agent.service` through systemd.

Useful agent commands:

```bash
sudo traffic-usage-agent join
sudo traffic-usage-agent report
sudo systemctl status traffic-usage-agent.service
sudo journalctl -u traffic-usage-agent.service -f
```

## Reset cycle algorithm

For every host, every minute, the server computes:

```text
cycleId = <period>:<normalized-cycle-start-utc-iso>
```

The normalized start is the latest configured cycle boundary not after `now`:

- Daily: current/previous day at `resetHourUtc:resetMinuteUtc`
- Weekly: configured `resetDayOfWeek` at `resetHourUtc:resetMinuteUtc`
- Monthly: configured `resetDayOfMonth` at `resetHourUtc:resetMinuteUtc`, clamped to month length
- Yearly: configured `resetMonth` and `resetDayOfMonth`, clamped to month length

If `cycleId` differs from `Host.lastResetCycleId`, the server records a `ResetEvent`, resets `usedBytes` to `0`, sets `remainingBytes` to `trafficAllowanceBytes`, and stores the new identifier.

## Metering behavior

The agent reports absolute RX/TX byte counters. The server stores the previous counters per interface and computes deltas. On counter rollover or reboot, it treats the current counter value as the delta since reset. The first sample initializes the baseline and does not charge historical traffic before monitoring began.

Supported metering types:

- `EGRESS_ONLY`: only TX deltas are charged.
- `INGRESS_AND_EGRESS`: RX + TX deltas are charged.

## Production notes

- Put the server behind HTTPS before installing agents over the network.
- Set `PUBLIC_URL` to the external HTTPS origin so dashboard install commands point at the reachable central server.
- Use a strong `JWT_SECRET`.
- Rotate the account join token if it leaks. Existing agents keep working because they use per-host agent keys after joining.
- Run Prisma migrations during deploy before starting the application.

## API sketch

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/account/join-command`
- `PATCH /api/account`
- `POST /api/account/join-token/rotate`
- `GET /api/hosts`
- `PATCH /api/hosts/:id`
- `POST /api/hosts/:id/correct-remaining`
- `POST /api/agent/join`
- `POST /api/agent/report`
- `GET /api/agent/install.sh`
- `GET /api/agent/traffic-agent.sh`
