# Agent Note: Background and page loading recovery

Status: implemented

## Problem

The random background endpoint redirects to a separate CDN. A successful 302 does not mean the image loaded, and CSS cannot retry or preserve the previous image on failure. Collection reads throw on transient Supabase failures, replacing the page with the framework error screen.

## Decision

The fixed `/api/background` endpoint resolves public HTTP redirects with the existing SSRF checks, an eight-second deadline, a raster-image content-type allowlist, and an eight-MiB limit. Redirect bodies are cancelled. Only successful images receive cache headers; errors are never cached.

The root client loader displays decoded images only, keeps the previous image on failure, stores the last successful response in optional browser Cache Storage, and makes at most three attempts. It retries after connectivity returns and cancels work on unmount. The background remains independent of collection loading.

Supabase GET and HEAD requests use three attempts with a six-second deadline per attempt and exponential delays of 350 and 700 milliseconds. Successful read bodies are consumed within the deadline so truncated or stalled bodies can be retried. Network failures, timeouts, 408, 429, and server errors are retryable. Other HTTP errors and caller cancellation are not. Retry-After up to two seconds is honored; longer requested waits return the failure instead of retrying early. SDK-level retries are disabled to avoid multiplying the budget. Mutations are never retried automatically. Both JWT and opaque API keys use this transport; opaque-key authorization filtering stays intact.

Existing tagged Next.js data caches and public/private query separation remain unchanged. Errors propagate after retries rather than becoming empty or demo data. Loading and error boundaries preserve the root navigation. The installed Next.js error-boundary `retry` API refreshes Server Components as well as resetting the boundary. Automatic recovery is limited to once per path per minute in session storage; storage failure leaves recovery manual.

## Alternatives considered

- Direct browser image retries avoid proxy bandwidth, but still depend on the browser reaching the third-party CDN and cannot reliably persist cross-origin image responses without CORS.
- Returning empty collections or demo groups keeps a page visible, but misrepresents a configured database failure and can mislead management workflows.
- Retrying every database operation is simpler, but a failed response can follow a committed write, causing duplicate submissions.

## Consequences

- Successful images are shared for an hour through browser/CDN caching, changing the previous per-load randomization and adding proxy bandwidth on cache misses.
- Browser storage may be unavailable or evicted. Without a previously saved image, an upstream outage retains the existing plain background color.
- Read recovery adds up to approximately 19 seconds before the error boundary, or 22 seconds with the maximum accepted Retry-After delays. Each redirect is checked, but the existing DNS-validation/fetch TOCTOU limitation remains.
- There is no process-local stale database fallback that could mix public and private results or conceal persistent configuration errors.

## Verification

`npm test` on Node 24 covers read retries, terminal errors, write non-replay, cancellation, read-body failures, deadlines, safe redirect handling, and size limits. `npm run test:loading` uses Playwright and installed Chrome for browser fault injection covering background retries, invalid images, stored-image recovery, storage failure, and collection recovery. PLAYWRIGHT_MODULE may point to a bundled Playwright module; BROWSER_CHANNEL and SMOKE_PORT override the browser and test port. The test copies source into a temporary workspace and links installed dependencies so fixture data, Next.js caches, and generated type configuration never affect the normal dev server. It uses a local database fixture without copying or changing environment files, stops its server and browser on completion, verifies the temporary cleanup path, and saves ignored desktop/mobile screenshots. TypeScript, ESLint, and production build validate integration. Codegraph indexes and verification output are local ignored artifacts.

## Note audit

The existing GitHub release-download feature note is unrelated. No active loading-recovery note is superseded. ESLint excludes generated Codegraph and smoke-workspace artifacts, while continuing to lint source and regression tests.
