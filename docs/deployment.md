# GitHub and live hosting

## Current status

The local project is a Git repository. No GitHub remote or public URL has been created for this first playable milestone. This keeps account ownership and hosting choices open for the next step.

## GitHub preparation

1. Review the playable game and documentation.
2. Configure your Git author name and email if desired. An initial local commit may use a neutral project identity if no account identity was configured.
3. Create a private repository under your own GitHub account, using the connected GitHub tools or the GitHub website. Do not initialize it with an unrelated README.
4. Add that repository as a remote and push the local history.
5. Confirm the configured workflow passes on GitHub.
6. Add a license of your choice before inviting reuse; no license has been selected on your behalf.
7. Add the live URL, tested-device notes, and final screenshots before making it public.

Do not commit environment files, session tokens, or credentials. The repository includes `.gitignore` and an example environment file.

## Hosting requirements

Use a service that runs a long-lived Node process or the included Docker container. Static-only hosting is insufficient. Run **one instance** for this in-memory version, with HTTPS and streaming response buffering disabled for `/api/events`.

- Start command: `npm start`
- Runtime: Node 22 or newer
- Health endpoint: `/health`
- Bind address: `0.0.0.0`
- Port: set `PORT` to the host’s assigned value
- Origin: set `PUBLIC_ORIGIN` to the full public origin, for example `https://your-game.example.com`, without a trailing slash

The host should allow SSE connections longer than one round and should not cache `/api/*`. Configure access logs to redact the `session` query parameter. A deployment restart ends any active in-memory games.

## Optional Docker route

```sh
docker build -t pool-party .
docker run --rm -p 3000:3000 pool-party
```

These commands are provided for portability; the image has not been built or run in this session.

## Launch verification

Open the public URL on two independent physical devices. Create and join a room. Confirm both receive bids and timers. Reproduce the 100-point miss / 70-point correct scoring example. Exercise a bonus miss and check that the remaining player gets a fresh question. Refresh one device, test a host disconnect, and complete all eight rounds.

Public hosting can involve an account, billing, or plan choice. Resolve those using the owner’s account before claiming a live deployment.
