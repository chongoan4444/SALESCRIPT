# Pancake hỗ trợ lên đơn 13.1 — UI tối giản + tự điền Giảm giá chính xác

File: `Pancake-LenDon-13.1.user.js` (thay thế bản 12.1 / 13.0 bạn đang chạy)

---

# PHẦN 1 — 13.1: sửa lỗi "script không thấy điền gì cả"

Bản 13.0 **quá cứng** khi tìm khu form đơn (chỉ chịu cấu trúc `#customerCol` +
`.swipeable-view-order` như trong `html*.txt`). Chỉ cần DOM thật khác một chút là
script không tìm thấy form ⇒ **im lặng, không điền gì**. 13.1 sửa 5 điểm:

### 1.1 Dò form đơn theo **4 tầng** (tầng nào ra kết quả dùng được thì lấy)
1. Pane đang mở trong `#customerCol` (như 13.0, nhưng chọn theo điểm dấu hiệu).
2. **Ứng viên bất kỳ đang hiện**: `form`, `.swipeable-view-order`,
   `[class*="order" i]`, `[id*="order" i]`, `.ant-drawer-body`, `.ant-modal-content`
   — chấm điểm theo ô tìm kiếm SP (3đ), `#shippingAddress` (3đ), ô nhập số (2đ).
3. Đi từ **dòng có nhãn chính xác "Giảm giá"** lên tối đa 4 cấp để tìm khối thanh toán.
4. Cuối cùng mới dò **vùng cuộn lớn** (đúng cách bản 12.1 vẫn làm).

Nhờ tầng 2–4, form đơn nằm ở trang riêng, trong modal, hay ở cột khác đều nhận được.

### 1.2 Lọc hiển thị ở **chính dòng/ô** cần dùng (quan trọng)
Pane bị trượt ra ngoài thì **phần tử con thừa hưởng đúng vị trí đó** ⇒ mọi dòng tiền,
ô nhập, ô tìm kiếm, ô địa chỉ… của pane ẩn đều bị loại (`shown()`), **kể cả khi khối
cha vẫn nằm trong màn hình** (ví dụ `.react-swipeable-view-container` luôn đứng yên
tại chỗ và chỉ con của nó bị dịch — đây chính là lỗi khiến bản 13.0 có thể ghi nhầm
hoặc không ghi gì). Có test hồi quy riêng cho tình huống này.

### 1.3 Tự điền mã SP **không cần bấm vào ô**
13.0 (và 12.1) chỉ điền khi bạn click/focus ô tìm kiếm. 13.1 điền sẵn mỗi nhịp quét
khi ô còn trống, vẫn **không đè** chữ bạn đang gõ.

### 1.4 Nhận nhiều cách nói "tổng đơn" hơn
`tổng 320k`, `chốt 320k`, `bill 320k`, `thanh toán 320k`, `còn lại 320k`,
`160k + 160k`, `160k = 320k`, `320.000đ`, `1tr2`, `320` (đoán nghìn)…
và nhãn `Thành tiền:` (có dấu hai chấm) vẫn nhận.
Ngược lại **không** nhận: `ck 320k`, giờ/ngày (`08:14`, `25/09`), SĐT, `cân nặng`,
`size M`, và các nhãn `Giảm giá theo combo / voucher / trên từng sản phẩm`.

### 1.5 Bảng **chẩn đoán** — biết ngay script đang "thấy" gì
`⚙ → Chẩn đoán` hoặc **Ctrl+Shift+D**. Bảng in ra: pane/cột phải, ứng viên form tốt
nhất, khu form đơn dùng được, ô Giảm giá, Thành tiền, Tổng tiền hàng, Phí vận chuyển,
ô tìm kiếm SP, ô địa chỉ, số nhãn "Giảm giá" tìm thấy, số dòng chat, tổng đơn nhận
diện, size, mã SP, trạng thái. Có nút **Copy**.
Nếu vẫn không điền, chỉ cần gửi 4 dòng: *Khu form đơn dùng được · ô Giảm giá ·
Thành tiền · Tổng đơn* (hoặc dùng **① Chỉ định ô Thành tiền** cho nhanh).

### 1.6 Bớt chặn oan
* Giới hạn "tổng đơn cũ" mặc định **200 dòng** (13.0 là 40 dòng → dễ chặn oan đơn
  mà khách chốt rồi mới nhắn thêm), chỉnh được: 40 / 80 / 200 / **Không giới hạn**.
* Không thấy dòng "Giảm giá" thì thử thêm `input[type=number]`,
  `input[inputmode=numeric]`, `input[type=text]` **trong đúng dòng đó**.
* Lỗi khởi tạo không còn làm script im lặng: có thử lại giao diện và log rõ.

### 1.7 Thanh trạng thái nói rõ đang chờ gì
`Chưa mở form đơn` · `Chưa có tổng đơn` · `Chưa thấy ô Giảm giá` ·
`Chưa thấy Thành tiền` · `Chờ thêm SP · 160.000` · `Đang quan sát` ·
`Ghi 60.000 → 260.000` · `260.000 ✓` · `Lệch 40.000` · `Tổng đơn đã cũ`…
(rê chuột lên thanh để xem chi tiết + tổng đơn + mã SP + địa chỉ)

### 1.8 Kiểm thử
**117 test pass** (48 đọc tiền/nhãn + 25 bộ điều khiển + 30 DOM jsdom `html3.txt` +
**14 test "UI đổi"**: form không có `#customerCol`, cấu trúc dòng tiền khác hẳn,
pane bị đẩy ra ngoài, chưa có form).

---

# PHẦN 1B — 13.1 (tiếp): sửa theo bảng chẩn đoán thực tế của bạn

Chẩn đoán gửi về cho thấy script **đã thấy khu form đơn** (`div.swipeable-view-order`),
**đã đọc được ô Giảm giá** và `Tổng tiền hàng: 300.000`, nhưng **không đọc được
"Thành tiền"** ⇒ đứng im, không điền. Ngoài ra địa chỉ bị nhận nhầm thành tin quảng cáo.

### 1B.1 "Thành tiền" — 5 đường đọc, không còn phụ thuộc 1 class
1. Dòng có nhãn khớp (mở rộng thêm: `tổng thanh toán`, `thanh toán`, `cần thanh toán`,
   `phải trả`, `khách phải trả`, `tiền khách trả`, `số tiền phải trả`, `sau giảm giá`,
   `giá trị đơn`… — trước đây chỉ có `thành tiền`, `tổng cộng`, `tổng tiền`).
2. `.text-final-price` **nằm trong hộp thanh toán**.
3. **Dòng cuối cùng có tiền** trong hộp thanh toán (sau dòng Giảm giá) — gần như luôn
   là dòng tổng, dùng khi nhãn bị đổi thành chữ lạ.
4. `.text-final-price` trong pane đang mở.
5. Dòng ngay dưới ô Giảm giá.

Thêm nữa: giá trị nằm trong `<input>` (không xuất hiện trong `textContent`) giờ cũng
đọc được, và **"Thành tiền" đã khớp thì DỪNG, không "sửa" thành số lẻ** (xem 1B.3).

### 1B.2 Địa chỉ: sửa lỗi khớp giữa chữ ("QC cao cấp" → "ấp")
`ADDR_RE` cũ khớp **chuỗi con**, nên "cao **cấp**" bị coi là "ấp" và tin quảng cáo
(`Áo shop SALE… Màu sắc… Chất liệu…`) bị nhận làm địa chỉ. Giờ bắt buộc **ranh giới từ**
(không dùng `\b` vì tiếng Việt có dấu), đồng thời:
* bỏ qua dòng dài > 160 ký tự (bảng giá, mô tả sản phẩm),
* bỏ qua dòng có ≥ 2 dấu hiệu quảng cáo (`sale`, `màu sắc`, `chất liệu`, `miễn ship`,
  `inbox`, `combo`, `bảng giá`…).

### 1B.3 Sửa lỗi "điền rồi lại sửa thành số lẻ" (đúng kiểu "đôi khi điền sai")
Sau khi ghi số đẹp (VD cần 101.000 → ghi 100.000, Thành tiền 200.000, lệch 1.000 ≤ sai số
5.000), vòng lặp cũ **vẫn tính tiếp** và ghi đè thành số lẻ 101.000. Giờ kiểm tra
**`|Thành tiền − Tổng đơn| ≤ sai số` trước tiên** ⇒ dừng ngay, giữ số đẹp.
(Có test hồi quy: cần 101.000 → ghi **1 lần duy nhất** 100.000, không sửa lại.)

### 1B.4 Chỉ định thủ công — "chốt hạ" khi UI đổi quá nhiều
Trong `⚙` có 3 nút:
* **① Chỉ định ô Thành tiền** → con trỏ thành dấu ngắm, bấm vào con số Thành tiền trên
  trang. Script sinh CSS selector, lưu lại (sống qua F5) và **luôn ưu tiên** ô đó.
* **② Chỉ định ô Giảm giá** → tương tự cho ô nhập giảm giá.
* **Bỏ chỉ định** → trả về tự dò.

Chỉ cần làm **một lần** cho mỗi máy/trình duyệt. Thanh trạng thái sẽ hiện
"Bấm vào số tiền THÀNH TIỀN…" khi đang ở chế độ chọn.

### 1B.5 Chẩn đoán in thêm 2 mục để soi tiếp
* **Các dòng tiền trong hộp thanh toán**: `[0] "tổng tiền hàng" → 300.000 (.flex-between…)`
  — thấy ngay nhãn thật là chữ gì, giá trị bao nhiêu, dòng nào đang [ẨN].
* **`.text-final-price` toàn trang**: số lượng + giá trị + đang ẩn/hiện.
* **Chỉ định thủ công**: selector đã lưu còn khớp không.

### 1B.6 Bộ kiểm thử nằm trong repo
`tests/lendon.test.js` (**111 test**) + `package.json`. Chạy:

```bash
npm install     # cài jsdom
npm test
```

Gồm: đọc tiền/nhãn/size (48), bộ điều khiển giảm giá (25), DOM jsdom dựng theo
`html3.txt` + các tình huống UI khác (38) — trong đó có hồi quy cho đúng ca của bạn:
câu `"Tổng Đơn Hàng : 2 áo sz L 199k miễn ship"`, đơn 300.000, tin quảng cáo
`"QC cao cấp…"` không được coi là địa chỉ, dòng tổng không có `.text-final-price`,
nhãn tổng là chữ lạ, pane bị đẩy ra ngoài, và chỉ định thủ công.

---

# PHẦN 2 — 13.0: bỏ UI lớn, giữ 1 nút TẠM DỪNG + 1 nút BẬT/TẮT, sửa logic Giảm giá

> ⚠️ **Tắt/gỡ script 12.1 cũ trước khi bật bản này.** Hai script cùng ghi vào ô
> "Giảm giá" sẽ tranh nhau và vẫn ra số sai.

---

## 1. Yêu cầu

1. **Xoá giao diện script** (thẻ to 370px, bảng màu/size/SĐT/địa chỉ…) — chỉ cần
   1 nút **Tạm dừng** tự động điền và 1 công tắc **BẬT/TẮT**.
2. **Giữ nguyên các chức năng tự động điền**: mã SP + size → ô tìm kiếm sản phẩm,
   địa chỉ → `#shippingAddress`, số tiền → ô "Giảm giá".
3. **Kiểm tra lại logic tự điền giá** vì "đôi khi bị sai" và hoàn thiện.

---

## 2. Giao diện mới

Chỉ một thanh nhỏ ở góc phải dưới (kéo thả được, lưu vị trí):

```
 ● 260.000 ✓        [ BẬT ] [ ⏸ ] [ ⚙ ]
```

| Thành phần | Việc |
|---|---|
| `●` + dòng chữ | Trạng thái + số tiền (rê chuột để xem chi tiết: tổng đơn, mã SP, địa chỉ, lý do) |
| `BẬT / TẮT` | Bật/tắt **toàn bộ** tự động điền (lưu trong localStorage) |
| `⏸ / ▶` | Tạm dừng / tiếp tục tự động điền (lưu trong localStorage) |
| `⚙` | Cài đặt: bước giảm giá, sai số cho phép, giảm tối đa, tỉ lệ tối đa %, ghi log, **Bỏ khoá "sửa tay"** |

Bảng chi tiết (màu, SĐT, chiều cao/cân nặng…) đã bỏ — script chỉ còn nhiệm vụ điền.

---

## 3. Vì sao tự điền giá "đôi khi bị sai" (đã tìm ra 8 nguyên nhân)

### 3.1 Đọc nhầm giá của pane **"Thông tin"** (lỗi nặng nhất)

Từ `html.txt`/`html2.txt`/`html3.txt`, form "Tạo đơn" nằm trong khung trượt:

```html
<div id="customerCol">
  <div class="tab-label-track"><div class="tab-label-item">Thông tin</div>
    <div class="tab-label-item" id="quick-create-order-tab">Tạo đơn</div></div>
  <div class="react-swipeable-view-container">
    <div aria-hidden="false" data-swipeable="true">  <!-- pane đang mở  -->
      <div class="swipeable-view-content swipeable-info-view"> … .order-list, .color-price 160.000 đ … </div>
    </div>
    <div aria-hidden="true" data-swipeable="true">   <!-- pane Tạo đơn: VẪN NẰM TRONG DOM -->
      <div class="swipeable-view-order swipeable-view-content"> … form tạo đơn … </div>
    </div>
  </div>
</div>
```

Pane không mở **không bị xoá**, chỉ bị **dịch ra ngoài màn hình** → nó vẫn có
`width/height > 0`. Bản 12.1 dùng `isVisible()` (chỉ kiểm tra kích thước) nên
`.text-final-price` / `.order-header` của **pane Thông tin (danh sách đơn cũ)** vẫn
được coi là "đang hiển thị" → script đọc giá của **đơn cũ** rồi lấy đó làm mốc
→ giảm giá sai. `isOrderOpen()` của bản cũ (dựa vào `.order-header`) cũng báo "đã mở
form" ngay khi chỉ mở xem thông tin hội thoại.

**13.0**: chỉ làm việc trong **pane đang thực sự nhìn thấy** (`paneVisible`: giao với
màn hình **và** nằm trong hộp `#customerCol`), cộng điểm theo dấu hiệu form
(`#shippingAddress`, `input.ant-input-number-input`, `input[type="search"]`).
Tab "Thông tin" đang mở ⇒ **không có form ⇒ không ghi gì**.

### 3.2 Bắt nhầm "Thành tiền" của **từng sản phẩm**

i18n trong repo cho thấy nhãn "Thành tiền" dùng cho cả dòng sản phẩm
(`totalPayment`) và dòng tổng đơn (`finalPrice`). Bản cũ lấy `.text-final-price`
đầu tiên nhìn thấy ⇒ có thể là **thành tiền của 1 sản phẩm** (VD 160.000) ⇒ giảm sai.
**13.0**: ưu tiên dòng nằm **cùng hộp thanh toán với ô "Giảm giá"**, chỉ sau dòng
Giảm giá; điểm thấp hơn mới xét tới `.text-final-price`.

### 3.3 Không bù được **phí vận chuyển**

Bản cũ tính `base = Thành tiền + Giảm giá` rồi `cần giảm = base − tổng đơn`.
Nếu "Thành tiền" đã gồm phí ship (hoặc shop nhập ship sau), mốc bị lệch **đúng
bằng tiền ship** ⇒ sai số tiền ship. Không có bước đọc lại để phát hiện.
**13.0**: ghi xong **đọc lại Thành tiền**, nếu lệch thì tự hiệu chỉnh lại
(`need = D + (Thành tiền − tổng đơn)`), tối đa 3 lần rồi dừng và báo rõ.

### 3.4 Kẹt "originalFinalPrice" giữa 2 đơn

Bản cũ khoá giá trị mốc và chỉ reset khi dòng chốt đơn **đổi chữ**. Hai đơn khác
nhau (hoặc cùng hội thoại, cùng câu "chốt đơn 260k") ⇒ dùng lại mốc cũ ⇒ sai.
**13.0**: chữ ký đơn = `mã hội thoại | tổng đơn | mã SP + size`; đổi là reset sạch.

### 3.5 Tổng đơn đọc từ **tin nhắn cũ**

Bản cũ quét toàn bộ chat, gặp dòng nào có "tổng đơn" là lấy. Tin "chốt đơn 260k"
của tuần trước vẫn được dùng cho đơn mới ⇒ giảm sai.
**13.0**: chỉ dùng tổng đơn **trong 40 dòng gần nhất**, quá cũ ⇒ trạng thái
"Tổng đơn đã cũ" và **không tự ghi**.

### 3.6 Đọc tiền bị lỗi / bỏ sót định dạng

* `đ\b` trong regex cũ **không bao giờ khớp** khi "đ" đứng cuối chuỗi (vì `đ`
  không thuộc `\w`) ⇒ `"tổng đơn 320.000đ"` bị coi là **không có tổng**.
* Không hiểu `1tr2`, `320 nghìn`, `320` (số trần)…
* Bắt **số đầu tiên** sau từ khoá ⇒ `"chốt đơn 160k + 160k"` ra 160k.
**13.0**: bộ đọc tiền mới (k/nghìn/ngàn/tr/triệu/đ/vnđ/đồng, `1tr2`, `320.000`,
`320`→320k có gắn cờ "đoán đơn vị"), **cộng** khi có dấu `+`, lấy số sau dấu `=`,
bỏ số thuộc `ship/phí/cọc/giảm`, bỏ giờ/ngày (`08:14`, `25/09`) và SĐT.

### 3.7 Ghi trong lúc app đang tính lại

Bản cũ vừa quét vừa ghi ngay (poll 1,2s + observer 180ms), hai đường cùng ghi,
không chờ app "đứng giá" ⇒ ghi vào lúc Thành tiền còn đang cập nhật.
**13.0**: giá phải **đứng yên 2 nhịp** mới ghi, form mới mở phải chờ 0,7s, có
khoá "đang ghi" + cooldown, chỉ **một** đường ghi duy nhất.

### 3.8 Tranh nhau với người dùng + ghi rồi không kiểm tra

Bản cũ `focus()`/`blur()` ô giảm giá liên tục (có thể cướp chỗ đang gõ) và cứ
điền lại dù bạn vừa sửa tay.
**13.0**: không cướp focus (chỉ dùng focus khi không có ô nào đang gõ), và nếu
**bạn tự sửa ô Giảm giá** thì script **giữ nguyên số của bạn** cho đơn đó
(xoá trắng ô = trả quyền lại cho script; hoặc bấm ⚙ → *Bỏ khoá "sửa tay"*).

---

## 4. Cơ chế mới: vòng lặp "ghi → đọc lại → sửa"

```
T  = tổng đơn đọc từ chat (dòng chốt/tổng đơn gần nhất)
F  = "Thành tiền" đọc trong form (đúng pane đang mở)
D  = giá trị ô "Giảm giá" hiện tại
base = F + D                      // mốc trước khi trừ phần giảm giá này
need = base − T

need ≤ sai số cho phép        → OK, không ghi
need < 0                      → chờ thêm sản phẩm (không ghi)
need > giảm tối đa / > 70% đơn → DỪNG, cảnh báo
còn lại                       → ghi D = round(need, bước)   (lần đầu: số đẹp 10k)
                                 chờ ~0,4s đọc lại ô giảm giá (không nhận ⇒ thử cách 2)
                                 chờ ~0,9s đọc lại Thành tiền
                                   |F − T| ≤ sai số   → xong
                                   F không đổi dù đã ghi ⇒ DỪNG (ghi sai chỗ)
                                   còn lượt (≤ 3)      → ghi D = D + (F − T) rồi lặp
                                   hết lượt            → DỪNG + báo số lệch
```

Vì luôn kiểm chứng bằng **Thành tiền thật sau khi ghi**, mọi sai lệch hệ thống
(phí ship, app làm tròn, ô giảm giá bị kẹp giá trị, ghi sai ô) đều bị phát hiện
thay vì âm thầm cho ra số sai.

### An toàn
* Chỉ tin dòng có nhãn **chính xác** `Giảm giá` (`giảm giá`, `giảm giá đơn hàng`,
  `chiết khấu đơn hàng`) — loại `Giảm giá theo combo / khuyến mại / voucher /
  trên từng sản phẩm`.
* Không bao giờ ghi sang ô khác nếu không tìm thấy dòng "Giảm giá"
  (trạng thái *Chưa thấy ô Giảm giá*).
* Giới hạn: ≤ 2.000.000đ, ≤ 70% giá trị đơn, ≤ 3 lần ghi/đơn.
* Lỗi ⇒ **khoá đơn đó** và hiển thị lý do; mở lại form đơn sẽ tự bỏ khoá.

---

## 5. Các chức năng tự động điền giữ nguyên

| Chức năng | Nguồn dữ liệu | Ghi chú |
|---|---|---|
| Mã SP + size → ô "Tìm kiếm sản phẩm" | `#listShowTags .row_tag_list:nth-child(3) .btn-tag-item:nth-child(4)` (đã kiểm chứng: hàng 3 item 4 = `M20` trong `html3.txt`), size đọc từ chat | Chỉ điền khi ô trống hoặc vẫn là mã cũ; không đè chữ bạn đang gõ; có fallback quét tag giống mã SP nếu vị trí tag thay đổi; tự bỏ size dính trong tag (`M20 L` → `M20` + size) |
| Địa chỉ → `#shippingAddress` | Dòng **cuối cùng** giống địa chỉ trong chat (ghép tối đa 2 dòng liền nhau) | Không ghi đè địa chỉ bạn tự nhập; không điền lặp |
| Giảm giá → ô "Giảm giá" | Tổng đơn trong chat | Vòng lặp kiểm chứng ở mục 4 |

Bỏ: bảng hiển thị màu / chiều cao cân nặng / SĐT / danh sách dòng chốt đơn (chỉ để
xem, không điền) — giữ code gọn và nhẹ, không quét `div` toàn trang mỗi 1,2s nữa
(chat đọc bằng `#message-col-list .message-text-ele`, chỉ tính lại khi chat đổi).

---

## 6. Kiểm thử (13.0)

Bộ test chạy bằng Node (jsdom), không nằm trong repo:

* **38 test** đọc tiền/size/nhãn: `320.000đ` (lỗi cũ), `260k`, `1tr2`, `320 nghìn`,
  `320`, `160k + 160k`, `160k = 320k`, `cọc 100k`, giờ/ngày, SĐT, không nhận
  `Giảm giá theo combo`, `Tổng tiền hàng ≠ Tổng tiền`…
* **24 test** bộ điều khiển giảm giá (app giả): đủ hàng, có ship, số lẻ, chưa đủ
  hàng, ô giảm giá vô tác dụng, app kẹp giá trị, người dùng sửa tay, tổng đơn cũ,
  thêm sản phẩm sau khi đã giảm, chênh lệch quá lớn.
* **30 test** DOM thật (jsdom, dựng theo `html3.txt`): không đọc giá pane "Thông tin",
  không lấy "Thành tiền" của dòng sản phẩm, tab Thông tin thì không ghi, mã SP `M20`
  + size `L`, địa chỉ, và một lượt chạy thật: đơn 320.000 + ship 30.000 → tự điền
  **30.000** → Thành tiền **320.000**, rồi đổi tổng đơn thành 300k → tự tính lại.

Tổng: **92/92 pass** (13.0).

---

## 7. Script dựa vào phần nào của nguồn

**Đã kiểm chứng trong repo**: `#customerCol`, `#quick-create-order-tab`,
`[data-swipeable="true"]`, `.swipeable-view-order`, `#message-col-list`,
`.message-text-ele`, `.inbox-message-ele`, `#conversationList … .selected`,
`#listShowTags > .row_tag_list > .btn-tag-item`, `input.ant-input-number-input`
(+ `.pancake-antd-input-number` trong `_app-*.v6.js`), i18n
`discountAmount/finalPrice/typeToSearch/shippingFee`, `.order-header.info-center…`.

**Chưa có trong repo** (giữ theo DOM thật của bạn, luôn có fallback theo nhãn):
`.flex-between.row-content-payment`, `.text-final-price`, `.box-input-number-wrapper`,
`#shippingAddress`. Nếu Pancake đổi các class này, script vẫn tìm dòng theo **nhãn
chữ** ("Giảm giá", "Thành tiền", "Phí vận chuyển"…) nên không chết cứng.

---

## 8. Dùng nhanh

1. Gỡ/tắt script 12.1 → cài `Pancake-LenDon-13.1.user.js`.
2. Mở hội thoại → tab **Tạo đơn** (cột phải) → thêm sản phẩm (bấm ô tìm kiếm, mã tự điền).
3. Chat có `tổng đơn / chốt đơn` ⇒ script tự tính và điền ô **Giảm giá**, thanh trạng thái
   hiện `260.000 ✓`.
4. Khi cần dừng tay: bấm `⏸` (tạm dừng) hoặc `TẮT`; muốn tự túc một đơn thì cứ sửa
   ô Giảm giá — script nhường ngay.

**Lưu ý về "tổng đơn"**: script luôn hiểu *tổng đơn trong chat = số tiền cuối cùng
khách phải trả* (tức là đưa **Thành tiền** về đúng con số đó, có/không có phí ship
đều tự khớp nhờ đọc lại). Nếu shop muốn khách trả `tổng đơn + phí ship`, hãy chốt
trong chat con số đã gồm ship, hoặc chuyển công tắc `⏸` và tự nhập giảm giá.
