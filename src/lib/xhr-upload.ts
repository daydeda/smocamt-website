// iOS Safari has a longstanding WebKit bug where fetch() sometimes sends a
// FormData body containing a File/Blob with Content-Length: 0 — the request
// headers (including a correctly-formed multipart boundary) go out, but the
// body itself never gets attached. It reproduces on the "take a photo" flow
// (a canvas-recompressed Blob from compressImageFile, right after returning
// from the native camera app), confirmed in prod: a failed prize-photo
// upload logged `contentType: 'multipart/form-data; boundary=...'` alongside
// `contentLength: '0'`. XMLHttpRequest's own multipart encoding doesn't have
// this bug, so it's the standard workaround for FormData/Blob uploads on
// Safari — use this instead of fetch() wherever a File/Blob is being posted.
export function uploadFormViaXHR(
  url: string,
  form: FormData,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        body = {};
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}
