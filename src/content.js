(() => {
  const STATE = {
    landmarks: [],
    headings: [],
    topics: [],
    responses: [],          
    index: { landmark: 0, heading: 0, topic: 0, response: 0 },
    scope: null,              
    live: null,
    useTTS: true,             
    body: {                   
      active: false,
      items: [],
      index: 0
    }
  };

  function createLiveRegion() {
    const live = document.createElement('div');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.style.position = 'fixed';
    live.style.left = '-9999px';
    document.documentElement.appendChild(live);
    STATE.live = live;
  }

  function say(text) {
    if (STATE.live) STATE.live.textContent = '';
    setTimeout(() => { if (STATE.live) STATE.live.textContent = text; }, 10);
    if (STATE.useTTS && chrome?.tts) {
      try { chrome.tts.stop(); } catch {}
      chrome.tts.speak(text, { enqueue: false, rate: 1 });
    }
  }

  const visible = (node) => {
    const r = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const labelById = (el, attr) => {
    const id = el.getAttribute(attr);
    if (!id) return '';
    const t = document.getElementById(id);
    return t ? t.textContent.trim() : '';
  };
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

  function focusAndReveal(el) {
    try { el.setAttribute('tabindex', '-1'); } catch {}
    try { el.focus({ preventScroll: false }); } catch {}
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  }

  const headingLevel = (el) => {
    const m = el?.tagName?.match(/^H([1-6])$/i);
    return m ? parseInt(m[1], 10) : 7;
  };

  function queryLandmarks(root = document) {
    const roles = ['[role="main"]','[role="navigation"]','[role="search"]','[role="banner"]','[role="contentinfo"]','[role="complementary"]','[role="region"]','main','nav','aside','header','footer'];
    return Array.from(root.querySelectorAll(roles.join(',')))
      .filter(visible)
      .map(node => ({ node, label: node.getAttribute('aria-label') || labelById(node,'aria-labelledby') || node.tagName.toLowerCase() }));
  }

  function queryHeadings(root = document) {
    return Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(visible)
      .map(node => ({ node, label: (node.textContent || '').trim() || node.tagName.toLowerCase() }));
  }

  function queryTopics(root = document) {
    const sels = ['[role="article"]','[data-message-id]','.message','.chat-message','article','.card','[role="listitem"]'];
    const nodes = Array.from(root.querySelectorAll(sels.join(','))).filter(visible);
    const seen = new Set(); const out = [];
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      const key = `${Math.round(r.top)}x${Math.round(r.left)}x${Math.round(r.width)}x${Math.round(r.height)}`;
      if (seen.has(key)) continue; seen.add(key);
      const header = node.querySelector('h1,h2,h3,h4,h5,h6');
      const label = node.getAttribute('aria-label') || (header && header.textContent.trim()) || textOf(node).slice(0,120) || 'topic';
      out.push({ node, label });
    }
    return out;
  }

  function queryAssistantResponses(root = document) {
    const sels = [
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[data-testid*="assistant"]',
      '[data-testid*="bot"]',
      '[aria-label*="assistant" i]',
      '[aria-roledescription*="assistant" i]',
      'article',
      '.chat-message',
      '[role="article"]'
    ];
    const cand = Array.from(root.querySelectorAll(sels.join(','))).filter(visible);
    const seen = new Set(); const out = [];
    for (const node of cand) {
      const t = textOf(node);
      if (t.length < 40) continue; 
      const r = node.getBoundingClientRect();
      const key = `${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.width)}:${Math.round(r.height)}`;
      if (seen.has(key)) continue; seen.add(key);
      const label = node.getAttribute('aria-label') || node.querySelector('h1,h2,h3')?.textContent?.trim() || t.slice(0,120);
      out.push({ node, label });
    }
    out.sort((a,b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    return out;
  }

  function rebuildOutline() {
    STATE.landmarks = queryLandmarks(document);
    STATE.responses = queryAssistantResponses(document);
    const root = STATE.scope || document;
    STATE.headings = queryHeadings(root);
    STATE.topics = queryTopics(root);
    for (const k of ['landmark','heading','topic','response']) {
      const arr = k==='landmark'?STATE.landmarks:k==='heading'?STATE.headings:k==='topic'?STATE.topics:STATE.responses;
      STATE.index[k] = Math.min(STATE.index[k], Math.max(arr.length-1, 0));
    }
    if (STATE.body.active) {
      STATE.body.active = false;
      STATE.body.items = [];
      STATE.body.index = 0;
    }
  }

  function collectBodyForHeading(hIndex) {
    const heads = STATE.headings;
    if (!heads.length || hIndex < 0 || hIndex >= heads.length) return [];
    const current = heads[hIndex].node;
    const currLevel = headingLevel(current);

    let stopNode = null;
    for (let i = hIndex + 1; i < heads.length; i++) {
      if (headingLevel(heads[i].node) <= currLevel) { stopNode = heads[i].node; break; }
    }

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          try {
            const cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          } catch {}
          if (/^H[1-6]$/.test(node.tagName)) return NodeFilter.FILTER_SKIP;
          if (!/^(P|LI|DIV|SECTION|ARTICLE|DD|TD|BLOCKQUOTE|PRE)$/i.test(node.tagName)) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const bodyItems = [];
    let inRange = false;
    let n = walker.currentNode;
    while (n) {
      if (n === current) inRange = true;
      else if (stopNode && n === stopNode) break;

      if (inRange && n !== current && visible(n)) {
        const t = textOf(n);
        if (t) bodyItems.push({ node: n, label: t.slice(0, 160) });
      }
      n = walker.nextNode();
    }

    if (!bodyItems.length && current?.nextElementSibling && visible(current.nextElementSibling)) {
      const t = textOf(current.nextElementSibling);
      if (t) bodyItems.push({ node: current.nextElementSibling, label: t.slice(0, 160) });
    }

    return bodyItems;
  }

  function moveTo(collectionName, direction = +1) {
    const items = STATE[collectionName];
    if (!items?.length) { say(`No ${collectionName} found.`); return; }
    const key = collectionName === 'landmarks' ? 'landmark' :
                collectionName === 'headings'  ? 'heading'  :
                collectionName === 'topics'    ? 'topic'    : 'response';
    STATE.index[key] = (STATE.index[key] + direction + items.length) % items.length;
    const { node, label } = items[STATE.index[key]];
    if (collectionName === 'headings' && STATE.body.active) {
      STATE.body.active = false;
      STATE.body.items = [];
      STATE.body.index = 0;
    }
    focusAndReveal(node);
    const human = collectionName.replace(/s$/, '');
    say(`${human} ${STATE.index[key]+1} of ${items.length}: ${label}`);
    if (collectionName === 'responses') {
      setScope(node, `Scoped to response ${STATE.index[key]+1} of ${items.length}.`);
    }
  }

  function setScope(node, preface = 'Scoped.') {
    STATE.scope = node;
    STATE.headings = queryHeadings(node);
    STATE.topics = queryTopics(node);
    STATE.index.heading = 0; STATE.index.topic = 0;
    STATE.body.active = false; STATE.body.items = []; STATE.body.index = 0;

    focusAndReveal(node);
    say(`${preface} Headings and topics limited to this response. Press Alt Shift C to clear scope.`);
  }

  function clearScope() {
    STATE.scope = null;
    rebuildOutline();
    say('Scope cleared. Headings and topics now cover the whole page.');
  }

  function readFrom(name) {
    const key = name==='landmarks'?'landmark':name==='headings'?'heading':name==='topics'?'topic':'response';
    const items = STATE[name];
    if (!items?.length) return say(`No ${name} to read.`);
    const { node } = items[STATE.index[key]];
    const t = textOf(node);
    say(t || 'Nothing readable here.');
  }

  function readCurrentPreferred() {
    if (STATE.body.active) {
      const cur = STATE.body.items[STATE.body.index];
      if (cur) return say(textOf(cur.node));
    }
    if (STATE.scope) {
      const t = textOf(STATE.scope);
      return say(t || 'Nothing readable in scoped response.');
    }
    if (STATE.topics.length) return readFrom('topics');
    if (STATE.landmarks.length) return readFrom('landmarks');
    return readFrom('headings');
  }

  function scopeToLatestResponse() {
    if (!STATE.responses.length) return say('No assistant responses found on this page.');
    STATE.index.response = STATE.responses.length - 1;
    setScope(STATE.responses[STATE.index.response].node, `Scoped to latest response (${STATE.responses.length} of ${STATE.responses.length}).`);
  }

  function bodyCommand() {
    if (!STATE.headings.length) return say('No headings available for body.');

    if (!STATE.body.active) {
      const hIdx = STATE.index.heading ?? 0;
      const items = collectBodyForHeading(hIdx);
      if (!items.length) { say('No body content for this heading.'); return; }
      STATE.body.items = items;
      STATE.body.index = 0;
      STATE.body.active = true;
      const { node, label } = items[0];
      focusAndReveal(node);
      say(`Body item 1 of ${items.length}: ${label}`);
      return;
    }

    const items = STATE.body.items;
    if (!items.length) { STATE.body.active = false; return say('No body content. Back to headings.'); }
    if (STATE.body.index + 1 >= items.length) {
      STATE.body.active = false;
      STATE.body.items = [];
      STATE.body.index = 0;
      const h = STATE.headings[STATE.index.heading];
      if (h?.node) focusAndReveal(h.node);
      return say('End of body. Back to headings.');
    }
    STATE.body.index += 1;
    const { node, label } = items[STATE.body.index];
    focusAndReveal(node);
    say(`Body item ${STATE.body.index + 1} of ${items.length}: ${label}`);
  }

  function init() {
    createLiveRegion();
    rebuildOutline();
    const mo = new MutationObserver(rebuildOutline);
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      // Keyboard commands from background
      if (msg?.type === 'COMMAND') {
        switch (msg.command) {
          case 'next_landmark': moveTo('landmarks', +1); break;
          case 'prev_landmark': moveTo('landmarks', -1); break;
          case 'next_heading':  moveTo('headings',  +1); break;
          case 'prev_heading':  moveTo('headings',  -1); break;
          case 'jump_topics':   moveTo('topics',    +1); break;
          case 'read_current':  readCurrentPreferred(); break;
          case 'scope_current_response': scopeToLatestResponse(); break;
          case 'clear_scope':   clearScope(); break;
          case 'next_response': moveTo('responses', +1); break;
          case 'prev_response': moveTo('responses', -1); break;

          case 'body':          bodyCommand(); break;
        }
      }

      if (msg?.type === 'PANEL_CMD') {
        const { cmd } = msg;
        if (cmd === 'scopeLatest') scopeToLatestResponse();
        if (cmd === 'clearScope')  clearScope();
        if (cmd === 'read')        readCurrentPreferred();
        if (cmd === 'nextHeading') moveTo('headings', +1);
        if (cmd === 'prevHeading') moveTo('headings', -1);
        if (cmd === 'nextResp')    moveTo('responses', +1);
        if (cmd === 'prevResp')    moveTo('responses', -1);
        if (cmd === 'toggleTTS')   { STATE.useTTS = !STATE.useTTS; say(`TTS ${STATE.useTTS ? 'on' : 'off'}.`); }
      }
      if (msg?.type === 'PANEL_QUERY') {
        sendResponse({
          scoped: !!STATE.scope,
          counts: {
            responses: STATE.responses.length,
            headings: STATE.headings.length,
            topics: STATE.topics.length
          },
          tts: STATE.useTTS
        });
      }
    });

    setTimeout(() => {
      say('Semantic Navigator ready. Use Alt Shift J/K for headings, Alt Shift R to read, Alt Shift B for body mode.');
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
