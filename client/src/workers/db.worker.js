/**
 * Offline Database Web Worker
 *
 * The decrypted database never leaves this Worker context.
 * This file stays intentionally thin and delegates heavy responsibilities
 * to internal modules for crypto, OPFS, SQLite, search, and message handling.
 */

import { dispatchWorkerMessage } from "./dbWorker/messages.js";
import { postWorkerError } from "./dbWorker/protocol.js";
import { setWorkerStatus } from "./dbWorker/state.js";

const originalConsole = self.console;

if (
  typeof self.location !== "undefined" &&
  !self.location.href.includes("localhost")
) {
  self.console = /** @type {Console} */ ({
    log: () => {},
    warn: () => {},
    error: originalConsole.error.bind(originalConsole),
    info: () => {},
    debug: () => {},
    dir: () => {},
    table: () => {},
    trace: () => {},
    assert: () => {},
    clear: () => {},
    count: () => {},
    countReset: () => {},
    group: () => {},
    groupEnd: () => {},
    groupCollapsed: () => {},
    time: () => {},
    timeEnd: () => {},
    timeLog: () => {},
    timeStamp: () => {},
  });
}

/**
 * @param {MessageEvent} event
 */
self.onmessage = async (event) => {
  const { type, id, payload } = event.data;

  try {
    await dispatchWorkerMessage(type, id, payload);
  } catch (error) {
    setWorkerStatus("error");
    postWorkerError(
      id,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
};

postMessage({ type: "READY", id: null, payload: {} });
