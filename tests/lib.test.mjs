/**
 * Unit tests for the pure logic in src/lib.ts.
 * Run with `npm test` — src/lib.ts is bundled to tests/build/lib.mjs first.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	buildCaption,
	containsUrl,
	estimateXCost,
	extractEmbeds,
	formatDcents,
	parseBulkPublishFrontmatter,
	parseScheduleInput,
	platformLabel,
	resolveChannels,
	splitFrontmatter,
	stripMarkdown,
	validateCharLimits,
	CHAR_LIMITS,
	DEFAULT_X_COSTS,
} from "./build/lib.mjs";

// ---------------------------------------------------------------------------
// splitFrontmatter
// ---------------------------------------------------------------------------

test("splitFrontmatter: no frontmatter", () => {
	const r = splitFrontmatter("Hello world");
	assert.equal(r.frontmatter, null);
	assert.equal(r.body, "Hello world");
});

test("splitFrontmatter: basic", () => {
	const r = splitFrontmatter("---\ntitle: Hi\ntags: [a]\n---\nBody here");
	assert.equal(r.frontmatter, "title: Hi\ntags: [a]");
	assert.equal(r.body, "Body here");
});

test("splitFrontmatter: CRLF line endings", () => {
	const r = splitFrontmatter("---\r\ntitle: Hi\r\n---\r\nBody");
	assert.equal(r.frontmatter, "title: Hi");
	assert.equal(r.body, "Body");
});

test("splitFrontmatter: frontmatter at EOF with no body", () => {
	const r = splitFrontmatter("---\ntitle: Hi\n---");
	assert.equal(r.frontmatter, "title: Hi");
	assert.equal(r.body, "");
});

test("splitFrontmatter: --- not at start is body", () => {
	const r = splitFrontmatter("intro\n---\nkey: v\n---\n");
	assert.equal(r.frontmatter, null);
});

// ---------------------------------------------------------------------------
// parseBulkPublishFrontmatter
// ---------------------------------------------------------------------------

test("frontmatter: inline channel array", () => {
	const fm = parseBulkPublishFrontmatter("bulkpublish-channels: [x, LinkedIn]");
	assert.deepEqual(fm.channels, ["x", "linkedin"]);
});

test("frontmatter: dash-list channels + quotes", () => {
	const fm = parseBulkPublishFrontmatter(
		'bulkpublish-channels:\n  - "x"\n  - \'mastodon\'\ntitle: other'
	);
	assert.deepEqual(fm.channels, ["x", "mastodon"]);
});

test("frontmatter: single scalar channel", () => {
	const fm = parseBulkPublishFrontmatter("bulkpublish-channels: x");
	assert.deepEqual(fm.channels, ["x"]);
});

test("frontmatter: schedule, share-url, post-id, status", () => {
	const fm = parseBulkPublishFrontmatter(
		[
			"bulkpublish-schedule: 2026-07-01T09:00",
			"share-url: https://example.com/post",
			'bulkpublish-post-id: "abc123"',
			"bulkpublish-status: published",
		].join("\n")
	);
	assert.equal(fm.schedule, "2026-07-01T09:00");
	assert.equal(fm.shareUrl, "https://example.com/post");
	assert.equal(fm.postId, "abc123");
	assert.equal(fm.status, "published");
});

test("frontmatter: null input", () => {
	const fm = parseBulkPublishFrontmatter(null);
	assert.deepEqual(fm.channels, []);
	assert.equal(fm.schedule, null);
});

// ---------------------------------------------------------------------------
// parseScheduleInput
// ---------------------------------------------------------------------------

test("parseScheduleInput: valid datetime returns ISO UTC", () => {
	const iso = parseScheduleInput("2030-07-01T09:00");
	assert.ok(iso);
	assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	assert.equal(new Date(iso).getTime(), new Date("2030-07-01T09:00").getTime());
});

test("parseScheduleInput: space separator accepted", () => {
	assert.ok(parseScheduleInput("2030-07-01 09:00"));
});

test("parseScheduleInput: date-only defaults to 9am local", () => {
	const iso = parseScheduleInput("2030-07-01");
	assert.equal(new Date(iso).getTime(), new Date("2030-07-01T09:00").getTime());
});

test("parseScheduleInput: invalid/empty", () => {
	assert.equal(parseScheduleInput(""), null);
	assert.equal(parseScheduleInput(null), null);
	assert.equal(parseScheduleInput(undefined), null);
	assert.equal(parseScheduleInput("tomorrow"), null);
	assert.equal(parseScheduleInput("2030-13-45T99:99"), null);
});

// ---------------------------------------------------------------------------
// stripMarkdown
// ---------------------------------------------------------------------------

test("stripMarkdown: headings, emphasis, inline code", () => {
	assert.equal(
		stripMarkdown("# Title\n\nSome **bold** and *italic* and `code`."),
		"Title\n\nSome bold and italic and code."
	);
});

test("stripMarkdown: links become 'text (url)'", () => {
	assert.equal(
		stripMarkdown("See [my site](https://example.com) now"),
		"See my site (https://example.com) now"
	);
});

test("stripMarkdown: link with text == url collapses to url", () => {
	assert.equal(
		stripMarkdown("[https://example.com](https://example.com)"),
		"https://example.com"
	);
});

test("stripMarkdown: wiki links and embeds", () => {
	assert.equal(stripMarkdown("See [[Other Note|the note]]"), "See the note");
	assert.equal(stripMarkdown("See [[Other Note#Heading]]"), "See Other Note");
	assert.equal(stripMarkdown("Before ![[img.png]] after"), "Before  after");
});

test("stripMarkdown: markdown images removed", () => {
	assert.equal(stripMarkdown("a ![alt](http://x/y.png) b"), "a  b");
});

test("stripMarkdown: lists, tasks, blockquotes", () => {
	assert.equal(
		stripMarkdown("- item one\n1. item two\n- [ ] todo\n> quoted"),
		"item one\nitem two\ntodo\nquoted"
	);
});

test("stripMarkdown: code fences keep content", () => {
	assert.equal(stripMarkdown("```js\nconst a = 1;\n```"), "const a = 1;");
});

test("stripMarkdown: obsidian comments and html removed", () => {
	assert.equal(stripMarkdown("keep %%secret%% this <b>bold</b>"), "keep  this bold");
});

test("stripMarkdown: collapses 3+ newlines and trims", () => {
	assert.equal(stripMarkdown("a\n\n\n\nb\n\n"), "a\n\nb");
});

test("stripMarkdown: strikethrough, highlight, autolink, footnotes", () => {
	assert.equal(stripMarkdown("~~gone~~ ==hot== <https://e.com> word[^1]\n[^1]: note"), "gone hot https://e.com word");
});

// ---------------------------------------------------------------------------
// buildCaption
// ---------------------------------------------------------------------------

test("buildCaption: strips markdown and appends share url", () => {
	const caption = buildCaption("# Hi\nbody", {
		stripMarkdown: true,
		appendShareUrl: true,
		shareUrl: "https://example.com/p",
	});
	assert.equal(caption, "Hi\nbody\n\nhttps://example.com/p");
});

test("buildCaption: no strip, no share url", () => {
	const caption = buildCaption("# Hi\n", {
		stripMarkdown: false,
		appendShareUrl: false,
		shareUrl: null,
	});
	assert.equal(caption, "# Hi");
});

// ---------------------------------------------------------------------------
// extractEmbeds
// ---------------------------------------------------------------------------

test("extractEmbeds: finds media embeds, skips notes and dupes", () => {
	const body =
		"![[photo.png]] text ![[dir/video.mp4|caption]] ![[photo.png]] ![[Other Note]] ![[doc.pdf]]";
	const embeds = extractEmbeds(body);
	assert.deepEqual(embeds, [
		{ link: "photo.png", name: "photo.png", extension: "png" },
		{ link: "dir/video.mp4", name: "video.mp4", extension: "mp4" },
	]);
});

test("extractEmbeds: heading suffix ignored, uppercase ext", () => {
	const embeds = extractEmbeds("![[IMG.JPG]]");
	assert.deepEqual(embeds, [{ link: "IMG.JPG", name: "IMG.JPG", extension: "jpg" }]);
});

// ---------------------------------------------------------------------------
// validateCharLimits
// ---------------------------------------------------------------------------

test("validateCharLimits: within limits", () => {
	assert.deepEqual(validateCharLimits("short", ["x", "linkedin"]), []);
});

test("validateCharLimits: over X limit, message exact", () => {
	const caption = "a".repeat(295);
	assert.deepEqual(validateCharLimits(caption, ["x", "x", "facebook"]), [
		"Too long for X (Twitter): 295/280 characters (15 over).",
	]);
});

test("validateCharLimits: counts code points not UTF-16 units", () => {
	const caption = "😀".repeat(280); // 560 UTF-16 units, 280 code points
	assert.deepEqual(validateCharLimits(caption, ["x"]), []);
});

test("validateCharLimits: unknown platform ignored", () => {
	assert.deepEqual(validateCharLimits("a".repeat(9999), ["someplatform"]), []);
});

test("CHAR_LIMITS matches API contract", () => {
	assert.equal(CHAR_LIMITS.x, 280);
	assert.equal(CHAR_LIMITS.bluesky, 300);
	assert.equal(CHAR_LIMITS.facebook, 63206);
});

// ---------------------------------------------------------------------------
// X cost estimate
// ---------------------------------------------------------------------------

test("containsUrl", () => {
	assert.ok(containsUrl("check https://example.com out"));
	assert.ok(containsUrl("check www.example.com out"));
	assert.ok(!containsUrl("no links here"));
});

test("estimateXCost: plain post", () => {
	assert.equal(estimateXCost("hello", 0, null), 15);
});

test("estimateXCost: link post ~13x", () => {
	assert.equal(estimateXCost("see https://e.com", 0, null), 200);
});

test("estimateXCost: media adds per-file cost", () => {
	assert.equal(estimateXCost("hello", 2, null), 15 + 2 * 5);
});

test("estimateXCost: server costs override defaults", () => {
	assert.equal(
		estimateXCost("hello", 1, { tweet_create: 20, media_simple_upload: 7 }),
		27
	);
	assert.equal(DEFAULT_X_COSTS.tweet_create_with_url, 200);
});

test("formatDcents", () => {
	assert.equal(formatDcents(200), "$0.20");
	assert.equal(formatDcents(15), "$0.015");
	assert.equal(formatDcents(1000), "$1.00");
	assert.equal(formatDcents(0), "$0.00");
});

// ---------------------------------------------------------------------------
// resolveChannels
// ---------------------------------------------------------------------------

const channels = [
	{ id: "1", platform: "x", accountName: "@me", isActive: true },
	{ id: "2", platform: "x", accountName: "@brand", isActive: true },
	{ id: "3", platform: "linkedin", accountName: "Me", isActive: true },
	{ id: "4", platform: "mastodon", accountName: "old", isActive: false },
];

test("resolveChannels: platform name matches all active channels of platform", () => {
	const r = resolveChannels(["x"], channels);
	assert.deepEqual(r.channelIds, ["1", "2"]);
	assert.deepEqual(r.unmatched, []);
});

test("resolveChannels: account name match, case-insensitive", () => {
	const r = resolveChannels(["@Brand", "ME"], channels);
	assert.deepEqual(r.channelIds, ["2", "3"]);
});

test("resolveChannels: inactive channels never match; unknown reported", () => {
	const r = resolveChannels(["mastodon", "tiktok"], channels);
	assert.deepEqual(r.channelIds, []);
	assert.deepEqual(r.unmatched, ["mastodon", "tiktok"]);
});

test("resolveChannels: dedupes ids", () => {
	const r = resolveChannels(["x", "@me"], channels);
	assert.deepEqual(r.channelIds, ["1", "2"]);
});

test("platformLabel: known and unknown", () => {
	assert.equal(platformLabel("gmb"), "Google Business Profile");
	assert.equal(platformLabel("newnet"), "newnet");
});
