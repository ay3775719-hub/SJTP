# Muse Web Collector v1

Chrome and Edge use this same Manifest V3 package. In development, run
`npm run build:extension`, open `chrome://extensions` or `edge://extensions`,
enable Developer mode, and load `release/browser-extension` as an unpacked
extension.

The extension requests only `contextMenus`, `storage`, `activeTab`, `scripting`,
and `nativeMessaging`. It does not request cookies, history, downloads,
`webRequest`, or `<all_urls>`.

The unpacked development extension has a stable manifest key and therefore a
stable extension id: `pammmlffogkfhnapajdjgelkkcpiijll`. Muse registers the
`com.muse.web_collector` native host for Chrome and Edge. The small host accepts
only the versioned Web Collector protocol, validates the calling extension,
and forwards requests to Electron Main through a per-user named pipe. It can
start Muse when necessary; it never exposes shell, raw SQL, or arbitrary file
operations.

The native context-menu item is registered for image elements on every normal
HTTP and HTTPS page. A content script shows a compact Muse action in the
top-right corner only while the pointer is over a visible content image. A
capture-only right-click fallback also supports standard images and CSS
background images without suppressing the site's own menu. There is no Pinterest, Xiaohongshu,
Huaban, Behance, Dribbble, or other site-specific allow-list. Browser-internal
pages, local/private URLs, canvas-only rendering, and images that require
browser cookies remain outside v1's safe collection boundary.

On posts with a visible image carousel (including Instagram and Xiaohongshu),
the hover action also offers **采集整组**. It walks the carousel to load each
slide, restores the initially displayed image, and saves every distinct image
through the existing Muse import path with the post URL as its source. Progress
and saved/already-present/failed counts appear on completion. One action reads
up to 30 slides; if a site does not expose an accessible carousel or refuses to
load a slide, the summary reports that the group may be incomplete. A video
slide can also stop the scan before later photos. No account or cookie access
is requested.

After updating an unpacked build, reload the extension once in
`chrome://extensions` or `edge://extensions` so the browser adopts the new
manifest and service worker. Then refresh existing website tabs to replace
their previously injected content script. The popup should then report “已连接”.
