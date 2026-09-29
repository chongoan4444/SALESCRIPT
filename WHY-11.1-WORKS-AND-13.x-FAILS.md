# Tại sao bản gốc 11.1 chạy ổn mà các bản tối ưu 13.x toàn lỗi

## 1. Logic F1 gốc 11.1 rất đơn giản và an toàn

**11.1:**
- `toggleWaitingMode`: check toàn bộ list, nếu có MESS/COMMENT cũ (raw eligible) → VÀNG (blocked), không có → XANH (armed)
- `startConversationObserver` khi VÀNG: chỉ check `!hasEligibleF1Target()` → nếu hết cũ thì VÀNG→XANH, **KHÔNG bắt tin mới khi đang VÀNG**
- Khi XANH: `scanWaitingCandidates` chỉ bắt item vừa thay đổi (mutation) hoặc tìm target mới

=> Khi có 2-3 tin cũ, F1 VÀNG và đứng im chờ list sạch. Không có race condition bắt nhầm đáy.

**13.x đã cố gắng cải tiến:**
- Muốn khi VÀNG vẫn bắt tin mới nhất nhảy vào top3 (để nhanh hơn)
- Thêm snapshot `f1Snapshot`, `oldEligibleIds`, logic `isOldConversation`, `hasOldEligibleTarget` đánh dấu bottom >=3 là cũ, top <3 là mới
- Thêm `hasRawEligibleTarget`, `findNewEligibleTargetNotInSnapshot` quét top3

=> Logic phức tạp, dễ race:
- Tin mới có tag (raw null) ở top + tin cũ đáy index 3-4 xuất hiện trong lúc vàng → 13.0 bắt nhầm đáy vì hasOld chỉ đánh dấu >=5
- Fix 13.1/13.2 đánh dấu >=3 nhưng lại quên read→unread nhảy top
- Fix read→unread lại làm hasOld side-effect, rearm dùng hasEligible phụ thuộc f1State → luôn xanh dù còn cũ
- Fix rearm lại làm observer xanh nhầm
- Cứ vá chỗ này lại lòi chỗ khác vì thay đổi hành vi gốc

**Kết luận:** Bản gốc 11.1 vàng = đứng im, không bắt mới, là hành vi an toàn và được user chấp nhận. 13.x muốn vàng vẫn bắt mới nên phức tạp và lỗi.

## 2. sendComposerCommand bị làm mất bước click gửi

**11.1 gốc:**
```js
await clickSelectedSuggestion
composer = await waitFor(() => getComposer() có text != command && text != '')
await clickComposerSendArrow
```
Sau khi chọn suggestion '/.', nó đợi composer có nội dung thực sự (template đã insert) rồi **click mũi tên gửi**.

**13.x tối ưu:**
```js
await clickSelectedSuggestion
await waitFor(() => !getSuggestionList())
```
Chỉ đợi suggestion list biến mất, không đợi composer có text và không click gửi. Kết quả: '/.' chỉ insert vào ô soạn, không gửi → user thấy "gắn tag xong không gửi".

Fix 13.4 đã thêm lại fallback click gửi, nhưng vẫn khác gốc.

## 3. triggerElementAction

- Gốc 11.1: `el.click()` đơn giản, đủ cho Pancake lúc đó.
- 13.2/13.3: vẫn click đơn giản.
- 13.4: nâng lên React props + pointer events để robust hơn, nhưng thay đổi hành vi có thể gây double-click hoặc miss.

Gốc đơn giản lại ổn định hơn.

## 4. waitFor polling vs MutationObserver

- Gốc 11.1: `waitFor` polling mỗi 100ms bằng `sleep`, đơn giản, hơi tốn CPU nhưng ổn định.
- 13.x: đổi sang MutationObserver + poll fallback, nhanh hơn nhưng phải xử lý abortGeneration, destroyed, và đảm bảo observer disconnect đúng. Nếu làm sai, có thể miss element hoặc leak.

Đây là tối ưu đúng hướng, nhưng phải giữ nguyên logic còn lại.

## 5. isConversationUnread

- Gốc 11.1: chỉ check `class unread` hoặc `.unread` ancestor/descendant. Với HTML cũ đủ, nhưng với HTML mới (html3.txt) có `border-fake`, `envelope-selected.svg`, badge, fontWeight bold thì miss.
- 13.x: fix đúng, thêm border-fake, envelope-selected, badge, fontWeight → bắt được unread từ HTML thật.

Đây là fix cần thiết và giữ lại trong bản optimized cuối.

## 6. Duplicate function

- 11.1 gốc không có duplicate.
- 12.3/13.0/13.1/13.2 vô tình có duplicate `stopSuggestionObserver` ở 2 nơi (494 và 1128) do copy-paste khi refactor. Trong strict mode của Tampermonkey có thể SyntaxError tại dòng 1128.

## 7. Kết luận và bản fix cuối

**Bản 11.1 Optimized Final (11.1-optimized):**
- Giữ **100% logic F1 gốc**: vàng chỉ chờ sạch, không bắt mới khi vàng
- Giữ **100% logic gửi**: sendComposerCommand đợi composer có text rồi click mũi tên gửi như gốc
- Giữ trigger đơn giản như gốc
- Chỉ tối ưu 2 điểm an toàn:
  1. `waitFor` dùng MutationObserver (nhanh, ít CPU) thay vì polling thuần
  2. `isConversationUnread` thêm border-fake, envelope-selected, badge, fontWeight từ html3.txt

=> Vừa giữ sự ổn định của gốc, vừa fix unread và hiệu năng.

File: `Pancake-Auto-11.1-Optimized-Final.user.js` (đã sync `Pancake-Auto-Optimized.user.js`)
