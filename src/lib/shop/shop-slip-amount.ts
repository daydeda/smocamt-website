// Free, offline check that the amount printed on a payment slip matches what the
// order charged. Like the rest of shop-slip-verify.ts this is a PRE-FILTER, not
// proof: OCR on a phone screenshot is fallible, so a mismatch only raises a flag
// for the admin review queue — it never rejects an order. A slip we can't read
// at all raises a softer "check it yourself" flag, so that no label at all means
// the amount genuinely matched rather than "OCR silently did nothing".
//
// We read every money-formatted number off the slip ("1,250.00") rather than
// trying to find the one next to "จำนวนเงิน": Tesseract's English model garbles
// Thai labels, but digits survive fine. The slip matches when ANY number equals
// the order total. A slip also prints fees and balances, so this can be lenient
// (a stray "0.00" fee never equals a real total) but never wrongly strict.

import os from "os";
import path from "path";
import type { Worker } from "tesseract.js";

export type SlipAmountFlag = "amount_mismatch" | "amount_unreadable" | null;

// Money as banks print it: optional thousands commas, always exactly 2 decimals.
const MONEY_RE = /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;

// Pull every money-formatted amount out of OCR text, in satang (integer) so the
// comparison never meets floating-point drift. De-duplicated, order preserved.
export function parseSlipAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const satang = Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
    if (Number.isSafeInteger(satang) && !out.includes(satang)) out.push(satang);
  }
  return out;
}

// amounts: null = OCR failed or timed out, [] = OCR ran but found no amount.
// Both mean we couldn't check, so both are "unreadable"; "read some amounts and
// none is the total" is the mismatch.
export function classifySlipAmount(totalBaht: number, amounts: number[] | null): SlipAmountFlag {
  if (!amounts || amounts.length === 0) return "amount_unreadable";
  return amounts.includes(Math.round(totalBaht * 100)) ? null : "amount_mismatch";
}

// --- OCR (tesseract.js, fully offline) ------------------------------------
//
// One lazily-created worker is reused: spinning one up costs ~1s of WASM +
// model load, and Tesseract runs a single job at a time anyway, so concurrent
// uploads queue behind it instead of each loading their own copy of the model.
// The English model ships in node_modules (@tesseract.js-data/eng), so there is
// no CDN fetch at runtime — the self-hosted server needn't reach the internet.

const OCR_TIMEOUT_MS = 20_000;
let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const w = await createWorker("eng", 1, {
        langPath: path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int"),
        cachePath: os.tmpdir(),
        cacheMethod: "none",
      });
      // Re-encoded slips carry no DPI; without this Tesseract warns on every run.
      await w.setParameters({ user_defined_dpi: "300" });
      return w;
    })().catch((e) => {
      workerPromise = null; // let the next slip retry instead of caching the failure
      throw e;
    });
  }
  return workerPromise;
}

// Returns the amounts (satang) printed on the slip, or null if OCR failed or
// timed out. Never throws — a slip must never fail to upload because of this.
export async function readSlipAmounts(buffer: Buffer): Promise<number[] | null> {
  const run = async (): Promise<number[] | null> => {
    const sharp = (await import("sharp")).default;
    // Grayscale + contrast stretch: bank apps use coloured/gradient headers.
    const prepared = await sharp(buffer).rotate().grayscale().normalize().png().toBuffer();
    const worker = await getWorker();
    const { data } = await worker.recognize(prepared);
    const amounts = parseSlipAmounts(data.text);
    // Visible in the container logs so "why no warning?" can be answered.
    console.log(`Slip amount OCR: read ${amounts.length} amount(s) in ${Date.now() - startedAt}ms`);
    return amounts;
  };
  const startedAt = Date.now();
  const job = queue.then(() =>
    Promise.race([
      run(),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          console.error(`Slip amount OCR timed out after ${OCR_TIMEOUT_MS}ms`);
          resolve(null);
        }, OCR_TIMEOUT_MS),
      ),
    ]),
  );
  queue = job.catch(() => null);
  try {
    return await job;
  } catch (e) {
    console.error("Slip amount OCR failed:", e);
    return null;
  }
}
