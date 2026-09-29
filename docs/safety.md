# Safety, Transaction Model, and Security

`discord-infra` is built around safety-first principles to prevent accidental outages, permission leaks, or destructive data loss on production Discord servers.

---

## 1. Destructive Operations Guard

Deleting channels, categories, or roles causes permanent loss of message history, permissions, and member assignments. Therefore:

- **No Silent Deletions**: Deletion operations are flagged with a prominent `!` symbol and red styling.
- **Explicit Flag Requirement**: The CLI will refuse to execute any plan containing deletions unless `--allow-destructive` is passed.
- **Interactive Affirmation**: In interactive terminals, even with `--allow-destructive`, the user must explicitly type `"DELETE"`:
  ```text
  WARNING: This plan contains 1 DESTRUCTIVE operation(s)!
  Type "DELETE" to confirm destructive changes:
  ```
- **Non-Interactive / CI Guard**: In CI/CD pipelines (when `stdin` is not a TTY), destructive operations are rejected unless **both** `--allow-destructive` and `--yes` are explicitly supplied.

---

## 2. Safe Execution & Transaction Model

Discord REST endpoints do not offer multi-resource database transactions. Operations succeed or fail individually.

`discord-infra` handles this reality with a strict execution engine:

1. **Topological Dependency Sorting**:
   - Roles are created before channels reference them.
   - Categories are created before channels are moved into them.
   - Channel permissions are applied after both target channels and roles exist.
2. **Dynamic Snowflake Resolution**:
   - When a category or role is created, its generated Snowflake is captured and forwarded to all subsequent operations.
3. **Immediate Halt on Failure**:
   - If any HTTP request fails (e.g. rate limit exhaustion, missing permission, network failure), execution **stops immediately**.
   - No subsequent operations are attempted.
4. **Honest Reporting**:
   - The engine reports exactly what succeeded, what failed, and what was left untouched.
   - Rollback is never claimed unless an actual compensation transaction was executed.

---

## 3. Secret Sanitization

The Discord Bot Token (`DISCORD_BOT_TOKEN`) possesses full control over server resources granted to that bot.

- **Automatic Secret Redaction**: The internal `Logger` and error normalization layers redact registered tokens and pattern-matched Discord tokens from:
  - Error stack traces
  - Terminal logs
  - JSON outputs
  - Plan diffs
  - Exported YAML files
- **Never Commit Secrets**:
  - `.env` is listed in `.gitignore`.
  - Use `.env.example` to document required environment variables.
