/*
 * verify-boot-v525.js — chạy THẬT pancake-auto-upsale-v5.25.user.js trong jsdom,
 * với danh sách MÔ PHỎNG ĐÚNG hành vi Pancake: sau mỗi tin gửi, hội thoại vừa
 * gửi bị rút khỏi chỗ cũ và chèn lên ĐẦU NHÓM (source: eg()/ev() trong
 * _app-9331d46f21a84eb1.v6.js), còn danh sách thì giữ nguyên offset pixel
 * (virtual list) ⇒ mọi row phía trên bị đẩy xuống 1 dòng, dấu đỏ trỏ sang
 * hội thoại ở trên.
 *
 * Mục tiêu:
 *   A. pinView = ON  → mỗi khách được click ĐÚNG lúc nó nằm dưới dấu đỏ
 *                      (script cuộn bù đúng phần bị Pancake đẩy).
 *   B. pinView = OFF → vẫn gửi đúng khách nhưng dấu đỏ TRÔI (đây là lỗi
 *                      người dùng báo: "chấm đỏ cứ bị đẩy di chuyển đi").
 *   C. Cả hai: chỉ gửi 6 khách cùng snippet, không click khách lạ, dừng ở
 *      khách đầu tiên khác snippet.
 *
 * Chạy:  NODE_PATH=/tmp/boottest/node_modules node verify-boot-v525.js
 */
'use strict';

const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync(__dirname + '/pancake-auto-upsale-v5.25.user.js', 'utf8');

const ROW_H = 40;
const HOLDER_H = 320;
const OVERSCAN = 2;
const DOT = { x: 10, y: 60 };     // tâm row index 1
const S = 'Chị cho em xin chiều cao + cân nặng em chọn size phù hợp cho ...';
const OTHER = 'Xin giá';
const PAGE = '764740356715221';

function makeList(extra = 17) {
    const list = [];
    list.push({ id: PAGE + '_9000', snippet: OTHER, seen: true, ts: 100000, ten: 'o1' });
    for (let i = 1; i <= 6; i++) {
        list.push({ id: PAGE + '_700' + i, snippet: S, seen: true, ts: 100000 - i, ten: 't' + i });
    }
    for (let i = 1; i <= extra; i++) {
        const n = String(i).padStart(2, '0');
        list.push({ id: PAGE + '_80' + n, snippet: OTHER, seen: true, ts: 90000 - i, ten: 'x' + i });
    }
    return list;
}

function runScenario(pinView, opts = {}) {
    const extra = opts.extra === undefined ? 17 : opts.extra;
    const H = opts.holderH === undefined ? HOLDER_H : opts.holderH;
    return new Promise(resolve => {
        const list = makeList(extra);
        let clock = 100000;
        let offset = 0;
        let opened = '';
        const clicked = [];
        const dotAtClick = [];
        let wheelTotal = 0;
        let pinLogs = 0;
        const expected = list.filter(c => c.snippet === S).map(c => c.ten);

        const dom = new JSDOM(`<!doctype html><html><body>
          <div class="conversation-list">
            <div class="rc-virtual-list infinite-conv-list" id="conversationList" width="310">
              <div class="rc-virtual-list-holder" style="height:${H}px; overflow-y: hidden;">
                <div style="height: ${list.length * ROW_H}px; position: relative; overflow: hidden;">
                  <div class="rc-virtual-list-holder-inner" style="display:flex;flex-direction:column"></div>
                </div>
              </div>
            </div>
          </div>
          <div id="reply_box"><div class="reply-box-container"><div class="reply-box__text-area">
            <textarea id="replyBoxComposer" placeholder="Trả lời từ Shop"></textarea>
          </div></div></div>
        </body></html>`, {
            url: 'https://pancake.vn/multi_pages',
            runScripts: 'outside-only',
            pretendToBeVisual: true
        });

        const win = dom.window;
        const doc = win.document;
        const inner = doc.querySelector('.rc-virtual-list-holder-inner');
        const holder = doc.querySelector('.rc-virtual-list-holder');

        /* ---------- render cửa sổ ảo hoá ---------- */
        function render() {
            inner.innerHTML = '';
            inner.style.transform = `translateY(${-offset}px)`;
            const first = Math.max(0, Math.floor(offset / ROW_H) - OVERSCAN);
            const last = Math.min(list.length - 1, Math.floor((offset + H) / ROW_H) + OVERSCAN);
            for (let i = first; i <= last; i++) {
                const c = list[i];
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
                const top = i * ROW_H - offset;
                row.getBoundingClientRect = () => ({
                    top, bottom: top + ROW_H, left: 0, right: 300,
                    width: 300, height: ROW_H, x: 0, y: top
                });
            }
        }

        const rowsNow = () => [...doc.querySelectorAll('.conversation-list-item')];
        const rowAt = (x, y) => rowsNow().find(r => {
            const b = r.getBoundingClientRect();
            return y >= b.top && y < b.bottom && x >= b.left && x < b.right;
        }) || null;
        const nameOf = row => {
            if (!row) return '(ngoài danh sách)';
            const id = row.id.replace(/__\d+$/, '');
            const c = list.find(v => v.id === id);
            return c ? c.ten : id;
        };

        doc.elementFromPoint = (x, y) => {
            const row = rowAt(x, y);
            return row ? row.querySelector('.snippet-text') : null;
        };

        /* ---------- Pancake: wheel để cuộn (list là virtual, offset tuyệt đối) ---------- */
        holder.addEventListener('wheel', ev => {
            const max = Math.max(0, list.length * ROW_H - H);
            const next = Math.max(0, Math.min(max, offset + ev.deltaY));
            wheelTotal += Math.abs(next - offset);
            if (next !== offset) { offset = next; render(); }
        });

        /* ---------- mở hội thoại + gửi tin ---------- */
        doc.addEventListener('click', ev => {
            const row = ev.target.closest ? ev.target.closest('.conversation-list-item') : null;
            if (!row) return;
            opened = row.id.replace(/__\d+$/, '');
            clicked.push(nameOf(row));
            dotAtClick.push(nameOf(rowAt(DOT.x, DOT.y)));
        }, true);

        const composer = doc.getElementById('replyBoxComposer');
        composer.addEventListener('keydown', ev => {
            if (ev.key !== 'Enter') return;
            setTimeout(() => {
                const nativeSet = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
                nativeSet.call(composer, '');
                composer.dispatchEvent(new win.Event('input', { bubbles: true }));

                const idx = list.findIndex(c => c.id === opened);
                if (idx < 0) return;
                const [conv] = list.splice(idx, 1);
                conv.seen = true;
                conv.ts = ++clock;          // vừa gửi ⇒ mới nhất
                list.splice(0, 0, conv);    // ⇒ nhảy lên ĐẦU nhóm (trên khung nhìn)
                render();                   // offset KHÔNG đổi — đúng như app
            }, 0);
        });

        /* ---------- chạy userscript ---------- */
        win.localStorage.setItem('pancake_auto_pos_v7', JSON.stringify(DOT));
        win.localStorage.setItem('pancake_auto_ui_v7', JSON.stringify({
            text: 'DẠ EM CẢM ƠN CHỊ Ạ', autoEnter: true, scanEnabled: true, pinView
        }));

        const origInfo = win.console.info;
        win.console.info = (...a) => {
            const s = a.join(' ');
            if (s.includes('Pancake xếp lại danh sách')) pinLogs++;
            if (process.env.VERBOSE) origInfo(...a);
        };
        win.console.warn = () => {};

        render();
        win.eval(SRC);

        doc.getElementById('pk-run').click();

        const t0 = Date.now();
        const timer = setInterval(() => {
            const status = doc.getElementById('pk-status').textContent;
            const done = status.includes('trùng mẫu') || status.includes('🛑') || Date.now() - t0 > 20000;
            if (!done) return;
            clearInterval(timer);
            resolve({ pinView, clicked, dotAtClick, expected, status, wheelTotal, pinLogs, elapsed: Date.now() - t0 });
        }, 50);
    });
}

(async () => {
    let fails = 0;
    const check = (ok, label, extra = '') => {
        console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
        if (!ok) fails++;
    };

    /* ---------- A: pinView ON ---------- */
    console.log('=== A. Ghim khung ON (mặc định) ===');
    const a = await runScenario(true);
    check(JSON.stringify(a.clicked) === JSON.stringify(a.expected),
        'chỉ gửi đúng 6 khách cùng snippet', a.clicked.join(', '));
    check(a.clicked.every((n, i) => a.dotAtClick[i] === n),
        'khách được click LUÔN nằm đúng dấu đỏ',
        a.dotAtClick.join(', '));
    check(a.pinLogs === 1, 'có log giải thích "Pancake xếp lại danh sách" đúng 1 lần', `pinLogs=${a.pinLogs}`);
    check(a.wheelTotal > 0, 'có cuộn bù thật', `${a.wheelTotal}px`);
    check(a.status.includes('trùng mẫu'), 'dừng ở khách đầu tiên khác snippet', JSON.stringify(a.status));
    console.log(`     thời gian: ${(a.elapsed / 1000).toFixed(1)}s · cuộn bù ${a.wheelTotal}px`);

    /* ---------- B: pinView OFF (đối chứng) ---------- */
    console.log('\n=== B. Ghim khung OFF (đối chứng — dấu đỏ bị đẩy) ===');
    const b = await runScenario(false);
    check(JSON.stringify(b.clicked) === JSON.stringify(b.expected),
        'vẫn gửi đúng 6 khách (V5.24.1 vốn đã đúng khách)', b.clicked.join(', '));
    check(b.dotAtClick.some((n, i) => n !== b.clicked[i]),
        'dấu đỏ TRÔI: có lần click khách không nằm dưới dấu đỏ',
        b.dotAtClick.join(', '));
    check(b.wheelTotal === 0, 'không cuộn gì khi tắt ghim', `${b.wheelTotal}px`);

    /* ---------- C: danh sách KHÔNG cuộn được (ngắn hơn khung nhìn) ---------- */
    console.log('\n=== C. Danh sách ngắn — không cuộn được (không được treo) ===');
    const c = await runScenario(true, { extra: 3, holderH: 500 });
    check(JSON.stringify(c.clicked) === JSON.stringify(c.expected),
        'vẫn gửi đủ 6 khách khi không thể cuộn bù', c.clicked.join(', '));
    check(c.elapsed < 15000, 'không bị treo', `${(c.elapsed / 1000).toFixed(1)}s`);
    check(c.status.includes('trùng mẫu'), 'dừng đúng lý do', JSON.stringify(c.status));

    console.log(`\n${fails ? '❌ ' + fails + ' mục sai' : 'TẤT CẢ ĐỀU ĐÚNG.'}`);
    process.exit(fails ? 1 : 0);
})();
