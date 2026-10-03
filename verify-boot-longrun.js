/*
 * verify-boot-longrun.js — chạy THẬT file userscript trong jsdom (chế độ DÃY)
 * cho các ca "dãy quá dài / nằm sát đầu hoặc cuối danh sách":
 *
 *   A. Dãy 30 khách, chỉ thấy 8 row ⇒ Pancake tự xếp lại và kéo khách kế lên;
 *      dãy kết thúc ngay ĐÁY danh sách (không thể cuộn thêm).
 *   B. Dấu đỏ nằm GIỮA dãy, phần đầu dãy nằm TRÊN tầm nhìn (danh sách đang cuộn
 *      ở giữa) ⇒ script phải tự cuộn LÊN tìm đầu dãy rồi gửi đủ.
 *   C. Pancake KHÔNG xếp lại danh sách sau khi gửi (mạng chậm) ⇒ script phải
 *      dừng đúng chỗ, KHÔNG gửi sang row ngoài dãy, và CẢNH BÁO rõ ràng.
 *
 * Cần jsdom (không nằm trong repo):
 *     npm install jsdom
 *     node verify-boot-longrun.js
 */
'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(__dirname + '/pancake-auto-upsale-v6.user.js', 'utf8');

const ROW_H = 40;
const VISIBLE = 6;
const OVERSCAN = 2;
const HOLDER_TOP = 100;
const LIST_W = 300;
const PAGE = '764740356715221';
const S = 'Chị cho em xin chiều cao + cân nặng em chọn size phù hợp cho ...';
const OTHER = 'Xin giá';
const REPLY = 'DẠ EM CẢM ƠN CHỊ Ạ';

const rect = (top, bottom) => ({
    top, bottom, height: bottom - top, left: 0, right: LIST_W, width: LIST_W, x: 0, y: top
});

function scenario(name, opts) {
    const { rows, dotIndex, reorder, startOffset, expected, expectStatus, expectWarn } = opts;

    let list = rows.map(r => ({ ...r }));
    let clock = 5000;
    let offset = startOffset || 0;
    let wheelCount = 0;
    const clicked = [];
    const warns = [];
    let lastClickedId = '';

    const sortList = () => {
        list.sort((a, b) =>
            (a.pinned ? 0 : 1) - (b.pinned ? 0 : 1) ||
            (a.unread ? 0 : 1) - (b.unread ? 0 : 1) ||
            b.ts - a.ts);
    };
    sortList();

    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="conversation-list">
        <div class="rc-virtual-list infinite-conv-list" id="conversationList" width="310" style="position:relative">
          <div class="rc-virtual-list-holder" style="height:${VISIBLE * ROW_H}px;overflow-y:hidden;overflow-anchor:none">
            <div style="height:${list.length * ROW_H}px;position:relative;overflow:hidden">
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

    /* Ghi lại console.warn của script (để kiểm tra cảnh báo "dãy bị cắt") */
    win.console.warn = (...args) => warns.push(args.map(String).join(' '));

    const listEl = doc.getElementById('conversationList');
    const holder = doc.querySelector('.rc-virtual-list-holder');
    const inner = doc.querySelector('.rc-virtual-list-holder-inner');
    const composer = doc.getElementById('replyBoxComposer');

    holder.getBoundingClientRect = () => rect(HOLDER_TOP, HOLDER_TOP + VISIBLE * ROW_H);
    listEl.getBoundingClientRect = () => rect(HOLDER_TOP, HOLDER_TOP + VISIBLE * ROW_H);

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
                       <div class="snippet-text">${c.snippet}</div>
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

    render();

    doc.elementFromPoint = (x, y) => {
        const rowsNow = [...doc.querySelectorAll('.conversation-list-item')];
        const row = rowsNow.find(r => {
            const b = r.getBoundingClientRect();
            return y >= b.top && y < b.bottom && x >= b.left && x < b.right;
        });
        return row ? row.querySelector('.snippet-text') : null;
    };

    /* Pancake cuộn bằng wheel → đổi translateY (overflow-y:hidden, không scrollTop) */
    holder.addEventListener('wheel', ev => {
        wheelCount++;
        const max = Math.max(0, list.length * ROW_H - VISIBLE * ROW_H);
        offset = Math.max(0, Math.min(max, offset + (ev.deltaY || 0)));
        render();
        ev.preventDefault();
    });

    doc.addEventListener('click', ev => {
        const row = ev.target.closest ? ev.target.closest('.conversation-list-item') : null;
        if (!row) return;
        const rid = row.id.replace(/__\d+$/, '');
        const c = list.find(x => x.id === rid);
        clicked.push(c ? c.ten : rid);
        lastClickedId = rid;
    }, true);

    composer.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        setTimeout(() => {
            const value = composer.value;
            const nativeSet = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
            nativeSet.call(composer, '');
            composer.dispatchEvent(new win.Event('input', { bubbles: true }));

            const c = list.find(x => x.id === lastClickedId);
            if (!c) return;
            c.snippet = value || REPLY;   // hội thoại mang snippet mới = tin vừa gửi
            c.unread = false;
            c.ts = ++clock;
            if (reorder) sortList();      // Pancake xếp lại danh sách (eg/ev trong bundle)
            render();
        }, 0);
    });

    const dotY = HOLDER_TOP + (dotIndex * ROW_H - offset) + ROW_H / 2;
    win.localStorage.setItem('pancake_auto_pos_v7', JSON.stringify({ x: 20, y: dotY }));
    win.localStorage.setItem('pancake_auto_ui_v7', JSON.stringify({ text: REPLY, autoEnter: true, mode: 'run' }));
    win.localStorage.setItem('pancake_auto_speed_v7', JSON.stringify({ confirm: 'off' }));

    win.eval(SRC);
    if (!doc.getElementById('pk-panel')) throw new Error(`${name}: panel không được tạo`);
    doc.getElementById('pk-run').click();

    return new Promise(resolve => {
        const started = Date.now();
        const timer = setInterval(() => {
            const status = doc.getElementById('pk-status').textContent;
            const running = doc.getElementById('pk-run').textContent.includes('Dừng');
            const elapsed = Date.now() - started;
            if ((!running && status && status !== 'Sẵn sàng') || elapsed > 60000) {
                clearInterval(timer);
                const got = clicked.join(', ');
                const want = expected.join(', ');
                const okList = got === want;
                const okStatus = status.includes(expectStatus);
                const warned = warns.some(w => w.includes('KHÔNG thuộc dãy'));
                const okWarn = expectWarn === undefined ? true : warned === expectWarn;

                console.log(`\n=== ${name} ===`);
                console.log(`${okList ? '✅' : '❌'} Đã gửi (${clicked.length}/${expected.length}): ${got || '(không gửi ai)'}`);
                if (!okList) console.log(`            mong đợi: ${want}`);
                console.log(`${okStatus ? '✅' : '❌'} Thông báo dừng: ${JSON.stringify(status)}`);
                console.log(`${okWarn ? '✅' : '❌'} Cảnh báo "dãy có thể bị cắt": ${warned} (mong đợi: ${expectWarn === undefined ? 'không xét' : expectWarn})`);
                console.log(`     số nhịp cuộn: ${wheelCount} · panel: ${doc.getElementById('pk-run-info').textContent}`);
                if (!okList || !okStatus || !okWarn) {
                    console.log(`❌ ${name} SAI`);
                    process.exitCode = 1;
                }
                resolve();
            }
        }, 50);
    });
}

const conv = (ten, snippet) => ({
    id: `${PAGE}_${1000 + conv.n++}`, snippet, unread: true, ts: conv.ts--, ten, pinned: false
});
conv.n = 1;
conv.ts = 4000;

const mk = (n, prefix) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(conv(`${prefix}${i + 1}`, S));
    return out;
};

(async () => {
    /* A — dãy 30 khách, chỉ thấy 8 row, dãy kết thúc ở ĐÁY danh sách.
           Pancake xếp lại sau mỗi tin nên khách kế tự trôi lên; hết dãy thì
           script phải tự thử cuộn, thấy đã ở đáy ⇒ dừng "Hết dãy". */
    const a = mk(30, 'M');
    await scenario('A · dãy 30 khách, kết thúc ở đáy danh sách', {
        rows: [{ ...conv('X', OTHER), unread: false, pinned: true, ts: 9000 }, ...a],
        dotIndex: 1,                 // dấu đỏ ở khách đầu dãy
        reorder: true,
        expected: a.map(c => c.ten),
        expectStatus: 'Hết dãy'
    });

    /* B — dấu đỏ GIỮA dãy, đầu dãy nằm TRÊN tầm nhìn (danh sách đang cuộn ở giữa).
           Script phải tự cuộn LÊN tìm đầu dãy rồi gửi đủ 20 khách. */
    const b = mk(20, 'N');
    await scenario('B · đầu dãy nằm trên tầm nhìn — tự cuộn lên', {
        rows: [{ ...conv('X', OTHER), unread: false, pinned: true, ts: 9000 }, ...b],
        dotIndex: 11,                // dấu đỏ ở giữa dãy (N11)
        reorder: true,
        startOffset: 6 * ROW_H,      // danh sách đang cuộn ở giữa
        expected: b.map(c => c.ten),
        expectStatus: 'Hết dãy'
    });

    /* C — Pancake KHÔNG xếp lại danh sách (mạng chậm): khách vừa gửi vẫn nằm chỗ
           cũ nên không nối được sang row dưới. Script phải dừng đúng chỗ, không
           gửi ra ngoài dãy, và CẢNH BÁO để người dùng kiểm tra tay. */
    const c = mk(14, 'P');
    await scenario('C · Pancake không xếp lại — dừng + cảnh báo (không gửi bừa)', {
        rows: [{ ...conv('X', OTHER), unread: false, pinned: true, ts: 9000 }, ...c],
        dotIndex: 1,
        reorder: false,
        expected: c.slice(0, 7).map(x => x.ten),   // 7 khách đang thấy (P8 ngoài cửa sổ render)
        expectStatus: 'Hết dãy',
        expectWarn: true
    });

    if (!process.exitCode) console.log('\nTẤT CẢ KỊCH BẢN ĐỀU ĐÚNG.');
})();
