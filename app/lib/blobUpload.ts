// Smart PDF upload: direct browser → Vercel Blob when the backend supports it
// (bypasses the ~4.5 MB serverless request body limit), with transparent
// fallback to the classic multipart /upload endpoint (local dev / memory backend,
// or when the browser cannot reach the Blob API directly).
//
// The Blob PUT is done with plain XHR following @vercel/blob's client protocol
// (verified against @vercel/blob@2.8.0 source): fetch a client token from our
// backend, then PUT the file to the Blob API with the token as Bearer auth.
// XHR (instead of fetch) is used because only it reports upload progress.

export interface UploadResult {
  id: string;
  filename: string;
  page_count: number;
  size: number;
}

export type ProgressCallback = (fraction: number) => void;

const BLOB_API_URL = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";

function newPdfId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "pdf_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Minimal XHR wrapper: fetch() cannot report upload progress.
function xhrSend(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: XMLHttpRequestBodyInit | null,
  onProgress?: ProgressCallback
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new TypeError("Upload network error"));
    xhr.send(body);
  });
}

function badStatus(status: number): boolean {
  return status < 200 || status >= 300;
}

async function throwIfBad(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  let detail = fallback;
  try {
    const j = await res.json();
    if (j?.detail) detail = j.detail;
  } catch {
    /* keep fallback */
  }
  throw new Error(detail);
}

async function multipartUpload(file: File, onProgress?: ProgressCallback): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const { status, text } = await xhrSend("POST", "/api/pdf/upload", {}, formData, onProgress);
  if (badStatus(status)) {
    let detail = `Upload failed: HTTP ${status}`;
    try {
      const j = JSON.parse(text);
      if (j?.detail) detail = j.detail;
    } catch {
      /* keep fallback */
    }
    throw new Error(detail);
  }
  return JSON.parse(text);
}

async function fetchClientToken(pathname: string): Promise<{ token: string; storeId: string }> {
  const res = await fetch("/api/pdf/blob-client-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname } }),
  });
  await throwIfBad(res, "Direct upload is not supported by this storage backend");
  const { clientToken } = await res.json();
  if (typeof clientToken !== "string" || !clientToken.startsWith("vercel_blob_client_")) {
    throw new Error("Invalid client token received from server");
  }
  return { token: clientToken, storeId: clientToken.split("_")[3] ?? "" };
}

async function directUpload(file: File, onProgress?: ProgressCallback): Promise<UploadResult> {
  const pdfId = newPdfId();
  const pathname = `docucraft/pdfs/${pdfId}.pdf`;

  const { token, storeId } = await fetchClientToken(pathname);

  const url = `${BLOB_API_URL}/?pathname=${encodeURIComponent(pathname)}`;
  const headers = (access: "public" | "private"): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    "x-vercel-blob-store-id": storeId,
    "x-api-version": BLOB_API_VERSION,
    "x-vercel-blob-access": access,
    "x-content-type": "application/pdf",
  });

  let put: { status: number; text: string };
  try {
    put = await xhrSend("PUT", url, headers("public"), file, onProgress);
    // Private-access stores reject public blobs: retry as a private blob
    // (same client token; the token is scoped to the pathname, not access).
    if (put.status === 400 && put.text.toLowerCase().includes("private store")) {
      put = await xhrSend("PUT", url, headers("private"), file, onProgress);
    }
  } catch {
    // Network-level failure (browser cannot reach the Blob API directly):
    // fall back to multipart upload through our backend instead of failing.
    return multipartUpload(file, onProgress);
  }
  if (badStatus(put.status)) throw new Error(`Blob upload failed: HTTP ${put.status}`);

  const regRes = await fetch("/api/pdf/register-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_id: pdfId, filename: file.name }),
  });
  await throwIfBad(regRes, `Register upload failed: HTTP ${regRes.status}`);
  return regRes.json();
}

export async function uploadPDFSmart(file: File, onProgress?: ProgressCallback): Promise<UploadResult> {
  // Probe with a valid pathname: 501 means the memory backend (no direct upload).
  try {
    const probe = await fetchClientToken("docucraft/pdfs/pdf_000000000000.pdf");
    if (!probe.token) return multipartUpload(file, onProgress);
  } catch (e: any) {
    if (/not supported/i.test(e?.message ?? "")) return multipartUpload(file, onProgress);
    throw e;
  }
  return directUpload(file, onProgress);
}
