/**
 * Bộ kiểm thử cho Pancake-LenDon-13.1.user.js
 *
 * Chạy:  npm install        (cần jsdom, xem package.json)
 *        node tests/lendon.test.js
 *
 * Gồm 3 nhóm:
 *   1. Đọc tiền / nhãn / size        (hàm thuần)
 *   2. Bộ điều khiển giảm giá        (app giả, không cần DOM)
 *   3. DOM thật (jsdom)              (dựng theo html.txt / html2.txt / html3.txt)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCRIPT_PATH = path.join(__dirname, '..', 'Pancake-LenDon-13.1.user.js');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

function check(cond, label, extra) {
    if (cond) { pass++; return; }
    fail++;
    failures.push(label + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
}

function eq(actual, expected, label) {
    check(JSON.stringify(actual) === JSON.stringify(expected), label,
        { got: actual, expected });
}

const fmt = (n) => (n ? n.toLocaleString('en-US') : '');


// =====================================================================
// 0. MÔI TRƯỜNG GIẢ TỐI THIỂU (dùng cho nhóm 1 & 2)
// =====================================================================

const fakeEl = () => ({
    style: {}, innerHTML: '', className: '', children: [], value: '', textContent: '',
    querySelector: () => null, querySelectorAll: () => [], appendChild() {},
    addEventListener() {}, setAttribute() {}, getAttribute: () => null,
    closest: () => null, matches: () => false,
    classList: { add() {}, remove() {}, toggle() {} },
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 })
});

function baseEnv() {
    global.window = {
        innerWidth: 1600,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
    };
    global.document = {
        body: null, head: null, activeElement: null, documentElement: {},
        querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
        createElement: fakeEl, addEventListener() {}
    };
    global.localStorage = { getItem: () => null, setItem() {} };
    global.MutationObserver = class { observe() {} };
    global.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
    global.HTMLInputElement = class {};
    global.HTMLTextAreaElement = class {};
    global.InputEvent = class {};
    global.Event = class {};
    global.KeyboardEvent = class {};
}

function loadScript(expose, prelude) {
    const src = SCRIPT.replace(/\}\)\(\);\s*$/, `
        ${prelude || ''}
        globalThis.__X = { ${expose} };
    })();`);
    eval(src);
    return globalThis.__X;
}


// =====================================================================
// 1. ĐỌC TIỀN / NHÃN / SIZE
// =====================================================================

function testParsing() {
    baseEnv();
    const X = loadScript(`
        moneyTokens, parseInputNumber, digitsValue, norm, sizeFromLine, extractTotal,
        labelMatches, roundToStep, isLikelyCode, ORDER_RE, ADDR_RE, PROMO_HINTS, stripSizeSuffix, parseNum`);

    const toks = (t) => X.moneyTokens(t).map(x => x.value);
    const total = (line, next) => { const t = X.extractTotal(line, next); return t ? t.value : null; };

    // ---- đơn vị tiền ----
    eq(toks('tổng đơn 320.000đ')[0], 320000, 'đ cuối chuỗi (lỗi cũ \\b với "đ")');
    eq(toks('chốt đơn 260k')[0], 260000, 'k');
    eq(toks('1tr2')[0], 1200000, 'tr2');
    eq(toks('320 nghìn')[0], 320000, 'nghìn');
    eq(toks('1.200.000')[0], 1200000, 'nhóm nghìn');
    eq(toks('1600000đ')[0], 1600000, 'không phân cách + đ');
    eq(toks('size M, 60kg'), [], 'không nhận size/cân nặng');

    // ---- tổng đơn ----
    eq(total('tổng đơn 320k'), 320000, 'tổng đơn 320k');
    eq(total('chốt đơn: 260k'), 260000, 'chốt đơn: 260k');
    eq(total('Tổng đơn 320.000đ'), 320000, 'Tổng đơn 320.000đ');
    eq(total('320k tổng đơn'), 320000, 'tiền trước từ khoá');
    eq(total('chốt đơn 2 áo 160k = 320k'), 320000, 'dấu = lấy số cuối');
    eq(total('tổng đơn 320k ship 30k'), 320000, 'bỏ phí ship');
    eq(total('ship 30k, tổng đơn 320k'), 320000, 'ship ở trước');
    eq(total('tổng đơn 160k + 160k'), 320000, 'phép cộng');
    eq(total('chốt đơn 260k cọc 100k'), 260000, 'cọc không lấy');
    eq(total('chốt đơn'), null, 'không có số');
    eq(total('chốt đơn 08:14 25/09'), null, 'giờ/ngày không bị nhận');
    eq(total('tổng đơn 320'), 320000, 'số trần = nghìn');
    eq(total('tổng đơn 1tr2'), 1200000, '1tr2');
    eq(total('sđt 0912345678 tổng đơn 500k'), 500000, 'không lấy SĐT');
    eq(total('tổng đơn', '320k'), 320000, 'tổng đơn xuống dòng');
    eq(total('tổng 320k'), 320000, 'cách nói "tổng 320k"');
    eq(total('chốt 320k nha'), 320000, 'cách nói "chốt 320k"');
    eq(total('bill 320k'), 320000, 'cách nói "bill 320k"');
    eq(total('thanh toán 320k'), 320000, 'cách nói "thanh toán 320k"');
    eq(total('Tổng Đơn Hàng : 2 áo đen đỏ sz L 199k miễn ship'), 199000,
        'câu thật của user: "Tổng Đơn Hàng : … 199k miễn ship"');
    eq(X.ORDER_RE.test('ck 320k'), false, 'dòng "ck 320k" không phải tổng đơn');

    // ---- size ----
    eq(X.sizeFromLine('chốt đơn 320k size L'), 'L', 'size L');
    eq(X.sizeFromLine('áo M nhé'), 'M', 'M viết hoa');
    eq(X.sizeFromLine('mình gửi nhé'), '', 'chữ m thường không nhận');
    eq(X.sizeFromLine('2 áo đen đỏ sz L 199k'), 'L', 'sz L');
    eq(X.sizeFromLine('size XXL'), '2XL', 'XXL → 2XL');

    // ---- nhãn dòng tiền ----
    eq(!!X.labelMatches('Giảm giá', ['giảm giá']), true, 'nhãn giảm giá');
    eq(!!X.labelMatches('Giảm giá theo combo', ['giảm giá']), false, 'loại "Giảm giá theo combo"');
    eq(!!X.labelMatches('Giảm giá trên từng sản phẩm', ['giảm giá']), false, 'loại "giảm giá từng SP"');
    eq(!!X.labelMatches('Tổng tiền hàng', ['tổng tiền']), false, 'Tổng tiền hàng ≠ Tổng tiền');
    eq(!!X.labelMatches('Thành tiền', ['thành tiền']), true, 'Thành tiền');
    eq(!!X.labelMatches('Thành tiền:', ['thành tiền']), true, 'Thành tiền: (có dấu hai chấm)');
    eq(!!X.labelMatches('Giảm giá: 60.000 đ', ['giảm giá']), true, 'nhãn dính số');
    eq(!!X.labelMatches('Thành tiền hàng', ['thành tiền']), false, 'Thành tiền hàng vẫn loại');
    eq(!!X.labelMatches('Tổng thanh toán', ['thành tiền', 'tổng thanh toán']), true, 'Tổng thanh toán');
    eq(X.roundToStep(62500, 10000), 60000, 'làm tròn 62.5k');
    eq(X.parseInputNumber('60.000'), 60000, 'parse ô nhập 60.000');
    eq(X.digitsValue('260.000 đ'), 260000, 'đọc .text-final-price');

    // ---- REGRESSION: địa chỉ không được khớp "cao cấp" (ấp) ----
    const promo = 'Áo shop SALE còn (1 áo 149k, 2 áo 199k, 3 áo 279k)❤️ 🍀Màu sắc : Đen, Trắng, ' +
        'Xanh Than, Đỏ Đô. 📌Chất liệu : 100% cotton QC cao cấp loại 1 mềm mại co dãn 4 chiều ' +
        'thoải mái ko nhăn không xù, mặc thoáng mát thấm hút mồ hôi, phù hợp cho mùa này ạ ❤️';
    eq(X.ADDR_RE.test(promo), false, 'REGRESSION: tin quảng cáo KHÔNG bị coi là địa chỉ');
    eq(X.ADDR_RE.test('150/56 Tạ Thanh Lam, Đường 10, Thị trấn Yên Ninh, Huyện Yên Khánh'), true,
        'địa chỉ thật vẫn nhận');
    eq(X.ADDR_RE.test('xóm 4, xã Hải Anh'), true, 'xóm/xã vẫn nhận');
    check((promo.match(X.PROMO_HINTS) || []).length >= 2, 'có dấu hiệu nhận biết tin quảng cáo');
    eq(X.stripSizeSuffix('M20 L'), 'M20', 'bỏ size khỏi tag mã SP');
    eq(X.stripSizeSuffix('M20'), 'M20', 'giữ nguyên mã thường');
}


// =====================================================================
// 2. BỘ ĐIỀU KHIỂN GIẢM GIÁ (app giả, không DOM)
// =====================================================================

function testController() {
    baseEnv();

    let clock = 1000000;
    Date.now = () => clock;

    const X = loadScript(`
        autoDiscount, resetForNewOrder, getS: () => S, getW: () => W`,
        `
        readForm = function (root) {
            const a = globalThis.__APP;
            return { root: root, goods: a.goods, shipping: a.ship, finalEl: {},
                     discount: { row: {}, input: a.input, value: a.D },
                     finalPrice: a.F() };
        };
        writeDiscount = function (input, value) {
            const a = globalThis.__APP;
            a.writes.push(value);
            if (!a.ignore) {
                a.D = a.clamp == null ? value : Math.min(a.clamp, value);
                input.value = String(a.D);
            }
            return true;
        };
        findOrderFormRoot = function () { return {}; };
        `);

    const input = {
        value: '', disabled: false, readOnly: false,
        focus() {}, blur() {}, select() {}, setAttribute() {}, getAttribute: () => null,
        dispatchEvent: () => true
    };
    const app = {
        goods: 0, ship: 0, D: 0, ignore: false, clamp: null, writes: [], input,
        F() { return Math.max(0, this.goods + this.ship - this.D); }
    };
    globalThis.__APP = app;

    const S = X.getS();
    const run = (n) => { for (let i = 0; i < n; i++) { clock += 1000; X.autoDiscount({}); } };
    const reset = (cfg, T) => {
        Object.assign(app, { goods: 0, ship: 0, D: 0, ignore: false, clamp: null, writes: [] }, cfg);
        X.resetForNewOrder();
        S.formAt = 0;
        S.target = { value: T, age: 0, assumed: false };
        S.convKey = 'conv-' + Math.random();
    };

    // A. đủ hàng, không ship
    reset({ goods: 320000 }, 260000); run(12);
    eq(app.D, 60000, 'A: giảm 60.000');
    eq(app.F(), 260000, 'A: Thành tiền = 260.000');
    check(app.writes.length <= 2, 'A: ghi tối đa 2 lần', app.writes);

    // B. tổng đơn đã gồm ship
    reset({ goods: 300000, ship: 30000 }, 320000); run(12);
    eq(app.F(), 320000, 'B: khớp cả khi có phí ship');
    eq(app.D, 10000, 'B: giảm 10.000');

    // C. số lẻ → làm tròn số đẹp rồi dừng trong sai số cho phép (không "sửa" thành số lẻ)
    reset({ goods: 323500 }, 300000); run(14);
    eq(app.D, 20000, 'C: ghi số đẹp 20.000 (làm tròn 10k)');
    check(Math.abs(app.F() - 300000) <= 5000, 'C: Thành tiền trong sai số cho phép', app.F());
    check(app.writes.length === 1, 'C: chỉ ghi 1 lần', app.writes);
    check(S.attempts < 99, 'C: không bị khoá', S.attempts);

    // D. chưa đủ sản phẩm
    reset({ goods: 160000 }, 500000); run(10);
    eq(app.writes, [], 'D: chờ thêm SP, không ghi');
    eq(S.status.code, 'waiting', 'D: trạng thái waiting');

    // E. ô giảm giá không tác động Thành tiền
    reset({ goods: 320000, ignore: true }, 260000); run(14);
    eq(S.attempts, 99, 'E: dừng khi ghi vô tác dụng');
    check(app.writes.length <= 3, 'E: không ghi quá 3 lần', app.writes);

    // F. app kẹp giá trị
    reset({ goods: 320000, clamp: 50000 }, 200000); run(14);
    check(['writefail', 'locked'].indexOf(S.status.code) !== -1, 'F: báo lỗi rõ ràng', S.status.code);
    check(!!S.lockDetail, 'F: giữ lý do khoá', S.lockDetail);

    // G. người dùng sửa tay
    reset({ goods: 320000 }, 260000);
    clock += 1000; X.autoDiscount({});
    app.D = 70000; S.manual = true; S.manualValue = 70000;
    run(10);
    eq(app.D, 70000, 'G: giữ số người dùng nhập');
    eq(S.status.code, 'manual', 'G: trạng thái manual');

    // H. xoá trắng → tự tính lại
    app.D = 0; run(12);
    eq(app.D, 60000, 'H: xoá trắng → tự điền lại');

    // I. tổng đơn quá cũ
    reset({ goods: 320000 }, 260000); S.target.age = 500; run(10);
    eq(app.writes, [], 'I: tổng đơn cũ → không ghi');
    eq(S.status.code, 'stale', 'I: trạng thái stale');

    // I2. "không giới hạn" → vẫn ghi
    reset({ goods: 320000 }, 260000); S.cfg.maxAge = 0; S.target.age = 500; run(12);
    eq(app.D, 60000, 'I2: không giới hạn tuổi → vẫn tự ghi');
    S.cfg.maxAge = 200;

    // J. thêm sản phẩm sau khi đã giảm
    reset({ goods: 320000 }, 260000); run(12);
    eq(app.D, 60000, 'J1: giảm 60.000');
    app.goods = 480000; run(14);
    eq(app.F(), 260000, 'J2: Thành tiền vẫn = tổng đơn sau khi thêm SP');
    check(app.D > 60000, 'J3: tự tăng số giảm', app.D);

    // K. chênh lệch vượt mức an toàn
    reset({ goods: 5000000 }, 100000); run(10);
    eq(app.writes, [], 'K: chặn khi lệch quá lớn');
    eq(S.status.code, 'danger', 'K: trạng thái danger');

    // L. KỊCH BẢN THẬT của user: hàng 300.000, khách chốt 199.000
    reset({ goods: 300000 }, 199000); run(12);
    eq(app.D, 100000, 'L: giảm 100.000 (làm tròn 10k)');
    eq(app.F(), 200000, 'L: Thành tiền 200.000, lệch 1.000 ≤ 5.000 → xong');
    check(['applied', 'ok'].indexOf(S.status.code) !== -1, 'L: trạng thái xong', S.status.code);
}


// =====================================================================
// 3. DOM THẬT (jsdom)
// =====================================================================

function boot(html, opts) {
    opts = opts || {};
    const dom = new JSDOM('<!doctype html><html><head></head><body>' + html + '</body></html>',
        { url: 'https://pancake.vn/', runScripts: 'outside-only' });
    const { window } = dom;
    const doc = window.document;

    Object.defineProperty(window, 'innerWidth', { value: opts.width || 1600, writable: true });
    window.Element.prototype.getBoundingClientRect = function () {
        let el = this;
        while (el && el.getAttribute) {
            const v = el.getAttribute('data-rect');
            if (v) {
                const p = v.split(',').map(Number);
                return {
                    left: p[0], top: p[1], width: p[2], height: p[3],
                    right: p[0] + p[2], bottom: p[1] + p[3], x: p[0], y: p[1]
                };
            }
            el = el.parentElement;
        }
        return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
    };

    let clock = 1000000;
    window.Date.now = () => clock;
    global.Date.now = () => clock;

    const app = {
        goods: opts.goods == null ? 320000 : opts.goods,
        ship: opts.ship == null ? 30000 : opts.ship,
        D: 0,
        F() { return this.goods + this.ship - this.D; }
    };
    const input = doc.querySelector('input.ant-input-number-input');
    // ô Thành tiền của ĐƠN đang tạo (không phải của pane "Thông tin" chứa đơn cũ)
    const finalEl = doc.querySelector('.payment-box .text-final-price') ||
        doc.querySelector('.summary .text-final-price') ||
        doc.querySelector('.text-final-price');
    if (input) {
        input.addEventListener('input', () => {
            app.D = Number(String(input.value).replace(/[^\d]/g, '')) || 0;
            input.value = fmt(app.D);
            if (finalEl) finalEl.textContent = fmt(app.F()) + ' đ';
        });
    }

    const src = SCRIPT.replace(/\}\)\(\);\s*$/, `
        globalThis.__X = {
            tick, findOrderFormRoot, readForm, describeEl, S, scanChat,
            getProductCodeWithSize, usableRoot, diagnose, autoFillAddress,
            getAddressInput, fillProductSearch, cssPath, startPick
        };
    })();`);

    const saved = {
        window: global.window, document: global.document, localStorage: global.localStorage,
        MutationObserver: global.MutationObserver, Node: global.Node, InputEvent: global.InputEvent,
        Event: global.Event, KeyboardEvent: global.KeyboardEvent,
        HTMLInputElement: global.HTMLInputElement, HTMLTextAreaElement: global.HTMLTextAreaElement,
        getComputedStyle: global.getComputedStyle, setTimeout: global.setTimeout,
        location: global.location
    };
    global.window = window;
    global.document = doc;
    global.localStorage = window.localStorage;
    global.MutationObserver = window.MutationObserver;
    global.Node = window.Node;
    global.InputEvent = window.InputEvent;
    global.Event = window.Event;
    global.KeyboardEvent = window.KeyboardEvent;
    global.HTMLInputElement = window.HTMLInputElement;
    global.HTMLTextAreaElement = window.HTMLTextAreaElement;
    global.getComputedStyle = window.getComputedStyle.bind(window);
    window.setInterval = () => 0;
    window.setTimeout = () => 0;
    global.setTimeout = () => 0;

    eval(src);

    return {
        X: globalThis.__X, doc, app, input, finalEl,
        clock: () => clock,
        advance: (n) => { for (let i = 0; i < n; i++) { clock += 1000; globalThis.__X.tick(); } },
        restore: () => { Object.assign(global, saved); }
    };
}

const CHAT = `
<div id="message-col-list" data-rect="0,60,700,840">
  <div class="message-list media-list-conversation"><div class="day-section">
    <div class="inbox-message-ele"><div class="message-text-field"><div class="message-text-ele"><div>150/56 Tạ Thanh Lam, Đường 10, Thị trấn Yên Ninh, Huyện Yên Khánh</div></div></div></div>
    <div class="inbox-message-ele"><div class="message-text-field"><div class="message-text-ele"><div>Tổng Đơn Hàng : 2 áo sz L 199k miễn ship</div></div></div></div>
  </div></div>
</div>`;

function testForms() {
    // ---------- 3.1 form trong pane đang mở (giống html3.txt) ----------
    {
        const env = boot(`
        <div id="conversationList" data-rect="0,60,310,840">
          <div id="675541385634278_28794751720156211">
            <div class="media conversation-list-item selected" data-rect="0,60,310,120"><span class="name-text">Tạ Thanh Lam</span></div>
          </div>
        </div>
        ${CHAT}
        <div class="list-tags-show" id="listShowTags">
          <div class="row_tag_list"><button class="btn-tag-item">T.Anh</button><button class="btn-tag-item">24/9</button><button class="btn-tag-item">23/9</button><button class="btn-tag-item">Thơm</button></div>
          <div class="row_tag_list"><button class="btn-tag-item">Mai</button><button class="btn-tag-item">Phương</button><button class="btn-tag-item">Tây</button><button class="btn-tag-item">29/9</button></div>
          <div class="row_tag_list"><button class="btn-tag-item">Chặn</button><button class="btn-tag-item">Đã Nhập</button><button class="btn-tag-item">Mua hàng</button><button class="btn-tag-item">A74</button></div>
        </div>
        <div id="customerCol" data-rect="1200,60,360,870">
          <div class="tab-label-track">
            <div class="tab-label-item active" id="tab-info"><span class="title">Thông tin</span></div>
            <div class="tab-label-item" id="quick-create-order-tab"><span class="title">Tạo đơn</span></div>
          </div>
          <div class="react-swipeable-view-container">
            <div aria-hidden="false" data-swipeable="true" id="pane-info" data-rect="1200,105,360,825">
              <div class="swipeable-view-content swipeable-info-view">
                <div class="order-list"><div class="order-header info-center info-justify-content user-select-none">
                  <span class="info-text">160.000 đ</span></div><span class="text-final-price">160.000 đ</span></div>
              </div>
            </div>
            <div aria-hidden="true" data-swipeable="true" id="pane-create" data-rect="1560,105,360,825">
              <div class="swipeable-view-order swipeable-view-content">
                <input type="search" placeholder="Tìm kiếm sản phẩm">
                <input id="shippingAddress" type="text">
                <div class="product-list">
                  <div class="flex-between product-row"><span>Tên SP</span><span>Thành tiền</span>
                    <span class="color-price">160.000 đ</span></div>
                </div>
                <div class="payment-box">
                  <div class="flex-between row-content-payment"><span class="text-color-default">Tổng tiền hàng</span><span class="color-price">320.000 đ</span></div>
                  <div class="flex-between row-content-payment"><span class="text-color-default">Giảm giá</span>
                    <span class="box-input-number-wrapper"><input class="ant-input-number-input" role="spinbutton" value=""></span></div>
                  <div class="flex-between row-content-payment"><span class="text-color-default">Giảm giá theo combo</span><span class="color-price">0 đ</span></div>
                  <div class="flex-between row-content-payment"><span class="text-color-default">Phí vận chuyển</span><span class="color-price">30.000 đ</span></div>
                  <div class="flex-between row-content-payment"><span class="text-color-default">Thành tiền</span><span class="text-final-price">350.000 đ</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>`, { goods: 320000, ship: 30000 });

        // tab "Thông tin" đang mở -> không có form
        check(env.X.findOrderFormRoot() === null, '3.1: tab Thông tin đang mở → không thấy form',
            env.X.describeEl(env.X.findOrderFormRoot()));

        // mở tab "Tạo đơn"
        env.doc.querySelector('#pane-info').setAttribute('data-rect', '1560,105,360,825');
        env.doc.querySelector('#pane-info').setAttribute('aria-hidden', 'true');
        env.doc.querySelector('#pane-create').setAttribute('data-rect', '1200,105,360,825');
        env.doc.querySelector('#pane-create').setAttribute('aria-hidden', 'false');

        const root = env.X.findOrderFormRoot();
        check(!!root, '3.1: mở tab → thấy form', env.X.describeEl(root));

        const f = env.X.readForm(root);
        eq(f.discount && f.discount.value, 0, '3.1: đọc ô Giảm giá');
        eq(f.finalPrice, 350000, '3.1: Thành tiền đúng (không lấy 160.000 của SP/đơn cũ)');
        eq(f.goods, 320000, '3.1: Tổng tiền hàng');
        eq(f.shipping, 30000, '3.1: Phí vận chuyển');

        // chat
        env.X.scanChat();
        eq(env.X.S.target.value, 199000, '3.1: tổng đơn 199k ("Tổng Đơn Hàng : … 199k miễn ship")');
        eq(env.X.S.size, 'L', '3.1: size L');
        check(/Yên Khánh/.test(env.X.S.address), '3.1: địa chỉ thật', env.X.S.address);
        check(!/cotton|Chất liệu/i.test(env.X.S.address), '3.1: KHÔNG nhận tin quảng cáo làm địa chỉ',
            env.X.S.address);

        // mã SP + size
        eq(env.X.getProductCodeWithSize(), 'A74 L', '3.1: mã SP + size');

        // điền địa chỉ
        env.X.S.formAt = env.clock() - 5000;
        const addr = env.X.getAddressInput(root);
        env.X.autoFillAddress(root);
        check(/Yên Khánh/.test(addr.value), '3.1: tự điền địa chỉ', addr.value);

        // vòng giảm giá: 320 + 30 − 199 = 151 → làm tròn 150 → còn lệch 1.000 → xong
        env.advance(14);
        eq(env.app.D, 150000, '3.1: tự điền giảm 150.000');
        eq(env.app.F(), 200000, '3.1: Thành tiền 200.000 (lệch 1.000 ≤ sai số 5.000)');
        check(['applied', 'ok'].indexOf(env.X.S.status.code) !== -1, '3.1: trạng thái xong',
            env.X.S.status.code);
    }

    // ---------- 3.2 pane bị đẩy ra ngoài → không ghi ----------
    {
        const env = boot(`
        <div id="message-col-list" data-rect="0,60,700,840"><div class="message-list media-list-conversation">
          <div class="day-section"><div class="inbox-message-ele"><div class="message-text-field">
            <div class="message-text-ele"><div>chốt đơn 320k</div></div></div></div></div></div></div>
        <div id="customerCol" data-rect="1200,60,360,870">
          <div class="pane" data-swipeable="true" data-rect="1200,105,360,825">
            <div class="swipeable-view-order">
              <input type="search" placeholder="Tìm kiếm sản phẩm">
              <div class="payment-box">
                <div class="flex-between row-content-payment"><span class="text-color-default">Giảm giá</span>
                  <span class="box-input-number-wrapper"><input class="ant-input-number-input" role="spinbutton"></span></div>
                <div class="flex-between row-content-payment"><span class="text-color-default">Thành tiền</span>
                  <span class="text-final-price">350.000 đ</span></div>
              </div>
            </div>
          </div>
        </div>`, { goods: 320000, ship: 30000 });
        env.X.scanChat();
        env.X.S.formAt = env.clock() - 5000;
        env.advance(12);
        eq(env.app.D, 30000, '3.2: pane đang mở → điền 30.000');

        env.doc.querySelector('#customerCol .pane').setAttribute('data-rect', '1600,105,360,825');
        const before = env.app.D;
        env.advance(10);
        eq(env.app.D, before, '3.2: pane bị đẩy ra ngoài → KHÔNG ghi thêm');
        check(env.X.findOrderFormRoot() === null, '3.2: không nhận pane ẩn',
            env.X.describeEl(env.X.findOrderFormRoot()));
    }

    // ---------- 3.3 KHÔNG có #customerCol (form ở nơi khác) ----------
    {
        const env = boot(`
        ${CHAT}
        <div class="page-order-create" data-rect="700,60,900,840">
          <input type="search" placeholder="Tìm kiếm sản phẩm">
          <input id="shippingAddress" type="text">
          <div class="summary">
            <div class="summary-row"><span>Giảm giá</span><input class="ant-input-number-input" role="spinbutton"></div>
            <div class="summary-row"><span>Phí vận chuyển</span><span class="color-price">30.000 đ</span></div>
            <div class="summary-row"><span>Thành tiền</span><span class="text-final-price">350.000 đ</span></div>
          </div>
        </div>`, { goods: 320000, ship: 30000 });
        const root = env.X.findOrderFormRoot();
        check(!!root, '3.3: vẫn thấy form dù không có #customerCol', env.X.describeEl(root));
        env.X.scanChat();
        env.X.S.formAt = env.clock() - 5000;
        env.advance(12);
        eq(env.app.F(), 200000, '3.3: vẫn tự điền (Thành tiền 200.000)');
    }

    // ---------- 3.4 REGRESSION: dòng tổng KHÔNG có .text-final-price ----------
    {
        const env = boot(`
        ${CHAT}
        <div id="customerCol" data-rect="1200,60,360,870">
          <div class="pane" data-swipeable="true" data-rect="1200,105,360,825">
            <div class="swipeable-view-order">
              <input type="search" placeholder="Tìm kiếm sản phẩm">
              <div class="payment-box">
                <div class="flex-between row-content-payment"><span class="text-color-default">Tổng tiền hàng</span><span>300.000 đ</span></div>
                <div class="flex-between row-content-payment"><span class="text-color-default">Giảm giá</span>
                  <span class="box-input-number-wrapper"><input class="ant-input-number-input" role="spinbutton"></span></div>
                <div class="flex-between row-content-payment"><span class="text-color-default">Tổng thanh toán</span><span class="color-price total-amount">300.000 đ</span></div>
              </div>
            </div>
          </div>
        </div>`, { goods: 300000, ship: 0 });
        env.X.scanChat();
        const root = env.X.findOrderFormRoot();
        const f = env.X.readForm(root);
        eq(f.finalPrice, 300000, '3.4: đọc được "Tổng thanh toán" khi không có .text-final-price');
        env.X.S.formAt = env.clock() - 5000;
        env.advance(12);
        eq(env.app.D, 100000, '3.4: tự điền 100.000 (300.000 → 199.000, làm tròn 10k)');
        eq(env.app.F(), 200000, '3.4: Thành tiền 200.000, lệch 1.000 ≤ 5.000');
    }

    // ---------- 3.5 REGRESSION: không có nhãn nào khớp → lấy dòng cuối có tiền ----------
    {
        const env = boot(`
        ${CHAT}
        <div id="customerCol" data-rect="1200,60,360,870">
          <div class="pane" data-swipeable="true" data-rect="1200,105,360,825">
            <div class="swipeable-view-order">
              <input type="search" placeholder="Tìm kiếm sản phẩm">
              <div class="payment-box">
                <div class="flex-between row-content-payment"><span class="text-color-default">Tổng tiền hàng</span><span>300.000 đ</span></div>
                <div class="flex-between row-content-payment"><span class="text-color-default">Giảm giá</span>
                  <span class="box-input-number-wrapper"><input class="ant-input-number-input" role="spinbutton"></span></div>
                <div class="flex-between row-content-payment"><span class="text-color-default">Số dư cần thu</span><span>300.000 đ</span></div>
              </div>
            </div>
          </div>
        </div>`, { goods: 300000, ship: 0 });
        env.X.scanChat();
        const f = env.X.readForm(env.X.findOrderFormRoot());
        eq(f.finalPrice, 300000, '3.5: nhãn lạ → vẫn lấy dòng cuối có tiền làm Thành tiền');
    }

    // ---------- 3.6 REGRESSION: chỉ định thủ công ----------
    {
        const env = boot(`
        ${CHAT}
        <div id="customerCol" data-rect="1200,60,360,870">
          <div class="pane" data-swipeable="true" data-rect="1200,105,360,825">
            <div class="swipeable-view-order">
              <input type="search" placeholder="Tìm kiếm sản phẩm">
              <div class="payment-box">
                <div class="flex-between row-content-payment"><span class="text-color-default">Giảm giá</span>
                  <span class="box-input-number-wrapper"><input class="ant-input-number-input" role="spinbutton"></span></div>
                <div class="flex-between row-content-payment"><span>Khách trả</span><span class="amount-x">300.000 đ</span></div>
              </div>
            </div>
          </div>
        </div>`, { goods: 300000, ship: 0 });

        const target = env.doc.querySelector('.amount-x');
        const sel = env.X.cssPath(target);
        check(!!sel && env.doc.querySelector(sel) === target, '3.6: sinh CSS selector dùng được', sel);

        env.X.S.cfg.bindFinal = sel;
        const f = env.X.readForm(env.X.findOrderFormRoot());
        eq(f.finalPrice, 300000, '3.6: dùng ô Thành tiền được chỉ định');
        env.X.S.cfg.bindFinal = '';

        // chỉ định ô Giảm giá bằng phần tử bất kỳ
        const inp = env.doc.querySelector('input.ant-input-number-input');
        env.X.S.cfg.bindDiscount = env.X.cssPath(inp);
        const f2 = env.X.readForm(env.X.findOrderFormRoot());
        check(!!(f2.discount && f2.discount.input === inp), '3.6: dùng ô Giảm giá được chỉ định');
        env.X.S.cfg.bindDiscount = '';
    }

    // ---------- 3.7 chưa mở form → báo rõ ----------
    {
        const env = boot(CHAT);
        env.advance(6);
        eq(env.X.S.status.code, 'idle', '3.7: báo "chưa mở form đơn"');
        check(env.X.S.status.text.length > 0, '3.7: có chữ trạng thái');
        const report = env.X.diagnose();
        check(/KHUNG ĐƠN/.test(report) && /CHAT/.test(report), '3.7: bảng chẩn đoán chạy được');
        check(/CÁC DÒNG TIỀN|.text-final-price/.test(report) === false ||
            /— .text-final-price toàn trang:/.test(report),
            '3.7: chẩn đoán in được danh sách .text-final-price');
    }
}


// =====================================================================
// CHẠY
// =====================================================================

testParsing();
testController();
testForms();

console.log('');
if (failures.length) {
    console.log('--- ' + fail + ' FAIL ---');
    failures.forEach(f => console.log('  ✗ ' + f));
}
console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
