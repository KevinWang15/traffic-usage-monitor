# Traffic Usage Monitor

A central server + Linux host agent application for monitoring per-node traffic usage and allowance.

Repository layout:

- `client`: Vite + React + TypeScript + Tailwind dashboard
- `server`: Node.js + Express + TypeScript + Prisma central API
- `shared`: frontend/backend shared constants and DTO types
- `agent`: lightweight Linux shell agent installed by command from the dashboard
- `run.sh`: local development launcher
- `k3s/Dockerfile.multistage`: production container build

## What it does

- Users can sign up, log in, and obtain a Linux install command tied to their account join token.
- New accounts must verify their email address before logging in.
- Users can request password reset links by email when they forget their password.
- Hosts run a lightweight Linux-only agent that reads `/proc/net/dev` counters, like vnStat-style interface accounting, and reports raw totals to the central server.
- The central server owns traffic allowance, reset cycle, metering mode, manual corrections, and alert policy.
- Per-host allowance, reset period/date, metering type, alert threshold override, and agent poll interval are configurable centrally.
- The server stores each host's agent-reported public IPv4 during join/report and can auto-detect country from a local MaxMind database.
- Users can manually correct remaining traffic for a host.
- Reset checks run every minute. For each host, the server normalizes the current UTC time to the configured cycle start and stores that cycle identifier in the database to avoid duplicate resets.
- Traffic allowance and missing-node alerts can be delivered to the account email address and multiple configurable webhooks. Alerts retain their separate per-host 3-hour cooldowns.
- Traffic alerts can be ignored after traffic has been switched away. The ignore marker suppresses notifications until used traffic increases by another 1 percentage point of the allowance, or until the next reset cycle clears it.
- Email delivery uses the provided EngageLab `sendEmail` implementation.

## Notifications

Open **Notifications** in the dashboard sidebar to enable or disable monitoring emails, manage webhook targets, send tests to one target or all enabled targets, and inspect delivery history. Verification and password reset messages always use email. The existing **Install → Send test email** button tests email delivery independently of the monitoring email toggle.

Webhook targets support GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS, custom headers as a JSON object, and an optional JSON or plain-text body template. GET and HEAD send no body. A blank template sends a JSON object containing `app`, `purpose`, `subject`, `html`, `text`, `shortText`, `details`, and `requestedAt`. Purposes are `TEST`, `TRAFFIC_ALERT`, and `MISSING_HOST`. Alert text includes the host's IP address and notes.

Use these variables in URLs, header values, and body templates:

| Variable | Value |
| --- | --- |
| `$SUBJECT` | Notification title |
| `$TEXT` | Full plain-text alert |
| `$SHORT_TEXT` | Brief alert including the host IP |
| `$HTML` | HTML alert |
| `$PURPOSE` | Notification purpose |
| `$DETAILS` | Host label, hostname, and IP, separated by commas |
| `$TIMESTAMP` | ISO timestamp of the notification request |

For example, use `https://notify.example.com/send?message=$SHORT_TEXT` for a GET webhook, or `{"text":"$TEXT"}` as a POST body. Each variable substituted in a URL is encoded with `encodeURIComponent`, preserving literal query parameters. For JSON body templates, variables in string values are expanded after parsing so quotes, newlines, and backslashes are escaped correctly. Plain-text bodies and header values use raw substitution. Unknown variables are left unchanged.

Deliveries run independently, with up to five requests at once. Successful delivery to any enabled target advances the traffic alert cooldown. Missing-node delivery attempts retain the existing cooldown after success or failure. With no enabled targets, no delivery is attempted. Failures appear in delivery history; webhook requests have a ten-second deadline and do not follow redirects.

Webhook destinations must use HTTP or HTTPS without embedded credentials or URL fragments. Private and reserved destination addresses are blocked by default, including DNS results. Set `WEBHOOK_ALLOW_PRIVATE_IPS=true` to reach an internal receiver. This setting is available in `.env.sample` and the k3s configuration.

Configuration exports include the email toggle and webhook settings. Older backups without these fields keep the current notification settings when imported. Run `npx prisma migrate deploy` in `server` when deploying the new database migration.

## Container verification

Run `npm run test:containers` to build the production image and run unit, type, integration, and restart persistence checks against local MySQL, an HTTP webhook receiver, and an HTTPS mock EngageLab provider. The application and mocks use an internal Docker network; tests do not call external notification services. See [the container test instructions](tests/containers/README.md) for inspection URLs and cleanup.

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

   Key values:

   - `DATABASE_URL`: MySQL URL for Prisma
   - `JWT_SECRET`: long random secret
   - `PUBLIC_URL`: public URL for the central server. In local Vite dev this can stay `http://localhost:5173`; in production set it to your HTTPS origin.
   - `TRUST_PROXY`: optional Express trust proxy setting. Leave `false` for direct connections; set a hop count or trusted proxy subnet when the app is behind a reverse proxy and should use forwarded client IP headers.
   - `GEOIP_MMDB_PATH`: optional path to a local MaxMind GeoLite2/GeoIP2 Country `.mmdb` file. When unset, the server uses the bundled `server/geoip/GeoLite2-Country.mmdb`.
   - `LOG_AGENT_IP_DEBUG`: optional `true`/`false` request IP diagnostics for agent join/report.
   - `ENGAGE_LAB_USERNAME`, `ENGAGE_LAB_API_KEY`, `ENGAGE_LAB_FROM_EMAIL`: required for verification, password reset, test, traffic alert, and missing-node emails.

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
- Set `PUBLIC_URL` to the external HTTPS origin so dashboard install commands, verification links, and password reset links point at the reachable central server.
- Public IP tracking comes from the agent's self-reported public IPv4 on join/report. The agent queries `ifconfig.info` over IPv4 first, then falls back to other public-IP endpoints. This keeps the dashboard accurate when agents reach the server through a relay. `TRUST_PROXY` only affects diagnostic request-IP logging and unrelated Express behavior.
- Country auto-detection uses the bundled MaxMind Country `.mmdb` file. Set `GEOIP_MMDB_PATH` only if you want to override it with another database. In k3s, `DEPLOYMENT_GEOIP_MMDB_HOST_PATH` can mount a host-side replacement at that container path. Hosts also support a manual country override for ranges where databases disagree with the observed service location.
- Use a strong `JWT_SECRET`.
- Rotate the account join token if it leaks. Existing agents keep working because they use per-host agent keys after joining.
- Run Prisma migrations during deploy before starting the application.

## Updating existing agents

To update an existing node's agent script without changing its identity, replace only the script and keep `/etc/traffic-usage-agent/config` intact. That config contains the existing `AGENT_ID` and `AGENT_KEY`.

```bash
. /etc/traffic-usage-agent/config

sudo curl -fsSL "$SERVER_URL/api/agent/traffic-agent.sh" \
  -o /usr/local/bin/traffic-usage-agent

sudo chmod 755 /usr/local/bin/traffic-usage-agent
sudo systemctl restart traffic-usage-agent
```

Do not rerun the full install command unless the node should rejoin. The next report will use the existing credentials and send the current self-reported public IPv4.

## API sketch

- `GET /api/health`
- `GET /api/config`
- `GET /api/metrics`
- `POST /api/auth/signup`
- `POST /api/auth/verify-email`
- `POST /api/auth/verification-email/resend`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/me`
- `GET /api/account/join-command`
- `PATCH /api/account`
- `POST /api/account/join-token/rotate`
- `POST /api/account/test-email`
- `GET /api/notifications/settings`
- `PUT /api/notifications/email`
- `POST /api/notifications/webhooks`
- `PUT /api/notifications/webhooks/:id`
- `DELETE /api/notifications/webhooks/:id`
- `POST /api/notifications/test`
- `POST /api/notifications/webhooks/:id/test`
- `GET /api/notifications/history`
- `GET /api/hosts`
- `GET /api/hosts/:id`
- `PATCH /api/hosts/:id`
- `DELETE /api/hosts/:id`
- `POST /api/hosts/:id/correct-remaining`
- `POST /api/hosts/:id/suppress-traffic-alert`
- `POST /api/hosts/:id/suppress-missing-alert`
- `GET /api/hosts/:id/samples`
- `POST /api/agent/join`
- `POST /api/agent/report`
- `GET /api/agent/install.sh`
- `GET /api/agent/traffic-agent.sh`
