/**
 * Thin BulkPublish API client built on Obsidian's requestUrl (no CORS issues).
 */
import { requestUrl, RequestUrlParam } from "obsidian";
import type { Channel, XCosts } from "./lib";

export const DEFAULT_BASE_URL = "https://app.bulkpublish.com";

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

export interface PostDetail {
	id: string;
	status: string;
	postPlatforms?: PostPlatformResult[];
}

export interface CreatePostBody {
	content: string;
	channels: { channelId: string }[];
	mediaFiles?: string[];
	status: "draft" | "scheduled";
	scheduledAt?: string;
	timezone?: string;
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

	async getQuotaUsage(): Promise<QuotaUsage> {
		return this.request<QuotaUsage>({ method: "GET", path: "/api/quotas/usage" });
	}

	async getXUsage(): Promise<XUsage> {
		return this.request<XUsage>({ method: "GET", path: "/api/quotas/x-usage" });
	}

	async createPost(body: CreatePostBody): Promise<{ id: string; status?: string }> {
		return this.request({ method: "POST", path: "/api/posts", json: body });
	}

	async publishPost(id: string): Promise<PostDetail> {
		return this.request({ method: "POST", path: `/api/posts/${id}/publish`, json: {} });
	}

	async getPost(id: string): Promise<PostDetail> {
		return this.request({ method: "GET", path: `/api/posts/${id}` });
	}

	/** Upload media as multipart/form-data (field name "file"). Returns the media ID. */
	async uploadMedia(fileName: string, data: ArrayBuffer, extension: string): Promise<string> {
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
}
