# TRALOINHANH — Trả lời nhanh cho Sale (câu tắt `/cn` + bong bóng kéo thả)

File: `scripts/traloinhanh.user.js` (v6.4.0) — Tampermonkey, chạy trên trang chat Pancake
(`pancake.vn`, `pages.fm`, `pancake.ph/id/in/biz`, `socialos.vip`).

**Đây là bản nâng cấp của script “Hỗ trợ trả lời Sale (Draggable Bubble - v5.5)”.**
`@name` + `@namespace` được **giữ nguyên** để Tampermonkey coi là cùng một script:
chỉ cần mở script cũ trong Tampermonkey → dán đè toàn bộ nội dung mới → Lưu (không bị cài thành 2 script).

## Có gì mới so với v5.5

| v5.5 | v6.2.0 |
|---|---|
| Mỗi câu có “mô tả ngắn” (label) + bấm trong panel để **ghi đè** ô nhập | Bỏ label. Mỗi câu có **câu tắt** — gõ **`//cn`** ngay trong ô soạn tin là câu tự nhảy vào |
| — | **Chỉ kích hoạt với `//`** (hai gạch): `/` một gạch vẫn là bảng câu nhanh gốc của Pancake |
| — | **Danh sách về trắng**: bỏ hết câu mẫu + câu đã lưu của bản cũ, bạn tự thêm câu của mình |
| Phải mở panel rồi bấm từng câu | Gõ `//cn` + **Enter/Tab** (hoặc gõ thêm dấu cách) là xong, **không cần mở panel** |
| Ghi đè toàn bộ ô nhập | **Chèn tại con trỏ**, giữ nguyên chữ đang gõ dở (bôi đen thì thay vùng bôi đen) |
| Thêm/sửa bằng `prompt()` của trình duyệt | Form trong panel, chặn **trùng câu tắt**, tự chuẩn hóa (bỏ dấu, lowercase, bỏ `/`) |
| — | Ô **tìm kiếm** câu tắt/nội dung, nút 📋 sao chép từng câu, phím tắt `Alt+Shift+S` |
| — | Lần chạy đầu của v6.2.0 **dọn sạch** dữ liệu cũ (`tln_data_v1`, `sqr_data_v5`) và in bản sao ra console |
| Có thông báo “Đã chèn câu…” mỗi lần chọn câu | **Không còn toast** khi chọn/chèn câu (chỉ giữ cảnh báo lỗi) |
| 1 câu = 1 tin | **1 câu tắt = nhiều tin**: Enter **một lần** là script tự điền + tự gửi tiếp các tin còn lại |
| — | **Không còn che bảng "/" gốc của Pancake**: bảng gợi ý của script tự ẩn bảng gốc khi mở, và **kéo được** (lưu vị trí) nếu vẫn muốn dời đi chỗ khác |

## Sử dụng

0. **Thêm câu tắt của bạn**: bấm bong bóng 💬 → “✏️ Chỉnh sửa” → “+ Thêm danh mục mới” →
   trong danh mục bấm “+ Thêm câu tắt cho danh mục này” → nhập **câu tắt** (vd `cn`) + **nội dung**.
   Danh sách mặc định **trống** (bản v6.2.0 đã xoá hết câu mẫu & câu cũ một lần khi nâng cấp).

   **Một câu tắt gửi nhiều tin liên tiếp:** trong ô nội dung, ngăn các tin bằng **một dòng trống**, ví dụ

   ```
   Dạ em chào anh/chị ạ!

   Bên em đang freeship toàn quốc.

   Anh/chị chốt giúp em nhé!
   ```

   = 3 tin. Khi dùng `//cau_tat`:

   1. Tin 1 được điền vào ô chat.
   2. Bạn **Enter MỘT LẦN** (gửi tin 1) → app gửi xong, script **tự điền + tự gửi tiếp** tin 2, tin 3…
      cách nhau **“Giãn cách”** (mặc định **1200 ms/tin**, chỉnh ở cuối panel).

   Cạnh ô soạn tin có nhãn tím **“3 tin — Enter (gửi tin 1) là script tự gửi tiếp cả 3 tin”** →
   khi chạy đổi thành **“Đang tự gửi 2/3 tin…”**; bấm **✕** trên nhãn = **DỪNG** ngay.
   Muốn kiểu cũ (mỗi tin Enter một lần): panel → **“Câu nhiều tin: Thủ công (Enter từng tin)”**.
   Script không điền oan khi bạn tự xoá nội dung; xuống dòng đơn trong một tin vẫn giữ nguyên (không tách tin).
1. **Gõ câu tắt trong ô soạn tin** của Pancake (ô `textarea#replyBoxComposer`):
   - Gõ **`//`** (hai gạch chéo) → hiện danh sách câu tắt gợi ý ngay cạnh ô soạn tin.
   - Gõ tiếp chữ (vd `//cn`) → lọc dần, gợi ý khớp đầu câu tắt được ưu tiên.
   - **Enter / Tab** (hoặc bấm vào gợi ý): chèn **tin đầu tiên** vào đúng vị trí con trỏ,
     xóa luôn phần `//cn`, đặt con trỏ ở cuối câu → **bấm Enter lần nữa là gửi** (script không tự gửi).
     Câu có nhiều tin: Enter lần đầu là gửi tin 1, các tin sau **tự gửi tiếp** (xem mục 0).
   - **Một gạch `/` thì script KHÔNG làm gì** — đó vẫn là bảng câu nhanh "/" gốc của Pancake.
   - `//` phải đứng đầu ô hoặc sau khoảng trắng/ký tự mở: `abc//cn`, `https://x//y`, `///cn` → không kích hoạt.
   - **↑ ↓** đổi lựa chọn, **Esc** đóng gợi ý. Gõ đúng câu tắt rồi **cách ra** cũng chèn luôn
     (tắt được bằng ô “Chèn ngay khi gõ xong câu tắt + dấu cách” ở cuối panel).
   - `//` dính liền chữ (`abc//xyz`) thì **không** kích hoạt, để không phá link/giờ (`https://…`, `10/11`).
   - Đang gõ tiếng Việt bằng bộ gõ (IME) thì script **không chen ngang** — chỉ xử lý sau khi chốt chữ.
2. **Bong bóng 💬** (kéo thả bất kỳ đâu, vị trí được nhớ qua F5): bấm để mở panel
   danh mục + câu tắt. `Alt+Shift+S` mở/đóng panel.
3. **Bảng gợi ý hiện ở đâu / đừng che bảng gốc Pancake** (cuối panel):
   - `Bảng gợi ý:` **Trên ô soạn tin** (mặc định) / **Dưới ô soạn tin** / **Chỗ đã kéo (tự do)**.
   - **Kéo tiêu đề `⠿ Câu tắt khớp …`** để dời bảng đi bất kỳ đâu — vị trí được nhớ qua F5;
     bấm **⤢** (hoặc đúp chuột vào tiêu đề) để về vị trí tự động.
   - Ô **“Ẩn bảng "/" gốc của Pancake khi bảng gợi ý mở”** (mặc định BẬT): lúc bảng của script
     đang mở thì bảng câu nhanh "/" của app được ẩn đi (bảng gốc vẫn dùng bình thường khi bạn gõ "/" mà
     không mở bảng của script). Nếu app đổi giao diện khiến việc ẩn không còn đúng, chỉ cần bỏ tick.
4. **Chỉnh sửa** (nút “⚡ Làm việc” → “✏️ Chỉnh sửa”):
   - `+ Thêm danh mục mới`, ✏️ đổi tên, 🗑️ xóa danh mục; `+ Thêm câu tắt cho danh mục này`, ✏️ sửa câu, 🗑️ xóa câu.
   - Kéo **⠿** để sắp xếp lại danh mục/câu. Mọi thay đổi được lưu ngay (GM storage + `localStorage`).
5. Ở chế độ Làm việc, bấm 1 câu = chèn vào ô soạn tin đang dùng (nếu chưa chọn ô nào thì sao chép).

## Script dựa vào phần nào của source trong repo?

| Phần source | Nội dung được dùng |
|---|---|
| `html2.txt`, `html3.txt` | `div.reply-box-container` → `div.reply-box__text-area` → `<textarea id="replyBoxComposer" placeholder="Trả lời từ …">` — đây là ô soạn tin thật của Pancake (không phải contenteditable), nên việc chèn câu dùng native `value` setter + `dispatchEvent(new Event('input', {bubbles:true}))` và `setSelectionRange` để React của app nhận đúng thay đổi và giữ caret. |
| `_app-9331d46f21a84eb1.v6.js` | `forcusReplyCompose()` = `document.getElementById("replyBoxComposer")` rồi `.focus()` ⇒ `#replyBoxComposer` là điểm vào ổn định để chèn câu/focus. |
| Script v5.5 của người dùng | Giữ nguyên phần khung: Shadow DOM chống đụng CSS app, bong bóng 💬 kéo thả (mouse + touch), panel bám theo bong bóng, danh mục kéo thả ⠿, chế độ Làm việc/Chỉnh sửa. |

Không có selector/API nào được bịa thêm: chỉ dùng `#replyBoxComposer`, `.reply-box-container`,
`.reply-box__text-area` (có trong HTML đã lưu) và thêm dự phòng `contenteditable` cho ô bình luận.

Riêng bảng câu nhanh "/" **gốc của Pancake**: repo chưa bắt được trạng thái mở của nó (không có trong
`html*.txt`, cũng không thấy class trong `_app`), nên script **không đoán class** — chỉ dùng CSS `:has()`
nhắm theo đúng **câu chữ** của bảng (`:has(.suggestion-element)`, `:has(.shortcut-tag)`, `:has(#qr_autocomplete)`)
và luôn có công tắc để tắt. Nếu bảng gốc vẫn hiện, dùng cách **kéo bảng của script** sang chỗ khác.

## Cách script gửi các tin tiếp theo (không cần bạn Enter)

- Ưu tiên **bấm đúng nút Gửi của Pancake** trong khung soạn tin: script tìm trong
  `.reply-box-container` phần tử có `title`/`class`/`id` chứa `send`/`gửi` (bỏ qua nút ảnh, file,
  emoji, sản phẩm…). Repo **không chứa class/id của nút Gửi** (`html3.txt` chỉ có
  `.reply-box-actions-container` + các `.new-reply-box-btn`), nên đây là cách nhận diện theo thuộc tính.
- Không tìm thấy nút → phát **phím Enter tổng hợp** lên ô soạn tin.
- Vẫn không ăn (ô còn nguyên chữ) → thử lại tối đa 3 lần (mỗi lần đổi ứng viên nút Gửi), sau đó
  **dừng an toàn**: tin kế tiếp vẫn được điền sẵn trong ô chat để bạn Enter/Gửi tay — không bao giờ
  bắn Enter vô hạn.
- Mọi thao tác chèn/gửi vẫn đi qua sự kiện thật trên ô soạn tin (`input`, `click`, `keydown/keyup`),
  nên tin hiện trong lịch sử chat y như bạn tự gửi.
