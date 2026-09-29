// Smart PDF upload: direct browser → Vercel Blob when the backend supports it
// (bypasses the ~4.5 MB serverless request body limit), with transparent
// fallback to the classic multipart /upload endpoint (local dev / memory backend).
//
// The Blob PUT is done with plain fetch following @vercel/blob's client protocol
// (verified against @vercel/blob@2.8.0 source): fetch a client token from our
// backend, then PUT the file to the Blob API with the token as Bearer auth.

export interface UploadResult {
  id: string;
  filename: string;
  page_count: number;
  size: number;
}

const BLOB_API_URL = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";

function newPdfId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "pdf_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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

async function multipartUpload(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/pdf/upload", { method: "POST", body: formData });
  await throwIfBad(res, `Upload failed: HTTP ${res.status}`);
  return res.json();
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

async function directUpload(file: File): Promise<UploadResult> {
  const pdfId = newPdfId();
  const pathname = `docucraft/pdfs/${pdfId}.pdf`;

  const { token, storeId } = await fetchClientToken(pathname);
  const putRes = await fetch(`${BLOB_API_URL}/?pathname=${encodeURIComponent(pathname)}`, {
    method: "PUT",
    body: file,
    headers: {
      authorization: `Bearer ${token}`,
      "x-vercel-blob-store-id": storeId,
      "x-api-version": BLOB_API_VERSION,
      "x-vercel-blob-access": "public",
      "x-content-type": "application/pdf",
    },
  });
  await throwIfBad(putRes, `Blob upload failed: HTTP ${putRes.status}`);

  const regRes = await fetch("/api/pdf/register-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_id: pdfId, filename: file.name }),
  });
  await throwIfBad(regRes, `Register upload failed: HTTP ${regRes.status}`);
  return regRes.json();
}

export async function uploadPDFSmart(file: File): Promise<UploadResult> {
  // Probe with a valid pathname: 501 means the memory backend (no direct upload).
  try {
    const probe = await fetchClientToken("docucraft/pdfs/pdf_000000000000.pdf");
    if (!probe.token) return multipartUpload(file);
  } catch (e: any) {
    if (/not supported/i.test(e?.message ?? "")) return multipartUpload(file);
    throw e;
  }
  return directUpload(file);
}
