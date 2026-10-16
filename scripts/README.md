# Script: Gửi 1 câu cho toàn bộ đoạn chat có cùng snippet

File: `pancake-send-by-snippet.user.js` — chạy bằng **Tampermonkey** trên trang chat Pancake
(`/page/conversation`).

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
   - **Tải qua API trước (siêu nhanh)** — đúng request mà app Pancake tự gọi
     (`GET /api/v1/conversations` + phân trang `next_cursor`): 2000–3000 chat chỉ mất vài giây,
     **không cuộn gì cả**. Tự kiểm tra khớp với màn hình; nếu không khớp (ví dụ bạn đang bật bộ lọc
     tag/loại) thì tự chuyển sang quét giao diện cho đúng những gì đang thấy.
   - **Quét giao diện** (dự phòng): bước cuộn lớn, chờ tối thiểu, đếm dần trên nút, xong tự cuộn về chỗ cũ.
   Chuỗi **hàng nghìn chat** vẫn chạy tốt. Với chuỗi ≥150 chat nên chọn tốc độ **“Song song 5 luồng”**
   để không bị Facebook chặn (429).
5. Bỏ tick chat nào không muốn gửi trong danh sách mục 2.
6. Nhập **1 câu** cần gửi vào mục 3 → chọn **tốc độ gửi** → bấm **“Gửi 1 câu cho tất cả”** → xác nhận.
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
Gửi theo lượt: chỉnh **“Số tin mỗi lượt”** ngay trên panel (mặc định **200 tin/lượt**, các lượt cách
nhau **500ms**; số tin ≤ số/lượt thì gửi 1 lượt). Mỗi lượt bắn song song toàn bộ. Bấm
**“⛶ Phóng to log”** để bung bảng log thành **cửa sổ lớn nổi trên trang** (không làm panel cao thêm);
bấm **“🗕 Thu nhỏ log”** để thu về. Nút **✕** trên tiêu đề panel để tắt hẳn panel —
**F5** (hoặc **Alt+Shift+B**) để hiện lại.

**Chống trùng tin (gửi đúng 1 lần/chat):** mỗi chat chỉ xuất hiện 1 lần trong danh sách gửi (tự loại
dòng trùng id, chặn bấm đúp). Khi một kênh báo **“không rõ kết quả”** (lỗi mạng/timeout — tin có thể
đã đi), script **dừng ngay**, không thử kênh khác và **không gửi thêm** — ghi `⚠` trong log để bạn biết.
**Lỗi là lỗi**: tin báo ❌ (chắc chắn chưa gửi) chỉ bị báo trong log — **không gửi lại, không kiểm tra
lại** — ưu tiên tốc độ.

Tự động tăng tốc: sau lần đầu API bị `(#10)`, các chat còn lại **bỏ qua API** đi thẳng sang Socket;
kênh gửi thành công được **ghi nhớ** (session) nên lần gửi sau vào thẳng kênh đó. Log từng dòng ghi rõ
kênh: `— đã gửi`, `— qua Socket`, `— qua Extension`.

## Lưu ý

- **Snippet so khớp là snippet hiển thị** (đã cắt ngắn có `...` đúng như bạn thấy trong danh sách) —
  "có cùng snippet" nghĩa là giống nhau trên màn hình bạn đang nhìn.
- **Chuỗi chọn** lấy theo thứ tự trên→dưới của danh sách đoạn chat tại thời điểm chọn.
- Gửi tin đi qua **cùng API mà Pancake dùng** khi nhân viên bấm Gửi trong ô chat
  (`#replyBoxComposer` → `action=reply_inbox`), nên tin hiện trong lịch sử chat như 1 tin nhắn bình thường.
  Nếu API bị chặn (lỗi `#10` do bot/app khác giữ quyền thread), script tự chuyển sang gửi qua
  **Socket** (đúng đường gửi tay — nhanh), rồi **Extension Pancake**. Tin không gửi được qua cả 3 kênh
  sẽ báo lỗi trong log — script **không nhảy vào từng chat để gửi tay** nữa.
- Đoạn chat loại **COMMENT** (bình luận bài viết) có thể bị API từ chối với `reply_inbox`;
  chat nào lỗi sẽ hiện rõ trong log (thường chỉ gặp với chat Inbox là mượt).
- Nếu log báo **token hết hạn** → tải lại trang Pancake rồi chạy lại (token mới được script tự bắt).
- Nên chạy với 1 tab Pancake; đừng gửi quá nhanh (để nguyên giãn cách ≥ 1000 ms) để tránh bị Facebook
  chặn do spam.
- Script đặt id prefix `ssb-` nên **không đụng** các script khác đang chạy trên trang của bạn
  (`pk-*`, `adj-*`, `pancake-*`).
