(function () {
  var ADMIN_PASSWORD = "jellyai";
  var state = null;
  var toast = document.querySelector("[data-admin-toast]");
  var amountInput = document.querySelector("[data-credit-amount]");
  var modelForm = document.querySelector("[data-model-form]");

  function isAuthed() {
    try {
      return window.sessionStorage && window.sessionStorage.getItem("jellyai_admin_authed") === "true";
    } catch (error) {
      return false;
    }
  }

  function setAuthed() {
    try {
      if (window.sessionStorage) window.sessionStorage.setItem("jellyai_admin_authed", "true");
    } catch (error) {
      return;
    }
  }

  function requireAuth() {
    if (isAuthed()) return true;
    document.body.classList.add("admin-locked");
    var overlay = document.createElement("div");
    overlay.className = "admin-lock-overlay";
    overlay.innerHTML =
      '<div class="admin-lock-card">' +
      '<img src="/logo.png" alt="JellyAI">' +
      '<h1>JellyAI 管理后台</h1>' +
      '<p>请输入后台密码后进入模型、积分和授权管理。</p>' +
      '<input type="password" placeholder="请输入密码" data-admin-lock-password autocomplete="current-password">' +
      '<div class="admin-lock-error" data-admin-lock-error></div>' +
      '<button type="button" class="primary-btn" data-admin-lock-submit>进入后台</button>' +
      '<a href="/#/hermes/chat">返回本地客户端</a>' +
      '</div>';
    document.body.appendChild(overlay);
    setTimeout(function () {
      var input = overlay.querySelector("[data-admin-lock-password]");
      if (input) input.focus();
    }, 30);
    return false;
  }

  function submitAuth() {
    var input = document.querySelector("[data-admin-lock-password]");
    var error = document.querySelector("[data-admin-lock-error]");
    if (!input) return;
    if (input.value === ADMIN_PASSWORD) {
      setAuthed();
      document.body.classList.remove("admin-locked");
      var overlay = document.querySelector(".admin-lock-overlay");
      if (overlay) overlay.remove();
      loadState();
      return;
    }
    if (error) error.textContent = "密码错误，请重新输入";
    input.select();
  }

  function formatNumber(num) {
    return String(Number(num) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function text(selector, value) {
    var node = document.querySelector(selector);
    if (node) node.textContent = value;
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(function () {
      toast.classList.remove("show");
    }, 1800);
  }

  function api(path, options) {
    return fetch(path, Object.assign({
      headers: { "Content-Type": "application/json" }
    }, options || {})).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () {
          return {};
        }).then(function (body) {
          throw new Error(body.error || "请求失败");
        });
      }
      return response.json();
    });
  }

  function loadState() {
    return api("/api/jellyai/state").then(function (nextState) {
      state = nextState;
      renderState();
      return nextState;
    }).catch(function (error) {
      showToast("本地后台未连接：" + error.message);
    });
  }

  function renderState() {
    if (!state) return;
    var user = state.user || {};
    var summary = state.summary || {};

    text("[data-active-users]", formatNumber(summary.activeUsers));
    text("[data-model-calls]", formatNumber(summary.modelCallsToday));
    text("[data-total-credits]", formatNumber(summary.todayCredits || user.todayCost));
    text("[data-gateway-status]", summary.gatewayStatus || "运行中");
    text("[data-user-name]", user.name || "-");
    text("[data-user-key]", user.licenseKey || "-");
    text("[data-user-expires]", user.expiresAt || "-");
    text("[data-user-credits]", formatNumber(user.credits));
    text("[data-user-skills]", (user.skills || []).join(" / ") || "-");
    text("[data-user-status]", user.status || "-");

    renderLedger(state.ledger || []);
    renderModels(state.models || []);
  }

  function renderLedger(items) {
    var ledger = document.querySelector("[data-ledger]");
    if (!ledger) return;
    ledger.innerHTML = items.map(function (item) {
      var delta = Number(item.delta) || 0;
      var sign = delta > 0 ? "+" : "";
      return "<div><span>" + sign + formatNumber(delta) + "</span><p>" +
        escapeHtml(item.message || "") + "</p><time>" + escapeHtml(item.time || "") + "</time></div>";
    }).join("");
  }

  function renderModels(models) {
    var list = document.querySelector("[data-model-list]");
    if (!list) return;
    list.innerHTML = models.map(function (model) {
      var enabled = model.enabled !== false;
      var label = model.default ? "默认模型" : enabled ? "备用" : "关闭";
      return '<article class="model-card' + (model.default ? " default-model" : "") + '">' +
        '<div class="model-card-head"><span>' + escapeHtml(model.provider || "JellyAI Gateway") +
        '</span><mark>' + label + '</mark></div>' +
        '<h3>' + escapeHtml(model.name || "-") + '</h3>' +
        '<p>' + escapeHtml(model.note || "由 JellyAI 统一模型网关提供。") + '</p>' +
        '<div class="model-key">Key：' + (model.hasKey ? escapeHtml(model.maskedKey || "已配置") : "未配置") + '</div>' +
        '<div class="model-meta"><span>成本倍率 ' + escapeHtml(model.costMultiplier || 1) + 'x</span>' +
        '<button type="button" class="toggle ' + (enabled ? "on" : "") + '" data-model-toggle="' +
        escapeHtml(model.id) + '">' + (enabled ? "启用" : "关闭") + '</button></div>' +
        '<div class="model-card-actions">' +
        '<button type="button" class="secondary-btn" data-model-default="' + escapeHtml(model.id) + '"' +
        (model.default ? " disabled" : "") + '>设为默认</button>' +
        '</div></article>';
    }).join("");
  }

  function getAmount() {
    var amount = parseInt(amountInput && amountInput.value ? amountInput.value : "0", 10);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function changeCredits(delta) {
    return api("/api/jellyai/admin/credits", {
      method: "POST",
      body: JSON.stringify({
        delta: delta,
        message: delta > 0 ? "管理员为广州迅达物流增加积分" : "管理员手动扣减积分"
      })
    }).then(function (nextState) {
      state = nextState;
      renderState();
      showToast((delta > 0 ? "已增加 " : "已扣减 ") + formatNumber(Math.abs(delta)) + " 积分");
    }).catch(function (error) {
      showToast(error.message);
    });
  }

  function saveModel(event) {
    event.preventDefault();
    var data = new FormData(modelForm);
    var name = String(data.get("name") || "").trim();
    if (!name) {
      showToast("请输入模型名称");
      return;
    }

    api("/api/jellyai/admin/models", {
      method: "POST",
      body: JSON.stringify({
        provider: data.get("provider"),
        name: name,
        apiKey: data.get("apiKey"),
        costMultiplier: Number(data.get("costMultiplier") || 1),
        default: data.get("default") === "on",
        enabled: true
      })
    }).then(function (nextState) {
      state = nextState;
      renderState();
      modelForm.reset();
      modelForm.elements.provider.value = "JellyAI Gateway";
      modelForm.elements.costMultiplier.value = "1";
      showToast("模型已保存并同步到 JellyAI 前端");
    }).catch(function (error) {
      showToast(error.message);
    });
  }

  function setDefaultModel(id) {
    api("/api/jellyai/admin/models/default", {
      method: "POST",
      body: JSON.stringify({ id: id })
    }).then(function (nextState) {
      state = nextState;
      renderState();
      showToast("默认模型已更新");
    }).catch(function (error) {
      showToast(error.message);
    });
  }

  function toggleModel(id, enabled) {
    api("/api/jellyai/admin/models/toggle", {
      method: "POST",
      body: JSON.stringify({ id: id, enabled: enabled })
    }).then(function (nextState) {
      state = nextState;
      renderState();
      showToast("模型启用状态已同步");
    }).catch(function (error) {
      showToast(error.message);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  var addBtn = document.querySelector("[data-credit-add]");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      var amount = getAmount();
      if (!amount) return showToast("请输入有效积分数量");
      changeCredits(amount);
    });
  }

  var subtractBtn = document.querySelector("[data-credit-subtract]");
  if (subtractBtn) {
    subtractBtn.addEventListener("click", function () {
      var amount = getAmount();
      if (!amount) return showToast("请输入有效积分数量");
      changeCredits(-amount);
    });
  }

  if (modelForm) modelForm.addEventListener("submit", saveModel);

  document.addEventListener("click", function (event) {
    var defaultBtn = event.target.closest && event.target.closest("[data-model-default]");
    if (defaultBtn && !defaultBtn.disabled) {
      setDefaultModel(defaultBtn.dataset.modelDefault);
      return;
    }

    var toggleBtn = event.target.closest && event.target.closest("[data-model-toggle]");
    if (toggleBtn) {
      toggleModel(toggleBtn.dataset.modelToggle, !toggleBtn.classList.contains("on"));
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-demo-toast]"), function (button) {
    button.addEventListener("click", function () {
      showToast(button.dataset.demoToast || "演示操作已完成");
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".skill-card input"), function (checkbox) {
    checkbox.addEventListener("change", function () {
      showToast("Skill 开通状态已更新");
    });
  });

  document.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest("[data-admin-lock-submit]")) {
      event.preventDefault();
      submitAuth();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && event.target.closest && event.target.closest("[data-admin-lock-password]")) {
      event.preventDefault();
      submitAuth();
    }
  });

  if (requireAuth()) loadState();
})();
