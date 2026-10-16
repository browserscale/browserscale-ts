<div align="center">

<img src="https://browserscale.cloud/icon-512.png" width="72" height="72" alt="browserscale">

# browserscale-ts

**Browser automation that doesn't guess.**

Real Chromium in the cloud, driven from inside the engine: waits the page reports, clicks that verify before they press, every frame on one tree, and nothing for the page to detect.

[![npm](https://img.shields.io/npm/v/browserscale-ts?style=flat-square&color=0a0a0a&logo=npm)](https://www.npmjs.com/package/browserscale-ts)
[![types](https://img.shields.io/badge/types-included-0a0a0a?style=flat-square&logo=typescript)](https://browserscale.cloud/docs/api-reference/ts)
[![node](https://img.shields.io/badge/node-18%2B-0a0a0a?style=flat-square&logo=node.js)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-0a0a0a?style=flat-square)](LICENSE)

[Docs](https://browserscale.cloud/docs) · [Quickstart](https://browserscale.cloud/docs/quickstart) · [API reference](https://browserscale.cloud/docs/api-reference/ts) · [Discord](https://discord.gg/SfE9C9K28D)

</div>

---

```bash
npm install browserscale-ts
```

```ts
import { rentBrowser, BrowserConfig, css, captcha, request, type WaitRequestResult } from "browserscale-ts";

const browser = await rentBrowser(new BrowserConfig(process.env.BROWSERSCALE_API_KEY!, 300, "", 0, "", ""));
try {
  const page = await browser.createPage();
  await page.navigate("https://example.com/login");
  await page.wait(css("#email"));
  await page.fill(css("#email"), "me@example.com");
  await page.click(css("button[type=submit]"));

  // One wait, three ways it can end. The page reports whichever happens first.
  const r = await page.waitAny([css("#inbox"), captcha(), request("https://example.com/error*")]);
  if (r.index === 1) await page.solveCaptcha();
  if (r.index === 2) throw new Error(`rejected: ${(r as WaitRequestResult).request.url}`);
} finally {
  await browser.stopBrowser();
}
```

Get a key in your [panel](https://browserscale.cloud/panel/account). Node 18+, ES module, types included. In the browser, import `browserscale-ts/browser`; it talks over WebSocket instead of gRPC.

## What you won't find elsewhere

- **Waits the page reports, not a poll.** Race elements in any frame, a captcha, a request and a response in one `waitAny`. A timeout tells you, per condition, how far it got: not found, hidden, or covered (and by what). [Waiting →](https://browserscale.cloud/docs/guides/waiting)
- **Clicks that check before they press.** The target is scrolled into view, held until it stops moving, and the exact pixel is verified to belong to it, even inside cross-origin frames. If something is covering it, the error names it. [Interaction →](https://browserscale.cloud/docs/guides/interaction)
- **One frame tree.** Cross-origin iframes are just another `frameId`: no per-frame sessions, no depth limit, and a frame that appears mid-wait is covered at once. [Frames →](https://browserscale.cloud/docs/guides/frames)
- **Reactions.** Arm a one-shot handler for the cookie banner that may or may not show up. It runs in the browser at a safe point, across every frame, navigation and popup. [Reactions →](https://browserscale.cloud/docs/guides/reactions)
- **Network from the browser's own stack.** Every request, including workers and service workers, with the headers as they were sent and every redirect hop. Bodies stay in the browser until you ask for one. [Network →](https://browserscale.cloud/docs/guides/network)
- **Captchas solved in place.** browserscale's own solver, no third-party solving service. With auto-solve on, the click a challenge interrupts waits and then carries on. [Captchas →](https://browserscale.cloud/docs/guides/captchas)
- **Nothing for the page to see.** No injected scripts and no DevTools handshake. Canvas, WebGL and audio are rendered on real consumer GPUs.
- **BrowserVM** *(early access)*. Your JavaScript runs next to the page, not in it: a cross-origin iframe is plain `contentDocument`, and each step costs microseconds instead of a round trip. [BrowserVM →](https://browserscale.cloud/browservm)

Everything else, from cookies and DBSC sign-ins to the live DOM mirror and agent observations, is in the [docs](https://browserscale.cloud/docs).

## Ecosystem

| | |
| --- | --- |
| [**browserscale-go**](https://github.com/browserscale/browserscale-go) | The same SDK for Go |
| [**browserscale studio**](https://github.com/browserscale/browserscale) | Build bots by chatting with an agent; desktop app and `browserscale` CLI |
| [**MCP server**](https://browserscale.cloud/docs/guides/agentic-coding) | The browser as tools for Cursor, Claude, Codex or any MCP client |

<div align="center">

[browserscale.cloud](https://browserscale.cloud) · [MIT](LICENSE)

</div>
