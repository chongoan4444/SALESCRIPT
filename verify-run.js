/*
 * verify-run.js — kiểm chứng LOGIC NHẮM MỤC TIÊU (dãy) của V6.
 *
 * Cách làm: cắt NGUYÊN VĂN các hàm nhắm mục tiêu ra khỏi
 * pancake-auto-upsale-v6.user.js (không copy tay, để test luôn khớp code thật),
 * rồi chạy chúng trong sandbox có DOM giả.
 *
 * Mô phỏng theo đúng source thật (_app-9331d46f21a84eb1.v6.js):
 *   • Hàm `ev(e,t)` — thứ tự danh sách:
 *        [ghim: pinned_timestamp giảm dần]
 *      → [chưa đọc  (seen=false): updated_at giảm dần]
 *      → [đã đọc    (seen=true) : updated_at giảm dần]
 *   • Hàm `eg(e,t,n)` — khi có tin mới/gửi xong: hội thoại seen=true,
 *     updated_at=now ⇒ được chèn vào ĐẦU khối đã đọc, tức nằm DƯỚI toàn bộ
 *     khối chưa đọc.
 *   • Danh sách ảo hoá: chỉ render một cửa sổ ~N row. Mốc cuộn KHÔNG đổi
 *     (holder có overflow-anchor:none) nên cửa sổ luôn là slice cố định
 *     [i, i+N) của mảng mới ⇒ nội dung trôi lên khi một row phía trên bị bỏ.
 *
 * Chạy: node verify-run.js
 */

'use strict';
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(__dirname + '/pancake-auto-upsale-v6.user.js', 'utf8');

/** Cắt nguyên văn `function name(...) { ... }` khỏi source bằng cách đếm ngoặc. */
function extractFunction(name) {
    const start = SRC.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('không tìm thấy function ' + name);
    const brace = SRC.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < SRC.length; i++) {
        const c = SRC[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return SRC.slice(start, i + 1);
        }
    }
    throw new Error('không khớp ngoặc ở ' + name);
}

/** Cắt nguyên văn `const name = ...;` (một dòng). */
function extractConst(name) {
    const re = new RegExp('const\\s+' + name + '\\s*=');
    const m = re.exec(SRC);
    if (!m) throw new Error('không tìm thấy const ' + name);
    const start = m.index;
    const end = SRC.indexOf(';', start);
    return SRC.slice(start, end + 1);
}

const code = [
    'const sameSnippet = (a, b) => a !== null && b !== null && a !== \'\' && a === b;',
    extractConst('isMember'),
    extractConst('isLive'),
    extractConst('isBridge'),
    extractFunction('refreshRun'),
    extractFunction('pendingRunCount'),
    extractFunction('pickRunTarget'),
    extractConst('runFinished'),
    'this.__api = { refreshRun, pickRunTarget, pendingRunCount, runFinished };'
].join('\n\n');

function makeSandbox(state) {
    const sandbox = {
        D: { upBottom: state.upBottom === undefined ? 1 : state.upBottom },
        runIds: new Set(),
        runSnippet: '',
        runBottomSeen: false,
        runStopId: '',
        handledIds: new Set(),
        updateRunUI() {},
        rowItems: () => state.items,
        console
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'run-logic.js' });
    return { sandbox, api: sandbox.__api };
}

/* =========================================================
 * Mô phỏng danh sách Pancake
 * =======================================================*/

const WIN = 6;   // số row đang render (html2.txt: 10 row, html3.txt: 12)

function makeList(spec, winStart) {
    let ts = 100000;
    const items = spec.map(s => ({
        id: s.id,
        snippet: s.snippet,
        seen: !!s.seen,
        pinned: !!s.pinned,
        pinned_ts: s.pinned ? ts-- : 0,
        ts: ts--
    }));
    let clock = 1;

    /* Hàm `ev` trong bundle. */
    const sorted = () => items.slice().sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) return b.pinned_ts - a.pinned_ts;
        if (a.seen !== b.seen) return a.seen ? 1 : -1;
        return b.ts - a.ts;
    });

    return {
        items,
        winStart,
        /** Cửa sổ đang render — slice CỐ ĐỊNH theo mốc cuộn. */
        renderWindow() {
            return sorted().slice(this.winStart, this.winStart + WIN);
        },
        /** Hàm `eg`: gửi xong → seen=true, updated_at=now → đầu khối đã đọc. */
        send(id, replySnippet) {
            const c = items.find(x => x.id === id);
            if (!c) throw new Error('không có id ' + id);
            c.snippet = replySnippet;
            c.seen = true;
            c.ts = 100000 + (clock++);       // mới nhất ⇒ đầu khối đã đọc
        },
        order() { return sorted().map(c => c.id); }
    };
}

const fakeRow = () => ({ isConnected: true, getBoundingClientRect: () => ({ top: 0, left: 0, width: 300, height: 40 }) });

function scenario(name, spec, opts) {
    const list = makeList(spec, opts.winStart || 0);
    const state = { upBottom: opts.upBottom, items: [] };
    const { sandbox, api } = makeSandbox(state);

    const anchorConv = spec.find(c => c.id === opts.anchor);
    sandbox.runSnippet = anchorConv.snippet;
    sandbox.runIds.add(anchorConv.id);

    const sync = () => {
        state.items = list.renderWindow().map(c => ({
            row: fakeRow(), id: c.id, snippet: c.snippet, name: c.id
        }));
    };

    sync();
    api.refreshRun(state.items);

    const sent = [];
    let finishedEarly = false;
    let guard = 0;
    while (guard++ < 300) {
        sync();
        const target = api.pickRunTarget();
        if (!target) { finishedEarly = api.runFinished(); break; }

        if (target.snippet !== anchorConv.snippet) throw new Error(name + ': BUG gửi row khác snippet: ' + target.id);
        if (!sandbox.runIds.has(target.id)) throw new Error(name + ': BUG gửi row ngoài dãy: ' + target.id);

        sent.push(target.id);
        sandbox.handledIds.add(target.id);
        list.send(target.id, opts.reply || 'DA TRA LOI');
    }

    const expected = opts.expected;
    const okSent = JSON.stringify(sent) === JSON.stringify(expected);
    const okStop = guard < 300;
    console.log(
        `${okSent && okStop ? '✅' : '❌'} ${name}\n`
        + `     đã gửi (${sent.length}): ${sent.join(', ') || '(không)'}\n`
        + `     mong đợi (${expected.length}): ${expected.join(', ')}\n`
        + `     dừng trước khi hết guard: ${okStop} · runFinished()=${finishedEarly}`
    );
    if (!okSent || !okStop) throw new Error('kịch bản sai: ' + name);
    return sent;
}

/* =========================================================
 * KỊCH BẢN
 * =======================================================*/

const S     = 'Chị cho em xin chiều cao + cân nặng em chọn size phù hợp cho ...';
const OTHER = 'Xin giá';
const REPLY = 'Dạ em đã nhận thông tin ạ';

const un  = (id, snippet) => ({ id, snippet, seen: false });
const se  = (id, snippet) => ({ id, snippet, seen: true });

console.log('=== A. Dãy 8 khách cùng snippet, cửa sổ chỉ thấy 6 row ===');
const specA = [
    un('o_1', OTHER),
    un('R1', S), un('R2', S), un('R3', S), un('R4', S), un('R5', S),
    un('R6', S), un('R7', S), un('R8', S),
    se('e_1', OTHER), se('e_2', OTHER)
];
scenario('A: gửi đủ R1..R8 rồi dừng, không đụng o_1/e_1/e_2', specA, {
    anchor: 'R1',
    expected: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']
});

console.log('\n=== B. Một CỤM KHÁC ở xa cũng cùng snippet (không liền kề) ===');
const specB = [
    un('q_1', S), un('q_2', S), un('q_3', S),
    un('x_1', OTHER), un('x_2', OTHER), un('x_3', OTHER), un('x_4', OTHER),
    un('z_1', S), un('z_2', S)
];
scenario('B: chỉ gửi q_1..q_3, KHÔNG gửi z_1/z_2', specB, {
    anchor: 'q_1',
    expected: ['q_1', 'q_2', 'q_3']
});

console.log('\n=== C. Dãy nằm GIỮA hai cụm khác snippet ===');
const specC = [
    un('c_1', OTHER), un('c_2', OTHER),
    un('r_1', S), un('r_2', S), un('r_3', S),
    un('c_3', OTHER), un('c_4', OTHER),
    un('z_1', S), un('z_2', S)
];
scenario('C: chỉ gửi r_1..r_3', specC, {
    anchor: 'r_2',
    expected: ['r_1', 'r_2', 'r_3']
});

console.log('\n=== D. Dấu đỏ nằm GIỮA dãy (dãy lấn lên trên) ===');
const specD = [
    un('g_1', OTHER),
    un('s_1', S), un('s_2', S), un('s_3', S), un('s_4', S), un('s_5', S),
    un('g_2', OTHER)
];
scenario('D: gửi cả s_1..s_5 dù dấu đỏ ở s_3', specD, {
    anchor: 's_3',
    expected: ['s_1', 's_2', 's_3', 's_4', 's_5']
});

console.log('\n=== E. Tắt "Lùi lên trong dãy" (upBottom=0) — dấu đỏ ở giữa ===');
const specE = [
    un('g_1', OTHER),
    un('t_1', S), un('t_2', S), un('t_3', S), un('t_4', S),
    un('g_2', OTHER)
];
scenario('E: chỉ tiến xuống từ t_3 ⇒ t_3, t_4 (bỏ t_1, t_2)', specE, {
    anchor: 't_3',
    upBottom: 0,
    expected: ['t_3', 't_4']
});

console.log('\n=== F. Dãy chỉ có 1 khách ===');
const specF = [un('u_1', OTHER), un('u_2', S), un('u_3', OTHER), se('u_4', OTHER)];
scenario('F: chỉ gửi u_2 rồi dừng', specF, {
    anchor: 'u_2',
    expected: ['u_2']
});

console.log('\n=== G. Người dùng đã cuộn sâu (mốc cuộn > 0) ===');
const specG = [
    un('k_1', OTHER), un('k_2', OTHER), un('k_3', OTHER), un('k_4', OTHER), un('k_5', OTHER),
    un('m_1', S), un('m_2', S), un('m_3', S), un('m_4', S),
    un('k_6', OTHER), un('k_7', OTHER), un('k_8', OTHER)
];
scenario('G: cửa sổ bắt đầu ở k_3 ⇒ gửi m_1..m_4', specG, {
    anchor: 'm_2',
    winStart: 2,
    expected: ['m_1', 'm_2', 'm_3', 'm_4']
});

console.log('\n=== H. Cụm cùng snippet NGAY DƯỚI nhưng bị chặn bởi 1 row khác snippet ===');
const specH = [
    un('n_1', S), un('n_2', S),
    un('h_1', OTHER),
    un('y_1', S), un('y_2', S)
];
scenario('H: chỉ gửi n_1, n_2 — y_1/y_2 cùng snippet nhưng KHÔNG liền kề', specH, {
    anchor: 'n_1',
    expected: ['n_1', 'n_2']
});

console.log('\nTẤT CẢ KỊCH BẢN ĐỀU ĐÚNG.');
