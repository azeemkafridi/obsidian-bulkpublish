/**
 * Thin BulkPublish API client built on Obsidian's requestUrl (no CORS issues).
 */
import { requestUrl, RequestUrlParam } from "obsidian";
import type { Channel, ChannelSet, XCosts } from "./lib";
import { computeParts } from "./lib";

export const DEFAULT_BASE_URL = "https://app.bulkpublish.com";

/**
 * Files larger than this go through the chunked multipart flow
 * (create → PUT 10 MB parts → complete). Videos are accepted up to 1 GB,
 * images up to 100 MB.
 */
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100 MB

export interface MultipartCreateResponse {
	r2Key: string;
	uploadId: string;
	/** Fixed by the server: 10485760 (10 MB). */
	partSize: number;
	/** One presigned PUT URL per part, in order. */
	partUrls: string[];
	expiresIn: number;
}

export interface QuotaUsage {
	plan: string;
	limits: { postsPerDay: number; postsPerMonth: number };
	usage: { postsToday: number; postsThisMonth: number };
}

export interface XUsage {
	credits: { balanceDcents: number };
	costs: XCosts;
}

export interface PostPlatformResult {
	platform: string;
	status: string;
	errorMessage?: string | null;
	platformUrl?: string | null;
}

/**
 * Team approval state, orthogonal to `status`. 'pending' and 'rejected' posts
 * are skipped by the scheduler even when scheduled and overdue; approving
 * releases them (an overdue post publishes immediately on approval).
 */
export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";

export interface PostDetail {
	id: string;
	status: string;
	content?: string;
	scheduledAt?: string | null;
	approvalStatus?: ApprovalStatus;
	/** User ID of the approver (set when approvalStatus is 'approved'). */
	approvedBy?: string | null;
	approvedAt?: string | null;
	/** Reviewer's reason when approvalStatus is 'rejected'. */
	rejectionReason?: string | null;
	postPlatforms?: PostPlatformResult[];
}

export interface CreatePostBody {
	content: string;
	channels: { channelId: string }[];
	mediaFiles?: string[];
	status: "draft" | "scheduled";
	scheduledAt?: string;
	timezone?: string;
	/**
	 * Optional. Set true to hold a scheduled post for team approval
	 * (approvalStatus becomes 'pending'). Forced on server-side for roles
	 * without post:publish (contributors), regardless of this flag.
	 */
	requestApproval?: boolean;
	/**
	 * Optional per-post override for bulkpubli.sh link tracking. true forces the
	 * post's links to be shortened and their clicks counted, false forces them
	 * to publish as written. Omit to inherit the organization's setting —
	 * omitting is NOT the same as sending false.
	 */
	linkTrackingOverride?: boolean;
}

export class BulkPublishError extends Error {
	code?: string;
	status?: number;
	constructor(message: string, code?: string, status?: number) {
		super(message);
		this.name = "BulkPublishError";
		this.code = code;
		this.status = status;
	}
}

const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	m4v: "video/x-m4v",
};

export function mimeForExtension(ext: string): string {
	return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

export class BulkPublishClient {
	constructor(
		private apiKey: string,
		private baseUrl: string = DEFAULT_BASE_URL
	) {}

	private async request<T>(params: {
		method: string;
		path: string;
		json?: unknown;
		body?: ArrayBuffer;
		contentType?: string;
	}): Promise<T> {
		if (!this.apiKey) {
			throw new BulkPublishError(
				"No API key configured. Add one in Settings → BulkPublish."
			);
		}
		const req: RequestUrlParam = {
			url: `${this.baseUrl}${params.path}`,
			method: params.method,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
			throw: false,
		};
		if (params.json !== undefined) {
			req.headers!["Content-Type"] = "application/json";
			req.body = JSON.stringify(params.json);
		} else if (params.body !== undefined) {
			req.headers!["Content-Type"] = params.contentType ?? "application/octet-stream";
			req.body = params.body;
		}

		const res = await requestUrl(req);
		let data: any = null;
		try {
			data = res.json;
		} catch {
			// non-JSON response body
		}
		if (res.status >= 400) {
			const message =
				data?.error?.message ?? `BulkPublish API error (HTTP ${res.status})`;
			throw new BulkPublishError(message, data?.error?.code, res.status);
		}
		return data as T;
	}

	async getChannels(): Promise<Channel[]> {
		const data = await this.request<{ channels: Channel[] }>({
			method: "GET",
			path: "/api/channels",
		});
		return data.channels ?? [];
	}

	/**
	 * List saved channel sets (GET /api/channel-sets). An org can have at most
	 * 50 sets and set names are unique per org, so a set name is a reliable
	 * targeting alias.
	 */
	async listChannelSets(): Promise<ChannelSet[]> {
		const data = await this.request<ChannelSet[]>({
			method: "GET",
			path: "/api/channel-sets",
		});
		return Array.isArray(data) ? data : [];
	}

	async getQuotaUsage(): Promise<QuotaUsage> {
		return this.request<QuotaUsage>({ method: "GET", path: "/api/quotas/usage" });
	}

	async getXUsage(): Promise<XUsage> {
		return this.request<XUsage>({ method: "GET", path: "/api/quotas/x-usage" });
	}

	async createPost(body: CreatePostBody): Promise<PostDetail> {
		return this.request({ method: "POST", path: "/api/posts", json: body });
	}

	async publishPost(id: string): Promise<PostDetail> {
		return this.request({ method: "POST", path: `/api/posts/${id}/publish`, json: {} });
	}

	async getPost(id: string): Promise<PostDetail> {
		return this.request({ method: "GET", path: `/api/posts/${id}` });
	}

	/**
	 * List posts, optionally filtered by team approval state
	 * (e.g. 'pending' for the approval queue).
	 */
	async listPosts(opts: {
		approvalStatus?: ApprovalStatus;
		limit?: number;
	} = {}): Promise<PostDetail[]> {
		const query = new URLSearchParams();
		if (opts.approvalStatus) query.set("approvalStatus", opts.approvalStatus);
		query.set("limit", String(opts.limit ?? 50));
		const data = await this.request<{ posts?: PostDetail[] } | PostDetail[]>({
			method: "GET",
			path: `/api/posts?${query.toString()}`,
		});
		if (Array.isArray(data)) return data;
		return data?.posts ?? [];
	}

	/**
	 * Approve a pending post. Requires a role with post:approve (owner, admin,
	 * approver) — otherwise the API returns 403. The post publishes at its
	 * scheduled time, or immediately if that time has already passed.
	 */
	async approvePost(id: string): Promise<PostDetail> {
		return this.request({ method: "POST", path: `/api/posts/${id}/approve`, json: {} });
	}

	/**
	 * Reject a pending post: it returns to draft with approvalStatus 'rejected'
	 * and the optional reason, and the author is notified.
	 */
	async rejectPost(id: string, reason?: string): Promise<PostDetail> {
		const trimmed = (reason ?? "").trim();
		return this.request({
			method: "POST",
			path: `/api/posts/${id}/reject`,
			json: trimmed ? { reason: trimmed.slice(0, 2000) } : {},
		});
	}

	/**
	 * Upload a media file and return its media ID. Files up to
	 * MULTIPART_THRESHOLD go as a single multipart/form-data POST; larger files
	 * (vault videos up to 1 GB) use the chunked multipart flow.
	 */
	async uploadMedia(
		fileName: string,
		data: ArrayBuffer,
		extension: string,
		onProgress?: (done: number, total: number) => void
	): Promise<string> {
		if (data.byteLength > MULTIPART_THRESHOLD) {
			return this.uploadMediaMultipart(fileName, data, extension, onProgress);
		}
		return this.uploadMediaSimple(fileName, data, extension);
	}

	/** Single-request upload as multipart/form-data (field name "file"). */
	private async uploadMediaSimple(
		fileName: string,
		data: ArrayBuffer,
		extension: string
	): Promise<string> {
		const boundary = `----BulkPublishObsidian${Date.now().toString(36)}${Math.random()
			.toString(36)
			.slice(2)}`;
		const mime = mimeForExtension(extension);
		const encoder = new TextEncoder();
		const safeName = fileName.replace(/"/g, "'");
		const head = encoder.encode(
			`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
				`Content-Type: ${mime}\r\n\r\n`
		);
		const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
		const payload = new Uint8Array(head.length + data.byteLength + tail.length);
		payload.set(head, 0);
		payload.set(new Uint8Array(data), head.length);
		payload.set(tail, head.length + data.byteLength);

		const res = await this.request<{ file: { id: string } }>({
			method: "POST",
			path: "/api/media",
			body: payload.buffer as ArrayBuffer,
			contentType: `multipart/form-data; boundary=${boundary}`,
		});
		return res.file.id;
	}

	/**
	 * Chunked upload for large files: create → PUT each fixed 10 MB part to its
	 * presigned URL, collecting exactly one ETag per part → complete. On any
	 * failure the upload is aborted, which frees the parts already stored.
	 * Individual part PUTs are retried once, so a network blip never restarts
	 * the whole file.
	 */
	private async uploadMediaMultipart(
		fileName: string,
		data: ArrayBuffer,
		extension: string,
		onProgress?: (done: number, total: number) => void
	): Promise<string> {
		const mime = mimeForExtension(extension);
		const created = await this.request<MultipartCreateResponse>({
			method: "POST",
			path: "/api/media/multipart/create",
			json: { contentType: mime, sizeBytes: data.byteLength },
		});

		try {
			const parts = computeParts(data.byteLength, created.partSize);
			const etags: { partNumber: number; etag: string }[] = [];
			for (const part of parts) {
				const url = created.partUrls[part.partNumber - 1];
				if (!url) {
					throw new BulkPublishError(
						`Missing presigned URL for part ${part.partNumber}.`
					);
				}
				const slice = data.slice(part.start, part.end);
				const etag = await this.putPart(url, slice);
				etags.push({ partNumber: part.partNumber, etag });
				onProgress?.(part.partNumber, parts.length);
			}

			const res = await this.request<{ file: { id: string } }>({
				method: "POST",
				path: "/api/media/multipart/complete",
				json: {
					r2Key: created.r2Key,
					uploadId: created.uploadId,
					parts: etags,
					fileName,
					mimeType: mime,
					sizeBytes: data.byteLength,
				},
			});
			return res.file.id;
		} catch (err) {
			// Best-effort abort so stored parts are freed; original error wins.
			try {
				await this.request({
					method: "POST",
					path: "/api/media/multipart/abort",
					json: { r2Key: created.r2Key, uploadId: created.uploadId },
				});
			} catch {
				// ignore — server sweeps stale multipart uploads
			}
			throw err;
		}
	}

	/** PUT one part to its presigned URL (no auth header) and return its ETag. One retry. */
	private async putPart(url: string, body: ArrayBuffer, attempt = 0): Promise<string> {
		try {
			const res = await requestUrl({
				url,
				method: "PUT",
				body,
				throw: false,
			});
			if (res.status >= 400) {
				throw new BulkPublishError(
					`Part upload failed (HTTP ${res.status}).`,
					undefined,
					res.status
				);
			}
			const etag = res.headers["etag"] ?? res.headers["ETag"] ?? res.headers["Etag"];
			if (!etag) {
				throw new BulkPublishError("Storage did not return an ETag for a part.");
			}
			return etag.replace(/"/g, "");
		} catch (err) {
			if (attempt < 1) return this.putPart(url, body, attempt + 1);
			throw err;
		}
	}
}
