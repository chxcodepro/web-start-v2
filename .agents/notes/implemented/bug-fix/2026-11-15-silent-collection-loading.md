# Agent Note: Silent collection loading

Status: implemented

## Problem

After the Supabase read transport exhausted its retries, collection pages threw and the route error boundary replaced the page with an error message. It retried automatically once per path per minute and otherwise required a manual reload button, so visitors saw an error screen and retry controls for failures that usually cleared within seconds. The search box disappeared with the page.

Requests only block on Supabase when the Next.js Data Cache misses. Stale entries are served while revalidating in the background, and background failures keep the stale value. `unstable_cache` keys include the cached function's source text, so a build that changes the compiled function starts with a cold cache, and the first request after it waits for the database.

## Decision

`loadBookmarkCollection` and `loadStarCollection` turn read failures into `{ status: "unavailable" }` after the existing transport retries. They log the error on the server and pass Next.js internal errors through `unstable_rethrow`.

When data is unavailable, pages render `CollectionPending`. It looks the same as the route's `loading.tsx` skeleton and calls `router.refresh()` with exponential backoff, starting at 0.8 seconds and capped at 15 seconds. Retries pause while the tab is hidden or offline and resume on `visibilitychange` or `online`. Data renders as soon as a refresh succeeds. After 10 seconds of waiting, a small status line says loading is slow, and offline browsers get a reconnect message. There is no error copy and no retry button.

The root `error.tsx` uses the same hook with the boundary's `retry()` for failures outside the data layer, such as an interrupted Server Component stream. It picks the home, star, or generic skeleton from the pathname. Backoff state lives in a module-level map, so a remounted boundary keeps its progress. A new episode starts after 60 seconds without a failure.

The home page awaits only `connection()` and the session, then streams the collection behind Suspense. The search box receives its local bookmark items as a promise, so it can be used before data arrives. Local suggestions join when the promise resolves, and typed text survives silent refreshes. Both collection pages call `connection()`, so a database failure during a build can never be prerendered as a static loading page.

Route-specific loading files show the home search and bookmark skeleton, the star toolbar and card skeleton, and an empty login placeholder so `/login` does not inherit the home skeleton.

## Alternatives considered

- Longer automatic retries inside the error boundary still flash error copy and drop the search box.
- Rendering a last-known-good snapshot from browser storage gives the fastest perceived load and survives outages, but it can show private items after sign-out, shows stale data, and needs hydration-safe rendering. It remains a possible follow-up.
- `cacheComponents` with `"use cache"` would give stable cache keys and partial prerendering, but it changes the rendering model for the whole app.
- Retrying indefinitely on the server holds function time without improving what the visitor sees.

## Consequences

- A persistent outage or configuration error now shows the skeleton with the slow-loading notice instead of an error screen. Diagnosis relies on server logs prefixed with `[data]`. While the tab is visible, refreshes continue at most every 15 seconds plus the server's retry time.
- Signed-in owners see the management toolbar appear above the grid when data arrives, because the skeleton does not know the session.
- `tsconfig.json` excludes `artifacts/`, matching the ESLint ignores, so leftover smoke-test workspaces no longer break `tsc`.

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass. `npm run test:loading` uses the local database fixture to check that a database outage shows the skeleton and a usable search box without error copy or retry buttons, that silent refreshes keep reading, that the slow-loading notice appears, and that data renders automatically once the fixture recovers. It also checks that typed search text survives the refreshes and that recovered bookmarks join local suggestions. A truncated client-navigation Server Component response must recover through the error boundary without a full reload. The test saves an ignored pending-state screenshot next to the existing desktop and mobile screenshots.

## Note audit

This note supersedes the error-boundary recovery in `2026-10-06-loading-recovery.md`: the once-per-minute automatic recovery, the error copy, and the manual reload button. That note's transport retries, background loading, and cache decisions remain current.
