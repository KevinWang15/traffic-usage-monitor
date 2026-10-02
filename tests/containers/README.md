# Local notification container tests

From the repository root:

```bash
npm run test:containers
```

Docker Compose builds the actual production image and a builder image for checks. The stack includes a dedicated MySQL database (`traffic_notifications`), an HTTP webhook receiver, and a mock EngageLab HTTPS endpoint using a temporary local CA. The app and mocks have no external network route. The gateway exposes only loopback inspection ports.

The suite verifies authentication and ownership, all seven HTTP methods, substitution and URL encoding, valid JSON with quotes and newlines, raw bodies, default payloads, enabled and disabled targets, email delivery, independent failures, redirect rejection, timeouts, private-IP blocking, real agent traffic alerts, the missing-node sweep, suppression and cooldowns, backup compatibility, and persistence after restarting the production container. Unit tests and server type checks also run inside the checks container; both application builds run during the Docker build.

After success, the stack stays available for inspection:

- Dashboard: <http://localhost:24870>
- Webhook requests: <http://localhost:24871/__admin/requests>
- Email requests: <http://localhost:24872/__admin/requests>
- Local demo credentials and check report: `tests/containers/artifacts/report.json` (ignored by Git)

Override `CONTAINER_TEST_APP_PORT`, `CONTAINER_TEST_WEBHOOK_PORT`, or `CONTAINER_TEST_EMAIL_PORT` if needed. Each run creates fresh demo accounts, so it can reuse the database volume.

Stop containers while retaining test data:

```bash
docker compose -f tests/containers/compose.yaml down
```

Remove the dedicated test database and certificates as well:

```bash
docker compose -f tests/containers/compose.yaml down --volumes
```
