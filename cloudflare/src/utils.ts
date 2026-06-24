const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function nowIso() {
  return new Date().toISOString();
}

export function encodeUtf8(value: string) {
  return encoder.encode(value);
}

export function decodeUtf8(value: ArrayBuffer | Uint8Array) {
  return decoder.decode(value instanceof Uint8Array ? value : new Uint8Array(value));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecodeBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return base64ToBytes(padded);
}

export function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(encodeUtf8(value));
}

export function base64UrlDecodeText(value: string): string {
  return decodeUtf8(base64UrlDecodeBytes(value));
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }

  return diff === 0;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jsonResponse(payload: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function textResponse(payload: string, contentType: string, status = 200, headers: HeadersInit = {}) {
  return new Response(payload, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function jsonDownloadResponse(fileName: string, payload: unknown) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}

export function buildDownloadFileName(title: string) {
  const safeTitle = title.replace(/[<>:"/\\|?*]+/g, "-").trim() || "mystery-case";
  return `${safeTitle}.json`;
}

export function concatenateBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}
