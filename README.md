# BulkPublish for Obsidian

Publish the current note — or just a selection — to 14 social media platforms straight from your vault, powered by [BulkPublish](https://bulkpublish.com).

- **Two commands**: *Publish note to social…* and *Publish selection to social…*
- **Caption prefilled** from the note (frontmatter removed, markdown optionally stripped to plain text)
- **Channel checkboxes** for every connected account (X, LinkedIn, Facebook, Instagram, Threads, Bluesky, Mastodon, Pinterest, TikTok, YouTube, Google Business Profile, Reddit, Discord, Telegram)
- **Scheduling** via a date/time picker or frontmatter
- **Embedded images/videos** (`![[photo.png]]`) detected and uploaded with the post — pick which ones to include
- **"Before you publish" panel**: posts today/this month vs your plan limits, plus an X cost estimate and credit balance
- **Per-platform results** after publishing (status, error, link to the live post), written back into the note's frontmatter
- Per-platform **character-limit validation** before you can hit Publish

## Install

### Manual

1. Download (or build) `main.js`, `manifest.json`, and `styles.css`.
2. Copy them into `<your vault>/.obsidian/plugins/bulkpublish/`.
3. In Obsidian: **Settings → Community plugins → reload**, then enable **BulkPublish**.

To build from source: `npm install && npm run build` produces `main.js`.

### BRAT

If you use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin:

1. Install and enable BRAT from Community plugins.
2. Run the command **BRAT: Add a beta plugin for testing**.
3. Enter `azeemkafridi/obsidian-bulkpublish` and confirm.
4. Enable **BulkPublish** in Community plugins.

## Setup

1. Create an API key at [app.bulkpublish.com/developer](https://app.bulkpublish.com/developer) (keys look like `bp_…`).
2. Open **Settings → BulkPublish** and paste the key.

### Settings

| Setting | Description |
|---|---|
| **API key** | Your BulkPublish API key (`bp_…`). |
| **Default channels** | Comma-separated platform names preselected in the publish modal, e.g. `x, linkedin`. Frontmatter overrides this. |
| **Strip markdown** | Convert markdown to plain text for the caption (headings, bold, links, list markers, wiki links…). Recommended. |
| **Append note link** | Appends the note's `share-url` frontmatter value (if present) to the caption. **A URL makes X posts cost ~13× more credits** — see below. |

### API key security

The key is stored **in plain text** in the plugin's `data.json` inside your vault (`.obsidian/plugins/bulkpublish/data.json`). If your vault syncs to other devices or a cloud service, the key travels with it. Use a dedicated key for this plugin and revoke it at [app.bulkpublish.com/developer](https://app.bulkpublish.com/developer) if any synced device is untrusted or the vault is ever shared. `data.json` is included in this repo's `.gitignore` — keep it that way if you version-control your vault.

## Frontmatter reference

Drive the publish modal from note frontmatter:

```yaml
---
bulkpublish-channels: [x, linkedin]   # platform names or account names; preselects channels
bulkpublish-schedule: 2026-07-01T09:00 # local time; prefills the schedule picker
share-url: https://myblog.com/post    # used by the "Append note link" setting
---
```

- `bulkpublish-channels` accepts an inline array, a dash list, or a single value. Names match a channel's platform (`x`, `linkedin`, `mastodon`, …) or its account name, case-insensitively.
- `bulkpublish-schedule` accepts `YYYY-MM-DD` (defaults to 09:00 local) or `YYYY-MM-DDTHH:mm`.

After publishing, the plugin writes results back:

```yaml
bulkpublish-post-id: abc123
bulkpublish-status: published
```

## Costs and quotas

- The **Before you publish** panel shows your plan's posts-per-day / posts-per-month limits against current usage, so you know a publish will be accepted.
- **X (Twitter) posts consume prepaid credits.** A plain tweet costs ~15 dcents ($0.015); **a tweet containing any URL costs ~200 dcents ($0.20) — about 13× more** — and each attached media file adds ~5 dcents. The modal estimates the cost of your exact caption + media and warns if your balance is too low. Mind this before enabling **Append note link**.
- Live prices and your balance come from the API at modal-open time; the numbers above are the current defaults.

## Character limits

The modal blocks publishing when the caption exceeds a selected platform's limit: X 280, Bluesky 300, Threads/Mastodon/Pinterest 500, Google Business Profile 1500, Instagram/TikTok 2200, LinkedIn 3000, YouTube 5000, Facebook 63,206.

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # production main.js
npm test       # unit tests (node:test) for src/lib.ts
```

## License

MIT
