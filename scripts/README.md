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
Gửi theo lượt: chỉnh **“Mỗi lượt: N tin — nghỉ N ms”** ngay trên panel (mặc định **200 tin/lượt, nghỉ 500ms** —
cả hai **đều chỉnh được và lưu lại, giữ qua F5**; số tin ≤ số/lượt thì gửi 1 lượt). Mỗi lượt bắn song song toàn bộ. Bấm
**“⛶ Phóng to log”** để bung bảng log thành **cửa sổ lớn nổi trên trang** (không làm panel cao thêm);
bấm **“🗕 Thu nhỏ log”** để thu về. Nút **✕** trên tiêu đề panel để tắt hẳn panel —
**F5** (hoặc **Alt+Shift+B**) để hiện lại.

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
24h với khách từ quảng cáo, đúng việc gửi tay trong app làm được.

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
- **LIST ĐÃ LƯU**: sau khi chọn chat (mục 1), bấm **＋ Tạo list từ lựa chọn** để lưu thành list
  (lưu vào trình duyệt — không mất khi tải lại trang). **Tích ô chọn** nhiều list để **gửi cùng lúc** (gộp chat, loại trùng),
  ✎ đổi tên, ✕ xóa, kéo **⠿** để sắp xếp thứ tự. Kéo góc dưới-phải panel để **đổi cỡ bảng** (đúp chuột = về mặc định). Tạo được nhiều list, đổi page vẫn gửi đúng list đã lưu. **Gửi xong thì các list đã tích tự xóa** (mỗi list chỉ gửi 1 lần — chống gửi trùng).
- Bấm **—** để thu panel thành **bóng logo BOTFAKE** (con quỷ tím) — **kéo thả bóng** đi bất kỳ đâu
  (kéo >4px = dời chỗ, bấm thật = mở lại panel);
  **✕** tắt hẳn panel (Alt+Shift+B để hiện lại). Logo vẽ bằng SVG khớp logo gốc ~99%.
- Script đặt id prefix `ssb-` nên **không đụng** các script khác đang chạy trên trang của bạn
  (`pk-*`, `adj-*`, `pancake-*`).
