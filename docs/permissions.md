# Discord Permissions & Role Hierarchy Guide

Permissions in Discord are computed using 64-bit bitfields and hierarchical evaluation rules. `discord-infra` abstracts this complexity into deterministic declarative structures while preserving Discord's underlying security guarantees.

---

## 1. Supported Permission Flags

All permission names are snake_case strings corresponding to official Discord API flags:

| Flag Name                  | Description                                                  |
| :------------------------- | :----------------------------------------------------------- |
| `view_channel`             | Allows viewing channels and reading channel history          |
| `send_messages`            | Allows sending messages in channels                          |
| `send_messages_in_threads` | Allows sending messages in threads                           |
| `manage_channels`          | Allows creating, editing, and deleting channels              |
| `manage_roles`             | Allows creating and editing roles lower than the user's role |
| `manage_messages`          | Allows deleting or pinning other users' messages             |
| `embed_links`              | Allows embedding rich link cards                             |
| `attach_files`             | Allows uploading files and images                            |
| `read_message_history`     | Allows reading message history                               |
| `mention_everyone`         | Allows @everyone and @here mentions                          |
| `use_external_emojis`      | Allows using emojis from other servers                       |
| `add_reactions`            | Allows adding new reactions to messages                      |
| `connect`                  | Allows joining voice channels                                |
| `speak`                    | Allows speaking in voice channels                            |
| `mute_members`             | Allows server-muting members in voice                        |
| `deafen_members`           | Allows server-deafening members in voice                     |
| `move_members`             | Allows moving members between voice channels                 |
| `administrator`            | Implicitly grants all server permissions                     |
| `kick_members`             | Allows kicking lower-ranking members                         |
| `ban_members`              | Allows banning lower-ranking members                         |
| `moderate_members`         | Allows timing out members                                    |

---

## 2. Discord's Role Hierarchy Rules

Discord enforces a strict mathematical role hierarchy across all guild operations:

```text
Server Owner (Bypasses all hierarchy checks)
  ▲
  │   Position 10: Bot's Highest Role
  │
  ├── Position 9: Manageable by Bot  ✓
  ├── Position 5: Manageable by Bot  ✓
  ├── Position 1: Manageable by Bot  ✓
  ▼
  @everyone (Position 0: Permissions manageable, cannot be deleted)
```

### The Cardinal Rule

> **A bot can ONLY manage roles positioned strictly lower than its own highest assigned role.**

1. **Role Editing & Deletion**:
   - If `role.position >= bot.highestRole.position`, Discord returns HTTP 403 `50013: Missing Permissions`.
   - `discord-infra` inspects the bot's membership on startup and warns/fails during `plan` before an unauthorized API call can be executed.

2. **Role Reordering**:
   - A bot cannot move any role to a position equal to or higher than its own highest role.

3. **Managed Integration Roles**:
   - Roles automatically generated for bots or Nitro Boosters (`role.managed == true`) cannot be edited or deleted by other bots.

4. **The `@everyone` Role**:
   - `@everyone` is always at position `0` and shares its snowflake ID with the Guild ID.
   - It cannot be deleted or renamed.
   - Its base permissions can be updated if the bot possesses `MANAGE_ROLES`.

---

## 3. Permission Overwrite Resolution

Discord resolves effective channel permissions in this order:

1. **Base Permissions**: Derived from `@everyone` and all roles assigned to the user.
2. **Category Denials**: Any `false` overwrite on the parent category overrides base permissions.
3. **Category Allows**: Any `true` overwrite on the parent category overrides category denials.
4. **Channel Denials**: Any `false` overwrite on the channel overrides category permissions.
5. **Channel Allows**: Any `true` overwrite on the channel overrides all previous rules.

### Tri-State System in `discord-infra`

- `true` (`allow` bitfield): Explicitly granted permission.
- `false` (`deny` bitfield): Explicitly blocked permission.
- Unspecified: Neutral state, allowing inheritance from parent category or server base.
