<div align="center">

# browserscale-ts

**The official TypeScript SDK for [browserscale](https://browserscale.cloud) — real Chromium browsers in the cloud, driven over gRPC.**

Rent an isolated browser session in seconds, automate it with human-like input, intercept network traffic, solve captchas, and watch a live video stream of everything your script does. Runs in Node.js and the browser.

[![npm](https://img.shields.io/npm/v/browserscale-ts?logo=npm)](https://www.npmjs.com/package/browserscale-ts)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Types](https://img.shields.io/badge/types-included-3178C6?logo=typescript&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

[Install](#install) · [Quickstart](#quickstart) · [Core API](#core-api) · [Docs](#documentation) · [Ecosystem](#ecosystem)

</div>

---

## Features

- **Real browser sessions as a service** — full Chromium in the cloud with
  pages, frames, cookies, storage and network state. No local binary.
- **Parallel isolated contexts** — each task gets its own session, fingerprint
  and lifecycle; large queues never share browser state. Sessions are browser
  contexts, not VMs or processes, so they spin up in under 250 ms and fan out to
  thousands in parallel.
- **Fingerprint & proxy handling** — pinnable server-side fingerprints,
  native Chrome control without CDP/Playwright/Puppeteer leaks, bring your own
  proxy or let browserscale allocate one.
- **Native engine-level control** — automation runs natively inside Chromium
  itself, not from outside over the DevTools protocol. Nothing is injected, no
  `Runtime.enable`, no DevTools handshake — page JS can't observe it. Waits run
  fully async with no polling loop, and built-in steady-time checks only report
  an element once it's stable in the DOM.
- **One flat frame tree** — main document, same-origin iframes and cross-origin
  OOPIFs are all just a `frameId` in one tree, no flattened sessions or
  per-frame execution-context juggling. `wait`/`click` act across all frames or
  a single iframe, and `wait` returns the `frameId` that matched.
- **Human-like interaction** — mouse paths use browserscale's own movement algorithm
  instead of instant synthetic jumps.
- **WebRTC live video stream** — watch and control the rented browser live
  from the browserscale web interface; mouse and keyboard go back over data channels.
- **Captcha support, no third-party solvers** — passive anti-bot checks are
  handled automatically; interactive challenges are solved with `solveCaptcha`
  by browserscale's own AI solver, which learns the known challenge types — puzzle,
  OCR, slide, hold and more — on its own and keeps improving as they evolve.
  No token is ever synthesized or fetched from an external API: the challenge
  is completed in the valid live browser and the provider's own JavaScript
  issues the token itself — which is why even new or unknown protections
  pass.
- **Real hardware, real GPUs** — sessions run hardware-accelerated on real
  consumer GPUs, not on VM cores with a WebGL faking layer. Canvas and WebGL
  readbacks (`toDataURL`, `getImageData`) return genuinely rendered pixels —
  no spoofing layer or fingerprint hash database for new bot protections to
  unmask.
- **Network control at the source** — interception sits in the browser's
  network stack itself, so every request from every frame (including
  cross-origin OOPIFs) passes through it; no handler races, nothing slips
  through. Wait for, block, mock or modify requests and responses without
  leaving the SDK; mark repeated assets as static with `setStaticPaths` to
  serve them from a server-side cache and cut proxy bandwidth on repeat runs.
- **Streaming network capture** — `captureNetwork` reports every request the
  session completes as it happens, and "every request" is literal: capture sits
  in the browser process rather than in a page, so cross-process iframes,
  workers and service workers are included, the headers are the ones actually
  put on the wire, and each hop of a redirect chain arrives as its own exchange.
  Requests are never paused, so the page loads at full speed.
- **Live DOM mirror** — `mirrorDom` holds the page as one incrementally updated
  tree: the browser sends the top once and from then on only what changed in the
  part you expanded, so a page churning inside a collapsed subtree costs one
  number per batch instead of a re-serialized document. An `<iframe>` is an
  ordinary element whose one child is the document it hosts, however deeply
  nested or cross-origin, and `getDomRevision` is the O(1) change detector to
  poll when you are not consuming events.
- **Agent-friendly observation** — `getObservation` returns one line per visible
  element across every frame, under headers carrying the URL, title and scroll
  offset, with live form state (typed values, checkbox state, `<select>`
  options) and a node handle to act on. A model reasons over what matters
  instead of raw HTML, and doesn't need a JS round-trip to ask where it is.
- **Scripts that run beside the browser** — `runScript` sends JavaScript to the
  session, where it runs in an isolate of its own and reaches the document
  through the engine: a cross-origin `<iframe>` is read as plain
  `contentDocument` with no frame ids anywhere, values come back as live objects
  you can assign to rather than snapshots, an element can be handed straight to
  `browser.click`, and the page sees nothing injected. Steps cost microseconds
  rather than network round trips, so loops are affordable. The log streams back
  as the script produces it; `startScript` leaves a script running without the
  caller, which is how work outlives the process that started it, and
  `followScript` attaches to one already under way. A guide for it is still to
  come.
- **Sessions you can find again** — `listBrowsers` reports what an API key is
  paying for: ids, proxy, egress address and remaining rental. A session
  therefore outlives the process that rented it — recover it after a restart, or
  from another machine entirely, and hand the `grpcUrl` it reports straight to
  `connectSession`.
- **Flow-optimized TypeScript** — fully typed promise-based API, `wait` races
  multiple outcomes, JS locators target elements by page logic when CSS is
  not enough. Runs in Node.js (native gRPC) and the browser (WebSocket via
  `browserscale-ts/browser`).

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
| `browser.stopBrowser()` | Release the rental. |

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
| [**browserscale-cli**](https://github.com/browserscale/browserscale-cli) | `browserscale init` — scaffold a runnable automation module (Go). |
| [**browserscale-kit**](https://github.com/browserscale/browserscale-kit) | Go toolkit around the browser: config, store, queues, proxies, logging, mail. |

## License

[MIT](LICENSE)
