# Deploying Tamasha (Khooni Sawaal)

The app is one Docker image: the Node server serves the built SPA statically
and handles the WebSocket game protocol. It needs a host with WebSocket support
in/near India (ap-south-1 / Mumbai).

## Recommended: Fly.io (config included as `fly.toml`)
1. Install flyctl and log in: `fly auth login` (or `fly auth token <TOKEN>`).
2. First time: `fly launch --copy-config --no-deploy` (creates the app; keep
   the app name/region in `fly.toml`).
3. `fly deploy` — builds the Dockerfile, ships to Mumbai (`bom`), returns a
   public HTTPS URL (WebSockets work over it natively).
4. Open `https://<app>.fly.dev/host` on a TV/laptop; players join at
   `https://<app>.fly.dev/` with the room code.

## Alternatives
- **Railway / Render:** point at this repo + Dockerfile; expose port 8787;
  set env `STATIC_DIR=/app/packages/client/dist`. Both support WebSockets.
- **AWS:** App Runner or ECS Fargate + ALB (ALB does WebSockets) from an ECR
  image built from this Dockerfile; region `ap-south-1`.

## Health
`GET /healthz` → `{"ok":true}` for the load balancer.
