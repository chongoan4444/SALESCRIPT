// ==UserScript==
// @name         Pancake - Auto bắt mess/comment + Clone Mess (13.0 - FINAL - Fix yellow tag confusion)
// @namespace    https://tampermonkey.net/
// @version      13.0
// @description  FINAL: Giữ nguyên logic gốc v11.1 (filter .border-fake, envelope-selected.svg, tag, snippet). Fix triệt để lỗi vàng: khi có 2-3 tin cũ unread + 1 mới nhảy vào lại bắt tin cũ dưới cùng, và khi có tin mới có tag (không đủ điều kiện) lại bắt nhầm tin cũ đã xuất hiện trước trong lúc vàng. Giải pháp: snapshot lưu tất cả ID lúc bật F1, oldEligibleIds lưu ID eligible cũ, khi vàng chỉ quét top3 và chỉ bắt ID hoàn toàn mới (chưa từng có trong snapshot và oldEligibleIds), hasOld chỉ check oldEligibleIds còn raw eligible không, isOld chỉ coi read->unread là mới, thêm yellowSeen để đánh dấu tin mới xuất hiện ở index>=3 trong lúc vàng là cũ.
// @match        https://pancake.vn/*
// @match        https://*.pancake.vn/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self) return;

    const INSTANCE_KEY = '__PANCAKE_AUTO_MAIN__';
    try {
        const oldInstance = window[INSTANCE_KEY];
        if (oldInstance && typeof oldInstance.destroy === 'function') oldInstance.destroy();
    } catch (e) { console.warn('[Pancake Auto] Cleanup lỗi:', e); }
    let destroyed = false;
    const cleanupFunctions = [];
    function addCleanup(fn) { cleanupFunctions.push(fn); }
    function addManagedEventListener(target, type, listener, options) {
        target.addEventListener(type, listener, options);
        addCleanup(() => target.removeEventListener(type, listener, options));
    }

    const EXCLUDED_COLORS = [];
    const CONFIG = {
        WAIT_AFTER_CLONE_SEND_MS: 200,
        WAIT_AFTER_SELECT_MESS: 150,
        WAIT_AFTER_SELECT_COMMENT: 1500,
        SUGGESTION_TIMEOUT_MS: 5000,
        WAIT_AFTER_SUGGESTION_CLICK_MS: 200,
        WAIT_AFTER_COMMENT_ENTER: 500,
        WAIT_BEFORE_PREVIEW_ENTER: 300,
        MAX_TAG_RETRIES: 5,
        TAG_RETRY_DELAY_MS: 150,
        ELEMENT_TIMEOUT_MS: 4000,
        WAIT_AFTER_PREVIEW_DISAPPEAR: 2000,
        PREVIEW_SEND_TIMEOUT_MS: 12000,
        POLL_INTERVAL_MS: 100,
        PREVIEW_TEXT: "/'",
        CLONE_RESCAN_DELAY_MS: 300,
        EXCLUDED_COMMENT_SNIPPETS: ['shop đã nhắn tin cho mình rồi đó ạ', 'chào chị']
    };

    const COMMENT_ICON_PATH = 'M232,128A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Z';
    const EXCLUDED_F1_COMMENT_PATH = 'M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H88v40a8,8,0,0,1-13.66,5.66l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,88,56V96h40A104.11,104.11,0,0,1,232,200Z';
    const SEND_ARROW_PATH = 'M240,127.89a16,16,0,0,1-8.18,14L63.9,237.9A16.15,16.15,0,0,1,56,240a16,16,0,0,1-15-21.33l27-79.95A4,4,0,0,1,71.72,136H144a8,8,0,0,0,8-8.53,8.19,8.19,0,0,0-8.26-7.47h-72a4,4,0,0,1-3.79-2.72l-27-79.94A16,16,0,0,1,63.84,18.07l168,95.89A16,16,0,0,1,240,127.89Z';

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const normalizeText = text => String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizePath = path => String(path || '').replace(/\s+/g, '');
    const excludedSnippets = CONFIG.EXCLUDED_COMMENT_SNIPPETS.map(normalizeText).filter(Boolean);

    function normalizeColorString(color) {
        return String(color || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
    }
    function cssColorToRgb(color) {
        const value = String(color || '').trim();
        if (!value) return null;
        const tester = document.createElement('span');
        tester.style.position = 'fixed'; tester.style.left = '-99999px'; tester.style.top = '-99999px'; tester.style.pointerEvents = 'none';
        try { tester.style.color = ''; tester.style.color = value; } catch { return null; }
        if (!tester.style.color) return null;
        document.documentElement.appendChild(tester);
        const result = normalizeColorString(getComputedStyle(tester).color);
        tester.remove();
        return result;
    }
    const normalizedExcludedColors = new Set(EXCLUDED_COLORS.map(cssColorToRgb).filter(Boolean));
    function getConversationColors(item) {
        if (!item) return [];
        return Array.from(item.querySelectorAll('.border-fake')).map(el => normalizeColorString(getComputedStyle(el).backgroundColor)).filter(Boolean).filter(c => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
    }
    function hasExcludedColor(item) {
        if (!item || normalizedExcludedColors.size === 0) return false;
        return getConversationColors(item).some(c => normalizedExcludedColors.has(c));
    }

    let waitingForMessage = false;
    let f1State = 'off';
    let isProcessing = false;
    let conversationObserver = null;
    let suggestionObserver = null;
    let cloneObserver = null;
    let tagDropdownOpenedByScript = false;
    let claimedConversation = null;
    let flowCounter = 0;
    let cloneModeActive = false;
    let cloneProcessing = false;
    let abortGeneration = 0;

    // FINAL SNAPSHOT LOGIC - FIX TRIỆT ĐỂ
    let f1Snapshot = new Map(); // id -> {snippet, wasUnread}
    let oldEligibleIds = new Set(); // ID đã eligible lúc bật F1 hoặc đã xuất hiện trong lúc vàng ở index>=3

    function takeF1Snapshot() {
        f1Snapshot.clear();
        oldEligibleIds.clear();
        const items = getConversationItems();
        items.forEach((item, idx) => {
            const id = item.id || '';
            if (!id) return;
            const snippet = normalizeText(item.querySelector('.snippet-text')?.textContent || '');
            const wasUnread = item.classList.contains('unread') || !!item.querySelector('.border-fake') || !!item.querySelector('img[src*="envelope-selected.svg"]');
            f1Snapshot.set(id, { snippet, wasUnread });
            if (classifyConversationRaw(item)) {
                oldEligibleIds.add(id);
            }
        });
        console.info(`[Pancake Auto 13.0] Snapshot ${f1Snapshot.size} total, oldEligible ${oldEligibleIds.size}`);
    }

    function isOldConversation(item) {
        if (!item) return true;
        const id = item.id || '';
        if (!id) return false;
        const old = f1Snapshot.get(id);
        if (!old) {
            // ID chưa từng có trong snapshot lúc bật F1
            // Nếu đã từng được đánh dấu là cũ trong lúc vàng thì vẫn là cũ
            if (oldEligibleIds.has(id)) return true;
            return false; // hoàn toàn mới
        }
        const curUnread = item.classList.contains('unread') || !!item.querySelector('.border-fake') || !!item.querySelector('img[src*="envelope-selected.svg"]');
        // Chỉ coi là mới khi trước read mà giờ unread
        if (!old.wasUnread && curUnread) return false;
        // Còn lại (đã unread rồi) thì vẫn là cũ, dù snippet đổi
        return true;
    }

    class AutomationAbortError extends Error { constructor() { super('AUTOMATION_ABORTED'); this.name = 'AutomationAbortError'; } }
    function isAbortError(e) { return e instanceof AutomationAbortError; }
    function assertNotAborted(gen) { if (destroyed || gen !== abortGeneration) throw new AutomationAbortError(); }
    async function abortableSleep(ms, gen) {
        assertNotAborted(gen);
        const slice = 40;
        let rem = ms;
        while (rem > 0) { await sleep(Math.min(slice, rem)); assertNotAborted(gen); rem -= slice; }
    }

    function updateStatusDot() {
        if (destroyed) return;
        let dot = document.getElementById('pancake-waiting-dot');
        if (!dot) {
            dot = document.createElement('div'); dot.id = 'pancake-waiting-dot';
            Object.assign(dot.style, { position: 'fixed', right: '6px', bottom: '6px', width: '7px', height: '7px', borderRadius: '50%', zIndex: '2147483647', pointerEvents: 'none' });
            document.body.appendChild(dot);
        }
        if (cloneModeActive) { dot.style.backgroundColor = '#00d13f'; return; }
        if (waitingForMessage && f1State === 'blocked') { dot.style.backgroundColor = '#ffc400'; return; }
        if (waitingForMessage && f1State === 'armed') { dot.style.backgroundColor = '#00d13f'; return; }
        dot.style.backgroundColor = '#ff2d2d';
    }

    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    async function waitFor(finder, timeout = CONFIG.ELEMENT_TIMEOUT_MS, gen = null) {
        const deadline = Date.now() + timeout;
        const imm = finder(); if (imm) return imm;
        return new Promise(resolve => {
            let finished = false, timer = null, observer = null, poll = null;
            const done = val => { if (finished) return; finished = true; if (timer) clearTimeout(timer); if (observer) observer.disconnect(); if (poll) clearInterval(poll); resolve(val); };
            observer = new MutationObserver(() => {
                if (destroyed) { done(null); return; }
                if (gen !== null && gen !== abortGeneration) { done(null); return; }
                const r = finder(); if (r) done(r);
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'id', 'src', 'd'] });
            poll = setInterval(() => { if (Date.now() >= deadline) { done(null); return; } if (gen !== null && gen !== abortGeneration) { done(null); return; } const r = finder(); if (r) done(r); }, CONFIG.POLL_INTERVAL_MS);
            timer = setTimeout(() => done(null), timeout);
        });
    }

    function triggerElementAction(el) {
        if (destroyed || !el || !el.isConnected) return false;
        try { el.click(); return true; } catch (e) { console.error('[Pancake Auto] click lỗi:', e); return false; }
    }

    let cachedConversationList = null;
    function getConversationListEl() {
        if (cachedConversationList && cachedConversationList.isConnected) return cachedConversationList;
        cachedConversationList = document.getElementById('conversationList');
        return cachedConversationList;
    }
    function getConversationItems() {
        const list = getConversationListEl();
        return list ? Array.from(list.querySelectorAll('.conversation-list-item')) : [];
    }

    function isConversationUnread(item) {
        if (!item) return false;
        if (item.classList.contains('unread') || !!item.closest('.unread') || !!item.querySelector('.unread')) return true;
        if (item.querySelector('.border-fake')) return true;
        if (item.querySelector('img[src*="envelope-selected.svg"]')) return true;
        if (item.querySelector('sup.ant-badge-count')) return true;
        try {
            const nameEl = item.querySelector('.name-module-text');
            const snippetEl = item.querySelector('.snippet-text');
            if (nameEl && snippetEl) {
                const fw1 = getComputedStyle(nameEl).fontWeight;
                const fw2 = getComputedStyle(snippetEl).fontWeight;
                if ((fw1 === '500' || parseInt(fw1) >= 500) && (fw2 === '500' || parseInt(fw2) >= 500)) return true;
            }
        } catch {}
        return false;
    }

    function hasEnvelopeSelected(item) { return !!item.querySelector('img[src*="envelope-selected.svg"]'); }
    function hasCommentPath(item) {
        const targetPath = normalizePath(COMMENT_ICON_PATH);
        return Array.from(item.querySelectorAll('path')).some(p => normalizePath(p.getAttribute('d')).includes(targetPath));
    }
    function hasRequiredCommentImage(item) { return !!item.querySelector('img[src*="comments.svg"]'); }
    function hasAnyCommentImage(item) { return !!item.querySelector('img[src*="comments"], img[src*="comment.svg"], [src*="comments.svg"]'); }
    function hasConversationTags(item) {
        const container = item.querySelector('div[class*="list_tags_conv_"]');
        return !!(container && (container.querySelector('.conversation_tags_item') || container.children.length > 0));
    }
    function hasExcludedCommentSnippet(item) {
        return Array.from(item.querySelectorAll('.snippet-text')).some(el => {
            const text = normalizeText(el.textContent);
            return excludedSnippets.some(s => text.includes(s));
        });
    }
    function hasExcludedF1CommentPath(item) {
        if (!item) return false;
        const targetPath = normalizePath(EXCLUDED_F1_COMMENT_PATH);
        return Array.from(item.querySelectorAll('path')).some(p => normalizePath(p.getAttribute('d')) === targetPath);
    }

    function classifyConversationRaw(item) {
        const list = getConversationListEl();
        if (destroyed || !item || !item.isConnected || !list?.contains(item) || !isConversationUnread(item)) return null;
        if (hasExcludedColor(item)) return null;
        const commentPath = hasCommentPath(item);
        const commentImage = hasRequiredCommentImage(item);
        if (commentPath || commentImage) {
            if (hasExcludedCommentSnippet(item)) return null;
            if (hasExcludedF1CommentPath(item)) return null;
            return 'comment';
        }
        if (!hasEnvelopeSelected(item)) return null;
        if (hasAnyCommentImage(item)) return null;
        if (hasConversationTags(item)) return null;
        return 'mess';
    }

    function classifyConversation(item) {
        const raw = classifyConversationRaw(item);
        if (!raw) return null;
        if (f1State === 'armed' && isOldConversation(item)) return null;
        return raw;
    }

    function findTarget(items) {
        for (const item of items) {
            const type = classifyConversation(item);
            if (type) return { item, type };
        }
        return null;
    }

    function isTagActive(btn) { return !!btn?.querySelector('.ellipse, div[class*="ellipse"]'); }
    function getVisibleTagButtons() {
        const container = document.querySelector('#listShowTags') || document;
        return Array.from(container.querySelectorAll('button.btn-tag-item')).filter(isElementVisible);
    }
    function findTagButtonByIndex(index) { return getVisibleTagButtons()[index - 1] || null; }
    function getTagDropdownButton() { return document.querySelector('.tag-dropdown-wrapper .btn-drop, .tag-dropdown-wrapper .btn-collapse button'); }
    async function findTagButtonByName(targetName, gen = null) {
        if (gen !== null) assertNotAborted(gen);
        const clean = v => normalizeText(v).replace(/\s+/g, '');
        const matches = btn => clean(btn.textContent) === clean(targetName);
        let target = getVisibleTagButtons().find(matches);
        if (target) return target;
        const findInAllTags = () => Array.from(document.querySelectorAll('#listAllTags button.btn-tag-item')).find(matches) || null;
        target = findInAllTags();
        if (target && isElementVisible(target)) return target;
        if (!tagDropdownOpenedByScript) {
            const dropdownButton = getTagDropdownButton();
            if (dropdownButton) {
                if (gen !== null) assertNotAborted(gen);
                triggerElementAction(dropdownButton);
                tagDropdownOpenedByScript = true;
                if (gen !== null) await abortableSleep(60, gen); else await sleep(60);
            }
        }
        target = getVisibleTagButtons().find(matches) || findInAllTags();
        return (target && isElementVisible(target)) ? target : null;
    }
    async function closeTagDropdown(gen = null) {
        if (!tagDropdownOpenedByScript) return;
        try {
            const allTags = document.querySelector('#listAllTags');
            const hasVisibleDropdownTags = !!allTags && Array.from(allTags.querySelectorAll('button.btn-tag-item')).some(isElementVisible);
            if (hasVisibleDropdownTags) {
                const button = getTagDropdownButton();
                if (button) {
                    if (gen !== null) assertNotAborted(gen);
                    triggerElementAction(button);
                    if (gen !== null) await abortableSleep(60, gen); else await sleep(60);
                }
            }
        } finally { tagDropdownOpenedByScript = false; }
    }
    async function ensureTagActivated(finder, gen = null) {
        for (let attempt = 0; attempt < CONFIG.MAX_TAG_RETRIES; attempt++) {
            if (destroyed) return false;
            if (gen !== null) assertNotAborted(gen);
            const button = await finder();
            if (!button) { if (gen !== null) await abortableSleep(CONFIG.TAG_RETRY_DELAY_MS, gen); else await sleep(CONFIG.TAG_RETRY_DELAY_MS); continue; }
            if (isTagActive(button)) return true;
            if (gen !== null) assertNotAborted(gen);
            triggerElementAction(button);
            if (gen !== null) await abortableSleep(CONFIG.TAG_RETRY_DELAY_MS, gen); else await sleep(CONFIG.TAG_RETRY_DELAY_MS);
            const recheck = await finder();
            if (recheck && isTagActive(recheck)) return true;
        }
        return false;
    }
    async function executeTaggingOnly(gen = null) {
        tagDropdownOpenedByScript = false;
        try {
            if (gen !== null) assertNotAborted(gen);
            const tag24 = await ensureTagActivated(() => findTagButtonByIndex(24), gen);
            if (gen !== null) await abortableSleep(30, gen); else await sleep(30);
            const tag25 = await ensureTagActivated(() => findTagButtonByIndex(25), gen);
            if (gen !== null) await abortableSleep(30, gen); else await sleep(30);
            const tagTAnh = await ensureTagActivated(() => findTagButtonByName('T.Anh', gen), gen);
            if (!tag24 || !tag25 || !tagTAnh) throw new Error('Chưa xác nhận đủ tag 24, 25, T.Anh. Dừng.');
        } finally {
            if (tagDropdownOpenedByScript && (gen === null || gen === abortGeneration)) {
                try { await closeTagDropdown(gen); } catch (e) { if (!isAbortError(e)) throw e; }
            }
        }
    }

    function getComposer() {
        const el = document.getElementById('replyBoxComposer');
        if (!el || el.tagName !== 'TEXTAREA' || !el.isConnected || !isElementVisible(el) || el.disabled || el.readOnly) return null;
        return el;
    }
    function getPreviewInput() {
        const el = document.getElementById('previewReplyInput');
        if (!el || !el.isConnected || !isElementVisible(el) || el.disabled || el.readOnly) return null;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable) return el;
        return null;
    }
    function getEditorText(el) {
        if (!el || !el.isConnected) return null;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value;
        if (el.isContentEditable) return el.textContent;
        return null;
    }
    function setEditorText(el, text) {
        if (!el || !el.isConnected) throw new Error('Editor không tồn tại.');
        el.focus();
        if (el.tagName === 'TEXTAREA') {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            if (!setter) throw new Error('Không tìm thấy textarea value setter.');
            setter.call(el, text);
        } else if (el.tagName === 'INPUT') {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (!setter) throw new Error('Không tìm thấy input value setter.');
            setter.call(el, text);
        } else if (el.isContentEditable) {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            selection.removeAllRanges();
            selection.addRange(range);
            const inserted = document.execCommand('insertText', false, text);
            if (!inserted) throw new Error('Không nhập được contenteditable.');
        } else { throw new Error('Editor không được hỗ trợ.'); }
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function simulateSlashKey(el) {
        if (destroyed || !el || !el.isConnected) return false;
        try {
            el.focus();
            const options = { key: '/', code: 'Slash', keyCode: 191, which: 191, bubbles: true, cancelable: true, repeat: false };
            el.dispatchEvent(new KeyboardEvent('keydown', options));
            if (!destroyed && el.isConnected) el.dispatchEvent(new KeyboardEvent('keyup', options));
            return true;
        } catch (e) { console.error('[Pancake Auto] Slash key lỗi:', e); return false; }
    }
    function simulateEnterKey(el) {
        if (!el || !el.isConnected) return false;
        try {
            el.focus();
            const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            el.dispatchEvent(new KeyboardEvent('keypress', opts));
            el.dispatchEvent(new KeyboardEvent('keyup', opts));
            return true;
        } catch { return false; }
    }

    function getSendArrowPaths() {
        const targetPath = normalizePath(SEND_ARROW_PATH);
        return Array.from(document.querySelectorAll('path')).filter(p => p.isConnected && normalizePath(p.getAttribute('d')) === targetPath);
    }
    function getSendArrowClickTarget(path) {
        if (!path || !path.isConnected) return null;
        let current = path;
        while (current && current !== document.body) {
            if (isElementVisible(current) && (current.tagName === 'BUTTON' || current.tagName === 'A' || current.getAttribute('role') === 'button')) return current;
            current = current.parentElement;
        }
        current = path.parentElement;
        while (current && current !== document.body) {
            if (isElementVisible(current) && (current.tagName === 'SPAN' || current.tagName === 'DIV')) return current;
            current = current.parentElement;
        }
        return null;
    }
    function getPreviewSendArrow() {
        const previewInput = getPreviewInput();
        if (!previewInput) return null;
        const paths = getSendArrowPaths();
        if (!paths.length) return null;
        let current = previewInput.parentElement;
        while (current && current !== document.body) {
            const matchingPaths = paths.filter(p => current.contains(p));
            if (matchingPaths.length === 1) {
                const target = getSendArrowClickTarget(matchingPaths[0]);
                if (target && current.contains(target)) return target;
            }
            current = current.parentElement;
        }
        const composer = getComposer();
        if (composer) {
            let cur = composer.parentElement;
            while (cur && cur !== document.body) {
                const matchingPaths = paths.filter(p => cur.contains(p));
                if (matchingPaths.length === 1) {
                    const target = getSendArrowClickTarget(matchingPaths[0]);
                    if (target && cur.contains(target)) return target;
                }
                cur = cur.parentElement;
            }
        }
        return null;
    }
    function getComposerSendArrow() {
        const composer = getComposer();
        if (!composer) return null;
        const paths = getSendArrowPaths();
        if (!paths.length) return null;
        let current = composer.parentElement;
        while (current && current !== document.body) {
            const matchingPaths = paths.filter(p => current.contains(p));
            if (matchingPaths.length === 1) {
                const target = getSendArrowClickTarget(matchingPaths[0]);
                if (target && current.contains(target)) return target;
            }
            current = current.parentElement;
        }
        return null;
    }

    async function clickComposerSendArrow(flowId, gen = null) {
        const button = await waitFor(getComposerSendArrow, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (gen !== null) assertNotAborted(gen);
        if (button) {
            console.info(`[Pancake Auto] Flow ${flowId}: click mũi tên gửi composer.`);
            if (!triggerElementAction(button)) throw new Error('Không click được mũi tên gửi composer.');
            return;
        }
        const composer = getComposer();
        if (!composer) throw new Error('Không tìm thấy nút mũi tên gửi composer.');
        console.info(`[Pancake Auto] Flow ${flowId}: fallback Enter composer.`);
        if (!simulateEnterKey(composer)) throw new Error('Fallback Enter thất bại.');
    }
    async function clickPreviewSendArrow(flowId, gen = null) {
        const button = await waitFor(getPreviewSendArrow, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (gen !== null) assertNotAborted(gen);
        if (button) {
            console.info(`[Pancake Auto] Flow ${flowId}: click mũi tên gửi preview.`);
            if (!triggerElementAction(button)) throw new Error('Không click được mũi tên gửi preview.');
            return;
        }
        const preview = getPreviewInput();
        if (!preview) throw new Error('Không tìm thấy nút mũi tên trong khung preview.');
        console.info(`[Pancake Auto] Flow ${flowId}: fallback Enter preview.`);
        if (!simulateEnterKey(preview)) throw new Error('Fallback Enter preview thất bại.');
    }

    function stopSuggestionObserver() { if (suggestionObserver) { suggestionObserver.disconnect(); suggestionObserver = null; } }
    function getSuggestionList() {
        const list = document.getElementById('qr_autocomplete');
        if (!list || !list.isConnected || !isElementVisible(list)) return null;
        return list;
    }
    function getSelectedSuggestion() {
        const list = getSuggestionList();
        if (!list) return null;
        const item = list.querySelector('li.suggestion-element.select');
        if (!item || !item.isConnected || !isElementVisible(item)) return null;
        return item;
    }
    function getSuggestionShortcut(item) { if (!item) return ''; return String(item.querySelector('.shortcut-tag')?.textContent || '').trim(); }
    function findSelectedSuggestion(command) {
        const item = getSelectedSuggestion();
        if (!item) return null;
        if (command === '/') return item;
        const shortcut = getSuggestionShortcut(item);
        return shortcut === command ? item : null;
    }
    function createSuggestionWaiter(command, timeout = CONFIG.SUGGESTION_TIMEOUT_MS, gen = null) {
        stopSuggestionObserver();
        let finished = false, timeoutId = null, resolvePromise;
        const promise = new Promise(resolve => { resolvePromise = resolve; });
        const finish = value => { if (finished) return; finished = true; if (timeoutId !== null) clearTimeout(timeoutId); stopSuggestionObserver(); resolvePromise(value); };
        const scan = () => {
            if (destroyed || finished) return;
            if (gen !== null && gen !== abortGeneration) { finish(null); return; }
            const item = findSelectedSuggestion(command);
            if (item) finish(item);
        };
        suggestionObserver = new MutationObserver(scan);
        suggestionObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        scan();
        timeoutId = setTimeout(() => finish(null), timeout);
        return { promise, cancel() { finish(null); } };
    }
    async function clickSelectedSuggestion(item, command, flowId, gen = null) {
        if (gen !== null) assertNotAborted(gen);
        if (!item || !item.isConnected) throw new Error('Suggestion không còn tồn tại.');
        if (!item.matches('li.suggestion-element.select')) throw new Error('Suggestion không còn trạng thái select.');
        const shortcut = getSuggestionShortcut(item);
        if (command !== '/' && shortcut !== command) throw new Error('Suggestion không đúng command.');
        const clickTarget = item.querySelector('.suggestion-row') || item.querySelector('.suggestion-content') || item;
        if (!clickTarget || !clickTarget.isConnected) throw new Error('Không tìm thấy vùng click suggestion.');
        if (gen !== null) assertNotAborted(gen);
        console.info(`[Pancake Auto] Flow ${flowId}: click suggestion ${JSON.stringify(shortcut)}`);
        if (!triggerElementAction(clickTarget)) throw new Error('Không click được suggestion.');
        if (gen !== null) await abortableSleep(CONFIG.WAIT_AFTER_SUGGESTION_CLICK_MS, gen); else await sleep(CONFIG.WAIT_AFTER_SUGGESTION_CLICK_MS);
        return !destroyed;
    }
    async function sendComposerCommand(command, activateSlashMenu, flowId, gen = null) {
        if (gen !== null) assertNotAborted(gen);
        let composer = await waitFor(getComposer, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (!composer) throw new Error('Không tìm thấy #replyBoxComposer.');
        const suggestionWaiter = createSuggestionWaiter(command, CONFIG.SUGGESTION_TIMEOUT_MS, gen);
        try {
            if (gen !== null) assertNotAborted(gen);
            composer.focus();
            if (activateSlashMenu) simulateSlashKey(composer);
            setEditorText(composer, command);
            if (gen !== null) assertNotAborted(gen);
            const selected = await suggestionWaiter.promise;
            if (gen !== null) assertNotAborted(gen);
            if (!selected) throw new Error(`Không thấy suggestion cho ${JSON.stringify(command)}.`);
            await clickSelectedSuggestion(selected, command, flowId, gen);
            if (gen !== null) assertNotAborted(gen);
            await waitFor(() => !getSuggestionList() ? true : null, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        } finally { suggestionWaiter.cancel(); }
    }

    async function openPreviewAndFill(flowId, gen = null) {
        if (gen !== null) assertNotAborted(gen);
        await sendComposerCommand('/', true, flowId, gen);
        if (gen !== null) assertNotAborted(gen);
        await abortableSleep(CONFIG.WAIT_AFTER_COMMENT_ENTER, gen);
        if (gen !== null) assertNotAborted(gen);
        const preview = await waitFor(getPreviewInput, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (!preview) throw new Error('Không thấy #previewReplyInput sau khi gửi /.');
        if (gen !== null) assertNotAborted(gen);
        preview.focus();
        setEditorText(preview, CONFIG.PREVIEW_TEXT);
        if (gen !== null) assertNotAborted(gen);
        await abortableSleep(CONFIG.WAIT_BEFORE_PREVIEW_ENTER, gen);
        if (gen !== null) assertNotAborted(gen);
        await clickPreviewSendArrow(flowId, gen);
        if (gen !== null) assertNotAborted(gen);
        await waitFor(() => !getPreviewInput() ? true : null, CONFIG.PREVIEW_SEND_TIMEOUT_MS, gen);
    }

    async function processMess(flowId, gen) {
        assertNotAborted(gen);
        await executeTaggingOnly(gen);
        assertNotAborted(gen);
        await abortableSleep(60, gen);
        assertNotAborted(gen);
        await sendComposerCommand('/.', false, flowId, gen);
        assertNotAborted(gen);
    }
    async function processComment(flowId, gen) {
        assertNotAborted(gen);
        const commentButton = await waitFor(() => {
            const btn = document.querySelector('.comment-action-btn');
            return (btn && btn.isConnected && isElementVisible(btn)) ? btn : null;
        }, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        assertNotAborted(gen);
        if (!commentButton) throw new Error('Không tìm thấy nút comment.');
        if (!triggerElementAction(commentButton)) throw new Error('Không click được nút comment.');
        assertNotAborted(gen);
        await abortableSleep(CONFIG.WAIT_AFTER_SELECT_COMMENT, gen);
        assertNotAborted(gen);
        await openPreviewAndFill(flowId, gen);
        assertNotAborted(gen);
    }

    function getAllConversationButton() {
        const container = document.querySelector('.conv-actions');
        if (!container) return null;
        const button = container.querySelector('g[id="all conversation"]')?.closest('button, [role="button"], div');
        return (button && button.isConnected && isElementVisible(button)) ? button : null;
    }
    function getCloneList() {
        const list = document.getElementById('conversationCloneList');
        if (!list || !list.isConnected || !isElementVisible(list)) return null;
        return list;
    }
    function isCloneListOpen() { return !!getCloneList(); }
    async function setCloneToggleState(desiredState, gen, flowId) {
        assertNotAborted(gen);
        const isOpen = isCloneListOpen();
        if ((desiredState === 'open' && isOpen) || (desiredState === 'closed' && !isOpen)) return;
        const button = await waitFor(getAllConversationButton, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        assertNotAborted(gen);
        if (!button) throw new Error('Không tìm thấy nút toggle clone list.');
        const beforeColor = (() => { try { const g = button.querySelector('g[id="all conversation"]'); if (!g) return ''; const path = g.querySelector('path'); return path ? getComputedStyle(path).fill : ''; } catch { return ''; } })();
        if (!triggerElementAction(button)) throw new Error('Không click được nút toggle clone list.');
        assertNotAborted(gen);
        await waitFor(() => {
            const open = isCloneListOpen();
            if ((desiredState === 'open' && open) || (desiredState === 'closed' && !open)) return true;
            try {
                const g = button.querySelector('g[id="all conversation"]');
                if (!g) return null;
                const path = g.querySelector('path');
                const afterColor = path ? getComputedStyle(path).fill : '';
                if (afterColor && beforeColor && afterColor !== beforeColor) return true;
            } catch {}
            return null;
        }, CONFIG.ELEMENT_TIMEOUT_MS, gen);
    }
    async function ensureCloneListOpen(gen, flowId) {
        assertNotAborted(gen);
        await setCloneToggleState('open', gen, flowId);
        assertNotAborted(gen);
        const list = await waitFor(getCloneList, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        assertNotAborted(gen);
        if (!list) throw new Error('Không mở được clone list.');
        return list;
    }
    async function ensureCloneListClosed(gen, flowId) {
        assertNotAborted(gen);
        await setCloneToggleState('closed', gen, flowId);
        assertNotAborted(gen);
        await waitFor(() => !getCloneList() ? true : null, 2000, gen);
        assertNotAborted(gen);
    }
    async function clickAfterCloneDoneButton(flowId, gen) {
        assertNotAborted(gen);
        await abortableSleep(CONFIG.WAIT_AFTER_CLONE_SEND_MS, gen);
        assertNotAborted(gen);
        await ensureCloneListClosed(gen, flowId);
        assertNotAborted(gen);
    }

    const processedCloneKeys = new Set();
    function getCloneItemKey(item) {
        if (!item) return null;
        const id = item.id || '';
        const snippet = normalizeText(item.querySelector('.snippet-text')?.textContent || '');
        return id ? `${id}::${snippet}` : null;
    }
    function isCloneMess(item) {
        if (!item || !item.isConnected) return false;
        if (!isConversationUnread(item)) return false;
        if (hasExcludedColor(item)) return false;
        if (!hasEnvelopeSelected(item)) return false;
        if (hasAnyCommentImage(item)) return false;
        const key = getCloneItemKey(item);
        if (key && processedCloneKeys.has(key)) return false;
        return true;
    }
    function findCloneMess() {
        const list = getCloneList();
        if (!list) return null;
        const items = Array.from(list.querySelectorAll('.conversation-list-item'));
        for (const item of items) { if (isCloneMess(item)) return item; }
        return null;
    }

    async function processCloneMess(item, gen, flowId) {
        assertNotAborted(gen);
        if (!isCloneMess(item)) throw new Error('Clone item không còn là MESS hợp lệ.');
        const alreadyHasTag = hasConversationTags(item);
        const key = getCloneItemKey(item);
        if (key) processedCloneKeys.add(key);
        console.info(`[Pancake Auto] Flow ${flowId}: CLONE MESS hasTag=${alreadyHasTag}, key=${JSON.stringify(key)}`);
        assertNotAborted(gen);
        if (!triggerElementAction(item)) { if (key) processedCloneKeys.delete(key); throw new Error('Không click được MESS trong clone list.'); }
        await abortableSleep(CONFIG.WAIT_AFTER_SELECT_MESS, gen);
        assertNotAborted(gen);
        if (!alreadyHasTag) {
            console.info(`[Pancake Auto] Flow ${flowId}: clone chưa có tag -> gắn 24,25,T.Anh.`);
            await executeTaggingOnly(gen);
            assertNotAborted(gen);
            await abortableSleep(60, gen);
        } else { console.info(`[Pancake Auto] Flow ${flowId}: clone đã có tag -> bỏ qua tagging.`); }
        assertNotAborted(gen);
        await sendComposerCommand('/.', false, flowId, gen);
        assertNotAborted(gen);
        console.info(`[Pancake Auto] Flow ${flowId}: clone đã gửi /.`);
        await clickAfterCloneDoneButton(flowId, gen);
        assertNotAborted(gen);
        cloneModeActive = false;
        stopCloneObserver();
        processedCloneKeys.clear();
        updateStatusDot();
        console.info(`[Pancake Auto] Flow ${flowId}: CLONE DONE -> chuẩn bị quay lại F1.`);
    }

    async function tryRunCloneMess() {
        if (destroyed || !cloneModeActive || cloneProcessing) return;
        const item = findCloneMess();
        if (!item) return;
        cloneProcessing = true;
        const gen = abortGeneration;
        const flowId = ++flowCounter;
        let cloneCompleted = false;
        try {
            assertNotAborted(gen);
            console.info(`[Pancake Auto] Flow ${flowId} START CLONE MESS`);
            await processCloneMess(item, gen, flowId);
            assertNotAborted(gen);
            cloneCompleted = true;
            console.info(`[Pancake Auto] Flow ${flowId} DONE CLONE MESS`);
        } catch (e) {
            if (!isAbortError(e)) console.error(`[Pancake Auto] Flow ${flowId} clone lỗi:`, e);
            else console.info(`[Pancake Auto] Flow ${flowId} CLONE bị ESC hủy.`);
        } finally {
            cloneProcessing = false;
            if (cloneCompleted && !destroyed && gen === abortGeneration) { await abortableSleep(250, gen); rearmF1AfterFlow(flowId); return; }
            if (!destroyed && cloneModeActive && gen === abortGeneration) {
                setTimeout(() => { if (!destroyed && cloneModeActive && !cloneProcessing && gen === abortGeneration) void tryRunCloneMess(); }, CONFIG.CLONE_RESCAN_DELAY_MS);
            }
        }
    }
    function startCloneObserver() {
        stopCloneObserver();
        if (destroyed || !cloneModeActive) return;
        cloneObserver = new MutationObserver(() => {
            if (destroyed || !cloneModeActive || cloneProcessing) return;
            if (!getCloneList()) return;
            void tryRunCloneMess();
        });
        cloneObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'style', 'd'] });
        void tryRunCloneMess();
    }

    async function enterCloneMessMode(gen, flowId) {
        assertNotAborted(gen);
        await abortableSleep(CONFIG.WAIT_AFTER_PREVIEW_DISAPPEAR, gen);
        assertNotAborted(gen);
        const buttonReady = await waitFor(getAllConversationButton, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        assertNotAborted(gen);
        if (!buttonReady) throw new Error('Toolbar chưa có nút all conversation.');
        const list = await ensureCloneListOpen(gen, flowId);
        assertNotAborted(gen);
        if (!list) throw new Error('Clone list chưa thực sự mở.');
        waitingForMessage = false;
        f1State = 'off';
        stopConversationObserver();
        processedCloneKeys.clear();
        cloneModeActive = true;
        updateStatusDot();
        console.info(`[Pancake Auto] Flow ${flowId}: CLONE MODE ON.`);
        startCloneObserver();
    }
    function abortAllAutomation() {
        abortGeneration++;
        waitingForMessage = false;
        f1State = 'off';
        cloneModeActive = false;
        claimedConversation = null;
        stopConversationObserver();
        stopCloneObserver();
        stopSuggestionObserver();
        processedCloneKeys.clear();
        tagDropdownOpenedByScript = false;
        updateStatusDot();
        console.info('[Pancake Auto] ESC -> ABORT');
    }

    // FINAL F1 LOGIC
    function findEligibleF1Target(items = getConversationItems()) { return findTarget(items); }
    function hasEligibleF1Target() { return !!findEligibleF1Target(getConversationItems()); }

    function hasOldEligibleTarget() {
        const items = getConversationItems();
        let count = 0;
        for (const item of items) {
            const id = item.id || '';
            if (!id) continue;
            if (!f1Snapshot.has(id) && !oldEligibleIds.has(id)) {
                const idx = items.indexOf(item);
                if (idx >= 3) {
                    const raw = classifyConversationRaw(item);
                    if (raw) {
                        console.debug(`[Pancake Auto] hasOld: id=${id} mới xuất hiện trong lúc vàng nhưng index=${idx}>=3 -> đánh dấu cũ`);
                        oldEligibleIds.add(id);
                    }
                }
                continue;
            }
            const type = classifyConversationRaw(item);
            if (type) { count++; if (count <= 3) console.info(`[Pancake Auto] hasOld: còn cũ id=${id} type=${type} index=${items.indexOf(item)}`); }
        }
        if (count) console.info(`[Pancake Auto] hasOld: tổng ${count} cũ còn eligible (giữ vàng)`);
        return count > 0;
    }

    function findNewEligibleTargetNotInSnapshot() {
        const items = getConversationItems();
        const isBlocked = f1State === 'blocked';
        const maxScan = isBlocked ? Math.min(3, items.length) : items.length;
        for (let i = 0; i < maxScan; i++) {
            const item = items[i];
            const id = item.id || '';
            if (!id) continue;
            if (isBlocked) {
                if (f1Snapshot.has(id) || oldEligibleIds.has(id)) {
                    if (i < 3) console.debug(`[Pancake Auto] findNew [VÀNG] skip old id=${id} index=${i}`);
                    continue;
                }
            } else {
                if (isOldConversation(item)) {
                    if (i < 3) console.debug(`[Pancake Auto] findNew [XANH] skip old id=${id} index=${i}`);
                    continue;
                }
            }
            const type = classifyConversationRaw(item);
            if (type) {
                console.info(`[Pancake Auto] findNew: mới nhất index=${i} id=${id} type=${type} ${isBlocked?'(VÀNG top3 ID mới)':''}`);
                return { item, type, index: i, isNewId: true };
            } else {
                if (i < 3) {
                    const hasTag = hasConversationTags(item);
                    const unread = isConversationUnread(item);
                    console.debug(`[Pancake Auto] findNew [${isBlocked?'VÀNG':'XANH'}] index=${i} id=${id} raw=null unread=${unread} hasTag=${hasTag} -> skip`);
                }
            }
        }
        if (isBlocked) {
            console.info(`[Pancake Auto] findNew: khi vàng quét top3 không thấy ID mới eligible -> giữ vàng`);
            return null;
        }
        for (let i = maxScan; i < items.length; i++) {
            const item = items[i];
            if (isOldConversation(item)) continue;
            const type = classifyConversationRaw(item);
            if (type) return { item, type, index: i, isNewId: true };
        }
        return null;
    }

    function findNewEligibleTargetWithOldCheck() {
        const items = getConversationItems();
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (isOldConversation(item)) continue;
            const type = classifyConversationRaw(item);
            if (type) return { item, type, index: i };
        }
        return null;
    }

    function scanWaitingCandidates(items) {
        if (destroyed || !waitingForMessage || isProcessing || claimedConversation || cloneModeActive) return false;
        if (f1State === 'armed') {
            if (items && items.length) {
                const allItems = getConversationItems();
                const sorted = [...items].sort((a,b) => allItems.indexOf(a) - allItems.indexOf(b));
                for (const it of sorted) {
                    if (isOldConversation(it)) continue;
                    const type = classifyConversationRaw(it);
                    if (type) { console.info(`[Pancake Auto] [XANH] mới từ mutation: ${type} id=${it.id}`); void runTarget({ item: it, type }); return true; }
                }
            }
            const newTarget = findNewEligibleTargetWithOldCheck();
            if (newTarget) { console.info(`[Pancake Auto] [XANH] mới từ full scan: ${newTarget.type} id=${newTarget.item.id}`); void runTarget(newTarget); return true; }
            return false;
        }
        if (f1State === 'blocked') {
            const newWhileBlocked = findNewEligibleTargetNotInSnapshot();
            if (newWhileBlocked) {
                console.info(`[Pancake Auto] [VÀNG] mới nhất: ${newWhileBlocked.type} id=${newWhileBlocked.item.id} index=${newWhileBlocked.index} - bắt luôn dù vàng`);
                f1State = 'armed'; updateStatusDot(); void runTarget(newWhileBlocked); return true;
            }
            return false;
        }
        return false;
    }

    function rearmF1AfterFlow(flowId) {
        if (destroyed) return;
        waitingForMessage = true;
        claimedConversation = null;
        if (hasOldEligibleTarget()) {
            f1State = 'blocked';
            console.info(`[Pancake Auto] Flow ${flowId}: REARM -> VÀNG: còn ${oldEligibleIds.size} cũ`);
        } else {
            takeF1Snapshot();
            if (hasEligibleF1Target()) {
                f1State = 'blocked';
                console.info(`[Pancake Auto] Flow ${flowId}: REARM -> VÀNG: có cũ mới sau snapshot`);
            } else {
                f1State = 'armed';
                console.info(`[Pancake Auto] Flow ${flowId}: REARM -> XANH: chờ mới`);
            }
        }
        updateStatusDot();
        if (!isProcessing && !cloneModeActive) startConversationObserver();
    }

    async function runTarget(target) {
        if (destroyed || !waitingForMessage || f1State !== 'armed' || isProcessing || !target || claimedConversation || cloneModeActive) return;
        if (classifyConversation(target.item) !== target.type) {
            console.warn(`[Pancake Auto] runTarget classify mismatch id=${target.item.id} expected=${target.type} got=${classifyConversation(target.item)} raw=${classifyConversationRaw(target.item)} isOld=${isOldConversation(target.item)}`);
            return;
        }
        const gen = abortGeneration;
        const flowId = ++flowCounter;
        claimedConversation = target.item;
        isProcessing = true;
        stopConversationObserver();
        updateStatusDot();
        let shouldRearmMainMess = false;
        let flowSucceeded = false;
        try {
            assertNotAborted(gen);
            console.info(`[Pancake Auto] Flow ${flowId} START F1 ${target.type.toUpperCase()} id=${target.item.id}`);
            if (!triggerElementAction(target.item)) throw new Error('Không chọn được hội thoại.');
            assertNotAborted(gen);
            if (target.type === 'mess') { await processMess(flowId, gen); assertNotAborted(gen); shouldRearmMainMess = true; }
            else if (target.type === 'comment') { await processComment(flowId, gen); assertNotAborted(gen); await enterCloneMessMode(gen, flowId); assertNotAborted(gen); }
            flowSucceeded = true;
            console.info(`[Pancake Auto] Flow ${flowId} DONE F1 ${target.type.toUpperCase()}`);
        } catch (e) {
            if (!isAbortError(e)) console.error(`[Pancake Auto] Flow ${flowId} lỗi:`, e);
            else console.info(`[Pancake Auto] Flow ${flowId} bị ESC hủy.`);
        } finally {
            stopSuggestionObserver();
            if (gen === abortGeneration && !destroyed) await sleep(250);
            claimedConversation = null;
            isProcessing = false;
            if (flowSucceeded && shouldRearmMainMess && !destroyed && gen === abortGeneration) { rearmF1AfterFlow(flowId); return; }
            if (flowSucceeded && cloneModeActive && !destroyed && gen === abortGeneration) { updateStatusDot(); return; }
            if (!flowSucceeded && !destroyed && gen === abortGeneration) {
                waitingForMessage = false; f1State = 'off'; stopConversationObserver(); if (!cloneModeActive) processedCloneKeys.clear(); updateStatusDot();
                console.warn(`[Pancake Auto] Flow ${flowId}: lỗi -> F1 OFF.`);
                return;
            }
            updateStatusDot();
        }
    }

    function collectChangedItems(records) {
        const items = new Set();
        const list = getConversationListEl();
        if (!list) return [];
        for (const record of records) {
            if (record.type === 'childList') {
                record.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        if (node.matches && node.matches('.conversation-list-item')) items.add(node);
                        if (node.querySelectorAll) node.querySelectorAll('.conversation-list-item').forEach(el => items.add(el));
                    }
                });
                if (record.target && record.target.matches && record.target.matches('.conversation-list-item')) items.add(record.target);
            } else if (record.type === 'attributes' || record.type === 'characterData') {
                let cur = record.target;
                while (cur && cur !== document.body) {
                    if (cur.matches && cur.matches('.conversation-list-item')) { items.add(cur); break; }
                    cur = cur.parentElement;
                }
            }
        }
        return Array.from(items).filter(el => el.isConnected && list.contains(el));
    }

    function stopConversationObserver() { if (conversationObserver) { conversationObserver.disconnect(); conversationObserver = null; } }
    function startConversationObserver() {
        stopConversationObserver();
        if (destroyed || !waitingForMessage || isProcessing || claimedConversation || cloneModeActive) return;
        conversationObserver = new MutationObserver(records => {
            if (destroyed || !waitingForMessage || isProcessing || claimedConversation || cloneModeActive) return;
            if (f1State === 'blocked') {
                const newWhileBlocked = findNewEligibleTargetNotInSnapshot();
                if (newWhileBlocked) {
                    console.info(`[Pancake Auto] [VÀNG][Observer] mới id=${newWhileBlocked.item.id} index=${newWhileBlocked.index} -> bắt`);
                    f1State = 'armed'; updateStatusDot(); void runTarget(newWhileBlocked); return;
                }
                if (!hasOldEligibleTarget()) {
                    f1State = 'armed'; takeF1Snapshot(); updateStatusDot();
                    console.info('[Pancake Auto] VÀNG -> XANH: hết cũ');
                }
                return;
            }
            if (f1State !== 'armed') return;
            const changedItems = collectChangedItems(records);
            if (changedItems.length) { if (scanWaitingCandidates(changedItems)) return; }
            scanWaitingCandidates([]);
        });
        conversationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ['class', 'src', 'd', 'style'] });
        let intervalId = setInterval(() => {
            if (destroyed || !waitingForMessage || isProcessing || claimedConversation || cloneModeActive) { clearInterval(intervalId); return; }
            if (f1State === 'armed' || f1State === 'blocked') scanWaitingCandidates([]);
        }, 800);
        addCleanup(() => clearInterval(intervalId));
    }

    function cancelWaitingMode() {
        if (destroyed || !waitingForMessage) return;
        waitingForMessage = false; f1State = 'off'; stopConversationObserver(); updateStatusDot();
        console.info('[Pancake Auto] F1 -> OFF.');
    }
    function toggleWaitingMode() {
        if (destroyed || isProcessing) return;
        if (cloneModeActive) { abortAllAutomation(); return; }
        if (waitingForMessage) { cancelWaitingMode(); return; }
        claimedConversation = null;
        waitingForMessage = true;
        takeF1Snapshot();
        const oldTarget = findEligibleF1Target(getConversationItems());
        if (oldTarget) {
            f1State = 'blocked';
            console.info('[Pancake Auto] F1 -> VÀNG. Có target cũ:', oldTarget.type, oldTarget.item.id);
        } else {
            f1State = 'armed';
            console.info('[Pancake Auto] F1 -> XANH. Không có cũ.');
        }
        updateStatusDot();
        startConversationObserver();
    }

    async function runManualComment() {
        if (destroyed || isProcessing || cloneModeActive) return;
        cancelWaitingMode();
        isProcessing = true;
        const gen = abortGeneration;
        const flowId = ++flowCounter;
        try {
            assertNotAborted(gen);
            console.info(`[Pancake Auto] Flow ${flowId} START F2`);
            await sendComposerCommand('/', true, flowId, gen);
            await abortableSleep(CONFIG.WAIT_AFTER_COMMENT_ENTER, gen);
            assertNotAborted(gen);
            await openPreviewAndFill(flowId, gen);
            assertNotAborted(gen);
            console.info(`[Pancake Auto] Flow ${flowId} DONE F2`);
        } catch (e) {
            if (!isAbortError(e)) console.error(`[Pancake Auto] Flow ${flowId} F2 lỗi:`, e);
            else console.info(`[Pancake Auto] Flow ${flowId} F2 bị ESC hủy.`);
        } finally {
            stopSuggestionObserver();
            if (gen === abortGeneration && !destroyed) await sleep(250);
            isProcessing = false;
            updateStatusDot();
        }
    }
    async function runManualTagging() {
        if (destroyed || isProcessing || cloneModeActive) return;
        cancelWaitingMode();
        isProcessing = true;
        const gen = abortGeneration;
        const flowId = ++flowCounter;
        try {
            assertNotAborted(gen);
            console.info(`[Pancake Auto] Flow ${flowId} START F3`);
            await executeTaggingOnly(gen);
            assertNotAborted(gen);
            console.info(`[Pancake Auto] Flow ${flowId} DONE F3`);
        } catch (e) {
            if (!isAbortError(e)) console.error(`[Pancake Auto] Flow ${flowId} F3 lỗi:`, e);
            else console.info(`[Pancake Auto] Flow ${flowId} F3 bị ESC hủy.`);
        } finally {
            stopSuggestionObserver();
            if (gen === abortGeneration && !destroyed) await sleep(250);
            isProcessing = false;
            updateStatusDot();
        }
    }

    function stopCloneObserver() { if (cloneObserver) { cloneObserver.disconnect(); cloneObserver = null; } }
    function stopSuggestionObserver() { if (suggestionObserver) { suggestionObserver.disconnect(); suggestionObserver = null; } }

    function destroy() {
        destroyed = true;
        abortGeneration++;
        stopConversationObserver();
        stopCloneObserver();
        stopSuggestionObserver();
        cleanupFunctions.forEach(fn => { try { fn(); } catch {} });
        const dot = document.getElementById('pancake-waiting-dot');
        if (dot) dot.remove();
        try { delete window[INSTANCE_KEY]; } catch {}
        console.info('[Pancake Auto] Destroyed.');
    }

    const api = { destroy };
    try { window[INSTANCE_KEY] = api; } catch {}

    addManagedEventListener(window, 'keydown', e => {
        if (e.key === 'Escape') { if (waitingForMessage || cloneModeActive || isProcessing) { e.preventDefault(); e.stopPropagation(); abortAllAutomation(); } return; }
        if (e.key === 'F1' || e.keyCode === 112) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (e.repeat) return;
            toggleWaitingMode();
        } else if (e.key === 'F2' || e.keyCode === 113) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (e.repeat) return;
            void runManualComment();
        } else if (e.key === 'F3' || e.keyCode === 114) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (e.repeat) return;
            void runManualTagging();
        }
    }, true);

    updateStatusDot();
    console.info('[Pancake Auto] v13.0 FINAL loaded. Fix yellow: chỉ bắt ID hoàn toàn mới top3 khi vàng, hasOld chỉ check oldEligibleIds, isOld chỉ read->unread là mới.');
})();
