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
