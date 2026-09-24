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
	approvalAwareMessage,
	approvalLabel,
	approvalOutcome,
	buildPostBody,
	buildCaption,
	Channel,
	ChannelSet,
	containsUrl,
	estimateXCost,
	extractEmbeds,
	EmbeddedMedia,
	formatDcents,
	parseBulkPublishFrontmatter,
	parseScheduleInput,
	platformLabel,
	resolveTargets,
	reviewErrorMessage,
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
	/** Preselect "Request approval" in the publish modal for scheduled posts. */
	requestApproval: boolean;
}

const DEFAULT_SETTINGS: BulkPublishSettings = {
	apiKey: "",
	baseUrl: DEFAULT_BASE_URL,
	defaultChannels: "",
	stripMarkdown: true,
	appendShareUrl: false,
	requestApproval: false,
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

		this.addCommand({
			id: "review-approvals",
			name: "Review posts awaiting approval…",
			callback: () => {
				if (!this.settings.apiKey.trim()) {
					new Notice(
						"BulkPublish: no API key set. Add one in Settings → BulkPublish."
					);
					return;
				}
				new ApprovalQueueModal(this.app, this).open();
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
			frontmatterRequestApproval: fm.requestApproval,
			frontmatterLinkTracking: fm.linkTracking,
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
				'Comma-separated names preselected in the publish modal, e.g. "x, linkedin". ' +
					"Names match a saved channel set first (sets are unique per organization, max 50), " +
					"then a platform or account name. A note can override this with a " +
					"bulkpublish-channels frontmatter list."
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

		new Setting(containerEl)
			.setName("Request approval")
			.setDesc(
				"Preselect “Request approval” in the publish modal: the post is held for a " +
					"teammate to review (approval status becomes “pending”) instead of going out at its " +
					"scheduled time, or right away if it has none. If your role can't publish (contributor), the server holds scheduled " +
					"posts for approval whether or not this is on. A note can override this with " +
					"bulkpublish-request-approval frontmatter."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.requestApproval)
					.onChange(async (value) => {
						this.plugin.settings.requestApproval = value;
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
	frontmatterRequestApproval: boolean | null;
	frontmatterLinkTracking: boolean | null;
}

class PublishModal extends Modal {
	private caption: string;
	private scheduleInput: string;
	private requestApproval: boolean;
	/** Tri-state: true/false override, null = inherit the org setting. */
	private linkTracking: boolean | null;
	private approvalHintEl: HTMLElement | null = null;
	private selectedChannelIds = new Set<string>();
	private includedEmbeds = new Set<string>(); // by link
	private channels: Channel[] = [];
	private channelSets: ChannelSet[] = [];
	private channelCheckboxes = new Map<string, HTMLInputElement>();
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
		this.requestApproval =
			input.frontmatterRequestApproval ?? plugin.settings.requestApproval;
		// No plugin-setting fallback: null already means "use the organization's
		// Link Tracking setting", which is the account-wide control.
		this.linkTracking = input.frontmatterLinkTracking ?? null;
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

		// --- Team approval ---
		const approvalSection = contentEl.createDiv({ cls: "bp-section" });
		const approvalRow = approvalSection.createDiv({ cls: "bp-approval-row" });
		const approvalCb = approvalRow.createEl("input", { type: "checkbox" });
		approvalCb.checked = this.requestApproval;
		approvalRow.createSpan({ text: "Request approval before publishing" });
		this.approvalHintEl = approvalSection.createDiv({ cls: "bp-hint" });
		approvalCb.addEventListener("change", () => {
			this.requestApproval = approvalCb.checked;
			this.refreshApprovalHint();
		});

		// --- Link tracking ---
		// A dropdown rather than a checkbox: the value is tri-state, and the
		// default must stay "inherit the organization setting" rather than off.
		const linkSection = contentEl.createDiv({ cls: "bp-section" });
		const linkRow = linkSection.createDiv({ cls: "bp-approval-row" });
		linkRow.createSpan({ text: "Link tracking" });
		const linkSelect = linkRow.createEl("select");
		for (const [value, label] of [
			["inherit", "Use organization setting"],
			["on", "On — shorten links, count clicks"],
			["off", "Off — links as written"],
		] as Array<[string, string]>) {
			const opt = linkSelect.createEl("option", { text: label });
			opt.value = value;
		}
		linkSelect.value =
			this.linkTracking === true ? "on" : this.linkTracking === false ? "off" : "inherit";
		linkSection.createDiv({
			cls: "bp-hint",
			text:
				"Shortens links through bulkpubli.sh and counts clicks. Skipped on a channel if the " +
				"rewrite would push the post over that platform's character limit.",
		});
		linkSelect.addEventListener("change", () => {
			this.linkTracking =
				linkSelect.value === "on" ? true : linkSelect.value === "off" ? false : null;
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
		const client = this.plugin.client();
		try {
			this.channels = await client.getChannels();
		} catch (err) {
			container.empty();
			container.createSpan({
				text: `Could not load channels: ${errMessage(err)}`,
				cls: "bp-error-text",
			});
			return;
		}
		// Channel sets are optional sugar — never block the modal on them.
		try {
			this.channelSets = await client.listChannelSets();
		} catch {
			this.channelSets = [];
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
		// Names match a channel set first, then a platform or account name.
		const wanted =
			this.input.frontmatterChannels.length > 0
				? this.input.frontmatterChannels
				: this.plugin.settings.defaultChannels
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
		const { channelIds, unmatched } = resolveTargets(
			wanted,
			this.channels,
			this.channelSets
		);
		for (const id of channelIds) this.selectedChannelIds.add(id);
		if (unmatched.length > 0 && this.input.frontmatterChannels.length > 0) {
			container.createDiv({
				cls: "bp-error-text",
				text: `No active channel or channel set matches frontmatter: ${unmatched.join(", ")}`,
			});
		}

		// Quick-select buttons: one per saved channel set.
		if (this.channelSets.length > 0) {
			const setsRow = container.createDiv({ cls: "bp-channel-sets" });
			for (const set of this.channelSets) {
				const btn = setsRow.createEl("button", {
					text: set.name,
					cls: "bp-set-btn",
					attr: { type: "button", title: "Select this channel set's channels" },
				});
				btn.addEventListener("click", () => this.applyChannelSet(set));
			}
		}

		this.channelCheckboxes.clear();
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
			this.channelCheckboxes.set(channel.id, cb);
			row.createSpan({
				text: `${platformLabel(channel.platform)} — ${channel.accountName}`,
			});
		}

		this.refreshValidation();
		this.refreshPreview();
	}

	/** Select exactly the channels of a saved set (active channels only). */
	private applyChannelSet(set: ChannelSet) {
		this.selectedChannelIds.clear();
		const wanted = new Set(set.channelIds.map(String));
		for (const [id, cb] of this.channelCheckboxes) {
			const on = wanted.has(id);
			cb.checked = on;
			if (on) this.selectedChannelIds.add(id);
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
		this.refreshApprovalHint();
	}

	private refreshApprovalHint() {
		const el = this.approvalHintEl;
		if (!el) return;
		el.removeClass("bp-error-text");
		if (!this.requestApproval) {
			el.setText(
				"Off: the post goes out at its scheduled time. Contributors' scheduled posts are always held for approval."
			);
		} else if (!this.scheduleInput.trim()) {
			el.setText(
				"The post is submitted for now and held with approval status “pending” — it does not " +
					"publish until a teammate (owner, admin or approver) approves it, and it publishes " +
					"as soon as it is approved."
			);
		} else {
			el.setText(
				"The post is held with approval status “pending” and does not publish until a teammate " +
					"(owner, admin or approver) approves it. Approved in time, it publishes as scheduled " +
					"(or right away if its time passed less than 15 minutes ago); approved later, it is " +
					"kept as a draft for you to reschedule."
			);
		}
		this.refreshPublishLabel2();
	}

	/** Publish button label: depends on both schedule and approval. */
	private refreshPublishLabel2() {
		if (!this.publishBtn) return;
		const scheduled = !!this.scheduleInput.trim();
		this.publishBtn.setText(
			this.requestApproval ? "Submit for approval" : scheduled ? "Schedule" : "Publish"
		);
	}

	private refreshPreview() {
		if (!this.previewEl) return;
		this.previewEl.empty();

		if (this.quota) {
			const { limits, usage, plan } = this.quota;
			// Limits are -1 on unlimited plans (business): show ∞, never warn.
			const fmtLimit = (n: number) => (n < 0 ? "∞" : String(n));
			this.previewEl.createDiv({
				text: `Plan: ${plan} — posts today ${usage.postsToday}/${fmtLimit(limits.postsPerDay)}, this month ${usage.postsThisMonth}/${fmtLimit(limits.postsPerMonth)}`,
			});
			if (
				(limits.postsPerDay >= 0 && usage.postsToday >= limits.postsPerDay) ||
				(limits.postsPerMonth >= 0 && usage.postsThisMonth >= limits.postsPerMonth)
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
				mediaIds.push(
					await client.uploadMedia(embed.name, data, embed.extension, (done, total) => {
						this.publishBtn.setText(`Uploading ${embed.name}… (part ${done}/${total})`);
					})
				);
			}

			// 2) Create the post
			const wantsApproval = this.requestApproval;
			this.publishBtn.setText(
				wantsApproval ? "Submitting…" : scheduledAt ? "Scheduling…" : "Publishing…"
			);
			// An approval request without a schedule goes as scheduled-for-now,
			// never as a draft: the API ignores requestApproval on a draft, and
			// the draft would then be published below with no review.
			const created = await client.createPost(
				buildPostBody({
					caption: this.caption,
					channelIds,
					mediaIds,
					scheduledAt,
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					requestApproval: wantsApproval,
					linkTracking: this.linkTracking,
				})
			);

			// The server can force approval even when we didn't ask (roles
			// without post:publish always get 'pending'), so trust the response.
			const approval = created.approvalStatus ?? (wantsApproval ? "pending" : "none");

			// 3) Publish now (only an unheld draft) and poll for outcomes
			let finalStatus =
				created.status ?? (scheduledAt || wantsApproval ? "scheduled" : "draft");
			if (!scheduledAt && !wantsApproval && approval !== "pending") {
				await client.publishPost(created.id);
				const detail = await this.pollOutcomes(created.id);
				finalStatus = detail?.status ?? "publishing";
				this.renderOutcomes(detail);
			} else if (scheduledAt) {
				this.resultsEl.createDiv({
					cls: "bp-result-ok",
					text: `Scheduled for ${new Date(scheduledAt).toLocaleString()} (post ${created.id}).`,
				});
			}
			if (approval === "pending") {
				this.resultsEl.createDiv({
					text:
						"Held for team approval — it will not publish until an owner, admin or approver " +
						"approves it in BulkPublish (or via “Review posts awaiting approval…”).",
				});
			}

			// 4) Write results back into frontmatter
			await this.writeFrontmatter(created.id, finalStatus, approval);

			new Notice(
				approval === "pending"
					? "BulkPublish: submitted for approval."
					: scheduledAt
						? "BulkPublish: post scheduled."
						: "BulkPublish: post submitted."
			);
			this.publishBtn.setText("Done");
		} catch (err) {
			this.resultsEl.createDiv({
				cls: "bp-error-text",
				text: `Failed: ${errMessage(err)}`,
			});
			if (err instanceof BulkPublishError && err.code === "APPROVAL_REQUIRED") {
				this.resultsEl.createDiv({
					cls: "bp-error-text",
					text:
						"Tip: tick “Request approval” — the post will be queued for a teammate to approve.",
				});
			}
			this.publishBtn.disabled = false;
			this.refreshPublishLabel2();
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

	private async writeFrontmatter(postId: string, status: string, approval?: string) {
		const file = this.input.file;
		if (!file) return;
		try {
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm["bulkpublish-post-id"] = postId;
				fm["bulkpublish-status"] = status;
				if (approval && approval !== "none") {
					fm["bulkpublish-approval"] = approval;
				}
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
// Approval queue modal
// ---------------------------------------------------------------------------

/**
 * Lists posts with approvalStatus "pending" (GET /api/posts?approvalStatus=pending)
 * and offers Approve / Reject. Both endpoints need a role with post:approve
 * (owner, admin, approver) — other roles get a 403.
 */
class ApprovalQueueModal extends Modal {
	private listEl!: HTMLElement;

	constructor(app: App, private plugin: BulkPublishPlugin) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("bp-modal");
		contentEl.createEl("h2", { text: "Posts awaiting approval" });
		this.listEl = contentEl.createDiv({ cls: "bp-approval-list" });
		this.listEl.setText("Loading…");
		void this.load();
	}

	private async load() {
		try {
			const posts = await this.plugin
				.client()
				.listPosts({ approvalStatus: "pending" });
			this.render(posts);
		} catch (err) {
			this.listEl.empty();
			this.listEl.createDiv({
				cls: "bp-error-text",
				text: `Could not load the approval queue: ${errMessage(err)}`,
			});
		}
	}

	private render(posts: PostDetail[]) {
		this.listEl.empty();
		if (posts.length === 0) {
			this.listEl.setText("Nothing is waiting for approval.");
			return;
		}
		for (const post of posts) {
			const row = this.listEl.createDiv({ cls: "bp-approval-item" });
			const excerpt = (post.content ?? "").replace(/\s+/g, " ").trim();
			row.createDiv({
				cls: "bp-approval-excerpt",
				text: excerpt.length > 140 ? `${excerpt.slice(0, 140)}…` : excerpt || "(no caption)",
			});
			const meta = [`post ${post.id}`, approvalLabel(post.approvalStatus)];
			if (post.scheduledAt) {
				meta.push(`scheduled ${new Date(post.scheduledAt).toLocaleString()}`);
			}
			row.createDiv({ cls: "bp-hint", text: meta.join(" · ") });
			if (post.rejectionReason) {
				row.createDiv({
					cls: "bp-hint",
					text: `Previous rejection: ${post.rejectionReason}`,
				});
			}

			const actions = row.createDiv({ cls: "bp-buttons" });
			const approveBtn = actions.createEl("button", { text: "Approve" });
			const rejectBtn = actions.createEl("button", { text: "Reject…" });
			const status = row.createDiv();

			approveBtn.addEventListener("click", async () => {
				approveBtn.disabled = rejectBtn.disabled = true;
				try {
					const approved = await this.plugin.client().approvePost(post.id, post.updatedAt);
					const outcome = approvalOutcome(approved);
					status.removeClass("bp-error-text");
					status.addClass(outcome.ok ? "bp-result-ok" : "bp-hint");
					status.setText(outcome.text);
				} catch (err) {
					const conflict = err instanceof BulkPublishError && err.status === 409;
					// A 409 means the post changed or was already decided; retrying cannot help.
					approveBtn.disabled = rejectBtn.disabled = conflict;
					status.addClass("bp-error-text");
					status.setText(
						reviewErrorMessage(
							"Approve",
							err instanceof BulkPublishError ? err.status : undefined,
							errMessage(err)
						)
					);
				}
			});

			rejectBtn.addEventListener("click", () => {
				new RejectReasonModal(this.app, async (reason) => {
					approveBtn.disabled = rejectBtn.disabled = true;
					try {
						await this.plugin.client().rejectPost(post.id, reason, post.updatedAt);
						status.removeClass("bp-result-ok");
						status.setText("Rejected — back to draft; the author was notified.");
					} catch (err) {
						const conflict = err instanceof BulkPublishError && err.status === 409;
						approveBtn.disabled = rejectBtn.disabled = conflict;
						status.addClass("bp-error-text");
						status.setText(
							reviewErrorMessage(
								"Reject",
								err instanceof BulkPublishError ? err.status : undefined,
								errMessage(err)
							)
						);
					}
				}).open();
			});
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Prompts for an optional rejection reason (max 2000 chars, shown to the author). */
class RejectReasonModal extends Modal {
	constructor(app: App, private onSubmit: (reason: string) => void | Promise<void>) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Reject post" });
		contentEl.createDiv({
			cls: "bp-hint",
			text: "Optional reason — shown to the author in-app and on the post (max 2000 characters).",
		});
		const textarea = contentEl.createEl("textarea", { cls: "bp-caption" });
		textarea.rows = 4;
		textarea.maxLength = 2000;

		const buttons = contentEl.createDiv({ cls: "bp-buttons" });
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const confirm = buttons.createEl("button", { text: "Reject" });
		confirm.addEventListener("click", () => {
			this.close();
			void this.onSubmit(textarea.value);
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errMessage(err: unknown): string {
	if (err instanceof BulkPublishError) {
		return approvalAwareMessage(err.code, err.message);
	}
	if (err instanceof Error) return err.message;
	return String(err);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
