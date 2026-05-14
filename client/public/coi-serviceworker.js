/* coi-serviceworker + offline shell cache */
let coepCredentialless = false;
const APP_SHELL_CACHE = "app-shell-v3";
const RUNTIME_CACHE = "runtime-assets-v3";
const CORE_URLS = ["./", "./index.html", "./coi-serviceworker.js", "./vite.svg"];

function shouldWarmRuntimeCache(absoluteUrl) {
  try {
    const { origin, pathname } = new URL(absoluteUrl, self.registration.scope);
    if (origin !== self.location.origin) {
      return false;
    }
    return pathname.startsWith("/assets/") || /\.(?:css|js|mjs|svg|png|jpe?g|webp|woff2?|ttf)$/i.test(pathname);
  } catch {
    return false;
  }
}

function resolveCredentiallessValue(payload) {
  return Boolean(payload?.credentialless);
}

function isTrustedMessageOrigin(event) {
  if (event.origin && event.origin !== self.location.origin) {
    return false;
  }

  const sourceUrl =
    event.source && typeof event.source === "object" && "url" in event.source
      ? event.source.url
      : "";

  if (!sourceUrl) {
    return !event.origin || event.origin === self.location.origin;
  }

  try {
    return new URL(sourceUrl).origin === self.location.origin;
  } catch {
    return false;
  }
}

function withCoiHeaders(response) {
  if (!response || response.status === 0) {
    return response;
  }

  const newHeaders = new Headers(response.headers);
  newHeaders.set(
    "Cross-Origin-Embedder-Policy",
    coepCredentialless ? "credentialless" : "require-corp"
  );
  newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

async function cacheUrls(urls) {
  const [appShellCache, runtimeCache] = await Promise.all([
    caches.open(APP_SHELL_CACHE),
    caches.open(RUNTIME_CACHE),
  ]);
  const uniqueUrls = [...new Set(urls.filter(Boolean))];

  await Promise.all(
    uniqueUrls.map(async (url) => {
      try {
        const absoluteUrl = new URL(url, self.registration.scope).toString();
        const response = await fetch(absoluteUrl, { cache: "no-cache" });
        if (response.ok) {
          await appShellCache.put(absoluteUrl, response.clone());
          if (shouldWarmRuntimeCache(absoluteUrl)) {
            await runtimeCache.put(absoluteUrl, response.clone());
          }
        }
      } catch {
        // Best-effort cache warmup only.
      }
    })
  );
}

async function networkWithOptionalCredentials(request) {
  const effectiveRequest =
    coepCredentialless && request.mode === "no-cors"
      ? new Request(request, { credentials: "omit" })
      : request;
  const response = await fetch(effectiveRequest);
  return withCoiHeaders(response);
}

if (typeof window === "undefined") {
  self.addEventListener("install", (event) => {
    event.waitUntil(
      cacheUrls(CORE_URLS).finally(() => self.skipWaiting())
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const expectedCaches = new Set([APP_SHELL_CACHE, RUNTIME_CACHE]);
        const cacheKeys = await caches.keys();
        await Promise.all(
          cacheKeys.map((cacheKey) =>
            expectedCaches.has(cacheKey) ? Promise.resolve() : caches.delete(cacheKey)
          )
        );
        await self.clients.claim();
      })()
    );
  });

  self.addEventListener("message", (event) => {
    if (event.origin && event.origin !== self.location.origin) return;
    if (!isTrustedMessageOrigin(event)) return;

    const message = event.data;
    if (!message) return;

    if (message.type === "deregister") {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => {
          for (const client of clients) {
            client.navigate(client.url);
          }
        });
      return;
    }

    if (message.type === "SET_COEP_MODE") {
      coepCredentialless = resolveCredentiallessValue(message.payload);
      return;
    }

    if (message.type === "CACHE_APP_SHELL") {
      const urls = [
        ...CORE_URLS,
        ...(Array.isArray(message.payload?.urls) ? message.payload.urls : []),
      ];
      event.waitUntil(cacheUrls(urls));
    }
  });

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
      return;
    }

    const requestUrl = new URL(request.url);
    const sameOrigin = requestUrl.origin === self.location.origin;

    // Cross-origin non-navigational requests (e.g. API calls to Render backend)
    // must NOT be intercepted by the SW. If we call event.respondWith() here and
    // the fetch fails, we return Response.error() which has no CORS headers and
    // the browser misreports it as a CORS policy block.
    if (!sameOrigin && request.mode !== "navigate") {
      return;
    }

    const isApiRequest = sameOrigin && requestUrl.pathname.startsWith("/api/");
    const isDocument =
      request.mode === "navigate" || request.destination === "document";
    const isStaticAsset =
      sameOrigin &&
      ["style", "script", "worker", "font", "image"].includes(
        request.destination
      );

    if (isApiRequest) {
      event.respondWith(networkWithOptionalCredentials(request));
      return;
    }

    if (isDocument) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(APP_SHELL_CACHE);
          try {
            const networkResponse = await networkWithOptionalCredentials(request);
            if (networkResponse?.ok) {
              await cache.put(request.url, networkResponse.clone());
              await cache.put(new URL("./", self.registration.scope).toString(), networkResponse.clone());
            }
            return networkResponse;
          } catch {
            const cachedResponse =
              (await cache.match(request.url)) ||
              (await cache.match(new URL("./", self.registration.scope).toString())) ||
              (await cache.match(new URL("./index.html", self.registration.scope).toString()));
            if (cachedResponse) {
              return withCoiHeaders(cachedResponse);
            }
            throw new Error("Offline document unavailable");
          }
        })()
      );
      return;
    }

    if (isStaticAsset) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(RUNTIME_CACHE);
          const cachedResponse = await cache.match(request.url);
          if (cachedResponse) {
            event.waitUntil(
              networkWithOptionalCredentials(request)
                .then((networkResponse) => {
                  if (networkResponse?.ok) {
                    return cache.put(request.url, networkResponse.clone());
                  }
                  return undefined;
                })
                .catch(() => undefined)
            );
            return withCoiHeaders(cachedResponse);
          }

          const networkResponse = await networkWithOptionalCredentials(request);
          if (networkResponse?.ok) {
            await cache.put(request.url, networkResponse.clone());
          }
          return networkResponse;
        })()
      );
      return;
    }

    event.respondWith(
      networkWithOptionalCredentials(request).catch(async () => {
        if (!sameOrigin) {
          return Response.error();
        }
        const cache = await caches.open(RUNTIME_CACHE);
        const cachedResponse = await cache.match(request.url);
        if (cachedResponse) {
          return withCoiHeaders(cachedResponse);
        }
        throw new Error("Resource unavailable offline");
      })
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
    window.sessionStorage.removeItem("coiReloadedBySelf");

    const alreadyRetried = reloadedBySelf === "reload";
    const coepDegrading = reloadedBySelf === "coepdegrade";
    if (
      window.isSecureContext &&
      !alreadyRetried &&
      !coepDegrading &&
      typeof window.SharedArrayBuffer === "undefined"
    ) {
      coepCredentialless = true;
    }

    const notifyCoiMode = (registration) => {
      const message = {
        type: "SET_COEP_MODE",
        payload: { credentialless: coepCredentialless },
      };
      registration.installing?.postMessage(message);
      registration.waiting?.postMessage(message);
      registration.active?.postMessage(message);
    };

    if (!window.isSecureContext) {
      console.info(
        "[coi] SharedArrayBuffer requires secure context (HTTPS). Offline search will use API fallback."
      );
      return;
    }

    if ("serviceWorker" in navigator) {
      // -------------------------------------------------------------
      // FIX para dev local: o SW atrapalha o Hot Reload do Vite (@vite/client).
      // Mantemos o bypass apenas quando o cliente de dev do Vite está presente.
      // Em preview/testes locais ainda precisamos do SW ativo para validar o app shell offline.
      // -------------------------------------------------------------
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const isViteDevClientPresent = Boolean(
        document.querySelector('script[src*="/@vite/client"]')
      );
      if (
        isLocalhost &&
        isViteDevClientPresent &&
        window.crossOriginIsolated === true &&
        typeof window.SharedArrayBuffer !== "undefined"
      ) {
        console.info("[coi] Local dev detected. Bypassing SW to prevent Vite conflicts.");
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            reg.unregister();
          }
        });
        return;
      }

      const currentScriptSrc =
        document.currentScript instanceof HTMLScriptElement
          ? document.currentScript.src
          : null;
      const serviceWorkerUrl = new URL(
        "coi-serviceworker.js",
        currentScriptSrc || window.location.href
      );
      navigator.serviceWorker
        .register(serviceWorkerUrl.href)
        .then(
          (registration) => {
            notifyCoiMode(registration);
            registration.addEventListener("updatefound", () => {
              const newSW = registration.installing;
              if (!newSW) return;
              newSW.addEventListener("statechange", () => {
                if (newSW.state === "installed" || newSW.state === "activating") {
                  notifyCoiMode(registration);
                }
                if (
                  newSW.state === "activated" &&
                  !window.SharedArrayBuffer &&
                  !alreadyRetried
                ) {
                  window.sessionStorage.setItem("coiReloadedBySelf", "reload");
                  window.location.reload();
                }
              });
            });

            if (registration.active) {
              registration.active.postMessage({
                type: "CACHE_APP_SHELL",
                payload: {
                  urls: [window.location.pathname, window.location.href],
                },
              });
            }

            if (
              registration.active &&
              !window.SharedArrayBuffer &&
              !alreadyRetried
            ) {
              window.sessionStorage.setItem("coiReloadedBySelf", "reload");
              window.location.reload();
            }
          },
          (err) => {
            console.error("[coi] Service worker registration failed:", err);
          }
        );
    }
  })();
}
