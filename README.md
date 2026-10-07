# BulkPublish for Obsidian

Publish the current note — or just a selection — to 15 social media platforms straight from your vault, powered by [BulkPublish](https://bulkpublish.com).

- **Two commands**: *Publish note to social…* and *Publish selection to social…*
- **Caption prefilled** from the note (frontmatter removed, markdown optionally stripped to plain text)
- **Channel checkboxes** for every connected account (Facebook, Instagram, X (Twitter), TikTok, YouTube, Threads, Bluesky, Pinterest, Google Business Profile, LinkedIn, Mastodon, Discord, Telegram, Tumblr, Snapchat)
- **Channel sets** — your saved channel groups appear as one-click buttons in the modal, and set names work anywhere channel names do (frontmatter, default channels)
- **Large videos** — files over 100 MB upload in resumable 10 MB chunks (videos up to 1 GB, images up to 100 MB)
- **Scheduling** via a date/time picker or frontmatter
- **Team approval** — hold a post for review, and approve/reject the queue from a command
- **Embedded images/videos** (`![[photo.png]]`) detected and uploaded with the post — pick which ones to include
- **"Before you publish" panel**: posts today/this month vs your plan limits, plus an X cost estimate and credit balance
- **Discord channel picker** — when a Discord server is selected, choose which of its text channels to post in
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
| **Default channels** | Comma-separated names preselected in the publish modal, e.g. `x, linkedin`. Names match a saved channel set first, then a platform or account name. Frontmatter overrides this. |
| **Strip markdown** | Convert markdown to plain text for the caption (headings, bold, links, list markers, wiki links…). Recommended. |
| **Append note link** | Appends the note's `share-url` frontmatter value (if present) to the caption. **A URL makes X posts cost ~13× more credits** — see below. |
| **Request approval** | Preselects *Request approval before publishing* in the modal, holding posts for a teammate to review. |

### API key security

The key is stored **in plain text** in the plugin's `data.json` inside your vault (`.obsidian/plugins/bulkpublish/data.json`). If your vault syncs to other devices or a cloud service, the key travels with it. Use a dedicated key for this plugin and revoke it at [app.bulkpublish.com/developer](https://app.bulkpublish.com/developer) if any synced device is untrusted or the vault is ever shared. `data.json` is included in this repo's `.gitignore` — keep it that way if you version-control your vault.

## Frontmatter reference

Drive the publish modal from note frontmatter:

```yaml
---
bulkpublish-channels: [x, linkedin]   # platform names or account names; preselects channels
bulkpublish-schedule: 2026-07-01T09:00 # local time; prefills the schedule picker
bulkpublish-request-approval: true     # hold this post for team approval
bulkpublish-link-tracking: on          # on | off — omit to use your organization setting
bulkpublish-discord-channel: general   # Discord text channel to post in (name, "#name" or id)
share-url: https://myblog.com/post    # used by the "Append note link" setting
---
```

- `bulkpublish-channels` accepts an inline array, a dash list, or a single value. Names match a saved **channel set** name first, then a channel's platform (`x`, `linkedin`, `mastodon`, …) or its account name, case-insensitively. A set name expands to all of its (active) channels.
- `bulkpublish-schedule` accepts `YYYY-MM-DD` (defaults to 09:00 local) or `YYYY-MM-DDTHH:mm`.
- `bulkpublish-request-approval` accepts `true`/`false` (or `yes`/`no`) and overrides the **Request approval** setting for that note.
- `bulkpublish-link-tracking` accepts `on`/`off` (or `true`/`false`, `yes`/`no`) and overrides [link tracking](#link-tracking) for that note. **Omit it to inherit your organization's setting** — omitting is not the same as `off`.
- `bulkpublish-discord-channel` preselects the [Discord channel](#discord) to post in: a channel name (`general`), `"#general"` (quote it — an unquoted `#` starts a comment in YAML) or the channel's id. It applies to every Discord server selected for the note.

After publishing, the plugin writes results back:

```yaml
bulkpublish-post-id: abc123
bulkpublish-status: published
bulkpublish-approval: pending   # only written when approval applies
```

## Link tracking

BulkPublish can rewrite the links in a post to `bulkpubli.sh` short URLs and count the clicks — something no platform API reports. It is **off by default** and opt-in per organization in *Settings → Link Tracking*.

The publish modal has a **Link tracking** dropdown:

- *On* — shorten the note's links and count clicks.
- *Off* — publish the links exactly as written.
- *Use organization setting* (default) — inherit.

It is a dropdown rather than a checkbox because those are three distinct states: an untouched checkbox could not be told apart from a deliberate *Off*. There is no plugin-level setting for it either — the organization setting already is the global default.

Links are rewritten **at publish time, per channel**, so a note going to two accounts on the same platform gets distinct codes. Shortening is **skipped** for any channel where the rewrite would push the post past that platform's character limit — a short URL is 28 characters and can be *longer* than the link it replaces, so on X (280) or Bluesky (300) a note that fit could otherwise fail to publish. The post still goes out with its original links, and records no clicks for that channel.


## Discord

A connected Discord server has many text channels, so a post to Discord needs one chosen. When a Discord server is selected, the publish modal shows a **Discord channel** dropdown listing that server's text channels. It is preselected from the note's `bulkpublish-discord-channel`, or else from the server's default channel if one is saved in BulkPublish.

Publish stays blocked until every selected Discord server has a channel. If the note names a channel the server does not have, the modal says so and asks you to choose one.

## Results

After an immediate publish the modal shows how each platform went. *published* is the only success. *failed* shows the platform's reason. *not confirmed* means the platform could not confirm the post: it may or may not have gone out, so **check the account before retrying, or it may post twice.**

## Team approval

Approval is **orthogonal to the post status**: a post with approval status `pending` or `rejected` does not publish, even when it is scheduled and its time has come.

- Tick **Request approval before publishing** in the modal (or set the **Request approval** setting / `bulkpublish-request-approval` frontmatter) to hold the post for review — its approval status becomes `pending`. Without a schedule the post is submitted for now and held the same way (approval applies only to scheduled posts, so it is not sent as a draft), and it publishes as soon as it is approved, however late.
- If your role lacks publish rights (contributors), the server holds your scheduled posts for approval **whether or not you tick the box**, and publishing directly fails with `APPROVAL_REQUIRED` — the plugin then tells you to submit for approval instead.
- The command **Review posts awaiting approval…** lists everything with approval status `pending` and offers **Approve** and **Reject…** (with an optional reason, max 2000 characters, shown to the author). Approving publishes at the scheduled time, or immediately if that time passed less than 15 minutes ago. If the scheduled time passed more than 15 minutes ago, the post is approved but **not** published: it comes back as a `draft` (approval status `approved`, scheduled time unchanged), the queue says so, and the author is notified to choose a new time. Rejecting returns the post to draft with the reason, and notifies the author.
- Approve/reject require a role with `post:approve` (owner, admin, approver); other roles get a 403. The queue sends the version of the post it showed you, so both return 409 when the post changed since the queue loaded it, or is no longer awaiting approval — nothing is changed; reopen the queue and review again. Approving or rejecting also turns off publish-when-approved.

## Costs and quotas

- The **Before you publish** panel shows your plan's posts-per-day / posts-per-month limits against current usage, so you know a publish will be accepted.
- **X (Twitter) posts consume prepaid credits.** A plain tweet costs ~15 dcents ($0.015); **a tweet containing any URL costs ~200 dcents ($0.20) — about 13× more** — and each attached media file adds ~5 dcents. The modal estimates the cost of your exact caption + media and warns if your balance is too low. Mind this before enabling **Append note link**.
- Live prices and your balance come from the API at modal-open time; the numbers above are the current defaults.

## Channel sets

Channel sets are saved channel groups managed in the BulkPublish app (an organization can have up to **50 sets**, and **set names are unique per organization** — which is why a set name is a reliable targeting alias). The publish modal shows each set as a quick-select button, and set names can be used in `bulkpublish-channels` frontmatter or the **Default channels** setting.

## Large media uploads

Embedded media up to 100 MB uploads in a single request. Larger files — vault videos up to **1 GB** — automatically use BulkPublish's chunked multipart flow: the plugin requests an upload, PUTs the file in fixed **10 MB parts** (collecting exactly one ETag per part), then completes the upload. A failed part is retried on its own, so a network blip never restarts the whole file; if the upload fails, the plugin aborts it, which frees the parts already stored.

## RSS autopost

BulkPublish also supports RSS/Atom autoposting (feeds polled every 15 minutes; new items become draft or auto-published posts). That is an account-level automation with no note-publishing surface, so this plugin does not expose it — manage feeds at [app.bulkpublish.com](https://app.bulkpublish.com) or via the API (`/api/rss-feeds`).

## Character limits

The modal blocks publishing when the caption exceeds a selected platform's limit:

| Platform | Limit (characters) |
|---|---|
| Snapchat | 160 |
| X (Twitter) | 280 |
| Bluesky | 300 |
| Threads, Mastodon, Pinterest | 500 |
| Google Business Profile | 1,500 |
| Discord | 2,000 |
| Instagram, TikTok | 2,200 |
| LinkedIn | 3,000 |
| Telegram | 4,096 (with media, 1,024 fits under the image or video; a longer caption is sent as its own message just above it) |
| YouTube | 5,000 |
| Tumblr | 32,768 |
| Facebook | 63,206 |

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # production main.js
npm test       # unit tests (node:test) for src/lib.ts
```

## Releasing

For maintainers:

1. Bump the version in `manifest.json`, `package.json` and `package-lock.json`, add the new version to `versions.json` (mapped to the minimum app version), and add a `CHANGELOG.md` entry.
2. Commit, then tag the commit with the bare version, with no `v` prefix: `git tag 1.6.0`.
3. Push the tag: `git push origin 1.6.0`.

The release workflow then tests and builds the plugin and creates a GitHub release for that tag with `main.js`, `manifest.json` and `styles.css` attached. It fails without releasing if the tag does not match the version in `manifest.json`.

## License

MIT — see [LICENSE](LICENSE).
