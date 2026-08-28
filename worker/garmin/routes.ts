import { getAuthenticatedUser } from "../auth/session";

const PART_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_PARTS = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CompleteBody = {
  importId?: unknown;
  uploadId?: unknown;
  filename?: unknown;
  size?: unknown;
  contentType?: unknown;
  parts?: unknown;
};

type UploadedPart = {
  partNumber: number;
  etag: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function cleanFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const filename = value.trim().replace(/[\\/\0]/g, "_");
  if (!filename || filename.length > 240) return null;
  return filename;
}

function cleanContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const contentType = value.trim();
  if (!contentType || contentType.length > 120) return null;
  return contentType;
}

function cleanSize(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value <= 0 || value > MAX_FILE_SIZE_BYTES) return null;
  return value;
}

function objectKey(userId: string, importId: string): string {
  return `garmin/${userId}/${importId}/source`;
}

async function requireUser(request: Request, env: Env) {
  return getAuthenticatedUser(request, env.DB);
}

async function startUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  let body: { filename?: unknown; size?: unknown; contentType?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const filename = cleanFilename(body.filename);
  const size = cleanSize(body.size);
  const contentType = cleanContentType(body.contentType) ?? "application/octet-stream";
  if (!filename || size === null) return json({ error: "invalid_upload" }, { status: 400 });

  const partCount = Math.ceil(size / PART_SIZE_BYTES);
  if (partCount > MAX_PARTS) return json({ error: "file_too_large" }, { status: 413 });

  const importId = crypto.randomUUID();
  const key = objectKey(user.id, importId);
  const upload = await env.DATA.createMultipartUpload(key);

  return json({
    importId,
    uploadId: upload.uploadId,
    partSize: PART_SIZE_BYTES,
    partCount,
    filename,
    contentType,
  });
}

async function uploadPart(request: Request, env: Env): Promise<Response> {
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, { status: 405 });

  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (!request.body) return json({ error: "missing_body" }, { status: 400 });

  const url = new URL(request.url);
  const importId = url.searchParams.get("importId") ?? "";
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const partNumber = Number(url.searchParams.get("partNumber"));

  if (!UUID_RE.test(importId) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
    return json({ error: "invalid_part_request" }, { status: 400 });
  }

  const upload = env.DATA.resumeMultipartUpload(objectKey(user.id, importId), uploadId);

  try {
    const part = await upload.uploadPart(partNumber, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  } catch (error) {
    console.error(JSON.stringify({
      event: "garmin_upload_part_failed",
      userId: user.id,
      importId,
      partNumber,
      error: error instanceof Error ? error.message : "unknown_error",
    }));
    return json({ error: "upload_part_failed" }, { status: 400 });
  }
}

function parseParts(value: unknown): UploadedPart[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARTS) return null;

  const parts: UploadedPart[] = [];
  const seen = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { partNumber, etag } = entry as { partNumber?: unknown; etag?: unknown };
    if (!Number.isInteger(partNumber) || (partNumber as number) < 1 || (partNumber as number) > MAX_PARTS) return null;
    if (typeof etag !== "string" || etag.length === 0 || etag.length > 256) return null;
    if (seen.has(partNumber as number)) return null;
    seen.add(partNumber as number);
    parts.push({ partNumber: partNumber as number, etag });
  }

  parts.sort((a, b) => a.partNumber - b.partNumber);
  return parts;
}

async function completeUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  let body: CompleteBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const importId = typeof body.importId === "string" ? body.importId : "";
  const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
  const filename = cleanFilename(body.filename);
  const size = cleanSize(body.size);
  const contentType = cleanContentType(body.contentType) ?? "application/octet-stream";
  const parts = parseParts(body.parts);

  if (!UUID_RE.test(importId) || !uploadId || !filename || size === null || !parts) {
    return json({ error: "invalid_complete_request" }, { status: 400 });
  }

  const expectedPartCount = Math.ceil(size / PART_SIZE_BYTES);
  if (parts.length !== expectedPartCount || parts.some((part, index) => part.partNumber !== index + 1)) {
    return json({ error: "incomplete_parts" }, { status: 400 });
  }

  const key = objectKey(user.id, importId);
  const upload = env.DATA.resumeMultipartUpload(key, uploadId);
  let object: R2Object;

  try {
    object = await upload.complete(parts);
  } catch (error) {
    console.error(JSON.stringify({
      event: "garmin_upload_complete_failed",
      userId: user.id,
      importId,
      error: error instanceof Error ? error.message : "unknown_error",
    }));
    return json({ error: "upload_complete_failed" }, { status: 400 });
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO garmin_imports (
         id, user_id, source_filename, source_size_bytes, source_content_type,
         storage_key, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
    )
      .bind(importId, user.id, filename, object.size, contentType, key, now, now)
      .run();
  } catch (error) {
    await env.DATA.delete(key);
    throw error;
  }

  return json({
    ok: true,
    import: {
      id: importId,
      filename,
      sizeBytes: object.size,
      status: "uploaded",
      createdAt: now,
    },
  }, { status: 201 });
}

async function abortUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "DELETE") return json({ error: "method_not_allowed" }, { status: 405 });

  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const importId = url.searchParams.get("importId") ?? "";
  const uploadId = url.searchParams.get("uploadId") ?? "";
  if (!UUID_RE.test(importId) || !uploadId) return json({ error: "invalid_abort_request" }, { status: 400 });

  try {
    await env.DATA.resumeMultipartUpload(objectKey(user.id, importId), uploadId).abort();
  } catch {
    // Treat an already missing/aborted multipart upload as successfully cleaned up.
  }
  return new Response(null, { status: 204 });
}

async function listImports(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });

  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const result = await env.DB.prepare(
    `SELECT id, source_filename, source_size_bytes, source_content_type, status,
            file_count, detected_from, detected_to, error_message, created_at, updated_at
     FROM garmin_imports
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 20`,
  )
    .bind(user.id)
    .all();

  return json({ imports: result.results });
}

export async function handleGarminRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/garmin/uploads/start") return startUpload(request, env);
  if (pathname === "/api/garmin/uploads/part") return uploadPart(request, env);
  if (pathname === "/api/garmin/uploads/complete") return completeUpload(request, env);
  if (pathname === "/api/garmin/uploads") return abortUpload(request, env);
  if (pathname === "/api/garmin/imports") return listImports(request, env);

  return null;
}
