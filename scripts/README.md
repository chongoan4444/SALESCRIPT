# BOTFAKE — Gửi 1 câu cho toàn bộ đoạn chat có cùng snippet

File: `pancake-send-by-snippet.user.js` — chạy bằng **Tampermonkey** trên trang chat Pancake
(`/page/conversation`). Gửi **cùng 1 câu** (có thể **kèm 1 ảnh**) cho tất cả đoạn chat đã chọn.

## Mục đích

Khi bạn chọn 1 snippet trong danh sách đoạn chat (dòng tin nhắn cuối cùng hiển thị dưới tên khách),
script sẽ:

1. Tìm **toàn bộ** các đoạn chat đang có **cùng snippet** đó trong danh sách.
2. Gửi **cùng 1 câu** mà bạn nhập cho tất cả các đoạn chat đó (gửi lần lượt, có giãn cách).

Phù hợp khi nhiều khách nhắn cùng 1 câu hỏi / cùng 1 tin tự động và bạn cần trả lời 1 lần cho tất cả.

## Cài đặt

1. Cài tiện ích **Tampermonkey** (Chrome/Edge/Firefox).
2. Tạo script mới → dán toàn bộ nội dung `pancake-send-by-snippet.user.js` → Lưu.
3. Mở Pancake → vào mục **Đoạn chat** (trang `/page/conversation`).

## Sử dụng

1. Bấm vào biểu tượng panel **“💬 Gửi 1 câu theo snippet”** góc dưới bên phải (kéo thả được).
2. **Chọn đối tượng nhận tin** — 2 cách:
   - **Chọn chuỗi (2 đầu):** **Alt+Click** vào dòng chat **đầu chuỗi** → **giữ Alt và nhấp tiếp** dòng
     **cuối chuỗi**. Tất cả chat nằm **giữa 2 dòng đó** trong danh sách được chọn thành 1 chuỗi
     (nhấp lần 3 = bắt đầu chuỗi mới; Esc = hủy). Nút “Chọn chuỗi (2 nhấp)” cũng làm được điều tương tự.
   - **Chọn theo snippet:** bấm 1 chat bất kỳ (chat đó được chọn) → bấm **“Lấy snippet từ chat đang chọn”**
     (hoặc `Alt+Shift+D`) — mọi chat có snippet giống nhau sẽ được chọn.
3. Các dòng **viền xanh lá (nền + viền)** là chat sẽ được nhận tin (dòng đầu/cuối chuỗi hoặc nguồn snippet
   viền xanh dương). Màu này **tự vẽ lại bền vững**: cuộn ra khỏi màn hình rồi quay lại, bấm mở chat rồi
   bấm ra… màu vẫn còn (script tự tô lại mỗi khi danh sách render).
   Nút **“⬇ Từ đây xuống cuối”**: chọn tất cả chat từ chat đang mở (đang được chọn trong app) trở xuống
   cuối danh sách (tự tải danh sách nếu chưa tải).
4. **Script không bao giờ tự cuộn danh sách** — khi cần quét toàn bộ chat (để chọn chuỗi chính xác
   khắp danh sách / so khớp snippet ngoài vùng đang thấy), bấm **“⚡ Tải danh sách”**:
   - **Tải qua API trước (siêu nhanh)** — đúng request mà app Pancake tự gọi, **lấy bộ lọc/thứ tự
     thẳng từ state của app** (`currentPageId`/`multiplePageIds`, `unread_first`, `filter_multi_tag`,
     tag/loại đang lọc) nên khớp đúng màn hình; phân trang `next_cursor` — 2000–3000 chat chỉ mất
     vài giây, **không cuộn gì cả**. Log ghi chẩn đoán đối chiếu (`API: N · màn hình: M · thiếu: X`);
     nếu không khớp (bộ lọc lạ) thì tự chuyển sang quét giao diện cho đúng những gì đang thấy.
   - **Quét giao diện** (dự phòng): bước cuộn lớn, chờ tối thiểu, đếm dần trên nút, xong tự cuộn về chỗ cũ.
   Chuỗi **hàng nghìn chat** vẫn chạy tốt. Với chuỗi ≥150 chat nên chọn tốc độ **“Song song 5 luồng”**
   để không bị Facebook chặn (429).
5. Bỏ tick chat nào không muốn gửi trong danh sách mục 2.
6. Nhập **1 câu** cần gửi vào mục 3 → chọn **tốc độ gửi** → bấm **“▶ Chạy”** → xác nhận.
   - **🚀 Gửi tất cả cùng lúc** (mặc định): bắn mọi request song song — xong trong 1 phát.
   - **⚡ Song song 5 luồng**: 5 chat cùng lúc — vẫn nhanh nhưng nhẹ hơn cho server.
   - **🐢 Tuần tự**: gửi lần lượt, có giãn cách (mặc định 300 ms, đổi được) — dành khi bị báo spam/429.
   - Có nút **Dừng** giữa chừng; log phía dưới hiện rõ chat nào gửi thành công / lỗi gì.

Phím tắt: `Alt+Shift+B` ẩn/hiện panel, `Alt+Shift+D` lấy snippet từ chat đang chọn, `Esc` hủy chọn chuỗi.

## Script dựa vào phần nào của source trong repo?

| Phần source | Nội dung được dùng |
|---|---|
| `html.txt`, `html2.txt`, `html3.txt`, `html comment list` | Cấu trúc DOM danh sách đoạn chat: `#conversationList` → `<div id="{pageId}_{conversationId}">` → `.conversation-list-item` với `.name-text`, `.time-modul`, `.snippet-text`; chat đang chọn có class `selected`. Icon `static/images/envelope*.svg` = chat Inbox, `static/images/comments.svg` = chat Bình luận (script phân biệt để cảnh báo). Ô soạn tin `#replyBoxComposer` (gửi bằng phím Enter). |
| `_app-9331d46f21a84eb1.v6.js` | Cách website tự gửi tin: `executeByApi` → `POST {api}/v1/pages/{page_id}/conversations/{id}/messages?access_token=…` (`action=reply_inbox`, `multipart/form-data`); khi server trả lỗi dạng `(#10)/(#551)/(#613)…` (`canFallbackToExt`) app tự fallback sang `executeByExt` (extension message `type:"REPLY_INBOX_PHOTO"`, `attachmentType:"SEND_TEXT_ONLY"`) rồi `executeBySocketFB`. Script tái hiện đúng3 tầng đó, dùng các biến toàn cục app expose sẵn: `__pancakeReduxStore__`, `__ExtensionAdapter__`, `__GlobalIdCacheTest__`, `__tempGlobalIdCache__`, `__syncMissingThreadId__`. |
| `pancake.vn2.har` | Xác nhận `access_token` (JWT) được gửi trong query string của mọi request `/api/v1/…` — script lấy token trực tiếp từ request thật của trang (hook fetch/XHR, `performance` entries, `__NEXT_DATA__`, URL ảnh trong DOM). |

Không dùng selector bịa: mọi class/id/đường API ở trên đều lấy trực tiếp từ source.

## 3 tầng gửi (tự động dự phòng) — CHỈ gửi hàng loạt

1. **API** — nhanh nhất, gửi song song nhiều chat cùng lúc.
2. **Socket (Facebook WebSocket)** — **đúng đường “gửi bình thường”** mà app Pancake dùng khi bạn
   gõ tay (`executeBySocketFB` → `__MqttHelper__.sendMessage` → `/ls_req`). Vượt được lỗi
   `"(#10) … một ứng dụng khác hiện đang kiểm soát thread này"` (bot/app khác giữ quyền thread).
   Cần **extension Pancake V2** (đăng nhập Facebook trong trình duyệt).
3. **Extension Pancake** — đường `executeByExt` của app (`REPLY_INBOX_PHOTO`).

**Không còn cơ chế gửi từng con** (đã bỏ gửi tuần tự và tầng giao diện “nhảy vào từng chat”).
Gửi theo lượt: chỉnh **“Mỗi lượt: N tin — nghỉ N ms”** ngay trên panel (mặc định **5000 tin/lượt, nghỉ 0ms** —
cả hai **đều chỉnh được và lưu lại, giữ qua F5**; số tin ≤ số/lượt thì gửi 1 lượt). Mỗi lượt bắn song song toàn bộ. Bấm
**“⛶ Phóng to log”** / **“⛶ Phóng to”** (bảng LIST CÂU GỬI) để bung thành **cửa sổ lớn
nổi trên trang** (không làm panel cao thêm) — cửa sổ **kéo tiêu đề để di chuyển**, **kéo góc dưới-phải
để phóng to/thu nhỏ** (đúp chuột góc = về mặc định), vị trí + cỡ **lưu giữ qua F5**; bấm **“🗕 Thu nhỏ…”**
hoặc **✕** trên tiêu đề cửa sổ để thu về đúng chỗ cũ trong panel. Nút **✕** trên tiêu đề panel để tắt
hẳn panel — **F5** (hoặc **Alt+Shift+B**) để hiện lại.

**Chống trùng tin (gửi đúng 1 lần/chat):** mỗi chat chỉ xuất hiện 1 lần trong danh sách gửi (tự loại
dòng trùng id, chặn bấm đúp). Khi một kênh báo **“không rõ kết quả”** (lỗi mạng/timeout — tin có thể
đã đi), script **dừng ngay**, không thử kênh khác và **không gửi thêm** — ghi `⚠` trong log để bạn biết.
**Lỗi là lỗi**: tin báo ❌ (chắc chắn chưa gửi) chỉ bị báo trong log — **không gửi lại, không kiểm tra
lại** — ưu tiên tốc độ.
- **⚡ Gửi nhanh** (mặc định bật, ô cạnh thiết lập lượt): bắn API **không chờ server xác nhận** — xong là báo ✅ ngay.
  Chat bị API từ chối RÕ thì tự **bù Socket/Ext trong nền** (log có dòng bù); không rõ kết quả thì bỏ — không gửi lại để tránh trùng.
- **Thông minh hơn — đoán trước kênh gửi** (đúng luật app `SEND_MESSAGE_API_TIME_WINDOW`): chat **ngoài cửa sổ 24h**
  (không có ads 7 ngày) → **gửi thẳng Socket/Ext** khỏi bắn API chắc thua `(#551)`; API bị chặn giữa lô `(#10)/(#551)…`
  → chat còn lại đi thẳng; chat đã biết kênh tốt → dùng luôn kênh đó. Ít lỗi hơn hẳn, không phải gửi bù mất thời gian.
- **Cứu globalId (PSID)**: nếu WS/Ext không tìm ra PSID thì dùng ngay `from_psid` mà API đã trả sẵn trong dữ liệu
  chat (khỏi dò tìm); Ext bị PSID rỗng thì bỏ qua cho nhanh; Socket/Ext đều thua rõ thì **API là cứu cánh cuối**
  (chỉ chạy khi chắc chắn chưa gửi gì — không lo trùng).
- **Gửi giống hệt request thật của app** (đã so khớp từng trường với curl thật): đủ `send_by_platform=web`,
  `width`/`height` ảnh, đúng thứ tự trường, và body `contents/facebook` dạng JSON như app.
- **Bỏ bước thừa**: ảnh ngoài cửa sổ 24h không bắn API trước nữa (chắc chắn #551) — đi thẳng Ext,
  API chỉ là cứu cánh cuối; nhãn log bù đúng kênh thật (ảnh = Ext, chữ = Socket/Ext).
- **Hết delay giữa 2 lần gửi**: PSID đã có trong dữ liệu → dùng ngay, khỏi chờ WS/Ext dò tìm (trước ngốn
  vài giây/tin); dòng chat đủ threadId + pageId → khỏi tải lại conversation. Lô gửi vẫn song song toàn phần.
- **Socket hết báo "không rõ" oan**: socket chết (frame chưa hề đi) hoặc server báo gửi thất bại
  (markOptimisticMessageFailed) → THUA RÕ → tự bù Ext/API tiếp; chỉ "đã gửi nhưng không có ACK"
  mới bị dừng chống trùng. Không còn con nào bị im lặng bỏ sót.
- **API không bị cướp oan**: `#551` (chặn của TỪNG NGƯỜI — ngoài cửa sổ) chỉ bù cho chính chat đó,
  không tước API cả lô nữa (chỉ rate limit/FB handover/thread-control mới chặn lô); chat thiếu mốc
  thời gian → để API thử trước thay vì đoán bừa.
- **Payload Ext đủ trường như app**: dòng chat giờ mang theo `thread_key`/tên khách/`updated_at` — payload
  gửi qua Extension không còn thiếu `convId`/`customerName`/`conversationUpdatedTime` (nguyên nhân Ext hay
  "không gửi được"); PSID chỉ lấy từ `from_psid` chính danh; server từ chối người nhận → kênh sau tự dò lại
  PSID chính chủ qua WS/Ext.
- **Bù Socket hết chậm**: Socket được "làm nóng" ngay từ lúc bắn lô (kết nối + đồng bộ chạy song song
  các bắn API) — con cần bù Socket chỉ còn ~1–2s thay vì ~10s phí kết nối như trước.
- **Socket nhanh hơn nữa**: dựng thẳng khung `/ls_req` gốc của app (label 46 + 21, id sinh đúng kiểu
  app) và gọi `helper.publish` — bỏ hẳn bước chờ 1s trong `sendMessage` của app. Vẫn chờ ACK của
  server để phân loại chắc/thiếu — không mất gì về độ chính xác.
- **Full speed**: mặc định 5000 tin/lượt, nghỉ 0ms giữa lượt — lô gửi bung hết tốc độ như tool gửi
  hàng loạt (không còn khoảng hãm nào trong đường gửi). Muốn hãm lại thì chỉnh 2 ô — vẫn lưu qua F5.
- **Bù sau nhịp — chống mất tin, hết "gửi đi gửi lại" (v1.39.0)**: bắn lô dồn (8–21 tin/giây) mà bù
  Socket/Ext NGAY là Facebook "báo gửi thất bại" hàng loạt (đang giữ nhịp gửi của tài khoản) —
  cùng chat đó bù lại sau ~12 giây là thắng (đã đối chiếu bằng chứng trong log). Nên khi kênh
  **thừa nhận thua** (chắc chắn tin chưa đến nơi) thì script **bù ĐÚNG 1 LẦN, 1 KÊNH** (text →
  Socket, ảnh/bình luận → Ext) sau nhịp ~12s, **rải đều ~1.2s** giữa các chat để FB không giữ nhịp.
  Trước đây mỗi chat bị thử đi thử lại 4–5 lần qua hết lối này tới lối khác trong 30–60s — nay
  tối đa: 1 phát API + 1 lần bù. Chat **đã có kênh báo thành công thì tuyệt đối không gửi lại**
  (dù bù đang chờ); bắt đầu lượt gửi mới thì bù dở của lượt cũ tự hủy (không gửi lẫn 2 lượt).
  Tin **"không rõ" (maybe)** vẫn tuyệt đối không gửi thêm — chống trùng tin. Socket cũng được
  khởi động lại đúng kiểu app (initSocket tự kiểm `isRunning`) và luôn chờ làm nóng xong mới bắn.
- **Socket/Ext gửi LẦN LƯỢT từng chat (hàng đợi)**: gửi lô mà bắn Socket/Extension đồng loạt thì
  hỏng hàng loạt (Extension trả "không gửi được", socket bị server "báo gửi thất bại") — đúng như
  thực tế "chọn riêng 1 con thì chạy, chọn cả lô thì lỗi". Nên mọi bước Socket/Ext được xếp vào 1
  hàng đợi: lệnh xong mới tới lệnh kế — giống hệt kịch bản gửi riêng từng con vốn chạy ngon. API vẫn
  bắn song song full speed (fetch thuần không đụng Extension/Socket).
- **Socket không còn 'không kết nối' oan**: socket được làm nóng ngay khi mở panel; nếu đang kết nối
  dở thì kênh Socket chờ xong rồi gửi thay vì bỏ cuộc. Lỗi Extension giờ giữ nguyên lý do extension
  trả về (log lộ đúng nguyên nhân thay vì chỉ 'không gửi được'). Token lấy từ cookie `jwt` như app.
- **Payload Ext không bao giờ thiếu `convId`**: dòng list cũ/thiếu `thread_key` → tự dẫn xuất `t_` +
  `thread_id` (đúng định dạng của app) hoặc nạp đầy đủ conversation; `conversationUpdatedTime` không
  bao giờ là NaN — hai lý do hay khiến Extension từ chối trong khi gửi tay vẫn chạy.
- **Gửi API y hệt 13 request gửi THẬT của app (`tinnhan.har` 2026-10-17)**: `POST .../messages`
  KHÔNG kèm `access_token` trong URL (auth bằng cookie `jwt` như người thật) và body đúng thứ tự
  `action → is_record_ctx_7_days (khi dr()) → message → [ảnh] → send_by_platform`. **Bản trước
  bỏ hẳn `is_record_ctx_7_days` là SỢI** — đối chiếu HAR gửi thật: app luôn kèm cờ này khi dr()
  đúng, 11/13 request thành công có cờ. THIẾU cờ = bị soi cửa sổ 24h gắt (#551) với **mọi chat
  ngoài cửa sổ 24h** — đây là "lỗi không gửi được tin" triệt để đã tìm ra. Text luôn đi API-trước.
- **Gửi xong tự bỏ chọn**: sau lượt gửi, các đoạn chat đã đánh dấu tự được "Xóa" chọn (như bấm nút
  Xóa) — sẵn sàng chọn lượt mới, và bấm chạy lại không bao giờ dính dấu cũ (chống gửi trùng).
- **Text luôn đi API-trước — hết vòng vo**: hint/dự đoán không còn ép text vào Socket/Ext (chậm,
  hàng đợi Extension xếp hàng) — gửi thẳng API cookie-auth như gửi tay (HAR 200 chứng minh);
  ảnh mới dùng hint. Bù cũng hết chậm: không dò PSID qua Extension khi kênh chỉ từ chối (cửa sổ).
- **Tự lọc tag "chốt"/"chặn" lúc gửi — 3 lớp bằng chứng (v1.40.0)**: trước khi bắn, script kiểm tra
  tag cấm của TỪNG chat qua đủ 3 nguồn — (1) **tag hiển thị ngay trên dòng chat (DOM)** — mắt thấy gì
  dùng nấy, tag "CHẶN" hiện trên dòng là bị loại cho dù dữ liệu nào khác hỏng; (2) dữ liệu app:
  `filledTags` (app tự map id → tên tag) hoặc `tags` id + bảng tag trang
  (`pageSettingTags` — shape `{[pageId]: defs}` lẫn mảng phẳng); (3) tải lại tag 1 lượt qua API lọc
  sẵn theo id (id giữ dạng **số** như app — id chuỗi bị server bỏ qua). Và **chốt phút chót**: soi lại
  tag/icon NGAY TRƯỚC khi bắn từng chat — tag gắn sau bước lọc vẫn bị chặn. Không kiểm tra được gì →
  vẫn gửi (thiếu dữ liệu không được làm mất tin); log kèm tên tag đã khớp để đối chiếu. So khớp tên
  nguyên từ, không phân biệt hoa/thường, chuẩn hóa Unicode: "CHẶN"/"chặn"/"Chặn tin"/"Huyền chốt" bị
  loại; "Bình Chánh"/"Chánh"/"chanh" KHÔNG dính (không loại oan).
- **Bỏ qua chat có icon điện thoại**: chat nào hiện icon 📞 (`phone-green` = `has_phone`, sale đang
  chăm số) cũng bị loại khỏi lô — soi cả icon trên màn hình, dữ liệu live của app lẫn dòng đã lưu.
  Log tách riêng từng nhóm: tag chốt/chặn 🧹 và icon điện thoại 📞.
  Lọc tag CHẶT CHẼ: chỉ loại khi CHÍNH chat đó mang tag cấm trong dữ liệu trả về (server có lơ
  filter vẫn không loại oan), so khớp "chốt"/"chặn" nguyên từ ("Bình Chánh"/"Chánh" không dính),
  và log kèm tên tag đã khớp để đối chiếu.

Tự động tăng tốc: sau lần đầu API bị `(#10)/(#551)…`, các chat còn lại **bỏ qua API** đi thẳng sang Socket;
kênh gửi thành công được **ghi nhớ** (session) nên lần gửi sau vào thẳng kênh đó.
Mỗi chat chỉ **tải/giải quyết 1 lần** cho mọi kênh dùng chung (conversation, threadId, globalId, bình luận);
tìm globalId **chạy đua** WebSocket (`__MqttHelper__.findGlobalId`, có cache) ↔ Extension — ai xong trước dùng trước
(đúng `concurrentlyGetGLobalId` của app); ảnh cho Extension upload song song bước tìm thread/globalId. Log từng dòng ghi rõ
kênh: `— đã gửi`, `— qua Socket`, `— qua Extension`.

**Gửi kèm ảnh (📷 Chọn ảnh / Ctrl+V):** chọn file ảnh, hoặc copy ảnh (screenshot, ảnh trên web…)
rồi **Ctrl+V** dán thẳng vào trang — ảnh dán không có tên file sẽ tự đặt `clipboard.png`. Đúng chuỗi app dùng khi gửi ảnh — upload file lên `POST /v1/contents`
(1 lần) → gắn attachment Facebook qua `POST /v1/pages/{p}/contents/facebook` (1 lần/page) →
gửi qua **API** (`attachment_id` + `content_url`) hoặc **Extension** (`REPLY_INBOX_PHOTO`,
`attachmentType:"PHOTO"`). Kênh gửi ảnh là **API → Extension** (Socket không hỗ trợ ảnh).
Không tải được ảnh thì **HỦY gửi** — không bao giờ gửi thiếu ảnh.
Gắn attachment đúng như app: `POST /v1/pages/{p}/contents/facebook` (`content_ids`, `is_reusable=true` cho
đường API) — riêng đường **Extension** upload attachment **mới** với `is_reusable=false` y như `executeByExtOnce`
(app không dùng lại attachment tái sử dụng cho Ext — dùng lại sẽ bị từ chối "Extension không gửi được").
Kèm cờ `is_record_ctx_7_days` khi đủ điều kiện cửa sổ quảng cáo 7 ngày của app (`dr()`: khách ≥1 ngày không
tương tác + page bật `ctx_7_days_enabled` + khách có `ad_clicks` ≤7 ngày) — cờ này cho phép gửi ngoài cửa sổ
24h với khách từ quảng cáo, đúng việc gửi tay trong app làm được (đối chiếu `buildRequestBody` trong `_app`:
`(0,ev.dr)()&&(j.is_record_ctx_7_days=!0)`). **Nghiêm ngặt đúng dr()**: thiếu dữ liệu `ad_clicks` thì KHÔNG
bật cờ (không bịa thêm — app cũng vậy); chat ngoài 24h không thuộc cửa sổ quảng cáo sẽ được **bù qua Socket**
(đường gửi tay). Kết quả "đã gửi" ở chế độ nhanh = request **đã bắn**, xác nhận đến nơi xử lý trong nền —
server từ chối là **báo rõ + tự bù 1 lần**, không bao giờ "báo gửi" rồi im lặng.
**Học `globalUserId` đúng từ extension (v1.38.0)**: app sau khi Extension thành công có event
`update_global_id` — globalId extension trả về có thể ĐÚNG hơn giá trị đoán từ `from_psid` (có khách
globalId là FBID `1000…` chứ không phải PSID). Script nay: (1) cache `res.data.globalUserId` vào
`__tempGlobalIdCache__` sau mỗi lần Ext thành công; (2) nếu server "báo gửi thất bại" mà globalId chỉ
là DOÁN từ `from_psid` → forceFind dò lại id đúng 1 lần rồi kênh sau dùng id vừa dò được.

## Lưu ý

- **Snippet so khớp là snippet hiển thị** (đã cắt ngắn có `...` đúng như bạn thấy trong danh sách) —
  "có cùng snippet" nghĩa là giống nhau trên màn hình bạn đang nhìn.
- **Chuỗi chọn** lấy theo thứ tự trên→dưới của danh sách đoạn chat tại thời điểm chọn.
- Gửi tin đi qua **cùng API mà Pancake dùng** khi nhân viên bấm Gửi trong ô chat
  (`#replyBoxComposer` → `action=reply_inbox`), nên tin hiện trong lịch sử chat như 1 tin nhắn bình thường.
  Nếu API bị chặn (lỗi `#10` do bot/app khác giữ quyền thread), script tự chuyển sang gửi qua
  **Socket** (đúng đường gửi tay — nhanh), rồi **Extension Pancake**. Tin không gửi được qua cả 3 kênh
  sẽ báo lỗi trong log — script **không nhảy vào từng chat để gửi tay** nữa.
- Đoạn chat loại **COMMENT** (bình luận bài viết) được gửi bằng **cơ chế riêng của app** —
  `action=reply_comment` (trả lời bình luận mới nhất của khách, công khai dưới bài viết) hoặc
  `action=reply_post`, fallback qua Extension (`SEND_COMMENT`) — **không** dùng `reply_inbox`
  (Facebook từ chối `(#551) Người này hiện không có mặt` với chat bình luận). Mặc định các chat
  này bị bỏ tick — muốn gửi thì tự tick chọn; hộp xác nhận sẽ ghi rõ "TRẢ LỜI BÌNH LUẬN".
- Nếu log báo **token hết hạn** → tải lại trang Pancake rồi chạy lại (token mới được script tự bắt).
- Nên chạy với 1 tab Pancake; đừng gửi quá nhanh (để nguyên giãn cách ≥ 1000 ms) để tránh bị Facebook
  chặn do spam.
- **LIST CÂU GỬI** (trước đây là “list”): **1 câu = nội dung cần gửi + các chat nhận**. Sau khi gõ
  câu cần gửi và chọn chat (mục 1), bấm **＋ Tạo câu gửi** — **câu đang gõ lúc đó được gắn liền với câu
  lưu** (lưu vào trình duyệt — không mất khi tải lại trang) và **tự gắn với lượt gửi hiện tại**.
  **Tích ô chọn** nhiều câu để **gửi cùng lúc** — **mỗi câu được gửi đúng chữ của câu đó** (chat lẻ
  không thuộc câu nào thì dùng ô đang gõ). Bấm **✎** để **sửa tên + nội dung từng câu** (ô nhiều dòng),
  ✕ xóa, kéo **⠿** để sắp xếp thứ tự. Tích 1 câu → nội dung câu tự nạp vào ô cần gửi.
  **Gửi xong (kể cả lỗi giữa chừng) thì các câu đã chốt tiêu thụ tự xóa** — danh sách xóa được chốt
  ngay từ khi bấm Gửi, không phụ thuộc việc giữa chừng bấm tích/bỏ tích (mỗi câu chỉ gửi 1 lần — chống gửi trùng).
- Bấm **—** để thu panel thành **bóng logo BOTFAKE** (con quỷ tím) — **kéo thả bóng** đi bất kỳ đâu
  (kéo >4px = dời chỗ, bấm thật = mở lại panel);
  **✕** tắt hẳn panel (Alt+Shift+B để hiện lại). Logo vẽ bằng SVG khớp logo gốc ~99%.
- Script đặt id prefix `ssb-` nên **không đụng** các script khác đang chạy trên trang của bạn
  (`pk-*`, `adj-*`, `pancake-*`).
