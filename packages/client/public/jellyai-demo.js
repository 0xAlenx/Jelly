(function () {
  var DEMO_QUERY = "demo";
  var NAV_ROOT_SELECTOR = ".sidebar-nav, .app-sidebar, aside, nav";
  var CREDIT_COST = 5;
  var CREDIT_INITIAL = 10000;
  var CREDIT_TODAY_INITIAL = 315;
  var creditBalance = readStoredNumber("jellyai_demo_credits", CREDIT_INITIAL);
  var todayCreditCost = readStoredNumber("jellyai_demo_today_cost", CREDIT_TODAY_INITIAL);
  var creditLowMode = false;
  var moreNavOpen = true;
  var activeMoreNavLabel = "";
  var observerPending = false;
  var jellyaiRemoteReady = false;
  var jellyaiAppState = {
    plan: "物流行业试用版",
    expiresAt: "2026-06-30",
    modelName: "jelly-logistics-pro"
  };
  var routeChunksPrefetched = false;
  var demos = {
    "customer-service": {
      label: "智能客服",
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 10a6 6 0 0 0-12 0v4"/><path d="M6 14a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2"/><path d="M18 14a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2"/><path d="M14 18h-2a2 2 0 0 1-2-2v0"/><path d="M18 14v1a3 3 0 0 1-3 3h-1"/></svg>',
      html: renderCustomerService
    },
    "customer-followup": {
      label: "客户跟进",
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M17 11l2 2 4-4"/><path d="M18 20h3"/></svg>',
      html: renderCustomerFollowup
    }
  };

  function getDemoKey() {
    var hash = window.location.hash || "";
    var query = hash.indexOf("?") >= 0 ? hash.slice(hash.indexOf("?") + 1) : "";
    return new URLSearchParams(query).get(DEMO_QUERY);
  }

  function routeToDemo(key) {
    activeMoreNavLabel = "";
    window.location.hash = "#/hermes/chat?" + DEMO_QUERY + "=" + encodeURIComponent(key);
    setTimeout(renderCurrentDemo, 0);
  }

  function getMain() {
    return document.querySelector(".app-main") || document.querySelector("main");
  }

  function ensureJellyAIBranding() {
    document.title = "JellyAI";
    if (!document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || /SCRIPT|STYLE|TEXTAREA|INPUT/.test(parent.tagName || "")) return NodeFilter.FILTER_REJECT;
        return /Hermes/.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      node.nodeValue = String(node.nodeValue || "")
        .replace(/Hermes Web UI/g, "JellyAI")
        .replace(/Hermes Agent/g, "JellyAI Agent")
        .replace(/\bHermes\b/g, "JellyAI");
    });
  }

  function prefetchOriginalRouteChunks() {
    if (routeChunksPrefetched || !document.head) return;
    routeChunksPrefetched = true;
    [
      "/assets/js/JobsView-BnxmXoK7.js",
      "/assets/js/KanbanView-DAKWcgxZ.js",
      "/assets/js/ChannelsView-Cjs1QNz5.js",
      "/assets/js/PluginsView-DK0HQ-hF.js",
      "/assets/js/MemoryView-Ec9r5bzO.js",
      "/assets/js/ModelsView-D-A-yiQG.js",
      "/assets/js/LogsView-0U6WWEBc.js",
      "/assets/js/UsageView-wwztodDs.js",
      "/assets/js/SettingsView-Dhb8fuWM.js",
      "/assets/js/PerformanceView-CCavvr6N.js",
      "/assets/js/SkillsUsageView-BVcynwjc.js",
      "/assets/js/ProfilesView-HHc3OpBg.js",
      "/assets/js/SkillsView-B5eWufVk.js"
    ].forEach(function (href) {
      if (document.querySelector('link[href="' + href + '"]')) return;
      var link = document.createElement("link");
      link.rel = "modulepreload";
      link.href = href;
      document.head.appendChild(link);
    });
  }

  function readStoredNumber(key, fallback) {
    try {
      if (!window.localStorage) return fallback;
      var stored = parseInt(window.localStorage.getItem(key) || "", 10);
      return Number.isFinite(stored) ? stored : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeStoredNumber(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, String(value));
    } catch (error) {
      return;
    }
  }

  function getCredits() {
    if (creditLowMode) return creditBalance;
    return jellyaiRemoteReady && Number.isFinite(Number(jellyaiAppState.credits))
      ? Number(jellyaiAppState.credits)
      : creditBalance;
  }

  function getTodayCost() {
    return jellyaiRemoteReady && Number.isFinite(Number(jellyaiAppState.todayCost))
      ? Number(jellyaiAppState.todayCost)
      : todayCreditCost;
  }

  function getPlan() {
    return jellyaiAppState.plan || "物流行业试用版";
  }

  function getExpiry() {
    return jellyaiAppState.expiresAt || "2026-06-30";
  }

  function getModelName() {
    return jellyaiAppState.modelName || "jelly-logistics-pro";
  }

  function setCredits(nextCredits, nextTodayCost) {
    creditBalance = Math.max(0, nextCredits);
    todayCreditCost = Math.max(CREDIT_TODAY_INITIAL, nextTodayCost);
    writeStoredNumber("jellyai_demo_credits", creditBalance);
    writeStoredNumber("jellyai_demo_today_cost", todayCreditCost);
    updateCreditDisplays();
  }

  function applyJellyAIState(data) {
    if (!data) return;
    jellyaiRemoteReady = true;
    jellyaiAppState = {
      credits: Number(data.credits),
      todayCost: Number(data.todayCost),
      plan: data.plan || "物流行业试用版",
      expiresAt: data.expiresAt || "2026-06-30",
      modelName: data.model && data.model.name || jellyaiAppState.modelName || "jelly-logistics-pro"
    };
    if (!creditLowMode) {
      creditBalance = Math.max(0, Number(jellyaiAppState.credits) || 0);
      todayCreditCost = Math.max(0, Number(jellyaiAppState.todayCost) || 0);
    }
    updateCreditDisplays();
    enableModelControls();
  }

  function syncJellyAIState() {
    fetch("/api/jellyai/me", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("JellyAI API unavailable");
        return response.json();
      })
      .then(applyJellyAIState)
      .catch(function () {
        jellyaiRemoteReady = false;
        updateCreditDisplays();
      });
  }

  function postCreditDelta(delta, message) {
    if (!jellyaiRemoteReady) return;
    fetch("/api/jellyai/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta: delta, message: message })
    })
      .then(function (response) {
        if (!response.ok) throw new Error("credit update failed");
        return response.json();
      })
      .then(function () {
        syncJellyAIState();
      })
      .catch(function () {
        return;
      });
  }

  function formatNumber(num) {
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function setTextIfChanged(node, value) {
    var next = String(value);
    if (node && node.textContent !== next) node.textContent = next;
  }

  function ensureCreditPanel() {
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar || sidebar.querySelector(".jellyai-credit-panel")) return;
    var panel = document.createElement("section");
    panel.className = "jellyai-credit-panel";
    panel.innerHTML =
      '<div class="jellyai-credit-compact-row">' +
      '<div><span>剩余积分</span><strong data-jellyai-credit-balance>10,000</strong></div>' +
      '<div><span>今日消耗</span><strong data-jellyai-today-cost>315</strong></div>' +
      "</div>" +
      '<div class="jellyai-credit-model">后台默认：<span data-jellyai-model-name>jelly-logistics-pro</span></div>';

    var footer = sidebar.querySelector(".sidebar-footer");
    var modelSelector = sidebar.querySelector(".model-selector");
    if (footer) {
      sidebar.insertBefore(panel, footer);
    } else if (modelSelector && modelSelector.parentElement === sidebar) {
      sidebar.insertBefore(panel, modelSelector);
    } else {
      sidebar.appendChild(panel);
    }
    updateCreditDisplays();
  }

  function updateCreditDisplays() {
    var credits = getCredits();
    var todayCost = getTodayCost();
    Array.prototype.forEach.call(document.querySelectorAll("[data-jellyai-credit-balance]"), function (node) {
      setTextIfChanged(node, formatNumber(credits));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-jellyai-today-cost]"), function (node) {
      setTextIfChanged(node, formatNumber(todayCost));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-jellyai-next-cost]"), function (node) {
      setTextIfChanged(node, CREDIT_COST);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-jellyai-plan]"), function (node) {
      setTextIfChanged(node, getPlan());
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-jellyai-expiry]"), function (node) {
      setTextIfChanged(node, getExpiry());
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-jellyai-model-name]"), function (node) {
      setTextIfChanged(node, getModelName());
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-jellyai-credit-low]"), function (button) {
      setTextIfChanged(button, creditLowMode ? "退出积分不足" : "模拟积分不足");
      button.classList.toggle("is-low", creditLowMode);
    });
  }

  function enableModelControls() {
    Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (item) {
      if (/^Models$|模型/.test((item.textContent || "").trim())) {
        item.classList.remove("jellyai-hidden-model-entry");
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll(".model-selector"), function (selector) {
      selector.classList.remove("jellyai-managed-model-selector");
      var existingNote = selector.querySelector(".jellyai-managed-model-note");
      if (existingNote) existingNote.remove();
    });
  }

  function isChatRoute() {
    var hash = window.location.hash || "";
    return hash.indexOf("#/hermes/chat") === 0 && !getDemoKey();
  }

  function ensureChatCreditBar() {
    Array.prototype.slice.call(document.querySelectorAll(".jellyai-chat-credit-bar")).forEach(function (bar) {
      bar.remove();
    });
  }

  function findMessageEntry() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll("textarea, input, [contenteditable='true'], [role='textbox']"));
    return nodes.find(function (node) {
      var text = [
        node.getAttribute("placeholder"),
        node.getAttribute("aria-label"),
        node.textContent,
        node.getAttribute("data-placeholder")
      ].join(" ");
      return /输入消息|Enter 发送|Shift\+Enter|message/i.test(text);
    });
  }

  function findComposerRoot(entry) {
    var node = entry;
    var best = entry.parentElement || entry;
    for (var index = 0; node && index < 8; index += 1) {
      var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      var buttons = node.querySelectorAll ? node.querySelectorAll("button").length : 0;
      var text = node.textContent || "";
      if (rect && rect.width > 320 && rect.height <= 180 && rect.bottom > window.innerHeight - 220 && (buttons >= 2 || /发送|Send/.test(text))) {
        best = node;
      }
      node = node.parentElement;
    }
    return best;
  }

  function ensureComposerVisible() {
    Array.prototype.slice.call(document.querySelectorAll(".jellyai-composer-lift")).forEach(function (node) {
      node.classList.remove("jellyai-composer-lift");
    });
  }

  function showCreditToast(message, kind) {
    var existing = document.querySelector(".jellyai-credit-toast");
    if (existing) existing.remove();
    var toast = document.createElement("div");
    toast.className = "jellyai-credit-toast " + (kind || "success");
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.classList.add("show");
    }, 20);
    setTimeout(function () {
      toast.classList.remove("show");
      setTimeout(function () {
        toast.remove();
      }, 180);
    }, 2200);
  }

  function consumeCreditsForDemo() {
    var credits = getCredits();
    var todayCost = getTodayCost();
    if (credits < CREDIT_COST) {
      showCreditToast("积分不足，请联系管理员充值", "error");
      return false;
    }
    if (jellyaiRemoteReady && !creditLowMode) {
      jellyaiAppState.credits = credits - CREDIT_COST;
      jellyaiAppState.todayCost = todayCost + CREDIT_COST;
      updateCreditDisplays();
      postCreditDelta(-CREDIT_COST, "AI 对话使用物流助手消耗积分");
    } else {
      setCredits(credits - CREDIT_COST, todayCost + CREDIT_COST);
    }
    showCreditToast("本次已消耗 " + CREDIT_COST + " 积分", "success");
    return true;
  }

  window.JellyAIDemoSetLowCredits = function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (creditLowMode) {
      creditLowMode = false;
      if (jellyaiRemoteReady) {
        syncJellyAIState();
      } else {
        setCredits(CREDIT_INITIAL, CREDIT_TODAY_INITIAL);
      }
      showCreditToast("已恢复正常使用", "success");
      return;
    }
    creditLowMode = true;
    setCredits(0, getTodayCost());
    showCreditToast("已切换到积分不足演示状态", "error");
  };

  function isLikelySendButton(button) {
    var text = (button.textContent || button.getAttribute("aria-label") || button.title || "").trim();
    var className = String(button.className || "");
    if (/发送|Send|submit|paper|arrow|chat/i.test(text + " " + className)) return true;
    var rect = button.getBoundingClientRect();
    var main = getMain();
    if (!main) return false;
    var mainRect = main.getBoundingClientRect();
    return rect.width <= 72 && rect.height <= 72 && rect.bottom > mainRect.bottom - 160 && rect.right > mainRect.right - 220;
  }

  function setupCreditInterceptors() {
    if (window.__jellyaiCreditInterceptorsReady) return;
    window.__jellyaiCreditInterceptorsReady = true;

    document.addEventListener(
      "click",
      function (event) {
        var lowBtn = event.target.closest && event.target.closest("[data-jellyai-credit-low]");
        if (lowBtn) {
          event.preventDefault();
          event.stopPropagation();
          window.JellyAIDemoSetLowCredits();
          return;
        }
        if (!isChatRoute()) return;
        var button = event.target.closest && event.target.closest("button");
        if (!button || button.closest(".jellyai-chat-credit-bar")) return;
        if (!isLikelySendButton(button)) return;
        if (!consumeCreditsForDemo()) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        }
      },
      true
    );

    document.addEventListener(
      "keydown",
      function (event) {
        if (!isChatRoute()) return;
        if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
        var target = event.target;
        if (!target || !/TEXTAREA|INPUT/.test(target.tagName || "")) return;
        if (!consumeCreditsForDemo()) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        }
      },
      true
    );
  }

  function findBestNavRoot() {
    var nativeSidebarNav = document.querySelector(".sidebar-nav");
    if (nativeSidebarNav) return nativeSidebarNav;
    var roots = Array.prototype.slice.call(document.querySelectorAll(NAV_ROOT_SELECTOR));
    var scored = roots
      .map(function (node) {
        var text = node.textContent || "";
        var score = 0;
        if (/对话|历史|群聊|任务|搜索|Chat|History/.test(text)) score += 5;
        if (node.querySelector(".nav-item")) score += 5;
        if (node.className && String(node.className).indexOf("sidebar") >= 0) score += 3;
        return { node: node, score: score };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });
    return scored.length && scored[0].score > 0 ? scored[0].node : null;
  }

  function findInsertContainer(navRoot) {
    var existingItems = Array.prototype.slice.call(navRoot.querySelectorAll(".nav-item"));
    var agentItem = existingItems.find(function (item) {
      return /任务|Jobs|Skills|技能|渠道|Channels/.test(item.textContent || "");
    });
    return agentItem && agentItem.parentElement ? agentItem.parentElement : navRoot;
  }

  function createButton(key, demo) {
    var button = document.createElement("a");
    button.href = "#/hermes/chat?" + DEMO_QUERY + "=" + encodeURIComponent(key);
    button.className = "route-link-item nav-item jellyai-demo-nav";
    button.dataset.jellyaiDemo = key;
    button.setAttribute("onclick", "event.preventDefault();event.stopPropagation();window.location.href=this.getAttribute('href');return false;");
    button.setAttribute("aria-label", demo.label);
    button.innerHTML = demo.icon + '<span class="nav-label">' + demo.label + "</span>";
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      routeToDemo(key);
    });
    return button;
  }

  function createAdminButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item jellyai-demo-nav jellyai-admin-nav";
    button.dataset.jellyaiAdminNav = "true";
    button.setAttribute("onclick", "window.JellyAIOpenAdminGate && window.JellyAIOpenAdminGate(event)");
    button.setAttribute("aria-label", "后台管理");
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10"/><path d="M7 12h4"/><path d="M14 12h3"/><path d="M7 16h10"/></svg><span class="nav-label">后台管理</span>';
    return button;
  }

  function createSkillProxyButton() {
    var button = document.createElement("a");
    button.href = "#/hermes/skills";
    button.className = "nav-item jellyai-demo-nav jellyai-skill-proxy";
    button.dataset.jellyaiSkillProxy = "true";
    button.setAttribute("onclick", "event.preventDefault();event.stopPropagation();window.location.href=this.getAttribute('href');return false;");
    button.setAttribute("aria-label", "技能");
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 14.5a6 6 0 1 1 7 0c-.9.7-1.5 1.8-1.5 3h-4c0-1.2-.6-2.3-1.5-3z"/></svg><span class="nav-label">技能</span>';
    return button;
  }

  var extraNavItems = [
    { label: "任务", match: /^(任务|Jobs)$/i, hash: "#/hermes/jobs" },
    { label: "看板", match: /^(看板|Kanban)$/i, hash: "#/hermes/kanban" },
    { label: "频道", match: /^(频道|Channels)$/i, hash: "#/hermes/channels" },
    { label: "插件", match: /^(插件|Plugins)$/i, hash: "#/hermes/plugins" },
    { label: "记忆", match: /^(记忆|Memory)$/i, hash: "#/hermes/memory" },
    { label: "模型", match: /^(模型|Models)$/i, hash: "#/hermes/models" },
    { label: "日志", match: /^(日志|Logs)$/i, hash: "#/hermes/logs" },
    { label: "用量", match: /^(用量|Usage)$/i, hash: "#/hermes/usage" },
    { label: "网关", match: /^(网关|Gateways)$/i, hash: "#/hermes/settings" },
    { label: "性能监控", match: /^(性能监控|Performance)$/i, hash: "#/hermes/performance" },
    { label: "技能用量", match: /^(技能用量|SkillsUsage)$/i, hash: "#/hermes/skills-usage" },
    { label: "用户", match: /^(用户|Profiles)$/i, hash: "#/hermes/profiles" },
    { label: "设置", match: /^(设置|Settings)$/i, hash: "#/hermes/settings" }
  ];

  function extraNavIcon(label) {
    var icons = {
      "任务": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/></svg>',
      "看板": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 4v16"/></svg>',
      "频道": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/><path d="M8 3v4"/><path d="M16 10v4"/></svg>',
      "插件": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v4"/><path d="M16 3v4"/><path d="M7 7h10v4a5 5 0 0 1-10 0V7z"/><path d="M12 16v5"/></svg>',
      "记忆": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V5a1 1 0 0 1 1-1z"/><path d="M8 8h7"/><path d="M8 12h6"/></svg>',
      "模型": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v3"/><path d="M12 19v3"/><path d="M4.9 4.9 7 7"/><path d="M17 17l2.1 2.1"/><path d="M2 12h3"/><path d="M19 12h3"/><circle cx="12" cy="12" r="4"/></svg>',
      "日志": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>',
      "用量": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></svg>',
      "网关": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10"/><path d="M7 13h4"/><path d="M15 13h2"/></svg>',
      "性能监控": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
      "技能用量": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4"/><path d="M7 8h10"/><path d="M8 12h8"/><path d="M6 21h12"/><path d="M9 21v-5h6v5"/></svg>',
      "用户": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
      "设置": '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-2 .3 1.7 1.7 0 0 0-.7 1.4H9.1a1.7 1.7 0 0 0-.7-1.4 1.7 1.7 0 0 0-2-.3l-.2.1-2-3.4.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14V10a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 2-.3A1.7 1.7 0 0 0 9.1 2h5.8a1.7 1.7 0 0 0 .7 1.4 1.7 1.7 0 0 0 2 .3l.2-.1 2 3.4-.1.1A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 21 10v4a1.7 1.7 0 0 0-1.6 1z"/></svg>'
    };
    return icons[label] || "";
  }

  function createMoreMenu() {
    var menu = document.createElement("div");
    menu.className = "jellyai-more-menu";
    menu.dataset.jellyaiMoreMenu = "true";
    menu.innerHTML = extraNavItems
      .map(function (item) {
        return '<a href="' + item.hash + '" class="nav-item jellyai-more-menu-item jellyai-demo-nav" data-jellyai-more-target="' + item.label + '" data-jellyai-more-hash="' + item.hash + '" onclick="event.preventDefault();event.stopPropagation();window.location.href=this.getAttribute(&quot;href&quot;);return false;" aria-label="' + item.label + '">' +
          extraNavIcon(item.label) + '<span class="nav-label">' + item.label + "</span></a>";
      })
      .join("");
    return menu;
  }

  function ensureFloatingMoreMenu() {
    Array.prototype.slice.call(document.querySelectorAll('[data-jellyai-floating-more-menu="true"]')).forEach(function (menu) {
      menu.remove();
    });
    return null;
  }

  function normalizeNavText(text) {
    return String(text || "")
      .replace(/\(beta\)/gi, "")
      .replace(/\s+/g, "");
  }

  function openOriginalNav(label) {
    var config = extraNavItems.find(function (item) {
      return item.label === label;
    });
    if (!config) return false;
    activeMoreNavLabel = label;
    if (window.location.hash !== config.hash) window.location.hash = config.hash;
    moreNavOpen = true;
    var currentNavRoot = findBestNavRoot();
    if (currentNavRoot) {
      applyMoreNavState(currentNavRoot);
      updateActiveNav();
    }
    return true;
  }

  function openMoreNavItem(event, label) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    return openOriginalNav(label);
  }

  function openSkillsRoute() {
    window.location.hash = "#/hermes/skills";
  }

  function openAdminGate() {
    try {
      if (window.sessionStorage && window.sessionStorage.getItem("jellyai_admin_authed") === "true") {
        window.location.href = "/jellyai-admin.html";
        return;
      }
    } catch (error) {
      return;
    }
    closeAdminGate();
    var modal = document.createElement("div");
    modal.className = "jellyai-admin-gate-backdrop";
    modal.innerHTML =
      '<div class="jellyai-admin-gate" role="dialog" aria-modal="true">' +
      '<button type="button" class="jellyai-admin-gate-close" data-jellyai-admin-close aria-label="关闭">×</button>' +
      '<div class="jellyai-admin-gate-title">后台管理</div>' +
      '<div class="jellyai-admin-gate-desc">请输入后台密码后进入模型、积分和授权管理。</div>' +
      '<input class="jellyai-admin-gate-input" type="password" placeholder="请输入密码" autocomplete="current-password" data-jellyai-admin-password>' +
      '<div class="jellyai-admin-gate-error" data-jellyai-admin-error></div>' +
      '<button type="button" class="jellyai-admin-gate-submit" data-jellyai-admin-submit>进入后台</button>' +
      "</div>";
    document.body.appendChild(modal);
    setTimeout(function () {
      var input = modal.querySelector("[data-jellyai-admin-password]");
      if (input) input.focus();
    }, 30);
  }

  function closeAdminGate() {
    var existing = document.querySelector(".jellyai-admin-gate-backdrop");
    if (existing) existing.remove();
  }

  function submitAdminGate() {
    var input = document.querySelector("[data-jellyai-admin-password]");
    var error = document.querySelector("[data-jellyai-admin-error]");
    if (!input) return;
    if (input.value === "jellyai") {
      try {
        if (window.sessionStorage) window.sessionStorage.setItem("jellyai_admin_authed", "true");
      } catch (ignore) {
        return;
      }
      closeAdminGate();
      window.location.href = "/jellyai-admin.html";
      return;
    }
    if (error) error.textContent = "密码错误，请重新输入";
    input.select();
  }

  function navKey(item) {
    if (!item) return "";
    if (item.dataset && item.dataset.jellyaiAdminNav) return "后台管理";
    if (item.dataset && item.dataset.jellyaiDemo === "customer-service") return "智能客服";
    if (item.dataset && item.dataset.jellyaiDemo === "customer-followup") return "客户跟进";
    var text = (item.textContent || "").replace(/\s+/g, "");
    if (/^对话$|^Chat$/i.test(text)) return "对话";
    if (/^历史$|^History$/i.test(text)) return "历史";
    if (/^搜索$|^Search$/i.test(text)) return "搜索";
    if (/^群聊/.test(text)) return "群聊";
    if (/^技能$|^Skills$/i.test(text)) return "技能";
    return text;
  }

  function ensureSidebarLayout(navRoot) {
    if (!navRoot) return;

    navRoot.classList.remove("jellyai-nav-more-open");
    if (document.body) document.body.classList.remove("jellyai-nav-more-open");

    Array.prototype.slice.call(navRoot.querySelectorAll("[data-jellyai-more-toggle], [data-jellyai-more-menu], [data-jellyai-admin-nav], [data-jellyai-skill-proxy]")).forEach(function (node) {
      node.remove();
    });

    Array.prototype.slice.call(document.querySelectorAll(".fun-link, .github-link, .website-link, a[href*='apikey.fun'], a[href*='github.com/EKKOLearnAI/hermes-web-ui'], a[href*='ekkolearnai.com']")).forEach(function (node) {
      node.remove();
    });

    Array.prototype.slice.call(navRoot.querySelectorAll(".nav-item")).forEach(function (node) {
      var text = normalizeNavText(node.textContent || "");
      var href = node.getAttribute && node.getAttribute("href") || "";
      if (/^(中转站|APIRelay)$/.test(text) || /apikey\.fun/.test(href)) node.remove();
    });

    Array.prototype.slice.call(navRoot.querySelectorAll(".nav-item, *")).forEach(function (node) {
      if (!node.classList) return;
      node.classList.remove(
        "jellyai-core-nav",
        "jellyai-extra-nav",
        "jellyai-secondary-nav",
        "jellyai-original-skill-nav",
        "jellyai-more-menu-nav",
        "jellyai-legacy-section-hidden"
      );
    });

    var group = Array.prototype.slice.call(document.querySelectorAll(".jellyai-demo-bottom-group")).find(function (node) {
      return node.parentElement === navRoot;
    });
    Array.prototype.slice.call(document.querySelectorAll(".jellyai-demo-bottom-group")).forEach(function (node) {
      if (node !== group) node.remove();
    });

    if (!group) {
      group = document.createElement("div");
      group.className = "nav-group jellyai-demo-bottom-group";
      group.innerHTML = '<div class="nav-group-title">JellyAI</div><div class="nav-group-items"></div>';
      navRoot.appendChild(group);
    }

    var items = group.querySelector(".nav-group-items");
    if (!items) {
      items = document.createElement("div");
      items.className = "nav-group-items";
      group.appendChild(items);
    }
    Object.keys(demos).forEach(function (key) {
      var existing = group.querySelector('[data-jellyai-demo="' + key + '"]');
      if (!existing) items.appendChild(createButton(key, demos[key]));
    });
    if (group.parentElement !== navRoot) navRoot.appendChild(group);
  }

  function hideLegacySectionLabels(navRoot) {
    Array.prototype.slice.call(navRoot.querySelectorAll("*")).forEach(function (node) {
      if (node.closest && node.closest(".nav-item")) {
        node.classList && node.classList.remove("jellyai-legacy-section-hidden");
        return;
      }
      if (node.classList && node.classList.contains("nav-item")) return;
      if (node.querySelector && node.querySelector(".nav-item")) return;
      var text = (node.textContent || "").replace(/\s+/g, "");
      if (/^(对话|代理|监控|系统)$/.test(text)) {
        node.classList.add("jellyai-legacy-section-hidden");
      }
    });
  }

  function applyMoreNavState(navRoot) {
    var toggle = navRoot.querySelector("[data-jellyai-more-toggle]");
    moreNavOpen = true;
    navRoot.classList.toggle("jellyai-nav-more-open", moreNavOpen);
    if (document.body) document.body.classList.toggle("jellyai-nav-more-open", moreNavOpen);
    if (toggle) toggle.classList.toggle("open", moreNavOpen);
    if (toggle) toggle.setAttribute("aria-expanded", moreNavOpen ? "true" : "false");
  }

  function toggleMoreNav(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    moreNavOpen = true;
    var navRoot = findBestNavRoot();
    if (navRoot) {
      ensureSidebarLayout(navRoot);
      applyMoreNavState(navRoot);
    }
  }

  function ensureDemoNav() {
    var navRoot = findBestNavRoot();
    if (!navRoot) return;
    ensureSidebarLayout(navRoot);
    navRoot.dataset.jellyaiNavReady = "true";
    updateActiveNav();
  }

  function updateActiveNav() {
    var key = getDemoKey();
    Array.prototype.forEach.call(document.querySelectorAll(".jellyai-demo-nav"), function (button) {
      button.classList.toggle("active", button.dataset.jellyaiDemo === key);
    });
    if (key && demos[key]) {
      Array.prototype.forEach.call(document.querySelectorAll(".nav-item:not(.jellyai-demo-nav)"), function (button) {
        button.classList.remove("active", "router-link-active", "router-link-exact-active");
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll(".jellyai-demo-nav"), function (button) {
      button.setAttribute("aria-current", button.classList.contains("active") ? "page" : "false");
    });
  }

  function restoreMainFromDemo(main) {
    if (!main) return;
    Array.prototype.forEach.call(main.children, function (child) {
      child.classList.remove("jellyai-demo-hidden");
    });
    Array.prototype.slice.call(main.querySelectorAll(":scope > .jellyai-demo-page")).forEach(function (page) {
      page.remove();
    });
    delete main.dataset.jellyaiDemoPage;
  }

  function hideMainForDemo(main, demoPage) {
    Array.prototype.forEach.call(main.children, function (child) {
      child.classList.toggle("jellyai-demo-hidden", child !== demoPage);
    });
  }

  function renderCurrentDemo() {
    var key = getDemoKey();
    updateActiveNav();
    var main = getMain();
    if (!main) return;
    if (!key || !demos[key]) {
      restoreMainFromDemo(main);
      return;
    }
    var existingPage = main.querySelector(":scope > .jellyai-demo-page");
    if (main.dataset.jellyaiDemoPage === key && existingPage) {
      hideMainForDemo(main, existingPage);
      return;
    }
    restoreMainFromDemo(main);

    var template = document.createElement("template");
    template.innerHTML = demos[key].html();
    var page = template.content.firstElementChild;
    if (!page) return;
    main.dataset.jellyaiDemoPage = key;
    main.insertBefore(page, main.firstChild);
    hideMainForDemo(main, page);
    main.scrollTop = 0;
  }

  function flowSteps(items) {
    return items
      .map(function (item, index) {
        var tag = index < 2 ? "配置" : index < 7 ? "AI处理" : "同步";
        return '<div class="jellyai-demo-step"><div class="jellyai-demo-step-number">' +
          String(index + 1).padStart(2, "0") +
          '</div><div class="jellyai-demo-step-title">' +
          item +
          '</div><div class="jellyai-demo-step-tag">' +
          tag +
          "</div></div>";
      })
      .join("");
  }

  function renderCustomerService() {
    return '<section class="jellyai-demo-page">' +
      '<header class="jellyai-demo-header"><div><div class="jellyai-demo-title">智能客服配置</div><div class="jellyai-demo-subtitle">配置微信客服、知识库、回复策略和客户意向识别。</div></div><div class="jellyai-demo-header-actions"><label class="jellyai-demo-action-btn" for="jellyai-modal-toggle-service-flow" onclick="document.getElementById(\'jellyai-modal-backdrop-service-flow\').style.display=\'flex\'">查看智能客服流程</label><div class="jellyai-demo-status">演示运行中</div></div></header>' +
      '<div class="jellyai-demo-content">' +
      '<div class="jellyai-demo-grid">' +
      configCard("wechat", "微信渠道", "已绑定", "企业微信客服 · 3 个接待账号在线") +
      configCard("knowledge", "知识库", "12 个文档", "FAQ、产品资料、价格政策可被 AI 调用") +
      configCard("reply", "回复策略", "自动优先", "低风险问题自动回复，高风险转人工确认") +
      configCard("intent", "意向标记", "开启", "自动识别高意向、犹豫、售后咨询等类型") +
      "</div>" +
      '<div class="jellyai-demo-columns service-dashboard">' +
      '<div class="jellyai-demo-panel"><div class="jellyai-demo-panel-head"><div class="jellyai-demo-panel-title">智能客服概览</div><label class="jellyai-demo-inline-btn" for="jellyai-modal-toggle-wechat" onclick="document.getElementById(\'jellyai-modal-backdrop-wechat\').style.display=\'flex\'">新增客服</label></div>' +
      '<div class="jellyai-service-list">' +
      serviceAgent("JellyAI 售前客服", "运行中", "微信客服", "今日接待 86", "自动回复率 78%", "高意向 12") +
      serviceAgent("JellyAI 售后客服", "运行中", "企微群聊", "今日接待 34", "自动回复率 71%", "待人工 5") +
      serviceAgent("价格咨询助手", "待优化", "公众号", "今日接待 21", "自动回复率 64%", "知识命中 89%") +
      "</div></div>" +
      '<div class="jellyai-demo-panel"><div class="jellyai-demo-panel-head"><div class="jellyai-demo-panel-title">运行情况</div><span class="jellyai-demo-chip">近 24 小时</span></div>' +
      '<div class="jellyai-runtime-grid">' +
      runtimeMetric("会话总量", "141", "+18%") +
      runtimeMetric("AI 已回复", "109", "平均 4.2 秒") +
      runtimeMetric("转人工", "17", "主要为退款/投诉") +
      runtimeMetric("同步线索", "32", "已进入跟进面板") +
      "</div>" +
      '<div class="jellyai-demo-message compact"><div class="jellyai-demo-message-title">实时提醒</div><div class="jellyai-demo-message-body">检测到「企业版报价」相关问题增加，建议检查价格政策文档是否为最新版本。</div></div>' +
      "</div></div>" +
      '<div class="jellyai-demo-panel"><div class="jellyai-demo-panel-head"><div class="jellyai-demo-panel-title">微信客服数据面板</div><span class="jellyai-demo-chip">企业微信</span></div>' +
      '<div class="jellyai-wechat-metrics">' +
      dataMetric("当前排队", "6", "2 个高优先级") +
      dataMetric("平均首响", "8 秒", "低于目标 12 秒") +
      dataMetric("知识命中率", "91%", "价格/接入类最高") +
      dataMetric("客户满意度", "96%", "来自 53 条反馈") +
      "</div>" +
      '<div class="jellyai-table">' +
      dataRow("企业版价格咨询", "价格政策", "自动回复", "高意向") +
      dataRow("如何绑定企业微信", "渠道接入", "AI 引导", "中意向") +
      dataRow("申请退款流程", "售后问题", "转人工", "风险") +
      dataRow("想看行业案例", "资料索取", "发送案例", "高意向") +
      "</div></div></div>" +
      serviceStaticModals() +
      "</section>";
  }

  function renderCustomerFollowup() {
    var steps = [
      "客户发生咨询",
      "AI 自动总结客户需求",
      "系统生成客户卡片",
      "判断意向等级",
      "生成跟进建议",
      "销售查看客户",
      "销售更新状态",
      "后续聊天继续同步更新"
    ];
    return '<section class="jellyai-demo-page">' +
      '<header class="jellyai-demo-header"><div><div class="jellyai-demo-title">客户跟进流程</div><div class="jellyai-demo-subtitle">演示版销售跟进面板，展示 AI 如何把咨询自动沉淀为客户线索。</div></div><div class="jellyai-demo-status">线索同步中</div></header>' +
      '<div class="jellyai-demo-content">' +
      '<div class="jellyai-demo-grid">' +
      card("今日咨询", "28", "来自微信、网页和历史会话") +
      card("高意向客户", "6", "已生成优先跟进建议") +
      card("待销售确认", "9", "需要补充预算、时间或决策人信息") +
      card("已更新卡片", "42", "聊天摘要持续同步") +
      "</div>" +
      '<div class="jellyai-demo-columns">' +
      '<div class="jellyai-demo-panel"><div class="jellyai-demo-panel-head"><div class="jellyai-demo-panel-title">客户跟进流程</div><span class="jellyai-demo-chip">8 步</span></div><div class="jellyai-demo-flow">' +
      flowSteps(steps) +
      "</div></div>" +
      '<div class="jellyai-demo-panel"><div class="jellyai-demo-panel-head"><div class="jellyai-demo-panel-title">跟进建议</div><span class="jellyai-demo-chip">AI 生成</span></div>' +
      '<div class="jellyai-demo-suggestion"><strong>优先联系：李女士</strong><span>客户关注企业版价格、微信接入周期和售后响应。建议 30 分钟内发送报价单，并确认试点团队规模。</span></div>' +
      '<div class="jellyai-demo-suggestion"><strong>补充信息：王经理</strong><span>客户提到已有竞品方案。建议追问当前痛点、预算周期和上线时间，判断是否需要售前介入。</span></div>' +
      '<div class="jellyai-demo-suggestion"><strong>持续培育：陈同学</strong><span>需求较早期，可发送产品介绍和案例，三天后自动提醒再次触达。</span></div>' +
      "</div></div>" +
      '<div class="jellyai-demo-panel"><div class="jellyai-demo-panel-head"><div class="jellyai-demo-panel-title">客户卡片</div><span class="jellyai-demo-chip">示例数据</span></div><div class="jellyai-demo-board">' +
      lane("high", "高意向", [
        ["李女士", "企业微信 · 12分钟前", "需要企业版报价，计划本周安排试用。"],
        ["赵总", "公众号 · 35分钟前", "关注多门店接待效率，已有预算。"]
      ]) +
      lane("medium", "中意向", [
        ["王经理", "网页咨询 · 1小时前", "正在比较同类产品，希望了解部署方式。"],
        ["刘老师", "历史会话 · 昨天", "想先看知识库自动回复效果。"]
      ]) +
      lane("low", "待培育", [
        ["陈同学", "微信 · 2小时前", "初步了解功能，暂未明确采购时间。"],
        ["周先生", "公众号 · 昨天", "询问基础功能，需持续同步后续聊天。"]
      ]) +
      "</div></div></div></section>";
  }

  function card(label, value, note) {
    return '<div class="jellyai-demo-card"><div class="jellyai-demo-card-label">' +
      label +
      '</div><div class="jellyai-demo-card-value">' +
      value +
      '</div><div class="jellyai-demo-card-note">' +
      note +
      "</div></div>";
  }

  function configCard(modal, label, value, note) {
    return '<label class="jellyai-demo-card jellyai-demo-config-card" for="jellyai-modal-toggle-' +
      modal +
      '" onclick="document.getElementById(\'jellyai-modal-backdrop-' +
      modal +
      '\').style.display=\'flex\'"><div class="jellyai-demo-card-label">' +
      label +
      '</div><div class="jellyai-demo-card-value">' +
      value +
      '</div><div class="jellyai-demo-card-note">' +
      note +
      '</div><div class="jellyai-demo-card-link">点击配置</div></label>';
  }

  function serviceAgent(name, status, channel, sessions, replyRate, intent) {
    return '<div class="jellyai-service-agent"><div class="jellyai-service-agent-head"><div><div class="jellyai-service-name">' +
      name +
      '</div><div class="jellyai-service-channel">' +
      channel +
      '</div></div><span class="jellyai-demo-chip">' +
      status +
      '</span></div><div class="jellyai-service-stats"><span>' +
      sessions +
      '</span><span>' +
      replyRate +
      '</span><span>' +
      intent +
      "</span></div></div>";
  }

  function runtimeMetric(label, value, note) {
    return '<div class="jellyai-runtime-metric"><div class="jellyai-demo-card-label">' +
      label +
      '</div><div class="jellyai-runtime-value">' +
      value +
      '</div><div class="jellyai-demo-card-note">' +
      note +
      "</div></div>";
  }

  function dataMetric(label, value, note) {
    return '<div class="jellyai-data-metric"><div class="jellyai-demo-card-label">' +
      label +
      '</div><div class="jellyai-runtime-value">' +
      value +
      '</div><div class="jellyai-demo-card-note">' +
      note +
      "</div></div>";
  }

  function dataRow(topic, category, action, intent) {
    return '<div class="jellyai-table-row"><span>' +
      topic +
      '</span><span>' +
      category +
      '</span><span>' +
      action +
      '</span><span>' +
      intent +
      "</span></div>";
  }

  function kv(key, value) {
    return '<div class="jellyai-demo-kv-row"><span class="jellyai-demo-kv-key">' +
      key +
      '</span><span class="jellyai-demo-kv-value">' +
      value +
      "</span></div>";
  }

  function lane(level, title, customers) {
    return '<div class="jellyai-demo-lane ' +
      level +
      '"><div class="jellyai-demo-lane-head"><span class="jellyai-demo-dot"></span>' +
      title +
      "</div>" +
      customers
        .map(function (customer) {
          return '<div class="jellyai-demo-customer"><div class="jellyai-demo-customer-name">' +
            customer[0] +
            '</div><div class="jellyai-demo-customer-meta">' +
            customer[1] +
            '</div><div class="jellyai-demo-customer-need">' +
            customer[2] +
            "</div></div>";
        })
        .join("") +
      "</div>";
  }

  function serviceStaticModals() {
    return staticModal("wechat") +
      staticModal("knowledge") +
      staticModal("reply") +
      staticModal("intent") +
      staticModal("service-flow");
  }

  function staticModal(type) {
    var id = "jellyai-modal-toggle-" + type;
    return '<input class="jellyai-modal-toggle" type="checkbox" id="' +
      id +
      '"><div class="jellyai-modal-backdrop jellyai-modal-static" id="jellyai-modal-backdrop-' +
      type +
      '">' +
      modalContent(type, id) +
      "</div>";
  }

  function openDemoModal(type) {
    closeDemoModal();
    var modal = document.createElement("div");
    modal.className = "jellyai-modal-backdrop";
    modal.dataset.jellyaiModalBackdrop = "true";
    modal.innerHTML = modalContent(type);
    document.body.appendChild(modal);
    var input = modal.querySelector(".jellyai-upload-input");
    if (input) input.focus();
  }

  function closeDemoModal() {
    var existing = document.querySelector(".jellyai-modal-backdrop");
    if (existing) existing.remove();
  }

  function modalContent(type, toggleId) {
    var map = {
      wechat: {
        title: "绑定微信渠道",
        body: '<div class="jellyai-modal-split"><div><div class="jellyai-qr"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div><div class="jellyai-modal-hint">使用企业微信管理员扫码，确认后会自动绑定客服账号。</div></div><div class="jellyai-modal-form">' +
          field("企业微信主体", "JellyAI 示例企业") +
          field("客服接待账号", "售前客服组 / 售后客服组") +
          field("消息同步范围", "客户消息、客服回复、会话标签") +
          '<div class="jellyai-modal-state">当前状态：等待扫码确认</div></div></div>',
        primary: "完成配置"
      },
      knowledge: {
        title: "知识库配置",
        body: '<div class="jellyai-modal-form">' +
          '<div class="jellyai-upload-box"><input class="jellyai-upload-input" type="file" multiple accept=".pdf,.doc,.docx,.md,.txt,.xlsx,.csv" onchange="window.JellyAIDemoUploadChange&&window.JellyAIDemoUploadChange(this)"><div class="jellyai-upload-title">上传规定格式文档</div><div class="jellyai-upload-desc">支持 PDF、Word、Markdown、TXT、Excel、CSV。上传后用于智能客服检索与生成回复。</div></div>' +
          '<div class="jellyai-upload-list"><div>product_faq.pdf <span>已解析</span></div><div>price_policy.docx <span>已启用</span></div><div>wechat_setup.md <span>待更新</span></div></div>' +
          field("知识库命中规则", "优先匹配最新版本文档") +
          field("低置信度处理", "转人工确认后再回复") +
          '<div class="jellyai-modal-state">配置未保存</div></div>',
        primary: "保存配置"
      },
      reply: {
        title: "回复策略配置",
        body: '<div class="jellyai-modal-form">' +
          option("自动优先", "常见咨询由 AI 自动回复，风险场景转人工。", true) +
          option("人工审核", "AI 生成建议回复，客服确认后发送。", false) +
          option("仅辅助总结", "AI 只总结客户问题，不自动发送消息。", false) +
          field("转人工关键词", "退款、投诉、合同、发票异常、无法登录") +
          field("回复口吻", "专业、简洁、主动给下一步") +
          '<div class="jellyai-modal-state">当前策略：自动优先</div></div>',
        primary: "保存策略"
      },
      intent: {
        title: "意向标记配置",
        body: '<div class="jellyai-modal-form">' +
          option("高意向", "询价、试用、合同、预算、上线时间明确。", true) +
          option("中意向", "对比方案、了解功能、需要资料。", true) +
          option("待培育", "只做初步咨询，暂未明确采购计划。", true) +
          option("风险咨询", "退款、投诉、负面情绪、合规问题。", true) +
          field("同步目标", "客户跟进流程 · 客户卡片") +
          '<div class="jellyai-modal-state">意向识别已开启</div></div>',
        primary: "保存标记"
      },
      "service-flow": {
        title: "智能客服流程",
        body: '<div class="jellyai-modal-flow">' +
          flowSteps([
            "管理员配置客服",
            "绑定微信渠道",
            "客户发来消息",
            "系统接收消息",
            "AI 判断问题类型",
            "调用知识库",
            "生成回复",
            "自动发送给客户",
            "记录聊天内容",
            "识别客户意向",
            "同步到客户跟进面板"
          ]) +
          '</div><div class="jellyai-modal-hint">这是演示流程说明。真实版本可以把每一步接入消息队列、知识库检索、发送回调和客户跟进系统。</div>',
        primary: "知道了"
      }
    };
    var modal = map[type] || map["service-flow"];
    var closeControl = toggleId
      ? '<label class="jellyai-modal-close" for="' + toggleId + '" onclick="this.closest(\'.jellyai-modal-backdrop\').style.display=\'none\'" aria-label="关闭">×</label>'
      : '<button type="button" class="jellyai-modal-close" data-jellyai-close="true" onclick="window.JellyAIDemoCloseModal&&window.JellyAIDemoCloseModal()" aria-label="关闭">×</button>';
    var cancelControl = toggleId
      ? '<label class="jellyai-demo-inline-btn" for="' + toggleId + '" onclick="this.closest(\'.jellyai-modal-backdrop\').style.display=\'none\'">取消</label>'
      : '<button type="button" class="jellyai-demo-inline-btn" data-jellyai-close="true" onclick="window.JellyAIDemoCloseModal&&window.JellyAIDemoCloseModal()">取消</button>';
    var primaryControl = toggleId
      ? '<label class="jellyai-demo-action-btn" for="' + toggleId + '" onclick="this.closest(\'.jellyai-modal-backdrop\').style.display=\'none\'">' + modal.primary + '</label>'
      : '<button type="button" class="jellyai-demo-action-btn" data-jellyai-save="true" onclick="window.JellyAIDemoSaveModal&&window.JellyAIDemoSaveModal()">' + modal.primary + "</button>";
    return '<div class="jellyai-modal" role="dialog" aria-modal="true"><div class="jellyai-modal-head"><div class="jellyai-modal-title">' +
      modal.title +
      "</div>" +
      closeControl +
      '</div><div class="jellyai-modal-body">' +
      modal.body +
      '</div><div class="jellyai-modal-actions">' +
      cancelControl +
      primaryControl +
      "</div></div>";
  }

  function field(label, value) {
    return '<label class="jellyai-modal-field"><span>' +
      label +
      '</span><input type="text" value="' +
      value +
      '"></label>';
  }

  function option(title, desc, checked) {
    return '<label class="jellyai-modal-option"><input type="checkbox"' +
      (checked ? " checked" : "") +
      '><span><strong>' +
      title +
      '</strong><small>' +
      desc +
      "</small></span></label>";
  }

  function handleUploadInput(input) {
    var list = document.querySelector(".jellyai-upload-list");
    if (!list) return;
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    list.innerHTML = files
      .map(function (file) {
        return "<div>" + file.name + " <span>待保存</span></div>";
      })
      .join("");
    var state = document.querySelector(".jellyai-modal-state");
    if (state) state.textContent = "已选择 " + files.length + " 个文档，点击保存配置后生效";
  }

  function saveDemoModal() {
    var state = document.querySelector(".jellyai-modal-state");
    if (state) state.textContent = "已保存：演示配置已更新";
    setTimeout(closeDemoModal, 650);
  }

  window.JellyAIDemoOpenModal = openDemoModal;
  window.JellyAIDemoCloseModal = closeDemoModal;
  window.JellyAIDemoSaveModal = saveDemoModal;
  window.JellyAIDemoUploadChange = handleUploadInput;
  window.JellyAIOpenSkills = function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    openSkillsRoute();
  };
  window.JellyAIOpenAdminGate = function (event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    openAdminGate();
  };
  window.JellyAIToggleMoreNav = toggleMoreNav;
  window.JellyAIOpenMoreNavItem = openMoreNavItem;

  document.addEventListener("change", function (event) {
    var input = event.target.closest && event.target.closest(".jellyai-upload-input");
    if (!input) return;
    handleUploadInput(input);
  });

  document.addEventListener("click", function (event) {
    var skillProxy = event.target.closest && event.target.closest("[data-jellyai-skill-proxy]");
    if (skillProxy) {
      event.preventDefault();
      event.stopPropagation();
      openSkillsRoute();
      return;
    }
    var adminNav = event.target.closest && event.target.closest("[data-jellyai-admin-nav]");
    if (adminNav) {
      event.preventDefault();
      event.stopPropagation();
      openAdminGate();
      return;
    }
    var moreToggle = event.target.closest && event.target.closest("[data-jellyai-more-toggle]");
    if (moreToggle) {
      toggleMoreNav(event);
      return;
    }
    var moreTarget = event.target.closest && event.target.closest("[data-jellyai-more-target]");
    if (moreTarget) {
      event.preventDefault();
      event.stopPropagation();
      openOriginalNav(moreTarget.dataset.jellyaiMoreTarget);
      return;
    }
    if (event.target.closest && event.target.closest("[data-jellyai-admin-submit]")) {
      event.preventDefault();
      event.stopPropagation();
      submitAdminGate();
      return;
    }
    if (event.target.closest && event.target.closest("[data-jellyai-admin-close]")) {
      event.preventDefault();
      event.stopPropagation();
      closeAdminGate();
      return;
    }
    if (event.target.classList && event.target.classList.contains("jellyai-admin-gate-backdrop")) {
      event.preventDefault();
      event.stopPropagation();
      closeAdminGate();
      return;
    }
    var action = event.target.closest && event.target.closest("[data-jellyai-modal]");
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      openDemoModal(action.dataset.jellyaiModal);
      return;
    }
    if (event.target.closest && event.target.closest("[data-jellyai-close]")) {
      event.preventDefault();
      event.stopPropagation();
      closeDemoModal();
      return;
    }
    if (event.target.dataset && event.target.dataset.jellyaiModalBackdrop === "true") {
      event.stopPropagation();
      closeDemoModal();
      return;
    }
    if (event.target.closest && event.target.closest("[data-jellyai-save]")) {
      event.preventDefault();
      event.stopPropagation();
      saveDemoModal();
    }
  }, true);

  document.addEventListener("keydown", function (event) {
    if (!document.querySelector(".jellyai-admin-gate-backdrop")) return;
    if (event.key === "Escape") {
      closeAdminGate();
      return;
    }
    if (event.key === "Enter" && event.target.closest && event.target.closest("[data-jellyai-admin-password]")) {
      event.preventDefault();
      submitAdminGate();
    }
  }, true);

  window.addEventListener("hashchange", function () {
    ensureDemoNav();
    if (isChatRoute()) {
      ensureChatCreditBar();
      ensureComposerVisible();
    }
    renderCurrentDemo();
  });

  function scheduleEnhancements(kind) {
    if (observerPending) return;
    observerPending = true;
    window.requestAnimationFrame(function () {
      observerPending = false;
      ensureJellyAIBranding();
      if (kind === "sidebar" || kind === "all") {
        ensureDemoNav();
        ensureCreditPanel();
      }
      if ((kind === "chat" || kind === "all") && isChatRoute()) {
        ensureChatCreditBar();
        ensureComposerVisible();
      }
      if (getDemoKey()) renderCurrentDemo();
    });
  }

  function mutationTouches(node, selector) {
    return !!(node && node.nodeType === 1 && (node.matches && node.matches(selector) || node.closest && node.closest(selector) || node.querySelector && node.querySelector(selector)));
  }

  var observer = new MutationObserver(function (mutations) {
    var sidebarChanged = false;
    var chatChanged = false;
    for (var index = 0; index < mutations.length; index += 1) {
      var mutation = mutations[index];
      if (mutationTouches(mutation.target, ".sidebar, .sidebar-nav, .model-selector, .profile-selector")) sidebarChanged = true;
      if (isChatRoute() && mutationTouches(mutation.target, ".app-main, main")) chatChanged = true;
      Array.prototype.forEach.call(mutation.addedNodes || [], function (node) {
        if (mutationTouches(node, ".sidebar, .sidebar-nav, .nav-item, .model-selector, .profile-selector")) sidebarChanged = true;
        if (isChatRoute() && mutationTouches(node, ".app-main, main, textarea, input, [contenteditable='true'], [role='textbox']")) chatChanged = true;
      });
      if (sidebarChanged || chatChanged) break;
    }
    if (sidebarChanged) scheduleEnhancements("sidebar");
    else if (chatChanged) scheduleEnhancements("chat");
  });

  function start() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
    syncJellyAIState();
    setInterval(syncJellyAIState, 5000);
    ensureJellyAIBranding();
    ensureDemoNav();
    ensureCreditPanel();
    enableModelControls();
    ensureChatCreditBar();
    ensureComposerVisible();
    setupCreditInterceptors();
    renderCurrentDemo();
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(prefetchOriginalRouteChunks, { timeout: 2500 });
    } else {
      setTimeout(prefetchOriginalRouteChunks, 1200);
    }
    setTimeout(ensureDemoNav, 500);
    setTimeout(ensureJellyAIBranding, 550);
    setTimeout(ensureCreditPanel, 600);
    setTimeout(enableModelControls, 700);
    setTimeout(ensureChatCreditBar, 800);
    setTimeout(ensureComposerVisible, 900);
    setTimeout(ensureDemoNav, 1500);
    setTimeout(ensureCreditPanel, 1600);
    setTimeout(ensureChatCreditBar, 1700);
    setTimeout(ensureComposerVisible, 1800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
