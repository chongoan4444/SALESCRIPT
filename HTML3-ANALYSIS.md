# Phân tích html3.txt & Fix 13.1 FINAL

## 1. Nguồn
- File `html3.txt` lấy từ `origin/main:html3.txt` (commit 96d7033 "Add files via upload"), 2611 dòng, 2MB.
- Đã fetch về workspace `/home/user/SALESCRIPT/html3.txt` bằng `git show origin/main:html3.txt`.

## 2. Cấu trúc thực tế
- Tổng 12 `conversation-list-item` (rc-virtual-list).
- Phân loại:
  - ID `675541385634278_28794751720156211` pinned selected, read: `envelope.svg` (không phải envelope-selected), `rgb(244,62,65)`, tags `Đã Nhập, Phương, +1`.
  - 11 unread: đều có `envelope-selected.svg`, class `unread`, `border-fake`.
- Màu `border-fake`:
  - `rgb(3,126,62)` x3, `rgb(244,62,65)` x2, `rgb(186,5,70)` x2, `rgb(143,5,98)` x2, còn lại `rgb(5,117,102)`, `rgb(173,18,36)`.

## 3. Tags thực tế (quan trọng cho hasConversationTags)
Chỉ 1/11 unread KHÔNG có tag:
- `Oanh Bui` id `898735919982398_28556035864023477` tags `[]` → eligible.

10/11 unread còn lại CÓ tag (đã xử lý):
- Đỗ Hương `[A78, 29/9, T.Anh]`
- Phạm Thanh Thuỷ `[A77, 27/9, Lê]`
- Xuan Xuân Ha `[A77, 29/9, Linh]`
- Nguyễn Vững `[M16, 29/9, T.Anh]`
- Nguyenthi Tuyen `[A74, T.Anh, 9/9]`
- Phuong Nguyen `[M16, 29/9, Thơm]`
- Phan Lệ `[A79, 29/9, phương]`
- Trần Thanh Hai Hai `[Mua hàng, Việt]`
- Toan Tuan Hoang `[A78, 29/9, Tây]`
- + 1 item nữa có tag tương tự

**Kết luận**: Logic `hasConversationTags` hiện tại (loại bất kỳ có `.conversation_tags_item`) là ĐÚNG theo thực tế html3.txt. Nếu cho phép tag ngày `29/9` hoặc `T.Anh` thì sẽ bắt lại hội thoại đã chốt, sai yêu cầu "chỉ bắt mới chưa tag". Do đó giữ nguyên filter tag.

- Implication cho F1: Khi bật F1 trong html3.txt, chỉ có 1 eligible cũ (Oanh Bui) → F1 sẽ vàng, chờ list sạch, không bắt Oanh Bui.

## 4. Lỗi vàng cũ (đã fix 12.8→12.9→13.0)
Scenario báo lỗi:
- Có 2-3 tin cũ unread (eligible) → F1 vàng.
- Trong lúc vàng, 1 tin mới có tag (không eligible, raw null) nhảy lên top.
- 1 tin cũ khác (eligible nhưng chưa từng có trong snapshot, xuất hiện ở đáy index 3-4 trong lúc vàng) bị script bắt nhầm vì:
  - `hasOld` chỉ đánh dấu >=5 là cũ, nên index 3-4 không bị đánh dấu.
  - `findNew` khi vàng quét top5, thấy top có tag (raw null) skip, rồi quét xuống index 3-4 thấy tin cũ đáy eligible và chưa trong snapshot → bắt nhầm.

Fix 13.0: 
- `f1Snapshot` lưu TẤT CẢ ID lúc bật.
- `oldEligibleIds` lưu ID eligible lúc bật.
- Khi vàng, `hasOld` nếu thấy ID hoàn toàn mới ở index>=3 và raw eligible → add vào `oldEligibleIds` (đánh dấu cũ đáy).
- `findNew` khi vàng chỉ quét top3 và chỉ bắt ID hoàn toàn mới (không trong snapshot và không trong oldEligibleIds).

## 5. Fix thêm 13.1 (read→unread)
Phát hiện thêm từ logic:
- Nếu hội thoại cũ đã read lúc snapshot, sau đó có tin mới nhảy lên top và thành unread, nó phải được bắt NGAY CẢ KHI ĐANG VÀNG.
- 13.0 cũ skip vì `f1Snapshot.has(id)` → không bắt read→unread.
- 13.1 sửa:
  - `takeF1Snapshot` dùng `isConversationUnread()` thay vì check thô.
  - `isOldConversation` dùng `isConversationUnread()` cho curUnread.
  - `hasOldEligibleTarget`:
    - Nếu ID hoàn toàn mới ở index>=3 và raw eligible → add oldEligibleIds và count là cũ.
    - Nếu ID mới ở index<3 và raw eligible → KHÔNG add, KHÔNG count (để findNew bắt).
    - Nếu `!isOldConversation` (read→unread) → KHÔNG count là cũ.
  - `findNewEligibleTargetNotInSnapshot` khi vàng:
    - Skip nếu `oldEligibleIds.has(id)`.
    - Nếu `f1Snapshot.has(id)` và `isOldConversation` true → skip (cũ thật).
    - Nếu `f1Snapshot.has(id)` và `isOldConversation` false (read→unread) → cho phép bắt, log "read->unread mới".
- Kết quả: Vàng vẫn bắt tin mới nhất top3 dù là ID mới hoàn toàn hoặc hội thoại cũ vừa có tin mới nhảy lên.

## 6. File kết quả
- `Pancake-Auto-13.1-Final.user.js` (13.1 FINAL) – fix chính.
- `Pancake-Auto-Optimized.user.js` – copy sync của 13.1.
- Giữ `Pancake-F4-Optimized.user.js` và `Pancake-F7-Optimized.user.js` không đổi (đã tối ưu trước đó dựa trên selector thực tế #listShowTags, #listAllTags, .ellipse, btn-tag-item, trigger React, và workflow 9 bước F7 với MutationObserver).

## 7. Test với html3.txt
- Snapshot lúc bật: 12 total, oldEligible 1 (Oanh Bui).
- F1 → vàng (còn 1 cũ).
- Nếu new eligible top (no tag) xuất hiện index0 → findNew top3 bắt ngay dù vàng.
- Nếu new có tag (A78/29/9) xuất hiện top0 và Oanh Bui index1, new bottom eligible index11 xuất hiện trong lúc vàng → hasOld đánh dấu bottom là cũ (oldEligibleIds), findNew top3 chỉ thấy top0 có tag raw null skip, Oanh Bui skip vì old, bottom không trong top3 → giữ vàng, không bắt nhầm đáy.
- Nếu hội thoại read cũ (pinned) có tin mới nhảy lên top0 thành unread và no tag → isOld false → findNew bắt ngay khi vàng, hasOld không đếm nó là cũ → sau khi bắt, rearm sẽ vàng lại nếu vẫn còn Oanh Bui, hoặc xanh nếu hết.
