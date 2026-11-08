# TRALOINHANH — Trả lời nhanh cho Sale (câu tắt `/cn` + bong bóng kéo thả)

File: `scripts/traloinhanh.user.js` (v6.0.0) — Tampermonkey, chạy trên trang chat Pancake
(`pancake.vn`, `pages.fm`, `pancake.ph/id/in/biz`, `socialos.vip`).

**Đây là bản nâng cấp của script “Hỗ trợ trả lời Sale (Draggable Bubble - v5.5)”.**
`@name` + `@namespace` được **giữ nguyên** để Tampermonkey coi là cùng một script:
chỉ cần mở script cũ trong Tampermonkey → dán đè toàn bộ nội dung mới → Lưu (không bị cài thành 2 script).

## Có gì mới so với v5.5

| v5.5 | v6.0.0 |
|---|---|
| Mỗi câu có “mô tả ngắn” (label) + bấm trong panel để **ghi đè** ô nhập | Bỏ label. Mỗi câu có **câu tắt** (`/cn`) — gõ ngay trong ô soạn tin là câu tự nhảy vào |
| Phải mở panel rồi bấm từng câu | Gõ `/cn` + **Enter/Tab** (hoặc gõ thêm dấu cách) là xong, **không cần mở panel** |
| Ghi đè toàn bộ ô nhập | **Chèn tại con trỏ**, giữ nguyên chữ đang gõ dở (bôi đen thì thay vùng bôi đen) |
| Thêm/sửa bằng `prompt()` của trình duyệt | Form trong panel, chặn **trùng câu tắt**, tự chuẩn hóa (bỏ dấu, lowercase, bỏ `/`) |
| — | Ô **tìm kiếm** câu tắt/nội dung, nút 📋 sao chép từng câu, phím tắt `Alt+Shift+S` |
| — | Tự **di trú** dữ liệu cũ (`sqr_data_v5`, kể cả label) sang dữ liệu mới, sinh câu tắt từ nhãn cũ |

## Sử dụng

1. **Gõ câu tắt trong ô soạn tin** của Pancake (ô `textarea#replyBoxComposer`):
   - Gõ `/` → hiện danh sách câu tắt gợi ý ngay **phía trên ô soạn tin**.
   - Gõ tiếp chữ (vd `/cn`) → lọc dần, gợi ý khớp đầu câu tắt được ưu tiên.
   - **Enter / Tab** (hoặc bấm vào gợi ý): chèn **nguyên văn câu trả lời** vào đúng vị trí con trỏ,
     xóa luôn phần `/cn`, đặt con trỏ ở cuối câu → **bấm Enter lần nữa là gửi** (script không tự gửi).
   - **↑ ↓** đổi lựa chọn, **Esc** đóng gợi ý. Gõ đúng câu tắt rồi **cách ra** cũng chèn luôn
     (tắt được bằng ô “Chèn ngay khi gõ xong câu tắt + dấu cách” ở cuối panel).
   - `/` dính liền chữ (`abc/xyz`) thì **không** kích hoạt, để không phá link/giờ (`10/11`).
   - Đang gõ tiếng Việt bằng bộ gõ (IME) thì script **không chen ngang** — chỉ xử lý sau khi chốt chữ.
2. **Bong bóng 💬** (kéo thả bất kỳ đâu, vị trí được nhớ qua F5): bấm để mở panel
   danh mục + câu tắt. `Alt+Shift+S` mở/đóng panel.
3. **Chỉnh sửa** (nút “⚡ Làm việc” → “✏️ Chỉnh sửa”):
   - `+ Thêm danh mục mới`, ✏️ đổi tên, 🗑️ xóa danh mục; `+ Thêm câu tắt cho danh mục này`, ✏️ sửa câu, 🗑️ xóa câu.
   - Kéo **⠿** để sắp xếp lại danh mục/câu. Mọi thay đổi được lưu ngay (GM storage + `localStorage`).
4. Ở chế độ Làm việc, bấm 1 câu = chèn vào ô soạn tin đang dùng (nếu chưa chọn ô nào thì sao chép).

## Script dựa vào phần nào của source trong repo?

| Phần source | Nội dung được dùng |
|---|---|
| `html2.txt`, `html3.txt` | `div.reply-box-container` → `div.reply-box__text-area` → `<textarea id="replyBoxComposer" placeholder="Trả lời từ …">` — đây là ô soạn tin thật của Pancake (không phải contenteditable), nên việc chèn câu dùng native `value` setter + `dispatchEvent(new Event('input', {bubbles:true}))` và `setSelectionRange` để React của app nhận đúng thay đổi và giữ caret. |
| `_app-9331d46f21a84eb1.v6.js` | `forcusReplyCompose()` = `document.getElementById("replyBoxComposer")` rồi `.focus()` ⇒ `#replyBoxComposer` là điểm vào ổn định để chèn câu/focus. |
| Script v5.5 của người dùng | Giữ nguyên phần khung: Shadow DOM chống đụng CSS app, bong bóng 💬 kéo thả (mouse + touch), panel bám theo bong bóng, danh mục kéo thả ⠿, chế độ Làm việc/Chỉnh sửa. |

Không có selector/API nào được bịa thêm: chỉ dùng `#replyBoxComposer`, `.reply-box-container`,
`.reply-box__text-area` (có trong HTML đã lưu) và thêm dự phòng `contenteditable` cho ô bình luận.
