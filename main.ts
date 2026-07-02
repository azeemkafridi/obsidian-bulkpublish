import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import {
	buildCaption,
	Channel,
	containsUrl,
	estimateXCost,
	extractEmbeds,
	EmbeddedMedia,
	formatDcents,
	parseBulkPublishFrontmatter,
	parseScheduleInput,
	platformLabel,
	resolveChannels,
	splitFrontmatter,
	validateCharLimits,
} from "./src/lib";
import {
	BulkPublishClient,
	BulkPublishError,
	DEFAULT_BASE_URL,
	PostDetail,
	QuotaUsage,
	XUsage,
} from "./src/api";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface BulkPublishSettings {
	apiKey: string;
	baseUrl: string;
	defaultChannels: string; // comma-separated platform names, e.g. "x, linkedin"
	stripMarkdown: boolean;
	appendShareUrl: boolean;
}

const DEFAULT_SETTINGS: BulkPublishSettings = {
	apiKey: "",
	baseUrl: DEFAULT_BASE_URL,
	defaultChannels: "",
	stripMarkdown: true,
	appendShareUrl: false,
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class BulkPublishPlugin extends Plugin {
	settings: BulkPublishSettings = DEFAULT_SETTINGS;

	client(): BulkPublishClient {
		return new BulkPublishClient(
			this.settings.apiKey.trim(),
			(this.settings.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")
		);
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new BulkPublishSettingTab(this.app, this));

		this.addCommand({
			id: "publish-note",
			name: "Publish note to social…",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.openPublishModal(file, null);
				return true;
			},
		});

		this.addCommand({
			id: "publish-selection",
			name: "Publish selection to social…",
			editorCheckCallback: (checking, editor: Editor, view) => {
				const selection = editor.getSelection();
				if (!selection || !selection.trim()) return false;
				const file = view instanceof MarkdownView ? view.file : null;
				if (!checking) this.openPublishModal(file, selection);
				return true;
			},
		});
	}

	async openPublishModal(file: TFile | null, selection: string | null) {
		if (!this.settings.apiKey.trim()) {
			new Notice(
				"BulkPublish: no API key set. Add one in Settings → BulkPublish."
			);
			return;
		}

		let rawBody: string;
		let fmText: string | null = null;
		if (selection !== null) {
			rawBody = selection;
			if (file) {
				const content = await this.app.vault.cachedRead(file);
				fmText = splitFrontmatter(content).frontmatter;
			}
		} else if (file) {
			const content = await this.app.vault.cachedRead(file);
			const split = splitFrontmatter(content);
			rawBody = split.body;
			fmText = split.frontmatter;
		} else {
			new Notice("BulkPublish: no active note.");
			return;
		}

		const fm = parseBulkPublishFrontmatter(fmText);
		const caption = buildCaption(rawBody, {
			stripMarkdown: this.settings.stripMarkdown,
			appendShareUrl: this.settings.appendShareUrl,
			shareUrl: fm.shareUrl,
		});
		const embeds = extractEmbeds(rawBody);

		new PublishModal(this.app, this, {
			file,
			caption,
			embeds,
			frontmatterChannels: fm.channels,
			frontmatterSchedule: fm.schedule,
		}).open();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

class BulkPublishSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: BulkPublishPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("API key")
			.setDesc(
				"Create a key at app.bulkpublish.com/developer. Stored in plugin data inside your vault — " +
					"use a dedicated key and revoke it if your vault syncs to untrusted devices."
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("bp_…")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Default channels")
			.setDesc(
				'Comma-separated platform names preselected in the publish modal, e.g. "x, linkedin". ' +
					"A note can override this with a bulkpublish-channels frontmatter list."
			)
			.addText((text) =>
				text
					.setPlaceholder("x, linkedin")
					.setValue(this.plugin.settings.defaultChannels)
					.onChange(async (value) => {
						this.plugin.settings.defaultChannels = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Strip markdown")
			.setDesc(
				"Convert markdown to plain text for captions (headings, bold, links, list markers…). Recommended."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.stripMarkdown)
					.onChange(async (value) => {
						this.plugin.settings.stripMarkdown = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Append note link")
			.setDesc(
				"Vault notes have no public URL, so this appends the note's share-url frontmatter field " +
					"(if present) to the caption. Note: a URL makes X posts cost ~13x more credits."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.appendShareUrl)
					.onChange(async (value) => {
						this.plugin.settings.appendShareUrl = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

// ---------------------------------------------------------------------------
// Publish modal
// ---------------------------------------------------------------------------

interface PublishModalInput {
	file: TFile | null;
	caption: string;
	embeds: EmbeddedMedia[];
	frontmatterChannels: string[];
	frontmatterSchedule: string | null;
}

class PublishModal extends Modal {
	private caption: string;
	private scheduleInput: string;
	private selectedChannelIds = new Set<string>();
	private includedEmbeds = new Set<string>(); // by link
	private channels: Channel[] = [];
	private quota: QuotaUsage | null = null;
	private xUsage: XUsage | null = null;
	private publishing = false;

	private validationEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private resultsEl!: HTMLElement;
	private publishBtn!: HTMLButtonElement;

	constructor(
		app: App,
		private plugin: BulkPublishPlugin,
		private input: PublishModalInput
	) {
		super(app);
		this.caption = input.caption;
		this.scheduleInput = input.frontmatterSchedule ?? "";
		for (const e of input.embeds) this.includedEmbeds.add(e.link);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("bp-modal");

		contentEl.createEl("h2", { text: "Publish to social" });

		// --- Caption ---
		const captionSection = contentEl.createDiv({ cls: "bp-section" });
		captionSection.createEl("label", { text: "Caption", cls: "bp-label" });
		const textarea = captionSection.createEl("textarea", { cls: "bp-caption" });
		textarea.value = this.caption;
		textarea.rows = 8;
		const counter = captionSection.createDiv({ cls: "bp-counter" });
		const updateCounter = () => {
			counter.setText(`${[...this.caption].length} characters`);
		};
		textarea.addEventListener("input", () => {
			this.caption = textarea.value;
			updateCounter();
			this.refreshValidation();
			this.refreshPreview();
		});
		updateCounter();

		// --- Channels ---
		const channelSection = contentEl.createDiv({ cls: "bp-section" });
		channelSection.createEl("label", { text: "Channels", cls: "bp-label" });
		const channelList = channelSection.createDiv({ cls: "bp-channels" });
		channelList.setText("Loading channels…");

		// --- Schedule ---
		const scheduleSection = contentEl.createDiv({ cls: "bp-section" });
		scheduleSection.createEl("label", {
			text: "Schedule (optional)",
			cls: "bp-label",
		});
		const scheduleField = scheduleSection.createEl("input", {
			type: "datetime-local",
			cls: "bp-schedule",
		});
		if (this.scheduleInput) scheduleField.value = this.scheduleInput.slice(0, 16);
		scheduleField.addEventListener("input", () => {
			this.scheduleInput = scheduleField.value;
			this.refreshPublishLabel();
		});
		scheduleSection.createDiv({
			cls: "bp-hint",
			text: "Leave empty to publish immediately.",
		});

		// --- Embedded media ---
		if (this.input.embeds.length > 0) {
			const mediaSection = contentEl.createDiv({ cls: "bp-section" });
			mediaSection.createEl("label", {
				text: "Embedded media",
				cls: "bp-label",
			});
			for (const embed of this.input.embeds) {
				const row = mediaSection.createDiv({ cls: "bp-media-row" });
				const cb = row.createEl("input", { type: "checkbox" });
				cb.checked = true;
				cb.addEventListener("change", () => {
					if (cb.checked) this.includedEmbeds.add(embed.link);
					else this.includedEmbeds.delete(embed.link);
					this.refreshPreview();
				});
				row.createSpan({ text: embed.name, cls: "bp-media-name" });
				const resolved = this.resolveEmbed(embed);
				if (!resolved) {
					row.createSpan({ text: " (not found in vault)", cls: "bp-error-text" });
					cb.checked = false;
					cb.disabled = true;
					this.includedEmbeds.delete(embed.link);
				}
			}
		}

		// --- Validation messages ---
		this.validationEl = contentEl.createDiv({ cls: "bp-validation" });

		// --- Before you publish ---
		const previewSection = contentEl.createDiv({ cls: "bp-section bp-preview" });
		previewSection.createEl("div", {
			text: "Before you publish",
			cls: "bp-preview-title",
		});
		this.previewEl = previewSection.createDiv();
		this.previewEl.setText("Loading usage…");

		// --- Results (per-platform outcomes after publish) ---
		this.resultsEl = contentEl.createDiv({ cls: "bp-results" });

		// --- Buttons ---
		const buttons = contentEl.createDiv({ cls: "bp-buttons" });
		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
		this.publishBtn = buttons.createEl("button", {
			text: "Publish",
			cls: "bp-publish-btn",
		});
		this.publishBtn.addEventListener("click", () => void this.publish());
		this.refreshPublishLabel();

		// --- Async loads ---
		void this.loadChannels(channelList);
		void this.loadUsage();
	}

	private resolveEmbed(embed: EmbeddedMedia): TFile | null {
		const sourcePath = this.input.file?.path ?? "";
		const dest = this.app.metadataCache.getFirstLinkpathDest(embed.link, sourcePath);
		return dest instanceof TFile ? dest : null;
	}

	private async loadChannels(container: HTMLElement) {
		try {
			this.channels = await this.plugin.client().getChannels();
		} catch (err) {
			container.empty();
			container.createSpan({
				text: `Could not load channels: ${errMessage(err)}`,
				cls: "bp-error-text",
			});
			return;
		}

		container.empty();
		const active = this.channels.filter((c) => c.isActive);
		if (active.length === 0) {
			container.setText(
				"No active channels. Connect accounts at app.bulkpublish.com/channels."
			);
			return;
		}

		// Preselect: frontmatter channels win, else settings default channels.
		const wanted =
			this.input.frontmatterChannels.length > 0
				? this.input.frontmatterChannels
				: this.plugin.settings.defaultChannels
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
		const { channelIds, unmatched } = resolveChannels(wanted, this.channels);
		for (const id of channelIds) this.selectedChannelIds.add(id);
		if (unmatched.length > 0 && this.input.frontmatterChannels.length > 0) {
			container.createDiv({
				cls: "bp-error-text",
				text: `No active channel matches frontmatter: ${unmatched.join(", ")}`,
			});
		}

		for (const channel of active) {
			const row = container.createDiv({ cls: "bp-channel-row" });
			const cb = row.createEl("input", { type: "checkbox" });
			cb.checked = this.selectedChannelIds.has(channel.id);
			cb.addEventListener("change", () => {
				if (cb.checked) this.selectedChannelIds.add(channel.id);
				else this.selectedChannelIds.delete(channel.id);
				this.refreshValidation();
				this.refreshPreview();
			});
			row.createSpan({
				text: `${platformLabel(channel.platform)} — ${channel.accountName}`,
			});
		}

		this.refreshValidation();
		this.refreshPreview();
	}

	private async loadUsage() {
		const client = this.plugin.client();
		const [quota, xUsage] = await Promise.allSettled([
			client.getQuotaUsage(),
			client.getXUsage(),
		]);
		if (quota.status === "fulfilled") this.quota = quota.value;
		if (xUsage.status === "fulfilled") this.xUsage = xUsage.value;
		this.refreshPreview();
	}

	private selectedPlatforms(): string[] {
		return this.channels
			.filter((c) => this.selectedChannelIds.has(c.id))
			.map((c) => c.platform);
	}

	private includedMediaCount(): number {
		return this.input.embeds.filter(
			(e) => this.includedEmbeds.has(e.link) && this.resolveEmbed(e)
		).length;
	}

	private refreshValidation() {
		if (!this.validationEl) return;
		this.validationEl.empty();
		const messages = validateCharLimits(this.caption, this.selectedPlatforms());
		for (const message of messages) {
			this.validationEl.createDiv({ cls: "bp-error-text", text: message });
		}
	}

	private refreshPublishLabel() {
		if (!this.publishBtn) return;
		this.publishBtn.setText(this.scheduleInput.trim() ? "Schedule" : "Publish");
	}

	private refreshPreview() {
		if (!this.previewEl) return;
		this.previewEl.empty();

		if (this.quota) {
			const { limits, usage, plan } = this.quota;
			this.previewEl.createDiv({
				text: `Plan: ${plan} — posts today ${usage.postsToday}/${limits.postsPerDay}, this month ${usage.postsThisMonth}/${limits.postsPerMonth}`,
			});
			if (
				usage.postsToday >= limits.postsPerDay ||
				usage.postsThisMonth >= limits.postsPerMonth
			) {
				this.previewEl.createDiv({
					cls: "bp-error-text",
					text: "You have reached a plan limit — publishing may be rejected.",
				});
			}
		} else {
			this.previewEl.createDiv({ text: "Quota usage unavailable." });
		}

		const platforms = this.selectedPlatforms();
		if (platforms.includes("x")) {
			const mediaCount = this.includedMediaCount();
			const cost = estimateXCost(this.caption, mediaCount, this.xUsage?.costs);
			const parts = [
				`X estimate: ${formatDcents(cost)} (${cost} dcents)`,
				containsUrl(this.caption)
					? "link detected — link posts cost ~13x a plain post"
					: "no link",
			];
			if (mediaCount > 0) parts.push(`${mediaCount} media`);
			this.previewEl.createDiv({ text: parts.join(" · ") });
			if (this.xUsage) {
				const balance = this.xUsage.credits.balanceDcents;
				const line = this.previewEl.createDiv({
					text: `X credit balance: ${formatDcents(balance)} (${balance} dcents)`,
				});
				if (balance < cost) {
					line.addClass("bp-error-text");
					line.setText(
						`X credit balance: ${formatDcents(balance)} — not enough for this post (${formatDcents(cost)} needed).`
					);
				}
			}
		}
	}

	private async publish() {
		if (this.publishing) return;

		const channelIds = [...this.selectedChannelIds];
		if (channelIds.length === 0) {
			new Notice("BulkPublish: select at least one channel.");
			return;
		}
		if (!this.caption.trim() && this.includedMediaCount() === 0) {
			new Notice("BulkPublish: caption is empty and no media selected.");
			return;
		}
		const violations = validateCharLimits(this.caption, this.selectedPlatforms());
		if (violations.length > 0) {
			new Notice(`BulkPublish: ${violations[0]}`);
			return;
		}
		let scheduledAt: string | null = null;
		if (this.scheduleInput.trim()) {
			scheduledAt = parseScheduleInput(this.scheduleInput);
			if (!scheduledAt) {
				new Notice("BulkPublish: invalid schedule date/time.");
				return;
			}
		}

		this.publishing = true;
		this.publishBtn.disabled = true;
		this.publishBtn.setText(scheduledAt ? "Scheduling…" : "Publishing…");
		this.resultsEl.empty();
		const client = this.plugin.client();

		try {
			// 1) Upload included embedded media
			const mediaIds: string[] = [];
			for (const embed of this.input.embeds) {
				if (!this.includedEmbeds.has(embed.link)) continue;
				const tfile = this.resolveEmbed(embed);
				if (!tfile) continue;
				this.publishBtn.setText(`Uploading ${embed.name}…`);
				const data = await this.app.vault.readBinary(tfile);
				mediaIds.push(await client.uploadMedia(embed.name, data, embed.extension));
			}

			// 2) Create the post
			this.publishBtn.setText(scheduledAt ? "Scheduling…" : "Publishing…");
			const created = await client.createPost({
				content: this.caption,
				channels: channelIds.map((channelId) => ({ channelId })),
				mediaFiles: mediaIds.length > 0 ? mediaIds : undefined,
				status: scheduledAt ? "scheduled" : "draft",
				scheduledAt: scheduledAt ?? undefined,
				timezone: scheduledAt
					? Intl.DateTimeFormat().resolvedOptions().timeZone
					: undefined,
			});

			// 3) Publish now (if not scheduled) and poll for outcomes
			let finalStatus = created.status ?? (scheduledAt ? "scheduled" : "draft");
			if (!scheduledAt) {
				await client.publishPost(created.id);
				const detail = await this.pollOutcomes(created.id);
				finalStatus = detail?.status ?? "publishing";
				this.renderOutcomes(detail);
			} else {
				this.resultsEl.createDiv({
					cls: "bp-result-ok",
					text: `Scheduled for ${new Date(scheduledAt).toLocaleString()} (post ${created.id}).`,
				});
			}

			// 4) Write results back into frontmatter
			await this.writeFrontmatter(created.id, finalStatus);

			new Notice(
				scheduledAt
					? "BulkPublish: post scheduled."
					: "BulkPublish: post submitted."
			);
			this.publishBtn.setText("Done");
		} catch (err) {
			this.resultsEl.createDiv({
				cls: "bp-error-text",
				text: `Failed: ${errMessage(err)}`,
			});
			this.publishBtn.disabled = false;
			this.publishBtn.setText(scheduledAt ? "Schedule" : "Publish");
			this.publishing = false;
		}
	}

	/** Poll GET /api/posts/{id} briefly until platforms settle. */
	private async pollOutcomes(postId: string): Promise<PostDetail | null> {
		const client = this.plugin.client();
		let detail: PostDetail | null = null;
		for (let attempt = 0; attempt < 8; attempt++) {
			await sleep(attempt === 0 ? 1000 : 2000);
			try {
				detail = await client.getPost(postId);
			} catch {
				continue;
			}
			const platforms = detail.postPlatforms ?? [];
			const pending = platforms.some(
				(p) => !["published", "failed"].includes(p.status)
			);
			if (platforms.length > 0 && !pending) break;
		}
		return detail;
	}

	private renderOutcomes(detail: PostDetail | null) {
		this.resultsEl.empty();
		this.resultsEl.createEl("div", { text: "Results", cls: "bp-preview-title" });
		const platforms = detail?.postPlatforms ?? [];
		if (platforms.length === 0) {
			this.resultsEl.createDiv({
				text: "Still publishing — check app.bulkpublish.com/posts for final status.",
			});
			return;
		}
		for (const p of platforms) {
			const row = this.resultsEl.createDiv({ cls: "bp-result-row" });
			const ok = p.status === "published";
			row.createSpan({
				text: `${ok ? "✓" : p.status === "failed" ? "✗" : "…"} ${platformLabel(p.platform)}: ${p.status}`,
				cls: ok ? "bp-result-ok" : p.status === "failed" ? "bp-error-text" : "",
			});
			if (p.platformUrl) {
				row.createSpan({ text: " — " });
				row.createEl("a", { text: "view post", href: p.platformUrl });
			}
			if (p.errorMessage) {
				row.createDiv({ cls: "bp-error-text bp-result-error", text: p.errorMessage });
			}
		}
	}

	private async writeFrontmatter(postId: string, status: string) {
		const file = this.input.file;
		if (!file) return;
		try {
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm["bulkpublish-post-id"] = postId;
				fm["bulkpublish-status"] = status;
			});
		} catch (err) {
			console.error("BulkPublish: could not write frontmatter", err);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errMessage(err: unknown): string {
	if (err instanceof BulkPublishError) return err.message;
	if (err instanceof Error) return err.message;
	return String(err);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
