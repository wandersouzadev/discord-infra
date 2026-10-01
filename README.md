# discord-infra

> **Declarative Infrastructure as Code (IaC) Manager for Discord servers.**

`discord-infra` treats your Discord server like Terraform or Kubernetes treats cloud infrastructure:

- **Desired state** is declared in Git using human-readable YAML files.
- **`plan`** calculates a deterministic diff against Discord's official REST API without side effects.
- **`apply`** provisions roles, categories, channels, and permissions in topological dependency order.
- **`verify`** detects drift between Git and live Discord state.
- **`export`** inspects an existing Discord server and generates Git-ready declarative YAML.
- **Built for AI Coding Agents** with `--json` output, structured logs, and full programmatic TypeScript API.

---

## Table of Contents

- [Prerequisites & Installation](#prerequisites--installation)
- [Discord Bot Setup Guide](#discord-bot-setup-guide)
  - [1. Create Discord Application](#1-create-discord-application)
  - [2. Configure Bot & Token](#2-configure-bot--token)
  - [3. Required Bot Permissions & Hierarchy](#3-required-bot-permissions--hierarchy)
  - [4. Invite Bot to Server](#4-invite-bot-to-server)
- [Environment Configuration](#environment-configuration)
- [Declarative Configuration Layout](#declarative-configuration-layout)
- [CLI Commands & Usage](#cli-commands--usage)
  - [Validate](#1-validate-configuration-offline)
  - [Plan](#2-plan-preview-changes)
  - [Apply](#3-apply-infrastructure-changes)
  - [Verify](#4-verify--drift-detection)
  - [Export](#5-export-existing-server)
- [Destructive Operations Guard](#destructive-operations-guard)
- [AI Agent & MCP Integration](#ai-agent--mcp-integration)
- [Documentation Reference](#documentation-reference)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [License](#license)

---

## Prerequisites & Installation

- **Bun**: `discord-infra` runs on Bun (version 1.1+).
- **TypeScript**: Strict mode enabled.
- **Node/OS**: Linux, macOS, or Windows (WSL recommended).

### Install Bun (if not already installed)

```bash
curl -fsSL https://bun.sh/install | bash
```

### Clone and Install Dependencies

```bash
git clone https://github.com/wandersouza/discord-agent.git
cd discord-agent
bun install
```

### Scripts

```bash
bun run dev          # Run CLI entrypoint
bun test             # Run Vitest test suite
bun run lint         # Run ESLint checks
bun run format       # Run Prettier formatter
bun run typecheck    # Run TypeScript compiler checks
```

---

## Discord Bot Setup Guide

### 1. Create Discord Application

1. Navigate to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** in the top right.
3. Enter an application name (e.g. `Discord Infra Bot`) and confirm.

### 2. Configure Bot & Token

1. Go to the **Bot** tab on the left sidebar.
2. Click **Add Bot** (or **Reset Token** if already added).
3. Copy the generated Bot Token immediately. **Keep it secure!**
4. Enable **Privileged Gateway Intents**:
   - `discord-infra` primarily uses the official REST API. Gateway intents are not required for standard REST operations.

### 3. Required Bot Permissions & Hierarchy

The bot needs sufficient permissions to manage resources on your server:

- **Minimal Recommended Permissions**:
  - `Manage Roles` (`MANAGE_ROLES`)
  - `Manage Channels` (`MANAGE_CHANNELS`)
  - `View Channels` (`VIEW_CHANNEL`)
- **Or Administrator**:
  - `Administrator` grants all permissions across the server.

> [!IMPORTANT]
> **Discord Role Hierarchy**:
> In Discord, a bot can **only manage roles positioned strictly lower than its own highest role**.
> After inviting your bot, open **Server Settings > Roles** in Discord and drag the Bot's managed role above any roles you want it to manage (e.g. below the Server Owner).

### 4. Invite Bot to Server

1. Go to the **OAuth2 > URL Generator** tab.
2. In **Scopes**, check `bot`.
3. In **Bot Permissions**, select `Manage Roles`, `Manage Channels`, `View Channels` (or `Administrator`).
4. Copy the generated URL at the bottom, paste it into your browser, select your target guild, and authorize the bot.

---

## Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_guild_id_here

# Optional
DISCORD_API_BASE_URL=https://discord.com/api/v10
LOG_LEVEL=info
```

> [!CAUTION]
> Never commit your `.env` file or bot token to source control. Anyone with your bot token has full control over your server within the bot's permissions.

---

## Declarative Configuration Layout

`discord-infra` uses a modular directory format (default: `discord/`):

```text
discord/
├── roles.yaml        # Role definitions, colors, hoist, mentionable
├── categories.yaml   # Category groupings and positions
├── channels.yaml     # Channels, category mapping, topic, slowmode
└── permissions.yaml  # Category and channel permission overwrites
```

### Example MMORPG Server Configuration

#### `discord/roles.yaml`

```yaml
roles:
  - name: GM
    color: "#9B59B6"
    hoist: true
    mentionable: true
    permissions:
      - view_channel
      - send_messages
      - manage_channels
      - manage_roles
      - manage_messages

  - name: MOD
    color: "#3498DB"
    hoist: true
    mentionable: true
    permissions:
      - view_channel
      - send_messages
      - manage_messages
```

#### `discord/categories.yaml`

```yaml
categories:
  - name: COMMUNITY
    position: 0
  - name: SUPPORT
    position: 1
  - name: STAFF
    position: 2
```

#### `discord/channels.yaml`

```yaml
channels:
  - name: welcome
    category: COMMUNITY
    type: text
    topic: "Welcome to the realm!"
    position: 0

  - name: support
    category: SUPPORT
    type: text
    topic: "General game help and assistance."
    slowmode: 5
    position: 0
```

#### `discord/permissions.yaml`

```yaml
permissions:
  COMMUNITY:
    "@everyone":
      view_channel: true
      send_messages: true

  STAFF:
    "@everyone":
      view_channel: false
    MOD:
      view_channel: true
      send_messages: true
      manage_messages: true
```

---

## CLI Commands & Usage

### 1. Validate Configuration (Offline)

Validate syntax, hex color formats, and referential integrity (checking that channels reference real categories and permissions reference real roles) without calling Discord:

```bash
bun run validate
# Or with JSON output:
bun run validate --json
```

### 2. Plan (Preview Changes)

Fetch current Discord state, compute the diff against desired state, and output the ordered operation plan:

```bash
bun run plan
# Or with machine-readable JSON:
bun run plan --json
```

Example plan output:

```text
Discord Infrastructure Plan
Guild: MMORPG Server (123456789012345678)

Roles
  + Create role: SUPPORT
  ~ Update role: MOD

Categories
  + Create category: DEVELOPMENT

Channels
  + Create #dev-chat
  ~ Move #reports -> SUPPORT

Permissions
  ~ Update permissions on STAFF

Summary:
  Create:      3
  Update:      2
  Delete:      0
  Destructive: 0
```

### 3. Apply (Infrastructure Changes)

Apply the plan in safe dependency order and verify results:

```bash
bun run apply
```

In automated CI environments:

```bash
bun run apply --yes
```

### 4. Verify & Drift Detection

Verify if live Discord server state matches your repository. Returns exit code `0` if in sync, `1` if drift exists:

```bash
bun run verify
# Or with JSON drift report:
bun run verify --json
```

### 5. Export Existing Server

Export an existing Discord server's roles, categories, channels, and permissions into Git-ready YAML files:

```bash
bun run export --output discord-export
# Or include Discord Snowflake IDs:
bun run export --output discord-export --include-ids
# Or into a single file:
bun run export --output discord-export --single-file
```

### 6. Wipe / Clear Channels

Safely purge channels and categories from Discord or configuration, protected by an explicit red warning banner and confirmation:

```bash
# Wipe only channels and categories defined in the local configuration:
bun run wipe

# Or wipe ALL channels and categories across the entire server:
bun run wipe --all

# Or only wipe channels, leaving categories intact:
bun run wipe --channels-only

# Preview targets first with dry-run mode:
bun run wipe --dry-run
```

---

## Destructive Operations Guard

Deleting channels, categories, or roles causes permanent loss of chat history and server configuration.

1. Any destructive operation is styled in bold red with `!` in the plan.
2. The CLI will **refuse** to apply deletions without the `--allow-destructive` flag:
   ```bash
   bun run apply --allow-destructive
   ```
3. In interactive terminals, the prompt requires explicitly typing `"DELETE"`:
   ```text
   WARNING: This plan contains 1 DESTRUCTIVE operation(s)!
   Type "DELETE" to confirm destructive changes:
   ```
4. In non-interactive CI pipelines, both `--allow-destructive` and `--yes` must be provided.

---

## AI Agent & MCP Integration

`discord-infra` is built to pair seamlessly with AI coding agents:

- **`--json` Flag**: Emits structured JSON for all major commands.
- **Stable Resource Identity**: AI agents modify logical names like `category: COMMUNITY` instead of hallucinating Discord Snowflakes.
- **Programmatic API**: Full programmatic access exported from `src/index.ts` (`getState`, `plan`, `apply`, `verify`, `exportInfrastructure`, `validate`).

---

## Documentation Reference

- [Architecture Guide](docs/architecture.md) — Deep dive into system layers, dependency sorting, and transactions.
- [Configuration Reference](docs/configuration.md) — Detailed YAML property definitions and options.
- [Permissions & Hierarchy](docs/permissions.md) — Comprehensive permission flag guide and role hierarchy rules.
- [Safety & Transaction Model](docs/safety.md) — Safety guards, halting on errors, and secret redaction.
- [AI Workflow & MCP Guide](docs/ai-workflow.md) — Autonomous agent loop and MCP tool schemas.

---

## Troubleshooting & FAQ

### `Discord API Error (401 [Code 0]): 401: Unauthorized`

- Verify that `DISCORD_BOT_TOKEN` in `.env` is correct and does not contain leading/trailing quotes or spaces.
- Ensure the token was not reset in the Discord Developer Portal.

### `Discord API Error (403 [Code 50013]): Missing Permissions`

- The bot lacks the required Discord permissions (e.g. `Manage Roles` or `Manage Channels`).
- Or the role being modified is positioned **above** the bot's highest role. Move the bot's role up in **Server Settings > Roles**.

### `Duplicate role name detected` or `references non-existent category`

- Run `bun run validate` to inspect referential integrity issues and syntax errors before planning.

---

## License

MIT © Wander Souza
