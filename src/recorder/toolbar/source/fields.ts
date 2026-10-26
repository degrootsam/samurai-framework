/** press() for tests and form field updates. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const FIELDS_JS = String.raw`  const press = (action, detail) => {
    const handler = handlers[action];
    if (handler) handler(detail || {});
  };

  const onField = (event, target) => {
    const t = target || event.target;
    const field = t && t.getAttribute && t.getAttribute("data-field");
    if (!field) return;
    const value = t.value;
    if (field === "expected" && ui.assert) ui.assert.expected = value;
    else if (field === "pageExpected" && ui.page) ui.page.expected = value;
    else if ((field === "outputName" || field === "outputPattern") && ui.output) {
      const key = field === "outputName" ? "name" : "pattern";
      if (ui.output[key] === value) return;
      ui.output[key] = value;
      if (key === "name") ui.output.nameError = null;
      else ui.output.error = null;
      render();
    }
    else if (field === "attribute" && ui.assert) {
      ui.assert.attribute = value;
      ui.assert.expected = prefill(ui.assert, "toHaveAttribute");
      render();
    } else if (field === "cssName" && ui.assert) {
      if (ui.assert.cssName === value) return;
      ui.assert.cssName = value;
      // The computed CSS value skips the secret filter on purpose: a computed style can't carry an
      // input's typed value, and it is already visible on the page
      ui.assert.cssValue = cssValueOf(ui.assert.target, value);
      ui.assert.expected = prefill(ui.assert, "toHaveCSS");
      render();
    } else if (field === "countIndex" && ui.assert) {
      ui.assert.countIndex = Number(value);
      ui.assert.expected = prefill(ui.assert, "toHaveCount");
      render();
    } else if (field === "filter" && ui.insert) {
      if (ui.insert.filter === value) return;
      ui.insert.filter = value;
      render();
    } else if (field === "name" && ui.form) {
      if (ui.form.name === value) return;
      ui.form.name = value;
      ui.form.nameError = null;
      render();
    } else if (field === "value" && ui.form) ui.form.value = value;
    else if (field === "waitKind") {
      ui.wait.kind = value === "time" ? "time" : "idle";
      render();
    } else if (field === "seconds") {
      ui.wait.seconds = value;
      ui.wait.kind = "time";
      render();
    } else if (field === "shotName") ui.shot.name = value;
    else if (field === "fullPage") {
      ui.shot.fullPage = value === "true";
      render();
    }
  };
`;
