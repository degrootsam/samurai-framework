/** Views: the Assert, Save as output, Page, Insert, New, Wait and Screenshot panels. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const VIEWS_PANELS_JS = String.raw`  const unavailable = (info, matcher) =>
    (matcher === "toHaveValue" && info.value === undefined) ||
    (matcher === "toHaveAttribute" && info.attributes.length === 0) ||
    (matcher === "toHaveCount" && info.counts.length === 0) ||
    (matcher === "toBeChecked" && !info.checkable) ||
    (matcher === "toBeEnabled" && !info.disableable) ||
    (matcher === "toHaveClass" && !info.className);
  // The computed value, as toHaveCSS reads it: camelCase names become kebab-case, --custom is kept
  const cssValueOf = (el, name) => {
    const trimmed = name.trim();
    if (!trimmed) return "";
    const property = trimmed.startsWith("--") ? trimmed : trimmed.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
    try { return getComputedStyle(el).getPropertyValue(property); } catch (err) { return ""; }
  };
  const prefill = (a, matcher) => {
    const info = a.info;
    if (matcher === "toHaveAttribute") {
      const found = info.attributes.find((at) => at.name === a.attribute) || info.attributes[0];
      return found ? found.value : "";
    }
    if (matcher === "toHaveCount") {
      const found = info.counts[a.countIndex];
      return found ? String(found.count) : "";
    }
    if (matcher === "toHaveClass") return info.className || "";
    if (matcher === "toHaveCSS") return a.cssValue;
    if (matcher === info.first.matcher && info.first.expected !== undefined) return info.first.expected;
    if (matcher === "toHaveText" || matcher === "toContainText") return info.text;
    if (matcher === "toHaveValue") return info.value || "";
    return "";
  };
  const assertValue = (a) => {
    const info = a.info;
    const expected = (type) => h("input", { type, class: "in", "data-field": "expected", value: a.expected, "data-enter": "assert-add", autocomplete: "off" });
    if (a.matcher === "toHaveText" || a.matcher === "toContainText" || a.matcher === "toHaveValue" || a.matcher === "toHaveClass") return h("div", { class: "val" }, expected("text"));
    if (a.matcher === "toHaveCSS") {
      return h("div", { class: "val" },
        h("input", { type: "text", class: "in code", "data-field": "cssName", value: a.cssName, placeholder: "Property", "data-enter": "assert-add", autocomplete: "off", spellcheck: "false" }),
        expected("text"));
    }
    if (a.matcher === "toHaveAttribute") {
      return h("div", { class: "val" },
        h("select", { class: "in", "data-field": "attribute" }, info.attributes.map((at) => {
          const shown = at.name + '="' + at.value + '"';
          return h("option", { value: at.name, selected: at.name === a.attribute }, shown.length > 44 ? shown.slice(0, 43) + "…" : shown);
        })),
        expected("text"));
    }
    if (a.matcher === "toHaveCount") {
      return h("div", { class: "val" },
        h("select", { class: "in", "data-field": "countIndex" }, info.counts.map((c, i) =>
          h("option", { value: String(i), selected: i === a.countIndex }, c.label + " (" + c.count + ")"))),
        expected("number"));
    }
    return null;
  };
  const assertPanel = () => {
    const a = ui.assert;
    const info = a.info;
    const head = h("div", { class: "h" }, "Assert", info && info.ok && h("code", { title: info.label }, info.label));
    if (!info) return [head, h("div", { class: "msg" }, "…")];
    if (!info.ok) return [head, h("div", { class: "err" }, info.error)];
    return [
      head,
      h("div", { class: "opts" }, MATCHERS.map(([matcher, label]) =>
        h("button", { class: a.matcher === matcher ? "o sel" : "o", "data-action": "matcher", "data-matcher": matcher, disabled: unavailable(info, matcher) }, label))),
      assertValue(a),
      a.error && h("div", { class: "err" }, a.error),
      h("div", { class: "row" },
        h("label", { class: "neg" }, h("input", { type: "checkbox", "data-action": "not", checked: a.not }), "Not"),
        h("button", { class: "add", "data-action": "assert-add", disabled: ui.busy }, "Add")),
    ];
  };

  // What the output would hold, as outputs.save reads it: the pattern's first group, else its whole match, else the text
  const captureOf = (text, pattern) => {
    if (!pattern.trim()) return { value: text };
    let re;
    try { re = new RegExp(pattern.trim()); } catch (err) { return { error: "Not a valid pattern" }; }
    const match = re.exec(text);
    if (!match) return { error: "No match" };
    return { value: match[1] !== undefined ? match[1] : match[0] };
  };
  // An element that shows a secret reaches the page with it masked: the recorder works out its preview from the real text
  const askPreview = (o) => {
    o.preview = null;
    post({ action: "output-preview", id: o.id, pattern: o.pattern.trim() });
  };
  const outputCapture = (o) => {
    if (!o.info.showsSecret) return captureOf(o.info.outputText, o.pattern);
    if (!o.preview) return { value: "…" };
    return o.preview.ok ? { value: o.preview.value, secret: o.preview.secret } : { error: o.preview.error };
  };
  const outputPanel = () => {
    const o = ui.output;
    const info = o.info;
    const head = h("div", { class: "h" }, "Save as output", info && info.ok && h("code", { title: info.label }, info.label));
    if (!info) return [head, h("div", { class: "msg" }, "…")];
    if (!info.ok) return [head, h("div", { class: "err" }, info.error)];
    const capture = outputCapture(o);
    return [
      head,
      info.showsSecret && h("div", { class: "warn out-secret" }, "This element shows a secret. The saved output may contain it; use a pattern that captures only the non-secret part."),
      h("div", { class: "lbl" }, "Text"),
      h("div", { class: "msg out-text" }, info.showsSecret ? info.outputText : info.text),
      h("div", { class: "lbl" }, "Name"),
      h("div", { class: "f" }, h("input", { type: "text", class: "in code", "data-field": "outputName", value: o.name, "data-enter": "output-save", autocomplete: "off", spellcheck: "false" })),
      o.nameError && h("div", { class: "field-error" }, o.nameError),
      h("div", { class: "lbl" }, "Pattern (optional)"),
      h("div", { class: "f" }, h("input", { type: "text", class: "in code", "data-field": "outputPattern", value: o.pattern, placeholder: "Order #(\\d+)", "data-enter": "output-save", autocomplete: "off", spellcheck: "false" })),
      h("div", { class: "lbl" }, "Saves"),
      capture.error ? h("div", { class: "warn out-capture" }, capture.error) : h("code", { class: "out-capture" }, capture.value),
      capture.secret && h("div", { class: "err out-leak" }, "The output will contain a secret: reports mask it, but whatever reads the output gets the real value."),
      o.error && h("div", { class: "err" }, o.error),
      h("div", { class: "foot" }, h("button", { class: "add", "data-action": "output-save", disabled: ui.busy || !o.name.trim() }, "Save")),
    ];
  };

  const pagePanel = () => {
    const p = ui.page;
    const head = h("div", { class: "h" }, "Page");
    if (!p.info) return [head, h("div", { class: "msg" }, "…")];
    if (!p.info.ok) return [head, h("div", { class: "err" }, p.info.error)];
    return [
      head,
      h("div", { class: "opts" }, PAGE_MATCHERS.map(([matcher, label]) =>
        h("button", { class: p.matcher === matcher ? "o sel" : "o", "data-action": "page-matcher", "data-matcher": matcher }, label))),
      h("div", { class: "val" },
        h("input", { type: "text", class: "in", "data-field": "pageExpected", value: p.expected, "data-enter": "page-add", autocomplete: "off", spellcheck: "false" })),
      p.error && h("div", { class: "err" }, p.error),
      h("div", { class: "row" },
        h("label", { class: "neg" }, h("input", { type: "checkbox", "data-action": "page-not", checked: p.not }), "Not"),
        h("button", { class: "add", "data-action": "page-add", disabled: ui.busy }, "Add")),
    ];
  };

  const matches = () => {
    const filter = ui.insert.filter.trim().toLowerCase();
    const hit = (item) => !filter || item.name.toLowerCase().indexOf(filter) >= 0;
    return {
      filter,
      variables: state.canAddVariables ? state.variables.filter(hit) : [],
      secrets: state.secrets.filter(hit),
      inputs: (state.inputs || []).filter(hit),
    };
  };
  const insertPanel = () => {
    const ins = ui.insert;
    if (!ins.field) return [h("div", { class: "h" }, "Insert"), h("div", { class: "msg" }, "Click into a field first")];
    const found = matches();
    const none = found.filter && found.variables.length === 0 && found.secrets.length === 0 && found.inputs.length === 0;
    const item = (kind, name, value) =>
      h("button", { class: "it", "data-action": "insert-item", "data-kind": kind, "data-name": name, disabled: ui.busy }, h("code", null, name), value);
    return [
      h("div", { class: "h stack" }, 'Insert into "' + fieldLabel(ins.field) + '"', h("small", null, "Environment: " + state.environment)),
      h("input", { type: "text", class: "in search", "data-field": "filter", placeholder: "Filter…", value: ins.filter, "data-enter": "insert-first", autocomplete: "off", spellcheck: "false" }),
      state.canAddVariables && [
        h("div", { class: "grp" }, "Variables"),
        found.variables.length
          ? found.variables.map((v) => item("env", v.name, h("span", { class: "v", title: v.value }, v.value)))
          : h("div", { class: "empty" }, found.filter ? "No variable matches." : "No variables yet."),
      ],
      h("div", { class: "grp" }, "Secrets"),
      found.secrets.length
        ? found.secrets.map((s) => item("secret", s.name, s.set ? h("span", { class: "v" }, "••••••") : h("span", { class: "warn" }, "not set")))
        : h("div", { class: "empty" }, found.filter ? "No secret matches." : "No secrets yet."),
      h("div", { class: "grp" }, "Inputs"),
      found.inputs.length
        ? found.inputs.map((i) => item("input", i.name, h("span", { class: "v", title: i.value }, i.value)))
        : h("div", { class: "empty" }, found.filter ? "No input matches." : "No inputs yet."),
      ins.error && h("div", { class: "err" }, ins.error),
      h("button", { class: "act", "data-action": "insert-new", "data-kind": "env" }, "+ Add variable" + (none ? ' "' + variableName(ins.filter) + '"' : "")),
      h("button", { class: "act", "data-action": "insert-new", "data-kind": "secret" }, "+ Add secret" + (none ? ' "' + snake(ins.filter) + '"' : "")),
      h("button", { class: "act", "data-action": "insert-new", "data-kind": "input" }, "+ Add input" + (none ? ' "' + camel(ins.filter) + '"' : "")),
    ];
  };

  const newHint = (kind, secret, env, name) => {
    if (kind === "input") return "Declared in the test's inputs, with this value as its default.";
    if (!secret) return ["Saved to ", h("code", null, "environments." + env + ".variables"), " in samurai.config.ts. Other environments don't get it — add it there before running against them."];
    if (!state.secretsIgnored) return h("span", { class: "warn" }, "Add .env." + env + " to .gitignore before committing.");
    return ["Saved as ", h("code", null, "SAMURAI_SECRET_" + (name.trim() || "<NAME>")), " in ", h("code", null, ".env." + env), " (git-ignored)."];
  };
  const newPanel = () => {
    const f = ui.form;
    const secret = f.kind === "secret";
    const blocked = f.kind === "env" && !state.canAddVariables;
    const env = state.environment;
    return [
      h("div", { class: "h stack" }, f.setValue ? "Set value" : secret ? "New secret" : f.kind === "input" ? "New input" : "New variable", h("small", null, 'For "' + fieldLabel(ui.insert.field) + '"')),
      h("div", { class: "seg" },
        h("button", { class: f.kind === "env" ? "sel" : "", "data-action": "new-kind", "data-kind": "env" }, "Variable"),
        h("button", { class: secret ? "sel" : "", "data-action": "new-kind", "data-kind": "secret" }, "Secret"),
        h("button", { class: f.kind === "input" ? "sel" : "", "data-action": "new-kind", "data-kind": "input" }, "Input")),
      blocked
        ? h("div", { class: "msg" }, "This recording has no environment")
        : [
            h("div", { class: "lbl" }, "Name"),
            h("div", { class: "f" }, h("input", { type: "text", class: "in code", "data-field": "name", value: f.name, "data-enter": "new-save", autocomplete: "off", spellcheck: "false" })),
            f.nameError && h("div", { class: "field-error" }, f.nameError),
            h("div", { class: "lbl" }, f.kind === "input" ? "Default value" : "Value in " + env),
            h("div", { class: "f" }, h("input", { type: secret ? "password" : "text", class: "in", "data-field": "value", value: f.value, "data-enter": "new-save", autocomplete: secret ? "new-password" : "off" })),
            h("div", { class: "hint" }, newHint(f.kind, secret, env, f.name)),
            f.error && h("div", { class: "err" }, f.error),
          ],
      h("div", { class: "foot plain" },
        h("button", { class: "cancel", "data-action": "new-cancel" }, "Cancel"),
        !blocked && h("button", { class: "add", "data-action": "new-save", disabled: ui.busy || !f.name.trim() }, "Save and insert")),
    ];
  };

  const secondsValid = () => {
    const seconds = Number(ui.wait.seconds);
    return ui.wait.seconds.trim() !== "" && isFinite(seconds) && seconds >= 0.1 && seconds <= 60;
  };
  const radio = (field, value, checked, ...label) =>
    h("label", { class: "radio" }, h("input", { type: "radio", name: field, "data-field": field, value, checked }), label);
  const waitPanel = () => [
    h("div", { class: "h" }, "Wait"),
    radio("waitKind", "idle", ui.wait.kind === "idle", "Until the page settles"),
    h("div", { class: "sub" }, "No requests for 500 ms"),
    radio("waitKind", "time", ui.wait.kind === "time", "For ",
      h("input", { type: "number", class: "num", "data-field": "seconds", min: "0.1", max: "60", step: "0.1", value: ui.wait.seconds, "data-enter": "wait-add" }),
      " seconds"),
    h("div", { class: "foot" }, h("button", { class: "add", "data-action": "wait-add", disabled: ui.busy || (ui.wait.kind === "time" && !secondsValid()) }, "Add")),
  ];
  const screenshotPanel = () => [
    h("div", { class: "h" }, "Screenshot"),
    h("div", { class: "grp" }, "Name"),
    h("div", { class: "f" }, h("input", { type: "text", class: "in", "data-field": "shotName", value: ui.shot.name, "data-enter": "screenshot-add", autocomplete: "off", spellcheck: "false" })),
    radio("fullPage", "false", !ui.shot.fullPage, "Visible part"),
    radio("fullPage", "true", ui.shot.fullPage, "Whole page"),
    h("div", { class: "foot" }, h("button", { class: "add", "data-action": "screenshot-add", disabled: ui.busy }, "Add")),
  ];
  const PANELS = { assert: assertPanel, output: outputPanel, page: pagePanel, insert: insertPanel, new: newPanel, wait: waitPanel, screenshot: screenshotPanel };
`;
