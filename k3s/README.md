# k3s deployment

1. Copy `k3s/.env.example` to `k3s/.env`.
2. Set `DEPLOYMENT_IMAGE`, `PUBLIC_URL`, `JWT_SECRET`, MySQL passwords, and EngageLab email settings.
3. Make sure your cluster can pull the image. If the image is private on GHCR, set `DEPLOYMENT_IMAGE_PULL_SECRET`, `GHCR_USERNAME`, and `GHCR_TOKEN`.
4. Run `./k3s/deploy.sh`.

`deploy.sh` creates a MySQL instance in the same namespace by default, waits for it to become ready, runs Prisma migrations as an init container, and deploys the app against that in-cluster database. If `DATABASE_URL` is empty, the script generates it from the `MYSQL_*` settings in `k3s/.env`.

The deployment script supports:

- `./k3s/deploy.sh deploy`
- `./k3s/deploy.sh status`
- `./k3s/deploy.sh logs`
- `./k3s/deploy.sh restart`
- `./k3s/deploy.sh delete`
- `./k3s/deploy.sh render`

`deploy.sh` loads environment variables from the repo root `.env` and then `k3s/.env`, so k3s-specific overrides can live under `k3s/`.

`delete` removes the app deployment resources and MySQL StatefulSet, but leaves MySQL PVCs intact so database data is not destroyed by default.

Set `PUBLIC_URL` to the external HTTPS origin users and agents can reach. Dashboard Linux install commands use this URL.
