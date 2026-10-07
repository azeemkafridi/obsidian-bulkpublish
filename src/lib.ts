/**
 * Pure logic for BulkPublish for Obsidian.
 * No Obsidian imports — everything here is unit-testable in plain Node.
 */

// ---------------------------------------------------------------------------
// Platform character limits (from the BulkPublish API contract)
// ---------------------------------------------------------------------------

export const CHAR_LIMITS: Record<string, number> = {
	x: 280,
	threads: 500,
	bluesky: 300,
	mastodon: 500,
	pinterest: 500,
	gmb: 1500,
	linkedin: 3000,
	instagram: 2200,
	tiktok: 2200,
	youtube: 5000,
	facebook: 63206,
	reddit: 40000,
	discord: 2000,
	telegram: 4096,
	tumblr: 32768,
	snapchat: 160,
};

export const PLATFORM_LABELS: Record<string, string> = {
	x: "X (Twitter)",
	threads: "Threads",
	bluesky: "Bluesky",
	mastodon: "Mastodon",
	pinterest: "Pinterest",
	gmb: "Google Business Profile",
	linkedin: "LinkedIn",
	instagram: "Instagram",
	tiktok: "TikTok",
	youtube: "YouTube",
	facebook: "Facebook",
	reddit: "Reddit",
	discord: "Discord",
	telegram: "Telegram",
	tumblr: "Tumblr",
	snapchat: "Snapchat",
};

export function platformLabel(platform: string): string {
	return PLATFORM_LABELS[platform] ?? platform;
}

/**
 * Validate a caption against the char limits of the selected platforms.
 * Returns one exact message per violated platform, e.g.:
 *   "Too long for X (Twitter): 295/280 characters (15 over)."
 */
export function validateCharLimits(caption: string, platforms: string[]): string[] {
	const len = [...caption].length; // count code points, not UTF-16 units
	const messages: string[] = [];
	const seen = new Set<string>();
	for (const platform of platforms) {
		if (seen.has(platform)) continue;
		seen.add(platform);
		const limit = CHAR_LIMITS[platform];
		if (limit !== undefined && len > limit) {
			messages.push(
				`Too long for ${platformLabel(platform)}: ${len}/${limit} characters (${len - limit} over).`
			);
		}
	}
	return messages;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export interface SplitNote {
	frontmatter: string | null; // raw YAML between the --- fences (no fences)
	body: string;
}

/** Split a note into raw frontmatter text and body. */
export function splitFrontmatter(content: string): SplitNote {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) return { frontmatter: null, body: content };
	return { frontmatter: match[1], body: content.slice(match[0].length) };
}

export interface BulkPublishFrontmatter {
	channels: string[]; // platform names, e.g. ["x", "linkedin"]
	schedule: string | null; // e.g. "2026-07-01T09:00"
	shareUrl: string | null; // public URL to append when "append note link" is on
	postId: string | null; // written back after publishing
	status: string | null;
	/** true/false override for the "Request approval" setting (null = use setting). */
	requestApproval: boolean | null;
	/**
	 * true/false override for bulkpubli.sh link tracking.
	 * null = inherit the organization's Link Tracking setting, which is NOT the
	 * same as false ("publish the links as written").
	 */
	linkTracking: boolean | null;
	/**
	 * Discord text channel to post in, for every Discord server selected:
	 * a channel name ("general"), "#general", or the channel's id.
	 */
	discordChannel: string | null;
}

function unquote(value: string): string {
	const v = value.trim();
	if (
		(v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
		(v.startsWith("'") && v.endsWith("'") && v.length >= 2)
	) {
		return v.slice(1, -1);
	}
	return v;
}

/**
 * Minimal YAML-ish parser for the handful of keys this plugin cares about.
 * Supports inline arrays (`key: [a, b]`), dash lists, and scalar values.
 * (In-app the plugin prefers Obsidian's metadataCache; this exists so the
 * same behavior is testable and works on unsaved content.)
 */
export function parseBulkPublishFrontmatter(fmText: string | null): BulkPublishFrontmatter {
	const result: BulkPublishFrontmatter = {
		channels: [],
		schedule: null,
		shareUrl: null,
		postId: null,
		status: null,
		requestApproval: null,
		linkTracking: null,
		discordChannel: null,
	};
	if (!fmText) return result;

	const lines = fmText.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!kv) continue;
		const key = kv[1].toLowerCase();
		let value = kv[2].trim();

		const readList = (): string[] => {
			if (value.startsWith("[")) {
				// inline array: [x, linkedin]
				const inner = value.replace(/^\[/, "").replace(/\]\s*$/, "");
				return inner
					.split(",")
					.map((s) => unquote(s))
					.filter((s) => s.length > 0);
			}
			if (value === "") {
				// dash list on following lines
				const items: string[] = [];
				while (i + 1 < lines.length) {
					const m = lines[i + 1].match(/^\s*-\s+(.*)$/);
					if (!m) break;
					items.push(unquote(m[1]));
					i++;
				}
				return items;
			}
			// single scalar treated as one-item list
			return [unquote(value)];
		};

		switch (key) {
			case "bulkpublish-channels":
				result.channels = readList().map((c) => c.toLowerCase());
				break;
			case "bulkpublish-schedule":
				result.schedule = value ? unquote(value) : null;
				break;
			case "share-url":
				result.shareUrl = value ? unquote(value) : null;
				break;
			case "bulkpublish-post-id":
				result.postId = value ? unquote(value) : null;
				break;
			case "bulkpublish-status":
				result.status = value ? unquote(value) : null;
				break;
			case "bulkpublish-request-approval": {
				const v = unquote(value).toLowerCase();
				if (v === "true" || v === "yes") result.requestApproval = true;
				else if (v === "false" || v === "no") result.requestApproval = false;
				break;
			}
			case "bulkpublish-link-tracking": {
				// Tri-state: anything unrecognised leaves it null (inherit)
				// rather than guessing "off".
				const v = unquote(value).toLowerCase();
				if (v === "true" || v === "yes" || v === "on") result.linkTracking = true;
				else if (v === "false" || v === "no" || v === "off") result.linkTracking = false;
				break;
			}
			case "bulkpublish-discord-channel":
				result.discordChannel = value ? unquote(value) || null : null;
				break;
		}
	}
	return result;
}

/**
 * Parse a schedule string like "2026-07-01T09:00" (local time) into an ISO
 * UTC string for the API. Returns null if the input is empty or invalid.
 */
export function parseScheduleInput(input: string | null | undefined): string | null {
	if (!input) return null;
	const trimmed = input.trim();
	if (!trimmed) return null;
	if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(trimmed)) return null;
	const normalized = trimmed.includes("T") || trimmed.includes(" ")
		? trimmed.replace(" ", "T")
		: `${trimmed}T09:00`; // date-only defaults to 9am local
	const date = new Date(normalized);
	if (isNaN(date.getTime())) return null;
	return date.toISOString();
}

// ---------------------------------------------------------------------------
// Markdown stripping (MD → plain-text caption)
// ---------------------------------------------------------------------------

export function stripMarkdown(md: string): string {
	let text = md;

	// Code fences — keep the inner content, drop the fences + language hint
	text = text.replace(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/gm, "$1");
	text = text.replace(/```[^\n]*\n([\s\S]*?)\n?```/g, "$1");

	// Embeds ![[file]] — removed entirely (they become media uploads instead)
	text = text.replace(/!\[\[[^\]]*\]\]/g, "");

	// Markdown images ![alt](url) — removed
	text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

	// Wiki links [[target|alias]] → alias, [[target]] → target (strip #heading)
	text = text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
	text = text.replace(/\[\[([^\]#|]*)(#[^\]|]*)?\]\]/g, "$1");

	// Markdown links [text](url) → "text (url)" (or just the url if text == url)
	text = text.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, url: string) => {
		const t = label.trim();
		if (!t || t === url) return url;
		return `${t} (${url})`;
	});

	// Autolinks <https://…> → url
	text = text.replace(/<(https?:\/\/[^>]+)>/g, "$1");

	// Footnote refs [^1] and definitions
	text = text.replace(/^\[\^[^\]]+\]:\s?.*$/gm, "");
	text = text.replace(/\[\^[^\]]+\]/g, "");

	// Emphasis / strikethrough / highlight markers
	text = text.replace(/(\*\*\*|___)(.+?)\1/g, "$2");
	text = text.replace(/(\*\*|__)(.+?)\1/g, "$2");
	text = text.replace(/(\*|_)(.+?)\1/g, "$2");
	text = text.replace(/~~(.+?)~~/g, "$1");
	text = text.replace(/==(.+?)==/g, "$1");

	// Inline code
	text = text.replace(/`([^`]+)`/g, "$1");

	// Headings
	text = text.replace(/^#{1,6}\s+/gm, "");

	// Blockquotes (possibly nested)
	text = text.replace(/^(\s*>)+\s?/gm, "");

	// Task checkboxes + list markers
	text = text.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/gm, "$1");
	text = text.replace(/^(\s*)[-*+]\s+/gm, "$1");
	text = text.replace(/^(\s*)\d+\.\s+/gm, "$1");

	// Horizontal rules
	text = text.replace(/^[ \t]*([-*_])[ \t]*(\1[ \t]*){2,}$/gm, "");

	// Obsidian comments %%…%% and HTML tags
	text = text.replace(/%%[\s\S]*?%%/g, "");
	text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");

	// Tidy whitespace: trim line ends, collapse 3+ newlines to 2, trim overall
	text = text
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/, ""))
		.join("\n");
	text = text.replace(/\n{3,}/g, "\n\n").trim();

	return text;
}

// ---------------------------------------------------------------------------
// Embedded media
// ---------------------------------------------------------------------------

export const MEDIA_EXTENSIONS = [
	"png", "jpg", "jpeg", "gif", "webp", "bmp",
	"mp4", "mov", "webm", "m4v",
];

export interface EmbeddedMedia {
	/** Link target as written in the note, e.g. "attachments/img.png" */
	link: string;
	/** Just the file name, e.g. "img.png" */
	name: string;
	extension: string;
}

/** Find embedded media (![[img.png]] wiki embeds) in a note body. */
export function extractEmbeds(body: string): EmbeddedMedia[] {
	const embeds: EmbeddedMedia[] = [];
	const seen = new Set<string>();
	const re = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(body)) !== null) {
		const link = match[1].trim();
		if (!link || seen.has(link)) continue;
		const dot = link.lastIndexOf(".");
		if (dot === -1) continue;
		const extension = link.slice(dot + 1).toLowerCase();
		if (!MEDIA_EXTENSIONS.includes(extension)) continue;
		seen.add(link);
		const name = link.split("/").pop() ?? link;
		embeds.push({ link, name, extension });
	}
	return embeds;
}

// ---------------------------------------------------------------------------
// X (Twitter) cost estimate
// ---------------------------------------------------------------------------

export interface XCosts {
	tweet_create: number;
	tweet_create_with_url: number;
	media_simple_upload: number;
}

export const DEFAULT_X_COSTS: XCosts = {
	tweet_create: 15,
	tweet_create_with_url: 200,
	media_simple_upload: 5,
};

const URL_RE = /(https?:\/\/[^\s)]+)|(\bwww\.[a-z0-9-]+\.[a-z]{2,}[^\s)]*)/i;

export function containsUrl(text: string): boolean {
	return URL_RE.test(text);
}

/**
 * Estimate the X publishing cost in dcents ($1 = 1000 dcents).
 * A post whose caption contains a link costs ~13x a plain post.
 */
export function estimateXCost(
	caption: string,
	mediaCount: number,
	costs: Partial<XCosts> | null | undefined
): number {
	const c: XCosts = { ...DEFAULT_X_COSTS, ...(costs ?? {}) };
	const base = containsUrl(caption) ? c.tweet_create_with_url : c.tweet_create;
	return base + mediaCount * c.media_simple_upload;
}

/** Format dcents as dollars, e.g. 200 → "$0.20", 15 → "$0.015". */
export function formatDcents(dcents: number): string {
	const dollars = dcents / 1000;
	const fixed = dollars.toFixed(3);
	// trim a single trailing zero so 0.200 → 0.20 but 0.015 stays
	const trimmed = fixed.endsWith("0") ? fixed.slice(0, -1) : fixed;
	return `$${trimmed}`;
}

// ---------------------------------------------------------------------------
// Channel resolution
// ---------------------------------------------------------------------------

export interface Channel {
	id: string;
	platform: string;
	accountName: string;
	isActive: boolean;
	/** For Discord, `channelId` is the text channel saved as the server's default. */
	metadata?: { channelId?: string | null } | null;
}

/**
 * Resolve frontmatter platform names (["x", "linkedin"]) to channel IDs.
 * Matches active channels whose platform OR accountName equals the name
 * (case-insensitive). Unknown names are returned so the UI can warn.
 */
export function resolveChannels(
	names: string[],
	channels: Channel[]
): { channelIds: string[]; unmatched: string[] } {
	const channelIds: string[] = [];
	const unmatched: string[] = [];
	for (const raw of names) {
		const name = raw.toLowerCase().trim();
		const matches = channels.filter(
			(c) =>
				c.isActive &&
				(c.platform.toLowerCase() === name || c.accountName.toLowerCase() === name)
		);
		if (matches.length === 0) {
			unmatched.push(raw);
		} else {
			for (const m of matches) {
				if (!channelIds.includes(m.id)) channelIds.push(m.id);
			}
		}
	}
	return { channelIds, unmatched };
}

// ---------------------------------------------------------------------------
// Channel sets (saved channel groups — max 50 per org, names unique per org)
// ---------------------------------------------------------------------------

export interface ChannelSet {
	id: number;
	name: string;
	channelIds: number[];
}

/**
 * Resolve frontmatter/settings names to channel IDs, checking channel-set
 * names first (exact, case-insensitive), then falling back to platform /
 * account-name matching (resolveChannels). A set expands to its channelIds,
 * filtered to channels that exist and are active.
 */
export function resolveTargets(
	names: string[],
	channels: Channel[],
	sets: ChannelSet[]
): { channelIds: string[]; unmatched: string[] } {
	const channelIds: string[] = [];
	const unmatched: string[] = [];
	const activeIds = new Set(channels.filter((c) => c.isActive).map((c) => c.id));
	for (const raw of names) {
		const name = raw.toLowerCase().trim();
		const set = sets.find((s) => s.name.toLowerCase().trim() === name);
		if (set) {
			const ids = set.channelIds.map(String).filter((id) => activeIds.has(id));
			if (ids.length === 0) {
				unmatched.push(raw);
			} else {
				for (const id of ids) {
					if (!channelIds.includes(id)) channelIds.push(id);
				}
			}
			continue;
		}
		const r = resolveChannels([raw], channels);
		if (r.channelIds.length === 0) {
			unmatched.push(raw);
		} else {
			for (const id of r.channelIds) {
				if (!channelIds.includes(id)) channelIds.push(id);
			}
		}
	}
	return { channelIds, unmatched };
}

// ---------------------------------------------------------------------------
// Multipart upload part math (part size is fixed by the server: 10 MB)
// ---------------------------------------------------------------------------

export interface UploadPart {
	partNumber: number; // 1-based
	start: number; // byte offset, inclusive
	end: number; // byte offset, exclusive
}

/** Split a file of sizeBytes into sequential parts of partSize (last part may be smaller). */
export function computeParts(sizeBytes: number, partSize: number): UploadPart[] {
	if (sizeBytes <= 0 || partSize <= 0) return [];
	const parts: UploadPart[] = [];
	for (let start = 0, n = 1; start < sizeBytes; start += partSize, n++) {
		parts.push({ partNumber: n, start, end: Math.min(start + partSize, sizeBytes) });
	}
	return parts;
}

// ---------------------------------------------------------------------------
// Caption assembly
// ---------------------------------------------------------------------------

export interface BuildCaptionOptions {
	stripMarkdown: boolean;
	appendShareUrl: boolean;
	shareUrl: string | null;
}

/** Build the final caption from a note body according to plugin settings. */
export function buildCaption(body: string, options: BuildCaptionOptions): string {
	let caption = options.stripMarkdown ? stripMarkdown(body) : body.trim();
	if (options.appendShareUrl && options.shareUrl) {
		caption = caption ? `${caption}\n\n${options.shareUrl}` : options.shareUrl;
	}
	return caption;
}

// ---------------------------------------------------------------------------
// Team approval
// ---------------------------------------------------------------------------

/** Human labels for a post's team approval state. */
export const APPROVAL_LABELS: Record<string, string> = {
	none: "No approval needed",
	pending: "Awaiting approval",
	approved: "Approved",
	rejected: "Rejected",
};

export function approvalLabel(status: string | null | undefined): string {
	if (!status) return APPROVAL_LABELS.none;
	return APPROVAL_LABELS[status] ?? status;
}

/**
 * Message for the API's 403 APPROVAL_REQUIRED error, returned by
 * POST /api/posts/{id}/publish and /retry for roles without post:publish.
 */
export const APPROVAL_REQUIRED_MESSAGE =
	"Your role can't publish directly — submit for approval instead " +
	"(enable “Request approval” and schedule the post).";

/** Map an API error to a user-facing message, special-casing APPROVAL_REQUIRED. */
export function approvalAwareMessage(code: string | undefined, fallback: string): string {
	return code === "APPROVAL_REQUIRED" ? APPROVAL_REQUIRED_MESSAGE : fallback;
}

/**
 * What an approval did, read from the post POST /api/posts/{id}/approve
 * returned. `ok` is false when the post was approved but will NOT publish: a
 * 'draft' with a past scheduledAt means its time passed more than 15 minutes
 * before approval, so the author was asked to choose a new time.
 */
export function approvalOutcome(
	post: { status?: string; scheduledAt?: string | null } | null | undefined,
	now: number = Date.now()
): { ok: boolean; text: string } {
	if (post?.status === "draft") {
		const scheduledMs = post.scheduledAt ? new Date(post.scheduledAt).getTime() : NaN;
		if (Number.isFinite(scheduledMs) && scheduledMs <= now) {
			return {
				ok: false,
				text:
					"Approved, but its scheduled time had already passed, so it was not published. " +
					"It is kept as a draft and the author has been asked to choose a new time.",
			};
		}
		return {
			ok: false,
			text: "Approved. It is still a draft, so it will not publish until it is scheduled or published.",
		};
	}
	if (post?.status === "publishing") {
		return { ok: true, text: "Approved — publishing now." };
	}
	return { ok: true, text: "Approved — publishes at its scheduled time." };
}

/**
 * The POST /api/posts body for the publish modal.
 *
 * Without a schedule the post is a draft that the modal publishes straight
 * away. With approval requested and no schedule it is sent as `scheduled` for
 * now instead: the API applies approval only to scheduled posts and ignores
 * `requestApproval` on a draft. Held this way it does not publish until
 * approved, and `publishWhenApproved` makes it publish as soon as it is
 * approved, however late. A picked schedule keeps the default: approved more
 * than 15 minutes late, it comes back as an approved draft to reschedule.
 */
export function buildPostBody(input: {
	caption: string;
	channelIds: string[];
	mediaIds?: string[];
	scheduledAt?: string | null;
	timezone?: string;
	requestApproval?: boolean;
	linkTracking?: boolean | null;
	/** BulkPublish channel id → Discord text channel id, for each Discord server. */
	discordChannels?: Record<string, string>;
	now?: number;
}): {
	content: string;
	channels: { channelId: string }[];
	mediaFiles?: string[];
	status: "draft" | "scheduled";
	scheduledAt?: string;
	timezone?: string;
	requestApproval?: boolean;
	publishWhenApproved?: boolean;
	linkTrackingOverride?: boolean;
	platformSpecific?: { discord: Record<string, { channelId: string }> };
} {
	const { caption, channelIds, mediaIds = [], scheduledAt = null, timezone } = input;
	const requestApproval = !!input.requestApproval;
	const body: ReturnType<typeof buildPostBody> = {
		content: caption,
		channels: channelIds.map((channelId) => ({ channelId })),
		status: scheduledAt || requestApproval ? "scheduled" : "draft",
	};
	if (mediaIds.length > 0) body.mediaFiles = mediaIds;
	if (scheduledAt) {
		body.scheduledAt = scheduledAt;
		if (timezone) body.timezone = timezone;
	} else if (requestApproval) {
		body.scheduledAt = new Date(input.now ?? Date.now()).toISOString();
		// No time was chosen, so the post should go out as soon as it is
		// approved, however late. A picked schedule keeps the default hold.
		body.publishWhenApproved = true;
	}
	// Sent only when true (the API default is false).
	if (requestApproval) body.requestApproval = true;
	// Omitted when null/undefined so the post inherits the organization
	// setting; false is sent and means "links as written".
	if (input.linkTracking === true || input.linkTracking === false) {
		body.linkTrackingOverride = input.linkTracking;
	}
	// Discord: keyed by the BulkPublish channel id, the inner channelId is the
	// Discord text channel inside that server.
	const discord: Record<string, { channelId: string }> = {};
	for (const [id, discordId] of Object.entries(input.discordChannels ?? {})) {
		if (discordId) discord[String(id)] = { channelId: String(discordId) };
	}
	if (Object.keys(discord).length > 0) body.platformSpecific = { discord };
	return body;
}

/**
 * Message for a failed approve/reject call. 409 means the post changed since
 * the queue loaded it, or is no longer awaiting approval.
 */
export function reviewErrorMessage(
	action: "Approve" | "Reject",
	status: number | undefined,
	fallback: string
): string {
	if (status === 409) {
		return (
			"This post changed since you loaded it, or is no longer awaiting approval. " +
			"Reopen the queue and review what is there now."
		);
	}
	return `${action} failed: ${fallback}`;
}

// ---------------------------------------------------------------------------
// Discord text channel selection
// ---------------------------------------------------------------------------

/** One postable text channel of a connected Discord server. */
export interface DiscordChannelOption {
	id: string;
	name: string;
}

/**
 * Pick which text channel of one Discord server to preselect.
 *
 * `wanted` (from the note's bulkpublish-discord-channel) is a channel name, a
 * "#name", or an id, matched case-insensitively against `options`. With nothing
 * wanted, the server's saved default is used when it is still one of the
 * listed channels. If the channel list could not be loaded (`options` empty),
 * an id-shaped `wanted` or the saved default is trusted as is.
 *
 * `unmatched` is set when `wanted` names a channel the server does not have.
 */
export function resolveDiscordChannel(
	wanted: string | null | undefined,
	savedDefault: string | null | undefined,
	options: DiscordChannelOption[]
): { channelId: string | null; unmatched: string | null } {
	const raw = (wanted ?? "").trim();
	if (raw) {
		const value = raw.replace(/^#/, "").trim().toLowerCase();
		const match =
			options.find((o) => String(o.id) === value) ??
			options.find((o) => (o.name ?? "").toLowerCase() === value);
		if (match) return { channelId: String(match.id), unmatched: null };
		if (options.length === 0 && /^\d+$/.test(value)) {
			return { channelId: value, unmatched: null };
		}
		return { channelId: null, unmatched: raw };
	}
	const saved = savedDefault ? String(savedDefault) : "";
	if (saved && (options.length === 0 || options.some((o) => String(o.id) === saved))) {
		return { channelId: saved, unmatched: null };
	}
	return { channelId: null, unmatched: null };
}

/**
 * Why a post to these Discord servers cannot go out yet, or null when every
 * selected server has a text channel chosen.
 */
export function discordSelectionError(
	servers: Array<{ id: string; accountName: string }>,
	picks: Record<string, string | null | undefined>
): string | null {
	const missing = servers.find((s) => !picks[s.id]);
	if (!missing) return null;
	return `Choose which Discord channel to post in for "${missing.accountName}".`;
}

// ---------------------------------------------------------------------------
// Per-destination publish status
// ---------------------------------------------------------------------------

/**
 * Statuses a destination does not leave on its own. `unconfirmed` means the
 * platform could not confirm the post: it may or may not be live, and it is
 * never retried automatically.
 */
export const TERMINAL_PLATFORM_STATUSES = ["published", "failed", "unconfirmed"];

export function isTerminalPlatformStatus(status: string | null | undefined): boolean {
	return TERMINAL_PLATFORM_STATUSES.includes(status ?? "");
}

/** Only `published` counts as success. */
export function platformOutcome(
	status: string | null | undefined
): "published" | "failed" | "unconfirmed" | "pending" {
	if (status === "published") return "published";
	if (status === "failed") return "failed";
	if (status === "unconfirmed") return "unconfirmed";
	return "pending";
}

export const UNCONFIRMED_MESSAGE =
	"The platform could not confirm the post. Check the account before retrying, " +
	"or it may post twice.";
