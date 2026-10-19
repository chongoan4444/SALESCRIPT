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
  Chat bị API từ chối RÕ thì tự **bù sang kênh chưa thử** (thường là Extension) trong nền (log có dòng bù);
  thua tiếp thì sang kênh kế — **mỗi kênh đúng 1 lần**; không rõ kết quả thì bỏ — không gửi lại để tránh trùng.
  `(#10)/(#551) …ngoài cửa sổ 24h…` **vẫn bù** — Extension cứu được (xem v1.46.0).
- **Không đoán trước kênh bằng mốc idle (v1.45.0)**: trước đây ảnh chat idle>24h bị ép đi thẳng Ext
  "khỏi bắn API chắc thua" — nhưng ngoài cửa sổ 24h thì Ext cũng dính `(#10)` (cùng chính sách) → mỗi
  chat uổng ~3s trong hàng đợi Ext mà vẫn thua. Nay **cả text lẫn ảnh đều API-trước** (HAR: request gửi
  tay có `content_id`+`attachment_id`+`content_url`), bắn song song, lỗi cửa sổ hiện rõ trong ~1s rồi
  bỏ; dữ liệu idle sai (list cũ) thì API vẫn gửi được — không loại oan. Chỉ chat **đã thắng qua Ext
  trong phiên** (hint) mới đi thẳng Ext; API bị chặn cấp page giữa lô `(#10) kiểm soát thread` thì chat
  còn lại đi thẳng Socket/Ext.
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
- **Bù qua EXTENSION, nhanh như app (v1.44.0)**: API bị từ chối RÕ (lỗi kênh) thì app fallback **NGAY**
  sang Extension (executeByExtOnce) — không chờ nhịp. Extension **tự resolve globalId đúng** (bằng chứng
  `update_global_id` trong tinnhan.har) nên cứu được cả chat Socket thua (globalId ≠ PSID) lẫn chat FB
  đang giữ nhịp sau bắn dồn (log 21:58 — Socket thua 30/30). Bù đúng 1 lần **qua Extension sau ~1.5s**;
  Socket chỉ dùng khi extension chưa kết nối (và vẫn chờ nhịp 12s cho khung /ls_req). Bù thắng được ghi
  nhớ kênh — lần gửi sau vào thẳng kênh đó. Vẫn đúng luật: tối đa 1 lần bù/chat, "maybe" tuyệt đối
  không gửi thêm, chat đã xác nhận thành công không bao giờ gửi lại.
- **Hết đuôi chờ 97s, hết bù lại kênh vừa thua (v1.45.0)**: delay bù **có hạn ≤4.5s** (trước đây dồn
  1.5s + số-thứ-tự×0.5s → chat cuối chờ 97s); **không bù lại kênh vừa thua** (Ext vừa "không gửi được"
  mà còn bù Ext = chắc thua lần 2); ảnh cũng API-trước. 🏁 chốt số lần bị chặn cửa sổ 24h.
- **Sửa GỐC "gửi tay được mà script không gửi được" (v1.46.0)**: app gửi ngoài cửa sổ 24h được nhờ cờ
  `is_record_ctx_7_days` (cửa sổ quảng cáo 7 ngày) — HAR chứng minh **11/13 lần gửi tay THÀNH CÔNG đều
  mang cờ `true`**. Cờ bật khi `dr()` có `ad_clicks` — mà `ad_clicks` **chỉ có khi app TẢI CHAT**
  (`GET …/conversations/{id}/messages?customer_id=…&user_view=true&is_new_api=true&separate_pos=true` —
  HAR), **list chat KHÔNG có** → script gửi hàng loạt trước đây luôn thiếu cờ → API chặn oan
  `"(#10)…ngoài khoảng thời gian…"` dù app gửi tay vẫn chạy. Nay script **nạp đúng request đó** cho
  chat ngoài 24h (cache theo chat) rồi mới quyết cờ — vẫn nghiêm ngặt `dr()`: thiếu `ad_clicks` là
  không bịa cờ. Và `(#10)/(#551)` **KHÔNG phải "mọi kênh đều thua"**: Extension cứu được (Thanh Binh —
  bù THÀNH CÔNG qua Extension ngay sau `(#10)`, log 07:36) → **chuỗi bù = plan của app**:
  `api → extension → socket`, mỗi kênh đúng 1 lần, 'maybe' dừng ngay, hết kênh thì nói "đã thử hết kênh".
- **`global_id` THẬT + đúng thứ tự kênh của app (v1.47.0)**: tinnhan1.har chứng minh **3/3 khách có
  `global_id` KHÁC PSID** (`61576542790011` vs psid `2747100…`) — trong khi đó script trước đây **đoán
  `global_id` = `from_psid`** → Ext "không gửi được", Socket "server báo gửi thất bại" (đúng triệu chứng
  log 08:19; chat "Võ Khánh" thắng là do id đoán trúng). Nay `resolveGlobalId` lấy **`global_id` thật
  từ dữ liệu chat** (`customers[0].global_id` — nạp từ đúng request app gọi khi mở chat) → chạy đua
  WS↔Ext → **`from_psid` chỉ là phương án cuối**, không cache phỏng đoán. Và **đúng plan của app**:
  text ngoài cửa sổ 24h + không có cờ `dr()` → **Extension TRƯỚC** (`["extension","api","socket"]` —
  HAR: gửi tay 3/3 chat không có POST /messages nào, thẳng Ext); ảnh vẫn API-trước. Sau gửi thành
  công, script gọi đủ 3 request app vẫn gọi: `fill_admin_name` (per chat) + `check_inbox` +
  `contents/touch` (per page, cuối lô) — file `post` + HAR.
- **Gửi lô & gửi bù siêu tốc cho hàng chục nghìn tin (v1.50.0)**:
  - **Không rơi `customerId`/`customers` khi tải danh sách qua API (`convApiRow` + `peekConv`)**: trước đây các dòng ngoài màn hình (58/69 chat trong log 09:22) mất `customers[0].id` nên `ensureConvCtx` bỏ qua → vừa mất cờ `is_record_ctx_7_days` (bị ép sang hàng đợi Ext), vừa mất `global_id` thật.
  - **Xóa bẫy treo 30s ở `MqttHelper.findGlobalId` + đọc thẳng `threadMapping` 0ms + đúng 9 trường `findGlobalIdForConv`**: trong log 08:57–09:00, mỗi đợt lỗi cách nhau đúng 32s do `MqttHelper.findGlobalId` chờ timeout 30s (`b = 30000`) rồi rơi xuống `from_psid` sai; nay đọc thẳng cache `threadMapping`/`threadMappingStoreV2` (0ms) và giới hạn chờ WS tối đa 2.5s.
  - **Bù tức thì (0.1s thay vì chờ 2–5s / 12s) + 6 luồng Extension / 4 luồng Socket song song + dừng ngay khi khách khóa nick (`1545041`/`#100`)**: không lặp 3 kênh vô ích cho tài khoản đã khóa/chặn page.
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
- **Dữ liệu GIỮ QUA F5 (v1.43.0)**: câu gửi lưu `localStorage` kèm **bản dự phòng** (key hỏng/mất →
  tự khôi phục, không mất câu đã soạn); **tick câu + ô nội dung đang gõ + nhật ký gửi** cũng được lưu
  — F5 xong làm việc tiếp đúng chỗ cũ. Khởi động có dòng "💾 Đã nạp N câu · M chat đã lưu".
  **Câu chỉ tự xóa khi lô có ít nhất 1 tin được bắn** (mỗi câu chỉ gửi 1 lần — chống gửi trùng);
  lô fail toàn bộ → GIỮ NGUYÊN câu + log rõ "không mất dữ liệu".
- **Gửi xong tự bỏ chọn**: sau lượt gửi, các đoạn chat đã đánh dấu tự được "Xóa" chọn (như bấm nút
  Xóa) — sẵn sàng chọn lượt mới, và bấm chạy lại không bao giờ dính dấu cũ (chống gửi trùng).
- **Text lẫn ảnh đều API-trước — hết vòng vo (v1.45.0)**: hint/dự đoán không ép chat vào Socket/Ext
  (chậm, hàng đợi Extension xếp hàng) — gửi thẳng API cookie-auth như gửi tay (HAR 200 chứng minh, ảnh
  có đủ `attachment_id`+`content_url`); chỉ chat đã thắng qua Ext trong phiên mới dùng thẳng Ext. Bù
  cũng hết chậm: không dò PSID qua Extension khi kênh chỉ từ chối, không bù lại kênh vừa thua.
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
bật cờ (không bịa thêm — app cũng vậy; **thiếu `ad_clicks` là không bật**, nhưng nay script tự nạp
`ad_clicks` từ request app dùng khi tải chat — v1.46.0 — nên cờ đúng như app, hết bỏ sót oan). Chat
ngoài 24h mà không thuộc cửa sổ quảng cáo thì API từ chối `"(#551)"/"(#10)…"` — **vẫn bù sang kênh khác**
(Extension cứu được — Thanh Binh, log 07:36), mỗi kênh đúng 1 lần. Kết quả "đã gửi" ở chế độ
nhanh = request **đã bắn**, xác nhận đến nơi xử lý trong nền — server từ chối là **báo rõ + tự bù
qua kênh chưa thử**, không bao giờ "báo gửi" rồi im lặng.
**Học `globalUserId` đúng từ extension & tăng tốc lô lớn 1.500–5.000 tin (v1.38.0 → v1.51.0)**:
- **Bền vững hóa `global_id` qua F5 (`localStorage` + IndexedDB `"fb_meta_data"`)**: nạp toàn bộ bảng `global_user_ids` & `global_user_ids_2` từ IndexedDB `"fb_meta_data"` của Pancake và `localStorage` (`ssb_global_id_cache_v1`) vào RAM ngay khi chạy (0ms).
- **Vá lỗi nội tại `window.__MqttHelper__` của Pancake (`patchMqttHelper`)**: sửa lỗi `triggerLoadMoreThreads(e, t)` trong bundle (`@822420`) truyền nhầm `t` (Object) thay vì `t.step` (Array) vào `findBlockAction` khiến mỗi trang `loadThread` (~15 chat) bị ngủ cứng hết timeout 5.000ms (5s/trang = 3 chat/s, mất 59s cho 12 trang đầu ở log `10:15:26→10:16:25`); đồng thời nâng `maxLoadThreadCount` từ 10 lên 500 trang (~7.500 chat) và bỏ `await sleep(1000)` trong `findGlobalId` khi socket đã mở → tốc độ nạp `threadMappingStoreV2` qua WebSocket tăng từ 5.000ms/trang lên ~80ms/trang (nhanh gấp 60x).
- **Tách cổng chuẩn bị HTTP (`extPrepLane = 18`) khỏi cổng bắn Extension (`extSendLane = 10`)**: chuẩn bị sẵn `uploadPhotoForPage` (`reusable=false`) và `resolveGlobalId` ở phía trước để khi vào `adapter.send` không mất thời gian chờ HTTP.
- **`photoOutWin` & điều tiết `sendBatch` (`BATCH_POOL_SIZE = 24`)**: lô ảnh ngoài cửa sổ 24h (`!isRecordCtx7Days`) đi thẳng vào Extension thay vì bắn 1.500 request `POST /messages` biết chắc bị `(#551)` làm nghẽn mạng Chrome 60s đầu.
- **Bộ tổng hợp số tin đã gửi thành công thật sự (v1.52.0) & bản lưu dự phòng v1.51.0**:
  - Thanh **`#ssb-summary`** nằm ngay dưới thanh tiến trình (trên khung LOG), đếm **real-time** số tin đã được server/Extension/Socket **xác nhận đến nơi thật sự** (không đếm nhầm tin mới bắn `fired` chưa xác nhận), tách rõ từng kênh (`[API: X · Ext: Y · Socket: Z]`), số tin đang xử lý nền (`⏳ Đang xử lý`), số tin lỗi (`❌ Lỗi`), không rõ (`⚠ Không rõ`), bỏ qua do tag/SĐT (`🧹 Bỏ qua`), và thời gian chạy (`⏱ Ns`). Khi toàn bộ tin bắn nền & bù ngầm hoàn tất (`pending === 0`), tự động chốt trạng thái `🏁 TỔNG HỢP` (lưu giữ qua F5) và in dòng `📊 TỔNG HỢP CHỐT LƯỢT GỬI: ✅ Đã gửi thành công X/Y tin (%) ...` vào LOG.
  - Bản copy nguyên trạng trước khi thêm tổng hợp được lưu tại **`scripts/pancake-send-by-snippet.v1.51.0-backup.user.js`** để có thể quay lại dùng hoặc sửa bất cứ lúc nào nếu thấy không cần.
- **🔥 Nấc 2 — Bắn-nhả Socket + xác nhận nền (v1.71.0)**: với lô lớn (>50 tin), Socket không còn giữ worker chờ ACK của Facebook (~2,8s/tin) nữa: publish xong là nhả worker đi bắn tiếp ngay (chỉ còn nhịp 2ms/khung giữ nhịp). ACK thật về sau được xử lý ở nền y hệt mẫu `fireApiAndWatch` của kênh API: thành công → ghi nhận đã đến nơi (im lặng, bảng tổng hợp tự cập nhật + tự chốt khi hết tin chờ), bị từ chối → bù kênh khác đúng 1 lần, không rõ kết quả → báo ⚠ và không gửi thêm. Nhờ vậy tốc độ phát lệnh không còn bị khóa bởi tốc độ trả ACK của server. Bản **v1.70.0 được giữ nguyên làm backup** tại `scripts/pancake-send-by-snippet.v1.70.0-backup.user.js` — cần quay lui chỉ việc cài lại file backup. Lưu ý đọc log bản này: dòng ✅ từng tin nghĩa là "đã bắn, đang xác nhận nền"; kết quả CHỐT nằm ở dòng `📊 TỔNG HỢP CHỐT LƯỢT GỬI` tự in khi mọi ACK đã về hết.

- **Tăng tốc gửi (v1.70.0)**: nhịp bắn Socket 4ms → **2ms** (500 khung/giây/page), số khung Socket chờ ACK trên mỗi page 32 → **64**, làn hỏi Extension tìm `global_id` 16 → 24 luồng, làn quét nhanh 128 → 160 worker. Thêm **pipeline nạp trước `global_id` chạy nền**: trong lúc gửi, một pipeline riêng chạy trước để nạp sẵn dữ liệu chat cho các chat phía sau, tới lượt gửi là có sẵn `global_id` trong cache (0ms) thay vì đứng chờ HTTP từng chat.

- **Chặn tuyệt đối chat dính tag "chốt"/"chặn" (v1.69.0)**: bản trước chỉ tải 1 trang (60 chat) khi lọc theo tag và chỉ chờ 1,8s — page có nhiều hơn 60 chat dính tag là lọt. Nay script **quét TOÀN BỘ chat dính tag cấm qua API** (tối đa 300 trang) nạp vào một danh sách chặn riêng, kiểm tra lại **ngay trước khi bắn từng chat**, và **quét lại mỗi 3.000 tin trong lúc gửi** để bắt cả tag vừa được gắn giữa lượt. Page nào app chưa nạp bảng tag thì script tự gọi `GET /pages/{id}/settings` (đúng request của app) để lấy bảng tag. Khi bắt đầu gửi, log sẽ in `🛡 Đã nạp X chat đang dính tag cấm` — đối chiếu số này với số chat đang gắn tag trên app để kiểm chứng.

- **Quy mô 60.000–100.000 tin/lượt (v1.68.0)**: nâng số chat mỗi lượt tối đa từ 50.000 lên **100.000**; mở rộng các làn CHUẨN BỊ (dò ngữ cảnh `GET /messages` 64→96 luồng, upload ảnh 64→96 luồng, làn quét nhanh 96→128 worker, làn nền Extension 32→48 worker) — cơ chế gửi (Socket 32 frame/page, nhịp 4ms, Extension) giữ nguyên như cũ. Panel tự in **đồng hồ tốc độ mỗi 30 giây** (`📊 … tốc độ X tin/phút · dự kiến còn ~Y nữa`) và dòng chốt cuối lượt kèm tổng thời gian + tốc độ trung bình để đối chiếu thực tế.

- **Tải danh sách SIÊU TỐC (v1.67.0)**:
  - **Nhiều page → chạy song song theo từng page**: khi đang xem nhiều page cùng lúc, script tách mỗi page thành 1 chuỗi cursor riêng (`/api/v1/pages/{pageId}/conversations` — đúng endpoint app dùng khi xem 1 page trong `buildConversationsRequest`, `_app` module 907775) và chạy **tối đa 10 chuỗi cùng lúc**. Mỗi chuỗi vẫn đi tuần tự theo `next_cursor` THẬT của server nên **không hở, không thiếu chat nào**; tải xong gộp lại và sắp xếp đúng thứ tự app (ghim → chưa đọc → đã đọc, mới nhất trước — đã kiểm chứng khớp 100% thứ tự server trên dữ liệu thật `pancake.vn2.har`). Page nào lỗi giữa chừng sẽ tự chuyển về cách tải chung để đảm bảo đủ danh sách.
  - **1 page → luồng chính + 10 luồng phụ độc lập**: các luồng phụ không còn phải chờ nhau theo từng vòng (1 request treo không làm đứng cả lượt tải nữa); hễ luồng chính chạm tới đoạn phụ nào là khâu cả đoạn vào và bỏ qua hàng loạt request tuần tự.
  - **Hiển thị trực tiếp nhẹ hơn**: trong lúc tải, danh sách trên panel chỉ NỐI THÊM phần mới tải được thay vì dựng lại toàn bộ từ đầu sau mỗi chặng — danh sách càng dài càng không bị chậm dần. Tải xong panel có in thời gian tải thực tế (ví dụ: `⚡⚡ Tải song song 15 page: 3000 chat trong 4.2s`).
  - Vẫn dừng ngay khi chuỗi 2 đầu đã đủ 2 đầu, và bấm nút lần nữa để dừng & dùng ngay số chat đã tải.

- **Cơ chế tải danh sách chuẩn & luôn xóa sạch danh sách cũ khi bấm `⚡ Tải danh sách` (v1.55.0)**:
  - Khi bấm **`⚡ Tải danh sách`**, script **xóa sạch hoàn toàn danh sách cũ (`state.allRows = null`)** ngay lập tức rồi **tải mới lại 100% từ trang đầu qua API `/api/v1/conversations`** (không giữ lại cache danh sách cũ, không nối tiếp từ `next_cursor` cũ gây lệch thứ tự hoặc không tải lại).
- **Tối ưu tốc độ & cứu trọn 3.000–6.000 mess ngoài 24h trên lô lớn (v1.54.0 → v1.56.0)**:
  - **Chống đóng băng `ensureConvCtx` khi bị rate-limit 429 & bỏ qua `GET /messages` thừa cho chat `> 7 ngày`**: chỉ đánh dấu `entry.fetched = true` khi `GET /v1/pages/{pid}/conversations/{cid}/messages` thành công thật sự (kèm tự động retry 3 lần qua `ctxFetchLane = 32` luồng). Với các chat đã quá 7 ngày (`idle > 7 ngày`) hoặc page tắt `ctx_7_days_enabled` (không thể bật `is_record_ctx_7_days`), bỏ qua bước gọi `GET /messages` trước khi bắn để đi thẳng vào `Socket ⇄ Ext` (0ms nếu đã có `global_id` từ cache/WebSocket), giảm hàng nghìn request HTTP thừa.
  - **Điều phối động `prepareDirectCtx` + `pickBestDirectOrder` (`__sendBySocketCacheFB__` tại `@927067` & `@937200`) & tách `socketLane` (16 luồng) khỏi bước chuẩn bị**: chuẩn bị chung `full`, `threadId`, `globalId`, và `nonReusableFbId` trong `extPrepLane` (32 luồng) trước rồi mới quyết định thứ tự `Socket ⇄ Extension` ngay tại thời điểm chuẩn bị xong (tránh việc tính ở giây thứ 0 làm khóa cứng 5.985/6.000 chat vào Extension và bỏ trống `socketLane`). Khi WebSocket đã kết nối và đã có `global_id` thật (`!ctx.gidFromPsid`), luôn ưu tiên bắn qua **`Socket` (`socketPublishSend`, ~80–120ms/tin)** và chỉ giữ slot `socketLane` đúng trong lúc bắn frame `/ls_req`.
  - **Chống báo oan `fbErrorCode: 1545041 ("Người này hiện không có mặt.")` trong `sendViaExtension` (`executeByExtOnce` tại `@961019` & `@966000`)**: khi chưa tìm được `global_id` thật (`ctx.gidFromPsid === true` hoặc `ctx.gid === null`) nhưng đã có `threadId`, truyền **`globalUserId: null`** kèm `threadId` và `convId` vào `REPLY_INBOX_PHOTO` đúng chuẩn `_app` để Extension tự tìm hội thoại theo `threadId` và trả về `globalUserId` thật, tuyệt đối không truyền `from_psid` phỏng đoán vào `globalUserId` của Extension.
  - **Nâng cấp `resolveGlobalId` (`BATCH_GET_GLOBAL_ID` `@897543` + `MAKE_MESSENGER_LINK` `@894200` + `cleanupRace`)**: gọi `BATCH_GET_GLOBAL_ID` ngay trong `warmUpSockets` để nạp hàng loạt `threadsWithGlobalId` vào cache RAM (0ms); trong `resolveGlobalId`, ngay khi một nhánh tìm ra `global_id` thì `cleanupRace()` hủy tức thì timer/`PENDING_MESSAGES` của WebSocket và giải phóng các task chờ trong `gidExtLane` (6 luồng); nếu `GET_GLOBAL_ID_FOR_CONV` trả `null` thì fallback sang `MAKE_MESSENGER_LINK` (`uiVersion: 6`) lấy `globalId` / `selected_item_id`.
  - **Vá chuẩn `MqttHelper.loadThread` cho cả `label: "313"` / `"145"` (`queue_name: "trq"`, `@827500`)**: sửa lỗi `reference_thread_key = fp.referenceThreadKey`, tự khởi tạo `sock.lastApplyCursor`, và tự giải phóng `loading_thread_{pageId}` ở `0ms` khi `publish` của `trq` hoàn tất (chấm dứt việc mỗi trang `loadThread` bị treo 5.000ms).
- **Kiến trúc Ultra-Turbo cho quy mô 20.000–30.000 tin nhắn/lần (v1.57.0)**:
  - **Tách làn Cao Tốc `0ms` (`peekFastGlobalId`) & Phân làn 2 tầng trong `sendBatch` (`FAST_POOL_SIZE = 128` + `DISCOVERY_POOL_SIZE = 32`)**: kiểm tra đồng bộ `0ms` trong RAM/Cache/`threadMappingStoreV2` (`peekFastGlobalId`). Mọi chat ngoài 24h đã có sẵn `global_id` thật và WebSocket đang mở sẽ **bỏ qua `await ensureConvCtx(c)`** (không tốn hàng nghìn request `GET /messages` kiểm tra `ad_clicks` cho các chat 1..7 ngày khi đã sẵn sàng bắn qua `Socket`) và **bỏ qua hoàn toàn `extPrepLane`**, đi thẳng vào **`socketLane` (64 luồng WebSocket song song)**. Trong `sendBatch`, 90–95% chat có sẵn `global_id` hoặc trong 24h chạy trên `fastList` (128 worker) độc lập hoàn toàn với 5–10% chat chưa có `global_id` trên `discoveryList` (32 worker), loại bỏ triệt để hiện tượng Head-of-Line Blocking.
  - **Đua song song 3 nguồn trong `resolveGlobalId` + cờ `ctx.gidDiscoveryRan` (`this.concurrentlyGetGLobalIdExecuted` `@961019`) + cắt sớm `wsTimer`**: chạy đua song song cả `ensureConvCtx` (`GET /messages`), `gidExtLane` (`findGlobalIdForConv` / `MAKE_MESSENGER_LINK`), và `mqtt.PENDING_MESSAGES` cùng lúc; khi cả HTTP lẫn Extension đều trả `null`, tự cắt `wsTimer` sau `120ms` thay vì chờ hết `4.500ms`, đồng thời đánh dấu `ctx.gidDiscoveryRan = true` để kênh thứ 2 không lặp lại bước dò mạng/Extension (giảm thời gian xử lý chat lỗi từ ~9–10s xuống ~0.2s).
  - **Cache `nonReusablePhotoCache` theo `pageId + photo` cho kênh `Socket` & điều tiết `sideEffectLane` (4 luồng)**: khi gửi kèm ảnh qua `Socket` cho 20.000–30.000 chat trên cùng page, chỉ upload `reusable=false` 1 lần/page và tái sử dụng `fbId` ở `0ms` (tự động upload mới nếu `Socket` báo `markOptimisticMessageFailed`); gom `fill_admin_name` và `update_global_id` (bỏ qua nếu `gid` đã từ server/cache) vào `sideEffectLane` (4 luồng nền).
  - **Tối ưu `O(1)` toàn diện cho CPU/DOM & mở rộng tải danh sách 30.000+ chat**: dùng `Map` `O(1)` (`getReduxConvById`) thay cho `.find()` tuyến tính trên Redux; dùng bộ đếm `O(1)` (`summaryCounters`) cho `getBatchSummaryCounts`; throttle cập nhật DOM/localStorage trong `logLine`, `updateBatchSummaryUI`, và `markChannel` (`80ms–400ms`) khi chạy lô lớn; nâng `loadListViaApi` lên `1500` trang (~45.000–75.000 chat, bỏ `sleep(120)` cứng), `maxLoadThreadCount = 5000` trang WebSocket, và `WAVE_SIZE` lên tới `50.000` tin/lượt (mặc định `30.000`).
- **Khắc phục triệt để lỗi "có tin chỉ gửi được chữ không gửi ảnh", bứt tốc từ mess 301 đến 20.000 mess, xóa sổ lỗi nghẽn `không có ACK` & lướt siêu tốc qua cục khách đã chặn page (v1.58.0 → v1.66.0)**:
  - **Cấp `fbId` (`is_reusable=false`) riêng cho từng cuộc hội thoại (`uploadOneTimePhoto`, 64 luồng song song) kết hợp Hồ dự trữ `spareFbIdPool[pageId]` (`v1.58.0–v1.66.0`)**: trên Facebook Messenger (`executeBySocketFB` `@976000` & `executeByExtOnce` `@964800` trong `_app`), `fb_id` sinh từ `POST /v1/pages/{pageId}/contents/facebook?is_reusable=false` là **ID đính kèm dùng 1 lần (single-use attachment ID)**. Bản `v1.64.0–v1.66.0` chạy **song song (`Promise.all`)** cả `resolveGlobalId` (`GET /messages`) và `uploadOneTimePhoto` (`POST /contents/facebook`) ở Làn 1 (giảm 30% độ trễ HTTP mỗi chat), mở khóa **Làn Cao Tốc `0ms` (`fastGid0`) cho cả tin nhắn kèm ảnh**, đồng thời bổ sung `spareFbIdPool[pageId]`: nếu một chat chuẩn bị xong `fbId` mà chưa bắn ở Làn 1 hoặc phát hiện khách đã khóa nick trước khi bắn, `fbId` chưa tiêu thụ đó được cất vào `spareFbIdPool[pageId]` để chat sống kế tiếp lấy dùng ngay ở **0ms**.
  - **Cơ chế Lướt Siêu Tốc qua "Cục Khách Đã Chặn Page" (`Cluster-Skip Probe / inBlockedCluster` — `v1.66.0`)**: các khách đã chặn page / khóa nick thường bị dồn thành một cụm dài hàng trăm đến hàng nghìn chat liên tiếp (như dải `130..287`). Khi gặp `>= 3` khách liên tiếp bị từ chối (`socketRejectStreak[pageId] >= 3`) và tin nhắn có cả chữ lẫn ảnh:
    + Script **tạm ngừng gọi HTTP `POST /contents/facebook` upload ảnh trước**, mà bắn gói Chữ qua WebSocket trước (`~30ms`, **tốn `0` HTTP request upload ảnh**).
    + Với 99.9% khách đã chặn trong cụm đó: Facebook MQTT trả về `rejected` ngay lập tức sau `~30ms`, giúp lướt qua hàng trăm/hàng nghìn khách đã chặn mà **không tốn dù chỉ 1 request upload ảnh vô ích**!
    + Nếu gặp khách còn sống nằm lẫn trong cụm: gói Chữ đi thành công (`ok`) → lập tức reset `socketRejectStreak = 0`, upload ảnh (ưu tiên `0ms` từ `spareFbIdPool`) và bắn tiếp phần Ảnh ngay lập tức (khách sống nhận đủ 100% cả chữ lẫn ảnh), đồng thời lưu bền vững `global_id` của cả khách đã chặn vào `localStorage` để lần gửi sau có sẵn ở `0ms`!
  - **Vá lỗi chí mạng `TypeError` trong `resolveSearchGlobalIdTask` (`@823506` của `_app`) & Đánh thức tức thì (`0ms`) `PENDING_MESSAGES['find_global_id_|...']` (`v1.65.0`)**: trong `_app-9331d46f21a84eb1.v6.js` tại `@823506`, hàm `resolveSearchGlobalIdTask` viết `o.context.initPageData.threadMapping[c]` không có optional chaining (`?.`). Khi `initPageData.threadMapping` là `undefined` (dữ liệu nằm ở `threadMappingStoreV2`), nó văng `TypeError: Cannot read properties of undefined` ngay ở phần tử đầu tiên và không gọi `.callback` cho bất kỳ `PENDING_MESSAGES` nào, bắt các đợt chat đang chờ phải đứng hình 4.5–6 giây đợi `wsTimer` hết hạn mới đọc được `lateGid` (như ở log `07:27:35→07:27:41` và `07:27:48→07:27:52`). Bản `v1.65.0` khởi tạo sẵn `threadMapping = {}` và `threadMappingStoreV2 = {}` trước khi `origResolve` chạy, đồng thời chủ động đánh thức `PENDING_MESSAGES['find_global_id_|...']` ngay trong `syncSocketMappingsToCache` (`0ms`) + `wsPoll` `60ms`, xóa sổ hoàn toàn các khoảng đứng hình 4.5–6 giây!
  - **Kiến trúc Đa Tầng Không Chặn Đầu (`Two-Pass Non-Blocking Pipeline`), Xóa sổ lỗi nghẽn `không có ACK` & Chống bỏ sót tin sống do Facebook MQTT Burst-Reject (`v1.61.0–v1.66.0`)**:
    + **Giãn nhịp vi mô `paceSocketPublish` (`4ms` = 250 tin/giây) + Retry Thông Minh theo Chuỗi (`socketRejectStreak <= 4` — `v1.65.0`)**: giữ khoảng cách vi mô `4ms` giữa 2 gói `/ls_req` trên cùng 1 fanpage, đồng thời khi đang gửi ở vùng các chat sống (`socketRejectStreak <= 4`), nếu bị `rejected` lần đầu thì tự động nghỉ `100ms` và bắn thử lại lần 2 ngay trên Socket (cứu 100% các chat sống dính burst như `v1.61.0`); ngược lại khi gặp cả một dải hàng trăm khách đã khóa nick liên tiếp (`socketRejectStreak > 4`, như dải `130..287`), tự động bỏ qua retry lần 2 để lướt qua vùng chat khóa nick nhanh gấp đôi!
    + **Chống báo oan `❌ Ext: Không tìm thấy global_id của khách` khi `findGlobalIdForConv` bị timeout (`v1.64.0–v1.65.0`)**: chỉ gán `ctx.extFinderReturnedNull = true` khi chính `findGlobalIdForConv` của Extension đã chạy xong và trả về rỗng (`confirmedNull === true`), tuyệt đối không gán khi lệnh bị timeout tạm thời — giúp các chat mà Extension bận lúc đầu vẫn được gọi `sendViaExtension` để gửi bằng `threadId` y hệt như khi gửi tay!
    + **Cấm tuyệt đối việc bắn `from_psid` (`gidFromPsid`) vào `sendViaSocket` (`v1.63.0`)**: chặn triệt để `gidFromPsid` trong `sendViaSocket` và `pickBestDirectOrder`, giữ `0` dòng `⚠ không có ACK` trên lô hàng nghìn tin.
    + **Loại bỏ bắn nhầm vào API bị chặn ngoài 24h do `updated_at` (`getConvIdleMs` — `v1.64.0`)**: khớp chuẩn `dr()` trong `_app`, chỉ tính trong cửa sổ 24h dựa trên `last_customer_interactive_at` / `lastAt` của khách; khi `last_customer_interactive_at === null` (dù `updated_at < 24h` do nhân viên vừa gắn tag/nhắn tin) thì xác định ngay là ngoài 24h (`idleLong = true`) để đi thẳng vào Socket từ đầu.

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
