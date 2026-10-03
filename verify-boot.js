/*
 * verify-boot.js — chạy THẬT file userscript trong jsdom với DOM mô phỏng
 * Pancake, để chắc chắn: script khởi động được, và vòng lặp chỉ click đúng
 * các row thuộc dãy (không click row khác snippet).
 *
 * Cần jsdom (không nằm trong repo):
 *     npm install jsdom
 *     node verify-boot.js
 */
'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(__dirname + '/pancake-auto-upsale-v6.user.js', 'utf8');

const WIN = 5;                 // số row đang render
const S = 'Chị cho em xin chiều cao + cân nặng em chọn size phù hợp cho ...';
const OTHER = 'Xin giá';
const REPLY = 'DẠ EM ĐÃ TRẢ LỜI Ạ';

/* ---- Mô hình dữ liệu: đúng thứ tự Pancake hiển thị ---- */
/* ID thật của Pancake có dạng {pageId}_{peerId} — regex của script bắt buộc
   đúng dạng này, nên test phải dùng ID số thật (như trong html.txt/html3.txt). */
const PAGE = '764740356715221';
let list = [
    { id: PAGE + '_1111', snippet: OTHER, seen: false, ts: 100, ten: 'o_1' },
    { id: PAGE + '_2222', snippet: S,     seen: false, ts: 99,  ten: 'R1' },
    { id: PAGE + '_3333', snippet: S,     seen: false, ts: 98,  ten: 'R2' },
    { id: PAGE + '_4444', snippet: S,     seen: false, ts: 97,  ten: 'R3' },
    { id: PAGE + '_5555', snippet: S,     seen: false, ts: 96,  ten: 'R4' },
    { id: PAGE + '_6666', snippet: OTHER, seen: true,  ts: 90,  ten: 'e_1' },
    { id: PAGE + '_7777', snippet: OTHER, seen: true,  ts: 80,  ten: 'e_2' }
];
let clockTick = 1000;

const dom = new JSDOM(`<!doctype html><html><body>
  <div class="conversation-list">
    <div class="rc-virtual-list infinite-conv-list" id="conversationList" width="310">
      <div class="rc-virtual-list-holder" style="height: 300px; overflow-y: hidden;">
        <div style="height: 4000px; position: relative; overflow: hidden;">
          <div class="rc-virtual-list-holder-inner" style="display:flex;flex-direction:column"></div>
        </div>
      </div>
    </div>
  </div>
  <div id="reply_box">
    <div class="reply-box-container">
      <div class="reply-box__text-area">
        <textarea id="replyBoxComposer" placeholder="Trả lời từ Shop"></textarea>
      </div>
    </div>
  </div>
</body></html>`, {
    url: 'https://pancake.vn/multi_pages',
    runScripts: 'outside-only',
    pretendToBeVisual: true
});

const win = dom.window;
const doc = win.document;

/* ---- Render cửa sổ danh sách (mốc cuộn cố định = 0, đúng như thực tế:
        holder có overflow-anchor:none nên cửa sổ là slice cố định) ---- */
function render() {
    const inner = doc.querySelector('.rc-virtual-list-holder-inner');
    inner.innerHTML = '';
    list.slice(0, WIN).forEach((c, i) => {
        const wrap = doc.createElement('div');
        wrap.setAttribute('offsetx', '0');
        wrap.id = c.id;
        wrap.innerHTML =
            `<div class="media conversation-list-item" id="${c.id}__${i}">
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
        row.getBoundingClientRect = () => ({
            top: i * 40, bottom: i * 40 + 40, left: 0, right: 300, width: 300, height: 40, x: 0, y: i * 40
        });
    });
}

/* ---- elementFromPoint giả: dùng đúng toạ độ đã gán ở trên ---- */
const rowsNow = () => [...doc.querySelectorAll('.conversation-list-item')];
doc.elementFromPoint = (x, y) => {
    const row = rowsNow().find(r => {
        const b = r.getBoundingClientRect();
        return y >= b.top && y < b.bottom && x >= b.left && x < b.right;
    });
    return row ? row.querySelector('.snippet-text') : null;
};

render();

/* ---- localStorage: đặt sẵn dấu đỏ + nội dung gửi ---- */
win.localStorage.setItem('pancake_auto_pos_v7', JSON.stringify({ x: 10, y: 20 }));   // row R1 (index 1 → y 40..80)? dùng y=20 ⇒ o_1
win.localStorage.setItem('pancake_auto_pos_v7', JSON.stringify({ x: 10, y: 60 }));   // y 60 ⇒ row index 1 = R1
win.localStorage.setItem('pancake_auto_ui_v7', JSON.stringify({ text: 'DẠ EM CẢM ƠN CHỊ Ạ', autoEnter: true }));

/* ---- Ghi nhận mọi row bị click + mô phỏng Pancake gửi tin ---- */
const clicked = [];
let lastClickedId = '';
doc.addEventListener('click', ev => {
    const row = ev.target.closest ? ev.target.closest('.conversation-list-item') : null;
    if (row) {
        const rid = row.id.replace(/__\d+$/, '');
        const c = list.find(x => x.id === rid);
        clicked.push(c ? c.ten : rid);
        lastClickedId = rid;
    }
}, true);

const composer = doc.getElementById('replyBoxComposer');
composer.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    // Mô phỏng Pancake: gửi xong ⇒ composer rỗng, hội thoại seen=true + đổi snippet
    setTimeout(() => {
        const value = composer.value;
        const nativeSet = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
        nativeSet.call(composer, '');
        composer.dispatchEvent(new win.Event('input', { bubbles: true }));

        // tìm hội thoại đang mở (mô phỏng: row đang có class selected? → dùng row vừa click)
        const last = lastClickedId;
        const idx = list.findIndex(c => c.id === last);
        if (idx < 0) return;
        const [conv] = list.splice(idx, 1);
        conv.snippet = value || REPLY;
        conv.seen = true;
        conv.ts = ++clockTick;
        let at = list.findIndex(c => c.seen);
        if (at < 0) at = list.length;
        list.splice(at, 0, conv);
        render();
    }, 0);
});

/* ---- Chạy userscript ---- */
win.eval(SRC);

const panel = doc.getElementById('pk-panel');
if (!panel) throw new Error('❌ Panel không được tạo');
console.log('✅ Script khởi động, panel đã tạo');

/* ---- Bấm Bắt đầu ---- */
doc.getElementById('pk-run').click();

/* ---- Chờ tới khi dừng ---- */
const started = Date.now();
const timer = setInterval(() => {
    const status = doc.getElementById('pk-status').textContent;
    const elapsed = Date.now() - started;
    if (status.includes('✅') || status.includes('⚠') && status.includes('Hết dãy') || elapsed > 20000) {
        clearInterval(timer);
        finish(status, elapsed);
    }
}, 100);

function finish(status, elapsed) {
    const expected = ['R1', 'R2', 'R3', 'R4'];
    const okClicks = JSON.stringify(clicked) === JSON.stringify(expected);
    console.log(`${okClicks ? '✅' : '❌'} Row đã click (${clicked.length}): ${clicked.join(', ')}`);
    console.log(`     mong đợi (${expected.length}): ${expected.join(', ')}`);
    console.log(`     trạng thái panel: ${JSON.stringify(status)}`);
    console.log(`     thời gian chạy: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`     dãy hiển thị: ${doc.getElementById('pk-run-info').textContent}`);
    if (!okClicks) { console.log('❌ SAI — có row ngoài dãy bị click'); process.exit(1); }
    if (!status.includes('Hết dãy')) { console.log('❌ Không dừng đúng thông báo "Hết dãy"'); process.exit(1); }
    console.log('TẤT CẢ ĐỀU ĐÚNG.');
    process.exit(0);
}
