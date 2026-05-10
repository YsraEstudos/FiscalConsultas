export function postWorkerProgress(id, progress, step) {
  postMessage({
    type: "PROGRESS",
    id,
    payload: { progress, step },
  });
}

export function postWorkerStatus(id, payload) {
  postMessage({
    type: "STATUS",
    id,
    payload,
  });
}

export function postWorkerResult(id, payload) {
  postMessage({
    type: "RESULT",
    id,
    payload,
  });
}

export function postWorkerError(id, error) {
  postMessage({
    type: "ERROR",
    id,
    payload: { error },
  });
}

/**
 * Ask the main thread to provide a fresh Clerk JWT.
 * The main thread will reply with a TOKEN_RESPONSE message containing the same id.
 * @param {string} id - Unique request id used to match the reply
 */
export function postWorkerRefreshToken(id) {
  postMessage({
    type: "REFRESH_TOKEN",
    id,
    payload: {},
  });
}
