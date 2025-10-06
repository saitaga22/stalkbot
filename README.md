# Presence Stalker Bot

A Discord.js v14 bot that monitors a specific member's presence within a guild, logging status and activity changes with persistent storage powered by `quick.db`.

## Features

- `!monitor @user` — start tracking a member and stream updates to the bot owner's DMs.
- `!stopmonitor` — stop monitoring in the current guild.
- `!status` — show total active time, latest status, and the most recent logged activity.
- `!help` — display the available commands and what they do.
- Tracks status transitions (online / idle / do-not-disturb / offline) and rich presence activities (games, streams, etc.).
- Detects and announces custom status (activity type 4) changes, preserving them in the log history.
- Supports English (default) and Turkish output; switch with `!setlang en|tr` and all bot messages follow suit.
- Built-in Express keep-alive endpoint for free hosts—ping it from UptimeRobot (or similar) to keep the process awake.
- Stores logs and accumulated online time in SQLite via `quick.db`, preserving data through restarts.

## Requirements

1. **Discord Privileged Intent:** Enable **"Presence Intent"** (a.k.a. `GUILD_PRESENCES`) in your bot's Discord Developer Portal settings.
2. **Environment Variable:** Provide the bot token through `DISCORD_TOKEN` (or `BOT_TOKEN`).
3. **Node.js 18+** — required by Discord.js v14 and `better-sqlite3`.

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your token:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   The file should contain `DISCORD_TOKEN=your-bot-token`. Restart the bot after any changes.

3. (Optional) Override the keep-alive port by setting `KEEP_ALIVE_PORT` (defaults to `3000`).

4. Start the bot:

   ```powershell
   npm start
   ```

## Usage

- Run `!monitor @User` in a text channel to begin monitoring that member. The bot saves the guild configuration and delivers all notifications to the owner via DM.
- Use `!status` at any time to review the tracked totals and last activity snapshot.
- A keep-alive server listens on `http://<host>:<port>/` (defaults to port `3000`) and responds with JSON `{ status: "ok" }`. Configure a monitoring service such as UptimeRobot to ping this URL every 5 minutes to keep the bot awake. The `/health` path returns `204` and can also be used for lightweight probes.
- Custom statuses are announced automatically in the configured log channel (e.g. `💬 <@user> changed status: 'old' → 'new'`).
- Run `!stopmonitor` to clear the monitoring setup for the guild.
- Type `!help` to recall the command list inside Discord.
- Switch languages with `!setlang tr` (or `!setlang en` to return to English); existing logs continue to obey the selected locale.

All history is capped at the 200 most recent entries per user under `logs.{userId}`, while total accumulated active time lives under `accum.{userId}` in the SQLite database (`presence.sqlite`).

## File Overview

- `index.js` — Discord client setup, command handling, presence tracking, and persistence helpers.
- `keepAlive.js` — minimal Express server used for uptime pings.
- `presence.sqlite` — generated automatically at runtime to persist monitoring data.

## Troubleshooting

- **Needs presence intent:** If the bot never logs activity, ensure the Presence Intent is enabled in both the portal and the code (already configured in `index.js`).
- **Native build tools:** `better-sqlite3` may require build tools on Windows. Install the [Windows Build Tools](https://github.com/felixrieseberg/windows-build-tools) or the Desktop development with C++ workload if installation fails.
- **Permission errors:** `!monitor` and `!stopmonitor` require the **Manage Server** permission.

## License

ISC — see `package.json` for details.
