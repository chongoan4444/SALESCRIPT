/*
 * verify-boot-below.js — chạy THẬT file userscript trong jsdom, giả lập Pancake
 * để kiểm chứng CHẾ ĐỘ "GỬI HẾT KHÁCH BÊN DƯỚI":
 *   • chỉ gửi khách còn class `unread` (khách đã trả lời) nằm TỪ DẤU ĐỎ trở xuống
 *   • KHÔNG gửi khách nằm trên dấu đỏ (kể cả khách chưa trả lời ở trên)
 *   • cuộn danh sách bằng sự kiện `wheel` (Pancake không cuộn bằng scrollTop)
 *   • dừng khi gặp hội thoại ĐÃ ĐỌC đầu tiên bên dưới dấu đỏ
 *   • cuộn không được nữa ⇒ dừng "Hết danh sách"
 *
 * Cần jsdom (không nằm trong repo):
 *     npm install jsdom
 *     node verify-boot-below.js
 */
'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(__dirname + '/pancake-auto-upsale-v6.user.js', 'utf8');

const ROW_H = 40;         // chiều cao 1 row trong bài test
const VISIBLE = 6;        // số row trong vùng nhìn
const OVERSCAN = 2;       // rc-virtual-list render thêm vài row ngoài vùng nhìn
const HOLDER_TOP = 100;   // toạ độ y của mép trên danh sách
const LIST_W = 300;
const PAGE = '764740356715221';
const TEXT = 'DẠ EM CẢM ƠN CHỊ Ạ';

const rect = (top, bottom) => ({
    top, bottom, height: bottom - top, left: 0, right: LIST_W, width: LIST_W, x: 0, y: top
});

function scenario(name, opts) {
    const { rows, dotIndex, reorder, expected, expectStatus, scrollable = true } = opts;

    let list = rows.map(r => ({ ...r }));
    let clock = 2000;
    let offset = 0;
    let wheelCount = 0;
    const clicked = [];
    let lastClickedId = '';

    const sortList = () => {
        list.sort((a, b) =>
            (a.pinned ? 0 : 1) - (b.pinned ? 0 : 1) ||
            (a.unread ? 0 : 1) - (b.unread ? 0 : 1) ||
            b.ts - a.ts);
    };
    sortList();

    const total = () => list.length * ROW_H;

    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="conversation-list">
        <div class="rc-virtual-list infinite-conv-list" id="conversationList" width="310" style="position:relative">
          <div class="rc-virtual-list-holder" style="height:${VISIBLE * ROW_H}px;overflow-y:hidden;overflow-anchor:none">
            <div style="height:${total()}px;position:relative;overflow:hidden">
              <div class="rc-virtual-list-holder-inner"
                   style="display:flex;flex-direction:column;position:absolute;left:0;right:0;top:0;transform:translateY(0px)"></div>
            </div>
          </div>
        </div>
      </div>
      <div id="pageCustomer"><div class="restrict-customer-name-length">
        <span class="copyable-text customer-name normal-customer-name">Khách test</span></div></div>
      <div id="reply_box"><div class="reply-box-container"><div class="reply-box__text-area">
        <textarea id="replyBoxComposer" placeholder="Trả lời từ Shop"></textarea></div></div></div>
    </body></html>`, {
        url: 'https://pancake.vn/multi_pages',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });

    const win = dom.window;
    const doc = win.document;

    const listEl = doc.getElementById('conversationList');
    const holder = doc.querySelector('.rc-virtual-list-holder');
    const inner = doc.querySelector('.rc-virtual-list-holder-inner');
    const composer = doc.getElementById('replyBoxComposer');

    holder.getBoundingClientRect = () => rect(HOLDER_TOP, HOLDER_TOP + VISIBLE * ROW_H);
    listEl.getBoundingClientRect = () => rect(HOLDER_TOP, HOLDER_TOP + VISIBLE * ROW_H);

    /* ---- Render cửa sổ ảo hoá: cắt `list` theo offset, đúng như Pancake ---- */
    function render() {
        inner.innerHTML = '';
        const start = Math.max(0, Math.floor(offset / ROW_H));
        const end = Math.min(list.length, start + VISIBLE + OVERSCAN);
        for (let i = start; i < end; i++) {
            const c = list[i];
            const wrap = doc.createElement('div');
            wrap.setAttribute('offsetx', '0');
            wrap.id = c.id;
            wrap.innerHTML =
                `<div class="media conversation-list-item${c.unread ? ' unread' : ''}" id="${c.id}__${i}">
                   <div class="media-left render-avatar-cus"></div>
                   <div class="media-body body-conver-item">
                     <div class="name-module platform-facebook">
                       <span class="name-module-text"><span class="name-text">Khách ${c.ten}</span></span>
                       <span class="time-modul">12:00</span>
                     </div>
                     <div class="snippet-wrap"><div class="snippet-line">
                       <div class="snippet-text">${c.snippet || 'Tin nhắn'}</div>
                     </div></div>
                   </div>
                 </div>`;
            inner.appendChild(wrap);

            const row = wrap.firstElementChild;
            const top = HOLDER_TOP + i * ROW_H - offset;
            row.getBoundingClientRect = () => rect(top, top + ROW_H);
        }
        inner.style.transform = `translateY(${offset}px)`;
    }

    render();   // vẽ cửa sổ danh sách lần đầu (offset 0)

    /* ---- elementFromPoint giả ---- */
    doc.elementFromPoint = (x, y) => {
        const rowsNow = [...doc.querySelectorAll('.conversation-list-item')];
        const row = rowsNow.find(r => {
            const b = r.getBoundingClientRect();
            return y >= b.top && y < b.bottom && x >= b.left && x < b.right;
        });
        return row ? row.querySelector('.snippet-text') : null;
    };

    /* ---- Cuộn: Pancake nghe wheel trên holder rồi cập nhật translateY ---- */
    holder.addEventListener('wheel', ev => {
        wheelCount++;
        if (!scrollable) { ev.preventDefault(); return; }   // giả lập app không cuộn được
        const max = Math.max(0, total() - VISIBLE * ROW_H);
        offset = Math.max(0, Math.min(max, offset + (ev.deltaY || 0)));
        render();
        ev.preventDefault();
    });

    /* ---- Ghi nhận click ---- */
    doc.addEventListener('click', ev => {
        const row = ev.target.closest ? ev.target.closest('.conversation-list-item') : null;
        if (!row) return;
        const rid = row.id.replace(/__\d+$/, '');
        const c = list.find(x => x.id === rid);
        clicked.push(c ? c.ten : rid);
        lastClickedId = rid;
    }, true);

    /* ---- Mô phỏng Pancake gửi tin khi bấm Enter ---- */
    composer.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        setTimeout(() => {
            const value = composer.value;
            const nativeSet = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
            nativeSet.call(composer, '');
            composer.dispatchEvent(new win.Event('input', { bubbles: true }));

            const c = list.find(x => x.id === lastClickedId);
            if (!c) return;
            c.unread = false;                 // đã trả lời khách
            c.ts = ++clock;                   // updated_at = now
            if (reorder) sortList();          // Pancake xếp lại (eg/ev trong bundle)
            render();
        }, 0);
    });

    /* ---- Dấu đỏ + nội dung gửi ---- */
    const dotY = HOLDER_TOP + dotIndex * ROW_H + ROW_H / 2;
    win.localStorage.setItem('pancake_auto_pos_v7', JSON.stringify({ x: 20, y: dotY }));
    win.localStorage.setItem('pancake_auto_ui_v7', JSON.stringify({ text: TEXT, autoEnter: true, mode: 'below' }));
    win.localStorage.setItem('pancake_auto_speed_v7', JSON.stringify({ confirm: 'off' }));

    /* ---- Chạy userscript ---- */
    win.eval(SRC);
    if (!doc.getElementById('pk-panel')) throw new Error(`${name}: panel không được tạo`);

    doc.getElementById('pk-run').click();

    return new Promise(resolve => {
        const started = Date.now();
        const timer = setInterval(() => {
            const status = doc.getElementById('pk-status').textContent;
            const running = doc.getElementById('pk-run').textContent.includes('Dừng');
            const elapsed = Date.now() - started;
            if (!running && status && status !== 'Sẵn sàng' || elapsed > 30000) {
                clearInterval(timer);
                const info = doc.getElementById('pk-run-info').textContent;
                const order = list.map(c => c.ten).join(' ');
                const got = clicked.join(', ');
                const want = expected.join(', ');
                const okList = got === want;
                const okStatus = status.includes(expectStatus);
                const okWheel = wheelCount > 0;

                console.log(`\n=== ${name} ===`);
                console.log(`${okList ? '✅' : '❌'} Đã gửi (${clicked.length}): ${got || '(không gửi ai)'}`);
                console.log(`            mong đợi  : ${want}`);
                console.log(`${okStatus ? '✅' : '❌'} Thông báo dừng: ${JSON.stringify(status)}`);
                console.log(`            mong đợi   : ${JSON.stringify(expectStatus)}`);
                console.log(`${okWheel ? '✅' : '❌'} Số lần cuộn (wheel): ${wheelCount}`);
                console.log(`     panel: ${info}`);
                console.log(`     thứ tự danh sách sau khi chạy: ${order}`);
                if (!okList || !okStatus || !okWheel) {
                    console.log(`❌ ${name} SAI`);
                    process.exitCode = 1;
                }
                resolve();
            }
        }, 50);
    });
}

/* =========================================================
 * DỰNG DỮ LIỆU
 * =======================================================*/
const conv = (ten, unread, ts, pinned) => ({
    id: `${PAGE}_${1000 + conv.n++}`, unread, ts, pinned: !!pinned, ten, snippet: 'Tin nhắn'
});
conv.n = 1;

const mk = (n, unread, ts0, prefix) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(conv(`${prefix}${i + 1}`, unread, ts0 - i));
    return out;
};

(async () => {
    /* A — Pancake xếp lại như thật: khách vừa gửi bị đẩy xuống khối "đã đọc",
           các khách chưa trả lời còn lại trôi lên vị trí dấu đỏ.
       Dấu đỏ đặt ngay khách chưa trả lời đầu tiên. */
    await scenario('A · xếp lại danh sách (thực tế) — gửi hết 10 khách chưa trả lời', {
        rows: [
            conv('P1', false, 900, true),      // ghim, đã đọc — TRÊN dấu đỏ, không được gửi
            ...mk(10, true, 800, 'U'),         // U1…U10 chưa trả lời
            ...mk(4, false, 100, 'S')          // S1…S4 đã đọc
        ],
        dotIndex: 1,                            // dấu đỏ ngay U1
        reorder: true,
        expected: ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8', 'U9', 'U10'],
        expectStatus: 'Hết khách đã trả lời'
    });

    /* B — Danh sách KHÔNG tự xếp lại khi gửi (mạng chậm/Pancake đứng):
           dấu đỏ nằm giữa khối, khách chưa trả lời ở TRÊN dấu đỏ phải bị bỏ qua,
           phần còn lại phải cuộn xuống mới tới ⇒ kiểm chứng cả đường cuộn. */
    await scenario('B · không xếp lại — bỏ qua khách ở trên, tự cuộn tới hết khối', {
        rows: [
            conv('P1', false, 900, true),      // ghim, đã đọc
            ...mk(8, true, 800, 'U'),          // U1…U8 chưa trả lời
            ...mk(3, false, 100, 'S')          // S1…S3 đã đọc
        ],
        dotIndex: 3,                            // dấu đỏ ở U3 ⇒ U1, U2 nằm TRÊN dấu đỏ
        reorder: false,
        expected: ['U3', 'U4', 'U5', 'U6', 'U7', 'U8'],
        expectStatus: 'Hết khách đã trả lời'
    });

    /* C — Danh sách KHÔNG cuộn được (hết dữ liệu / app chặn): gửi hết phần
           đang thấy rồi phải dừng bằng thông báo "Hết danh sách", không treo. */
    await scenario('C · không cuộn được — dừng "Hết danh sách"', {
        rows: [
            conv('P1', false, 900, true),
            ...mk(5, true, 800, 'U')
        ],
        dotIndex: 2,                            // dấu đỏ ở U2 ⇒ U1 nằm TRÊN dấu đỏ
        reorder: true,
        scrollable: false,
        expected: ['U2', 'U3', 'U4', 'U5'],
        expectStatus: 'Hết danh sách'
    });

    if (!process.exitCode) console.log('\nTẤT CẢ KỊCH BẢN ĐỀU ĐÚNG.');
})();
