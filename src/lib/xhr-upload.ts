// iOS Safari has a longstanding WebKit bug where an upload sometimes sends a
// FormData body containing a File/Blob with Content-Length: 0 — the request
// headers (including a correctly-formed multipart boundary) go out, but the
// body itself never gets attached. Confirmed in prod repeatedly: a failed
// upload logged `contentType: 'multipart/form-data; boundary=...'` alongside
// `contentLength: '0'`. Two earlier theories (fetch() vs XMLHttpRequest as
// the transport; a synthesized File vs a plain Blob via .slice()) each fixed
// nothing — the failure recurred after both were tried, including together.
// That rules out the transport layer and the wrapper type, and points at the
// actual remaining suspect: compressImageFile() hands back a Blob straight
// out of canvas.toBlob(), which on WebKit can still be backed by a temp file
// that hasn't finished flushing to disk when the multipart encoder starts
// streaming it moments later — especially right after returning from the
// native camera app, when the tab was backgrounded mid-flight. Slicing that
// Blob just creates another view over the same not-yet-materialized store,
// so it doesn't help. Forcing a read via arrayBuffer() does: it can't return
// until every byte is actually in JS-accessible memory, and rebuilding a
// fresh Blob from that ArrayBuffer has no disk-backed store left to race.
// Do this materialization here, once, for every entry — not at each call
// site — so nothing that posts through this helper can reintroduce the bug.
async function materializeFormData(form: FormData): Promise<FormData> {
  const safe = new FormData();
  for (const [key, value] of form.entries()) {
    if (value instanceof Blob) {
      const bytes = await value.arrayBuffer();
      const blob = new Blob([bytes], { type: value.type });
      safe.append(key, blob, value instanceof File ? value.name : undefined);
    } else {
      safe.append(key, value);
    }
  }
  return safe;
}

export async function uploadFormViaXHR(
  url: string,
  form: FormData,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const safeForm = await materializeFormData(form);
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
    xhr.send(safeForm);
  });
}
