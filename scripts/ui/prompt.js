const open = new Map();

function escape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

let PromptClass = null;

/** Lazily defined so tests can import this module without Foundry globals. */
function promptClass() {
  if (PromptClass) return PromptClass;
  const { ApplicationV2 } = foundry.applications.api;

  PromptClass = class GuarderPrompt extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["pf2e-guarder", "pf2e-guarder-prompt-app"],
      tag: "section",
      window: { icon: "fa-solid fa-shield-halved", minimizable: false, resizable: false },
      position: { width: 440, height: "auto" },
      actions: {
        choose: GuarderPrompt.#choose,
      },
    };

    constructor({ title, icon, body, buttons, timeoutSeconds = 0, collect = null, onRender = null }, options = {}) {
      super({ ...options, window: { ...options.window, title, icon: icon ?? "fa-solid fa-shield-halved" } });
      this.body = body;
      this.buttons = buttons;
      this.timeoutSeconds = timeoutSeconds;
      this.collect = collect;
      this.onRenderBody = onRender;
      this.result = undefined;
      this.settle = () => {};
    }

    async _renderHTML() {
      const timer = this.timeoutSeconds > 0
        ? `<div class="guarder-timer" style="--guarder-timeout: ${this.timeoutSeconds}s"><span></span></div>`
        : "";
      // Hidden buttons are rendered inside the body (row actions) but still resolve through `choose`.
      const buttons = this.buttons.filter((button) => !button.hidden).map((button) => `<button type="button" class="guarder-button ${button.style ?? "subtle"}"
          data-action="choose" data-value="${escape(button.value)}" ${button.default ? "autofocus" : ""}>
          ${button.icon ? `<i class="${escape(button.icon)}"></i>` : ""}<span>${escape(button.label)}</span></button>`).join("");
      return `${timer}<div class="guarder-body">${this.body}</div><footer class="guarder-actions">${buttons}</footer>`;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
      this.onRenderBody?.(content, this);
    }

    static #choose(_event, target) {
      const button = this.buttons.find((entry) => String(entry.value) === target.dataset.value);
      if (!button) return;
      this.result = button.result ?? button.value;
      if (typeof this.result === "function") this.result = this.result(this.element);
      void this.close();
    }

    _onClose(options) {
      super._onClose(options);
      this.settle(this.result ?? null);
    }
  };
  return PromptClass;
}

/**
 * Show a Guarder prompt window and resolve with the chosen button's result, or null when it
 * is closed, times out, or is dismissed remotely through `dismissPrompts(prefix)`.
 * Each button: { value, label, icon, style: "primary" | "subtle" | "danger", default, result }.
 * A button's `result` may be a function receiving the window element.
 */
export function timedPrompt({ key = null, title, icon, body, buttons, timeoutSeconds = 0, onRender = null, classes = [] }) {
  const App = promptClass();
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const app = new App({ title, icon, body, buttons, timeoutSeconds, onRender }, { classes: ["pf2e-guarder", "pf2e-guarder-prompt-app", ...classes] });
    app.settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (key) open.delete(key);
      resolve(value ?? null);
    };
    if (key) open.set(key, app);
    if (timeoutSeconds > 0) timer = setTimeout(() => void app.close(), timeoutSeconds * 1000);
    void app.render({ force: true });
  });
}

/** The open prompt registered under `key`, for live updates (GM override board). */
export function openPrompt(key) {
  return open.get(key) ?? null;
}

/** Close every open prompt whose key starts with `prefix`. */
export function dismissPrompts(prefix) {
  for (const [key, app] of [...open]) if (key.startsWith(prefix)) void app.close();
}

export { escape as escapeHtml };
