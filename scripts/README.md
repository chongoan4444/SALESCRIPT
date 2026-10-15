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
3. Các dòng **viền xanh lá** là chat sẽ được nhận tin (dòng đầu/cuối chuỗi hoặc nguồn snippet viền xanh dương).
4. **Script không bao giờ tự cuộn danh sách** — khi cần quét toàn bộ chat (để chọn chuỗi chính xác
   khắp danh sách / so khớp snippet ngoài vùng đang thấy), bấm **“⚡ Tải danh sách”**: script quét
   siêu nhanh (bước cuộn lớn, chờ tối thiểu), đếm dần trên nút, xong tự cuộn về chỗ cũ.
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

## 4 tầng gửi (tự động dự phòng, nhớ kênh tốt)

1. **API** — nhanh nhất, gửi song song nhiều chat cùng lúc.
2. **Socket (Facebook WebSocket)** — **đúng đường “gửi bình thường”** mà app Pancake dùng khi bạn
   gõ tay (`executeBySocketFB` → `__MqttHelper__.sendMessage` → `/ls_req`). Vượt được lỗi
   `"(#10) … một ứng dụng khác hiện đang kiểm soát thread này"` (bot/app khác giữ quyền thread).
   Cần **extension Pancake V2** (đăng nhập Facebook trong trình duyệt).
3. **Extension Pancake** — đường `executeByExt` của app (`REPLY_INBOX_PHOTO`).
4. **Giao diện** — cuối cùng: tự mở chat → điền ô chat → Enter (giống bạn gửi thủ công).

Tự động tăng tốc: sau lần đầu API bị `(#10)`, các chat còn lại **bỏ qua API** đi thẳng sang Socket;
kênh gửi thành công được **ghi nhớ** (session) nên lần gửi sau vào thẳng kênh đó. Log từng dòng ghi rõ
kênh: `— đã gửi`, `— qua Socket`, `— qua Extension`, `— qua giao diện`.

## Lưu ý

- **Snippet so khớp là snippet hiển thị** (đã cắt ngắn có `...` đúng như bạn thấy trong danh sách) —
  "có cùng snippet" nghĩa là giống nhau trên màn hình bạn đang nhìn.
- **Chuỗi chọn** lấy theo thứ tự trên→dưới của danh sách đoạn chat tại thời điểm chọn.
- Gửi tin đi qua **cùng API mà Pancake dùng** khi nhân viên bấm Gửi trong ô chat
  (`#replyBoxComposer` → `action=reply_inbox`), nên tin hiện trong lịch sử chat như 1 tin nhắn bình thường.
  Nếu API bị chặn (lỗi `#10` do bot/app khác giữ quyền thread), script tự chuyển sang gửi qua
  **Socket** (đúng đường gửi tay — nhanh), rồi **Extension Pancake**, cuối cùng qua **giao diện** —
  hãy cài extension Pancake V2 để dùng các tầng dự phòng nhanh.
- Đoạn chat loại **COMMENT** (bình luận bài viết) có thể bị API từ chối với `reply_inbox`;
  chat nào lỗi sẽ hiện rõ trong log (thường chỉ gặp với chat Inbox là mượt).
- Nếu log báo **token hết hạn** → tải lại trang Pancake rồi chạy lại (token mới được script tự bắt).
- Nên chạy với 1 tab Pancake; đừng gửi quá nhanh (để nguyên giãn cách ≥ 1000 ms) để tránh bị Facebook
  chặn do spam.
- Script đặt id prefix `ssb-` nên **không đụng** các script khác đang chạy trên trang của bạn
  (`pk-*`, `adj-*`, `pancake-*`).
