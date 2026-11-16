const NOTES_TIMEOUT_MS = 6 * 60 * 1000;

export class ProcessingTimeout extends Error {
  constructor() {
    super("The notes took too long to come back. The recording is saved on this device, so try again.");
    this.name = "ProcessingTimeout";
  }
}

/**
 * A notes pipeline can finish after the page has given up on it. Racing the
 * promise keeps a hung provider from leaving a capture in processing forever,
 * and the losing promise is ignored once the race has settled.
 */
export function withProcessingTimeout<T>(promise: Promise<T>, timeoutMs = NOTES_TIMEOUT_MS) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProcessingTimeout()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
