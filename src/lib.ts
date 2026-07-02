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
