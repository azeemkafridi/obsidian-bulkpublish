# Changelog

## 1.3.0 (2026-07-25)

- **Tumblr support (15th platform).** `tumblr` added to the platform character-limit map (32,768) and display names. Tumblr posts accept up to 30 images **or** exactly one video — never both in the same post.
- **Platform availability.** Platforms can now be disabled server-side. Post creation targeting a disabled platform returns 403 `PLATFORM_DISABLED` (distinct from `FEATURE_DISABLED`, which means the plan doesn't include it). Posts already scheduled when a platform is disabled are **held, not failed**, and publish automatically once it is re-enabled — no need to delete and recreate them. `GET /api/platforms` reports the current state of every platform.

## 1.2.0 (2026-07-24)

- **Team approval**: new *Request approval before publishing* checkbox in the publish modal (with a **Request approval** setting and `bulkpublish-request-approval` frontmatter override) sends `requestApproval: true` on `POST /api/posts`, holding a scheduled post with approval status `pending`. Approval is orthogonal to status — `pending`/`rejected` posts are skipped by the scheduler even when overdue.
- New command **Review posts awaiting approval…**: lists `GET /api/posts?approvalStatus=pending` with **Approve** (`POST /api/posts/{id}/approve`) and **Reject…** (`POST /api/posts/{id}/reject`, optional reason up to 2000 chars). Both need a role with post:approve (owner, admin, approver).
- Publish failures with the 403 `APPROVAL_REQUIRED` code now say "Your role can't publish directly — submit for approval instead".
- The resulting approval state is written back to the note as `bulkpublish-approval` (the server forces `pending` for contributors regardless of the checkbox).

## 1.1.0 (2026-07-17)

- **Channel sets**: saved channel groups (GET /api/channel-sets) appear as quick-select buttons in the publish modal, and set names resolve in `bulkpublish-channels` frontmatter and the Default channels setting (checked before platform/account names). Sets are unique-named per organization, max 50.
- **Large media uploads**: files over 100 MB now use the chunked multipart flow (`/api/media/multipart/create` → PUT fixed 10 MB parts, one ETag per part → `complete`), enabling vault videos up to 1 GB with per-part retry and progress. Failures abort the upload, freeing stored parts.
- Not surfaced: RSS autopost (`/api/rss-feeds`) — account-level automation, documented in README only.
- Fixed manifest.json version drift (was still 1.0.0).

## 1.0.1 (2026-07-16)

- Added Reddit, Discord, Telegram — platform labels and character limits (40000/2000/4096).
- Docs: 14 supported platforms.

