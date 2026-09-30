# Running a small self-hosted Git server

This guide walks through setting up a **self-hosted Git server** for a team of five to twenty people. It assumes a single Linux machine with a public IP and about 20 GB of free disk space.

## Why self-host at all

Hosted services are convenient, but some teams need to keep source code on hardware they control. Common reasons include:

- Contracts that forbid storing code with third parties.
- Air-gapped networks with no route to the internet.
- A wish to avoid per-seat pricing as the team grows.

If none of these apply, a hosted service is almost always the cheaper choice once you count the hours spent on maintenance.

## Choosing the software

There are three realistic options for a team this size:

| Option | Web UI | Memory | Notes |
| --- | --- | --- | --- |
| Plain SSH + Git | None | ~0 MB | No pull requests, no issue tracker |
| Gitea | Yes | ~150 MB | Single binary, easy upgrades |
| GitLab CE | Yes | ~4 GB | Built-in CI, heavy to run |

For most small teams, **Gitea** hits the sweet spot: it has pull requests and issues, but it runs comfortably on a two-core virtual machine.

## Preparing the machine

Create a dedicated user so the server never runs as root:

```bash
sudo adduser --system --group --home /srv/git git
sudo mkdir -p /srv/git/{data,repos}
sudo chown -R git:git /srv/git
```

Then open only the ports you need. Git over SSH uses port 22, and the web UI will sit behind a reverse proxy on 443.

## Installing Gitea

Download the release binary, verify its checksum, and install it as a systemd service. Keep the binary under `/usr/local/bin` so upgrades are a single file swap.

1. Download the binary for your architecture.
2. Compare its SHA-256 sum with the one on the release page.
3. Copy the sample unit file into `/etc/systemd/system/`.
4. Run `systemctl enable --now gitea`.

When the service starts for the first time, the web installer asks for a database. SQLite is fine for twenty users; switch to PostgreSQL only if you see lock contention.

## Putting it behind HTTPS

Never expose the web UI over plain HTTP. A reverse proxy such as Caddy obtains and renews certificates on its own:

```text
git.example.com {
    reverse_proxy localhost:3000
}
```

After reloading the proxy, visit the site and confirm the padlock appears before inviting anyone.

## Backups

A Git server without backups is a single point of failure. Gitea ships a `dump` command that writes the database, repositories, and configuration into one archive.

- Run the dump **nightly** from a cron job.
- Copy the archive to a second machine or object storage.
- Keep at least **seven daily** and **four weekly** copies.

> A backup you have never restored is only a hope. Restore one to a scratch machine every quarter.

## Upgrades

Read the release notes before every upgrade, especially the sections marked *breaking*. The usual routine is short: stop the service, take a dump, swap the binary, and start the service again. If the web UI shows a migration notice, let it finish before anyone pushes.

## When to move on

Self-hosting stops paying off when the server needs more attention than the code it stores. Signs that it is time to reconsider:

- You spend more than an afternoon a month on maintenance.
- The team needs CI runners you cannot provide.
- Nobody on the team wants to be on call for the server.

At that point, migrating to a hosted service is usually a one-day job, since every option imports plain Git repositories.
