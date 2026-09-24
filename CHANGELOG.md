# Changelog

## 1.5.4 (2026-09-24)

### Changed

- **A post submitted for approval without a schedule now publishes as soon as
  it is approved, however late.** Previously an approval more than 15 minutes
  after submitting kept it as a draft to reschedule by hand. Posts with a
  picked schedule are unchanged.

## 1.5.3 (2026-09-24)

### Fixed

- **"Request approval before publishing" now holds a post that has no
  schedule.** Approval used to apply only to scheduled posts, so with the box
  ticked and no date the post was published straight away with no review (the
  modal showed a warning, but the button still said *Publish*). It is now
  submitted for the current time and held with approval status `pending`: it
  does not publish until a teammate approves it. Approved within 15 minutes it
  publishes right away; approved later it is kept as a draft to reschedule. The
  button reads *Submit for approval* whenever the box is ticked. The body is
  built by the new `buildPostBody()` in lib.ts.

### Changed

- The approve/reject 409 message names every cause: someone else approved,
  rejected or withdrew the post, or (approve only) its scheduled time moved.
- The "can't publish directly" tip no longer asks you to pick a schedule.

## 1.5.2 (2026-09-23)

### Changed

- Approval wording updated for the new approve rule: an approved post publishes
  at its scheduled time, or immediately if that time passed less than 15 minutes
  ago. If it passed longer ago, the post is approved but kept as a `draft`
  (scheduled time unchanged) and the author is notified to choose a new time.
- The approval queue now reads the post the approve call returns and says when
  it was approved but not published because its time had passed (new
  `approvalOutcome` helper).
- Approve/reject 409 (the post stopped awaiting approval while the request was
  in flight — approved, rejected or withdrawn by someone else) is explained
  (new `reviewErrorMessage` helper).

## 1.5.1 (2026-08-26)

### Changed

- Package description and README said 14 platforms; the advertisable count is
  15 (Tumblr and Snapchat shipped after that line was written).

## 1.5.0 (2026-08-19)

- **Snapchat support (16th platform).** `snapchat` added to the platform character-limit map (160 — the caption is only used as the Spotlight description and as a saved-story title fallback; plain Snapchat stories carry no text) and display names. Every Snapchat post requires exactly ONE media file: a jpg/png image or an mp4 video; Spotlight is video-only (6-60s). Post types: `story` (default), `saved_story`, `spotlight`.

## 1.4.0 (2026-08-01)

- **Link tracking**: new **Link tracking** dropdown in the publish modal (and a `bulkpublish-link-tracking` frontmatter override) sets `linkTrackingOverride` — *On* shortens the note's links through bulkpubli.sh and counts the clicks, *Off* publishes them as written, and *Use organization setting* (the default) inherits. A dropdown rather than a checkbox because the field is tri-state: an untouched checkbox could not be told apart from a deliberate *Off*. There is deliberately no plugin-level setting, since the organization setting already is the global default.

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

