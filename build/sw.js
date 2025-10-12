/* Service Worker for ShoppingList PWA
   - Cache/route の既存実装があれば、下の fetch ハンドラに追記して併用してください（★自信なし★）
*/

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Web Share Target: POST /share-target を受けて、共有テキストを取り出しUIトリガ
// 参考: MDN/Chrome Docs（share_target + FormData）2
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === "/share-target" && event.request.method === "POST") {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const sharedText =
            formData.get("text") ||
            formData.get("title") ||
            formData.get("url") ||
            "";

          // 起動中クライアントに postMessage（即時ダイアログ用）
          const winClients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          if (winClients.length > 0) {
            winClients[0].postMessage({
              type: "OPEN_SHARE_IMPORT",
              sharedText: String(sharedText),
            });
          }

          // フォールバック：URLクエリでも誘導（新規 or 非起動時）
          const p = new URLSearchParams({
            "share-import": "1",
            sharedText: String(sharedText),
          });
          return Response.redirect("/?" + p.toString(), 303);
        } catch (e) {
          return new Response("Share handling failed", { status: 500 });
        }
      })()
    );
  }
});
