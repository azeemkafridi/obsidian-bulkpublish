# Changelog

## 1.1.0 (2026-07-17)

- **Channel sets**: saved channel groups (GET /api/channel-sets) appear as quick-select buttons in the publish modal, and set names resolve in `bulkpublish-channels` frontmatter and the Default channels setting (checked before platform/account names). Sets are unique-named per organization, max 50.
- **Large media uploads**: files over 100 MB now use the chunked multipart flow (`/api/media/multipart/create` → PUT fixed 10 MB parts, one ETag per part → `complete`), enabling vault videos up to 1 GB with per-part retry and progress. Failures abort the upload, freeing stored parts.
- Not surfaced: RSS autopost (`/api/rss-feeds`) — account-level automation, documented in README only.
- Fixed manifest.json version drift (was still 1.0.0).

## 1.0.1 (2026-07-16)

- Added Reddit, Discord, Telegram — platform labels and character limits (40000/2000/4096).
- Docs: 14 supported platforms.

