<div align="center">

# browserscale-ts

**The official TypeScript SDK for [browserscale](https://browserscale.cloud) — real Chromium browsers in the cloud, driven over gRPC.**

Browser automation that doesn't guess. Waits, clicks and frames are handled inside the browser engine instead of being approximated from outside — rent an isolated session in under 250 ms, drive it with input that arrives like hardware, see every request it makes, and watch it live. Runs in Node.js and the browser.

[![npm](https://img.shields.io/npm/v/browserscale-ts?logo=npm)](https://www.npmjs.com/package/browserscale-ts)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Types](https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

[Install](#install) · [Quickstart](#quickstart) · [Core API](#core-api) · [Docs](#documentation) · [Ecosystem](#ecosystem)

</div>

---

## Features

### Acting on the page

- **Clicks that check before they press** — the element is scrolled genuinely
  into view (through nested scroll containers and up the frame chain), held
  until it stops moving, approached on a human pointer path, and the exact pixel
  is verified to belong to it — across process boundaries — before the button
  goes down. Covered? The click re-aims at the visible part or steps out of a
  hover overlay's way. Still blocked? It throws a `ClickError` naming the
  element in the way.
- **Input the way hardware sends it** — pointer and key events take the path a
  real mouse and keyboard take, with none of the markers of remote-controlled
  input. Typing follows the session region's keyboard layout with per-character
  timing that varies like a hand.
- **Failures you can act on** — every command answers with success or a stable
  error code (`not_found`, `occluded_after_evade`, `timeout`, …) and throws a
  typed error carrying the detail, so code and models repair a failure instead
  of blindly retrying.

### Waiting & reacting

- **Waits the page reports, not a poll** — each document tells the wait the
  moment a condition holds, usually within a frame; an idle wait does no work,
  and more conditions or more frames cost a registration, not another loop. By
  default a match means visible and holding still, not merely in the DOM.
- **Timeouts that explain themselves** — a `WaitError` says per condition how
  far it got: `not_found`, `found_hidden`, `found_occluded` (with the blocker)
  or `pending_steady`.
- **Reactions** — `addReaction` arms a one-shot handler in the browser for the
  cookie banner or popup that may or may not show up. It fires between your
  calls while the pointer is idle, across every frame and navigation, and
  retires itself — so a click blocked by a modal lands because the reaction
  cleared the modal mid-retry.

### Frames

- **One flat frame tree** — main document, same-origin iframes and cross-origin
  OOPIFs are all just a `frameId`: no per-frame sessions, no isolated worlds,
  no depth limit. A frame created mid-wait is covered the moment it exists, and
  a match returns the frame plus a node handle the next action routes on its own.

### Scripts beside the browser (BrowserVM, early access)

- **`runScript`** runs JavaScript in its own isolate next to the page, reaching
  the document through the engine: a cross-origin `<iframe>` is plain
  `contentDocument`, values are live objects, an element goes straight into
  `browser.click`, and the page sees nothing injected. A refusal throws the
  same error classes as this SDK. Steps cost
  microseconds instead of round trips, so loops are affordable. `startScript`
  leaves a script running without the caller; `followScript` attaches to one
  already under way. [More on BrowserVM](https://browserscale.cloud/browservm).
  Access is opened per account while in early access: ask
  [support](mailto:support@browserscale.cloud) or on [Discord](https://discord.gg/SfE9C9K28D).

### Stealth on real hardware

- **Control lives below the page** — commands are carried out by the browser
  itself: nothing injected, no `Runtime.enable`, no DevTools handshake, nothing
  for page JavaScript to observe.
- **Real consumer GPUs, our own hardware** — Canvas, WebGL, audio and codec
  readbacks are genuinely rendered; there is no spoofing layer or hash database
  for deeper checks to unmask.
- **A shipped Chrome, not a build of one** — sessions carry the state and wire
  behavior of a consumer browser, consistent with the region they exit from and
  reproducible run over run.

### Network

- **Armed at the root, before anything loads** — interception sits in the
  browser's network stack, so every frame, cross-process iframe, worker and
  service worker passes through it. No attach race, nothing slips.
- **Capture that never pauses the page** — `captureNetwork` streams every
  finished request with the headers and cookies actually put on the wire, each
  redirect hop as its own exchange, bodies copied off to the side.
- **Catch one call and change it** — wait for a request or response, block,
  mock, rewrite headers or bodies, or answer a whole navigation yourself with
  `loadHTML`.
- **Pay for static assets once** — `setStaticPaths` serves heavy JS, CSS and
  images from a server-side cache reached outside the proxy, so repeat runs pay
  neither the download nor the proxy bandwidth.

### Identity & state

- **A login as one portable object** — `getAuthSession` / `setAuthSession`
  export a signed-in persona, device-bound sessions (DBSC) included, and bring
  it up signed in inside a fresh context.
- **Cookies and storage as data** — the whole jar, partitioned cookies
  included, and local storage per origin, read and written with no page open.
- **A machine you can come back as** — a country sets language, locale,
  timezone and keyboard together; cores, memory and renderer stay consistent in
  every frame and worker. Pin the fingerprint and the next run is the same
  computer returning. Bring your own proxy or let browserscale allocate one.

### Seeing the page

- **Agent-friendly observation** — `getObservation` returns one line per
  element across every frame and closed shadow root, with role, live value,
  label and flags, under a token budget — prompt-sized instead of a megabyte of
  HTML, in one round trip.
- **Live DOM mirror** — `mirrorDom` keeps an incrementally updated copy of the
  page: only what changed in the part you expanded is sent, an `<iframe>` is an
  ordinary element holding its document, and `getDomRevision` is an O(1)
  change check.
- Plus `screenshot`, `readCanvas` and `inspectAtPosition`.

### Sessions at scale

- **Contexts, not machines** — a session is an isolated browser context with
  its own cookies, storage, cache, proxy and persona, ready in under 250 ms;
  thousands run side by side without sharing state.
- **Sessions you can find again** — the browser lives server-side, so a session
  outlives the process that rented it. `listBrowsers` shows what a key holds,
  and the `grpcUrl` it reports goes straight into `connectSession` from any
  machine.
- **Operated for you** — heavy sessions can't starve their neighbours, capacity
  is warm before you rent (and a full host fails fast instead of hanging), and
  sessions are rotated onto fresh processes without losing capacity.
- **Live stream and takeover** — a WebRTC stream encoded on the GPU that paints
  the page; take over with mouse, keyboard and clipboard from the dashboard or
  the CLI.
- **Captchas, no third-party solvers** — `solveCaptcha` completes interactive
  challenges in the live session with browserscale's own solver; the provider's
  own JavaScript issues the token, nothing is synthesized or bought from an
  external API.

### Built for agents

- **MCP server** — `https://mcp.browserscale.cloud/mcp` exposes the same verbs
  as this SDK to Cursor, Claude, Codex or any MCP client; the key stays in an
  `Authorization` header, never in the model's context.
- **Flow-optimized TypeScript** — fully typed and promise-based, `wait` races
  several outcomes, `js(...)` locators target by page logic when CSS is not
  enough. Native gRPC in Node.js, WebSocket in the browser via
  `browserscale-ts/browser`.

## Install

```bash
npm install browserscale-ts
```

Requires **Node 18+**. Ships as an ES module with bundled type declarations.

## Quickstart

```ts
import { rentBrowser, BrowserConfig, css } from "browserscale-ts";

async function main() {
    // Empty proxy fields tell browserscale to allocate a managed proxy server-side;
    // pass your own host/port/creds to bring your own.
    const cfg = new BrowserConfig(
        "YOUR_API_KEY", // sk_…
        300,            // rent duration in seconds (5 minutes)
        "", 0, "", "",  // proxy host / port / user / pass
    );

    const browser = await rentBrowser(cfg);
    try {
        await browser.navigate("https://example.com");
        await browser.wait(css("h1"));

        const res = await browser.evaluate("document.title");
        console.log("title:", res.value);
    } finally {
        await browser.stopBrowser(); // always release the session
    }
}

main();
```

Run it and you should see `title: Example Domain`. Get an API key from your
[dashboard](https://browserscale.cloud/dashboard/api-keys).

## Core API

Fully typed and promise-based. Failures throw typed error classes (`ClickError`,
`WaitError`, `FillError`, …) carrying structured detail — e.g. a `ClickError`
reports the element that occluded the click.

| Call | What it does |
| --- | --- |
| `rentBrowser(cfg)` | Rent a fresh session (`new BrowserConfig(key, secs, host, port, user, pass)`). |
| `connectSession(grpcUrl, apiKey, sessionId)` | Attach to an existing session by id (from a prior rent). |
| `listBrowsers(apiKey)` | The sessions a key currently holds, each with the `grpcUrl` to hand to `connectSession`. |
| `browser.navigate(url, opts?)` | Load a URL. |
| `browser.wait(condition, opts?)` | Wait for a locator condition; returns the matched `frameId`. |
| `browser.click(target, opts?)` | Human-like click; throws a rich `ClickError` on failure. |
| `browser.fill(target, text, opts?)` | Per-key typing that fires real input events; `insertText` for bulk commit. |
| `browser.evaluate(expr)` | Run JS in the page/frame and get a typed value back. |
| `browser.runScript(source)` | Run JavaScript beside the browser, where cross-origin frames are property access and every step is local; `startScript` leaves it running, `followScript` watches one already going. |
| `browser.getObservation(opts?)` | Compact, node-handle-tagged view of the visible page across frames; `opts` tunes budgets and format. |
| `browser.captureNetwork(opts, onExchange)` | Stream every request the session completes, optionally with response bodies. |
| `browser.mirrorDom(opts, onChange, onResync?)` | Live, incrementally updated copy of the page's DOM across every frame. |
| `browser.solveCaptcha(opts?)` | Solve an interactive challenge in the live browser. |
| `browser.getUsage()` | CPU time, memory (min / average / peak), renderers and frames the session has used so far. |
| `browser.stopBrowser()` | Release the rental; resolves with the session's final usage. |

Locators: `css(...)`, `js(...)` (target by page logic when CSS can't). Plus
cookies, storage, auth/DBSC (`getAuthSession`/`setAuthSession`), network
interception, mouse/scroll/drag/select/key events, and canvas reads — see the
full reference below.

## Documentation

- [Introduction](https://browserscale.cloud/docs) — what browserscale is, use cases and
  the mental model behind sessions, pages, frames and locators
- [Quickstart](https://browserscale.cloud/docs/quickstart) — from install to a
  running script in under a minute
- [Core concepts](https://browserscale.cloud/docs/concepts)
- Guides — [locators](https://browserscale.cloud/docs/guides/locators),
  [waiting](https://browserscale.cloud/docs/guides/waiting),
  [network](https://browserscale.cloud/docs/guides/network),
  [cookies](https://browserscale.cloud/docs/guides/cookies),
  [captchas](https://browserscale.cloud/docs/guides/captchas) and more
- [TypeScript API reference](https://browserscale.cloud/docs/api-reference/ts) —
  every method, type and option with runnable examples

## Browser usage

The default entry point uses native gRPC (Node.js). To drive a session from a
browser over WebSocket, import the browser build:

```ts
import { rentBrowser, css } from "browserscale-ts/browser";
```

## Ecosystem

| Project | Role |
| --- | --- |
| **browserscale-ts** (you are here) | The TypeScript SDK (Node.js + browser). |
| [**browserscale-go**](https://github.com/browserscale/browserscale-go) | The Go SDK. |
| [**browserscale**](https://github.com/browserscale/browserscale) | The CLI: `browserscale init` scaffolds a runnable automation module (Go), `dev` builds and streams it, `list`/`rent`/`view`/`stop` manage your cloud browsers. |
| [**browserscale-kit**](https://github.com/browserscale/browserscale-kit) | Go toolkit around the browser: config, store, queues, proxies, logging, mail. |
| [**MCP server**](https://mcp.browserscale.cloud/mcp) | The browser as tools for any MCP client, one-to-one with the SDK. |

## License

[MIT](LICENSE)
