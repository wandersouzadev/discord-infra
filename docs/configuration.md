# Declarative Configuration Reference

`discord-infra` uses YAML files to define the desired state of your Discord server.

Configurations can be organized in either of two layouts:

1. **Multi-File Directory (Recommended)**:

   ```text
   discord/
   ├── roles.yaml
   ├── categories.yaml
   ├── channels.yaml
   └── permissions.yaml
   ```

2. **Single File**:
   ```text
   discord.yaml
   ```

---

## 1. Stable Resource Identity

Resources are identified primarily by **logical names** rather than Discord Snowflakes (IDs):

- **Roles**: Identified by `name` (case-insensitive during reconciliation).
- **Categories**: Identified by `name` (case-insensitive).
- **Channels**: Identified by `name` within their parent `category`.

### Optional `discord_id`

When importing pre-existing servers or handling disambiguation, you may provide an explicit `discord_id`:

```yaml
roles:
  - name: MOD
    discord_id: "123456789012345678"
    color: "#3498DB"
```

If provided, the planner resolves the resource using this exact snowflake before falling back to logical names.

---

## 2. Roles Configuration (`roles.yaml`)

Defines guild roles, visual styling, ordering, and default permissions.

```yaml
roles:
  - name: GM
    color: "#9B59B6" # Hex color code (#RRGGBB) or integer
    hoist: true # Display separately in member list
    mentionable: true # Allow anyone to @mention this role
    position: 10 # Desired hierarchy position (optional)
    permissions: # List of base permission flags
      - view_channel
      - send_messages
      - manage_channels
      - manage_roles
      - manage_messages

  - name: MOD
    color: "#3498DB"
    hoist: true
    mentionable: false
    permissions:
      - view_channel
      - send_messages
      - manage_messages
```

### Supported Properties:

- `name` _(string, required)_: 1-100 characters.
- `color` _(hex string | number, optional)_: Role color, e.g. `"#E74C3C"`.
- `hoist` _(boolean, optional)_: Default `false`.
- `mentionable` _(boolean, optional)_: Default `false`.
- `position` _(integer, optional)_: Target position in role hierarchy.
- `permissions` _(string[], optional)_: Array of valid Discord permission names.

---

## 3. Categories Configuration (`categories.yaml`)

Defines category groupings for channels.

```yaml
categories:
  - name: COMMUNITY
    position: 0

  - name: SUPPORT
    position: 1

  - name: DEVELOPMENT
    position: 2

  - name: STAFF
    position: 3
```

### Supported Properties:

- `name` _(string, required)_: Category title.
- `position` _(integer, optional)_: Category sorting position.
- `discord_id` _(string, optional)_: Explicit Discord category channel ID.

---

## 4. Channels Configuration (`channels.yaml`)

Defines channels and their category associations.

```yaml
channels:
  - name: welcome
    category: COMMUNITY
    type: text
    topic: "Read the rules before entering."
    position: 0

  - name: support
    category: SUPPORT
    type: text
    topic: "Ask for player help here."
    position: 0
    slowmode: 5 # Rate limit in seconds per user (0 to 21600)
```

### Supported Properties:

- `name` _(string, required)_: Channel name (1-100 characters).
- `category` _(string, optional)_: Must match a name declared in `categories.yaml`.
- `type` _(string, optional)_: `"text"` (default), `"voice"`, `"announcement"`, or `"forum"`.
- `topic` _(string, optional)_: Up to 1024 characters.
- `position` _(integer, optional)_: Sorting position within category.
- `slowmode` _(integer, optional)_: Seconds per message (0 to 21600).
- `permissions` _(object, optional)_: Inline permission overwrites for this specific channel.

---

## 5. Permissions Configuration (`permissions.yaml`)

Defines role permission overwrites for categories and channels. Overwrites configured on a category automatically inherit to member channels unless overridden.

```yaml
permissions:
  # Overwrite at the Category level:
  COMMUNITY:
    "@everyone":
      view_channel: true
      send_messages: true
      read_message_history: true

  STAFF:
    "@everyone":
      view_channel: false
    MOD:
      view_channel: true
      send_messages: true
      manage_messages: true
    GM:
      view_channel: true
      send_messages: true
      manage_channels: true
      manage_messages: true

  # Channel-specific override:
  announcements:
    "@everyone":
      view_channel: true
      send_messages: false
    MOD:
      send_messages: true
    GM:
      send_messages: true
```

### Tri-State Behavior:

- `true`: Allowed in Discord (`allow` bit set).
- `false`: Denied in Discord (`deny` bit set).
- _omitted_: Neutral / Inherited from parent category or server default.
